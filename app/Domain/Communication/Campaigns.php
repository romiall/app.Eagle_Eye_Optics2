<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Application\Effects\IdempotencyStore;
use App\Application\Effects\OutboxEvent;
use App\Application\Effects\OutboxWriter;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Access\Approvals\ExactApprovals;
use App\Domain\Access\AuditRecorder;
use App\Domain\Billing\BillingErrors;
use App\Domain\Billing\Guards\ActorRights;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Support\Integrations\Messaging\DestinationCipher;
use App\Support\Integrations\Messaging\MessagingClientFactory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Campagnes ciblées par segment administratif (L2D08) :
 * - création en brouillon (`DRAFT`) ;
 * - prévisualisation (`preview`) calculant éligibles vs exclus (sans consentement ou destination) ;
 * - gel atomique (`freeze`) avec consommation stricte d'une approbation gérante `CAMPAIGN_SEND` (exact eligible_count) ;
 * - exécution par lots bornés (`execute`) recontrôlant le consentement avant chaque envoi puis émettant
 *   `CampaignCompleted` dans l'outbox ;
 * - suspension (`pause` -> `CANCELLED`).
 */
final class Campaigns
{
    public const EXECUTE_BATCH_SIZE = 50;

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AudienceSegments $segments,
        private readonly ConsentLedger $consents,
        private readonly MessageTemplates $templates,
        private readonly DestinationCipher $cipher,
        private readonly MessagingClientFactory $clients,
        private readonly ExactApprovals $approvals,
        private readonly ActorRights $rights,
        private readonly OutboxWriter $outbox,
        private readonly IdempotencyStore $idempotency,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $filters
     * @return array{items: list<stdClass>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function list(string $clinicId, array $filters = []): array
    {
        $perPage = 25;
        $page = isset($filters['page']) && is_int($filters['page']) ? max(1, $filters['page']) : 1;

        $query = DB::table('campaign_definitions')->where('clinic_id', $clinicId);
        if (is_string($filters['status'] ?? null) && $filters['status'] !== '') {
            $query->where('status', $filters['status']);
        }

        $total = (int) (clone $query)->count();
        $lastPage = max(1, intdiv($total + $perPage - 1, $perPage));
        $rows = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->forPage($page, $perPage)
            ->get()
            ->all();

        return [
            'items' => $this->hydrateCampaignCounts($clinicId, array_values($rows)),
            'meta' => [
                'current_page' => $page,
                'last_page' => $lastPage,
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    public function get(string $clinicId, string $campaignId): stdClass
    {
        $row = DB::table('campaign_definitions')
            ->where('clinic_id', $clinicId)
            ->where('id', $campaignId)
            ->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        return $this->hydrateCampaignCounts($clinicId, [$row])[0];
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array{items: list<stdClass>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function recipients(string $clinicId, string $campaignId, array $filters = []): array
    {
        $exists = DB::table('campaign_definitions')
            ->where('clinic_id', $clinicId)
            ->where('id', $campaignId)
            ->exists();
        if (! $exists) {
            throw BusinessError::notFound();
        }

        $perPage = 25;
        $page = isset($filters['page']) && is_int($filters['page']) ? max(1, $filters['page']) : 1;

        $query = DB::table('campaign_recipients')
            ->where('clinic_id', $clinicId)
            ->where('campaign_id', $campaignId);

        if (is_string($filters['status'] ?? null) && $filters['status'] !== '') {
            $query->where('status', $filters['status']);
        }

        $channel = (string) (DB::table('campaign_definitions as c')
            ->join('message_template_versions as v', static function ($join): void {
                $join->on('v.clinic_id', '=', 'c.clinic_id')->on('v.id', '=', 'c.template_version_id');
            })
            ->join('message_templates as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'v.clinic_id')->on('t.id', '=', 'v.template_id');
            })
            ->where('c.clinic_id', $clinicId)
            ->where('c.id', $campaignId)
            ->value('t.channel') ?: 'SMS');

        $total = (int) (clone $query)->count();
        $lastPage = max(1, intdiv($total + $perPage - 1, $perPage));
        $rows = $query->orderBy('id')->forPage($page, $perPage)->get()->all();

        foreach ($rows as $row) {
            $row->destination_masked = $this->maskRecipientCiphertext($channel, (string) $row->destination_ciphertext);
        }

        return [
            'items' => array_values($rows),
            'meta' => [
                'current_page' => $page,
                'last_page' => $lastPage,
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function create(CommandContext $context, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $name = CommunicationRules::requiredText((string) ($payload['name'] ?? ''), 180, 'name');
        $segmentId = (string) ($payload['segment_id'] ?? '');
        $templateVersionId = (string) ($payload['template_version_id'] ?? '');
        $scheduledAtRaw = is_string($payload['scheduled_at'] ?? null) && trim($payload['scheduled_at']) !== ''
            ? $payload['scheduled_at']
            : null;
        $scheduledAtDb = $scheduledAtRaw !== null
            ? CarbonImmutable::parse($scheduledAtRaw, 'UTC')->utc()->format('Y-m-d H:i:s.u')
            : null;

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'name' => $name,
            'segment_id' => $segmentId,
            'template_version_id' => $templateVersionId,
            'scheduled_at' => $scheduledAtRaw,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use (
            $context,
            $name,
            $segmentId,
            $templateVersionId,
            $scheduledAtDb,
            $cleanKey,
            $fingerprint,
        ): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'CreateCampaign', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->get($context->clinicId, (string) $existingIdem->result_id);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'CreateCampaign', $cleanKey, $fingerprint);
                }
            }

            $segmentExists = DB::table('audience_segments')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $segmentId)
                ->exists();
            if (! $segmentExists) {
                throw BusinessError::notFound();
            }

            $versionExists = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $templateVersionId)
                ->exists();
            if (! $versionExists) {
                throw BusinessError::notFound();
            }

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            DB::table('campaign_definitions')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'name' => $name,
                'segment_id' => $segmentId,
                'template_version_id' => $templateVersionId,
                'approval_id' => null,
                'scheduled_at' => $scheduledAtDb,
                'status' => 'DRAFT',
                'created_by' => (string) $context->actorId,
                'target_frozen_at' => null,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.campaign.created',
                'campaign_definitions',
                $id,
                null,
                ['name' => $name, 'segment_id' => $segmentId, 'template_version_id' => $templateVersionId],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'campaign_definitions', $id, ['id' => $id]);
            }

            return $this->get($context->clinicId, $id);
        });
    }

    /**
     * @return array{campaign_id: string, total_candidates: int, eligible_count: int, excluded_count: int, sample: list<stdClass>}
     */
    public function preview(CommandContext $context, string $campaignId): array
    {
        $campaign = DB::table('campaign_definitions')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $campaignId)
            ->first();
        if (! $campaign instanceof stdClass) {
            throw BusinessError::notFound();
        }

        $version = $this->loadTemplateVersion($context->clinicId, (string) $campaign->template_version_id);

        if ((string) $campaign->status !== 'DRAFT') {
            $frozenRows = DB::table('campaign_recipients')
                ->where('clinic_id', $context->clinicId)
                ->where('campaign_id', $campaignId)
                ->orderBy('id')
                ->get()
                ->all();

            $eligible = 0;
            $excluded = 0;
            $sample = [];
            foreach ($frozenRows as $row) {
                if ((string) $row->status === 'EXCLUDED') {
                    $excluded++;
                } else {
                    $eligible++;
                }
                if (count($sample) < 25) {
                    $row->destination_masked = $this->maskRecipientCiphertext((string) $version->template_channel, (string) $row->destination_ciphertext);
                    $sample[] = $row;
                }
            }

            return [
                'campaign_id' => $campaignId,
                'total_candidates' => count($frozenRows),
                'eligible_count' => $eligible,
                'excluded_count' => $excluded,
                'sample' => $sample,
            ];
        }

        $evaluated = $this->evaluateRecipients(
            $context->clinicId,
            $campaign,
            $version,
            $context->now,
        );

        $eligibleCount = 0;
        $excludedCount = 0;
        $sample = [];
        $nowStr = $context->now->format('Y-m-d H:i:s.u');

        foreach ($evaluated as $item) {
            if ($item['status'] === 'ELIGIBLE') {
                $eligibleCount++;
            } else {
                $excludedCount++;
            }
            if (count($sample) < 25) {
                $sample[] = (object) [
                    'id' => Ulid::generate(),
                    'campaign_id' => $campaignId,
                    'patient_id' => $item['patient_id'],
                    'prospect_contact_id' => $item['prospect_contact_id'],
                    'destination_masked' => $item['destination_masked'],
                    'consent_event_id' => $item['consent_event_id'],
                    'status' => $item['status'],
                    'exclusion_reason' => $item['exclusion_reason'],
                    'consent_checked_at' => $nowStr,
                ];
            }
        }

        return [
            'campaign_id' => $campaignId,
            'total_candidates' => count($evaluated),
            'eligible_count' => $eligibleCount,
            'excluded_count' => $excludedCount,
            'sample' => $sample,
        ];
    }

    /**
     * Gèle les destinataires de la campagne sous approbation exacte gérante `CAMPAIGN_SEND`.
     *
     * @param  array<string, mixed>  $payload
     */
    public function freeze(CommandContext $context, string $campaignId, array $payload = [], ?string $idempotencyKey = null): stdClass
    {
        $requestedApprovalId = is_string($payload['approval_id'] ?? null) && trim($payload['approval_id']) !== ''
            ? trim($payload['approval_id'])
            : null;
        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'campaign_id' => $campaignId,
            'approval_id' => $requestedApprovalId,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use (
            $context,
            $campaignId,
            $requestedApprovalId,
            $cleanKey,
            $fingerprint,
        ): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'FreezeCampaign', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->get($context->clinicId, $campaignId);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'FreezeCampaign', $cleanKey, $fingerprint);
                }
            }

            $campaign = $locks->campaignDefinition($campaignId);
            if ($campaign === null) {
                throw BusinessError::notFound();
            }

            if ((string) $campaign->status !== 'DRAFT') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Seul un brouillon de campagne peut être figé et approuvé.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => (string) $campaign->status],
                );
            }

            $version = $this->templates->requireApprovedVersion($context->clinicId, (string) $campaign->template_version_id);
            $locks->messageTemplate((string) $version->template_id);

            $evaluated = $this->evaluateRecipients($context->clinicId, $campaign, $version, $context->now);
            $eligibleCount = 0;
            foreach ($evaluated as $item) {
                if ($item['status'] === 'ELIGIBLE') {
                    $eligibleCount++;
                }
            }

            if ($eligibleCount < 1) {
                throw BusinessError::validation([
                    'campaign_id' => ['Impossible de figer la campagne : aucun destinataire éligible avec consentement actif.'],
                ]);
            }

            $subject = ApprovalSubject::campaignSend(
                $campaignId,
                (string) $campaign->segment_id,
                (string) $campaign->template_version_id,
                $eligibleCount,
            );

            if ($requestedApprovalId !== null) {
                $auth = $this->approvals->authorize(
                    $locks,
                    $context,
                    $requestedApprovalId,
                    $subject,
                    'Validation gérante et gel de la campagne ('.$eligibleCount.' destinataire(s))',
                );
            } elseif ($this->rights->manager($context) && $this->rights->has($context, 'communication.manage')) {
                $auth = $this->approvals->authorize(
                    $locks,
                    $context,
                    Ulid::generate(),
                    $subject,
                    'Gel et autorisation directe de campagne par la gérante ('.$eligibleCount.' destinataire(s))',
                );
            } else {
                throw BillingErrors::approvalRequired([
                    'approval_id' => ['Une approbation gérante CAMPAIGN_SEND correspondant au nombre exact de destinataires éligibles est obligatoire.'],
                ]);
            }

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            foreach ($evaluated as $item) {
                DB::table('campaign_recipients')->insert([
                    'id' => Ulid::generate(),
                    'clinic_id' => $context->clinicId,
                    'campaign_id' => $campaignId,
                    'patient_id' => $item['patient_id'],
                    'prospect_contact_id' => $item['prospect_contact_id'],
                    'destination_hash' => $item['destination_hash'],
                    'destination_ciphertext' => $item['destination_ciphertext'],
                    'encryption_key_id' => $item['encryption_key_id'],
                    'consent_event_id' => $item['consent_event_id'],
                    'status' => $item['status'],
                    'exclusion_reason' => $item['exclusion_reason'],
                    'consent_checked_at' => $nowDb,
                    'created_at' => $nowDb,
                    'updated_at' => $nowDb,
                ]);
            }

            DB::table('campaign_definitions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $campaignId)
                ->update([
                    'approval_id' => $auth['id'],
                    'target_frozen_at' => $nowDb,
                    'status' => 'APPROVED',
                    'updated_at' => $nowDb,
                ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.campaign.frozen',
                'campaign_definitions',
                $campaignId,
                null,
                [
                    'approval_id' => $auth['id'],
                    'approval_mode' => $auth['mode'],
                    'eligible_count' => $eligibleCount,
                    'total_candidates' => count($evaluated),
                ],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'campaign_definitions', $campaignId, ['id' => $campaignId]);
            }

            return $this->get($context->clinicId, $campaignId);
        });
    }

    /**
     * Exécute un lot borné d'envois après revérification immédiate du consentement de chaque destinataire.
     */
    public function execute(
        CommandContext $context,
        string $campaignId,
        ?string $reason = null,
        ?string $idempotencyKey = null,
    ): stdClass {
        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['campaign_id' => $campaignId, 'reason' => $reason], JSON_THROW_ON_ERROR));

        /**
         * @var array{
         *   replay: bool,
         *   account: ?stdClass,
         *   channel: string,
         *   body: string,
         *   provider_template_id: ?string,
         *   allowed_variables: list<string>,
         *   dispatches: list<array{recipient_id: string, attempt_id: string, destination: string, variables: array<string, string>, dedupe_key: string}>
         * } $batch
         */
        $batch = $this->transactions->run(function () use ($context, $campaignId, $cleanKey, $fingerprint): array {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'ExecuteCampaign', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return [
                        'replay' => true,
                        'account' => null,
                        'channel' => 'SMS',
                        'body' => '',
                        'provider_template_id' => null,
                        'allowed_variables' => [],
                        'dispatches' => [],
                    ];
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'ExecuteCampaign', $cleanKey, $fingerprint);
                }
            }

            $campaign = $locks->campaignDefinition($campaignId);
            if ($campaign === null) {
                throw BusinessError::notFound();
            }

            if (! in_array((string) $campaign->status, ['APPROVED', 'RUNNING'], true)
                || $campaign->approval_id === null
                || $campaign->target_frozen_at === null) {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'La campagne doit être figée et approuvée avant exécution.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => (string) $campaign->status],
                );
            }

            $recipientRows = DB::table('campaign_recipients')
                ->where('clinic_id', $context->clinicId)
                ->where('campaign_id', $campaignId)
                ->where('status', 'ELIGIBLE')
                ->orderBy('id')
                ->limit(self::EXECUTE_BATCH_SIZE)
                ->get()
                ->all();

            foreach ($recipientRows as $r) {
                $locks->campaignRecipient((string) $r->id);
            }

            $version = $this->templates->requireApprovedVersion($context->clinicId, (string) $campaign->template_version_id);
            $locks->messageTemplate((string) $version->template_id);

            $account = DB::table('integration_accounts')
                ->where('clinic_id', $context->clinicId)
                ->where('id', (string) $version->integration_account_id)
                ->first();
            if (! $account instanceof stdClass || (string) $account->status === 'DISABLED') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Le compte d\'intégration de la campagne est désactivé ou introuvable.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => $account instanceof stdClass ? (string) $account->status : 'MISSING_ACCOUNT'],
                );
            }

            $channel = (string) $version->template_channel;
            $purpose = (string) $version->template_purpose;
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            $allowedVars = $this->decodeAllowedVariables((string) $version->allowed_variables);
            $dispatches = [];

            foreach ($recipientRows as $recipient) {
                $recipientId = (string) $recipient->id;
                $patientId = $recipient->patient_id !== null ? (string) $recipient->patient_id : null;
                $prospectId = $recipient->prospect_contact_id !== null ? (string) $recipient->prospect_contact_id : null;

                // Recontrôle temps réel : une révocation post-gel exclut immédiatement le destinataire.
                $latest = DB::table('communication_consents')
                    ->where('clinic_id', $context->clinicId)
                    ->where('channel', $channel)
                    ->where('purpose', $purpose)
                    ->where('destination_hash', (string) $recipient->destination_hash)
                    ->when($patientId !== null, static fn ($q) => $q->where('patient_id', $patientId)->whereNull('prospect_contact_id'))
                    ->when($prospectId !== null, static fn ($q) => $q->where('prospect_contact_id', $prospectId)->whereNull('patient_id'))
                    ->orderByDesc('event_sequence')
                    ->first();

                if (! $latest instanceof stdClass || (string) $latest->status !== 'GRANTED') {
                    DB::table('campaign_recipients')
                        ->where('clinic_id', $context->clinicId)
                        ->where('id', $recipientId)
                        ->update([
                            'status' => 'EXCLUDED',
                            'exclusion_reason' => 'CONSENT_REVOKED_BEFORE_SEND',
                            'consent_checked_at' => $nowDb,
                            'updated_at' => $nowDb,
                        ]);

                    continue;
                }

                $dedupeKey = substr('CMP:'.$campaignId.':'.$recipientId.':'.$version->id, 0, 180);
                $existingAttempt = DB::table('message_attempts')
                    ->where('clinic_id', $context->clinicId)
                    ->where('dedupe_key', $dedupeKey)
                    ->whereIn('status', ['PLANNED', 'SUBMITTED', 'DELIVERED', 'READ'])
                    ->first();
                if ($existingAttempt instanceof stdClass) {
                    continue;
                }

                $maxAttempt = DB::table('message_attempts')
                    ->where('clinic_id', $context->clinicId)
                    ->where('dedupe_key', $dedupeKey)
                    ->max('attempt_no');
                $attemptNo = is_numeric($maxAttempt) ? ((int) $maxAttempt) + 1 : 1;

                $attemptId = Ulid::generate();
                DB::table('message_attempts')->insert([
                    'id' => $attemptId,
                    'clinic_id' => $context->clinicId,
                    'task_id' => null,
                    'campaign_recipient_id' => $recipientId,
                    'integration_account_id' => (string) $account->id,
                    'template_version_id' => (string) $version->id,
                    'consent_event_id' => (string) $latest->id,
                    'destination_hash' => (string) $recipient->destination_hash,
                    'destination_ciphertext' => (string) $recipient->destination_ciphertext,
                    'encryption_key_id' => (string) $recipient->encryption_key_id,
                    'dedupe_key' => $dedupeKey,
                    'provider_message_id' => null,
                    'attempt_no' => $attemptNo,
                    'status' => 'PLANNED',
                    'submitted_at' => null,
                    'delivered_at' => null,
                    'read_at' => null,
                    'error_code' => null,
                    'created_at' => $nowDb,
                    'updated_at' => $nowDb,
                ]);

                $vars = $this->buildSafeCampaignVariables($context->clinicId, $patientId, $prospectId, $allowedVars);
                $dispatches[] = [
                    'recipient_id' => $recipientId,
                    'attempt_id' => $attemptId,
                    'destination' => $this->cipher->decrypt((string) $recipient->destination_ciphertext),
                    'variables' => $vars,
                    'dedupe_key' => $dedupeKey,
                ];
            }

            if ((string) $campaign->status === 'APPROVED') {
                DB::table('campaign_definitions')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $campaignId)
                    ->update([
                        'status' => 'RUNNING',
                        'updated_at' => $nowDb,
                    ]);
            }

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'campaign_definitions', $campaignId, ['id' => $campaignId]);
            }

            return [
                'replay' => false,
                'account' => $account,
                'channel' => $channel,
                'body' => (string) $version->body,
                'provider_template_id' => $version->provider_template_id !== null ? (string) $version->provider_template_id : null,
                'allowed_variables' => $allowedVars,
                'dispatches' => $dispatches,
            ];
        });

        if ($batch['replay']) {
            return $this->get($context->clinicId, $campaignId);
        }

        $outcomes = [];
        if ($batch['account'] instanceof stdClass && $batch['dispatches'] !== []) {
            $client = $this->clients->forAccount($batch['account']);
            foreach ($batch['dispatches'] as $item) {
                $rendered = CommunicationRules::renderTemplate(
                    $batch['body'],
                    $batch['allowed_variables'],
                    $item['variables'],
                );
                $outcomes[] = [
                    'recipient_id' => $item['recipient_id'],
                    'attempt_id' => $item['attempt_id'],
                    'delivery' => $client->send(
                        $batch['channel'],
                        $item['destination'],
                        $rendered,
                        $batch['provider_template_id'],
                        $item['variables'],
                        $item['dedupe_key'],
                    ),
                ];
            }
        }

        $this->transactions->run(function () use ($context, $campaignId, $outcomes, $reason): void {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();
            $campaign = $locks->campaignDefinition($campaignId);
            if ($campaign === null) {
                return;
            }

            usort($outcomes, static fn (array $a, array $b): int => strcmp($a['recipient_id'], $b['recipient_id']));
            foreach ($outcomes as $entry) {
                $locks->campaignRecipient($entry['recipient_id']);
            }
            $attemptSorted = $outcomes;
            usort($attemptSorted, static fn (array $a, array $b): int => strcmp($a['attempt_id'], $b['attempt_id']));
            foreach ($attemptSorted as $entry) {
                $locks->messageAttempt($entry['attempt_id']);
            }

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            foreach ($outcomes as $entry) {
                $delivery = $entry['delivery'];
                DB::table('message_attempts')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $entry['attempt_id'])
                    ->update([
                        'status' => $delivery->status,
                        'provider_message_id' => $delivery->providerMessageId,
                        'submitted_at' => ($delivery->submittedAt ?? $context->now)->format('Y-m-d H:i:s.u'),
                        'delivered_at' => $delivery->deliveredAt?->format('Y-m-d H:i:s.u'),
                        'read_at' => $delivery->readAt?->format('Y-m-d H:i:s.u'),
                        'error_code' => $delivery->errorCode,
                        'updated_at' => $nowDb,
                    ]);

                $recipientStatus = match ($delivery->status) {
                    'DELIVERED', 'READ' => 'DELIVERED',
                    'FAILED' => 'FAILED',
                    default => 'SUBMITTED',
                };

                DB::table('campaign_recipients')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $entry['recipient_id'])
                    ->update([
                        'status' => $recipientStatus,
                        'updated_at' => $nowDb,
                    ]);
            }

            $remainingEligible = DB::table('campaign_recipients')
                ->where('clinic_id', $context->clinicId)
                ->where('campaign_id', $campaignId)
                ->where('status', 'ELIGIBLE')
                ->exists();

            if (! $remainingEligible && in_array((string) $campaign->status, ['APPROVED', 'RUNNING'], true)) {
                DB::table('campaign_definitions')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $campaignId)
                    ->update([
                        'status' => 'COMPLETED',
                        'updated_at' => $nowDb,
                    ]);

                $this->outbox->write($context, [
                    new OutboxEvent(
                        type: 'CampaignCompleted',
                        version: 1,
                        sourceType: 'campaign_definitions',
                        sourceId: $campaignId,
                        sourceVersion: 1,
                        payload: [
                            'campaign_id' => $campaignId,
                            'status' => 'COMPLETED',
                            'completed_at' => $context->now->utc()->format('Y-m-d\TH:i:s.v\Z'),
                        ],
                    ),
                ]);
            }

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.campaign.executed',
                'campaign_definitions',
                $campaignId,
                $reason,
                ['batch_dispatched' => count($outcomes), 'completed' => ! $remainingEligible],
                $context->actorName,
            );
        });

        return $this->get($context->clinicId, $campaignId);
    }

    public function pause(
        CommandContext $context,
        string $campaignId,
        ?string $reason = null,
        ?string $idempotencyKey = null,
    ): stdClass {
        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['campaign_id' => $campaignId, 'reason' => $reason], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $campaignId, $reason, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'PauseCampaign', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->get($context->clinicId, $campaignId);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'PauseCampaign', $cleanKey, $fingerprint);
                }
            }

            $campaign = $locks->campaignDefinition($campaignId);
            if ($campaign === null) {
                throw BusinessError::notFound();
            }

            if (in_array((string) $campaign->status, ['COMPLETED', 'CANCELLED', 'FAILED'], true)) {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Cette campagne est déjà terminée ou arrêtée.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => (string) $campaign->status],
                );
            }

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            DB::table('campaign_definitions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $campaignId)
                ->update([
                    'status' => 'CANCELLED',
                    'updated_at' => $nowDb,
                ]);

            DB::table('campaign_recipients')
                ->where('clinic_id', $context->clinicId)
                ->where('campaign_id', $campaignId)
                ->whereIn('status', ['PENDING', 'ELIGIBLE'])
                ->update([
                    'status' => 'CANCELLED',
                    'updated_at' => $nowDb,
                ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.campaign.paused',
                'campaign_definitions',
                $campaignId,
                $reason,
                ['status' => 'CANCELLED'],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'campaign_definitions', $campaignId, ['id' => $campaignId]);
            }

            return $this->get($context->clinicId, $campaignId);
        });
    }

    /**
     * @return list<array{
     *   patient_id: ?string,
     *   prospect_contact_id: ?string,
     *   destination_hash: string,
     *   destination_ciphertext: string,
     *   encryption_key_id: string,
     *   destination_masked: string,
     *   consent_event_id: ?string,
     *   status: string,
     *   exclusion_reason: ?string
     * }>
     */
    private function evaluateRecipients(
        string $clinicId,
        stdClass $campaign,
        stdClass $templateVersion,
        CarbonImmutable $now,
    ): array {
        $segment = $this->segments->get($clinicId, (string) $campaign->segment_id);
        $channel = (string) $templateVersion->template_channel;
        $purpose = (string) $templateVersion->template_purpose;

        $candidates = $this->segments->evaluateCandidates($clinicId, $segment, $channel, $now);
        $results = [];
        $seenHashes = [];

        foreach ($candidates as $candidate) {
            $patientId = $candidate['patient_id'];
            $prospectId = $candidate['prospect_contact_id'];
            $rawDest = $candidate['raw_destination'];

            $normalized = null;
            $invalidReason = null;
            if ($rawDest !== null) {
                try {
                    $normalized = CommunicationRules::normalizeDestination($channel, $rawDest);
                } catch (BusinessError) {
                    $invalidReason = 'INVALID_DESTINATION';
                }
            }

            if ($normalized === null) {
                $placeholder = 'UNAVAILABLE:'.($patientId ?? ('prospect:'.$prospectId));
                $enc = $this->cipher->encrypt($placeholder);
                if (isset($seenHashes[$enc['hash']])) {
                    continue;
                }
                $seenHashes[$enc['hash']] = true;
                $results[] = [
                    'patient_id' => $patientId,
                    'prospect_contact_id' => $prospectId,
                    'destination_hash' => $enc['hash'],
                    'destination_ciphertext' => $enc['ciphertext'],
                    'encryption_key_id' => $enc['key_id'],
                    'destination_masked' => '—',
                    'consent_event_id' => null,
                    'status' => 'EXCLUDED',
                    'exclusion_reason' => $invalidReason ?? 'MISSING_DESTINATION',
                ];

                continue;
            }

            $enc = $this->cipher->encrypt($normalized);
            if (isset($seenHashes[$enc['hash']])) {
                continue;
            }
            $seenHashes[$enc['hash']] = true;

            $consent = $this->consents->latestConsent($clinicId, $patientId, $prospectId, $channel, $purpose, $normalized);
            if ($consent instanceof stdClass && (string) $consent->status === 'GRANTED') {
                $results[] = [
                    'patient_id' => $patientId,
                    'prospect_contact_id' => $prospectId,
                    'destination_hash' => (string) $consent->destination_hash,
                    'destination_ciphertext' => (string) $consent->destination_ciphertext,
                    'encryption_key_id' => (string) $consent->encryption_key_id,
                    'destination_masked' => $this->cipher->mask($channel, $normalized),
                    'consent_event_id' => (string) $consent->id,
                    'status' => 'ELIGIBLE',
                    'exclusion_reason' => null,
                ];
            } else {
                $results[] = [
                    'patient_id' => $patientId,
                    'prospect_contact_id' => $prospectId,
                    'destination_hash' => $enc['hash'],
                    'destination_ciphertext' => $enc['ciphertext'],
                    'encryption_key_id' => $enc['key_id'],
                    'destination_masked' => $this->cipher->mask($channel, $normalized),
                    'consent_event_id' => $consent instanceof stdClass ? (string) $consent->id : null,
                    'status' => 'EXCLUDED',
                    'exclusion_reason' => $consent instanceof stdClass ? 'CONSENT_REVOKED' : 'MISSING_CONSENT',
                ];
            }
        }

        return $results;
    }

    private function loadTemplateVersion(string $clinicId, string $versionId): stdClass
    {
        $row = DB::table('message_template_versions as v')
            ->join('message_templates as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'v.clinic_id')->on('t.id', '=', 'v.template_id');
            })
            ->where('v.clinic_id', $clinicId)
            ->where('v.id', $versionId)
            ->select([
                'v.*',
                't.channel as template_channel',
                't.purpose as template_purpose',
            ])
            ->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        return $row;
    }

    /**
     * @param  list<stdClass>  $campaigns
     * @return list<stdClass>
     */
    private function hydrateCampaignCounts(string $clinicId, array $campaigns): array
    {
        if ($campaigns === []) {
            return [];
        }

        $ids = array_map(static fn (stdClass $c): string => (string) $c->id, $campaigns);
        $stats = DB::table('campaign_recipients')
            ->where('clinic_id', $clinicId)
            ->whereIn('campaign_id', $ids)
            ->selectRaw("campaign_id,
                SUM(CASE WHEN status IN ('ELIGIBLE','SUBMITTED','DELIVERED','FAILED') THEN 1 ELSE 0 END) as eligible_count,
                SUM(CASE WHEN status = 'EXCLUDED' THEN 1 ELSE 0 END) as excluded_count,
                SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) as delivered_count,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count")
            ->groupBy('campaign_id')
            ->get()
            ->keyBy('campaign_id');

        foreach ($campaigns as $c) {
            $row = $stats->get((string) $c->id);
            $c->eligible_count = $row !== null ? (int) $row->eligible_count : 0;
            $c->excluded_count = $row !== null ? (int) $row->excluded_count : 0;
            $c->delivered_count = $row !== null ? (int) $row->delivered_count : 0;
            $c->failed_count = $row !== null ? (int) $row->failed_count : 0;
        }

        return $campaigns;
    }

    private function maskRecipientCiphertext(string $channel, string $ciphertext): string
    {
        $plain = $this->cipher->decrypt($ciphertext);
        if (str_starts_with($plain, 'UNAVAILABLE:')) {
            return '—';
        }

        return $this->cipher->mask($channel, $plain);
    }

    /**
     * @return list<string>
     */
    private function decodeAllowedVariables(string $json): array
    {
        $decoded = json_decode($json, true);
        if (! is_array($decoded)) {
            return [];
        }

        return array_values(array_filter($decoded, static fn (mixed $v): bool => is_string($v)));
    }

    /**
     * @param  list<string>  $allowedVariables
     * @return array<string, string>
     */
    private function buildSafeCampaignVariables(
        string $clinicId,
        ?string $patientId,
        ?string $prospectId,
        array $allowedVariables,
    ): array {
        $clinicName = DB::table('clinics')->where('id', $clinicId)->value('name');
        $defaults = [
            'clinic_name' => is_string($clinicName) && $clinicName !== '' ? $clinicName : 'Cabinet',
        ];

        if ($patientId !== null) {
            $patient = DB::table('patient_records')
                ->where('clinic_id', $clinicId)
                ->where('id', $patientId)
                ->first(['first_names', 'last_name']);
            if ($patient instanceof stdClass) {
                $defaults['first_name'] = (string) ($patient->first_names ?: $patient->last_name);
                $defaults['last_name'] = (string) $patient->last_name;
                $defaults['recipient_name'] = trim(((string) ($patient->first_names ?? '')).' '.((string) $patient->last_name));
            }
        } elseif ($prospectId !== null) {
            $name = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('id', $prospectId)
                ->value('name');
            if (is_string($name)) {
                $defaults['first_name'] = $name;
                $defaults['recipient_name'] = $name;
            }
        }

        $selected = [];
        foreach ($allowedVariables as $var) {
            if (isset($defaults[$var])) {
                $selected[$var] = $defaults[$var];
            }
        }

        return $selected;
    }
}

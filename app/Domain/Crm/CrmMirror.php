<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use App\Models\User;
use App\Support\Integrations\Kommo\KommoClientFactory;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Miroir local du CRM Kommo et conversations omnicanales (L2D03) : idempotent via `external_links`,
 * strictement administratif (aucune donnée clinique ou médicale n'entre ni ne sort du CRM).
 */
final class CrmMirror
{
    public const PER_PAGE = 25;

    /** @var list<string> */
    public const LEAD_STATUSES = ['OPEN', 'APPOINTMENT_BOOKED', 'HUMAN_TAKEOVER', 'WON', 'LOST', 'CLOSED'];

    /** @var list<string> */
    public const CONVERSATION_STATUSES = ['BOT_ACTIVE', 'HUMAN_TAKEOVER', 'CLOSED'];

    /** @var list<string> */
    public const CHANNELS = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM'];

    private const MAX_MONEY_XAF = 1000000000000;

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
        private readonly KommoClientFactory $kommo,
    ) {}

    /**
     * @return array{rows: list<stdClass>, page: LengthAwarePaginator<int, stdClass>}
     */
    public function listLeads(string $clinicId, mixed $status = null, mixed $page = null): array
    {
        $pageNumber = ProspectContacts::parsePage($page);

        $builder = DB::table('crm_leads as l')
            ->join('prospect_contacts as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 'l.clinic_id')
                    ->on('p.id', '=', 'l.prospect_contact_id');
            })
            ->where('l.clinic_id', $clinicId);

        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, self::LEAD_STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Statut de piste invalide.']]);
            }
            $builder->where('l.status', $status);
        }

        $paginator = $builder
            ->orderByDesc('l.updated_at')
            ->orderByDesc('l.id')
            ->select(['l.*', 'p.name as prospect_name'])
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);

        /** @var list<stdClass> $rows */
        $rows = array_values($paginator->items());

        return ['rows' => $rows, 'page' => $paginator];
    }

    /**
     * @return array{rows: list<stdClass>, page: LengthAwarePaginator<int, stdClass>}
     */
    public function listConversations(string $clinicId, mixed $status = null, mixed $page = null): array
    {
        $pageNumber = ProspectContacts::parsePage($page);

        $builder = DB::table('crm_conversations')->where('clinic_id', $clinicId);

        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, self::CONVERSATION_STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Statut de conversation invalide.']]);
            }
            $builder->where('status', $status);
        }

        $paginator = $builder
            ->orderByDesc('last_activity_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);

        /** @var list<stdClass> $rows */
        $rows = array_values($paginator->items());

        return ['rows' => $rows, 'page' => $paginator];
    }

    public function findConversation(string $clinicId, string $conversationId): ?stdClass
    {
        if (! Ulid::isValid($conversationId)) {
            return null;
        }

        return DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('id', $conversationId)
            ->first();
    }

    /**
     * Synchronise les pistes Kommo CRM vers `prospect_contacts`, `crm_leads`, `crm_conversations` et
     * `external_links` de manière idempotente. L'appel externe a lieu HORS transaction / verrous.
     *
     * @return array{synced: int, created: int, updated: int, conflicts: int}
     */
    public function syncLeads(string $clinicId, ?User $actor, ?string $integrationAccountId = null, int $limit = 50): array
    {
        $account = $this->resolveKommoAccount($clinicId, $integrationAccountId);
        $accountConfig = $this->accountConfig($account);
        $limit = max(1, min(200, $limit));

        // I/O externe strictement hors transaction et verrous DB.
        $externalLeads = $this->kommo->make()->fetchLeads($accountConfig, $limit);
        $now = CarbonImmutable::now('UTC');
        $nowSql = $now->format('Y-m-d H:i:s.u');
        $accountId = (string) $account->id;

        return $this->transactions->run(function () use ($clinicId, $actor, $accountId, $externalLeads, $nowSql): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $lockedAccount = $locks->integrationAccount($accountId);
            if ($lockedAccount === null) {
                throw BusinessError::notFound('Compte Kommo introuvable pour ce cabinet.');
            }

            $stats = $this->applyExternalLeadsUnderLocks(
                $locks,
                $clinicId,
                $accountId,
                $externalLeads,
                $nowSql,
                $actor?->id !== null ? (string) $actor->id : null,
            );

            $this->audit->record($clinicId, $actor, 'crm.leads_synced', 'integration_accounts', $accountId, null, $stats);

            return $stats;
        });
    }

    /**
     * Upsert idempotent de pistes Kommo dans une transaction existante (réutilisé aussi par les webhooks).
     *
     * @param  list<array<string, mixed>>  $externalLeads
     * @return array{synced: int, created: int, updated: int, conflicts: int}
     */
    public function upsertLeadsInContext(CommandContext $context, string $accountId, array $externalLeads, ?TransactionLocks $existingLocks = null): array
    {
        $nowSql = $context->now->utc()->format('Y-m-d H:i:s.u');

        $run = function (TransactionLocks $locks) use ($context, $accountId, $externalLeads, $nowSql): array {
            $stats = $this->applyExternalLeadsUnderLocks(
                $locks,
                $context->clinicId,
                $accountId,
                $externalLeads,
                $nowSql,
                $context->actorId,
            );
            $this->audit->recordFor(
                $context->clinicId,
                $context->actorId,
                $context->actorName,
                'crm.leads_synced',
                'integration_accounts',
                $accountId,
                null,
                $stats,
                $context->correlationId,
            );

            return $stats;
        };

        if ($existingLocks !== null) {
            return $run($existingLocks);
        }

        return $this->transactions->run(function () use ($context, $accountId, $run): array {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();
            if ($locks->integrationAccount($accountId) === null) {
                throw BusinessError::notFound('Compte d\'intégration introuvable.');
            }

            return $run($locks);
        });
    }

    /**
     * Pousse une mise à jour administrative (statut / note) vers Kommo sans aucune information médicale.
     */
    public function pushLeadStatusToKommo(
        string $clinicId,
        string $leadId,
        string $status,
        ?string $pipelineStage = null,
        ?string $administrativeNote = null,
    ): void {
        $lead = DB::table('crm_leads')
            ->where('clinic_id', $clinicId)
            ->where('id', $leadId)
            ->first();
        if ($lead === null) {
            return;
        }

        $account = DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->where('id', (string) $lead->integration_account_id)
            ->first();
        if ($account === null || (string) $account->provider !== 'KOMMO' || ! in_array((string) $account->status, ['ACTIVE', 'TEST'], true)) {
            return;
        }

        $result = $this->kommo->make()->pushBookingStatus(
            $this->accountConfig($account),
            (string) $lead->external_lead_id,
            $status,
            $pipelineStage,
            $administrativeNote,
        );

        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
        $this->transactions->run(function () use ($clinicId, $leadId, $account, $lead, $result, $nowSql): void {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $locks->integrationAccount((string) $account->id);
            $locks->crmLead($leadId);

            DB::table('crm_leads')
                ->where('clinic_id', $clinicId)
                ->where('id', $leadId)
                ->update([
                    'last_synced_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);

            DB::table('external_links')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', (string) $account->id)
                ->where('external_entity_type', 'KOMMO_LEAD')
                ->where('external_entity_id', (string) $lead->external_lead_id)
                ->update([
                    'etag' => $result['etag'],
                    'last_synced_at' => $nowSql,
                    'status' => 'SYNCED',
                    'updated_at' => $nowSql,
                ]);
        });
    }

    private function resolveProspectCreatorId(string $clinicId, ?string $preferredActorId): string
    {
        if ($preferredActorId !== null && $preferredActorId !== '') {
            return $preferredActorId;
        }

        $userId = DB::table('users')
            ->where('clinic_id', $clinicId)
            ->orderByDesc('active')
            ->orderBy('id')
            ->value('id');

        if (! is_string($userId) || $userId === '') {
            throw BusinessError::validation(
                ['clinic_id' => ['Aucun utilisateur actif.']],
                'Aucun utilisateur disponible pour rattacher la création du prospect.',
            );
        }

        return $userId;
    }

    /**
     * @param  list<array<string, mixed>>  $externalLeads
     * @return array{synced: int, created: int, updated: int, conflicts: int}
     */
    private function applyExternalLeadsUnderLocks(
        TransactionLocks $locks,
        string $clinicId,
        string $accountId,
        array $externalLeads,
        string $nowSql,
        ?string $actorId = null,
    ): array {
        $creatorId = $this->resolveProspectCreatorId($clinicId, $actorId);
        $extLeadIds = [];
        $extConvIds = [];
        foreach ($externalLeads as $item) {
            $extLeadId = trim((string) ($item['external_lead_id'] ?? ''));
            if ($extLeadId !== '') {
                $extLeadIds[] = mb_substr($extLeadId, 0, 180);
                $extConvId = trim((string) ($item['external_conversation_id'] ?? ('kommo-conv-'.$extLeadId)));
                $extConvIds[] = mb_substr($extConvId, 0, 180);
            }
        }

        // Pré-acquisition des verrous dans l'ordre strict des rangs (CrmLead 41 -> CrmConversation 42 -> ProspectContact 44).
        $existingLeadsByExt = [];
        $existingLeadIds = [];
        $existingProspectIds = [];
        if ($extLeadIds !== []) {
            $rows = DB::table('crm_leads')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->whereIn('external_lead_id', array_values(array_unique($extLeadIds)))
                ->get();
            foreach ($rows as $row) {
                $existingLeadsByExt[(string) $row->external_lead_id] = $row;
                $existingLeadIds[] = (string) $row->id;
                $existingProspectIds[] = (string) $row->prospect_contact_id;
            }
        }

        $existingConvsByExt = [];
        $existingConvIds = [];
        if ($extConvIds !== []) {
            $rows = DB::table('crm_conversations')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->whereIn('external_conversation_id', array_values(array_unique($extConvIds)))
                ->get();
            foreach ($rows as $row) {
                $existingConvsByExt[(string) $row->external_conversation_id] = $row;
                $existingConvIds[] = (string) $row->id;
            }
        }

        $existingLinkRows = DB::table('external_links')
            ->where('clinic_id', $clinicId)
            ->where('integration_account_id', $accountId)
            ->where('external_entity_type', 'KOMMO_LEAD')
            ->whereIn('external_entity_id', array_values(array_unique($extLeadIds === [] ? ['__none__'] : $extLeadIds)))
            ->get();
        $linksByExt = [];
        foreach ($existingLinkRows as $link) {
            $linksByExt[(string) $link->external_entity_id] = $link;
        }

        $existingContactLinks = [];
        $extContactIds = [];
        foreach ($externalLeads as $item) {
            $prospectData = is_array($item['prospect'] ?? null) ? $item['prospect'] : [];
            $extContactId = isset($prospectData['external_contact_id']) && is_string($prospectData['external_contact_id'])
                ? trim($prospectData['external_contact_id'])
                : '';
            if ($extContactId !== '') {
                $extContactIds[] = mb_substr($extContactId, 0, 180);
            }
        }
        if ($extContactIds !== []) {
            $contactLinkRows = DB::table('external_links')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->where('external_entity_type', 'KOMMO_CONTACT')
                ->whereIn('external_entity_id', array_values(array_unique($extContactIds)))
                ->get();
            foreach ($contactLinkRows as $cl) {
                $existingContactLinks[(string) $cl->external_entity_id] = (string) $cl->local_entity_id;
                $existingProspectIds[] = (string) $cl->local_entity_id;
            }
        }

        $existingLeadIds = array_values(array_unique($existingLeadIds));
        sort($existingLeadIds, SORT_STRING);
        foreach ($existingLeadIds as $leadId) {
            $locks->crmLead($leadId);
        }

        $existingConvIds = array_values(array_unique($existingConvIds));
        sort($existingConvIds, SORT_STRING);
        foreach ($existingConvIds as $convId) {
            $locks->crmConversation($convId);
        }

        $existingProspectIds = array_values(array_unique($existingProspectIds));
        sort($existingProspectIds, SORT_STRING);
        foreach ($existingProspectIds as $prospectId) {
            $locks->prospectContact($prospectId);
        }

        $synced = 0;
        $created = 0;
        $updated = 0;
        $conflicts = 0;

        foreach ($externalLeads as $item) {
            $extLeadId = trim((string) ($item['external_lead_id'] ?? ''));
            if ($extLeadId === '') {
                $conflicts++;

                continue;
            }
            $extLeadId = mb_substr($extLeadId, 0, 180);

            [$budgetMin, $budgetMax, $budgetValid] = self::sanitizeBudget($item['budget_min'] ?? null, $item['budget_max'] ?? null);
            if (! $budgetValid) {
                $conflicts++;

                continue;
            }

            $status = in_array($item['status'] ?? null, self::LEAD_STATUSES, true)
                ? (string) $item['status']
                : 'OPEN';
            $pipelineId = self::optionalBounded($item['pipeline_id'] ?? null, 100);
            $pipelineStage = self::optionalBounded($item['pipeline_stage'] ?? null, 100) ?? 'OPEN';
            $productInterest = self::optionalBounded($item['product_interest'] ?? null, 2000);
            $acquisitionSource = self::optionalBounded($item['acquisition_source'] ?? null, 100);
            $etag = self::optionalBounded($item['etag'] ?? null, 180);
            $channel = in_array($item['channel'] ?? null, self::CHANNELS, true) ? (string) $item['channel'] : 'WHATSAPP';
            $extConvId = self::optionalBounded($item['external_conversation_id'] ?? null, 180) ?? mb_substr('kommo-conv-'.$extLeadId, 0, 180);

            $prospectData = is_array($item['prospect'] ?? null) ? $item['prospect'] : [];
            $prospectName = self::optionalBounded($prospectData['name'] ?? null, 180) ?? 'Prospect Kommo';
            [$prospectPhone, $prospectPhoneNorm] = self::sanitizePhone($prospectData['phone'] ?? null);
            $prospectEmail = self::sanitizeEmail($prospectData['email'] ?? null);
            $extContactId = self::optionalBounded($prospectData['external_contact_id'] ?? null, 180);

            $existingLead = $existingLeadsByExt[$extLeadId] ?? null;

            if ($existingLead !== null) {
                $leadId = (string) $existingLead->id;
                $prospectId = (string) $existingLead->prospect_contact_id;
                $link = $linksByExt[$extLeadId] ?? null;

                $leadChanged = (string) $existingLead->pipeline_stage !== $pipelineStage
                    || $existingLead->pipeline_id !== $pipelineId
                    || $existingLead->product_interest !== $productInterest
                    || ($existingLead->budget_min === null ? null : (int) $existingLead->budget_min) !== $budgetMin
                    || ($existingLead->budget_max === null ? null : (int) $existingLead->budget_max) !== $budgetMax
                    || $existingLead->acquisition_source !== $acquisitionSource
                    || (string) $existingLead->status !== $status
                    || ($link !== null && $etag !== null && $link->etag !== $etag);

                DB::table('prospect_contacts')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $prospectId)
                    ->update([
                        'name' => $prospectName,
                        'phone' => $prospectPhone,
                        'phone_normalized' => $prospectPhoneNorm,
                        'email' => $prospectEmail,
                        'updated_at' => $nowSql,
                    ]);

                DB::table('crm_leads')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $leadId)
                    ->update([
                        'pipeline_id' => $pipelineId,
                        'pipeline_stage' => $pipelineStage,
                        'product_interest' => $productInterest,
                        'budget_min' => $budgetMin,
                        'budget_max' => $budgetMax,
                        'acquisition_source' => $acquisitionSource,
                        'status' => $status,
                        'last_synced_at' => $nowSql,
                        'updated_at' => $nowSql,
                    ]);

                if ($link !== null) {
                    DB::table('external_links')
                        ->where('clinic_id', $clinicId)
                        ->where('id', (string) $link->id)
                        ->update([
                            'etag' => $etag,
                            'local_version' => (int) $link->local_version + ($leadChanged ? 1 : 0),
                            'last_synced_at' => $nowSql,
                            'status' => 'SYNCED',
                            'updated_at' => $nowSql,
                        ]);
                }

                if (! isset($existingConvsByExt[$extConvId])) {
                    $convId = Ulid::generate();
                    DB::table('crm_conversations')->insert([
                        'id' => $convId,
                        'clinic_id' => $clinicId,
                        'crm_lead_id' => $leadId,
                        'integration_account_id' => $accountId,
                        'external_conversation_id' => $extConvId,
                        'channel' => $channel,
                        'status' => 'BOT_ACTIVE',
                        'human_owner_id' => null,
                        'takeover_at' => null,
                        'takeover_reason' => null,
                        'administrative_summary' => null,
                        'bot_resumed_at' => null,
                        'bot_resumed_by' => null,
                        'last_activity_at' => $nowSql,
                        'version' => 1,
                        'created_at' => $nowSql,
                        'updated_at' => $nowSql,
                    ]);
                    $existingConvsByExt[$extConvId] = (object) ['id' => $convId];
                }

                if ($leadChanged) {
                    $updated++;
                }
                $synced++;

                continue;
            }

            $prospectId = $extContactId !== null ? ($existingContactLinks[$extContactId] ?? null) : null;
            if ($prospectId === null) {
                $prospectId = Ulid::generate();
                DB::table('prospect_contacts')->insert([
                    'id' => $prospectId,
                    'clinic_id' => $clinicId,
                    'name' => $prospectName,
                    'phone' => $prospectPhone,
                    'phone_normalized' => $prospectPhoneNorm,
                    'email' => $prospectEmail,
                    'patient_id' => null,
                    'origin' => 'CRM',
                    'administrative_notes' => null,
                    'created_by' => $creatorId,
                    'version' => 1,
                    'created_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);

                if ($extContactId !== null) {
                    DB::table('external_links')->insert([
                        'id' => Ulid::generate(),
                        'clinic_id' => $clinicId,
                        'integration_account_id' => $accountId,
                        'local_entity_type' => 'PROSPECT_CONTACT',
                        'local_entity_id' => $prospectId,
                        'external_entity_type' => 'KOMMO_CONTACT',
                        'external_entity_id' => $extContactId,
                        'etag' => null,
                        'local_version' => 1,
                        'last_synced_at' => $nowSql,
                        'status' => 'SYNCED',
                        'created_at' => $nowSql,
                        'updated_at' => $nowSql,
                    ]);
                    $existingContactLinks[$extContactId] = $prospectId;
                }
            }

            $leadId = Ulid::generate();
            DB::table('crm_leads')->insert([
                'id' => $leadId,
                'clinic_id' => $clinicId,
                'prospect_contact_id' => $prospectId,
                'integration_account_id' => $accountId,
                'external_lead_id' => $extLeadId,
                'pipeline_id' => $pipelineId,
                'pipeline_stage' => $pipelineStage,
                'product_interest' => $productInterest,
                'budget_min' => $budgetMin,
                'budget_max' => $budgetMax,
                'acquisition_source' => $acquisitionSource,
                'assigned_to' => null,
                'status' => $status,
                'last_synced_at' => $nowSql,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            DB::table('external_links')->insert([
                'id' => Ulid::generate(),
                'clinic_id' => $clinicId,
                'integration_account_id' => $accountId,
                'local_entity_type' => 'CRM_LEAD',
                'local_entity_id' => $leadId,
                'external_entity_type' => 'KOMMO_LEAD',
                'external_entity_id' => $extLeadId,
                'etag' => $etag,
                'local_version' => 1,
                'last_synced_at' => $nowSql,
                'status' => 'SYNCED',
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            if (! isset($existingConvsByExt[$extConvId])) {
                $convId = Ulid::generate();
                DB::table('crm_conversations')->insert([
                    'id' => $convId,
                    'clinic_id' => $clinicId,
                    'crm_lead_id' => $leadId,
                    'integration_account_id' => $accountId,
                    'external_conversation_id' => $extConvId,
                    'channel' => $channel,
                    'status' => 'BOT_ACTIVE',
                    'human_owner_id' => null,
                    'takeover_at' => null,
                    'takeover_reason' => null,
                    'administrative_summary' => null,
                    'bot_resumed_at' => null,
                    'bot_resumed_by' => null,
                    'last_activity_at' => $nowSql,
                    'version' => 1,
                    'created_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);
                $existingConvsByExt[$extConvId] = (object) ['id' => $convId];
            }

            $existingLeadsByExt[$extLeadId] = (object) ['id' => $leadId, 'prospect_contact_id' => $prospectId];
            $created++;
            $synced++;
        }

        return [
            'synced' => $synced,
            'created' => $created,
            'updated' => $updated,
            'conflicts' => $conflicts,
        ];
    }

    private function resolveKommoAccount(string $clinicId, ?string $integrationAccountId): stdClass
    {
        $query = DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->where('provider', 'KOMMO');

        if ($integrationAccountId !== null) {
            if (! Ulid::isValid($integrationAccountId)) {
                throw BusinessError::notFound('Compte Kommo introuvable pour ce cabinet.');
            }
            $account = $query->where('id', $integrationAccountId)->first();
        } else {
            $account = $query
                ->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 WHEN 'TEST' THEN 1 ELSE 2 END")
                ->orderBy('id')
                ->first();
        }

        if ($account === null) {
            throw BusinessError::notFound('Aucun compte Kommo configuré pour ce cabinet.');
        }

        if (! in_array((string) $account->status, ['ACTIVE', 'TEST'], true)) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Le connecteur Kommo du cabinet est désactivé ou en erreur.', 503);
        }

        return $account;
    }

    /**
     * @return array<string, mixed>
     */
    private function accountConfig(stdClass $account): array
    {
        $publicConfig = [];
        if (is_string($account->public_configuration) && $account->public_configuration !== '') {
            $decoded = json_decode($account->public_configuration, true);
            if (is_array($decoded)) {
                $publicConfig = $decoded;
            }
        }

        return [
            ...$publicConfig,
            'account_id' => (string) $account->id,
            'external_account_id' => (string) $account->external_account_id,
            'status' => (string) $account->status,
        ];
    }

    /**
     * @return array{0: ?int, 1: ?int, 2: bool}
     */
    private static function sanitizeBudget(mixed $rawMin, mixed $rawMax): array
    {
        $min = $rawMin === null ? null : (is_int($rawMin) ? $rawMin : null);
        $max = $rawMax === null ? null : (is_int($rawMax) ? $rawMax : null);

        if ($min !== null && ($min < 0 || $min > self::MAX_MONEY_XAF)) {
            return [null, null, false];
        }
        if ($max !== null && ($max < 0 || $max > self::MAX_MONEY_XAF)) {
            return [null, null, false];
        }
        if ($min !== null && $max !== null && $max < $min) {
            return [null, null, false];
        }

        return [$min, $max, true];
    }

    private static function optionalBounded(mixed $value, int $maxLength): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $trimmed = Text::trim($value);
        if ($trimmed === '') {
            return null;
        }

        return mb_substr($trimmed, 0, $maxLength, 'UTF-8');
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    private static function sanitizePhone(mixed $value): array
    {
        if (! is_string($value)) {
            return [null, null];
        }
        try {
            $raw = Text::optional($value, 32, 'phone');
            if ($raw === null) {
                return [null, null];
            }

            return [$raw, Text::phone($raw, 'phone')];
        } catch (RuleViolation) {
            return [null, null];
        }
    }

    private static function sanitizeEmail(mixed $value): ?string
    {
        $email = self::optionalBounded($value, 254);
        if ($email === null || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return null;
        }

        return $email;
    }
}

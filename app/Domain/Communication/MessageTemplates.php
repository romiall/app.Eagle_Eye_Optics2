<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Application\Effects\IdempotencyStore;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Modèles de messages et révisions gouvernées : seule une révision `APPROVED` peut être utilisée pour un envoi
 * transactionnel ou une campagne. Toute variable clinique est bloquée à la création de la révision.
 */
final class MessageTemplates
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly IdempotencyStore $idempotency,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $filters
     * @return array{items: list<stdClass>, next_cursor: ?string}
     */
    public function list(string $clinicId, array $filters = []): array
    {
        $limit = isset($filters['limit']) && is_int($filters['limit'])
            ? max(1, min(100, $filters['limit']))
            : 50;

        $query = DB::table('message_templates')->where('clinic_id', $clinicId);

        if (is_string($filters['channel'] ?? null) && $filters['channel'] !== '') {
            $query->where('channel', $filters['channel']);
        }
        if (is_string($filters['purpose'] ?? null) && $filters['purpose'] !== '') {
            $query->where('purpose', $filters['purpose']);
        }
        if (array_key_exists('active', $filters) && is_bool($filters['active'])) {
            $query->where('active', $filters['active'] ? 1 : 0);
        }
        if (is_string($filters['cursor'] ?? null) && $filters['cursor'] !== '') {
            $query->where('id', '>', $filters['cursor']);
        }

        $templates = $query->orderBy('id')->limit($limit + 1)->get()->all();
        $nextCursor = null;
        if (count($templates) > $limit) {
            array_pop($templates);
            $last = end($templates);
            if ($last instanceof stdClass) {
                $nextCursor = (string) $last->id;
            }
        }

        $templateIds = array_map(static fn (stdClass $t): string => (string) $t->id, $templates);
        $versionsByTemplate = [];
        if ($templateIds !== []) {
            $versions = DB::table('message_template_versions')
                ->where('clinic_id', $clinicId)
                ->whereIn('template_id', $templateIds)
                ->orderByDesc('revision_no')
                ->get();
            foreach ($versions as $v) {
                $versionsByTemplate[(string) $v->template_id][] = $v;
            }
        }

        foreach ($templates as $template) {
            $template->versions = $versionsByTemplate[(string) $template->id] ?? [];
        }

        return [
            'items' => array_values($templates),
            'next_cursor' => $nextCursor,
        ];
    }

    public function getTemplate(string $clinicId, string $templateId): stdClass
    {
        $template = DB::table('message_templates')
            ->where('clinic_id', $clinicId)
            ->where('id', $templateId)
            ->first();
        if (! $template instanceof stdClass) {
            throw BusinessError::notFound();
        }

        $template->versions = DB::table('message_template_versions')
            ->where('clinic_id', $clinicId)
            ->where('template_id', $templateId)
            ->orderByDesc('revision_no')
            ->get()
            ->all();

        return $template;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function createTemplate(CommandContext $context, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $code = trim((string) ($payload['code'] ?? ''));
        $channel = (string) ($payload['channel'] ?? '');
        $purpose = (string) ($payload['purpose'] ?? '');

        if ($code === '' || mb_strlen($code) > 100) {
            throw BusinessError::validation(['code' => ['Le code du modèle est obligatoire (100 caractères max.).']]);
        }
        if (! in_array($channel, CommunicationRules::TEMPLATE_CHANNELS, true)) {
            throw BusinessError::validation(['channel' => ['Canal invalide pour un modèle de message.']]);
        }
        if (! in_array($purpose, CommunicationRules::CONSENT_PURPOSES, true)) {
            throw BusinessError::validation(['purpose' => ['Finalité invalide.']]);
        }

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'code' => $code,
            'channel' => $channel,
            'purpose' => $purpose,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $code, $channel, $purpose, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SaveMessageTemplate', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->getTemplate($context->clinicId, (string) $existingIdem->result_id);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'SaveMessageTemplate', $cleanKey, $fingerprint);
                }
            }

            $duplicate = DB::table('message_templates')
                ->where('clinic_id', $context->clinicId)
                ->where('code', $code)
                ->exists();
            if ($duplicate) {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Un modèle portant ce code existe déjà dans ce cabinet.',
                    409,
                    ['code' => ['Code déjà utilisé.']],
                    null,
                    [],
                    ['current_status' => 'DUPLICATE_CODE'],
                );
            }

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            DB::table('message_templates')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'code' => $code,
                'channel' => $channel,
                'purpose' => $purpose,
                'active' => 0,
                'version' => 1,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.template.created',
                'message_templates',
                $id,
                null,
                ['code' => $code, 'channel' => $channel, 'purpose' => $purpose],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'message_templates', $id, ['id' => $id]);
            }

            return $this->getTemplate($context->clinicId, $id);
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function createVersion(CommandContext $context, string $templateId, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $body = (string) ($payload['body'] ?? '');
        $rawAllowed = is_array($payload['allowed_variables'] ?? null) ? $payload['allowed_variables'] : [];
        $allowedVariables = CommunicationRules::validateAllowedVariables($rawAllowed);
        CommunicationRules::validateTemplateBody($body, $allowedVariables);

        $language = trim((string) ($payload['language'] ?? 'fr'));
        if ($language === '' || mb_strlen($language) > 10) {
            throw BusinessError::validation(['language' => ['Code langue invalide (10 caractères max.).']]);
        }

        $providerTemplateId = is_string($payload['provider_template_id'] ?? null) && trim($payload['provider_template_id']) !== ''
            ? substr(trim($payload['provider_template_id']), 0, 180)
            : null;
        $requestedAccountId = is_string($payload['integration_account_id'] ?? null) && $payload['integration_account_id'] !== ''
            ? $payload['integration_account_id']
            : null;

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'template_id' => $templateId,
            'integration_account_id' => $requestedAccountId,
            'provider_template_id' => $providerTemplateId,
            'language' => $language,
            'body' => $body,
            'allowed_variables' => $allowedVariables,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use (
            $context,
            $templateId,
            $requestedAccountId,
            $providerTemplateId,
            $language,
            $body,
            $allowedVariables,
            $cleanKey,
            $fingerprint,
        ): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'CreateMessageTemplateVersion', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $existingVersion = DB::table('message_template_versions')
                        ->where('clinic_id', $context->clinicId)
                        ->where('id', (string) $existingIdem->result_id)
                        ->first();
                    if ($existingVersion instanceof stdClass) {
                        return $existingVersion;
                    }
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'CreateMessageTemplateVersion', $cleanKey, $fingerprint);
                }
            }

            $template = $locks->messageTemplate($templateId);
            if ($template === null) {
                throw BusinessError::notFound();
            }

            $accountId = $this->resolveIntegrationAccountId(
                $context->clinicId,
                CommunicationRules::integrationProviderForChannel((string) $template->channel),
                $requestedAccountId,
            );

            $maxRevision = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('template_id', $templateId)
                ->max('revision_no');
            $nextRevision = is_numeric($maxRevision) ? ((int) $maxRevision) + 1 : 1;

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');

            DB::table('message_template_versions')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'template_id' => $templateId,
                'integration_account_id' => $accountId,
                'revision_no' => $nextRevision,
                'provider_template_id' => $providerTemplateId,
                'language' => $language,
                'body' => $body,
                'allowed_variables' => json_encode($allowedVariables, JSON_THROW_ON_ERROR),
                'media_file_id' => null,
                'provider_approval_status' => 'DRAFT',
                'approved_by' => null,
                'approved_at' => null,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.template_version.created',
                'message_template_versions',
                $id,
                null,
                ['template_id' => $templateId, 'revision_no' => $nextRevision],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'message_template_versions', $id, ['id' => $id]);
            }

            $created = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $id)
                ->first();
            if (! $created instanceof stdClass) {
                throw BusinessError::notFound();
            }

            return $created;
        });
    }

    public function approveVersion(
        CommandContext $context,
        string $versionId,
        ?string $reason = null,
        ?string $idempotencyKey = null,
    ): stdClass {
        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'version_id' => $versionId,
            'reason' => $reason,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $versionId, $reason, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'ApproveMessageTemplateVersion', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $existingVersion = DB::table('message_template_versions')
                        ->where('clinic_id', $context->clinicId)
                        ->where('id', $versionId)
                        ->first();
                    if ($existingVersion instanceof stdClass) {
                        return $existingVersion;
                    }
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'ApproveMessageTemplateVersion', $cleanKey, $fingerprint);
                }
            }

            $versionLookup = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $versionId)
                ->first(['id', 'template_id']);
            if (! $versionLookup instanceof stdClass) {
                throw BusinessError::notFound();
            }

            $templateId = (string) $versionLookup->template_id;
            $template = $locks->messageTemplate($templateId);
            if ($template === null) {
                throw BusinessError::notFound();
            }

            $version = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('template_id', $templateId)
                ->where('id', $versionId)
                ->lockForUpdate()
                ->first();
            if (! $version instanceof stdClass) {
                throw BusinessError::notFound();
            }

            if ((string) $version->provider_approval_status === 'REJECTED') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Une révision rejetée ne peut pas être approuvée directement.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => 'REJECTED'],
                );
            }

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            if ((string) $version->provider_approval_status !== 'APPROVED') {
                DB::table('message_template_versions')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $versionId)
                    ->update([
                        'provider_approval_status' => 'APPROVED',
                        'approved_by' => $context->actorId,
                        'approved_at' => $nowDb,
                        'updated_at' => $nowDb,
                    ]);
            }

            if (! (bool) $template->active) {
                DB::table('message_templates')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $templateId)
                    ->update([
                        'active' => 1,
                        'version' => ((int) $template->version) + 1,
                        'updated_at' => $nowDb,
                    ]);
            }

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.template_version.approved',
                'message_template_versions',
                $versionId,
                $reason,
                ['template_id' => $templateId, 'revision_no' => (int) $version->revision_no],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'message_template_versions', $versionId, ['id' => $versionId]);
            }

            $updated = DB::table('message_template_versions')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $versionId)
                ->first();
            if (! $updated instanceof stdClass) {
                throw BusinessError::notFound();
            }

            return $updated;
        });
    }

    /**
     * Retourne la révision approuvée jointe aux attributs du modèle (`channel`, `purpose`, `code`).
     */
    public function requireApprovedVersion(string $clinicId, string $versionId): stdClass
    {
        $row = DB::table('message_template_versions as v')
            ->join('message_templates as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'v.clinic_id')
                    ->on('t.id', '=', 'v.template_id');
            })
            ->where('v.clinic_id', $clinicId)
            ->where('v.id', $versionId)
            ->select([
                'v.*',
                't.code as template_code',
                't.channel as template_channel',
                't.purpose as template_purpose',
                't.active as template_active',
            ])
            ->first();

        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        if ((string) $row->provider_approval_status !== 'APPROVED') {
            throw new BusinessError(
                'STATE_TRANSITION_REFUSED',
                'Cette révision de modèle n\'est pas encore approuvée pour envoi.',
                409,
                [],
                null,
                [],
                ['current_status' => (string) $row->provider_approval_status],
            );
        }

        return $row;
    }

    /**
     * Recherche la plus récente révision approuvée d'un modèle actif du canal/finalité demandé.
     */
    public function findLatestApprovedVersion(string $clinicId, string $channel, string $purpose): stdClass
    {
        $row = DB::table('message_template_versions as v')
            ->join('message_templates as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'v.clinic_id')
                    ->on('t.id', '=', 'v.template_id');
            })
            ->where('v.clinic_id', $clinicId)
            ->where('t.channel', $channel)
            ->where('t.purpose', $purpose)
            ->where('v.provider_approval_status', 'APPROVED')
            ->orderByDesc('t.active')
            ->orderByDesc('v.approved_at')
            ->orderByDesc('v.revision_no')
            ->select([
                'v.*',
                't.code as template_code',
                't.channel as template_channel',
                't.purpose as template_purpose',
                't.active as template_active',
            ])
            ->first();

        if (! $row instanceof stdClass) {
            throw new BusinessError(
                'STATE_TRANSITION_REFUSED',
                'Aucun modèle approuvé disponible pour ce canal et cette finalité.',
                409,
                [],
                null,
                [],
                ['current_status' => 'MISSING_APPROVED_TEMPLATE'],
            );
        }

        return $row;
    }

    private function resolveIntegrationAccountId(string $clinicId, string $provider, ?string $requestedId): string
    {
        if ($requestedId !== null) {
            $account = DB::table('integration_accounts')
                ->where('clinic_id', $clinicId)
                ->where('id', $requestedId)
                ->first();
            if (! $account instanceof stdClass) {
                throw BusinessError::validation(['integration_account_id' => ['Compte d\'intégration introuvable dans ce cabinet.']]);
            }
            if ((string) $account->provider !== $provider) {
                throw BusinessError::validation(['integration_account_id' => ['Ce compte d\'intégration ne correspond pas au canal du modèle.']]);
            }

            return (string) $account->id;
        }

        $account = DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->where('provider', $provider)
            ->whereIn('status', ['ACTIVE', 'TEST'])
            ->orderByRaw("CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END")
            ->orderBy('id')
            ->first();

        if (! $account instanceof stdClass) {
            throw BusinessError::validation([
                'integration_account_id' => ['Aucun compte d\'intégration actif ou de test pour le fournisseur « '.$provider.' ».'],
            ]);
        }

        return (string) $account->id;
    }
}

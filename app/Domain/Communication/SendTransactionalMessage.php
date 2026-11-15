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
use App\Support\Integrations\Messaging\MessagingClientFactory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Envoi transactionnel gouverné sur une tâche de contact (L2D07) :
 * - vérifie un consentement actif `GRANTED` pour (sujet, canal, finalité, destination) ;
 * - exige une révision de modèle `APPROVED` sans variable clinique ;
 * - déduplique strictement par `dedupe_key` (jamais de double envoi) ;
 * - exécute l'appel fournisseur HORS transaction DB après journalisation `PLANNED`.
 */
final class SendTransactionalMessage
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly ConsentLedger $consents,
        private readonly MessageTemplates $templates,
        private readonly MessagingClientFactory $clients,
        private readonly IdempotencyStore $idempotency,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $filters
     * @return array{items: list<stdClass>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function listAttempts(string $clinicId, array $filters = []): array
    {
        $perPage = 25;
        $page = isset($filters['page']) && is_int($filters['page']) ? max(1, $filters['page']) : 1;

        $query = DB::table('message_attempts')->where('clinic_id', $clinicId);
        if (is_string($filters['status'] ?? null) && $filters['status'] !== '') {
            $query->where('status', $filters['status']);
        }
        if (is_string($filters['task_id'] ?? null) && $filters['task_id'] !== '') {
            $query->where('task_id', $filters['task_id']);
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
    public function sendForTask(
        CommandContext $context,
        string $taskId,
        array $payload = [],
        ?string $idempotencyKey = null,
    ): stdClass {
        $requestedVersionId = is_string($payload['template_version_id'] ?? null) && $payload['template_version_id'] !== ''
            ? $payload['template_version_id']
            : null;
        $requestedChannel = is_string($payload['channel'] ?? null) && $payload['channel'] !== ''
            ? $payload['channel']
            : null;
        /** @var array<string, mixed> $customVariables */
        $customVariables = is_array($payload['variables'] ?? null) ? $payload['variables'] : [];

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'task_id' => $taskId,
            'template_version_id' => $requestedVersionId,
            'channel' => $requestedChannel,
        ], JSON_THROW_ON_ERROR));

        /**
         * @var array{
         *   dispatch: bool,
         *   attempt_id: string,
         *   account: ?stdClass,
         *   channel: ?string,
         *   destination: ?string,
         *   rendered_body: ?string,
         *   provider_template_id: ?string,
         *   variables: array<string, string>,
         *   dedupe_key: ?string
         * } $prepared
         */
        $prepared = $this->transactions->run(function () use (
            $context,
            $taskId,
            $requestedVersionId,
            $requestedChannel,
            $customVariables,
            $cleanKey,
            $fingerprint,
        ): array {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SendTransactionalTaskMessage', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return [
                        'dispatch' => false,
                        'attempt_id' => (string) $existingIdem->result_id,
                        'account' => null,
                        'channel' => null,
                        'destination' => null,
                        'rendered_body' => null,
                        'provider_template_id' => null,
                        'variables' => [],
                        'dedupe_key' => null,
                    ];
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'SendTransactionalTaskMessage', $cleanKey, $fingerprint);
                }
            }

            $preTask = DB::table('contact_tasks')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $taskId)
                ->first(['patient_id', 'prospect_contact_id']);
            if (! $preTask instanceof stdClass) {
                throw BusinessError::notFound();
            }

            // Ordre strict des verrous : ProspectContact (44) / Patient (45) avant ContactTask (51).
            if ($preTask->prospect_contact_id !== null) {
                $locks->prospectContact((string) $preTask->prospect_contact_id);
            } elseif ($preTask->patient_id !== null) {
                $locks->patient((string) $preTask->patient_id);
            }

            $task = $locks->contactTask($taskId);
            if ($task === null) {
                throw BusinessError::notFound();
            }

            $channel = $requestedChannel ?? (string) $task->channel;
            if (! in_array($channel, CommunicationRules::TEMPLATE_CHANNELS, true)) {
                throw BusinessError::validation([
                    'channel' => ['Ce canal ne permet pas l\'envoi automatisé (SMS, WHATSAPP ou EMAIL requis).'],
                ]);
            }

            $purpose = $this->taskPurpose($task);
            $templateVersion = $requestedVersionId !== null
                ? $this->templates->requireApprovedVersion($context->clinicId, $requestedVersionId)
                : $this->templates->findLatestApprovedVersion($context->clinicId, $channel, $purpose);

            if ((string) $templateVersion->template_channel !== $channel) {
                throw BusinessError::validation([
                    'template_version_id' => ['La révision de modèle sélectionnée correspond au canal '.(string) $templateVersion->template_channel.'.'],
                ]);
            }

            if ((string) $templateVersion->template_purpose === 'MARKETING') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Un modèle MARKETING ne peut pas être utilisé pour un envoi transactionnel.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => 'MARKETING_TEMPLATE_FORBIDDEN'],
                );
            }

            $grant = $this->consents->requireActiveGrant(
                $context->clinicId,
                $task->patient_id !== null ? (string) $task->patient_id : null,
                $task->prospect_contact_id !== null ? (string) $task->prospect_contact_id : null,
                $channel,
                $purpose,
            );

            $dedupeKey = substr(
                'TASK:'.$taskId.':'.$templateVersion->id.':'.$grant['destination_hash'],
                0,
                180,
            );

            $existingSent = DB::table('message_attempts')
                ->where('clinic_id', $context->clinicId)
                ->where('dedupe_key', $dedupeKey)
                ->whereIn('status', ['PLANNED', 'SUBMITTED', 'DELIVERED', 'READ'])
                ->orderByDesc('attempt_no')
                ->first();

            if ($existingSent instanceof stdClass) {
                if ($reservation !== null) {
                    $this->idempotency->complete($context, $reservation, 'message_attempts', (string) $existingSent->id, ['id' => (string) $existingSent->id]);
                }

                return [
                    'dispatch' => false,
                    'attempt_id' => (string) $existingSent->id,
                    'account' => null,
                    'channel' => null,
                    'destination' => null,
                    'rendered_body' => null,
                    'provider_template_id' => null,
                    'variables' => [],
                    'dedupe_key' => null,
                ];
            }

            $account = DB::table('integration_accounts')
                ->where('clinic_id', $context->clinicId)
                ->where('id', (string) $templateVersion->integration_account_id)
                ->first();
            if (! $account instanceof stdClass || (string) $account->status === 'DISABLED') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Le compte d\'intégration lié au modèle est indisponible ou désactivé.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => $account instanceof stdClass ? (string) $account->status : 'MISSING_ACCOUNT'],
                );
            }

            $allowedVariables = $this->decodeAllowedVariables((string) $templateVersion->allowed_variables);
            $safeVariables = $this->buildSafeVariables($context->clinicId, $task, $allowedVariables, $customVariables);
            $renderedBody = CommunicationRules::renderTemplate(
                (string) $templateVersion->body,
                $allowedVariables,
                $safeVariables,
            );

            $maxAttempt = DB::table('message_attempts')
                ->where('clinic_id', $context->clinicId)
                ->where('dedupe_key', $dedupeKey)
                ->max('attempt_no');
            $attemptNo = is_numeric($maxAttempt) ? ((int) $maxAttempt) + 1 : 1;

            $attemptId = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');

            DB::table('message_attempts')->insert([
                'id' => $attemptId,
                'clinic_id' => $context->clinicId,
                'task_id' => $taskId,
                'campaign_recipient_id' => null,
                'integration_account_id' => (string) $account->id,
                'template_version_id' => (string) $templateVersion->id,
                'consent_event_id' => (string) $grant['consent']->id,
                'destination_hash' => $grant['destination_hash'],
                'destination_ciphertext' => $grant['destination_ciphertext'],
                'encryption_key_id' => $grant['encryption_key_id'],
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

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.transactional.planned',
                'message_attempts',
                $attemptId,
                null,
                ['task_id' => $taskId, 'channel' => $channel, 'attempt_no' => $attemptNo],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'message_attempts', $attemptId, ['id' => $attemptId]);
            }

            /** @var array<string, string> $stringVars */
            $stringVars = array_map(static fn (mixed $v): string => (string) $v, $safeVariables);

            return [
                'dispatch' => true,
                'attempt_id' => $attemptId,
                'account' => $account,
                'channel' => $channel,
                'destination' => $grant['destination'],
                'rendered_body' => $renderedBody,
                'provider_template_id' => $templateVersion->provider_template_id !== null ? (string) $templateVersion->provider_template_id : null,
                'variables' => $stringVars,
                'dedupe_key' => $dedupeKey,
            ];
        });

        if ($prepared['dispatch'] && $prepared['account'] instanceof stdClass) {
            $client = $this->clients->forAccount($prepared['account']);
            $delivery = $client->send(
                (string) $prepared['channel'],
                (string) $prepared['destination'],
                (string) $prepared['rendered_body'],
                $prepared['provider_template_id'],
                $prepared['variables'],
                $prepared['dedupe_key'],
            );

            $this->transactions->run(function () use ($context, $prepared, $delivery): void {
                $locks = new TransactionLocks($context->clinicId);
                $locks->clinic();
                $attempt = $locks->messageAttempt($prepared['attempt_id']);
                if ($attempt === null) {
                    return;
                }

                $nowDb = $context->now->format('Y-m-d H:i:s.u');
                DB::table('message_attempts')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $prepared['attempt_id'])
                    ->update([
                        'status' => $delivery->status,
                        'provider_message_id' => $delivery->providerMessageId,
                        'submitted_at' => ($delivery->submittedAt ?? $context->now)->format('Y-m-d H:i:s.u'),
                        'delivered_at' => $delivery->deliveredAt?->format('Y-m-d H:i:s.u'),
                        'read_at' => $delivery->readAt?->format('Y-m-d H:i:s.u'),
                        'error_code' => $delivery->errorCode,
                        'updated_at' => $nowDb,
                    ]);
            });
        }

        return $this->getAttempt($context->clinicId, $prepared['attempt_id']);
    }

    public function reconcileAttempt(
        CommandContext $context,
        string $attemptId,
        ?string $reason = null,
        ?string $idempotencyKey = null,
    ): stdClass {
        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['attempt_id' => $attemptId, 'reason' => $reason], JSON_THROW_ON_ERROR));

        /**
         * @var array{replay: bool, attempt: ?stdClass, account: ?stdClass, channel: ?string} $lookup
         */
        $lookup = $this->transactions->run(function () use ($context, $attemptId, $cleanKey, $fingerprint): array {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'ReconcileMessageAttempt', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return ['replay' => true, 'attempt' => null, 'account' => null, 'channel' => null];
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'ReconcileMessageAttempt', $cleanKey, $fingerprint);
                }
            }

            $attempt = $locks->messageAttempt($attemptId);
            if ($attempt === null) {
                throw BusinessError::notFound();
            }

            $account = DB::table('integration_accounts')
                ->where('clinic_id', $context->clinicId)
                ->where('id', (string) $attempt->integration_account_id)
                ->first();

            $channel = (string) (DB::table('message_template_versions as v')
                ->join('message_templates as t', static function ($join): void {
                    $join->on('t.clinic_id', '=', 'v.clinic_id')->on('t.id', '=', 'v.template_id');
                })
                ->where('v.clinic_id', $context->clinicId)
                ->where('v.id', (string) $attempt->template_version_id)
                ->value('t.channel') ?: 'SMS');

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'message_attempts', $attemptId, ['id' => $attemptId]);
            }

            return ['replay' => false, 'attempt' => $attempt, 'account' => $account, 'channel' => $channel];
        });

        if ($lookup['replay']) {
            return $this->getAttempt($context->clinicId, $attemptId);
        }

        $attempt = $lookup['attempt'];
        $account = $lookup['account'];
        if (! $attempt instanceof stdClass || ! $account instanceof stdClass) {
            return $this->getAttempt($context->clinicId, $attemptId);
        }

        if ($attempt->provider_message_id === null || (string) $attempt->provider_message_id === '') {
            return $this->getAttempt($context->clinicId, $attemptId);
        }

        $client = $this->clients->forAccount($account);
        $remote = $client->fetchStatus((string) $lookup['channel'], (string) $attempt->provider_message_id);

        if ($remote->status !== 'UNKNOWN') {
            $this->transactions->run(function () use ($context, $attemptId, $remote, $reason): void {
                $locks = new TransactionLocks($context->clinicId);
                $locks->clinic();
                $locked = $locks->messageAttempt($attemptId);
                if ($locked === null) {
                    return;
                }

                $nowDb = $context->now->format('Y-m-d H:i:s.u');
                DB::table('message_attempts')
                    ->where('clinic_id', $context->clinicId)
                    ->where('id', $attemptId)
                    ->update([
                        'status' => $remote->status,
                        'delivered_at' => $remote->deliveredAt?->format('Y-m-d H:i:s.u')
                            ?? ($remote->status === 'DELIVERED' || $remote->status === 'READ' ? ($locked->delivered_at ?? $nowDb) : $locked->delivered_at),
                        'read_at' => $remote->readAt?->format('Y-m-d H:i:s.u')
                            ?? ($remote->status === 'READ' ? ($locked->read_at ?? $nowDb) : $locked->read_at),
                        'error_code' => $remote->errorCode ?? $locked->error_code,
                        'updated_at' => $nowDb,
                    ]);

                $this->audit->record(
                    $context->clinicId,
                    $context->user,
                    'communication.message_attempt.reconciled',
                    'message_attempts',
                    $attemptId,
                    $reason,
                    ['status' => $remote->status],
                    $context->actorName,
                );
            });
        }

        return $this->getAttempt($context->clinicId, $attemptId);
    }

    public function getAttempt(string $clinicId, string $attemptId): stdClass
    {
        $row = DB::table('message_attempts')
            ->where('clinic_id', $clinicId)
            ->where('id', $attemptId)
            ->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        return $row;
    }

    private function taskPurpose(stdClass $task): string
    {
        if ($task->appointment_id !== null) {
            return 'APPOINTMENT';
        }
        if ($task->workshop_order_id !== null) {
            return 'ORDER_UPDATE';
        }
        if ($task->invoice_id !== null) {
            return 'PAYMENT_FOLLOW_UP';
        }

        return 'FOLLOW_UP';
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
     * @param  array<string, mixed>  $customVariables
     * @return array<string, mixed>
     */
    private function buildSafeVariables(
        string $clinicId,
        stdClass $task,
        array $allowedVariables,
        array $customVariables,
    ): array {
        $defaults = [];
        $clinicName = DB::table('clinics')->where('id', $clinicId)->value('name');
        $defaults['clinic_name'] = is_string($clinicName) && $clinicName !== '' ? $clinicName : 'Cabinet';

        if ($task->patient_id !== null) {
            $patient = DB::table('patient_records')
                ->where('clinic_id', $clinicId)
                ->where('id', (string) $task->patient_id)
                ->first(['first_names', 'last_name']);
            if ($patient instanceof stdClass) {
                $defaults['first_name'] = (string) ($patient->first_names ?: $patient->last_name);
                $defaults['last_name'] = (string) $patient->last_name;
                $defaults['recipient_name'] = trim(((string) ($patient->first_names ?? '')).' '.((string) $patient->last_name));
            }
        } elseif ($task->prospect_contact_id !== null) {
            $prospect = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('id', (string) $task->prospect_contact_id)
                ->first(['name']);
            if ($prospect instanceof stdClass) {
                $defaults['first_name'] = (string) $prospect->name;
                $defaults['recipient_name'] = (string) $prospect->name;
            }
        }

        if ($task->appointment_id !== null) {
            $appt = DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('id', (string) $task->appointment_id)
                ->first(['starts_at']);
            if ($appt instanceof stdClass) {
                $tz = (string) (DB::table('clinics')->where('id', $clinicId)->value('timezone') ?: 'Africa/Douala');
                $local = CarbonImmutable::parse((string) $appt->starts_at, 'UTC')->setTimezone($tz);
                $defaults['appointment_date'] = $local->format('d/m/Y');
                $defaults['appointment_time'] = $local->format('H:i');
            }
        }

        if ($task->workshop_order_id !== null) {
            $ref = DB::table('workshop_orders')
                ->where('clinic_id', $clinicId)
                ->where('id', (string) $task->workshop_order_id)
                ->value('reference');
            if (is_string($ref)) {
                $defaults['order_reference'] = $ref;
            }
        }

        $dueLocal = CarbonImmutable::parse((string) $task->due_at, 'UTC');
        $defaults['due_date'] = $dueLocal->format('d/m/Y');

        $selected = [];
        foreach ($allowedVariables as $name) {
            if (array_key_exists($name, $customVariables)) {
                $selected[$name] = $customVariables[$name];
            } elseif (array_key_exists($name, $defaults)) {
                $selected[$name] = $defaults[$name];
            }
        }

        return $selected;
    }
}

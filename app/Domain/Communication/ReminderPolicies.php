<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Application\Effects\IdempotencyStore;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Billing\BillingErrors;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Politiques de rappels et relances (R02 / L2D06) et matérialisation idempotente de `contact_tasks`
 * à partir d'événements administratifs (rendez-vous confirmé, équipement prêt atelier, contrôle planifié,
 * échéance de paiement) sans jamais mentionner de donnée clinique.
 */
final class ReminderPolicies
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

        $query = DB::table('reminder_policies')->where('clinic_id', $clinicId);
        if (is_string($filters['purpose'] ?? null) && $filters['purpose'] !== '') {
            $query->where('purpose', $filters['purpose']);
        }
        if (is_string($filters['channel'] ?? null) && $filters['channel'] !== '') {
            $query->where('channel', $filters['channel']);
        }
        if (array_key_exists('active', $filters) && is_bool($filters['active'])) {
            $query->where('active', $filters['active'] ? 1 : 0);
        }
        if (is_string($filters['cursor'] ?? null) && $filters['cursor'] !== '') {
            $query->where('id', '>', $filters['cursor']);
        }

        $rows = $query->orderBy('id')->limit($limit + 1)->get()->all();
        $nextCursor = null;
        if (count($rows) > $limit) {
            array_pop($rows);
            $last = end($rows);
            if ($last instanceof stdClass) {
                $nextCursor = (string) $last->id;
            }
        }

        return [
            'items' => array_values($rows),
            'next_cursor' => $nextCursor,
        ];
    }

    public function get(string $clinicId, string $policyId): stdClass
    {
        $row = DB::table('reminder_policies')
            ->where('clinic_id', $clinicId)
            ->where('id', $policyId)
            ->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        return $row;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function create(CommandContext $context, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $code = trim((string) ($payload['code'] ?? ''));
        $label = CommunicationRules::requiredText((string) ($payload['label'] ?? ''), 180, 'label');
        $purpose = (string) ($payload['purpose'] ?? '');
        $channel = (string) ($payload['channel'] ?? '');
        $offsetUnit = (string) ($payload['offset_unit'] ?? '');
        $offsetValue = $payload['offset_value'] ?? null;
        $localSendTime = CommunicationRules::normalizeLocalSendTime(
            is_string($payload['local_send_time'] ?? null) ? $payload['local_send_time'] : null,
        );
        $active = array_key_exists('active', $payload) ? (bool) $payload['active'] : true;

        if ($code === '' || mb_strlen($code) > 64) {
            throw BusinessError::validation(['code' => ['Code de politique obligatoire (64 caractères max.).']]);
        }
        if (! in_array($purpose, CommunicationRules::REMINDER_PURPOSES, true)) {
            throw BusinessError::validation(['purpose' => ['Finalité de rappel invalide.']]);
        }
        if (! in_array($channel, CommunicationRules::REMINDER_CHANNELS, true)) {
            throw BusinessError::validation(['channel' => ['Canal de rappel invalide.']]);
        }
        if (! is_int($offsetValue)) {
            throw BusinessError::validation(['offset_value' => ['Décalage entier obligatoire.']]);
        }
        CommunicationRules::validateReminderOffset($offsetUnit, $offsetValue);

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'code' => $code,
            'label' => $label,
            'purpose' => $purpose,
            'channel' => $channel,
            'offset_unit' => $offsetUnit,
            'offset_value' => $offsetValue,
            'local_send_time' => $localSendTime,
            'active' => $active,
        ], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use (
            $context,
            $code,
            $label,
            $purpose,
            $channel,
            $offsetUnit,
            $offsetValue,
            $localSendTime,
            $active,
            $cleanKey,
            $fingerprint,
        ): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SaveReminderPolicy', $cleanKey);
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
                    $reservation = $this->idempotency->reserve($context, 'SaveReminderPolicy', $cleanKey, $fingerprint);
                }
            }

            $duplicate = DB::table('reminder_policies')
                ->where('clinic_id', $context->clinicId)
                ->where('code', $code)
                ->exists();
            if ($duplicate) {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Une politique de rappel porte déjà ce code dans ce cabinet.',
                    409,
                    ['code' => ['Code déjà utilisé.']],
                    null,
                    [],
                    ['current_status' => 'DUPLICATE_CODE'],
                );
            }

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            DB::table('reminder_policies')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'code' => $code,
                'label' => $label,
                'purpose' => $purpose,
                'channel' => $channel,
                'offset_unit' => $offsetUnit,
                'offset_value' => $offsetValue,
                'local_send_time' => $localSendTime,
                'active' => $active ? 1 : 0,
                'version' => 1,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.reminder_policy.created',
                'reminder_policies',
                $id,
                null,
                ['code' => $code, 'purpose' => $purpose, 'channel' => $channel],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'reminder_policies', $id, ['id' => $id]);
            }

            return $this->get($context->clinicId, $id);
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function update(CommandContext $context, string $policyId, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $expectedVersion = $payload['expected_version'] ?? null;
        if (! is_int($expectedVersion) || $expectedVersion < 1) {
            throw BusinessError::validation(['expected_version' => ['Version attendue obligatoire (entier >= 1).']]);
        }

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['id' => $policyId] + $payload, JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $policyId, $payload, $expectedVersion, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'UpdateReminderPolicy', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->get($context->clinicId, $policyId);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'UpdateReminderPolicy', $cleanKey, $fingerprint);
                }
            }

            $existing = $locks->reminderPolicy($policyId);
            if ($existing === null) {
                throw BusinessError::notFound();
            }

            if ((int) $existing->version !== $expectedVersion) {
                throw BillingErrors::versionConflict((int) $existing->version);
            }

            $label = array_key_exists('label', $payload)
                ? CommunicationRules::requiredText((string) $payload['label'], 180, 'label')
                : (string) $existing->label;
            $channel = array_key_exists('channel', $payload)
                ? (string) $payload['channel']
                : (string) $existing->channel;
            $offsetUnit = array_key_exists('offset_unit', $payload)
                ? (string) $payload['offset_unit']
                : (string) $existing->offset_unit;
            $offsetValue = array_key_exists('offset_value', $payload)
                ? $payload['offset_value']
                : (int) $existing->offset_value;
            $localSendTime = array_key_exists('local_send_time', $payload)
                ? CommunicationRules::normalizeLocalSendTime(is_string($payload['local_send_time']) ? $payload['local_send_time'] : null)
                : ($existing->local_send_time !== null ? (string) $existing->local_send_time : null);
            $active = array_key_exists('active', $payload)
                ? (bool) $payload['active']
                : (bool) $existing->active;

            if (! in_array($channel, CommunicationRules::REMINDER_CHANNELS, true)) {
                throw BusinessError::validation(['channel' => ['Canal de rappel invalide.']]);
            }
            if (! is_int($offsetValue)) {
                throw BusinessError::validation(['offset_value' => ['Décalage entier invalide.']]);
            }
            CommunicationRules::validateReminderOffset($offsetUnit, $offsetValue);

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            $nextVersion = ((int) $existing->version) + 1;

            DB::table('reminder_policies')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $policyId)
                ->update([
                    'label' => $label,
                    'channel' => $channel,
                    'offset_unit' => $offsetUnit,
                    'offset_value' => $offsetValue,
                    'local_send_time' => $localSendTime,
                    'active' => $active ? 1 : 0,
                    'version' => $nextVersion,
                    'updated_at' => $nowDb,
                ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.reminder_policy.updated',
                'reminder_policies',
                $policyId,
                null,
                ['version' => $nextVersion, 'channel' => $channel, 'active' => $active],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'reminder_policies', $policyId, ['id' => $policyId]);
            }

            return $this->get($context->clinicId, $policyId);
        });
    }

    /**
     * Matérialise de manière idempotente des tâches de contact à partir d'un événement administratif
     * (`AppointmentConfirmed`, `WorkshopReady`/`WorkshopOrderReady`, `FollowUpScheduled`, etc.).
     *
     * @param  array<string, mixed>  $payload
     */
    public function materializeTasksForEvent(
        string $clinicId,
        string $eventType,
        string $sourceId,
        int $sourceVersion,
        array $payload,
        ?CarbonImmutable $occurredAt = null,
    ): int {
        $mapping = match ($eventType) {
            'AppointmentConfirmed' => ['purpose' => 'APPOINTMENT', 'column' => 'appointment_id', 'note' => 'Rappel administratif de rendez-vous'],
            'WorkshopReady', 'WorkshopOrderReady' => ['purpose' => 'ORDER_UPDATE', 'column' => 'workshop_order_id', 'note' => 'Information administrative de disponibilité atelier'],
            'FollowUpScheduled', 'FollowUpPlanCreated' => ['purpose' => 'FOLLOW_UP', 'column' => 'follow_up_id', 'note' => 'Relance administrative de suivi'],
            'InvoiceIssued', 'PaymentFollowUpScheduled' => ['purpose' => 'PAYMENT_FOLLOW_UP', 'column' => 'invoice_id', 'note' => 'Relance administrative de règlement'],
            default => null,
        };

        if ($mapping === null) {
            return 0;
        }

        $patientId = is_string($payload['patient_id'] ?? null) && $payload['patient_id'] !== '' ? $payload['patient_id'] : null;
        $prospectId = is_string($payload['prospect_contact_id'] ?? null) && $payload['prospect_contact_id'] !== '' ? $payload['prospect_contact_id'] : null;
        if ((($patientId !== null ? 1 : 0) + ($prospectId !== null ? 1 : 0)) !== 1) {
            return 0;
        }

        $referenceRaw = $payload['starts_at'] ?? ($payload['due_at'] ?? ($payload['recommended_date'] ?? null));
        $referenceAt = is_string($referenceRaw) && $referenceRaw !== ''
            ? CarbonImmutable::parse($referenceRaw, 'UTC')
            : ($occurredAt ?? CarbonImmutable::now('UTC'));

        $clinicTimezone = (string) (DB::table('clinics')->where('id', $clinicId)->value('timezone') ?: 'Africa/Douala');

        return $this->transactions->run(function () use (
            $clinicId,
            $eventType,
            $sourceId,
            $sourceVersion,
            $mapping,
            $patientId,
            $prospectId,
            $referenceAt,
            $clinicTimezone,
        ): int {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            if ($prospectId !== null && $locks->prospectContact($prospectId) === null) {
                return 0;
            }
            if ($patientId !== null && $locks->patient($patientId) === null) {
                return 0;
            }

            $policies = DB::table('reminder_policies')
                ->where('clinic_id', $clinicId)
                ->where('purpose', $mapping['purpose'])
                ->where('active', 1)
                ->orderBy('id')
                ->get();

            $created = 0;
            $nowDb = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

            foreach ($policies as $policy) {
                $locks->reminderPolicy((string) $policy->id);

                $dueAt = CommunicationRules::computeDueAt(
                    $referenceAt,
                    (string) $policy->offset_unit,
                    (int) $policy->offset_value,
                    $policy->local_send_time !== null ? (string) $policy->local_send_time : null,
                    $clinicTimezone,
                );

                $dedupeKey = 'REM:'.$eventType.':'.$sourceId.':v'.max(1, $sourceVersion).':'.$policy->id;
                $dedupeKey = substr($dedupeKey, 0, 180);

                $exists = DB::table('contact_tasks')
                    ->where('clinic_id', $clinicId)
                    ->where('dedupe_key', $dedupeKey)
                    ->exists();
                if ($exists) {
                    continue;
                }

                $row = [
                    'id' => Ulid::generate(),
                    'clinic_id' => $clinicId,
                    'patient_id' => $patientId,
                    'prospect_contact_id' => $prospectId,
                    'follow_up_id' => $mapping['column'] === 'follow_up_id' ? $sourceId : null,
                    'appointment_id' => $mapping['column'] === 'appointment_id' ? $sourceId : null,
                    'invoice_id' => $mapping['column'] === 'invoice_id' ? $sourceId : null,
                    'workshop_order_id' => $mapping['column'] === 'workshop_order_id' ? $sourceId : null,
                    'policy_id' => (string) $policy->id,
                    'source_version' => max(1, $sourceVersion),
                    'due_at' => $dueAt->format('Y-m-d H:i:s.u'),
                    'channel' => (string) $policy->channel,
                    'status' => 'PENDING',
                    'next_attempt_at' => null,
                    'assigned_to' => null,
                    'dedupe_key' => $dedupeKey,
                    'administrative_notes' => $mapping['note'],
                    'version' => 1,
                    'created_at' => $nowDb,
                    'updated_at' => $nowDb,
                ];

                DB::table('contact_tasks')->insert($row);
                $created++;
            }

            return $created;
        });
    }
}

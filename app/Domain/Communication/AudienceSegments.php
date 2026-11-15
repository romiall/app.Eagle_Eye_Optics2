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
 * Segments d'audience strictement administratifs (ville, origine, volume de rendez-vous,
 * ancienneté de dernière visite, présence d'un devis, nature patient/prospect).
 * Tout critère clinique est rejeté avec erreur 422 VALIDATION_FAILED.
 */
final class AudienceSegments
{
    public const CRITERIA_SCHEMA_VERSION = 'v1';

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly IdempotencyStore $idempotency,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @return list<stdClass>
     */
    public function list(string $clinicId): array
    {
        return array_values(DB::table('audience_segments')
            ->where('clinic_id', $clinicId)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->get()
            ->all());
    }

    public function get(string $clinicId, string $segmentId): stdClass
    {
        $row = DB::table('audience_segments')
            ->where('clinic_id', $clinicId)
            ->where('id', $segmentId)
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
        $name = CommunicationRules::requiredText((string) ($payload['name'] ?? ''), 180, 'name');
        if (! is_array($payload['criteria'] ?? null)) {
            throw BusinessError::validation(['criteria' => ['Les critères doivent former un objet JSON.']]);
        }
        /** @var array<string, mixed> $rawCriteria */
        $rawCriteria = $payload['criteria'];
        $criteria = CommunicationRules::validateSegmentCriteria($rawCriteria);

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['name' => $name, 'criteria' => $criteria], JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $name, $criteria, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SaveAudienceSegment', $cleanKey);
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
                    $reservation = $this->idempotency->reserve($context, 'SaveAudienceSegment', $cleanKey, $fingerprint);
                }
            }

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            DB::table('audience_segments')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'name' => $name,
                'criteria' => (string) json_encode($criteria, JSON_THROW_ON_ERROR),
                'criteria_schema_version' => self::CRITERIA_SCHEMA_VERSION,
                'created_by' => (string) $context->actorId,
                'version' => 1,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.segment.created',
                'audience_segments',
                $id,
                null,
                ['name' => $name, 'criteria_keys' => array_keys($criteria)],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'audience_segments', $id, ['id' => $id]);
            }

            return $this->get($context->clinicId, $id);
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function update(CommandContext $context, string $segmentId, array $payload, ?string $idempotencyKey = null): stdClass
    {
        $expectedVersion = $payload['expected_version'] ?? null;
        if (! is_int($expectedVersion) || $expectedVersion < 1) {
            throw BusinessError::validation(['expected_version' => ['Version attendue obligatoire (entier >= 1).']]);
        }

        if (array_key_exists('criteria', $payload)) {
            if (! is_array($payload['criteria'])) {
                throw BusinessError::validation(['criteria' => ['Les critères doivent former un objet JSON.']]);
            }
            /** @var array<string, mixed> $rawCriteria */
            $rawCriteria = $payload['criteria'];
            CommunicationRules::validateSegmentCriteria($rawCriteria);
        }

        $cleanKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;
        $fingerprint = hash('sha256', (string) json_encode(['id' => $segmentId] + $payload, JSON_THROW_ON_ERROR));

        return $this->transactions->run(function () use ($context, $segmentId, $payload, $expectedVersion, $cleanKey, $fingerprint): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'UpdateAudienceSegment', $cleanKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }

                    return $this->get($context->clinicId, $segmentId);
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'UpdateAudienceSegment', $cleanKey, $fingerprint);
                }
            }

            $existing = DB::table('audience_segments')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $segmentId)
                ->lockForUpdate()
                ->first();
            if (! $existing instanceof stdClass) {
                throw BusinessError::notFound();
            }

            if ((int) $existing->version !== $expectedVersion) {
                throw BillingErrors::versionConflict((int) $existing->version);
            }

            $name = array_key_exists('name', $payload)
                ? CommunicationRules::requiredText((string) $payload['name'], 180, 'name')
                : (string) $existing->name;

            $criteriaJson = (string) $existing->criteria;
            if (array_key_exists('criteria', $payload) && is_array($payload['criteria'])) {
                /** @var array<string, mixed> $rawCriteria */
                $rawCriteria = $payload['criteria'];
                $criteria = CommunicationRules::validateSegmentCriteria($rawCriteria);
                $criteriaJson = (string) json_encode($criteria, JSON_THROW_ON_ERROR);
            }

            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            $nextVersion = ((int) $existing->version) + 1;

            DB::table('audience_segments')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $segmentId)
                ->update([
                    'name' => $name,
                    'criteria' => $criteriaJson,
                    'version' => $nextVersion,
                    'updated_at' => $nowDb,
                ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                'communication.segment.updated',
                'audience_segments',
                $segmentId,
                null,
                ['version' => $nextVersion, 'name' => $name],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'audience_segments', $segmentId, ['id' => $segmentId]);
            }

            return $this->get($context->clinicId, $segmentId);
        });
    }

    /**
     * Évalue les dossiers candidats non cliniques correspondant au segment dans le cabinet.
     *
     * @return list<array{patient_id: ?string, prospect_contact_id: ?string, raw_destination: ?string}>
     */
    public function evaluateCandidates(
        string $clinicId,
        stdClass $segment,
        string $channel,
        CarbonImmutable $now,
    ): array {
        $decoded = json_decode((string) $segment->criteria, true);
        /** @var array<string, mixed> $rawCriteria */
        $rawCriteria = is_array($decoded) ? $decoded : [];
        $criteria = CommunicationRules::validateSegmentCriteria($rawCriteria);

        $subjectType = (string) ($criteria['patient_or_prospect'] ?? ($criteria['subject_type'] ?? 'BOTH'));
        $candidates = [];

        if ($subjectType === 'PATIENT' || $subjectType === 'BOTH') {
            $patients = DB::table('patient_records')
                ->where('clinic_id', $clinicId)
                ->whereNull('archived_at')
                ->whereNull('merged_into_patient_id')
                ->orderBy('id')
                ->get(['id', 'address', 'phone_primary_normalized', 'phone_primary', 'phone_secondary_normalized', 'phone_secondary']);

            foreach ($patients as $patient) {
                $patientId = (string) $patient->id;
                if (! $this->matchesPatient($clinicId, $patient, $criteria, $now)) {
                    continue;
                }

                $rawDest = $channel === 'EMAIL'
                    ? null
                    : ($patient->phone_primary_normalized ?? ($patient->phone_primary ?? ($patient->phone_secondary_normalized ?? $patient->phone_secondary)));
                $candidates[] = [
                    'patient_id' => $patientId,
                    'prospect_contact_id' => null,
                    'raw_destination' => is_string($rawDest) && trim($rawDest) !== '' ? $rawDest : null,
                ];
            }
        }

        if ($subjectType === 'PROSPECT' || $subjectType === 'BOTH') {
            $prospects = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->orderBy('id')
                ->get(['id', 'patient_id', 'origin', 'phone_normalized', 'phone', 'email', 'administrative_notes']);

            foreach ($prospects as $prospect) {
                if ($subjectType === 'BOTH' && $prospect->patient_id !== null) {
                    // Déjà évalué comme patient si lié.
                    continue;
                }
                if (! $this->matchesProspect($clinicId, $prospect, $criteria, $now)) {
                    continue;
                }

                $rawDest = $channel === 'EMAIL'
                    ? $prospect->email
                    : ($prospect->phone_normalized ?? $prospect->phone);
                $candidates[] = [
                    'patient_id' => null,
                    'prospect_contact_id' => (string) $prospect->id,
                    'raw_destination' => is_string($rawDest) && trim($rawDest) !== '' ? $rawDest : null,
                ];
            }
        }

        return $candidates;
    }

    /**
     * @param  array<string, mixed>  $criteria
     */
    private function matchesPatient(string $clinicId, stdClass $patient, array $criteria, CarbonImmutable $now): bool
    {
        $patientId = (string) $patient->id;

        if (is_string($criteria['city'] ?? null)) {
            $address = mb_strtolower((string) ($patient->address ?? ''));
            if (! str_contains($address, mb_strtolower($criteria['city']))) {
                return false;
            }
        }

        if (is_string($criteria['origin'] ?? null)) {
            $hasOrigin = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('patient_id', $patientId)
                ->where('origin', $criteria['origin'])
                ->exists();
            if (! $hasOrigin) {
                return false;
            }
        }

        if (array_key_exists('has_quote', $criteria)) {
            $hasQuote = DB::table('quotes')
                ->where('clinic_id', $clinicId)
                ->where('patient_id', $patientId)
                ->exists();
            if ($hasQuote !== (bool) $criteria['has_quote']) {
                return false;
            }
        }

        if (isset($criteria['appointment_count']) || isset($criteria['min_appointments']) || isset($criteria['max_appointments'])) {
            $apptCount = (int) DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('patient_id', $patientId)
                ->where('status', '!=', 'CANCELLED')
                ->count();
            if (isset($criteria['appointment_count']) && $apptCount < (int) $criteria['appointment_count']) {
                return false;
            }
            if (isset($criteria['min_appointments']) && $apptCount < (int) $criteria['min_appointments']) {
                return false;
            }
            if (isset($criteria['max_appointments']) && $apptCount > (int) $criteria['max_appointments']) {
                return false;
            }
        }

        if (isset($criteria['last_visit_days']) || isset($criteria['min_last_visit_days']) || isset($criteria['max_last_visit_days'])) {
            $lastAppt = DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('patient_id', $patientId)
                ->whereIn('status', ['CONFIRMED', 'ARRIVED', 'COMPLETED'])
                ->max('starts_at');
            $lastInvoice = DB::table('invoices')
                ->where('clinic_id', $clinicId)
                ->where('patient_id', $patientId)
                ->where('status', 'ISSUED')
                ->max('issued_at');

            $latestRaw = $this->maxDateString($lastAppt, $lastInvoice);
            if ($latestRaw === null) {
                return false;
            }

            $days = (int) CarbonImmutable::parse($latestRaw, 'UTC')->diffInDays($now);
            if (isset($criteria['last_visit_days']) && $days > (int) $criteria['last_visit_days']) {
                return false;
            }
            if (isset($criteria['min_last_visit_days']) && $days < (int) $criteria['min_last_visit_days']) {
                return false;
            }
            if (isset($criteria['max_last_visit_days']) && $days > (int) $criteria['max_last_visit_days']) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $criteria
     */
    private function matchesProspect(string $clinicId, stdClass $prospect, array $criteria, CarbonImmutable $now): bool
    {
        $prospectId = (string) $prospect->id;

        if (is_string($criteria['origin'] ?? null) && (string) $prospect->origin !== $criteria['origin']) {
            return false;
        }

        if (is_string($criteria['city'] ?? null)) {
            $cityNeedle = mb_strtolower($criteria['city']);
            $notes = mb_strtolower((string) ($prospect->administrative_notes ?? ''));
            $matches = str_contains($notes, $cityNeedle);
            if (! $matches && $prospect->patient_id !== null) {
                $addr = DB::table('patient_records')
                    ->where('clinic_id', $clinicId)
                    ->where('id', (string) $prospect->patient_id)
                    ->value('address');
                $matches = is_string($addr) && str_contains(mb_strtolower($addr), $cityNeedle);
            }
            if (! $matches) {
                return false;
            }
        }

        if (array_key_exists('has_quote', $criteria)) {
            $hasQuote = DB::table('quotes')
                ->where('clinic_id', $clinicId)
                ->where('prospect_contact_id', $prospectId)
                ->exists();
            if ($hasQuote !== (bool) $criteria['has_quote']) {
                return false;
            }
        }

        if (isset($criteria['appointment_count']) || isset($criteria['min_appointments']) || isset($criteria['max_appointments'])) {
            $apptCount = (int) DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('prospect_contact_id', $prospectId)
                ->where('status', '!=', 'CANCELLED')
                ->count();
            if (isset($criteria['appointment_count']) && $apptCount < (int) $criteria['appointment_count']) {
                return false;
            }
            if (isset($criteria['min_appointments']) && $apptCount < (int) $criteria['min_appointments']) {
                return false;
            }
            if (isset($criteria['max_appointments']) && $apptCount > (int) $criteria['max_appointments']) {
                return false;
            }
        }

        if (isset($criteria['last_visit_days']) || isset($criteria['min_last_visit_days']) || isset($criteria['max_last_visit_days'])) {
            $lastAppt = DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('prospect_contact_id', $prospectId)
                ->whereIn('status', ['CONFIRMED', 'ARRIVED', 'COMPLETED'])
                ->max('starts_at');
            if (! is_string($lastAppt) || $lastAppt === '') {
                return false;
            }
            $days = (int) CarbonImmutable::parse($lastAppt, 'UTC')->diffInDays($now);
            if (isset($criteria['last_visit_days']) && $days > (int) $criteria['last_visit_days']) {
                return false;
            }
            if (isset($criteria['min_last_visit_days']) && $days < (int) $criteria['min_last_visit_days']) {
                return false;
            }
            if (isset($criteria['max_last_visit_days']) && $days > (int) $criteria['max_last_visit_days']) {
                return false;
            }
        }

        return true;
    }

    private function maxDateString(mixed $a, mixed $b): ?string
    {
        $sa = is_string($a) && $a !== '' ? $a : null;
        $sb = is_string($b) && $b !== '' ? $b : null;
        if ($sa === null) {
            return $sb;
        }
        if ($sb === null) {
            return $sa;
        }

        return strcmp($sa, $sb) >= 0 ? $sa : $sb;
    }
}

<?php

namespace App\Domain\Scheduling;

use App\Application\Contracts\ContractValidator;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeLogWriter;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Effects\IdempotencyStore;
use App\Application\Effects\OutboxEvent;
use App\Application\Effects\OutboxWriter;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Communication\ContactTasks;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Text;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Portail de prise de rendez-vous public & validation administrative (L2D02) :
 * - prestations réservables (`appointment_services.active = 1 AND public_booking = 1`), zéro donnée clinique/tarifaire ;
 * - créneaux libres combinant `AvailabilityService` (`appointments`, `resource_opening_hours`, `resource_exceptions`,
 *   `calendar_blocks` Google inclus) et fuseau horaire du cabinet ;
 * - soumission publique : consentement explicite `consent === true`, idempotence (`request_key` / `Idempotency-Key`),
 *   création ou réutilisation de `prospect_contacts` (`origin = 'WEBSITE'`) sans jamais consulter ni révéler
 *   l'existence d'un dossier patient (`patient_records`), référence publique opaque, jeton de gestion haché SHA-256,
 *   événement d'outbox `PublicBookingRequested` ;
 * - traitement back-office : liste paginée, confirmation (verrou rang 43, revérification du créneau, création d'un
 *   vrai rendez-vous `appointments` + outbox `AppointmentConfirmed`) et rejet (`REJECTED`).
 */
final class PublicBooking
{
    public const CONSENT_POLICY_VERSION = '2026-10-v1';

    /** @var list<string> */
    public const VALID_STATUSES = ['RECEIVED', 'PENDING', 'CONFIRMED', 'CONFLICT', 'CANCELLED', 'REJECTED'];

    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly TransactionRunner $transactions,
        private readonly ContractValidator $contracts,
        private readonly AuditRecorder $audit,
        private readonly ChangeLogWriter $changeLog,
        private readonly OutboxWriter $outbox,
        private readonly IdempotencyStore $idempotency,
        private readonly ContactTasks $tasks,
    ) {}

    public function resolvePublicClinicId(?string $explicitClinicId = null): string
    {
        if ($explicitClinicId !== null && trim($explicitClinicId) !== '') {
            $id = trim($explicitClinicId);
            if (! Ulid::isValid($id) || ! DB::table('clinics')->where('id', $id)->exists()) {
                throw BusinessError::notFound('Cabinet introuvable.');
            }

            return $id;
        }

        $configured = config('eeo.integrations.default_clinic_id');
        if (is_string($configured) && trim($configured) !== '') {
            $id = trim($configured);
            if (Ulid::isValid($id) && DB::table('clinics')->where('id', $id)->exists()) {
                return $id;
            }
        }

        $clinics = DB::table('clinics')->orderBy('created_at')->orderBy('id')->limit(2)->get(['id'])->all();
        if (count($clinics) === 1) {
            return (string) $clinics[0]->id;
        }

        throw new BusinessError(
            'CLINIC_NOT_CONFIGURED',
            'Aucun cabinet par défaut n\'est configuré pour la réservation publique.',
            503,
        );
    }

    /**
     * @return list<array{id: string, name: string, duration_minutes: int}>
     */
    public function listServices(string $clinicId): array
    {
        $rows = DB::table('appointment_services')
            ->where('clinic_id', $clinicId)
            ->where('active', true)
            ->where('public_booking', true)
            ->orderBy('name')
            ->orderBy('id')
            ->get(['id', 'name', 'duration_minutes'])
            ->all();

        return array_values(array_map(static fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'duration_minutes' => (int) $row->duration_minutes,
        ], $rows));
    }

    /**
     * @return list<array{service_id: string, resource_id: string, starts_at: string, ends_at: string}>
     */
    public function listSlots(
        string $clinicId,
        ?string $serviceId,
        ?string $fromRaw,
        ?string $toRaw,
        ?CarbonImmutable $now = null,
    ): array {
        $clinic = DB::table('clinics')->where('id', $clinicId)->first();
        if ($clinic === null) {
            throw BusinessError::notFound('Cabinet introuvable.');
        }

        $errors = [];
        if ($serviceId !== null && ! Ulid::isValid($serviceId)) {
            $errors['service_id'][] = 'Identifiant de prestation invalide.';
        }

        $nowUtc = ($now ?? CarbonImmutable::now('UTC'))->utc();
        $from = $fromRaw !== null && trim($fromRaw) !== ''
            ? SchedulingInput::instant($fromRaw, 'from', $errors)
            : $nowUtc;
        $to = $toRaw !== null && trim($toRaw) !== ''
            ? SchedulingInput::instant($toRaw, 'to', $errors)
            : ($from ?? $nowUtc)->addDays(7);

        if ($from !== null && $to !== null) {
            if (! $to->greaterThan($from)) {
                $errors['to'][] = 'La fin de la fenêtre doit suivre son début.';
            } elseif ($from->diffInDays($to) > 14) {
                $errors['to'][] = 'La fenêtre de recherche publique couvre au plus 14 jours.';
            }
        }

        $services = [];
        if (! isset($errors['service_id'])) {
            $serviceQuery = DB::table('appointment_services')
                ->where('clinic_id', $clinicId)
                ->where('active', true)
                ->where('public_booking', true)
                ->orderBy('id');

            if ($serviceId !== null) {
                $serviceQuery->where('id', $serviceId);
            }

            $services = $serviceQuery->get()->all();
            if ($serviceId !== null && $services === []) {
                $errors['service_id'][] = 'Prestation introuvable ou non ouverte à la réservation publique.';
            }
        }

        SchedulingInput::throwIfAny($errors);
        assert($from !== null && $to !== null);

        $resources = DB::table('scheduling_resources')
            ->where('clinic_id', $clinicId)
            ->where('active', true)
            ->orderBy('id')
            ->get()
            ->all();

        if ($services === [] || $resources === []) {
            return [];
        }

        $timezone = (string) $clinic->timezone;
        $startLocal = $from->setTimezone($timezone);
        $endLocal = $to->setTimezone($timezone);
        $startDay = CivilDate::fromString($startLocal->format('Y-m-d'));
        $endDay = CivilDate::fromString($endLocal->format('Y-m-d'));

        // Prise en compte des demandes publiques déjà ouvertes (RECEIVED / PENDING) pour ne pas proposer un créneau bloqué.
        $pendingRequests = array_values(DB::table('public_booking_requests')
            ->where('clinic_id', $clinicId)
            ->whereIn('status', ['RECEIVED', 'PENDING'])
            ->where('requested_ends_at', '>', SchedulingInput::stamp($from))
            ->where('requested_starts_at', '<', SchedulingInput::stamp($to))
            ->get(['resource_id', 'requested_starts_at', 'requested_ends_at'])
            ->all());

        $slots = [];
        for ($day = $startDay; $day->compare($endDay) <= 0; $day = $day->addDays(1)) {
            foreach ($services as $service) {
                foreach ($resources as $resource) {
                    $daySlots = $this->availability->slots($clinicId, $timezone, $resource, $service, $day, $nowUtc);
                    foreach ($daySlots as $slot) {
                        $slotStart = CarbonImmutable::parse($slot['starts_at'], 'UTC');
                        $slotEnd = CarbonImmutable::parse($slot['ends_at'], 'UTC');

                        if ($slotStart->lt($from) || $slotEnd->gt($to)) {
                            continue;
                        }
                        if ($this->overlapsPendingRequests($pendingRequests, (string) $resource->id, $slotStart, $slotEnd)) {
                            continue;
                        }

                        $slots[] = [
                            'service_id' => (string) $service->id,
                            'resource_id' => (string) $resource->id,
                            'starts_at' => $slot['starts_at'],
                            'ends_at' => $slot['ends_at'],
                        ];
                    }
                }
            }
        }

        usort($slots, static function (array $a, array $b): int {
            return [$a['starts_at'], $a['service_id'], $a['resource_id']]
                <=> [$b['starts_at'], $b['service_id'], $b['resource_id']];
        });

        return $slots;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{public_reference: string, status: string, service_id: string, requested_starts_at: string, requested_ends_at: string}
     */
    public function requestBooking(
        string $clinicId,
        array $payload,
        ?string $requestKey,
        string $correlationId,
        ?CarbonImmutable $now = null,
    ): array {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/BookingRequest', $payload);

        $key = $requestKey !== null ? trim($requestKey) : '';
        if ($key === '' || mb_strlen($key) > 100) {
            throw BusinessError::validation(['Idempotency-Key' => ['En-tête Idempotency-Key obligatoire (1 à 100 caractères).']]);
        }

        $errors = [];
        $name = null;
        $phoneRaw = null;
        $phoneNormalized = null;
        $email = null;

        try {
            $name = Text::optional(is_string($payload['name'] ?? null) ? $payload['name'] : null, 180, 'name');
            if ($name === null) {
                $errors['name'][] = 'Le nom du demandeur est obligatoire.';
            }
        } catch (RuleViolation $e) {
            $errors['name'][] = $e->getMessage();
        }

        try {
            $rawPhone = is_string($payload['phone'] ?? null) ? Text::trim($payload['phone']) : '';
            $phoneNormalized = Text::phone($rawPhone, 'phone');
            if ($phoneNormalized === null) {
                $errors['phone'][] = 'Le numéro de téléphone est obligatoire.';
            } else {
                $phoneRaw = mb_substr($rawPhone, 0, 32);
            }
        } catch (RuleViolation $e) {
            $errors['phone'][] = $e->getMessage();
        }

        if (isset($payload['email']) && is_string($payload['email'])) {
            try {
                $email = Text::optional($payload['email'], 254, 'email');
                if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                    $errors['email'][] = 'Adresse e-mail invalide.';
                }
            } catch (RuleViolation $e) {
                $errors['email'][] = $e->getMessage();
            }
        }

        $start = SchedulingInput::instant($payload['starts_at'] ?? null, 'starts_at', $errors);
        $nowUtc = ($now ?? CarbonImmutable::now('UTC'))->utc();
        if ($start !== null && ! $start->greaterThan($nowUtc)) {
            $errors['starts_at'][] = 'Le créneau demandé doit être dans le futur.';
        }

        if (($payload['consent'] ?? null) !== true) {
            $errors['consent'][] = 'Le consentement explicite est obligatoire pour enregistrer votre demande.';
        }

        SchedulingInput::throwIfAny($errors);
        assert($name !== null && $phoneRaw !== null && $phoneNormalized !== null && $start !== null);

        $serviceId = (string) $payload['service_id'];
        $requestedResourceId = is_string($payload['resource_id'] ?? null) ? $payload['resource_id'] : null;
        $payloadHash = CanonicalJson::hash($payload);
        $context = CommandContext::job($clinicId, 'PublicBookingRequest', $correlationId, $nowUtc);

        return $this->transactions->run(function () use (
            $context,
            $clinicId,
            $key,
            $payloadHash,
            $serviceId,
            $requestedResourceId,
            $start,
            $nowUtc,
            $name,
            $phoneRaw,
            $phoneNormalized,
            $email,
            $correlationId,
        ): array {
            $locks = new TransactionLocks($clinicId);
            $clinic = $locks->clinic();
            $timezone = (string) $clinic->timezone;

            // Vérification d'idempotence (rejeu exact -> même reçu sans doublon ; charge différente -> 409).
            $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'RequestPublicBooking', $key);
            if ($existingIdem !== null) {
                if ((string) $existingIdem->payload_hash !== $payloadHash) {
                    throw BusinessError::idempotencyMismatch();
                }
                if ((string) $existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                    /** @var array{public_reference: string, status: string, service_id: string, requested_starts_at: string, requested_ends_at: string} $cached */
                    $cached = json_decode($existingIdem->result_payload, true, 512, JSON_THROW_ON_ERROR);

                    return $cached;
                }
                $this->idempotency->restart($context, (string) $existingIdem->id);
                $idemId = (string) $existingIdem->id;
            } else {
                $idemId = $this->idempotency->reserve($context, 'RequestPublicBooking', $key, $payloadHash);
            }

            $existingByKey = DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('request_key', $key)
                ->first();
            if ($existingByKey !== null) {
                $receipt = [
                    'public_reference' => (string) $existingByKey->public_reference,
                    'status' => (string) $existingByKey->status,
                    'service_id' => (string) $existingByKey->service_id,
                    'requested_starts_at' => SchedulingInput::iso((string) $existingByKey->requested_starts_at),
                    'requested_ends_at' => SchedulingInput::iso((string) $existingByKey->requested_ends_at),
                ];
                $this->idempotency->complete($context, $idemId, 'public_booking_requests', (string) $existingByKey->id, $receipt);

                return $receipt;
            }

            $service = DB::table('appointment_services')
                ->where('clinic_id', $clinicId)
                ->where('id', $serviceId)
                ->first();
            if ($service === null) {
                throw BusinessError::validation(['service_id' => ['Prestation introuvable dans ce cabinet.']]);
            }
            if (! (bool) $service->active || ! (bool) $service->public_booking) {
                throw BusinessError::validation(['service_id' => ['Cette prestation n\'est pas ouverte à la réservation publique.']]);
            }

            $end = $start->addMinutes((int) $service->duration_minutes);
            $resource = $this->pickBookableResource($clinicId, $timezone, $service, $start, $end, $requestedResourceId);
            $resourceId = (string) $resource->id;
            $stamp = SchedulingInput::stamp($nowUtc);

            // IMPORTANT : aucune consultation de `patient_records` ici ! Un numéro de téléphone existant ne
            // modifie jamais la réponse ni les liaisons : le prospect reste isolé (`patient_id = null`).
            $prospect = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('phone_normalized', $phoneNormalized)
                ->orderBy('id')
                ->first();

            if ($prospect !== null) {
                $prospectId = (string) $prospect->id;
            } else {
                $creatorId = DB::table('users')
                    ->where('clinic_id', $clinicId)
                    ->orderByDesc('active')
                    ->orderBy('created_at')
                    ->orderBy('id')
                    ->value('id');
                if (! is_string($creatorId)) {
                    throw new BusinessError('CLINIC_NOT_CONFIGURED', 'Aucun compte configuré dans ce cabinet.', 503);
                }

                $prospectId = Ulid::generate();
                DB::table('prospect_contacts')->insert([
                    'id' => $prospectId,
                    'clinic_id' => $clinicId,
                    'name' => $name,
                    'phone' => $phoneRaw,
                    'phone_normalized' => $phoneNormalized,
                    'email' => $email,
                    'patient_id' => null,
                    'origin' => 'WEBSITE',
                    'administrative_notes' => null,
                    'created_by' => $creatorId,
                    'version' => 1,
                    'created_at' => $stamp,
                    'updated_at' => $stamp,
                ]);
            }

            $bookingId = Ulid::generate();
            $publicReference = $this->generateUniqueReference($clinicId);
            $managementToken = bin2hex(random_bytes(32));
            $tokenHash = hash('sha256', $managementToken);
            $tokenExpiresAt = SchedulingInput::stamp($start->addDays(7));
            $status = 'PENDING';

            DB::table('public_booking_requests')->insert([
                'id' => $bookingId,
                'clinic_id' => $clinicId,
                'catalog_publication_id' => null,
                'public_reference' => $publicReference,
                'prospect_contact_id' => $prospectId,
                'service_id' => $serviceId,
                'resource_id' => $resourceId,
                'requested_starts_at' => SchedulingInput::stamp($start),
                'requested_ends_at' => SchedulingInput::stamp($end),
                'appointment_id' => null,
                'request_key' => $key,
                'status' => $status,
                'consent_recorded_at' => $stamp,
                'consent_policy_version' => self::CONSENT_POLICY_VERSION,
                'management_token_hash' => $tokenHash,
                'token_expires_at' => $tokenExpiresAt,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);

            $this->outbox->write($context, [
                new OutboxEvent('PublicBookingRequested', 1, 'public_booking_requests', $bookingId, 1, [
                    'booking_request_id' => $bookingId,
                    'public_reference' => $publicReference,
                    'service_id' => $serviceId,
                    'requested_starts_at' => $start->format('Y-m-d\TH:i:s.v\Z'),
                    'status' => $status,
                ]),
            ]);

            $this->audit->recordFor(
                $clinicId,
                null,
                'Portail public',
                'public_booking.requested',
                'public_booking_requests',
                $bookingId,
                null,
                [
                    'public_reference' => $publicReference,
                    'service_id' => $serviceId,
                    'resource_id' => $resourceId,
                    'status' => $status,
                ],
                $correlationId,
            );

            $receipt = [
                'public_reference' => $publicReference,
                'status' => $status,
                'service_id' => $serviceId,
                'requested_starts_at' => $start->format('Y-m-d\TH:i:s.v\Z'),
                'requested_ends_at' => $end->format('Y-m-d\TH:i:s.v\Z'),
            ];

            $this->idempotency->complete($context, $idemId, 'public_booking_requests', $bookingId, $receipt);

            return $receipt;
        });
    }

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public function listRequests(string $clinicId, ?string $status, mixed $page): LengthAwarePaginator
    {
        if ($status !== null && ! in_array($status, self::VALID_STATUSES, true)) {
            throw BusinessError::validation(['status' => ['Statut de demande publique invalide.']]);
        }

        $pageNumber = is_numeric($page) && (int) $page >= 1 ? (int) $page : 1;

        $query = DB::table('public_booking_requests as pbr')
            ->leftJoin('appointment_services as s', static function ($join): void {
                $join->on('s.clinic_id', '=', 'pbr.clinic_id')->on('s.id', '=', 'pbr.service_id');
            })
            ->leftJoin('prospect_contacts as pc', static function ($join): void {
                $join->on('pc.clinic_id', '=', 'pbr.clinic_id')->on('pc.id', '=', 'pbr.prospect_contact_id');
            })
            ->where('pbr.clinic_id', $clinicId)
            ->select([
                'pbr.id',
                'pbr.public_reference',
                'pbr.status',
                'pbr.service_id',
                's.name as service_name',
                'pbr.resource_id',
                'pbr.prospect_contact_id',
                'pc.name as prospect_name',
                'pc.phone as prospect_phone',
                'pbr.requested_starts_at',
                'pbr.requested_ends_at',
                'pbr.appointment_id',
                'pbr.consent_recorded_at',
                'pbr.created_at',
            ]);

        if ($status !== null) {
            $query->where('pbr.status', $status);
        }

        return $query
            ->orderByDesc('pbr.created_at')
            ->orderByDesc('pbr.id')
            ->paginate(25, ['*'], 'page', $pageNumber);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function confirmRequest(
        User $actor,
        string $bookingId,
        string $correlationId,
        ?string $idempotencyKey,
        array $payload,
        ?CarbonImmutable $now = null,
    ): array {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/DecidePublicBookingRequest', $payload);
        $clinicId = (string) $actor->clinic_id;
        $context = CommandContext::direct($actor, $correlationId, $now);
        $hash = CanonicalJson::hash(['action' => 'confirm', 'id' => $bookingId] + $payload);

        return $this->transactions->joinOrRun(function () use ($context, $clinicId, $bookingId, $payload, $idempotencyKey, $hash): array {
            $locks = new TransactionLocks($clinicId);
            $clinic = $locks->clinic();
            $timezone = (string) $clinic->timezone;

            $idemId = null;
            if ($idempotencyKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'ConfirmPublicBooking', $idempotencyKey);
                if ($existingIdem !== null) {
                    if ((string) $existingIdem->payload_hash !== $hash) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    if ((string) $existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                        /** @var array<string, mixed> $decoded */
                        $decoded = json_decode($existingIdem->result_payload, true, 512, JSON_THROW_ON_ERROR);

                        return $decoded;
                    }
                    $this->idempotency->restart($context, (string) $existingIdem->id);
                    $idemId = (string) $existingIdem->id;
                } else {
                    $idemId = $this->idempotency->reserve($context, 'ConfirmPublicBooking', $idempotencyKey, $hash);
                }
            }

            $booking = $locks->publicBookingRequest($bookingId);
            if ($booking === null) {
                throw BusinessError::notFound('Demande publique introuvable dans ce cabinet.');
            }
            $currentStatus = (string) $booking->status;
            if (! in_array($currentStatus, ['RECEIVED', 'PENDING'], true)) {
                throw BusinessError::stateRefused('Cette demande publique ne peut plus être confirmée.', $currentStatus);
            }

            $prospect = $locks->prospectContact((string) $booking->prospect_contact_id);
            if ($prospect === null) {
                throw BusinessError::notFound('Prospect lié à la demande introuvable.');
            }

            $resourceId = is_string($payload['resource_id'] ?? null)
                ? (string) $payload['resource_id']
                : (string) $booking->resource_id;
            $resource = DB::table('scheduling_resources')
                ->where('clinic_id', $clinicId)
                ->where('id', $resourceId)
                ->first();
            if ($resource === null || ! (bool) $resource->active) {
                throw BusinessError::validation(['resource_id' => ['Ressource de l\'agenda introuvable ou inactive.']]);
            }

            $service = DB::table('appointment_services')
                ->where('clinic_id', $clinicId)
                ->where('id', (string) $booking->service_id)
                ->first();
            if ($service === null || ! (bool) $service->active) {
                throw BusinessError::validation(['service_id' => ['Prestation introuvable ou inactive.']]);
            }

            $start = CarbonImmutable::parse((string) $booking->requested_starts_at, 'UTC')->utc();
            $end = CarbonImmutable::parse((string) $booking->requested_ends_at, 'UTC')->utc();

            $this->availability->assertBookable($clinicId, $timezone, $resource, $service, $start, $end);

            $nowUtc = $context->now->utc();
            $stamp = SchedulingInput::stamp($nowUtc);
            $appointmentId = Ulid::generate();
            $linkedPatientId = $prospect->patient_id !== null ? (string) $prospect->patient_id : null;
            $linkedProspectId = $linkedPatientId === null ? (string) $prospect->id : null;
            $reason = isset($payload['reason']) && is_string($payload['reason']) && trim($payload['reason']) !== ''
                ? trim($payload['reason'])
                : null;

            DB::table('appointments')->insert([
                'id' => $appointmentId,
                'clinic_id' => $clinicId,
                'patient_id' => $linkedPatientId,
                'prospect_contact_id' => $linkedProspectId,
                'follow_up_id' => null,
                'resource_id' => $resourceId,
                'service_id' => (string) $booking->service_id,
                'starts_at' => SchedulingInput::stamp($start),
                'ends_at' => SchedulingInput::stamp($end),
                'status' => 'CONFIRMED',
                'source' => 'WEBSITE',
                'administrative_reason' => $reason,
                'cancel_reason' => null,
                'created_by' => (string) $context->actorId,
                'version' => 1,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);

            DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('id', $bookingId)
                ->update([
                    'resource_id' => $resourceId,
                    'appointment_id' => $appointmentId,
                    'status' => 'CONFIRMED',
                    'updated_at' => $stamp,
                ]);

            $appointmentRow = DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('id', $appointmentId)
                ->first();
            assert($appointmentRow !== null);

            $changes = [new ChangeRecord('appointments', $appointmentId, 1, ChangeVisibility::Administrative, ChangeKind::Created)];
            if ($linkedPatientId !== null) {
                $changes = [...$changes, ...$this->tasks->forAppointment($clinicId, $timezone, $appointmentRow, $nowUtc)];
            }
            $this->changeLog->write($context, $locks, $changes);

            $this->outbox->write($context, [
                new OutboxEvent('AppointmentConfirmed', 1, 'appointments', $appointmentId, 1, [
                    'appointment_id' => $appointmentId,
                    'patient_id' => $linkedPatientId,
                    'prospect_contact_id' => $linkedProspectId,
                    'resource_id' => $resourceId,
                    'service_id' => (string) $booking->service_id,
                    'starts_at' => $start->format('Y-m-d\TH:i:s.v\Z'),
                    'ends_at' => $end->format('Y-m-d\TH:i:s.v\Z'),
                    'source' => 'WEBSITE',
                ]),
            ]);

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'public_booking.confirmed',
                'public_booking_requests',
                $bookingId,
                $reason,
                [
                    'appointment_id' => $appointmentId,
                    'resource_id' => $resourceId,
                    'status' => 'CONFIRMED',
                ],
                $context->correlationId,
            );

            $item = $this->findAdminItem($clinicId, $bookingId);
            assert($item !== null);
            $presented = self::presentAdminItem($item);

            if ($idemId !== null) {
                $this->idempotency->complete($context, $idemId, 'public_booking_requests', $bookingId, $presented);
            }

            return $presented;
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function rejectRequest(
        User $actor,
        string $bookingId,
        string $correlationId,
        ?string $idempotencyKey,
        array $payload,
        ?CarbonImmutable $now = null,
    ): array {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/DecidePublicBookingRequest', $payload);
        $clinicId = (string) $actor->clinic_id;
        $context = CommandContext::direct($actor, $correlationId, $now);
        $hash = CanonicalJson::hash(['action' => 'reject', 'id' => $bookingId] + $payload);

        return $this->transactions->joinOrRun(function () use ($context, $clinicId, $bookingId, $payload, $idempotencyKey, $hash): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $idemId = null;
            if ($idempotencyKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'RejectPublicBooking', $idempotencyKey);
                if ($existingIdem !== null) {
                    if ((string) $existingIdem->payload_hash !== $hash) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    if ((string) $existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                        /** @var array<string, mixed> $decoded */
                        $decoded = json_decode($existingIdem->result_payload, true, 512, JSON_THROW_ON_ERROR);

                        return $decoded;
                    }
                    $this->idempotency->restart($context, (string) $existingIdem->id);
                    $idemId = (string) $existingIdem->id;
                } else {
                    $idemId = $this->idempotency->reserve($context, 'RejectPublicBooking', $idempotencyKey, $hash);
                }
            }

            $booking = $locks->publicBookingRequest($bookingId);
            if ($booking === null) {
                throw BusinessError::notFound('Demande publique introuvable dans ce cabinet.');
            }
            $currentStatus = (string) $booking->status;
            if (! in_array($currentStatus, ['RECEIVED', 'PENDING', 'CONFLICT'], true)) {
                throw BusinessError::stateRefused('Cette demande publique ne peut plus être refusée.', $currentStatus);
            }

            $stamp = SchedulingInput::stamp($context->now->utc());
            DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('id', $bookingId)
                ->update([
                    'status' => 'REJECTED',
                    'updated_at' => $stamp,
                ]);

            $reason = isset($payload['reason']) && is_string($payload['reason']) && trim($payload['reason']) !== ''
                ? trim($payload['reason'])
                : null;

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'public_booking.rejected',
                'public_booking_requests',
                $bookingId,
                $reason,
                ['previous_status' => $currentStatus, 'status' => 'REJECTED'],
                $context->correlationId,
            );

            $item = $this->findAdminItem($clinicId, $bookingId);
            assert($item !== null);
            $presented = self::presentAdminItem($item);

            if ($idemId !== null) {
                $this->idempotency->complete($context, $idemId, 'public_booking_requests', $bookingId, $presented);
            }

            return $presented;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function presentAdminItem(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'public_reference' => (string) $row->public_reference,
            'status' => (string) $row->status,
            'service_id' => (string) $row->service_id,
            'service_name' => is_string($row->service_name ?? null) ? $row->service_name : null,
            'resource_id' => is_string($row->resource_id ?? null) ? $row->resource_id : null,
            'prospect_contact_id' => (string) $row->prospect_contact_id,
            'prospect_name' => is_string($row->prospect_name ?? null) ? $row->prospect_name : null,
            'prospect_phone' => is_string($row->prospect_phone ?? null) ? $row->prospect_phone : null,
            'requested_starts_at' => SchedulingInput::iso((string) $row->requested_starts_at),
            'requested_ends_at' => SchedulingInput::iso((string) $row->requested_ends_at),
            'appointment_id' => is_string($row->appointment_id ?? null) ? $row->appointment_id : null,
            'consent_recorded_at' => SchedulingInput::iso((string) $row->consent_recorded_at),
            'created_at' => SchedulingInput::iso((string) $row->created_at),
        ];
    }

    private function pickBookableResource(
        string $clinicId,
        string $timezone,
        stdClass $service,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $requestedResourceId,
    ): stdClass {
        $startStamp = SchedulingInput::stamp($start);
        $endStamp = SchedulingInput::stamp($end);

        if ($requestedResourceId !== null) {
            $resource = DB::table('scheduling_resources')
                ->where('clinic_id', $clinicId)
                ->where('id', $requestedResourceId)
                ->first();
            if ($resource === null || ! (bool) $resource->active) {
                throw BusinessError::validation(['resource_id' => ['Ressource introuvable ou inactive.']]);
            }

            $this->availability->assertBookable($clinicId, $timezone, $resource, $service, $start, $end);
            $hasPending = DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('resource_id', $requestedResourceId)
                ->whereIn('status', ['RECEIVED', 'PENDING'])
                ->where('requested_starts_at', '<', $endStamp)
                ->where('requested_ends_at', '>', $startStamp)
                ->exists();
            if ($hasPending) {
                throw new BusinessError('SLOT_UNAVAILABLE', 'Ce créneau vient d\'être réservé : choisissez un autre horaire.', 409);
            }

            return $resource;
        }

        $resources = DB::table('scheduling_resources')
            ->where('clinic_id', $clinicId)
            ->where('active', true)
            ->orderBy('id')
            ->get()
            ->all();

        foreach ($resources as $candidate) {
            $hasPending = DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('resource_id', (string) $candidate->id)
                ->whereIn('status', ['RECEIVED', 'PENDING'])
                ->where('requested_starts_at', '<', $endStamp)
                ->where('requested_ends_at', '>', $startStamp)
                ->exists();
            if ($hasPending) {
                continue;
            }

            try {
                $this->availability->assertBookable($clinicId, $timezone, $candidate, $service, $start, $end);

                return $candidate;
            } catch (BusinessError) {
                continue;
            }
        }

        throw new BusinessError('SLOT_UNAVAILABLE', 'Aucun créneau disponible à cet horaire : choisissez un autre créneau.', 409);
    }

    /**
     * @param  list<stdClass>  $pending
     */
    private function overlapsPendingRequests(array $pending, string $resourceId, CarbonImmutable $start, CarbonImmutable $end): bool
    {
        foreach ($pending as $row) {
            if ((string) $row->resource_id !== $resourceId) {
                continue;
            }
            $rowStart = CarbonImmutable::parse((string) $row->requested_starts_at, 'UTC');
            $rowEnd = CarbonImmutable::parse((string) $row->requested_ends_at, 'UTC');
            if ($rowStart->lt($end) && $rowEnd->gt($start)) {
                return true;
            }
        }

        return false;
    }

    private function generateUniqueReference(string $clinicId): string
    {
        for ($i = 0; $i < 10; $i++) {
            $candidate = 'RDV-'.strtoupper(bin2hex(random_bytes(5)));
            $exists = DB::table('public_booking_requests')
                ->where('clinic_id', $clinicId)
                ->where('public_reference', $candidate)
                ->exists();
            if (! $exists) {
                return $candidate;
            }
        }

        return 'RDV-'.substr(Ulid::generate(), -12);
    }

    private function findAdminItem(string $clinicId, string $bookingId): ?stdClass
    {
        return DB::table('public_booking_requests as pbr')
            ->leftJoin('appointment_services as s', static function ($join): void {
                $join->on('s.clinic_id', '=', 'pbr.clinic_id')->on('s.id', '=', 'pbr.service_id');
            })
            ->leftJoin('prospect_contacts as pc', static function ($join): void {
                $join->on('pc.clinic_id', '=', 'pbr.clinic_id')->on('pc.id', '=', 'pbr.prospect_contact_id');
            })
            ->where('pbr.clinic_id', $clinicId)
            ->where('pbr.id', $bookingId)
            ->select([
                'pbr.id',
                'pbr.public_reference',
                'pbr.status',
                'pbr.service_id',
                's.name as service_name',
                'pbr.resource_id',
                'pbr.prospect_contact_id',
                'pc.name as prospect_name',
                'pc.phone as prospect_phone',
                'pbr.requested_starts_at',
                'pbr.requested_ends_at',
                'pbr.appointment_id',
                'pbr.consent_recorded_at',
                'pbr.created_at',
            ])
            ->first();
    }
}

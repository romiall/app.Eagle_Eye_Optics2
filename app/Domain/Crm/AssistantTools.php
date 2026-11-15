<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Scheduling\AvailabilityService;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Jeu d'outils strictement assainis et bornés pour l'assistant IA (L2D05) :
 * - Base de connaissances PUBLIÉE uniquement (`published_at IS NOT NULL AND retired_at IS NULL`) ;
 * - Prestations réservables et créneaux disponibles de l'agenda ;
 * - Enregistrement administratif d'une demande publique de rendez-vous (`public_booking_requests`).
 *
 * CLOISONNEMENT : n'accède JAMAIS aux dossiers patients, consultations, ordonnances ni révisions cliniques.
 */
final class AssistantTools
{
    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly TransactionRunner $transactions,
    ) {}

    /**
     * Retourne uniquement les versions actuellement publiées des fiches actives du cabinet.
     *
     * @return list<array{
     *     version_id: string,
     *     entry_id: string,
     *     code: string,
     *     title: string,
     *     category: string,
     *     content: string,
     *     language: string,
     * }>
     */
    public function listPublishedKnowledge(string $clinicId): array
    {
        $rows = DB::table('knowledge_entry_versions as v')
            ->join('knowledge_entries as e', static function ($join): void {
                $join->on('e.clinic_id', '=', 'v.clinic_id')
                    ->on('e.id', '=', 'v.entry_id');
            })
            ->where('e.clinic_id', $clinicId)
            ->where('e.active', true)
            ->where('v.clinic_id', $clinicId)
            ->whereNotNull('v.published_at')
            ->whereNull('v.retired_at')
            ->orderBy('e.category')
            ->orderBy('e.code')
            ->orderBy('v.id')
            ->get([
                'v.id as version_id',
                'v.entry_id',
                'e.code',
                'e.title',
                'e.category',
                'v.content',
                'v.language',
            ]);

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'version_id' => (string) $row->version_id,
                'entry_id' => (string) $row->entry_id,
                'code' => (string) $row->code,
                'title' => (string) $row->title,
                'category' => (string) $row->category,
                'content' => (string) $row->content,
                'language' => (string) $row->language,
            ];
        }

        return $out;
    }

    /**
     * Liste des prestations ouvertes à la réservation publique / assistée.
     *
     * @return list<array{service_id: string, name: string, duration_minutes: int}>
     */
    public function getBookableServices(string $clinicId): array
    {
        $rows = DB::table('appointment_services')
            ->where('clinic_id', $clinicId)
            ->where('active', true)
            ->where('public_booking', true)
            ->orderBy('name')
            ->orderBy('id')
            ->get(['id', 'name', 'duration_minutes']);

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'service_id' => (string) $row->id,
                'name' => (string) $row->name,
                'duration_minutes' => (int) $row->duration_minutes,
            ];
        }

        return $out;
    }

    /**
     * Créneaux disponibles pour une prestation et une journée données.
     *
     * @return list<array{resource_id: string, resource_name: string, starts_at: string, ends_at: string}>
     */
    public function getAvailableSlots(string $clinicId, string $serviceId, CivilDate $day, CarbonImmutable $now): array
    {
        if (! Ulid::isValid($serviceId)) {
            return [];
        }

        $clinic = DB::table('clinics')->where('id', $clinicId)->first(['timezone']);
        if ($clinic === null) {
            return [];
        }
        $timezone = (string) $clinic->timezone;

        $service = DB::table('appointment_services')
            ->where('clinic_id', $clinicId)
            ->where('id', $serviceId)
            ->where('active', true)
            ->where('public_booking', true)
            ->first();
        if ($service === null) {
            return [];
        }

        $resources = DB::table('scheduling_resources')
            ->where('clinic_id', $clinicId)
            ->where('active', true)
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        $out = [];
        foreach ($resources as $resource) {
            $slots = $this->availability->slots($clinicId, $timezone, $resource, $service, $day, $now);
            foreach ($slots as $slot) {
                $out[] = [
                    'resource_id' => (string) $resource->id,
                    'resource_name' => (string) $resource->name,
                    'starts_at' => $slot['starts_at'],
                    'ends_at' => $slot['ends_at'],
                ];
            }
        }

        usort($out, static fn (array $a, array $b): int => strcmp($a['starts_at'], $b['starts_at']) ?: strcmp($a['resource_id'], $b['resource_id']));

        return $out;
    }

    /**
     * Crée une demande administrative de rendez-vous dans `public_booking_requests` pour le prospect,
     * après vérification stricte de disponibilité sous verrou.
     *
     * @return array{id: string, public_reference: string, requested_starts_at: string, requested_ends_at: string}
     */
    public function createPublicBookingRequest(
        string $clinicId,
        string $prospectContactId,
        string $serviceId,
        string $resourceId,
        CarbonImmutable $startsAt,
        string $requestKey,
        CarbonImmutable $now,
    ): array {
        return $this->transactions->run(function () use (
            $clinicId,
            $prospectContactId,
            $serviceId,
            $resourceId,
            $startsAt,
            $requestKey,
            $now,
        ): array {
            $locks = new TransactionLocks($clinicId);
            $clinic = $locks->clinic();
            $locks->prospectContact($prospectContactId);
            $service = $locks->appointmentService($serviceId);
            if ($service === null) {
                throw BusinessError::notFound('Prestation introuvable.');
            }

            return $this->recordBookingRequestUnderLocks(
                $clinicId,
                (string) $clinic->timezone,
                $prospectContactId,
                $service,
                $resourceId,
                $startsAt,
                $requestKey,
                $now,
            );
        });
    }

    /**
     * Enregistre une demande `public_booking_requests` alors que le verrou cabinet, prospect et prestation
     * sont déjà détenus dans la transaction appelante.
     *
     * @return array{id: string, public_reference: string, requested_starts_at: string, requested_ends_at: string}
     */
    public function recordBookingRequestUnderLocks(
        string $clinicId,
        string $timezone,
        string $prospectContactId,
        stdClass $service,
        string $resourceId,
        CarbonImmutable $startsAt,
        string $requestKey,
        CarbonImmutable $now,
    ): array {
        $existing = DB::table('public_booking_requests')
            ->where('clinic_id', $clinicId)
            ->where('request_key', $requestKey)
            ->first();
        if ($existing !== null) {
            return [
                'id' => (string) $existing->id,
                'public_reference' => (string) $existing->public_reference,
                'requested_starts_at' => CarbonImmutable::parse((string) $existing->requested_starts_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
                'requested_ends_at' => CarbonImmutable::parse((string) $existing->requested_ends_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
            ];
        }

        if (! (bool) $service->active || ! (bool) $service->public_booking) {
            throw BusinessError::validation(['service_id' => ['Cette prestation n\'est pas ouverte à la réservation en ligne.']]);
        }

        $resource = DB::table('scheduling_resources')
            ->where('clinic_id', $clinicId)
            ->where('id', $resourceId)
            ->first();
        if ($resource === null) {
            throw BusinessError::notFound('Ressource agenda introuvable.');
        }

        $startUtc = $startsAt->utc();
        $endUtc = $startUtc->addMinutes((int) $service->duration_minutes);
        $this->availability->assertBookable($clinicId, $timezone, $resource, $service, $startUtc, $endUtc);

        $id = Ulid::generate();
        $publicRef = 'RDV-'.substr($id, -8);
        $nowSql = $now->utc()->format('Y-m-d H:i:s.u');
        $expiresSql = $now->utc()->addDays(7)->format('Y-m-d H:i:s.u');

        DB::table('public_booking_requests')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'catalog_publication_id' => null,
            'public_reference' => $publicRef,
            'prospect_contact_id' => $prospectContactId,
            'service_id' => (string) $service->id,
            'resource_id' => $resourceId,
            'requested_starts_at' => $startUtc->format('Y-m-d H:i:s.u'),
            'requested_ends_at' => $endUtc->format('Y-m-d H:i:s.u'),
            'appointment_id' => null,
            'request_key' => $requestKey,
            'status' => 'PENDING',
            'consent_recorded_at' => $nowSql,
            'consent_policy_version' => 'assistant-v1',
            'management_token_hash' => hash('sha256', Ulid::generate().'|'.$requestKey),
            'token_expires_at' => $expiresSql,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        return [
            'id' => $id,
            'public_reference' => $publicRef,
            'requested_starts_at' => $startUtc->format('Y-m-d\TH:i:s.v\Z'),
            'requested_ends_at' => $endUtc->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }
}

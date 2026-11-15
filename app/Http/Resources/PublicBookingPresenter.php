<?php

namespace App\Http\Resources;

use App\Domain\Scheduling\CalendarReconciliation;
use App\Domain\Scheduling\PublicBooking;
use stdClass;

/**
 * Formateur des réponses HTTP du portail public et de la synchronisation Google Calendar.
 * Exclut systématiquement toute donnée clinique, tarif non public, jeton chiffré ou lien vers `patient_id`.
 */
final class PublicBookingPresenter
{
    /**
     * @param  array{id: string, name: string, duration_minutes: int}  $service
     * @return array{id: string, name: string, duration_minutes: int}
     */
    public static function service(array $service): array
    {
        return [
            'id' => $service['id'],
            'name' => $service['name'],
            'duration_minutes' => $service['duration_minutes'],
        ];
    }

    /**
     * @param  array{service_id: string, resource_id: string, starts_at: string, ends_at: string}  $slot
     * @return array{service_id: string, resource_id: string, starts_at: string, ends_at: string}
     */
    public static function slot(array $slot): array
    {
        return [
            'service_id' => $slot['service_id'],
            'resource_id' => $slot['resource_id'],
            'starts_at' => $slot['starts_at'],
            'ends_at' => $slot['ends_at'],
        ];
    }

    /**
     * @param  array{public_reference: string, status: string, service_id: string, requested_starts_at: string, requested_ends_at: string}  $receipt
     * @return array{public_reference: string, status: string, service_id: string, requested_starts_at: string, requested_ends_at: string}
     */
    public static function receipt(array $receipt): array
    {
        return [
            'public_reference' => $receipt['public_reference'],
            'status' => $receipt['status'],
            'service_id' => $receipt['service_id'],
            'requested_starts_at' => $receipt['requested_starts_at'],
            'requested_ends_at' => $receipt['requested_ends_at'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function syncState(stdClass $row): array
    {
        return CalendarReconciliation::presentState($row);
    }

    /**
     * @return array<string, mixed>
     */
    public static function adminItem(stdClass $row): array
    {
        return PublicBooking::presentAdminItem($row);
    }
}

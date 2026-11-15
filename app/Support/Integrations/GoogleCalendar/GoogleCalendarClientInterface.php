<?php

namespace App\Support\Integrations\GoogleCalendar;

/**
 * Contrat d'accès à l'API Google Calendar. Toutes les opérations HTTP/IO restent confinées sous
 * `app/Support/Integrations/*` ; aucun appel clinique ou note médicale n'y transite jamais.
 */
interface GoogleCalendarClientInterface
{
    /**
     * Liste les événements (synchronisation complète sur fenêtre ou incrémentale via `syncToken`).
     *
     * @param  array{
     *     id?: string,
     *     external_account_id: string,
     *     status?: string,
     *     credentials?: array<string, mixed>|null,
     *     public_configuration?: array<string, mixed>|null
     * }  $account
     * @return array{
     *     ok: bool,
     *     sync_token_expired?: bool,
     *     error_code?: string|null,
     *     next_sync_token?: string|null,
     *     events: list<array{
     *         external_event_id: string,
     *         status: 'confirmed'|'cancelled',
     *         etag: string|null,
     *         summary: string|null,
     *         starts_at: string|null,
     *         ends_at: string|null,
     *         is_clinic_mirror: bool,
     *         appointment_id: string|null
     *     }>
     * }
     */
    public function listEvents(
        array $account,
        string $calendarId,
        ?string $syncToken = null,
        ?string $timeMinIso = null,
        ?string $timeMaxIso = null,
    ): array;

    /**
     * Crée ou met à jour un événement strictement assaini sur Google Calendar.
     *
     * @param  array{
     *     id?: string,
     *     external_account_id: string,
     *     status?: string,
     *     credentials?: array<string, mixed>|null,
     *     public_configuration?: array<string, mixed>|null
     * }  $account
     * @param  array{
     *     appointment_id: string,
     *     reference: string,
     *     summary: string,
     *     starts_at: string,
     *     ends_at: string,
     *     timezone: string
     * }  $sanitizedEvent
     * @return array{
     *     ok: bool,
     *     external_event_id: string|null,
     *     etag: string|null,
     *     error_code?: string|null
     * }
     */
    public function upsertEvent(
        array $account,
        string $calendarId,
        array $sanitizedEvent,
        ?string $externalEventId = null,
    ): array;

    /**
     * Supprime ou annule un événement miroir sur Google Calendar.
     *
     * @param  array{
     *     id?: string,
     *     external_account_id: string,
     *     status?: string,
     *     credentials?: array<string, mixed>|null,
     *     public_configuration?: array<string, mixed>|null
     * }  $account
     * @return array{
     *     ok: bool,
     *     error_code?: string|null
     * }
     */
    public function deleteEvent(
        array $account,
        string $calendarId,
        string $externalEventId,
    ): array;
}

<?php

namespace App\Support\Integrations\GoogleCalendar;

/**
 * Adaptateur Google Calendar déterministe en mémoire pour le mode `fake` (`EEO_INTEGRATIONS_MODE=fake`).
 * Aucun appel réseau sortant : génère des jetons incrémentaux déterministes, conserve les événements
 * poussés et accepte l'injection d'événements distants ou de pannes pour les tests.
 */
final class FakeGoogleCalendarClient implements GoogleCalendarClientInterface
{
    /** @var array<string, int> */
    private array $syncSequences = [];

    /**
     * @var array<string, array<string, array{
     *     external_event_id: string,
     *     status: 'confirmed'|'cancelled',
     *     etag: string|null,
     *     summary: string|null,
     *     starts_at: string|null,
     *     ends_at: string|null,
     *     is_clinic_mirror: bool,
     *     appointment_id: string|null,
     *     changed_after_seq: int
     * }>>
     */
    private array $eventsByCalendar = [];

    /** @var array<string, array{appointment_id: string, reference: string, summary: string, starts_at: string, ends_at: string, timezone: string, external_event_id: string}> */
    private array $pushedPayloads = [];

    /** @var array<string, bool> */
    private array $expiredTokens = [];

    /** @var array<string, string> */
    private array $forcedErrors = [];

    public function reset(): void
    {
        $this->syncSequences = [];
        $this->eventsByCalendar = [];
        $this->pushedPayloads = [];
        $this->expiredTokens = [];
        $this->forcedErrors = [];
    }

    /**
     * Injecte un événement Google distant (occupé externe ou miroir modifié) pour les tests.
     *
     * @param  array{
     *     external_event_id: string,
     *     status?: 'confirmed'|'cancelled',
     *     etag?: string|null,
     *     summary?: string|null,
     *     starts_at?: string|null,
     *     ends_at?: string|null,
     *     is_clinic_mirror?: bool,
     *     appointment_id?: string|null
     * }  $event
     */
    public function seedRemoteEvent(string $calendarId, array $event): void
    {
        $currentSeq = $this->syncSequences[$calendarId] ?? 0;
        $nextChangeSeq = $currentSeq + 1;
        $id = $event['external_event_id'];

        $this->eventsByCalendar[$calendarId][$id] = [
            'external_event_id' => $id,
            'status' => ($event['status'] ?? 'confirmed') === 'cancelled' ? 'cancelled' : 'confirmed',
            'etag' => $event['etag'] ?? '"fake-etag-'.substr(sha1($calendarId.':'.$id.':'.$nextChangeSeq), 0, 12).'"',
            'summary' => $event['summary'] ?? 'Événement Google',
            'starts_at' => $event['starts_at'] ?? null,
            'ends_at' => $event['ends_at'] ?? null,
            'is_clinic_mirror' => (bool) ($event['is_clinic_mirror'] ?? false),
            'appointment_id' => $event['appointment_id'] ?? null,
            'changed_after_seq' => $nextChangeSeq,
        ];
    }

    public function expireSyncTokenFor(string $calendarId): void
    {
        $this->expiredTokens[$calendarId] = true;
    }

    public function failNextSyncFor(string $calendarId, string $errorCode = 'GOOGLE_UNAVAILABLE'): void
    {
        $this->forcedErrors[$calendarId] = $errorCode;
    }

    /**
     * @return list<array{appointment_id: string, reference: string, summary: string, starts_at: string, ends_at: string, timezone: string, external_event_id: string}>
     */
    public function pushedEvents(?string $calendarId = null): array
    {
        if ($calendarId === null) {
            return array_values($this->pushedPayloads);
        }

        $matching = [];
        foreach ($this->pushedPayloads as $key => $payload) {
            if (str_starts_with($key, $calendarId.'::')) {
                $matching[] = $payload;
            }
        }

        return $matching;
    }

    public function listEvents(
        array $account,
        string $calendarId,
        ?string $syncToken = null,
        ?string $timeMinIso = null,
        ?string $timeMaxIso = null,
    ): array {
        if (isset($this->forcedErrors[$calendarId])) {
            $code = $this->forcedErrors[$calendarId];
            unset($this->forcedErrors[$calendarId]);

            return [
                'ok' => false,
                'error_code' => $code,
                'events' => [],
            ];
        }

        if (($account['status'] ?? 'ACTIVE') === 'ERROR') {
            return [
                'ok' => false,
                'error_code' => 'ACCOUNT_IN_ERROR',
                'events' => [],
            ];
        }

        if ($syncToken !== null && isset($this->expiredTokens[$calendarId])) {
            unset($this->expiredTokens[$calendarId]);

            return [
                'ok' => false,
                'sync_token_expired' => true,
                'error_code' => 'SYNC_TOKEN_EXPIRED',
                'events' => [],
            ];
        }

        // Support facultatif d'événements fictifs définis dans `public_configuration.fake_events`.
        $configEvents = $account['public_configuration']['fake_events'] ?? null;
        if (is_array($configEvents)) {
            foreach ($configEvents as $rawEvent) {
                if (is_array($rawEvent) && is_string($rawEvent['external_event_id'] ?? null) && ! isset($this->eventsByCalendar[$calendarId][$rawEvent['external_event_id']])) {
                    $this->seedRemoteEvent($calendarId, $rawEvent);
                }
            }
        }

        $sinceSeq = $syncToken !== null ? $this->parseTokenSequence($calendarId, $syncToken) : null;
        if ($syncToken !== null && $sinceSeq === null) {
            return [
                'ok' => false,
                'sync_token_expired' => true,
                'error_code' => 'SYNC_TOKEN_EXPIRED',
                'events' => [],
            ];
        }

        $nextSeq = ($this->syncSequences[$calendarId] ?? 0) + 1;
        $this->syncSequences[$calendarId] = $nextSeq;
        $nextToken = $this->formatToken($calendarId, $nextSeq);

        $events = [];
        foreach ($this->eventsByCalendar[$calendarId] ?? [] as $item) {
            if ($sinceSeq !== null && $item['changed_after_seq'] <= $sinceSeq) {
                continue;
            }
            if ($sinceSeq === null && $item['status'] === 'cancelled') {
                continue;
            }
            if ($sinceSeq === null && $timeMinIso !== null && $item['ends_at'] !== null && $item['ends_at'] <= $timeMinIso) {
                continue;
            }
            if ($sinceSeq === null && $timeMaxIso !== null && $item['starts_at'] !== null && $item['starts_at'] >= $timeMaxIso) {
                continue;
            }

            $events[] = [
                'external_event_id' => $item['external_event_id'],
                'status' => $item['status'],
                'etag' => $item['etag'],
                'summary' => $item['summary'],
                'starts_at' => $item['starts_at'],
                'ends_at' => $item['ends_at'],
                'is_clinic_mirror' => $item['is_clinic_mirror'],
                'appointment_id' => $item['appointment_id'],
            ];
        }

        return [
            'ok' => true,
            'sync_token_expired' => false,
            'error_code' => null,
            'next_sync_token' => $nextToken,
            'events' => $events,
        ];
    }

    public function upsertEvent(
        array $account,
        string $calendarId,
        array $sanitizedEvent,
        ?string $externalEventId = null,
    ): array {
        if (isset($this->forcedErrors[$calendarId])) {
            $code = $this->forcedErrors[$calendarId];
            unset($this->forcedErrors[$calendarId]);

            return [
                'ok' => false,
                'external_event_id' => $externalEventId,
                'etag' => null,
                'error_code' => $code,
            ];
        }

        $appointmentId = $sanitizedEvent['appointment_id'];
        $id = $externalEventId ?? 'gcal-evt-'.strtolower(substr(sha1($calendarId.':'.$appointmentId), 0, 16));
        $seq = ($this->syncSequences[$calendarId] ?? 0) + 1;
        $etag = '"fake-etag-'.substr(sha1($id.':'.$sanitizedEvent['starts_at'].':'.$sanitizedEvent['ends_at']), 0, 12).'"';

        $this->eventsByCalendar[$calendarId][$id] = [
            'external_event_id' => $id,
            'status' => 'confirmed',
            'etag' => $etag,
            'summary' => $sanitizedEvent['summary'],
            'starts_at' => $sanitizedEvent['starts_at'],
            'ends_at' => $sanitizedEvent['ends_at'],
            'is_clinic_mirror' => true,
            'appointment_id' => $appointmentId,
            'changed_after_seq' => $seq,
        ];

        $this->pushedPayloads[$calendarId.'::'.$id] = $sanitizedEvent + ['external_event_id' => $id];

        return [
            'ok' => true,
            'external_event_id' => $id,
            'etag' => $etag,
            'error_code' => null,
        ];
    }

    public function deleteEvent(
        array $account,
        string $calendarId,
        string $externalEventId,
    ): array {
        $seq = ($this->syncSequences[$calendarId] ?? 0) + 1;
        if (isset($this->eventsByCalendar[$calendarId][$externalEventId])) {
            $existing = $this->eventsByCalendar[$calendarId][$externalEventId];
            $existing['status'] = 'cancelled';
            $existing['changed_after_seq'] = $seq;
            $this->eventsByCalendar[$calendarId][$externalEventId] = $existing;
        }

        return [
            'ok' => true,
            'error_code' => null,
        ];
    }

    private function formatToken(string $calendarId, int $seq): string
    {
        return 'fake-sync-'.substr(sha1($calendarId), 0, 10).'-'.$seq;
    }

    private function parseTokenSequence(string $calendarId, string $token): ?int
    {
        $prefix = 'fake-sync-'.substr(sha1($calendarId), 0, 10).'-';
        if (! str_starts_with($token, $prefix)) {
            return null;
        }
        $raw = substr($token, strlen($prefix));
        if (! ctype_digit($raw)) {
            return null;
        }

        return (int) $raw;
    }
}

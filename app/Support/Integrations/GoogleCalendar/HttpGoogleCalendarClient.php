<?php

namespace App\Support\Integrations\GoogleCalendar;

use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Client HTTP Google Calendar v3 (mode `real`). Toutes les communications sortantes passent par Laravel Http
 * avec délai borné (`eeo.integrations.timeout_seconds`) et aucun contenu médical.
 */
final class HttpGoogleCalendarClient implements GoogleCalendarClientInterface
{
    private const BASE_URL = 'https://www.googleapis.com/calendar/v3';

    public function listEvents(
        array $account,
        string $calendarId,
        ?string $syncToken = null,
        ?string $timeMinIso = null,
        ?string $timeMaxIso = null,
    ): array {
        $token = $this->accessToken($account);
        if ($token === null) {
            return ['ok' => false, 'error_code' => 'MISSING_CREDENTIALS', 'events' => []];
        }

        $query = ['maxResults' => 250];
        if ($syncToken !== null && $syncToken !== '') {
            $query['syncToken'] = $syncToken;
        } else {
            $query['singleEvents'] = 'true';
            if ($timeMinIso !== null) {
                $query['timeMin'] = $timeMinIso;
            }
            if ($timeMaxIso !== null) {
                $query['timeMax'] = $timeMaxIso;
            }
        }

        try {
            $response = Http::withToken($token)
                ->acceptJson()
                ->timeout($this->timeoutSeconds())
                ->get(self::BASE_URL.'/calendars/'.rawurlencode($calendarId).'/events', $query);
        } catch (ConnectionException) {
            return ['ok' => false, 'error_code' => 'GOOGLE_TIMEOUT', 'events' => []];
        }

        if ($response->status() === 410) {
            return [
                'ok' => false,
                'sync_token_expired' => true,
                'error_code' => 'SYNC_TOKEN_EXPIRED',
                'events' => [],
            ];
        }

        if (! $response->successful()) {
            return [
                'ok' => false,
                'error_code' => 'GOOGLE_HTTP_'.$response->status(),
                'events' => [],
            ];
        }

        /** @var array<string, mixed> $body */
        $body = $response->json() ?? [];
        $items = is_array($body['items'] ?? null) ? $body['items'] : [];
        $events = [];

        foreach ($items as $item) {
            if (! is_array($item) || ! is_string($item['id'] ?? null)) {
                continue;
            }
            $privateProps = is_array($item['extendedProperties']['private'] ?? null)
                ? $item['extendedProperties']['private']
                : [];
            $appointmentId = is_string($privateProps['eeo_appointment_id'] ?? null)
                ? $privateProps['eeo_appointment_id']
                : null;

            $events[] = [
                'external_event_id' => $item['id'],
                'status' => ($item['status'] ?? 'confirmed') === 'cancelled' ? 'cancelled' : 'confirmed',
                'etag' => is_string($item['etag'] ?? null) ? $item['etag'] : null,
                'summary' => is_string($item['summary'] ?? null) ? $item['summary'] : null,
                'starts_at' => $this->normalizeGoogleTime(is_array($item['start'] ?? null) ? $item['start'] : []),
                'ends_at' => $this->normalizeGoogleTime(is_array($item['end'] ?? null) ? $item['end'] : []),
                'is_clinic_mirror' => $appointmentId !== null || ($privateProps['eeo_origin'] ?? null) === 'EEO',
                'appointment_id' => $appointmentId,
            ];
        }

        return [
            'ok' => true,
            'sync_token_expired' => false,
            'error_code' => null,
            'next_sync_token' => is_string($body['nextSyncToken'] ?? null) ? $body['nextSyncToken'] : null,
            'events' => $events,
        ];
    }

    public function upsertEvent(
        array $account,
        string $calendarId,
        array $sanitizedEvent,
        ?string $externalEventId = null,
    ): array {
        $token = $this->accessToken($account);
        if ($token === null) {
            return ['ok' => false, 'external_event_id' => $externalEventId, 'etag' => null, 'error_code' => 'MISSING_CREDENTIALS'];
        }

        $body = [
            'summary' => $sanitizedEvent['summary'],
            'start' => [
                'dateTime' => $sanitizedEvent['starts_at'],
                'timeZone' => $sanitizedEvent['timezone'],
            ],
            'end' => [
                'dateTime' => $sanitizedEvent['ends_at'],
                'timeZone' => $sanitizedEvent['timezone'],
            ],
            'extendedProperties' => [
                'private' => [
                    'eeo_origin' => 'EEO',
                    'eeo_appointment_id' => $sanitizedEvent['appointment_id'],
                    'eeo_reference' => $sanitizedEvent['reference'],
                ],
            ],
        ];

        $url = self::BASE_URL.'/calendars/'.rawurlencode($calendarId).'/events';
        try {
            $client = Http::withToken($token)->acceptJson()->timeout($this->timeoutSeconds());
            $response = $externalEventId !== null
                ? $client->put($url.'/'.rawurlencode($externalEventId), $body)
                : $client->post($url, $body);
        } catch (ConnectionException) {
            return ['ok' => false, 'external_event_id' => $externalEventId, 'etag' => null, 'error_code' => 'GOOGLE_TIMEOUT'];
        }

        if (! $response->successful()) {
            return [
                'ok' => false,
                'external_event_id' => $externalEventId,
                'etag' => null,
                'error_code' => 'GOOGLE_HTTP_'.$response->status(),
            ];
        }

        /** @var array<string, mixed> $json */
        $json = $response->json() ?? [];

        return [
            'ok' => true,
            'external_event_id' => is_string($json['id'] ?? null) ? $json['id'] : $externalEventId,
            'etag' => is_string($json['etag'] ?? null) ? $json['etag'] : null,
            'error_code' => null,
        ];
    }

    public function deleteEvent(
        array $account,
        string $calendarId,
        string $externalEventId,
    ): array {
        $token = $this->accessToken($account);
        if ($token === null) {
            return ['ok' => false, 'error_code' => 'MISSING_CREDENTIALS'];
        }

        $url = self::BASE_URL.'/calendars/'.rawurlencode($calendarId).'/events/'.rawurlencode($externalEventId);
        try {
            $response = Http::withToken($token)->acceptJson()->timeout($this->timeoutSeconds())->delete($url);
        } catch (ConnectionException) {
            return ['ok' => false, 'error_code' => 'GOOGLE_TIMEOUT'];
        }

        if (in_array($response->status(), [200, 204, 404, 410], true)) {
            return ['ok' => true, 'error_code' => null];
        }

        return ['ok' => false, 'error_code' => 'GOOGLE_HTTP_'.$response->status()];
    }

    /**
     * @param  array<string, mixed>  $account
     */
    private function accessToken(array $account): ?string
    {
        $credentials = $account['credentials'] ?? null;
        if (! is_array($credentials)) {
            return null;
        }
        $token = $credentials['access_token'] ?? $credentials['token'] ?? null;

        return is_string($token) && trim($token) !== '' ? trim($token) : null;
    }

    /**
     * @param  array<string, mixed>  $slot
     */
    private function normalizeGoogleTime(array $slot): ?string
    {
        $raw = $slot['dateTime'] ?? $slot['date'] ?? null;
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        return CarbonImmutable::parse($raw)->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    private function timeoutSeconds(): int
    {
        $seconds = (int) config('eeo.integrations.timeout_seconds', 10);

        return max(1, min(30, $seconds));
    }
}

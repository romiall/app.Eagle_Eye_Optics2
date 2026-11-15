<?php

namespace App\Support\Integrations\Kommo;

use App\Domain\Shared\BusinessError;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Client HTTP Kommo CRM v4 (mode `live`) : toutes les requêtes HTTP externes sont cantonnées dans cette classe.
 * Ne transporte jamais de données médicales : uniquement l'identité administrative, le pipeline et le budget.
 */
final class HttpKommoClient implements KommoClientInterface
{
    public function fetchLeads(array $accountConfig, int $limit = 50): array
    {
        [$baseUrl, $token, $timeout] = $this->connection($accountConfig);
        $limit = max(1, min(200, $limit));

        try {
            $response = Http::baseUrl($baseUrl)
                ->withToken($token)
                ->timeout($timeout)
                ->acceptJson()
                ->get('/api/v4/leads', [
                    'limit' => $limit,
                    'with' => 'contacts',
                ]);
        } catch (ConnectionException $exception) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM est injoignable pour le moment.', 503, [], $exception);
        }

        if (! $response->successful()) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM a renvoyé une erreur lors de la lecture des pistes.', 503);
        }

        $body = $response->json();
        $embedded = is_array($body['_embedded'] ?? null) ? $body['_embedded'] : [];
        $rawLeads = is_array($embedded['leads'] ?? null) ? $embedded['leads'] : [];

        $out = [];
        foreach ($rawLeads as $lead) {
            if (! is_array($lead) || ! isset($lead['id'])) {
                continue;
            }
            $extLeadId = (string) $lead['id'];
            $contacts = is_array($lead['_embedded']['contacts'] ?? null) ? $lead['_embedded']['contacts'] : [];
            $primary = is_array($contacts[0] ?? null) ? $contacts[0] : [];

            $price = isset($lead['price']) && is_numeric($lead['price']) ? max(0, (int) $lead['price']) : null;
            $status = $this->mapRemoteStatus($lead['status_id'] ?? null);

            $out[] = [
                'external_lead_id' => $extLeadId,
                'external_conversation_id' => isset($lead['external_conversation_id'])
                    ? (string) $lead['external_conversation_id']
                    : 'kommo-conv-'.$extLeadId,
                'channel' => $this->mapChannel($lead['source'] ?? null),
                'prospect' => [
                    'external_contact_id' => isset($primary['id']) ? (string) $primary['id'] : null,
                    'name' => mb_substr((string) ($primary['name'] ?? ($lead['name'] ?? 'Prospect Kommo #'.$extLeadId)), 0, 180),
                    'phone' => isset($primary['phone']) && is_string($primary['phone']) ? mb_substr($primary['phone'], 0, 32) : null,
                    'email' => isset($primary['email']) && is_string($primary['email']) ? mb_substr($primary['email'], 0, 254) : null,
                ],
                'pipeline_id' => isset($lead['pipeline_id']) ? (string) $lead['pipeline_id'] : null,
                'pipeline_stage' => isset($lead['status_id']) ? (string) $lead['status_id'] : 'OPEN',
                'product_interest' => isset($lead['name']) && is_string($lead['name']) ? mb_substr($lead['name'], 0, 2000) : null,
                'budget_min' => $price,
                'budget_max' => $price,
                'acquisition_source' => isset($lead['source']) && is_string($lead['source']) ? mb_substr($lead['source'], 0, 100) : 'KOMMO',
                'status' => $status,
                'etag' => isset($lead['updated_at']) ? (string) $lead['updated_at'] : null,
            ];
        }

        return $out;
    }

    public function pushBookingStatus(
        array $accountConfig,
        string $externalLeadId,
        string $status,
        ?string $pipelineStage = null,
        ?string $note = null,
    ): array {
        [$baseUrl, $token, $timeout] = $this->connection($accountConfig);

        $payload = [
            'status_label' => mb_substr($status, 0, 40),
        ];
        if ($pipelineStage !== null && $pipelineStage !== '') {
            $payload['pipeline_stage'] = mb_substr($pipelineStage, 0, 100);
        }

        try {
            $response = Http::baseUrl($baseUrl)
                ->withToken($token)
                ->timeout($timeout)
                ->acceptJson()
                ->patch('/api/v4/leads/'.rawurlencode($externalLeadId), $payload);
        } catch (ConnectionException $exception) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM est injoignable lors de la mise à jour de la piste.', 503, [], $exception);
        }

        if (! $response->successful()) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM a refusé la mise à jour administrative de la piste.', 503);
        }

        if ($note !== null && $note !== '') {
            $this->addAdministrativeNote($accountConfig, $externalLeadId, $note);
        }

        $etagHeader = $response->header('ETag');

        return [
            'external_lead_id' => $externalLeadId,
            'etag' => $etagHeader !== '' ? $etagHeader : null,
            'synced' => true,
        ];
    }

    public function addAdministrativeNote(array $accountConfig, string $externalLeadId, string $note): array
    {
        [$baseUrl, $token, $timeout] = $this->connection($accountConfig);

        try {
            $response = Http::baseUrl($baseUrl)
                ->withToken($token)
                ->timeout($timeout)
                ->acceptJson()
                ->post('/api/v4/leads/'.rawurlencode($externalLeadId).'/notes', [
                    [
                        'note_type' => 'common',
                        'params' => [
                            'text' => mb_substr($note, 0, 2000),
                        ],
                    ],
                ]);
        } catch (ConnectionException $exception) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM est injoignable lors de l\'ajout de la note administrative.', 503, [], $exception);
        }

        if (! $response->successful()) {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Kommo CRM a refusé l\'ajout de la note administrative.', 503);
        }

        $json = $response->json();
        $first = is_array($json['_embedded']['notes'][0] ?? null) ? $json['_embedded']['notes'][0] : [];

        return [
            'external_note_id' => isset($first['id']) ? (string) $first['id'] : 'kommo-note',
            'synced' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $accountConfig
     * @return array{0: string, 1: string, 2: int}
     */
    private function connection(array $accountConfig): array
    {
        $subdomain = is_string($accountConfig['subdomain'] ?? null) && $accountConfig['subdomain'] !== ''
            ? $accountConfig['subdomain']
            : (string) config('eeo.integrations.kommo.subdomain', '');
        $token = is_string($accountConfig['access_token'] ?? null) ? $accountConfig['access_token'] : '';

        if ($subdomain === '' || $token === '') {
            throw new BusinessError('INTEGRATION_UNAVAILABLE', 'Configuration Kommo CRM incomplète (sous-domaine ou jeton absent).', 503);
        }

        $baseUrl = str_starts_with($subdomain, 'http://') || str_starts_with($subdomain, 'https://')
            ? rtrim($subdomain, '/')
            : 'https://'.preg_replace('/[^A-Za-z0-9.-]/', '', $subdomain).'.kommo.com';

        $timeout = max(1, (int) config('eeo.integrations.timeout_seconds', 10));

        return [$baseUrl, $token, $timeout];
    }

    private function mapRemoteStatus(mixed $statusId): string
    {
        return match ((string) $statusId) {
            '142', 'WON' => 'WON',
            '143', 'LOST' => 'LOST',
            'CLOSED' => 'CLOSED',
            'APPOINTMENT_BOOKED' => 'APPOINTMENT_BOOKED',
            'HUMAN_TAKEOVER' => 'HUMAN_TAKEOVER',
            default => 'OPEN',
        };
    }

    private function mapChannel(mixed $source): string
    {
        $normalized = strtoupper((string) $source);

        return match ($normalized) {
            'MESSENGER', 'INSTAGRAM', 'WHATSAPP' => $normalized,
            default => 'WHATSAPP',
        };
    }
}

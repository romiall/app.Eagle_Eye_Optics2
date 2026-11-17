<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Client HTTP réel pour l'envoi via Meta WhatsApp Cloud API, passerelle SMS ou relais SMTP/HTTP.
 * Toutes les sorties réseau restent strictement isolées dans `app/Support/Integrations/*`.
 */
final class HttpMessagingClient implements MessagingClientInterface
{
    /**
     * @param  array<string, mixed>  $accountConfig
     */
    public function __construct(
        private readonly string $externalAccountId,
        private readonly ?string $apiToken,
        private readonly array $accountConfig = [],
    ) {}

    public function send(
        string $channel,
        string $destination,
        string $body,
        ?string $providerTemplateId = null,
        array $variables = [],
        ?string $dedupeKey = null,
    ): ProviderDeliveryStatus {
        $now = CarbonImmutable::now('UTC');
        $timeout = config('eeo.integrations.timeout_seconds', 10);
        $timeoutSeconds = is_int($timeout) && $timeout > 0 ? $timeout : 10;

        $endpoint = $this->resolveEndpoint($channel);
        if ($endpoint === '') {
            return new ProviderDeliveryStatus(
                status: 'FAILED',
                providerMessageId: null,
                errorCode: 'PROVIDER_ENDPOINT_MISSING',
                submittedAt: $now,
            );
        }

        $payload = match ($channel) {
            'WHATSAPP' => $this->whatsAppPayload($destination, $body, $providerTemplateId, $variables),
            'SMS' => [
                'to' => $destination,
                'sender_id' => $this->stringOption('sender_id', config('eeo.integrations.sms.sender_id')),
                'text' => $body,
                'dedupe_key' => $dedupeKey,
            ],
            default => [
                'to' => $destination,
                'body' => $body,
                'template_id' => $providerTemplateId,
                'variables' => $variables,
                'dedupe_key' => $dedupeKey,
            ],
        };

        try {
            $request = Http::timeout($timeoutSeconds)->acceptJson();
            if ($this->apiToken !== null && $this->apiToken !== '') {
                $request = $request->withToken($this->apiToken);
            }
            $response = $request->post($endpoint, $payload);

            if (! $response->successful()) {
                return new ProviderDeliveryStatus(
                    status: 'FAILED',
                    providerMessageId: null,
                    errorCode: 'PROVIDER_HTTP_'.$response->status(),
                    submittedAt: $now,
                );
            }

            /** @var mixed $json */
            $json = $response->json();
            $providerMessageId = null;
            if (is_array($json)) {
                $id = $json['messages'][0]['id'] ?? ($json['message_id'] ?? ($json['id'] ?? null));
                if (is_string($id) && $id !== '') {
                    $providerMessageId = substr($id, 0, 180);
                }
            }

            return new ProviderDeliveryStatus(
                status: 'SUBMITTED',
                providerMessageId: $providerMessageId,
                errorCode: null,
                submittedAt: $now,
            );
        } catch (Throwable) {
            return new ProviderDeliveryStatus(
                status: 'FAILED',
                providerMessageId: null,
                errorCode: 'PROVIDER_UNREACHABLE',
                submittedAt: $now,
            );
        }
    }

    public function fetchStatus(string $channel, string $providerMessageId): ProviderDeliveryStatus
    {
        $statusUrl = $this->stringOption('status_url', null);
        if ($statusUrl === '') {
            return new ProviderDeliveryStatus(status: 'UNKNOWN', providerMessageId: $providerMessageId);
        }

        $timeout = config('eeo.integrations.timeout_seconds', 10);
        $timeoutSeconds = is_int($timeout) && $timeout > 0 ? $timeout : 10;

        try {
            $request = Http::timeout($timeoutSeconds)->acceptJson();
            if ($this->apiToken !== null && $this->apiToken !== '') {
                $request = $request->withToken($this->apiToken);
            }
            $response = $request->get(rtrim($statusUrl, '/').'/'.urlencode($providerMessageId));
            if (! $response->successful()) {
                return new ProviderDeliveryStatus(status: 'UNKNOWN', providerMessageId: $providerMessageId);
            }

            $json = $response->json();
            $rawStatus = is_array($json) && is_string($json['status'] ?? null) ? strtoupper($json['status']) : 'UNKNOWN';
            $mapped = match ($rawStatus) {
                'SENT', 'ACCEPTED', 'SUBMITTED', 'QUEUED' => 'SUBMITTED',
                'DELIVERED' => 'DELIVERED',
                'READ', 'SEEN' => 'READ',
                'FAILED', 'REJECTED', 'UNDELIVERED' => 'FAILED',
                default => 'UNKNOWN',
            };

            return new ProviderDeliveryStatus(
                status: $mapped,
                providerMessageId: $providerMessageId,
                errorCode: is_array($json) && is_string($json['error_code'] ?? null) ? substr($json['error_code'], 0, 100) : null,
            );
        } catch (Throwable) {
            return new ProviderDeliveryStatus(status: 'UNKNOWN', providerMessageId: $providerMessageId);
        }
    }

    /**
     * @param  array<string, string>  $variables
     * @return array<string, mixed>
     */
    private function whatsAppPayload(string $destination, string $body, ?string $providerTemplateId, array $variables): array
    {
        if ($providerTemplateId !== null && $providerTemplateId !== '') {
            $components = [];
            if ($variables !== []) {
                $parameters = [];
                foreach ($variables as $value) {
                    $parameters[] = ['type' => 'text', 'text' => $value];
                }
                $components[] = ['type' => 'body', 'parameters' => $parameters];
            }

            return [
                'messaging_product' => 'whatsapp',
                'to' => ltrim($destination, '+'),
                'type' => 'template',
                'template' => [
                    'name' => $providerTemplateId,
                    'language' => ['code' => $this->stringOption('language', 'fr')],
                    'components' => $components,
                ],
            ];
        }

        return [
            'messaging_product' => 'whatsapp',
            'to' => ltrim($destination, '+'),
            'type' => 'text',
            'text' => ['body' => $body],
        ];
    }

    private function resolveEndpoint(string $channel): string
    {
        $configured = $this->stringOption('endpoint_url', null);
        if ($configured !== '') {
            return $configured;
        }

        return match ($channel) {
            'WHATSAPP' => 'https://graph.facebook.com/v20.0/'.$this->externalAccountId.'/messages',
            'SMS' => $this->stringOption('sms_base_url', config('eeo.integrations.sms.base_url')),
            default => '',
        };
    }

    private function stringOption(string $key, mixed $fallback): string
    {
        $value = $this->accountConfig[$key] ?? $fallback;

        return is_string($value) ? trim($value) : '';
    }
}

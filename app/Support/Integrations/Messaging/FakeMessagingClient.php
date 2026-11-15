<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;

/**
 * Double déterministe pour le mode `fake` et la suite de tests (aucune sortie réseau).
 */
final class FakeMessagingClient implements MessagingClientInterface
{
    /** @var list<array{channel: string, destination: string, body: string, provider_template_id: ?string, variables: array<string, string>, dedupe_key: ?string, provider_message_id: ?string, status: string, error_code: ?string}> */
    private array $sent = [];

    /** @var array<string, ProviderDeliveryStatus> */
    private array $statuses = [];

    private ?string $nextFailureCode = null;

    /** @var array<string, string> */
    private array $failingDestinations = [];

    public function forceNextFailure(?string $errorCode): void
    {
        $this->nextFailureCode = $errorCode;
    }

    public function failDestination(string $normalizedDestination, string $errorCode): void
    {
        $this->failingDestinations[$normalizedDestination] = $errorCode;
    }

    public function setStatus(string $providerMessageId, ProviderDeliveryStatus $status): void
    {
        $this->statuses[$providerMessageId] = $status;
    }

    /**
     * @return list<array{channel: string, destination: string, body: string, provider_template_id: ?string, variables: array<string, string>, dedupe_key: ?string, provider_message_id: ?string, status: string, error_code: ?string}>
     */
    public function sent(): array
    {
        return $this->sent;
    }

    public function clear(): void
    {
        $this->sent = [];
        $this->statuses = [];
        $this->nextFailureCode = null;
        $this->failingDestinations = [];
    }

    public function send(
        string $channel,
        string $destination,
        string $body,
        ?string $providerTemplateId = null,
        array $variables = [],
        ?string $dedupeKey = null,
    ): ProviderDeliveryStatus {
        $now = CarbonImmutable::now('UTC');
        $forcedError = $this->nextFailureCode;
        $this->nextFailureCode = null;

        if ($forcedError === null && isset($this->failingDestinations[$destination])) {
            $forcedError = $this->failingDestinations[$destination];
        }

        if ($forcedError !== null) {
            $this->sent[] = [
                'channel' => $channel,
                'destination' => $destination,
                'body' => $body,
                'provider_template_id' => $providerTemplateId,
                'variables' => $variables,
                'dedupe_key' => $dedupeKey,
                'provider_message_id' => null,
                'status' => 'FAILED',
                'error_code' => $forcedError,
            ];

            return new ProviderDeliveryStatus(
                status: 'FAILED',
                providerMessageId: null,
                errorCode: $forcedError,
                submittedAt: $now,
            );
        }

        $providerMessageId = 'fake-'.strtolower($channel).'-'.Ulid::generate();
        $result = new ProviderDeliveryStatus(
            status: 'SUBMITTED',
            providerMessageId: $providerMessageId,
            errorCode: null,
            submittedAt: $now,
        );
        $this->statuses[$providerMessageId] = $result;
        $this->sent[] = [
            'channel' => $channel,
            'destination' => $destination,
            'body' => $body,
            'provider_template_id' => $providerTemplateId,
            'variables' => $variables,
            'dedupe_key' => $dedupeKey,
            'provider_message_id' => $providerMessageId,
            'status' => 'SUBMITTED',
            'error_code' => null,
        ];

        return $result;
    }

    public function fetchStatus(string $channel, string $providerMessageId): ProviderDeliveryStatus
    {
        return $this->statuses[$providerMessageId]
            ?? new ProviderDeliveryStatus(status: 'UNKNOWN', providerMessageId: $providerMessageId);
    }
}

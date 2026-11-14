<?php

namespace App\Support\Integrations\Contracts;

/**
 * Consommateur d'un webhook vérifié issu de `webhook_inbox` (Google Calendar, Kommo, Meta, SMS).
 */
interface WebhookConsumerInterface
{
    public function supports(string $provider): bool;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function handle(string $clinicId, string $accountId, string $provider, array $payload): void;
}

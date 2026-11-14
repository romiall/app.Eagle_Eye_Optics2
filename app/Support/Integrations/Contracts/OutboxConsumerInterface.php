<?php

namespace App\Support\Integrations\Contracts;

use stdClass;

/**
 * Consommateur d'événement interne issu de `outbox_events` (livraison au moins une fois, idempotent).
 */
interface OutboxConsumerInterface
{
    public function supports(string $eventType): bool;

    /**
     * Traite l'événement outbox décodé (jamais de donnée clinique dans la charge).
     *
     * @param  array<string, mixed>  $payload
     */
    public function handle(stdClass $outboxRow, array $payload): void;
}

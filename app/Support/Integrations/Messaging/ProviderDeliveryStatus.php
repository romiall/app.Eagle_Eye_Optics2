<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

use Carbon\CarbonImmutable;

/**
 * Résultat normalisé d'un envoi ou d'une interrogation de statut auprès d'un fournisseur de messagerie.
 */
final readonly class ProviderDeliveryStatus
{
    public function __construct(
        public string $status,
        public ?string $providerMessageId = null,
        public ?string $errorCode = null,
        public ?CarbonImmutable $submittedAt = null,
        public ?CarbonImmutable $deliveredAt = null,
        public ?CarbonImmutable $readAt = null,
    ) {}
}

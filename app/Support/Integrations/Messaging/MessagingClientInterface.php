<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

/**
 * Contrat d'adaptateur d'envoi de messages (SMS, WhatsApp, E-mail) hors du domaine métier.
 */
interface MessagingClientInterface
{
    /**
     * @param  array<string, string>  $variables
     */
    public function send(
        string $channel,
        string $destination,
        string $body,
        ?string $providerTemplateId = null,
        array $variables = [],
        ?string $dedupeKey = null,
    ): ProviderDeliveryStatus;

    public function fetchStatus(string $channel, string $providerMessageId): ProviderDeliveryStatus;
}

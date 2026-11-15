<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

use stdClass;

/**
 * Fabrique de clients de messagerie : renvoie le double `FakeMessagingClient` en mode `fake` ou pour un
 * compte en statut `TEST`, et un client HTTP configuré pour les comptes `ACTIVE` en mode réel.
 */
final class MessagingClientFactory
{
    public function __construct(
        private readonly FakeMessagingClient $fakeClient,
        private readonly DestinationCipher $cipher,
    ) {}

    public function forAccount(stdClass $integrationAccount): MessagingClientInterface
    {
        $mode = config('eeo.integrations.mode', 'fake');
        if ($mode !== 'live' || ((string) $integrationAccount->status) === 'TEST') {
            return $this->fakeClient;
        }

        $publicConfig = [];
        if (is_string($integrationAccount->public_configuration ?? null)) {
            $decoded = json_decode($integrationAccount->public_configuration, true);
            if (is_array($decoded)) {
                $publicConfig = $decoded;
            }
        }

        $token = null;
        if (is_string($integrationAccount->credentials_ciphertext ?? null) && $integrationAccount->credentials_ciphertext !== '') {
            $raw = $this->cipher->decrypt($integrationAccount->credentials_ciphertext);
            $decodedCreds = json_decode($raw, true);
            if (is_array($decodedCreds)) {
                $candidate = $decodedCreds['access_token'] ?? ($decodedCreds['api_token'] ?? ($decodedCreds['token'] ?? null));
                $token = is_string($candidate) && $candidate !== '' ? $candidate : null;
            } else {
                $token = $raw;
            }
        }

        return new HttpMessagingClient(
            externalAccountId: (string) $integrationAccount->external_account_id,
            apiToken: $token,
            accountConfig: $publicConfig,
        );
    }

    public function fake(): FakeMessagingClient
    {
        return $this->fakeClient;
    }
}

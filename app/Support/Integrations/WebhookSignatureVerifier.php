<?php

namespace App\Support\Integrations;

use App\Domain\Shared\BusinessError;

/**
 * Vérification des signatures et limites de charge des webhooks entrants par fournisseur.
 * Rejette systématiquement les signatures absentes ou erronées avec 403 ACTION_FORBIDDEN
 * et les charges utiles excessives avec 413 PAYLOAD_TOO_LARGE.
 */
final class WebhookSignatureVerifier
{
    public function __construct(
        private readonly IntegrationMode $mode,
    ) {}

    public function assertWithinMaxBytes(string $rawBody): void
    {
        $maxBytes = $this->mode->webhookMaxBytes();
        if (strlen($rawBody) > $maxBytes) {
            throw new BusinessError(
                'PAYLOAD_TOO_LARGE',
                'La charge utile du webhook dépasse la taille maximale autorisée.',
                413,
                details: ['max_bytes' => $maxBytes],
            );
        }
    }

    /**
     * Vérifie la signature ou le jeton secret d'un webhook entrant contre les identifiants
     * déchiffrés du compte d'intégration ciblé.
     *
     * @param  array<string, string|list<string>|null>  $headers
     * @param  array<string, mixed>  $accountCredentials
     */
    public function verifyIncoming(
        string $providerChannel,
        string $rawBody,
        array $headers,
        array $accountCredentials,
    ): void {
        $this->assertWithinMaxBytes($rawBody);

        $channel = $this->normalizeChannel($providerChannel);
        $normalizedHeaders = self::normalizeHeaders($headers);
        $secret = $this->extractSigningSecret($channel, $accountCredentials);

        if ($secret === null) {
            throw $this->forbiddenError($channel);
        }

        $verified = match ($channel) {
            'meta' => $this->verifyMetaHmac($rawBody, $normalizedHeaders, $secret),
            'google' => $this->verifyGoogleToken($normalizedHeaders, $secret),
            'kommo' => $this->verifyKommo($rawBody, $normalizedHeaders, $secret),
            'sms' => $this->verifyHmacHeader($rawBody, $normalizedHeaders['x-signature'] ?? null, $secret),
            default => false,
        };

        if (! $verified && $this->mode->isFake()) {
            $verified = $this->verifyFakeTestSignature($normalizedHeaders, $secret);
        }

        if (! $verified) {
            throw $this->forbiddenError($channel);
        }
    }

    /**
     * Vérifie le challenge GET hub.verify_token de Meta contre le secret configuré du compte.
     *
     * @param  array<string, mixed>  $accountCredentials
     */
    public function verifyMetaChallengeToken(string $providedToken, array $accountCredentials): bool
    {
        $trimmed = trim($providedToken);
        if ($trimmed === '') {
            return false;
        }

        foreach (['verify_token', 'webhook_secret', 'secret'] as $key) {
            $expected = $accountCredentials[$key] ?? null;
            if (is_string($expected) && trim($expected) !== '' && hash_equals(trim($expected), $trimmed)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeChannel(string $providerOrChannel): string
    {
        $lower = strtolower(trim($providerOrChannel));
        if (in_array($lower, ['meta', 'google', 'kommo', 'sms'], true)) {
            return $lower;
        }

        return $this->mode->webhookChannelForProvider($providerOrChannel);
    }

    /**
     * @param  array<string, string|list<string>|null>  $headers
     * @return array<string, string>
     */
    public static function normalizeHeaders(array $headers): array
    {
        $normalized = [];

        foreach ($headers as $name => $value) {
            $key = strtolower(trim((string) $name));
            if (is_array($value)) {
                $first = $value[0] ?? null;
                $normalized[$key] = is_string($first) ? trim($first) : '';
            } elseif (is_string($value)) {
                $normalized[$key] = trim($value);
            }
        }

        return $normalized;
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    private function extractSigningSecret(string $channel, array $credentials): ?string
    {
        $candidateKeys = match ($channel) {
            'meta' => ['app_secret', 'webhook_secret', 'secret'],
            'google' => ['webhook_token', 'channel_token', 'webhook_secret', 'secret'],
            'kommo' => ['webhook_secret', 'client_secret', 'secret'],
            'sms' => ['webhook_secret', 'api_secret', 'secret', 'api_key'],
            default => [],
        };

        foreach ($candidateKeys as $key) {
            $value = $credentials[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function verifyMetaHmac(string $rawBody, array $headers, string $secret): bool
    {
        $provided = $headers['x-hub-signature-256'] ?? '';
        if ($provided === '' || ! str_starts_with(strtolower($provided), 'sha256=')) {
            return false;
        }

        $expected = 'sha256='.hash_hmac('sha256', $rawBody, $secret);

        return hash_equals($expected, strtolower($provided));
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function verifyGoogleToken(array $headers, string $secret): bool
    {
        $provided = $headers['x-goog-channel-token'] ?? '';
        if ($provided === '') {
            return false;
        }

        return hash_equals($secret, $provided);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function verifyKommo(string $rawBody, array $headers, string $secret): bool
    {
        $signature = $headers['x-kommo-signature'] ?? null;
        if ($signature !== null && $signature !== '') {
            return $this->verifyHmacHeader($rawBody, $signature, $secret);
        }

        $sharedSecret = $headers['x-kommo-secret'] ?? ($headers['x-webhook-secret'] ?? null);
        if ($sharedSecret !== null && $sharedSecret !== '') {
            return hash_equals($secret, $sharedSecret);
        }

        return false;
    }

    private function verifyHmacHeader(string $rawBody, ?string $providedHeader, string $secret): bool
    {
        if ($providedHeader === null || $providedHeader === '') {
            return false;
        }

        $digest = hash_hmac('sha256', $rawBody, $secret);
        $lower = strtolower($providedHeader);

        if (str_starts_with($lower, 'sha256=')) {
            return hash_equals('sha256='.$digest, $lower);
        }

        return hash_equals($digest, $lower);
    }

    /**
     * En mode fake uniquement, accepte un en-tête de signature de test explicite
     * uniquement s'il correspond au secret configuré sur le compte d'intégration.
     *
     * @param  array<string, string>  $headers
     */
    private function verifyFakeTestSignature(array $headers, string $secret): bool
    {
        $testHeader = $headers['x-test-signature'] ?? '';
        if ($testHeader === '') {
            return false;
        }

        return hash_equals($secret, $testHeader) || hash_equals('test:'.$secret, $testHeader);
    }

    private function forbiddenError(string $channel): BusinessError
    {
        return new BusinessError(
            'ACTION_FORBIDDEN',
            sprintf('Signature de webhook invalide pour le canal %s.', $channel),
            403,
        );
    }
}

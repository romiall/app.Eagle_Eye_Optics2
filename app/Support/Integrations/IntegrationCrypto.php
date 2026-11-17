<?php

namespace App\Support\Integrations;

use App\Domain\Shared\BusinessError;
use JsonException;
use RuntimeException;

/**
 * Chiffrement symétrique libsodium (XSalsa20-Poly1305 secretbox), hachage déterministe HMAC-SHA256
 * des destinations et masquage PII pour les réponses et journaux d'audit.
 */
final class IntegrationCrypto
{
    private const CIPHERTEXT_PREFIX = 'v1:';

    private const TESTING_KEY_ID = 'test-integrations-k1';

    private const TESTING_FALLBACK_SEED = 'eeo-testing-integrations-credentials-key-v1';

    private const TESTING_HASH_SALT = 'eeo-testing-destination-hash-salt-v1';

    public function isConfigured(): bool
    {
        $configured = config('eeo.integrations.credentials_key');

        return is_string($configured) && trim($configured) !== '';
    }

    public function keyId(): string
    {
        ['key' => $key, 'key_id' => $keyId] = $this->resolveKeyMaterial();
        sodium_memzero($key);

        return $keyId;
    }

    /**
     * @return array{ciphertext: string, key_id: string}
     */
    public function encrypt(string $plaintext): array
    {
        ['key' => $key, 'key_id' => $keyId] = $this->resolveKeyMaterial();

        try {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipherBytes = sodium_crypto_secretbox($plaintext, $nonce, $key);

            return [
                'ciphertext' => self::CIPHERTEXT_PREFIX.base64_encode($nonce.$cipherBytes),
                'key_id' => $keyId,
            ];
        } finally {
            sodium_memzero($key);
        }
    }

    public function decrypt(string $ciphertext): string
    {
        if (! str_starts_with($ciphertext, self::CIPHERTEXT_PREFIX)) {
            throw new RuntimeException('Format de texte chiffré non pris en charge.');
        }

        $encoded = substr($ciphertext, strlen(self::CIPHERTEXT_PREFIX));
        $decoded = base64_decode($encoded, true);
        if ($decoded === false) {
            throw new RuntimeException('Texte chiffré base64 invalide.');
        }

        $minLength = SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES;
        if (strlen($decoded) < $minLength) {
            throw new RuntimeException('Texte chiffré tronqué.');
        }

        $nonce = substr($decoded, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $box = substr($decoded, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        ['key' => $key] = $this->resolveKeyMaterial();

        try {
            $plaintext = sodium_crypto_secretbox_open($box, $nonce, $key);
        } finally {
            sodium_memzero($key);
        }

        if ($plaintext === false) {
            throw new RuntimeException('Déchiffrement secretbox impossible : clé invalide ou donnée altérée.');
        }

        return $plaintext;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{ciphertext: string, key_id: string}
     */
    public function encryptJson(array $payload): array
    {
        try {
            $json = json_encode($payload === [] ? (object) [] : $payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        } catch (JsonException $exception) {
            throw new RuntimeException('Sérialisation JSON impossible avant chiffrement.', 0, $exception);
        }

        return $this->encrypt($json);
    }

    /**
     * @return array<string, mixed>
     */
    public function decryptJson(string $ciphertext): array
    {
        $plaintext = $this->decrypt($ciphertext);

        try {
            $decoded = json_decode($plaintext, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException('Payload JSON chiffré invalide.', 0, $exception);
        }

        if (! is_array($decoded)) {
            throw new RuntimeException('Le payload déchiffré doit être un objet JSON.');
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    public function hashDestination(string $normalized): string
    {
        $salt = $this->resolveDestinationHashSalt();

        return hash_hmac('sha256', $normalized, $salt);
    }

    public function maskDestination(string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return '';
        }

        if (str_contains($trimmed, '@')) {
            [$local, $domain] = explode('@', $trimmed, 2);
            $localLength = mb_strlen($local, 'UTF-8');
            if ($localLength <= 1) {
                return '***@'.$domain;
            }
            if ($localLength === 2) {
                return mb_substr($local, 0, 1, 'UTF-8').'*@'.$domain;
            }

            $prefix = mb_substr($local, 0, 2, 'UTF-8');
            $suffix = $localLength >= 5 ? mb_substr($local, -1, 1, 'UTF-8') : '';

            return $prefix.'***'.$suffix.'@'.$domain;
        }

        $length = mb_strlen($trimmed, 'UTF-8');
        if ($length <= 4) {
            return str_repeat('*', $length);
        }

        if ($length <= 7) {
            return mb_substr($trimmed, 0, 1, 'UTF-8')
                .'***'
                .mb_substr($trimmed, -2, 2, 'UTF-8');
        }

        $prefixLen = str_starts_with($trimmed, '+') ? 4 : 3;
        $suffixLen = 2;
        $maskedCount = max(3, $length - $prefixLen - $suffixLen);

        return mb_substr($trimmed, 0, $prefixLen, 'UTF-8')
            .str_repeat('*', $maskedCount)
            .mb_substr($trimmed, -$suffixLen, $suffixLen, 'UTF-8');
    }

    /**
     * @return array{key: string, key_id: string}
     */
    private function resolveKeyMaterial(): array
    {
        $configured = config('eeo.integrations.credentials_key');
        if (is_string($configured) && trim($configured) !== '') {
            $key = $this->deriveKeyFromConfigured(trim($configured));
            $keyId = 'k1-'.substr(hash('sha256', $key), 0, 12);

            return ['key' => $key, 'key_id' => $keyId];
        }

        if ($this->isTestingEnvironment()) {
            $key = hash('sha256', self::TESTING_FALLBACK_SEED, true);

            return ['key' => $key, 'key_id' => self::TESTING_KEY_ID];
        }

        throw new BusinessError(
            'DEPENDENCY_UNAVAILABLE',
            'La clé de chiffrement des intégrations est absente.',
            503,
        );
    }

    private function deriveKeyFromConfigured(string $configured): string
    {
        if (str_starts_with($configured, 'base64:')) {
            $decoded = base64_decode(substr($configured, 7), true);
            if ($decoded === false || $decoded === '') {
                throw new RuntimeException('La clé EEO_INTEGRATIONS_KEY base64 est invalide.');
            }

            return strlen($decoded) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES
                ? $decoded
                : hash('sha256', $decoded, true);
        }

        if (strlen($configured) === 64 && ctype_xdigit($configured)) {
            $binary = hex2bin($configured);
            if ($binary !== false && strlen($binary) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
                return $binary;
            }
        }

        if (strlen($configured) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            return $configured;
        }

        return hash_hkdf(
            'sha256',
            $configured,
            SODIUM_CRYPTO_SECRETBOX_KEYBYTES,
            'eeo-integrations-secretbox-v1',
        );
    }

    private function resolveDestinationHashSalt(): string
    {
        $configured = config('eeo.integrations.destination_hash_salt');
        if (is_string($configured) && trim($configured) !== '') {
            return $configured;
        }

        if ($this->isTestingEnvironment()) {
            return self::TESTING_HASH_SALT;
        }

        throw new BusinessError(
            'DEPENDENCY_UNAVAILABLE',
            'Le sel de hachage des destinations est absent.',
            503,
        );
    }

    private function isTestingEnvironment(): bool
    {
        if (function_exists('app') && app()->bound('env')) {
            return app()->environment('testing');
        }

        return config('app.env') === 'testing';
    }
}

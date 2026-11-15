<?php

declare(strict_types=1);

namespace App\Support\Integrations\Messaging;

use App\Domain\Shared\BusinessError;
use Illuminate\Support\Facades\App;

/**
 * Chiffrement sodium (XChaCha20-Poly1305 / secretbox) et hachage HMAC-SHA256 des destinations de contact
 * (téléphone normalisé ou adresse e-mail). Toute manipulation de clé reste cantonnée dans
 * `app/Support/Integrations/*`, jamais en clair dans les journaux ni les réponses API.
 */
final class DestinationCipher
{
    public const KEY_ID = 'eeo-int-1';

    private const PREFIX = 'v1:';

    /**
     * @return array{ciphertext: string, hash: string, key_id: string}
     */
    public function encrypt(string $normalizedDestination): array
    {
        $key = $this->encryptionKey();
        try {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipher = sodium_crypto_secretbox($normalizedDestination, $nonce, $key);
        } finally {
            sodium_memzero($key);
        }

        return [
            'ciphertext' => self::PREFIX.base64_encode($nonce.$cipher),
            'hash' => $this->hash($normalizedDestination),
            'key_id' => self::KEY_ID,
        ];
    }

    public function hash(string $normalizedDestination): string
    {
        return hash_hmac('sha256', $normalizedDestination, $this->hashSalt());
    }

    public function decrypt(string $ciphertext): string
    {
        if (! str_starts_with($ciphertext, self::PREFIX)) {
            throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Format de destination chiffrée invalide.', 500);
        }

        $decoded = base64_decode(substr($ciphertext, strlen(self::PREFIX)), true);
        if (! is_string($decoded) || strlen($decoded) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Charge chiffrée invalide.', 500);
        }

        $nonce = substr($decoded, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($decoded, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        $key = $this->encryptionKey();
        try {
            $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        } finally {
            sodium_memzero($key);
        }

        if (! is_string($plain)) {
            throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Impossible de déchiffrer la destination.', 500);
        }

        return $plain;
    }

    public function maskCiphertext(string $channel, string $ciphertext): string
    {
        return $this->mask($channel, $this->decrypt($ciphertext));
    }

    public function mask(string $channel, string $normalizedDestination): string
    {
        $trimmed = trim($normalizedDestination);
        if ($channel === 'EMAIL' || str_contains($trimmed, '@')) {
            $parts = explode('@', $trimmed, 2);
            if (count($parts) === 2) {
                [$local, $domain] = $parts;
                $prefix = mb_strlen($local) >= 3 ? mb_substr($local, 0, 2) : mb_substr($local, 0, 1);

                return $prefix.'***@'.$domain;
            }
        }

        $digits = preg_replace('/\s+/', '', $trimmed) ?? $trimmed;
        $len = strlen($digits);
        if ($len <= 4) {
            return '***';
        }

        // Format lisible type « +237 6** *** **12 » pour les numéros E.164.
        if (str_starts_with($digits, '+237') && $len >= 11) {
            $firstLocal = substr($digits, 4, 1);
            $lastTwo = substr($digits, -2);

            return '+237 '.$firstLocal.'** *** **'.$lastTwo;
        }

        if (str_starts_with($digits, '+') && $len >= 8) {
            $prefix = substr($digits, 0, 5);
            $lastTwo = substr($digits, -2);

            return $prefix.' ****'.$lastTwo;
        }

        return substr($digits, 0, 2).'***'.substr($digits, -2);
    }

    private function encryptionKey(): string
    {
        $configured = config('eeo.integrations.credentials_key');
        $raw = is_string($configured) ? trim($configured) : '';

        if ($raw === '') {
            if (App::environment('testing')) {
                return hash('sha256', 'eeo-testing-integrations-credentials-key', true);
            }

            throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Clé de chiffrement des intégrations non configurée.', 503);
        }

        if (str_starts_with($raw, 'base64:')) {
            $decoded = base64_decode(substr($raw, 7), true);
            if (is_string($decoded) && strlen($decoded) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
                return $decoded;
            }
            if (is_string($decoded) && $decoded !== '') {
                return hash('sha256', $decoded, true);
            }
        }

        if (strlen($raw) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            return $raw;
        }

        if (strlen($raw) === 64 && ctype_xdigit($raw)) {
            $bin = hex2bin($raw);
            if (is_string($bin) && strlen($bin) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
                return $bin;
            }
        }

        return hash('sha256', $raw, true);
    }

    private function hashSalt(): string
    {
        $configured = config('eeo.integrations.destination_hash_salt');
        $salt = is_string($configured) ? trim($configured) : '';

        if ($salt === '') {
            if (App::environment('testing')) {
                return 'eeo-testing-destination-hash-salt';
            }

            throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Sel de hachage des destinations non configuré.', 503);
        }

        return $salt;
    }
}

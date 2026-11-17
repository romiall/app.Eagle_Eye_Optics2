<?php

namespace App\Support\Integrations\GoogleCalendar;

use RuntimeException;

/**
 * Chiffrement authentifié local des jetons de synchronisation Google (`sync_token_ciphertext`) via
 * `sodium_crypto_secretbox`. Aucun jeton de synchronisation n'est stocké en clair en base ni exposé en API.
 */
final class CalendarTokenCipher
{
    private const KEY_CONTEXT = 'eeo-google-calendar-sync-token-v1';

    /**
     * @return array{ciphertext: string, key_id: string}
     */
    public function encrypt(string $plaintext): array
    {
        $key = $this->deriveKey();
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plaintext, $nonce, $key);
        $keyId = $this->keyIdFor($key);
        sodium_memzero($key);

        return [
            'ciphertext' => base64_encode($nonce.$cipher),
            'key_id' => $keyId,
        ];
    }

    public function decrypt(string $ciphertext): string
    {
        $decoded = base64_decode($ciphertext, true);
        if ($decoded === false || strlen($decoded) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
            throw new RuntimeException('Jeton de synchronisation Google Calendar chiffré invalide.');
        }

        $nonce = substr($decoded, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($decoded, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $key = $this->deriveKey();
        $plaintext = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        sodium_memzero($key);

        if ($plaintext === false) {
            throw new RuntimeException('Déchiffrement du jeton de synchronisation Google Calendar impossible.');
        }

        return $plaintext;
    }

    public function keyId(): string
    {
        $key = $this->deriveKey();
        $keyId = $this->keyIdFor($key);
        sodium_memzero($key);

        return $keyId;
    }

    private function deriveKey(): string
    {
        $configured = config('eeo.integrations.credentials_key');
        $raw = is_string($configured) ? trim($configured) : '';

        if ($raw === '') {
            if (! app()->environment('testing')) {
                throw new RuntimeException('Clé de chiffrement des intégrations (`eeo.integrations.credentials_key`) absente.');
            }
            $appKey = config('app.key');
            $raw = is_string($appKey) && trim($appKey) !== ''
                ? trim($appKey)
                : 'eeo-testing-google-calendar-sync-key';
        }

        if (str_starts_with($raw, 'base64:')) {
            $decoded = base64_decode(substr($raw, 7), true);
            if ($decoded !== false && $decoded !== '') {
                $raw = $decoded;
            }
        }

        return sodium_crypto_generichash(
            self::KEY_CONTEXT.':'.$raw,
            '',
            SODIUM_CRYPTO_SECRETBOX_KEYBYTES,
        );
    }

    private function keyIdFor(string $key): string
    {
        return 'sodium-sb-v1:'.substr(hash('sha256', $key), 0, 16);
    }
}

<?php

namespace App\Support\Integrations;

use App\Domain\Shared\BusinessError;
use stdClass;

/**
 * Résout le mode d'exécution des intégrations (fake / live / disabled) et la disponibilité
 * des fournisseurs et comptes cliniques sans jamais imposer d'effets réseau par défaut.
 */
final class IntegrationMode
{
    public const MODE_FAKE = 'fake';

    public const MODE_LIVE = 'live';

    public const MODE_DISABLED = 'disabled';

    /** @var list<string> */
    public const VALID_MODES = [
        self::MODE_FAKE,
        self::MODE_LIVE,
        self::MODE_DISABLED,
    ];

    /** @var list<string> */
    public const OPERATIONAL_STATUSES = [
        'ACTIVE',
        'TEST',
    ];

    /** @var list<string> */
    public const ALL_PROVIDERS = [
        'GOOGLE',
        'KOMMO',
        'META_WHATSAPP',
        'META_MESSENGER',
        'META_INSTAGRAM',
        'SMS',
        'SMTP',
    ];

    /** @var array<string, list<string>> */
    public const WEBHOOK_PROVIDER_MAP = [
        'google' => ['GOOGLE'],
        'kommo' => ['KOMMO'],
        'meta' => ['META_WHATSAPP', 'META_MESSENGER', 'META_INSTAGRAM'],
        'sms' => ['SMS'],
    ];

    public function mode(): string
    {
        $raw = config('eeo.integrations.mode', self::MODE_FAKE);
        if (! is_string($raw)) {
            return self::MODE_DISABLED;
        }

        $normalized = strtolower(trim($raw));

        return in_array($normalized, self::VALID_MODES, true) ? $normalized : self::MODE_DISABLED;
    }

    public function isDisabled(): bool
    {
        return $this->mode() === self::MODE_DISABLED;
    }

    public function isFake(): bool
    {
        return $this->mode() === self::MODE_FAKE;
    }

    public function isLive(): bool
    {
        return $this->mode() === self::MODE_LIVE;
    }

    public function isEnabled(): bool
    {
        return ! $this->isDisabled();
    }

    public function assertEnabled(): void
    {
        if ($this->isDisabled()) {
            throw new BusinessError(
                'DEPENDENCY_UNAVAILABLE',
                'Les intégrations externes sont désactivées.',
                503,
            );
        }
    }

    public function isAccountOperational(stdClass|string $accountOrStatus): bool
    {
        if ($this->isDisabled()) {
            return false;
        }

        $status = is_string($accountOrStatus)
            ? $accountOrStatus
            : (string) ($accountOrStatus->status ?? '');

        return in_array(strtoupper(trim($status)), self::OPERATIONAL_STATUSES, true);
    }

    public function isProviderActive(string $provider, ?string $accountStatus = null): bool
    {
        if ($this->isDisabled()) {
            return false;
        }

        $normalizedProvider = strtoupper(trim($provider));
        if (! in_array($normalizedProvider, self::ALL_PROVIDERS, true)) {
            return false;
        }

        if ($accountStatus !== null && ! $this->isAccountOperational($accountStatus)) {
            return false;
        }

        if ($this->isFake()) {
            return true;
        }

        if ($accountStatus !== null) {
            return true;
        }

        return $this->hasGlobalProviderConfig($normalizedProvider);
    }

    public function hasGlobalProviderConfig(string $provider): bool
    {
        return match (strtoupper(trim($provider))) {
            'GOOGLE' => $this->hasNonEmptyConfig('eeo.integrations.google.client_id')
                || $this->hasNonEmptyConfig('eeo.integrations.google.webhook_token'),
            'KOMMO' => $this->hasNonEmptyConfig('eeo.integrations.kommo.client_id')
                || $this->hasNonEmptyConfig('eeo.integrations.kommo.webhook_secret'),
            'META_WHATSAPP', 'META_MESSENGER', 'META_INSTAGRAM' => $this->hasNonEmptyConfig('eeo.integrations.meta.app_secret')
                || $this->hasNonEmptyConfig('eeo.integrations.meta.verify_token'),
            'SMS' => $this->hasNonEmptyConfig('eeo.integrations.sms.api_key'),
            'SMTP' => $this->hasNonEmptyConfig('mail.mailers.smtp.host'),
            default => false,
        };
    }

    /**
     * @return list<string>
     */
    public function accountProvidersForWebhookChannel(string $channel): array
    {
        $normalized = strtolower(trim($channel));

        return self::WEBHOOK_PROVIDER_MAP[$normalized] ?? [];
    }

    public function webhookChannelForProvider(string $provider): string
    {
        $normalized = strtoupper(trim($provider));

        return match ($normalized) {
            'GOOGLE' => 'google',
            'KOMMO' => 'kommo',
            'META_WHATSAPP', 'META_MESSENGER', 'META_INSTAGRAM' => 'meta',
            'SMS' => 'sms',
            default => strtolower($normalized),
        };
    }

    public function timeoutSeconds(): int
    {
        $raw = config('eeo.integrations.timeout_seconds', 10);

        return is_numeric($raw) ? max(1, (int) $raw) : 10;
    }

    public function outboxMaxAttempts(): int
    {
        $raw = config('eeo.integrations.outbox_max_attempts', 5);

        return is_numeric($raw) ? max(1, (int) $raw) : 5;
    }

    public function webhookMaxBytes(): int
    {
        $raw = config('eeo.integrations.webhook_max_bytes', 262144);

        return is_numeric($raw) ? max(1024, (int) $raw) : 262144;
    }

    private function hasNonEmptyConfig(string $key): bool
    {
        $value = config($key);

        return is_string($value) && trim($value) !== '';
    }
}

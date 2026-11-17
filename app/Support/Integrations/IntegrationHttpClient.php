<?php

namespace App\Support\Integrations;

use App\Domain\Shared\BusinessError;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Throwable;

/**
 * Enveloppe HTTP bornée en délai réservée exclusivement à la couche d'intégrations.
 * Aucune autre classe Domain/Application ne doit importer la façade Http directement.
 */
final class IntegrationHttpClient
{
    private const MAX_TIMEOUT_SECONDS = 30;

    private const MAX_CONNECT_TIMEOUT_SECONDS = 5;

    public function __construct(
        private readonly IntegrationMode $mode,
    ) {}

    /**
     * @param  array<string, mixed>  $options
     * @param  array<string, string>  $headers
     */
    public function request(
        string $method,
        string $url,
        array $options = [],
        array $headers = [],
        ?int $timeoutSeconds = null,
    ): Response {
        $this->mode->assertEnabled();
        $this->assertSafeHttpUrl($url);

        $pending = $this->newPendingRequest($headers, $timeoutSeconds);

        try {
            return $pending->send(strtoupper($method), $url, $options);
        } catch (ConnectionException $exception) {
            throw new BusinessError(
                'DEPENDENCY_UNAVAILABLE',
                'Le service externe est temporairement injoignable.',
                503,
                previous: $exception,
            );
        }
    }

    /**
     * @param  array<string, mixed>  $query
     * @param  array<string, string>  $headers
     */
    public function get(
        string $url,
        array $query = [],
        array $headers = [],
        ?int $timeoutSeconds = null,
    ): Response {
        return $this->request('GET', $url, ['query' => $query], $headers, $timeoutSeconds);
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, string>  $headers
     */
    public function postJson(
        string $url,
        array $body = [],
        array $headers = [],
        ?int $timeoutSeconds = null,
    ): Response {
        return $this->request('POST', $url, ['json' => $body], $headers, $timeoutSeconds);
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, string>  $headers
     */
    public function patchJson(
        string $url,
        array $body = [],
        array $headers = [],
        ?int $timeoutSeconds = null,
    ): Response {
        return $this->request('PATCH', $url, ['json' => $body], $headers, $timeoutSeconds);
    }

    /**
     * @param  array<string, mixed>  $credentials
     * @param  array<string, mixed>  $publicConfiguration
     * @return array{reachable: bool, detail: ?string}
     */
    public function probeProvider(
        string $provider,
        string $status,
        array $credentials,
        array $publicConfiguration = [],
    ): array {
        $this->mode->assertEnabled();

        if (! $this->mode->isAccountOperational($status)) {
            return [
                'reachable' => false,
                'detail' => 'Le compte d’intégration n’est pas dans un état opérationnel.',
            ];
        }

        if ($this->mode->isFake()) {
            $hasSecret = $credentials !== [];

            return $hasSecret
                ? ['reachable' => true, 'detail' => 'Connexion vérifiée en mode simulé (fake).']
                : ['reachable' => false, 'detail' => 'Aucun identifiant chiffré configuré sur le compte.'];
        }

        $probeUrl = $this->resolveProbeUrl($provider, $publicConfiguration);
        if ($probeUrl === null) {
            return [
                'reachable' => $credentials !== [],
                'detail' => $credentials !== []
                    ? 'Configuration live présente sans endpoint de sonde explicite.'
                    : 'Identifiants absents pour le mode live.',
            ];
        }

        $headers = $this->buildProbeHeaders($credentials);

        try {
            $response = $this->get($probeUrl, [], $headers, min($this->mode->timeoutSeconds(), 10));

            if ($response->successful()) {
                return ['reachable' => true, 'detail' => 'Sonde HTTP live réussie ('.$response->status().').'];
            }

            return [
                'reachable' => false,
                'detail' => 'Le fournisseur a répondu avec le statut HTTP '.$response->status().'.',
            ];
        } catch (Throwable $exception) {
            return [
                'reachable' => false,
                'detail' => 'Sonde HTTP live en échec : '.$exception->getMessage(),
            ];
        }
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function newPendingRequest(array $headers, ?int $timeoutSeconds): PendingRequest
    {
        $configuredTimeout = $timeoutSeconds ?? $this->mode->timeoutSeconds();
        $boundedTimeout = min(max(1, $configuredTimeout), self::MAX_TIMEOUT_SECONDS);
        $connectTimeout = min($boundedTimeout, self::MAX_CONNECT_TIMEOUT_SECONDS);

        return Http::timeout($boundedTimeout)
            ->connectTimeout($connectTimeout)
            ->acceptJson()
            ->withHeaders(array_merge([
                'User-Agent' => 'EEO-Socle/1.0',
            ], $headers));
    }

    private function assertSafeHttpUrl(string $url): void
    {
        $parts = parse_url($url);
        $scheme = is_array($parts) ? strtolower((string) ($parts['scheme'] ?? '')) : '';
        $host = is_array($parts) ? (string) ($parts['host'] ?? '') : '';

        if (! in_array($scheme, ['https', 'http'], true) || $host === '') {
            throw new InvalidArgumentException('URL d’intégration externe invalide.');
        }
    }

    /**
     * @param  array<string, mixed>  $publicConfiguration
     */
    private function resolveProbeUrl(string $provider, array $publicConfiguration): ?string
    {
        $explicit = $publicConfiguration['health_url'] ?? $publicConfiguration['base_url'] ?? null;
        if (is_string($explicit) && $explicit !== '') {
            $parts = parse_url($explicit);
            $scheme = is_array($parts) ? strtolower((string) ($parts['scheme'] ?? '')) : '';
            if (in_array($scheme, ['https', 'http'], true)) {
                return $explicit;
            }
        }

        return match (strtoupper($provider)) {
            'GOOGLE' => 'https://www.googleapis.com/discovery/v1/apis',
            'KOMMO' => is_string($publicConfiguration['subdomain'] ?? null) && $publicConfiguration['subdomain'] !== ''
                ? 'https://'.$publicConfiguration['subdomain'].'.kommo.com/api/v4/account'
                : null,
            'META_WHATSAPP', 'META_MESSENGER', 'META_INSTAGRAM' => 'https://graph.facebook.com/v20.0',
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $credentials
     * @return array<string, string>
     */
    private function buildProbeHeaders(array $credentials): array
    {
        $token = $credentials['access_token'] ?? $credentials['api_key'] ?? null;
        if (is_string($token) && trim($token) !== '') {
            return ['Authorization' => 'Bearer '.trim($token)];
        }

        return [];
    }
}

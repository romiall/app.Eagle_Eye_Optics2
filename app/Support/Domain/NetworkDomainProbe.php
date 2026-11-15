<?php

namespace App\Support\Domain;

use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Sondes réelles du contrôle du domaine (voir `DomainProbe`) : sockets TLS et SMTP, résolveur DNS du système et client
 * HTTP de Laravel. Délai de 10 secondes par sonde ; une panne est un RÉSULTAT (`error`), jamais une exception : le
 * contrôle doit toujours aller au bout et dire ce qu'il a vu.
 */
final class NetworkDomainProbe implements DomainProbe
{
    private const TIMEOUT_SECONDS = 10;

    private const DNS_TYPES = [
        'A' => DNS_A,
        'AAAA' => DNS_AAAA,
        'MX' => DNS_MX,
        'TXT' => DNS_TXT,
        'CNAME' => DNS_CNAME,
    ];

    public function certificate(string $host, int $port = 443): array
    {
        $verified = $this->peerCertificate($host, $port, true);
        if ($verified['certificate'] !== null) {
            return $this->describe($verified['certificate'], true, null);
        }

        // Chaîne ou nom refusés : on relit tout de même le certificat présenté pour dire de quoi il s'agit.
        $unverified = $this->peerCertificate($host, $port, false);

        return $unverified['certificate'] !== null
            ? $this->describe($unverified['certificate'], false, $verified['error'])
            : ['trusted' => false, 'valid_from' => null, 'valid_to' => null, 'subject' => null, 'issuer' => null, 'error' => $verified['error'] ?? $unverified['error']];
    }

    public function http(string $url): array
    {
        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)->withoutRedirecting()->get($url);
        } catch (Throwable $exception) {
            return ['status' => null, 'location' => null, 'body' => null, 'headers' => [], 'error' => $exception->getMessage()];
        }

        $headers = [];
        foreach ($response->headers() as $name => $values) {
            $headers[strtolower((string) $name)] = implode(', ', $values);
        }
        $location = $response->header('Location');

        return [
            'status' => $response->status(),
            'location' => $location === '' ? null : $location,
            'body' => $response->body(),
            'headers' => $headers,
            'error' => null,
        ];
    }

    public function dns(string $name, string $type): array
    {
        $constant = self::DNS_TYPES[strtoupper($type)] ?? null;
        if ($constant === null || $name === '') {
            return [];
        }
        $records = @dns_get_record($name, $constant);
        if (! is_array($records)) {
            return [];
        }

        $values = [];
        foreach ($records as $record) {
            $value = match (strtoupper($type)) {
                'A' => $record['ip'] ?? null,
                'AAAA' => $record['ipv6'] ?? null,
                'MX' => isset($record['target']) ? ($record['pri'] ?? 0).' '.$record['target'] : null,
                'TXT' => $record['txt'] ?? (isset($record['entries']) && is_array($record['entries']) ? implode('', $record['entries']) : null),
                default => $record['target'] ?? null,
            };
            if (is_string($value) && $value !== '') {
                $values[] = $value;
            }
        }

        return $values;
    }

    public function smtp(string $host, int $port): array
    {
        $implicit = $port === 465;
        $errorNumber = 0;
        $errorMessage = '';
        $socket = @stream_socket_client(($implicit ? 'ssl://' : 'tcp://').$host.':'.$port, $errorNumber, $errorMessage, self::TIMEOUT_SECONDS);
        if ($socket === false) {
            return ['banner' => null, 'capabilities' => [], 'tls' => null, 'error' => self::failure($errorNumber, $errorMessage, 'connexion impossible')];
        }

        try {
            stream_set_timeout($socket, self::TIMEOUT_SECONDS);
            $banner = $this->reply($socket);
            if ($banner === null || ! str_starts_with($banner[0], '220')) {
                return ['banner' => $banner[0] ?? null, 'capabilities' => [], 'tls' => null, 'error' => 'réponse inattendue à la connexion'];
            }
            fwrite($socket, "EHLO eeo-domain-check.invalid\r\n");
            $ehlo = $this->reply($socket) ?? [];
            fwrite($socket, "QUIT\r\n");

            $capabilities = [];
            foreach ($ehlo as $line) {
                if (preg_match('/^250[ -](.+)$/', $line, $match) === 1) {
                    $capabilities[] = strtoupper(trim($match[1]));
                }
            }

            return [
                'banner' => $banner[0],
                'capabilities' => $capabilities,
                'tls' => $implicit ? 'implicite' : (in_array('STARTTLS', $capabilities, true) ? 'STARTTLS' : null),
                'error' => null,
            ];
        } finally {
            fclose($socket);
        }
    }

    /**
     * @return array{certificate: \OpenSSLCertificate|null, error: string|null}
     */
    private function peerCertificate(string $host, int $port, bool $verify): array
    {
        $context = stream_context_create(['ssl' => [
            'capture_peer_cert' => true,
            'verify_peer' => $verify,
            'verify_peer_name' => $verify,
            'SNI_enabled' => true,
            'peer_name' => $host,
        ]]);
        $errorNumber = 0;
        $errorMessage = '';
        $client = @stream_socket_client('ssl://'.$host.':'.$port, $errorNumber, $errorMessage, self::TIMEOUT_SECONDS, STREAM_CLIENT_CONNECT, $context);
        if ($client === false) {
            return ['certificate' => null, 'error' => self::failure($errorNumber, $errorMessage, 'connexion TLS impossible')];
        }

        $parameters = stream_context_get_params($client);
        fclose($client);
        $certificate = $parameters['options']['ssl']['peer_certificate'] ?? null;

        return $certificate instanceof \OpenSSLCertificate
            ? ['certificate' => $certificate, 'error' => null]
            : ['certificate' => null, 'error' => 'aucun certificat présenté'];
    }

    /**
     * @return array{trusted: bool, valid_from: int|null, valid_to: int|null, subject: string|null, issuer: string|null, error: string|null}
     */
    private function describe(\OpenSSLCertificate $certificate, bool $trusted, ?string $error): array
    {
        $parsed = openssl_x509_parse($certificate);
        if (! is_array($parsed)) {
            return ['trusted' => $trusted, 'valid_from' => null, 'valid_to' => null, 'subject' => null, 'issuer' => null, 'error' => $error ?? 'certificat illisible'];
        }
        $subject = is_array($parsed['subject'] ?? null) ? ($parsed['subject']['CN'] ?? null) : null;
        $issuerParts = is_array($parsed['issuer'] ?? null) ? $parsed['issuer'] : [];
        $issuer = $issuerParts['O'] ?? $issuerParts['CN'] ?? null;

        return [
            'trusted' => $trusted,
            'valid_from' => is_int($parsed['validFrom_time_t'] ?? null) ? $parsed['validFrom_time_t'] : null,
            'valid_to' => is_int($parsed['validTo_time_t'] ?? null) ? $parsed['validTo_time_t'] : null,
            'subject' => is_string($subject) ? $subject : null,
            'issuer' => is_string($issuer) ? $issuer : null,
            'error' => $error,
        ];
    }

    /** Message d'une connexion refusée : celui du système s'il existe, sinon le code. */
    private static function failure(?int $code, ?string $message, string $fallback): string
    {
        if ($message !== null && trim($message) !== '') {
            return $message;
        }

        return $code === null ? $fallback : $fallback.' (code '.$code.')';
    }

    /**
     * Lit une réponse SMTP (une ou plusieurs lignes, la dernière sans « - » après le code).
     *
     * @param  resource  $socket
     * @return list<string>|null
     */
    private function reply($socket): ?array
    {
        $lines = [];
        while (($line = fgets($socket, 1024)) !== false) {
            $line = rtrim($line, "\r\n");
            $lines[] = $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }

        return $lines === [] ? null : $lines;
    }
}

<?php

namespace App\Console\Commands;

use App\Support\Deployment\PreflightResult;
use App\Support\Domain\DomainChecks;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Contrôle du domaine et de la messagerie (L3D04, EE040, docs/runbooks/domain-email.md), EN LECTURE SEULE : DNS et
 * certificat de l'application, redirection HTTP vers HTTPS, sonde de santé, puis MX, SPF, DKIM, DMARC et bannière
 * SMTP du domaine de messagerie du cabinet. Aucun achat, aucune modification de zone DNS, aucun compte créé, aucun
 * courrier envoyé : le domaine et la messagerie appartiennent au client, ce contrôle ne fait que les interroger.
 *
 * Les valeurs par défaut viennent de la configuration (APP_URL, MAIL_FROM_ADDRESS, MAIL_HOST, MAIL_PORT) ; une valeur
 * de démonstration (example.com, 127.0.0.1) n'est jamais contrôlée. Code de sortie : 0 sans point bloquant, 1 sinon (les
 * alertes ne bloquent pas). `--json` donne le rapport pour le consigner dans docs/evidence/domain-checks.md.
 */
#[Signature('eeo:domain:check
    {--host= : Nom de l\'application (défaut : hôte de APP_URL)}
    {--mail-domain= : Domaine de messagerie du cabinet (défaut : domaine de MAIL_FROM_ADDRESS)}
    {--smtp-host= : Serveur SMTP à interroger sans l\'utiliser (défaut : MAIL_HOST)}
    {--smtp-port= : Port SMTP (défaut : MAIL_PORT, sinon 587)}
    {--dkim-selector= : Sélecteur DKIM publié par le fournisseur de messagerie}
    {--json : Rapport au format JSON}')]
#[Description('Contrôle en lecture seule du domaine : DNS, certificat HTTPS, redirection, sonde /up, MX, SPF, DKIM, DMARC et SMTP')]
final class DomainCheckCommand extends Command
{
    /** Valeurs d'exemple de Laravel : un domaine ou un hôte de démonstration n'est pas celui du cabinet. */
    private const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'localhost'];

    private const PLACEHOLDER_HOSTS = ['127.0.0.1', '::1', 'localhost', 'mailpit', 'mailhog'];

    public function handle(DomainChecks $checks): int
    {
        $host = $this->text('host') ?? $this->hostOf((string) config('app.url'));
        if ($host === null || in_array($host, self::PLACEHOLDER_HOSTS, true)) {
            $this->components->error('Aucun hôte à contrôler : APP_URL n\'est pas celui du cabinet. Relancer avec --host=<nom>.');

            return self::FAILURE;
        }

        $mailDomain = $this->text('mail-domain') ?? $this->domainOf((string) config('mail.from.address'));
        $smtpHost = $this->text('smtp-host') ?? $this->nonPlaceholderHost(config('mail.mailers.smtp.host'));
        $configuredPort = config('mail.mailers.smtp.port');
        $smtpPort = (int) ($this->text('smtp-port') ?? (is_numeric($configuredPort) ? $configuredPort : 587));

        $results = $checks->run($host, $mailDomain, $smtpHost, $smtpPort, $this->text('dkim-selector'));
        $blocking = array_values(array_filter($results, static fn (PreflightResult $result): bool => $result->isBlocking()));

        if ($this->option('json')) {
            $this->line((string) json_encode([
                'ok' => $blocking === [],
                'blocking' => count($blocking),
                'host' => $host,
                'mail_domain' => $mailDomain,
                'checks' => array_map(static fn (PreflightResult $result): array => $result->toArray(), $results),
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

            return $blocking === [] ? self::SUCCESS : self::FAILURE;
        }

        foreach ($results as $result) {
            $line = sprintf('%-40s %s', $result->label, $result->detail);
            match ($result->status) {
                PreflightResult::OK => $this->line('  <fg=green>OK</>      '.$line),
                PreflightResult::WARNING => $this->line('  <fg=yellow>ALERTE</>  '.$line),
                PreflightResult::BLOCKING => $this->line('  <fg=red>BLOQUANT</> '.$line),
                default => $this->line('  info    '.$line),
            };
        }

        $warnings = count(array_filter($results, static fn (PreflightResult $result): bool => $result->status === PreflightResult::WARNING));
        $this->newLine();
        if ($blocking === []) {
            $this->components->info('Aucun point bloquant'.($warnings > 0 ? " ({$warnings} alerte(s) à lire)." : '.'));

            return self::SUCCESS;
        }

        $this->components->error(count($blocking).' point(s) bloquant(s) : à corriger chez le fournisseur du domaine ou de l\'hébergement (rien n\'est modifié par ce contrôle).');

        return self::FAILURE;
    }

    private function text(string $option): ?string
    {
        $value = $this->option($option);

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private function hostOf(string $url): ?string
    {
        $host = parse_url($url, PHP_URL_HOST);

        return is_string($host) && $host !== '' ? strtolower($host) : null;
    }

    private function domainOf(string $address): ?string
    {
        $position = strrpos($address, '@');
        if ($position === false) {
            return null;
        }
        $domain = strtolower(substr($address, $position + 1));

        return $domain === '' || in_array($domain, self::PLACEHOLDER_DOMAINS, true) ? null : $domain;
    }

    private function nonPlaceholderHost(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' && ! in_array(strtolower(trim($value)), self::PLACEHOLDER_HOSTS, true) ? trim($value) : null;
    }
}

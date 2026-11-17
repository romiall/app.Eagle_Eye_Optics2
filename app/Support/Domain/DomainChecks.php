<?php

namespace App\Support\Domain;

use App\Support\Deployment\PreflightResult;

/**
 * Contrôles du domaine et de la messagerie de `php artisan eeo:domain:check` (L3D04, EE040), EN LECTURE SEULE.
 *
 * Application : le nom se résout, le certificat HTTPS est reconnu et loin de son échéance, le port 80 renvoie vers
 * HTTPS, la sonde `/up` répond, l'en-tête HSTS est posé. Messagerie du cabinet : MX, SPF, DKIM (si le sélecteur est
 * connu), DMARC et bannière SMTP avec chiffrement. Une absence côté messagerie est une ALERTE, jamais un point
 * bloquant : les comptes direction et contact sont configurés « si disponibles » (fichier 02) et appartiennent au client.
 *
 * Rien n'est acheté, créé ni modifié : ni DNS, ni compte, ni courrier. Les seules écritures du contrôle sont les
 * lignes de son rapport.
 */
final class DomainChecks
{
    /** Au-dessous de ce nombre de jours avant l'échéance, le certificat est signalé. */
    private const CERTIFICATE_WARNING_DAYS = 21;

    public function __construct(private readonly DomainProbe $probe) {}

    /**
     * @return list<PreflightResult>
     */
    public function run(string $appHost, ?string $mailDomain, ?string $smtpHost, int $smtpPort, ?string $dkimSelector = null, ?int $now = null): array
    {
        $now ??= time();

        return [
            ...$this->application($appHost, $now),
            ...$this->mail($mailDomain, $smtpHost, $smtpPort, $dkimSelector),
        ];
    }

    /**
     * @return list<PreflightResult>
     */
    private function application(string $host, int $now): array
    {
        $results = [];

        $addresses = [...$this->probe->dns($host, 'A'), ...$this->probe->dns($host, 'AAAA')];
        $results[] = $addresses === []
            ? PreflightResult::blocking('Application : DNS', $host.' ne se résout pas (aucun enregistrement A ni AAAA).')
            : PreflightResult::ok('Application : DNS', $host.' → '.implode(', ', $addresses));

        $results[] = $this->certificate($host, $now);

        $redirect = $this->probe->http('http://'.$host.'/up');
        $location = $redirect['location'] ?? '';
        $results[] = match (true) {
            $redirect['status'] === null => PreflightResult::warning('Application : HTTP vers HTTPS', 'Le port 80 ne répond pas ('.($redirect['error'] ?? 'sans détail').') : sans importance si le fournisseur redirige avant l\'application, à vérifier dans son panneau.'),
            in_array($redirect['status'], [301, 302, 307, 308], true) && str_starts_with(strtolower($location), 'https://') => PreflightResult::ok('Application : HTTP vers HTTPS', 'Le port 80 renvoie (statut '.$redirect['status'].') vers '.$location),
            default => PreflightResult::warning('Application : HTTP vers HTTPS', 'Le port 80 répond statut '.$redirect['status'].' sans renvoyer vers HTTPS : le trafic pourrait rester en clair.'),
        };

        $health = $this->probe->http('https://'.$host.'/up');
        $decoded = is_string($health['body']) ? json_decode($health['body'], true) : null;
        $healthy = $health['status'] === 200 && is_array($decoded) && ($decoded['status'] ?? null) === 'ok';
        $results[] = $healthy
            ? PreflightResult::ok('Application : sonde /up', 'https://'.$host.'/up répond 200 {"status":"ok"}.')
            : PreflightResult::blocking('Application : sonde /up', 'https://'.$host.'/up ne répond pas {"status":"ok"} ('.($health['status'] === null ? ($health['error'] ?? 'aucune réponse') : 'statut '.$health['status']).').');

        $results[] = isset($health['headers']['strict-transport-security'])
            ? PreflightResult::ok('Application : HSTS', $health['headers']['strict-transport-security'])
            : PreflightResult::warning('Application : HSTS', 'L\'en-tête Strict-Transport-Security est absent des réponses HTTPS.');

        return $results;
    }

    private function certificate(string $host, int $now): PreflightResult
    {
        $label = 'Application : certificat HTTPS';
        $certificate = $this->probe->certificate($host);
        $validTo = $certificate['valid_to'];
        if ($validTo === null) {
            return PreflightResult::blocking($label, 'Aucun certificat lisible sur '.$host.':443 ('.($certificate['error'] ?? 'sans détail').').');
        }

        $until = gmdate('d/m/Y', $validTo);
        $holder = ($certificate['subject'] ?? 'nom inconnu').', émis par '.($certificate['issuer'] ?? 'émetteur inconnu');
        if (! $certificate['trusted']) {
            return PreflightResult::blocking($label, 'Certificat non reconnu pour '.$host.' ('.($certificate['error'] ?? 'chaîne ou nom refusés').') : '.$holder.'.');
        }
        if ($validTo <= $now) {
            return PreflightResult::blocking($label, 'Certificat expiré depuis le '.$until.' ('.$holder.').');
        }
        $days = intdiv($validTo - $now, 86400);

        return $days < self::CERTIFICATE_WARNING_DAYS
            ? PreflightResult::warning($label, 'Le certificat expire dans '.$days.' jour(s), le '.$until.' ('.$holder.') : le renouvellement automatique du fournisseur est à vérifier.')
            : PreflightResult::ok($label, 'Valide jusqu\'au '.$until.' ('.$holder.').');
    }

    /**
     * @return list<PreflightResult>
     */
    private function mail(?string $domain, ?string $smtpHost, int $smtpPort, ?string $dkimSelector): array
    {
        if ($domain === null || $domain === '') {
            return [PreflightResult::info('Messagerie', 'Domaine de messagerie non précisé : relancer avec --mail-domain=<domaine> pour contrôler MX, SPF, DKIM et DMARC.')];
        }

        $results = [];

        $mx = $this->probe->dns($domain, 'MX');
        $results[] = $mx === []
            ? PreflightResult::warning('Messagerie : MX', $domain.' n\'a aucun enregistrement MX : aucun courrier ne peut y être reçu.')
            : PreflightResult::ok('Messagerie : MX', implode(' ; ', $mx));

        $spf = array_values(array_filter($this->probe->dns($domain, 'TXT'), static fn (string $text): bool => str_starts_with(strtolower(trim($text)), 'v=spf1')));
        $results[] = match (true) {
            $spf === [] => PreflightResult::warning('Messagerie : SPF', 'Aucun enregistrement SPF (v=spf1) sur '.$domain.' : le courrier risque d\'être classé en indésirable.'),
            count($spf) > 1 => PreflightResult::warning('Messagerie : SPF', count($spf).' enregistrements SPF sur '.$domain.' : un seul est admis, les autres rendent le SPF invalide.'),
            default => PreflightResult::ok('Messagerie : SPF', $spf[0]),
        };

        $dmarc = array_values(array_filter($this->probe->dns('_dmarc.'.$domain, 'TXT'), static fn (string $text): bool => str_starts_with(strtoupper(trim($text)), 'V=DMARC1')));
        $results[] = $dmarc === []
            ? PreflightResult::warning('Messagerie : DMARC', 'Aucun enregistrement DMARC sur _dmarc.'.$domain.'.')
            : PreflightResult::ok('Messagerie : DMARC', $dmarc[0]);

        if ($dkimSelector === null || $dkimSelector === '') {
            $results[] = PreflightResult::info('Messagerie : DKIM', 'Sélecteur inconnu : le lire dans le panneau de messagerie, puis relancer avec --dkim-selector=<sélecteur>.');
        } else {
            $name = $dkimSelector.'._domainkey.'.$domain;
            $keys = [...$this->probe->dns($name, 'TXT'), ...$this->probe->dns($name, 'CNAME')];
            $published = array_filter($keys, static fn (string $value): bool => str_contains(strtolower($value), 'v=dkim1') || str_contains(strtolower($value), 'p=') || str_contains($value, '.'));
            $results[] = $published === []
                ? PreflightResult::warning('Messagerie : DKIM', 'Aucune clé publiée sur '.$name.'.')
                : PreflightResult::ok('Messagerie : DKIM', 'Clé publiée sur '.$name.'.');
        }

        if ($smtpHost === null || $smtpHost === '') {
            $results[] = PreflightResult::info('Messagerie : SMTP', 'Serveur SMTP non précisé : relancer avec --smtp-host=<hôte> (aucun courrier n\'est envoyé par ce contrôle).');
        } else {
            $smtp = $this->probe->smtp($smtpHost, $smtpPort);
            $label = 'Messagerie : SMTP '.$smtpHost.':'.$smtpPort;
            $results[] = match (true) {
                $smtp['banner'] === null => PreflightResult::warning($label, 'Le serveur ne répond pas ('.($smtp['error'] ?? 'sans détail').').'),
                $smtp['error'] !== null => PreflightResult::warning($label, $smtp['error'].' (bannière : '.$smtp['banner'].').'),
                $smtp['tls'] === null => PreflightResult::warning($label, 'Aucun chiffrement annoncé (ni STARTTLS ni TLS implicite) : les mots de passe passeraient en clair.'),
                default => PreflightResult::ok($label, 'Bannière « '.$smtp['banner'].' », chiffrement '.$smtp['tls'].'.'),
            };
        }

        return $results;
    }
}

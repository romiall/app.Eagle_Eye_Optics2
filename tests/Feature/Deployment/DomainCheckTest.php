<?php

namespace Tests\Feature\Deployment;

use App\Support\Deployment\PreflightResult;
use App\Support\Domain\DomainChecks;
use App\Support\Domain\DomainProbe;
use App\Support\Domain\NetworkDomainProbe;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Contrôle du domaine `eeo:domain:check` (L3D04, EE040) : verdict sur le DNS, le certificat, la redirection HTTP,
 * la sonde de santé, la messagerie (MX, SPF, DKIM, DMARC, SMTP) et code de sortie. Sondes simulées : aucun réseau,
 * donc aucun achat, aucune modification de zone et aucun courrier. Domaines fictifs (.test, .invalid).
 */
final class DomainCheckTest extends TestCase
{
    private const NOW = 1_795_000_000; // 2026-11-18 environ

    /**
     * @param  array<string, list<string>>  $dns  clé « TYPE nom »
     * @param  array<string, mixed>  $overrides
     */
    private function probe(array $dns = [], array $overrides = []): FakeDomainProbe
    {
        return new FakeDomainProbe($dns + [
            'A app.cabinet.test' => ['203.0.113.10'],
            'MX cabinet.test' => ['10 mx.cabinet.test'],
            'TXT cabinet.test' => ['v=spf1 include:_spf.messagerie.test ~all'],
            'TXT _dmarc.cabinet.test' => ['v=DMARC1; p=quarantine'],
            'TXT selecteur._domainkey.cabinet.test' => ['v=DKIM1; k=rsa; p=ABCDEF'],
        ], $overrides);
    }

    /**
     * @return array<string, PreflightResult>
     */
    private function verdicts(FakeDomainProbe $probe, ?string $mailDomain = 'cabinet.test', ?string $smtpHost = 'smtp.cabinet.test', ?string $dkim = 'selecteur'): array
    {
        $byLabel = [];
        foreach ((new DomainChecks($probe))->run('app.cabinet.test', $mailDomain, $smtpHost, 587, $dkim, self::NOW) as $result) {
            $byLabel[$result->label] = $result;
        }

        return $byLabel;
    }

    public function test_un_domaine_en_ordre_ne_donne_que_des_resultats_reussis(): void
    {
        $probe = $this->probe();
        $results = $this->verdicts($probe);

        foreach ($results as $label => $result) {
            $this->assertSame(PreflightResult::OK, $result->status, $label.' : '.$result->detail);
        }
        $this->assertCount(10, $results);
        $this->assertSame([], $probe->writes, 'Le contrôle ne fait que lire.');
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string, 2: string}>
     */
    public static function certificats(): array
    {
        return [
            'expiré' => [['valid_to' => self::NOW - 86400], PreflightResult::BLOCKING, 'expiré'],
            'non reconnu' => [['trusted' => false, 'error' => 'self signed certificate'], PreflightResult::BLOCKING, 'non reconnu'],
            'illisible' => [['valid_to' => null, 'error' => 'connexion refusée'], PreflightResult::BLOCKING, 'Aucun certificat'],
            'proche de l\'échéance' => [['valid_to' => self::NOW + 10 * 86400], PreflightResult::WARNING, '10 jour(s)'],
            'valide' => [['valid_to' => self::NOW + 80 * 86400], PreflightResult::OK, 'Valide jusqu\'au'],
        ];
    }

    /**
     * @param  array<string, mixed>  $certificate
     */
    #[DataProvider('certificats')]
    public function test_le_verdict_sur_le_certificat_https(array $certificate, string $status, string $needle): void
    {
        $results = $this->verdicts($this->probe(overrides: ['certificate' => $certificate]));

        $this->assertSame($status, $results['Application : certificat HTTPS']->status);
        $this->assertStringContainsString($needle, $results['Application : certificat HTTPS']->detail);
    }

    public function test_un_nom_qui_ne_se_resout_pas_est_bloquant(): void
    {
        $results = $this->verdicts($this->probe(['A app.cabinet.test' => []]));

        $this->assertSame(PreflightResult::BLOCKING, $results['Application : DNS']->status);
    }

    public function test_la_redirection_la_sonde_de_sante_et_hsts_sont_controlees(): void
    {
        $results = $this->verdicts($this->probe(overrides: [
            'http' => [
                'http://app.cabinet.test/up' => ['status' => 200, 'location' => null, 'body' => '{"status":"ok"}', 'headers' => [], 'error' => null],
                'https://app.cabinet.test/up' => ['status' => 503, 'location' => null, 'body' => '<html>', 'headers' => [], 'error' => null],
            ],
        ]));

        $this->assertSame(PreflightResult::WARNING, $results['Application : HTTP vers HTTPS']->status);
        $this->assertSame(PreflightResult::BLOCKING, $results['Application : sonde /up']->status);
        $this->assertStringContainsString('statut 503', $results['Application : sonde /up']->detail);
        $this->assertSame(PreflightResult::WARNING, $results['Application : HSTS']->status);
    }

    public function test_une_messagerie_incomplete_donne_des_alertes_jamais_un_point_bloquant(): void
    {
        $results = $this->verdicts($this->probe([
            'MX cabinet.test' => [],
            'TXT cabinet.test' => ['v=spf1 a ~all', 'v=spf1 mx ~all'],
            'TXT _dmarc.cabinet.test' => [],
            'TXT selecteur._domainkey.cabinet.test' => [],
        ], ['smtp' => ['banner' => '220 smtp.cabinet.test ESMTP', 'capabilities' => ['SIZE 1000'], 'tls' => null, 'error' => null]]));

        foreach (['Messagerie : MX', 'Messagerie : SPF', 'Messagerie : DMARC', 'Messagerie : DKIM', 'Messagerie : SMTP smtp.cabinet.test:587'] as $label) {
            $this->assertSame(PreflightResult::WARNING, $results[$label]->status, $label);
        }
        $this->assertStringContainsString('2 enregistrements SPF', $results['Messagerie : SPF']->detail);
        $this->assertStringContainsString('Aucun chiffrement', $results['Messagerie : SMTP smtp.cabinet.test:587']->detail);
        $this->assertSame([], array_filter($results, static fn (PreflightResult $result): bool => $result->isBlocking()));
    }

    public function test_sans_domaine_de_messagerie_ni_selecteur_ni_serveur_le_controle_le_dit_sans_deviner(): void
    {
        $withoutMail = $this->verdicts($this->probe(), null);
        $this->assertSame(PreflightResult::INFO, $withoutMail['Messagerie']->status);
        $this->assertArrayNotHasKey('Messagerie : MX', $withoutMail);

        $partial = $this->verdicts($this->probe(), 'cabinet.test', null, null);
        $this->assertSame(PreflightResult::INFO, $partial['Messagerie : DKIM']->status);
        $this->assertSame(PreflightResult::INFO, $partial['Messagerie : SMTP']->status);
    }

    public function test_la_commande_rend_un_rapport_json_et_son_code_de_sortie_suit_les_points_bloquants(): void
    {
        $this->app->instance(DomainProbe::class, $this->probe());

        $this->artisan('eeo:domain:check', ['--host' => 'app.cabinet.test', '--mail-domain' => 'cabinet.test', '--smtp-host' => 'smtp.cabinet.test', '--dkim-selector' => 'selecteur', '--json' => true])
            ->assertSuccessful();

        $this->app->instance(DomainProbe::class, $this->probe(['A app.cabinet.test' => []]));
        $this->artisan('eeo:domain:check', ['--host' => 'app.cabinet.test', '--mail-domain' => 'cabinet.test', '--json' => true])
            ->assertFailed();
    }

    public function test_une_configuration_de_demonstration_n_est_jamais_controlee(): void
    {
        config(['app.url' => 'http://localhost', 'mail.from.address' => 'hello@example.com']);
        $this->app->instance(DomainProbe::class, $this->probe());

        $this->artisan('eeo:domain:check')->assertFailed();
    }

    public function test_les_sondes_http_reelles_ne_suivent_pas_les_redirections_et_rendent_les_en_tetes(): void
    {
        Http::fake([
            'http://app.cabinet.test/up' => Http::response('', 301, ['Location' => 'https://app.cabinet.test/up']),
            'https://app.cabinet.test/up' => Http::response('{"status":"ok"}', 200, ['Strict-Transport-Security' => 'max-age=31536000']),
        ]);
        $probe = new NetworkDomainProbe;

        $redirect = $probe->http('http://app.cabinet.test/up');
        $this->assertSame(301, $redirect['status']);
        $this->assertSame('https://app.cabinet.test/up', $redirect['location']);
        $health = $probe->http('https://app.cabinet.test/up');
        $this->assertSame(200, $health['status']);
        $this->assertSame('max-age=31536000', $health['headers']['strict-transport-security']);
    }
}

/**
 * Sondes de test : réponses déterministes, aucune écriture possible (`writes` reste vide par construction).
 *
 * @internal
 */
final class FakeDomainProbe implements DomainProbe
{
    /** @var list<string> */
    public array $writes = [];

    /**
     * @param  array<string, list<string>>  $dns
     * @param  array<string, mixed>  $overrides
     */
    public function __construct(private readonly array $dns, private readonly array $overrides = []) {}

    public function certificate(string $host, int $port = 443): array
    {
        /** @var array<string, mixed> $override */
        $override = $this->overrides['certificate'] ?? [];

        return $override + [
            'trusted' => true,
            'valid_from' => self::now() - 30 * 86400,
            'valid_to' => self::now() + 60 * 86400,
            'subject' => $host,
            'issuer' => 'Autorité fictive',
            'error' => null,
        ];
    }

    public function http(string $url): array
    {
        /** @var array<string, array{status: int|null, location: string|null, body: string|null, headers: array<string, string>, error: string|null}> $responses */
        $responses = $this->overrides['http'] ?? [];

        return $responses[$url] ?? (str_starts_with($url, 'http://')
            ? ['status' => 301, 'location' => 'https://'.substr($url, 7), 'body' => '', 'headers' => [], 'error' => null]
            : ['status' => 200, 'location' => null, 'body' => '{"status":"ok"}', 'headers' => ['strict-transport-security' => 'max-age=31536000'], 'error' => null]);
    }

    public function dns(string $name, string $type): array
    {
        return $this->dns[strtoupper($type).' '.$name] ?? [];
    }

    public function smtp(string $host, int $port): array
    {
        /** @var array{banner: string|null, capabilities: list<string>, tls: string|null, error: string|null} $override */
        $override = $this->overrides['smtp'] ?? ['banner' => '220 '.$host.' ESMTP', 'capabilities' => ['STARTTLS', 'AUTH LOGIN'], 'tls' => 'STARTTLS', 'error' => null];

        return $override;
    }

    private static function now(): int
    {
        return 1_795_000_000;
    }
}

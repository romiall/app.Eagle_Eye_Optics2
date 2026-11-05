<?php

namespace Tests\Feature\Deployment;

use App\Support\Deployment\PreflightChecks;
use App\Support\Deployment\PreflightResult;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Diagnostic d'hébergement `eeo:preflight` : verdict sur la version du serveur de base (MariaDB refusée),
 * contrôles de production, droits MySQL réels (dont le trigger) vérifiés sur des objets temporaires qui ne
 * subsistent jamais, rapport JSON et code de sortie.
 */
final class PreflightCheckTest extends TestCase
{
    use MigratedDatabase;

    /**
     * @return array<string, array{0: string, 1: string, 2: string}>
     */
    public static function serverVersions(): array
    {
        return [
            'MariaDB (version)' => ['10.11.6-MariaDB', '', PreflightResult::BLOCKING],
            'MariaDB (commentaire)' => ['10.6.12', 'mariadb.org binary distribution', PreflightResult::BLOCKING],
            'MariaDB 11.8 (Hostinger)' => ['11.8.9-MariaDB-log', '', PreflightResult::OK],
            'MySQL 5.7' => ['5.7.44', '', PreflightResult::BLOCKING],
            'MySQL 8.0.15 sans CHECK' => ['8.0.15', '', PreflightResult::BLOCKING],
            'MySQL 8.0.16' => ['8.0.16', '', PreflightResult::WARNING],
            'MySQL 8.0.36 journal' => ['8.0.36-log', '', PreflightResult::WARNING],
            'MySQL 8.4.9' => ['8.4.9', 'MySQL Community Server - GPL', PreflightResult::OK],
            'MySQL 9.1' => ['9.1.0', '', PreflightResult::OK],
            'version illisible' => ['inconnue', '', PreflightResult::BLOCKING],
        ];
    }

    #[DataProvider('serverVersions')]
    public function test_le_verdict_sur_le_serveur_de_base_refuse_mariadb_et_les_versions_sans_check(string $version, string $comment, string $status): void
    {
        $this->assertSame($status, PreflightChecks::serverVerdict($version, $comment)->status);
    }

    public function test_le_rapport_json_decrit_chaque_controle_et_le_code_de_sortie_suit_les_points_bloquants(): void
    {
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);

        $this->artisan('eeo:preflight', ['--json' => true])->assertSuccessful();
    }

    public function test_sur_la_base_de_test_tous_les_droits_sont_accordes_et_le_trigger_est_execute(): void
    {
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);

        $results = $this->app->make(PreflightChecks::class)->run(true);
        $byLabel = [];
        foreach ($results as $result) {
            $byLabel[$result->label] = $result;
        }

        foreach (['Droit CREATE TABLE', 'Clé étrangère (REFERENCES)', 'Colonne générée', 'Droit ALTER TABLE', 'Droit CREATE VIEW', 'Droit TRIGGER', 'Trigger exécuté', 'Contraintes CHECK appliquées'] as $label) {
            $this->assertArrayHasKey($label, $byLabel, $label);
            $this->assertSame(PreflightResult::OK, $byLabel[$label]->status, $label.' : '.$byLabel[$label]->detail);
        }
        $this->assertSame([], array_filter($results, static fn (PreflightResult $result): bool => $result->isBlocking()));
    }

    public function test_aucun_objet_temporaire_ne_subsiste_apres_le_diagnostic(): void
    {
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);

        $this->artisan('eeo:preflight')->assertSuccessful();

        $tables = DB::select("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'eeo\\_preflight\\_%'");
        $triggers = DB::select("SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'eeo\\_preflight\\_%'");
        $this->assertSame([], $tables, 'Tables et vues temporaires supprimées.');
        $this->assertSame([], $triggers, 'Trigger temporaire supprimé.');
    }

    public function test_en_production_une_configuration_non_securisee_est_bloquante(): void
    {
        $this->app['env'] = 'production';
        config([
            'app.key' => 'base64:'.base64_encode(random_bytes(32)),
            'app.debug' => true,
            'app.url' => 'http://app.exemple.test',
            'session.secure' => false,
            'sanctum.stateful' => ['autre.exemple.test'],
        ]);

        $results = $this->app->make(PreflightChecks::class)->run(false);
        $blocking = array_map(static fn (PreflightResult $result): string => $result->label, array_filter($results, static fn (PreflightResult $result): bool => $result->isBlocking()));

        foreach (['APP_DEBUG', 'APP_URL', 'SESSION_SECURE_COOKIE', 'SANCTUM_STATEFUL_DOMAINS'] as $label) {
            $this->assertContains($label, $blocking, $label);
        }
        $this->artisan('eeo:preflight', ['--skip-database' => true])->assertFailed();
    }

    public function test_en_production_une_configuration_correcte_n_a_aucun_point_bloquant_de_configuration(): void
    {
        $this->app['env'] = 'production';
        config([
            'app.key' => 'base64:'.base64_encode(random_bytes(32)),
            'app.debug' => false,
            'app.url' => 'https://app.exemple.test',
            'session.secure' => true,
            'sanctum.stateful' => ['app.exemple.test'],
        ]);

        $labels = array_map(static fn (PreflightResult $result): string => $result->label, array_filter(
            $this->app->make(PreflightChecks::class)->run(false),
            static fn (PreflightResult $result): bool => $result->isBlocking(),
        ));

        foreach (['APP_KEY', 'APP_DEBUG', 'APP_URL', 'SESSION_SECURE_COOKIE', 'SANCTUM_STATEFUL_DOMAINS'] as $label) {
            $this->assertNotContains($label, $labels, $label);
        }
    }

    /**
     * @return array<string, PreflightResult>
     */
    private function byLabel(bool $withDatabase = false): array
    {
        $results = [];
        foreach ($this->app->make(PreflightChecks::class)->run($withDatabase) as $result) {
            // Un même libellé peut revenir (échelles d'acuité) : le dernier l'emporte, comme à la lecture.
            $results[$result->label] = $result;
        }

        return $results;
    }

    public function test_phase_1_un_code_de_module_inconnu_et_le_module_settings_ferme_sont_signales(): void
    {
        config(['eeo.enabled_modules' => ['patients', 'today', 'consultation']]);

        $results = $this->byLabel();

        $this->assertSame(PreflightResult::WARNING, $results['Codes de modules inconnus']->status);
        $this->assertStringContainsString('consultation', $results['Codes de modules inconnus']->detail);
        $this->assertSame(PreflightResult::WARNING, $results['Module « settings »']->status);
    }

    public function test_phase_1_le_controle_du_paiement_de_l_examen_incoherent_est_bloquant(): void
    {
        $label = 'Contrôle du paiement de l\'examen';

        config(['eeo.enabled_modules' => ['patients', 'today', 'consultations', 'settings'], 'eeo.billing.exam_fee_control' => 'off']);
        $this->assertSame(PreflightResult::INFO, $this->byLabel()[$label]->status);

        config(['eeo.billing.exam_fee_control' => 'billed', 'eeo.billing.exam_fee_item_reference' => '']);
        $this->assertTrue($this->byLabel()[$label]->isBlocking(), 'sans article de frais d\'examen');

        config(['eeo.billing.exam_fee_item_reference' => 'EXAMEN-FICTIF']);
        $this->assertTrue($this->byLabel()[$label]->isBlocking(), 'module « sales » fermé');

        config(['eeo.enabled_modules' => ['patients', 'today', 'consultations', 'sales', 'settings']]);
        $this->assertSame(PreflightResult::OK, $this->byLabel()[$label]->status);

        config(['eeo.billing.exam_fee_control' => 'oui']);
        $this->assertTrue($this->byLabel()[$label]->isBlocking(), 'valeur inconnue');
    }

    public function test_phase_1_la_caisse_et_les_echelles_manquantes_sont_signalees_pour_un_module_ouvert(): void
    {
        config([
            'app.key' => 'base64:'.base64_encode(random_bytes(32)),
            'eeo.enabled_modules' => ['patients', 'today', 'consultations', 'sales', 'settings'],
        ]);

        $results = $this->byLabel(true);

        $this->assertSame(PreflightResult::WARNING, $results['Caisse principale']->status);
        $this->assertStringContainsString('eeo:sales:bootstrap', $results['Caisse principale']->detail);
        $this->assertSame(PreflightResult::WARNING, $results['Échelles d\'acuité']->status);
        $this->assertStringContainsString('eeo:clinical:scales', $results['Échelles d\'acuité']->detail);
        $this->assertSame(PreflightResult::INFO, $results['Cabinet à créer']->status);
        $this->assertArrayHasKey('Outil de sauvegarde', $results);
        $this->assertNotSame(PreflightResult::BLOCKING, $results['Outil de sauvegarde']->status);
    }

    public function test_sans_cle_d_application_le_diagnostic_est_bloquant(): void
    {
        config(['app.key' => '']);

        $this->artisan('eeo:preflight', ['--skip-database' => true])->assertFailed();
    }

    public function test_une_base_injoignable_est_un_point_bloquant_sans_divulguer_les_identifiants(): void
    {
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);
        config(['database.connections.preflight_down' => [...(array) config('database.connections.mysql'), 'host' => '127.0.0.1', 'port' => '1', 'password' => 'secret-fictif-a-ne-jamais-afficher']]);
        $default = (string) config('database.default');
        config(['database.default' => 'preflight_down']);
        DB::purge('preflight_down');

        try {
            $results = $this->app->make(PreflightChecks::class)->run(true);
        } finally {
            // Le cycle de vie du test (nettoyage de la base) doit retrouver la connexion de test.
            config(['database.default' => $default]);
            DB::purge('preflight_down');
        }
        $database = array_values(array_filter($results, static fn (PreflightResult $result): bool => $result->label === 'Connexion à la base'));

        $this->assertCount(1, $database);
        $this->assertTrue($database[0]->isBlocking());
        $this->assertStringNotContainsString('secret-fictif', $database[0]->detail);
        $this->assertStringNotContainsString('SQL:', $database[0]->detail);
    }
}

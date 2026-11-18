<?php

namespace Tests\Feature\Schema;

use App\Support\Schema\BaselineStateRefused;
use App\Support\Schema\SchemaInspector;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\ScratchMysqlDatabases;
use Tests\TestCase;

/**
 * Preuve sur MySQL réel : les migrations reproduisent la baseline complète sur une base neuve, ne se
 * rejouent pas, et ne se défont jamais automatiquement (contrat 23, F04).
 */
final class BaselineMigrationsTest extends TestCase
{
    use ScratchMysqlDatabases;

    private const CONNECTION = 'mysql_schema';

    protected function setUp(): void
    {
        parent::setUp();
        $this->createScratchDatabase(self::CONNECTION, 'eeo_schema_migrate_test');
        [$status, $output] = $this->runArtisan('migrate', ['--database' => self::CONNECTION, '--force' => true]);
        $this->assertSame(0, $status, $output);
    }

    protected function tearDown(): void
    {
        $this->dropScratchDatabases();
        parent::tearDown();
    }

    /**
     * Artisan::output() vide le tampon à la lecture : on lit la sortie une seule fois par commande.
     *
     * @param  array<string, mixed>  $parameters
     * @return array{0: int, 1: string}
     */
    private function runArtisan(string $command, array $parameters = []): array
    {
        $status = Artisan::call($command, $parameters);

        return [$status, Artisan::output()];
    }

    public function test_une_base_neuve_migree_est_equivalente_a_la_baseline(): void
    {
        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);
        $this->assertSame(0, $status, $output);
        $this->assertStringContainsString('aucun écart', $output);

        $snapshot = SchemaInspector::for(DB::connection(self::CONNECTION))->snapshot();
        $this->assertSame(
            ['business_tables' => 117, 'foreign_keys' => 466, 'checks' => 488, 'views' => 10, 'triggers' => 88],
            $snapshot['counts'],
        );
        $this->assertSame(4, $snapshot['reference_data']['roles']['rows']);
        $this->assertSame(49, $snapshot['reference_data']['permissions']['rows']);
        $this->assertSame(76, $snapshot['reference_data']['clinical_terms']['rows']);

        $others = $snapshot['other_tables'];
        sort($others);
        $this->assertSame(['fw_cache', 'fw_cache_locks', 'fw_failed_jobs', 'fw_job_batches', 'fw_jobs', 'fw_sessions', 'migrations'], $others);

        $userId = DB::connection(self::CONNECTION)->selectOne(
            "SELECT column_type AS type, character_set_name AS charset, collation_name AS collation
               FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'fw_sessions' AND column_name = 'user_id'",
        );
        $this->assertSame(['char(26)', 'ascii', 'ascii_bin'], [$userId->type, $userId->charset, $userId->collation]);
    }

    public function test_un_second_migrate_n_execute_rien(): void
    {
        [$status, $output] = $this->runArtisan('migrate', ['--database' => self::CONNECTION, '--force' => true]);

        $this->assertSame(0, $status, $output);
        $this->assertStringContainsString('Nothing to migrate', $output);
    }

    public function test_les_guards_installes_protegent_reellement_une_ligne_append_only(): void
    {
        $db = DB::connection(self::CONNECTION);
        $clinic = str_pad('1', 26, '0', STR_PAD_LEFT);
        $db->insert('INSERT INTO clinics (id, name) VALUES (?, ?)', [$clinic, 'TEST CABINET']);
        $db->insert(
            'INSERT INTO audit_events (id, clinic_id, actor_name_snapshot, action, target_type, recorded_at, correlation_id, event_hash)
             VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?)',
            [str_pad('2', 26, '0', STR_PAD_LEFT), $clinic, 'TEST', 'test.action', 'clinics', 'TEST-CORRELATION', str_repeat('a', 64)],
        );

        try {
            $db->update("UPDATE audit_events SET action = 'modifiee'");
            $this->fail('La garde append-only aurait dû refuser la modification.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('Append-only history', $exception->getMessage());
        }

        try {
            $db->delete('DELETE FROM audit_events');
            $this->fail('La garde append-only aurait dû refuser la suppression.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('Append-only history', $exception->getMessage());
        }
    }

    public function test_un_ecart_introduit_apres_migration_est_detecte(): void
    {
        DB::connection(self::CONNECTION)->unprepared('ALTER TABLE patient_records MODIFY last_name VARCHAR(100) NOT NULL');

        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);

        $this->assertSame(1, $status, $output);
        $this->assertStringContainsString('tables.patient_records.columns.last_name.type', $output);
    }

    /**
     * IT01 : une migration qui perdrait une colonne générée, une FK, un CHECK ou un trigger est détectée.
     */
    public function test_it01_perte_de_colonne_generee_fk_check_ou_trigger_detectee(): void
    {
        $db = DB::connection(self::CONNECTION);
        $db->unprepared('ALTER TABLE stock_positions DROP COLUMN central_available');
        $db->unprepared('ALTER TABLE invoices DROP FOREIGN KEY fk_invoices_01');
        $db->unprepared('ALTER TABLE payments DROP CHECK ck_payments_01');
        $db->unprepared('DROP TRIGGER tr_invoices_update_guard');

        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);

        $this->assertSame(1, $status, $output);
        foreach ([
            'tables.stock_positions.columns.central_available',
            'tables.invoices.foreign_keys.fk_invoices_01',
            'tables.payments.checks.ck_payments_01',
            'triggers.tr_invoices_update_guard',
        ] as $path) {
            $this->assertStringContainsString($path, $output);
        }
    }

    public function test_l_alias_eeo_schema_verify_reste_disponible(): void
    {
        [$status, $output] = $this->runArtisan('eeo:schema:verify', ['--database' => self::CONNECTION]);

        $this->assertSame(0, $status, $output);
    }

    public function test_le_retour_arriere_est_refuse_sans_rien_supprimer(): void
    {
        try {
            Artisan::call('migrate:rollback', ['--database' => self::CONNECTION, '--force' => true]);
            $this->fail('Le retour arrière de la baseline aurait dû être refusé.');
        } catch (BaselineStateRefused $exception) {
            $this->assertStringContainsString('ne se défait pas automatiquement', $exception->getMessage());
        }

        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);
        $this->assertSame(0, $status, $output);
        $this->assertStringContainsString('fw_sessions', $output, 'Les tables techniques, migrées en premier, sont toujours là.');
    }

    public function test_la_methode_down_de_chaque_etape_de_baseline_refuse(): void
    {
        $files = glob(base_path('database/migrations/*_eeo_baseline_*.php')) ?: [];
        $this->assertCount(4, $files);

        foreach ($files as $file) {
            $migration = require $file;

            try {
                $migration->down();
                $this->fail(basename($file).' : down() aurait dû refuser.');
            } catch (BaselineStateRefused $exception) {
                $this->assertStringContainsString('Refus', $exception->getMessage());
            }
        }
    }
}

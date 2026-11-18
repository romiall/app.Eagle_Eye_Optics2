<?php

namespace Tests\Feature\Schema;

use App\Support\Schema\BaselineInstaller;
use App\Support\Schema\BaselineStateRefused;
use App\Support\Schema\ExpectedSchema;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\ScratchMysqlDatabases;
use Tests\TestCase;

/**
 * Adoption contrôlée d'une base créée hors migrations (contrat 23). La base « importée » est construite ici
 * avec la même liste d'instructions que le SQL livré ; l'import réel par le client mysql est prouvé par
 * tools/dev/schema-parity.sh (docs/evidence/schema-parity.json).
 */
final class AdoptBaselineTest extends TestCase
{
    use ScratchMysqlDatabases;

    private const CONNECTION = 'mysql_adopt';

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

    private function importedDatabase(string $name): void
    {
        $this->createScratchDatabase(self::CONNECTION, $name);
        BaselineInstaller::for(DB::connection(self::CONNECTION))->installAll();
    }

    /**
     * @return list<string>
     */
    private function recordedMigrations(): array
    {
        if (! Schema::connection(self::CONNECTION)->hasTable('migrations')) {
            return [];
        }

        return DB::connection(self::CONNECTION)->table('migrations')->orderBy('id')->pluck('migration')->all();
    }

    public function test_une_base_equivalente_est_adoptee_une_seule_fois_puis_completee_par_migrate(): void
    {
        $this->importedDatabase('eeo_schema_adopt_test');
        $adopt = ['--database' => self::CONNECTION, '--force' => true];

        [$status, $output] = $this->runArtisan('eeo:schema:adopt', ['--database' => self::CONNECTION, '--dry-run' => true]);
        $this->assertSame(0, $status, $output);
        $this->assertStringContainsString('adoption possible', $output);
        $this->assertSame([], $this->recordedMigrations(), '--dry-run ne doit rien écrire');

        [$status, $output] = $this->runArtisan('eeo:schema:adopt', $adopt);
        $this->assertSame(0, $status, $output);
        $this->assertSame(ExpectedSchema::BASELINE_MIGRATIONS, $this->recordedMigrations());

        [$status, $output] = $this->runArtisan('eeo:schema:adopt', $adopt);
        $this->assertSame(1, $status, $output);
        $this->assertStringContainsString('déjà enregistrée', $output);

        [$status, $output] = $this->runArtisan('migrate', ['--database' => self::CONNECTION, '--force' => true]);
        $this->assertSame(0, $status, $output);
        $this->assertSame(
            [...ExpectedSchema::BASELINE_MIGRATIONS, '2026_10_14_000000_create_framework_tables', '2026_11_18_000001_update_cash_movements_for_expenses_and_sync'],
            $this->recordedMigrations(),
        );

        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);
        $this->assertSame(0, $status, $output);
        $this->assertStringContainsString('4 / 4', $output);
    }

    public function test_une_base_divergente_est_refusee_sans_aucune_ecriture(): void
    {
        $this->importedDatabase('eeo_schema_adopt_bad_test');
        DB::connection(self::CONNECTION)->unprepared('DROP TRIGGER tr_receipts_update_guard');
        DB::connection(self::CONNECTION)->unprepared('CREATE TABLE intrus (id INT PRIMARY KEY) ENGINE=InnoDB');

        [$status, $output] = $this->runArtisan('eeo:schema:adopt', ['--database' => self::CONNECTION, '--force' => true]);

        $this->assertSame(1, $status, $output);
        $this->assertStringContainsString('Adoption refusée', $output);
        $this->assertStringContainsString('triggers.tr_receipts_update_guard', $output);
        $this->assertStringContainsString('other_tables.intrus', $output);
        $this->assertFalse(Schema::connection(self::CONNECTION)->hasTable('migrations'));
    }

    public function test_un_referentiel_modifie_empeche_l_adoption(): void
    {
        $this->importedDatabase('eeo_schema_adopt_ref_test');
        DB::connection(self::CONNECTION)->update("UPDATE clinical_terms SET label = 'Libellé modifié' WHERE group_code = 'LENS_TREATMENT' AND code = 'HMC'");

        [$status, $output] = $this->runArtisan('eeo:schema:adopt', ['--database' => self::CONNECTION, '--force' => true]);

        $this->assertSame(1, $status, $output);
        $this->assertStringContainsString('reference_data.clinical_terms.sha256', $output);
        $this->assertFalse(Schema::connection(self::CONNECTION)->hasTable('migrations'));
    }

    public function test_migrate_sur_une_base_deja_initialisee_est_refuse_et_renvoie_a_l_adoption(): void
    {
        $this->importedDatabase('eeo_schema_double_test');

        try {
            Artisan::call('migrate', ['--database' => self::CONNECTION, '--force' => true]);
            $this->fail('migrate aurait dû refuser une base déjà initialisée.');
        } catch (BaselineStateRefused $exception) {
            $this->assertStringContainsString('eeo:schema:adopt', $exception->getMessage());
        }

        $this->assertSame([], array_values(array_intersect(ExpectedSchema::BASELINE_MIGRATIONS, $this->recordedMigrations())));

        [$status, $output] = $this->runArtisan('eagle:verify-schema', ['--database' => self::CONNECTION]);
        $this->assertSame(0, $status, $output);
    }
}

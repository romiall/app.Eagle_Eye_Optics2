<?php

namespace Tests\Unit\Schema;

use App\Support\Schema\BaselineStatements;
use App\Support\Schema\ExpectedSchema;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * Liste structurée des instructions de la baseline (contrat 23) : complète, sans DELIMITER, un trigger
 * complet par instruction, et refusée dès qu'elle est altérée.
 */
final class BaselineStatementsTest extends TestCase
{
    private static function root(): string
    {
        return dirname(__DIR__, 3);
    }

    private static function statementsPath(): string
    {
        return self::root().'/'.BaselineStatements::RELATIVE_PATH;
    }

    public function test_la_baseline_contient_les_117_tables_464_fk_88_guards_10_vues_et_6_referentiels(): void
    {
        $baseline = BaselineStatements::load(self::statementsPath());

        $this->assertCount(117, $baseline->businessTables());
        $this->assertCount(117, array_unique($baseline->businessTables()));
        $this->assertCount(88, $baseline->triggers());
        $this->assertCount(10, $baseline->views());
        $this->assertSame(BaselineStatements::REFERENCE_TABLES, array_column($baseline->entries('03_reference_data'), 'table'));
        $this->assertSame(466, array_sum(array_column($baseline->entries('02_foreign_keys'), 'foreign_keys')));
        $this->assertSame(488, $baseline->counts()['checks']);
        $this->assertContains('patient_records', $baseline->businessTables());
        $this->assertContains('invoices', $baseline->businessTables());
        $this->assertContains('sync_command_results', $baseline->businessTables());
    }

    public function test_chaque_instruction_est_unique_et_exempte_des_constructions_interdites(): void
    {
        $baseline = BaselineStatements::load(self::statementsPath());

        foreach (BaselineStatements::STEPS as $step) {
            foreach ($baseline->statements($step) as $sql) {
                $this->assertStringNotContainsString('DELIMITER', $sql);
                $this->assertStringNotContainsStringIgnoringCase('IF NOT EXISTS', $sql);
                $this->assertStringNotContainsStringIgnoringCase('INSERT IGNORE', $sql);
                $this->assertStringEndsNotWith(';', rtrim($sql));
            }
        }

        foreach ($baseline->entries('04_guards') as $trigger) {
            $this->assertStringStartsWith('CREATE TRIGGER `'.$trigger['name'].'` BEFORE ', $trigger['sql']);
            $this->assertStringEndsWith("\nEND", $trigger['sql']);
            $this->assertSame(1, substr_count($trigger['sql'], 'CREATE TRIGGER'));
            $this->assertStringNotContainsString('$$', $trigger['sql']);
        }

        foreach ($baseline->statements('01_tables') as $sql) {
            $this->assertStringStartsWith('CREATE TABLE `', $sql);
            $this->assertStringContainsString('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci', $sql);
            $this->assertStringNotContainsString('FOREIGN KEY', $sql, 'Les FK sont ajoutées après toutes les tables.');
        }
    }

    public function test_la_session_reprend_celle_de_01_schema(): void
    {
        $session = BaselineStatements::load(self::statementsPath())->session();

        $this->assertSame('utf8mb4', $session['names']);
        $this->assertSame('utf8mb4_0900_ai_ci', $session['collation']);
        $this->assertSame('+00:00', $session['time_zone']);
        $this->assertSame('STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY', $session['sql_mode']);
    }

    public function test_les_empreintes_correspondent_au_catalogue_et_aux_scripts_livres(): void
    {
        $baseline = BaselineStatements::load(self::statementsPath());
        $backlog = json_decode((string) file_get_contents(self::root().'/specifications/developpement/backlog.json'), true);

        $this->assertIsArray($backlog);
        $this->assertSame($backlog['baseline_catalog_sha256'], $baseline->catalogSha256());

        foreach ($baseline->sourcesSha256() as $file => $hash) {
            $this->assertSame(hash_file('sha256', self::root().'/database/'.$file), $hash, $file.' a changé : relancer database/tools/build_migrations.py');
        }
    }

    public function test_les_migrations_de_baseline_existent_sous_ces_noms(): void
    {
        foreach (ExpectedSchema::BASELINE_MIGRATIONS as $migration) {
            $this->assertFileExists(self::root().'/database/migrations/'.$migration.'.php');
        }
    }

    public function test_un_trigger_avec_delimiter_est_refuse(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('DELIMITER');

        $this->loadAltered(function (array &$data): void {
            $data['steps']['04_guards'][0]['sql'] = "DELIMITER $$\n".$data['steps']['04_guards'][0]['sql'];
        });
    }

    public function test_un_insert_ignore_est_refuse(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('INSERT IGNORE');

        $this->loadAltered(function (array &$data): void {
            $data['steps']['03_reference_data'][0]['sql'] = str_replace('INSERT INTO', 'INSERT IGNORE INTO', $data['steps']['03_reference_data'][0]['sql']);
        });
    }

    public function test_une_table_manquante_est_refusee(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('116 instructions');

        $this->loadAltered(function (array &$data): void {
            array_pop($data['steps']['01_tables']);
        });
    }

    public function test_une_session_injectee_est_refusee(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('sql_mode');

        $this->loadAltered(function (array &$data): void {
            $data['session']['sql_mode'] = "STRICT_TRANS_TABLES'; DROP TABLE users; --";
        });
    }

    /**
     * @param  callable(array<string, mixed>&): void  $alter
     */
    private function loadAltered(callable $alter): void
    {
        $data = json_decode((string) file_get_contents(self::statementsPath()), true);
        $this->assertIsArray($data);
        $alter($data);

        $file = tempnam(sys_get_temp_dir(), 'eeo-baseline-');
        $this->assertIsString($file);
        file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE));

        try {
            BaselineStatements::load($file);
        } finally {
            unlink($file);
        }
    }
}

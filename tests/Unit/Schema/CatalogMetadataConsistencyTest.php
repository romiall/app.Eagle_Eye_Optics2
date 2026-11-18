<?php

namespace Tests\Unit\Schema;

use App\Support\Schema\ExpectedSchema;
use PHPUnit\Framework\TestCase;

/**
 * Comparaison catalogue canonique ↔ métadonnées attendues (F04) : chaque table, colonne, clé, CHECK, FK et
 * garde du catalogue doit se retrouver, sous le même nom, dans la photographie MySQL de la baseline que les
 * migrations doivent reproduire.
 */
final class CatalogMetadataConsistencyTest extends TestCase
{
    /** @var list<array<string, mixed>> */
    private static array $catalog;

    /** @var array<string, mixed> */
    private static array $snapshot;

    public static function setUpBeforeClass(): void
    {
        $root = dirname(__DIR__, 3);
        $catalog = json_decode((string) file_get_contents($root.'/database/schema_catalog.json'), true);
        self::$catalog = $catalog['tables'];
        self::$snapshot = ExpectedSchema::load($root.'/'.ExpectedSchema::RELATIVE_PATH)->snapshot;
    }

    public function test_les_memes_117_tables_avec_moteur_collation_et_commentaire(): void
    {
        $names = array_column(self::$catalog, 'name');
        sort($names);
        $actual = array_keys(self::$snapshot['tables']);
        sort($actual);

        $this->assertCount(117, $names);
        $this->assertSame($names, $actual);
        $this->assertSame([], self::$snapshot['missing_business_tables']);

        foreach (self::$catalog as $table) {
            $meta = self::$snapshot['tables'][$table['name']];
            $this->assertSame('InnoDB', $meta['engine'], $table['name']);
            $this->assertSame('utf8mb4_0900_ai_ci', $meta['collation'], $table['name']);
            $this->assertSame($table['description'], $meta['comment'], $table['name']);
        }
    }

    public function test_colonnes_dans_le_meme_ordre_avec_type_nullabilite_defaut_et_calcul(): void
    {
        foreach (self::$catalog as $table) {
            $meta = self::$snapshot['tables'][$table['name']]['columns'];
            $this->assertSame(array_column($table['columns'], 'name'), array_keys($meta), $table['name']);

            foreach ($table['columns'] as $index => $column) {
                $where = $table['name'].'.'.$column['name'];
                $actual = $meta[$column['name']];
                [$type, $charset, $collation, $autoIncrement] = $this->normaliseType($column['type']);

                $this->assertSame($index + 1, $actual['position'], $where);
                $this->assertSame($type, $actual['type'], $where);
                if ($charset !== null) {
                    $this->assertSame($charset, $actual['charset'], $where);
                    $this->assertSame($collation, $actual['collation'], $where);
                }
                $this->assertSame($column['description'], $actual['comment'], $where);
                $this->assertSame($autoIncrement, str_contains($actual['extra'], 'auto_increment'), $where.' : auto_increment');

                if ($column['generated'] !== null) {
                    $this->assertStringContainsString('STORED GENERATED', $actual['extra'], $where);
                    $this->assertNotSame('', $actual['generation'], $where);
                } else {
                    $this->assertSame($column['nullable'] ? 'YES' : 'NO', $actual['nullable'], $where);
                    $this->assertSame('', $actual['generation'], $where);
                    $this->assertSame($column['default'] === null, $actual['default'] === null, $where.' : présence du défaut');
                }
            }
        }
    }

    public function test_cles_primaires_uniques_et_index_sous_les_noms_du_generateur(): void
    {
        foreach (self::$catalog as $table) {
            $indexes = self::$snapshot['tables'][$table['name']]['indexes'];
            $columns = static fn (string $name): array => array_column($indexes[$name]['columns'] ?? [], 'column');

            $this->assertSame($table['primary'], $columns('PRIMARY'), $table['name']);
            $expected = ['PRIMARY'];

            foreach ($table['unique'] as $i => $key) {
                $name = sprintf('uq_%s_%02d', $table['name'], $i + 1);
                $this->assertSame($key, $columns($name), $name);
                $this->assertTrue($indexes[$name]['unique'], $name);
                $expected[] = $name;
            }

            foreach ($table['indexes'] as $i => $key) {
                $name = sprintf('ix_%s_%02d', $table['name'], $i + 1);
                $this->assertSame($key, $columns($name), $name);
                $this->assertFalse($indexes[$name]['unique'], $name);
                $expected[] = $name;
            }

            sort($expected);
            $this->assertSame($expected, array_keys($indexes), $table['name'].' : aucun index en plus ou en moins');
        }
    }

    public function test_tous_les_check_et_toutes_les_fk_sans_cascade(): void
    {
        $checks = 0;
        $foreignKeys = 0;

        foreach (self::$catalog as $table) {
            $meta = self::$snapshot['tables'][$table['name']];

            $expectedChecks = [];
            foreach ($table['checks'] as $i => $expression) {
                $expectedChecks[] = sprintf('ck_%s_%02d', $table['name'], $i + 1);
            }
            $this->assertSame($expectedChecks, array_keys($meta['checks']), $table['name']);
            foreach ($meta['checks'] as $name => $check) {
                $this->assertSame('YES', $check['enforced'], $name);
            }
            $checks += count($expectedChecks);

            $expectedFks = [];
            foreach ($table['foreign'] as $i => $fk) {
                $name = sprintf('fk_%s_%02d', $table['name'], $i + 1);
                $expectedFks[] = $name;
                $actual = $meta['foreign_keys'][$name] ?? null;
                $this->assertNotNull($actual, $name);
                $this->assertSame($fk['target'], $actual['target'], $name);
                $this->assertSame($fk['columns'], $actual['columns'], $name);
                $this->assertSame($fk['target_columns'], $actual['target_columns'], $name);
                $this->assertNotSame('CASCADE', $actual['delete_rule'], $name);
                $this->assertNotSame('CASCADE', $actual['update_rule'], $name);
            }
            $this->assertSame($expectedFks, array_keys($meta['foreign_keys']), $table['name']);
            $foreignKeys += count($expectedFks);
        }

        $this->assertSame(488, $checks);
        $this->assertSame(466, $foreignKeys);
    }

    public function test_chaque_table_append_only_ou_gardee_a_ses_triggers(): void
    {
        $triggers = self::$snapshot['triggers'];
        $childGuards = ['invoice_child', 'credit_child', 'prescription_child', 'goods_child', 'inventory_child', 'delivery_child'];

        foreach (self::$catalog as $table) {
            $name = $table['name'];
            $events = [];
            if ($table['immutable']) {
                $events = ['update', 'delete'];
            } elseif (in_array($table['guard'], $childGuards, true)) {
                $events = ['insert', 'update', 'delete'];
            } elseif ($table['guard'] !== null) {
                $events = ['update', 'delete'];
            }

            foreach ($events as $event) {
                $trigger = 'tr_'.$name.'_'.$event.'_guard';
                $this->assertArrayHasKey($trigger, $triggers);
                $this->assertSame($name, $triggers[$trigger]['table']);
                $this->assertSame(strtoupper($event), $triggers[$trigger]['event']);
                $this->assertSame('BEFORE', $triggers[$trigger]['timing']);
            }
        }

        $this->assertCount(88, $triggers);
    }

    /**
     * @return array{0: string, 1: ?string, 2: ?string, 3: bool} type MySQL affiché, jeu de caractères et collation explicites, auto-incrément
     */
    private function normaliseType(string $type): array
    {
        $charset = null;
        $collation = null;
        $autoIncrement = str_ends_with($type, ' AUTO_INCREMENT');
        if ($autoIncrement) {
            $type = substr($type, 0, -strlen(' AUTO_INCREMENT'));
        }

        if (preg_match('/^(.*) CHARACTER SET (\w+) COLLATE (\w+)$/', $type, $m) === 1) {
            [$type, $charset, $collation] = [$m[1], $m[2], $m[3]];
        }

        $type = strtolower($type);

        return [$type === 'boolean' ? 'tinyint(1)' : $type, $charset, $collation, $autoIncrement];
    }
}

<?php

namespace App\Support\Schema;

use RuntimeException;

/**
 * Liste structurée des instructions SQL de la baseline (117 tables métier, FK, référentiels, vues, guards).
 *
 * Le fichier database/baseline/statements.json est produit par database/tools/build_migrations.py depuis
 * le catalogue canonique et les scripts SQL validés ; ce générateur vérifie que la concaténation des
 * instructions redonne exactement les fichiers livrés. Cette classe ne réécrit ni ne corrige aucune
 * instruction : elle refuse un fichier incomplet ou contraire au contrat 23.
 */
final class BaselineStatements
{
    public const RELATIVE_PATH = 'database/baseline/statements.json';

    /** Ordre d'exécution des étapes de la baseline. */
    public const STEPS = ['01_tables', '02_foreign_keys', '03_reference_data', '03_views', '04_guards'];

    /** Compteurs de la baseline validée sur MySQL 8.4.9 (database/VALIDATION.md). */
    public const EXPECTED_COUNTS = [
        'tables' => 117,
        'foreign_keys' => 466,
        'checks' => 488,
        'views' => 10,
        'triggers' => 88,
        'reference_inserts' => 6,
    ];

    /** Tables globales chargées par 02_reference_data.sql. */
    public const REFERENCE_TABLES = ['roles', 'permissions', 'role_permissions', 'clinical_terms', 'catalog_categories', 'units'];

    /** Constructions refusées dans une instruction exécutée par PDO (contrat 23). */
    private const FORBIDDEN_FRAGMENTS = ['DELIMITER', 'IF NOT EXISTS', 'INSERT IGNORE', 'DROP ', 'TRUNCATE'];

    private static ?self $cached = null;

    /**
     * @param  array<string, mixed>  $data
     */
    private function __construct(private readonly array $data) {}

    public static function load(?string $path = null): self
    {
        if ($path === null && self::$cached !== null) {
            return self::$cached;
        }

        $file = $path ?? base_path(self::RELATIVE_PATH);
        $raw = is_file($file) ? file_get_contents($file) : false;

        if ($raw === false) {
            throw new RuntimeException('Baseline introuvable : '.$file.' (générer avec python3 database/tools/build_migrations.py).');
        }

        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);

        if (! is_array($data)) {
            throw new RuntimeException('Baseline illisible : '.$file);
        }

        $baseline = new self($data);
        $baseline->validate();

        if ($path === null) {
            self::$cached = $baseline;
        }

        return $baseline;
    }

    /**
     * @return list<string>
     */
    public function statements(string $step): array
    {
        return array_map(static fn (array $entry): string => $entry['sql'], $this->entries($step));
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function entries(string $step): array
    {
        if (! in_array($step, self::STEPS, true)) {
            throw new RuntimeException('Étape de baseline inconnue : '.$step);
        }

        /** @var list<array<string, mixed>> $entries */
        $entries = $this->data['steps'][$step];

        return $entries;
    }

    /**
     * @return list<string> Les 117 tables métier, dans l'ordre du catalogue.
     */
    public function businessTables(): array
    {
        return array_map(static fn (array $entry): string => $entry['table'], $this->entries('01_tables'));
    }

    /**
     * @return list<string>
     */
    public function views(): array
    {
        return array_map(static fn (array $entry): string => $entry['view'], $this->entries('03_views'));
    }

    /**
     * @return list<string>
     */
    public function triggers(): array
    {
        return array_map(static fn (array $entry): string => $entry['name'], $this->entries('04_guards'));
    }

    /**
     * @return array{names: string, collation: string, time_zone: string, sql_mode: string}
     */
    public function session(): array
    {
        /** @var array{names: string, collation: string, time_zone: string, sql_mode: string} $session */
        $session = $this->data['session'];

        return $session;
    }

    /**
     * @return array<string, int>
     */
    public function counts(): array
    {
        /** @var array<string, int> $counts */
        $counts = $this->data['counts'];

        return $counts;
    }

    public function catalogSha256(): string
    {
        return (string) $this->data['baseline_catalog_sha256'];
    }

    /**
     * @return array<string, string>
     */
    public function sourcesSha256(): array
    {
        /** @var array<string, string> $sources */
        $sources = $this->data['sources_sha256'];

        return $sources;
    }

    private function validate(): void
    {
        foreach (['steps', 'session', 'counts', 'baseline_catalog_sha256', 'sources_sha256'] as $key) {
            if (! array_key_exists($key, $this->data)) {
                throw new RuntimeException('Baseline incomplète : clé « '.$key.' » absente.');
            }
        }

        foreach (self::STEPS as $step) {
            $entries = $this->data['steps'][$step] ?? null;

            if (! is_array($entries) || $entries === [] || ! array_is_list($entries)) {
                throw new RuntimeException('Baseline incomplète : étape « '.$step.' » vide ou absente.');
            }

            foreach ($entries as $index => $entry) {
                $sql = is_array($entry) ? ($entry['sql'] ?? null) : null;

                if (! is_string($sql) || trim($sql) === '' || str_ends_with(rtrim($sql), ';')) {
                    throw new RuntimeException(sprintf('Instruction %d de « %s » invalide.', $index, $step));
                }

                foreach (self::FORBIDDEN_FRAGMENTS as $fragment) {
                    if (str_contains(strtoupper($sql), $fragment)) {
                        throw new RuntimeException(sprintf('Instruction %d de « %s » contient « %s » : refusé (contrat 23).', $index, $step, trim($fragment)));
                    }
                }
            }
        }

        $counts = $this->counts();
        foreach (self::EXPECTED_COUNTS as $key => $expected) {
            if (($counts[$key] ?? null) !== $expected) {
                throw new RuntimeException(sprintf('Baseline : compteur « %s » = %s, attendu %d.', $key, var_export($counts[$key] ?? null, true), $expected));
            }
        }

        $this->assertCount('01_tables', self::EXPECTED_COUNTS['tables']);
        $this->assertCount('03_views', self::EXPECTED_COUNTS['views']);
        $this->assertCount('04_guards', self::EXPECTED_COUNTS['triggers']);
        $this->assertCount('03_reference_data', self::EXPECTED_COUNTS['reference_inserts']);

        $foreignKeys = array_sum(array_map(static fn (array $entry): int => (int) ($entry['foreign_keys'] ?? 0), $this->entries('02_foreign_keys')));
        if ($foreignKeys !== self::EXPECTED_COUNTS['foreign_keys']) {
            throw new RuntimeException('Baseline : '.$foreignKeys.' FK dans les instructions, attendu '.self::EXPECTED_COUNTS['foreign_keys'].'.');
        }

        foreach ($this->entries('04_guards') as $entry) {
            if (! str_starts_with($entry['sql'], 'CREATE TRIGGER `'.$entry['name'].'` ') || ! str_ends_with($entry['sql'], "\nEND")) {
                throw new RuntimeException('Trigger « '.$entry['name'].' » : instruction incomplète.');
            }
        }

        $referenceTables = array_map(static fn (array $entry): string => (string) $entry['table'], $this->entries('03_reference_data'));
        if ($referenceTables !== self::REFERENCE_TABLES) {
            throw new RuntimeException('Baseline : référentiels inattendus ('.implode(', ', $referenceTables).').');
        }

        $session = $this->data['session'];
        $patterns = [
            'names' => '/^utf8mb4$/',
            'collation' => '/^utf8mb4_[a-z0-9_]+$/',
            'time_zone' => '/^[+-]\d{2}:\d{2}$/',
            'sql_mode' => '/^[A-Z_]+(,[A-Z_]+)*$/',
        ];
        foreach ($patterns as $key => $pattern) {
            if (! is_array($session) || ! is_string($session[$key] ?? null) || preg_match($pattern, $session[$key]) !== 1) {
                throw new RuntimeException('Baseline : paramètre de session « '.$key.' » invalide.');
            }
        }
    }

    private function assertCount(string $step, int $expected): void
    {
        $actual = count($this->entries($step));

        if ($actual !== $expected) {
            throw new RuntimeException(sprintf('Baseline : %d instructions dans « %s », attendu %d.', $actual, $step, $expected));
        }
    }
}

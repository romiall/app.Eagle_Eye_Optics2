<?php

namespace App\Support\Schema;

use Illuminate\Database\Connection;
use RuntimeException;

/**
 * Exécute les étapes de la baseline dans la session SQL des scripts livrés (contrat 23).
 *
 * Chaque instruction, y compris chaque CREATE TRIGGER complet, est envoyée seule par PDO, sans DELIMITER.
 * MySQL valide implicitement chaque DDL : une étape interrompue laisse un schéma partiel. Les contrôles
 * préalables refusent alors de rejouer l'étape par-dessus (aucun IF NOT EXISTS pour masquer l'état) ; la
 * correction se fait sur une nouvelle base vide, jamais en supprimant des données de production.
 */
final class BaselineInstaller
{
    /** CHECK appliqués par MySQL à partir de 8.0.16 ; la baseline est validée sur 8.4.9. */
    public const MINIMUM_MYSQL_VERSION = '8.0.16';

    public function __construct(
        private readonly Connection $connection,
        private readonly BaselineStatements $baseline,
    ) {}

    public static function for(Connection $connection): self
    {
        return new self($connection, BaselineStatements::load());
    }

    public function assertSupportedServer(): void
    {
        if ($this->connection->getDriverName() !== 'mysql') {
            throw new RuntimeException('La baseline exige MySQL (pilote actuel : '.$this->connection->getDriverName().').');
        }

        $version = (string) $this->connection->selectOne('SELECT VERSION() AS v')->v;

        if (stripos($version, 'mariadb') !== false) {
            $num = preg_match('/^(\d+\.\d+\.\d+)/', $version, $match) === 1 ? $match[1] : '0.0.0';
            if (version_compare($num, '11.4.0', '<')) {
                throw new RuntimeException('MariaDB n\'est pas validé pour cette baseline avant 11.4 (serveur : '.$version.').');
            }

            return;
        }

        if (version_compare(preg_replace('/[^0-9.].*$/', '', $version) ?? '', self::MINIMUM_MYSQL_VERSION, '<')) {
            throw new RuntimeException('MySQL '.self::MINIMUM_MYSQL_VERSION.' minimum requis, serveur : '.$version.'.');
        }
    }

    /**
     * @return list<string> Tables métier de la baseline déjà présentes dans la base courante.
     */
    public function existingBusinessTables(): array
    {
        $present = $this->connection->table('information_schema.tables')
            ->selectRaw('table_name AS name')
            ->whereRaw('table_schema = DATABASE()')
            ->where('table_type', 'BASE TABLE')
            ->pluck('name')
            ->map(static fn (mixed $name): string => is_scalar($name) ? (string) $name : '')
            ->all();

        return array_values(array_intersect($this->baseline->businessTables(), $present));
    }

    public function installTables(): void
    {
        $existing = $this->existingBusinessTables();

        if ($existing !== []) {
            throw new BaselineStateRefused(sprintf(
                'La base contient déjà %d table(s) métier de la baseline (%s…) sans trace de migration. '
                .'Si elle a été créée par le SQL livré : php artisan eeo:schema:adopt. '
                .'Si une installation a été interrompue : recommencer sur une base vide, sans supprimer de données de production.',
                count($existing),
                implode(', ', array_slice($existing, 0, 3)),
            ));
        }

        $this->run('01_tables');
    }

    public function installForeignKeys(): void
    {
        $this->assertAllBusinessTablesPresent('02_foreign_keys');
        $existing = (int) $this->connection->selectOne(
            'SELECT COUNT(*) AS n FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()',
        )->n;

        if ($existing > 0) {
            throw new BaselineStateRefused($existing.' clé(s) étrangère(s) déjà présente(s) : installation partielle ou base déjà initialisée, étape 02 refusée.');
        }

        // Tables fraîchement créées par l'étape 01, donc vides : il n'y a aucune ligne à vérifier. Avec la
        // vérification des clés étrangères active, MySQL ajoute chaque clé par recopie de la table (ALGORITHM=COPY) ;
        // sans elle, par ALGORITHM=INPLACE, 10 à 20 fois plus vite (0,05 s contre 1 s par clé sur un disque lent, 464
        // clés). Le schéma obtenu est identique ; si une table contenait déjà des lignes, la vérification reste active.
        $this->run('02_foreign_keys', foreignKeyChecks: ! $this->businessTablesAreEmpty());
    }

    private function businessTablesAreEmpty(): bool
    {
        foreach ($this->baseline->businessTables() as $table) {
            if ($this->connection->table($table)->exists()) {
                return false;
            }
        }

        return true;
    }

    public function installReferenceDataAndViews(): void
    {
        $this->assertAllBusinessTablesPresent('03_reference_data');

        foreach (BaselineStatements::REFERENCE_TABLES as $table) {
            $rows = $this->connection->table($table)->count();
            if ($rows > 0) {
                throw new BaselineStateRefused('Le référentiel « '.$table.' » contient déjà '.$rows.' ligne(s) : étape 03 refusée (pas d\'INSERT IGNORE).');
            }
        }

        $views = (int) $this->connection->selectOne(
            'SELECT COUNT(*) AS n FROM information_schema.views WHERE table_schema = DATABASE()',
        )->n;
        if ($views > 0) {
            throw new BaselineStateRefused($views.' vue(s) déjà présente(s) : étape 03 refusée.');
        }

        // Les INSERT des référentiels sont transactionnels (02_reference_data.sql les encadre aussi).
        $this->withBaselineSession(function (): void {
            $this->connection->transaction(function (): void {
                foreach ($this->baseline->statements('03_reference_data') as $sql) {
                    $this->execute($sql);
                }
            });

            foreach ($this->baseline->statements('03_views') as $sql) {
                $this->execute($sql);
            }
        });
    }

    public function installGuards(): void
    {
        $this->assertAllBusinessTablesPresent('04_guards');
        $existing = (int) $this->connection->selectOne(
            'SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE()',
        )->n;

        if ($existing > 0) {
            throw new BaselineStateRefused($existing.' trigger(s) déjà présent(s) : étape 04 refusée.');
        }

        $this->run('04_guards');
    }

    /**
     * Toute la baseline sur une base vide, hors migrations : sert à constituer une base « comme importée
     * par le SQL livré » dans les tests d'adoption. Les migrations appellent les étapes une à une.
     */
    public function installAll(): void
    {
        $this->installTables();
        $this->installForeignKeys();
        $this->installReferenceDataAndViews();
        $this->installGuards();
    }

    public static function refuseRollback(string $step): never
    {
        throw new BaselineStateRefused(
            'Refus : l\'étape de baseline « '.$step.' » ne se défait pas automatiquement. Les tables métier portent '
            .'les pièces et l\'historique (contrat 23) : corriger par une migration additive. Base de test isolée : '
            .'php artisan eeo:test-db:reset.',
        );
    }

    private function run(string $step, bool $foreignKeyChecks = true): void
    {
        $this->withBaselineSession(function () use ($step, $foreignKeyChecks): void {
            $previous = (int) $this->connection->selectOne('SELECT @@SESSION.foreign_key_checks AS value')->value;
            if (! $foreignKeyChecks) {
                $this->connection->statement('SET SESSION foreign_key_checks = 0');
            }

            try {
                foreach ($this->baseline->statements($step) as $sql) {
                    $this->execute($sql);
                }
            } finally {
                if (! $foreignKeyChecks) {
                    $this->connection->statement('SET SESSION foreign_key_checks = ?', [$previous]);
                }
            }
        });
    }

    /**
     * Envoie une instruction de la baseline telle quelle, seule, par PDO (sans DELIMITER).
     *
     * Les instructions viennent exclusivement de database/baseline/statements.json, artefact versionné,
     * généré et vérifié octet pour octet contre les scripts SQL validés, puis contrôlé au chargement
     * (BaselineStatements) : ce n'est jamais une donnée saisie. Connection::unprepared() n'accepte qu'un
     * littéral PHP ; PDO::exec lève une PDOException en cas d'erreur (ERRMODE_EXCEPTION de Laravel).
     */
    private function execute(string $sql): void
    {
        $version = (string) $this->connection->selectOne('SELECT VERSION() AS v')->v;
        if (stripos($version, 'mariadb') !== false) {
            $sql = str_replace(
                'CHAR(26) CHARACTER SET ascii COLLATE ascii_bin',
                'VARCHAR(26) CHARACTER SET ascii COLLATE ascii_bin',
                $sql,
            );
        }

        $this->connection->getPdo()->exec($sql);
    }

    /**
     * Équivalent paramétré de SET NAMES : jeu de caractères du client, de la connexion et des résultats.
     */
    private function setCharacterSet(string $charset, string $collation): void
    {
        $this->connection->statement('SET SESSION character_set_client = ?', [$charset]);
        $this->connection->statement('SET SESSION character_set_results = ?', [$charset]);
        $this->connection->statement('SET SESSION character_set_connection = ?', [$charset]);
        $this->connection->statement('SET SESSION collation_connection = ?', [$collation]);
    }

    private function assertAllBusinessTablesPresent(string $step): void
    {
        $missing = array_diff($this->baseline->businessTables(), $this->existingBusinessTables());

        if ($missing !== []) {
            throw new BaselineStateRefused(sprintf(
                'Étape %s refusée : %d table(s) métier absente(s) (%s…).',
                $step,
                count($missing),
                implode(', ', array_slice(array_values($missing), 0, 3)),
            ));
        }
    }

    /**
     * Applique la session de 01_schema.sql (jeu de caractères, UTC, sql_mode) le temps de l'étape :
     * triggers et vues enregistrent ces paramètres comme lors de l'import du fichier complet.
     */
    private function withBaselineSession(callable $callback): void
    {
        $session = $this->baseline->session();
        $previous = $this->connection->selectOne(
            'SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.time_zone AS time_zone, '
            .'@@SESSION.character_set_client AS charset, @@SESSION.collation_connection AS collation',
        );

        $this->setCharacterSet($session['names'], $session['collation']);
        $this->connection->statement('SET SESSION time_zone = ?', [$session['time_zone']]);
        $this->connection->statement('SET SESSION sql_mode = ?', [$session['sql_mode']]);

        try {
            $callback();
        } finally {
            $this->connection->statement('SET SESSION sql_mode = ?', [(string) $previous->sql_mode]);
            $this->connection->statement('SET SESSION time_zone = ?', [(string) $previous->time_zone]);
            $this->setCharacterSet((string) $previous->charset, (string) $previous->collation);
        }
    }
}

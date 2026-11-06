<?php

namespace Tests\Concurrency\Support;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\DB;

/**
 * Outils d'entrelacement des tests de concurrence qui lancent des commandes du chemin central dans des processus enfants
 * (`tests/Concurrency/bin/command-scenario.php`) : enfants suivis, barrière par verrou de ligne sur le cabinet (une
 * mutation en cours), observation des requêtes en attente. Le test qui l'utilise déclare les constantes `CONNECTION`,
 * `DATABASE`, `SCRIPT` et `WAIT`. Mêmes principes que `CommandBusConcurrencyTest` : aucun sleep d'ordonnancement, les
 * enfants sont suspendus sur la requête attendue avant que la barrière ne soit relâchée.
 */
trait ScenarioHarness
{
    /** @var list<ScenarioProcess> */
    private array $children = [];

    private ?ConnectionInterface $gate = null;

    protected function releaseScenarioResources(): void
    {
        foreach ($this->children as $child) {
            $child->terminate();
        }
        if ($this->gate !== null && $this->gate->transactionLevel() > 0) {
            $this->gate->rollBack();
        }
        DB::setDefaultConnection('mysql');
        foreach ([self::CONNECTION, 'concurrency_observer', 'concurrency_gate'] as $connection) {
            DB::purge($connection);
        }
    }

    /**
     * @param  array<string, mixed>  $arguments
     */
    private function child(string $scenario, array $arguments): ScenarioProcess
    {
        // Les enfants suivis par le test sont ceux qui doivent rester suspendus jusqu'à la libération de la barrière.
        return $this->children[] = $this->spawn($scenario, $arguments);
    }

    /**
     * Lance un enfant SANS le suivre (échauffement).
     *
     * @param  array<string, mixed>  $arguments
     */
    private function spawn(string $scenario, array $arguments): ScenarioProcess
    {
        /** @var array{host: string, port: int|string, database: string, username: string, password: string} $connection */
        $connection = config('database.connections.'.self::CONNECTION);

        return ScenarioProcess::start($scenario, $arguments, [
            'APP_ENV' => 'testing',
            'APP_KEY' => (string) config('app.key'),
            'APP_DEBUG' => 'false',
            'DB_CONNECTION' => 'mysql',
            'DB_HOST' => $connection['host'],
            'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => $connection['database'],
            'DB_USERNAME' => $connection['username'],
            'DB_PASSWORD' => $connection['password'],
            'EEO_CLINIC_ID' => '',
            // Modules ouverts dans l'enfant : les commandes de poste (SyncDrain, M01) sont refusées pour un module fermé,
            // et un enfant ne partage pas la configuration modifiée en mémoire par le test.
            'EEO_ENABLED_MODULES' => 'today,patients,consultations,agenda,sales,stock,settings,reports,offline',
            'CACHE_STORE' => 'array',
            'SESSION_DRIVER' => 'array',
            'QUEUE_CONNECTION' => 'sync',
            'EEO_LOCK_WAIT_TIMEOUT' => '600',
            'LOG_CHANNEL' => 'null',
            'BCRYPT_ROUNDS' => '4',
            'PATH' => (string) getenv('PATH'),
        ], self::SCRIPT);
    }

    /**
     * Barrière : verrou exclusif de la ligne du cabinet dans une transaction ouverte, comme une mutation en cours.
     */
    private function holdClinicLock(string $clinicId): void
    {
        config(['database.connections.concurrency_gate' => (array) config('database.connections.'.self::CONNECTION)]);
        $this->gate = DB::connection('concurrency_gate');
        $this->gate->beginTransaction();
        $this->gate->table('clinics')->where('id', $clinicId)->lockForUpdate()->first();
    }

    private function releaseGate(): void
    {
        $this->assertNotNull($this->gate);
        $this->gate->commit();
    }

    /**
     * Attend que $expected connexions de la base jetable exécutent (donc attendent) la requête qui contient ces
     * fragments ; échoue avec l'état des connexions sinon.
     */
    private function waitForBlockedQuery(string $table, string $lock, int $expected): void
    {
        $observer = $this->observer();
        $deadline = microtime(true) + self::WAIT;
        $rows = [];

        do {
            $rows = $observer->select(
                "SELECT ID, INFO FROM information_schema.PROCESSLIST WHERE DB = ? AND COMMAND IN ('Query', 'Execute') AND ID <> CONNECTION_ID()",
                [self::DATABASE],
            );
            $blocked = array_filter($rows, static fn (object $row): bool => is_string($row->INFO) && str_contains($row->INFO, $table) && str_contains(strtolower($row->INFO), $lock));
            if (count($blocked) >= $expected) {
                return;
            }
            foreach ($this->children as $child) {
                if (! $child->isRunning() && count($blocked) < $expected) {
                    $this->fail('Un processus enfant s\'est terminé avant d\'atteindre la barrière : '.$child->output());
                }
            }
            usleep(50_000);
        } while (microtime(true) < $deadline);

        $this->fail(sprintf(
            '%d requête(s) attendue(s) en attente sur %s (%s) ; connexions observées : %s',
            $expected,
            $table,
            $lock,
            json_encode(array_map(static fn (object $row): mixed => $row->INFO, $rows), JSON_UNESCAPED_UNICODE),
        ));
    }

    private function observer(): ConnectionInterface
    {
        config(['database.connections.concurrency_observer' => (array) config('database.connections.'.self::CONNECTION)]);

        return DB::connection('concurrency_observer');
    }
}

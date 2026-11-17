<?php

namespace Tests\Unit\Application;

use App\Application\TransactionRunner;
use App\Domain\Shared\BusinessError;
use Closure;
use DomainException;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\DeadlockException;
use Illuminate\Database\QueryException;
use LogicException;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PDOException;
use PHPUnit\Framework\TestCase;

/**
 * Politique d'interblocage du contrat 23 : au plus trois tentatives internes avec attente bornée, puis une
 * erreur réessayable sans effet partiel. Les erreurs MySQL sont simulées ; l'interblocage RÉEL entre deux
 * connexions est prouvé par tests/Concurrency/CommandBusConcurrencyTest.php.
 */
final class TransactionRunnerTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    /** @var list<int> */
    private array $sleeps = [];

    public function test_un_travail_reussi_s_execute_une_fois_dans_une_transaction_a_attente_bornee(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));

        $this->assertSame('ok', $runner->run(fn (int $attempt): string => 'ok'));
        $this->assertSame([], $this->sleeps);
    }

    public function test_un_interblocage_est_rejoue_en_entier_puis_reussit(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));
        $attempts = [];

        $result = $runner->run(function (int $attempt) use (&$attempts): string {
            $attempts[] = $attempt;
            if ($attempt < 3) {
                throw $this->mysqlError(1213, 'Deadlock found when trying to get lock');
            }

            return 'termine';
        });

        $this->assertSame('termine', $result);
        $this->assertSame([1, 2, 3], $attempts);
        $this->assertCount(2, $this->sleeps, 'Une attente entre deux tentatives, pas après la dernière.');
        // Attente bornée, décalée au hasard et doublée à chaque tentative (10 à 40 ms, puis 20 à 80 ms).
        $this->assertGreaterThanOrEqual(10_000, $this->sleeps[0]);
        $this->assertLessThanOrEqual(40_000, $this->sleeps[0]);
        $this->assertGreaterThanOrEqual(20_000, $this->sleeps[1]);
        $this->assertLessThanOrEqual(80_000, $this->sleeps[1]);
    }

    public function test_trois_interblocages_donnent_une_erreur_reessayable_sans_quatrieme_tentative(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));
        $attempts = 0;

        try {
            $runner->run(function () use (&$attempts): never {
                $attempts++;
                throw $this->mysqlError(1213, 'Deadlock found when trying to get lock');
            });
            $this->fail('Une erreur réessayable était attendue.');
        } catch (BusinessError $error) {
            $this->assertSame('SERVER_BUSY', $error->errorCode);
            $this->assertSame(503, $error->httpStatus);
            $this->assertInstanceOf(PDOException::class, $error->getPrevious());
        }

        $this->assertSame(3, $attempts);
        $this->assertCount(2, $this->sleeps);
    }

    public function test_le_deadlock_exception_de_laravel_est_aussi_rejoue(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));
        $attempts = 0;

        $runner->run(function () use (&$attempts): string {
            $attempts++;
            if ($attempts === 1) {
                throw new DeadlockException('Deadlock found');
            }

            return 'ok';
        });

        $this->assertSame(2, $attempts);
    }

    public function test_une_attente_de_verrou_depassee_n_est_pas_rejouee_en_interne(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));
        $attempts = 0;

        try {
            $runner->run(function () use (&$attempts): never {
                $attempts++;
                throw $this->mysqlError(1205, 'Lock wait timeout exceeded; try restarting transaction');
            });
            $this->fail('Une erreur réessayable était attendue.');
        } catch (BusinessError $error) {
            $this->assertSame('SERVER_BUSY', $error->errorCode);
        }

        $this->assertSame(1, $attempts, 'Rejouer trois attentes de plusieurs secondes dépasserait le délai de la requête.');
        $this->assertSame([], $this->sleeps);
    }

    public function test_une_autre_erreur_sql_est_remontee_telle_quelle_sans_nouvelle_tentative(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));
        $attempts = 0;

        try {
            $runner->run(function () use (&$attempts): never {
                $attempts++;
                throw $this->mysqlError(1062, 'Duplicate entry');
            });
            $this->fail('L\'erreur SQL devait remonter.');
        } catch (QueryException $error) {
            $this->assertSame(1062, $error->errorInfo[1] ?? null);
        }

        $this->assertSame(1, $attempts);
    }

    public function test_un_refus_metier_et_une_exception_inattendue_ne_sont_jamais_rejoues(): void
    {
        $runner = $this->runner($this->connection(level: 0, timeout: 10));

        foreach ([BusinessError::versionConflict(), new DomainException('inattendue')] as $failure) {
            $attempts = 0;
            try {
                $runner->run(function () use (&$attempts, $failure): never {
                    $attempts++;
                    throw $failure;
                });
                $this->fail('L\'erreur devait remonter.');
            } catch (\Throwable $caught) {
                $this->assertSame($failure, $caught);
            }
            $this->assertSame(1, $attempts);
        }
    }

    public function test_une_transaction_imbriquee_est_refusee_hors_des_tests(): void
    {
        $runner = $this->runner($this->connection(level: 1, timeout: null), environment: 'production');

        $this->expectException(LogicException::class);
        $runner->run(fn (): string => 'jamais');
    }

    public function test_dans_un_test_enveloppe_une_transaction_existante_devient_un_point_de_sauvegarde(): void
    {
        $runner = $this->runner($this->connection(level: 1, timeout: null), environment: 'testing');

        $this->assertSame('ok', $runner->run(fn (int $attempt): string => 'ok'));
    }

    public function test_hors_unite_de_travail_la_jonction_ouvre_sa_propre_transaction_comme_run(): void
    {
        $opened = 0;
        $runner = $this->runner($this->trackedConnection($opened), environment: 'production');

        $this->assertSame('seul', $runner->joinOrRun(fn (int $attempt): string => 'seul'));
        $this->assertSame(1, $opened);
    }

    public function test_dans_une_unite_de_travail_la_jonction_se_joint_a_la_transaction_sans_en_ouvrir_une_seconde(): void
    {
        $opened = 0;
        $runner = $this->runner($this->trackedConnection($opened), environment: 'production');

        // Le chemin central (run) appelle une action qui appelle un service du domaine : une seule transaction, même en
        // production où `run()` refuse de s'imbriquer.
        $result = $runner->run(fn (): string => $runner->joinOrRun(fn (int $attempt): string => 'joint'));

        $this->assertSame('joint', $result);
        $this->assertSame(1, $opened);
    }

    public function test_un_run_imbrique_reste_refuse_meme_dans_une_unite_de_travail(): void
    {
        $opened = 0;
        $runner = $this->runner($this->trackedConnection($opened), environment: 'production');

        $this->expectException(LogicException::class);
        $runner->run(fn (): mixed => $runner->run(fn (): string => 'jamais'));
    }

    public function test_un_interblocage_dans_un_travail_joint_rejoue_toute_l_unite_exterieure(): void
    {
        $opened = 0;
        $runner = $this->runner($this->trackedConnection($opened), environment: 'production');
        $outer = 0;
        $inner = 0;

        $result = $runner->run(function () use ($runner, &$outer, &$inner): string {
            $outer++;

            return $runner->joinOrRun(function () use (&$inner): string {
                $inner++;
                if ($inner === 1) {
                    throw $this->mysqlError(1213, 'Deadlock found when trying to get lock');
                }

                return 'rejoue';
            });
        });

        $this->assertSame('rejoue', $result);
        $this->assertSame(2, $outer, 'L\'unité extérieure repart du début : verrou du cabinet compris.');
        $this->assertSame(2, $inner);
        $this->assertSame(2, $opened, 'Une transaction par tentative de l\'unité extérieure, jamais deux en même temps.');
    }

    public function test_une_unite_terminee_ne_laisse_aucune_jonction_ouverte(): void
    {
        $opened = 0;
        $runner = $this->runner($this->trackedConnection($opened), environment: 'production');

        try {
            $runner->run(function (): never {
                throw new DomainException('échec');
            });
        } catch (DomainException) {
        }

        // Après un échec, un travail sans unité ouvre de nouveau sa propre transaction.
        $this->assertSame('apres', $runner->joinOrRun(fn (int $attempt): string => 'apres'));
        $this->assertSame(2, $opened);
    }

    private function runner(Connection $connection, string $environment = 'testing'): TransactionRunner
    {
        $database = Mockery::mock(DatabaseManager::class);
        $database->shouldReceive('connection')->andReturn($connection);

        $app = Mockery::mock(Application::class);
        $app->shouldReceive('environment')->with('testing')->andReturn($environment === 'testing');

        return new TransactionRunner($database, $app, 3, 10, function (int $microseconds): void {
            $this->sleeps[] = $microseconds;
        });
    }

    private function connection(int $level, ?int $timeout): Connection
    {
        $connection = Mockery::mock(Connection::class);
        $connection->shouldReceive('transactionLevel')->andReturn($level);
        $connection->shouldReceive('getDriverName')->andReturn('mysql');
        $connection->shouldReceive('transaction')->andReturnUsing(
            static fn (Closure $callback, int $attempts = 1): mixed => $callback($connection),
        );

        if ($timeout !== null) {
            // Une fois par appel de run() : le délai de la session est (ré)appliqué avant chaque transaction.
            $connection->shouldReceive('statement')->atLeast()->once()->with('SET SESSION innodb_lock_wait_timeout = '.$timeout);
        }

        return $connection;
    }

    /**
     * Connexion simulée qui TIENT le niveau de transaction : 1 dans une transaction ouverte, comme MySQL. `$opened`
     * compte les transactions réellement ouvertes.
     */
    private function trackedConnection(int &$opened): Connection
    {
        $level = 0;
        $connection = Mockery::mock(Connection::class);
        $connection->shouldReceive('transactionLevel')->andReturnUsing(static function () use (&$level): int {
            return $level;
        });
        $connection->shouldReceive('getDriverName')->andReturn('mysql');
        $connection->shouldReceive('statement')->andReturn(true);
        $connection->shouldReceive('transaction')->andReturnUsing(
            static function (Closure $callback, int $attempts = 1) use (&$level, &$opened): mixed {
                $level++;
                $opened++;
                try {
                    return $callback();
                } finally {
                    $level--;
                }
            },
        );

        return $connection;
    }

    private function mysqlError(int $code, string $message): QueryException
    {
        $pdo = new PDOException($message);
        $pdo->errorInfo = [$code === 1213 || $code === 1205 ? '40001' : '23000', $code, $message];

        return new QueryException('mysql', 'update document_sequences set last_value = ?', [1], $pdo);
    }
}

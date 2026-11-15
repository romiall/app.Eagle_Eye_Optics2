<?php

namespace App\Application;

use App\Domain\Shared\BusinessError;
use Closure;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Connection;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\DeadlockException;
use Illuminate\Database\QueryException;
use LogicException;
use PDOException;
use Throwable;

/**
 * Exécute une unité de travail dans UNE transaction MySQL, avec la politique d'interblocage du contrat 23 :
 * au plus trois tentatives internes, attente bornée entre elles, puis une erreur RÉESSAYABLE (SERVER_BUSY,
 * 503) sans effet partiel. Le travail est rejoué en entier à chaque tentative : il doit tout refaire
 * (verrous, lectures, écritures) et ne produire aucun effet externe.
 *
 * Une attente de verrou trop longue (timeout InnoDB) n'est PAS rejouée en interne : relancer trois fois une
 * attente de plusieurs secondes dépasserait le délai de la requête. Le délai InnoDB est borné pour la
 * session (`eeo.transactions.lock_wait_timeout_seconds`), puis l'erreur réessayable est rendue au client, qui
 * renvoie la même demande (même clé d'idempotence, aucun doublon possible).
 *
 * Cette classe est le seul endroit de l'application métier qui ouvre une transaction (test d'architecture).
 */
final class TransactionRunner
{
    /** Erreurs MySQL : interblocage détecté, attente de verrou dépassée. */
    private const DEADLOCK = 1213;

    private const LOCK_WAIT_TIMEOUT = 1205;

    /** @var Closure(int): void */
    private Closure $sleeper;

    /**
     * Unités de travail en cours dans CET exécuteur (une transaction ouverte par `run()` et rejouée en entier sur
     * interblocage). Un service du domaine appelé depuis une action du chemin central s'y joint (`joinOrRun()`) au lieu
     * d'ouvrir une seconde transaction.
     */
    private int $units = 0;

    /**
     * @param  (Closure(int): void)|null  $sleeper  attente en microsecondes ; injectable pour les tests
     */
    public function __construct(
        private readonly DatabaseManager $database,
        private readonly Application $app,
        private readonly int $maxAttempts = 3,
        private readonly int $lockWaitTimeoutSeconds = 10,
        ?Closure $sleeper = null,
    ) {
        $this->sleeper = $sleeper ?? static function (int $microseconds): void {
            usleep($microseconds);
        };
    }

    /**
     * @template TResult
     *
     * @param  Closure(int): TResult  $work  reçoit le numéro de la tentative (1, 2, 3)
     * @return TResult
     */
    public function run(Closure $work): mixed
    {
        $connection = $this->database->connection();

        if ($connection->transactionLevel() > 0) {
            if (! $this->app->environment('testing')) {
                throw new LogicException('Le chemin central de commandes ne s\'imbrique pas dans une autre transaction : une relance sur interblocage ne rejouerait que le point de sauvegarde.');
            }

            // Tests enveloppés par RefreshDatabase : point de sauvegarde, sans relance possible.
            return $connection->transaction(fn (): mixed => $this->inUnit($work, 1));
        }

        $this->boundLockWait($connection);

        for ($attempt = 1; ; $attempt++) {
            try {
                return $connection->transaction(fn (): mixed => $this->inUnit($work, $attempt), 1);
            } catch (Throwable $error) {
                $code = $this->mysqlErrorCode($error);

                if ($code === self::LOCK_WAIT_TIMEOUT) {
                    throw BusinessError::serverBusy($error);
                }
                if (! $this->isDeadlock($error, $code)) {
                    throw $error;
                }
                if ($attempt >= $this->maxAttempts) {
                    throw BusinessError::serverBusy($error);
                }

                // Attente croissante et décalée : deux victimes d'un même interblocage ne repartent pas ensemble.
                ($this->sleeper)(random_int(10_000, 40_000) * (2 ** ($attempt - 1)));
            }
        }
    }

    /**
     * Pour un service du domaine appelé À LA FOIS par une action du chemin central (dans la transaction du bus) et par
     * une tâche ou un consommateur d'outbox (sans transaction) : dans une unité de travail déjà ouverte par cet
     * exécuteur, le travail s'exécute dans cette transaction — un interblocage remonte alors à l'unité extérieure, qui
     * rejoue TOUT, verrou du cabinet compris, ce qu'un point de sauvegarde ne ferait pas ; hors unité, c'est `run()`.
     * `run()` reste strict : un chemin central ne s'imbrique jamais dans une autre transaction.
     *
     * @template TResult
     *
     * @param  Closure(int): TResult  $work
     * @return TResult
     */
    public function joinOrRun(Closure $work): mixed
    {
        if ($this->units > 0) {
            return $work(1);
        }

        return $this->run($work);
    }

    /**
     * @param  Closure(int): mixed  $work
     */
    private function inUnit(Closure $work, int $attempt): mixed
    {
        $this->units++;

        try {
            return $work($attempt);
        } finally {
            $this->units--;
        }
    }

    private function boundLockWait(ConnectionInterface $connection): void
    {
        if ($connection instanceof Connection && $connection->getDriverName() === 'mysql') {
            $connection->statement('SET SESSION innodb_lock_wait_timeout = '.max(1, $this->lockWaitTimeoutSeconds));
        }
    }

    private function isDeadlock(Throwable $error, ?int $code): bool
    {
        return $code === self::DEADLOCK || $error instanceof DeadlockException;
    }

    private function mysqlErrorCode(Throwable $error): ?int
    {
        for ($current = $error; $current !== null; $current = $current->getPrevious()) {
            if ($current instanceof QueryException || $current instanceof PDOException) {
                $info = $current->errorInfo;

                return is_array($info) && isset($info[1]) ? (int) $info[1] : null;
            }
        }

        return null;
    }
}

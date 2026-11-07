<?php

namespace Tests\Concurrency;

use Illuminate\Support\Facades\DB;
use Tests\Support\RequiresIsolatedMysql;
use Tests\TestCase;

/**
 * Base des tests de concurrence (fichier 25) : deux connexions MySQL réellement distinctes avec une
 * barrière contrôlée (verrou nommé), et non deux « promesses » sans contrôle d'entrelacement.
 */
final class IndependentConnectionsTest extends TestCase
{
    use RequiresIsolatedMysql;

    private const LOCK = 'eeo_concurrency_probe';

    protected function setUp(): void
    {
        parent::setUp();

        $this->requireIsolatedMysql();

        config(['database.connections.mysql_second' => (array) config('database.connections.mysql')]);
        DB::purge('mysql_second');
    }

    protected function tearDown(): void
    {
        DB::purge('mysql_second');
        DB::purge('mysql');

        parent::tearDown();
    }

    private function acquire(string $connection, int $timeoutSeconds = 0): int
    {
        return (int) DB::connection($connection)->selectOne('SELECT GET_LOCK(?, ?) AS acquired', [self::LOCK, $timeoutSeconds])->acquired;
    }

    private function release(string $connection): void
    {
        DB::connection($connection)->selectOne('SELECT RELEASE_LOCK(?) AS released', [self::LOCK]);
    }

    public function test_les_deux_connexions_sont_des_sessions_mysql_distinctes(): void
    {
        $first = (int) DB::connection('mysql')->selectOne('SELECT CONNECTION_ID() AS id')->id;
        $second = (int) DB::connection('mysql_second')->selectOne('SELECT CONNECTION_ID() AS id')->id;

        $this->assertNotSame($first, $second);
    }

    public function test_la_barriere_exclut_la_seconde_session_jusqu_a_la_liberation(): void
    {
        $this->assertSame(1, $this->acquire('mysql'), 'La première session doit obtenir le verrou.');

        try {
            $this->assertSame(0, $this->acquire('mysql_second'), 'La seconde session ne doit pas entrer tant que la première tient le verrou.');
        } finally {
            $this->release('mysql');
        }

        $this->assertSame(1, $this->acquire('mysql_second'), 'Après libération, la seconde session obtient le verrou.');
        $this->release('mysql_second');
    }

    public function test_un_verrou_nomme_est_libere_a_la_fermeture_de_la_session(): void
    {
        $this->assertSame(1, $this->acquire('mysql_second'));
        DB::purge('mysql_second');

        // Le serveur libère le verrou quand il a traité la fermeture de la connexion, un instant APRÈS que le client l'a
        // fermée (CI du 2026-11-07 : 0 renvoyé par un essai immédiat). Un verrou orphelin, lui, ne serait jamais libéré :
        // l'essai attend donc jusqu'à 10 secondes, ce qui reste un échec franc si le verrou n'est jamais rendu.
        $this->assertSame(1, $this->acquire('mysql', 10), 'La fermeture de la session propriétaire libère le verrou (pas de verrou orphelin).');
        $this->release('mysql');
    }
}

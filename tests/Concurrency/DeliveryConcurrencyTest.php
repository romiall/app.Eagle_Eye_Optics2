<?php

namespace Tests\Concurrency;

use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Instant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\Concurrency\Support\ScenarioHarness;
use Tests\Concurrency\Support\ScenarioProcess;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\DeliveryFixtures;
use Tests\Support\ScratchMysqlDatabases;
use Tests\TestCase;

/**
 * Remises concurrentes entre CONNEXIONS MYSQL RÉELLES (fiche I01 : « dernier article remis par deux postes », « rejeu
 * d'une remise ») sur une base jetable migrée une fois pour la classe. Chaque remise s'exécute dans un processus PHP
 * enfant suspendu derrière le verrou du cabinet tenu par le test, puis relâché : aucun sleep, aucun hasard.
 *
 * Données fictives ; l'horloge n'est pas figée (les enfants lisent l'heure réelle du serveur).
 */
final class DeliveryConcurrencyTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use DeliveryFixtures;
    use ScenarioHarness;
    use ScratchMysqlDatabases;

    private const CONNECTION = 'concurrency_deliveries';

    private const DATABASE = 'eeo_conc_deliveries_test';

    private const SCRIPT = 'command-scenario.php';

    private const WAIT = 300.0;

    private static bool $migrated = false;

    private static bool $warmedUp = false;

    private User $secondCashier;

    public static function tearDownAfterClass(): void
    {
        if (self::$migrated) {
            $pdo = new PDO(
                sprintf('mysql:host=%s;port=%s', getenv('EEO_TEST_DB_HOST') ?: '127.0.0.1', getenv('EEO_TEST_DB_PORT') ?: '3306'),
                getenv('EEO_TEST_DB_USERNAME') ?: 'eeo_test',
                getenv('EEO_TEST_DB_PASSWORD') ?: 'eeo_test_password',
            );
            $pdo->exec('DROP DATABASE IF EXISTS `'.self::DATABASE.'`');
            self::$migrated = false;
            self::$warmedUp = false;
        }

        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();

        if (self::$migrated) {
            config(['database.connections.'.self::CONNECTION => [...(array) config('database.connections.mysql'), 'database' => self::DATABASE]]);
            DB::purge(self::CONNECTION);
        } else {
            $this->createScratchDatabase(self::CONNECTION, self::DATABASE);
            $this->scratchDatabases = []; // supprimée par tearDownAfterClass, pas à chaque test
            $status = Artisan::call('migrate', ['--database' => self::CONNECTION, '--force' => true]);
            $this->assertSame(0, $status, Artisan::output());
            self::$migrated = true;
        }
        DB::setDefaultConnection(self::CONNECTION);

        if (! self::$warmedUp) {
            $this->spawn('pull', ['clinic_id' => Ulid::generate(), 'after' => 0])->wait(self::WAIT);
            self::$warmedUp = true;
        }

        config([
            'eeo.enabled_modules' => ['sales', 'stock', 'settings'],
            'eeo.billing.exam_fee_control' => 'off',
            'eeo.billing.exam_fee_item_reference' => 'EX-001',
            'eeo.billing.discount_cap_percent' => '0',
        ]);
        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->cashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.test');
        $this->secondCashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse2.test');
        $this->patientId = $this->seedPatient($this->clinicId);
        $this->registerId = $this->seedRegister($this->clinicId);
        $this->locationId = $this->seedLocation($this->clinicId);
        $this->item = [
            'frame' => $this->seedItem($this->clinicId, ['reference' => 'FR-001', 'name' => 'Monture fictive', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 40000, 'stock_mode' => 'STOCKED']),
        ];
    }

    protected function tearDown(): void
    {
        $this->releaseScenarioResources();

        parent::tearDown();
    }

    private function instant(int $offsetSeconds = 0): string
    {
        return Instant::fromEpochMilliseconds(((int) CarbonImmutable::now('UTC')->format('Uv')) + $offsetSeconds * 1000)->toString();
    }

    /**
     * Dernière monture du stock vendue (facture émise et réglée) : [facture, ligne, position].
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function lastFrameSold(): array
    {
        $position = $this->seedPosition($this->item['frame'], '1');
        $this->ensureOpenCashSession($this->manager);
        [$id, $sum, $version] = $this->draft([$this->line($this->item['frame'], '1', 1, 40000)], $this->manager);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $sum, ['issued_at' => $this->instant(-120)]), $this->manager)->assertOk();

        return [$id, $this->invoiceLine($id), $position];
    }

    /**
     * @param  array<string, mixed>  $body  corps direct (expected_version null retiré)
     */
    private function delivery(User $actor, array $body, string $key): ScenarioProcess
    {
        unset($body['expected_version']);

        return $this->child('command', ['actor_id' => $actor->id, 'name' => 'ConfirmDelivery', 'entity_id' => (string) $body['delivery_id'], 'expected_version' => null, 'key' => $key, 'payload' => $body]);
    }

    /**
     * @param  list<ScenarioProcess>  $children
     * @return list<string>
     */
    private function codes(array $children): array
    {
        $codes = array_map(static fn (ScenarioProcess $child): string => ($outcome = $child->wait(self::WAIT))['ok'] ? 'OK' : (string) $outcome['code'], $children);
        sort($codes);

        return $codes;
    }

    // ------------------------------------------------------------------------------------------------------------

    public function test_le_dernier_article_remis_par_deux_postes_ne_sort_qu_une_fois(): void
    {
        [$invoice, $line, $position] = $this->lastFrameSold();
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->delivery($this->cashier, $this->deliveryBody($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['delivered_at' => $this->instant()]), 'cle-remise-aaaa0001'),
            $this->delivery($this->secondCashier, $this->deliveryBody($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['delivered_at' => $this->instant()]), 'cle-remise-bbbb0001'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $this->assertSame(['OK', 'VALIDATION_FAILED'], $this->codes($children));
        $this->assertSame(1, DB::table('deliveries')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, DB::table('stock_movements')->where('kind', 'SALE_DELIVERY')->where('position_id', $position)->count());
        $row = DB::table('stock_positions')->where('id', $position)->first();
        $this->assertNotNull($row);
        $this->assertSame(['0.000', '0.000'], [(string) $row->on_hand, (string) $row->reserved], 'Le physique ne devient jamais négatif.');
    }

    public function test_le_rejeu_simultane_de_la_meme_remise_n_en_ecrit_qu_une(): void
    {
        [$invoice, $line, $position] = $this->lastFrameSold();
        $body = $this->deliveryBody($invoice, [$this->deliveryLine($line, $this->item['frame'])], ['delivered_at' => $this->instant()]);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->delivery($this->cashier, $body, 'cle-remise-rejeu001'),
            $this->delivery($this->cashier, $body, 'cle-remise-rejeu001'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $this->assertSame(['OK', 'OK'], $this->codes($children));
        $this->assertSame(1, DB::table('deliveries')->where('invoice_id', $invoice)->count());
        $this->assertSame('0.000', (string) DB::table('stock_positions')->where('id', $position)->value('on_hand'));
    }
}

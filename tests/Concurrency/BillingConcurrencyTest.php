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
use Tests\Support\BillingFixtures;
use Tests\Support\ScratchMysqlDatabases;
use Tests\TestCase;

/**
 * Entrelacements contrôlés des commandes financières entre CONNEXIONS MYSQL RÉELLES (fichier 25 : « deux connexions MySQL
 * avec interleavings contrôlés »), sur une base jetable migrée UNE fois pour la classe. Chaque opération s'exécute dans
 * un processus PHP enfant ; le test tient la ligne du cabinet (une mutation en cours), attend que les enfants soient
 * suspendus sur la même requête, puis la relâche : aucun sleep, aucun hasard d'ordonnancement.
 *
 * AT12 : deux règlements concurrents de 40 000 sur 50 000 dus, un seul accepté, aucun numéro de reçu brûlé.
 * AT11/AT38 : double clic avec la même clé, un seul encaissement. AT08/AT09 : numéros de facture consécutifs sans trou,
 * une seule émission d'une même facture, dernière unité de stock vendue une seule fois. B05 : une seule session ouverte
 * par caisse, encaissement espèces et clôture jamais incohérents.
 *
 * L'horloge n'est PAS figée ici : les enfants lisent l'heure réelle du serveur.
 */
final class BillingConcurrencyTest extends TestCase
{
    use BillingFixtures;
    use ScenarioHarness;
    use ScratchMysqlDatabases;

    private const CONNECTION = 'concurrency_billing';

    private const DATABASE = 'eeo_conc_billing_test';

    private const SCRIPT = 'command-scenario.php';

    /** Délai maximal d'attente d'un enfant ou d'une barrière, en secondes (démarrage à froid d'un enfant : jusqu'à ~30 s). */
    private const WAIT = 300.0;

    private static bool $migrated = false;

    private static bool $warmedUp = false;

    private User $second;

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

        // Fixtures écrites sur la base jetable : les processus enfants les voient.
        DB::setDefaultConnection(self::CONNECTION);

        if (! self::$warmedUp) {
            // Premier enfant jetable : amorce le cache disque pour que les enfants des tests suivants démarrent à chaud.
            $this->spawn('pull', ['clinic_id' => Ulid::generate(), 'after' => 0])->wait(self::WAIT);
            self::$warmedUp = true;
        }

        config([
            'eeo.enabled_modules' => ['sales', 'stock'],
            'eeo.billing.exam_fee_control' => 'off',
            'eeo.billing.exam_fee_item_reference' => 'EX-001',
            'eeo.billing.discount_cap_percent' => '0',
        ]);
        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->cashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.test');
        $this->second = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse2.test');
        $this->patientId = $this->seedPatient($this->clinicId);
        $this->registerId = $this->seedRegister($this->clinicId);
        $this->locationId = $this->seedLocation($this->clinicId);
        $this->item = [
            'exam' => $this->seedItem($this->clinicId, ['reference' => 'EX-001', 'name' => 'Examen de vue (fictif)', 'category_code' => 'SERVICE', 'unit_code' => 'SERVICE', 'quantity_integer_only' => 0, 'sale_price' => 15000, 'stock_mode' => 'NONE']),
            'frame' => $this->seedItem($this->clinicId, ['reference' => 'FR-001', 'name' => 'Monture fictive', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 40000, 'stock_mode' => 'STOCKED']),
            'lens' => $this->seedItem($this->clinicId, ['reference' => 'LS-001', 'name' => 'Verres fictifs sur mesure', 'category_code' => 'LENS', 'unit_code' => 'PAIR', 'sale_price' => 60000, 'stock_mode' => 'MADE_TO_ORDER']),
        ];
    }

    protected function tearDown(): void
    {
        $this->releaseScenarioResources();

        parent::tearDown();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Fixtures et commandes d'enfants
    // ------------------------------------------------------------------------------------------------------------

    /** Instant du serveur à la milliseconde, décalé de $offsetSeconds (les enfants lisent l'heure réelle). */
    private function instant(int $offsetSeconds = 0): string
    {
        return Instant::fromEpochMilliseconds(((int) CarbonImmutable::now('UTC')->format('Uv')) + $offsetSeconds * 1000)->toString();
    }

    /**
     * Facture de 80 000 (ou du montant donné) créée, et émise si demandé, par l'API dans le processus du test.
     *
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: string, 1: int, 2: int} identifiant, total, version du brouillon
     */
    private function invoice(?array $lines = null, bool $issue = true, ?User $as = null): array
    {
        if ($issue) {
            [$id, $total] = $this->issuedUncollectedInvoice($lines ?? [$this->line($this->item['lens'], '1', 1, 80000)], $as ?? $this->manager);

            return [$id, $total, 1];
        }

        return $this->draft($lines ?? [$this->line($this->item['lens'], '1', 1, 80000)], $as ?? $this->manager);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function payment(User $actor, string $invoiceId, int $version, int $amount, string $key, array $overrides = [], string $method = 'MTN_MOMO'): ScenarioProcess
    {
        $body = $this->paymentBody($invoiceId, $version, $amount, $method, array_merge(['effective_at' => $this->instant(-60)], $overrides));
        unset($body['expected_version']);

        return $this->child('command', ['actor_id' => $actor->id, 'name' => 'RegisterPayment', 'entity_id' => $invoiceId, 'expected_version' => $version, 'key' => $key, 'payload' => $body]);
    }

    private function issuing(User $actor, string $invoiceId, int $version, int $total, string $key): ScenarioProcess
    {
        $body = $this->issueBody($invoiceId, $version, $total, ['issued_at' => $this->instant(-60)]);
        unset($body['expected_version']);

        return $this->child('command', ['actor_id' => $actor->id, 'name' => 'IssueInvoice', 'entity_id' => $invoiceId, 'expected_version' => $version, 'key' => $key, 'payload' => $body]);
    }

    /**
     * @param  list<ScenarioProcess>  $children
     * @return list<array<string, mixed>>
     */
    private function outcomes(array $children): array
    {
        return array_map(static fn (ScenarioProcess $child): array => $child->wait(self::WAIT), $children);
    }

    /**
     * @param  list<array<string, mixed>>  $outcomes
     * @return list<string>
     */
    private function codes(array $outcomes): array
    {
        $codes = array_map(static fn (array $outcome): string => $outcome['ok'] ? 'OK' : (string) $outcome['code'], $outcomes);
        sort($codes);

        return $codes;
    }

    private function sequenceValue(string $type): int
    {
        return (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', $type)->value('last_value');
    }

    private function sequenceYear(string $type): int
    {
        return (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', $type)->value('document_year');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Encaissements
    // ------------------------------------------------------------------------------------------------------------

    public function test_deux_reglements_concurrents_de_40000_sur_50000_ne_laissent_passer_que_le_premier(): void
    {
        // AT12 : un seul règlement de 40 000 accepté, le second est refusé sans effet et sans numéro de reçu brûlé.
        [$invoice] = $this->invoice([$this->line($this->item['lens'], '1', 1, 50000)]);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->payment($this->cashier, $invoice, 1, 40000, 'cle-at12-caisse01'),
            $this->payment($this->manager, $invoice, 1, 40000, 'cle-at12-gerante1'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $this->assertSame(['OK', 'PAYMENT_EXCEEDS_BALANCE'], $this->codes($outcomes));
        $this->assertSame(40000, (int) DB::table('payments')->where('invoice_id', $invoice)->sum('amount'));
        $this->assertSame(1, DB::table('receipts')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, $this->sequenceValue('RECEIPT'), 'Le numéro du refus est revenu avec sa transaction : aucun trou.');
        $this->assertSame(1, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'RECEIPT')->count());
        $this->assertSame(1, DB::table('audit_events')->where('clinic_id', $this->clinicId)->where('action', 'payment.confirmed')->count());
        $failed = array_values(array_filter($outcomes, static fn (array $outcome): bool => ! $outcome['ok']))[0];
        $this->assertStringContainsString('reste', mb_strtolower((string) $failed['message']), 'Le refus dit qu\'il reste un montant à payer.');
    }

    public function test_un_double_clic_concurrent_avec_la_meme_cle_n_encaisse_qu_une_fois(): void
    {
        // AT11/AT38 : même clé, même contenu, simultanément, un seul effet, la seconde réponse est le rejeu.
        [$invoice] = $this->invoice();
        $same = ['payment_id' => Ulid::generate(), 'receipt_id' => Ulid::generate(), 'receipt_number_usage_id' => Ulid::generate(), 'receipt_document_id' => Ulid::generate(), 'effective_at' => $this->instant(-60)];
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->payment($this->cashier, $invoice, 1, 30000, 'cle-double-clic-01', $same),
            $this->payment($this->cashier, $invoice, 1, 30000, 'cle-double-clic-01', $same),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        foreach ($outcomes as $outcome) {
            $this->assertTrue($outcome['ok'], json_encode($outcome, JSON_UNESCAPED_UNICODE));
        }
        $replays = array_map(static fn (array $outcome): bool => (bool) $outcome['result']['replayed'], $outcomes);
        sort($replays);
        $this->assertSame([false, true], $replays, 'Une exécution, un rejeu.');
        $this->assertSame($outcomes[0]['result']['result']['receipt_number'], $outcomes[1]['result']['result']['receipt_number']);
        $this->assertSame(1, DB::table('payments')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, DB::table('receipts')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, $this->sequenceValue('RECEIPT'));
    }

    public function test_deux_encaissements_de_la_meme_version_obligent_le_second_a_actualiser_puis_les_recus_se_suivent(): void
    {
        // Montants compatibles (30 000 + 50 000 sur 80 000) mais même version attendue : le second doit actualiser.
        [$invoice] = $this->invoice();
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->payment($this->cashier, $invoice, 1, 30000, 'cle-version-aaaa01'),
            $this->payment($this->manager, $invoice, 1, 50000, 'cle-version-bbbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $this->assertSame(['OK', 'VERSION_CONFLICT'], $this->codes($outcomes));
        $paid = (int) DB::table('payments')->where('invoice_id', $invoice)->sum('amount');
        $this->assertContains($paid, [30000, 50000]);

        // Le second actualise (version 2, reste dû rendu) et aboutit : numéros 1 puis 2, sans trou.
        $this->write('POST', '/api/v1/invoices/'.$invoice.'/payments', $this->paymentBody($invoice, 2, 80000 - $paid, 'MTN_MOMO', ['effective_at' => $this->instant(-60)]), $this->cashier)
            ->assertCreated()->assertJsonPath('data.balance.settlement', 'SETTLED');
        $year = $this->sequenceYear('RECEIPT');
        $this->assertSame(
            [sprintf('TEST-REC-%04d-000001', $year), sprintf('TEST-REC-%04d-000002', $year)],
            DB::table('receipts')->where('invoice_id', $invoice)->orderBy('number')->pluck('number')->all(),
        );
        $this->assertSame(80000, (int) DB::table('payments')->where('invoice_id', $invoice)->sum('amount'));
    }

    public function test_un_encaissement_especes_et_la_cloture_de_la_session_ne_sont_jamais_incoherents(): void
    {
        [$invoice] = $this->invoice();
        $session = Ulid::generate();
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(25000, ['cash_session_id' => $session, 'opened_at' => $this->instant(-60)]), $this->cashier)->assertCreated();
        $close = $this->closeSessionBody($session, 25000, 25000, null, ['closed_at' => $this->instant(-30)]);
        unset($close['expected_version']);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->payment($this->cashier, $invoice, 1, 30000, 'cle-especes-aaaa01', ['cash_session_id' => $session, 'effective_at' => $this->instant()], 'CASH'),
            $this->child('command', ['actor_id' => $this->cashier->id, 'name' => 'CloseCashSession', 'entity_id' => $session, 'key' => 'cle-cloture-bbbb001', 'payload' => $close]),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $codes = $this->codes($outcomes);
        $this->assertContains($codes, [['OK', 'STATE_TRANSITION_REFUSED'], ['OK', 'VERSION_CONFLICT']], json_encode($outcomes, JSON_UNESCAPED_UNICODE));
        $closedAt = DB::table('cash_sessions')->where('id', $session)->value('closed_at');
        $payments = DB::table('payments')->where('cash_session_id', $session)->count();
        $this->assertTrue(($closedAt === null && $payments === 1) || ($closedAt !== null && $payments === 0), 'Soit l\'encaissement est dans une session ouverte, soit la session est close sans lui.');
        if ($closedAt !== null) {
            $this->assertSame(25000, (int) DB::table('cash_sessions')->where('id', $session)->value('expected_amount'));
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Émission et stock
    // ------------------------------------------------------------------------------------------------------------

    public function test_deux_emissions_simultanees_de_la_meme_facture_ne_consomment_qu_un_numero(): void
    {
        $this->ensureOpenCashSession($this->cashier);
        [$invoice, $total, $version] = $this->invoice([$this->line($this->item['exam'])], false);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->issuing($this->cashier, $invoice, $version, $total, 'cle-emission-aaaa01'),
            $this->issuing($this->second, $invoice, $version, $total, 'cle-emission-bbbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $this->assertSame(['OK', 'STATE_TRANSITION_REFUSED'], $this->codes($outcomes));
        $this->assertSame('ISSUED', DB::table('invoices')->where('id', $invoice)->value('status'));
        $this->assertSame(1, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'INVOICE')->count());
        $this->assertSame(1, $this->sequenceValue('INVOICE'));
        $this->assertSame(1, DB::table('generated_documents')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, DB::table('audit_events')->where('clinic_id', $this->clinicId)->where('action', 'invoice.issued')->count());
    }

    public function test_cinq_emissions_simultanees_recoivent_cinq_numeros_distincts_et_consecutifs(): void
    {
        // AT08 : numéros attribués sous le verrou du cabinet puis de la série, sans doublon ni trou.
        $this->ensureOpenCashSession($this->cashier);
        $drafts = [];
        for ($index = 0; $index < 5; $index++) {
            $drafts[] = $this->invoice([$this->line($this->item['exam'])], false);
        }
        $this->holdClinicLock($this->clinicId);
        $children = [];
        foreach ($drafts as $index => [$invoice, $total, $version]) {
            $children[] = $this->issuing($index % 2 === 0 ? $this->cashier : $this->second, $invoice, $version, $total, 'cle-cinq-emissions-0'.$index);
        }
        $this->waitForBlockedQuery('`clinics`', 'for update', 5);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        foreach ($outcomes as $outcome) {
            $this->assertTrue($outcome['ok'], json_encode($outcome, JSON_UNESCAPED_UNICODE));
        }
        $year = $this->sequenceYear('INVOICE');
        $numbers = DB::table('invoices')->where('clinic_id', $this->clinicId)->where('status', 'ISSUED')->orderBy('number')->pluck('number')->all();
        $this->assertSame(
            array_map(static fn (int $value): string => sprintf('TEST-FAC-%04d-%06d', $year, $value), [1, 2, 3, 4, 5]),
            $numbers,
        );
        $this->assertSame(5, $this->sequenceValue('INVOICE'));
        $this->assertSame(5, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'INVOICE')->count());
    }

    public function test_la_derniere_unite_de_stock_n_est_vendue_qu_une_fois_et_le_refus_ne_brule_pas_de_numero(): void
    {
        $this->ensureOpenCashSession($this->cashier);
        $position = $this->seedPosition($this->item['frame'], '1');
        $first = $this->invoice([$this->line($this->item['frame'])], false);
        $second = $this->invoice([$this->line($this->item['frame'])], false);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->issuing($this->cashier, $first[0], $first[2], $first[1], 'cle-stock-aaaaaa01'),
            $this->issuing($this->second, $second[0], $second[2], $second[1], 'cle-stock-bbbbbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $this->assertSame(['OK', 'STOCK_UNAVAILABLE'], $this->codes($outcomes));
        $row = DB::table('stock_positions')->where('id', $position)->first();
        $this->assertNotNull($row);
        $this->assertSame(['1.000', '1.000', '0.000'], [$row->on_hand, $row->reserved, $row->central_available]);
        $this->assertSame(1, DB::table('stock_reservations')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(1, DB::table('invoices')->where('clinic_id', $this->clinicId)->where('status', 'ISSUED')->count());
        $this->assertSame(1, DB::table('invoices')->where('clinic_id', $this->clinicId)->where('status', 'DRAFT')->count());
        $this->assertSame(1, $this->sequenceValue('INVOICE'), 'Le numéro de l\'émission refusée est revenu avec sa transaction.');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Caisse
    // ------------------------------------------------------------------------------------------------------------

    public function test_deux_ouvertures_simultanees_sur_la_meme_caisse_n_en_ouvrent_qu_une(): void
    {
        $children = [];
        $this->holdClinicLock($this->clinicId);
        foreach ([[$this->cashier, 'cle-ouverture-aaa01'], [$this->second, 'cle-ouverture-bbb01']] as [$actor, $key]) {
            $session = Ulid::generate();
            $body = $this->openSessionBody(25000, ['cash_session_id' => $session, 'opened_at' => $this->instant(-60)]);
            unset($body['expected_version']);
            $children[] = $this->child('command', ['actor_id' => $actor->id, 'name' => 'OpenCashSession', 'entity_id' => $session, 'key' => $key, 'payload' => $body]);
        }
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();
        $outcomes = $this->outcomes($children);

        $this->assertSame(['OK', 'STATE_TRANSITION_REFUSED'], $this->codes($outcomes));
        $this->assertSame(1, DB::table('cash_sessions')->where('clinic_id', $this->clinicId)->whereNull('closed_at')->count());
        $this->assertSame(1, DB::table('cash_sessions')->where('clinic_id', $this->clinicId)->count());
    }
}

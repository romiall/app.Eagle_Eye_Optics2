<?php

namespace Tests\Concurrency;

use App\Domain\Access\Approvals\ApprovalSubject;
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
use Tests\Support\ScratchMysqlDatabases;
use Tests\TestCase;

/**
 * Entrelacements contrôlés des corrections et des approbations entre CONNEXIONS MYSQL RÉELLES (fichier 25 ; fiches B06,
 * B07, B08 : « Replay approbation et hash différent », « Deux avoirs concurrents », « Concurrence refund et session
 * close »), sur une base jetable migrée une fois pour la classe. Chaque opération s'exécute dans un processus PHP enfant
 * suspendu derrière le verrou du cabinet tenu par le test, puis relâché : aucun sleep, aucun hasard.
 *
 * Données fictives ; l'horloge n'est pas figée (les enfants lisent l'heure réelle du serveur).
 */
final class CorrectionsConcurrencyTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use ScenarioHarness;
    use ScratchMysqlDatabases;

    private const CONNECTION = 'concurrency_corrections';

    private const DATABASE = 'eeo_conc_corrections_test';

    private const SCRIPT = 'command-scenario.php';

    private const WAIT = 300.0;

    private static bool $migrated = false;

    private static bool $warmedUp = false;

    private User $secondManager;

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
        $this->secondManager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante2.test');
        $this->cashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.test');
        $this->patientId = $this->seedPatient($this->clinicId);
        $this->registerId = $this->seedRegister($this->clinicId);
        $this->locationId = $this->seedLocation($this->clinicId);
        $this->item = [
            'exam' => $this->seedItem($this->clinicId, ['reference' => 'EX-001', 'name' => 'Examen de vue (fictif)', 'category_code' => 'SERVICE', 'unit_code' => 'SERVICE', 'quantity_integer_only' => 0, 'sale_price' => 15000, 'stock_mode' => 'NONE']),
            'lens' => $this->seedItem($this->clinicId, ['reference' => 'LS-001', 'name' => 'Verres fictifs sur mesure', 'category_code' => 'LENS', 'unit_code' => 'PAIR', 'sale_price' => 60000, 'stock_mode' => 'MADE_TO_ORDER']),
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
     * Facture de 50 000 émise et entièrement payée : [facture, paiement].
     *
     * @return array{0: string, 1: string}
     */
    private function paidInvoice(int $total = 50000): array
    {
        [$id] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, $total)], $this->manager);
        $this->pay($id, 1, $total, 'MTN_MOMO', ['effective_at' => $this->instant(-90)], $this->manager)->assertCreated();

        return [$id, $this->firstPayment($id)];
    }

    /**
     * @param  array<string, mixed>  $body  corps direct (sa version attendue est passée à part)
     */
    private function command(User $actor, string $name, string $entityId, array $body, string $key): ScenarioProcess
    {
        $version = $body['expected_version'] ?? null;
        unset($body['expected_version']);

        return $this->child('command', ['actor_id' => $actor->id, 'name' => $name, 'entity_id' => $entityId, 'expected_version' => $version, 'key' => $key, 'payload' => $body]);
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

    public function test_deux_avoirs_concurrents_sur_la_meme_ligne_ne_depassent_jamais_l_original(): void
    {
        [$invoice] = $this->paidInvoice();
        $line = $this->firstLine($invoice);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->command($this->manager, 'IssueCreditNote', $invoice, $this->creditNoteBody($invoice, 2, [$this->creditLine($line, 30000)]), 'cle-avoir-aaaaaa01'),
            $this->command($this->secondManager, 'IssueCreditNote', $invoice, $this->creditNoteBody($invoice, 2, [$this->creditLine($line, 30000)]), 'cle-avoir-bbbbbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $this->assertSame(['OK', 'VERSION_CONFLICT'], $this->codes($children));
        $this->assertSame(30000, (int) DB::table('credit_note_lines')->where('invoice_line_id', $line)->sum('amount_gross'));
        $this->assertSame(1, DB::table('credit_notes')->where('invoice_id', $invoice)->count());
        $this->assertSame(1, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'CREDIT_NOTE')->value('last_value'), 'Aucun numéro d\'avoir brûlé.');
        $this->assertSame(1, DB::table('approvals')->where('clinic_id', $this->clinicId)->where('action_code', 'credit_note.issue')->count(), 'Le refus a annulé son autorisation directe.');
    }

    public function test_deux_remboursements_concurrents_du_meme_credit_n_en_paient_qu_un(): void
    {
        [$invoice] = $this->paidInvoice();
        $note = (string) $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 2, [$this->creditLine($this->firstLine($invoice), 30000)]), $this->manager)->assertCreated()->json('data.credit_note_id');
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->command($this->manager, 'RefundCredit', $invoice, $this->refundBody($invoice, $note, 3, 20000, 'MTN_MOMO', ['effective_at' => $this->instant(-30)]), 'cle-rmb-aaaaaa001'),
            $this->command($this->secondManager, 'RefundCredit', $invoice, $this->refundBody($invoice, $note, 3, 20000, 'MTN_MOMO', ['effective_at' => $this->instant(-30)]), 'cle-rmb-bbbbbb001'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $this->assertSame(['OK', 'VERSION_CONFLICT'], $this->codes($children));
        $this->assertSame(20000, (int) DB::table('refunds')->where('invoice_id', $invoice)->sum('amount'));
        $this->assertSame(1, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'REFUND')->value('last_value'));
    }

    public function test_un_remboursement_especes_et_la_cloture_de_la_session_ne_sont_jamais_incoherents(): void
    {
        [$invoice] = $this->paidInvoice();
        $note = (string) $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 2, [$this->creditLine($this->firstLine($invoice), 30000)]), $this->manager)->assertCreated()->json('data.credit_note_id');
        $session = Ulid::generate();
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(50000, ['cash_session_id' => $session, 'opened_at' => $this->instant(-60)]), $this->manager)->assertCreated();
        $close = $this->closeSessionBody($session, 50000, 50000, null, ['closed_at' => $this->instant(-10)]);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->command($this->manager, 'RefundCredit', $invoice, $this->refundBody($invoice, $note, 3, 10000, 'CASH', ['cash_session_id' => $session, 'effective_at' => $this->instant()]), 'cle-rmb-especes01'),
            $this->command($this->manager, 'CloseCashSession', $session, $close, 'cle-cloture-rmb001'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $codes = $this->codes($children);
        $this->assertContains($codes, [['OK', 'STATE_TRANSITION_REFUSED'], ['OK', 'VERSION_CONFLICT']]);
        $closedAt = DB::table('cash_sessions')->where('id', $session)->value('closed_at');
        $refunds = DB::table('refunds')->where('cash_session_id', $session)->count();
        $this->assertTrue(($closedAt === null && $refunds === 1) || ($closedAt !== null && $refunds === 0), 'Soit le remboursement sort d\'une session ouverte, soit la session est close sans lui.');
    }

    public function test_une_approbation_n_est_consommee_qu_une_fois_meme_par_deux_executions_simultanees(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $this->allowPermission($this->cashier, 'payment.reverse');
        $approval = $this->approved(ApprovalSubject::paymentReversal($invoice, $payment, 20000)->toArray(), $this->cashier);
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->command($this->cashier, 'ReversePayment', $invoice, $this->reversalBody($invoice, $payment, 2, 20000, ['approval_id' => $approval]), 'cle-contre-aaaa01'),
            $this->command($this->cashier, 'ReversePayment', $invoice, $this->reversalBody($invoice, $payment, 2, 20000, ['approval_id' => $approval]), 'cle-contre-bbbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $codes = $this->codes($children);
        $this->assertContains($codes, [['APPROVAL_REQUIRED_OR_EXPIRED', 'OK'], ['OK', 'VERSION_CONFLICT']]);
        $this->assertSame(1, DB::table('payment_reversals')->where('payment_id', $payment)->count());
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $approval)->value('status'));
    }

    public function test_deux_gerantes_qui_decident_la_meme_demande_n_en_enregistrent_qu_une_decision(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $id = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 20000)->toArray(), $this->cashier)->assertCreated()->json('data.id');
        $this->holdClinicLock($this->clinicId);
        $children = [
            $this->command($this->manager, 'DecideApproval', $id, ['expected_version' => null, 'approval_id' => $id, 'decision' => 'APPROVED', 'reason' => null], 'cle-decision-aaa01'),
            $this->command($this->secondManager, 'DecideApproval', $id, ['expected_version' => null, 'approval_id' => $id, 'decision' => 'REFUSED', 'reason' => 'Refus fictif'], 'cle-decision-bbb01'),
        ];
        $this->waitForBlockedQuery('`clinics`', 'for update', 2);

        $this->releaseGate();

        $this->assertSame(['OK', 'STATE_TRANSITION_REFUSED'], $this->codes($children));
        $this->assertContains(DB::table('approvals')->where('id', $id)->value('status'), ['APPROVED', 'REFUSED']);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'approval.decided')->where('target_id', $id)->count());
    }
}

<?php

namespace Tests\Feature\Billing;

use App\Domain\Billing\ExistingInvoiceAutoCollector;
use App\Domain\Cash\CashSessionReport;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Rattrapage idempotent des factures valides existantes émises sans encaissement (A1) : crée le paiement
 * 100 % espèces à l'exacte heure d'émission (`effective_at = issued_at`), son reçu numéroté et son entrée
 * chronologique dans le journal de caisse. Sans effet sur les factures déjà encaissées, créditées ou
 * reprises papier. Données fictives.
 */
final class ExistingInvoiceAutoCollectorTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_regularise_les_factures_emises_sans_paiement_a_leur_heure_d_emission_et_reste_idempotent(): void
    {
        $sessionId = $this->openedSession($this->manager, 10000);
        // La session a été ouverte à 09:00 UTC ; on vieillit son ouverture pour couvrir des factures de test à 09:05 et 09:15.
        DB::table('cash_sessions')->where('id', $sessionId)->update(['opened_at' => '2026-10-22 08:00:00.000000']);

        // 1) Facture émise AVANT la règle A1 sans paiement (ex. FAC-2026-000001 = 3 000 FCFA, FAC-2026-000002 = 33 000 FCFA).
        $legacyIssuedAt1 = '2026-10-22 09:05:12.123000';
        $legacyIssuedAt2 = '2026-10-22 09:15:45.654000';
        $inv1 = $this->insertUncollectedIssuedInvoice('TEST-FAC-2026-000001', 3000, $legacyIssuedAt1);
        $inv2 = $this->insertUncollectedIssuedInvoice('TEST-FAC-2026-000002', 33000, $legacyIssuedAt2);

        // 2) Facture reprise papier (`LEGACY_BALANCE`) : ne doit PAS être collectée automatiquement.
        $legacyImport = $this->insertUncollectedIssuedInvoice('TEST-REP-2026-000001', 15000, '2026-10-22 09:20:00.000000', 'LEGACY_BALANCE');

        $collector = $this->app->make(ExistingInvoiceAutoCollector::class);
        $first = $collector->collectAll();

        $this->assertSame(['collected' => 2, 'skipped' => 0], $first);

        foreach ([$inv1 => [$legacyIssuedAt1, 3000], $inv2 => [$legacyIssuedAt2, 33000]] as $invoiceId => [$expectedAt, $expectedAmount]) {
            $payment = DB::table('payments')->where('clinic_id', $this->clinicId)->where('invoice_id', $invoiceId)->first();
            $this->assertNotNull($payment);
            $this->assertSame('CONFIRMED', $payment->status);
            $this->assertSame('CASH', $payment->method);
            $this->assertSame($expectedAmount, (int) $payment->amount);
            $this->assertSame($sessionId, $payment->cash_session_id);
            $this->assertSame($expectedAt, $payment->effective_at);

            $receipt = DB::table('receipts')->where('payment_id', $payment->id)->first();
            $this->assertNotNull($receipt);
            $this->assertSame($expectedAt, $receipt->issued_at);
        }

        $this->assertSame(0, DB::table('payments')->where('invoice_id', $legacyImport)->count());

        // Second passage : 100 % idempotent, aucun doublon.
        $second = $collector->collectAll();
        $this->assertSame(['collected' => 0, 'skipped' => 0], $second);
        $this->assertSame(2, DB::table('payments')->where('clinic_id', $this->clinicId)->count());

        // Apparaissent dans le journal chronologique de la session dans l'ordre exact d'émission.
        $session = DB::table('cash_sessions')->where('clinic_id', $this->clinicId)->where('id', $sessionId)->first();
        $this->assertNotNull($session);
        $report = CashSessionReport::build($session, CarbonImmutable::now('UTC'));
        $this->assertSame(36000, $report['cash_received']);
        $this->assertSame(['TEST-FAC-2026-000001', 'TEST-FAC-2026-000002'], array_column($report['journal'], 'invoice_number'));
    }

    public function test_ignore_si_aucune_session_de_caisse_n_est_ouverte_pour_la_date_d_emission(): void
    {
        $sessionId = $this->openedSession($this->manager, 10000);
        $invBefore = $this->insertUncollectedIssuedInvoice('TEST-FAC-2026-000010', 3000, '2026-10-22 08:30:00.000000');

        $collector = $this->app->make(ExistingInvoiceAutoCollector::class);
        $res = $collector->collectAll();

        $this->assertSame(['collected' => 0, 'skipped' => 1], $res);
        $this->assertSame(0, DB::table('payments')->where('invoice_id', $invBefore)->count());

        // Clôturée : ne collecte rien non plus.
        $this->write('POST', '/api/v1/cash-sessions/'.$sessionId.'/close', $this->closeSessionBody($sessionId, 10000, 10000), $this->manager)->assertOk();
        $this->assertSame(['collected' => 0, 'skipped' => 1], $collector->collectAll());
    }

    private function insertUncollectedIssuedInvoice(string $number, int $total, string $issuedDb, string $origin = 'NATIVE'): string
    {
        $invoiceId = Ulid::generate();
        $usageId = Ulid::generate();
        $nowDb = CarbonImmutable::parse($issuedDb, 'UTC')->format('Y-m-d H:i:s.u');
        DB::table('document_number_usages')->insert([
            'id' => $usageId,
            'clinic_id' => $this->clinicId,
            'allocation_id' => null,
            'document_type' => $origin === 'NATIVE' ? 'INVOICE' : 'LEGACY_BALANCE',
            'document_year' => 2026,
            'number_value' => (int) substr($number, -6),
            'rendered_number' => $number,
            'entity_type' => 'invoices',
            'entity_id' => $invoiceId,
            'source_device_id' => null,
            'actor_id' => $this->manager->id,
            'consumed_at' => $issuedDb,
            'status' => 'USED',
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        DB::table('invoices')->insert([
            'id' => $invoiceId,
            'clinic_id' => $this->clinicId,
            'patient_id' => $this->patientId,
            'visit_id' => null,
            'number' => $number,
            'issued_at' => $issuedDb,
            'issued_by' => $this->manager->id,
            'number_usage_id' => $usageId,
            'status' => 'ISSUED',
            'origin' => $origin,
            'legacy_reference' => $origin === 'LEGACY_BALANCE' ? $number : null,
            'legacy_opening_balance' => $origin === 'LEGACY_BALANCE' ? $total : null,
            'due_date' => null,
            'currency' => 'XAF',
            'total_gross' => $total,
            'patient_snapshot' => json_encode(['patient_id' => $this->patientId, 'record_number' => 'TEST-P-000001', 'last_name' => 'Patient', 'first_names' => 'Fictif'], JSON_THROW_ON_ERROR),
            'clinic_snapshot' => json_encode(['clinic_id' => $this->clinicId, 'name' => 'Test', 'currency' => 'XAF', 'timezone' => 'Africa/Douala', 'test_document' => true], JSON_THROW_ON_ERROR),
            'tax_snapshot' => json_encode(['regime' => 'NO_TAX_CONFIGURED', 'rules' => []], JSON_THROW_ON_ERROR),
            'version' => 1,
            'created_by' => $this->manager->id,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        return $invoiceId;
    }
}

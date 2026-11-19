<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Sessions de caisse de tous les postes pour la gérante (`cash.manage`) et relevé d'une session (B05) : la caissière
 * ne lit que le relevé de SA session (fichier 09), la gérante celui de toute session et clôture celle d'une autre.
 * Le relevé sépare le tiroir espèces des autres modes ; une session ouverte donne un relevé provisoire. Fictif.
 */
final class CashSessionDirectoryTest extends TestCase
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

    public function test_la_gerante_liste_les_sessions_ouvertes_d_abord_avec_les_noms(): void
    {
        $closed = $this->openedSession($this->manager);
        $this->write('POST', '/api/v1/cash-sessions/'.$closed.'/close', $this->closeSessionBody($closed, 25000, 25000, null, ['closed_at' => self::NOW]), $this->manager)->assertOk();
        $open = $this->openedSession($this->cashier);

        $response = $this->read('/api/v1/cash-sessions', $this->manager)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashSessionPage');
        $this->assertSame([$open, $closed], array_column($response->json('data'), 'id'));
        $cashierName = (string) DB::table('users')->where('id', $this->cashier->id)->value('display_name');
        $managerName = (string) DB::table('users')->where('id', $this->manager->id)->value('display_name');
        $response->assertJsonPath('data.0.cashier_name', $cashierName)
            ->assertJsonPath('data.0.register_code', 'CAISSE-PRINCIPALE')
            ->assertJsonPath('data.0.closed_by_name', null)
            ->assertJsonPath('data.1.closed_by_name', $managerName);

        $this->read('/api/v1/cash-sessions?state=open', $this->manager)->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $open);
        $this->read('/api/v1/cash-sessions?state=closed', $this->manager)->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $closed);
        $this->read('/api/v1/cash-sessions?state=paid', $this->manager)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['state']]]);
    }

    public function test_seule_la_gerante_liste_les_sessions(): void
    {
        $this->read('/api/v1/cash-sessions', $this->cashier)->assertForbidden();
        $this->read('/api/v1/cash-sessions', $this->reception)->assertForbidden();
        $this->read('/api/v1/cash-sessions', $this->clinician)->assertForbidden();
    }

    public function test_la_gerante_cloture_la_session_d_une_autre_caissiere(): void
    {
        $session = $this->openedSession($this->cashier);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000, null, ['closed_at' => self::NOW]), $this->manager)
            ->assertOk()
            ->assertJsonPath('data.closed_by', $this->manager->id);
    }

    public function test_le_releve_separe_le_tiroir_especes_des_autres_modes(): void
    {
        $session = $this->openedSession($this->cashier, 10000);
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 30000, 'CASH', ['cash_session_id' => $session], $this->cashier)->assertCreated();
        $this->pay($invoice, 2, 20000, 'MTN_MOMO', [], $this->cashier)->assertCreated();
        // Encaissement d'une autre personne : hors du relevé de cette caissière.
        $this->pay($invoice, 3, 5000, 'ORANGE_MONEY', [], $this->manager)->assertCreated();

        $response = $this->read('/api/v1/cash-sessions/'.$session.'/report', $this->cashier)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashSessionReportResponse');
        $response->assertJsonPath('data.session.id', $session)
            ->assertJsonPath('data.session.opening_amount', 10000)
            ->assertJsonPath('data.session.theoretical_cash', 40000)
            ->assertJsonPath('data.session.closed_at', null)
            ->assertJsonPath('data.cash_received', 30000)
            ->assertJsonPath('data.cash_reversed', 0)
            ->assertJsonPath('data.cash_refunded', 0)
            ->assertJsonPath('data.movements_in', 0)
            ->assertJsonPath('data.movements_out', 0)
            ->assertJsonPath('data.other_methods', [['method' => 'MTN_MOMO', 'count' => 1, 'amount' => 20000]]);
        $this->assertSame(['CASH', 'MTN_MOMO'], array_column($response->json('data.payments'), 'method'));
        foreach ($response->json('data.payments') as $payment) {
            $this->assertNotNull($payment['receipt_number'], 'Chaque encaissement a son reçu');
        }
    }

    public function test_la_caissiere_ne_lit_que_le_releve_de_sa_session(): void
    {
        $other = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.deux');
        $session = $this->openedSession($this->cashier);

        $this->read('/api/v1/cash-sessions/'.$session.'/report', $other)->assertForbidden();
        $this->read('/api/v1/cash-sessions/'.$session.'/report', $this->manager)->assertOk();
        $this->read('/api/v1/cash-sessions/'.$session.'/report', $this->reception)->assertForbidden();
        $this->read('/api/v1/cash-sessions/01J9ZXK4M2Q8R7S6T5V4W3ZZZZ/report', $this->cashier)->assertNotFound();
    }

    public function test_une_session_d_un_autre_cabinet_est_introuvable(): void
    {
        $session = $this->openedSession($this->cashier);
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.b');

        $this->read('/api/v1/cash-sessions/'.$session.'/report', $otherManager)->assertNotFound();
        $this->read('/api/v1/cash-sessions', $otherManager)->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_module_ferme_404(): void
    {
        $session = $this->openedSession($this->cashier);
        config(['eeo.enabled_modules' => ['stock']]);

        $this->read('/api/v1/cash-sessions', $this->manager)->assertNotFound();
        $this->read('/api/v1/cash-sessions/'.$session.'/report', $this->cashier)->assertNotFound();
    }

    public function test_le_journal_chronologique_fusionne_factures_encaissees_depenses_et_contre_ecritures(): void
    {
        $session = $this->openedSession($this->cashier, 10000);
        $catId = Ulid::generate();
        $this->write('POST', '/api/v1/expense-categories', [
            'expected_version' => null, 'category_id' => $catId, 'code' => 'PAPETERIE', 'name' => 'Papeterie', 'active' => true,
        ], $this->manager)->assertOk();

        // 09:29 UTC : émission auto-encaissée 15 000 FCFA
        [$invoiceId, , $invoiceNumber] = $this->issuedInvoice([$this->line($this->item['exam'])], $this->cashier);
        $paymentId = (string) DB::table('payments')->where('invoice_id', $invoiceId)->value('id');

        // 09:30 UTC (NOW) : dépense tiroir 2 500 FCFA puis contre-écriture 5 000 FCFA
        $this->write('POST', '/api/v1/cash-movements', [
            'expected_version' => null,
            'movement_id' => Ulid::generate(),
            'cash_session_id' => $session,
            'movement_kind' => 'EXPENSE',
            'method' => 'CASH',
            'signed_amount' => -2500,
            'expense_category_id' => $catId,
            'reason' => 'Ramettes A4',
            'reference' => 'BON-01',
            'approval_id' => null,
            'occurred_at' => self::NOW,
        ], $this->cashier)->assertCreated();

        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/payments/'.$paymentId.'/reversals', [
                'expected_version' => 2,
                'invoice_id' => $invoiceId,
                'payment_id' => $paymentId,
                'reversal_id' => Ulid::generate(),
                'amount' => 5000,
                'reason' => 'Erreur de caisse',
                'approval_id' => Ulid::generate(),
            ])->assertCreated();

        $report = $this->read('/api/v1/cash-sessions/'.$session.'/report', $this->cashier)->assertOk();
        $journal = $report->json('data.journal');
        $this->assertCount(3, $journal);
        $this->assertSame(['PAYMENT', 'CASH_MOVEMENT', 'PAYMENT_REVERSAL'], array_column($journal, 'entry_type'));
        $this->assertSame([15000, -2500, -5000], array_column($journal, 'signed_amount'));
        $this->assertSame($invoiceNumber, $journal[0]['invoice_number']);
        $this->assertSame('BON-01', $journal[1]['reference']);
    }
}

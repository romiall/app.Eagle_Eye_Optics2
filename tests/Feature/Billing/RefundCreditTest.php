<?php

namespace Tests\Feature\Billing;

use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Remboursement réel d'un crédit (B08, AT14, AT25, AT37 ; EE024, EE030, EE045) sur MySQL réel : lié à un avoir émis,
 * limité au crédit disponible et à la part de l'avoir non remboursée, pièce numérotée TEST-RMB avec son snapshot et son
 * document en attente ; espèces dans la session ouverte de l'auteur (la clôture compte la sortie) ; une clé ne rembourse
 * qu'une fois ; facture, avoir et reçus jamais modifiés. Données fictives.
 */
final class RefundCreditTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'settings']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Facture 80 000 entièrement payée, avoir de 30 000 : [facture, avoir, ledger_version courante].
     *
     * @return array{0: string, 1: string, 2: int}
     */
    private function inCredit(int $credit = 30000): array
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 80000)->assertCreated();
        $note = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 2, [$this->creditLine($this->firstLine($invoice), $credit)]), $this->manager)->assertCreated();

        return [$invoice, (string) $note->json('data.credit_note_id'), 3];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function refund(string $invoice, string $note, int $version, int $amount, string $method = 'MTN_MOMO', array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $this->refundBody($invoice, $note, $version, $amount, $method, $overrides), $as ?? $this->manager, $key);
    }

    public function test_le_remboursement_du_credit_solde_la_facture_sans_modifier_aucune_piece(): void
    {
        [$invoice, $note, $version] = $this->inCredit();
        $invoiceBefore = DB::table('invoices')->where('id', $invoice)->first();
        $noteBefore = DB::table('credit_notes')->where('id', $note)->first();
        $receiptsBefore = DB::table('receipts')->where('invoice_id', $invoice)->get()->all();

        $response = $this->refund($invoice, $note, $version, 30000);

        $response->assertCreated()
            ->assertJsonPath('data.amount', 30000)
            ->assertJsonPath('data.ledger_version', 4)
            ->assertJsonPath('data.balance.balance_due', 0)
            ->assertJsonPath('data.balance.refunded', 30000)
            ->assertJsonPath('data.balance.credit_available', 0)
            ->assertJsonPath('data.document.document_status', 'PENDING');
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/RefundResultResponse');
        $this->assertMatchesRegularExpression('/^TEST-RMB-\d{4}-000001$/', (string) $response->json('data.number'));
        $this->assertEquals($invoiceBefore, DB::table('invoices')->where('id', $invoice)->first());
        $this->assertEquals($noteBefore, DB::table('credit_notes')->where('id', $note)->first());
        $this->assertEquals($receiptsBefore, DB::table('receipts')->where('invoice_id', $invoice)->get()->all());

        $refund = DB::table('refunds')->where('id', $response->json('data.refund_id'))->first();
        $this->assertNotNull($refund);
        $snapshot = json_decode((string) $refund->snapshot, false, 512, JSON_THROW_ON_ERROR);
        $this->assertDataMatchesContract($snapshot, 'snapshots/refund.json');
        $this->assertSame('refund.v1', $snapshot->template_version);
        $document = DB::table('generated_documents')->where('refund_id', $refund->id)->first();
        $this->assertNotNull($document);
        $this->assertSame(['REFUND', 'PENDING'], [$document->document_type, $document->status]);
        $this->assertSame(1, $this->auditCount('refund.executed', (string) $refund->id));
    }

    public function test_jamais_au_dela_du_credit_ni_de_la_part_de_l_avoir_non_remboursee(): void
    {
        [$invoice, $note, $version] = $this->inCredit();

        $this->refund($invoice, $note, $version, 30001)->assertStatus(422)->assertJsonPath('error.details.refundable_credit', 30000);
        $this->refund($invoice, $note, $version, 20000)->assertCreated();
        $this->refund($invoice, $note, $version + 1, 10001)->assertStatus(422);
        $this->refund($invoice, $note, $version + 1, 10000)->assertCreated();
        $this->refund($invoice, $note, $version + 2, 1)->assertStatus(422);
        $this->assertSame(30000, (int) DB::table('refunds')->where('credit_note_id', $note)->sum('amount'));
    }

    public function test_sans_avoir_emis_de_la_facture_aucun_remboursement(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        [$other, $otherNote] = $this->inCredit();

        $this->refund($invoice, $otherNote, 1, 1000)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['credit_note_id']]]);
        $this->refund($invoice, Ulid::generate(), 1, 1000)->assertStatus(422);
        $this->assertSame(0, DB::table('refunds')->where('invoice_id', $invoice)->count());
        $this->assertNotSame($invoice, $other);
    }

    public function test_un_remboursement_especes_sort_de_la_session_ouverte_de_l_auteur_et_jamais_d_une_session_close(): void
    {
        [$invoice, $note, $version] = $this->inCredit();
        $this->refund($invoice, $note, $version, 5000, 'CASH')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);

        $session = $this->openedSession($this->manager, 50000);
        $this->refund($invoice, $note, $version, 5000, 'CASH', ['cash_session_id' => $session])->assertCreated();
        $this->read('/api/v1/cash-sessions/current', $this->manager)->assertOk()
            ->assertJsonPath('data.refunded_cash', 5000)
            ->assertJsonPath('data.theoretical_cash', 45000);

        // Session d'une autre caissière (sur une seconde caisse fictive) : jamais la caisse de l'auteur.
        $body = $this->openSessionBody(10000, ['cash_register_id' => $this->seedRegister($this->clinicId, 'CAISSE-SECONDE')]);
        $this->write('POST', '/api/v1/cash-sessions', $body, $this->cashier)->assertCreated();
        $this->refund($invoice, $note, $version + 1, 5000, 'CASH', ['cash_session_id' => (string) $body['cash_session_id']])->assertStatus(422);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 45000, 45000, null, ['closed_at' => self::NOW]), $this->manager)->assertOk();
        $this->refund($invoice, $note, $version + 1, 5000, 'CASH', ['cash_session_id' => $session])
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->assertSame(1, DB::table('refunds')->where('invoice_id', $invoice)->count());
    }

    public function test_reference_obligatoire_date_du_jour_et_un_seul_remboursement_par_cle(): void
    {
        [$invoice, $note, $version] = $this->inCredit();
        $this->refund($invoice, $note, $version, 5000, 'MTN_MOMO', ['reference' => null])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reference']]]);
        $this->refund($invoice, $note, $version, 5000, 'MTN_MOMO', ['effective_at' => '2026-10-21T09:00:00.000Z'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['effective_at']]]);

        $body = $this->refundBody($invoice, $note, $version, 5000);
        $key = Ulid::generate();
        $first = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $body, $this->manager, $key)->assertCreated();
        $second = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $body, $this->manager, $key)->assertCreated();

        $this->assertSame($first->json('data.number'), $second->json('data.number'));
        $this->assertSame(1, DB::table('refunds')->where('invoice_id', $invoice)->count());
    }

    public function test_la_caisse_rembourse_avec_l_approbation_exacte_du_montant_et_du_mode(): void
    {
        [$invoice, $note, $version] = $this->inCredit();
        $this->allowPermission($this->cashier, 'refund.execute');
        $approval = $this->approved(ApprovalSubject::refund($invoice, $note, 30000, 'MTN_MOMO')->toArray(), $this->cashier);

        $this->refund($invoice, $note, $version, 30000, 'ORANGE_MONEY', ['approval_id' => $approval], $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
        $this->refund($invoice, $note, $version, 30000, 'MTN_MOMO', ['approval_id' => $approval], $this->cashier)->assertCreated();
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $approval)->value('status'));
    }
}

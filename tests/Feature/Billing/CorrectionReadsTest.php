<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Lecture des corrections d'une facture émise (B07, B08) : la facture rend ses contre-écritures (motif, auteur), ses
 * avoirs (motif, part déjà remboursée) et ses remboursements (avoir lié) ; `GET /credit-notes/{id}` et
 * `GET /refunds/{id}` rendent chaque pièce avec son snapshot figé (source de son PDF) et l'état de son document.
 * Droit `invoice.read`, module « sales », isolation entre cabinets. Données fictives.
 */
final class CorrectionReadsTest extends TestCase
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
     * Facture 80 000 payée deux fois (50 000 + 30 000), contre-écriture de 10 000 sur le second paiement, avoir de
     * 30 000 remboursé à hauteur de 5 000 : [facture, avoir, remboursement].
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function corrected(): array
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 50000)->assertCreated();
        $this->pay($invoice, 2, 30000)->assertCreated();
        $payments = DB::table('payments')->where('invoice_id', $invoice)->orderBy('effective_at')->orderBy('created_at')->pluck('id')->all();
        $this->writeReauthenticated('POST', '/api/v1/payments/'.$payments[1].'/reversals', $this->reversalBody($invoice, (string) $payments[1], 3, 10000), $this->manager)->assertCreated();
        $note = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 4, [$this->creditLine($this->firstLine($invoice), 30000)]), $this->manager)->assertCreated();
        $noteId = (string) $note->json('data.credit_note_id');
        $refund = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $this->refundBody($invoice, $noteId, 5, 5000), $this->manager)->assertCreated();

        return [$invoice, $noteId, (string) $refund->json('data.refund_id')];
    }

    public function test_la_facture_rend_ses_contre_ecritures_ses_avoirs_et_ses_remboursements(): void
    {
        [$invoice, $noteId, $refundId] = $this->corrected();

        $response = $this->read('/api/v1/invoices/'.$invoice, $this->manager)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
        $response->assertJsonCount(1, 'data.reversals')
            ->assertJsonPath('data.reversals.0.amount', 10000)
            ->assertJsonPath('data.reversals.0.recorded_by', $this->manager->id)
            ->assertJsonPath('data.credit_notes.0.id', $noteId)
            ->assertJsonPath('data.credit_notes.0.refunded_amount', 5000)
            ->assertJsonPath('data.refunds.0.id', $refundId)
            ->assertJsonPath('data.refunds.0.credit_note_id', $noteId);
        $this->assertNotSame('', (string) $response->json('data.reversals.0.reason'));
        $this->assertNotSame('', (string) $response->json('data.credit_notes.0.reason'));
    }

    public function test_l_avoir_se_lit_avec_ses_lignes_son_snapshot_et_l_etat_de_son_document(): void
    {
        [$invoice, $noteId] = $this->corrected();

        $response = $this->read('/api/v1/credit-notes/'.$noteId, $this->cashier)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CreditNoteResponse');
        $response->assertJsonPath('data.invoice_id', $invoice)
            ->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.amount_gross', 30000)
            ->assertJsonPath('data.refunded_amount', 5000)
            ->assertJsonPath('data.issued_by', $this->manager->id)
            ->assertJsonPath('data.snapshot.template_version', 'credit_note.v1')
            ->assertJsonPath('data.document.document_status', 'PENDING')
            ->assertJsonCount(1, 'data.lines');
        $this->assertMatchesRegularExpression('/^TEST-AV-\d{4}-000001$/', (string) $response->json('data.number'));
    }

    public function test_le_remboursement_se_lit_avec_son_snapshot_et_l_etat_de_son_document(): void
    {
        [$invoice, $noteId, $refundId] = $this->corrected();

        $response = $this->read('/api/v1/refunds/'.$refundId, $this->cashier)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/RefundResponse');
        $response->assertJsonPath('data.invoice_id', $invoice)
            ->assertJsonPath('data.credit_note_id', $noteId)
            ->assertJsonPath('data.amount', 5000)
            ->assertJsonPath('data.created_by', $this->manager->id)
            ->assertJsonPath('data.snapshot.template_version', 'refund.v1')
            ->assertJsonPath('data.document.document_status', 'PENDING');
    }

    public function test_droits_module_et_isolation_entre_cabinets(): void
    {
        [, $noteId, $refundId] = $this->corrected();

        // L'accueil ne lit pas les pièces financières (invoice.read absent du profil seedé).
        $this->read('/api/v1/credit-notes/'.$noteId, $this->reception)->assertStatus(403);
        $this->read('/api/v1/refunds/'.$refundId, $this->reception)->assertStatus(403);

        $this->read('/api/v1/credit-notes/'.Ulid::generate(), $this->manager)->assertNotFound();
        $this->read('/api/v1/refunds/'.Ulid::generate(), $this->manager)->assertNotFound();

        // Une pièce d'un autre cabinet est introuvable : la gérante d'un autre cabinet ne la lit pas.
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.b.test');
        $this->read('/api/v1/credit-notes/'.$noteId, $otherManager)->assertNotFound();
        $this->read('/api/v1/refunds/'.$refundId, $otherManager)->assertNotFound();
    }

    public function test_module_ventes_ferme_repond_introuvable(): void
    {
        [, $noteId, $refundId] = $this->corrected();
        config(['eeo.enabled_modules' => ['stock', 'settings']]);

        $this->read('/api/v1/credit-notes/'.$noteId, $this->manager)->assertNotFound();
        $this->read('/api/v1/refunds/'.$refundId, $this->manager)->assertNotFound();
    }
}

<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Avoir lié aux lignes d'une facture émise (B07, AT14, AT24 ; EE017, EE029, EE045) sur MySQL réel : réduction de la
 * créance, jamais modification de la facture, de ses lignes, de ses reçus ni du stock ; cumul plafonné par ligne et par
 * facture ; numéro TEST-AV, snapshot figé, document en attente ; approbation exacte ou exécution directe de la gérante ;
 * un avoir au-delà du reste dû fait apparaître un crédit à rembourser. Données fictives.
 */
final class CreditNoteTest extends TestCase
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
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $overrides
     */
    private function credit(string $invoice, int $version, array $lines, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, $version, $lines, $overrides), $as ?? $this->manager, $key);
    }

    public function test_l_exemple_du_fichier_03_avoir_puis_annulation_totale_fait_apparaitre_le_credit(): void
    {
        // Facture 80 000 ; acompte 30 000 ; paiement 20 000 ; avoir 10 000 → reste 20 000 ; avoir 70 000 → 50 000 à rembourser.
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 30000)->assertCreated();
        $this->pay($invoice, 2, 20000)->assertCreated();
        $line = $this->firstLine($invoice);
        $invoiceBefore = DB::table('invoices')->where('id', $invoice)->first();
        $linesBefore = DB::table('invoice_lines')->where('invoice_id', $invoice)->get()->all();

        $first = $this->credit($invoice, 3, [$this->creditLine($line, 10000)]);

        $first->assertCreated()
            ->assertJsonPath('data.amount_gross', 10000)
            ->assertJsonPath('data.ledger_version', 4)
            ->assertJsonPath('data.balance.balance_due', 20000)
            ->assertJsonPath('data.balance.credited', 10000)
            ->assertJsonPath('data.document.document_status', 'PENDING');
        $this->assertMatchesContract($first, 'schemas/resources/billing.json#/$defs/CreditNoteResultResponse');
        $this->assertMatchesSequence('TEST-AV', (string) $first->json('data.number'), 1);

        $second = $this->credit($invoice, 4, [$this->creditLine($line, 70000)])->assertCreated();
        $second->assertJsonPath('data.balance.balance_due', -50000)
            ->assertJsonPath('data.balance.credit_available', 50000)
            ->assertJsonPath('data.balance.settlement', 'IN_CREDIT');
        $this->assertMatchesSequence('TEST-AV', (string) $second->json('data.number'), 2);

        $this->assertEquals($invoiceBefore, DB::table('invoices')->where('id', $invoice)->first(), 'La facture émise n\'est jamais modifiée.');
        $this->assertEquals($linesBefore, DB::table('invoice_lines')->where('invoice_id', $invoice)->get()->all());

        $note = DB::table('credit_notes')->where('id', $first->json('data.credit_note_id'))->first();
        $this->assertNotNull($note);
        $this->assertSame('ISSUED', $note->status);
        $snapshot = json_decode((string) $note->snapshot, false, 512, JSON_THROW_ON_ERROR);
        $this->assertDataMatchesContract($snapshot, 'snapshots/credit-note.json');
        $this->assertSame('credit_note.v1', $snapshot->template_version);
        $this->assertTrue($snapshot->clinic->test_document);
        $document = DB::table('generated_documents')->where('credit_note_id', $note->id)->first();
        $this->assertNotNull($document);
        $this->assertSame(['CREDIT_NOTE', 'PENDING', 'credit_note.v1'], [$document->document_type, $document->status, $document->template_version]);
        $this->assertSame(1, DB::table('outbox_events')->where('event_type', 'CreditNoteIssued')->where('source_id', $invoice)->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.credit_note_id')) = ?", [$note->id])->count());
    }

    private function assertMatchesSequence(string $prefix, string $number, int $value): void
    {
        $this->assertMatchesRegularExpression('/^'.preg_quote($prefix, '/').'-\d{4}-'.str_pad((string) $value, 6, '0', STR_PAD_LEFT).'$/', $number);
    }

    public function test_un_avoir_ne_touche_jamais_au_stock(): void
    {
        $position = $this->seedPosition($this->item['frame'], '3');
        [$invoice] = $this->issuedInvoice([$this->line($this->item['frame'])], $this->manager);
        $before = DB::table('stock_positions')->where('id', $position)->first();
        $movements = DB::table('stock_movements')->count();

        $this->credit($invoice, 2, [$this->creditLine($this->firstLine($invoice), 40000, '1')])->assertCreated();

        $this->assertEquals($before, DB::table('stock_positions')->where('id', $position)->first(), 'Un avoir financier sans retour physique ne modifie pas le stock.');
        $this->assertSame($movements, DB::table('stock_movements')->count());
    }

    public function test_le_cumul_par_ligne_et_par_quantite_est_plafonne(): void
    {
        [$invoice] = $this->issuedInvoice([
            $this->line($this->item['lens'], '2', 1, 30000),
            $this->line($this->item['exam'], '1', 2),
        ], $this->manager);
        $lens = (string) DB::table('invoice_lines')->where('invoice_id', $invoice)->where('position', 1)->value('id');
        $this->credit($invoice, 2, [$this->creditLine($lens, 30000, '1')])->assertCreated();

        $this->credit($invoice, 3, [$this->creditLine($lens, 30001, '1')])->assertStatus(422)->assertJsonPath('error.details.creditable', 30000);
        $this->credit($invoice, 3, [$this->creditLine($lens, 1000, '1.5')])->assertStatus(422)->assertJsonPath('error.details.creditable_quantity', '1.000');
        $this->credit($invoice, 3, [$this->creditLine($lens, 1000), $this->creditLine($lens, 1000)])->assertStatus(422);
        $this->credit($invoice, 3, [$this->creditLine(Ulid::generate(), 1000)])->assertStatus(422);
        $this->credit($invoice, 3, [$this->creditLine($lens, 1000)], ['amount_gross' => 2000])->assertStatus(422);
        $this->credit($invoice, 3, [$this->creditLine($lens, 30000, '1')])->assertCreated();
        $this->assertSame(2, DB::table('credit_notes')->where('invoice_id', $invoice)->count());
    }

    public function test_la_taxe_creditee_suit_la_taxe_figee_de_la_ligne_sans_jamais_la_depasser(): void
    {
        $rule = $this->seedTaxRule('TEST_TAXE', '10.0000');
        DB::table('catalog_items')->where('id', $this->item['lens'])->update(['tax_rule_id' => $rule]);
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 11000)], $this->manager);
        $line = DB::table('invoice_lines')->where('invoice_id', $invoice)->first();
        $this->assertNotNull($line);
        $this->assertSame(1000, (int) $line->tax_amount);

        $this->credit($invoice, 2, [$this->creditLine((string) $line->id, 3333)])->assertCreated();
        $this->credit($invoice, 3, [$this->creditLine((string) $line->id, 7667)])->assertCreated();

        $this->assertSame(1000, (int) DB::table('credit_note_lines')->where('invoice_line_id', $line->id)->sum('tax_amount'));
    }

    public function test_la_caisse_emet_avec_l_approbation_exacte_de_ce_contenu(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        $this->allowPermission($this->cashier, 'credit_note.issue');
        $body = $this->creditNoteBody($invoice, 2, [$this->creditLine($this->firstLine($invoice), 5000)]);

        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $body, $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');

        $approval = $this->approved($this->creditNoteSubject($body), $this->cashier);
        $changed = $body;
        $changed['lines'][0]['amount_gross'] = 6000;
        $changed['amount_gross'] = 6000;
        $changed['approval_id'] = $approval;
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $changed, $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');

        $body['approval_id'] = $approval;
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $body, $this->cashier)->assertCreated();
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $approval)->value('status'));
        $this->assertSame($approval, DB::table('credit_notes')->where('invoice_id', $invoice)->value('approval_id'));
    }

    public function test_un_brouillon_ou_une_version_perimee_est_refuse_sans_numero_brule(): void
    {
        [$draft] = $this->draft([$this->line($this->item['exam'])], $this->manager);
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        $draftLine = $this->firstLine($draft);

        $this->credit($draft, 1, [$this->creditLine($draftLine, 1000)])->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->credit($invoice, 1, [$this->creditLine($this->firstLine($invoice), 1000)])->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT');
        $this->credit($invoice, 2, [$this->creditLine($this->firstLine($invoice), 1000)], ['reason' => ''])->assertStatus(422);

        $this->assertSame(0, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'CREDIT_NOTE')->value('last_value'));
        $this->assertSame(0, DB::table('credit_notes')->count());
    }

    public function test_un_avoir_emis_ne_se_modifie_ni_ne_se_supprime(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        $id = (string) $this->credit($invoice, 2, [$this->creditLine($this->firstLine($invoice), 5000)])->assertCreated()->json('data.credit_note_id');

        $this->expectExceptionMessage('Finalized record is immutable');
        DB::table('credit_notes')->where('id', $id)->update(['amount_gross' => 1]);
    }
}

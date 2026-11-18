<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Devis versionnés et conversion en facture (L1D07, AT08, AT11) sur MySQL réel : brouillon sans numéro ni effet,
 * émission numérotée sans trou (série QUOTE) avec révision 1 figée et document PENDING, révision suivante qui laisse
 * l'ancienne intacte et réimprimable, réponse du client, expiration à la lecture, conversion d'une révision choisie en
 * BROUILLON de facture (prix confirmés explicitement, idempotente, provenance `quote_id`), et aucun effet sur le
 * chiffre d'affaires ni sur l'encaissé. Données fictives.
 */
final class QuotesTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        // bootBilling remplace toute la liste des préfixes : la série des devis s'ajoute ici.
        config(['eeo.numbering.prefixes.QUOTE' => 'TEST-DEV']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Ligne de devis : celle d'un brouillon de facture, sans prescription.
     *
     * @return array<string, mixed>
     */
    private function quoteLine(string $itemId, string $quantity = '1', int $position = 1, ?int $price = null, int $discount = 0): array
    {
        $line = $this->line($itemId, $quantity, $position, $price, $discount);
        unset($line['prescription_id']);

        return $line;
    }

    /**
     * @param  list<array<string, mixed>>|null  $lines
     * @param  array<string, mixed>  $overrides
     */
    private function createQuote(?array $lines = null, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        $lines ??= [$this->quoteLine($this->item['frame'], '1', 1), $this->quoteLine($this->item['exam'], '1', 2)];

        return $this->write('POST', '/api/v1/quotes', array_merge([
            'expected_version' => null,
            'quote_id' => Ulid::generate(),
            'patient_id' => $this->patientId,
            'prospect' => null,
            'valid_until' => '2026-11-21',
            'lines' => $lines,
        ], $overrides), $as, $key);
    }

    /**
     * Devis créé puis émis par l'API : [identifiant, numéro, version, total].
     *
     * @param  array<string, mixed>  $overrides
     * @return array{0: string, 1: string, 2: int, 3: int}
     */
    private function issuedQuote(array $overrides = [], ?User $as = null): array
    {
        $created = $this->createQuote(null, $overrides, $as)->assertCreated();
        $id = (string) $created->json('data.id');
        $issued = $this->write('POST', '/api/v1/quotes/'.$id.'/issue', [
            'expected_version' => (int) $created->json('data.version'),
            'quote_id' => $id,
            'total_gross' => (int) $created->json('data.total_gross'),
        ], $as)->assertOk();

        return [$id, (string) $issued->json('data.number'), (int) $issued->json('data.version'), (int) $issued->json('data.total_gross')];
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function convertBody(string $quoteId, int $version, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => $version,
            'quote_id' => $quoteId,
            'revision_no' => 1,
            'invoice_id' => Ulid::generate(),
            'patient_id' => null,
            'price_basis' => 'QUOTE',
            'prices_confirmed' => true,
        ], $overrides);
    }

    public function test_un_brouillon_n_a_ni_numero_ni_effet_puis_l_emission_numerote_sans_trou_et_fige_la_revision_1(): void
    {
        $created = $this->createQuote()->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/billing.json#/$defs/QuoteResponse');
        $created->assertJsonPath('data.status', 'DRAFT')
            ->assertJsonPath('data.number', null)
            ->assertJsonPath('data.current_revision', 0)
            ->assertJsonPath('data.total_gross', 55000)
            ->assertJsonPath('data.recipient.kind', 'PATIENT');
        $this->assertSame(0, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'QUOTE')->count());
        $this->assertSame(0, DB::table('invoices')->where('clinic_id', $this->clinicId)->count());

        $id = (string) $created->json('data.id');
        $issued = $this->write('POST', '/api/v1/quotes/'.$id.'/issue', ['expected_version' => 1, 'quote_id' => $id, 'total_gross' => 55000])->assertOk();
        $this->assertMatchesContract($issued, 'schemas/resources/billing.json#/$defs/QuoteResponse');
        $issued->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.number', 'TEST-DEV-2026-000001')
            ->assertJsonPath('data.current_revision', 1)
            ->assertJsonPath('data.revisions.0.revision_no', 1)
            ->assertJsonPath('data.revisions.0.snapshot.total_gross', 55000)
            ->assertJsonPath('data.revisions.0.snapshot.recipient.patient_id', $this->patientId)
            ->assertJsonPath('data.revisions.0.document.document_status', 'PENDING');

        $document = DB::table('generated_documents')->where('quote_id', $id)->first();
        $this->assertNotNull($document);
        $this->assertSame('QUOTE', $document->document_type);
        $this->assertSame(1, (int) $document->revision_no);
        $this->assertSame('quote.v1', $document->template_version);

        [, $second] = $this->issuedQuote();
        $this->assertSame('TEST-DEV-2026-000002', $second);
        // Un devis émis n'est ni une facture ni une réserve.
        $this->assertSame(0, DB::table('invoices')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(0, DB::table('stock_reservations')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_un_total_different_est_refuse_sans_consommer_de_numero(): void
    {
        $created = $this->createQuote()->assertCreated();
        $id = (string) $created->json('data.id');

        $this->write('POST', '/api/v1/quotes/'.$id.'/issue', ['expected_version' => 1, 'quote_id' => $id, 'total_gross' => 1])
            ->assertStatus(422)
            ->assertJsonPath('error.details.expected_total', 55000);
        $this->assertSame(0, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->where('document_type', 'QUOTE')->count());

        $this->write('POST', '/api/v1/quotes/'.$id.'/issue', ['expected_version' => 1, 'quote_id' => $id, 'total_gross' => 55000])
            ->assertOk()
            ->assertJsonPath('data.number', 'TEST-DEV-2026-000001');
    }

    public function test_les_lignes_suivent_les_droits_de_l_auteur(): void
    {
        $this->createQuote([$this->quoteLine($this->item['frame'], '1', 1, 30000)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
        $this->createQuote([$this->quoteLine($this->item['frame'], '1', 1, 30000)], [], $this->manager)
            ->assertCreated()
            ->assertJsonPath('data.total_gross', 30000);
        $this->createQuote(null, [], $this->reception)->assertForbidden();
    }

    public function test_une_revision_fige_une_nouvelle_version_et_laisse_l_ancienne_intacte(): void
    {
        [$id, $number, $version] = $this->issuedQuote();
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['sale_price' => 45000]);

        $revised = $this->write('POST', '/api/v1/quotes/'.$id.'/revisions', [
            'expected_version' => $version,
            'quote_id' => $id,
            'reason' => 'Nouvelle monture proposée au client (fictif)',
            'valid_until' => '2026-12-01',
            'lines' => [$this->quoteLine($this->item['frame'], '2', 1)],
            'total_gross' => 90000,
        ])->assertCreated();
        $this->assertMatchesContract($revised, 'schemas/resources/billing.json#/$defs/QuoteResponse');
        $revised->assertJsonPath('data.number', $number)
            ->assertJsonPath('data.current_revision', 2)
            ->assertJsonPath('data.total_gross', 90000)
            ->assertJsonPath('data.revisions.0.revision_no', 2)
            ->assertJsonPath('data.revisions.0.reason', 'Nouvelle monture proposée au client (fictif)')
            ->assertJsonPath('data.revisions.1.revision_no', 1)
            ->assertJsonPath('data.revisions.1.snapshot.total_gross', 55000)
            ->assertJsonPath('data.revisions.1.snapshot.lines.0.unit_price_gross', 40000);
        $this->assertSame(2, DB::table('generated_documents')->where('quote_id', $id)->count());

        // La révision figée ne se réécrit pas (garde du schéma).
        $this->expectException(QueryException::class);
        DB::table('quote_revisions')->where('quote_id', $id)->where('revision_no', 1)->update(['reason' => 'réécrit']);
    }

    public function test_la_conversion_cree_un_brouillon_lie_sans_paiement_ni_reserve_et_ne_se_repete_pas(): void
    {
        [$id, , $version] = $this->issuedQuote();
        $key = Ulid::generate();
        $body = $this->convertBody($id, $version);

        $converted = $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $body, null, $key)->assertCreated();
        $this->assertMatchesContract($converted, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
        $converted->assertJsonPath('data.status', 'DRAFT')
            ->assertJsonPath('data.quote_id', $id)
            ->assertJsonPath('data.number', null)
            ->assertJsonPath('data.total_gross', 55000);
        $invoiceId = (string) $converted->json('data.id');

        // Même clé, même contenu : même réponse, aucune seconde facture.
        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $body, null, $key)
            ->assertCreated()
            ->assertJsonPath('data.id', $invoiceId);
        $this->assertSame(1, DB::table('invoices')->where('quote_id', $id)->count());
        $this->assertSame(0, DB::table('payments')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(0, DB::table('stock_reservations')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame('CONVERTED', DB::table('quotes')->where('id', $id)->value('status'));

        // Nouvelle intention sur un devis déjà converti : refus qui désigne la facture existante.
        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version + 1))
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.invoice_id', $invoiceId);

        $this->read('/api/v1/quotes/'.$id)->assertOk()->assertJsonPath('data.invoices.0.id', $invoiceId);
    }

    public function test_les_prix_sont_confirmes_et_la_base_choisie_est_respectee(): void
    {
        [$id, , $version] = $this->issuedQuote();
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['sale_price' => 45000]);

        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version, ['prices_confirmed' => false]))
            ->assertStatus(422);
        $this->assertSame(0, DB::table('invoices')->where('quote_id', $id)->count());

        $converted = $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version, ['price_basis' => 'CATALOG']))
            ->assertCreated()
            ->assertJsonPath('data.total_gross', 60000);
        $this->assertSame(45000, (int) $converted->json('data.lines.0.unit_price_gross'));

        $audit = DB::table('audit_events')->where('action', 'quote.converted')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $diff = json_decode((string) $audit->sanitized_diff, true);
        $this->assertIsArray($diff);
        $this->assertSame(1, $diff['catalog_price_changes'] ?? null, 'un écart de prix du catalogue est consigné');
        $this->assertSame('CATALOG', $diff['price_basis'] ?? null);
    }

    public function test_un_devis_ne_compte_ni_dans_le_chiffre_d_affaires_ni_dans_l_encaisse(): void
    {
        [$id, , $version] = $this->issuedQuote();
        $this->write('POST', '/api/v1/quotes/'.$id.'/decision', [
            'expected_version' => $version,
            'quote_id' => $id,
            'decision' => 'ACCEPTED',
            'reason' => null,
        ])->assertOk()->assertJsonPath('data.status', 'ACCEPTED');

        $report = $this->read('/api/v1/reports/cash-day?date=2026-10-22', $this->manager)->assertOk();
        $report->assertJsonPath('data.issued.count', 0)
            ->assertJsonPath('data.issued.total_gross', 0)
            ->assertJsonPath('data.net_total', 0);
    }

    public function test_un_devis_expire_ne_s_accepte_ni_ne_se_convertit_et_une_revision_le_ravive(): void
    {
        [$id, , $version] = $this->issuedQuote(['valid_until' => '2026-10-25']);
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-27 09:00:00', 'UTC'));

        $this->read('/api/v1/quotes/'.$id)->assertOk()
            ->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.effective_status', 'EXPIRED');
        $this->write('POST', '/api/v1/quotes/'.$id.'/decision', ['expected_version' => $version, 'quote_id' => $id, 'decision' => 'ACCEPTED', 'reason' => null])
            ->assertStatus(409)
            ->assertJsonPath('error.details.current_status', 'EXPIRED');
        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version))
            ->assertStatus(409)
            ->assertJsonPath('error.details.current_status', 'EXPIRED');

        $this->write('POST', '/api/v1/quotes/'.$id.'/revisions', [
            'expected_version' => $version,
            'quote_id' => $id,
            'reason' => 'Nouvelle validité (fictif)',
            'valid_until' => '2026-11-30',
            'lines' => [$this->quoteLine($this->item['frame'], '1', 1)],
            'total_gross' => 40000,
        ])->assertCreated()->assertJsonPath('data.effective_status', 'ISSUED');
    }

    public function test_un_prospect_se_convertit_sur_le_dossier_patient_choisi(): void
    {
        $created = $this->createQuote(null, ['patient_id' => null, 'prospect' => ['name' => 'Prospect Fictif', 'phone' => '600 00 00 00']])->assertCreated();
        $created->assertJsonPath('data.recipient.kind', 'PROSPECT')->assertJsonPath('data.recipient.last_name', 'Prospect Fictif');
        $id = (string) $created->json('data.id');
        $issued = $this->write('POST', '/api/v1/quotes/'.$id.'/issue', ['expected_version' => 1, 'quote_id' => $id, 'total_gross' => 55000])->assertOk();
        $version = (int) $issued->json('data.version');

        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version))
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['patient_id']]]);
        $this->write('POST', '/api/v1/quotes/'.$id.'/conversions', $this->convertBody($id, $version, ['patient_id' => $this->patientId]))
            ->assertCreated()
            ->assertJsonPath('data.patient_id', $this->patientId);
        $prospectId = DB::table('quotes')->where('id', $id)->value('prospect_contact_id');
        $this->assertSame($this->patientId, DB::table('prospect_contacts')->where('id', $prospectId)->value('patient_id'));
    }

    public function test_un_devis_vise_un_patient_ou_un_prospect_jamais_les_deux(): void
    {
        $this->createQuote(null, ['prospect' => ['name' => 'Prospect Fictif', 'phone' => null]])
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['patient_id']]]);
        $this->createQuote(null, ['patient_id' => null])
            ->assertStatus(422);
        $this->createQuote(null, ['valid_until' => '2026-10-01'])
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['valid_until']]]);
        $this->assertSame(0, DB::table('quotes')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_une_ligne_hors_catalogue_sur_devis_prend_la_regle_exo_validee_par_defaut(): void
    {
        $exoId = $this->seedTaxRule('EXO', '0.0000', true);
        $freeLine = [
            'line_id' => Ulid::generate(),
            'position' => 1,
            'catalog_item_id' => null,
            'description' => 'Consultation hors catalogue',
            'quantity' => '1',
            'unit_price_gross' => 3000,
            'discount_gross' => 0,
        ];

        $created = $this->createQuote([$freeLine], [], $this->manager)->assertCreated();
        $quoteId = (string) $created->json('data.id');

        $issued = $this->write('POST', '/api/v1/quotes/'.$quoteId.'/issue', [
            'expected_version' => 1,
            'quote_id' => $quoteId,
            'total_gross' => 3000,
        ], $this->manager)->assertOk();

        $issued
            ->assertJsonPath('data.revisions.0.snapshot.lines.0.tax_code', 'EXO')
            ->assertJsonPath('data.revisions.0.snapshot.lines.0.tax_rate_percent', '0.0000')
            ->assertJsonPath('data.revisions.0.snapshot.lines.0.tax_amount', 0)
            ->assertJsonPath('data.revisions.0.snapshot.tax.regime', 'VALIDATED_RULES')
            ->assertJsonPath('data.revisions.0.snapshot.tax.rules.0.tax_rule_id', $exoId);
    }
}

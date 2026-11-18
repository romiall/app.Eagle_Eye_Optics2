<?php

namespace Tests\Feature\Billing;

use App\Application\Checkpoint;
use App\Application\Command;
use App\Application\CommandBusProbe;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Handlers\IssueInvoiceHandler;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Support\BillingFixtures;
use Tests\Support\Commands\RecordingProbe;
use Tests\Support\MigratedDatabase;
use Tests\Support\RefusedSources;
use Tests\TestCase;

/**
 * Émission d'une facture IMMUABLE (B03, EE021, EE023, EE045, AT08, AT09, AT37) sur MySQL réel : numéro sans trou,
 * snapshots figés, réserve du stock atomique, version du brouillon figée, document en attente, guards SQL,
 * propriétaire de facture, taxes, document de production, idempotence, retour arrière à chaque point. Données fictives.
 */
final class IssueInvoiceTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use RefusedSources;

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

    public function test_l_emission_attribue_le_numero_fige_les_snapshots_et_laisse_la_version_du_brouillon(): void
    {
        [$id, $total, $version] = $this->draft([$this->line($this->item['exam']), $this->line($this->item['lens'], '1', 2)]);
        $body = $this->issueBody($id, $version, $total);

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $body, $this->cashier);

        $response->assertOk()
            ->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.number', 'TEST-FAC-2026-000001')
            ->assertJsonPath('data.issued_at', '2026-10-22T09:30:00.000Z')
            ->assertJsonPath('data.issued_by', $this->cashier->id)
            ->assertJsonPath('data.draft_version', 1)
            ->assertJsonPath('data.ledger_version', 1)
            ->assertJsonPath('data.total_gross', 75000)
            ->assertJsonPath('data.balance.settlement', 'UNPAID')
            ->assertJsonPath('data.balance.balance_due', 75000)
            ->assertJsonPath('data.balance.paid_net', 0)
            ->assertJsonPath('data.document.document_id', $body['document_id'])
            ->assertJsonPath('data.document.document_status', 'PENDING')
            ->assertJsonPath('data.patient_snapshot.record_number', 'EE-2026-0001')
            ->assertJsonPath('data.clinic_snapshot.test_document', true)
            ->assertJsonPath('data.clinic_snapshot.timezone', 'Africa/Douala')
            ->assertJsonPath('data.tax_snapshot.regime', 'NO_TAX_CONFIGURED')
            ->assertJsonPath('data.write_owner', null);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoiceResponse');

        $invoice = DB::table('invoices')->where('id', $id)->first();
        $this->assertNotNull($invoice);
        $this->assertSame('ISSUED', $invoice->status);
        $this->assertSame(1, (int) $invoice->version, 'invoices.version reste la version du brouillon, figée.');
        $this->assertSame($body['number_usage_id'], $invoice->number_usage_id);

        $usage = DB::table('document_number_usages')->where('id', $body['number_usage_id'])->first();
        $this->assertNotNull($usage);
        $this->assertSame(['INVOICE', 2026, 1, 'TEST-FAC-2026-000001', 'invoices', $id, 'USED', $this->cashier->id], [
            $usage->document_type, (int) $usage->document_year, (int) $usage->number_value, $usage->rendered_number, $usage->entity_type, $usage->entity_id, $usage->status, $usage->actor_id,
        ]);
        $this->assertSame(1, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'INVOICE')->where('document_year', 2026)->value('last_value'));

        $document = DB::table('generated_documents')->where('id', $body['document_id'])->first();
        $this->assertNotNull($document);
        $this->assertSame(['INVOICE', $id, 'PENDING', 1, null], [$document->document_type, $document->invoice_id, $document->status, (int) $document->revision_no, $document->file_id]);

        $event = DB::table('outbox_events')->where('clinic_id', $this->clinicId)->where('event_type', 'InvoiceIssued')->first();
        $this->assertNotNull($event);
        $payload = json_decode((string) $event->payload, true);
        $this->assertSame(['TEST-FAC-2026-000001', 75000, 'XAF', null], [$payload['number'], $payload['total_gross'], $payload['currency'], $payload['source_device_id']]);
        $this->assertSame('PENDING', $event->status);

        $audit = DB::table('audit_events')->where('action', 'invoice.issued')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $diff = json_decode((string) $audit->sanitized_diff, true);
        $this->assertTrue($diff['test_document']);
        $this->assertSame(str_repeat('a', 64), $diff['client_catalog_snapshot_sha256']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $diff['catalog_snapshot_sha256']);
    }

    public function test_les_numeros_se_suivent_sans_trou(): void
    {
        $numbers = [];
        for ($index = 0; $index < 3; $index++) {
            [, , $number] = $this->issuedInvoice();
            $numbers[] = $number;
        }

        $this->assertSame(['TEST-FAC-2026-000001', 'TEST-FAC-2026-000002', 'TEST-FAC-2026-000003'], $numbers);
        $this->assertSame(3, DB::table('document_number_usages')->where('document_type', 'INVOICE')->count());
    }

    public function test_l_annee_du_numero_est_celle_du_fuseau_du_cabinet(): void
    {
        // 31 décembre 2026, 23 h 30 UTC = 1er janvier 2027, 00 h 30 à Douala.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-12-31 23:30:00', 'UTC'));
        [$id, $total, $version] = $this->draft();

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total, ['issued_at' => '2026-12-31T23:29:00.000Z']), $this->cashier);

        $response->assertOk()->assertJsonPath('data.number', 'TEST-FAC-2027-000001');
        $this->assertSame(2027, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->value('document_year'));
    }

    public function test_apres_l_emission_le_nom_du_patient_et_le_prix_du_catalogue_n_alterent_plus_la_piece(): void
    {
        [$id] = $this->issuedInvoice([$this->line($this->item['lens'])]);

        DB::table('patient_records')->where('id', $this->patientId)->update(['last_name' => 'Nom changé', 'name_search' => 'nom change']);
        DB::table('catalog_items')->where('id', $this->item['lens'])->update(['sale_price' => 99000, 'name' => 'Autre désignation']);

        $invoice = $this->read('/api/v1/invoices/'.$id, $this->manager)->assertOk();
        $invoice->assertJsonPath('data.patient_snapshot.last_name', 'Patient Fictif')
            ->assertJsonPath('data.lines.0.unit_price_gross', 60000)
            ->assertJsonPath('data.lines.0.description_snapshot', 'Ligne fictive')
            ->assertJsonPath('data.total_gross', 60000);
    }

    public function test_un_rejeu_de_la_meme_cle_rend_le_meme_numero_et_une_autre_cle_sur_la_meme_facture_est_un_refus_d_etat(): void
    {
        [$id, $total, $version] = $this->draft();
        $body = $this->issueBody($id, $version, $total);
        $key = Ulid::generate();

        $first = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $body, $this->cashier, $key)->assertOk();
        $replay = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $body, $this->cashier, $key)->assertOk();
        $other = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier);

        $this->assertSame($first->json('data.number'), $replay->json('data.number'));
        $other->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'ISSUED');
        $this->assertSame(1, DB::table('document_number_usages')->where('document_type', 'INVOICE')->count(), 'Un seul numéro consommé.');
        $this->assertSame(1, DB::table('audit_events')->where('action', 'invoice.issued')->count());
    }

    public function test_une_version_de_brouillon_perimee_est_un_conflit_sans_numero_consomme(): void
    {
        [$id, , $version] = $this->draft();
        $this->write('PATCH', '/api/v1/invoices/'.$id, ['expected_version' => $version, 'invoice_id' => $id, 'visit_id' => null, 'due_date' => null, 'lines' => [$this->line($this->item['lens'])]], $this->cashier)->assertOk();

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, 15000), $this->cashier);

        $response->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT')->assertJsonPath('error.details.current_version', 2);
        $this->assertSame(0, DB::table('document_number_usages')->count());
        $this->assertSame(0, DB::table('document_sequences')->where('clinic_id', $this->clinicId)->count(), 'La séquence n\'a pas été créée : le numéro n\'est pas brûlé.');
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
    }

    public function test_un_total_annonce_different_du_total_recalcule_est_refuse(): void
    {
        [$id, $total, $version] = $this->draft([$this->line($this->item['lens'])]);

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total + 1), $this->cashier);

        $response->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonPath('error.details.expected_total', 60000)
            ->assertJsonStructure(['error' => ['fields' => ['total_gross']]]);
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('document_number_usages')->count());
    }

    public function test_les_valeurs_que_la_route_directe_ne_laisse_pas_au_client_sont_refusees(): void
    {
        [$id, $total, $version] = $this->draft();

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total, ['write_owner_id' => Ulid::generate()]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['write_owner_id']]]);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total, ['reservations' => [[
            'reservation_id' => Ulid::generate(), 'invoice_line_id' => Ulid::generate(), 'item_id' => $this->item['frame'], 'stock_position_id' => Ulid::generate(),
            'stock_lot_id' => null, 'device_allocation_id' => null, 'quantity' => '1',
        ]]]), $this->cashier)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reservations']]]);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total, ['number' => 'FAC-IMPOSE']), $this->cashier)->assertStatus(422);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total, ['issued_at' => '2026-10-22T09:36:00.000Z']), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['issued_at']]]);

        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
    }

    public function test_un_identifiant_d_usage_ou_de_document_deja_pris_est_refuse_sans_erreur_sql(): void
    {
        [$firstId, $total, $version] = $this->draft();
        $first = $this->issueBody($firstId, $version, $total);
        $this->write('POST', '/api/v1/invoices/'.$firstId.'/issue', $first, $this->cashier)->assertOk();
        [$id, $secondTotal, $secondVersion] = $this->draft();

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $secondVersion, $secondTotal, ['number_usage_id' => $first['number_usage_id']]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['number_usage_id']]]);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $secondVersion, $secondTotal, ['document_id' => $first['document_id']]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['document_id']]]);
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
    }

    public function test_une_facture_sans_ligne_ne_s_emet_pas(): void
    {
        [$id, , $version] = $this->draft([]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, 0), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['lines']]]);
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
    }

    // ------------------------------------------------------------------------------------------------------------
    // Stock (I00)
    // ------------------------------------------------------------------------------------------------------------

    public function test_l_emission_reserve_le_stock_sans_decrementer_le_physique(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');

        [$id] = $this->issuedInvoice([$this->line($this->item['frame'], '2')]);

        $row = DB::table('stock_positions')->where('id', $position)->first();
        $this->assertNotNull($row);
        $this->assertSame(['5.000', '2.000', '3.000', 2], [$row->on_hand, $row->reserved, $row->central_available, (int) $row->version]);
        $reservation = DB::table('stock_reservations')->where('clinic_id', $this->clinicId)->first();
        $this->assertNotNull($reservation);
        $this->assertSame(['2.000', 'ACTIVE', $position, null, null], [$reservation->quantity, $reservation->status, $reservation->stock_position_id, $reservation->stock_lot_id, $reservation->device_allocation_id]);
        $this->assertSame(DB::table('invoice_lines')->where('invoice_id', $id)->value('id'), $reservation->invoice_line_id);
        $this->assertSame(0, DB::table('stock_movements')->count(), 'Seule la remise sort l\'article du physique.');
    }

    public function test_les_services_et_les_articles_sur_mesure_ne_reservent_rien(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');

        $this->issuedInvoice([$this->line($this->item['exam']), $this->line($this->item['lens'], '1', 2)]);

        $this->assertSame(0, DB::table('stock_reservations')->count());
        $this->assertSame('0.000', DB::table('stock_positions')->where('id', $position)->value('reserved'));
    }

    public function test_la_derniere_unite_n_est_vendable_qu_une_fois_et_le_refus_ne_brule_pas_de_numero(): void
    {
        $position = $this->seedPosition($this->item['frame'], '1');
        $this->issuedInvoice([$this->line($this->item['frame'])]);
        [$id, $total, $version] = $this->draft([$this->line($this->item['frame'])]);

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier);

        $response->assertStatus(409)->assertJsonPath('error.code', 'STOCK_UNAVAILABLE')->assertJsonPath('error.details.available', '0.000')
            ->assertJsonStructure(['error' => ['fields' => ['lines.0.quantity']]]);
        $this->assertMatchesContract($response, 'schemas/error.json');
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
        $this->assertSame(1, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'INVOICE')->value('last_value'), 'La séquence est revenue à son état.');
        $this->assertSame(1, DB::table('document_number_usages')->where('document_type', 'INVOICE')->count());

        // Le réapprovisionnement permet l'émission, sous le numéro suivant : aucun trou.
        DB::table('stock_positions')->where('id', $position)->update(['on_hand' => '2']);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)->assertOk()->assertJsonPath('data.number', 'TEST-FAC-2026-000002');
    }

    public function test_plusieurs_lignes_sont_reservees_ensemble_ou_pas_du_tout(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');
        $dropsPosition = $this->seedPosition($this->item['drops'], '0');
        $before = $this->billingEffects();
        [$id, $total, $version] = $this->draft([$this->line($this->item['frame'], '2'), $this->line($this->item['drops'], '1', 2)]);
        $afterDraft = $this->billingEffects();

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier);

        $response->assertStatus(409)->assertJsonPath('error.code', 'STOCK_UNAVAILABLE')->assertJsonStructure(['error' => ['fields' => ['lines.1.quantity']]]);
        $this->assertSame('0.000', DB::table('stock_positions')->where('id', $position)->value('reserved'), 'La première ligne n\'a pas gardé de réserve.');
        $this->assertSame('0.000', DB::table('stock_positions')->where('id', $dropsPosition)->value('reserved'));
        $this->assertSame(0, DB::table('stock_reservations')->count());
        $this->assertNotSame($before, $afterDraft);
        $this->assertSame($afterDraft, $this->billingEffects(), 'Rien ne subsiste de la tentative d\'émission.');
    }

    public function test_deux_lignes_du_meme_article_se_partagent_le_disponible(): void
    {
        $this->seedPosition($this->item['frame'], '3');
        [$id, $total, $version] = $this->draft([$this->line($this->item['frame'], '2'), $this->line($this->item['frame'], '2', 2)]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STOCK_UNAVAILABLE')->assertJsonPath('error.details.available', '1.000');
    }

    public function test_les_lots_sortent_par_expiration_la_plus_proche_et_une_quantite_peut_s_etendre_sur_deux_lots(): void
    {
        $position = $this->seedPosition($this->item['drops'], '10');
        $far = $this->seedLot($position, $this->item['drops'], 'LOT-LOIN', '2027-03-01', '5');
        $near = $this->seedLot($position, $this->item['drops'], 'LOT-PROCHE', '2026-12-01', '5');

        $this->issuedInvoice([$this->line($this->item['drops'], '7')]);

        $this->assertSame('5.000', DB::table('stock_lots')->where('id', $near)->value('reserved'));
        $this->assertSame('2.000', DB::table('stock_lots')->where('id', $far)->value('reserved'));
        $this->assertSame('7.000', DB::table('stock_positions')->where('id', $position)->value('reserved'));
        $this->assertSame(2, DB::table('stock_reservations')->count());
    }

    public function test_un_lot_expire_a_la_date_locale_de_remise_est_refuse_et_le_lot_du_jour_reste_vendable(): void
    {
        $position = $this->seedPosition($this->item['drops'], '10');
        $this->seedLot($position, $this->item['drops'], 'LOT-HIER', '2026-10-21', '10');
        [$id, $total, $version] = $this->draft([$this->line($this->item['drops'], '1')]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'LOT_EXPIRED');
        $this->assertSame(0, DB::table('stock_reservations')->count());

        $today = $this->seedLot($position, $this->item['drops'], 'LOT-JOUR', '2026-10-22', '5');
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)->assertOk();
        $this->assertSame('1.000', DB::table('stock_lots')->where('id', $today)->value('reserved'));
    }

    public function test_un_lot_en_quarantaine_n_est_jamais_reserve(): void
    {
        $position = $this->seedPosition($this->item['drops'], '10');
        $this->seedLot($position, $this->item['drops'], 'LOT-Q', '2027-01-01', '10', 'QUARANTINE');
        [$id, $total, $version] = $this->draft([$this->line($this->item['drops'], '1')]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STOCK_UNAVAILABLE');
        $this->assertSame(0, DB::table('stock_reservations')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Taxes et document de production
    // ------------------------------------------------------------------------------------------------------------

    public function test_une_regle_active_et_validee_est_ventilee_et_figee_dans_le_snapshot_fiscal(): void
    {
        $this->seedPosition($this->item['frame'], '5');
        $rule = $this->seedTaxRule('TEST_TAXE', '10.0000', true);
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['tax_rule_id' => $rule]);

        [$id] = $this->issuedInvoice([$this->line($this->item['frame'])]);

        $invoice = $this->read('/api/v1/invoices/'.$id, $this->manager)->assertOk();
        $invoice->assertJsonPath('data.tax_snapshot.regime', 'VALIDATED_RULES')
            ->assertJsonPath('data.tax_snapshot.rules.0.code', 'TEST_TAXE')
            ->assertJsonPath('data.tax_snapshot.rules.0.rate_percent', '10.0000')
            ->assertJsonPath('data.tax_snapshot.rules.0.validated_at', '2026-10-20T08:00:00.000Z')
            ->assertJsonPath('data.lines.0.tax_code_snapshot', 'TEST_TAXE')
            ->assertJsonPath('data.lines.0.tax_rate_snapshot', '10.0000')
            ->assertJsonPath('data.lines.0.tax_amount', 3636);
        $this->assertMatchesContract($invoice, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
    }

    public function test_une_regle_non_validee_n_est_pas_appliquee(): void
    {
        $this->seedPosition($this->item['frame'], '5');
        $rule = $this->seedTaxRule('REGLE_NON_VALIDEE', '12.0000', false);
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['tax_rule_id' => $rule]);

        [$id] = $this->issuedInvoice([$this->line($this->item['frame'])]);

        $this->read('/api/v1/invoices/'.$id, $this->manager)->assertJsonPath('data.tax_snapshot.regime', 'NO_TAX_CONFIGURED')
            ->assertJsonPath('data.lines.0.tax_code_snapshot', 'NO_TAX_CONFIGURED')->assertJsonPath('data.lines.0.tax_amount', null);
    }

    public function test_un_document_de_production_exige_une_regle_fiscale_validee_sur_chaque_ligne(): void
    {
        config(['eeo.production_documents_enabled' => true]);
        DB::table('clinics')->where('id', $this->clinicId)->update(['production_documents_enabled' => 1]);
        [$id, $total, $version] = $this->draft([$this->line($this->item['lens'])]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['lines.0.catalog_item_id']]]);
        $this->assertSame(0, DB::table('document_number_usages')->count());

        DB::table('catalog_items')->where('id', $this->item['lens'])->update(['tax_rule_id' => $this->seedTaxRule('TEST_TAXE', '10.0000', true)]);
        [$second, $secondTotal, $secondVersion] = $this->draft([$this->line($this->item['lens'])]);
        $this->write('POST', '/api/v1/invoices/'.$second.'/issue', $this->issueBody($second, $secondVersion, $secondTotal), $this->cashier)
            ->assertOk()->assertJsonPath('data.clinic_snapshot.test_document', false);
    }

    public function test_une_ligne_hors_catalogue_est_exoneree_par_defaut_en_production_si_regle_0_validee(): void
    {
        config(['eeo.production_documents_enabled' => true]);
        DB::table('clinics')->where('id', $this->clinicId)->update(['production_documents_enabled' => 1]);
        // Une règle à 0 % non validée/inactive ne s'applique pas : la ligne reste bloquée en production.
        $this->seedTaxRule('EXO_BROUILLON', '0.0000', false);
        $makeFreeLine = static fn (): array => [
            'line_id' => Ulid::generate(),
            'position' => 1,
            'catalog_item_id' => null,
            'description' => 'Consultation hors catalogue',
            'quantity' => '1',
            'unit_price_gross' => 3000,
            'discount_gross' => 0,
            'prescription_id' => null,
        ];
        $created = $this->createDraft([$makeFreeLine()], $this->manager)->assertCreated();
        $created->assertJsonPath('data.lines.0.tax_code_snapshot', 'NO_TAX_CONFIGURED');
        $draftId = (string) $created->json('data.id');
        $version = (int) $created->json('data.draft_version');

        $this->write('POST', '/api/v1/invoices/'.$draftId.'/issue', $this->issueBody($draftId, $version, 3000), $this->manager)
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['lines.0.catalog_item_id']]]);

        // Une fois la règle EXO (0 %) validée et active (prioritaire devant une autre règle à 0 %), le brouillon existant comme un nouveau s'émettent.
        $this->seedTaxRule('ZERO_ALT', '0.0000', true);
        $exoId = $this->seedTaxRule('EXO', '0.0000', true);

        $this->write('POST', '/api/v1/invoices/'.$draftId.'/issue', $this->issueBody($draftId, $version, 3000), $this->manager)
            ->assertOk()
            ->assertJsonPath('data.clinic_snapshot.test_document', false)
            ->assertJsonPath('data.lines.0.tax_code_snapshot', 'EXO')
            ->assertJsonPath('data.lines.0.tax_rate_snapshot', '0.0000')
            ->assertJsonPath('data.lines.0.tax_amount', 0)
            ->assertJsonPath('data.tax_snapshot.regime', 'VALIDATED_RULES')
            ->assertJsonPath('data.tax_snapshot.rules.0.tax_rule_id', $exoId);

        $secondDraft = $this->createDraft([$makeFreeLine()], $this->manager)->assertCreated();
        $secondDraft
            ->assertJsonPath('data.lines.0.tax_code_snapshot', 'EXO')
            ->assertJsonPath('data.lines.0.tax_rate_snapshot', '0.0000')
            ->assertJsonPath('data.lines.0.tax_amount', 0);
    }

    public function test_les_deux_interrupteurs_sont_necessaires_pour_un_document_de_production(): void
    {
        DB::table('clinics')->where('id', $this->clinicId)->update(['production_documents_enabled' => 1]);

        [$id] = $this->issuedInvoice();

        $this->read('/api/v1/invoices/'.$id, $this->manager)->assertJsonPath('data.clinic_snapshot.test_document', true);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Propriété, droits, cabinets
    // ------------------------------------------------------------------------------------------------------------

    public function test_une_facture_detenue_par_un_poste_n_est_pas_emise_par_l_api(): void
    {
        [$id, $total, $version] = $this->draft();
        $device = $this->seedWriteOwner($id, 'ACTIVE');

        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier);

        $response->assertStatus(409)->assertJsonPath('error.code', 'WRITE_OWNER_REQUIRED');
        $this->assertStringContainsString('Caisse A', (string) $response->json('error.message'));
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
        $this->assertNotNull($device);
    }

    public function test_un_droit_de_poste_clos_ne_bloque_plus(): void
    {
        [$id, $total, $version] = $this->draft();
        $this->seedWriteOwner($id, 'CLOSED');

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)->assertOk();
    }

    public function test_seuls_la_caissiere_et_la_gerante_emettent(): void
    {
        [$id, $total, $version] = $this->draft();

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->reception)->assertForbidden();
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->clinician)->assertForbidden();
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->manager)->assertOk()->assertJsonPath('data.issued_by', $this->manager->id);
    }

    public function test_le_profil_frais_d_examen_n_emet_que_les_factures_de_frais_d_examen(): void
    {
        $this->allowPermission($this->reception, 'exam_fee.collect');
        [$exam, $examTotal, $examVersion] = $this->draft([$this->line($this->item['exam'])], $this->reception);
        [$mixed, $mixedTotal, $mixedVersion] = $this->draft([$this->line($this->item['exam']), $this->line($this->item['lens'], '1', 2)], $this->manager);

        $this->write('POST', '/api/v1/invoices/'.$mixed.'/issue', $this->issueBody($mixed, $mixedVersion, $mixedTotal), $this->reception)->assertForbidden();
        $this->write('POST', '/api/v1/invoices/'.$exam.'/issue', $this->issueBody($exam, $examVersion, $examTotal), $this->reception)->assertOk();

        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $mixed)->value('status'));
        $this->assertSame('ISSUED', DB::table('invoices')->where('id', $exam)->value('status'));
    }

    public function test_une_facture_inconnue_ou_d_un_autre_cabinet_est_introuvable(): void
    {
        $other = $this->makeClinic('TEST CABINET B');
        $this->makeStaff($other, 'MANAGER', 'gerante.b');
        $patient = $this->seedPatient($other);
        $foreign = Ulid::generate();
        DB::table('invoices')->insert([
            'id' => $foreign, 'clinic_id' => $other, 'patient_id' => $patient, 'status' => 'DRAFT', 'currency' => 'XAF', 'total_gross' => 0,
            'origin' => 'NATIVE', 'created_by' => DB::table('users')->where('clinic_id', $other)->value('id'), 'version' => 1,
        ]);

        $this->write('POST', '/api/v1/invoices/'.$foreign.'/issue', $this->issueBody($foreign, 1, 0), $this->manager)->assertNotFound();
        $unknown = Ulid::generate();
        $this->write('POST', '/api/v1/invoices/'.$unknown.'/issue', $this->issueBody($unknown, 1, 0), $this->manager)->assertNotFound();
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $foreign)->value('status'));
    }

    public function test_un_dossier_fusionne_n_est_plus_facturable(): void
    {
        [$id, $total, $version] = $this->draft();
        $other = $this->seedPatient($this->clinicId, 'Fiche actuelle');
        DB::table('patient_records')->where('id', $this->patientId)->update(['merged_into_patient_id' => $other]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['patient_id']]]);
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
    }

    public function test_un_module_ferme_repond_404(): void
    {
        [$id, $total, $version] = $this->draft();
        config(['eeo.enabled_modules' => ['stock']]);

        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->manager)->assertNotFound();
    }

    /**
     * L'émission est ouverte aux postes synchronisés (O05) : une tâche du serveur, sans auteur, est refusée avant toute
     * lecture ; un poste dont le cœur signé ne désigne aucune plage de numéros est refusé, la facture reste un brouillon.
     */
    public function test_une_source_sans_auteur_ou_sans_plage_de_numeros_est_refusee(): void
    {
        [$id, $total, $version] = $this->draft();
        $payload = $this->issueBody($id, $version, $total);
        unset($payload['expected_version']);
        $payload['write_owner_id'] = Ulid::generate();
        $payload['number'] = 'TEST-FAC-2026-000001';

        $attempts = [
            ['ACTION_FORBIDDEN', 'auteur identifié', $this->jobContext()],
            ['NUMBER_RANGE_INVALID', 'aucune plage', $this->syncContextWithoutRange($this->cashier)],
        ];
        foreach ($attempts as [$code, $fragment, $context]) {
            try {
                $this->app->make(IssueInvoiceHandler::class)->handle(
                    new Command('IssueInvoice', $payload, $id, $version),
                    $context,
                    new TransactionLocks($this->clinicId),
                    null,
                );
                $this->fail('Une source sans auteur ou sans plage de numéros devait être refusée.');
            } catch (BusinessError $error) {
                $this->assertSame($code, $error->errorCode);
                $this->assertStringContainsString($fragment, $error->getMessage());
            }
        }
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('document_number_usages')->where('document_type', 'INVOICE')->count());
    }

    public function test_les_verrous_sont_pris_dans_l_ordre_du_contrat(): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');
        [$id, $total, $version] = $this->draft([$this->line($this->item['frame'])]);
        $payload = $this->issueBody($id, $version, $total);
        unset($payload['expected_version']);
        $locks = new TransactionLocks($this->clinicId);
        $locks->clinic();

        $this->app->make(IssueInvoiceHandler::class)->handle(
            new Command('IssueInvoice', $payload, $id, $version),
            CommandContext::direct($this->cashier, 'corr-test-0001'),
            $locks,
            null,
        );

        $this->assertSame(
            ['10:'.$this->clinicId, '40:INVOICE:2026', '45:'.$this->patientId, '50:'.$id, '60:'.$id, '80:'.$position],
            $locks->acquired(),
            'Cabinet, séquence (40), dossier patient (45), propriété (50), facture (60), position de stock (80).',
        );
    }

    // ------------------------------------------------------------------------------------------------------------
    // Immuabilité (triggers du schéma) et retour arrière
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_facture_emise_et_ses_enfants_sont_proteges_par_les_guards_du_schema(): void
    {
        [$id] = $this->issuedInvoice();
        $lineId = DB::table('invoice_lines')->where('invoice_id', $id)->value('id');
        $usageId = DB::table('invoices')->where('id', $id)->value('number_usage_id');

        $finalized = 'Finalized record is immutable';
        $child = 'Issued or finalized parent: child is immutable';
        $appendOnly = 'Append-only history';
        $attempts = [
            'modifier la facture' => [$finalized, fn () => DB::table('invoices')->where('id', $id)->update(['total_gross' => 1])],
            'modifier sa version' => [$finalized, fn () => DB::table('invoices')->where('id', $id)->update(['version' => 9])],
            'modifier sa date de mise à jour' => [$finalized, fn () => DB::table('invoices')->where('id', $id)->update(['updated_at' => '2030-01-01 00:00:00.000000'])],
            'supprimer la facture' => [$finalized, fn () => DB::table('invoices')->where('id', $id)->delete()],
            'modifier une ligne' => [$child, fn () => DB::table('invoice_lines')->where('id', $lineId)->update(['unit_price_gross' => 1])],
            'supprimer une ligne' => [$child, fn () => DB::table('invoice_lines')->where('id', $lineId)->delete()],
            'ajouter une ligne' => [$child, fn () => DB::table('invoice_lines')->insert([
                'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'patient_id' => $this->patientId, 'invoice_id' => $id, 'position' => 9,
                'description_snapshot' => 'Ajout', 'category_snapshot' => 'OTHER', 'unit_snapshot' => 'UNIT', 'quantity' => '1', 'unit_price_gross' => 1,
                'discount_gross' => 0, 'line_total_gross' => 1, 'tax_code_snapshot' => 'NO_TAX_CONFIGURED',
            ])],
            'modifier l\'usage du numéro' => [$appendOnly, fn () => DB::table('document_number_usages')->where('id', $usageId)->update(['status' => 'VOID'])],
            'supprimer l\'usage du numéro' => [$appendOnly, fn () => DB::table('document_number_usages')->where('id', $usageId)->delete()],
        ];
        foreach ($attempts as $label => [$message, $attempt]) {
            try {
                DB::transaction($attempt);
                $this->fail('Le schéma devait refuser de '.$label.'.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString($message, $exception->getMessage(), $label);
            }
        }

        $invoice = DB::table('invoices')->where('id', $id)->first();
        $this->assertNotNull($invoice);
        $this->assertSame(['ISSUED', 15000, 1], [$invoice->status, (int) $invoice->total_gross, (int) $invoice->version]);
    }

    /**
     * @return array<string, array{0: Checkpoint}>
     */
    public static function checkpoints(): array
    {
        $cases = [];
        foreach (Checkpoint::cases() as $checkpoint) {
            $cases[$checkpoint->value] = [$checkpoint];
        }

        return $cases;
    }

    #[DataProvider('checkpoints')]
    public function test_un_echec_a_n_importe_quel_point_annule_numero_reserves_et_document(Checkpoint $failAt): void
    {
        $position = $this->seedPosition($this->item['frame'], '5');
        [$id, $total, $version] = $this->draft([$this->line($this->item['frame'], '2'), $this->line($this->item['exam'], '1', 2)]);
        $before = $this->billingEffects();
        $this->app->instance(CommandBusProbe::class, new RecordingProbe($failAt));
        $this->withoutExceptionHandling();

        try {
            $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier);
            $this->fail('Une erreur injectée devait annuler la commande.');
        } catch (RuntimeException) {
            // Attendu : la transaction est annulée en entier.
        }

        $this->assertSame($before, $this->billingEffects());
        $this->assertSame('DRAFT', DB::table('invoices')->where('id', $id)->value('status'));
        $this->assertSame('0.000', DB::table('stock_positions')->where('id', $position)->value('reserved'));

        // La même demande aboutit ensuite avec le PREMIER numéro : rien n'a été brûlé.
        $this->app->instance(CommandBusProbe::class, new RecordingProbe);
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $this->cashier)->assertOk()->assertJsonPath('data.number', 'TEST-FAC-2026-000001');
    }
}

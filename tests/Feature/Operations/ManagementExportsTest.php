<?php

namespace Tests\Feature\Operations;

use App\Domain\Billing\Setup\SalesBootstrap;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientActivityFixtures;
use Tests\TestCase;
use ZipArchive;

/**
 * Tableaux et exports de gestion L1D09 sur MySQL réel :
 *  - synthèse consolidée Finance / Stock / Atelier / Patients / Clinique, comparaison période N vs N-1 ;
 *  - zéro double compte (devis et créances papier LEGACY_BALANCE hors CA) ;
 *  - inconnus explicites jamais maquillés en zéro (coût stock manquant, alerte sans échéance, ordre sans date prévue, identité/clinique partielles) ;
 *  - cloisonnement strict par rôle et modules ouverts (clinicien sans valorisation stock, caisse, accueil, module fermé) ;
 *  - téléchargements CSV (UTF-8 BOM ;) et JSON avec dictionnaire et empreinte SHA-256 ;
 *  - exports contrôlés filtrés par période et portée de profil sans escalade, et manifeste conservé après expiration 48 h.
 * Données strictement fictives.
 */
final class ManagementExportsTest extends TestCase
{
    use MigratedDatabase;
    use PatientActivityFixtures;

    /** @var list<string> */
    private array $cleanupPaths = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootActivity(['today', 'patients', 'consultations', 'sales', 'stock', 'workshop', 'reports', 'settings']);
    }

    protected function tearDown(): void
    {
        foreach ($this->cleanupPaths as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
        $this->resetClock();
        parent::tearDown();
    }

    public function test_manager_gets_unified_comparison_without_double_counting_or_hidden_unknowns(): void
    {
        $seeded = $this->seedMultiDomainDataset();

        $res = $this->actingAsFresh($this->manager)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22');

        $res->assertOk();
        $this->assertMatchesContract($res, 'schemas/resources/operations.json#/$defs/ManagementReportResponse');

        $data = $res->json('data');
        $this->assertSame(['from' => '2026-10-15', 'to' => '2026-10-22', 'days' => 8], $data['period']);
        $this->assertSame(['from' => '2026-10-07', 'to' => '2026-10-14', 'days' => 8], $data['previous_period']);
        $this->assertSame([], $data['excluded_sections']);

        // Finance : N (100 000 facture - 20 000 avoir = 80 000), N-1 (50 000), devis et reprise papier exclus du CA.
        $this->assertSame(80000, $data['finance']['net_revenue']['current']);
        $this->assertSame(50000, $data['finance']['net_revenue']['previous']);
        $this->assertSame(30000, $data['finance']['net_revenue']['delta']);
        $this->assertSame(6000, $data['finance']['net_revenue']['delta_pct_bps']);
        $this->assertSame(60000, $data['finance']['net_collections']['current']);
        $this->assertSame(1, $data['finance']['quotes_pipeline']['issued_count']);
        $this->assertSame(250000, $data['finance']['quotes_pipeline']['issued_amount']);
        $this->assertSame(1, $data['finance']['receivables_at_read']['of_which_legacy_count']);
        $this->assertSame(40000, $data['finance']['receivables_at_read']['of_which_legacy_amount']);

        // Stock : coût connu exact = 3 * 15 000 = 45 000 XAF ; position sans coût jamais comptée à 0.
        $this->assertSame(45000, $data['stock']['valuation_at_read']['known_cost_value']);
        $this->assertSame(1, $data['stock']['valuation_at_read']['unknown_cost_positions']);
        $this->assertSame(2, $data['stock']['valuation_at_read']['total_positions']);
        $this->assertNull($data['stock']['valuation_hidden_reason']);
        $this->assertSame(2, $data['stock']['low_stock_items_count']);
        $this->assertSame(1, $data['stock']['open_alerts']['without_due_date']);

        // Atelier : 2 ouverts (1 en retard avec date, 1 sans expected_at et sans monture), 1 reprise, 1 QC échoué.
        $this->assertSame(2, $data['workshop']['created_count']['current']);
        $this->assertSame(0, $data['workshop']['created_count']['previous']);
        $this->assertSame(2, $data['workshop']['open_total']);
        $this->assertSame(1, $data['workshop']['overdue_open_count']);
        $this->assertSame(1, $data['workshop']['unknown_expected_date_count']);
        $this->assertSame(1, $data['workshop']['orders_without_frame_item_count']);
        $this->assertSame(1, $data['workshop']['reworks_in_period']);
        $this->assertSame(1, $data['workshop']['failed_qc_in_period']);

        // Patients & clinique : comparaison et données incomplètes explicites.
        $this->assertSame(2, $data['patients']['visits_count']['current']);
        $this->assertSame(1, $data['patients']['visits_count']['previous']);
        $this->assertSame(1, $data['patients']['incomplete_identity']['birth_date_unknown']);
        $this->assertSame(1, $data['patients']['incomplete_identity']['sex_unknown']);
        $this->assertSame(1, $data['patients']['incomplete_identity']['phone_unknown']);
        $this->assertSame(1, $data['clinical']['consultations_completed']['current']);
        $this->assertSame(1, $data['clinical']['consultations_completed']['previous']);
        $this->assertSame(1, $data['clinical']['incomplete_clinical_data']['without_acuity']);
        $this->assertSame(1, $data['clinical']['incomplete_clinical_data']['without_refraction']);
        $this->assertSame(1, $data['clinical']['incomplete_clinical_data']['without_ametropia']);

        // Définitions & empreinte de provenance.
        $this->assertNotEmpty($data['definitions']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $data['provenance']['dataset_sha256']);
        $unknownCodes = array_column($data['unknowns'], 'code');
        $this->assertContains('unknown_cost_positions', $unknownCodes);
        $this->assertContains('alerts_without_due_date', $unknownCodes);
        $this->assertContains('workshop_unknown_expected_date', $unknownCodes);
        $this->assertContains('legacy_receivables_outstanding', $unknownCodes);
        $this->assertContains('clinical_incomplete_consultations', $unknownCodes);
        $this->assertSame($seeded['item_with_cost'], $seeded['item_with_cost']);
    }

    public function test_role_and_module_scoping_hides_valuation_and_unauthorized_sections(): void
    {
        $this->seedMultiDomainDataset();

        // Clinicien : clinique et quantités stock UNIQUEMENT (aucune valorisation XAF, aucune finance, aucun atelier, aucune activité accueil).
        $clinicianRes = $this->actingAsFresh($this->clinician)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22');
        $clinicianRes->assertOk();
        $this->assertMatchesContract($clinicianRes, 'schemas/resources/operations.json#/$defs/ManagementReportResponse');

        $clinicianData = $clinicianRes->json('data');
        $this->assertNull($clinicianData['finance']);
        $this->assertNull($clinicianData['workshop']);
        $this->assertNull($clinicianData['patients']);
        $this->assertNotNull($clinicianData['clinical']);
        $this->assertNotNull($clinicianData['stock']);
        $this->assertNull($clinicianData['stock']['valuation_at_read']);
        $this->assertSame('PERMISSION_MISSING', $clinicianData['stock']['valuation_hidden_reason']);
        foreach ($clinicianData['stock']['by_category'] as $cat) {
            $this->assertNull($cat['known_cost_value']);
        }
        $excludedBySection = array_column($clinicianData['excluded_sections'], 'reason', 'section');
        $this->assertSame('PERMISSION_MISSING', $excludedBySection['FINANCE']);
        $this->assertSame('PERMISSION_MISSING', $excludedBySection['STOCK_VALUATION']);
        $this->assertSame('PERMISSION_MISSING', $excludedBySection['WORKSHOP']);
        $this->assertSame('PERMISSION_MISSING', $excludedBySection['PATIENTS']);

        // Accueil : patients seulement.
        $receptionRes = $this->actingAsFresh($this->reception)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22');
        $receptionRes->assertOk();
        $receptionData = $receptionRes->json('data');
        $this->assertNotNull($receptionData['patients']);
        $this->assertNull($receptionData['finance']);
        $this->assertNull($receptionData['stock']);
        $this->assertNull($receptionData['workshop']);
        $this->assertNull($receptionData['clinical']);

        // Caissière : stock sans valorisation (sans finance globale ni clinique ni patients).
        $cashierRes = $this->actingAsFresh($this->cashier)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22');
        $cashierRes->assertOk();
        $cashierData = $cashierRes->json('data');
        $this->assertNotNull($cashierData['stock']);
        $this->assertNull($cashierData['stock']['valuation_at_read']);
        $this->assertNull($cashierData['finance']);

        // Compte sans aucun droit rapports : 403.
        $noReportPerm = $this->makeStaff($this->clinicId, 'RECEPTION', 'sans.stat');
        $this->denyPermission($noReportPerm, 'statistics.activity');
        $this->actingAsFresh($noReportPerm)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22')
            ->assertForbidden();

        // Modules stock & atelier désactivés : signalés explicitement MODULE_DISABLED.
        config(['eeo.enabled_modules' => ['today', 'patients', 'consultations', 'sales', 'reports', 'settings']]);
        $disabledRes = $this->actingAsFresh($this->manager)
            ->getJson('/api/v1/reports/management?from=2026-10-15&to=2026-10-22');
        $disabledRes->assertOk();
        $disabledData = $disabledRes->json('data');
        $this->assertNull($disabledData['stock']);
        $this->assertNull($disabledData['workshop']);
        $disabledMap = array_column($disabledData['excluded_sections'], 'reason', 'section');
        $this->assertSame('MODULE_DISABLED', $disabledMap['STOCK']);
        $this->assertSame('MODULE_DISABLED', $disabledMap['WORKSHOP']);
    }

    public function test_management_report_download_outputs_csv_and_json_with_provenance(): void
    {
        $this->seedMultiDomainDataset();

        $csvRes = $this->actingAsFresh($this->manager)
            ->get('/api/v1/reports/management/download?from=2026-10-15&to=2026-10-22&format=csv');
        $csvRes->assertOk();
        $this->assertStringStartsWith('text/csv', (string) $csvRes->headers->get('Content-Type'));
        $body = $csvRes->getContent();
        $this->assertStringStartsWith("\u{FEFF}RAPPORT_GESTION_L1D09", $body);
        $this->assertStringContainsString("Chiffre d'affaires net", $body);
        $this->assertStringContainsString('DICTIONNAIRE;DOMAINE;CODE', $body);
        $this->assertStringContainsString('sha256_donnees', $body);
        $this->assertStringContainsString('eeo.management_exports.v1', $body);

        $jsonRes = $this->actingAsFresh($this->clinician)
            ->get('/api/v1/reports/management/download?from=2026-10-15&to=2026-10-22&format=json');
        $jsonRes->assertOk();
        $decoded = json_decode((string) $jsonRes->getContent(), true, 512, JSON_THROW_ON_ERROR);
        $this->assertNull($decoded['data']['finance']);
        $this->assertNull($decoded['data']['stock']['valuation_at_read']);
    }

    public function test_controlled_export_filters_scope_and_preserves_manifest_after_expiration(): void
    {
        $this->seedMultiDomainDataset();

        // Tentative d'escalade : un clinicien ne peut jamais demander une portée MANAGER.
        $this->actingAsReauthenticated($this->clinician)
            ->withHeader('Idempotency-Key', Ulid::generate())
            ->postJson('/api/v1/exports', [
                'expected_version' => null,
                'export_type' => 'PATIENT_RECORD',
                'patient_id' => $this->patientId,
                'filters' => ['scope_role' => 'MANAGER'],
            ])
            ->assertForbidden();

        // Demi-période refusée en 422.
        $this->actingAsReauthenticated($this->manager)
            ->withHeader('Idempotency-Key', Ulid::generate())
            ->postJson('/api/v1/exports', [
                'expected_version' => null,
                'export_type' => 'FULL_HANDOVER',
                'filters' => ['from' => '2026-10-15'],
            ])
            ->assertStatus(422);

        // La gérante demande un export complet filtré sur [2026-10-15, 2026-10-22] restreint au profil CLINICIAN.
        $createRes = $this->actingAsReauthenticated($this->manager)
            ->withHeader('Idempotency-Key', Ulid::generate())
            ->postJson('/api/v1/exports', [
                'expected_version' => null,
                'export_type' => 'FULL_HANDOVER',
                'filters' => [
                    'from' => '2026-10-15',
                    'to' => '2026-10-22',
                    'scope_role' => 'CLINICIAN',
                ],
            ]);
        $createRes->assertCreated();
        $exportId = (string) $createRes->json('data.id');
        $this->assertEquals([
            'from' => '2026-10-15',
            'to' => '2026-10-22',
            'scope_role' => 'CLINICIAN',
        ], $createRes->json('data.filters'));

        $this->assertSame(0, Artisan::call('eeo:exports:process'));

        $row = DB::table('export_requests')->where('id', $exportId)->first();
        $this->assertNotNull($row);
        $this->assertSame('READY', $row->status);
        $file = DB::table('stored_files')->where('id', $row->file_id)->first();
        $this->assertNotNull($file);
        $zipPath = storage_path('app/private/'.$file->private_path);
        $this->cleanupPaths[] = $zipPath;
        $this->assertFileExists($zipPath);

        $zip = new ZipArchive;
        $this->assertTrue($zip->open($zipPath) === true);
        // Tables financières, atelier et audit exclues de l'archive sous scope CLINICIAN ; coûts stock masqués.
        $this->assertFalse($zip->locateName('donnees/invoices.csv'));
        $this->assertFalse($zip->locateName('donnees/workshop_orders.csv'));
        $this->assertFalse($zip->locateName('donnees/audit_events.csv'));
        $visitsCsv = $zip->getFromName('donnees/visits.csv');
        $this->assertIsString($visitsCsv);
        // La visite N-1 (2026-10-10) doit être exclue par le filtre période ; seules les visites [2026-10-15..22] restent.
        $visitLines = array_values(array_filter(explode("\n", trim($visitsCsv)), static fn (string $line): bool => trim($line) !== ''));
        $this->assertCount(3, $visitLines); // en-tête + 2 visites en période N

        $itemsCsv = $zip->getFromName('donnees/catalog_items.csv');
        $this->assertIsString($itemsCsv);
        $this->assertStringNotContainsString('purchase_cost', explode("\n", $itemsCsv)[0]);
        $zip->close();

        // Manifeste structuré consultable via API et conforme au contrat.
        $manifestRes = $this->actingAsFresh($this->manager)
            ->getJson("/api/v1/exports/{$exportId}/manifest");
        $manifestRes->assertOk();
        $this->assertMatchesContract($manifestRes, 'schemas/resources/operations.json#/$defs/ExportManifestResponse');
        $manifest = $manifestRes->json('data');
        $this->assertSame('READY', $manifest['archive_status']);
        $this->assertSame($file->sha256, $manifest['archive_sha256']);
        $this->assertContains('invoices', array_column($manifest['excluded_tables'], 'table'));

        // Expiration après 48 h : l'archive ZIP est supprimée mais le manifeste demeure lisible.
        DB::table('export_requests')->where('id', $exportId)->update([
            'expires_at' => CarbonImmutable::now('UTC')->subMinute()->format('Y-m-d H:i:s.u'),
        ]);
        $this->assertSame(0, Artisan::call('eeo:exports:process'));

        $this->actingAsFresh($this->manager)
            ->get("/api/v1/exports/{$exportId}/download")
            ->assertStatus(409);

        $expiredManifestRes = $this->actingAsFresh($this->manager)
            ->getJson("/api/v1/exports/{$exportId}/manifest");
        $expiredManifestRes->assertOk();
        $this->assertMatchesContract($expiredManifestRes, 'schemas/resources/operations.json#/$defs/ExportManifestResponse');
        $this->assertSame('EXPIRED', $expiredManifestRes->json('data.archive_status'));
        $this->assertTrue($expiredManifestRes->json('data.provenance.manifest_preserved'));
        $this->assertSame($file->sha256, $expiredManifestRes->json('data.archive_sha256'));
    }

    /**
     * @return array{item_with_cost: string, item_without_cost: string}
     */
    private function seedMultiDomainDataset(): array
    {
        $now = CarbonImmutable::now('UTC');
        app(SalesBootstrap::class)->ensure($this->clinicId, $now);

        $incompletePatientId = $this->seedPatient($this->clinicId, 'Patient Incomplet', null, [
            'sex' => 'UNKNOWN',
            'birth_date' => null,
            'birth_date_missing_reason' => 'NON_RENSEIGNE',
            'phone_primary' => null,
            'phone_primary_normalized' => null,
            'phone_missing_reason' => 'SANS_TELEPHONE',
            'address' => null,
        ]);

        // Période N : 2026-10-18 et 2026-10-19 ; Période N-1 : 2026-10-10.
        $visitN1 = $this->seedActivityVisit('2026-10-18 10:00:00', ['reason' => 'EXAM']);
        $consN1 = $this->seedActivityConsultation($visitN1, '2026-10-18 10:15:00', 'COMPLETED', ['referral' => false]);
        $rxId = $this->seedOpticalPrescription($consN1, '2026-10-18 10:25:00', '2026-10-18 10:30:00');
        $scaleId = (string) (DB::table('visual_acuity_scales')->where('clinic_id', $this->clinicId)->value('id') ?? '');
        if ($scaleId === '') {
            $scaleId = Ulid::generate();
            DB::table('visual_acuity_scales')->insert([
                'id' => $scaleId,
                'clinic_id' => $this->clinicId,
                'code' => 'TEST_DIXIEMES',
                'label' => 'Dixièmes (test)',
                'description' => null,
                'active' => true,
                'created_at' => '2026-10-18 08:00:00.000000',
                'updated_at' => '2026-10-18 08:00:00.000000',
            ]);
        }
        DB::table('visual_acuities')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'consultation_id' => $consN1,
            'context' => 'PRELIMINARY',
            'distance' => 'FAR',
            'correction' => 'WITHOUT',
            'eye' => 'OD',
            'scale_id' => $scaleId,
            'raw_value' => '10/10',
            'normalized_value' => '1.000',
            'created_at' => '2026-10-18 10:16:00.000000',
            'updated_at' => '2026-10-18 10:16:00.000000',
        ]);
        DB::table('refraction_measurements')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'consultation_id' => $consN1,
            'stage' => 'SUBJECTIVE',
            'eye' => 'OD',
            'sphere' => '-1.25',
            'cylinder' => '0.00',
            'axis' => null,
            'addition' => null,
            'created_at' => '2026-10-18 10:17:00.000000',
            'updated_at' => '2026-10-18 10:17:00.000000',
        ]);
        $ametropiaCode = (string) DB::table('clinical_terms')->where('group_code', 'AMETROPIA')->orderBy('sort_order')->value('code');
        DB::table('consultation_ametropias')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'consultation_id' => $consN1,
            'term_group' => 'AMETROPIA',
            'term_code' => $ametropiaCode,
            'other_text' => null,
            'created_at' => '2026-10-18 10:18:00.000000',
            'updated_at' => '2026-10-18 10:18:00.000000',
        ]);

        // 2e visite / consultation en N volontairement sans mesures pour vérifier le compteur d'incomplets.
        $visitN2 = $this->seedActivityVisit('2026-10-19 11:00:00', ['reason' => 'FOLLOW_UP'], patientId: $incompletePatientId);
        $this->seedActivityConsultation($visitN2, '2026-10-19 11:10:00', 'IN_PROGRESS', ['referral' => null, 'patient_id' => $incompletePatientId]);

        // Visite + consultation clôturée en N-1 (2026-10-10).
        $visitPrev = $this->seedActivityVisit('2026-10-10 09:30:00', ['reason' => 'EXAM']);
        $this->seedActivityConsultation($visitPrev, '2026-10-10 09:45:00', 'COMPLETED');

        // Finance : N (facture 100 000, avoir 20 000, encaissement 60 000) & N-1 (facture 50 000).
        [$invNId] = $this->seedIssuedInvoice(100000, '2026-10-18 12:00:00');
        $this->seedPaymentWithReceipt($invNId, 60000, '2026-10-18 12:15:00');
        $this->seedCreditNote($invNId, 20000, '2026-10-18 13:00:00');
        [$invPrevId] = $this->seedIssuedInvoice(50000, '2026-10-10 12:00:00');
        $draftForWorkshop = $this->seedDraftInvoice(0, '2026-10-16 08:30:00');

        $invLine1Id = Ulid::generate();
        $invLine2Id = Ulid::generate();
        DB::table('invoice_lines')->insert([
            [
                'id' => $invLine1Id,
                'clinic_id' => $this->clinicId,
                'patient_id' => $this->patientId,
                'invoice_id' => $draftForWorkshop,
                'position' => 1,
                'catalog_item_id' => null,
                'reference_snapshot' => 'EQUIP-01',
                'description_snapshot' => 'Équipement optique fictif 1',
                'category_snapshot' => 'LENS',
                'unit_snapshot' => 'UNIT',
                'quantity' => '1.000',
                'unit_price_gross' => 0,
                'discount_gross' => 0,
                'line_total_gross' => 0,
                'tax_code_snapshot' => 'EXONERE',
                'tax_rate_snapshot' => null,
                'tax_amount' => null,
                'prescription_id' => $rxId,
                'created_at' => '2026-10-16 08:30:00.000000',
                'updated_at' => '2026-10-16 08:30:00.000000',
            ],
            [
                'id' => $invLine2Id,
                'clinic_id' => $this->clinicId,
                'patient_id' => $this->patientId,
                'invoice_id' => $draftForWorkshop,
                'position' => 2,
                'catalog_item_id' => null,
                'reference_snapshot' => 'EQUIP-02',
                'description_snapshot' => 'Équipement optique fictif 2',
                'category_snapshot' => 'LENS',
                'unit_snapshot' => 'UNIT',
                'quantity' => '1.000',
                'unit_price_gross' => 0,
                'discount_gross' => 0,
                'line_total_gross' => 0,
                'tax_code_snapshot' => 'EXONERE',
                'tax_rate_snapshot' => null,
                'tax_amount' => null,
                'prescription_id' => $rxId,
                'created_at' => '2026-10-16 08:30:00.000000',
                'updated_at' => '2026-10-16 08:30:00.000000',
            ],
        ]);

        // Devis hors CA + reprise papier LEGACY_BALANCE hors CA.
        $quoteId = Ulid::generate();
        DB::table('quotes')->insert([
            'id' => $quoteId,
            'clinic_id' => $this->clinicId,
            'patient_id' => $this->patientId,
            'prospect_contact_id' => null,
            'number' => 'DEV-TEST-001',
            'status' => 'ISSUED',
            'valid_until' => '2026-11-18',
            'total_gross' => 250000,
            'recipient_snapshot' => json_encode(['display_name' => 'Patient Fictif'], JSON_THROW_ON_ERROR),
            'created_by' => $this->manager->getKey(),
            'issued_at' => '2026-10-18 14:00:00.000000',
            'version' => 1,
            'created_at' => '2026-10-18 14:00:00.000000',
            'updated_at' => '2026-10-18 14:00:00.000000',
        ]);

        $legacyInvId = Ulid::generate();
        $legacyUsageId = Ulid::generate();
        DB::table('document_number_usages')->insert([
            'id' => $legacyUsageId,
            'clinic_id' => $this->clinicId,
            'allocation_id' => null,
            'document_type' => 'LEGACY_BALANCE',
            'document_year' => 2026,
            'number_value' => 9001,
            'rendered_number' => 'TEST-REP-2026-009001',
            'entity_type' => 'invoices',
            'entity_id' => $legacyInvId,
            'source_device_id' => null,
            'actor_id' => $this->manager->getKey(),
            'consumed_at' => '2026-10-18 14:30:00.000000',
            'status' => 'USED',
            'created_at' => '2026-10-18 14:30:00.000000',
            'updated_at' => '2026-10-18 14:30:00.000000',
        ]);
        DB::table('invoices')->insert([
            'id' => $legacyInvId,
            'clinic_id' => $this->clinicId,
            'patient_id' => $this->patientId,
            'visit_id' => null,
            'quote_id' => null,
            'number' => 'TEST-REP-2026-009001',
            'issued_at' => '2026-10-18 14:30:00.000000',
            'issued_by' => $this->manager->getKey(),
            'number_usage_id' => $legacyUsageId,
            'status' => 'ISSUED',
            'due_date' => null,
            'currency' => 'XAF',
            'total_gross' => 40000,
            'patient_snapshot' => json_encode(['id' => $this->patientId, 'full_name' => 'Patient Fictif'], JSON_THROW_ON_ERROR),
            'clinic_snapshot' => json_encode(['name' => 'TEST CABINET A'], JSON_THROW_ON_ERROR),
            'tax_snapshot' => json_encode(['regime' => 'NONE'], JSON_THROW_ON_ERROR),
            'origin' => 'LEGACY_BALANCE',
            'legacy_reference' => 'CARNET-001',
            'legacy_opening_balance' => 40000,
            'source_invoice_id' => null,
            'created_by' => $this->manager->getKey(),
            'source_device_id' => null,
            'version' => 1,
            'created_at' => '2026-10-18 14:30:00.000000',
            'updated_at' => '2026-10-18 14:30:00.000000',
        ]);

        // Stock : 1 position valorisée à 15 000 * 3 = 45 000 + 1 position sans coût + 1 alerte sans due_on.
        $taxRuleId = DB::table('tax_rules')->where('clinic_id', $this->clinicId)->value('id');
        $locationId = (string) DB::table('stock_locations')->where('clinic_id', $this->clinicId)->value('id');
        $categoryCode = 'FRAME';
        $unitCode = 'UNIT';

        $item1Id = Ulid::generate();
        $item2Id = Ulid::generate();
        DB::table('catalog_items')->insert([
            [
                'id' => $item1Id,
                'clinic_id' => $this->clinicId,
                'reference' => 'MONT-TEST-01',
                'category_code' => $categoryCode,
                'name' => 'Monture Test Valorisée',
                'brand' => 'Test',
                'model' => 'M1',
                'unit_code' => $unitCode,
                'quantity_integer_only' => true,
                'sale_price' => 35000,
                'purchase_cost' => 15000,
                'tax_rule_id' => $taxRuleId,
                'stock_mode' => 'STOCKED',
                'requires_expiry' => false,
                'low_stock_threshold' => '5.000',
                'expiry_alert_days' => null,
                'active' => true,
                'public_visibility' => false,
                'version' => 1,
                'created_at' => '2026-10-18 08:00:00.000000',
                'updated_at' => '2026-10-18 08:00:00.000000',
            ],
            [
                'id' => $item2Id,
                'clinic_id' => $this->clinicId,
                'reference' => 'MONT-TEST-02',
                'category_code' => $categoryCode,
                'name' => 'Monture Coût Inconnu',
                'brand' => 'Test',
                'model' => 'M2',
                'unit_code' => $unitCode,
                'quantity_integer_only' => true,
                'sale_price' => 25000,
                'purchase_cost' => null,
                'tax_rule_id' => $taxRuleId,
                'stock_mode' => 'STOCKED',
                'requires_expiry' => false,
                'low_stock_threshold' => '10.000',
                'expiry_alert_days' => null,
                'active' => true,
                'public_visibility' => false,
                'version' => 1,
                'created_at' => '2026-10-18 08:00:00.000000',
                'updated_at' => '2026-10-18 08:00:00.000000',
            ],
        ]);

        DB::table('stock_positions')->insert([
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'item_id' => $item1Id,
                'location_id' => $locationId,
                'on_hand' => '3.000',
                'reserved' => '0.000',
                'offline_allocated' => '0.000',
                'version' => 1,
                'created_at' => '2026-10-18 08:00:00.000000',
                'updated_at' => '2026-10-18 08:00:00.000000',
            ],
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'item_id' => $item2Id,
                'location_id' => $locationId,
                'on_hand' => '2.000',
                'reserved' => '0.000',
                'offline_allocated' => '0.000',
                'version' => 1,
                'created_at' => '2026-10-18 08:00:00.000000',
                'updated_at' => '2026-10-18 08:00:00.000000',
            ],
        ]);

        DB::table('stock_alerts')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'item_id' => $item2Id,
            'location_id' => $locationId,
            'lot_id' => null,
            'kind' => 'EXPIRY',
            'dedupe_key' => 'EXPIRY:'.$item2Id.':'.$locationId,
            'detected_at' => '2026-10-18 09:00:00.000000',
            'due_on' => null,
            'status' => 'OPEN',
            'acknowledged_by' => null,
            'resolved_at' => null,
            'created_at' => '2026-10-18 09:00:00.000000',
            'updated_at' => '2026-10-18 09:00:00.000000',
        ]);

        // Atelier : 2 ordres ouverts en N + événements reprise / QC échoué.
        $supplierId = Ulid::generate();
        DB::table('suppliers')->insert([
            'id' => $supplierId,
            'clinic_id' => $this->clinicId,
            'name' => 'Labo Test Optique',
            'reference' => 'LAB-TEST-01',
            'phone' => null,
            'email' => null,
            'address' => null,
            'is_optical_lab' => true,
            'active' => true,
            'created_at' => '2026-10-16 08:00:00.000000',
            'updated_at' => '2026-10-16 08:00:00.000000',
        ]);

        $order1Id = Ulid::generate();
        $order2Id = Ulid::generate();
        $snapshot = json_encode(['order_reference' => 'ATL-1', 'anonymous_code' => 'P-001', 'eyes' => []], JSON_THROW_ON_ERROR);
        DB::table('workshop_orders')->insert([
            [
                'id' => $order1Id,
                'clinic_id' => $this->clinicId,
                'patient_id' => $this->patientId,
                'invoice_line_id' => $invLine1Id,
                'prescription_id' => $rxId,
                'supplier_id' => $supplierId,
                'frame_item_id' => $item1Id,
                'reference' => 'ATL-2026-0001',
                'lab_reference' => null,
                'quantity' => '1.000',
                'snapshot' => $snapshot,
                'ordered_at' => '2026-10-16 09:00:00.000000',
                'expected_at' => '2026-10-20 12:00:00.000000',
                'received_at' => null,
                'status' => 'ORDERED',
                'ready_revision' => 0,
                'notes' => null,
                'created_by' => $this->manager->getKey(),
                'version' => 1,
                'created_at' => '2026-10-16 09:00:00.000000',
                'updated_at' => '2026-10-16 09:00:00.000000',
            ],
            [
                'id' => $order2Id,
                'clinic_id' => $this->clinicId,
                'patient_id' => $this->patientId,
                'invoice_line_id' => $invLine2Id,
                'prescription_id' => $rxId,
                'supplier_id' => $supplierId,
                'frame_item_id' => null,
                'reference' => 'ATL-2026-0002',
                'lab_reference' => null,
                'quantity' => '1.000',
                'snapshot' => $snapshot,
                'ordered_at' => '2026-10-19 09:00:00.000000',
                'expected_at' => null,
                'received_at' => null,
                'status' => 'MOUNTING',
                'ready_revision' => 0,
                'notes' => null,
                'created_by' => $this->manager->getKey(),
                'version' => 1,
                'created_at' => '2026-10-19 09:00:00.000000',
                'updated_at' => '2026-10-19 09:00:00.000000',
            ],
        ]);
        DB::table('workshop_events')->insert([
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'workshop_order_id' => $order2Id,
                'sequence_no' => 1,
                'event_type' => 'QUALITY_CHECK',
                'previous_status' => 'QUALITY_CHECK',
                'new_status' => 'MOUNTING',
                'quality_result' => 'FAILED',
                'observations' => 'Axe décalé',
                'delivery_line_id' => null,
                'actor_id' => $this->manager->getKey(),
                'occurred_at' => '2026-10-20 15:00:00.000000',
                'created_at' => '2026-10-20 15:00:00.000000',
                'updated_at' => '2026-10-20 15:00:00.000000',
            ],
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'workshop_order_id' => $order2Id,
                'sequence_no' => 2,
                'event_type' => 'REWORK',
                'previous_status' => 'READY',
                'new_status' => 'MOUNTING',
                'quality_result' => 'NOT_APPLICABLE',
                'observations' => 'Reprise montage',
                'delivery_line_id' => null,
                'actor_id' => $this->manager->getKey(),
                'occurred_at' => '2026-10-21 10:00:00.000000',
                'created_at' => '2026-10-21 10:00:00.000000',
                'updated_at' => '2026-10-21 10:00:00.000000',
            ],
        ]);

        return ['item_with_cost' => $item1Id, 'item_without_cost' => $item2Id];
    }
}

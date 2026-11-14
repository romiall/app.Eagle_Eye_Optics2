<?php

namespace Tests\Feature\Workshop;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\DeliveryFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Commandes d'atelier optique & bon laboratoire anonymisé (L1D04, EE028, AT31) sur MySQL réel :
 *  - lignes éligibles (factures ISSUED uniquement, hors SERVICE/COLLYRE/DERMOCOSMETIC, déduction des reliquats) ;
 *  - création en ligne avec numérotation WORKSHOP (`document_number_usages`), `generated_documents` PENDING,
 *    snapshot anonymisé conforme à `snapshots/workshop-order.json` (zéro nom patient, zéro prix, zéro médical) ;
 *  - immutabilité des mesures figées lors d'une révision v2 de l'ordonnance ;
 *  - cycle de vie complet (`ORDERED → RECEIVED → MOUNTING → QUALITY_CHECK → READY`), contrôle qualité `FAILED → MOUNTING`,
 *    reprises (`REWORK`) incrémentant `ready_revision`, verrou optimiste 409 et journal append-only `workshop_events` ;
 *  - filtre retard (`overdue=1`), clôture `DELIVERED` liée à une ligne de remise patient `CONFIRMED`, annulation `CANCEL` ;
 *  - dépôt et téléchargement sécurisé du PDF `WORKSHOP` par droits et isolation entre cabinets.
 * Données strictement fictives.
 */
final class WorkshopOrdersTest extends TestCase
{
    use BillingFixtures;
    use DeliveryFixtures;
    use MigratedDatabase;

    private string $labId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'workshop', 'consultations']);
        Storage::fake('local');
        config(['eeo.numbering.workshop_prefix' => 'TEST-ATL']);
        $this->labId = $this->seedLab()['id'];
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /** @return array<string, mixed> */
    private function seedLab(array $overrides = []): array
    {
        $body = array_replace([
            'expected_version' => null,
            'name' => 'Labo Central Fictif',
            'reference' => 'LAB-'.substr(Ulid::generate(), -6),
            'phone' => '+237 600 11 22 33',
            'email' => 'labo@example.test',
            'is_optical_lab' => true,
        ], $overrides);

        return $this->write('POST', '/api/v1/suppliers', $body, $this->manager)
            ->assertCreated()
            ->json('data');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function externalPrescriptionBody(array $overrides = []): array
    {
        $rxId = $overrides['prescription_id'] ?? Ulid::generate();
        $seriesId = $overrides['series_id'] ?? Ulid::generate();

        return array_replace([
            'expected_version' => null,
            'prescription_id' => $rxId,
            'series_id' => $seriesId,
            'version_no' => 1,
            'supersedes_id' => null,
            'patient_id' => $this->patientId,
            'origin' => 'EXTERNAL',
            'consultation_id' => null,
            'external_prescriber' => 'Dr. Externe Fictif',
            'external_prescribed_on' => '2026-10-01',
            'external_file_id' => null,
            'usage_code' => 'NEAR',
            'usage_other' => null,
            'lens_type_code' => 'SINGLE_VISION',
            'lens_type_other' => null,
            'lens_index' => '1.50',
            'lens_index_other' => null,
            'pd_total' => '62.00',
            'pd_od' => '31.00',
            'pd_og' => '31.00',
            'pd_inconsistency_reason' => null,
            'notes' => 'Port permanent — bords polis (fictif)',
            'eyes' => [
                [
                    'id' => Ulid::generate(),
                    'eye' => 'OD',
                    'no_correction' => false,
                    'sphere' => '-1.25',
                    'cylinder' => '-0.50',
                    'axis' => 90,
                    'addition' => '2.00',
                    'fitting_height' => '20.00',
                ],
                [
                    'id' => Ulid::generate(),
                    'eye' => 'OG',
                    'no_correction' => false,
                    'sphere' => '-1.50',
                    'cylinder' => null,
                    'axis' => null,
                    'addition' => '2.00',
                    'fitting_height' => '20.00',
                ],
            ],
            'treatments' => [
                ['id' => Ulid::generate(), 'term_code' => 'ANTI_REFLECTION', 'other_text' => null],
            ],
        ], $overrides);
    }

    /** @return array<string, mixed> */
    private function createValidatedExternalPrescription(array $overrides = []): array
    {
        $body = $this->externalPrescriptionBody($overrides);
        $path = $body['supersedes_id'] !== null
            ? '/api/v1/prescriptions/'.$body['supersedes_id'].'/revisions'
            : '/api/v1/prescriptions/external';
        $this->write('POST', $path, $body, $this->clinician)->assertCreated();
        $docId = Ulid::generate();

        return $this->write(
            'POST',
            '/api/v1/prescriptions/'.$body['prescription_id'].'/validate',
            ['expected_version' => null, 'prescription_id' => $body['prescription_id'], 'document_id' => $docId],
            $this->clinician,
        )->assertOk()->json('data');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function orderPayload(string $invoiceLineId, string $prescriptionId, array $overrides = []): array
    {
        return array_replace([
            'expected_version' => null,
            'invoice_line_id' => $invoiceLineId,
            'prescription_id' => $prescriptionId,
            'supplier_id' => $this->labId,
            'quantity' => '1',
            'frame_item_id' => null,
            'frame_reference_snapshot' => null,
            'lens_type' => null,
            'pd_od' => null,
            'pd_og' => null,
            'fitting_height_od' => null,
            'fitting_height_og' => null,
            'expected_at' => null,
            'lab_reference' => null,
            'notes' => null,
        ], $overrides);
    }

    private function createOrder(string $invoiceLineId, string $prescriptionId, array $overrides = [], ?string $key = null): TestResponse
    {
        return $this->write(
            'POST',
            '/api/v1/workshop-orders',
            $this->orderPayload($invoiceLineId, $prescriptionId, $overrides),
            $this->manager,
            $key,
        );
    }

    private function advance(string $orderId, int $version, array $fields = []): TestResponse
    {
        $body = array_replace([
            'expected_version' => $version,
            'workshop_order_id' => $orderId,
            'event_type' => 'STATUS_CHANGE',
            'new_status' => null,
            'quality_result' => 'NOT_APPLICABLE',
            'observations' => null,
            'delivery_line_id' => null,
        ], $fields);

        return $this->write('POST', '/api/v1/workshop-orders/'.$orderId.'/advance', $body, $this->manager);
    }

    public function test_lignes_eligibles_et_filtrage_excluent_brouillons_services_et_lignes_soldees(): void
    {
        $dropsPosition = $this->seedPosition($this->item['drops'], '5');
        $this->seedLot($dropsPosition, $this->item['drops'], 'LOT-DROPS-1', '2028-12-31', '5');
        $this->draft([$this->line($this->item['lens'], '1', 1, 60000)]);
        [$invoiceId] = $this->issuedInvoice([
            $this->line($this->item['exam'], '1', 1, 15000, 0, 'Examen vue'),
            $this->line($this->item['drops'], '1', 2, 5000, 0, 'Collyre'),
            $this->line($this->item['lens'], '2', 3, 60000, 0, 'Verres unifocaux Fictifs'),
        ]);
        $lensLineId = $this->invoiceLine($invoiceId, 3);
        $rx = $this->createValidatedExternalPrescription();

        $eligible = $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertOk();
        $this->assertMatchesContract($eligible, 'schemas/resources/workshop.json#/$defs/WorkshopEligibleLinesResponse');
        $eligible->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.invoice_line_id', $lensLineId)
            ->assertJsonPath('data.lines.0.ordered_quantity', '0.000')
            ->assertJsonPath('data.lines.0.remaining_quantity', '2.000');

        $this->createOrder($lensLineId, $rx['id'], ['quantity' => '1'])->assertCreated();

        $afterFirst = $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertOk();
        $this->assertMatchesContract($afterFirst, 'schemas/resources/workshop.json#/$defs/WorkshopEligibleLinesResponse');
        $afterFirst->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.ordered_quantity', '1.000')
            ->assertJsonPath('data.lines.0.remaining_quantity', '1.000');

        $this->createOrder($lensLineId, $rx['id'], ['quantity' => '1'])->assertCreated();

        $afterSecond = $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertOk();
        $this->assertMatchesContract($afterSecond, 'schemas/resources/workshop.json#/$defs/WorkshopEligibleLinesResponse');
        $afterSecond->assertJsonCount(0, 'data.lines');
    }

    public function test_creation_valide_numerotation_snapshot_anonymise_document_et_idempotence(): void
    {
        $this->patientId = $this->seedPatient($this->clinicId, 'Ndongmo', 'Chantal');
        [$invoiceId] = $this->issuedInvoice([$this->line($this->item['lens'], '2', 1, 60000)]);
        $lensLineId = $this->invoiceLine($invoiceId, 1);
        $rx = $this->createValidatedExternalPrescription();
        $patient = DB::table('patient_records')->where('id', $this->patientId)->first();
        $this->assertNotNull($patient);

        $idemKey = Ulid::generate();
        $payload = $this->orderPayload($lensLineId, $rx['id'], [
            'frame_item_id' => $this->item['frame'],
            'pd_od' => '31.50',
            'pd_og' => '30.50',
            'fitting_height_od' => '21.00',
            'fitting_height_og' => '21.50',
            'lab_reference' => 'EXT-LAB-99',
            'notes' => 'Montage fin sans bavure',
            'expected_at' => '2026-10-25T17:00:00.000Z',
        ]);

        $created = $this->write('POST', '/api/v1/workshop-orders', $payload, $this->manager, $idemKey)->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/workshop.json#/$defs/WorkshopOrderResponse');
        $data = $created->json('data');
        $orderId = (string) $data['id'];
        $this->assertTrue(Ulid::isValid($orderId));
        $this->assertMatchesRegularExpression('/^TEST-ATL-2026-\d{6}$/', (string) $data['reference']);
        $this->assertSame('ORDERED', $data['status']);
        $this->assertSame(0, $data['ready_revision']);
        $this->assertSame(1, $data['version']);
        $this->assertSame(1, $data['prescription_version_no']);
        $this->assertCount(2, $data['eyes']);
        $this->assertSame('31.50', $data['eyes'][0]['pd']);
        $this->assertSame('21.00', $data['eyes'][0]['fitting_height']);
        $this->assertSame('30.50', $data['eyes'][1]['pd']);
        $this->assertSame('21.50', $data['eyes'][1]['fitting_height']);

        // Numéro central dans document_number_usages + document WORKHOP PENDING prêt à être généré.
        $usage = DB::table('document_number_usages')
            ->where('clinic_id', $this->clinicId)
            ->where('document_type', 'WORKSHOP')
            ->where('entity_id', $orderId)
            ->first();
        $this->assertNotNull($usage);
        $this->assertSame($data['reference'], $usage->rendered_number);

        $pendingDoc = DB::table('generated_documents')
            ->where('clinic_id', $this->clinicId)
            ->where('workshop_order_id', $orderId)
            ->first();
        $this->assertNotNull($pendingDoc);
        $this->assertSame('WORKSHOP', $pendingDoc->document_type);
        $this->assertSame('PENDING', $pendingDoc->status);
        $this->assertSame('workshop:'.$orderId, $pendingDoc->source_key);
        $this->assertSame($pendingDoc->id, $data['document']['document_id']);

        // Snapshot anonymisé conforme à snapshots/workshop-order.json : zéro PII patient, zéro médical, zéro prix.
        $rawSnapshot = (string) DB::table('workshop_orders')->where('id', $orderId)->value('snapshot');
        $snapshotObj = json_decode($rawSnapshot, false, 512, JSON_THROW_ON_ERROR);
        $this->assertDataMatchesContract($snapshotObj, 'snapshots/workshop-order.json');
        $encoded = mb_strtolower($rawSnapshot);
        foreach ([$patient->last_name, $patient->first_names, 'allergie', 'diabète', '60000', '40000', 'fcfa', 'unit_price', 'total_gross'] as $forbidden) {
            if (is_string($forbidden) && trim($forbidden) !== '') {
                $this->assertStringNotContainsString(mb_strtolower($forbidden), $encoded, "Le bon laboratoire ne doit jamais exposer « {$forbidden} ».");
            }
        }

        // Rejeu idempotent exact.
        $replay = $this->write('POST', '/api/v1/workshop-orders', $payload, $this->manager, $idemKey)->assertCreated();
        $this->assertSame($data, $replay->json('data'));
        $this->assertSame(1, DB::table('workshop_orders')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(1, DB::table('workshop_events')->where('workshop_order_id', $orderId)->count());
    }

    public function test_controles_a_la_creation_et_isolation_entre_cabinets(): void
    {
        [$invoiceId] = $this->issuedInvoice([
            $this->line($this->item['exam'], '1', 1, 15000),
            $this->line($this->item['lens'], '2', 2, 60000),
        ]);
        $examLineId = $this->invoiceLine($invoiceId, 1);
        $lensLineId = $this->invoiceLine($invoiceId, 2);

        [$draftInvoiceId] = $this->draft([$this->line($this->item['lens'], '1', 1, 60000)]);
        $draftLineId = $this->invoiceLine($draftInvoiceId, 1);

        $validatedRx = $this->createValidatedExternalPrescription();
        $draftRxBody = $this->externalPrescriptionBody();
        $this->write('POST', '/api/v1/prescriptions/external', $draftRxBody, $this->clinician)->assertCreated();

        $otherPatientId = $this->seedPatient($this->clinicId, 'Autre');
        $otherPatientRx = $this->createValidatedExternalPrescription(['patient_id' => $otherPatientId]);

        $nonLabSupplier = $this->seedLab(['name' => 'Grossiste Non Labo', 'is_optical_lab' => false]);
        $inactiveLab = $this->seedLab(['name' => 'Labo Fermé']);
        $this->write('PATCH', '/api/v1/suppliers/'.$inactiveLab['id'], [
            'expected_version' => null,
            'name' => 'Labo Fermé',
            'reference' => $inactiveLab['reference'],
            'active' => false,
        ], $this->manager)->assertOk();

        // Ligne non optique ou facture brouillon.
        $this->createOrder($examLineId, $validatedRx['id'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['invoice_line_id']]]);
        $this->createOrder($draftLineId, $validatedRx['id'])->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        // Dépassement de quantité, mesures <= 0.
        $this->createOrder($lensLineId, $validatedRx['id'], ['quantity' => '3'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['quantity']]]);
        $this->createOrder($lensLineId, $validatedRx['id'], ['pd_od' => '0.00'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['pd_od']]]);
        $this->createOrder($lensLineId, $validatedRx['id'], ['fitting_height_og' => '-2.00'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['fitting_height_og']]]);

        // Prescription brouillon ou d'un autre patient.
        $this->createOrder($lensLineId, $draftRxBody['prescription_id'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['prescription_id']]]);
        $this->createOrder($lensLineId, $otherPatientRx['id'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['prescription_id']]]);

        // Fournisseur non laboratoire ou inactif.
        $this->createOrder($lensLineId, $validatedRx['id'], ['supplier_id' => $nonLabSupplier['id']])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['supplier_id']]]);
        $this->createOrder($lensLineId, $validatedRx['id'], ['supplier_id' => $inactiveLab['id']])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['supplier_id']]]);

        // Article monture qui n'est pas une monture.
        $this->createOrder($lensLineId, $validatedRx['id'], ['frame_item_id' => $this->item['lens']])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['frame_item_id']]]);

        // Isolation inter-cabinet : un gérant d'un autre cabinet ne voit ni ne modifie la commande.
        $validOrder = $this->createOrder($lensLineId, $validatedRx['id'])->assertCreated()->json('data');
        $otherClinic = $this->makeClinic('AUTRE');
        $stranger = $this->makeStaff($otherClinic, 'MANAGER', 'autre.gerant');

        $this->read('/api/v1/workshop-orders/'.$validOrder['id'], $stranger)->assertNotFound();
        $this->write('POST', '/api/v1/workshop-orders/'.$validOrder['id'].'/advance', [
            'expected_version' => 1,
            'workshop_order_id' => $validOrder['id'],
            'event_type' => 'STATUS_CHANGE',
            'new_status' => 'RECEIVED',
            'quality_result' => 'NOT_APPLICABLE',
        ], $stranger)->assertNotFound();
    }

    public function test_la_correction_d_une_ordonnance_ne_modifie_pas_les_mesures_figees_de_la_commande(): void
    {
        [$invoiceId] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 60000)]);
        $lensLineId = $this->invoiceLine($invoiceId, 1);
        $v1 = $this->createValidatedExternalPrescription();

        $order = $this->createOrder($lensLineId, $v1['id'])->assertCreated()->json('data');
        $snapshotBefore = DB::table('workshop_orders')->where('id', $order['id'])->value('snapshot');

        // Révision v2 validée avec une sphère OD modifiée.
        $this->createValidatedExternalPrescription([
            'prescription_id' => Ulid::generate(),
            'series_id' => $v1['series_id'],
            'version_no' => 2,
            'supersedes_id' => $v1['id'],
            'eyes' => [
                ['id' => Ulid::generate(), 'eye' => 'OD', 'no_correction' => false, 'sphere' => '-3.75', 'cylinder' => '-0.50', 'axis' => 90, 'addition' => '2.00', 'fitting_height' => '20.00'],
                ['id' => Ulid::generate(), 'eye' => 'OG', 'no_correction' => false, 'sphere' => '-1.50', 'cylinder' => null, 'axis' => null, 'addition' => '2.00', 'fitting_height' => '20.00'],
            ],
        ]);

        $reloaded = $this->read('/api/v1/workshop-orders/'.$order['id'], $this->manager)->assertOk();
        $reloaded->assertJsonPath('data.prescription_version_no', 1)
            ->assertJsonPath('data.eyes.0.sphere', '-1.25');
        $this->assertSame($snapshotBefore, DB::table('workshop_orders')->where('id', $order['id'])->value('snapshot'));
    }

    public function test_cycle_complet_qc_reprise_revisions_pret_verrou_optimiste_et_journal_append_only(): void
    {
        [$invoiceId] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 60000)]);
        $lensLineId = $this->invoiceLine($invoiceId, 1);
        $rx = $this->createValidatedExternalPrescription();
        $order = $this->createOrder($lensLineId, $rx['id'])->assertCreated()->json('data');
        $id = $order['id'];

        // Transition directe illégale ORDERED -> MOUNTING refusée.
        $this->advance($id, 1, ['new_status' => 'MOUNTING'])->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        // Progression nominale jusqu'à QUALITY_CHECK.
        $this->advance($id, 1, ['new_status' => 'RECEIVED'])->assertOk()->assertJsonPath('data.status', 'RECEIVED');

        // Verrou optimiste avec ancienne version 1 => 409.
        $this->advance($id, 1, ['new_status' => 'MOUNTING'])->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT');

        $this->advance($id, 2, ['new_status' => 'MOUNTING'])->assertOk()->assertJsonPath('data.status', 'MOUNTING');
        $this->advance($id, 3, ['new_status' => 'QUALITY_CHECK'])->assertOk()->assertJsonPath('data.status', 'QUALITY_CHECK');

        // Contrôle qualité FAILED -> retour à MOUNTING sans événement WorkshopReady.
        $this->advance($id, 4, [
            'event_type' => 'QUALITY_CHECK',
            'quality_result' => 'FAILED',
            'observations' => 'Micro-rayure détectée sur verre droit',
        ])->assertOk()
            ->assertJsonPath('data.status', 'MOUNTING')
            ->assertJsonPath('data.ready_revision', 0);
        $this->assertSame(0, DB::table('outbox_events')->where('event_type', 'WorkshopReady')->count());

        // Second passage en QUALITY_CHECK puis PASSED -> READY (ready_revision = 1, WorkshopReady #1).
        $this->advance($id, 5, ['new_status' => 'QUALITY_CHECK'])->assertOk();
        $ready1 = $this->advance($id, 6, [
            'event_type' => 'QUALITY_CHECK',
            'quality_result' => 'PASSED',
            'observations' => 'Contrôle conforme',
        ])->assertOk();
        $this->assertMatchesContract($ready1, 'schemas/resources/workshop.json#/$defs/WorkshopOrderResponse');
        $ready1->assertJsonPath('data.status', 'READY')
            ->assertJsonPath('data.ready_revision', 1)
            ->assertJsonPath('data.version', 7);

        // Reprise depuis READY -> ORDERED puis nouveau passage QC PASSED -> READY (ready_revision = 2, WorkshopReady #2).
        $this->advance($id, 7, [
            'event_type' => 'REWORK',
            'new_status' => 'ORDERED',
            'observations' => 'Centrage à reprendre',
        ])->assertOk()->assertJsonPath('data.status', 'ORDERED')->assertJsonPath('data.ready_revision', 1);

        $this->advance($id, 8, ['new_status' => 'RECEIVED'])->assertOk();
        $this->advance($id, 9, ['new_status' => 'MOUNTING'])->assertOk();
        $this->advance($id, 10, ['new_status' => 'QUALITY_CHECK'])->assertOk();
        $ready2 = $this->advance($id, 11, [
            'event_type' => 'QUALITY_CHECK',
            'quality_result' => 'PASSED',
        ])->assertOk();
        $ready2->assertJsonPath('data.status', 'READY')
            ->assertJsonPath('data.ready_revision', 2)
            ->assertJsonPath('data.version', 12);

        $outbox = DB::table('outbox_events')
            ->where('event_type', 'WorkshopReady')
            ->where('source_id', $id)
            ->orderBy('source_version')
            ->get();
        $this->assertCount(2, $outbox);
        $this->assertSame(1, json_decode((string) $outbox[0]->payload, true)['ready_revision']);
        $this->assertSame(2, json_decode((string) $outbox[1]->payload, true)['ready_revision']);

        // Journal workshop_events strictement append-only (triggers SQL bloquent UPDATE et DELETE).
        try {
            DB::table('workshop_events')->where('workshop_order_id', $id)->update(['observations' => 'Falsifié']);
            $this->fail('Le trigger MySQL devait refuser UPDATE sur workshop_events.');
        } catch (QueryException) {
            // Attendu.
        }
        try {
            DB::table('workshop_events')->where('workshop_order_id', $id)->delete();
            $this->fail('Le trigger MySQL devait refuser DELETE sur workshop_events.');
        } catch (QueryException) {
            // Attendu.
        }
    }

    public function test_filtre_retard_remise_patient_liee_a_la_livraison_et_annulation_reouvre_reliquat(): void
    {
        [$invoiceId] = $this->settledInvoice([$this->line($this->item['lens'], '2', 1, 60000)]);
        $lensLineId = $this->invoiceLine($invoiceId, 1);
        $rx = $this->createValidatedExternalPrescription();

        // Commande 1 : en retard (échéance passée par rapport au 22/10/2026 figé par BillingFixtures), puis prête et remise.
        $order1 = $this->createOrder($lensLineId, $rx['id'], [
            'quantity' => '1',
            'expected_at' => '2026-10-10T10:00:00.000Z',
        ])->assertCreated()->json('data');
        $this->assertTrue($order1['is_overdue']);

        // Commande 2 : à l'heure, puis annulée pour vérifier la réouverture du reliquat.
        $order2 = $this->createOrder($lensLineId, $rx['id'], [
            'quantity' => '1',
            'expected_at' => CarbonImmutable::parse('2026-10-28T17:00:00Z')->toIso8601ZuluString('millisecond'),
        ])->assertCreated()->json('data');
        $this->assertFalse($order2['is_overdue']);

        $overdueList = $this->read('/api/v1/workshop-orders?overdue=1', $this->manager)->assertOk();
        $this->assertMatchesContract($overdueList, 'schemas/resources/workshop.json#/$defs/WorkshopOrderPage');
        $overdueList->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $order1['id']);

        // Conduire commande 1 à READY.
        $this->advance($order1['id'], 1, ['new_status' => 'RECEIVED'])->assertOk();
        $this->advance($order1['id'], 2, ['new_status' => 'MOUNTING'])->assertOk();
        $this->advance($order1['id'], 3, ['new_status' => 'QUALITY_CHECK'])->assertOk();
        $this->advance($order1['id'], 4, ['event_type' => 'QUALITY_CHECK', 'quality_result' => 'PASSED'])->assertOk();

        // Sans ligne de remise confirmée => 422.
        $this->advance($order1['id'], 5, ['new_status' => 'DELIVERED'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['delivery_line_id']]]);
        $this->advance($order1['id'], 5, ['new_status' => 'DELIVERED', 'delivery_line_id' => Ulid::generate()])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['delivery_line_id']]]);

        // Enregistrement d'une remise physique patient sur la facture réglée.
        $this->deliver($invoiceId, [$this->deliveryLine($lensLineId, $this->item['lens'], '1')], [], $this->manager)->assertCreated();
        $detailWithDelivery = $this->read('/api/v1/workshop-orders/'.$order1['id'], $this->manager)->assertOk();
        $deliveryLineId = (string) $detailWithDelivery->json('data.eligible_delivery_lines.0.delivery_line_id');
        $this->assertNotSame('', $deliveryLineId);

        $delivered = $this->advance($order1['id'], 5, [
            'new_status' => 'DELIVERED',
            'delivery_line_id' => $deliveryLineId,
        ])->assertOk();
        $this->assertMatchesContract($delivered, 'schemas/resources/workshop.json#/$defs/WorkshopOrderResponse');
        $delivered->assertJsonPath('data.status', 'DELIVERED')->assertJsonPath('data.is_overdue', false);

        // Statut terminal : aucune nouvelle action possible.
        $this->advance($order1['id'], 6, ['event_type' => 'CANCEL', 'observations' => 'Trop tard'])->assertStatus(409);

        // Annulation de la commande 2 : le reliquat remonte à 1 sur la ligne de facture.
        $this->advance($order2['id'], 1, ['event_type' => 'CANCEL', 'observations' => 'Erreur saisie commande'])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->read('/api/v1/workshop-orders?overdue=1', $this->manager)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/workshop-orders/eligible-lines', $this->manager)->assertOk()
            ->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.remaining_quantity', '1.000');
    }

    public function test_document_bon_laboratoire_depot_et_telechargement_par_droits(): void
    {
        [$invoiceId] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 60000)]);
        $lensLineId = $this->invoiceLine($invoiceId, 1);
        $rx = $this->createValidatedExternalPrescription();
        $order = $this->createOrder($lensLineId, $rx['id'])->assertCreated()->json('data');
        $docId = (string) $order['document']['document_id'];

        $pdfBytes = "%PDF-1.4\n% Bon laboratoire anonymisé fictif\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n";
        $headers = [
            'Idempotency-Key' => Ulid::generate(),
            'Content-Type' => 'application/pdf',
            'Accept' => 'application/json',
            'X-Content-Sha256' => hash('sha256', $pdfBytes),
        ];

        $stored = $this->actingAsFresh($this->manager)
            ->call('POST', '/api/v1/documents/'.$docId.'/content', [], [], [], $this->transformHeadersToServerVars($headers), $pdfBytes)
            ->assertOk();
        $stored->assertJsonPath('data.status', 'READY')->assertJsonPath('data.sha256', hash('sha256', $pdfBytes));

        $download = $this->actingAsFresh($this->manager)->get('/api/v1/documents/'.$docId.'/download')->assertOk();
        $this->assertStringStartsWith('application/pdf', (string) $download->headers->get('Content-Type'));
        $this->assertStringStartsWith('%PDF-', (string) $download->getContent());

        foreach ([$this->cashier, $this->clinician, $this->reception] as $unauthorized) {
            $this->actingAsFresh($unauthorized)->get('/api/v1/documents/'.$docId.'/download')->assertForbidden();
        }

        $stranger = $this->makeStaff($this->makeClinic('AUTRE'), 'MANAGER', 'autre.doc');
        $this->actingAsFresh($stranger)->get('/api/v1/documents/'.$docId.'/download')->assertNotFound();
    }
}

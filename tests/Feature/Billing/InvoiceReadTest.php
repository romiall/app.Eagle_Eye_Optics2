<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Lecture des factures et des reçus (B02, B03, B04) : liste filtrée et paginée avec soldes projetés, détail avec
 * snapshots, propriétaire et document, reçu. Aucun statut « payé » stocké, aucun coût d'achat, limite au cabinet,
 * lecture réservée à `invoice.read`. Données fictives.
 */
final class InvoiceReadTest extends TestCase
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

    /**
     * Brouillon inséré directement (pour les listes longues) : identifiant.
     */
    private function seedDraftRow(?string $patientId = null, ?string $clinicId = null): string
    {
        $id = Ulid::generate();
        DB::table('invoices')->insert([
            'id' => $id, 'clinic_id' => $clinicId ?? $this->clinicId, 'patient_id' => $patientId ?? $this->patientId, 'status' => 'DRAFT', 'currency' => 'XAF',
            'total_gross' => 0, 'origin' => 'NATIVE', 'created_by' => (string) DB::table('users')->where('clinic_id', $clinicId ?? $this->clinicId)->value('id'), 'version' => 1,
        ]);

        return $id;
    }

    public function test_la_liste_donne_le_solde_projete_de_chaque_facture(): void
    {
        [$draft] = $this->draft([$this->line($this->item['exam'])]);
        [$unpaid] = $this->issuedUncollectedInvoice([$this->line($this->item['exam'])]);
        [$partial] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($partial, 1, 30000)->assertCreated();
        [$settled] = $this->issuedInvoice([$this->line($this->item['exam'])]);

        $response = $this->read('/api/v1/invoices', $this->cashier)->assertOk();

        $response->assertJsonPath('meta.total', 4)->assertJsonPath('meta.per_page', 25)->assertJsonPath('meta.current_page', 1);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoicePage');
        $rows = [];
        foreach ($response->json('data') as $row) {
            $rows[$row['id']] = $row;
        }
        $this->assertSame([null, 0, null, 1], [$rows[$draft]['number'], $rows[$draft]['balance_due'], $rows[$draft]['ledger_version'], $rows[$draft]['draft_version']]);
        $this->assertSame(['ISSUED', 15000, 1], [$rows[$unpaid]['status'], $rows[$unpaid]['balance_due'], $rows[$unpaid]['ledger_version']]);
        $this->assertSame([50000, 2], [$rows[$partial]['balance_due'], $rows[$partial]['ledger_version']]);
        $this->assertSame([0, 2], [$rows[$settled]['balance_due'], $rows[$settled]['ledger_version']]);
        $this->assertSame(['DRAFT', 'ISSUED'], array_values(array_unique(array_merge(['DRAFT'], array_column($response->json('data'), 'status')))), 'Aucun statut « payé » n\'existe.');
    }

    public function test_la_liste_se_filtre_par_statut_et_par_patient(): void
    {
        $other = $this->seedPatient($this->clinicId, 'Autre Patient');
        $this->draft([$this->line($this->item['exam'])]);
        $this->issuedInvoice([$this->line($this->item['exam'])]);
        $this->issuedInvoice([$this->line($this->item['exam'])]);
        $otherDraft = $this->seedDraftRow($other);

        $this->read('/api/v1/invoices?status=ISSUED', $this->cashier)->assertJsonPath('meta.total', 2);
        $this->read('/api/v1/invoices?status=DRAFT', $this->cashier)->assertJsonPath('meta.total', 2);
        $this->read('/api/v1/invoices?status=ABANDONED', $this->cashier)->assertJsonPath('meta.total', 0);
        $this->read('/api/v1/invoices?patient_id='.$other, $this->cashier)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $otherDraft);
        $this->read('/api/v1/invoices?patient_id='.$this->patientId.'&status=ISSUED', $this->cashier)->assertJsonPath('meta.total', 2);
    }

    public function test_un_filtre_ou_une_page_invalide_est_un_refus_de_validation(): void
    {
        $this->read('/api/v1/invoices?status=PAID', $this->cashier)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['status']]]);
        $this->read('/api/v1/invoices?patient_id=1234', $this->cashier)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['patient_id']]]);
        $this->read('/api/v1/invoices?page=0', $this->cashier)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['page']]]);
    }

    public function test_la_liste_est_paginee_par_vingt_cinq_et_ne_montre_que_le_cabinet(): void
    {
        for ($index = 0; $index < 26; $index++) {
            $this->seedDraftRow();
        }
        $other = $this->makeClinic('TEST CABINET B');
        $this->makeStaff($other, 'MANAGER', 'gerante.b');
        $this->seedDraftRow($this->seedPatient($other), $other);

        $first = $this->read('/api/v1/invoices', $this->cashier)->assertOk();
        $second = $this->read('/api/v1/invoices?page=2', $this->cashier)->assertOk();

        $first->assertJsonCount(25, 'data')->assertJsonPath('meta.total', 26)->assertJsonPath('meta.last_page', 2);
        $second->assertJsonCount(1, 'data')->assertJsonPath('meta.current_page', 2);
    }

    public function test_le_detail_d_un_brouillon_n_a_ni_snapshot_ni_version_financiere(): void
    {
        [$id] = $this->draft([$this->line($this->item['exam'])]);

        $response = $this->read('/api/v1/invoices/'.$id, $this->cashier)->assertOk();

        $response->assertJsonPath('data.status', 'DRAFT')
            ->assertJsonPath('data.number', null)
            ->assertJsonPath('data.ledger_version', null)
            ->assertJsonPath('data.patient_snapshot', null)
            ->assertJsonPath('data.clinic_snapshot', null)
            ->assertJsonPath('data.tax_snapshot', null)
            ->assertJsonPath('data.document', null)
            ->assertJsonPath('data.balance.settlement', 'NOT_ISSUED')
            ->assertJsonPath('data.balance.balance_due', 0)
            ->assertJsonCount(1, 'data.lines');
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
    }

    public function test_le_detail_d_une_facture_emise_porte_snapshots_document_et_encaissements(): void
    {
        [$id] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $payment = $this->pay($id, 1, 30000)->assertCreated();

        $response = $this->read('/api/v1/invoices/'.$id, $this->cashier)->assertOk();

        $response->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.patient_snapshot.last_name', 'Patient Fictif')
            ->assertJsonPath('data.clinic_snapshot.currency', 'XAF')
            ->assertJsonPath('data.tax_snapshot.regime', 'NO_TAX_CONFIGURED')
            ->assertJsonPath('data.document.document_status', 'PENDING')
            ->assertJsonPath('data.payments.0.id', $payment->json('data.payment_id'))
            ->assertJsonPath('data.payments.0.receipt_number', 'TEST-REC-2026-000001')
            ->assertJsonPath('data.payments.0.reversed_amount', 0)
            ->assertJsonPath('data.balance.credit_available', 0)
            ->assertJsonPath('data.credit_notes', [])
            ->assertJsonPath('data.refunds', []);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
    }

    public function test_le_poste_qui_detient_la_facture_est_signale(): void
    {
        [$id] = $this->draft([$this->line($this->item['exam'])]);
        $device = $this->seedWriteOwner($id, 'ACTIVE');

        $this->read('/api/v1/invoices/'.$id, $this->manager)->assertOk()
            ->assertJsonPath('data.write_owner.device_id', $device)
            ->assertJsonPath('data.write_owner.epoch', 1)
            ->assertJsonPath('data.write_owner.status', 'ACTIVE');
    }

    public function test_un_droit_clos_n_est_plus_signale_comme_proprietaire(): void
    {
        [$id] = $this->draft([$this->line($this->item['exam'])]);
        $this->seedWriteOwner($id, 'CLOSED');

        $this->read('/api/v1/invoices/'.$id, $this->manager)->assertOk()->assertJsonPath('data.write_owner', null);
    }

    public function test_aucun_cout_d_achat_n_apparait_dans_une_facture(): void
    {
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['purchase_cost' => 12345]);
        $this->seedPosition($this->item['frame'], '5');
        [$id] = $this->issuedInvoice([$this->line($this->item['frame'])]);

        $detail = (string) $this->read('/api/v1/invoices/'.$id, $this->cashier)->assertOk()->getContent();
        $list = (string) $this->read('/api/v1/invoices', $this->cashier)->assertOk()->getContent();

        foreach ([$detail, $list] as $body) {
            $this->assertStringNotContainsString('purchase_cost', $body);
            $this->assertStringNotContainsString('12345', $body);
        }
    }

    public function test_une_facture_inconnue_ou_d_un_autre_cabinet_est_introuvable(): void
    {
        $other = $this->makeClinic('TEST CABINET B');
        $this->makeStaff($other, 'MANAGER', 'gerante.b');
        $foreign = $this->seedDraftRow($this->seedPatient($other), $other);

        $this->read('/api/v1/invoices/'.$foreign, $this->manager)->assertNotFound();
        $this->read('/api/v1/invoices/'.Ulid::generate(), $this->manager)->assertNotFound();
        $this->read('/api/v1/invoices/pas-un-identifiant', $this->manager)->assertNotFound();
    }

    public function test_le_recu_est_introuvable_s_il_n_existe_pas(): void
    {
        $this->read('/api/v1/receipts/'.Ulid::generate(), $this->manager)->assertNotFound();
        $this->read('/api/v1/receipts/pas-un-identifiant', $this->manager)->assertNotFound();
    }

    public function test_un_recu_d_un_autre_cabinet_est_introuvable(): void
    {
        [$id] = $this->issuedUncollectedInvoice();
        $receiptId = $this->pay($id, 1, 15000)->assertCreated()->json('data.receipt_id');
        $other = $this->makeClinic('TEST CABINET B');
        $manager = $this->makeStaff($other, 'MANAGER', 'gerante.b');

        $this->read('/api/v1/receipts/'.$receiptId, $manager)->assertNotFound();
        $this->read('/api/v1/receipts/'.$receiptId, $this->manager)->assertOk();
    }

    public function test_seuls_les_comptes_avec_la_lecture_des_factures_les_consultent(): void
    {
        [$id] = $this->issuedUncollectedInvoice();
        $receiptId = $this->pay($id, 1, 15000)->assertCreated()->json('data.receipt_id');
        $this->allowPermission($this->reception, 'exam_fee.collect');

        foreach ([$this->reception, $this->clinician] as $user) {
            $this->read('/api/v1/invoices', $user)->assertForbidden();
            $this->read('/api/v1/invoices/'.$id, $user)->assertForbidden();
            $this->read('/api/v1/receipts/'.$receiptId, $user)->assertForbidden();
        }
        foreach ([$this->cashier, $this->manager] as $user) {
            $this->read('/api/v1/invoices', $user)->assertOk();
            $this->read('/api/v1/invoices/'.$id, $user)->assertOk();
            $this->read('/api/v1/receipts/'.$receiptId, $user)->assertOk();
        }
    }

    public function test_un_module_ferme_repond_404_et_un_visiteur_non_connecte_401(): void
    {
        [$id] = $this->issuedInvoice();
        // La facture vient d'être émise par un compte connecté : le visiteur repart d'une session vide et sans garde.
        $this->flushSession();
        $this->nextRequest()->getJson('/api/v1/invoices')->assertUnauthorized();
        $this->nextRequest()->getJson('/api/v1/invoices/'.$id)->assertUnauthorized();

        config(['eeo.enabled_modules' => ['stock']]);
        $this->read('/api/v1/invoices', $this->manager)->assertNotFound();
        $this->read('/api/v1/invoices/'.$id, $this->manager)->assertNotFound();
    }
}

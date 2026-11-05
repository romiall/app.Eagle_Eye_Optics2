<?php

namespace Tests\Feature\Billing;

use App\Domain\Billing\BilledExamFeeControl;
use App\Domain\Billing\ExamFeeWaiver;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Contrôle réel du paiement de l'examen (B04, AT05, AT06) branché par `eeo.billing.exam_fee_control = billed` : le
 * démarrage d'une consultation exige la facture de frais d'examen de CETTE visite réglée, ou la dérogation exacte de la
 * gérante, consommée une seule fois. Par défaut (`off`) le comportement du jalon clinique, « non contrôlé », est
 * inchangé. Données fictives.
 */
final class BilledExamFeeControlTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'today', 'patients', 'consultations']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function billed(): void
    {
        config(['eeo.billing.exam_fee_control' => 'billed']);
    }

    /**
     * Visite insérée directement (arrivée à 09 h 15 UTC, le jour du test) : identifiant.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function visit(array $overrides = [], ?string $patientId = null): string
    {
        $id = Ulid::generate();
        DB::table('visits')->insert($overrides + [
            'id' => $id, 'clinic_id' => $this->clinicId, 'patient_id' => $patientId ?? $this->patientId, 'reason' => 'EXAM',
            'occurred_at' => '2026-10-22 09:15:00.000000', 'status' => 'ARRIVED', 'appointment_id' => null, 'exam_invoice_id' => null,
            'exam_waiver_approval_id' => null, 'arrival_at' => '2026-10-22 09:15:00.000000', 'closed_at' => null, 'administrative_note' => null,
            'created_by' => $this->manager->id, 'version' => 1, 'created_at' => '2026-10-22 09:15:00.000000', 'updated_at' => '2026-10-22 09:15:00.000000',
        ]);

        return (string) ($overrides['id'] ?? $id);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function start(string $visitId, array $overrides = []): TestResponse
    {
        return $this->actingAsFresh($this->clinician)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/visits/'.$visitId.'/consultations', array_merge([
                'expected_version' => null, 'consultation_id' => Ulid::generate(), 'visit_id' => $visitId, 'patient_id' => $this->patientId,
                'effective_at' => '2026-10-22T09:20:00.000Z', 'date_change_reason' => null, 'exam_invoice_id' => null, 'exam_waiver_approval_id' => null,
            ], $overrides));
    }

    /**
     * Facture émise rattachée à la visite : identifiant. `$paid` encaisse ce montant (null : rien).
     *
     * @param  list<array<string, mixed>>|null  $lines
     */
    private function invoiceFor(string $visitId, ?array $lines = null, ?int $paid = null, bool $issue = true): string
    {
        $draft = $this->createDraft($lines ?? [$this->line($this->item['exam'])], $this->cashier, ['visit_id' => $visitId])->assertCreated();
        $id = (string) $draft->json('data.id');
        if ($issue) {
            $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, (int) $draft->json('data.draft_version'), (int) $draft->json('data.total_gross')), $this->cashier)->assertOk();
        }
        if ($paid !== null) {
            $this->pay($id, 1, $paid)->assertCreated();
        }

        return $id;
    }

    /**
     * Dérogation de la gérante telle que B06 devra la produire (contrat de `ExamFeeWaiver`).
     *
     * @param  array<string, mixed>  $overrides
     */
    private function waiver(string $visitId, array $overrides = []): string
    {
        $id = Ulid::generate();
        DB::table('approvals')->insert($overrides + [
            'id' => $id, 'clinic_id' => $this->clinicId, 'action_code' => ExamFeeWaiver::ACTION_CODE, 'target_type' => ExamFeeWaiver::TARGET_TYPE,
            'target_id' => $visitId, 'payload_hash' => ExamFeeWaiver::payloadHash($visitId, $this->patientId), 'requested_by' => $this->reception->id,
            'reason' => 'Patient pris en charge par la gérante (fictif)', 'status' => 'APPROVED', 'decided_by' => $this->manager->id,
            'decided_at' => '2026-10-22 09:25:00.000000', 'expires_at' => '2026-10-22 18:00:00.000000', 'consumed_at' => null,
        ]);

        return (string) ($overrides['id'] ?? $id);
    }

    private function examFeeAudit(string $consultationId): ?string
    {
        $diff = DB::table('audit_events')->where('action', 'consultation.started')->where('target_id', $consultationId)->value('sanitized_diff');

        return is_string($diff) ? (string) (json_decode($diff, true)['exam_fee_control'] ?? null) : null;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Par défaut : non contrôlé
    // ------------------------------------------------------------------------------------------------------------

    public function test_par_defaut_le_controle_reste_non_controle_et_le_dit_dans_l_audit(): void
    {
        $visit = $this->visit();

        $response = $this->start($visit)->assertCreated();

        $this->assertSame('NOT_CONTROLLED', $this->examFeeAudit((string) $response->json('data.id')));
        $this->assertNull(DB::table('visits')->where('id', $visit)->value('exam_invoice_id'));
    }

    public function test_une_valeur_inconnue_de_la_cle_n_active_aucun_controle(): void
    {
        foreach (['on', 'true', 'BILLED', '1', ''] as $value) {
            config(['eeo.billing.exam_fee_control' => $value]);
            $visit = $this->visit();

            $response = $this->start($visit)->assertCreated();

            $this->assertSame('NOT_CONTROLLED', $this->examFeeAudit((string) $response->json('data.id')), $value);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Contrôle actif : refus
    // ------------------------------------------------------------------------------------------------------------

    public function test_sans_facture_de_frais_le_demarrage_est_refuse_et_rien_n_est_cree(): void
    {
        $this->billed();
        $visit = $this->visit();

        $response = $this->start($visit);

        $response->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED')->assertJsonStructure(['error' => ['fields' => ['exam_invoice_id']]]);
        $this->assertMatchesContract($response, 'schemas/error.json');
        $this->assertSame(0, DB::table('consultations')->count());
        $visitRow = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($visitRow);
        $this->assertSame(['ARRIVED', 1, null, null], [$visitRow->status, (int) $visitRow->version, $visitRow->exam_invoice_id, $visitRow->exam_waiver_approval_id]);
    }

    public function test_un_brouillon_une_facture_non_payee_ou_partiellement_payee_ne_suffisent_pas(): void
    {
        $this->billed();
        $visit = $this->visit();
        $this->invoiceFor($visit, null, null, false);
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');

        $unpaid = $this->invoiceFor($visit);
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');

        $this->pay($unpaid, 1, 5000)->assertCreated();
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->assertSame(0, DB::table('consultations')->count());
    }

    public function test_le_paiement_d_une_autre_visite_ne_prouve_rien(): void
    {
        $this->billed();
        $other = $this->visit();
        $this->invoiceFor($other, null, 15000);
        $visit = $this->visit();

        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->start($other)->assertCreated();
    }

    public function test_le_paiement_d_une_monture_ne_prouve_pas_le_paiement_de_l_examen(): void
    {
        $this->billed();
        $this->seedPosition($this->item['frame'], '5');
        $visit = $this->visit();
        $this->invoiceFor($visit, [$this->line($this->item['frame'])], 40000);

        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->assertSame(0, DB::table('consultations')->count());
    }

    public function test_sans_article_de_frais_configure_aucune_facture_ne_prouve_le_reglement(): void
    {
        $this->billed();
        $visit = $this->visit();
        $this->invoiceFor($visit, null, 15000);
        config(['eeo.billing.exam_fee_item_reference' => '']);

        $response = $this->start($visit);

        $response->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->assertStringContainsString('EEO_EXAM_FEE_ITEM_REFERENCE', (string) $response->json('error.message'));
    }

    public function test_une_preuve_fournie_qui_n_est_pas_reglee_est_refusee(): void
    {
        $this->billed();
        $visit = $this->visit();
        $unpaid = $this->invoiceFor($visit);

        $this->start($visit, ['exam_invoice_id' => $unpaid])->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED')
            ->assertJsonStructure(['error' => ['fields' => ['exam_invoice_id']]]);
        $this->start($visit, ['exam_invoice_id' => Ulid::generate()])->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Contrôle actif : preuve de règlement
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_facture_de_frais_reglee_autorise_le_demarrage_et_reste_sur_la_visite(): void
    {
        $this->billed();
        $visit = $this->visit();
        $invoice = $this->invoiceFor($visit, null, 15000);

        $response = $this->start($visit)->assertCreated();

        $this->assertSame('PAID', $this->examFeeAudit((string) $response->json('data.id')));
        $visitRow = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($visitRow);
        $this->assertSame(['IN_CONSULTATION', $invoice], [$visitRow->status, $visitRow->exam_invoice_id]);
        $this->assertSame(1, DB::table('consultations')->count());
    }

    public function test_une_facture_de_frais_et_de_monture_reglee_en_entier_prouve_l_examen(): void
    {
        $this->billed();
        $this->seedPosition($this->item['frame'], '5');
        $visit = $this->visit();
        $invoice = $this->invoiceFor($visit, [$this->line($this->item['exam']), $this->line($this->item['frame'], '1', 2)], 55000);

        $this->start($visit, ['exam_invoice_id' => $invoice])->assertCreated();
        $this->assertSame($invoice, DB::table('visits')->where('id', $visit)->value('exam_invoice_id'));
    }

    public function test_un_controle_de_suivi_se_regle_comme_un_examen(): void
    {
        $this->billed();
        $visit = $this->visit(['reason' => 'FOLLOW_UP']);

        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->invoiceFor($visit, null, 15000);
        $this->start($visit)->assertCreated();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Contrôle actif : dérogation de la gérante
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_derogation_exacte_autorise_le_demarrage_et_est_consommee_une_seule_fois(): void
    {
        $this->billed();
        $visit = $this->visit();
        $waiver = $this->waiver($visit);

        $response = $this->start($visit, ['exam_waiver_approval_id' => $waiver])->assertCreated();

        $this->assertSame('WAIVED', $this->examFeeAudit((string) $response->json('data.id')));
        $approval = DB::table('approvals')->where('id', $waiver)->first();
        $this->assertNotNull($approval);
        $this->assertSame('CONSUMED', $approval->status);
        $this->assertNotNull($approval->consumed_at);
        $this->assertSame($waiver, DB::table('visits')->where('id', $visit)->value('exam_waiver_approval_id'));

        // Réutilisée pour une autre visite : refusée, jamais transférable.
        $other = $this->visit();
        $this->start($other, ['exam_waiver_approval_id' => $waiver])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
    }

    public function test_une_derogation_inexacte_expiree_ou_non_decidee_est_refusee(): void
    {
        $this->billed();
        $visit = $this->visit();
        $otherVisit = $this->visit();
        $cases = [
            'expirée' => $this->waiver($visit, ['expires_at' => '2026-10-22 09:00:00.000000']),
            'non décidée' => $this->waiver($visit, ['status' => 'REQUESTED', 'decided_by' => null, 'decided_at' => null]),
            'refusée' => $this->waiver($visit, ['status' => 'REFUSED']),
            'd\'une autre visite' => $this->waiver($otherVisit),
            'd\'une autre action' => $this->waiver($visit, ['action_code' => 'stock.adjust']),
            'd\'une autre cible' => $this->waiver($visit, ['target_type' => 'invoices']),
            'd\'un autre contenu' => $this->waiver($visit, ['payload_hash' => str_repeat('d', 64)]),
            'déjà consommée' => $this->waiver($visit, ['status' => 'CONSUMED', 'consumed_at' => '2026-10-22 09:26:00.000000']),
            'inconnue' => Ulid::generate(),
        ];

        foreach ($cases as $label => $approval) {
            $this->start($visit, ['exam_waiver_approval_id' => $approval])
                ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED')
                ->assertJsonStructure(['error' => ['fields' => ['exam_waiver_approval_id']]]);
            $this->assertSame(0, DB::table('consultations')->count(), $label);
        }
        $this->assertSame('APPROVED', DB::table('approvals')->where('id', $cases['expirée'])->value('status'), 'Un refus ne consomme aucune dérogation.');
    }

    public function test_une_derogation_sans_expiration_reste_valable(): void
    {
        $this->billed();
        $visit = $this->visit();

        $this->start($visit, ['exam_waiver_approval_id' => $this->waiver($visit, ['expires_at' => null])])->assertCreated();
    }

    public function test_un_refus_de_validation_laisse_la_derogation_intacte(): void
    {
        $this->billed();
        $visit = $this->visit();
        $waiver = $this->waiver($visit);

        // Date de consultation dans le futur : la commande entière est refusée, la dérogation n'est pas brûlée.
        $this->start($visit, ['exam_waiver_approval_id' => $waiver, 'effective_at' => '2026-10-23T09:20:00.000Z'])->assertStatus(422);

        $approval = DB::table('approvals')->where('id', $waiver)->first();
        $this->assertNotNull($approval);
        $this->assertSame(['APPROVED', null], [$approval->status, $approval->consumed_at]);
        $this->assertNull(DB::table('visits')->where('id', $visit)->value('exam_waiver_approval_id'));
        $this->start($visit, ['exam_waiver_approval_id' => $waiver])->assertCreated();
    }

    public function test_un_reglement_complet_prime_sur_une_derogation_fournie(): void
    {
        $this->billed();
        $visit = $this->visit();
        $this->invoiceFor($visit, null, 15000);
        $waiver = $this->waiver($visit);

        $response = $this->start($visit, ['exam_waiver_approval_id' => $waiver])->assertCreated();

        $this->assertSame('PAID', $this->examFeeAudit((string) $response->json('data.id')));
        $this->assertSame('APPROVED', DB::table('approvals')->where('id', $waiver)->value('status'), 'La dérogation n\'est pas consommée quand le règlement suffit.');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Lecture du statut (sans écriture)
    // ------------------------------------------------------------------------------------------------------------

    public function test_le_statut_en_lecture_distingue_non_paye_paye_deroge_et_sans_objet(): void
    {
        $this->billed();
        $control = $this->app->make(BilledExamFeeControl::class);
        $visit = $this->visit();
        $row = static fn (string $id): object => (object) (array) DB::table('visits')->where('id', $id)->first();

        $this->assertSame('UNPAID', $control->statusFor($row($visit)));
        $invoice = $this->invoiceFor($visit, null, 15000);
        $this->assertSame('PAID', $control->statusFor($row($visit)));
        $this->assertSame([$invoice], $control->paidInvoices($this->clinicId, $visit, $this->patientId));

        $waived = $this->visit();
        DB::table('visits')->where('id', $waived)->update(['exam_waiver_approval_id' => $this->waiver($waived)]);
        $this->assertSame('WAIVED', $control->statusFor($row($waived)));

        $purchase = $this->visit(['reason' => 'DIRECT_PURCHASE']);
        $this->assertSame('NOT_APPLICABLE', $control->statusFor($row($purchase)));
        $this->assertNull(DB::table('visits')->where('id', $visit)->value('exam_invoice_id'), 'La lecture n\'écrit rien.');
    }

    public function test_un_autre_compte_que_le_professionnel_ne_demarre_pas_la_consultation(): void
    {
        $this->billed();
        $visit = $this->visit();
        $this->invoiceFor($visit, null, 15000);

        foreach ([$this->cashier, $this->reception] as $user) {
            $this->actingAsFresh($user)->withHeaders(['Idempotency-Key' => Ulid::generate()])
                ->postJson('/api/v1/visits/'.$visit.'/consultations', [
                    'expected_version' => null, 'consultation_id' => Ulid::generate(), 'visit_id' => $visit, 'patient_id' => $this->patientId,
                    'effective_at' => '2026-10-22T09:20:00.000Z', 'date_change_reason' => null, 'exam_invoice_id' => null, 'exam_waiver_approval_id' => null,
                ])->assertForbidden();
        }
        $this->assertSame(0, DB::table('consultations')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Suppression d'un examen resté brouillon : la visite revient à son état d'avant
    // ------------------------------------------------------------------------------------------------------------

    private function deleteDraft(string $consultationId): TestResponse
    {
        return $this->actingAsFresh($this->clinician)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/consultations/'.$consultationId.'/delete', ['expected_version' => 1, 'consultation_id' => $consultationId]);
    }

    public function test_avec_les_frais_regles_la_visite_revient_prete_pour_l_examen_apres_la_suppression_du_brouillon(): void
    {
        $this->billed();
        $visit = $this->visit();
        $invoice = $this->invoiceFor($visit, null, 15000);
        $consultation = (string) $this->start($visit)->assertCreated()->json('data.id');

        $this->deleteDraft($consultation)->assertOk()->assertJsonPath('data.visit_status', 'READY_FOR_EXAM');

        $row = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($row);
        $this->assertSame(['READY_FOR_EXAM', $invoice], [$row->status, $row->exam_invoice_id]);
        $this->start($visit)->assertCreated();
    }

    public function test_une_dispense_consommee_par_l_examen_supprime_n_est_pas_reutilisee_et_les_factures_restent(): void
    {
        $this->billed();
        $visit = $this->visit();
        $waiver = $this->waiver($visit);
        $consultation = (string) $this->start($visit, ['exam_waiver_approval_id' => $waiver])->assertCreated()->json('data.id');
        $draftInvoice = $this->invoiceFor($visit, null, null, false);
        $invoiceBefore = (array) DB::table('invoices')->where('id', $draftInvoice)->first();

        $this->deleteDraft($consultation)->assertOk()->assertJsonPath('data.visit_status', 'AWAITING_EXAM_FEE');

        $row = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($row);
        $this->assertSame(['AWAITING_EXAM_FEE', null, null], [$row->status, $row->exam_invoice_id, $row->exam_waiver_approval_id]);
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $waiver)->value('status'), 'L\'approbation reste consommée : elle ne sert qu\'une fois.');
        $this->assertEquals($invoiceBefore, (array) DB::table('invoices')->where('id', $draftInvoice)->first(), 'Le brouillon de facture de la visite n\'est pas touché.');
        $this->start($visit, ['exam_waiver_approval_id' => $waiver])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
    }
}

<?php

namespace Tests\Feature\Access;

use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Billing\ExamFeeWaiver;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Approbations exactes (B06, AT06, AT07, AT13, AT14, AT16, AT43 ; EE016, EE018, EE024, EE025) sur MySQL réel : la
 * demande porte le contenu exact, le serveur en dérive l'empreinte ; la gérante décide après réauthentification, jamais
 * sur sa propre demande ni sans la permission que l'approbation remplace ; une approbation échue, refusée ou déjà
 * utilisée ne vaut rien ; la consommation est unique et liée au contenu. Données fictives.
 */
final class ApprovalsTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'today', 'patients', 'consultations', 'settings']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Facture émise et payée par mobile money : [facture, paiement].
     *
     * @return array{0: string, 1: string}
     */
    private function paidInvoice(int $amount = 40000): array
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, $amount)], $this->manager);
        $this->pay($invoice, 1, $amount)->assertCreated();

        return [$invoice, $this->firstPayment($invoice)];
    }

    // ------------------------------------------------------------------------------------------------------------
    // Demande
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_demande_derive_l_action_la_cible_et_l_empreinte_du_contenu_exact(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $subject = ApprovalSubject::paymentReversal($invoice, $payment, 40000);

        $response = $this->requestApproval($subject->toArray(), $this->cashier, 'Paiement saisi deux fois (fictif)');

        $response->assertCreated()
            ->assertJsonPath('data.kind', 'PAYMENT_REVERSAL')
            ->assertJsonPath('data.action_code', 'payment.reverse')
            ->assertJsonPath('data.target_type', 'payments')
            ->assertJsonPath('data.target_id', $payment)
            ->assertJsonPath('data.payload_hash', $subject->hash())
            ->assertJsonPath('data.status', 'REQUESTED')
            ->assertJsonPath('data.effective_status', 'REQUESTED')
            ->assertJsonPath('data.requested_by', $this->cashier->id)
            ->assertJsonPath('data.subject.amount', 40000)
            ->assertJsonPath('data.target.payment.amount', 40000);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/ApprovalResponse');
        $id = (string) $response->json('data.id');
        $audit = DB::table('audit_events')->where('action', 'approval.requested')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->cashier->id, $audit->actor_id);
        $this->assertSame('Paiement saisi deux fois (fictif)', $audit->reason);
        $change = DB::table('sync_change_log')->where('entity_type', 'approvals')->where('entity_id', $id)->first();
        $this->assertNotNull($change);
        $this->assertSame('MANAGER', $change->visibility);
    }

    public function test_une_empreinte_fournie_par_le_client_ou_un_contenu_inexact_est_refuse(): void
    {
        [$invoice, $payment] = $this->paidInvoice();

        $this->write('POST', '/api/v1/approvals', [
            'expected_version' => null, 'approval_id' => Ulid::generate(), 'reason' => 'Fictif',
            'subject' => ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(),
            'payload_hash' => str_repeat('a', 64), 'expires_at' => null,
        ], $this->cashier)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');

        $this->requestApproval(['kind' => 'ANY_OPERATION', 'invoice_id' => $invoice], $this->cashier)->assertStatus(422);
        $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40001)->toArray(), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['subject.amount']]]);
        $this->requestApproval(ApprovalSubject::paymentReversal($invoice, Ulid::generate(), 100)->toArray(), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['subject.payment_id']]]);
        $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(), $this->cashier, '')
            ->assertStatus(422);
        $this->assertSame(0, DB::table('approvals')->count());
    }

    public function test_une_demande_identique_en_attente_n_est_pas_dupliquee(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $subject = ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray();
        $this->requestApproval($subject, $this->cashier)->assertCreated();

        $this->requestApproval($subject, $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'REQUESTED');
        $this->assertSame(1, DB::table('approvals')->count());

        // Même clé, même contenu : rejeu de la première réponse, aucune seconde demande.
        $key = Ulid::generate();
        $id = Ulid::generate();
        $other = ApprovalSubject::paymentReversal($invoice, $payment, 10000)->toArray();
        $first = $this->requestApproval($other, $this->cashier, 'Fictif', $id, null, $key)->assertCreated();
        $this->requestApproval($other, $this->cashier, 'Fictif', $id, null, $key)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertSame(2, DB::table('approvals')->count());
    }

    public function test_sans_le_droit_de_demander_ou_module_ferme_rien_n_est_cree(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $subject = ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray();
        $this->denyPermission($this->cashier, 'approval.request');

        $this->requestApproval($subject, $this->cashier)->assertForbidden();

        config(['eeo.enabled_modules' => ['sales']]);
        $this->requestApproval($subject, $this->manager)->assertNotFound();
        $this->assertSame(0, DB::table('approvals')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Décision
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_decision_exige_une_reauthentification_recente(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $id = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(), $this->cashier)->json('data.id');

        $this->decide($id, 'APPROVED', $this->manager, null, false)->assertStatus(423)->assertJsonPath('error.code', 'REAUTHENTICATION_REQUIRED');
        $this->assertSame('REQUESTED', DB::table('approvals')->where('id', $id)->value('status'));

        $this->decide($id, 'APPROVED', $this->manager)->assertOk()
            ->assertJsonPath('data.status', 'APPROVED')
            ->assertJsonPath('data.decided_by', $this->manager->id);
        $row = DB::table('approvals')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertNotNull($row->decided_at);
        // Échéance : décision + 60 minutes (valeur par défaut, proposition à confirmer).
        $this->assertSame('2026-10-22 10:30:00.000000', (string) $row->expires_at);
        $this->assertSame(1, $this->auditCount('approval.decided', $id));
    }

    public function test_un_refus_exige_un_motif_qui_est_rendu_a_la_demandeuse(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $id = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(), $this->cashier)->json('data.id');

        $this->decide($id, 'REFUSED', $this->manager)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reason']]]);
        $this->decide($id, 'REFUSED', $this->manager, 'Le paiement est bien arrivé (fictif)')->assertOk()->assertJsonPath('data.status', 'REFUSED');

        $this->read('/api/v1/approvals/'.$id, $this->cashier)->assertOk()
            ->assertJsonPath('data.effective_status', 'REFUSED')
            ->assertJsonPath('data.decision_reason', 'Le paiement est bien arrivé (fictif)');
        // Une décision ne se change pas.
        $this->decide($id, 'APPROVED', $this->manager)->assertStatus(409)->assertJsonPath('error.details.current_status', 'REFUSED');
    }

    public function test_la_demandeuse_ne_decide_jamais_de_sa_propre_demande(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $id = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(), $this->manager)->json('data.id');

        $this->decide($id, 'APPROVED', $this->manager)->assertForbidden();
        $this->assertSame('REQUESTED', DB::table('approvals')->where('id', $id)->value('status'));
    }

    public function test_les_permissions_prix_examen_et_correction_restent_distinctes(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $id = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 40000)->toArray(), $this->cashier)->json('data.id');
        // Une gérante privée de la permission que l'approbation remplace ne peut pas l'accorder.
        $this->denyPermission($this->manager, 'payment.reverse');

        $this->decide($id, 'APPROVED', $this->manager)->assertForbidden();
        $this->assertSame('REQUESTED', DB::table('approvals')->where('id', $id)->value('status'));
        // La caisse ne décide rien.
        $this->decide($id, 'APPROVED', $this->cashier)->assertForbidden();
    }

    public function test_une_demande_echue_ne_se_decide_plus_et_un_accord_ne_depasse_pas_l_echeance_proposee(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $short = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 10000)->toArray(), $this->cashier, 'Fictif', null, '2026-10-22T09:45:00.000Z')->json('data.id');
        $late = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 20000)->toArray(), $this->cashier, 'Fictif', null, '2026-10-22T09:40:00.000Z')->json('data.id');

        $this->decide($short, 'APPROVED', $this->manager)->assertOk();
        $this->assertSame('2026-10-22 09:45:00.000000', (string) DB::table('approvals')->where('id', $short)->value('expires_at'));

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:50:00', 'UTC'));
        $this->decide($late, 'APPROVED', $this->manager)->assertStatus(409)->assertJsonPath('error.details.current_status', 'EXPIRED');
        $this->read('/api/v1/approvals/'.$short, $this->manager)->assertOk()->assertJsonPath('data.effective_status', 'EXPIRED')->assertJsonPath('data.status', 'APPROVED');
        $this->read('/api/v1/approvals?status=EXPIRED', $this->manager)->assertOk()->assertJsonCount(2, 'data');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Lecture
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_gerante_voit_toutes_les_demandes_et_un_autre_compte_seulement_les_siennes(): void
    {
        [$invoice, $payment] = $this->paidInvoice();
        $mine = (string) $this->requestApproval(ApprovalSubject::paymentReversal($invoice, $payment, 10000)->toArray(), $this->cashier)->json('data.id');
        $visit = Ulid::generate();
        DB::table('visits')->insert([
            'id' => $visit, 'clinic_id' => $this->clinicId, 'patient_id' => $this->patientId, 'reason' => 'EXAM', 'occurred_at' => '2026-10-22 09:15:00.000000',
            'status' => 'AWAITING_EXAM_FEE', 'appointment_id' => null, 'exam_invoice_id' => null, 'exam_waiver_approval_id' => null, 'arrival_at' => '2026-10-22 09:15:00.000000',
            'closed_at' => null, 'administrative_note' => null, 'created_by' => $this->reception->id, 'version' => 1,
        ]);
        config(['eeo.billing.exam_fee_control' => 'billed']);
        $other = (string) $this->requestApproval(ApprovalSubject::examFeeWaiver($visit, $this->patientId)->toArray(), $this->reception)->assertCreated()->json('data.id');

        $all = $this->read('/api/v1/approvals', $this->manager)->assertOk();
        $this->assertMatchesContract($all, 'schemas/resources/billing.json#/$defs/ApprovalPage');
        $this->assertEqualsCanonicalizing([$mine, $other], array_column((array) $all->json('data'), 'id'));

        $own = $this->read('/api/v1/approvals', $this->cashier)->assertOk();
        $this->assertSame([$mine], array_column((array) $own->json('data'), 'id'));
        $this->read('/api/v1/approvals/'.$other, $this->cashier)->assertNotFound();
        $this->read('/api/v1/approvals?status=BOGUS', $this->manager)->assertStatus(422);
    }

    public function test_un_contenu_d_audit_qui_ne_reproduit_pas_l_empreinte_n_est_jamais_affiche(): void
    {
        $visit = Ulid::generate();
        $id = Ulid::generate();
        DB::table('approvals')->insert([
            'id' => $id, 'clinic_id' => $this->clinicId, 'action_code' => ExamFeeWaiver::ACTION_CODE, 'target_type' => 'visits', 'target_id' => $visit,
            'payload_hash' => str_repeat('e', 64), 'requested_by' => $this->reception->id, 'reason' => 'Fictif', 'status' => 'REQUESTED',
        ]);

        $this->read('/api/v1/approvals/'.$id, $this->manager)->assertOk()->assertJsonPath('data.subject', null)->assertJsonPath('data.kind', 'EXAM_FEE_WAIVER');
    }

    public function test_l_empreinte_d_une_dispense_est_celle_du_contrat_historique(): void
    {
        $visit = Ulid::generate();

        $this->assertSame(ExamFeeWaiver::payloadHash($visit, $this->patientId), ApprovalSubject::examFeeWaiver($visit, $this->patientId)->hash());
    }
}

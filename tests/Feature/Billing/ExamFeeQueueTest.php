<?php

namespace Tests\Feature\Billing;

use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Contrôle du paiement de l'examen branché dans la file du jour et le démarrage de l'examen (P03 avec B04 et B06 ;
 * AT05, AT06, AT21 ; EE002, EE018, EE019). Contrôle ACTIF (`billed`) : une visite d'examen arrive « en attente du
 * paiement de l'examen », passe « prête » à l'encaissement de SA facture de frais ou à la dispense accordée, revient
 * « en attente » si le règlement est contre-passé ; le marqueur dit « à encaisser », « dispense demandée »,
 * « encaissés : reçu n° … » ou « dispense approuvée », jamais « payé » ni « gratuit ». Contrôle INACTIF (défaut) :
 * rien ne change (« non contrôlé », statut ARRIVED). Données fictives.
 */
final class ExamFeeQueueTest extends TestCase
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

    private function billed(): void
    {
        config(['eeo.billing.exam_fee_control' => 'billed']);
    }

    private function arrive(string $reason = 'EXAM'): string
    {
        $id = Ulid::generate();
        $this->write('POST', '/api/v1/visits', [
            'expected_version' => null, 'visit_id' => $id, 'patient_id' => $this->patientId, 'reason' => $reason,
            'occurred_at' => '2026-10-22T09:15:00.000Z', 'appointment_id' => null, 'administrative_note' => null,
        ], $this->reception)->assertCreated();

        return $id;
    }

    /**
     * Facture de frais d'examen émise pour la visite : [identifiant, total].
     *
     * @return array{0: string, 1: int}
     */
    private function examInvoice(string $visitId): array
    {
        [$id, $total] = $this->issuedUncollectedInvoice([$this->line($this->item['exam'])], $this->cashier, ['visit_id' => $visitId]);

        return [$id, $total];
    }

    private function queue(?User $as = null): TestResponse
    {
        return $this->read('/api/v1/visits?date=2026-10-22', $as ?? $this->reception)->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    private function queued(string $visitId, ?User $as = null): array
    {
        foreach ((array) $this->queue($as)->json('data') as $visit) {
            if (is_array($visit) && ($visit['id'] ?? null) === $visitId) {
                return $visit;
            }
        }
        $this->fail('Visite absente de la file.');
    }

    private function start(string $visitId): TestResponse
    {
        return $this->actingAsFresh($this->clinician)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/visits/'.$visitId.'/consultations', [
                'expected_version' => null, 'consultation_id' => Ulid::generate(), 'visit_id' => $visitId, 'patient_id' => $this->patientId,
                'effective_at' => '2026-10-22T09:20:00.000Z', 'date_change_reason' => null, 'exam_invoice_id' => null, 'exam_waiver_approval_id' => null,
            ]);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Contrôle inactif : rien ne change
    // ------------------------------------------------------------------------------------------------------------

    public function test_par_defaut_la_visite_arrive_et_reste_non_controlee_meme_apres_un_encaissement(): void
    {
        $visit = $this->arrive();
        [$invoice, $total] = $this->examInvoice($visit);
        $this->pay($invoice, 1, $total)->assertCreated();

        $row = $this->queued($visit);
        $this->assertSame(['ARRIVED', 'NOT_CONTROLLED', null], [$row['status'], $row['exam_fee_control'], $row['exam_fee_receipt_number']]);
        $this->assertSame('ARRIVED', DB::table('visits')->where('id', $visit)->value('status'));
        $this->assertNull(DB::table('visits')->where('id', $visit)->value('exam_invoice_id'));
        $this->assertMatchesContract($this->queue(), 'schemas/resources/patients.json#/$defs/VisitPage');
        $this->read('/api/v1/auth/me', $this->reception)->assertOk()->assertJsonPath('data.clinic.exam_fee_control', 'OFF');
    }

    // ------------------------------------------------------------------------------------------------------------
    // Contrôle actif
    // ------------------------------------------------------------------------------------------------------------

    public function test_controle_actif_une_visite_d_examen_arrive_en_attente_et_un_achat_reste_arrive(): void
    {
        $this->billed();
        $exam = $this->arrive();
        $purchase = $this->arrive('DIRECT_PURCHASE');

        $this->assertSame('AWAITING_EXAM_FEE', DB::table('visits')->where('id', $exam)->value('status'));
        $this->assertSame('ARRIVED', DB::table('visits')->where('id', $purchase)->value('status'));
        $this->assertSame(['AWAITING_EXAM_FEE', 'UNPAID'], [$this->queued($exam)['status'], $this->queued($exam)['exam_fee_control']]);
        $this->assertSame('NOT_APPLICABLE', $this->queued($purchase)['exam_fee_control']);
        $this->read('/api/v1/auth/me', $this->reception)->assertOk()->assertJsonPath('data.clinic.exam_fee_control', 'BILLED');
        $this->start($exam)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
    }

    public function test_l_encaissement_de_la_facture_de_frais_rend_la_visite_prete_avec_le_numero_du_recu(): void
    {
        $this->billed();
        $visit = $this->arrive();
        [$invoice, $total] = $this->examInvoice($visit);
        $this->pay($invoice, 1, 5000)->assertCreated();
        $this->assertSame('AWAITING_EXAM_FEE', DB::table('visits')->where('id', $visit)->value('status'), 'Un acompte ne règle pas les frais.');

        $receipt = (string) $this->pay($invoice, 2, $total - 5000)->assertCreated()->json('data.receipt_number');

        $row = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($row);
        $this->assertSame(['READY_FOR_EXAM', $invoice, 2], [$row->status, $row->exam_invoice_id, (int) $row->version]);
        $queued = $this->queued($visit);
        $this->assertSame(['READY_FOR_EXAM', 'PAID', $receipt], [$queued['status'], $queued['exam_fee_control'], $queued['exam_fee_receipt_number']]);
        $this->assertMatchesContract($this->queue(), 'schemas/resources/patients.json#/$defs/VisitPage');
        $this->start($visit)->assertCreated();
    }

    public function test_le_paiement_d_une_autre_prestation_ne_rend_pas_la_visite_prete(): void
    {
        $this->billed();
        $this->seedPosition($this->item['frame'], '5');
        $this->ensureOpenCashSession($this->cashier);
        $visit = $this->arrive();
        $draft = $this->createDraft([$this->line($this->item['frame'])], $this->cashier, ['visit_id' => $visit])->assertCreated();
        $id = (string) $draft->json('data.id');
        $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, 1, 40000), $this->cashier)->assertOk();

        $this->assertSame('AWAITING_EXAM_FEE', DB::table('visits')->where('id', $visit)->value('status'));
        $this->assertSame('UNPAID', $this->queued($visit)['exam_fee_control']);
    }

    public function test_l_emission_de_la_facture_d_examen_rend_aussitot_la_visite_prete_avec_recu(): void
    {
        $this->billed();
        $this->ensureOpenCashSession($this->cashier);
        $visit = $this->arrive();
        $draft = $this->createDraft([$this->line($this->item['exam'])], $this->cashier, ['visit_id' => $visit])->assertCreated();
        $id = (string) $draft->json('data.id');

        $issued = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, 1, 15000), $this->cashier)->assertOk();
        $receipt = (string) $issued->json('data.payments.0.receipt_number');
        $this->assertSame('READY_FOR_EXAM', DB::table('visits')->where('id', $visit)->value('status'));
        $queued = $this->queued($visit);
        $this->assertSame(['READY_FOR_EXAM', 'PAID', $receipt], [$queued['status'], $queued['exam_fee_control'], $queued['exam_fee_receipt_number']]);
        $this->start($visit)->assertCreated();
    }

    public function test_une_contre_ecriture_du_reglement_ramene_la_visite_en_attente(): void
    {
        $this->billed();
        $visit = $this->arrive();
        [$invoice, $total] = $this->examInvoice($visit);
        $this->pay($invoice, 1, $total)->assertCreated();
        $this->assertSame('READY_FOR_EXAM', DB::table('visits')->where('id', $visit)->value('status'));

        $this->writeReauthenticated('POST', '/api/v1/payments/'.$this->firstPayment($invoice).'/reversals', $this->reversalBody($invoice, $this->firstPayment($invoice), 2, $total), $this->manager)->assertCreated();

        $row = DB::table('visits')->where('id', $visit)->first();
        $this->assertNotNull($row);
        $this->assertSame(['AWAITING_EXAM_FEE', null], [$row->status, $row->exam_invoice_id]);
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
    }

    public function test_la_dispense_demandee_puis_accordee_rend_la_visite_prete_et_se_consomme_au_demarrage(): void
    {
        $this->billed();
        $visit = $this->arrive();
        $subject = ApprovalSubject::examFeeWaiver($visit, $this->patientId);

        $id = (string) $this->requestApproval($subject->toArray(), $this->reception, 'Contrôle de suivi pris en charge (fictif)')->assertCreated()->json('data.id');
        $this->assertSame('WAIVER_REQUESTED', $this->queued($visit)['exam_fee_control']);
        $this->assertSame('AWAITING_EXAM_FEE', DB::table('visits')->where('id', $visit)->value('status'));

        $this->decide($id, 'APPROVED', $this->manager)->assertOk();
        $this->assertSame('READY_FOR_EXAM', DB::table('visits')->where('id', $visit)->value('status'));
        $this->assertSame(['READY_FOR_EXAM', 'WAIVED'], [$this->queued($visit)['status'], $this->queued($visit)['exam_fee_control']]);

        // Aucune dispense désignée au démarrage : celle de CETTE visite est retrouvée par son contenu exact et consommée.
        $consultation = (string) $this->start($visit)->assertCreated()->json('data.id');
        $approval = DB::table('approvals')->where('id', $id)->first();
        $this->assertNotNull($approval);
        $this->assertSame('CONSUMED', $approval->status);
        $this->assertSame($id, DB::table('visits')->where('id', $visit)->value('exam_waiver_approval_id'));
        $diff = json_decode((string) DB::table('audit_events')->where('action', 'consultation.started')->where('target_id', $consultation)->value('sanitized_diff'), true);
        $this->assertSame('WAIVED', $diff['exam_fee_control'] ?? null);
    }

    public function test_une_dispense_echue_ne_laisse_jamais_la_visite_affichee_prete(): void
    {
        $this->billed();
        $visit = $this->arrive();
        $this->approved(ApprovalSubject::examFeeWaiver($visit, $this->patientId)->toArray(), $this->reception);
        $this->assertSame('READY_FOR_EXAM', DB::table('visits')->where('id', $visit)->value('status'));

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 11:00:00', 'UTC'));

        $queued = $this->queued($visit);
        $this->assertSame(['AWAITING_EXAM_FEE', 'UNPAID'], [$queued['status'], $queued['exam_fee_control']]);
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
    }

    public function test_une_dispense_ne_se_demande_pas_sans_controle_actif_ni_pour_un_achat(): void
    {
        $visit = $this->arrive();
        $this->requestApproval(ApprovalSubject::examFeeWaiver($visit, $this->patientId)->toArray(), $this->reception)
            ->assertStatus(409)->assertJsonPath('error.details.current_status', 'NOT_CONTROLLED');

        $this->billed();
        $purchase = $this->arrive('DIRECT_PURCHASE');
        $this->requestApproval(ApprovalSubject::examFeeWaiver($purchase, $this->patientId)->toArray(), $this->reception)->assertStatus(422);
        $this->assertSame(0, DB::table('approvals')->count());
    }

    public function test_une_dispense_d_une_autre_visite_ne_debloque_pas_celle_ci(): void
    {
        $this->billed();
        $other = $this->arrive();
        $visit = $this->arrive();
        $this->approved(ApprovalSubject::examFeeWaiver($other, $this->patientId)->toArray(), $this->reception);

        $this->assertSame('AWAITING_EXAM_FEE', DB::table('visits')->where('id', $visit)->value('status'));
        $this->start($visit)->assertStatus(422)->assertJsonPath('error.code', 'EXAM_PAYMENT_REQUIRED');
        $this->start($other)->assertCreated();
    }
}

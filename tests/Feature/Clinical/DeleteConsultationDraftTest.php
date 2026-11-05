<?php

namespace Tests\Feature\Clinical;

use App\Application\Command;
use App\Application\Locking\TransactionLocks;
use App\Domain\Clinical\Handlers\DeleteConsultationDraftHandler;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ClinicalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Suppression d'un examen resté BROUILLON (demande du cabinet : « uniquement en brouillon pour l'instant ») sur MySQL
 * réel : la règle est appliquée par le serveur (examen en cours ou terminé : 409, rien ne change), l'auteur ou la gérante
 * seulement, la visite revient à son état d'avant l'examen et peut le redémarrer, les prescriptions brouillon de l'examen
 * disparaissent avec lui alors qu'une prescription validée, un contrôle recommandé ou une rubrique enregistrée l'en
 * empêchent, audit sans contenu clinique, pierre tombale au journal des changements, rejeu idempotent, isolation des
 * cabinets. Données fictives.
 */
final class DeleteConsultationDraftTest extends TestCase
{
    use ClinicalFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootClinical();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function deleteDraft(string $consultationId, array $overrides = [], ?User $as = null, ?string $key = null, ?string $pathId = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->clinician)
            ->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->postJson('/api/v1/consultations/'.($pathId ?? $consultationId).'/delete', array_merge([
                'expected_version' => 1,
                'consultation_id' => $consultationId,
            ], $overrides));
    }

    private function visitRow(string $visitId): \stdClass
    {
        $row = DB::table('visits')->where('id', $visitId)->first();
        $this->assertNotNull($row);

        return $row;
    }

    public function test_un_brouillon_se_supprime_et_la_visite_revient_a_l_etat_d_avant(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        $this->assertSame(['IN_CONSULTATION', 2], [$this->visitRow($visitId)->status, (int) $this->visitRow($visitId)->version]);

        $response = $this->deleteDraft($consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/DeleteConsultationDraftResponse');
        $response->assertJsonPath('data.consultation_id', $consultationId)
            ->assertJsonPath('data.visit_id', $visitId)
            ->assertJsonPath('data.visit_status', 'ARRIVED')
            ->assertJsonPath('data.visit_version', 3);
        $this->assertFalse(DB::table('consultations')->where('id', $consultationId)->exists());
        $visit = $this->visitRow($visitId);
        $this->assertSame(['ARRIVED', 3, null], [$visit->status, (int) $visit->version, $visit->closed_at]);

        // L'examen de cette visite n'existe plus, la lecture répond 404 et la liste ne le montre plus.
        $this->readConsultation($consultationId)->assertNotFound();
        $this->assertNotContains($consultationId, array_column((array) $this->actingAsFresh($this->clinician)->getJson('/api/v1/consultations')->assertOk()->json('data'), 'id'));
    }

    public function test_la_suppression_est_auditee_et_publiee_comme_pierre_tombale_sans_contenu_clinique(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        $draft = $this->draftPrescription($consultationId, ['notes' => 'SENTINELLE-CLINIQUE-RX']);

        $this->deleteDraft($consultationId)->assertOk();

        $audit = DB::table('audit_events')->where('action', 'consultation.deleted')->where('target_id', $consultationId)->first();
        $this->assertNotNull($audit, 'La suppression est tracée : qui, quand, quelle consultation.');
        $this->assertSame($this->clinician->id, $audit->actor_id);
        $this->assertSame('consultations', $audit->target_type);
        $diff = json_decode((string) $audit->sanitized_diff, true, 512, JSON_THROW_ON_ERROR);
        $this->assertEquals(
            ['visit_id' => $visitId, 'patient_id' => $this->patientId, 'clinician_id' => $this->clinician->id, 'previous_status' => 'DRAFT', 'version' => 1, 'deleted_prescription_drafts' => 1, 'visit_status' => 'ARRIVED'],
            $diff,
        );

        $tombstone = DB::table('sync_change_log')->where('entity_type', 'consultations')->where('entity_id', $consultationId)->orderByDesc('change_sequence')->first();
        $this->assertNotNull($tombstone);
        $this->assertSame(['ARCHIVED', 2, 'CLINICAL'], [$tombstone->change_kind, (int) $tombstone->entity_version, $tombstone->visibility]);
        $visitChange = DB::table('sync_change_log')->where('entity_type', 'visits')->where('entity_id', $visitId)->orderByDesc('change_sequence')->first();
        $this->assertNotNull($visitChange);
        $this->assertSame(['UPDATED', 3], [$visitChange->change_kind, (int) $visitChange->entity_version]);

        $this->assertStringNotContainsString('SENTINELLE-CLINIQUE-RX', $this->sideEffectsDump(), 'Aucune valeur clinique dans l\'audit, l\'outbox, le journal des changements ni les clés d\'idempotence.');
        $this->assertFalse(DB::table('optical_prescriptions')->where('id', $draft['id'])->exists());
    }

    public function test_l_examen_peut_etre_redemarre_apres_la_suppression(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        $this->startConsultation($visitId)->assertStatus(409);

        $this->deleteDraft($consultationId)->assertOk();
        $body = $this->startBody($visitId);
        $this->startConsultation($visitId, $body)->assertCreated()->assertJsonPath('data.status', 'DRAFT');

        $this->assertSame('IN_CONSULTATION', $this->visitRow($visitId)->status);
        $this->assertSame(1, DB::table('consultations')->where('visit_id', $visitId)->count());
    }

    public function test_les_prescriptions_brouillon_de_l_examen_disparaissent_avec_lui(): void
    {
        [, $consultationId] = $this->startedExam();
        $draft = $this->draftPrescription($consultationId);
        $this->assertSame(2, DB::table('optical_prescription_eyes')->where('prescription_id', $draft['id'])->count());

        $this->deleteDraft($consultationId)->assertOk();

        $this->assertSame(0, DB::table('optical_prescriptions')->where('consultation_id', $consultationId)->count());
        $this->assertSame(0, DB::table('optical_prescription_eyes')->where('prescription_id', $draft['id'])->count());
        $this->assertSame(0, DB::table('optical_prescription_treatments')->where('prescription_id', $draft['id'])->count());
    }

    public function test_une_prescription_validee_empeche_la_suppression(): void
    {
        [, $consultationId] = $this->startedExam();
        $validated = $this->validatedPrescription($consultationId);
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
        $this->assertSame('VALIDATED', DB::table('optical_prescriptions')->where('id', $validated['id'])->value('status'));
        $this->assertSame($before, $this->clinicalEffectCounts(), 'Un refus ne laisse aucun effet.');
    }

    public function test_un_controle_recommande_programme_empeche_la_suppression(): void
    {
        [, $consultationId] = $this->startedExam();
        DB::table('follow_up_plans')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'consultation_id' => $consultationId, 'patient_id' => $this->patientId,
            'reason' => 'ROUTINE', 'anchor_kind' => 'CONSULTATION', 'anchor_date' => '2026-10-22', 'interval_value' => 3, 'interval_unit' => 'MONTH',
            'recommended_date' => '2027-01-22', 'date_origin' => 'CALCULATED', 'manual_reason' => null, 'reminder_enabled' => 1,
            'preferred_channel' => 'CALL', 'advance_value' => 7, 'advance_unit' => 'DAY', 'notes' => null, 'status' => 'ACTIVE', 'version' => 1,
            'created_at' => '2026-10-22 09:30:00.000000', 'updated_at' => '2026-10-22 09:30:00.000000',
        ]);
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_une_rubrique_enregistree_sous_un_brouillon_empeche_la_suppression(): void
    {
        [, $consultationId] = $this->startedExam();
        $this->saveCurrent($consultationId, 'ANAMNESIS', $this->anamnesis(['symptoms' => 'Gêne en lecture (fictif)', 'complaints' => [$this->term('VISION_DECLINE')]]))->assertOk();
        // État incohérent forcé : l'examen est redevenu « brouillon » alors qu'une rubrique est enregistrée.
        DB::table('consultations')->where('id', $consultationId)->update(['status' => 'DRAFT']);
        $before = $this->clinicalEffectCounts();
        $version = (int) DB::table('consultations')->where('id', $consultationId)->value('version');

        $this->deleteDraft($consultationId, ['expected_version' => $version])->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_un_examen_en_cours_ne_se_supprime_pas(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        $this->saveCurrent($consultationId, 'ANAMNESIS', $this->anamnesis(['symptoms' => 'Gêne en lecture (fictif)']))->assertOk();
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, ['expected_version' => 2])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.current_status', 'IN_PROGRESS');

        $this->assertSame('IN_PROGRESS', DB::table('consultations')->where('id', $consultationId)->value('status'));
        $this->assertSame('IN_CONSULTATION', $this->visitRow($visitId)->status);
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_un_examen_termine_ne_se_supprime_jamais_et_le_serveur_le_refuse(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        DB::table('consultations')->where('id', $consultationId)->update(['status' => 'COMPLETED', 'current_revision' => 1, 'completed_at' => '2026-10-22 09:40:00.000000', 'version' => 3]);
        DB::table('visits')->where('id', $visitId)->update(['status' => 'COMPLETED', 'closed_at' => '2026-10-22 09:40:00.000000']);
        $before = $this->clinicalEffectCounts();

        foreach ([$this->clinician, $this->manager] as $user) {
            $this->deleteDraft($consultationId, ['expected_version' => 3], $user)
                ->assertStatus(409)
                ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
                ->assertJsonPath('error.details.current_status', 'COMPLETED');
        }

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_la_gerante_supprime_le_brouillon_d_un_autre_professionnel_pas_un_autre_professionnel(): void
    {
        [, $consultationId] = $this->startedExam();
        $other = $this->makeStaff($this->clinicId, 'CLINICIAN', 'pro2.test');
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, [], $other)
            ->assertForbidden()
            ->assertJsonPath('error.code', 'ACTION_FORBIDDEN');
        $this->assertSame($before, $this->clinicalEffectCounts());
        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());

        $this->deleteDraft($consultationId, [], $this->manager)->assertOk();
        $this->assertFalse(DB::table('consultations')->where('id', $consultationId)->exists());
        $audit = DB::table('audit_events')->where('action', 'consultation.deleted')->where('target_id', $consultationId)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->manager->id, $audit->actor_id, 'L\'audit nomme le compte qui a supprimé, pas l\'auteur du brouillon.');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function accountsWithoutClinicalWrite(): array
    {
        return ['accueil' => ['reception'], 'caisse' => ['cashier']];
    }

    #[DataProvider('accountsWithoutClinicalWrite')]
    public function test_l_accueil_et_la_caisse_ne_suppriment_pas_un_examen(string $account): void
    {
        [, $consultationId] = $this->startedExam();
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, [], $this->{$account})->assertForbidden();

        $this->assertSame($before, $this->clinicalEffectCounts());
        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
    }

    public function test_une_derogation_qui_retire_l_ecriture_clinique_interdit_la_suppression(): void
    {
        [, $consultationId] = $this->startedExam();
        $this->denyPermission($this->clinician, 'clinical.write');

        $this->deleteDraft($consultationId)->assertForbidden();

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
    }

    public function test_une_version_perimee_repond_conflit_avec_la_version_actuelle(): void
    {
        [, $consultationId] = $this->startedExam();
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, ['expected_version' => 7])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'VERSION_CONFLICT')
            ->assertJsonPath('error.details.current_version', 1);

        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_le_corps_doit_porter_la_version_et_l_identifiant_de_l_adresse(): void
    {
        [, $consultationId] = $this->startedExam();
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, ['consultation_id' => Ulid::generate()])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->actingAsFresh($this->clinician)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/consultations/'.$consultationId.'/delete', ['consultation_id' => $consultationId])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->deleteDraft($consultationId, ['expected_version' => 0])->assertStatus(422);

        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_une_suppression_sans_cle_d_idempotence_est_refusee(): void
    {
        [, $consultationId] = $this->startedExam();

        // Les en-têtes d'un test persistent d'une requête à l'autre : celui de la clé est retiré explicitement.
        $this->actingAsFresh($this->clinician)
            ->withoutHeader('Idempotency-Key')
            ->postJson('/api/v1/consultations/'.$consultationId.'/delete', ['expected_version' => 1, 'consultation_id' => $consultationId])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED');

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
    }

    public function test_le_rejeu_de_la_meme_cle_rend_la_reponse_d_origine_sans_second_effet(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        $key = Ulid::generate();

        $first = $this->deleteDraft($consultationId, [], null, $key)->assertOk();
        $second = $this->deleteDraft($consultationId, [], null, $key)->assertOk();

        $this->assertEquals($first->json('data'), $second->json('data'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'consultation.deleted')->count());
        $this->assertSame(1, DB::table('sync_change_log')->where('entity_type', 'consultations')->where('entity_id', $consultationId)->where('change_kind', 'ARCHIVED')->count());
        $this->assertSame(3, (int) $this->visitRow($visitId)->version, 'La visite n\'est pas réécrite une seconde fois.');
    }

    public function test_une_consultation_deja_supprimee_ou_inconnue_repond_introuvable(): void
    {
        [, $consultationId] = $this->startedExam();
        $this->deleteDraft($consultationId)->assertOk();

        $this->deleteDraft($consultationId)->assertNotFound();
        $unknown = Ulid::generate();
        $this->deleteDraft($unknown)->assertNotFound();
        $this->actingAsFresh($this->clinician)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/consultations/pas-un-identifiant/delete', ['expected_version' => 1, 'consultation_id' => 'pas-un-identifiant'])
            ->assertNotFound();
    }

    public function test_une_consultation_d_un_autre_cabinet_repond_introuvable(): void
    {
        [, $consultationId] = $this->startedExam();
        $clinicB = $this->makeClinic('TEST CABINET B');
        $foreign = $this->makeStaff($clinicB, 'MANAGER', 'gerante.b');
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId, [], $foreign)->assertNotFound();

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_une_visite_qui_n_est_plus_en_consultation_empeche_la_suppression(): void
    {
        [$visitId, $consultationId] = $this->startedExam();
        DB::table('visits')->where('id', $visitId)->update(['status' => 'ARRIVED']);
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft($consultationId)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_la_suppression_n_est_ouverte_qu_en_ligne(): void
    {
        [, $consultationId] = $this->startedExam();
        $payload = ['consultation_id' => $consultationId];

        foreach ([CommandContext::job($this->clinicId, 'test', 'corr-test', CarbonImmutable::now('UTC')), $this->syncContextFor($this->clinician)] as $context) {
            try {
                $this->app->make(DeleteConsultationDraftHandler::class)->handle(new Command('DeleteConsultationDraft', $payload, $consultationId, 1), $context, new TransactionLocks($this->clinicId), null);
                $this->fail('Une source autre que la route directe devait être refusée.');
            } catch (BusinessError $error) {
                $this->assertSame('ACTION_FORBIDDEN', $error->errorCode);
            }
        }
        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
    }

    public function test_le_module_des_consultations_ferme_repond_introuvable(): void
    {
        [, $consultationId] = $this->startedExam();
        config(['eeo.enabled_modules' => ['today', 'patients']]);

        $this->deleteDraft($consultationId)->assertNotFound();

        $this->assertTrue(DB::table('consultations')->where('id', $consultationId)->exists());
    }
}

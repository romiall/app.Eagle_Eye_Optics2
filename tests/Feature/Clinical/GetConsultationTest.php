<?php

namespace Tests\Feature\Clinical;

use App\Domain\Clinical\ClinicalReadAudit;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ClinicalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Lecture d'une consultation (C01, AT02) : format `AllSteps` relu dans les tables vivantes, rubriques pas encore
 * ouvertes rendues vides, séparation identité / clinique (accueil et caisse : 403 même pour une consultation
 * existante), isolation des cabinets (404), module fermé (404), audit de lecture sans contenu et limité à un
 * événement par compte et par consultation toutes les 10 minutes. Données fictives.
 */
final class GetConsultationTest extends TestCase
{
    use ClinicalFixtures;
    use MigratedDatabase;

    private string $visitId;

    private string $consultationId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootClinical();
        [$this->visitId, $this->consultationId] = $this->startedExam();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function viewedCount(?string $actorId = null): int
    {
        $query = DB::table('audit_events')->where('action', 'consultation.viewed')->where('target_id', $this->consultationId);
        if ($actorId !== null) {
            $query->where('actor_id', $actorId);
        }

        return $query->count();
    }

    public function test_la_consultation_se_relit_au_format_all_steps_conforme_au_contrat(): void
    {
        $this->saveCurrent($this->consultationId, 'ANAMNESIS', $this->anamnesis(['symptoms' => 'Relu', 'wears_glasses' => true, 'complaints' => [$this->term('PAIN')]]))->assertOk();
        $this->saveCurrent($this->consultationId, 'HISTORIES', ['histories' => [$this->history('OCULAR_HISTORY', true)]])->assertOk();
        $this->saveCurrent($this->consultationId, 'CONCLUSION', $this->conclusion(['conclusion' => 'Fin', 'referral' => false]))->assertOk();

        $response = $this->readConsultation($this->consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $response->assertJsonPath('data.id', $this->consultationId)
            ->assertJsonPath('data.visit_id', $this->visitId)
            ->assertJsonPath('data.clinician_id', $this->clinician->id)
            ->assertJsonPath('data.status', 'IN_PROGRESS')
            ->assertJsonPath('data.version', 4)
            ->assertJsonPath('data.steps.ANAMNESIS.symptoms', 'Relu')
            ->assertJsonPath('data.steps.HISTORIES.histories.0.known_none', true)
            ->assertJsonPath('data.steps.CONCLUSION.referral', false)
            ->assertJsonPath('data.revisions', []);
        $this->assertSame('no-store, private', $response->headers->get('Cache-Control'));
    }

    public function test_les_rubriques_sans_saisie_sont_rendues_vides_et_conformes(): void
    {
        $steps = $this->readConsultation($this->consultationId)->assertOk()->json('data.steps');

        $this->assertSame(['acuities' => []], $steps['VISUAL_ACUITY']);
        $this->assertSame(['measurements' => [], 'refraction_observations' => null, 'ametropias' => []], $steps['REFRACTION']);
        $this->assertSame(['centering_id' => null, 'pd_total' => null, 'pd_od' => null, 'pd_og' => null, 'inconsistency_reason' => null], $steps['CENTERING']);
        $this->assertSame(['orders' => []], $steps['MEDICATIONS']);
    }

    public function test_la_consultation_porte_l_identite_administrative_de_base_et_la_profession_du_patient(): void
    {
        DB::table('patient_records')->where('id', $this->patientId)->update(['profession' => 'Enseignante']);
        $response = $this->readConsultation($this->consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $patient = DB::table('patient_records')->where('id', $this->patientId)->first();
        $this->assertNotNull($patient);
        $this->assertSame($this->patientId, $response->json('data.patient.id'));
        $this->assertSame($patient->record_number, $response->json('data.patient.record_number'));
        $this->assertSame($patient->last_name, $response->json('data.patient.last_name'));
        $this->assertSame('Enseignante', $response->json('data.patient.profession'));
        $this->assertSame(['id', 'record_number', 'last_name', 'first_names', 'sex', 'birth_date', 'profession'], array_keys($response->json('data.patient')), 'Identité de base et profession seulement : aucune coordonnée, aucun état clinique.');
    }

    public function test_une_profession_non_renseignee_est_rendue_nulle(): void
    {
        DB::table('patient_records')->where('id', $this->patientId)->update(['profession' => null]);

        $response = $this->readConsultation($this->consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $this->assertNull($response->json('data.patient.profession'));
    }

    public function test_les_lignes_deja_presentes_des_rubriques_hors_chemin_sont_lues_telles_quelles(): void
    {
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
        $scaleId = Ulid::generate();
        DB::table('visual_acuity_scales')->insert(['id' => $scaleId, 'clinic_id' => $this->clinicId, 'code' => 'LIBRE', 'label' => 'Saisie libre', 'active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $acuity = ['clinic_id' => $this->clinicId, 'consultation_id' => $this->consultationId, 'scale_id' => $scaleId, 'created_at' => $now, 'updated_at' => $now];
        DB::table('visual_acuities')->insert([
            $acuity + ['id' => Ulid::generate(), 'context' => 'POST_REFRACTION', 'distance' => 'UNSPECIFIED', 'correction' => 'WITH', 'eye' => 'OU', 'raw_value' => '10/10', 'normalized_value' => null],
            $acuity + ['id' => Ulid::generate(), 'context' => 'PRELIMINARY', 'distance' => 'FAR', 'correction' => 'WITHOUT', 'eye' => 'OG', 'raw_value' => '0', 'normalized_value' => null],
            $acuity + ['id' => Ulid::generate(), 'context' => 'PRELIMINARY', 'distance' => 'FAR', 'correction' => 'WITHOUT', 'eye' => 'OD', 'raw_value' => '8/10', 'normalized_value' => '0.8'],
        ]);
        $measure = ['clinic_id' => $this->clinicId, 'consultation_id' => $this->consultationId, 'created_at' => $now, 'updated_at' => $now];
        DB::table('refraction_measurements')->insert([
            $measure + ['id' => Ulid::generate(), 'stage' => 'SUBJECTIVE', 'eye' => 'OG', 'sphere' => '0', 'cylinder' => null, 'axis' => null, 'addition' => '2'],
            $measure + ['id' => Ulid::generate(), 'stage' => 'AUTOREFRACTOR', 'eye' => 'OD', 'sphere' => '-1.25', 'cylinder' => '-0.5', 'axis' => 90, 'addition' => null],
        ]);
        $centeringId = Ulid::generate();
        DB::table('autorefractor_centering')->insert($measure + ['id' => $centeringId, 'pd_total' => '62', 'pd_od' => '31', 'pd_og' => null, 'inconsistency_reason' => null]);

        $response = $this->readConsultation($this->consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $steps = $response->json('data.steps');
        // Ordre du dossier : préliminaires avant post-réfraction, loin avant près, œil droit avant œil gauche.
        $this->assertSame(['8/10', '0', '10/10'], array_column($steps['VISUAL_ACUITY']['acuities'], 'raw_value'));
        $this->assertSame('0.8000', $steps['VISUAL_ACUITY']['acuities'][0]['normalized_value']);
        $this->assertSame([['AUTOREFRACTOR', 'OD', '-1.25', '-0.50', 90, null], ['SUBJECTIVE', 'OG', '0.00', null, null, '2.00']], array_map(
            static fn (array $m): array => [$m['stage'], $m['eye'], $m['sphere'], $m['cylinder'], $m['axis'], $m['addition']],
            $steps['REFRACTION']['measurements'],
        ));
        $this->assertSame(['centering_id' => $centeringId, 'pd_total' => '62.00', 'pd_od' => '31.00', 'pd_og' => null, 'inconsistency_reason' => null], $steps['CENTERING']);
    }

    public function test_les_revisions_sont_rendues_sans_leur_snapshot(): void
    {
        $revisionId = Ulid::generate();
        DB::table('clinical_revisions')->insert([
            'id' => $revisionId, 'clinic_id' => $this->clinicId, 'consultation_id' => $this->consultationId, 'revision_no' => 1,
            'snapshot' => '{"secret":"SENTINELLE-SNAPSHOT-RT5"}', 'reason' => 'Finalisation', 'author_id' => $this->clinician->id,
            'recorded_at' => '2026-10-22 09:35:00.123456', 'previous_revision_id' => null, 'sha256' => str_repeat('a', 64),
            'created_at' => '2026-10-22 09:35:00.000000', 'updated_at' => '2026-10-22 09:35:00.000000',
        ]);

        $response = $this->readConsultation($this->consultationId)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $this->assertSame([[
            'id' => $revisionId, 'revision_no' => 1, 'recorded_at' => '2026-10-22T09:35:00.123Z', 'author_id' => $this->clinician->id,
            'reason' => 'Finalisation', 'previous_revision_id' => null, 'sha256' => str_repeat('a', 64),
        ]], $response->json('data.revisions'));
        $this->assertStringNotContainsString('SENTINELLE-SNAPSHOT-RT5', (string) $response->getContent());
    }

    /**
     * @return array<string, array{0: string, 1: int}>
     */
    public static function roles(): array
    {
        return ['gérante' => ['MANAGER', 200], 'professionnel' => ['CLINICIAN', 200], 'accueil' => ['RECEPTION', 403], 'caisse' => ['CASHIER', 403]];
    }

    #[DataProvider('roles')]
    public function test_l_accueil_et_la_caisse_n_ont_aucun_acces_clinique_meme_a_une_consultation_existante(string $role, int $status): void
    {
        $user = $this->makeStaff($this->clinicId, $role);

        $existing = $this->readConsultation($this->consultationId, $user);
        $unknown = $this->readConsultation(Ulid::generate(), $user);

        $existing->assertStatus($status);
        $this->assertSame($status === 200 ? 404 : 403, $unknown->status(), 'Le refus clinique ne dit pas si la consultation existe.');
        if ($status === 403) {
            $existing->assertJsonPath('error.code', 'ACTION_FORBIDDEN');
            $this->assertMatchesContract($existing, 'schemas/error.json');
            $this->assertStringNotContainsString($this->consultationId, (string) $existing->getContent());
            $this->assertSame(0, $this->viewedCount($user->id), 'Un refus n\'est pas une lecture.');
        }
    }

    public function test_une_consultation_inconnue_ou_d_un_autre_cabinet_repond_introuvable(): void
    {
        $otherClinic = $this->makeClinic();
        $otherClinician = $this->makeStaff($otherClinic, 'CLINICIAN', 'autre.pro.lecture');
        $otherPatient = $this->seedPatient($otherClinic);
        $otherVisit = $this->seedVisit([], $otherClinic, $otherPatient);
        $foreignId = Ulid::generate();
        $this->startConsultation($otherVisit, [...$this->startBody($otherVisit, ['consultation_id' => $foreignId]), 'patient_id' => $otherPatient], $otherClinician)->assertCreated();

        $this->readConsultation($foreignId)->assertNotFound();
        $this->readConsultation(Ulid::generate())->assertNotFound();
        $this->actingAsFresh($this->clinician)->getJson('/api/v1/consultations/pas-un-ulid')->assertNotFound();
        // Les refus ne laissent aucune trace de lecture ; la seule est celle du démarrage par son auteur légitime (la
        // réponse d'une écriture qui rend le dossier est tracée comme une lecture, voir ClinicalReadAudit).
        $foreignViews = DB::table('audit_events')->where('action', 'consultation.viewed')->where('target_id', $foreignId);
        $this->assertSame(0, (clone $foreignViews)->where('actor_id', $this->clinician->id)->count());
        $this->assertSame([$otherClinician->id], (clone $foreignViews)->pluck('actor_id')->all());
        // L'auteur légitime, lui, la lit.
        $this->readConsultation($foreignId, $otherClinician)->assertOk();
    }

    public function test_un_module_ferme_repond_404_meme_pour_une_gerante(): void
    {
        config(['eeo.enabled_modules' => ['today', 'patients']]);

        $this->readConsultation($this->consultationId, $this->manager)->assertNotFound();
        $this->readConsultation($this->consultationId, $this->cashier)->assertNotFound();
    }

    public function test_sans_connexion_401(): void
    {
        $this->flushSession();
        $this->nextRequest()->getJson('/api/v1/consultations/'.$this->consultationId)->assertStatus(401);
    }

    public function test_le_droit_de_lire_retire_par_derogation_refuse_la_lecture(): void
    {
        $this->denyPermission($this->clinician, 'clinical.read');
        // Le démarrage a déjà tracé une lecture de ce compte : au-delà de l'intervalle, une lecture réussie en
        // ajouterait une seconde ; le refus, lui, n'en ajoute aucune.
        $this->assertSame(1, $this->viewedCount($this->clinician->id));
        CarbonImmutable::setTestNow(CarbonImmutable::now('UTC')->addMinutes(ClinicalReadAudit::INTERVAL_MINUTES + 1));

        $this->readConsultation($this->consultationId)->assertStatus(403);
        $this->assertSame(1, $this->viewedCount($this->clinician->id), 'Un refus n\'est pas une lecture.');
    }

    public function test_la_lecture_est_tracee_sans_contenu_et_au_plus_une_fois_par_compte_et_par_intervalle(): void
    {
        $this->saveCurrent($this->consultationId, 'ANAMNESIS', $this->anamnesis(['symptoms' => 'SENTINELLE-LECTURE-JN1']))->assertOk();

        $this->readConsultation($this->consultationId)->assertOk();
        $this->readConsultation($this->consultationId)->assertOk();
        $this->assertSame(1, $this->viewedCount($this->clinician->id), 'Deux ouvertures rapprochées : un seul événement.');

        // Un autre compte a sa propre trace.
        $this->readConsultation($this->consultationId, $this->manager)->assertOk();
        $this->assertSame(1, $this->viewedCount($this->manager->id));

        // Juste avant la fin de l'intervalle : toujours un seul événement ; juste après : un nouvel événement.
        CarbonImmutable::setTestNow(CarbonImmutable::now('UTC')->addMinutes(9)->addSeconds(30));
        $this->readConsultation($this->consultationId)->assertOk();
        $this->assertSame(1, $this->viewedCount($this->clinician->id));
        CarbonImmutable::setTestNow(CarbonImmutable::now('UTC')->addMinutes(1));
        $this->readConsultation($this->consultationId)->assertOk();
        $this->assertSame(2, $this->viewedCount($this->clinician->id));

        $event = DB::table('audit_events')->where('action', 'consultation.viewed')->where('actor_id', $this->clinician->id)->first();
        $this->assertNotNull($event);
        $this->assertSame('consultations', $event->target_type);
        $this->assertNull($event->sanitized_diff, 'Aucun contenu dans l\'audit de lecture.');
        $this->assertNull($event->reason);
        $this->assertStringNotContainsString('SENTINELLE-LECTURE-JN1', $this->sideEffectsDump());
    }

    public function test_les_reponses_des_ecritures_rendent_le_dossier_donc_sont_tracees_comme_des_lectures(): void
    {
        // Démarrer l'examen a rendu le dossier complet au professionnel : une lecture tracée (une fois par intervalle).
        $this->assertSame(1, $this->viewedCount($this->clinician->id));
        $this->assertSame(0, $this->viewedCount($this->manager->id));

        // La gérante qui connaît l'identifiant et la version (obtenue par un 409) ne contourne pas la trace par une
        // écriture sans effet : sa réponse rend tout le dossier, elle est donc tracée.
        $data = $this->conclusion(['conclusion' => 'Conclusion fictive']);
        $this->saveStep($this->consultationId, 'CONCLUSION', $data, 1)->assertOk();
        $this->saveStep($this->consultationId, 'CONCLUSION', $data, 2, $this->manager)->assertOk()->assertJsonPath('data.version', 2);
        $this->assertSame(1, $this->viewedCount($this->manager->id));
    }

    public function test_la_lecture_ne_modifie_rien(): void
    {
        $before = [DB::table('consultations')->where('id', $this->consultationId)->first(), DB::table('sync_change_log')->count(), DB::table('outbox_events')->count()];

        $this->readConsultation($this->consultationId)->assertOk();

        $this->assertEquals($before[0], DB::table('consultations')->where('id', $this->consultationId)->first());
        $this->assertSame($before[1], DB::table('sync_change_log')->count());
        $this->assertSame($before[2], DB::table('outbox_events')->count());
    }

    public function test_si_l_ecriture_de_l_audit_echoue_la_lecture_echoue_et_ne_rend_aucune_donnee(): void
    {
        $this->saveCurrent($this->consultationId, 'ANAMNESIS', $this->anamnesis(['symptoms' => 'SENTINELLE-AUDIT-EN-ECHEC-ZP4']))->assertOk();
        // Plus de dix minutes plus tard : une nouvelle trace est due, et son écriture échoue.
        CarbonImmutable::setTestNow(CarbonImmutable::now('UTC')->addMinutes(11));
        DB::listen(static function (object $query): void {
            if (str_contains((string) $query->sql, 'insert into `audit_events`')) {
                throw new \RuntimeException('Échec injecté de l\'écriture de l\'audit.');
            }
        });

        $response = $this->readConsultation($this->consultationId);

        $response->assertStatus(500);
        $this->assertStringNotContainsString('SENTINELLE-AUDIT-EN-ECHEC-ZP4', (string) $response->getContent(), 'Un dossier ne se lit pas sans trace : rien n\'est rendu.');
    }

    public function test_la_lecture_est_limitee_en_debit_par_compte(): void
    {
        config(['eeo.rate_limits.consultation_read' => 3]);

        foreach ([1, 2, 3] as $attempt) {
            $this->readConsultation($this->consultationId)->assertOk();
        }
        $this->readConsultation($this->consultationId)->assertStatus(429)->assertJsonPath('error.code', 'RATE_LIMITED');
        // La limite est PAR COMPTE : un autre compte clinique lit encore.
        $this->readConsultation($this->consultationId, $this->manager)->assertOk();
    }
}

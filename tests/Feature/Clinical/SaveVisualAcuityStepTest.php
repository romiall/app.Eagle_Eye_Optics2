<?php

namespace Tests\Feature\Clinical;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ClinicalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Rubrique VISUAL_ACUITY (C02, AT18, EE006) : acuités de loin et de près, sans et avec correction, par œil, puis
 * acuité après correction. Une valeur non mesurée n'a pas de ligne ; la valeur lue est conservée telle que saisie
 * (« 10/10 », « P2 », « CLD », « 0 ») ; aucune conversion entre échelles n'est calculée (Q06). Données fictives.
 */
final class SaveVisualAcuityStepTest extends TestCase
{
    use ClinicalFixtures;
    use MigratedDatabase;

    private string $consultationId;

    private string $scaleId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootClinical();
        [, $this->consultationId] = $this->startedExam();
        $this->scaleId = $this->seedScale();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @param  list<array<string, mixed>>  $acuities
     * @return array<string, mixed>
     */
    private function data(array $acuities): array
    {
        return ['acuities' => $acuities];
    }

    public function test_les_acuites_sont_enregistrees_conservees_telles_que_saisies_et_relues_dans_l_ordre_du_dossier(): void
    {
        $rows = [
            $this->acuity($this->scaleId, '10/10', 'UNSPECIFIED', 'WITH', 'OU', 'POST_REFRACTION'),
            $this->acuity($this->scaleId, 'P2', 'NEAR', 'WITHOUT', 'OG'),
            $this->acuity($this->scaleId, '0', 'FAR', 'WITHOUT', 'OG'),
            $this->acuity($this->scaleId, 'CLD', 'FAR', 'WITHOUT', 'OD'),
        ];

        $saved = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data($rows))->assertOk();

        $this->assertMatchesContract($saved, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $read = $saved->json('data.steps.VISUAL_ACUITY.acuities');
        // Préliminaires avant post-réfraction, loin avant près, œil droit avant œil gauche.
        $this->assertSame(['CLD', '0', 'P2', '10/10'], array_column($read, 'raw_value'));
        $this->assertSame([null, null, null, null], array_column($read, 'normalized_value'), 'Aucune conversion entre échelles n\'est calculée.');
        $this->assertSame(4, DB::table('visual_acuities')->where('consultation_id', $this->consultationId)->count());
        $this->assertSame('0', DB::table('visual_acuities')->where('id', $rows[2]['id'])->value('raw_value'), 'Zéro est une valeur lue, distincte de « non mesuré ».');
        $this->assertSame(2, (int) DB::table('consultations')->where('id', $this->consultationId)->value('version'));
    }

    public function test_une_valeur_non_mesuree_n_a_pas_de_ligne_et_retirer_une_ligne_la_supprime(): void
    {
        $od = $this->acuity($this->scaleId, '8/10');
        $og = $this->acuity($this->scaleId, '9/10', 'FAR', 'WITHOUT', 'OG');
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$od, $og]))->assertOk();

        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$od]))->assertOk();

        $this->assertSame([$od['id']], DB::table('visual_acuities')->where('consultation_id', $this->consultationId)->pluck('id')->all());
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([]))->assertOk();
        $this->assertSame(0, DB::table('visual_acuities')->where('consultation_id', $this->consultationId)->count());
    }

    public function test_une_valeur_modifiee_garde_son_identifiant_et_un_enregistrement_identique_ne_change_rien(): void
    {
        $row = $this->acuity($this->scaleId, '8/10');
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]))->assertOk();
        $before = DB::table('consultations')->where('id', $this->consultationId)->first();

        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]))->assertOk();
        $this->assertEquals($before->version, DB::table('consultations')->where('id', $this->consultationId)->value('version'), 'Un enregistrement sans effet ne change pas la version.');

        $row['raw_value'] = '9/10';
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]))->assertOk();
        $this->assertSame('9/10', DB::table('visual_acuities')->where('id', $row['id'])->value('raw_value'));
        $this->assertSame(1, DB::table('visual_acuities')->where('consultation_id', $this->consultationId)->count());
    }

    public function test_deux_lignes_peuvent_echanger_leur_cle_sans_heurter_l_unicite(): void
    {
        $od = $this->acuity($this->scaleId, '8/10', 'FAR', 'WITHOUT', 'OD');
        $og = $this->acuity($this->scaleId, '5/10', 'FAR', 'WITHOUT', 'OG');
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$od, $og]))->assertOk();

        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([[...$od, 'eye' => 'OG'], [...$og, 'eye' => 'OD']]))->assertOk();

        $this->assertSame('OG', DB::table('visual_acuities')->where('id', $od['id'])->value('eye'));
        $this->assertSame('OD', DB::table('visual_acuities')->where('id', $og['id'])->value('eye'));
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function incoherentCombinations(): array
    {
        return [
            'préliminaire sans distance' => [['context' => 'PRELIMINARY', 'distance' => 'UNSPECIFIED', 'correction' => 'WITHOUT'], 'acuities.0.distance'],
            'après correction avec distance' => [['context' => 'POST_REFRACTION', 'distance' => 'FAR', 'correction' => 'WITH'], 'acuities.0.distance'],
            'après correction sans correction' => [['context' => 'POST_REFRACTION', 'distance' => 'UNSPECIFIED', 'correction' => 'WITHOUT'], 'acuities.0.correction'],
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    #[DataProvider('incoherentCombinations')]
    public function test_les_combinaisons_incoherentes_sont_refusees_avant_toute_ecriture(array $overrides, string $fragment): void
    {
        $row = [...$this->acuity($this->scaleId, '8/10'), ...$overrides];

        $response = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]));

        $this->assertFieldError($response, $fragment);
        $this->assertSame(0, DB::table('visual_acuities')->count(), 'Jamais d\'erreur SQL de la contrainte, jamais de saisie à moitié enregistrée.');
        $this->assertSame(1, (int) DB::table('consultations')->where('id', $this->consultationId)->value('version'));
    }

    public function test_une_meme_acuite_deux_fois_est_refusee_sur_la_seconde_ligne(): void
    {
        $response = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([
            $this->acuity($this->scaleId, '8/10'),
            $this->acuity($this->scaleId, '9/10'),
        ]));

        $this->assertFieldError($response, 'acuities.1.eye');
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    public function test_l_echelle_doit_etre_une_echelle_active_du_cabinet(): void
    {
        $inactive = $this->seedScale('ANCIENNE', false);
        $otherClinic = $this->makeClinic();
        $foreign = $this->seedScale('AUTRE_CABINET', true, $otherClinic);

        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($inactive, '8/10')])), 'acuities.0.scale_id');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($foreign, '8/10')])), 'acuities.0.scale_id');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity(Ulid::generate(), '8/10')])), 'acuities.0.scale_id');
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    public function test_une_echelle_desactivee_depuis_reste_valable_pour_la_ligne_qui_l_utilise_deja(): void
    {
        $row = $this->acuity($this->scaleId, '8/10');
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]))->assertOk();
        DB::table('visual_acuity_scales')->where('id', $this->scaleId)->update(['active' => false]);

        // La même ligne se ré-enregistre (valeur modifiée) ; une NOUVELLE ligne avec cette échelle est refusée.
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([[...$row, 'raw_value' => '9/10']]))->assertOk();
        $other = $this->acuity($this->scaleId, '7/10', 'FAR', 'WITHOUT', 'OG');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([[...$row, 'raw_value' => '9/10'], $other])), 'acuities.1.scale_id');
    }

    public function test_la_valeur_lue_est_obligatoire_et_bornee(): void
    {
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, '')])), 'acuities.0.raw_value');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, '   ')])), 'acuities.0.raw_value');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, str_repeat('9', 101))])), 'acuities.0.raw_value');
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, "10/10\x07")])), 'acuities.0.raw_value');
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    public function test_une_valeur_lue_numerique_ou_un_oeil_inconnu_sont_refuses_par_le_contrat(): void
    {
        $number = [...$this->acuity($this->scaleId, '8/10'), 'raw_value' => 0.8];
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$number])), 'raw_value');
        $unknownEye = [...$this->acuity($this->scaleId, '8/10'), 'eye' => 'XX'];
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$unknownEye])), 'eye');
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    public function test_aucune_conversion_entre_echelles_n_est_acceptee(): void
    {
        $row = [...$this->acuity($this->scaleId, '8/10'), 'normalized_value' => '0.8'];

        $response = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$row]));

        $this->assertFieldError($response, 'acuities.0.normalized_value');
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    public function test_un_identifiant_de_ligne_pris_ailleurs_est_refuse_par_champ(): void
    {
        $taken = $this->acuity($this->scaleId, '8/10');
        [, $otherConsultation] = $this->startedExamForOtherPatient();
        $this->saveCurrent($otherConsultation, 'VISUAL_ACUITY', $this->data([$taken]))->assertOk();

        $response = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$taken]));

        $this->assertFieldError($response, 'acuities.0.id');
        $this->assertSame(1, DB::table('visual_acuities')->count());
    }

    public function test_une_erreur_n_ecrit_aucune_ligne_meme_si_les_autres_sont_valides(): void
    {
        $effects = $this->clinicalEffectCounts();

        $response = $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([
            $this->acuity($this->scaleId, '8/10'),
            $this->acuity($this->scaleId, '', 'FAR', 'WITHOUT', 'OG'),
        ]));

        $this->assertFieldError($response, 'acuities.1.raw_value');
        $this->assertSame($effects, $this->clinicalEffectCounts());
    }

    public function test_l_audit_porte_le_nom_de_la_rubrique_et_aucune_valeur_mesuree(): void
    {
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, 'SENTINELLE-ACUITE-QX7')]))->assertOk();

        $event = DB::table('audit_events')->where('action', 'consultation.step_saved')->where('target_id', $this->consultationId)->first();
        $this->assertNotNull($event);
        $this->assertStringNotContainsString('SENTINELLE-ACUITE-QX7', $this->sideEffectsDump());
    }

    public function test_une_ecriture_d_acuite_exige_la_permission_d_ecrire(): void
    {
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, '8/10')]), $this->reception)->assertStatus(403);
        $this->saveCurrent($this->consultationId, 'VISUAL_ACUITY', $this->data([$this->acuity($this->scaleId, '8/10')]), $this->cashier)->assertStatus(403);
        $this->assertSame(0, DB::table('visual_acuities')->count());
    }

    /**
     * Autre examen démarré (autre patient) : [visite, consultation].
     *
     * @return array{0: string, 1: string}
     */
    private function startedExamForOtherPatient(): array
    {
        $patientId = $this->seedPatient($this->clinicId);
        $visitId = $this->seedVisit([], $this->clinicId, $patientId);
        $body = $this->startBody($visitId, ['patient_id' => $patientId]);
        $this->startConsultation($visitId, $body)->assertCreated();

        return [$visitId, (string) $body['consultation_id']];
    }
}

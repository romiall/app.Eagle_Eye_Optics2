<?php

namespace Tests\Feature\Clinical;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ClinicalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Rubrique CENTERING (C02, AT18) : écart pupillaire objectif en millimètres (total, OD, OG), une ligne par consultation.
 * Le système ne fabrique jamais une valeur monoculaire à partir du total (ni l'inverse) ; une incohérence entre le
 * total et la somme OD + OG exige une justification (tolérance 0 par hypothèse, Q06). Données fictives.
 */
final class SaveCenteringStepTest extends TestCase
{
    use ClinicalFixtures;
    use MigratedDatabase;

    private string $consultationId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootClinical();
        [, $this->consultationId] = $this->startedExam();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_un_centrage_coherent_est_enregistre_et_relu_sans_rien_fabriquer(): void
    {
        $id = Ulid::generate();

        $saved = $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '62', 'pd_od' => null, 'pd_og' => null]))->assertOk();

        $this->assertMatchesContract($saved, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $this->assertSame(['centering_id' => $id, 'pd_total' => '62.00', 'pd_od' => null, 'pd_og' => null, 'inconsistency_reason' => null], $saved->json('data.steps.CENTERING'), 'Aucune DP monoculaire n\'est déduite du total.');
        $this->assertSame(1, DB::table('autorefractor_centering')->where('consultation_id', $this->consultationId)->count());
    }

    public function test_une_somme_egale_au_total_n_exige_aucune_justification(): void
    {
        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '62.00', 'pd_od' => '31.50', 'pd_og' => '30.50']))
            ->assertOk()
            ->assertJsonPath('data.steps.CENTERING.pd_og', '30.50');
    }

    public function test_une_somme_differente_du_total_exige_une_justification_jamais_une_correction_silencieuse(): void
    {
        $data = $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '62', 'pd_od' => '31', 'pd_og' => '30']);

        $this->assertFieldError($this->saveCurrent($this->consultationId, 'CENTERING', $data), 'inconsistency_reason');
        $this->assertSame(0, DB::table('autorefractor_centering')->count());

        $this->saveCurrent($this->consultationId, 'CENTERING', [...$data, 'inconsistency_reason' => 'Asymétrie du visage constatée (fictif)'])
            ->assertOk()
            ->assertJsonPath('data.steps.CENTERING.pd_total', '62.00')
            ->assertJsonPath('data.steps.CENTERING.pd_og', '30.00')
            ->assertJsonPath('data.steps.CENTERING.inconsistency_reason', 'Asymétrie du visage constatée (fictif)');
    }

    public function test_aucun_ecart_n_est_juge_tant_qu_une_des_trois_valeurs_manque(): void
    {
        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '62', 'pd_od' => '31']))
            ->assertOk()
            ->assertJsonPath('data.steps.CENTERING.pd_og', null);
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function invalidCentering(): array
    {
        return [
            'zéro' => [['pd_total' => '0'], 'pd_total'],
            'négatif' => [['pd_od' => '-31'], 'pd_od'],
            'trois décimales' => [['pd_og' => '30.255'], 'pd_og'],
            'virgule' => [['pd_total' => '62,5'], 'pd_total'],
            'flottant' => [['pd_total' => 62.5], 'pd_total'],
            'justification sans écart' => [['inconsistency_reason' => 'Sans mesure'], 'inconsistency_reason'],
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    #[DataProvider('invalidCentering')]
    public function test_un_centrage_invalide_est_refuse_avant_toute_ecriture(array $overrides, string $fragment): void
    {
        $data = $this->centering(['centering_id' => Ulid::generate(), ...$overrides]);

        $this->assertFieldError($this->saveCurrent($this->consultationId, 'CENTERING', $data), $fragment);
        $this->assertSame(0, DB::table('autorefractor_centering')->count());
        $this->assertSame(1, (int) DB::table('consultations')->where('id', $this->consultationId)->value('version'));
    }

    public function test_un_ecart_saisi_exige_l_identifiant_de_ligne_du_poste(): void
    {
        $response = $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['pd_total' => '62']));

        $this->assertFieldError($response, 'centering_id');
        $this->assertSame(0, DB::table('autorefractor_centering')->count());
    }

    public function test_une_seule_ligne_par_consultation_et_son_identifiant_ne_change_pas(): void
    {
        $id = Ulid::generate();
        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '62']))->assertOk();

        // Un autre identifiant pour la même consultation : refusé (la ligne existante a le sien).
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '63'])), 'centering_id');

        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '63']))->assertOk();
        $this->assertSame('63.00', (string) DB::table('autorefractor_centering')->where('id', $id)->value('pd_total'));
        $this->assertSame(1, DB::table('autorefractor_centering')->count());
    }

    public function test_effacer_toutes_les_valeurs_supprime_la_ligne_et_rend_un_centrage_vide(): void
    {
        $id = Ulid::generate();
        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '62']))->assertOk();

        $cleared = $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering())->assertOk();

        $this->assertSame($this->centering(), $cleared->json('data.steps.CENTERING'));
        $this->assertSame(0, DB::table('autorefractor_centering')->count());
    }

    public function test_un_identifiant_de_ligne_pris_par_une_autre_consultation_est_refuse(): void
    {
        $id = Ulid::generate();
        $patientId = $this->seedPatient($this->clinicId);
        $visitId = $this->seedVisit([], $this->clinicId, $patientId);
        $body = $this->startBody($visitId, ['patient_id' => $patientId]);
        $this->startConsultation($visitId, $body)->assertCreated();
        $this->saveCurrent((string) $body['consultation_id'], 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '60']))->assertOk();

        $response = $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => $id, 'pd_total' => '62']));

        $this->assertFieldError($response, 'centering_id');
    }

    public function test_un_enregistrement_identique_ne_change_pas_la_version(): void
    {
        $data = $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '62.00']);
        $this->saveCurrent($this->consultationId, 'CENTERING', $data)->assertOk();

        $this->saveCurrent($this->consultationId, 'CENTERING', [...$data, 'pd_total' => '62'])->assertOk()->assertJsonPath('data.version', 2);
    }

    public function test_l_audit_ne_contient_aucune_valeur(): void
    {
        $this->saveCurrent($this->consultationId, 'CENTERING', $this->centering(['centering_id' => Ulid::generate(), 'pd_total' => '71.37']))->assertOk();

        $this->assertStringNotContainsString('71.37', $this->sideEffectsDump());
    }
}

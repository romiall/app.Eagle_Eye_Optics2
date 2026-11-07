<?php

namespace Tests\Feature\Clinical;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ClinicalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Rubrique REFRACTION (C02, AT18, EE007) : autoréfracteur, réfraction objective et subjective séparés par œil,
 * observations et amétropies choisies par le professionnel. Aucun arrondi, aucune inférence (cylindre positif non
 * transposé, axe non déduit), zéro distinct de « non mesuré ». Données fictives.
 */
final class SaveRefractionStepTest extends TestCase
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

    public function test_les_trois_stades_restent_distincts_par_oeil_et_sont_relus_en_forme_canonique(): void
    {
        $data = $this->refraction([
            'measurements' => [
                $this->measurement('SUBJECTIVE', 'OG', '-1', '-0.5', 90, '1.5'),
                $this->measurement('AUTOREFRACTOR', 'OD', '-1.25', '-0.50', 90),
                $this->measurement('OBJECTIVE', 'OD', '+0.75', null, null),
                $this->measurement('AUTOREFRACTOR', 'OG', '0', '0', 0),
            ],
            'refraction_observations' => "Observation fictive\nsur deux lignes",
            'ametropias' => [$this->term('MYOPIA'), $this->term('OTHER', 'Précision fictive')],
        ]);

        $saved = $this->saveCurrent($this->consultationId, 'REFRACTION', $data)->assertOk();

        $this->assertMatchesContract($saved, 'schemas/resources/clinical.json#/$defs/ConsultationResponse');
        $step = $saved->json('data.steps.REFRACTION');
        $this->assertSame(
            [['AUTOREFRACTOR', 'OD', '-1.25', '-0.50', 90, null], ['AUTOREFRACTOR', 'OG', '0.00', '0.00', 0, null], ['OBJECTIVE', 'OD', '0.75', null, null, null], ['SUBJECTIVE', 'OG', '-1.00', '-0.50', 90, '1.50']],
            array_map(static fn (array $m): array => [$m['stage'], $m['eye'], $m['sphere'], $m['cylinder'], $m['axis'], $m['addition']], $step['measurements']),
        );
        $this->assertSame("Observation fictive\nsur deux lignes", $step['refraction_observations']);
        $this->assertSame(['MYOPIA', 'OTHER'], array_column($step['ametropias'], 'term_code'));
        $this->assertSame('Précision fictive', $step['ametropias'][1]['other_text']);
        $this->assertSame($step, $this->stepOf($this->consultationId, 'REFRACTION'));
        $this->assertSame(4, DB::table('refraction_measurements')->where('consultation_id', $this->consultationId)->count());
        $this->assertSame(2, DB::table('consultation_ametropias')->where('consultation_id', $this->consultationId)->count());
    }

    public function test_zero_est_une_valeur_et_non_mesure_n_a_pas_de_ligne(): void
    {
        $zero = $this->measurement('OBJECTIVE', 'OD', '0', null, null);
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$zero]]))->assertOk();

        $row = DB::table('refraction_measurements')->where('id', $zero['id'])->first();
        $this->assertNotNull($row);
        $this->assertSame('0.00', (string) $row->sphere, 'Zéro est enregistré comme zéro.');
        $this->assertNull($row->cylinder, 'Non mesuré reste null, jamais zéro.');
        $this->assertNull($row->axis);

        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction())->assertOk();
        $this->assertSame(0, DB::table('refraction_measurements')->count(), 'Un œil non mesuré n\'a pas de ligne.');
    }

    public function test_le_cylindre_positif_n_est_jamais_transpose_et_l_axe_n_est_jamais_deduit(): void
    {
        $row = $this->measurement('SUBJECTIVE', 'OD', '-1.00', '+0.75', null);

        $saved = $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$row]]))->assertOk();

        $stored = $saved->json('data.steps.REFRACTION.measurements.0');
        $this->assertSame('0.75', $stored['cylinder'], 'Le cylindre positif est conservé tel que saisi.');
        $this->assertNull($stored['axis'], 'Un cylindre non nul sans axe est admis à l\'enregistrement d\'une mesure : l\'axe n\'est pas déduit.');
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function invalidMeasures(): array
    {
        return [
            'trois décimales' => [['sphere' => '1.255'], 'measurements.0.sphere'],
            'virgule' => [['sphere' => '1,25'], 'measurements.0.sphere'],
            'nombre flottant' => [['sphere' => -1.25], 'measurements.0.sphere'],
            // Par HTTP, ConvertEmptyStringsToNull change « » en null (non mesuré) : la ligne n'a plus aucune mesure et
            // c'est elle qui est refusée. Le refus de la chaîne vide elle-même (chemin de synchronisation) est couvert
            // par MeasurementRulesTest.
            'chaîne vide' => [['sphere' => ''], 'measurements.0'],
            'plus de quatre chiffres entiers' => [['cylinder' => '12345.00'], 'measurements.0.cylinder'],
            'axe au-delà de 180' => [['cylinder' => '-1', 'axis' => 181], 'measurements.0.axis'],
            'axe négatif' => [['cylinder' => '-1', 'axis' => -1], 'measurements.0.axis'],
            'axe décimal' => [['cylinder' => '-1', 'axis' => 90.5], 'measurements.0.axis'],
            'axe en chaîne' => [['cylinder' => '-1', 'axis' => '90'], 'measurements.0.axis'],
            'addition hors réfraction subjective' => [['addition' => '1.50'], 'measurements.0.addition'],
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    #[DataProvider('invalidMeasures')]
    public function test_une_mesure_invalide_est_refusee_sans_etre_arrondie_ni_corrigee(array $overrides, string $fragment): void
    {
        $row = [...$this->measurement('OBJECTIVE', 'OD', '-1.00'), ...$overrides];

        $response = $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$row]]));

        $this->assertFieldError($response, $fragment);
        $this->assertSame(0, DB::table('refraction_measurements')->count());
        $this->assertSame(1, (int) DB::table('consultations')->where('id', $this->consultationId)->value('version'));
    }

    public function test_l_addition_est_admise_pour_la_seule_refraction_subjective(): void
    {
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$this->measurement('SUBJECTIVE', 'OD', null, null, null, '2.25')]]))
            ->assertOk()
            ->assertJsonPath('data.steps.REFRACTION.measurements.0.addition', '2.25');
    }

    public function test_une_ligne_sans_aucune_mesure_est_refusee(): void
    {
        $response = $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$this->measurement('OBJECTIVE', 'OD')]]));

        $this->assertFieldError($response, 'measurements.0');
        $this->assertSame(0, DB::table('refraction_measurements')->count());
    }

    public function test_une_seule_ligne_par_stade_et_par_oeil_et_aucun_oeil_inconnu(): void
    {
        $twice = $this->refraction(['measurements' => [$this->measurement('OBJECTIVE', 'OD', '-1'), $this->measurement('OBJECTIVE', 'OD', '-2')]]);
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'REFRACTION', $twice), 'measurements.1.eye');

        $ou = $this->refraction(['measurements' => [[...$this->measurement('OBJECTIVE', 'OD', '-1'), 'eye' => 'OU']]]);
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'REFRACTION', $ou), 'eye');

        $this->assertSame(0, DB::table('refraction_measurements')->count());
    }

    public function test_les_ametropies_viennent_du_referentiel_et_autre_exige_sa_precision(): void
    {
        $unknown = $this->refraction(['ametropias' => [$this->term('NE_EXISTE_PAS')]]);
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'REFRACTION', $unknown), 'ametropias.0');

        $otherWithoutText = $this->refraction(['ametropias' => [$this->term('OTHER')]]);
        $this->assertFieldError($this->saveCurrent($this->consultationId, 'REFRACTION', $otherWithoutText), 'ametropias.0.other_text');

        $this->assertSame(0, DB::table('consultation_ametropias')->count());
    }

    public function test_deux_mesures_peuvent_echanger_leur_oeil_sans_heurter_l_unicite(): void
    {
        $od = $this->measurement('OBJECTIVE', 'OD', '-1.00');
        $og = $this->measurement('OBJECTIVE', 'OG', '-2.00');
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$od, $og]]))->assertOk();

        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [[...$od, 'eye' => 'OG'], [...$og, 'eye' => 'OD']]]))->assertOk();

        $this->assertSame('OG', DB::table('refraction_measurements')->where('id', $od['id'])->value('eye'));
        $this->assertSame('OD', DB::table('refraction_measurements')->where('id', $og['id'])->value('eye'));
    }

    public function test_un_enregistrement_identique_ne_change_pas_la_version_et_la_mesure_modifiee_garde_son_identifiant(): void
    {
        $row = $this->measurement('OBJECTIVE', 'OD', '-1.00', '-0.50', 10);
        $data = $this->refraction(['measurements' => [$row]]);
        $this->saveCurrent($this->consultationId, 'REFRACTION', $data)->assertOk();

        // « -1 » et « -1.00 » désignent la même mesure : aucun effet.
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [[...$row, 'sphere' => '-1']]]))->assertOk();
        $this->assertSame(2, (int) DB::table('consultations')->where('id', $this->consultationId)->value('version'));

        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [[...$row, 'sphere' => '-1.25']]]))->assertOk();
        $this->assertSame('-1.25', (string) DB::table('refraction_measurements')->where('id', $row['id'])->value('sphere'));
        $this->assertSame(1, DB::table('refraction_measurements')->count());
    }

    public function test_un_identifiant_de_mesure_pris_ailleurs_est_refuse_par_champ(): void
    {
        $taken = $this->measurement('OBJECTIVE', 'OD', '-1.00');
        $patientId = $this->seedPatient($this->clinicId);
        $visitId = $this->seedVisit([], $this->clinicId, $patientId);
        $body = $this->startBody($visitId, ['patient_id' => $patientId]);
        $this->startConsultation($visitId, $body)->assertCreated();
        $this->saveCurrent((string) $body['consultation_id'], 'REFRACTION', $this->refraction(['measurements' => [$taken]]))->assertOk();

        $response = $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(['measurements' => [$taken]]));

        $this->assertFieldError($response, 'measurements.0.id');
    }

    public function test_l_audit_ne_contient_aucune_valeur_mesuree(): void
    {
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction([
            'measurements' => [$this->measurement('OBJECTIVE', 'OD', '-7.77')],
            'refraction_observations' => 'SENTINELLE-REFRACTION-KD2',
        ]))->assertOk();

        $dump = $this->sideEffectsDump();
        $this->assertStringNotContainsString('SENTINELLE-REFRACTION-KD2', $dump);
        $this->assertStringNotContainsString('-7.77', $dump);
    }

    public function test_l_acces_exige_la_permission_d_ecrire(): void
    {
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(), $this->reception)->assertStatus(403);
        $this->saveCurrent($this->consultationId, 'REFRACTION', $this->refraction(), $this->cashier)->assertStatus(403);
    }
}

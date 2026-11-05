<?php

namespace Tests\Feature\Clinical;

use App\Application\Command;
use App\Application\Locking\TransactionLocks;
use App\Domain\Clinical\Handlers\DeletePrescriptionDraftHandler;
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
 * Suppression d'un brouillon de prescription (chantier « CRUD des écrans », tranche 3a ; en ligne seulement) sur MySQL
 * réel : seul un brouillon jamais utilisé disparaît avec ses yeux et traitements, une prescription validée ou utilisée
 * reste (409), jeton de concurrence `expected_updated_at`, droits de la modification d'un brouillon, audit sans valeur
 * clinique, pierre tombale au journal des changements, rejeu idempotent, isolation des cabinets. Données fictives.
 */
final class DeletePrescriptionDraftTest extends TestCase
{
    use ClinicalFixtures;
    use MigratedDatabase;

    private string $consultationId;

    /** @var array<string, mixed> */
    private array $draft;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootClinical();
        [, $this->consultationId] = $this->startedExam();
        $this->draft = $this->draftPrescription($this->consultationId, ['notes' => 'SENTINELLE-CLINIQUE-RX']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function deleteDraft(?string $id = null, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        $id ??= (string) $this->draft['id'];

        return $this->actingAsFresh($as ?? $this->clinician)
            ->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->postJson('/api/v1/prescriptions/'.$id.'/delete', array_merge([
                'expected_version' => null,
                'prescription_id' => $id,
                'expected_updated_at' => (string) $this->draft['updated_at'],
            ], $overrides));
    }

    public function test_un_brouillon_se_supprime_avec_ses_yeux_et_sa_trace_sans_valeur_clinique(): void
    {
        $id = (string) $this->draft['id'];
        $this->assertSame(2, DB::table('optical_prescription_eyes')->where('prescription_id', $id)->count());

        $response = $this->deleteDraft()->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/clinical.json#/$defs/DeletePrescriptionDraftResponse');
        $response->assertJsonPath('data.prescription_id', $id)
            ->assertJsonPath('data.consultation_id', $this->consultationId)
            ->assertJsonPath('data.patient_id', $this->patientId)
            ->assertJsonPath('data.version_no', 1);
        $this->assertFalse(DB::table('optical_prescriptions')->where('id', $id)->exists());
        $this->assertSame(0, DB::table('optical_prescription_eyes')->where('prescription_id', $id)->count());
        $this->assertSame(0, DB::table('optical_prescription_treatments')->where('prescription_id', $id)->count());
        $this->assertTrue(DB::table('consultations')->where('id', $this->consultationId)->exists(), 'L\'examen n\'est pas touché.');

        $audit = DB::table('audit_events')->where('action', 'prescription.deleted')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->clinician->id, $audit->actor_id);
        $diff = json_decode((string) $audit->sanitized_diff, true, 512, JSON_THROW_ON_ERROR);
        $this->assertEquals(['series_id' => $this->draft['series_id'], 'version_no' => 1, 'origin' => 'INTERNAL', 'consultation_id' => $this->consultationId, 'supersedes_id' => null], $diff);
        $tombstone = DB::table('sync_change_log')->where('entity_type', 'optical_prescriptions')->where('entity_id', $id)->orderByDesc('change_sequence')->first();
        $this->assertNotNull($tombstone);
        $this->assertSame(['ARCHIVED', 1, 'CLINICAL'], [$tombstone->change_kind, (int) $tombstone->entity_version, $tombstone->visibility]);
        $this->assertStringNotContainsString('SENTINELLE-CLINIQUE-RX', $this->sideEffectsDump());
    }

    public function test_une_prescription_validee_ne_se_supprime_jamais(): void
    {
        // Le brouillon de l'examen est validé (une consultation n'a qu'une série : pas de seconde première version).
        $validated = (array) $this->validatePrescription((string) $this->draft['id'])->assertOk()->json('data');
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft((string) $validated['id'], ['expected_updated_at' => (string) $validated['updated_at']])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.current_status', 'VALIDATED');

        $this->assertSame('VALIDATED', DB::table('optical_prescriptions')->where('id', $validated['id'])->value('status'));
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_un_brouillon_de_nouvelle_version_se_supprime_sans_toucher_a_la_validee(): void
    {
        $this->deleteDraft()->assertOk();
        $validated = $this->validatedPrescription($this->consultationId);
        $revision = $this->createPrescription($this->rxBody($this->consultationId, [
            'series_id' => $validated['series_id'], 'version_no' => 2, 'supersedes_id' => $validated['id'],
        ]))->assertCreated();
        $draftId = (string) $revision->json('data.id');

        $this->deleteDraft($draftId, ['expected_updated_at' => (string) $revision->json('data.updated_at')])->assertOk();

        $this->assertFalse(DB::table('optical_prescriptions')->where('id', $draftId)->exists());
        $this->assertSame('VALIDATED', DB::table('optical_prescriptions')->where('id', $validated['id'])->value('status'));
        $again = $this->createPrescription($this->rxBody($this->consultationId, [
            'series_id' => $validated['series_id'], 'version_no' => 2, 'supersedes_id' => $validated['id'],
        ]));
        $again->assertCreated();
    }

    public function test_un_jeton_perime_repond_conflit_avec_le_jeton_actuel(): void
    {
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft(null, ['expected_updated_at' => '2020-01-01T00:00:00.000Z'])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'VERSION_CONFLICT')
            ->assertJsonPath('error.details.current_updated_at', $this->draft['updated_at']);

        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_une_prescription_deja_utilisee_par_un_document_ne_se_supprime_pas(): void
    {
        DB::table('generated_documents')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'document_type' => 'OPTICAL_PRESCRIPTION', 'prescription_id' => $this->draft['id'],
            'source_key' => 'prescription:'.$this->draft['id'], 'revision_no' => 1, 'template_version' => 'test-1',
            'status' => 'PENDING', 'created_at' => '2026-10-22 09:30:00.000000', 'updated_at' => '2026-10-22 09:30:00.000000',
        ]);
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft()->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    /**
     * @return array<string, array{string, int}>
     */
    public static function accountsWithoutClinicalWrite(): array
    {
        return ['accueil' => ['reception', 403], 'caisse' => ['cashier', 403]];
    }

    #[DataProvider('accountsWithoutClinicalWrite')]
    public function test_l_accueil_et_la_caisse_ne_suppriment_pas_une_prescription(string $account, int $status): void
    {
        $before = $this->clinicalEffectCounts();

        $this->deleteDraft(null, [], $this->{$account})->assertStatus($status);

        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());
        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_la_gerante_peut_supprimer_un_brouillon_et_une_derogation_retire_ce_droit(): void
    {
        $this->denyPermission($this->clinician, 'clinical.write');
        $this->deleteDraft()->assertForbidden();
        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());

        $this->deleteDraft(null, [], $this->manager)->assertOk();
        $this->assertFalse(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());
    }

    public function test_le_corps_doit_porter_le_jeton_et_l_identifiant_de_l_adresse_sans_version(): void
    {
        $before = $this->clinicalEffectCounts();
        $id = (string) $this->draft['id'];

        $this->deleteDraft(null, ['prescription_id' => Ulid::generate()])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->deleteDraft(null, ['expected_version' => 3])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->actingAsFresh($this->clinician)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/prescriptions/'.$id.'/delete', ['expected_version' => null, 'prescription_id' => $id])
            ->assertStatus(422);
        $this->deleteDraft(null, ['expected_updated_at' => 'hier'])->assertStatus(422);

        $this->assertSame($before, $this->clinicalEffectCounts());
    }

    public function test_le_rejeu_de_la_meme_cle_rend_la_reponse_d_origine_sans_second_effet(): void
    {
        $key = Ulid::generate();

        $first = $this->deleteDraft(null, [], null, $key)->assertOk();
        $second = $this->deleteDraft(null, [], null, $key)->assertOk();

        $this->assertEquals($first->json('data'), $second->json('data'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'prescription.deleted')->count());
        $this->assertSame(1, DB::table('sync_change_log')->where('entity_type', 'optical_prescriptions')->where('change_kind', 'ARCHIVED')->count());
    }

    public function test_une_prescription_deja_supprimee_ou_d_un_autre_cabinet_repond_introuvable(): void
    {
        $this->deleteDraft()->assertOk();
        $this->deleteDraft()->assertNotFound();

        $other = $this->draftPrescription($this->consultationId, ['series_id' => Ulid::generate(), 'version_no' => 1, 'prescription_id' => Ulid::generate()]);
        $clinicB = $this->makeClinic('TEST CABINET B');
        $foreign = $this->makeStaff($clinicB, 'MANAGER', 'gerante.b');
        $this->deleteDraft((string) $other['id'], ['expected_updated_at' => (string) $other['updated_at']], $foreign)->assertNotFound();
        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $other['id'])->exists());
    }

    public function test_la_suppression_n_est_ouverte_qu_en_ligne(): void
    {
        $payload = ['prescription_id' => $this->draft['id'], 'expected_updated_at' => $this->draft['updated_at']];

        foreach ([CommandContext::job($this->clinicId, 'test', 'corr-test', CarbonImmutable::now('UTC')), $this->syncContextFor($this->clinician)] as $context) {
            try {
                $this->app->make(DeletePrescriptionDraftHandler::class)->handle(new Command('DeletePrescriptionDraft', $payload, (string) $this->draft['id']), $context, new TransactionLocks($this->clinicId), null);
                $this->fail('Une source autre que la route directe devait être refusée.');
            } catch (BusinessError $error) {
                $this->assertSame('ACTION_FORBIDDEN', $error->errorCode);
            }
        }
        $this->assertTrue(DB::table('optical_prescriptions')->where('id', $this->draft['id'])->exists());
    }
}

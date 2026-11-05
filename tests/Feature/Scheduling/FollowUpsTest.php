<?php

namespace Tests\Feature\Scheduling;

use App\Domain\Access\EffectivePermissions;
use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Contrôles recommandés (S02, AT22) sur MySQL réel : date calculée depuis l'origine choisie (recalculée par le
 * serveur), date manuelle motivée, aucune décision médicale automatique, tâche de rappel interne unique, programmation
 * par un rendez-vous (SCHEDULED, tâches BOOKED), réouverture après annulation, cloisonnement clinique de la liste et
 * droits. Données fictives.
 */
final class FollowUpsTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;

    private string $consultationId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda();
        $this->consultationId = $this->seedConsultation();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function create(array $overrides = [], ?User $as = null): TestResponse
    {
        return $this->send($as ?? $this->clinician, 'POST', '/api/v1/follow-ups', $this->followUpBody($this->consultationId, $overrides));
    }

    public function test_un_controle_calcule_cree_sa_tache_de_rappel_interne(): void
    {
        $response = $this->create()->assertCreated();

        $this->assertMatchesContract($response, 'schemas/resources/scheduling.json#/$defs/FollowUpPlanResponse');
        $response->assertJsonPath('data.recommended_date', '2027-01-22')
            ->assertJsonPath('data.reminder_date', '2027-01-15')
            ->assertJsonPath('data.status', 'ACTIVE')
            ->assertJsonPath('data.reason', 'ROUTINE');
        $tasks = DB::table('contact_tasks')->where('follow_up_id', $response->json('data.id'))->get();
        $this->assertCount(1, $tasks);
        $this->assertSame('2027-01-14 23:00:00.000000', (string) $tasks[0]->due_at, 'minuit du 15 janvier à Douala');
        $this->assertSame('CALL', $tasks[0]->channel);
        $audit = (string) DB::table('audit_events')->where('action', 'follow_up.created')->value('sanitized_diff');
        $this->assertStringNotContainsString('SENTINELLE', $audit, 'aucun texte clinique dans l\'audit');
    }

    public function test_la_date_est_recalculee_par_le_serveur_au_calendrier_civil(): void
    {
        $this->create(['recommended_date' => '2027-01-23'])->assertStatus(422)
            ->assertJsonPath('error.fields.recommended_date.0', 'La date recommandée ne correspond pas au calcul (départ + délai = 2027-01-22).');
        $this->create(['anchor_date' => '2026-10-21'])->assertStatus(422);

        // Fin de mois : 31 janvier + 1 mois = dernier jour de février.
        $this->create(['anchor_kind' => 'TREATMENT_END', 'anchor_date' => '2027-01-31', 'interval_value' => 1, 'recommended_date' => '2027-02-28'])
            ->assertCreated();
        // Collyre : 12 jours après la fin du traitement donnée par le professionnel.
        $this->create(['reason' => 'DROPS', 'anchor_kind' => 'TREATMENT_END', 'anchor_date' => '2026-10-30', 'interval_value' => 12,
            'interval_unit' => 'DAY', 'recommended_date' => '2026-11-11'])->assertCreated();
    }

    public function test_une_date_manuelle_exige_son_motif(): void
    {
        $manual = ['date_origin' => 'MANUAL', 'anchor_kind' => 'MANUAL', 'anchor_date' => '2026-11-05', 'interval_value' => null,
            'interval_unit' => null, 'recommended_date' => '2026-11-05'];
        // Sans motif : refusé dès le contrat de la commande (date_origin MANUAL impose une chaîne non vide).
        $this->create($manual)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['manual_reason']]]);
        // Motif trop court : la règle métier donne le message français.
        $this->create(['manual_reason' => 'ab'] + $manual)->assertStatus(422)
            ->assertJsonPath('error.fields.manual_reason.0', 'Une date saisie à la main porte son motif (au moins 3 caractères).');
        $this->create(['manual_reason' => 'Disponibilité du patient'] + $manual)->assertCreated()->assertJsonPath('data.date_origin', 'MANUAL');
    }

    public function test_droits_et_cloisonnement_clinique(): void
    {
        $this->create([], $this->reception)->assertForbidden();
        $plan = $this->create()->assertCreated()->json('data.id');

        $reception = $this->read($this->reception, '/api/v1/follow-ups?from=2027-01-01&to=2027-01-31')->assertOk();
        $this->assertMatchesContract($reception, 'schemas/resources/scheduling.json#/$defs/FollowUpPlanList');
        $reception->assertJsonPath('data.0.id', $plan)->assertJsonPath('data.0.reason', null)->assertJsonPath('data.0.notes', null);
        $this->assertStringNotContainsString('SENTINELLE', (string) $reception->getContent());

        $this->read($this->clinician, '/api/v1/follow-ups?from=2027-01-01&to=2027-01-31')
            ->assertJsonPath('data.0.reason', 'ROUTINE')->assertJsonPath('data.0.notes', 'SENTINELLE-CLINIQUE-NOTE');

        // Un professionnel privé de la lecture clinique ne programme pas de contrôle.
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'user_id' => $this->clinician->id, 'permission_code' => 'clinical.read',
            'allowed' => false, 'assigned_by' => $this->manager->id, 'reason' => 'Test', 'expires_at' => null,
            'created_at' => '2026-01-01 00:00:00.000000', 'updated_at' => '2026-01-01 00:00:00.000000',
        ]);
        $this->app->make(EffectivePermissions::class)->forget($this->clinician);
        $this->create()->assertForbidden();
    }

    public function test_un_rendez_vous_programme_le_controle_et_son_annulation_le_rouvre(): void
    {
        $plan = $this->create()->assertCreated()->json('data.id');

        $appointment = $this->book(['follow_up_id' => $plan, 'starts_at' => '2026-10-26T07:00:00.000Z', 'ends_at' => '2026-10-26T07:30:00.000Z'])
            ->assertCreated()->assertJsonPath('data.follow_up_id', $plan)->json('data.id');
        $this->assertSame('SCHEDULED', DB::table('follow_up_plans')->where('id', $plan)->value('status'));
        $this->assertSame('BOOKED', DB::table('contact_tasks')->where('follow_up_id', $plan)->value('status'));
        $this->read($this->clinician, '/api/v1/follow-ups?consultation_id='.$this->consultationId)->assertJsonPath('data.0.appointment_id', $appointment);

        $this->send($this->reception, 'POST', "/api/v1/appointments/$appointment/cancel", ['expected_version' => 1, 'reason' => 'Report fictif'])->assertOk();
        $this->assertSame('ACTIVE', DB::table('follow_up_plans')->where('id', $plan)->value('status'), 'le patient reste à revoir');

        // Un rendez-vous ne programme pas le contrôle d'un autre patient.
        $other = $this->seedPatient($this->clinicId, 'Autre Fictif');
        $this->book(['patient_id' => $other, 'follow_up_id' => $plan])->assertStatus(422);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Annulation d'un contrôle recommandé (chantier « CRUD des écrans », tranche 3a)
    // ------------------------------------------------------------------------------------------------------------

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function cancelFollowUp(string $planId, int $version = 1, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->send($as ?? $this->clinician, 'POST', "/api/v1/follow-ups/$planId/cancel", array_merge([
            'expected_version' => $version,
            'follow_up_plan_id' => $planId,
            'reason' => 'Patient suivi ailleurs (fictif)',
        ], $overrides), $key);
    }

    /**
     * @return array<string, int>
     */
    private function followUpCounts(): array
    {
        $count = fn (string $table): int => DB::table($table)->where('clinic_id', $this->clinicId)->count();

        return ['audit' => $count('audit_events'), 'changes' => $count('sync_change_log'), 'tasks' => $count('contact_tasks'), 'idempotency' => $count('idempotency_requests')];
    }

    public function test_un_controle_actif_s_annule_avec_son_motif_et_ses_rappels_sont_clos(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $this->assertSame('PENDING', DB::table('contact_tasks')->where('follow_up_id', $plan)->value('status'));

        $response = $this->cancelFollowUp($plan)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/scheduling.json#/$defs/FollowUpPlanResponse');
        $response->assertJsonPath('data.id', $plan)->assertJsonPath('data.status', 'CANCELLED')->assertJsonPath('data.version', 2);
        $this->assertSame('CANCELLED', DB::table('follow_up_plans')->where('id', $plan)->value('status'));
        $this->assertSame('CANCELLED', DB::table('contact_tasks')->where('follow_up_id', $plan)->value('status'), 'Les rappels ouverts sont clos.');

        $audit = DB::table('audit_events')->where('action', 'follow_up.cancelled')->where('target_id', $plan)->first();
        $this->assertNotNull($audit, 'L\'annulation est tracée avec son motif.');
        $this->assertSame($this->clinician->id, $audit->actor_id);
        $this->assertSame('Patient suivi ailleurs (fictif)', $audit->reason);
        $this->assertStringNotContainsString('SENTINELLE', (string) $audit->sanitized_diff, 'aucun texte clinique dans l\'audit');
        $change = DB::table('sync_change_log')->where('entity_type', 'follow_up_plans')->where('entity_id', $plan)->orderByDesc('change_sequence')->first();
        $this->assertNotNull($change);
        $this->assertSame(['UPDATED', 2], [$change->change_kind, (int) $change->entity_version]);

        // Le contrôle annulé disparaît de la liste des patients à revoir mais reste lisible dans sa consultation.
        $this->read($this->clinician, '/api/v1/follow-ups?from=2027-01-01&to=2027-01-31')->assertOk()->assertJsonCount(0, 'data');
        $this->read($this->clinician, '/api/v1/follow-ups?consultation_id='.$this->consultationId)->assertJsonPath('data.0.status', 'CANCELLED');
    }

    public function test_un_controle_programme_par_un_rendez_vous_ne_s_annule_pas_avant_le_rendez_vous(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $this->book(['follow_up_id' => $plan, 'starts_at' => '2026-10-26T07:00:00.000Z', 'ends_at' => '2026-10-26T07:30:00.000Z'])->assertCreated();
        $before = $this->followUpCounts();

        $this->cancelFollowUp($plan, 2)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.current_status', 'SCHEDULED');

        $this->assertSame('SCHEDULED', DB::table('follow_up_plans')->where('id', $plan)->value('status'));
        $this->assertSame($before, $this->followUpCounts(), 'Un refus ne laisse aucun effet.');
    }

    public function test_un_controle_deja_annule_ou_une_version_perimee_est_refuse(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $this->cancelFollowUp($plan, 7)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'VERSION_CONFLICT')
            ->assertJsonPath('error.details.current_version', 1);
        $this->assertSame('ACTIVE', DB::table('follow_up_plans')->where('id', $plan)->value('status'));

        $this->cancelFollowUp($plan)->assertOk();
        $this->cancelFollowUp($plan, 2)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.current_status', 'CANCELLED');
    }

    public function test_le_motif_est_obligatoire_et_le_corps_porte_l_identifiant_de_l_adresse(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $before = $this->followUpCounts();

        $this->cancelFollowUp($plan, 1, ['reason' => 'ok'])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reason']]]);
        $this->cancelFollowUp($plan, 1, ['reason' => null])->assertStatus(422);
        $this->cancelFollowUp($plan, 1, ['follow_up_plan_id' => Ulid::generate()])->assertStatus(422);
        $this->send($this->clinician, 'POST', "/api/v1/follow-ups/$plan/cancel", ['follow_up_plan_id' => $plan, 'reason' => 'Motif valable'])->assertStatus(422);

        $this->assertSame('ACTIVE', DB::table('follow_up_plans')->where('id', $plan)->value('status'));
        $this->assertSame($before, $this->followUpCounts());
    }

    public function test_droits_de_l_annulation_d_un_controle(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $before = $this->followUpCounts();

        // Accueil et caisse n'ont pas follow_up.write ; la lecture clinique est exigée en plus.
        $this->cancelFollowUp($plan, 1, [], $this->reception)->assertForbidden();
        $this->cancelFollowUp($plan, 1, [], $this->cashier)->assertForbidden();
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'user_id' => $this->clinician->id, 'permission_code' => 'clinical.read',
            'allowed' => false, 'assigned_by' => $this->manager->id, 'reason' => 'Test', 'expires_at' => null,
            'created_at' => '2026-01-01 00:00:00.000000', 'updated_at' => '2026-01-01 00:00:00.000000',
        ]);
        $this->app->make(EffectivePermissions::class)->forget($this->clinician);
        $this->cancelFollowUp($plan)->assertForbidden();
        $this->assertSame($before, $this->followUpCounts());
        $this->assertSame('ACTIVE', DB::table('follow_up_plans')->where('id', $plan)->value('status'));

        // La gérante peut annuler.
        $this->cancelFollowUp($plan, 1, [], $this->manager)->assertOk();
    }

    public function test_le_rejeu_de_la_meme_cle_rend_la_reponse_d_origine_et_un_autre_cabinet_ne_voit_rien(): void
    {
        $plan = (string) $this->create()->assertCreated()->json('data.id');
        $key = Ulid::generate();

        $first = $this->cancelFollowUp($plan, 1, [], null, $key)->assertOk();
        $second = $this->cancelFollowUp($plan, 1, [], null, $key)->assertOk();
        $this->assertEquals($first->json('data'), $second->json('data'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'follow_up.cancelled')->count());

        $this->cancelFollowUp(Ulid::generate())->assertNotFound();
        $other = $this->otherClinic();
        $foreign = $this->makeStaff($other['clinic'], 'MANAGER', 'gerante.c');
        $this->cancelFollowUp($plan, 2, [], $foreign)->assertNotFound();
    }
}

<?php

namespace Tests\Feature\Scheduling;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Rendez-vous de l'agenda interne (S01, AT23) sur MySQL réel : prise de rendez-vous confirmée à la réponse du serveur,
 * créneau revérifié (horaires, fermetures, autres rendez-vous), refus d'un créneau occupé (409 SLOT_UNAVAILABLE), rejeu
 * idempotent, déplacement et annulation avec version, absence après l'heure, arrivée depuis l'agenda, créneaux libres,
 * liste d'une période, rappels internes (aucun envoi), droits et isolation. Données fictives.
 */
final class AppointmentsTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;

    private const RESPONSE = 'schemas/resources/scheduling.json#/$defs/AppointmentResponse';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_un_rendez_vous_pris_en_ligne_est_confirme_par_le_serveur(): void
    {
        $response = $this->book()->assertCreated();

        $this->assertMatchesContract($response, self::RESPONSE);
        $response->assertJsonPath('data.status', 'CONFIRMED')
            ->assertJsonPath('data.source', 'INTERNAL')
            ->assertJsonPath('data.patient.id', $this->patientId)
            ->assertJsonPath('data.resource_name', 'Salle fictive')
            ->assertJsonPath('data.starts_at', '2026-10-23T07:00:00.000Z')
            ->assertJsonPath('data.visit_id', null)
            ->assertJsonPath('data.version', 1);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'appointment.created')->count());
    }

    public function test_un_creneau_deja_pris_est_refuse_sous_verrou_et_rien_n_est_ecrit(): void
    {
        $this->book()->assertCreated();

        // Chevauchement partiel (08:15–08:45) : refusé, même pour un autre patient.
        $other = $this->seedPatient($this->clinicId, 'Second Fictif');
        $this->book([
            'patient_id' => $other,
            'starts_at' => '2026-10-23T07:15:00.000Z',
            'ends_at' => '2026-10-23T07:45:00.000Z',
        ])->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');

        $this->assertSame(1, DB::table('appointments')->count());
        // Créneau voisin (08:30–09:00) : libre.
        $this->book(['patient_id' => $other, 'starts_at' => '2026-10-23T07:30:00.000Z', 'ends_at' => '2026-10-23T08:00:00.000Z'])->assertCreated();
    }

    public function test_un_creneau_hors_des_horaires_dans_le_passe_ou_sur_une_ressource_inactive_est_refuse(): void
    {
        // 12:30 locale : entre les deux ouvertures du vendredi.
        $this->book(['starts_at' => '2026-10-23T11:30:00.000Z', 'ends_at' => '2026-10-23T12:00:00.000Z'])
            ->assertStatus(422)->assertJsonPath('error.fields.starts_at.0', 'Ce créneau est en dehors des horaires d\'ouverture de la ressource.');
        // Dimanche : aucun créneau.
        $this->book(['starts_at' => '2026-10-25T08:00:00.000Z', 'ends_at' => '2026-10-25T08:30:00.000Z'])->assertStatus(422);
        // Passé.
        $this->book(['starts_at' => '2026-10-21T07:00:00.000Z', 'ends_at' => '2026-10-21T07:30:00.000Z'])->assertStatus(422);
        // Fin avant début.
        $this->book(['starts_at' => '2026-10-23T07:30:00.000Z', 'ends_at' => '2026-10-23T07:00:00.000Z'])->assertStatus(422);
        // Ressource désactivée.
        $inactive = $this->seedResource(null, null, 'Salle fermée', false);
        $this->book(['resource_id' => $inactive])->assertStatus(422)->assertJsonPath('error.fields.resource_id.0', 'Cette ressource de l\'agenda est désactivée.');

        $this->assertSame(0, DB::table('appointments')->count());
    }

    public function test_une_fermeture_exceptionnelle_occupe_le_creneau(): void
    {
        DB::table('resource_exceptions')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23 06:00:00.000000', 'ends_at' => '2026-10-23 12:00:00.000000', 'is_available' => false,
            'reason' => 'Formation fictive', 'created_by' => $this->manager->id,
            'created_at' => '2026-10-01 08:00:00.000000', 'updated_at' => '2026-10-01 08:00:00.000000',
        ]);

        $this->book()->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');
    }

    public function test_un_rejeu_de_la_meme_cle_ne_cree_qu_un_rendez_vous(): void
    {
        $key = Ulid::generate();
        $body = $this->appointmentBody();
        $first = $this->send($this->reception, 'POST', '/api/v1/appointments', $body, $key)->assertCreated();
        $second = $this->send($this->reception, 'POST', '/api/v1/appointments', $body, $key)->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, DB::table('appointments')->count());
    }

    public function test_patient_ressource_et_prestation_d_un_autre_cabinet_sont_refuses(): void
    {
        $other = $this->otherClinic();

        $this->book(['patient_id' => $other['patient']])->assertStatus(422);
        $this->book(['resource_id' => $other['resource']])->assertStatus(422);
        $this->book(['service_id' => $other['service']])->assertStatus(422);
        $this->book(['prospect_contact_id' => Ulid::generate(), 'patient_id' => null])->assertStatus(422);
        $this->assertSame(0, DB::table('appointments')->count());
    }

    public function test_droits_et_module(): void
    {
        $this->book([], $this->cashier)->assertForbidden();
        $this->book([], $this->clinician)->assertCreated();
        $this->read($this->cashier, '/api/v1/appointments?from=2026-10-23&to=2026-10-23')->assertOk();

        config(['eeo.enabled_modules' => ['today', 'patients']]);
        $this->book([], $this->manager)->assertNotFound();
        $this->read($this->manager, '/api/v1/appointments?from=2026-10-23&to=2026-10-23')->assertNotFound();
    }

    public function test_la_liste_d_une_periode_suit_les_jours_civils_du_cabinet(): void
    {
        $this->book()->assertCreated();
        $this->book(['starts_at' => '2026-10-23T08:00:00.000Z', 'ends_at' => '2026-10-23T08:30:00.000Z'])->assertCreated();
        // Lundi 26.
        $this->book(['starts_at' => '2026-10-26T13:00:00.000Z', 'ends_at' => '2026-10-26T13:30:00.000Z'])->assertCreated();

        $friday = $this->read($this->reception, '/api/v1/appointments?from=2026-10-23&to=2026-10-23')->assertOk();
        $this->assertMatchesContract($friday, 'schemas/resources/scheduling.json#/$defs/AppointmentList');
        $this->assertSame(['2026-10-23T07:00:00.000Z', '2026-10-23T08:00:00.000Z'], array_column($friday->json('data'), 'starts_at'));

        $week = $this->read($this->reception, '/api/v1/appointments?from=2026-10-19&to=2026-10-25')->assertOk();
        $this->assertCount(2, $week->json('data'));
        // Grille mensuelle complète (42 jours) admise ; au-delà de 45 jours (46 jours) : 422.
        $monthGrid = $this->read($this->reception, '/api/v1/appointments?from=2026-09-28&to=2026-11-08')->assertOk();
        $this->assertCount(3, $monthGrid->json('data'));
        $this->read($this->reception, '/api/v1/appointments?from=2026-10-01&to=2026-11-15')->assertStatus(422);
        $this->read($this->reception, '/api/v1/appointments?from=2026-10-23')->assertStatus(422);
        $this->read($this->reception, '/api/v1/appointments?from=2026-10-23&to=2026-10-23&resource_id=abc')->assertStatus(422);
    }

    public function test_les_creneaux_libres_excluent_le_passe_et_les_creneaux_occupes(): void
    {
        $this->book()->assertCreated();

        $friday = $this->read($this->reception, '/api/v1/agenda/slots?date=2026-10-23&resource_id='.$this->resourceId.'&service_id='.$this->serviceId)->assertOk();
        $this->assertMatchesContract($friday, 'schemas/resources/scheduling.json#/$defs/AvailableSlotsResponse');
        $starts = array_column($friday->json('data.slots'), 'starts_at');
        $this->assertNotContains('2026-10-23T07:00:00.000Z', $starts, 'créneau pris');
        $this->assertNotContains('2026-10-23T07:15:00.000Z', $starts, 'chevauche le créneau pris');
        $this->assertContains('2026-10-23T07:30:00.000Z', $starts);
        $this->assertContains('2026-10-23T10:30:00.000Z', $starts, 'dernier départ de la matinée (11:30–12:00 locale)');
        $this->assertNotContains('2026-10-23T10:45:00.000Z', $starts, 'dépasserait midi');
        $this->assertContains('2026-10-23T13:00:00.000Z', $starts, 'reprise de 14:00 locale');

        // Aujourd'hui (jeudi, 10:30 locale) : aucun créneau passé.
        $today = $this->read($this->reception, '/api/v1/agenda/slots?date=2026-10-22&resource_id='.$this->resourceId.'&service_id='.$this->serviceId)->assertOk();
        foreach (array_column($today->json('data.slots'), 'starts_at') as $start) {
            $this->assertGreaterThanOrEqual('2026-10-22T09:30:00.000Z', $start);
        }
        // Dimanche : aucun créneau.
        $sunday = $this->read($this->reception, '/api/v1/agenda/slots?date=2026-10-25&resource_id='.$this->resourceId.'&service_id='.$this->serviceId)->assertOk();
        $this->assertSame([], $sunday->json('data.slots'));
    }

    public function test_deplacer_verifie_la_version_et_le_nouveau_creneau_et_garde_l_ancien_dans_l_audit(): void
    {
        $id = $this->book()->assertCreated()->json('data.id');
        $other = $this->seedPatient($this->clinicId, 'Second Fictif');
        $this->book(['patient_id' => $other, 'starts_at' => '2026-10-23T08:00:00.000Z', 'ends_at' => '2026-10-23T08:30:00.000Z'])->assertCreated();

        // Vers un créneau occupé : 409.
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/reschedule", [
            'expected_version' => 1, 'starts_at' => '2026-10-23T08:15:00.000Z', 'ends_at' => '2026-10-23T08:45:00.000Z',
        ])->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');
        // Version périmée : 409 VERSION_CONFLICT.
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/reschedule", [
            'expected_version' => 7, 'starts_at' => '2026-10-23T09:00:00.000Z', 'ends_at' => '2026-10-23T09:30:00.000Z',
        ])->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT');
        // Déplacement sur lui-même décalé de 15 min : il s'ignore lui-même.
        $moved = $this->send($this->reception, 'POST', "/api/v1/appointments/$id/reschedule", [
            'expected_version' => 1, 'starts_at' => '2026-10-23T07:15:00.000Z', 'ends_at' => '2026-10-23T07:45:00.000Z',
        ])->assertOk();
        $this->assertMatchesContract($moved, self::RESPONSE);
        $moved->assertJsonPath('data.starts_at', '2026-10-23T07:15:00.000Z')->assertJsonPath('data.version', 2);

        $audit = DB::table('audit_events')->where('action', 'appointment.rescheduled')->first();
        $this->assertNotNull($audit);
        $this->assertStringContainsString('2026-10-23T07:00:00.000Z', (string) $audit->sanitized_diff);
    }

    public function test_annuler_exige_un_motif_libere_le_creneau_et_n_est_plus_modifiable(): void
    {
        $id = $this->book()->assertCreated()->json('data.id');

        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/cancel", ['expected_version' => 1, 'reason' => 'x'])->assertStatus(422);
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/cancel", ['expected_version' => 1, 'reason' => 'Patient indisponible'])
            ->assertOk()->assertJsonPath('data.status', 'CANCELLED')->assertJsonPath('data.cancel_reason', 'Patient indisponible');

        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/cancel", ['expected_version' => 2, 'reason' => 'Encore'])
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'CANCELLED');
        $this->book()->assertCreated();
    }

    public function test_l_absence_ne_se_constate_qu_apres_l_heure(): void
    {
        $id = $this->book()->assertCreated()->json('data.id');

        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/no-show", ['expected_version' => 1])
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        $this->moveClock('2026-10-23 07:20:00');
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/no-show", ['expected_version' => 1])
            ->assertOk()->assertJsonPath('data.status', 'NO_SHOW');
    }

    public function test_l_arrivee_depuis_l_agenda_passe_le_rendez_vous_arrive_une_seule_fois(): void
    {
        $this->moveClock('2026-10-23 06:50:00');
        $id = $this->book(['starts_at' => '2026-10-23T07:00:00.000Z', 'ends_at' => '2026-10-23T07:30:00.000Z'])->assertCreated()->json('data.id');
        $this->moveClock('2026-10-23 07:02:00');

        $visit = [
            'expected_version' => null, 'visit_id' => Ulid::generate(), 'patient_id' => $this->patientId, 'reason' => 'EXAM',
            'occurred_at' => '2026-10-23T07:02:00.000Z', 'appointment_id' => $id, 'administrative_note' => null,
        ];
        $this->send($this->reception, 'POST', '/api/v1/visits', $visit)->assertCreated();
        $this->assertSame('ARRIVED', DB::table('appointments')->where('id', $id)->value('status'));
        $this->read($this->reception, '/api/v1/appointments?from=2026-10-23&to=2026-10-23')
            ->assertJsonPath('data.0.visit_id', $visit['visit_id']);

        $this->send($this->reception, 'POST', '/api/v1/visits', ['visit_id' => Ulid::generate()] + $visit)->assertStatus(422)
            ->assertJsonPath('error.fields.appointment_id.0', 'L\'arrivée de ce rendez-vous est déjà enregistrée.');
    }

    public function test_les_rappels_internes_suivent_le_rendez_vous_sans_jamais_envoyer(): void
    {
        $this->seedAppointmentPolicy('VEILLE_18H', 'DAY', 1, '18:00:00');
        $this->seedAppointmentPolicy('DEUX_HEURES', 'HOUR', 2);
        $id = $this->book(['starts_at' => '2026-10-26T13:00:00.000Z', 'ends_at' => '2026-10-26T13:30:00.000Z'])->assertCreated()->json('data.id');

        $tasks = DB::table('contact_tasks')->where('appointment_id', $id)->orderBy('due_at')->get();
        $this->assertCount(2, $tasks);
        $this->assertSame('2026-10-25 17:00:00.000000', (string) $tasks[0]->due_at, 'veille à 18:00 locale');
        $this->assertSame('2026-10-26 11:00:00.000000', (string) $tasks[1]->due_at, 'deux heures avant');
        $this->assertSame(['INTERNAL', 'INTERNAL'], array_map(static fn ($task) => $task->channel, $tasks->all()));
        $this->assertSame(0, DB::table('outbox_events')->count(), 'aucun message externe');

        // Déplacé : les anciennes tâches passent CANCELLED, de nouvelles sont créées ; jamais de doublon.
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/reschedule", [
            'expected_version' => 1, 'starts_at' => '2026-10-27T13:00:00.000Z', 'ends_at' => '2026-10-27T13:30:00.000Z',
        ])->assertOk();
        $this->assertSame(2, DB::table('contact_tasks')->where('appointment_id', $id)->where('status', 'CANCELLED')->count());
        $this->assertSame(2, DB::table('contact_tasks')->where('appointment_id', $id)->where('status', 'PENDING')->count());

        // Annulé : plus aucune tâche ouverte.
        $this->send($this->reception, 'POST', "/api/v1/appointments/$id/cancel", ['expected_version' => 2, 'reason' => 'Annulation fictive'])->assertOk();
        $this->assertSame(0, DB::table('contact_tasks')->where('appointment_id', $id)->where('status', 'PENDING')->count());
    }
}

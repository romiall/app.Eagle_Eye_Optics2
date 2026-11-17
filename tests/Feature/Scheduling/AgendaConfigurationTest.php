<?php

namespace Tests\Feature\Scheduling;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Configuration de l'agenda (S01) sur MySQL réel : ressources, créneaux hebdomadaires remplacés en bloc, fermetures
 * exceptionnelles (refusées sur des rendez-vous existants), prestations ; versions attendues, réservé à la gérante,
 * lecture pour tout compte de l'agenda, isolation entre cabinets. Aucun horaire inventé. Données fictives.
 */
final class AgendaConfigurationTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;

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

    public function test_la_configuration_se_lit_par_tout_compte_de_l_agenda_et_jamais_celle_d_un_autre_cabinet(): void
    {
        $this->otherClinic();

        $response = $this->read($this->reception, '/api/v1/agenda/configuration')->assertOk();
        $this->assertMatchesContract($response, 'schemas/resources/scheduling.json#/$defs/AgendaConfigurationResponse');
        $this->assertSame([$this->resourceId], array_column($response->json('data.resources'), 'id'));
        $this->assertCount(11, $response->json('data.resources.0.opening_hours'));
        $this->assertSame([$this->serviceId], array_column($response->json('data.services'), 'id'));

        config(['eeo.enabled_modules' => ['today']]);
        $this->read($this->manager, '/api/v1/agenda/configuration')->assertNotFound();
    }

    public function test_la_gerante_cree_puis_modifie_une_ressource_avec_sa_version(): void
    {
        $id = Ulid::generate();
        $body = ['expected_version' => null, 'resource_id' => $id, 'name' => 'Cabinet 2 fictif', 'professional_user_id' => $this->clinician->id,
            'slot_duration_minutes' => 20, 'active' => true];

        $this->send($this->reception, 'POST', '/api/v1/agenda/resources', $body)->assertForbidden();
        $created = $this->send($this->manager, 'POST', '/api/v1/agenda/resources', $body)->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/scheduling.json#/$defs/SchedulingResourceResponse');
        $created->assertJsonPath('data.professional_name', $this->clinician->display_name)->assertJsonPath('data.opening_hours', []);

        $this->send($this->manager, 'PATCH', "/api/v1/agenda/resources/$id", ['expected_version' => 9] + $body)
            ->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT');
        $this->send($this->manager, 'PATCH', "/api/v1/agenda/resources/$id", ['expected_version' => 1, 'name' => 'Renommée', 'active' => false] + $body)
            ->assertOk()->assertJsonPath('data.name', 'Renommée')->assertJsonPath('data.active', false)->assertJsonPath('data.version', 2);

        $this->send($this->manager, 'POST', '/api/v1/agenda/resources', ['professional_user_id' => Ulid::generate(), 'resource_id' => Ulid::generate()] + $body)
            ->assertStatus(422);
    }

    public function test_les_creneaux_hebdomadaires_se_remplacent_en_bloc_sans_chevauchement(): void
    {
        $uri = "/api/v1/agenda/resources/{$this->resourceId}/opening-hours";
        $overlap = ['expected_version' => 1, 'hours' => [
            ['id' => Ulid::generate(), 'weekday' => 1, 'opens_at' => '08:00', 'closes_at' => '12:00'],
            ['id' => Ulid::generate(), 'weekday' => 1, 'opens_at' => '11:00', 'closes_at' => '13:00'],
        ]];
        $this->send($this->manager, 'POST', $uri, $overlap)->assertStatus(422);
        $this->send($this->manager, 'POST', $uri, ['expected_version' => 1, 'hours' => [
            ['id' => Ulid::generate(), 'weekday' => 2, 'opens_at' => '12:00', 'closes_at' => '12:00'],
        ]])->assertStatus(422);

        $replaced = $this->send($this->manager, 'POST', $uri, ['expected_version' => 1, 'hours' => [
            ['id' => Ulid::generate(), 'weekday' => 2, 'opens_at' => '09:00', 'closes_at' => '13:00'],
        ]])->assertOk();
        $replaced->assertJsonPath('data.version', 2)->assertJsonCount(1, 'data.opening_hours')
            ->assertJsonPath('data.opening_hours.0.opens_at', '09:00');
        $this->assertSame(1, DB::table('resource_opening_hours')->where('resource_id', $this->resourceId)->count());

        // Une liste vide ferme la ressource : aucun horaire par défaut.
        $this->send($this->manager, 'POST', $uri, ['expected_version' => 2, 'hours' => []])->assertOk()->assertJsonPath('data.opening_hours', []);
        $this->read($this->reception, '/api/v1/agenda/slots?date=2026-10-27&resource_id='.$this->resourceId.'&service_id='.$this->serviceId)
            ->assertOk()->assertJsonPath('data.slots', []);
    }

    public function test_une_fermeture_est_refusee_sur_des_rendez_vous_existants_et_motivee(): void
    {
        $this->book()->assertCreated();
        $uri = "/api/v1/agenda/resources/{$this->resourceId}/exceptions";
        $body = ['expected_version' => null, 'exception_id' => Ulid::generate(), 'starts_at' => '2026-10-22T23:00:00.000Z',
            'ends_at' => '2026-10-23T23:00:00.000Z', 'is_available' => false, 'reason' => 'Congé fictif'];

        $this->send($this->manager, 'POST', $uri, $body)->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');
        $this->send($this->manager, 'POST', $uri, ['reason' => 'x'] + $body)->assertStatus(422);

        $created = $this->send($this->manager, 'POST', $uri, ['starts_at' => '2026-10-26T23:00:00.000Z', 'ends_at' => '2026-10-27T23:00:00.000Z'] + $body)->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/scheduling.json#/$defs/ResourceExceptionResponse');
        $this->read($this->reception, '/api/v1/agenda/slots?date=2026-10-27&resource_id='.$this->resourceId.'&service_id='.$this->serviceId)
            ->assertOk()->assertJsonPath('data.slots', []);
    }

    public function test_les_prestations_se_creent_et_se_modifient_par_la_gerante(): void
    {
        $id = Ulid::generate();
        $body = ['expected_version' => null, 'service_id' => $id, 'name' => 'Contrôle fictif', 'duration_minutes' => 20, 'active' => true];

        $this->send($this->clinician, 'POST', '/api/v1/agenda/services', $body)->assertForbidden();
        $this->send($this->manager, 'POST', '/api/v1/agenda/services', $body)->assertCreated()->assertJsonPath('data.duration_minutes', 20);
        $this->send($this->manager, 'PATCH', "/api/v1/agenda/services/$id", ['expected_version' => 1, 'duration_minutes' => 25] + $body)
            ->assertOk()->assertJsonPath('data.duration_minutes', 25)->assertJsonPath('data.version', 2);
        $this->send($this->manager, 'POST', '/api/v1/agenda/services', ['service_id' => Ulid::generate(), 'duration_minutes' => 2] + $body)->assertStatus(422);
    }

    public function test_une_prestation_s_ouvre_a_la_reservation_en_ligne_par_decision_de_la_gerante(): void
    {
        config(['eeo.integrations.default_clinic_id' => $this->clinicId]);
        $id = Ulid::generate();
        $uri = "/api/v1/agenda/services/$id";
        $body = ['expected_version' => null, 'service_id' => $id, 'name' => 'Examen en ligne fictif', 'duration_minutes' => 20, 'active' => true];
        $publicIds = fn (): array => array_column($this->getJson('/public/v1/services')->assertOk()->json('data'), 'id');

        // Fermée par défaut : le public ne la voit pas, et la réponse respecte le contrat.
        $created = $this->send($this->manager, 'POST', '/api/v1/agenda/services', $body)->assertCreated()->assertJsonPath('data.public_booking', false);
        $this->assertMatchesContract($created, 'schemas/resources/scheduling.json#/$defs/AppointmentServiceResponse');
        $this->assertNotContains($id, $publicIds());

        // Ouverte par la gérante : elle apparaît, avec sa seule identité publique (ni prix, ni donnée clinique).
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 1, 'public_booking' => true] + $body)
            ->assertOk()->assertJsonPath('data.public_booking', true);
        $this->assertContains($id, $publicIds());
        foreach ($this->getJson('/public/v1/services')->json('data') as $row) {
            $keys = array_keys($row);
            sort($keys);
            $this->assertSame(['duration_minutes', 'id', 'name'], $keys);
        }

        // Un ancien client qui n'envoie pas le champ ne la ferme pas.
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 2, 'duration_minutes' => 25] + $body)
            ->assertOk()->assertJsonPath('data.public_booking', true)->assertJsonPath('data.duration_minutes', 25);

        // Désactivée, elle quitte le public même ouverte ; réactivée, elle revient.
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 3, 'active' => false] + $body)->assertOk();
        $this->assertNotContains($id, $publicIds());
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 4] + $body)->assertOk();
        $this->assertContains($id, $publicIds());

        // Refermée : le public ne la voit plus, et l'audit garde l'avant et l'après.
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 5, 'public_booking' => false] + $body)
            ->assertOk()->assertJsonPath('data.public_booking', false);
        $this->assertNotContains($id, $publicIds());
        $after = json_decode((string) DB::table('audit_events')->where('target_type', 'appointment_services')->where('target_id', $id)
            ->where('action', 'agenda.service_updated')->orderByDesc('recorded_at')->orderByDesc('id')->value('sanitized_diff'), true);
        $this->assertTrue($after['before']['public_booking']);
        $this->assertFalse($after['after']['public_booking']);

        // Un champ qui n'existe pas est refusé (contrat strict).
        $this->send($this->manager, 'PATCH', $uri, ['expected_version' => 6, 'public_booking' => 'oui'] + $body)->assertStatus(422);
        $this->send($this->clinician, 'PATCH', $uri, ['expected_version' => 6, 'public_booking' => true] + $body)->assertForbidden();
    }
}

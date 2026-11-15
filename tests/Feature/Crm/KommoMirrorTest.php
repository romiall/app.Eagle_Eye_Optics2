<?php

namespace Tests\Feature\Crm;

use App\Domain\Crm\CrmOutboxConsumer;
use App\Domain\Crm\CrmWebhookConsumer;
use App\Domain\Shared\Ulid;
use App\Support\Integrations\Kommo\FakeKommoClient;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\SendsIdempotencyKeys;
use Tests\TestCase;

/**
 * Prospects administratifs et miroir Kommo CRM (L2D03) : CRUD + verrou optimiste sur prospects,
 * rattachement explicite à un dossier patient du même cabinet (404 inter-cabinet), synchronisation
 * idempotente via `FakeKommoClient`, consommation d'outbox et webhooks sans fuite clinique.
 */
final class KommoMirrorTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;
    use SendsIdempotencyKeys;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda(['agenda', 'today', 'patients', 'communication', 'settings']);
        config(['eeo.integrations.mode' => 'fake']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_prospect_crud_optimistic_locking_and_patient_link_cross_clinic_isolation(): void
    {
        // Création par l'accueil (`agenda.write` autorisé) sans ouvrir de dossier clinique.
        $create = $this->actingAsFresh($this->reception)->postJson('/api/v1/crm/prospects', [
            'name' => 'Clarisse Tchoumi',
            'phone' => '+237 699 00 11 22',
            'email' => 'clarisse.tchoumi@example.invalid',
            'origin' => 'WEBSITE',
            'administrative_notes' => 'Souhaite des renseignements sur les montures en titane.',
        ]);

        $create->assertCreated();
        $this->assertMatchesContract($create, 'schemas/resources/communication.json#/$defs/ProspectContactResponse');
        $prospectId = (string) $create->json('data.id');
        $this->assertSame(1, $create->json('data.version'));
        $this->assertNull($create->json('data.patient_id'));

        // Recherche par nom et par numéro normalisé.
        $searchByPhone = $this->actingAsFresh($this->reception)->getJson('/api/v1/crm/prospects?query=699001122');
        $searchByPhone->assertOk();
        $this->assertMatchesContract($searchByPhone, 'schemas/resources/communication.json#/$defs/ProspectContactPage');
        $this->assertCount(1, $searchByPhone->json('data'));
        $this->assertSame($prospectId, $searchByPhone->json('data.0.id'));

        // Mise à jour avec verrou optimiste + refus sur version obsolète (409 VERSION_CONFLICT).
        $update = $this->actingAsFresh($this->manager)->patchJson('/api/v1/crm/prospects/'.$prospectId, [
            'expected_version' => 1,
            'name' => 'Clarisse Tchoumi-Ndi',
            'administrative_notes' => 'Préfère être rappelée le matin.',
        ]);
        $update->assertOk();
        $this->assertMatchesContract($update, 'schemas/resources/communication.json#/$defs/ProspectContactResponse');
        $this->assertSame(2, $update->json('data.version'));

        $staleUpdate = $this->actingAsFresh($this->manager)->patchJson('/api/v1/crm/prospects/'.$prospectId, [
            'expected_version' => 1,
            'name' => 'Collision',
        ]);
        $staleUpdate->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT');

        // Rattachement cross-clinic refusé en 404.
        $otherClinicId = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinicId, 'MANAGER', 'gerante.b');
        $otherPatientId = $this->seedPatient($otherClinicId);
        $crossClinicLink = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/prospects/'.$prospectId.'/link-patient', [
            'patient_id' => $otherPatientId,
        ]);
        $crossClinicLink->assertNotFound();

        // Rattachement explicite à un patient du même cabinet + audit.
        $link = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/prospects/'.$prospectId.'/link-patient', [
            'patient_id' => $this->patientId,
        ]);
        $link->assertOk();
        $this->assertMatchesContract($link, 'schemas/resources/communication.json#/$defs/ProspectContactResponse');
        $this->assertSame($this->patientId, $link->json('data.patient_id'));
        $this->assertSame(3, $link->json('data.version'));

        $this->assertDatabaseHas('audit_events', [
            'clinic_id' => $this->clinicId,
            'action' => 'prospect.linked_patient',
            'target_id' => $prospectId,
        ]);

        // Un utilisateur d'un autre cabinet ne voit aucun prospect ni ne peut modifier celui du cabinet A.
        $this->actingAsFresh($otherManager)->getJson('/api/v1/crm/prospects')
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->actingAsFresh($otherManager)->patchJson('/api/v1/crm/prospects/'.$prospectId, [
            'expected_version' => 3,
            'name' => 'Intrus',
        ])->assertNotFound();
    }

    public function test_kommo_sync_is_idempotent_and_handles_webhooks_and_outbox_without_clinical_data(): void
    {
        // Sans compte Kommo configuré -> 404.
        $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/leads/sync', [])
            ->assertNotFound();

        $accountId = $this->seedKommoAccount($this->clinicId, $this->manager->id);

        // Premier sync en mode `fake` : crée 2 prospects, 2 leads, 2 conversations et les liens externes.
        $sync1 = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/leads/sync', ['limit' => 25]);
        $sync1->assertOk();
        $this->assertMatchesContract($sync1, 'schemas/resources/communication.json#/$defs/CrmLeadSyncResultResponse');
        $this->assertSame(['synced' => 2, 'created' => 2, 'updated' => 0, 'conflicts' => 0], $sync1->json('data'));

        // Rejeu immédiat -> idempotent (0 création, 0 mise à jour parasite).
        $sync2 = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/leads/sync', []);
        $sync2->assertOk();
        $this->assertMatchesContract($sync2, 'schemas/resources/communication.json#/$defs/CrmLeadSyncResultResponse');
        $this->assertSame(['synced' => 2, 'created' => 0, 'updated' => 0, 'conflicts' => 0], $sync2->json('data'));

        $this->assertSame(2, DB::table('crm_leads')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(2, DB::table('crm_conversations')->where('clinic_id', $this->clinicId)->count());
        $this->assertSame(2, DB::table('external_links')->where('clinic_id', $this->clinicId)->where('external_entity_type', 'KOMMO_LEAD')->count());

        // Lecture des pistes et conversations avec validation stricte des contrats.
        $leadsPage = $this->actingAsFresh($this->manager)->getJson('/api/v1/crm/leads?status=OPEN');
        $leadsPage->assertOk();
        $this->assertMatchesContract($leadsPage, 'schemas/resources/communication.json#/$defs/CrmLeadPage');
        $this->assertCount(2, $leadsPage->json('data'));

        $convsPage = $this->actingAsFresh($this->manager)->getJson('/api/v1/crm/conversations?status=BOT_ACTIVE');
        $convsPage->assertOk();
        $this->assertMatchesContract($convsPage, 'schemas/resources/communication.json#/$defs/CrmConversationPage');
        $this->assertCount(2, $convsPage->json('data'));

        $convId = (string) $convsPage->json('data.0.id');
        $convDetail = $this->actingAsFresh($this->manager)->getJson('/api/v1/crm/conversations/'.$convId);
        $convDetail->assertOk();
        $this->assertMatchesContract($convDetail, 'schemas/resources/communication.json#/$defs/CrmConversationResponse');

        // Webhook entrant Kommo + Meta WhatsApp consommés de façon idempotente.
        /** @var CrmWebhookConsumer $webhookConsumer */
        $webhookConsumer = $this->app->make(CrmWebhookConsumer::class);
        $this->assertTrue($webhookConsumer->supports('KOMMO'));
        $this->assertTrue($webhookConsumer->supports('META_WHATSAPP'));

        $firstExtLeadId = (string) $leadsPage->json('data.0.external_lead_id');
        $firstProspectId = (string) $leadsPage->json('data.0.prospect_contact_id');

        $webhookConsumer->handle($this->clinicId, $accountId, 'KOMMO', [
            'leads' => [
                'update' => [[
                    'id' => $firstExtLeadId,
                    'pipeline_stage' => 'RDV_SOUHAITE',
                    'status' => 'OPEN',
                    'price' => 90000,
                    'prospect' => ['name' => 'Amina Njoya'],
                    'updated_at' => '1761125400',
                ]],
            ],
        ]);
        $this->assertDatabaseHas('crm_leads', [
            'clinic_id' => $this->clinicId,
            'external_lead_id' => $firstExtLeadId,
            'pipeline_stage' => 'RDV_SOUHAITE',
        ]);

        // Consommateur outbox : confirmation d'un rendez-vous rattaché à un prospect pousse le statut administratif.
        /** @var CrmOutboxConsumer $outboxConsumer */
        $outboxConsumer = $this->app->make(CrmOutboxConsumer::class);
        $this->assertTrue($outboxConsumer->supports('AppointmentConfirmed'));

        $fakeKommo = new FakeKommoClient;
        $this->app->instance(FakeKommoClient::class, $fakeKommo);

        $outboxRow = (object) [
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'event_type' => 'AppointmentConfirmed',
        ];
        $outboxConsumer->handle($outboxRow, [
            'appointment_id' => Ulid::generate(),
            'patient_id' => null,
            'prospect_contact_id' => $firstProspectId,
            'resource_id' => $this->resourceId,
            'service_id' => $this->serviceId,
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'ends_at' => '2026-10-23T08:30:00.000Z',
            'source' => 'WEB',
        ]);

        $this->assertDatabaseHas('crm_leads', [
            'clinic_id' => $this->clinicId,
            'external_lead_id' => $firstExtLeadId,
            'status' => 'APPOINTMENT_BOOKED',
        ]);
        $updates = $fakeKommo->recordedUpdates();
        $this->assertCount(1, $updates);
        $this->assertSame('APPOINTMENT_BOOKED', $updates[0]['status']);
        $this->assertSame('RDV_CONFIRME', $updates[0]['pipeline_stage']);

        // Un compte sans `communication.manage` ni `integration.manage` est refusé (403).
        $this->actingAsFresh($this->cashier)->getJson('/api/v1/crm/leads')->assertForbidden();
        $this->actingAsFresh($this->cashier)->postJson('/api/v1/crm/leads/sync', [])->assertForbidden();
    }

    private function seedKommoAccount(string $clinicId, string $configuredBy, string $status = 'ACTIVE'): string
    {
        $id = Ulid::generate();
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
        DB::table('integration_accounts')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'provider' => 'KOMMO',
            'external_account_id' => 'kommo-demo',
            'display_name' => 'Kommo Cabinet Test',
            'credentials_ciphertext' => null,
            'encryption_key_id' => null,
            'token_expires_at' => null,
            'status' => $status,
            'public_configuration' => null,
            'configured_by' => $configuredBy,
            'version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }
}

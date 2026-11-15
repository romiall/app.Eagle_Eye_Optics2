<?php

namespace Tests\Feature\Scheduling;

use App\Domain\Scheduling\CalendarOutboxConsumer;
use App\Domain\Scheduling\CalendarWebhookConsumer;
use App\Domain\Shared\Ulid;
use App\Http\Controllers\Api\V1\GoogleCalendarController;
use App\Http\Controllers\PublicBookingController;
use App\Models\User;
use App\Support\Integrations\GoogleCalendar\CalendarTokenCipher;
use App\Support\Integrations\GoogleCalendar\FakeGoogleCalendarClient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class GoogleCalendarAndPublicBookingTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    protected function setUp(): void
    {
        parent::setUp();

        // Routes temporaires strictement limitées aux tests (routes/* intact).
        Route::middleware(['api', 'throttle:eeo-public-booking'])->prefix('public/v1')->group(function (): void {
            Route::get('services', [PublicBookingController::class, 'services']);
            Route::get('slots', [PublicBookingController::class, 'slots']);
            Route::post('booking-requests', [PublicBookingController::class, 'store']);
        });

        Route::middleware(['api', 'auth:sanctum', 'active'])->prefix('api/v1')->group(function (): void {
            Route::get('integrations/google/states', [GoogleCalendarController::class, 'states']);
            Route::post('integrations/google/states', [GoogleCalendarController::class, 'saveState']);
            Route::post('integrations/google/sync', [GoogleCalendarController::class, 'sync']);
            Route::get('public-bookings', [PublicBookingController::class, 'index']);
            Route::post('public-bookings/{id}/confirm', [PublicBookingController::class, 'confirm'])->whereUlid('id');
            Route::post('public-bookings/{id}/reject', [PublicBookingController::class, 'reject'])->whereUlid('id');
        });
    }

    public function test_appointment_handlers_emit_sanitized_contract_outbox_events_when_communication_enabled(): void
    {
        $this->bootAgenda(['agenda', 'today', 'patients', 'consultations', 'communication']);

        $firstId = $this->book([
            'starts_at' => '2026-10-23T09:00:00.000Z',
            'ends_at' => '2026-10-23T09:30:00.000Z',
            'administrative_reason' => 'Contrôle administratif semestriel',
        ])->assertCreated()->json('data.id');

        $this->send($this->reception, 'POST', "/api/v1/appointments/{$firstId}/reschedule", [
            'expected_version' => 1,
            'starts_at' => '2026-10-23T10:00:00.000Z',
            'ends_at' => '2026-10-23T10:30:00.000Z',
        ])->assertOk();

        $this->send($this->reception, 'POST', "/api/v1/appointments/{$firstId}/cancel", [
            'expected_version' => 2,
            'reason' => 'Empêchement personnel signalé',
        ])->assertOk();

        $secondId = $this->book([
            'starts_at' => '2026-10-23T13:00:00.000Z',
            'ends_at' => '2026-10-23T13:30:00.000Z',
        ])->assertCreated()->json('data.id');

        $this->moveClock('2026-10-23 13:10:00');
        $this->send($this->reception, 'POST', "/api/v1/appointments/{$secondId}/no-show", [
            'expected_version' => 1,
        ])->assertOk();

        $events = DB::table('outbox_events')
            ->where('clinic_id', $this->clinicId)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->all();

        $types = array_map(static fn (object $row): string => (string) $row->event_type, $events);
        $this->assertSame([
            'AppointmentConfirmed',
            'AppointmentRescheduled',
            'AppointmentCancelled',
            'AppointmentConfirmed',
            'AppointmentNoShow',
        ], $types);

        foreach ($events as $row) {
            $decoded = json_decode((string) $row->payload, false, 512, JSON_THROW_ON_ERROR);
            $this->assertDataMatchesContract($decoded, 'events/'.$row->event_type.'.v1.json');

            $asArray = json_decode((string) $row->payload, true, 512, JSON_THROW_ON_ERROR);
            foreach (['clinical', 'diagnosis', 'acuity', 'prescription', 'notes', 'administrative_reason', 'cancel_reason'] as $forbidden) {
                $this->assertArrayNotHasKey($forbidden, $asArray);
            }
        }
    }

    public function test_google_calendar_sync_pushes_sanitized_events_encrypts_sync_token_pulls_blocks_and_detects_conflicts(): void
    {
        $this->bootAgenda(['agenda', 'today', 'patients', 'consultations', 'communication']);
        $accountId = $this->seedGoogleAccount($this->clinicId, $this->manager);

        // La réception (agenda.read uniquement) peut lire les états mais pas configurer la liaison (403).
        $this->read($this->reception, '/api/v1/integrations/google/states')->assertOk();
        $this->send($this->reception, 'POST', '/api/v1/integrations/google/states', [
            'integration_account_id' => $accountId,
            'resource_id' => $this->resourceId,
            'external_calendar_id' => 'cabinet-optique-salle-1@group.calendar.google.com',
        ])->assertStatus(403);

        $saveResponse = $this->send($this->manager, 'POST', '/api/v1/integrations/google/states', [
            'integration_account_id' => $accountId,
            'resource_id' => $this->resourceId,
            'external_calendar_id' => 'cabinet-optique-salle-1@group.calendar.google.com',
        ])->assertCreated();
        $this->assertMatchesContract($saveResponse, 'schemas/resources/communication.json#/$defs/CalendarSyncStateResponse');
        $saveJson = $saveResponse->json('data');
        $this->assertArrayNotHasKey('sync_token_ciphertext', $saveJson);
        $this->assertArrayNotHasKey('token_encryption_key_id', $saveJson);

        $listResponse = $this->read($this->manager, '/api/v1/integrations/google/states')->assertOk();
        $this->assertMatchesContract($listResponse, 'schemas/resources/communication.json#/$defs/CalendarSyncStateList');

        // Création d'un rendez-vous contenant des notes administratives sensibles qui ne doivent jamais sortir.
        $appointmentId = $this->book([
            'starts_at' => '2026-10-23T09:00:00.000Z',
            'ends_at' => '2026-10-23T09:30:00.000Z',
            'administrative_reason' => 'Douleur glaucome dioptrie confidentielle',
        ])->assertCreated()->json('data.id');

        $syncResponse = $this->send($this->manager, 'POST', '/api/v1/integrations/google/sync', [
            'resource_id' => $this->resourceId,
            'full_resync' => false,
        ], 'sync-run-1')->assertOk();
        $this->assertMatchesContract($syncResponse, 'schemas/resources/communication.json#/$defs/CalendarSyncRunResultResponse');
        $this->assertSame(1, $syncResponse->json('data.synced_states'));
        $this->assertSame(1, $syncResponse->json('data.pushed_appointments'));
        $this->assertSame(0, $syncResponse->json('data.conflicts'));
        $this->assertSame('READY', $syncResponse->json('data.states.0.status'));

        /** @var FakeGoogleCalendarClient $fake */
        $fake = app(FakeGoogleCalendarClient::class);
        $pushed = $fake->pushedEvents('cabinet-optique-salle-1@group.calendar.google.com');
        $this->assertCount(1, $pushed);
        $this->assertSame($appointmentId, $pushed[0]['appointment_id']);
        $this->assertStringNotContainsString('glaucome', strtolower($pushed[0]['summary']));
        $this->assertStringNotContainsString('douleur', strtolower($pushed[0]['summary']));
        $this->assertStringContainsString('RDV-', $pushed[0]['summary']);

        // Le jeton de synchronisation est chiffré par libsodium en base et déchiffrable par le helper local.
        $storedState = DB::table('calendar_sync_states')->where('id', $saveJson['id'])->first();
        $this->assertNotNull($storedState);
        $this->assertNotNull($storedState->sync_token_ciphertext);
        $this->assertStringNotContainsString('fake-sync-', (string) $storedState->sync_token_ciphertext);
        $decrypted = app(CalendarTokenCipher::class)->decrypt((string) $storedState->sync_token_ciphertext);
        $this->assertStringStartsWith('fake-sync-', $decrypted);

        // Rejeu idempotent exact et détection de conflit sur même clé avec payload différent.
        $replay = $this->send($this->manager, 'POST', '/api/v1/integrations/google/sync', [
            'resource_id' => $this->resourceId,
            'full_resync' => false,
        ], 'sync-run-1')->assertOk();
        $this->assertSame($syncResponse->json('data.pushed_appointments'), $replay->json('data.pushed_appointments'));

        $this->send($this->manager, 'POST', '/api/v1/integrations/google/sync', [
            'resource_id' => $this->resourceId,
            'full_resync' => true,
        ], 'sync-run-1')->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_PAYLOAD_MISMATCH');

        // Simulation d'expiration 410 du syncToken + ajout d'un bloc distant libre et d'un bloc en chevauchement.
        $fake->expireSyncTokenFor('cabinet-optique-salle-1@group.calendar.google.com');
        $fake->seedRemoteEvent('cabinet-optique-salle-1@group.calendar.google.com', [
            'external_event_id' => 'gcal-busy-free-slot',
            'summary' => 'Réunion externe optométrie',
            'starts_at' => '2026-10-23T13:00:00.000Z',
            'ends_at' => '2026-10-23T14:00:00.000Z',
        ]);
        $fake->seedRemoteEvent('cabinet-optique-salle-1@group.calendar.google.com', [
            'external_event_id' => 'gcal-conflict-overlap',
            'summary' => 'Indisponibilité personnelle',
            'starts_at' => '2026-10-23T09:15:00.000Z',
            'ends_at' => '2026-10-23T09:45:00.000Z',
        ]);

        $conflictSync = $this->send($this->manager, 'POST', '/api/v1/integrations/google/sync', [
            'resource_id' => $this->resourceId,
            'full_resync' => false,
        ], 'sync-run-2')->assertOk();
        $this->assertMatchesContract($conflictSync, 'schemas/resources/communication.json#/$defs/CalendarSyncRunResultResponse');
        $this->assertGreaterThanOrEqual(2, $conflictSync->json('data.pulled_blocks'));
        $this->assertGreaterThanOrEqual(1, $conflictSync->json('data.conflicts'));
        $this->assertSame('STALE', $conflictSync->json('data.states.0.status'));

        $this->assertSame('CONFLICT', DB::table('external_links')
            ->where('clinic_id', $this->clinicId)
            ->where('external_entity_id', 'gcal-conflict-overlap')
            ->value('status'));
        $this->assertSame('SYNCED', DB::table('external_links')
            ->where('clinic_id', $this->clinicId)
            ->where('external_entity_id', 'gcal-busy-free-slot')
            ->value('status'));
        $this->assertSame(2, DB::table('calendar_blocks')->where('clinic_id', $this->clinicId)->where('origin', 'GOOGLE')->count());
    }

    public function test_outbox_and_webhook_consumers_trigger_incremental_calendar_sync(): void
    {
        $this->bootAgenda(['agenda', 'today', 'patients', 'consultations', 'communication']);
        $accountId = $this->seedGoogleAccount($this->clinicId, $this->manager);

        $this->send($this->manager, 'POST', '/api/v1/integrations/google/states', [
            'integration_account_id' => $accountId,
            'resource_id' => $this->resourceId,
            'external_calendar_id' => 'cal-consumer@group.calendar.google.com',
        ])->assertCreated();

        $this->book([
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'ends_at' => '2026-10-23T08:30:00.000Z',
        ])->assertCreated();

        $outboxRow = DB::table('outbox_events')
            ->where('clinic_id', $this->clinicId)
            ->where('event_type', 'AppointmentConfirmed')
            ->first();
        $this->assertNotNull($outboxRow);

        /** @var CalendarOutboxConsumer $outboxConsumer */
        $outboxConsumer = app(CalendarOutboxConsumer::class);
        $this->assertTrue($outboxConsumer->supports('AppointmentConfirmed'));
        $this->assertFalse($outboxConsumer->supports('InvoiceIssued'));

        /** @var array<string, mixed> $eventPayload */
        $eventPayload = json_decode((string) $outboxRow->payload, true, 512, JSON_THROW_ON_ERROR);
        $outboxConsumer->handle($outboxRow, $eventPayload);

        /** @var FakeGoogleCalendarClient $fake */
        $fake = app(FakeGoogleCalendarClient::class);
        $this->assertCount(1, $fake->pushedEvents('cal-consumer@group.calendar.google.com'));

        $fake->seedRemoteEvent('cal-consumer@group.calendar.google.com', [
            'external_event_id' => 'gcal-webhook-block',
            'summary' => 'Blocage reçu via webhook',
            'starts_at' => '2026-10-23T14:00:00.000Z',
            'ends_at' => '2026-10-23T15:00:00.000Z',
        ]);

        /** @var CalendarWebhookConsumer $webhookConsumer */
        $webhookConsumer = app(CalendarWebhookConsumer::class);
        $this->assertTrue($webhookConsumer->supports('GOOGLE'));
        $this->assertFalse($webhookConsumer->supports('KOMMO'));
        $webhookConsumer->handle($this->clinicId, $accountId, 'GOOGLE', [
            'external_calendar_id' => 'cal-consumer@group.calendar.google.com',
        ]);

        $this->assertDatabaseHas('calendar_blocks', [
            'clinic_id' => $this->clinicId,
            'resource_id' => $this->resourceId,
            'origin' => 'GOOGLE',
            'label' => 'Blocage reçu via webhook',
        ]);
    }

    public function test_public_booking_portal_prevents_enumeration_double_book_and_confirms_safely(): void
    {
        $this->bootAgenda(['agenda', 'today', 'patients', 'consultations', 'communication']);
        config(['eeo.integrations.default_clinic_id' => $this->clinicId]);

        DB::table('appointment_services')
            ->where('clinic_id', $this->clinicId)
            ->where('id', $this->serviceId)
            ->update(['public_booking' => true]);

        // Prestation interne privée ne devant jamais apparaître sur le portail public.
        $privateServiceId = $this->seedService(45, $this->clinicId, true);

        // Patient existant avec téléphone connu : le portail ne doit ni lier ni révéler son existence.
        $knownPhone = '+237690112233';
        DB::table('patient_records')
            ->where('clinic_id', $this->clinicId)
            ->where('id', $this->patientId)
            ->update([
                'phone_primary' => $knownPhone,
                'phone_primary_normalized' => '+237690112233',
            ]);

        // Bloc Google Calendar entre 10:00 et 11:00 UTC (l'agenda du vendredi 2026-10-23 est ouvert 08:00-17:00 Africa/Douala = 07:00-16:00 UTC).
        DB::table('calendar_blocks')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23 10:00:00.000000',
            'ends_at' => '2026-10-23 11:00:00.000000',
            'origin' => 'GOOGLE',
            'label' => 'Absence Google',
            'external_link_id' => null,
            'created_by' => null,
            'created_at' => '2026-10-20 08:00:00.000000',
            'updated_at' => '2026-10-20 08:00:00.000000',
        ]);

        $servicesResp = $this->getJson('/public/v1/services')->assertOk();
        $this->assertMatchesContract($servicesResp, 'schemas/resources/public.json#/$defs/PublicServiceList');
        $serviceIds = array_column($servicesResp->json('data'), 'id');
        $this->assertContains($this->serviceId, $serviceIds);
        $this->assertNotContains($privateServiceId, $serviceIds);

        $slotsResp = $this->getJson('/public/v1/slots?service_id='.$this->serviceId.'&from=2026-10-23T07:00:00.000Z&to=2026-10-23T13:00:00.000Z')
            ->assertOk();
        $this->assertMatchesContract($slotsResp, 'schemas/resources/public.json#/$defs/PublicSlotList');
        $slotStarts = array_column($slotsResp->json('data'), 'starts_at');
        $this->assertContains('2026-10-23T08:00:00.000Z', $slotStarts);
        $this->assertNotContains('2026-10-23T10:00:00.000Z', $slotStarts, 'Bloc Google 10:00-11:00 exclu');
        $this->assertNotContains('2026-10-23T10:30:00.000Z', $slotStarts, 'Bloc Google 10:00-11:00 exclu');

        // Consentement explicite exigé.
        $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'name' => 'Jean Prospect',
            'phone' => $knownPhone,
            'consent' => false,
        ], 'pub-key-bad-consent')->assertStatus(422);

        // Réservation avec numéro identique à un patient existant : même reçu neutre, patient_id reste null.
        $knownResp = $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'name' => 'Patient Existant Web',
            'phone' => '+237 690 11 22 33',
            'email' => 'prospect@example.test',
            'consent' => true,
        ], 'pub-key-1')->assertCreated();
        $this->assertMatchesContract($knownResp, 'schemas/resources/public.json#/$defs/BookingReceiptResponse');

        // Numéro inconnu sur un autre créneau : structure et statut identiques (aucune fuite d'existence).
        $unknownResp = $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => null,
            'starts_at' => '2026-10-23T09:00:00.000Z',
            'name' => 'Inconnu Web',
            'phone' => '+237699887766',
            'consent' => true,
        ], 'pub-key-2')->assertCreated();
        $this->assertMatchesContract($unknownResp, 'schemas/resources/public.json#/$defs/BookingReceiptResponse');
        $this->assertSame($knownResp->json('data.status'), $unknownResp->json('data.status'));
        $this->assertSame(array_keys($knownResp->json('data')), array_keys($unknownResp->json('data')));

        $prospectForKnown = DB::table('prospect_contacts')
            ->where('clinic_id', $this->clinicId)
            ->where('phone_normalized', '+237690112233')
            ->first();
        $this->assertNotNull($prospectForKnown);
        $this->assertNull($prospectForKnown->patient_id);
        $this->assertSame('WEBSITE', $prospectForKnown->origin);

        // Rejeu idempotent exact -> même référence publique, sans doublon.
        $replay = $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'name' => 'Patient Existant Web',
            'phone' => '+237 690 11 22 33',
            'email' => 'prospect@example.test',
            'consent' => true,
        ], 'pub-key-1')->assertCreated();
        $this->assertSame($knownResp->json('data.public_reference'), $replay->json('data.public_reference'));

        // Même clé avec autre créneau -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH.
        $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23T13:30:00.000Z',
            'name' => 'Patient Existant Web',
            'phone' => '+237 690 11 22 33',
            'email' => 'prospect@example.test',
            'consent' => true,
        ], 'pub-key-1')->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_PAYLOAD_MISMATCH');

        // Anti-double-réservation avec une autre clé sur le créneau déjà demandé 08:00-08:30.
        $this->publicPost('/public/v1/booking-requests', [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => '2026-10-23T08:00:00.000Z',
            'name' => 'Autre Visiteur',
            'phone' => '+237655443322',
            'consent' => true,
        ], 'pub-key-double-book')->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');

        // Vérification événement outbox PublicBookingRequested.
        $publicEvent = DB::table('outbox_events')
            ->where('clinic_id', $this->clinicId)
            ->where('event_type', 'PublicBookingRequested')
            ->orderBy('created_at')
            ->first();
        $this->assertNotNull($publicEvent);
        $this->assertDataMatchesContract(
            json_decode((string) $publicEvent->payload, false, 512, JSON_THROW_ON_ERROR),
            'events/PublicBookingRequested.v1.json',
        );

        // Liste back-office et confirmation en vrai rendez-vous.
        $adminList = $this->read($this->reception, '/api/v1/public-bookings?status=PENDING')->assertOk();
        $this->assertMatchesContract($adminList, 'schemas/resources/communication.json#/$defs/PublicBookingAdminPage');
        $this->assertCount(2, $adminList->json('data'));

        $firstBookingRow = DB::table('public_booking_requests')
            ->where('clinic_id', $this->clinicId)
            ->where('public_reference', $knownResp->json('data.public_reference'))
            ->first();
        $this->assertNotNull($firstBookingRow);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', (string) $firstBookingRow->management_token_hash);

        $confirmResp = $this->send($this->reception, 'POST', "/api/v1/public-bookings/{$firstBookingRow->id}/confirm", [
            'resource_id' => $this->resourceId,
            'reason' => 'Confirmation accueil téléphonique',
        ], 'confirm-1')->assertOk();
        $this->assertMatchesContract($confirmResp, 'schemas/resources/communication.json#/$defs/PublicBookingAdminResponse');
        $this->assertSame('CONFIRMED', $confirmResp->json('data.status'));
        $appointmentId = $confirmResp->json('data.appointment_id');
        $this->assertNotNull($appointmentId);

        $this->assertDatabaseHas('appointments', [
            'id' => $appointmentId,
            'clinic_id' => $this->clinicId,
            'prospect_contact_id' => $prospectForKnown->id,
            'patient_id' => null,
            'source' => 'WEBSITE',
            'status' => 'CONFIRMED',
        ]);

        // Une demande déjà confirmée refuse une seconde confirmation (409).
        $this->send($this->reception, 'POST', "/api/v1/public-bookings/{$firstBookingRow->id}/confirm", [], 'confirm-again')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        // Rejet de la deuxième demande (libère son créneau).
        $secondBookingRow = DB::table('public_booking_requests')
            ->where('clinic_id', $this->clinicId)
            ->where('public_reference', $unknownResp->json('data.public_reference'))
            ->first();
        $this->assertNotNull($secondBookingRow);

        $rejectResp = $this->send($this->reception, 'POST', "/api/v1/public-bookings/{$secondBookingRow->id}/reject", [
            'reason' => 'Demandeur injoignable',
        ], 'reject-2')->assertOk();
        $this->assertMatchesContract($rejectResp, 'schemas/resources/communication.json#/$defs/PublicBookingAdminResponse');
        $this->assertSame('REJECTED', $rejectResp->json('data.status'));

        // Isolation inter-cabinets : un utilisateur d'un autre cabinet ne voit ni ne modifie ces demandes.
        $otherClinic = $this->otherClinic();
        $otherManager = User::query()->where('clinic_id', $otherClinic['clinic'])->firstOrFail();
        $this->send($otherManager, 'POST', "/api/v1/public-bookings/{$firstBookingRow->id}/reject", [
            'reason' => 'Tentative inter-cabinet',
        ], 'cross-clinic-reject')->assertStatus(404);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function publicPost(string $uri, array $body, string $idempotencyKey): TestResponse
    {
        return $this->withHeaders(['Idempotency-Key' => $idempotencyKey])
            ->postJson($uri, $body);
    }

    private function seedGoogleAccount(string $clinicId, User $actor): string
    {
        $accountId = Ulid::generate();
        $now = '2026-10-20 08:00:00.000000';

        DB::table('integration_accounts')->insert([
            'id' => $accountId,
            'clinic_id' => $clinicId,
            'provider' => 'GOOGLE',
            'external_account_id' => 'google-workspace-clinic-1',
            'display_name' => 'Google Workspace Cabinet',
            'credentials_ciphertext' => null,
            'encryption_key_id' => null,
            'token_expires_at' => null,
            'status' => 'ACTIVE',
            'public_configuration' => null,
            'configured_by' => (string) $actor->getKey(),
            'version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $accountId;
    }
}

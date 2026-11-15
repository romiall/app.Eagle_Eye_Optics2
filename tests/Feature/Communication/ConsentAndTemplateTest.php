<?php

declare(strict_types=1);

namespace Tests\Feature\Communication;

use App\Domain\Communication\CommunicationOutboxConsumer;
use App\Domain\Shared\Ulid;
use App\Http\Controllers\Api\V1\CampaignController;
use App\Http\Controllers\Api\V1\CommunicationController;
use App\Models\User;
use App\Support\Integrations\Messaging\FakeMessagingClient;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Support\AccessFixtures;
use Tests\Support\ApprovalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientFixtures;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class ConsentAndTemplateTest extends TestCase
{
    use AccessFixtures;
    use ApprovalFixtures;
    use MigratedDatabase;
    use PatientFixtures;
    use ValidatesContracts;

    protected string $clinicId;

    protected User $manager;

    protected User $reception;

    protected string $patientId;

    protected string $smsAccountId;

    protected function setUp(): void
    {
        parent::setUp();

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:30:00', 'UTC'));
        config(['eeo.enabled_modules' => ['communication', 'agenda', 'patients']]);
        $this->app->singleton(FakeMessagingClient::class);
        $this->registerCommunicationRoutes();

        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->reception = $this->makeStaff($this->clinicId, 'RECEPTION', 'accueil.test');
        $this->patientId = $this->seedPatient($this->clinicId);
        $this->smsAccountId = $this->seedSmsAccount($this->clinicId);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_consent_append_only_ledger_masks_destination_and_increments_sequence(): void
    {
        $grant = $this->write('POST', '/api/v1/communication/consents', [
            'patient_id' => $this->patientId,
            'prospect_contact_id' => null,
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
            'destination' => '690 00 12 34',
            'proof' => 'Formulaire signé accueil #104',
            'policy_version' => 'rgpd-2026-v1',
        ], $this->manager);

        $grant->assertCreated();
        $this->assertMatchesContract($grant, 'schemas/resources/communication.json#/$defs/CommunicationConsentResponse');
        self::assertSame('GRANTED', $grant->json('data.status'));
        self::assertSame(1, $grant->json('data.event_sequence'));
        self::assertSame('+237 6** *** **34', $grant->json('data.destination_masked'));
        self::assertStringNotContainsString('690001234', (string) $grant->getContent());

        // Révocation immédiate -> event_sequence passe à 2 (aucune suppression/mise à jour).
        $revoke = $this->write('POST', '/api/v1/communication/consents/revoke', [
            'patient_id' => $this->patientId,
            'prospect_contact_id' => null,
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
            'destination' => '+237690001234',
            'proof' => 'Demande orale guichet',
            'policy_version' => 'rgpd-2026-v1',
        ], $this->manager);

        $revoke->assertCreated();
        $this->assertMatchesContract($revoke, 'schemas/resources/communication.json#/$defs/CommunicationConsentResponse');
        self::assertSame('REVOKED', $revoke->json('data.status'));
        self::assertSame(2, $revoke->json('data.event_sequence'));

        self::assertSame(2, DB::table('communication_consents')->where('clinic_id', $this->clinicId)->count());

        $list = $this->read('/api/v1/communication/consents?patient_id='.$this->patientId, $this->manager);
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/CommunicationConsentPage');
        self::assertCount(2, $list->json('data'));
        self::assertSame(25, $list->json('meta.per_page'));
    }

    public function test_templates_reject_clinical_variables_enforce_idempotency_and_approve(): void
    {
        // Réception sans permission communication.manage -> 403.
        $forbidden = $this->write('POST', '/api/v1/communication/templates', [
            'code' => 'RAPPEL_RDV',
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
        ], $this->reception);
        $forbidden->assertForbidden();

        $key = Ulid::generate();
        $body = ['code' => 'RAPPEL_RDV', 'channel' => 'SMS', 'purpose' => 'APPOINTMENT'];
        $created = $this->write('POST', '/api/v1/communication/templates', $body, $this->manager, $key);
        $created->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/communication.json#/$defs/MessageTemplateResponse');
        $templateId = (string) $created->json('data.id');

        // Rejeu idempotent identique -> même ressource.
        $replay = $this->write('POST', '/api/v1/communication/templates', $body, $this->manager, $key);
        $replay->assertCreated();
        self::assertSame($templateId, $replay->json('data.id'));

        // Même clé avec charge différente -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH.
        $mismatch = $this->write('POST', '/api/v1/communication/templates', [
            'code' => 'AUTRE_CODE',
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
        ], $this->manager, $key);
        $mismatch->assertStatus(409);
        self::assertSame('IDEMPOTENCY_PAYLOAD_MISMATCH', $mismatch->json('error.code'));

        // Variable clinique interdite -> 422.
        $clinical = $this->write('POST', '/api/v1/communication/templates/'.$templateId.'/versions', [
            'body' => 'Bonjour {{first_name}}, résultat {{diagnosis}}',
            'allowed_variables' => ['first_name', 'diagnosis'],
        ], $this->manager);
        $clinical->assertStatus(422);

        // Révision valide + approbation.
        $version = $this->write('POST', '/api/v1/communication/templates/'.$templateId.'/versions', [
            'language' => 'fr',
            'body' => 'Bonjour {{first_name}}, rendez-vous le {{appointment_date}}.',
            'allowed_variables' => ['first_name', 'appointment_date'],
        ], $this->manager);
        $version->assertCreated();
        $this->assertMatchesContract($version, 'schemas/resources/communication.json#/$defs/MessageTemplateVersionResponse');
        self::assertSame('DRAFT', $version->json('data.provider_approval_status'));
        $versionId = (string) $version->json('data.id');

        $approved = $this->write('POST', '/api/v1/communication/templates/versions/'.$versionId.'/approve', [
            'reason' => 'Validation texte administratif',
        ], $this->manager);
        $approved->assertOk();
        $this->assertMatchesContract($approved, 'schemas/resources/communication.json#/$defs/MessageTemplateVersionResponse');
        self::assertSame('APPROVED', $approved->json('data.provider_approval_status'));

        $list = $this->read('/api/v1/communication/templates', $this->manager);
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/MessageTemplateList');
        self::assertTrue($list->json('data.0.active'));
    }

    public function test_reminder_policies_version_conflict_and_outbox_task_materialization_idempotency(): void
    {
        $created = $this->write('POST', '/api/v1/communication/reminder-policies', [
            'code' => 'RDV_VEILLE',
            'label' => 'Rappel veille du rendez-vous',
            'purpose' => 'APPOINTMENT',
            'channel' => 'SMS',
            'offset_unit' => 'DAY',
            'offset_value' => -1,
            'local_send_time' => '18:00',
            'active' => true,
        ], $this->manager);
        $created->assertCreated();
        $this->assertMatchesContract($created, 'schemas/resources/communication.json#/$defs/ReminderPolicyResponse');
        $policyId = (string) $created->json('data.id');

        // Version conflict (expected_version = 99) -> 409 VERSION_CONFLICT.
        $conflict = $this->write('PATCH', '/api/v1/communication/reminder-policies/'.$policyId, [
            'expected_version' => 99,
            'label' => 'Modifié',
        ], $this->manager);
        $conflict->assertStatus(409);
        self::assertSame('VERSION_CONFLICT', $conflict->json('error.code'));

        $updated = $this->write('PATCH', '/api/v1/communication/reminder-policies/'.$policyId, [
            'expected_version' => 1,
            'label' => 'Rappel administratif J-1',
        ], $this->manager);
        $updated->assertOk();
        $this->assertMatchesContract($updated, 'schemas/resources/communication.json#/$defs/ReminderPolicyResponse');
        self::assertSame(2, $updated->json('data.version'));

        $list = $this->read('/api/v1/communication/reminder-policies', $this->manager);
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/ReminderPolicyList');

        // Création d'un rendez-vous puis consommation idempotente d'AppointmentConfirmed via CommunicationOutboxConsumer.
        $resourceId = Ulid::generate();
        $serviceId = Ulid::generate();
        $nowDb = '2026-10-22 09:30:00.000000';
        DB::table('scheduling_resources')->insert([
            'id' => $resourceId,
            'clinic_id' => $this->clinicId,
            'name' => 'Salle A',
            'slot_duration_minutes' => 15,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);
        DB::table('appointment_services')->insert([
            'id' => $serviceId,
            'clinic_id' => $this->clinicId,
            'name' => 'Contrôle administratif',
            'duration_minutes' => 30,
            'active' => 1,
            'public_booking' => 0,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);
        $appointmentId = Ulid::generate();
        DB::table('appointments')->insert([
            'id' => $appointmentId,
            'clinic_id' => $this->clinicId,
            'patient_id' => $this->patientId,
            'prospect_contact_id' => null,
            'follow_up_id' => null,
            'resource_id' => $resourceId,
            'service_id' => $serviceId,
            'starts_at' => '2026-10-25 09:00:00.000000',
            'ends_at' => '2026-10-25 09:30:00.000000',
            'status' => 'CONFIRMED',
            'source' => 'INTERNAL',
            'created_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        /** @var CommunicationOutboxConsumer $consumer */
        $consumer = $this->app->make(CommunicationOutboxConsumer::class);
        self::assertTrue($consumer->supports('AppointmentConfirmed'));
        $outboxRow = (object) [
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'event_type' => 'AppointmentConfirmed',
            'event_version' => 1,
            'source_type' => 'appointments',
            'source_id' => $appointmentId,
            'source_version' => 1,
            'correlation_id' => Ulid::generate(),
            'created_at' => $nowDb,
        ];
        $payload = [
            'patient_id' => $this->patientId,
            'starts_at' => '2026-10-25T09:00:00.000Z',
        ];

        $consumer->handle($outboxRow, $payload);
        $consumer->handle($outboxRow, $payload);

        self::assertSame(1, DB::table('contact_tasks')->where('clinic_id', $this->clinicId)->where('appointment_id', $appointmentId)->count());
    }

    public function test_cross_clinic_isolation_returns_404(): void
    {
        $otherClinic = $this->makeClinic();
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'autre.gerante.test');
        $otherSms = $this->seedSmsAccount($otherClinic);

        $tpl = $this->write('POST', '/api/v1/communication/templates', [
            'code' => 'OTHER_TPL',
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
        ], $otherManager);
        $tpl->assertCreated();
        $otherTemplateId = (string) $tpl->json('data.id');

        $this->write('POST', '/api/v1/communication/templates/'.$otherTemplateId.'/versions', [
            'integration_account_id' => $otherSms,
            'body' => 'Bonjour',
            'allowed_variables' => [],
        ], $this->manager)->assertNotFound();
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function write(string $method, string $uri, array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->manager)
            ->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->json($method, $uri, $body);
    }

    protected function read(string $uri, ?User $as = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->manager)->getJson($uri);
    }

    private function seedSmsAccount(string $clinicId): string
    {
        $id = Ulid::generate();
        $nowDb = '2026-10-22 09:30:00.000000';
        $configuredBy = (string) DB::table('users')->where('clinic_id', $clinicId)->value('id');
        DB::table('integration_accounts')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'provider' => 'SMS',
            'external_account_id' => 'sms-test-'.substr($id, -6),
            'display_name' => 'Passerelle SMS Test',
            'credentials_ciphertext' => null,
            'encryption_key_id' => null,
            'token_expires_at' => null,
            'status' => 'TEST',
            'public_configuration' => null,
            'configured_by' => $configuredBy,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        return $id;
    }

    private function registerCommunicationRoutes(): void
    {
        Route::prefix('api/v1')
            ->middleware(['api', 'auth:sanctum', 'active', 'module:communication'])
            ->group(function (): void {
                Route::get('communication/consents', [CommunicationController::class, 'listConsents']);
                Route::post('communication/consents', [CommunicationController::class, 'storeConsent']);
                Route::post('communication/consents/revoke', [CommunicationController::class, 'revokeConsent']);
                Route::get('communication/templates', [CommunicationController::class, 'listTemplates']);
                Route::post('communication/templates', [CommunicationController::class, 'storeTemplate']);
                Route::post('communication/templates/{id}/versions', [CommunicationController::class, 'storeTemplateVersion'])->whereUlid('id');
                Route::post('communication/templates/versions/{id}/approve', [CommunicationController::class, 'approveTemplateVersion'])->whereUlid('id');
                Route::get('communication/reminder-policies', [CommunicationController::class, 'listReminderPolicies']);
                Route::post('communication/reminder-policies', [CommunicationController::class, 'storeReminderPolicy']);
                Route::patch('communication/reminder-policies/{id}', [CommunicationController::class, 'updateReminderPolicy'])->whereUlid('id');
                Route::get('communication/attempts', [CommunicationController::class, 'listAttempts']);
                Route::post('communication/tasks/{id}/send', [CommunicationController::class, 'sendTaskMessage'])->whereUlid('id');
                Route::post('communication/attempts/{id}/reconcile', [CommunicationController::class, 'reconcileAttempt'])->whereUlid('id');
                Route::get('communication/segments', [CampaignController::class, 'listSegments']);
                Route::post('communication/segments', [CampaignController::class, 'storeSegment']);
                Route::patch('communication/segments/{id}', [CampaignController::class, 'updateSegment'])->whereUlid('id');
            });

        Route::getRoutes()->refreshNameLookups();
        Route::getRoutes()->refreshActionLookups();
    }
}

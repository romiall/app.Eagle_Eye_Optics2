<?php

declare(strict_types=1);

namespace Tests\Feature\Communication;

use App\Domain\Communication\MessagingWebhookConsumer;
use App\Domain\Shared\Ulid;
use App\Models\User;
use App\Support\Integrations\Messaging\FakeMessagingClient;
use App\Support\Integrations\Messaging\ProviderDeliveryStatus;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\AccessFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientFixtures;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class TransactionalMessagingTest extends TestCase
{
    use AccessFixtures;
    use MigratedDatabase;
    use PatientFixtures;
    use ValidatesContracts;

    protected string $clinicId;

    protected User $manager;

    protected string $patientId;

    protected string $smsAccountId;

    protected string $appointmentId;

    protected string $taskId;

    protected string $draftVersionId;

    protected string $approvedVersionId;

    protected function setUp(): void
    {
        parent::setUp();

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:30:00', 'UTC'));
        config(['eeo.enabled_modules' => ['communication', 'agenda', 'patients']]);
        $this->app->singleton(FakeMessagingClient::class);

        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->patientId = $this->seedPatient($this->clinicId, 'Ndi', 'Paul', ['phone_primary' => '690001122', 'phone_primary_normalized' => '690001122']);
        $this->smsAccountId = $this->seedSmsAccount($this->clinicId);
        $this->appointmentId = $this->seedAppointment($this->clinicId, $this->patientId);
        $this->taskId = $this->seedContactTask($this->clinicId, $this->patientId, $this->appointmentId);

        $tpl = $this->write('POST', '/api/v1/communication/templates', [
            'code' => 'CONF_RDV_SMS',
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
        ])->assertCreated();
        $tplId = (string) $tpl->json('data.id');

        $draft = $this->write('POST', '/api/v1/communication/templates/'.$tplId.'/versions', [
            'body' => 'Bonjour {{first_name}}, rendez-vous le {{appointment_date}} à {{appointment_time}}.',
            'allowed_variables' => ['first_name', 'appointment_date', 'appointment_time'],
        ])->assertCreated();
        $this->draftVersionId = (string) $draft->json('data.id');

        $approved = $this->write('POST', '/api/v1/communication/templates/'.$tplId.'/versions', [
            'body' => 'Bonjour {{first_name}}, votre rendez-vous du {{appointment_date}} à {{appointment_time}} est confirmé.',
            'allowed_variables' => ['first_name', 'appointment_date', 'appointment_time'],
        ])->assertCreated();
        $this->approvedVersionId = (string) $approved->json('data.id');

        $this->write('POST', '/api/v1/communication/templates/versions/'.$this->approvedVersionId.'/approve', [
            'reason' => 'Approuvé pour envoi',
        ])->assertOk();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_blocks_unapproved_template_and_missing_or_revoked_consent_and_dedupes_send(): void
    {
        /** @var FakeMessagingClient $fake */
        $fake = $this->app->make(FakeMessagingClient::class);

        // 1. Modèle non approuvé -> 409.
        $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->draftVersionId,
            'channel' => 'SMS',
        ])->assertStatus(409);

        // 2. Sans consentement -> 409, aucun message envoyé.
        $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ])->assertStatus(409);
        self::assertCount(0, $fake->sent());

        // 3. Consentement accordé -> envoi réussi (201).
        $this->write('POST', '/api/v1/communication/consents', [
            'patient_id' => $this->patientId,
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
            'destination' => '+237690001122',
            'proof' => 'Signature accueil',
        ])->assertCreated();

        $send = $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ]);
        $send->assertCreated();
        $this->assertMatchesContract($send, 'schemas/resources/communication.json#/$defs/MessageAttemptResponse');
        self::assertSame('SUBMITTED', $send->json('data.status'));
        self::assertCount(1, $fake->sent());
        $attemptId = (string) $send->json('data.id');
        $providerMsgId = (string) $send->json('data.provider_message_id');

        // 4. Deduplication : nouvel appel avec une AUTRE clé d'idempotence ne double-envoie jamais !
        $deduped = $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ]);
        $deduped->assertCreated();
        self::assertSame($attemptId, $deduped->json('data.id'));
        self::assertCount(1, $fake->sent());

        // 5. Réconciliation statut fournisseur -> DELIVERED.
        $fake->setStatus($providerMsgId, new ProviderDeliveryStatus(
            status: 'DELIVERED',
            providerMessageId: $providerMsgId,
            deliveredAt: CarbonImmutable::parse('2026-10-22 09:32:00', 'UTC'),
        ));
        $reconciled = $this->write('POST', '/api/v1/communication/attempts/'.$attemptId.'/reconcile', [
            'reason' => 'Contrôle livraison',
        ]);
        $reconciled->assertOk();
        $this->assertMatchesContract($reconciled, 'schemas/resources/communication.json#/$defs/MessageAttemptResponse');
        self::assertSame('DELIVERED', $reconciled->json('data.status'));
        self::assertNotNull($reconciled->json('data.delivered_at'));

        // 6. Liste des tentatives conforme au contrat.
        $list = $this->read('/api/v1/communication/attempts?task_id='.$this->taskId);
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/MessageAttemptPage');
        self::assertCount(1, $list->json('data'));
    }

    public function test_webhook_updates_read_status_and_stop_keyword_triggers_immediate_opt_out(): void
    {
        $this->write('POST', '/api/v1/communication/consents', [
            'patient_id' => $this->patientId,
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
            'destination' => '+237690001122',
            'proof' => 'Consentement guichet',
        ])->assertCreated();

        $send = $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ])->assertCreated();
        $attemptId = (string) $send->json('data.id');
        $providerMsgId = (string) $send->json('data.provider_message_id');

        /** @var MessagingWebhookConsumer $webhook */
        $webhook = $this->app->make(MessagingWebhookConsumer::class);
        self::assertTrue($webhook->supports('SMS'));

        // Webhook lecture + mot-clé STOP.
        $webhook->handle($this->clinicId, $this->smsAccountId, 'SMS', [
            'statuses' => [
                ['id' => $providerMsgId, 'status' => 'READ'],
            ],
            'messages' => [
                ['from' => '690001122', 'text' => 'STOP'],
            ],
        ]);

        $attemptRow = DB::table('message_attempts')->where('id', $attemptId)->first();
        self::assertSame('READ', $attemptRow?->status);
        self::assertNotNull($attemptRow?->read_at);

        // Le patient a maintenant un événement REVOKED en séquence 2 : une nouvelle tâche ne peut plus être envoyée.
        $secondTaskId = $this->seedContactTask($this->clinicId, $this->patientId, $this->appointmentId);
        $blocked = $this->write('POST', '/api/v1/communication/tasks/'.$secondTaskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ]);
        $blocked->assertStatus(409);
        self::assertSame('STATE_TRANSITION_REFUSED', $blocked->json('error.code'));
    }

    public function test_failed_provider_attempt_is_recorded_and_can_be_retried(): void
    {
        $this->write('POST', '/api/v1/communication/consents', [
            'patient_id' => $this->patientId,
            'channel' => 'SMS',
            'purpose' => 'APPOINTMENT',
            'destination' => '+237690001122',
            'proof' => 'Opt-in test',
        ])->assertCreated();

        /** @var FakeMessagingClient $fake */
        $fake = $this->app->make(FakeMessagingClient::class);
        $fake->forceNextFailure('CARRIER_TIMEOUT');

        $failed = $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ])->assertCreated();
        self::assertSame('FAILED', $failed->json('data.status'));
        self::assertSame('CARRIER_TIMEOUT', $failed->json('data.error_code'));
        self::assertSame(1, $failed->json('data.attempt_no'));

        $retried = $this->write('POST', '/api/v1/communication/tasks/'.$this->taskId.'/send', [
            'template_version_id' => $this->approvedVersionId,
            'channel' => 'SMS',
        ])->assertCreated();
        self::assertSame('SUBMITTED', $retried->json('data.status'));
        self::assertSame(2, $retried->json('data.attempt_no'));
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
        DB::table('integration_accounts')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'provider' => 'SMS',
            'external_account_id' => 'sms-test-acc',
            'display_name' => 'Passerelle SMS',
            'credentials_ciphertext' => null,
            'encryption_key_id' => null,
            'token_expires_at' => null,
            'status' => 'TEST',
            'public_configuration' => null,
            'configured_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        return $id;
    }

    private function seedAppointment(string $clinicId, string $patientId): string
    {
        $nowDb = '2026-10-22 09:30:00.000000';
        $resourceId = Ulid::generate();
        $serviceId = Ulid::generate();
        DB::table('scheduling_resources')->insert([
            'id' => $resourceId,
            'clinic_id' => $clinicId,
            'name' => 'Bureau 1',
            'slot_duration_minutes' => 15,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);
        DB::table('appointment_services')->insert([
            'id' => $serviceId,
            'clinic_id' => $clinicId,
            'name' => 'Rendez-vous',
            'duration_minutes' => 30,
            'active' => 1,
            'public_booking' => 0,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);
        $id = Ulid::generate();
        DB::table('appointments')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'patient_id' => $patientId,
            'prospect_contact_id' => null,
            'follow_up_id' => null,
            'resource_id' => $resourceId,
            'service_id' => $serviceId,
            'starts_at' => '2026-10-24 09:00:00.000000',
            'ends_at' => '2026-10-24 09:30:00.000000',
            'status' => 'CONFIRMED',
            'source' => 'INTERNAL',
            'created_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        return $id;
    }

    private function seedContactTask(string $clinicId, string $patientId, string $appointmentId): string
    {
        $id = Ulid::generate();
        $nowDb = '2026-10-22 09:30:00.000000';
        DB::table('contact_tasks')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'patient_id' => $patientId,
            'prospect_contact_id' => null,
            'follow_up_id' => null,
            'appointment_id' => $appointmentId,
            'invoice_id' => null,
            'workshop_order_id' => null,
            'policy_id' => null,
            'source_version' => 1,
            'due_at' => '2026-10-23 17:00:00.000000',
            'channel' => 'SMS',
            'status' => 'PENDING',
            'next_attempt_at' => null,
            'assigned_to' => null,
            'dedupe_key' => 'TASK-MANUAL:'.$id,
            'administrative_notes' => 'Rappel administratif',
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        return $id;
    }
}

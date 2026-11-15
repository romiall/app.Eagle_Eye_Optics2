<?php

namespace Tests\Feature\Integrations;

use App\Domain\Operations\IntegrationAccounts;
use App\Domain\Operations\OutboxProcessor;
use App\Domain\Shared\Ulid;
use App\Models\User;
use App\Support\Integrations\Contracts\OutboxConsumerInterface;
use App\Support\Integrations\IntegrationCrypto;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use stdClass;
use Tests\Support\AccessFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class IntegrationHealthAndOutboxTest extends TestCase
{
    use AccessFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    private string $clinicId;

    private string $otherClinicId;

    private User $manager;

    private User $otherManager;

    private User $receptionist;

    protected function setUp(): void
    {
        parent::setUp();

        $this->clinicId = $this->makeClinic('CABINET INTEGRATIONS A');
        $this->otherClinicId = $this->makeClinic('CABINET INTEGRATIONS B');
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'integ.manager.a');
        $this->otherManager = $this->makeStaff($this->otherClinicId, 'MANAGER', 'integ.manager.b');
        $this->receptionist = $this->makeStaff($this->clinicId, 'RECEPTION', 'integ.reception.a');
    }

    public function test_crypto_round_trip_hash_and_mask_destination(): void
    {
        $crypto = app(IntegrationCrypto::class);

        $fallbackEncrypted = $crypto->encryptJson(['secret' => 'fallback-value']);
        $this->assertSame(['secret' => 'fallback-value'], $crypto->decryptJson($fallbackEncrypted['ciphertext']));

        $key = 'base64:'.base64_encode(random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES));
        config()->set('eeo.integrations.credentials_key', $key);
        config()->set('eeo.integrations.destination_hash_salt', 'salt-testing-secret');

        $this->assertTrue($crypto->isConfigured());

        $encrypted = $crypto->encryptJson(['app_secret' => 's3cr3t', 'verify_token' => 'vt-1']);
        $this->assertStringStartsWith('v1:', $encrypted['ciphertext']);
        $this->assertStringNotContainsString('s3cr3t', $encrypted['ciphertext']);
        $this->assertSame(
            ['app_secret' => 's3cr3t', 'verify_token' => 'vt-1'],
            $crypto->decryptJson($encrypted['ciphertext']),
        );

        $hash1 = $crypto->hashDestination('+212612345678');
        $hash2 = $crypto->hashDestination('+212612345678');
        $this->assertSame($hash1, $hash2);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}\z/', $hash1);
        $this->assertNotSame($hash1, $crypto->hashDestination('+212612345679'));

        $maskedEmail = $crypto->maskDestination('sara.benali@example.com');
        $this->assertStringContainsString('@example.com', $maskedEmail);
        $this->assertStringNotContainsString('sara.benali', $maskedEmail);

        $maskedPhone = $crypto->maskDestination('+212612345678');
        $this->assertStringStartsWith('+212', $maskedPhone);
        $this->assertStringEndsWith('78', $maskedPhone);
        $this->assertStringNotContainsString('123456', $maskedPhone);
    }

    public function test_account_crud_secret_non_disclosure_optimistic_lock_and_cross_clinic_isolation(): void
    {
        $this->actingAsFresh($this->receptionist)
            ->getJson('/api/v1/integrations/health')
            ->assertStatus(403);

        // Création ou modification sans réauthentification récente -> 423 REAUTHENTICATION_REQUIRED
        $this->actingAsFresh($this->manager)
            ->postJson('/api/v1/integrations/accounts', [
                'provider' => 'META_WHATSAPP',
                'external_account_id' => 'waba-reauth',
                'display_name' => 'Sans réauth',
            ])
            ->assertStatus(423)
            ->assertJsonPath('error.code', 'REAUTHENTICATION_REQUIRED');

        $createResponse = $this->actingAsReauthenticated($this->manager)->postJson('/api/v1/integrations/accounts', [
            'provider' => 'META_WHATSAPP',
            'external_account_id' => 'waba-001',
            'display_name' => 'WhatsApp Principal',
            'status' => 'ACTIVE',
            'credentials' => [
                'app_secret' => 'meta-super-secret-value',
                'verify_token' => 'meta-verify-token-secret',
            ],
            'public_configuration' => [],
        ]);

        $createResponse->assertStatus(201);
        $this->assertMatchesContract($createResponse, 'schemas/resources/communication.json#/$defs/IntegrationAccountResponse');

        $rawContent = $createResponse->getContent();
        $this->assertIsString($rawContent);
        $this->assertStringNotContainsString('meta-super-secret-value', $rawContent);
        $this->assertStringNotContainsString('meta-verify-token-secret', $rawContent);
        $this->assertStringNotContainsString('credentials_ciphertext', $rawContent);
        $this->assertStringContainsString('"public_configuration":{}', $rawContent);

        $accountId = (string) $createResponse->json('data.id');
        $this->assertTrue((bool) $createResponse->json('data.has_credentials'));
        $this->assertSame(1, (int) $createResponse->json('data.version'));

        // Vérifier le stockage chiffré réel et la non-exposition dans les journaux d'audit
        $dbAccount = DB::table('integration_accounts')->where('id', $accountId)->first();
        $this->assertNotNull($dbAccount);
        $this->assertIsString($dbAccount->credentials_ciphertext);
        $this->assertStringNotContainsString('meta-super-secret-value', $dbAccount->credentials_ciphertext);

        $decrypted = app(IntegrationAccounts::class)->decryptCredentials($dbAccount);
        $this->assertSame('meta-super-secret-value', $decrypted['app_secret']);

        $auditRows = DB::table('audit_events')->where('target_id', $accountId)->get();
        $this->assertGreaterThanOrEqual(1, $auditRows->count());
        foreach ($auditRows as $auditRow) {
            $encoded = json_encode($auditRow);
            $this->assertIsString($encoded);
            $this->assertStringNotContainsString('meta-super-secret-value', $encoded);
            $this->assertStringNotContainsString('meta-verify-token-secret', $encoded);
        }

        // Liste & santé
        $listResponse = $this->actingAsFresh($this->manager)->getJson('/api/v1/integrations/accounts')->assertOk();
        $this->assertMatchesContract($listResponse, 'schemas/resources/communication.json#/$defs/IntegrationAccountList');
        $this->assertCount(1, $listResponse->json('data'));

        $healthResponse = $this->actingAsFresh($this->manager)->getJson('/api/v1/integrations/health')->assertOk();
        $this->assertMatchesContract($healthResponse, 'schemas/resources/communication.json#/$defs/IntegrationHealthResponse');
        $healthResponse->assertJsonPath('data.accounts_total', 1)
            ->assertJsonPath('data.accounts_active', 1)
            ->assertJsonPath('data.accounts_error', 0);

        // Mise à jour valide puis conflit de version (409 VERSION_CONFLICT)
        $updateResponse = $this->actingAsReauthenticated($this->manager)->patchJson('/api/v1/integrations/accounts/'.$accountId, [
            'expected_version' => 1,
            'display_name' => 'WhatsApp Clinique Principale',
            'status' => 'TEST',
        ])->assertOk();
        $this->assertMatchesContract($updateResponse, 'schemas/resources/communication.json#/$defs/IntegrationAccountResponse');
        $updateResponse->assertJsonPath('data.version', 2);

        $conflictResponse = $this->actingAsReauthenticated($this->manager)->patchJson('/api/v1/integrations/accounts/'.$accountId, [
            'expected_version' => 1,
            'display_name' => 'Collision Version',
        ])->assertStatus(409);
        $this->assertMatchesContract($conflictResponse, 'schemas/error.json');
        $conflictResponse->assertJsonPath('error.code', 'VERSION_CONFLICT');

        // Sonde fake puis live HTTP
        $fakeTest = $this->actingAsFresh($this->manager)
            ->postJson('/api/v1/integrations/accounts/'.$accountId.'/test')
            ->assertOk();
        $this->assertMatchesContract($fakeTest, 'schemas/resources/communication.json#/$defs/IntegrationConnectionTestResponse');
        $fakeTest->assertJsonPath('data.reachable', true)->assertJsonPath('data.mode', 'fake');

        Http::fake(['graph.facebook.com/*' => Http::response(['id' => 'ok'], 200)]);
        config()->set('eeo.integrations.mode', 'live');
        $liveTest = $this->actingAsFresh($this->manager)
            ->postJson('/api/v1/integrations/accounts/'.$accountId.'/test')
            ->assertOk();
        $this->assertMatchesContract($liveTest, 'schemas/resources/communication.json#/$defs/IntegrationConnectionTestResponse');
        $liveTest->assertJsonPath('data.reachable', true)->assertJsonPath('data.mode', 'live');

        config()->set('eeo.integrations.mode', 'disabled');
        $this->actingAsFresh($this->manager)
            ->postJson('/api/v1/integrations/accounts/'.$accountId.'/test')
            ->assertStatus(503)
            ->assertJsonPath('error.code', 'DEPENDENCY_UNAVAILABLE');
        config()->set('eeo.integrations.mode', 'fake');

        // Isolation inter-cliniques (404 + listes vides pour autre clinique)
        $this->actingAsReauthenticated($this->otherManager)
            ->patchJson('/api/v1/integrations/accounts/'.$accountId, [
                'expected_version' => 2,
                'display_name' => 'Hack Autre Clinique',
            ])
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'RESOURCE_NOT_FOUND');

        $this->actingAsFresh($this->otherManager)
            ->postJson('/api/v1/integrations/accounts/'.$accountId.'/test')
            ->assertStatus(404);

        $this->actingAsFresh($this->otherManager)
            ->getJson('/api/v1/integrations/accounts')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_outbox_processing_idempotency_exponential_backoff_and_cli_command(): void
    {
        config()->set('eeo.integrations.outbox_max_attempts', 3);

        $okEventId = $this->insertOutboxEvent($this->clinicId, 'message.queued', ['message_id' => 'm1']);
        $failEventId = $this->insertOutboxEvent($this->clinicId, 'message.failing', ['message_id' => 'm2']);
        $otherEventId = $this->insertOutboxEvent($this->otherClinicId, 'message.queued', ['message_id' => 'm3']);

        $handledOkIds = [];
        $okConsumer = new class($handledOkIds) implements OutboxConsumerInterface
        {
            /** @param array<int, string> $handled */
            public function __construct(private array &$handled) {}

            public function supports(string $eventType): bool
            {
                return $eventType === 'message.queued';
            }

            public function handle(stdClass $outboxRow, array $payload): void
            {
                $this->handled[] = (string) $outboxRow->id;
            }
        };

        $failingConsumer = new class implements OutboxConsumerInterface
        {
            public function supports(string $eventType): bool
            {
                return $eventType === 'message.failing';
            }

            public function handle(stdClass $outboxRow, array $payload): void
            {
                throw new RuntimeException('SMTP temporairement indisponible');
            }
        };

        /** @var OutboxProcessor $processor */
        $processor = app(OutboxProcessor::class);
        $processor->addConsumer($okConsumer);
        $processor->addConsumer($failingConsumer);
        $this->app->instance(OutboxProcessor::class, $processor);

        $frozenNow = CarbonImmutable::now('UTC');
        CarbonImmutable::setTestNow($frozenNow);

        try {
            // Lot 1 via HTTP : ok -> PROCESSED, fail -> PENDING (tentative 1 + backoff)
            $batch1 = $this->actingAsFresh($this->manager)
                ->postJson('/api/v1/integrations/outbox/process', ['limit' => 50])
                ->assertOk();
            $this->assertMatchesContract($batch1, 'schemas/resources/communication.json#/$defs/OutboxBatchResultResponse');
            $batch1->assertJsonPath('data.processed', 1)->assertJsonPath('data.failed', 1);

            $this->assertSame([$okEventId], $handledOkIds);

            // Idempotence sur événement déjà PROCESSED
            $this->assertSame('already_processed', $processor->processEvent($this->clinicId, $okEventId));
            $this->assertCount(1, $handledOkIds);

            $okRow = DB::table('outbox_events')->where('id', $okEventId)->first();
            $this->assertNotNull($okRow);
            $this->assertSame('PROCESSED', $okRow->status);
            $this->assertNotNull($okRow->processed_at);

            $attempt1 = DB::table('outbox_events')->where('id', $failEventId)->first();
            $this->assertNotNull($attempt1);
            $this->assertSame('PENDING', $attempt1->status);
            $this->assertSame(1, (int) $attempt1->attempt_count);
            $this->assertNotNull($attempt1->next_attempt_at);
            $backoff1Seconds = CarbonImmutable::parse((string) $attempt1->updated_at, 'UTC')->diffInSeconds(
                CarbonImmutable::parse((string) $attempt1->next_attempt_at, 'UTC'),
                false,
            );
            $this->assertSame(10.0, round($backoff1Seconds, 2));

            // Tant que next_attempt_at est dans le futur, l'événement n'est pas retraité
            $noopBatch = $processor->processBatch($this->clinicId, 50);
            $this->assertSame(0, $noopBatch['processed']);
            $this->assertSame(0, $noopBatch['failed']);

            // Simule l'échéance du backoff pour tentative 2 -> backoff plus long
            CarbonImmutable::setTestNow($frozenNow->addSeconds(11));

            $processor->processBatch($this->clinicId, 50);
            $attempt2 = DB::table('outbox_events')->where('id', $failEventId)->first();
            $this->assertNotNull($attempt2);
            $this->assertSame('PENDING', $attempt2->status);
            $this->assertSame(2, (int) $attempt2->attempt_count);
            $backoff2Seconds = CarbonImmutable::parse((string) $attempt2->updated_at, 'UTC')->diffInSeconds(
                CarbonImmutable::parse((string) $attempt2->next_attempt_at, 'UTC'),
                false,
            );
            $this->assertSame(20.0, round($backoff2Seconds, 2));
            $this->assertGreaterThan($backoff1Seconds, $backoff2Seconds);

            // Tentative 3 (== outbox_max_attempts) -> passage définitif à FAILED
            CarbonImmutable::setTestNow($frozenNow->addSeconds(32));

            $processor->processBatch($this->clinicId, 50);
            $attempt3 = DB::table('outbox_events')->where('id', $failEventId)->first();
            $this->assertNotNull($attempt3);
            $this->assertSame('FAILED', $attempt3->status);
            $this->assertSame(3, (int) $attempt3->attempt_count);
            $this->assertNull($attempt3->next_attempt_at);
            $this->assertSame('RUNTIMEEXCEPTION', $attempt3->last_error_code);
        } finally {
            CarbonImmutable::setTestNow();
        }

        // Liste paginée filtrée par clinique + contrat OutboxEventPage
        $listPage = $this->actingAsFresh($this->manager)
            ->getJson('/api/v1/integrations/outbox')
            ->assertOk();
        $this->assertMatchesContract($listPage, 'schemas/resources/communication.json#/$defs/OutboxEventPage');
        $listPage->assertJsonPath('meta.total', 2);

        $otherList = $this->actingAsFresh($this->otherManager)
            ->getJson('/api/v1/integrations/outbox')
            ->assertOk();
        $otherList->assertJsonPath('meta.total', 1);

        // Commande Artisan eeo:integrations:outbox sur l'autre clinique
        $exitCode = Artisan::call('eeo:integrations:outbox', ['--clinic' => $this->otherClinicId, '--limit' => 10]);
        $this->assertSame(0, $exitCode);

        $otherRow = DB::table('outbox_events')->where('id', $otherEventId)->first();
        $this->assertNotNull($otherRow);
        $this->assertSame('PROCESSED', $otherRow->status);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function insertOutboxEvent(string $clinicId, string $eventType, array $payload): string
    {
        $id = Ulid::generate();
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        DB::table('outbox_events')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'event_type' => $eventType,
            'event_version' => 1,
            'source_type' => 'message_job',
            'source_id' => Ulid::generate(),
            'source_version' => 1,
            'payload' => json_encode($payload, JSON_THROW_ON_ERROR),
            'correlation_id' => Ulid::generate(),
            'status' => 'PENDING',
            'processed_at' => null,
            'attempt_count' => 0,
            'next_attempt_at' => null,
            'last_error_code' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }
}

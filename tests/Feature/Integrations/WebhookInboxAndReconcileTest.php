<?php

namespace Tests\Feature\Integrations;

use App\Domain\Operations\IntegrationAccounts;
use App\Domain\Operations\WebhookInboxService;
use App\Http\Controllers\Api\V1\WebhookAdminController;
use App\Http\Controllers\PublicWebhookController;
use App\Models\User;
use App\Support\Integrations\Contracts\WebhookConsumerInterface;
use App\Support\Integrations\IntegrationCrypto;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\AccessFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class WebhookInboxAndReconcileTest extends TestCase
{
    use AccessFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    private string $clinicA;

    private string $clinicB;

    private User $managerA;

    private User $managerB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->clinicA = $this->makeClinic('CABINET WEBHOOK A');
        $this->clinicB = $this->makeClinic('CABINET WEBHOOK B');
        $this->managerA = $this->makeStaff($this->clinicA, 'MANAGER', 'hook.manager.a');
        $this->managerB = $this->makeStaff($this->clinicB, 'MANAGER', 'hook.manager.b');

        Route::prefix('api/v1')->middleware(['api', 'auth:sanctum', 'active'])->group(function (): void {
            Route::get('/integrations/webhooks', [WebhookAdminController::class, 'webhooks']);
            Route::post('/integrations/reconcile', [WebhookAdminController::class, 'reconcile']);
        });

        Route::prefix('public/v1')->middleware(['api'])->group(function (): void {
            Route::get('/webhooks/meta', [PublicWebhookController::class, 'verifyMeta']);
            Route::post('/webhooks/{provider}', [PublicWebhookController::class, 'ingest']);
        });
    }

    public function test_meta_challenge_verification_matches_account_secret(): void
    {
        $accounts = app(IntegrationAccounts::class);
        $accounts->create($this->clinicA, $this->managerA, [
            'provider' => 'META_WHATSAPP',
            'external_account_id' => 'waba-meta-a',
            'display_name' => 'Meta Clinic A',
            'status' => 'ACTIVE',
            'credentials' => [
                'app_secret' => 'app-secret-a',
                'verify_token' => 'verify-token-a',
            ],
        ]);

        $ok = $this->get('/public/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-a&hub.challenge=challenge-42');
        $ok->assertStatus(200);
        $this->assertSame('challenge-42', $ok->getContent());

        $bad = $this->get('/public/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-42');
        $bad->assertStatus(403);
        $this->assertMatchesContract($bad, 'schemas/error.json');
        $bad->assertJsonPath('error.code', 'ACTION_FORBIDDEN');
    }

    public function test_provider_signatures_max_bytes_encrypted_storage_and_replay_idempotency(): void
    {
        $accounts = app(IntegrationAccounts::class);

        $metaAccount = $accounts->create($this->clinicA, $this->managerA, [
            'provider' => 'META_WHATSAPP',
            'external_account_id' => 'waba-ext-a',
            'display_name' => 'Meta WhatsApp A',
            'status' => 'ACTIVE',
            'credentials' => ['app_secret' => 'meta-secret-a'],
        ]);

        $accounts->create($this->clinicB, $this->managerB, [
            'provider' => 'META_WHATSAPP',
            'external_account_id' => 'waba-ext-b',
            'display_name' => 'Meta WhatsApp B',
            'status' => 'ACTIVE',
            'credentials' => ['app_secret' => 'meta-secret-b'],
        ]);

        $googleAccount = $accounts->create($this->clinicA, $this->managerA, [
            'provider' => 'GOOGLE',
            'external_account_id' => 'gcal-chan-a',
            'display_name' => 'Google Agenda A',
            'status' => 'ACTIVE',
            'credentials' => ['webhook_token' => 'google-token-a'],
        ]);

        $kommoAccount = $accounts->create($this->clinicA, $this->managerA, [
            'provider' => 'KOMMO',
            'external_account_id' => 'kommo-sub-a',
            'display_name' => 'Kommo A',
            'status' => 'ACTIVE',
            'credentials' => ['webhook_secret' => 'kommo-secret-a'],
        ]);

        $smsAccount = $accounts->create($this->clinicA, $this->managerA, [
            'provider' => 'SMS',
            'external_account_id' => 'sms-sender-a',
            'display_name' => 'SMS A',
            'status' => 'ACTIVE',
            'credentials' => ['webhook_secret' => 'sms-secret-a'],
        ]);

        $metaBody = json_encode([
            'external_account_id' => 'waba-ext-a',
            'event_id' => 'evt-meta-001',
            'entry' => [['id' => 'waba-ext-a']],
        ], JSON_THROW_ON_ERROR);

        // Mauvaise signature -> 403 ACTION_FORBIDDEN
        $badSig = $this->postRawWebhook('/public/v1/webhooks/meta', $metaBody, [
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256=deadbeef',
        ]);
        $badSig->assertStatus(403);
        $this->assertMatchesContract($badSig, 'schemas/error.json');
        $badSig->assertJsonPath('error.code', 'ACTION_FORBIDDEN');

        // Signature de la clinique B sur le compte de la clinique A -> 403 isolation
        $crossSig = $this->postRawWebhook('/public/v1/webhooks/meta', $metaBody, [
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $metaBody, 'meta-secret-b'),
        ]);
        $crossSig->assertStatus(403)->assertJsonPath('error.code', 'ACTION_FORBIDDEN');

        // Query clinic_id B combiné avec account_id A -> 404 isolation
        $this->postRawWebhook(
            '/public/v1/webhooks/meta?clinic_id='.$this->clinicB.'&account_id='.$metaAccount->id,
            $metaBody,
            ['HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $metaBody, 'meta-secret-a')],
        )->assertStatus(404)->assertJsonPath('error.code', 'RESOURCE_NOT_FOUND');

        // Charge trop volumineuse -> 413 PAYLOAD_TOO_LARGE
        config()->set('eeo.integrations.webhook_max_bytes', 1024);
        $oversized = $this->postRawWebhook('/public/v1/webhooks/meta', str_repeat('a', 1500), [
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256=any',
        ]);
        $oversized->assertStatus(413);
        $this->assertMatchesContract($oversized, 'schemas/error.json');
        $oversized->assertJsonPath('error.code', 'PAYLOAD_TOO_LARGE');
        config()->set('eeo.integrations.webhook_max_bytes', 262144);

        // Meta valide -> 202 + payload chiffré + hash SHA-256
        $okMeta = $this->postRawWebhook('/public/v1/webhooks/meta', $metaBody, [
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $metaBody, 'meta-secret-a'),
        ]);
        $okMeta->assertStatus(202);
        $this->assertMatchesContract($okMeta, 'schemas/resources/communication.json#/$defs/WebhookIngestResultResponse');
        $okMeta->assertJsonPath('data.accepted', true)
            ->assertJsonPath('data.duplicate', false)
            ->assertJsonPath('data.status', 'VERIFIED');

        $inboxId = (string) $okMeta->json('data.inbox_id');
        $inboxRow = DB::table('webhook_inbox')->where('id', $inboxId)->first();
        $this->assertNotNull($inboxRow);
        $this->assertSame(hash('sha256', $metaBody), $inboxRow->payload_hash);
        $this->assertStringNotContainsString('evt-meta-001', (string) $inboxRow->payload_ciphertext);
        $this->assertSame($metaBody, app(IntegrationCrypto::class)->decrypt((string) $inboxRow->payload_ciphertext));

        // Replay exact -> 202 duplicate: true sans nouvelle ligne
        $replayMeta = $this->postRawWebhook('/public/v1/webhooks/meta', $metaBody, [
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $metaBody, 'meta-secret-a'),
        ]);
        $replayMeta->assertStatus(202);
        $this->assertMatchesContract($replayMeta, 'schemas/resources/communication.json#/$defs/WebhookIngestResultResponse');
        $replayMeta->assertJsonPath('data.accepted', true)
            ->assertJsonPath('data.duplicate', true)
            ->assertJsonPath('data.inbox_id', $inboxId);
        $this->assertSame(1, DB::table('webhook_inbox')->where('clinic_id', $this->clinicA)->count());

        // Google push (corps vide + X-Goog-Channel-Token + X-Goog-Channel-ID + X-Goog-Message-Number)
        $googleRes = $this->postRawWebhook('/public/v1/webhooks/google', '', [
            'HTTP_X_GOOG_CHANNEL_ID' => 'gcal-chan-a',
            'HTTP_X_GOOG_RESOURCE_ID' => 'res-1',
            'HTTP_X_GOOG_MESSAGE_NUMBER' => '7',
            'HTTP_X_GOOG_CHANNEL_TOKEN' => 'google-token-a',
        ]);
        $googleRes->assertStatus(202)->assertJsonPath('data.status', 'VERIFIED');

        // Kommo HMAC
        $kommoBody = json_encode(['external_account_id' => 'kommo-sub-a', 'event_id' => 'kommo-1'], JSON_THROW_ON_ERROR);
        $this->postRawWebhook('/public/v1/webhooks/kommo', $kommoBody, [
            'HTTP_X_KOMMO_SIGNATURE' => hash_hmac('sha256', $kommoBody, 'kommo-secret-a'),
        ])->assertStatus(202)->assertJsonPath('data.status', 'VERIFIED');

        // SMS HMAC
        $smsBody = json_encode(['external_account_id' => 'sms-sender-a', 'event_id' => 'sms-1'], JSON_THROW_ON_ERROR);
        $this->postRawWebhook('/public/v1/webhooks/sms', $smsBody, [
            'HTTP_X_SIGNATURE' => hash_hmac('sha256', $smsBody, 'sms-secret-a'),
        ])->assertStatus(202)->assertJsonPath('data.status', 'VERIFIED');

        // Mode fake accepte X-Test-Signature == secret du compte ; live le refuse
        $fakeBody = json_encode(['external_account_id' => 'sms-sender-a', 'event_id' => 'sms-fake-sig'], JSON_THROW_ON_ERROR);
        $this->postRawWebhook('/public/v1/webhooks/sms', $fakeBody, [
            'HTTP_X_TEST_SIGNATURE' => 'sms-secret-a',
        ])->assertStatus(202);

        config()->set('eeo.integrations.mode', 'live');
        $liveTestBody = json_encode(['external_account_id' => 'sms-sender-a', 'event_id' => 'sms-live-reject'], JSON_THROW_ON_ERROR);
        $this->postRawWebhook('/public/v1/webhooks/sms', $liveTestBody, [
            'HTTP_X_TEST_SIGNATURE' => 'sms-secret-a',
        ])->assertStatus(403);
        config()->set('eeo.integrations.mode', 'fake');

        // Liste admin + isolation clinique B
        $pageA = $this->actingAsFresh($this->managerA)->getJson('/api/v1/integrations/webhooks')->assertOk();
        $this->assertMatchesContract($pageA, 'schemas/resources/communication.json#/$defs/WebhookInboxPage');
        $this->assertSame(5, (int) $pageA->json('meta.total'));

        $pageB = $this->actingAsFresh($this->managerB)->getJson('/api/v1/integrations/webhooks')->assertOk();
        $this->assertMatchesContract($pageB, 'schemas/resources/communication.json#/$defs/WebhookInboxPage');
        $this->assertSame(0, (int) $pageB->json('meta.total'));

        // Consommateurs webhooks + réconciliation HTTP et CLI
        $consumedProviders = [];
        $metaConsumer = new class($consumedProviders) implements WebhookConsumerInterface
        {
            /** @param array<int, string> $providers */
            public function __construct(private array &$providers) {}

            public function supports(string $provider): bool
            {
                return $provider === 'META_WHATSAPP' || $provider === 'GOOGLE' || $provider === 'KOMMO';
            }

            public function handle(string $clinicId, string $accountId, string $provider, array $payload): void
            {
                $this->providers[] = $provider;
            }
        };

        $failingSmsConsumer = new class implements WebhookConsumerInterface
        {
            public function supports(string $provider): bool
            {
                return $provider === 'SMS';
            }

            public function handle(string $clinicId, string $accountId, string $provider, array $payload): void
            {
                throw new RuntimeException('Erreur de traitement SMS');
            }
        };

        /** @var WebhookInboxService $inboxService */
        $inboxService = app(WebhookInboxService::class);
        $inboxService->addConsumer($metaConsumer);
        $inboxService->addConsumer($failingSmsConsumer);
        $this->app->instance(WebhookInboxService::class, $inboxService);

        $reconcileRes = $this->actingAsFresh($this->managerA)
            ->postJson('/api/v1/integrations/reconcile', ['limit' => 50])
            ->assertOk();
        $this->assertMatchesContract($reconcileRes, 'schemas/resources/communication.json#/$defs/IntegrationReconcileResultResponse');
        $reconcileRes->assertJsonPath('data.webhooks_processed', 3);

        $this->assertSame(['META_WHATSAPP', 'GOOGLE', 'KOMMO'], $consumedProviders);

        $this->assertSame('PROCESSED', DB::table('webhook_inbox')->where('id', $inboxId)->value('status'));
        $this->assertSame(
            'FAILED',
            DB::table('webhook_inbox')->where('integration_account_id', $smsAccount->id)->first()?->status,
        );

        // Commande CLI eeo:integrations:reconcile
        $exitCode = Artisan::call('eeo:integrations:reconcile', ['--clinic' => $this->clinicA, '--limit' => 25]);
        $this->assertSame(0, $exitCode);

        $this->assertNotNull($googleAccount);
        $this->assertNotNull($kommoAccount);
    }

    /**
     * @param  array<string, string>  $serverHeaders
     * @return TestResponse<Response>
     */
    private function postRawWebhook(string $uri, string $rawBody, array $serverHeaders): TestResponse
    {
        $server = array_merge([
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], $serverHeaders);

        return $this->call('POST', $uri, [], [], [], $server, $rawBody);
    }
}

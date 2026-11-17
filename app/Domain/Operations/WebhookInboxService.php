<?php

namespace App\Domain\Operations;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use App\Support\Integrations\Contracts\WebhookConsumerInterface;
use App\Support\Integrations\IntegrationCrypto;
use App\Support\Integrations\IntegrationMode;
use App\Support\Integrations\WebhookSignatureVerifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use JsonException;
use stdClass;
use Throwable;

/**
 * Réception, vérification de signature, déduplication et traitement batch des webhooks entrants.
 * Stocke le corps brut chiffré (webhook_inbox.payload_ciphertext) avec son SHA-256,
 * garantit l'idempotence sur (clinic_id, integration_account_id, provider_event_key)
 * et distribue les événements VERIFIED aux WebhookConsumerInterface injectés.
 */
final class WebhookInboxService
{
    private const MAX_BATCH_LIMIT = 200;

    private const ALLOWED_STATUSES = ['RECEIVED', 'VERIFIED', 'PROCESSED', 'REJECTED', 'FAILED'];

    /** @var list<WebhookConsumerInterface> */
    private array $consumers = [];

    /**
     * @param  iterable<WebhookConsumerInterface>  $consumers
     */
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly IntegrationCrypto $crypto,
        private readonly IntegrationMode $mode,
        private readonly WebhookSignatureVerifier $verifier,
        private readonly IntegrationAccounts $accounts,
        iterable $consumers = [],
    ) {
        foreach ($consumers as $consumer) {
            $this->consumers[] = $consumer;
        }
    }

    public function addConsumer(WebhookConsumerInterface $consumer): void
    {
        $this->consumers[] = $consumer;
    }

    /**
     * @return array{
     *     items: list<stdClass>,
     *     current_page: int,
     *     per_page: int,
     *     total: int
     * }
     */
    public function listForClinic(
        string $clinicId,
        int $page = 1,
        int $perPage = 25,
        ?string $status = null,
    ): array {
        $safePage = max(1, $page);
        $safePerPage = $perPage === 50 ? 50 : 25;

        $query = DB::table('webhook_inbox')
            ->where('clinic_id', $clinicId);

        if ($status !== null && trim($status) !== '') {
            $normalized = strtoupper(trim($status));
            if (! in_array($normalized, self::ALLOWED_STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Statut webhook invalide.']]);
            }
            $query->where('status', $normalized);
        }

        $total = (clone $query)->count();

        /** @var list<stdClass> $items */
        $items = $query
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->forPage($safePage, $safePerPage)
            ->get()
            ->all();

        return [
            'items' => $items,
            'current_page' => $safePage,
            'per_page' => $safePerPage,
            'total' => $total,
        ];
    }

    public function verifyMetaChallenge(
        ?string $hubMode,
        ?string $verifyToken,
        ?string $challenge,
        ?string $clinicId = null,
        ?string $accountId = null,
    ): string {
        $this->mode->assertEnabled();

        if ($hubMode !== 'subscribe' || $verifyToken === null || trim($verifyToken) === '' || $challenge === null || $challenge === '') {
            throw BusinessError::validation([
                'hub.verify_token' => ['Paramètres de challenge Meta incomplets ou invalides.'],
            ]);
        }

        $providers = $this->mode->accountProvidersForWebhookChannel('meta');

        if ($accountId !== null && trim($accountId) !== '') {
            $query = DB::table('integration_accounts')
                ->where('id', trim($accountId))
                ->whereIn('provider', $providers)
                ->whereIn('status', IntegrationMode::OPERATIONAL_STATUSES);

            if ($clinicId !== null && trim($clinicId) !== '') {
                $query->where('clinic_id', trim($clinicId));
            }

            $account = $query->first();
            if ($account !== null && $this->accountMatchesMetaVerifyToken($account, $verifyToken)) {
                return $challenge;
            }

            throw new BusinessError('ACTION_FORBIDDEN', 'Jeton de vérification Meta invalide.', 403);
        }

        $accounts = $this->accounts->findOperationalForProviders($clinicId, $providers);
        foreach ($accounts as $account) {
            if ($this->accountMatchesMetaVerifyToken($account, $verifyToken)) {
                return $challenge;
            }
        }

        throw new BusinessError('ACTION_FORBIDDEN', 'Jeton de vérification Meta invalide.', 403);
    }

    /**
     * @param  array<string, string|list<string>|null>  $headers
     * @param  array<string, mixed>  $query
     * @return array{accepted: bool, duplicate: bool, inbox_id: string, status: string}
     */
    public function ingest(
        string $providerChannel,
        string $rawBody,
        array $headers,
        array $query = [],
    ): array {
        $this->mode->assertEnabled();
        $this->verifier->assertWithinMaxBytes($rawBody);

        $channel = strtolower(trim($providerChannel));
        $providers = $this->mode->accountProvidersForWebhookChannel($channel);
        if ($providers === []) {
            throw BusinessError::validation([
                'provider' => ['Fournisseur de webhook non pris en charge.'],
            ]);
        }

        $normalizedHeaders = WebhookSignatureVerifier::normalizeHeaders($headers);
        $decodedBody = $this->parsePayloadForRouting($channel, $rawBody);

        $account = $this->resolveTargetAccount($channel, $providers, $normalizedHeaders, $query, $decodedBody);
        $credentials = $this->safelyDecryptCredentials($account);

        $this->verifier->verifyIncoming($channel, $rawBody, $headers, $credentials);

        $clinicId = (string) $account->clinic_id;
        $accountId = (string) $account->id;
        $eventKey = $this->extractProviderEventKey($channel, $rawBody, $normalizedHeaders, $decodedBody);
        $payloadHash = hash('sha256', $rawBody);
        $encrypted = $this->crypto->encrypt($rawBody);

        try {
            /** @var array{accepted: bool, duplicate: bool, inbox_id: string, status: string} */
            return $this->transactions->run(function () use (
                $clinicId,
                $accountId,
                $eventKey,
                $payloadHash,
                $encrypted,
            ): array {
                $locks = new TransactionLocks($clinicId);
                $locks->clinic();

                $existing = DB::table('webhook_inbox')
                    ->where('clinic_id', $clinicId)
                    ->where('integration_account_id', $accountId)
                    ->where('provider_event_key', $eventKey)
                    ->lockForUpdate()
                    ->first();

                if ($existing !== null) {
                    return [
                        'accepted' => true,
                        'duplicate' => true,
                        'inbox_id' => (string) $existing->id,
                        'status' => (string) $existing->status,
                    ];
                }

                $inboxId = Ulid::generate();
                $nowDb = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

                DB::table('webhook_inbox')->insert([
                    'id' => $inboxId,
                    'clinic_id' => $clinicId,
                    'integration_account_id' => $accountId,
                    'provider_event_key' => $eventKey,
                    'payload_hash' => $payloadHash,
                    'payload_ciphertext' => $encrypted['ciphertext'],
                    'encryption_key_id' => $encrypted['key_id'],
                    'received_at' => $nowDb,
                    'status' => 'VERIFIED',
                    'verified_at' => $nowDb,
                    'processed_at' => null,
                    'attempt_count' => 0,
                    'last_error_code' => null,
                    'created_at' => $nowDb,
                    'updated_at' => $nowDb,
                ]);

                return [
                    'accepted' => true,
                    'duplicate' => false,
                    'inbox_id' => $inboxId,
                    'status' => 'VERIFIED',
                ];
            });
        } catch (UniqueConstraintViolationException) {
            $existing = DB::table('webhook_inbox')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->where('provider_event_key', $eventKey)
                ->first();

            if ($existing !== null) {
                return [
                    'accepted' => true,
                    'duplicate' => true,
                    'inbox_id' => (string) $existing->id,
                    'status' => (string) $existing->status,
                ];
            }

            throw new BusinessError('SERVER_BUSY', 'Conflit concurrentiel lors de la réception du webhook.', 409);
        }
    }

    /**
     * @return array{processed: int, failed: int, skipped: int}
     */
    public function processBatch(string $clinicId, int $limit = 50): array
    {
        if ($limit < 1 || $limit > self::MAX_BATCH_LIMIT) {
            throw BusinessError::validation([
                'limit' => ['La limite doit être comprise entre 1 et '.self::MAX_BATCH_LIMIT.'.'],
            ]);
        }

        if ($this->mode->isDisabled()) {
            return ['processed' => 0, 'failed' => 0, 'skipped' => 0];
        }

        /** @var list<string> $candidateIds */
        $candidateIds = $this->transactions->run(function () use ($clinicId, $limit): array {
            /** @var list<string> $ids */
            $ids = DB::table('webhook_inbox')
                ->where('clinic_id', $clinicId)
                ->where('status', 'VERIFIED')
                ->orderBy('received_at')
                ->orderBy('id')
                ->limit($limit)
                ->lock('for update skip locked')
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            return $ids;
        });

        $processed = 0;
        $failed = 0;
        $skipped = 0;

        foreach ($candidateIds as $inboxId) {
            $outcome = $this->processInboxItem($clinicId, $inboxId);
            if ($outcome === 'processed') {
                $processed++;
            } elseif ($outcome === 'failed') {
                $failed++;
            } else {
                $skipped++;
            }
        }

        return [
            'processed' => $processed,
            'failed' => $failed,
            'skipped' => $skipped,
        ];
    }

    /**
     * @return array{processed: int, failed: int, skipped: int, clinics: int}
     */
    public function processAllPendingClinics(int $limitPerClinic = 50): array
    {
        /** @var list<string> $clinicIds */
        $clinicIds = DB::table('webhook_inbox')
            ->where('status', 'VERIFIED')
            ->distinct()
            ->pluck('clinic_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $totalProcessed = 0;
        $totalFailed = 0;
        $totalSkipped = 0;

        foreach ($clinicIds as $clinicId) {
            $result = $this->processBatch($clinicId, $limitPerClinic);
            $totalProcessed += $result['processed'];
            $totalFailed += $result['failed'];
            $totalSkipped += $result['skipped'];
        }

        return [
            'processed' => $totalProcessed,
            'failed' => $totalFailed,
            'skipped' => $totalSkipped,
            'clinics' => count($clinicIds),
        ];
    }

    private function processInboxItem(string $clinicId, string $inboxId): string
    {
        try {
            /** @var string */
            return $this->transactions->run(function () use ($clinicId, $inboxId): string {
                $locks = new TransactionLocks($clinicId);
                $row = $locks->webhookInbox($inboxId);

                if ($row === null || (string) $row->status !== 'VERIFIED') {
                    return 'skipped';
                }

                $account = DB::table('integration_accounts')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $row->integration_account_id)
                    ->first();

                if ($account === null) {
                    throw new BusinessError('RESOURCE_NOT_FOUND', 'Compte d’intégration associé introuvable.', 404);
                }

                $provider = (string) $account->provider;
                $matchingConsumers = $this->consumersFor($provider);
                if ($matchingConsumers === []) {
                    return 'skipped';
                }

                $rawBody = $this->crypto->decrypt((string) $row->payload_ciphertext);
                $payload = $this->decodeStoredPayload($rawBody);

                foreach ($matchingConsumers as $consumer) {
                    $consumer->handle($clinicId, (string) $row->integration_account_id, $provider, $payload);
                }

                $nowDb = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

                DB::table('webhook_inbox')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $inboxId)
                    ->update([
                        'status' => 'PROCESSED',
                        'processed_at' => $nowDb,
                        'attempt_count' => (int) $row->attempt_count + 1,
                        'last_error_code' => null,
                        'updated_at' => $nowDb,
                    ]);

                return 'processed';
            });
        } catch (Throwable $exception) {
            $errorCode = $exception instanceof BusinessError
                ? $exception->errorCode
                : $this->errorCodeFromThrowable($exception);

            $this->transactions->run(function () use ($clinicId, $inboxId, $errorCode): void {
                $locks = new TransactionLocks($clinicId);
                $row = $locks->webhookInbox($inboxId);

                if ($row === null || (string) $row->status === 'PROCESSED') {
                    return;
                }

                DB::table('webhook_inbox')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $inboxId)
                    ->update([
                        'status' => 'FAILED',
                        'attempt_count' => (int) $row->attempt_count + 1,
                        'last_error_code' => substr($errorCode, 0, 100),
                        'updated_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u'),
                    ]);
            });

            return 'failed';
        }
    }

    /**
     * @param  list<string>  $providers
     * @param  array<string, string>  $headers
     * @param  array<string, mixed>  $query
     * @param  array<string, mixed>  $decodedBody
     */
    private function resolveTargetAccount(
        string $channel,
        array $providers,
        array $headers,
        array $query,
        array $decodedBody,
    ): stdClass {
        $clinicHint = $this->firstNonEmptyString([
            $query['clinic_id'] ?? null,
            $headers['x-clinic-id'] ?? null,
            $decodedBody['clinic_id'] ?? null,
        ]);

        $accountHint = $this->firstNonEmptyString([
            $query['account_id'] ?? null,
            $headers['x-integration-account-id'] ?? null,
            $headers['x-account-id'] ?? null,
            $decodedBody['integration_account_id'] ?? null,
            $decodedBody['account_id'] ?? null,
        ]);

        if ($accountHint !== null) {
            $byId = DB::table('integration_accounts')
                ->where('id', $accountHint)
                ->whereIn('provider', $providers)
                ->whereIn('status', IntegrationMode::OPERATIONAL_STATUSES);

            if ($clinicHint !== null) {
                $byId->where('clinic_id', $clinicHint);
            }

            $matched = $byId->first();
            if ($matched === null) {
                throw BusinessError::notFound('Compte d’intégration webhook introuvable.');
            }

            return $matched;
        }

        $candidates = $this->accounts->findOperationalForProviders($clinicHint, $providers);
        if ($candidates === []) {
            throw BusinessError::notFound('Aucun compte d’intégration opérationnel pour ce webhook.');
        }

        $externalHints = $this->extractExternalAccountHints($channel, $headers, $decodedBody);
        if ($externalHints !== []) {
            $matchedByExternal = array_values(array_filter(
                $candidates,
                static fn (stdClass $candidate): bool => in_array((string) $candidate->external_account_id, $externalHints, true),
            ));

            if (count($matchedByExternal) === 1) {
                return $matchedByExternal[0];
            }

            if (count($matchedByExternal) > 1) {
                throw BusinessError::validation([
                    'account_id' => ['Plusieurs comptes correspondent à cet identifiant externe ; précisez clinic_id ou account_id.'],
                ]);
            }
        }

        if ($channel === 'google') {
            $channelId = $headers['x-goog-channel-id'] ?? '';
            if ($channelId !== '') {
                $syncQuery = DB::table('calendar_sync_states')
                    ->where('push_channel_id', $channelId);
                if ($clinicHint !== null) {
                    $syncQuery->where('clinic_id', $clinicHint);
                }
                $syncState = $syncQuery->first();
                if ($syncState !== null) {
                    foreach ($candidates as $candidate) {
                        if ((string) $candidate->id === (string) $syncState->integration_account_id) {
                            return $candidate;
                        }
                    }
                }
            }
        }

        if (count($candidates) === 1 && $externalHints === []) {
            return $candidates[0];
        }

        if ($externalHints !== []) {
            throw BusinessError::notFound('Compte d’intégration cible introuvable pour cet identifiant externe.');
        }

        throw BusinessError::validation([
            'account_id' => ['Impossible d’identifier le compte d’intégration cible de manière univoque.'],
        ]);
    }

    /**
     * @param  array<string, string>  $headers
     * @param  array<string, mixed>  $decodedBody
     * @return list<string>
     */
    private function extractExternalAccountHints(string $channel, array $headers, array $decodedBody): array
    {
        $hints = [];

        $direct = $decodedBody['external_account_id'] ?? null;
        if (is_string($direct) && trim($direct) !== '') {
            $hints[] = trim($direct);
        }

        if ($channel === 'meta' && isset($decodedBody['entry']) && is_array($decodedBody['entry'])) {
            $firstEntry = $decodedBody['entry'][0] ?? null;
            if (is_array($firstEntry)) {
                if (is_string($firstEntry['id'] ?? null) && trim($firstEntry['id']) !== '') {
                    $hints[] = trim($firstEntry['id']);
                }
                $firstChange = $firstEntry['changes'][0] ?? null;
                if (is_array($firstChange)) {
                    $phoneNumberId = $firstChange['value']['metadata']['phone_number_id'] ?? null;
                    if (is_string($phoneNumberId) && trim($phoneNumberId) !== '') {
                        $hints[] = trim($phoneNumberId);
                    }
                }
            }
        }

        if ($channel === 'kommo' && isset($decodedBody['account']) && is_array($decodedBody['account'])) {
            foreach (['id', 'subdomain'] as $key) {
                $val = $decodedBody['account'][$key] ?? null;
                if (is_scalar($val) && trim((string) $val) !== '') {
                    $hints[] = trim((string) $val);
                }
            }
        }

        if ($channel === 'google') {
            foreach (['x-goog-channel-id', 'x-goog-resource-id'] as $headerName) {
                if (($headers[$headerName] ?? '') !== '') {
                    $hints[] = $headers[$headerName];
                }
            }
        }

        if ($channel === 'sms') {
            foreach (['sender_id', 'to'] as $key) {
                $val = $decodedBody[$key] ?? null;
                if (is_string($val) && trim($val) !== '') {
                    $hints[] = trim($val);
                }
            }
        }

        return array_values(array_unique($hints));
    }

    /**
     * @param  array<string, string>  $headers
     * @param  array<string, mixed>  $decodedBody
     */
    private function extractProviderEventKey(
        string $channel,
        string $rawBody,
        array $headers,
        array $decodedBody,
    ): string {
        $headerCandidates = [
            $headers['x-event-id'] ?? null,
            $headers['x-provider-event-id'] ?? null,
            $headers['x-webhook-id'] ?? null,
        ];

        foreach ($headerCandidates as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                return $this->boundEventKey($candidate);
            }
        }

        if ($channel === 'google') {
            $msgNumber = $headers['x-goog-message-number'] ?? '';
            $resourceId = $headers['x-goog-resource-id'] ?? '';
            if ($msgNumber !== '' && $resourceId !== '') {
                return $this->boundEventKey('goog:'.$resourceId.':'.$msgNumber);
            }
        }

        foreach (['event_id', 'id', 'webhook_id', 'message_id'] as $key) {
            $val = $decodedBody[$key] ?? null;
            if (is_scalar($val) && trim((string) $val) !== '') {
                return $this->boundEventKey(trim((string) $val));
            }
        }

        if ($channel === 'meta' && isset($decodedBody['entry']) && is_array($decodedBody['entry'])) {
            $firstEntry = $decodedBody['entry'][0] ?? null;
            if (is_array($firstEntry)) {
                $changeValue = $firstEntry['changes'][0]['value'] ?? null;
                if (is_array($changeValue)) {
                    $messageId = $changeValue['messages'][0]['id']
                        ?? $changeValue['statuses'][0]['id']
                        ?? null;
                    if (is_string($messageId) && trim($messageId) !== '') {
                        return $this->boundEventKey(trim($messageId));
                    }
                }
            }
        }

        return 'sha256:'.hash('sha256', $rawBody);
    }

    private function boundEventKey(string $key): string
    {
        if (strlen($key) <= 180) {
            return $key;
        }

        return 'sha256:'.hash('sha256', $key);
    }

    /**
     * @return array<string, mixed>
     */
    private function parsePayloadForRouting(string $channel, string $rawBody): array
    {
        $trimmed = trim($rawBody);
        if ($trimmed === '') {
            return [];
        }

        if (str_starts_with($trimmed, '{') || str_starts_with($trimmed, '[')) {
            try {
                $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw BusinessError::validation(['payload' => ['Corps JSON du webhook invalide.']]);
            }

            if (! is_array($decoded)) {
                throw BusinessError::validation(['payload' => ['Corps JSON du webhook invalide.']]);
            }

            /** @var array<string, mixed> $decoded */
            return $decoded;
        }

        if ($channel === 'kommo' || $channel === 'sms') {
            $parsed = [];
            parse_str($rawBody, $parsed);
            if ($parsed !== []) {
                /** @var array<string, mixed> $parsed */
                return $parsed;
            }
        }

        return [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeStoredPayload(string $rawBody): array
    {
        $trimmed = trim($rawBody);
        if ($trimmed === '') {
            return [];
        }

        if (str_starts_with($trimmed, '{') || str_starts_with($trimmed, '[')) {
            $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($decoded)) {
                throw new JsonException('Payload webhook non objet.');
            }

            /** @var array<string, mixed> $decoded */
            return $decoded;
        }

        $parsed = [];
        parse_str($rawBody, $parsed);

        /** @var array<string, mixed> $parsed */
        return $parsed;
    }

    private function accountMatchesMetaVerifyToken(stdClass $account, string $verifyToken): bool
    {
        $credentials = $this->safelyDecryptCredentials($account);

        return $this->verifier->verifyMetaChallengeToken($verifyToken, $credentials);
    }

    /**
     * @return array<string, mixed>
     */
    private function safelyDecryptCredentials(stdClass $account): array
    {
        try {
            return $this->accounts->decryptCredentials($account);
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return list<WebhookConsumerInterface>
     */
    private function consumersFor(string $provider): array
    {
        $channel = $this->mode->webhookChannelForProvider($provider);
        $matches = [];

        foreach ($this->consumers as $consumer) {
            if ($consumer->supports($provider) || $consumer->supports($channel)) {
                $matches[] = $consumer;
            }
        }

        return $matches;
    }

    /**
     * @param  list<mixed>  $candidates
     */
    private function firstNonEmptyString(array $candidates): ?string
    {
        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
        }

        return null;
    }

    private function errorCodeFromThrowable(Throwable $exception): string
    {
        $parts = explode('\\', $exception::class);
        $base = strtoupper(preg_replace('/[^A-Za-z0-9_]/', '_', end($parts)) ?? 'WEBHOOK_CONSUMER_ERROR');

        return $base !== '' ? substr($base, 0, 100) : 'WEBHOOK_CONSUMER_ERROR';
    }
}

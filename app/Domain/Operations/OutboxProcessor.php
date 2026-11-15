<?php

namespace App\Domain\Operations;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Shared\BusinessError;
use App\Support\Integrations\Contracts\OutboxConsumerInterface;
use App\Support\Integrations\IntegrationMode;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use JsonException;
use stdClass;
use Throwable;

/**
 * Processeur de l'outbox transactionnelle par clinique.
 * Utilise SELECT ... FOR UPDATE SKIP LOCKED puis TransactionLocks::outboxEvent (rang 38),
 * décode le payload JSON, distribue aux consommateurs injectés, applique un backoff
 * exponentiel jusqu'à outbox_max_attempts puis FAILED, et garantit l'idempotence de PROCESSED.
 */
final class OutboxProcessor
{
    private const MAX_BATCH_LIMIT = 200;

    private const ALLOWED_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'];

    /** @var list<OutboxConsumerInterface> */
    private array $consumers = [];

    /**
     * @param  iterable<OutboxConsumerInterface>  $consumers
     */
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly IntegrationMode $mode,
        iterable $consumers = [],
    ) {
        foreach ($consumers as $consumer) {
            $this->consumers[] = $consumer;
        }
    }

    public function addConsumer(OutboxConsumerInterface $consumer): void
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
        ?string $eventType = null,
    ): array {
        $safePage = max(1, $page);
        $safePerPage = $perPage === 50 ? 50 : 25;

        $query = DB::table('outbox_events')
            ->where('clinic_id', $clinicId);

        if ($status !== null && trim($status) !== '') {
            $normalizedStatus = strtoupper(trim($status));
            if (! in_array($normalizedStatus, self::ALLOWED_STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Statut outbox invalide.']]);
            }
            $query->where('status', $normalizedStatus);
        }

        if ($eventType !== null && trim($eventType) !== '') {
            $query->where('event_type', trim($eventType));
        }

        $total = (clone $query)->count();

        /** @var list<stdClass> $items */
        $items = $query
            ->orderByDesc('created_at')
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

    /**
     * @param  list<string>  $eventTypes
     * @return array{processed: int, failed: int, skipped: int, events: list<stdClass>}
     */
    public function processBatch(
        string $clinicId,
        int $limit = 50,
        array $eventTypes = [],
    ): array {
        $boundedLimit = $this->normalizeLimit($limit);
        $normalizedTypes = $this->normalizeEventTypes($eventTypes);

        if ($this->mode->isDisabled()) {
            $pendingCount = $this->duePendingQuery($clinicId, $normalizedTypes, CarbonImmutable::now('UTC'))
                ->limit($boundedLimit)
                ->count();

            return [
                'processed' => 0,
                'failed' => 0,
                'skipped' => $pendingCount,
                'events' => [],
            ];
        }

        $claimedIds = $this->claimDueIds($clinicId, $boundedLimit, $normalizedTypes);
        if ($claimedIds === []) {
            return [
                'processed' => 0,
                'failed' => 0,
                'skipped' => 0,
                'events' => [],
            ];
        }

        $processed = 0;
        $failed = 0;
        $skipped = 0;
        $touchedIds = [];

        foreach ($claimedIds as $eventId) {
            $outcome = $this->processClaimedEvent($clinicId, $eventId);
            $touchedIds[] = $eventId;

            if ($outcome === 'processed') {
                $processed++;
            } elseif ($outcome === 'failed') {
                $failed++;
            } else {
                $skipped++;
            }
        }

        /** @var list<stdClass> $events */
        $events = DB::table('outbox_events')
            ->where('clinic_id', $clinicId)
            ->whereIn('id', $touchedIds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->all();

        return [
            'processed' => $processed,
            'failed' => $failed,
            'skipped' => $skipped,
            'events' => $events,
        ];
    }

    /**
     * Traite un événement outbox ciblé de manière idempotente sous verrou rank 38.
     */
    public function processEvent(string $clinicId, string $eventId): string
    {
        if ($this->mode->isDisabled()) {
            return 'skipped';
        }

        return $this->processClaimedEvent($clinicId, $eventId);
    }

    /**
     * @param  list<string>  $eventTypes
     * @return array{processed: int, failed: int, skipped: int, clinics: int}
     */
    public function processAllPendingClinics(int $limitPerClinic = 50, array $eventTypes = []): array
    {
        /** @var list<string> $clinicIds */
        $clinicIds = DB::table('outbox_events')
            ->where('status', 'PENDING')
            ->distinct()
            ->pluck('clinic_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $totalProcessed = 0;
        $totalFailed = 0;
        $totalSkipped = 0;

        foreach ($clinicIds as $clinicId) {
            $result = $this->processBatch($clinicId, $limitPerClinic, $eventTypes);
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

    /**
     * @param  list<string>  $eventTypes
     * @return list<string>
     */
    private function claimDueIds(string $clinicId, int $limit, array $eventTypes): array
    {
        $now = CarbonImmutable::now('UTC');
        $nowDb = $now->format('Y-m-d H:i:s.u');

        /** @var list<string> */
        return $this->transactions->run(function () use ($clinicId, $limit, $eventTypes, $now, $nowDb): array {
            /** @var list<string> $ids */
            $ids = $this->duePendingQuery($clinicId, $eventTypes, $now)
                ->orderBy('created_at')
                ->orderBy('id')
                ->limit($limit)
                ->lock('for update skip locked')
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            if ($ids === []) {
                return [];
            }

            DB::table('outbox_events')
                ->where('clinic_id', $clinicId)
                ->whereIn('id', $ids)
                ->update([
                    'status' => 'PROCESSING',
                    'updated_at' => $nowDb,
                ]);

            return $ids;
        });
    }

    private function processClaimedEvent(string $clinicId, string $eventId): string
    {
        try {
            /** @var string $outcome */
            $outcome = $this->transactions->run(function () use ($clinicId, $eventId): string {
                $locks = new TransactionLocks($clinicId);
                $row = $locks->outboxEvent($eventId);

                if ($row === null) {
                    return 'not_found';
                }

                $status = (string) $row->status;
                if ($status === 'PROCESSED') {
                    return 'already_processed';
                }

                if ($status === 'FAILED') {
                    return 'skipped';
                }

                $matchingConsumers = $this->consumersFor((string) $row->event_type);
                if ($matchingConsumers === []) {
                    if ($status === 'PROCESSING') {
                        DB::table('outbox_events')
                            ->where('clinic_id', $clinicId)
                            ->where('id', $eventId)
                            ->update([
                                'status' => 'PENDING',
                                'updated_at' => $this->nowUtcDb(),
                            ]);
                    }

                    return 'skipped';
                }

                $payload = $this->decodePayload($row->payload ?? null);

                foreach ($matchingConsumers as $consumer) {
                    $consumer->handle($row, $payload);
                }

                $nowDb = $this->nowUtcDb();

                DB::table('outbox_events')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $eventId)
                    ->update([
                        'status' => 'PROCESSED',
                        'processed_at' => $nowDb,
                        'attempt_count' => (int) $row->attempt_count + 1,
                        'next_attempt_at' => null,
                        'last_error_code' => null,
                        'updated_at' => $nowDb,
                    ]);

                return 'processed';
            });

            if ($outcome === 'not_found') {
                throw BusinessError::notFound('Événement outbox introuvable.');
            }

            return $outcome;
        } catch (BusinessError $error) {
            $isRetryable = $this->isRetryableError($error);
            $this->recordFailure($clinicId, $eventId, $error->errorCode, $isRetryable);

            return 'failed';
        } catch (JsonException $exception) {
            $this->recordFailure($clinicId, $eventId, 'INVALID_PAYLOAD', false);

            return 'failed';
        } catch (Throwable $exception) {
            $code = $this->errorCodeFromThrowable($exception);
            $this->recordFailure($clinicId, $eventId, $code, true);

            return 'failed';
        }
    }

    private function recordFailure(
        string $clinicId,
        string $eventId,
        string $errorCode,
        bool $retryable,
    ): void {
        $maxAttempts = $this->mode->outboxMaxAttempts();
        $now = CarbonImmutable::now('UTC');
        $nowDb = $now->format('Y-m-d H:i:s.u');

        $this->transactions->run(function () use (
            $clinicId,
            $eventId,
            $errorCode,
            $retryable,
            $maxAttempts,
            $now,
            $nowDb,
        ): void {
            $locks = new TransactionLocks($clinicId);
            $row = $locks->outboxEvent($eventId);

            if ($row === null || (string) $row->status === 'PROCESSED') {
                return;
            }

            $nextAttemptCount = (int) $row->attempt_count + 1;
            $exhausted = ! $retryable || $nextAttemptCount >= $maxAttempts;

            if ($exhausted) {
                DB::table('outbox_events')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $eventId)
                    ->update([
                        'status' => 'FAILED',
                        'attempt_count' => $nextAttemptCount,
                        'next_attempt_at' => null,
                        'last_error_code' => substr($errorCode, 0, 100),
                        'updated_at' => $nowDb,
                    ]);

                return;
            }

            $backoffSeconds = $this->computeBackoffSeconds($nextAttemptCount);

            DB::table('outbox_events')
                ->where('clinic_id', $clinicId)
                ->where('id', $eventId)
                ->update([
                    'status' => 'PENDING',
                    'attempt_count' => $nextAttemptCount,
                    'next_attempt_at' => $now->addSeconds($backoffSeconds)->format('Y-m-d H:i:s.u'),
                    'last_error_code' => substr($errorCode, 0, 100),
                    'updated_at' => $nowDb,
                ]);
        });
    }

    private function computeBackoffSeconds(int $attemptCount): int
    {
        $exponent = min(10, max(0, $attemptCount - 1));

        return min(3600, 10 * (1 << $exponent));
    }

    private function isRetryableError(BusinessError $error): bool
    {
        $status = $error->httpStatus;

        return $status >= 500 || $status === 429 || $status === 408;
    }

    private function errorCodeFromThrowable(Throwable $exception): string
    {
        $parts = explode('\\', $exception::class);
        $base = strtoupper(preg_replace('/[^A-Za-z0-9_]/', '_', end($parts)) ?? 'CONSUMER_ERROR');

        return $base !== '' ? substr($base, 0, 100) : 'CONSUMER_ERROR';
    }

    /**
     * @param  list<string>  $eventTypes
     */
    private function duePendingQuery(
        string $clinicId,
        array $eventTypes,
        CarbonImmutable $now,
    ): Builder {
        $nowDb = $now->format('Y-m-d H:i:s.u');

        $query = DB::table('outbox_events')
            ->where('clinic_id', $clinicId)
            ->where('status', 'PENDING')
            ->where(static function (Builder $inner) use ($nowDb): void {
                $inner->whereNull('next_attempt_at')
                    ->orWhere('next_attempt_at', '<=', $nowDb);
            });

        if ($eventTypes !== []) {
            $query->whereIn('event_type', $eventTypes);
        }

        return $query;
    }

    /**
     * @return list<OutboxConsumerInterface>
     */
    private function consumersFor(string $eventType): array
    {
        $matches = [];
        foreach ($this->consumers as $consumer) {
            if ($consumer->supports($eventType)) {
                $matches[] = $consumer;
            }
        }

        return $matches;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodePayload(mixed $raw): array
    {
        if (is_array($raw)) {
            /** @var array<string, mixed> $raw */
            return $raw;
        }

        if (! is_string($raw) || trim($raw) === '') {
            throw new JsonException('Payload outbox vide.');
        }

        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($decoded)) {
            throw new JsonException('Payload outbox non objet.');
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    private function normalizeLimit(int $limit): int
    {
        if ($limit < 1 || $limit > self::MAX_BATCH_LIMIT) {
            throw BusinessError::validation([
                'limit' => ['La limite doit être comprise entre 1 et '.self::MAX_BATCH_LIMIT.'.'],
            ]);
        }

        return $limit;
    }

    /**
     * @param  list<string>  $eventTypes
     * @return list<string>
     */
    private function normalizeEventTypes(array $eventTypes): array
    {
        $normalized = [];
        foreach ($eventTypes as $type) {
            $trimmed = trim($type);
            if ($trimmed !== '') {
                $normalized[] = $trimmed;
            }
        }

        return array_values(array_unique($normalized));
    }

    private function nowUtcDb(): string
    {
        return CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
    }
}

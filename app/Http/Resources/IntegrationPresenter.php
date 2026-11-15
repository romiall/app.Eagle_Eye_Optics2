<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use JsonException;
use stdClass;

/**
 * Sérialiseur strict des ressources d'intégrations, outbox et webhooks vers les schémas
 * contractuels (contracts/schemas/resources/communication.json).
 * Ne expose jamais credentials_ciphertext ni aucun secret déchiffré.
 */
final class IntegrationPresenter
{
    /**
     * @return array<string, mixed>
     */
    public function account(stdClass $row): array
    {
        $ciphertext = $row->credentials_ciphertext ?? null;
        $hasCredentials = is_string($ciphertext) && $ciphertext !== '';

        return [
            'id' => (string) $row->id,
            'provider' => (string) $row->provider,
            'external_account_id' => (string) $row->external_account_id,
            'display_name' => (string) $row->display_name,
            'status' => (string) $row->status,
            'has_credentials' => $hasCredentials,
            'encryption_key_id' => isset($row->encryption_key_id) ? (string) $row->encryption_key_id : null,
            'token_expires_at' => $this->formatInstant($row->token_expires_at ?? null),
            'public_configuration' => $this->decodeJsonObject($row->public_configuration ?? null),
            'version' => (int) $row->version,
            'updated_at' => $this->formatInstant($row->updated_at) ?? '',
        ];
    }

    /**
     * @param  array{
     *     mode: string,
     *     credentials_configured: bool,
     *     accounts_total: int,
     *     accounts_active: int,
     *     accounts_error: int,
     *     outbox_pending: int,
     *     outbox_failed: int,
     *     webhook_pending: int,
     *     webhook_failed: int,
     *     calendar_stale: int,
     *     accounts: list<stdClass>
     * }  $summary
     * @return array<string, mixed>
     */
    public function health(array $summary): array
    {
        return [
            'mode' => $summary['mode'],
            'credentials_configured' => $summary['credentials_configured'],
            'accounts_total' => $summary['accounts_total'],
            'accounts_active' => $summary['accounts_active'],
            'accounts_error' => $summary['accounts_error'],
            'outbox_pending' => $summary['outbox_pending'],
            'outbox_failed' => $summary['outbox_failed'],
            'webhook_pending' => $summary['webhook_pending'],
            'webhook_failed' => $summary['webhook_failed'],
            'calendar_stale' => $summary['calendar_stale'],
            'accounts' => array_map(
                fn (stdClass $account): array => $this->account($account),
                $summary['accounts'],
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function connectionTest(
        string $accountId,
        string $provider,
        bool $reachable,
        string $mode,
        string $status,
        string $checkedAt,
        ?string $detail,
    ): array {
        return [
            'account_id' => $accountId,
            'provider' => $provider,
            'reachable' => $reachable,
            'mode' => $mode,
            'status' => $status,
            'checked_at' => $checkedAt,
            'detail' => $detail,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function outboxEvent(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'event_type' => (string) $row->event_type,
            'event_version' => (int) $row->event_version,
            'source_type' => (string) $row->source_type,
            'source_id' => (string) $row->source_id,
            'source_version' => (int) $row->source_version,
            'status' => (string) $row->status,
            'attempt_count' => (int) $row->attempt_count,
            'next_attempt_at' => $this->formatInstant($row->next_attempt_at ?? null),
            'processed_at' => $this->formatInstant($row->processed_at ?? null),
            'last_error_code' => isset($row->last_error_code) ? (string) $row->last_error_code : null,
            'correlation_id' => (string) $row->correlation_id,
            'created_at' => $this->formatInstant($row->created_at) ?? '',
        ];
    }

    /**
     * @param  list<stdClass>  $events
     * @return array<string, mixed>
     */
    public function outboxBatchResult(int $processed, int $failed, int $skipped, array $events): array
    {
        return [
            'processed' => $processed,
            'failed' => $failed,
            'skipped' => $skipped,
            'events' => array_map(
                fn (stdClass $row): array => $this->outboxEvent($row),
                $events,
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function webhookInboxItem(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'integration_account_id' => (string) $row->integration_account_id,
            'provider_event_key' => (string) $row->provider_event_key,
            'payload_hash' => (string) $row->payload_hash,
            'received_at' => $this->formatInstant($row->received_at) ?? '',
            'status' => (string) $row->status,
            'verified_at' => $this->formatInstant($row->verified_at ?? null),
            'processed_at' => $this->formatInstant($row->processed_at ?? null),
            'attempt_count' => (int) $row->attempt_count,
            'last_error_code' => isset($row->last_error_code) ? (string) $row->last_error_code : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function webhookIngestResult(bool $accepted, bool $duplicate, ?string $inboxId, string $status): array
    {
        return [
            'accepted' => $accepted,
            'duplicate' => $duplicate,
            'inbox_id' => $inboxId,
            'status' => $status,
        ];
    }

    /**
     * @param  array{outbox_processed: int, webhooks_processed: int, attempts_reconciled: int, calendar_synced: int}  $result
     * @return array<string, int>
     */
    public function reconcileResult(array $result): array
    {
        return [
            'outbox_processed' => $result['outbox_processed'],
            'webhooks_processed' => $result['webhooks_processed'],
            'attempts_reconciled' => $result['attempts_reconciled'],
            'calendar_synced' => $result['calendar_synced'],
        ];
    }

    /**
     * @return array{current_page: int, last_page: int, per_page: int, total: int}
     */
    public function paginationMeta(int $currentPage, int $perPage, int $total): array
    {
        $normalizedPerPage = $perPage === 50 ? 50 : 25;
        $safeTotal = max(0, $total);

        return [
            'current_page' => max(1, $currentPage),
            'last_page' => max(1, (int) ceil($safeTotal / $normalizedPerPage)),
            'per_page' => $normalizedPerPage,
            'total' => $safeTotal,
        ];
    }

    public function formatInstant(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof CarbonImmutable) {
            return $value->utc()->format('Y-m-d\TH:i:s.v\Z');
        }

        $string = is_string($value) ? trim($value) : (is_scalar($value) ? (string) $value : '');
        if ($string === '') {
            return null;
        }

        return CarbonImmutable::parse($string, 'UTC')->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * @return array<string, mixed>|object|null
     */
    public function decodeJsonObject(mixed $raw): array|object|null
    {
        if ($raw === null) {
            return null;
        }

        if (is_string($raw)) {
            $trimmed = trim($raw);
            if ($trimmed === '') {
                return null;
            }

            try {
                $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                return null;
            }

            if (! is_array($decoded)) {
                return null;
            }

            return $decoded === [] ? (object) [] : $decoded;
        }

        if (is_array($raw)) {
            return $raw === [] ? (object) [] : $raw;
        }

        if ($raw instanceof stdClass) {
            return $raw;
        }

        return null;
    }
}

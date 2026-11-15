<?php

namespace App\Domain\Operations;

use App\Domain\Shared\BusinessError;
use App\Support\Integrations\IntegrationMode;
use Illuminate\Support\Facades\DB;

/**
 * Orchestrateur borné de réconciliation des intégrations (outbox + webhook_inbox).
 */
final class IntegrationReconciler
{
    private const MAX_LIMIT = 200;

    public function __construct(
        private readonly IntegrationMode $mode,
        private readonly OutboxProcessor $outbox,
        private readonly WebhookInboxService $webhooks,
    ) {}

    /**
     * @return array{
     *     outbox_processed: int,
     *     webhooks_processed: int,
     *     attempts_reconciled: int,
     *     calendar_synced: int
     * }
     */
    public function reconcile(string $clinicId, int $limit = 50): array
    {
        if ($limit < 1 || $limit > self::MAX_LIMIT) {
            throw BusinessError::validation([
                'limit' => ['La limite doit être comprise entre 1 et '.self::MAX_LIMIT.'.'],
            ]);
        }

        if ($this->mode->isDisabled()) {
            return [
                'outbox_processed' => 0,
                'webhooks_processed' => 0,
                'attempts_reconciled' => 0,
                'calendar_synced' => 0,
            ];
        }

        $outboxResult = $this->outbox->processBatch($clinicId, $limit);
        $webhookResult = $this->webhooks->processBatch($clinicId, $limit);

        return [
            'outbox_processed' => $outboxResult['processed'],
            'webhooks_processed' => $webhookResult['processed'],
            'attempts_reconciled' => 0,
            'calendar_synced' => 0,
        ];
    }

    /**
     * @return array{
     *     outbox_processed: int,
     *     webhooks_processed: int,
     *     attempts_reconciled: int,
     *     calendar_synced: int,
     *     clinics: int
     * }
     */
    public function reconcileAllClinics(int $limitPerClinic = 50): array
    {
        if ($limitPerClinic < 1 || $limitPerClinic > self::MAX_LIMIT) {
            throw BusinessError::validation([
                'limit' => ['La limite doit être comprise entre 1 et '.self::MAX_LIMIT.'.'],
            ]);
        }

        if ($this->mode->isDisabled()) {
            return [
                'outbox_processed' => 0,
                'webhooks_processed' => 0,
                'attempts_reconciled' => 0,
                'calendar_synced' => 0,
                'clinics' => 0,
            ];
        }

        /** @var list<string> $outboxClinics */
        $outboxClinics = DB::table('outbox_events')
            ->where('status', 'PENDING')
            ->distinct()
            ->pluck('clinic_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        /** @var list<string> $webhookClinics */
        $webhookClinics = DB::table('webhook_inbox')
            ->where('status', 'VERIFIED')
            ->distinct()
            ->pluck('clinic_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $clinicIds = array_values(array_unique(array_merge($outboxClinics, $webhookClinics)));

        $totals = [
            'outbox_processed' => 0,
            'webhooks_processed' => 0,
            'attempts_reconciled' => 0,
            'calendar_synced' => 0,
            'clinics' => count($clinicIds),
        ];

        foreach ($clinicIds as $clinicId) {
            $result = $this->reconcile($clinicId, $limitPerClinic);
            $totals['outbox_processed'] += $result['outbox_processed'];
            $totals['webhooks_processed'] += $result['webhooks_processed'];
            $totals['attempts_reconciled'] += $result['attempts_reconciled'];
            $totals['calendar_synced'] += $result['calendar_synced'];
        }

        return $totals;
    }
}

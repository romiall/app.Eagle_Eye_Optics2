<?php

namespace App\Domain\Operations;

use App\Support\Integrations\IntegrationCrypto;
use App\Support\Integrations\IntegrationMode;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Synthèse de santé des intégrations pour une clinique donnée :
 * mode actif, présence de la clé maître, compteurs comptes/outbox/webhooks/calendrier.
 */
final class IntegrationHealth
{
    public function __construct(
        private readonly IntegrationMode $mode,
        private readonly IntegrationCrypto $crypto,
        private readonly IntegrationAccounts $accounts,
    ) {}

    /**
     * @return array{
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
     * }
     */
    public function summary(string $clinicId): array
    {
        $accounts = $this->accounts->list($clinicId);

        $accountsActive = 0;
        $accountsError = 0;
        foreach ($accounts as $account) {
            if ((string) $account->status === 'ACTIVE') {
                $accountsActive++;
            } elseif ((string) $account->status === 'ERROR') {
                $accountsError++;
            }
        }

        $outboxPending = DB::table('outbox_events')
            ->where('clinic_id', $clinicId)
            ->whereIn('status', ['PENDING', 'PROCESSING'])
            ->count();

        $outboxFailed = DB::table('outbox_events')
            ->where('clinic_id', $clinicId)
            ->where('status', 'FAILED')
            ->count();

        $webhookPending = DB::table('webhook_inbox')
            ->where('clinic_id', $clinicId)
            ->whereIn('status', ['RECEIVED', 'VERIFIED'])
            ->count();

        $webhookFailed = DB::table('webhook_inbox')
            ->where('clinic_id', $clinicId)
            ->where('status', 'FAILED')
            ->count();

        $calendarStale = DB::table('calendar_sync_states')
            ->where('clinic_id', $clinicId)
            ->where('status', 'STALE')
            ->count();

        return [
            'mode' => $this->mode->mode(),
            'credentials_configured' => $this->crypto->isConfigured(),
            'accounts_total' => count($accounts),
            'accounts_active' => $accountsActive,
            'accounts_error' => $accountsError,
            'outbox_pending' => $outboxPending,
            'outbox_failed' => $outboxFailed,
            'webhook_pending' => $webhookPending,
            'webhook_failed' => $webhookFailed,
            'calendar_stale' => $calendarStale,
            'accounts' => $accounts,
        ];
    }
}

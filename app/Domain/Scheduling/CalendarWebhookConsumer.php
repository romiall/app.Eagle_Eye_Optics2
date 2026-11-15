<?php

namespace App\Domain\Scheduling;

use App\Domain\Shared\Ulid;
use App\Support\Integrations\Contracts\WebhookConsumerInterface;
use Illuminate\Support\Facades\DB;

/**
 * Réception des notifications push Google Calendar (L2D02) : identifie la ou les ressources
 * reliées au compte Google et déclenche une synchronisation incrémentale ciblée.
 */
final class CalendarWebhookConsumer implements WebhookConsumerInterface
{
    public function __construct(private readonly CalendarReconciliation $reconciliation) {}

    public function supports(string $provider): bool
    {
        return strtoupper(trim($provider)) === 'GOOGLE';
    }

    public function handle(string $clinicId, string $accountId, string $provider, array $payload): void
    {
        $baseQuery = DB::table('calendar_sync_states')
            ->where('clinic_id', $clinicId)
            ->where('integration_account_id', $accountId)
            ->where('status', '<>', 'NOT_CONFIGURED');

        $resourceId = is_string($payload['resource_id'] ?? null) ? $payload['resource_id'] : null;
        $channelId = is_string($payload['channel_id'] ?? null) ? $payload['channel_id'] : null;
        $calendarId = is_string($payload['external_calendar_id'] ?? null)
            ? $payload['external_calendar_id']
            : (is_string($payload['calendar_id'] ?? null) ? $payload['calendar_id'] : null);

        $filtered = (clone $baseQuery);
        if ($resourceId !== null) {
            $filtered->where('resource_id', $resourceId);
        } elseif ($channelId !== null) {
            $filtered->where('push_channel_id', $channelId);
        } elseif ($calendarId !== null) {
            $filtered->where('external_calendar_id', $calendarId);
        }

        $states = $filtered->orderBy('id')->get(['resource_id'])->all();
        if ($states === [] && ($resourceId !== null || $channelId !== null || $calendarId !== null)) {
            $states = $baseQuery->orderBy('id')->get(['resource_id'])->all();
        }

        $correlationId = Ulid::generate();
        foreach ($states as $state) {
            $this->reconciliation->syncAutomated(
                clinicId: $clinicId,
                jobName: 'CalendarWebhookConsumer',
                correlationId: $correlationId,
                resourceId: (string) $state->resource_id,
                fullResync: false,
            );
        }
    }
}

<?php

namespace App\Domain\Scheduling;

use App\Domain\Shared\Ulid;
use App\Support\Integrations\Contracts\OutboxConsumerInterface;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Répercute les événements d'agenda (`AppointmentConfirmed`, `AppointmentRescheduled`,
 * `AppointmentCancelled`, `AppointmentNoShow`) sur la synchronisation Google Calendar de la ressource
 * concernée lorsqu'un état `calendar_sync_states` est actif.
 */
final class CalendarOutboxConsumer implements OutboxConsumerInterface
{
    /** @var list<string> */
    private const SUPPORTED_EVENTS = [
        'AppointmentConfirmed',
        'AppointmentRescheduled',
        'AppointmentCancelled',
        'AppointmentNoShow',
    ];

    public function __construct(private readonly CalendarReconciliation $reconciliation) {}

    public function supports(string $eventType): bool
    {
        return in_array($eventType, self::SUPPORTED_EVENTS, true);
    }

    public function handle(stdClass $outboxRow, array $payload): void
    {
        $clinicId = (string) $outboxRow->clinic_id;
        $resourceId = is_string($payload['resource_id'] ?? null) ? $payload['resource_id'] : null;

        if ($resourceId === null && is_string($payload['appointment_id'] ?? null)) {
            $lookedUp = DB::table('appointments')
                ->where('clinic_id', $clinicId)
                ->where('id', $payload['appointment_id'])
                ->value('resource_id');
            if (is_string($lookedUp)) {
                $resourceId = $lookedUp;
            }
        }

        if ($resourceId === null) {
            return;
        }

        $configured = DB::table('calendar_sync_states')
            ->where('clinic_id', $clinicId)
            ->where('resource_id', $resourceId)
            ->where('status', '<>', 'NOT_CONFIGURED')
            ->exists();

        if (! $configured) {
            return;
        }

        $correlationId = is_string($outboxRow->correlation_id ?? null) && $outboxRow->correlation_id !== ''
            ? $outboxRow->correlation_id
            : Ulid::generate();

        $this->reconciliation->syncAutomated(
            clinicId: $clinicId,
            jobName: 'CalendarOutboxConsumer',
            correlationId: $correlationId,
            resourceId: $resourceId,
            fullResync: false,
        );
    }
}

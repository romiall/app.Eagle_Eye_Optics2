<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Domain\Shared\CommandContext;
use App\Support\Integrations\Contracts\OutboxConsumerInterface;
use Carbon\CarbonImmutable;
use stdClass;

/**
 * Consommateur outbox des événements administratifs de communication :
 * - matérialise des tâches de contact selon les politiques de rappel actives ;
 * - exécute les demandes d'envoi transactionnel différées post-commit.
 */
final class CommunicationOutboxConsumer implements OutboxConsumerInterface
{
    private const SUPPORTED_EVENTS = [
        'AppointmentConfirmed',
        'WorkshopReady',
        'WorkshopOrderReady',
        'FollowUpScheduled',
        'FollowUpPlanCreated',
        'InvoiceIssued',
        'PaymentFollowUpScheduled',
        'SendTransactionalMessageRequested',
    ];

    public function __construct(
        private readonly ReminderPolicies $policies,
        private readonly SendTransactionalMessage $sender,
    ) {}

    public function supports(string $eventType): bool
    {
        return in_array($eventType, self::SUPPORTED_EVENTS, true);
    }

    public function handle(stdClass $outboxRow, array $payload): void
    {
        $clinicId = (string) $outboxRow->clinic_id;
        $eventType = (string) $outboxRow->event_type;
        $sourceId = (string) $outboxRow->source_id;
        $sourceVersion = (int) $outboxRow->source_version;

        if ($eventType === 'SendTransactionalMessageRequested') {
            $taskId = is_string($payload['task_id'] ?? null) && $payload['task_id'] !== ''
                ? $payload['task_id']
                : $sourceId;

            $context = CommandContext::job(
                $clinicId,
                'outbox:SendTransactionalMessage',
                (string) ($outboxRow->correlation_id ?? $outboxRow->id),
                CarbonImmutable::now('UTC'),
            );

            $this->sender->sendForTask($context, $taskId, $payload);

            return;
        }

        $occurredAt = is_string($outboxRow->created_at ?? null)
            ? CarbonImmutable::parse((string) $outboxRow->created_at, 'UTC')
            : CarbonImmutable::now('UTC');

        $this->policies->materializeTasksForEvent(
            $clinicId,
            $eventType,
            $sourceId,
            $sourceVersion,
            $payload,
            $occurredAt,
        );
    }
}

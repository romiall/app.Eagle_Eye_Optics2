<?php

namespace App\Console\Commands;

use App\Domain\Operations\OutboxProcessor;
use Illuminate\Console\Command;

/**
 * Traite les événements en attente de la table outbox_events pour une clinique
 * donnée ou pour l'ensemble des cliniques ayant des événements dus.
 */
final class ProcessOutboxEvents extends Command
{
    protected $signature = 'eeo:integrations:outbox
        {--clinic= : Identifiant ULID de la clinique cible}
        {--limit=50 : Nombre maximal d’événements à traiter par clinique (1 à 200)}
        {--event-type=* : Filtrer sur un ou plusieurs types d’événements}';

    protected $description = 'Traite un lot borné d’événements outbox en attente.';

    public function handle(OutboxProcessor $processor): int
    {
        $limit = max(1, min(200, (int) $this->option('limit')));
        $rawClinic = $this->option('clinic');
        $clinicId = is_string($rawClinic) && trim($rawClinic) !== '' ? trim($rawClinic) : null;

        $rawEventTypes = $this->option('event-type');
        $eventTypes = [];
        if (is_array($rawEventTypes)) {
            foreach ($rawEventTypes as $type) {
                if (is_string($type) && trim($type) !== '') {
                    $eventTypes[] = trim($type);
                }
            }
        }

        if ($clinicId !== null) {
            $result = $processor->processBatch($clinicId, $limit, $eventTypes);
            $this->info(sprintf(
                'Outbox clinique %s : processed=%d failed=%d skipped=%d',
                $clinicId,
                $result['processed'],
                $result['failed'],
                $result['skipped'],
            ));

            return self::SUCCESS;
        }

        $result = $processor->processAllPendingClinics($limit, $eventTypes);
        $this->info(sprintf(
            'Outbox multi-cliniques (%d) : processed=%d failed=%d skipped=%d',
            $result['clinics'],
            $result['processed'],
            $result['failed'],
            $result['skipped'],
        ));

        return self::SUCCESS;
    }
}

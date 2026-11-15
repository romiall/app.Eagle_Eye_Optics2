<?php

namespace App\Console\Commands;

use App\Domain\Operations\IntegrationReconciler;
use Illuminate\Console\Command;

/**
 * Exécute une passe bornée de réconciliation des intégrations (outbox et webhook_inbox).
 */
final class ReconcileIntegrations extends Command
{
    protected $signature = 'eeo:integrations:reconcile
        {--clinic= : Identifiant ULID de la clinique cible}
        {--limit=50 : Nombre maximal d’éléments à traiter par clinique (1 à 200)}';

    protected $description = 'Exécute une passe bornée de réconciliation outbox et webhooks.';

    public function handle(IntegrationReconciler $reconciler): int
    {
        $limit = max(1, min(200, (int) $this->option('limit')));
        $rawClinic = $this->option('clinic');
        $clinicId = is_string($rawClinic) && trim($rawClinic) !== '' ? trim($rawClinic) : null;

        if ($clinicId !== null) {
            $result = $reconciler->reconcile($clinicId, $limit);
            $this->info(sprintf(
                'Réconciliation clinique %s : outbox=%d webhooks=%d attempts=%d calendar=%d',
                $clinicId,
                $result['outbox_processed'],
                $result['webhooks_processed'],
                $result['attempts_reconciled'],
                $result['calendar_synced'],
            ));

            return self::SUCCESS;
        }

        $result = $reconciler->reconcileAllClinics($limit);
        $this->info(sprintf(
            'Réconciliation multi-cliniques (%d) : outbox=%d webhooks=%d attempts=%d calendar=%d',
            $result['clinics'],
            $result['outbox_processed'],
            $result['webhooks_processed'],
            $result['attempts_reconciled'],
            $result['calendar_synced'],
        ));

        return self::SUCCESS;
    }
}

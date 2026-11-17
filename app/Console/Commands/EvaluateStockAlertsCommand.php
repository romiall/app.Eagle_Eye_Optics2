<?php

namespace App\Console\Commands;

use App\Application\Command;
use App\Application\CommandBus;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Console\Command as ConsoleCommand;
use Illuminate\Support\Facades\DB;

/**
 * Tâche planifiée des alertes de stock bas et de péremption (L1D03), appelée par `schedule:run` ou à la demande :
 * parcourt les cabinets actifs et passe par le `CommandBus` (`CommandSource::Job`) pour garantir déduplication sous
 * verrou, audit et publication `StockThresholdCrossed` sans doublon ni spam de tâches.
 */
final class EvaluateStockAlertsCommand extends ConsoleCommand
{
    protected $signature = 'eeo:stock:evaluate-alerts';

    protected $description = 'Évalue les seuils de stock bas et dates de péremption des lots (L1D03)';

    public function handle(CommandBus $bus): int
    {
        $clinicIds = DB::table('clinics')->orderBy('id')->pluck('id');
        $opened = 0;
        $reopened = 0;
        $resolved = 0;

        foreach ($clinicIds as $clinicId) {
            $id = (string) $clinicId;
            $result = $bus->dispatch(
                new Command('EvaluateStockAlerts', [], null, null),
                CommandContext::job($id, 'stock.alerts', Ulid::generate()),
                'job-stock-alerts:'.Ulid::generate(),
            );
            $opened += (int) ($result->result['opened'] ?? 0);
            $reopened += (int) ($result->result['reopened'] ?? 0);
            $resolved += (int) ($result->result['resolved'] ?? 0);
        }

        $this->line(sprintf(
            'Alertes évaluées (%d cabinet(s)) : %d ouverte(s), %d rouverte(s), %d résolue(s).',
            $clinicIds->count(),
            $opened,
            $reopened,
            $resolved,
        ));

        return self::SUCCESS;
    }
}

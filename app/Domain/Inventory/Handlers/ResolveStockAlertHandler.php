<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Résolution manuelle d'une alerte de stock (L1D03) : `OPEN` ou `ACKNOWLEDGED` → `RESOLVED`, sans jamais écrire de
 * mouvement ni lever le blocage d'un lot expiré ou en quarantaine.
 */
final class ResolveStockAlertHandler implements CommandHandler
{
    public const COMMAND = 'ResolveStockAlert';

    public function permissions(): array
    {
        return ['stock.adjust', 'stock.receive', 'stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null || $command->entityId === null) {
            throw new LogicException('Résoudre une alerte exige un compte connecté et une alerte visée.');
        }
        $alert = DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('id', $command->entityId)->first();
        if ($alert === null) {
            throw BusinessError::notFound('Alerte de stock introuvable dans ce cabinet.');
        }
        $status = (string) $alert->status;
        if (! in_array($status, ['OPEN', 'ACKNOWLEDGED'], true)) {
            throw BusinessError::stateRefused('Cette alerte est déjà résolue.', $status);
        }

        $stamp = $context->now->utc()->format('Y-m-d H:i:s.u');
        DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('id', $command->entityId)->update([
            'status' => 'RESOLVED',
            'acknowledged_by' => $alert->acknowledged_by ?? $context->actorId,
            'resolved_at' => $stamp,
            'updated_at' => $stamp,
        ]);

        return new CommandOutcome(
            result: ['stock_alert_id' => (string) $alert->id, 'status' => 'RESOLVED'],
            resultType: 'stock_alerts',
            resultId: (string) $alert->id,
            audit: [new AuditEntry('stock.alert_resolved', 'stock_alerts', (string) $alert->id, null, [
                'kind' => (string) $alert->kind,
                'item_id' => (string) $alert->item_id,
                'location_id' => (string) $alert->location_id,
                'lot_id' => $alert->lot_id,
            ])],
        );
    }
}

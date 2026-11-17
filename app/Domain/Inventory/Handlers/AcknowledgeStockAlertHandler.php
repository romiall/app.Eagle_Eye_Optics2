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
 * Accusé de réception d'une alerte de stock (L1D03) : `OPEN` → `ACKNOWLEDGED` en consignant l'auteur, sans modifier le
 * stock ni créer de mouvement. Un scheduler répété conserve cet accusé (sauf expiration nouvellement franchie).
 */
final class AcknowledgeStockAlertHandler implements CommandHandler
{
    public const COMMAND = 'AcknowledgeStockAlert';

    public function permissions(): array
    {
        return ['stock.adjust', 'stock.receive', 'stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null || $command->entityId === null) {
            throw new LogicException('Accuser réception d\'une alerte exige un compte connecté et une alerte visée.');
        }
        $alert = DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('id', $command->entityId)->first();
        if ($alert === null) {
            throw BusinessError::notFound('Alerte de stock introuvable dans ce cabinet.');
        }
        $status = (string) $alert->status;
        if ($status !== 'OPEN') {
            throw BusinessError::stateRefused(
                $status === 'ACKNOWLEDGED'
                    ? 'L\'alerte est déjà prise en compte.'
                    : 'Cette alerte est déjà résolue.',
                $status,
            );
        }

        $stamp = $context->now->utc()->format('Y-m-d H:i:s.u');
        DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('id', $command->entityId)->update([
            'status' => 'ACKNOWLEDGED',
            'acknowledged_by' => $context->actorId,
            'updated_at' => $stamp,
        ]);

        return new CommandOutcome(
            result: ['stock_alert_id' => (string) $alert->id, 'status' => 'ACKNOWLEDGED'],
            resultType: 'stock_alerts',
            resultId: (string) $alert->id,
            audit: [new AuditEntry('stock.alert_acknowledged', 'stock_alerts', (string) $alert->id, null, [
                'kind' => (string) $alert->kind,
                'item_id' => (string) $alert->item_id,
                'location_id' => (string) $alert->location_id,
                'lot_id' => $alert->lot_id,
            ])],
        );
    }
}

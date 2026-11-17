<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Changements d'état d'un inventaire (L1D02), sans effet sur le stock : terminer le comptage (OPEN → COUNTED, toutes
 * les lignes comptées), le rouvrir (COUNTED → OPEN) ou l'abandonner (OPEN ou COUNTED → ABANDONED, motif facultatif
 * conservé dans l'audit). Droit `stock.inventory`, EN LIGNE seulement. Le même gestionnaire est enregistré sous trois
 * noms de commande ; le nom reçu choisit la transition. La validation, seule à ajuster le stock, est à part
 * (`ValidateInventoryCount`, gérante).
 */
final class TransitionInventoryCountHandler implements CommandHandler
{
    public const COMPLETE = 'CompleteInventoryCount';

    public const REOPEN = 'ReopenInventoryCount';

    public const ABANDON = 'AbandonInventoryCount';

    public function permissions(): array
    {
        return ['stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null || $command->entityId === null) {
            throw new LogicException('Un changement d\'état d\'inventaire a toujours un auteur identifié et un inventaire visé.');
        }
        $countId = $command->entityId;
        $count = DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('id', $countId)->first();
        if ($count === null) {
            throw BusinessError::notFound('Inventaire introuvable dans ce cabinet.');
        }
        $status = (string) $count->status;
        [$allowedFrom, $target, $audit] = match ($command->name) {
            self::COMPLETE => [['OPEN'], 'COUNTED', 'stock.inventory_completed'],
            self::REOPEN => [['COUNTED'], 'OPEN', 'stock.inventory_reopened'],
            self::ABANDON => [['OPEN', 'COUNTED'], 'ABANDONED', 'stock.inventory_abandoned'],
            default => throw new LogicException('Commande d\'inventaire inconnue : '.$command->name),
        };
        if (! in_array($status, $allowedFrom, true)) {
            throw BusinessError::stateRefused('Cet inventaire est '.match ($status) {
                'OPEN' => 'ouvert : terminez son comptage avant de le valider',
                'COUNTED' => 'déjà compté',
                'VALIDATED' => 'validé : il est définitif',
                default => 'abandonné',
            }.' : cette opération n\'est pas possible.', $status);
        }

        $notCounted = DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->whereNull('counted_quantity')->count();
        if ($command->name === self::COMPLETE && $notCounted > 0) {
            throw BusinessError::validation(['lines' => [$notCounted === 1 ? 'Une ligne n\'est pas comptée : saisissez sa quantité (zéro si rien n\'est trouvé).' : $notCounted.' lignes ne sont pas comptées : saisissez leur quantité (zéro si rien n\'est trouvé).']]);
        }
        $reason = null;
        if ($command->name === self::ABANDON) {
            try {
                $reason = Text::optional(is_string($command->payload['reason'] ?? null) ? $command->payload['reason'] : null, 1000, 'reason');
            } catch (RuleViolation $violation) {
                throw BusinessError::validation([$violation->field => [$violation->getMessage()]]);
            }
        }

        DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('id', $countId)->update([
            'status' => $target,
            'updated_at' => $context->now->utc()->format('Y-m-d H:i:s.u'),
        ]);

        return new CommandOutcome(
            result: ['inventory_id' => $countId, 'status' => $target],
            resultType: 'inventory_counts',
            resultId: $countId,
            audit: [new AuditEntry($audit, 'inventory_counts', $countId, $reason, [
                'reference' => (string) $count->reference,
                'from' => $status,
                'to' => $target,
            ])],
        );
    }
}

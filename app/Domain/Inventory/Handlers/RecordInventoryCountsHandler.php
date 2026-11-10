<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Saisie des quantités comptées d'un inventaire OUVERT (L1D02) : par ligne (article, lot), la quantité réellement
 * trouvée (zéro admis, `null` efface le comptage) et, si besoin, le motif d'un écart. Droit `stock.inventory`, EN LIGNE
 * seulement. Cette saisie n'écrit AUCUN mouvement et ne change aucun stock : seule la validation, par la gérante,
 * ajuste le stock par des mouvements `ADJUSTMENT` signés (jamais un remplacement brut de la quantité).
 *
 * Un article vendu à l'unité se compte en nombre entier. Chaque ligne comptée garde son auteur et son instant : c'est
 * à cet instant que la validation juge le théorique (les ventes postérieures au comptage de la ligne ne sont pas un
 * écart).
 */
final class RecordInventoryCountsHandler implements CommandHandler
{
    public const COMMAND = 'RecordInventoryCounts';

    public function permissions(): array
    {
        return ['stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null || $command->entityId === null) {
            throw new LogicException('Un comptage a toujours un auteur identifié et un inventaire visé.');
        }
        $countId = $command->entityId;
        $count = DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('id', $countId)->first();
        if ($count === null) {
            throw BusinessError::notFound('Inventaire introuvable dans ce cabinet.');
        }
        if ((string) $count->status !== 'OPEN') {
            throw BusinessError::stateRefused('Seul un inventaire ouvert se compte : rouvrez-le d\'abord s\'il est déjà compté.', (string) $count->status);
        }

        /** @var list<array<string, mixed>> $given */
        $given = array_values((array) $command->payload['lines']);
        $ids = array_values(array_unique(array_map(static fn (array $line): string => (string) $line['line_id'], $given)));
        $stored = DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->whereIn('id', $ids)->get()->keyBy('id');
        $integerOnly = DB::table('catalog_items')->where('clinic_id', $context->clinicId)->whereIn('id', $stored->pluck('item_id')->unique()->values()->all())->pluck('quantity_integer_only', 'id');

        $errors = new FieldErrors;
        $at = $context->now->utc()->format('Y-m-d H:i:s.u');
        /** @var array<string, array<string, mixed>> $updates */
        $updates = [];
        foreach ($given as $index => $line) {
            $prefix = 'lines.'.$index;
            $lineId = (string) $line['line_id'];
            $row = $stored->get($lineId);
            if ($row === null) {
                $errors->add($prefix.'.line_id', 'Cette ligne n\'appartient pas à cet inventaire.');

                continue;
            }
            if (isset($updates[$lineId])) {
                $errors->add($prefix.'.line_id', 'Cette ligne est donnée deux fois.');

                continue;
            }
            $update = ['updated_at' => $at];
            $counted = $line['counted_quantity'] ?? null;
            if ($counted === null) {
                $update += ['counted_quantity' => null, 'counted_by' => null, 'counted_at' => null];
            } else {
                try {
                    $quantity = Quantity::parse((string) $counted, 'counted_quantity');
                    if ($quantity === null) {
                        $errors->add($prefix.'.counted_quantity', 'La quantité comptée est obligatoire (zéro si rien n\'est trouvé).');

                        continue;
                    }
                    if ((bool) ($integerOnly[(string) $row->item_id] ?? true) && ! $quantity->isInteger()) {
                        $errors->add($prefix.'.counted_quantity', 'Cet article se vend à l\'unité : quantité entière obligatoire.');

                        continue;
                    }
                    $update += ['counted_quantity' => $quantity->canonical(), 'counted_by' => $context->actorId, 'counted_at' => $at];
                } catch (RuleViolation $violation) {
                    $errors->addViolation($prefix, $violation);

                    continue;
                }
            }
            if (array_key_exists('variance_reason', $line)) {
                try {
                    $update['variance_reason'] = Text::optional(is_string($line['variance_reason']) ? $line['variance_reason'] : null, 1000, 'variance_reason');
                } catch (RuleViolation $violation) {
                    $errors->addViolation($prefix, $violation);

                    continue;
                }
            }
            $updates[$lineId] = $update;
        }
        $errors->throwIfAny();

        foreach ($updates as $lineId => $update) {
            DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->where('id', $lineId)->update($update);
        }
        $total = DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->count();
        $counted = DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->whereNotNull('counted_quantity')->count();

        return new CommandOutcome(
            result: ['inventory_id' => $countId, 'counted_lines' => $counted, 'total_lines' => $total],
            resultType: 'inventory_counts',
            resultId: $countId,
            audit: [new AuditEntry('stock.inventory_counted', 'inventory_counts', $countId, null, [
                'lines_recorded' => count($updates),
                'counted_lines' => $counted,
                'total_lines' => $total,
            ])],
        );
    }
}

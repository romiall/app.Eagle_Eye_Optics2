<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Guards\ActorRights;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Inventory\Rules\StockValue;
use App\Domain\Inventory\StockCounters;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\DirectApproval;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use LogicException;
use stdClass;

/**
 * Validation d'un inventaire (L1D02, EE026, EE030, AT30) : la gérante, réauthentifiée, approuve les écarts ; chaque
 * écart devient un mouvement `ADJUSTMENT` SIGNÉ, append-only, motivé, rattaché à une approbation directe (CHECK
 * `ck_stock_movements_06`) ; la quantité n'est JAMAIS remplacée par la quantité comptée. Droit `stock.inventory` ET
 * autorité de gérante (comme le stock initial), EN LIGNE seulement, clé d'idempotence obligatoire.
 *
 * Ce que la validation juge : pour chaque ligne, le théorique AU MOMENT DU COMPTAGE de la ligne = théorique figé à
 * l'ouverture + mouvements enregistrés entre l'ouverture et ce comptage. Une vente remise avant le comptage n'est donc
 * pas un écart ; une vente postérieure au comptage ne l'est pas non plus (l'ajustement, signé, s'applique au stock
 * COURANT). Écart = quantité comptée − théorique au comptage ; un écart nul n'écrit rien.
 *
 * Garde-fous : motif obligatoire pour chaque écart non nul ; un ajustement négatif ne prend jamais la marchandise
 * réservée pour une vente émise ni celle confiée à un poste (409 STOCK_UNAVAILABLE, lignes nommées : « les quotas
 * locaux ne disparaissent pas au comptage ») ; aucun effet si une seule ligne est refusée.
 *
 * Valorisation (fichier 02 : « au coût d'achat connu ») : coût du lot, ou coût d'achat du catalogue pour un article sans
 * lot ; un coût absent est INCONNU, compté à part, jamais valorisé à zéro. Valeur indicative de gestion : la méthode
 * officielle reste à définir avec le comptable (fichier 03).
 *
 * Verrous : positions (80) puis lots (81) concernés, approbation écrite directement.
 */
final class ValidateInventoryCountHandler implements CommandHandler
{
    public const COMMAND = 'ValidateInventoryCount';

    public function __construct(private readonly ActorRights $rights) {}

    public function permissions(): array
    {
        return ['stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($idempotencyId === null || $context->actorId === null || $command->entityId === null) {
            throw new LogicException('Un inventaire validé exige une clé d\'idempotence, un auteur identifié et un inventaire visé.');
        }
        if (! $this->rights->manager($context)) {
            throw BusinessError::forbidden('Les écarts d\'un inventaire sont approuvés par la gérante.');
        }
        $countId = $command->entityId;
        $count = DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('id', $countId)->first();
        if ($count === null) {
            throw BusinessError::notFound('Inventaire introuvable dans ce cabinet.');
        }
        if ((string) $count->status !== 'COUNTED') {
            throw BusinessError::stateRefused('Seul un inventaire dont le comptage est terminé se valide.', (string) $count->status);
        }
        $reason = null;
        try {
            $reason = Text::optional(is_string($command->payload['reason'] ?? null) ? $command->payload['reason'] : null, 1000, 'reason');
        } catch (RuleViolation $violation) {
            throw BusinessError::validation([$violation->field => [$violation->getMessage()]]);
        }
        if ($reason === null || mb_strlen($reason, 'UTF-8') < 3) {
            throw BusinessError::validation(['reason' => ['Le motif de l\'approbation est obligatoire (3 caractères au moins).']]);
        }

        $locationId = (string) $count->location_id;
        $snapshotAt = (string) $count->snapshot_at;
        $lines = DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('inventory_id', $countId)->orderBy('item_id')->orderBy('lot_key')->orderBy('id')->get();
        $items = DB::table('catalog_items')->where('clinic_id', $context->clinicId)->whereIn('id', $lines->pluck('item_id')->unique()->values()->all())->get()->keyBy('id');
        $positionRows = DB::table('stock_positions')->where('clinic_id', $context->clinicId)->where('location_id', $locationId)->whereIn('item_id', $lines->pluck('item_id')->unique()->values()->all())->get()->keyBy('item_id');
        $lotIds = array_values(array_filter($lines->pluck('stock_lot_id')->unique()->all(), static fn ($id): bool => is_string($id)));

        // Verrous (80 puis 81) : le stock courant est jugé sous verrou.
        $lockedPositions = $locks->stockPositions(array_values(array_map(static fn (stdClass $row): string => (string) $row->id, $positionRows->all())));
        $lockedLots = $locks->stockLots($lotIds);
        /** @var array<string, stdClass> $positionNow */
        $positionNow = $lockedPositions;
        /** @var array<string, stdClass> $lotNow */
        $lotNow = $lockedLots;

        // Mouvements enregistrés depuis l'ouverture, par position et lot, pour juger le théorique au comptage.
        $moves = DB::table('stock_movements')->where('clinic_id', $context->clinicId)->whereIn('position_id', array_keys($positionNow))->where('created_at', '>', $snapshotAt)->get(['position_id', 'lot_id', 'signed_quantity', 'created_at']);

        $errors = new FieldErrors;
        $blocked = [];
        /** @var list<array{line: stdClass, adjustment: FixedDecimal, reason: string, position_id: string, lot_id: string|null, cost: int|null}> $plans */
        $plans = [];
        foreach ($lines as $line) {
            $item = $items->get((string) $line->item_id);
            $label = ($item === null ? (string) $line->item_id : (string) $item->reference).($line->stock_lot_id === null ? '' : ' (lot '.(string) ($lockedLots[(string) $line->stock_lot_id]->batch_number ?? '').')');
            if ($line->counted_quantity === null || $line->counted_at === null) {
                $errors->add('lines.'.$line->id, 'La ligne '.$label.' n\'est pas comptée.');

                continue;
            }
            $position = $positionRows->get((string) $line->item_id);
            if ($item === null || $position === null) {
                $errors->add('lines.'.$line->id, 'La ligne '.$label.' ne correspond plus à une position de stock.');

                continue;
            }
            $positionId = (string) $position->id;
            $lotId = $line->stock_lot_id === null ? null : (string) $line->stock_lot_id;

            $theoretical = Quantity::of((string) $line->theoretical_quantity);
            foreach ($moves as $move) {
                if ((string) $move->position_id === $positionId && ($move->lot_id === null ? null : (string) $move->lot_id) === $lotId && (string) $move->created_at <= (string) $line->counted_at) {
                    $theoretical = $theoretical->plus(Quantity::of((string) $move->signed_quantity));
                }
            }
            $counted = Quantity::of((string) $line->counted_quantity);
            $adjustment = FixedDecimal::fromUnits($counted->units - $theoretical->units, Quantity::SCALE);
            if ($adjustment->isZero()) {
                continue;
            }
            $lineReason = $line->variance_reason === null ? '' : trim((string) $line->variance_reason);
            if (mb_strlen($lineReason, 'UTF-8') < 3) {
                $errors->add('lines.'.$line->id, 'Le motif de l\'écart de la ligne '.$label.' est obligatoire (3 caractères au moins).');

                continue;
            }

            // Un retrait ne prend jamais la marchandise réservée ni confiée à un poste ; les lignes d'une même position
            // s'appliquent l'une après l'autre sur le physique courant.
            try {
                $positionAfter = StockCounters::onHandAfter($positionNow[$positionId], $adjustment, 'lines.'.$line->id);
                $lotAfter = $lotId === null ? null : StockCounters::onHandAfter($lotNow[$lotId] ?? throw BusinessError::notFound('Lot de stock introuvable dans ce cabinet.'), $adjustment, 'lines.'.$line->id);
            } catch (RuleViolation $violation) {
                $blocked['lines.'.$line->id] = ['Ligne '.$label.' : le comptage retirerait de la marchandise réservée pour une vente émise ou confiée à un poste (disponible : '.($violation->details['available'] ?? '0').'). Traitez ces réservations avant de valider.'];

                continue;
            }
            $positionNow[$positionId] = $this->withOnHand($positionNow[$positionId], $positionAfter);
            if ($lotId !== null && $lotAfter !== null) {
                $lotNow[$lotId] = $this->withOnHand($lotNow[$lotId], $lotAfter);
            }
            $lotCost = $lotId === null ? ($item->purchase_cost === null ? null : (int) $item->purchase_cost) : ($lockedLots[$lotId]->unit_cost === null ? null : (int) $lockedLots[$lotId]->unit_cost);
            $plans[] = ['line' => $line, 'adjustment' => $adjustment, 'reason' => $lineReason, 'position_id' => $positionId, 'lot_id' => $lotId, 'cost' => $lotCost];
        }
        $errors->throwIfAny();
        if ($blocked !== []) {
            throw new BusinessError(RuleViolation::STOCK_UNAVAILABLE, 'Le comptage ne peut pas être validé : des lignes retireraient de la marchandise réservée ou confiée à un poste.', 409, $blocked, null, [], ['blocked_lines' => count($blocked)]);
        }

        $at = $context->now->utc();
        $now = $at->format('Y-m-d H:i:s.u');
        $approvalId = DirectApproval::record(
            $context,
            'stock.inventory',
            'inventory_counts',
            $countId,
            CanonicalJson::hash(['inventory_id' => $countId, 'reference' => (string) $count->reference, 'adjustments' => array_map(static fn (array $plan): array => [
                'line_id' => (string) $plan['line']->id,
                'position_id' => $plan['position_id'],
                'lot_id' => $plan['lot_id'],
                'adjustment' => $plan['adjustment']->canonical(),
            ], $plans)]),
            $reason,
        );

        $movementIds = [];
        $known = 0;
        $unknownLines = 0;
        $position = 0;
        /** @var array<string, FixedDecimal> $positionDelta */
        $positionDelta = [];
        /** @var array<string, FixedDecimal> $lotDelta */
        $lotDelta = [];
        foreach ($plans as $plan) {
            $position++;
            $movementId = Ulid::generate();
            $movementIds[] = $movementId;
            DB::table('stock_movements')->insert([
                'id' => $movementId,
                'clinic_id' => $context->clinicId,
                'movement_position' => $position,
                'item_id' => (string) $plan['line']->item_id,
                'position_id' => $plan['position_id'],
                'lot_id' => $plan['lot_id'],
                'kind' => 'ADJUSTMENT',
                'signed_quantity' => $plan['adjustment']->canonical(),
                'unit_cost' => $plan['cost'],
                'approval_id' => $approvalId,
                'reason' => 'Inventaire '.(string) $count->reference.' : '.$plan['reason'],
                'occurred_at' => $now,
                'actor_id' => $context->actorId,
                'idempotency_id' => $idempotencyId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('inventory_count_lines')->where('clinic_id', $context->clinicId)->where('id', (string) $plan['line']->id)->update(['adjustment_movement_id' => $movementId, 'updated_at' => $now]);
            $positionDelta[$plan['position_id']] = ($positionDelta[$plan['position_id']] ?? FixedDecimal::fromUnits(0, Quantity::SCALE))->plus($plan['adjustment']);
            if ($plan['lot_id'] !== null) {
                $lotDelta[$plan['lot_id']] = ($lotDelta[$plan['lot_id']] ?? FixedDecimal::fromUnits(0, Quantity::SCALE))->plus($plan['adjustment']);
            }
            if ($plan['cost'] === null) {
                $unknownLines++;
            } else {
                $known += StockValue::of($plan['adjustment'], $plan['cost']);
            }
        }

        $changes = [];
        foreach ($positionDelta as $positionId => $delta) {
            $row = $lockedPositions[$positionId];
            $newOnHand = Quantity::bounded(Quantity::of((string) $row->on_hand)->units + $delta->units, 'on_hand');
            $version = StockCounters::write($context->clinicId, 'stock_positions', $row, $newOnHand, $now);
            $changes[] = new ChangeRecord('stock_positions', $positionId, $version, ChangeVisibility::Financial, ChangeKind::Updated);
        }
        foreach ($lotDelta as $lotId => $delta) {
            $row = $lockedLots[$lotId];
            StockCounters::write($context->clinicId, 'stock_lots', $row, Quantity::bounded(Quantity::of((string) $row->on_hand)->units + $delta->units, 'on_hand'), $now);
        }

        DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('id', $countId)->update([
            'status' => 'VALIDATED',
            'validated_by' => $context->actorId,
            'validated_at' => $now,
            'approval_id' => $approvalId,
            'updated_at' => $now,
        ]);

        return new CommandOutcome(
            result: [
                'inventory_id' => $countId,
                'status' => 'VALIDATED',
                'approval_id' => $approvalId,
                'adjusted_lines' => count($plans),
                'movement_ids' => $movementIds,
                'variance_value_known' => $known,
                'unknown_cost_lines' => $unknownLines,
            ],
            resultType: 'inventory_counts',
            resultId: $countId,
            audit: [new AuditEntry('stock.inventory_validated', 'inventory_counts', $countId, $reason, [
                'reference' => (string) $count->reference,
                'lines' => $lines->count(),
                'adjusted_lines' => count($plans),
                'unknown_cost_lines' => $unknownLines,
                'approval_id' => $approvalId,
            ])],
            changes: $changes,
        );
    }

    /**
     * Copie de la ligne de stock avec le physique recalculé (les contrôles du disponible lisent physique, réserve et quota).
     */
    private function withOnHand(stdClass $row, FixedDecimal $onHand): stdClass
    {
        $copy = clone $row;
        $copy->on_hand = $onHand->canonical();

        return $copy;
    }
}

<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use LogicException;
use stdClass;

/**
 * Ouverture d'un inventaire (L1D02, EE026, EE030, AT30) : « figer périmètre, date et comptage ». Droit
 * `stock.inventory`, EN LIGNE seulement. Le périmètre est UN emplacement ; la date est l'instant d'ouverture
 * (`snapshot_at`) ; le théorique (`theoretical_quantity`) est le PHYSIQUE de chaque article, ou de chaque lot, à cet
 * instant, réserves et quotas des postes compris (la marchandise réservée ou confiée à un poste est bien présente sur
 * l'étagère). Les positions vides (aucun physique, aucune réserve, aucun quota) ne sont pas listées.
 *
 * Un seul inventaire actif (ouvert ou compté) par emplacement : deux comptages simultanés du même rayon se
 * contredisent. Un article jamais reçu dans l'emplacement n'a pas de ligne : il entre par une réception ou un
 * ajustement approuvé, pas par un comptage.
 *
 * Verrous : positions (80) puis lots (81) lus, pour figer un état cohérent ; l'ouverture n'écrit aucun mouvement.
 */
final class OpenInventoryCountHandler implements CommandHandler
{
    public const COMMAND = 'OpenInventoryCount';

    public function permissions(): array
    {
        return ['stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null) {
            throw new LogicException('Un inventaire a toujours un auteur identifié.');
        }
        $payload = $command->payload;
        $errors = new FieldErrors;
        $locationId = (string) $payload['location_id'];
        $location = DB::table('stock_locations')->where('clinic_id', $context->clinicId)->where('id', $locationId)->first();
        if ($location === null || ! (bool) $location->active) {
            $errors->add('location_id', 'Emplacement introuvable ou désactivé.');
        }
        $reference = Text::trim((string) $payload['reference']);
        if ($reference === '') {
            $errors->add('reference', 'La référence de l\'inventaire est obligatoire.');
        } elseif (DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('reference', $reference)->exists()) {
            $errors->add('reference', 'Cette référence d\'inventaire existe déjà.');
        }
        if ($location !== null && DB::table('inventory_counts')->where('clinic_id', $context->clinicId)->where('location_id', $locationId)->whereIn('status', ['OPEN', 'COUNTED'])->exists()) {
            $errors->add('location_id', 'Un inventaire est déjà en cours dans cet emplacement : validez-le ou abandonnez-le avant d\'en ouvrir un autre.');
        }
        $errors->throwIfAny();

        $positions = DB::table('stock_positions as p')
            ->join('catalog_items as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.item_id');
            })
            ->where('p.clinic_id', $context->clinicId)->where('p.location_id', $locationId)->where('i.stock_mode', 'STOCKED')
            ->where(static function ($query): void {
                $query->where('p.on_hand', '>', 0)->orWhere('p.reserved', '>', 0)->orWhere('p.offline_allocated', '>', 0);
            })
            ->orderBy('i.reference')->orderBy('p.id')
            ->get(['p.id']);
        $positionIds = array_values(array_map(static fn (stdClass $row): string => (string) $row->id, $positions->all()));
        // Verrous (80 puis 81) : le périmètre figé est un état cohérent, jamais lu entre deux écritures.
        $lockedPositions = $locks->stockPositions($positionIds);
        $lotIds = array_values(array_map(static fn (stdClass $row): string => (string) $row->id, DB::table('stock_lots')->where('clinic_id', $context->clinicId)->whereIn('stock_position_id', $positionIds)->get(['id'])->all()));
        $lockedLots = $locks->stockLots($lotIds);
        $lotsByPosition = [];
        foreach ($lockedLots as $lot) {
            $lotsByPosition[(string) $lot->stock_position_id][] = $lot;
        }

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $countId = Ulid::generate();
        $rows = [];
        foreach ($positions as $listed) {
            $position = $lockedPositions[(string) $listed->id] ?? null;
            if ($position === null) {
                continue;
            }
            $lots = $lotsByPosition[(string) $position->id] ?? [];
            usort($lots, static fn (stdClass $left, stdClass $right): int => [(string) $left->batch_number, (string) $left->id] <=> [(string) $right->batch_number, (string) $right->id]);
            $lotted = FixedDecimal::fromUnits(0, Quantity::SCALE);
            foreach ($lots as $lot) {
                $onHand = Quantity::of((string) $lot->on_hand);
                $lotted = $lotted->plus($onHand);
                if ($onHand->units > 0 || Quantity::of((string) $lot->reserved)->units > 0 || Quantity::of((string) $lot->offline_allocated)->units > 0) {
                    $rows[] = $this->line($context->clinicId, $countId, $position, $lot, $onHand, $now);
                }
            }
            // Physique de la position que les lots ne couvrent pas (jamais une quantité négative).
            $remainder = Quantity::of((string) $position->on_hand)->units - $lotted->units;
            if ($remainder > 0) {
                $rows[] = $this->line($context->clinicId, $countId, $position, null, FixedDecimal::fromUnits($remainder, Quantity::SCALE), $now);
            }
        }

        DB::table('inventory_counts')->insert([
            'id' => $countId,
            'clinic_id' => $context->clinicId,
            'location_id' => $locationId,
            'reference' => $reference,
            'snapshot_at' => $now,
            'status' => 'OPEN',
            'opened_by' => $context->actorId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('inventory_count_lines')->insert($chunk);
        }

        return new CommandOutcome(
            result: ['inventory_id' => $countId, 'status' => 'OPEN', 'line_count' => count($rows)],
            resultType: 'inventory_counts',
            resultId: $countId,
            audit: [new AuditEntry('stock.inventory_opened', 'inventory_counts', $countId, null, [
                'reference' => $reference,
                'location_id' => $locationId,
                'lines' => count($rows),
            ])],
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function line(string $clinicId, string $countId, stdClass $position, ?stdClass $lot, FixedDecimal $theoretical, string $now): array
    {
        return [
            'id' => Ulid::generate(),
            'clinic_id' => $clinicId,
            'inventory_id' => $countId,
            'item_id' => (string) $position->item_id,
            'location_id' => (string) $position->location_id,
            'stock_lot_id' => $lot === null ? null : (string) $lot->id,
            'theoretical_quantity' => $theoretical->canonical(),
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }
}

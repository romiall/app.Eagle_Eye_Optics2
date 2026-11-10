<?php

namespace App\Domain\Inventory;

use App\Domain\Inventory\Rules\StockValue;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Quantity;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Inventaires (`inventory_counts`, L1D02) : liste paginée et fiche avec ses lignes, toujours limitées au cabinet.
 * Lecture seule. Les valeurs (coût unitaire, valeur des écarts) ne sortent que pour qui détient
 * `stock.valuation.read` (`$withValue`) : ailleurs elles valent `null`.
 *
 * Valeur d'un écart = quantité × coût d'achat CONNU (coût du lot, ou coût du catalogue pour un article sans lot),
 * arrondie au FCFA ligne par ligne (`StockValue`) ; un coût absent est « inconnu », compté à part, jamais zéro. Pour une
 * ligne ajustée, la quantité et le coût sont ceux du mouvement `ADJUSTMENT` ; sinon c'est l'écart brut, indicatif.
 */
final class InventoryCounts
{
    public const PER_PAGE = 25;

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public static function page(string $clinicId, mixed $status, mixed $locationId, mixed $page = null): LengthAwarePaginator
    {
        $query = DB::table('inventory_counts')->where('clinic_id', $clinicId);
        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, ['OPEN', 'COUNTED', 'VALIDATED', 'ABANDONED'], true)) {
                throw BusinessError::validation(['status' => ['Le statut vaut OPEN, COUNTED, VALIDATED ou ABANDONED.']]);
            }
            $query->where('status', $status);
        }
        if ($locationId !== null && $locationId !== '') {
            if (! is_string($locationId) || ! Ulid::isValid($locationId)) {
                throw BusinessError::validation(['location_id' => ['L\'identifiant attendu est un ULID.']]);
            }
            $query->where('location_id', $locationId);
        }
        $pageNumber = 1;
        if ($page !== null) {
            if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                throw BusinessError::validation(['page' => ['La page est un entier supérieur ou égal à 1.']]);
            }
            $pageNumber = (int) $page;
        }

        // Inventaires à terminer d'abord (ouverts, puis comptés), puis les plus récents.
        return $query->orderByRaw("CASE status WHEN 'OPEN' THEN 0 WHEN 'COUNTED' THEN 1 ELSE 2 END")->orderByDesc('snapshot_at')->orderByDesc('id')->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);
    }

    /**
     * Résumés (sans lignes) des inventaires d'une page.
     *
     * @param  list<stdClass>  $counts
     * @return list<array<string, mixed>>
     */
    public static function summaries(string $clinicId, array $counts, bool $withValue): array
    {
        if ($counts === []) {
            return [];
        }
        $out = [];
        foreach ($counts as $count) {
            $detail = self::build($clinicId, $count, $withValue, false);
            unset($detail['lines']);
            $out[] = $detail;
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function detail(string $clinicId, string $id, bool $withValue): ?array
    {
        $count = DB::table('inventory_counts')->where('clinic_id', $clinicId)->where('id', $id)->first();

        return $count === null ? null : self::build($clinicId, $count, $withValue, true);
    }

    /**
     * @return array<string, mixed>
     */
    private static function build(string $clinicId, stdClass $count, bool $withValue, bool $withLines): array
    {
        $rows = DB::table('inventory_count_lines as l')
            ->join('catalog_items as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'l.clinic_id')->on('i.id', '=', 'l.item_id');
            })
            ->leftJoin('stock_lots as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'l.clinic_id')->on('t.id', '=', 'l.stock_lot_id');
            })
            ->leftJoin('stock_movements as m', static function ($join): void {
                $join->on('m.clinic_id', '=', 'l.clinic_id')->on('m.id', '=', 'l.adjustment_movement_id');
            })
            ->where('l.clinic_id', $clinicId)->where('l.inventory_id', (string) $count->id)
            ->orderBy('i.reference')->orderBy('t.batch_number')->orderBy('l.id')
            ->get([
                'l.id', 'l.item_id', 'i.reference as item_reference', 'i.name as item_name', 'i.purchase_cost as item_cost',
                'l.stock_lot_id', 't.batch_number', 't.expires_on', 't.unit_cost as lot_cost',
                'l.theoretical_quantity', 'l.counted_quantity', 'l.variance_quantity', 'l.variance_reason',
                'm.signed_quantity as adjustment_quantity', 'm.unit_cost as adjustment_cost',
            ]);

        $locationName = (string) (DB::table('stock_locations')->where('clinic_id', $clinicId)->where('id', (string) $count->location_id)->value('name') ?? '');
        $lines = [];
        $counted = 0;
        $withVariance = 0;
        $known = 0;
        $unknown = 0;
        foreach ($rows as $row) {
            if ($row->counted_quantity !== null) {
                $counted++;
            }
            $adjusted = $row->adjustment_quantity !== null;
            // Quantité d'écart retenue : l'ajustement écrit (validé) ou l'écart brut (indicatif).
            // Validé : seul l'ajustement écrit compte (un écart brut absorbé par les mouvements du comptage n'en est plus un).
            $variance = $adjusted ? (string) $row->adjustment_quantity : ((string) $count->status === 'VALIDATED' ? null : ($row->variance_quantity === null ? null : (string) $row->variance_quantity));
            $varianceUnits = $variance === null ? 0 : Quantity::of($variance)->units;
            if ($varianceUnits !== 0) {
                $withVariance++;
            }
            $cost = $adjusted
                ? ($row->adjustment_cost === null ? null : (int) $row->adjustment_cost)
                : ($row->stock_lot_id === null ? ($row->item_cost === null ? null : (int) $row->item_cost) : ($row->lot_cost === null ? null : (int) $row->lot_cost));
            $value = null;
            if ($varianceUnits !== 0) {
                if ($cost === null) {
                    $unknown++;
                } else {
                    $value = StockValue::of(Quantity::of((string) $variance), $cost);
                    $known += $value;
                }
            }
            if ($withLines) {
                $lines[] = [
                    'line_id' => (string) $row->id,
                    'item_id' => (string) $row->item_id,
                    'item_reference' => (string) $row->item_reference,
                    'item_name' => (string) $row->item_name,
                    'lot' => $row->stock_lot_id === null ? null : [
                        'lot_id' => (string) $row->stock_lot_id,
                        'batch_number' => (string) $row->batch_number,
                        'expires_on' => $row->expires_on === null ? null : (string) $row->expires_on,
                    ],
                    'theoretical_quantity' => (string) $row->theoretical_quantity,
                    'counted_quantity' => $row->counted_quantity === null ? null : (string) $row->counted_quantity,
                    'variance_quantity' => $row->variance_quantity === null ? null : (string) $row->variance_quantity,
                    'variance_reason' => $row->variance_reason === null ? null : (string) $row->variance_reason,
                    'adjustment_quantity' => $adjusted ? (string) $row->adjustment_quantity : null,
                    'unit_cost' => $withValue ? $cost : null,
                    'variance_value' => $withValue ? $value : null,
                ];
            }
        }

        $summary = [
            'id' => (string) $count->id,
            'reference' => (string) $count->reference,
            'location_id' => (string) $count->location_id,
            'location_name' => $locationName,
            'snapshot_at' => self::instant((string) $count->snapshot_at),
            'status' => (string) $count->status,
            'validated_at' => $count->validated_at === null ? null : self::instant((string) $count->validated_at),
            'line_count' => $rows->count(),
            'counted_lines' => $counted,
            'variance_lines' => $withVariance,
            'variance_value_known' => $withValue ? $known : null,
            'unknown_cost_lines' => $withValue ? $unknown : null,
        ];
        if ($withLines) {
            $summary['lines'] = $lines;
        }

        return $summary;
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

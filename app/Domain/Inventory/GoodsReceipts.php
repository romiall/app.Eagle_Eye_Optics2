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
 * Réceptions fournisseur (`goods_receipts`, L1D01) : liste paginée et fiche avec ses lignes. Lecture seule, toujours
 * limitée au cabinet. Les coûts d'achat y figurent : la route exige `stock.receive` (jamais `stock.read`).
 *
 * « Valeur au coût connu » = somme des lignes dont le coût est connu, arrondie au FCFA ligne par ligne
 * (`StockValue`) ; les lignes sans coût sont COMPTÉES à part (`unknown_cost_lines`), jamais valorisées à zéro.
 */
final class GoodsReceipts
{
    public const PER_PAGE = 25;

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public static function page(string $clinicId, mixed $status, mixed $supplierId, mixed $page = null): LengthAwarePaginator
    {
        $query = DB::table('goods_receipts')->where('clinic_id', $clinicId);
        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, ['DRAFT', 'VALIDATED', 'ABANDONED'], true)) {
                throw BusinessError::validation(['status' => ['Le statut vaut DRAFT, VALIDATED ou ABANDONED.']]);
            }
            $query->where('status', $status);
        }
        if ($supplierId !== null && $supplierId !== '') {
            if (! is_string($supplierId) || ! Ulid::isValid($supplierId)) {
                throw BusinessError::validation(['supplier_id' => ['L\'identifiant attendu est un ULID.']]);
            }
            $query->where('supplier_id', $supplierId);
        }
        $pageNumber = 1;
        if ($page !== null) {
            if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                throw BusinessError::validation(['page' => ['La page est un entier supérieur ou égal à 1.']]);
            }
            $pageNumber = (int) $page;
        }

        // Brouillons d'abord (à finir), puis les plus récentes.
        return $query->orderByRaw("status = 'DRAFT' DESC")->orderByDesc('received_at')->orderByDesc('id')->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);
    }

    /**
     * Résumés (sans lignes) des réceptions d'une page.
     *
     * @param  list<stdClass>  $receipts
     * @return list<array<string, mixed>>
     */
    public static function summaries(string $clinicId, array $receipts): array
    {
        if ($receipts === []) {
            return [];
        }
        $ids = array_map(static fn (stdClass $row): string => (string) $row->id, $receipts);
        $lines = DB::table('goods_receipt_lines')->where('clinic_id', $clinicId)->whereIn('receipt_id', $ids)->get(['receipt_id', 'quantity', 'unit_cost']);
        /** @var array<string, array{count: int, total: int, unknown: int}> $totals */
        $totals = [];
        foreach ($lines as $line) {
            $key = (string) $line->receipt_id;
            $totals[$key] ??= ['count' => 0, 'total' => 0, 'unknown' => 0];
            $totals[$key]['count']++;
            if ($line->unit_cost === null) {
                $totals[$key]['unknown']++;
            } else {
                $totals[$key]['total'] += StockValue::of(Quantity::of((string) $line->quantity), (int) $line->unit_cost);
            }
        }
        $suppliers = DB::table('suppliers')->where('clinic_id', $clinicId)->whereIn('id', array_values(array_unique(array_map(static fn (stdClass $row): string => (string) $row->supplier_id, $receipts))))->pluck('name', 'id');
        $locations = DB::table('stock_locations')->where('clinic_id', $clinicId)->whereIn('id', array_values(array_unique(array_map(static fn (stdClass $row): string => (string) $row->location_id, $receipts))))->pluck('name', 'id');

        return array_map(static function (stdClass $row) use ($totals, $suppliers, $locations): array {
            $sum = $totals[(string) $row->id] ?? ['count' => 0, 'total' => 0, 'unknown' => 0];

            return [
                'id' => (string) $row->id,
                'supplier_id' => (string) $row->supplier_id,
                'supplier_name' => (string) ($suppliers[(string) $row->supplier_id] ?? ''),
                'location_id' => (string) $row->location_id,
                'location_name' => (string) ($locations[(string) $row->location_id] ?? ''),
                'supplier_reference' => (string) $row->supplier_reference,
                'received_at' => self::instant((string) $row->received_at),
                'status' => (string) $row->status,
                'validated_at' => $row->validated_at === null ? null : self::instant((string) $row->validated_at),
                'notes' => $row->notes === null ? null : (string) $row->notes,
                'line_count' => $sum['count'],
                'known_cost_total' => $sum['total'],
                'unknown_cost_lines' => $sum['unknown'],
            ];
        }, $receipts);
    }

    /**
     * Fiche d'une réception avec ses lignes (article, quantité, coût, lot), ou null hors du cabinet.
     *
     * @return array<string, mixed>|null
     */
    public static function detail(string $clinicId, string $id): ?array
    {
        $row = DB::table('goods_receipts')->where('clinic_id', $clinicId)->where('id', $id)->first();
        if ($row === null) {
            return null;
        }
        $summary = self::summaries($clinicId, [$row])[0];
        $lines = DB::table('goods_receipt_lines as l')
            ->join('catalog_items as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'l.clinic_id')->on('i.id', '=', 'l.item_id');
            })
            ->leftJoin('stock_lots as t', static function ($join): void {
                $join->on('t.clinic_id', '=', 'l.clinic_id')->on('t.id', '=', 'l.stock_lot_id');
            })
            ->where('l.clinic_id', $clinicId)->where('l.receipt_id', $id)
            ->orderBy('l.position')
            ->get(['l.position', 'l.item_id', 'i.reference as item_reference', 'i.name as item_name', 'l.quantity', 'l.unit_cost', 'l.stock_lot_id', 't.batch_number', 't.expires_on']);

        $summary['lines'] = array_values(array_map(static fn (stdClass $line): array => [
            'position' => (int) $line->position,
            'item_id' => (string) $line->item_id,
            'item_reference' => (string) $line->item_reference,
            'item_name' => (string) $line->item_name,
            'quantity' => (string) $line->quantity,
            'unit_cost' => $line->unit_cost === null ? null : (int) $line->unit_cost,
            'lot' => $line->stock_lot_id === null ? null : [
                'lot_id' => (string) $line->stock_lot_id,
                'batch_number' => (string) $line->batch_number,
                'expires_on' => $line->expires_on === null ? null : (string) $line->expires_on,
            ],
        ], $lines->all()));

        return $summary;
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

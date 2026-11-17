<?php

namespace App\Domain\Inventory;

use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Historique des mouvements de stock d'un article (`GET /stock/movements`, cahier des charges §6 : « historique des
 * mouvements de stock par article, consultable à tout moment », EE026). Lecture seule, limitée au cabinet, du plus
 * récent au plus ancien. Les mouvements sont des faits physiques append-only : réception, remise, retour, casse, retour
 * fournisseur, ajustement d'inventaire et stock d'ouverture, chacun avec son motif, son auteur et son lot.
 *
 * Le coût unitaire d'un mouvement n'est rendu qu'avec `stock.valuation.read` (gérante) : jamais à un profil qui ne lit
 * que le stock.
 */
final class StockMovementHistory
{
    public const PER_PAGE = 25;

    /** Types de mouvement de `stock_movements.kind` (contrainte de la base). */
    public const KINDS = ['OPENING', 'RECEIPT', 'SALE_DELIVERY', 'PATIENT_RETURN', 'BREAKAGE', 'SUPPLIER_RETURN', 'ADJUSTMENT'];

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public function page(string $clinicId, mixed $itemId, mixed $locationId, mixed $kind, mixed $page = null): LengthAwarePaginator
    {
        if (! is_string($itemId) || ! Ulid::isValid($itemId)) {
            throw BusinessError::validation(['item_id' => ['L\'article est obligatoire (identifiant ULID).']]);
        }
        if (! DB::table('catalog_items')->where('clinic_id', $clinicId)->where('id', $itemId)->exists()) {
            throw BusinessError::notFound('Article introuvable dans ce cabinet.');
        }

        $query = DB::table('stock_movements as sm')
            ->join('stock_positions as sp', static function ($join): void {
                $join->on('sp.clinic_id', '=', 'sm.clinic_id')->on('sp.id', '=', 'sm.position_id');
            })
            ->join('stock_locations as sl', static function ($join): void {
                $join->on('sl.clinic_id', '=', 'sp.clinic_id')->on('sl.id', '=', 'sp.location_id');
            })
            ->leftJoin('stock_lots as lot', static function ($join): void {
                $join->on('lot.clinic_id', '=', 'sm.clinic_id')->on('lot.id', '=', 'sm.lot_id');
            })
            ->leftJoin('users as u', 'u.id', '=', 'sm.actor_id')
            ->where('sm.clinic_id', $clinicId)
            ->where('sm.item_id', $itemId);

        if ($locationId !== null && $locationId !== '') {
            if (! is_string($locationId) || ! Ulid::isValid($locationId)) {
                throw BusinessError::validation(['location_id' => ['L\'identifiant attendu est un ULID.']]);
            }
            $query->where('sp.location_id', $locationId);
        }
        if ($kind !== null && $kind !== '') {
            if (! is_string($kind) || ! in_array($kind, self::KINDS, true)) {
                throw BusinessError::validation(['kind' => ['Type de mouvement inconnu.']]);
            }
            $query->where('sm.kind', $kind);
        }

        $pageNumber = 1;
        if ($page !== null) {
            if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                throw BusinessError::validation(['page' => ['La page est un entier supérieur ou égal à 1.']]);
            }
            $pageNumber = (int) $page;
        }

        return $query
            ->orderByDesc('sm.occurred_at')
            ->orderByDesc('sm.id')
            ->select([
                'sm.id', 'sm.kind', 'sm.signed_quantity', 'sm.unit_cost', 'sm.reason', 'sm.occurred_at',
                'sm.lot_id', 'sl.name as location_name', 'lot.batch_number', 'lot.expires_on', 'u.display_name as actor_name',
            ])
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(stdClass $row, bool $withCost): array
    {
        return [
            'id' => (string) $row->id,
            'kind' => (string) $row->kind,
            'signed_quantity' => (string) $row->signed_quantity,
            'occurred_at' => CarbonImmutable::parse((string) $row->occurred_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
            'reason' => (string) $row->reason,
            'location_name' => (string) $row->location_name,
            'lot' => $row->lot_id !== null
                ? ['lot_id' => (string) $row->lot_id, 'batch_number' => (string) $row->batch_number, 'expires_on' => $row->expires_on !== null ? (string) $row->expires_on : null]
                : null,
            'actor_name' => $row->actor_name !== null ? (string) $row->actor_name : null,
            'unit_cost' => $withCost && $row->unit_cost !== null ? (int) $row->unit_cost : null,
        ];
    }
}

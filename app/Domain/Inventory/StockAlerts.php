<?php

namespace App\Domain\Inventory;

use App\Domain\Inventory\Rules\StockAvailability;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Quantity;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Supervision et alertes de stock (`stock_alerts`, L1D03) : lecture seule paginée avec explication complète du
 * disponible (`physique − réservé − quotas des postes`), toujours limitée au cabinet.
 */
final class StockAlerts
{
    public const PER_PAGE = 25;

    public const KINDS = ['LOW_STOCK', 'EXPIRY'];

    public const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public static function page(string $clinicId, mixed $status, mixed $kind, mixed $locationId, mixed $page = null): LengthAwarePaginator
    {
        $query = DB::table('stock_alerts')->where('clinic_id', $clinicId);
        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, self::STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Le statut vaut OPEN, ACKNOWLEDGED ou RESOLVED.']]);
            }
            $query->where('status', $status);
        }
        if ($kind !== null && $kind !== '') {
            if (! is_string($kind) || ! in_array($kind, self::KINDS, true)) {
                throw BusinessError::validation(['kind' => ['Le type d\'alerte vaut LOW_STOCK ou EXPIRY.']]);
            }
            $query->where('kind', $kind);
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

        return $query
            ->orderByRaw("CASE status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END")
            ->orderByRaw("CASE WHEN kind = 'EXPIRY' AND due_on IS NOT NULL THEN 0 ELSE 1 END")
            ->orderBy('due_on')
            ->orderByDesc('detected_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function find(string $clinicId, string $id): ?array
    {
        $row = DB::table('stock_alerts')->where('clinic_id', $clinicId)->where('id', $id)->first();
        if ($row === null) {
            return null;
        }

        return self::presentMany($clinicId, [$row])[0] ?? null;
    }

    /**
     * @param  list<stdClass>  $alerts
     * @return list<array<string, mixed>>
     */
    public static function presentMany(string $clinicId, array $alerts): array
    {
        if ($alerts === []) {
            return [];
        }

        $timezone = (string) (DB::table('clinics')->where('id', $clinicId)->value('timezone') ?? config('eeo.clinic.timezone', 'Africa/Douala'));
        $nowMs = (int) CarbonImmutable::now('UTC')->format('Uv');
        $today = CivilDate::fromInstant(Instant::fromEpochMilliseconds($nowMs), $timezone);

        $itemIds = array_values(array_unique(array_map(static fn (stdClass $r): string => (string) $r->item_id, $alerts)));
        $locationIds = array_values(array_unique(array_map(static fn (stdClass $r): string => (string) $r->location_id, $alerts)));
        $lotIds = array_values(array_unique(array_filter(array_map(static fn (stdClass $r): ?string => $r->lot_id !== null ? (string) $r->lot_id : null, $alerts))));
        $userIds = array_values(array_unique(array_filter(array_map(static fn (stdClass $r): ?string => $r->acknowledged_by !== null ? (string) $r->acknowledged_by : null, $alerts))));

        $items = DB::table('catalog_items')
            ->where('clinic_id', $clinicId)
            ->whereIn('id', $itemIds)
            ->get(['id', 'reference', 'name', 'low_stock_threshold', 'expiry_alert_days'])
            ->keyBy('id');
        $locations = DB::table('stock_locations')
            ->where('clinic_id', $clinicId)
            ->whereIn('id', $locationIds)
            ->get(['id', 'code', 'name'])
            ->keyBy('id');
        $positions = DB::table('stock_positions')
            ->where('clinic_id', $clinicId)
            ->whereIn('item_id', $itemIds)
            ->whereIn('location_id', $locationIds)
            ->get(['item_id', 'location_id', 'on_hand', 'reserved', 'offline_allocated', 'central_available'])
            ->keyBy(static fn (stdClass $r): string => $r->item_id.':'.$r->location_id);
        $lots = $lotIds === []
            ? collect()
            : DB::table('stock_lots')
                ->where('clinic_id', $clinicId)
                ->whereIn('id', $lotIds)
                ->get(['id', 'batch_number', 'on_hand', 'reserved', 'offline_allocated'])
                ->keyBy('id');
        $users = $userIds === []
            ? collect()
            : DB::table('users')
                ->where('clinic_id', $clinicId)
                ->whereIn('id', $userIds)
                ->get(['id', 'display_name'])
                ->keyBy('id');

        $out = [];
        foreach ($alerts as $alert) {
            $item = $items->get((string) $alert->item_id);
            $location = $locations->get((string) $alert->location_id);
            $lot = $alert->lot_id !== null ? $lots->get((string) $alert->lot_id) : null;
            $position = $positions->get($alert->item_id.':'.$alert->location_id);
            $user = $alert->acknowledged_by !== null ? $users->get((string) $alert->acknowledged_by) : null;

            if ($lot !== null) {
                $onHand = (string) $lot->on_hand;
                $reserved = (string) $lot->reserved;
                $offlineAllocated = (string) $lot->offline_allocated;
                $centralAvailable = StockAvailability::central(
                    Quantity::of($onHand),
                    Quantity::of($reserved),
                    Quantity::of($offlineAllocated),
                )->canonical();
            } elseif ($position !== null) {
                $onHand = (string) $position->on_hand;
                $reserved = (string) $position->reserved;
                $offlineAllocated = (string) $position->offline_allocated;
                $centralAvailable = (string) $position->central_available;
            } else {
                $onHand = '0';
                $reserved = '0';
                $offlineAllocated = '0';
                $centralAvailable = '0';
            }

            $dueOn = $alert->due_on !== null ? (string) $alert->due_on : null;
            $expired = (string) $alert->kind === 'EXPIRY'
                && $dueOn !== null
                && CivilDate::fromString($dueOn, 'due_on')->compare($today) < 0;

            $out[] = [
                'id' => (string) $alert->id,
                'kind' => (string) $alert->kind,
                'status' => (string) $alert->status,
                'item_id' => (string) $alert->item_id,
                'item_reference' => $item !== null ? (string) $item->reference : '—',
                'item_name' => $item !== null ? (string) $item->name : 'Article inconnu',
                'location_id' => (string) $alert->location_id,
                'location_code' => $location !== null ? (string) $location->code : '—',
                'location_name' => $location !== null ? (string) $location->name : 'Emplacement inconnu',
                'lot_id' => $alert->lot_id !== null ? (string) $alert->lot_id : null,
                'batch_number' => $lot !== null ? (string) $lot->batch_number : null,
                'detected_at' => self::iso((string) $alert->detected_at),
                'due_on' => $dueOn,
                'resolved_at' => $alert->resolved_at !== null ? self::iso((string) $alert->resolved_at) : null,
                'acknowledged_by' => $alert->acknowledged_by !== null ? (string) $alert->acknowledged_by : null,
                'acknowledged_by_name' => $user !== null ? (string) $user->display_name : null,
                'on_hand' => $onHand,
                'reserved' => $reserved,
                'offline_allocated' => $offlineAllocated,
                'central_available' => $centralAvailable,
                'low_stock_threshold' => $item?->low_stock_threshold !== null ? (string) $item->low_stock_threshold : null,
                'expiry_alert_days' => $item?->expiry_alert_days !== null ? (int) $item->expiry_alert_days : null,
                'expired' => $expired,
            ];
        }

        return $out;
    }

    private static function iso(string $datetime): string
    {
        return CarbonImmutable::parse($datetime, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

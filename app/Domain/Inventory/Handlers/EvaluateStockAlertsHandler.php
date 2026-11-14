<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\OutboxEvent;
use App\Application\Locking\TransactionLocks;
use App\Domain\Inventory\Rules\StockAlertRules;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Quantity;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Évaluation des seuils bas et dates de péremption du stock (L1D03) :
 *
 *  - seuils bas : disponible central (`physique − réservé − quotas des postes`) <= `low_stock_threshold` sur un
 *    article actif géré en stock dans un emplacement actif ;
 *  - péremption : lot vendable non vide (`on_hand > 0`) déjà expiré ou dans son `expiry_alert_days` ;
 *  - déduplication : une ligne unique par `(clinic_id, dedupe_key)` dans `stock_alerts` ; aucune alerte ni événement
 *    `StockThresholdCrossed` en double sur exécutions répétées du scheduler ;
 *  - résolution automatique lorsque le stock repasse au-dessus du seuil ou que le lot est sorti/quarantaine ; réouverture
 *    si un lot préalablement signalé franchit sa date d'expiration ou après un nouveau mouvement/changement ;
 *  - ne crée JAMAIS aucun mouvement de stock.
 */
final class EvaluateStockAlertsHandler implements CommandHandler
{
    public const COMMAND = 'EvaluateStockAlerts';

    public function permissions(): array
    {
        return ['stock.adjust', 'stock.receive', 'stock.inventory'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $clinic = $locks->clinic();
        $timezone = (string) ($clinic->timezone ?? config('eeo.clinic.timezone', 'Africa/Douala'));
        $nowUtc = $context->now->utc();
        $stamp = $nowUtc->format('Y-m-d H:i:s.u');
        $nowInstant = Instant::fromEpochMilliseconds((int) $nowUtc->format('Uv'));
        $detectedIso = $nowInstant->toString();
        $today = CivilDate::fromInstant($nowInstant, $timezone);

        $items = DB::table('catalog_items')
            ->where('clinic_id', $context->clinicId)
            ->get(['id', 'stock_mode', 'requires_expiry', 'low_stock_threshold', 'expiry_alert_days', 'active', 'updated_at'])
            ->keyBy('id');

        $locations = DB::table('stock_locations')
            ->where('clinic_id', $context->clinicId)
            ->get(['id', 'active'])
            ->keyBy('id');

        $positions = DB::table('stock_positions')
            ->where('clinic_id', $context->clinicId)
            ->get(['id', 'item_id', 'location_id', 'on_hand', 'reserved', 'offline_allocated', 'central_available', 'updated_at'])
            ->keyBy(static fn (stdClass $row): string => $row->item_id.':'.$row->location_id);

        $lots = DB::table('stock_lots')
            ->where('clinic_id', $context->clinicId)
            ->get(['id', 'item_id', 'location_id', 'status', 'on_hand', 'expires_on', 'updated_at']);

        $existing = DB::table('stock_alerts')
            ->where('clinic_id', $context->clinicId)
            ->get()
            ->keyBy('dedupe_key');

        /** @var array<string, array{kind: string, item_id: string, location_id: string, lot_id: string|null, due_on: string|null, activity_at: string|null}> $targets */
        $targets = [];

        foreach ($items as $item) {
            if (! (bool) $item->active || (string) $item->stock_mode !== 'STOCKED' || $item->low_stock_threshold === null) {
                continue;
            }
            $threshold = Quantity::of((string) $item->low_stock_threshold);
            foreach ($locations as $location) {
                if (! (bool) $location->active) {
                    continue;
                }
                $keyPair = $item->id.':'.$location->id;
                $position = $positions->get($keyPair);
                $centralAvailable = $position !== null
                    ? Quantity::of((string) $position->central_available)
                    : Quantity::of('0');

                if (! StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, true, $centralAvailable)) {
                    continue;
                }
                $activityAt = self::latestStamp((string) $item->updated_at, $position !== null ? (string) $position->updated_at : null);
                $dedupeKey = StockAlertRules::dedupeKeyLowStock((string) $item->id, (string) $location->id);
                $targets[$dedupeKey] = [
                    'kind' => 'LOW_STOCK',
                    'item_id' => (string) $item->id,
                    'location_id' => (string) $location->id,
                    'lot_id' => null,
                    'due_on' => null,
                    'activity_at' => $activityAt,
                ];
            }
        }

        foreach ($lots as $lot) {
            $item = $items->get((string) $lot->item_id);
            $location = $locations->get((string) $lot->location_id);
            if ($item === null || $location === null) {
                continue;
            }
            $expiresOn = $lot->expires_on !== null ? CivilDate::fromString((string) $lot->expires_on, 'expires_on') : null;
            $eval = StockAlertRules::evaluateExpiry(
                (bool) $item->active,
                (string) $item->stock_mode,
                (bool) $location->active,
                (string) $lot->status,
                Quantity::of((string) $lot->on_hand),
                $expiresOn,
                $item->expiry_alert_days !== null ? (int) $item->expiry_alert_days : null,
                $today,
            );
            if (! $eval['triggered'] || $expiresOn === null) {
                continue;
            }
            $dedupeKey = StockAlertRules::dedupeKeyExpiry((string) $item->id, (string) $location->id, (string) $lot->id);
            $targets[$dedupeKey] = [
                'kind' => 'EXPIRY',
                'item_id' => (string) $item->id,
                'location_id' => (string) $location->id,
                'lot_id' => (string) $lot->id,
                'due_on' => $expiresOn->toString(),
                'activity_at' => self::latestStamp((string) $item->updated_at, (string) $lot->updated_at),
            ];
        }

        ksort($targets);

        $opened = 0;
        $reopened = 0;
        $resolved = 0;
        $unchanged = 0;
        /** @var list<OutboxEvent> $events */
        $events = [];

        foreach ($existing as $dedupeKey => $alert) {
            $key = (string) $dedupeKey;
            $target = $targets[$key] ?? null;
            $status = (string) $alert->status;

            if ($target === null) {
                if ($status !== 'RESOLVED') {
                    DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('id', $alert->id)->update([
                        'status' => 'RESOLVED',
                        'resolved_at' => $stamp,
                        'updated_at' => $stamp,
                    ]);
                    $resolved++;
                } else {
                    $unchanged++;
                }

                continue;
            }

            if ($status === 'OPEN') {
                $unchanged++;

                continue;
            }

            $updatedMs = (int) CarbonImmutable::parse((string) $alert->updated_at, 'UTC')->format('Uv');
            $updatedLocal = CivilDate::fromInstant(Instant::fromEpochMilliseconds($updatedMs), $timezone);
            $reopenExpiry = $target['kind'] === 'EXPIRY'
                && $target['due_on'] !== null
                && StockAlertRules::shouldReopenExpiryOnNewExpiry(
                    $status,
                    $updatedLocal,
                    CivilDate::fromString($target['due_on'], 'due_on'),
                    $today,
                );

            if ($status === 'ACKNOWLEDGED') {
                if ($reopenExpiry) {
                    $this->reopenAlert((string) $context->clinicId, (string) $alert->id, $stamp, $target['due_on']);
                    $events[] = $this->crossedEvent((string) $alert->id, $target, $detectedIso);
                    $reopened++;
                } else {
                    $unchanged++;
                }

                continue;
            }

            // Statut RESOLVED : réouverture seulement sur expiration nouvellement franchie ou changement/sortie postérieur à la résolution.
            $shouldReopen = $reopenExpiry || StockAlertRules::shouldReopenResolvedLowStock(
                $alert->resolved_at !== null ? (string) $alert->resolved_at : null,
                $target['activity_at'],
            );
            if ($shouldReopen) {
                $this->reopenAlert((string) $context->clinicId, (string) $alert->id, $stamp, $target['due_on']);
                $events[] = $this->crossedEvent((string) $alert->id, $target, $detectedIso);
                $reopened++;
            } else {
                $unchanged++;
            }
        }

        foreach ($targets as $dedupeKey => $target) {
            if ($existing->has($dedupeKey)) {
                continue;
            }
            $alertId = Ulid::generate();
            DB::table('stock_alerts')->insert([
                'id' => $alertId,
                'clinic_id' => $context->clinicId,
                'item_id' => $target['item_id'],
                'location_id' => $target['location_id'],
                'lot_id' => $target['lot_id'],
                'kind' => $target['kind'],
                'dedupe_key' => $dedupeKey,
                'detected_at' => $stamp,
                'due_on' => $target['due_on'],
                'status' => 'OPEN',
                'acknowledged_by' => null,
                'resolved_at' => null,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);
            $events[] = $this->crossedEvent($alertId, $target, $detectedIso);
            $opened++;
        }

        $openCount = DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('status', 'OPEN')->count();
        $acknowledgedCount = DB::table('stock_alerts')->where('clinic_id', $context->clinicId)->where('status', 'ACKNOWLEDGED')->count();

        $summary = [
            'opened' => $opened,
            'reopened' => $reopened,
            'resolved' => $resolved,
            'unchanged' => $unchanged,
            'open_count' => $openCount,
            'acknowledged_count' => $acknowledgedCount,
        ];

        $audit = ($opened + $reopened + $resolved > 0 || $context->source === CommandSource::Direct)
            ? [new AuditEntry('stock.alerts_evaluated', 'clinics', $context->clinicId, null, $summary)]
            : [];

        return new CommandOutcome(
            result: $summary,
            resultType: 'stock_alerts_evaluation',
            resultId: $context->clinicId,
            audit: $audit,
            events: $events,
        );
    }

    private function reopenAlert(string $clinicId, string $alertId, string $stamp, ?string $dueOn): void
    {
        DB::table('stock_alerts')->where('clinic_id', $clinicId)->where('id', $alertId)->update([
            'status' => 'OPEN',
            'detected_at' => $stamp,
            'due_on' => $dueOn,
            'acknowledged_by' => null,
            'resolved_at' => null,
            'updated_at' => $stamp,
        ]);
    }

    /**
     * @param  array{kind: string, item_id: string, location_id: string, lot_id: string|null, due_on: string|null, activity_at: string|null}  $target
     */
    private function crossedEvent(string $alertId, array $target, string $detectedIso): OutboxEvent
    {
        return new OutboxEvent('StockThresholdCrossed', 1, 'stock_alerts', $alertId, 1, [
            'stock_alert_id' => $alertId,
            'item_id' => $target['item_id'],
            'location_id' => $target['location_id'],
            'lot_id' => $target['lot_id'],
            'kind' => $target['kind'],
            'detected_at' => $detectedIso,
            'due_on' => $target['due_on'],
        ]);
    }

    private static function latestStamp(string $left, ?string $right): string
    {
        if ($right === null || strcmp($left, $right) >= 0) {
            return $left;
        }

        return $right;
    }
}

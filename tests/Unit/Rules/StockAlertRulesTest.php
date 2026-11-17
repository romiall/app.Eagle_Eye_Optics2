<?php

namespace Tests\Unit\Rules;

use App\Domain\Inventory\Rules\StockAlertRules;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Quantity;
use PHPUnit\Framework\TestCase;

/**
 * Règles pures des alertes de stock bas et de péremption (L1D03).
 */
final class StockAlertRulesTest extends TestCase
{
    public function test_low_stock_triggers_at_or_below_threshold_for_active_stocked_item_and_location(): void
    {
        $threshold = Quantity::of('3');

        self::assertTrue(StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, true, Quantity::of('3')));
        self::assertTrue(StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, true, Quantity::of('0')));
        self::assertTrue(StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, true, Quantity::of('-1')));
        self::assertFalse(StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, true, Quantity::of('3.001')));
        self::assertFalse(StockAlertRules::isLowStockTriggered(false, 'STOCKED', $threshold, true, Quantity::of('0')));
        self::assertFalse(StockAlertRules::isLowStockTriggered(true, 'UNTRACKED', $threshold, true, Quantity::of('0')));
        self::assertFalse(StockAlertRules::isLowStockTriggered(true, 'STOCKED', null, true, Quantity::of('0')));
        self::assertFalse(StockAlertRules::isLowStockTriggered(true, 'STOCKED', $threshold, false, Quantity::of('0')));
    }

    public function test_expiry_triggers_inside_alert_window_or_when_expired_only_for_sellable_non_empty_lots(): void
    {
        $today = CivilDate::of(2026, 11, 12);

        self::assertSame(
            ['triggered' => true, 'expired' => false],
            StockAlertRules::evaluateExpiry(true, 'STOCKED', true, 'SELLABLE', Quantity::of('2'), CivilDate::of(2026, 11, 22), 10, $today),
        );
        self::assertFalse(
            StockAlertRules::evaluateExpiry(true, 'STOCKED', true, 'SELLABLE', Quantity::of('2'), CivilDate::of(2026, 11, 23), 10, $today)['triggered'],
        );
        self::assertSame(
            ['triggered' => true, 'expired' => true],
            StockAlertRules::evaluateExpiry(true, 'STOCKED', true, 'SELLABLE', Quantity::of('1'), CivilDate::of(2026, 11, 11), null, $today),
        );
        self::assertFalse(
            StockAlertRules::evaluateExpiry(true, 'STOCKED', true, 'QUARANTINE', Quantity::of('5'), CivilDate::of(2026, 11, 10), 10, $today)['triggered'],
        );
        self::assertFalse(
            StockAlertRules::evaluateExpiry(true, 'STOCKED', true, 'SELLABLE', Quantity::of('0'), CivilDate::of(2026, 11, 10), 10, $today)['triggered'],
        );
    }

    public function test_reopen_guards_prevent_scheduler_flapping(): void
    {
        self::assertFalse(StockAlertRules::shouldReopenResolvedLowStock('2026-11-12 10:00:00.000000', '2026-11-12 09:59:59.000000'));
        self::assertFalse(StockAlertRules::shouldReopenResolvedLowStock('2026-11-12 10:00:00.000000', '2026-11-12 10:00:00.000000'));
        self::assertTrue(StockAlertRules::shouldReopenResolvedLowStock('2026-11-12 10:00:00.000000', '2026-11-12 10:00:01.000000'));

        $due = CivilDate::of(2026, 11, 15);
        self::assertFalse(StockAlertRules::shouldReopenExpiryOnNewExpiry('ACKNOWLEDGED', CivilDate::of(2026, 11, 10), $due, CivilDate::of(2026, 11, 15)));
        self::assertTrue(StockAlertRules::shouldReopenExpiryOnNewExpiry('ACKNOWLEDGED', CivilDate::of(2026, 11, 10), $due, CivilDate::of(2026, 11, 16)));
        self::assertFalse(StockAlertRules::shouldReopenExpiryOnNewExpiry('ACKNOWLEDGED', CivilDate::of(2026, 11, 16), $due, CivilDate::of(2026, 11, 17)));
        self::assertFalse(StockAlertRules::shouldReopenExpiryOnNewExpiry('OPEN', CivilDate::of(2026, 11, 10), $due, CivilDate::of(2026, 11, 16)));
    }
}

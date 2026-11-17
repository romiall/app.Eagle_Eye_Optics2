<?php

namespace App\Domain\Inventory\Rules;

use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\FixedDecimal;

/**
 * Règles pures des alertes de stock bas et de péremption (L1D03, jumelles de `resources/frontend/domain/inventory/alerts.ts`) :
 *  - seuil bas : article actif géré en stock avec `low_stock_threshold` renseigné et `central_available <= threshold` ;
 *  - péremption : lot vendable non vide (`on_hand > 0`), soit déjà expiré (`expires_on < today`), soit dans le délai
 *    d'alerte configuré (`expires_on <= today + expiry_alert_days`) ;
 *  - déduplication : une seule alerte par `(LOW_STOCK, article, emplacement)` ou `(EXPIRY, article, emplacement, lot)` ;
 *  - les alertes ne créent jamais de mouvement de stock ; un lot expiré ou en quarantaine reste bloqué par `LotRules`.
 */
final class StockAlertRules
{
    public static function dedupeKeyLowStock(string $itemId, string $locationId): string
    {
        return 'LOW_STOCK:'.$itemId.':'.$locationId;
    }

    public static function dedupeKeyExpiry(string $itemId, string $locationId, string $lotId): string
    {
        return 'EXPIRY:'.$itemId.':'.$locationId.':'.$lotId;
    }

    public static function isLowStockTriggered(
        bool $activeItem,
        string $stockMode,
        ?FixedDecimal $threshold,
        bool $activeLocation,
        FixedDecimal $centralAvailable,
    ): bool {
        if (! $activeItem || $stockMode !== 'STOCKED' || $threshold === null || ! $activeLocation) {
            return false;
        }

        return $centralAvailable->compare($threshold) <= 0;
    }

    /**
     * @return array{triggered: bool, expired: bool}
     */
    public static function evaluateExpiry(
        bool $activeItem,
        string $stockMode,
        bool $activeLocation,
        string $lotStatus,
        FixedDecimal $onHand,
        ?CivilDate $expiresOn,
        ?int $alertDays,
        CivilDate $today,
    ): array {
        if (! $activeItem || $stockMode !== 'STOCKED' || ! $activeLocation || $lotStatus !== 'SELLABLE' || $onHand->units <= 0 || $expiresOn === null) {
            return ['triggered' => false, 'expired' => false];
        }

        $expired = $expiresOn->compare($today) < 0;
        if ($expired) {
            return ['triggered' => true, 'expired' => true];
        }
        if ($alertDays === null) {
            return ['triggered' => false, 'expired' => false];
        }

        $limit = $today->addDays($alertDays, 'expiry_alert_days');

        return ['triggered' => $expiresOn->compare($limit) <= 0, 'expired' => false];
    }

    /**
     * Une alerte `LOW_STOCK` déjà résolue ne se rouvre pas sur une simple répétition du scheduler : elle ne repart
     * qu'après un nouveau mouvement sortant (ou une baisse de disponibilité/changement de seuil postérieur à la résolution).
     */
    public static function shouldReopenResolvedLowStock(?string $resolvedAt, ?string $latestActivityAt): bool
    {
        if ($resolvedAt === null) {
            return true;
        }
        if ($latestActivityAt === null) {
            return false;
        }

        return strcmp($latestActivityAt, $resolvedAt) > 0;
    }

    /**
     * Si un lot déjà signalé (voire accusé ou résolu avant l'échéance) franchit effectivement sa date d'expiration,
     * l'alerte repasse en `OPEN` une seule fois pour signaler le lot nouvellement expiré.
     */
    public static function shouldReopenExpiryOnNewExpiry(
        string $status,
        CivilDate $updatedLocalDate,
        CivilDate $dueOn,
        CivilDate $today,
    ): bool {
        if ($status === 'OPEN') {
            return false;
        }
        if ($dueOn->compare($today) >= 0) {
            return false;
        }

        return $updatedLocalDate->compare($dueOn) <= 0;
    }
}

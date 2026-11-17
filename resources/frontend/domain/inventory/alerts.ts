import type { StockAlert } from '../contracts/generated'
import { CivilDate } from '../values/civilDate'
import { type FixedDecimal, Quantity } from '../values/decimal'

/**
 * Règles d'affichage des alertes de stock (L1D03, jumelles de `app/Domain/Inventory/Rules/StockAlertRules.php`) :
 * aucun calcul flottant ; les écarts de dates passent par le numéro de jour civil, les manques de seuil par
 * `Quantity` (échelle décimale fixe).
 */
export const ALERT_STATUS_LABELS: Record<StockAlert['status'], string> = {
  OPEN: 'À traiter',
  ACKNOWLEDGED: 'Prise en compte',
  RESOLVED: 'Résolue',
}

export const ALERT_KIND_LABELS: Record<StockAlert['kind'], string> = {
  LOW_STOCK: 'Seuil bas',
  EXPIRY: 'Péremption',
}

export function lowStockShortfall(alert: StockAlert): FixedDecimal | null {
  if (
    alert.kind !== 'LOW_STOCK' ||
    alert.low_stock_threshold === null ||
    alert.central_available === null
  ) {
    return null
  }
  const threshold = Quantity.of(alert.low_stock_threshold)
  const available = Quantity.of(alert.central_available)
  if (available.compare(threshold) > 0) return null
  return threshold.minus(available)
}

export function daysUntilExpiry(dueOn: string, today: CivilDate): number {
  return CivilDate.fromString(dueOn, 'due_on').dayNumber() - today.dayNumber()
}

export function formatCivilDateFr(isoDate: string): string {
  const date = CivilDate.fromString(isoDate, 'due_on')
  return `${String(date.day).padStart(2, '0')}/${String(date.month).padStart(2, '0')}/${String(date.year).padStart(4, '0')}`
}

export function formatExpiryHeadline(alert: StockAlert, today: CivilDate): string {
  if (alert.expired) {
    return 'Lot expiré — bloqué à la remise'
  }
  if (alert.due_on === null) {
    return 'Péremption surveillée'
  }
  const remaining = daysUntilExpiry(alert.due_on, today)
  if (remaining < 0) {
    return 'Lot expiré — bloqué à la remise'
  }
  if (remaining === 0) {
    return 'Expire aujourd’hui'
  }
  if (remaining === 1) {
    return 'Expire demain'
  }
  return `Expire dans ${remaining} jours`
}

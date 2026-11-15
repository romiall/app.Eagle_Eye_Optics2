import { apiRequest } from '@/app/api'
import type { StockMovementHistoryPage } from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lecture du serveur pour l'historique des mouvements de stock d'un article (`GET /stock/movements`, cahier des charges
 * §6), EN LIGNE seulement : le coût unitaire n'est rendu qu'avec `stock.valuation.read`.
 */
export async function listStockMovements(filters: {
  itemId: string
  kind?: string | null
  locationId?: string | null
  page?: number
}): Promise<ReadOutcome<StockMovementHistoryPage>> {
  if (!isUlid(filters.itemId)) {
    throw new RangeError('Identifiant d’article invalide.')
  }
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Page invalide.')
  }
  const parameters = new URLSearchParams({ item_id: filters.itemId, page: String(page) })
  if (filters.kind !== undefined && filters.kind !== null && filters.kind !== '') {
    parameters.set('kind', filters.kind)
  }
  if (
    filters.locationId !== undefined &&
    filters.locationId !== null &&
    filters.locationId !== ''
  ) {
    if (!isUlid(filters.locationId)) {
      throw new RangeError('Identifiant d’emplacement invalide.')
    }
    parameters.set('location_id', filters.locationId)
  }
  const data = await apiRequest<StockMovementHistoryPage>(
    'GET',
    `/api/v1/stock/movements?${parameters}`,
  )
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

import { apiRequest } from '@/app/api'
import type { StockAlertPage } from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lectures du serveur pour les alertes et seuils de stock (L1D03), EN LIGNE seulement (`GET /stock/alerts`).
 */
export async function listStockAlerts(
  filters: {
    status?: string | null
    kind?: string | null
    locationId?: string | null
    page?: number
  } = {},
): Promise<ReadOutcome<StockAlertPage>> {
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Page invalide.')
  }
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    parameters.set('status', filters.status)
  }
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
  const data = await apiRequest<StockAlertPage>('GET', `/api/v1/stock/alerts?${parameters}`)
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

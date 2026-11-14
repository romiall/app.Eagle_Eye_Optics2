import { apiRequest } from '@/app/api'
import type {
  WorkshopEligibleLines,
  WorkshopEligibleLinesResponse,
  WorkshopOrder,
  WorkshopOrderPage,
  WorkshopOrderResponse,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lectures de l'atelier optique (L1D04), EN LIGNE seulement, droit `workshop.manage` : commandes
 * filtrables par état et retard, lignes facturées admissibles, et détail figé avec historique.
 */
function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export interface WorkshopOrderFilters {
  status?: WorkshopOrdersStatus | null
  overdue?: boolean
  patientId?: string | null
  supplierId?: string | null
  page?: number
}

export async function listWorkshopOrders(
  filters: WorkshopOrderFilters = {},
): Promise<ReadOutcome<WorkshopOrderPage>> {
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page invalide.')
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null) {
    parameters.set('status', filters.status)
  }
  if (filters.overdue === true) {
    parameters.set('overdue', '1')
  }
  if (filters.patientId !== undefined && filters.patientId !== null) {
    if (!isUlid(filters.patientId)) throw new RangeError('Identifiant de patient invalide.')
    parameters.set('patient_id', filters.patientId)
  }
  if (filters.supplierId !== undefined && filters.supplierId !== null) {
    if (!isUlid(filters.supplierId)) throw new RangeError('Identifiant de laboratoire invalide.')
    parameters.set('supplier_id', filters.supplierId)
  }

  return answered(
    await apiRequest<WorkshopOrderPage>('GET', `/api/v1/workshop-orders?${parameters}`),
  )
}

export async function getWorkshopEligibleLines(
  options: {
    q?: string | null
    patientId?: string | null
  } = {},
): Promise<ReadOutcome<WorkshopEligibleLines>> {
  const parameters = new URLSearchParams()
  if (options.q !== undefined && options.q !== null && options.q.trim() !== '') {
    parameters.set('q', options.q.trim())
  }
  if (options.patientId !== undefined && options.patientId !== null) {
    if (!isUlid(options.patientId)) throw new RangeError('Identifiant de patient invalide.')
    parameters.set('patient_id', options.patientId)
  }
  const suffix = parameters.toString() === '' ? '' : `?${parameters}`
  const response = await apiRequest<WorkshopEligibleLinesResponse>(
    'GET',
    `/api/v1/workshop-orders/eligible-lines${suffix}`,
  )
  return answered(response.data)
}

export async function getWorkshopOrder(id: string): Promise<ReadOutcome<WorkshopOrder>> {
  if (!isUlid(id)) throw new RangeError('Identifiant de commande atelier invalide.')
  const response = await apiRequest<WorkshopOrderResponse>(
    'GET',
    `/api/v1/workshop-orders/${encodeURIComponent(id)}`,
  )
  return answered(response.data)
}

export function workshopOrderAdvancePath(id: string): string {
  if (!isUlid(id)) throw new RangeError('Identifiant de commande atelier invalide.')
  return `/workshop-orders/${encodeURIComponent(id)}/advance`
}

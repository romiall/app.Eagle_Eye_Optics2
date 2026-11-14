import { apiRequest } from '@/app/api'
import type {
  GoodsReceipt,
  GoodsReceiptPage,
  GoodsReceiptResponse,
  InventoryCount,
  InventoryCountPage,
  InventoryCountResponse,
  Supplier,
  SupplierList,
} from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lectures du serveur pour les achats et les inventaires (L1D01, L1D02), EN LIGNE seulement : fournisseurs, réceptions
 * fournisseur et inventaires. Chaque lecture rend la donnée avec sa fraîcheur ; le serveur seul décide des droits
 * (`stock.receive` pour les achats, `stock.inventory` pour les inventaires) et du module « stock » ouvert.
 */
function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

function assertPage(page: number): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page invalide.')
}

function assertId(id: string, what: string): void {
  if (!isUlid(id)) throw new RangeError(`Identifiant de ${what} invalide.`)
}

/** Fournisseurs du cabinet, actifs d'abord ; `active` filtre (vrai : actifs, faux : désactivés), absent : tous. */
export async function listSuppliers(active?: boolean): Promise<ReadOutcome<Supplier[]>> {
  const query = active === undefined ? '' : `?active=${active ? '1' : '0'}`
  const response = await apiRequest<SupplierList>('GET', `/api/v1/suppliers${query}`)
  return answered(response.data)
}

export async function listGoodsReceipts(
  filters: { status?: string | null; supplierId?: string | null; page?: number } = {},
): Promise<ReadOutcome<GoodsReceiptPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    parameters.set('status', filters.status)
  }
  if (filters.supplierId !== undefined && filters.supplierId !== null) {
    assertId(filters.supplierId, 'fournisseur')
    parameters.set('supplier_id', filters.supplierId)
  }
  return answered(await apiRequest<GoodsReceiptPage>('GET', `/api/v1/goods-receipts?${parameters}`))
}

export async function getGoodsReceipt(id: string): Promise<ReadOutcome<GoodsReceipt>> {
  assertId(id, 'réception')
  const response = await apiRequest<GoodsReceiptResponse>('GET', `/api/v1/goods-receipts/${id}`)
  return answered(response.data)
}

export async function listInventoryCounts(
  filters: { status?: string | null; page?: number } = {},
): Promise<ReadOutcome<InventoryCountPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    parameters.set('status', filters.status)
  }
  return answered(
    await apiRequest<InventoryCountPage>('GET', `/api/v1/inventory-counts?${parameters}`),
  )
}

export async function getInventoryCount(id: string): Promise<ReadOutcome<InventoryCount>> {
  assertId(id, 'inventaire')
  const response = await apiRequest<InventoryCountResponse>('GET', `/api/v1/inventory-counts/${id}`)
  return answered(response.data)
}

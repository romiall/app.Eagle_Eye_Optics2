import type {
  CatalogItem,
  GoodsReceipt,
  GoodsReceiptSummary,
  InventoryCount,
  InventoryCountLine,
  StockLocation,
  Supplier,
} from '@/domain/contracts/generated'

import { catalogItem, json, MANAGER, type SalesApi } from '../billing/support'

// Aides communes des tests des écrans d'achats et d'inventaires (L1D01, L1D02). Données FICTIVES uniquement ;
// identifiants au format ULID (alphabet de Crockford : ni I, L, O ni U).
export const SUPPLIER_ID = '01J9ZXK4M2Q8R7S6T5V4WS0001'
export const LOCATION_ID = '01J9ZXK4M2Q8R7S6T5V4WM0001'
export const FRAME_ID = '01J9ZXK4M2Q8R7S6T5V4WF0001'
export const DROPS_ID = '01J9ZXK4M2Q8R7S6T5V4WD0001'
export const RECEIPT_ID = '01J9ZXK4M2Q8R7S6T5V4WR0001'
export const INVENTORY_ID = '01J9ZXK4M2Q8R7S6T5V4WN0001'
export const LINE_FRAME = '01J9ZXK4M2Q8R7S6T5V4WK0001'
export const LINE_DROPS = '01J9ZXK4M2Q8R7S6T5V4WK0002'
export const LOT_ID = '01J9ZXK4M2Q8R7S6T5V4WP0001'

/** Gérante avec les droits d'achats, d'inventaire et de valorisation. */
export const STOCK_MANAGER = [
  ...MANAGER,
  'stock.receive',
  'stock.inventory',
  'stock.valuation.read',
]

export const FRAME: CatalogItem = catalogItem({
  id: FRAME_ID,
  reference: 'FR-001',
  name: 'Monture fictive',
  stock_mode: 'STOCKED',
})
export const DROPS: CatalogItem = catalogItem({
  id: DROPS_ID,
  reference: 'CO-001',
  name: 'Collyre fictif',
  category_code: 'COLLYRE',
  stock_mode: 'STOCKED',
  requires_expiry: true,
})

export const SUPPLIER: Supplier = {
  id: SUPPLIER_ID,
  name: 'Optique Distribution',
  reference: 'FOU-001',
  phone: null,
  email: null,
  address: null,
  is_optical_lab: false,
  active: true,
}

export const LOCATION: StockLocation = {
  id: LOCATION_ID,
  code: 'PRINCIPAL',
  name: 'Emplacement fictif',
  active: true,
}

export const PAGE_META = { current_page: 1, last_page: 1, per_page: 25, total: 1 }

export function receiptSummary(overrides: Partial<GoodsReceiptSummary> = {}): GoodsReceiptSummary {
  return {
    id: RECEIPT_ID,
    supplier_id: SUPPLIER_ID,
    supplier_name: 'Optique Distribution',
    location_id: LOCATION_ID,
    location_name: 'Emplacement fictif',
    supplier_reference: 'BL-2026-0001',
    received_at: '2026-10-15T08:00:00.000Z',
    status: 'DRAFT',
    validated_at: null,
    notes: null,
    line_count: 1,
    known_cost_total: 90000,
    unknown_cost_lines: 0,
    ...overrides,
  } as GoodsReceiptSummary
}

export function receiptDetail(overrides: Partial<GoodsReceipt> = {}): GoodsReceipt {
  return {
    ...receiptSummary(),
    lines: [
      {
        position: 1,
        item_id: FRAME_ID,
        item_reference: 'FR-001',
        item_name: 'Monture fictive',
        quantity: '5.000',
        unit_cost: 18000,
        lot: null,
      },
    ],
    ...overrides,
  } as GoodsReceipt
}

export function inventoryLine(
  id: string,
  overrides: Partial<InventoryCountLine> = {},
): InventoryCountLine {
  return {
    line_id: id,
    item_id: FRAME_ID,
    item_reference: 'FR-001',
    item_name: 'Monture fictive',
    lot: null,
    theoretical_quantity: '7.000',
    counted_quantity: null,
    variance_quantity: null,
    variance_reason: null,
    adjustment_quantity: null,
    unit_cost: null,
    variance_value: null,
    ...overrides,
  } as InventoryCountLine
}

export function inventoryDetail(overrides: Partial<InventoryCount> = {}): InventoryCount {
  const lines = [
    inventoryLine(LINE_DROPS, {
      item_id: DROPS_ID,
      item_reference: 'CO-001',
      item_name: 'Collyre fictif',
      lot: { lot_id: LOT_ID, batch_number: 'LOT-A', expires_on: '2027-03-01' },
      theoretical_quantity: '8.000',
    }),
    inventoryLine(LINE_FRAME),
  ]
  return {
    id: INVENTORY_ID,
    reference: 'INV-2026-10-15',
    location_id: LOCATION_ID,
    location_name: 'Emplacement fictif',
    snapshot_at: '2026-10-15T08:00:00.000Z',
    status: 'OPEN',
    validated_at: null,
    line_count: lines.length,
    counted_lines: 0,
    variance_lines: 0,
    variance_value_known: 0,
    unknown_cost_lines: 0,
    lines,
    ...overrides,
  } as InventoryCount
}

/** Lectures communes : catalogue, emplacements, fournisseurs. */
export function stubStockReads(api: SalesApi): void {
  api.on('GET', /^\/api\/v1\/catalog$/, () =>
    json(200, { data: [FRAME, DROPS], meta: { ...PAGE_META, total: 2 } }),
  )
  api.on('GET', /^\/api\/v1\/stock\/locations$/, () => json(200, { data: [LOCATION] }))
  api.on('GET', /^\/api\/v1\/suppliers$/, () => json(200, { data: [SUPPLIER] }))
}

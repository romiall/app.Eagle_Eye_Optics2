import { afterEach, describe, expect, it } from 'vitest'

import type { StockMovementHistoryEntry } from '@/domain/contracts/generated'

import {
  callsTo,
  json,
  openApp,
  resetSales,
  selectInto,
  stubSalesApi,
  textOf,
} from '../billing/support'
import { FRAME_ID, LOCATION_ID, PAGE_META, STOCK_MANAGER, stubStockReads } from './support'

// Historique des mouvements d'un article (cahier des charges §6, EE026), EN LIGNE : lecture seule, quantité signée,
// motif, lot, auteur ; le coût n'apparaît que si le serveur le rend. Données FICTIVES.
afterEach(() => {
  resetSales()
})

function entry(overrides: Partial<StockMovementHistoryEntry> = {}): StockMovementHistoryEntry {
  return {
    id: '01J9ZXK4M2Q8R7S6T5V4WQ0001',
    kind: 'RECEIPT',
    signed_quantity: '5.000',
    occurred_at: '2026-10-22T08:00:00.000Z',
    reason: 'Réception BL-2026-0001',
    location_name: 'Emplacement fictif',
    lot: null,
    actor_name: 'Gérante fictive',
    unit_cost: 18000,
    ...overrides,
  } as StockMovementHistoryEntry
}

const BREAKAGE = entry({
  id: '01J9ZXK4M2Q8R7S6T5V4WQ0002',
  kind: 'BREAKAGE',
  signed_quantity: '-1.000',
  reason: 'Monture tombée au comptoir',
  lot: { lot_id: '01J9ZXK4M2Q8R7S6T5V4WP0001', batch_number: 'LOT-A', expires_on: '2027-03-01' },
  unit_cost: null,
})

describe('historique des mouvements d’un article', () => {
  it('lit les mouvements de l’article de l’adresse et montre quantité signée, lot, motif, auteur et coût', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/stock\/movements$/, () =>
      json(200, { data: [BREAKAGE, entry()], meta: { ...PAGE_META, total: 2 } }),
    )

    const { root, unmount } = await openApp(`/stock/historique?article=${FRAME_ID}`)

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Historique des mouvements de stock')
    const [call] = callsTo(api, 'GET', /\/stock\/movements$/)
    expect(call?.query.get('item_id')).toBe(FRAME_ID)
    expect(call?.query.get('page')).toBe('1')
    const text = textOf(root)
    expect(text).toContain('Casse ou perte −1')
    expect(text).toContain('Réception fournisseur +5')
    expect(text).toContain('Lot LOT-A · expire le 01/03/2027')
    expect(text).toContain('Motif : Monture tombée au comptoir')
    expect(text).toContain('par Gérante fictive')
    expect(text).toContain('Coût unitaire')
    // Le coût n'est rendu qu'une fois : la casse n'en porte pas (null), la réception si.
    expect(text.match(/Coût unitaire/g)).toHaveLength(1)
    unmount()
  })

  it('filtre par type et par emplacement et repart à la première page', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/stock\/movements$/, () =>
      json(200, { data: [entry()], meta: PAGE_META }),
    )

    const { root, unmount } = await openApp(`/stock/historique?article=${FRAME_ID}`)
    await selectInto(root, 'mouvements-type', 'RECEIPT')
    await selectInto(root, 'mouvements-emplacement', LOCATION_ID)

    const last = callsTo(api, 'GET', /\/stock\/movements$/).at(-1)
    expect(last?.query.get('kind')).toBe('RECEIPT')
    expect(last?.query.get('location_id')).toBe(LOCATION_ID)
    expect(last?.query.get('page')).toBe('1')
    unmount()
  })

  it('sans article, ne lit rien ; choisir un article ouvre son historique', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/stock\/movements$/, () =>
      json(200, { data: [entry()], meta: PAGE_META }),
    )

    const { root, unmount } = await openApp('/stock/historique')
    expect(textOf(root)).toContain('Aucun article choisi')
    expect(callsTo(api, 'GET', /\/stock\/movements$/)).toHaveLength(0)

    await selectInto(root, 'historique-article', FRAME_ID)

    expect(
      callsTo(api, 'GET', /\/stock\/movements$/)
        .at(-1)
        ?.query.get('item_id'),
    ).toBe(FRAME_ID)
    expect(textOf(root)).toContain('Réception fournisseur +5')
    unmount()
  })

  it('dit qu’aucun mouvement ne correspond quand la liste est vide', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/stock\/movements$/, () =>
      json(200, { data: [], meta: { ...PAGE_META, total: 0 } }),
    )

    const { root, unmount } = await openApp(`/stock/historique?article=${FRAME_ID}`)

    expect(textOf(root)).toContain(
      'Aucun mouvement de stock ne correspond à cet article et à ces filtres.',
    )
    unmount()
  })
})

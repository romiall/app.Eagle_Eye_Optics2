import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buttonByName,
  callsTo,
  CASHIER,
  click,
  json,
  openApp,
  resetSales,
  selectInto,
  stubSalesApi,
  textOf,
} from '../billing/support'
import {
  DROPS_ID,
  FRAME_ID,
  LOCATION,
  LOCATION_ID,
  LOT_ID,
  PAGE_META,
  STOCK_MANAGER,
} from './support'

// Alertes et seuils de stock (L1D03), EN LIGNE : lecture avec disponible central détaillé, filtre par statut/type/emplacement,
// lancement de l'évaluation, accusé de réception, résolution manuelle, masquage des écritures pour lecture seule. Données FICTIVES.
const ALERT_LOW_ID = '01J9ZXK4M2Q8R7S6T5V4WA0001'
const ALERT_EXP_ID = '01J9ZXK4M2Q8R7S6T5V4WA0002'

function lowAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_LOW_ID,
    kind: 'LOW_STOCK',
    status: 'OPEN',
    item_id: FRAME_ID,
    item_reference: 'FR-001',
    item_name: 'Monture fictive',
    location_id: LOCATION_ID,
    location_code: 'PRINCIPAL',
    location_name: 'Emplacement fictif',
    lot_id: null,
    batch_number: null,
    detected_at: '2026-10-15T08:00:00.000Z',
    due_on: null,
    resolved_at: null,
    acknowledged_by: null,
    acknowledged_by_name: null,
    on_hand: '5.000',
    reserved: '3.000',
    offline_allocated: '1.000',
    central_available: '1.000',
    low_stock_threshold: '2.000',
    expiry_alert_days: null,
    expired: false,
    ...overrides,
  }
}

function expiryAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_EXP_ID,
    kind: 'EXPIRY',
    status: 'OPEN',
    item_id: DROPS_ID,
    item_reference: 'CO-001',
    item_name: 'Collyre fictif',
    location_id: LOCATION_ID,
    location_code: 'PRINCIPAL',
    location_name: 'Emplacement fictif',
    lot_id: LOT_ID,
    batch_number: 'LOT-A',
    detected_at: '2026-10-15T08:00:00.000Z',
    due_on: '2026-10-10',
    resolved_at: null,
    acknowledged_by: null,
    acknowledged_by_name: null,
    on_hand: '3.000',
    reserved: '0.000',
    offline_allocated: '0.000',
    central_available: '3.000',
    low_stock_threshold: null,
    expiry_alert_days: 15,
    expired: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

describe('alertes et seuils de stock', () => {
  it('explique le disponible central, affiche seuil et lot expiré, et permet d’actualiser, accuser réception et résoudre', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    let listData = [lowAlert(), expiryAlert()]

    api.on('GET', /^\/api\/v1\/stock\/locations$/, () => json(200, { data: [LOCATION] }))
    api.on('GET', /^\/api\/v1\/stock\/alerts$/, (req) => {
      const kind = req.query.get('kind')
      const filtered = kind ? listData.filter((a) => a.kind === kind) : listData
      return json(200, {
        data: filtered,
        meta: { ...PAGE_META, total: filtered.length },
      })
    })
    api.on('POST', /^\/api\/v1\/stock\/alerts\/evaluate$/, () =>
      json(200, {
        data: {
          opened: 1,
          reopened: 0,
          resolved: 0,
          unchanged: 1,
          open_count: 2,
          acknowledged_count: 0,
        },
      }),
    )
    api.on('POST', new RegExp(`/api/v1/stock/alerts/${ALERT_LOW_ID}/acknowledge$`), () => {
      listData = [
        lowAlert({ status: 'ACKNOWLEDGED', acknowledged_by_name: 'Gérante (test)' }),
        expiryAlert(),
      ]
      return json(200, { data: { stock_alert_id: ALERT_LOW_ID, status: 'ACKNOWLEDGED' } })
    })
    api.on('POST', new RegExp(`/api/v1/stock/alerts/${ALERT_LOW_ID}/resolve$`), () => {
      listData = [
        lowAlert({
          status: 'RESOLVED',
          acknowledged_by_name: 'Gérante (test)',
          resolved_at: '2026-10-15T09:05:00.000Z',
        }),
        expiryAlert(),
      ]
      return json(200, { data: { stock_alert_id: ALERT_LOW_ID, status: 'RESOLVED' } })
    })

    const { root, unmount } = await openApp('/stock/alertes')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Alertes et seuils de stock')
    expect(textOf(root)).toContain('Physique − Réservé − Quotas des postes')
    expect(textOf(root)).toContain('Seuil de stock bas : 2')
    expect(textOf(root)).toContain('Manque 1 pour revenir au-dessus du seuil')
    expect(textOf(root)).toContain('Lot LOT-A')
    expect(textOf(root)).toContain('Lot expiré — bloqué à la remise')

    await click(buttonByName(root, 'Actualiser les alertes'))
    expect(callsTo(api, 'POST', /\/stock\/alerts\/evaluate$/)).toHaveLength(1)
    expect(textOf(root)).toContain('Évaluation terminée : 2 alertes à traiter')

    await selectInto(root, 'alertes-type', 'LOW_STOCK')
    expect(
      callsTo(api, 'GET', /\/stock\/alerts$/)
        .at(-1)
        ?.query.get('kind'),
    ).toBe('LOW_STOCK')
    await selectInto(root, 'alertes-type', '')

    await click(buttonByName(root, 'Prendre en compte'))
    expect(textOf(root)).toContain('Prise en compte par Gérante (test)')

    await click(buttonByName(root, 'Marquer résolue'))
    expect(textOf(root)).toContain('Alerte marquée comme résolue.')
    unmount()
  })

  it('pour un compte en lecture seule du stock, masque les actions mais affiche les alertes', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/stock\/locations$/, () => json(200, { data: [LOCATION] }))
    api.on('GET', /^\/api\/v1\/stock\/alerts$/, () =>
      json(200, { data: [lowAlert()], meta: PAGE_META }),
    )

    const { root, unmount } = await openApp('/stock/alertes')

    expect(textOf(root)).toContain('Monture fictive')
    expect(root.querySelector('main')?.querySelectorAll('button').length).toBe(0)
    expect(textOf(root)).not.toContain('Actualiser les alertes')
    expect(textOf(root)).not.toContain('Prendre en compte')
    expect(textOf(root)).not.toContain('Marquer résolue')
    unmount()
  })
})

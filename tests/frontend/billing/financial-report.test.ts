import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authorLabel,
  collectionRows,
  deviceNotice,
  deviceStateLabel,
  type FinancialDevice,
  freshnessHeadline,
  periodCashNet,
  periodOtherNet,
  signedAmount,
} from '@/domain/billing/financialReport'
import type { FinancialReport } from '@/domain/contracts/generated'

import {
  buttonByName,
  callsTo,
  CASHIER,
  click,
  forbiddenWordsIn,
  json,
  MANAGER,
  openApp,
  resetSales,
  stubSalesApi,
  textOf,
  typeInto,
} from './support'

// Finance du cabinet (R01), EN LIGNE, gérante seule : chiffre d'affaires, encaissements, créances et caisse restent des
// indicateurs distincts ; la fraîcheur des postes hors ligne est dite EN PREMIER ; jamais « payé » ; une lecture qui
// échoue est « indisponible », jamais un total nul. FICTIF.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

const PAGE = '/ventes/finance'
const READ = /^\/api\/v1\/reports\/financial$/
const MANAGER_ID = '01J9ZXK4M2Q8R7S6T5V4W30MG1'
const CASHIER_ID = '01J9ZXK4M2Q8R7S6T5V4W30CA1'

function device(overrides: Partial<FinancialDevice> = {}): FinancialDevice {
  return {
    device_id: '01J9ZXK4M2Q8R7S6T5V4W3D001',
    name: 'Caisse A',
    last_sync_at: '2026-10-15T08:30:00.000Z',
    commands_pending: 0,
    commands_in_conflict: 0,
    state: 'UP_TO_DATE',
    ...overrides,
  }
}

function report(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    period: { from: '2026-10-01', to: '2026-10-31' },
    revenue: {
      issued: { count: 2, total_gross: 110000 },
      credited: { count: 1, amount_gross: 5000 },
      net: 105000,
      by_author: [
        {
          user_id: CASHIER_ID,
          display_name: 'Caisse (démonstration)',
          issued_count: 1,
          issued_gross: 30000,
          credited_count: 0,
          credited_gross: 0,
          net: 30000,
        },
        {
          user_id: MANAGER_ID,
          display_name: null,
          issued_count: 1,
          issued_gross: 80000,
          credited_count: 1,
          credited_gross: 5000,
          net: 75000,
        },
      ],
    },
    collections: {
      by_method: [
        {
          method: 'CASH',
          payments_count: 1,
          payments_amount: 30000,
          reversals_amount: 5000,
          refunds_amount: 0,
          net_amount: 25000,
        },
        {
          method: 'MTN_MOMO',
          payments_count: 2,
          payments_amount: 60000,
          reversals_amount: 0,
          refunds_amount: 2000,
          net_amount: 58000,
        },
      ],
      net_total: 83000,
      corrections: {
        reversals: { count: 1, amount: 5000 },
        refunds: { count: 1, amount: 2000 },
      },
      on_legacy: { payments_count: 1, net_amount: 20000 },
      by_author: [
        {
          user_id: CASHIER_ID,
          display_name: 'Caisse (démonstration)',
          payments_count: 3,
          payments_amount: 90000,
          reversals_amount: 5000,
          refunds_amount: 2000,
          net_amount: 83000,
        },
      ],
    },
    receivables: {
      invoices_count: 2,
      amount_due: 55000,
      of_which_legacy: { invoices_count: 1, amount_due: 30000 },
      refundable_credit: { invoices_count: 1, amount: 4000 },
    },
    legacy_imported: { count: 1, opening_balance: 50000 },
    cash_sessions: {
      closed_count: 1,
      expected_total: 40000,
      counted_total: 39500,
      variance_total: -500,
      post_closure_reversals: 5000,
      open_count: 1,
    },
    freshness: { complete: true, silence_hours: 24, devices: [device()] },
    generated_at: '2026-10-15T09:00:00.000Z',
    ...overrides,
  }
}

function money(root: Element, selector: string): string {
  return (root.querySelector(selector)?.textContent ?? '').replace(/\s/g, ' ').trim()
}

describe('finance du cabinet : règles', () => {
  it('prépare les lignes par mode et sépare les espèces des autres modes', () => {
    const data = report()
    expect(collectionRows(data)).toEqual([
      { method: 'CASH', count: 1, collected: 30000, reversed: 5000, refunded: 0, net: 25000 },
      { method: 'MTN_MOMO', count: 2, collected: 60000, reversed: 0, refunded: 2000, net: 58000 },
    ])
    expect(periodCashNet(data)).toBe(25000)
    expect(periodOtherNet(data)).toBe(58000)
    expect(periodCashNet(report({ collections: { ...data.collections, by_method: [] } }))).toBe(0)
  })

  it('nomme un auteur sans jamais en inventer un', () => {
    expect(authorLabel('Caisse (démonstration)', CASHIER_ID)).toBe('Caisse (démonstration)')
    expect(authorLabel(null, '01J9ZXK4M2Q8R7S6T5V4W30MG1')).toBe('Compte …W30MG1')
    expect(authorLabel('  ', null)).toBe('Auteur inconnu')
  })

  it('dit pour chaque poste ce qui est su et ce qui est inconnu, et rien pour un poste à jour', () => {
    expect(deviceNotice(device(), 24, '15/10/2026')).toBeNull()
    const waiting = deviceNotice(
      device({ state: 'WAITING', commands_pending: 2, commands_in_conflict: 1 }),
      24,
      null,
    )
    expect(waiting).toContain('Caisse A : 2 commandes reçues en attente d’une pièce liée')
    expect(waiting).toContain('1 commande en conflit')
    expect(waiting).toContain('pas encore dans ces totaux')
    const silent = deviceNotice(device({ state: 'SILENT' }), 24, '13/10/2026 à 08h00')
    expect(silent).toContain('rien reçu depuis le 13/10/2026 à 08h00')
    expect(silent).toContain('plus de 24 h')
    expect(silent).toContain('inconnu du serveur')
    expect(deviceNotice(device({ state: 'SILENT', last_sync_at: null }), 24, null)).toContain(
      'n’a encore rien transmis',
    )
  })

  it('annonce des totaux complets, sans poste, ou possiblement incomplets', () => {
    expect(freshnessHeadline({ complete: true, silence_hours: 24, devices: [] })).toMatchObject({
      tone: 'ok',
      text: expect.stringContaining('Aucun poste hors ligne') as string,
    })
    expect(
      freshnessHeadline({ complete: true, silence_hours: 24, devices: [device()] }),
    ).toMatchObject({ tone: 'ok', text: expect.stringContaining('Totaux à jour') as string })
    const incomplete = freshnessHeadline({
      complete: false,
      silence_hours: 24,
      devices: [device({ state: 'SILENT' })],
    })
    expect(incomplete.tone).toBe('warn')
    expect(incomplete.text).toContain('Totaux possiblement incomplets')
    expect(deviceStateLabel('UP_TO_DATE')).toBe('À jour')
    expect(deviceStateLabel('WAITING')).toBe('Commandes en attente')
    expect(deviceStateLabel('SILENT')).toBe('Sans nouvelle')
  })

  it('écrit l’écart de caisse avec son signe', () => {
    const format = (value: number): string => `${value} FCFA`
    expect(signedAmount(500, format)).toBe('+500 FCFA')
    expect(signedAmount(-500, format)).toBe('-500 FCFA')
    expect(signedAmount(0, format)).toBe('0 FCFA')
  })
})

describe('finance du cabinet : écran', () => {
  it('la gérante lit quatre indicateurs distincts, le mois en cours par défaut', async () => {
    const api = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    api.on('GET', READ, () => json(200, { data: report() }))
    const { root, unmount } = await openApp(PAGE)

    const text = textOf(root)
    expect(text).toContain('Finance du cabinet')
    expect(text).toContain('Chiffre d’affaires de la période')
    expect(text).toContain('Encaissements de la période')
    expect(text).toContain('Créances et crédits à rembourser')
    expect(text).toContain('Caisse')
    expect(money(root, '[data-montant="ca-net"]')).toContain('105 000')
    expect(money(root, '[data-montant="encaisse-net"]')).toContain('83 000')
    expect(money(root, '[data-montant="creances"]')).toContain('55 000')
    expect(money(root, '[data-montant="credits"]')).toContain('4 000')
    expect(money(root, '[data-montant="ecart-caisse"]')).toContain('-500')
    // Le chiffre d'affaires et les encaissements ne sont pas confondus.
    expect(money(root, '[data-montant="ca-net"]')).not.toBe(
      money(root, '[data-montant="encaisse-net"]'),
    )
    expect(text).toContain('Dont créances reprises du carnet papier')
    expect(text).toContain('Caisse (démonstration)')
    expect(text).toContain('Compte …W30MG1')
    expect(forbiddenWordsIn(root)).toEqual([])

    // Octobre 2026 entier, au fuseau du cabinet.
    const calls = callsTo(api, 'GET', READ)
    expect(calls.at(-1)?.query.get('from')).toBe('2026-10-01')
    expect(calls.at(-1)?.query.get('to')).toBe('2026-10-31')

    unmount()
  })

  it('des totaux à jour le disent ; un poste en retard rend les totaux possiblement incomplets, dits en premier', async () => {
    const api = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    api.on('GET', READ, () => json(200, { data: report() }))
    const complete = await openApp(PAGE)
    expect(complete.root.querySelector('[data-fraicheur="complete"]')).not.toBeNull()
    expect(textOf(complete.root)).toContain('Totaux à jour')
    complete.unmount()
    resetSales()

    const stale = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    stale.on('GET', READ, () =>
      json(200, {
        data: report({
          freshness: {
            complete: false,
            silence_hours: 24,
            devices: [
              device({ state: 'WAITING', commands_pending: 1 }),
              device({
                device_id: '01J9ZXK4M2Q8R7S6T5V4W3D002',
                name: 'Caisse B',
                last_sync_at: null,
                state: 'SILENT',
              }),
            ],
          },
        }),
      }),
    )
    const { root, unmount } = await openApp(PAGE)

    const banner = root.querySelector('[data-fraicheur="incomplete"]')
    expect(banner).not.toBeNull()
    const text = banner?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(text).toContain('Totaux possiblement incomplets')
    expect(text).toContain('Caisse A : 1 commande reçue en attente d’une pièce liée')
    expect(text).toContain('Caisse B : n’a encore rien transmis au serveur')
    // La fraîcheur précède les chiffres dans le document.
    const order = [...root.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())
    expect(order.indexOf('Fraîcheur des totaux')).toBeLessThan(
      order.indexOf('Chiffre d’affaires de la période'),
    )

    unmount()
  })

  it('une autre période est demandée au serveur ; un intervalle invalide ne l’est pas', async () => {
    const api = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    api.on('GET', READ, (request) =>
      json(200, {
        data: report({
          period: {
            from: request.query.get('from') ?? '',
            to: request.query.get('to') ?? '',
          },
        }),
      }),
    )
    const { root, unmount } = await openApp(PAGE)

    await click(buttonByName(root, 'Cette semaine'))
    await vi.waitFor(() => {
      const last = callsTo(api, 'GET', READ).at(-1)
      expect(last?.query.get('from')).toBe('2026-10-12')
      expect(last?.query.get('to')).toBe('2026-10-18')
    })
    expect(textOf(root)).toContain('Période : du')

    await typeInto(root, 'finance-debut', '20/10/2026')
    await typeInto(root, 'finance-fin', '10/10/2026')
    const before = callsTo(api, 'GET', READ).length
    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() =>
      expect(textOf(root)).toContain('La fin de la période précède son début.'),
    )
    expect(callsTo(api, 'GET', READ)).toHaveLength(before)

    await typeInto(root, 'finance-fin', '25/10/2026')
    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => {
      const last = callsTo(api, 'GET', READ).at(-1)
      expect(last?.query.get('from')).toBe('2026-10-20')
      expect(last?.query.get('to')).toBe('2026-10-25')
    })

    unmount()
  })

  it('une période sans encaissement le dit ; un serveur injoignable est « indisponible », jamais un total nul', async () => {
    const api = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    api.on('GET', READ, () =>
      json(200, {
        data: report({
          collections: {
            by_method: [],
            net_total: 0,
            corrections: {
              reversals: { count: 0, amount: 0 },
              refunds: { count: 0, amount: 0 },
            },
            on_legacy: { payments_count: 0, net_amount: 0 },
            by_author: [],
          },
        }),
      }),
    )
    const empty = await openApp(PAGE)
    expect(textOf(empty.root)).toContain('Aucun encaissement sur cette période')
    empty.unmount()
    resetSales()

    const down = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    down.on('GET', READ, () => 'network')
    const { root, unmount } = await openApp(PAGE)
    expect(textOf(root)).toContain('Serveur indisponible')
    expect(textOf(root)).not.toContain('Aucun encaissement')
    expect(root.querySelector('[data-montant="ca-net"]')).toBeNull()
    unmount()
  })

  it('la caissière n’y accède pas ; module fermé : introuvable ; la gérante y arrive depuis « Ventes et caisse »', async () => {
    stubSalesApi({ permissions: CASHIER })
    const refused = await openApp(PAGE)
    expect(refused.router.currentRoute.value.name).toBe('acces-refuse')
    refused.unmount()
    resetSales()

    const api = stubSalesApi({
      permissions: [...MANAGER, 'finance.global.read'],
      modules: ['patients', 'today'],
    })
    const closed = await openApp(PAGE)
    expect(closed.router.currentRoute.value.name).toBe('introuvable')
    expect(callsTo(api, 'GET', /reports\/financial/)).toHaveLength(0)
    closed.unmount()
    resetSales()

    const home = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    home.on('GET', READ, () => json(200, { data: report() }))
    const sales = await openApp('/ventes')
    expect(textOf(sales.root)).toContain('Finance du cabinet')
    sales.unmount()
    resetSales()

    stubSalesApi({ permissions: CASHIER })
    const cashier = await openApp('/ventes')
    expect(textOf(cashier.root)).not.toContain('Finance du cabinet')
    cashier.unmount()
  })
})

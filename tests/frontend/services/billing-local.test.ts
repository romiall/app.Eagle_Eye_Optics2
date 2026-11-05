import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NetworkUnavailable } from '@/app/api'
import { getInvoice, searchCatalog } from '@/app/services/billing'
import { type LocalCatalog, readLocalCatalog } from '@/domain/billing/localCatalog'
import type { LocalInvoice } from '@/domain/billing/localInvoices'
import type { Invoice } from '@/domain/contracts/generated'

/**
 * Lectures de vente qui savent répondre depuis CE poste : une facture créée sur le poste et pas encore consolidée prime
 * sur le serveur ; serveur injoignable, la copie du poste répond (jamais une absence affirmée) ; le catalogue figé répond
 * au choix d'un article seulement si l'écran le demande. Une erreur du serveur n'est jamais remplacée. Données fictives.
 */
const INVOICE = '01J9ZXK4M2Q8R7S6T5V4W3FA01'
const PATIENT = '01J9ZXK4M2Q8R7S6T5V4W3PA01'

const device = vi.hoisted(() => ({
  invoices: new Map<string, unknown>(),
  catalog: null as unknown,
}))
vi.mock('@/app/services/localInvoices', async () => {
  const actual = await vi.importActual<typeof import('@/app/services/localInvoices')>(
    '@/app/services/localInvoices',
  )
  return { ...actual, localInvoices: vi.fn(async () => device.invoices) }
})
vi.mock('@/app/services/localCatalog', () => ({
  localCatalog: vi.fn(async () => device.catalog),
}))

function invoice(number: string | null, total: number): Invoice {
  return {
    id: INVOICE,
    patient_id: PATIENT,
    visit_id: null,
    quote_id: null,
    number,
    status: number === null ? 'DRAFT' : 'ISSUED',
    issued_at: number === null ? null : '2026-10-28T11:30:00.000Z',
    issued_by: null,
    issued_by_name: null,
    due_date: null,
    currency: 'XAF',
    total_gross: total,
    origin: 'NATIVE',
    legacy_reference: null,
    draft_version: 1,
    ledger_version: number === null ? null : 1,
    balance: {
      total_gross: total,
      paid_net: 0,
      credited: 0,
      refunded: 0,
      balance_due: number === null ? 0 : total,
      credit_available: 0,
      settlement: number === null ? 'NOT_ISSUED' : 'UNPAID',
    },
    lines: [],
    payments: [],
    reversals: [],
    credit_notes: [],
    refunds: [],
    write_owner: null,
    document: null,
    patient_snapshot: null,
    clinic_snapshot: null,
    tax_snapshot: null,
  }
}

function setLocalInvoice(state: LocalInvoice['state'], number: string | null = 'LOCAL-1'): void {
  device.invoices.set(INVOICE, { invoice: invoice(number, 80000), state } satisfies LocalInvoice)
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  device.invoices = new Map()
  device.catalog = null
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getInvoice', () => {
  it('une facture du poste pas encore consolidée est lue SUR le poste, sans appeler le serveur qui l’ignore', async () => {
    for (const state of ['local', 'pending', 'waiting_dependency', 'conflict'] as const) {
      setLocalInvoice(state)

      const result = await getInvoice(INVOICE)

      expect(result.data.number, state).toBe('LOCAL-1')
      expect(result.freshness, state).toEqual({ serverAsOf: null, complete: false })
      expect(result.live, state).toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('une facture inconnue du poste vient du serveur, avec sa fraîcheur', async () => {
    fetchMock.mockResolvedValue(json(200, { data: invoice('SERVEUR-1', 80000) }))

    const result = await getInvoice(INVOICE)

    expect(result.data.number).toBe('SERVEUR-1')
    expect(result.live).toBe(true)
    expect(result.freshness.serverAsOf).not.toBeNull()
  })

  it('une facture consolidée suit le serveur quand il répond, et la copie du poste quand il ne répond pas', async () => {
    setLocalInvoice('acknowledged')
    fetchMock.mockResolvedValueOnce(json(200, { data: invoice('SERVEUR-1', 80000) }))
    expect((await getInvoice(INVOICE)).data.number).toBe('SERVEUR-1')

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await getInvoice(INVOICE)
    expect(offline.data.number).toBe('LOCAL-1')
    expect(offline.live).toBe(false)
  })

  it('une proposition rejetée cède la place au serveur', async () => {
    setLocalInvoice('rejected')
    fetchMock.mockResolvedValue(json(200, { data: invoice('SERVEUR-1', 80000) }))

    expect((await getInvoice(INVOICE)).data.number).toBe('SERVEUR-1')
  })

  it('une erreur du serveur n’est jamais remplacée par la copie du poste (facture inconnue : 404)', async () => {
    setLocalInvoice('acknowledged')
    fetchMock.mockResolvedValue(
      json(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'Ressource introuvable.' } }),
    )

    await expect(getInvoice(INVOICE)).rejects.toMatchObject({ status: 404 })
  })

  it('sans copie du poste, un serveur injoignable reste un réseau coupé', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(getInvoice(INVOICE)).rejects.toBeInstanceOf(NetworkUnavailable)
  })
})

describe('searchCatalog', () => {
  function catalog(): LocalCatalog {
    const value = readLocalCatalog({
      catalog_version: 'catalogue-abc123def456',
      snapshot_sha256: 'a'.repeat(64),
      snapshot: {
        items: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3IT01',
            reference: 'DEMO-MONTURE',
            category_code: 'FRAME',
            name: 'Monture fictive',
            unit_code: 'UNIT',
            quantity_integer_only: true,
            sale_price: 40000,
            tax_rule_id: null,
            stock_mode: 'NONE',
            requires_expiry: false,
            active: true,
            version: 1,
          },
        ],
        tax_rules: [],
      },
    })
    if (value === null) throw new Error('catalogue attendu')
    return value
  }

  it('sans « includeLocal », un serveur injoignable lève toujours le réseau coupé (gestion du catalogue)', async () => {
    device.catalog = catalog()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchCatalog('monture')).rejects.toBeInstanceOf(NetworkUnavailable)
  })

  it('« includeLocal » et serveur injoignable : le catalogue figé du poste répond, et le dit', async () => {
    device.catalog = catalog()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await searchCatalog('monture', 1, { includeLocal: true })

    expect(result.data.data.map((item) => item.reference)).toEqual(['DEMO-MONTURE'])
    expect(result.data.data[0]).toMatchObject({ sale_price: 40000, brand: null })
    expect(result.freshness).toEqual({ serverAsOf: null, complete: false })
    expect(result.live).toBe(false)
  })

  it('« includeLocal » sans catalogue sur le poste : le réseau coupé reste signalé tel quel', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchCatalog('monture', 1, { includeLocal: true })).rejects.toBeInstanceOf(
      NetworkUnavailable,
    )
  })

  it('serveur joint : la réponse du serveur, jamais le catalogue du poste', async () => {
    device.catalog = catalog()
    const page = {
      data: [],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 },
    }
    fetchMock.mockResolvedValue(json(200, page))

    const result = await searchCatalog('monture', 1, { includeLocal: true })

    expect(result.data).toEqual(page)
    expect(result.live).toBe(true)
  })

  it('une erreur du serveur n’est jamais remplacée par le catalogue du poste', async () => {
    device.catalog = catalog()
    fetchMock.mockResolvedValue(
      json(403, { error: { code: 'FORBIDDEN', message: 'Droits insuffisants.' } }),
    )

    await expect(searchCatalog('monture', 1, { includeLocal: true })).rejects.toMatchObject({
      status: 403,
    })
  })
})

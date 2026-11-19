import { webcrypto } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getCashDayReport,
  getCashSessionReport,
  getSalesSettings,
  listCashSessions,
  listInvoices,
  listStockLocations,
} from '@/app/services/billing'
import { clinicFromSummary } from '@/documents/data/clinic'
import { discountRule } from '@/domain/billing/draft'
import {
  accountLabel,
  cashMovementLabel,
  cashSessionReportData,
  dayCashNet,
  dayMethodRows,
  dayOtherNet,
  reportExpected,
} from '@/domain/billing/cashReport'
import { referenceRequired, validatePayment } from '@/domain/billing/payment'
import type { CashDayReport, CashSessionReport, InvoiceSummary } from '@/domain/contracts/generated'

import {
  buttonByName,
  callsTo,
  CASHIER,
  click,
  dialogButton,
  draftInvoice,
  forbiddenWordsIn,
  INVOICE_ID,
  json,
  MANAGER,
  openApp,
  openSession,
  PATIENT_ID,
  resetSales,
  salesPatient,
  SESSION_ID,
  stubSalesApi,
  textOf,
  typeInto,
} from './support'

// Compléments des ventes pour un usage réel : filtres SERVEUR de la liste des factures et identité du
// patient dans chaque ligne, règles de vente du compte (plafond de remise, références obligatoires),
// emplacements de stock, sessions de toutes les caisses et relevé, caisse du jour, abandon d'un
// brouillon. EN LIGNE ; données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

const PAGE_META = { current_page: 1, last_page: 1, per_page: 25, total: 1 }

function summary(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: INVOICE_ID,
    patient_id: PATIENT_ID,
    patient: {
      id: PATIENT_ID,
      record_number: 'EE-2026-0001',
      last_name: 'PATIENT FICTIF',
      first_names: 'Élodie Marie',
    },
    number: 'TEST-FAC-2026-000001',
    status: 'ISSUED',
    issued_at: '2026-10-15T09:00:00.000Z',
    total_gross: 80000,
    balance_due: 50000,
    draft_version: 2,
    ledger_version: 2,
    ...overrides,
  }
}

function sessionEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...openSession(),
    cashier_name: 'Caisse (démonstration)',
    closed_by_name: null,
    register_code: 'CAISSE-PRINCIPALE',
    register_name: 'Caisse principale',
    ...overrides,
  }
}

function sessionReport(overrides: Partial<CashSessionReport> = {}): CashSessionReport {
  return {
    session: sessionEntry({
      opening_amount: 10000,
      collected_cash: 30000,
      theoretical_cash: 40000,
    }),
    cash_received: 30000,
    cash_reversed: 0,
    cash_refunded: 0,
    movements_in: 0,
    movements_out: 0,
    movements: [],
    payments: [
      {
        payment_id: '01J9ZXK4M2Q8R7S6T5V4W3002T',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_id: '01J9ZXK4M2Q8R7S6T5V4W3002V',
        receipt_number: 'TEST-REC-2026-000001',
        method: 'CASH',
        amount: 30000,
        reversed_amount: 0,
        effective_at: '2026-10-15T09:00:00.000Z',
      },
      {
        payment_id: '01J9ZXK4M2Q8R7S6T5V4W3002W',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_id: '01J9ZXK4M2Q8R7S6T5V4W3002X',
        receipt_number: 'TEST-REC-2026-000002',
        method: 'MTN_MOMO',
        amount: 20000,
        reversed_amount: 0,
        effective_at: '2026-10-15T09:10:00.000Z',
      },
    ],
    other_methods: [{ method: 'MTN_MOMO', count: 1, amount: 20000 }],
    journal: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3002T',
        entry_type: 'PAYMENT',
        occurred_at: '2026-10-15T09:00:00.000Z',
        signed_amount: 30000,
        method: 'CASH',
        label: 'Facture TEST-FAC-2026-000001',
        detail: 'Reçu TEST-REC-2026-000001',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_number: 'TEST-REC-2026-000001',
        patient_name: null,
        movement_kind: null,
        reference: null,
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3002W',
        entry_type: 'PAYMENT',
        occurred_at: '2026-10-15T09:10:00.000Z',
        signed_amount: 20000,
        method: 'MTN_MOMO',
        label: 'Facture TEST-FAC-2026-000001',
        detail: 'Reçu TEST-REC-2026-000002',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_number: 'TEST-REC-2026-000002',
        patient_name: null,
        movement_kind: null,
        reference: null,
      },
    ],
    generated_at: '2026-10-15T12:00:00.000Z',
    ...overrides,
  }
}

function dayReport(overrides: Partial<CashDayReport> = {}): CashDayReport {
  return {
    date: '2026-10-15',
    scope: 'CLINIC',
    collections: [
      {
        method: 'CASH',
        payments_count: 1,
        payments_amount: 30000,
        reversals_amount: 0,
        refunds_amount: 0,
        net_amount: 30000,
      },
      {
        method: 'MTN_MOMO',
        payments_count: 2,
        payments_amount: 25000,
        reversals_amount: 5000,
        refunds_amount: 0,
        net_amount: 20000,
      },
    ],
    net_total: 50000,
    sessions: [sessionEntry()],
    issued: { count: 1, total_gross: 80000 },
    credited: { count: 0, amount_gross: 0 },
    outstanding: { invoices_count: 1, amount_due: 30000, refundable_credit: 0 },
    generated_at: '2026-10-15T12:00:00.000Z',
    ...overrides,
  }
}

describe('lectures du serveur', () => {
  it('les factures se filtrent par jour d’émission côté serveur ; un jour illisible n’est jamais envoyé', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/invoices$/, () => json(200, { data: [summary()], meta: PAGE_META }))

    await listInvoices({ issuedOn: '2026-10-15', status: 'ISSUED', patientId: PATIENT_ID })
    const [call] = callsTo(api, 'GET', /^\/api\/v1\/invoices$/)
    expect(call?.query.get('issued_on')).toBe('2026-10-15')
    expect(call?.query.get('status')).toBe('ISSUED')
    expect(call?.query.get('patient_id')).toBe(PATIENT_ID)

    await expect(listInvoices({ issuedOn: '15/10/2026' })).rejects.toThrow(RangeError)
    expect(callsTo(api, 'GET', /^\/api\/v1\/invoices$/)).toHaveLength(1)
  })

  it('règles de vente, emplacements, sessions, relevé et caisse du jour : chemins et paramètres', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('GET', /^\/api\/v1\/sales\/settings$/, () =>
      json(200, {
        data: {
          price_authority: true,
          discount_cap_percent: '100.0000',
          payment_methods: ['CASH'],
          payment_reference_required: ['MTN_MOMO'],
          exam_fee_item_reference: null,
        },
      }),
    )
    api.on('GET', /^\/api\/v1\/stock\/locations$/, () =>
      json(200, {
        data: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3004A',
            code: 'PRINCIPAL',
            name: 'Emplacement principal',
            active: true,
          },
        ],
      }),
    )
    api.on('GET', /^\/api\/v1\/cash-sessions$/, () =>
      json(200, { data: [sessionEntry()], meta: PAGE_META }),
    )
    api.on('GET', /^\/api\/v1\/cash-sessions\/([^/]+)\/report$/, () =>
      json(200, { data: sessionReport() }),
    )
    api.on('GET', /^\/api\/v1\/reports\/cash-day$/, () => json(200, { data: dayReport() }))

    expect((await getSalesSettings()).data.discount_cap_percent).toBe('100.0000')
    expect((await listStockLocations()).data[0]?.code).toBe('PRINCIPAL')
    await listCashSessions({ state: 'open', page: 2 })
    expect(callsTo(api, 'GET', /^\/api\/v1\/cash-sessions$/)[0]?.query.get('state')).toBe('open')
    expect((await getCashSessionReport(SESSION_ID)).data.cash_received).toBe(30000)
    await expect(getCashSessionReport('pas-un-ulid')).rejects.toThrow(RangeError)
    await getCashDayReport()
    await getCashDayReport('2026-10-14')
    const days = callsTo(api, 'GET', /^\/api\/v1\/reports\/cash-day$/)
    expect(days[0]?.query.get('date')).toBeNull()
    expect(days[1]?.query.get('date')).toBe('2026-10-14')
  })
})

describe('règles d’écran', () => {
  it('le plafond de remise lu sur le serveur est dit tel quel, jamais arrondi', () => {
    expect(discountRule(true, '100.0000')).toContain('autorité de prix')
    expect(discountRule(false, null)).toContain('0 % par défaut')
    expect(discountRule(false, '0.0000')).toContain('aucune remise n’est admise')
    expect(discountRule(false, '10.0000')).toContain('au plus 10 %')
    expect(discountRule(false, '12.5000')).toContain('au plus 12,5 %')
  })

  it('les modes à référence obligatoire viennent du serveur quand ils sont lus', () => {
    expect(referenceRequired('MTN_MOMO')).toBe(true)
    expect(referenceRequired('MTN_MOMO', ['CHEQUE'])).toBe(false)
    expect(referenceRequired('CHEQUE', ['CHEQUE'])).toBe(true)
    const checked = validatePayment(
      { amount: 1000, method: 'CHEQUE', reference: '' },
      { amountDue: 5000, cashSessionId: null, referenceRequiredMethods: ['CHEQUE'] },
    )
    expect(checked.ok).toBe(false)
  })

  it('le relevé de session sépare le tiroir des autres modes et garde la photographie d’une session close', () => {
    const clinic = clinicFromSummary({
      name: 'CABINET FICTIF',
      timezone: 'Africa/Douala',
      currency: 'XAF',
      production_documents_enabled: false,
    })
    const open = cashSessionReportData(sessionReport(), clinic, 'TEST-1')
    expect(open.cashReceived).toBe(30000)
    expect(open.expectedAmount).toBe(40000)
    expect(open.countedAmount).toBeNull()
    expect(open.variance).toBeNull()
    expect(open.otherMethods).toEqual([{ method: 'MTN_MOMO', count: 1, amount: 20000 }])
    expect(open.receipts.map((receipt) => receipt.receiptNumber)).toEqual([
      'TEST-REC-2026-000001',
      'TEST-REC-2026-000002',
    ])

    const reversed = cashSessionReportData(sessionReport({ cash_reversed: 5000 }), clinic, 'TEST-1')
    expect(reversed.cashReceived).toBe(25000)

    const closed = sessionReport({
      session: sessionEntry({
        opening_amount: 10000,
        theoretical_cash: 40000,
        closed_at: '2026-10-15T18:00:00.000Z',
        expected_amount: 40000,
        counted_amount: 39500,
        variance: -500,
        variance_reason: 'Erreur de rendu fictive',
      }),
    })
    expect(reportExpected(closed)).toBe(40000)
    const data = cashSessionReportData(closed, clinic, 'TEST-1')
    expect(data.countedAmount).toBe(39500)
    expect(data.variance).toBe(-500)
    expect(cashMovementLabel('EXPENSE')).toBe('Dépense')
    expect(accountLabel(null, SESSION_ID)).toBe(`Compte …${SESSION_ID.slice(-6)}`)
  })

  it('la caisse du jour distingue le tiroir des autres modes', () => {
    const report = dayReport()
    expect(dayCashNet(report)).toBe(30000)
    expect(dayOtherNet(report)).toBe(20000)
    expect(dayMethodRows(report)[1]).toEqual({
      method: 'MTN_MOMO',
      count: 2,
      collected: 25000,
      reversed: 5000,
      refunded: 0,
      net: 20000,
    })
  })
})

describe('liste des factures', () => {
  it('chaque ligne montre le patient ; le jour d’émission part au serveur', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/invoices$/, () => json(200, { data: [summary()], meta: PAGE_META }))
    const { root, unmount } = await openApp('/ventes/factures')

    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(textOf(root)).toContain('dossier EE-2026-0001')
    expect(textOf(root)).not.toContain('page affichée')
    await typeInto(root, 'factures-date', '15/10/2026')
    const calls = callsTo(api, 'GET', /^\/api\/v1\/invoices$/)
    expect(calls.at(-1)?.query.get('issued_on')).toBe('2026-10-15')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })
})

describe('abandon d’un brouillon', () => {
  function server() {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/patients\/([^/]+)$/, () => json(200, { data: salesPatient() }))
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () =>
      json(200, { data: draftInvoice({ draft_version: 3 }) }),
    )
    return api
  }

  it('après confirmation : version attendue, motif facultatif, facture affichée abandonnée', async () => {
    const api = server()
    api.on('POST', /^\/api\/v1\/invoices\/([^/]+)\/abandon$/, () =>
      json(200, { data: draftInvoice({ status: 'ABANDONED', draft_version: 4 }) }),
    )
    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`)

    await click(buttonByName(root, 'Abandonner le brouillon'))
    await typeInto(root, 'facture-abandon-motif', 'Le patient renonce (fictif)')
    await click(dialogButton(root, 'Abandonner le brouillon'))

    const [call] = callsTo(api, 'POST', /^\/api\/v1\/invoices\/[^/]+\/abandon$/)
    expect(call?.path).toBe(`/api/v1/invoices/${INVOICE_ID}/abandon`)
    expect(call?.body).toEqual({
      invoice_id: INVOICE_ID,
      reason: 'Le patient renonce (fictif)',
      expected_version: 3,
    })
    expect(call?.headers['Idempotency-Key']).toBeTruthy()
    expect(textOf(root)).toContain('Facture abandonnée')
    expect(textOf(root)).toContain('ni numéro ni effet financier')

    unmount()
  })

  it('sans motif : null ; un conflit de version garde le brouillon affiché', async () => {
    const api = server()
    api.on('POST', /^\/api\/v1\/invoices\/([^/]+)\/abandon$/, () =>
      json(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Une version plus récente existe.',
          details: { current_version: 4 },
        },
        correlation_id: 'corr-test-0300',
      }),
    )
    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`)

    await click(buttonByName(root, 'Abandonner le brouillon'))
    await click(dialogButton(root, 'Abandonner le brouillon'))

    const [call] = callsTo(api, 'POST', /^\/api\/v1\/invoices\/[^/]+\/abandon$/)
    expect(call?.body?.['reason']).toBeNull()
    expect(textOf(root)).toContain('Le brouillon a changé entre-temps')
    expect(textOf(root)).not.toContain('Facture abandonnée')

    unmount()
  })
})

describe('stock initial', () => {
  it('propose les emplacements lus sur le serveur', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('GET', /^\/api\/v1\/stock\/availability$/, () =>
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )
    api.on('GET', /^\/api\/v1\/catalog$/, () =>
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )
    api.on('GET', /^\/api\/v1\/stock\/locations$/, () =>
      json(200, {
        data: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3004A',
            code: 'PRINCIPAL',
            name: 'Emplacement principal',
            active: true,
          },
        ],
      }),
    )
    const { root, unmount } = await openApp('/stock')

    expect(callsTo(api, 'GET', /^\/api\/v1\/stock\/locations$/)).toHaveLength(1)
    expect(textOf(root)).not.toContain('Aucun emplacement de stock')
    expect(textOf(root)).not.toContain('indisponible dans cette version')

    unmount()
  })

  it('sans emplacement : le dit, jamais deviné', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('GET', /^\/api\/v1\/stock\/availability$/, () =>
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )
    api.on('GET', /^\/api\/v1\/catalog$/, () =>
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )
    api.on('GET', /^\/api\/v1\/stock\/locations$/, () => json(200, { data: [] }))
    const { root, unmount } = await openApp('/stock')

    expect(textOf(root)).toContain('Aucun emplacement de stock')

    unmount()
  })
})

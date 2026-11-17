import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeVariance,
  draftLineFromCandidate,
  draftLinesFromSaved,
  isEditableReconciliation,
  linesTotalAmount,
  manualDraftLine,
  validationProblem,
} from '@/domain/cash/reconciliation'
import type {
  AccountingExportReport,
  PaymentReconciliation,
  PaymentReconciliationCandidate,
  PaymentReconciliationCandidates,
  PaymentReconciliationSummary,
  StatementEvidence,
} from '@/domain/contracts/generated'

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

// Rapprochements par canal et export comptable Q13 (L1D06) :
// - l'attendu vient toujours du serveur avec la fraîcheur des caisses hors ligne ;
// - la gérante pointe les encaissements/remboursements libres, ajoute d'éventuels frais/litiges ;
// - le dépôt de relevé (423) et la validation définitive (423, motif si écart) figent la pièce ;
// - l'export Q13 sur /ventes/finance sépare ventes, encaissements, dépenses, rapprochements et stock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

const PAGE = '/ventes/rapprochement'
const FINANCE_PAGE = '/ventes/finance'
const MANAGER_WITH_RECONCILE = [...MANAGER, 'finance.reconcile', 'finance.global.read']
const RECONCILIATION_ID = '01J9ZXK4M2Q8R7S6T5V4W3R001'
const PAYMENT_ID = '01J9ZXK4M2Q8R7S6T5V4W3P001'
const EVIDENCE: StatementEvidence = {
  file_id: '01J9ZXK4M2Q8R7S6T5V4W3F001',
  mime_type: 'image/jpeg',
  size_bytes: 2048,
  sha256: 'abc123def456',
}

function candidate(
  overrides: Partial<PaymentReconciliationCandidate> = {},
): PaymentReconciliationCandidate {
  return {
    payment_id: PAYMENT_ID,
    refund_id: null,
    kind: 'PAYMENT',
    method: 'MTN_MOMO',
    piece_number: 'TEST-REC-2026-000101',
    invoice_id: '01J9ZXK4M2Q8R7S6T5V4W3I001',
    invoice_number: 'TEST-FAC-2026-000101',
    patient_name: 'NDOUA Claire',
    effective_at: '2026-10-15T08:30:00.000Z',
    amount: 45000,
    gross_amount: 45000,
    reversed_amount: 0,
    reference: 'MOMO-REF-101',
    ...overrides,
  }
}

function candidatesPayload(
  overrides: Partial<PaymentReconciliationCandidates> = {},
): PaymentReconciliationCandidates {
  return {
    method: 'MTN_MOMO',
    period_starts_at: '2026-10-14T23:00:00.000Z',
    period_ends_at: '2026-10-15T23:00:00.000Z',
    expected_amount: 45000,
    candidates: [candidate()],
    freshness: {
      complete: true,
      silence_hours: 24,
      devices: [
        {
          device_id: '01J9ZXK4M2Q8R7S6T5V4W3D001',
          name: 'Caisse A',
          last_sync_at: '2026-10-15T08:45:00.000Z',
          commands_pending: 0,
          commands_in_conflict: 0,
          state: 'UP_TO_DATE',
        },
      ],
    },
    ...overrides,
  }
}

function reconciliation(overrides: Partial<PaymentReconciliation> = {}): PaymentReconciliation {
  return {
    id: RECONCILIATION_ID,
    method: 'MTN_MOMO',
    period_starts_at: '2026-10-14T23:00:00.000Z',
    period_ends_at: '2026-10-15T23:00:00.000Z',
    expected_amount: 45000,
    current_expected_amount: 45000,
    statement_amount: 44500,
    variance_amount: -500,
    matched_lines_amount: 45000,
    disputed_lines_count: 0,
    unmatched_lines_count: 1,
    variance_reason: 'Frais opérateur MTN MoMo',
    status: 'DRAFT',
    statement_file: EVIDENCE,
    validated_by: null,
    validated_by_name: null,
    validated_at: null,
    created_at: '2026-10-15T09:00:00.000Z',
    updated_at: '2026-10-15T09:00:00.000Z',
    lines: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3L001',
        payment_id: PAYMENT_ID,
        refund_id: null,
        kind: 'PAYMENT',
        piece_number: 'TEST-REC-2026-000101',
        external_reference: 'MOMO-REF-101',
        statement_amount: 45000,
        expected_item_amount: 45000,
        status: 'MATCHED',
        note: null,
        effective_at: '2026-10-15T08:30:00.000Z',
        payment_reference: 'MOMO-REF-101',
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3L002',
        payment_id: null,
        refund_id: null,
        kind: null,
        piece_number: null,
        external_reference: 'FRAIS-MOMO',
        statement_amount: -500,
        expected_item_amount: null,
        status: 'UNMATCHED',
        note: 'Commission relevé',
        effective_at: null,
        payment_reference: null,
      },
    ],
    ...overrides,
  }
}

function summaryFrom(rec: PaymentReconciliation): PaymentReconciliationSummary {
  return {
    id: rec.id,
    method: rec.method,
    period_starts_at: rec.period_starts_at,
    period_ends_at: rec.period_ends_at,
    expected_amount: rec.expected_amount,
    statement_amount: rec.statement_amount,
    variance_amount: rec.variance_amount,
    status: rec.status,
    statement_file: rec.statement_file,
    variance_reason: rec.variance_reason,
    validated_by: rec.validated_by,
    validated_by_name: rec.validated_by_name,
    validated_at: rec.validated_at,
    lines_count: rec.lines.length,
    disputed_lines_count: rec.disputed_lines_count,
    unmatched_lines_count: rec.unmatched_lines_count,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
  }
}

function accountingExportReport(): AccountingExportReport {
  return {
    period: { from: '2026-10-01', to: '2026-10-31' },
    currency: 'XAF',
    freshness: { complete: true, silence_hours: 24, devices: [] },
    revenue: {
      invoices_count: 2,
      invoiced_gross: 110000,
      credit_notes_count: 1,
      credited_gross: 5000,
      net_revenue: 105000,
      legacy_excluded_note: 'Les créances reprises du carnet papier sont exclues du CA.',
    },
    collections: {
      by_method: [
        {
          method: 'MTN_MOMO',
          payments_count: 1,
          payments_amount: 45000,
          reversals_amount: 0,
          refunds_amount: 0,
          net_amount: 45000,
        },
      ],
      net_total: 45000,
      on_legacy: { payments_count: 0, net_amount: 0 },
    },
    expenses: {
      total_amount: 6000,
      movements_count: 1,
      by_category: [
        {
          category_id: '01J9ZXK4M2Q8R7S6T5V4W3C001',
          code: 'FOURN',
          name: 'Fournitures',
          movements_count: 1,
          amount: 6000,
        },
      ],
      other_cash_movements: {
        deposits: 0,
        withdrawals: 0,
        opening_adjustments: 0,
      },
    },
    reconciliations: {
      validated_count: 1,
      draft_count: 0,
      by_method: [
        {
          method: 'MTN_MOMO',
          validated_count: 1,
          expected_total: 45000,
          statement_total: 44500,
          variance_total: -500,
          disputed_lines: 0,
        },
      ],
      items: [],
    },
    receivables_at_read: {
      invoices_count: 1,
      amount_due: 25000,
      of_which_legacy: { invoices_count: 0, amount_due: 0 },
      refundable_credit: { invoices_count: 0, amount: 0 },
    },
    stock_valuation_at_read: {
      known_cost_value: 320000,
      unknown_cost_positions: 0,
      total_positions: 4,
    },
    lines: [
      {
        section: 'REVENUE_INVOICE',
        occurred_at: '2026-10-15T08:00:00.000Z',
        reference: 'TEST-FAC-2026-000101',
        channel: null,
        category_or_label: 'Facture émise',
        signed_amount: 80000,
        excluded_from_ca: false,
        reconciliation_status: null,
      },
      {
        section: 'RECONCILIATION',
        occurred_at: '2026-10-15T09:05:00.000Z',
        reference: RECONCILIATION_ID,
        channel: 'MTN_MOMO',
        category_or_label: 'Rapprochement validé',
        signed_amount: -500,
        excluded_from_ca: true,
        reconciliation_status: 'VALIDATED',
      },
    ],
    generated_at: '2026-10-15T09:10:00.000Z',
  }
}

describe('rapprochements par canal : règles pures', () => {
  it('calcule l’écart, la somme des lignes et refuse la validation sans montant ou motif d’écart', () => {
    expect(computeVariance(45000, 44500)).toBe(-500)
    expect(computeVariance(45000, null)).toBeNull()

    const cLine = draftLineFromCandidate(candidate())
    const feeLine = manualDraftLine({
      externalReference: 'FRAIS',
      statementAmount: -500,
      status: 'UNMATCHED',
      note: 'Frais MoMo',
    })
    expect(linesTotalAmount([cLine, feeLine])).toBe(44500)

    expect(
      validationProblem({ statementAmount: null, expectedAmount: 45000, varianceReason: '' }),
    ).toContain('montant net du relevé')
    expect(
      validationProblem({ statementAmount: 44500, expectedAmount: 45000, varianceReason: 'ab' }),
    ).toContain('motif explicite')
    expect(
      validationProblem({
        statementAmount: 44500,
        expectedAmount: 45000,
        varianceReason: 'Frais opérateur',
      }),
    ).toBeNull()

    const saved = draftLinesFromSaved(reconciliation().lines)
    expect(saved).toHaveLength(2)
    expect(isEditableReconciliation(reconciliation({ status: 'DRAFT' }))).toBe(true)
    expect(isEditableReconciliation(reconciliation({ status: 'VALIDATED' }))).toBe(false)
  })
})

describe('rapprochements par canal : écran et Q13', () => {
  it('charge l’attendu et la fraîcheur, pointe une écriture, reauthentifie sur validation (423) puis fige', async () => {
    let validatedCalls = 0
    let saved = reconciliation()

    const api = stubSalesApi({ permissions: MANAGER_WITH_RECONCILE })
    api.on('GET', /^\/api\/v1\/payment-reconciliations\/candidates$/, () =>
      json(200, { data: candidatesPayload() }),
    )
    api.on('GET', /^\/api\/v1\/payment-reconciliations$/, () =>
      json(200, {
        data: [summaryFrom(saved)],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
      }),
    )
    api.on('POST', /^\/api\/v1\/payment-reconciliations$/, () => {
      saved = reconciliation({ id: saved.id, status: 'DRAFT' })
      return json(201, { data: saved })
    })
    api.on('POST', /^\/api\/v1\/payment-reconciliations\/[^/]+\/validate$/, () => {
      validatedCalls += 1
      if (validatedCalls === 1) {
        return json(423, { error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Confirmez.' } })
      }
      saved = reconciliation({
        status: 'VALIDATED',
        validated_by: '01J9ZXK4M2Q8R7S6T5V4W30001',
        validated_by_name: 'Gérante (démonstration)',
        validated_at: '2026-10-15T09:05:00.000Z',
      })
      return json(200, { data: saved })
    })
    api.on('POST', /^\/api\/v1\/auth\/reauthenticate$/, () =>
      json(200, { data: { reauthenticated_until: '2026-10-15T09:20:00.000Z' } }),
    )

    const { root, unmount } = await openApp(PAGE)

    await vi.waitFor(() => {
      expect(textOf(root)).toContain('TEST-REC-2026-000101')
    })
    expect(textOf(root)).toContain('45 000 FCFA')
    expect(textOf(root)).toContain('Totaux à jour')

    // Pointer le reçu MTN MoMo et saisir le total net du relevé + motif
    await click(buttonByName(root, 'Pointer'))
    await typeInto(root, 'rec-total-releve', '44500')
    root.querySelector('#rec-total-releve')?.dispatchEvent(new Event('blur', { bubbles: true }))

    await click(buttonByName(root, 'Valider définitivement'))
    await vi.waitFor(() => {
      expect(textOf(root)).toContain('Un écart non nul exige un motif explicite')
    })

    await typeInto(root, 'rec-motif', 'Frais opérateur MTN MoMo')
    await click(buttonByName(root, 'Valider définitivement'))

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Confirmer votre mot de passe')
    })

    const pwd = document.body.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(pwd).not.toBeNull()
    if (pwd) {
      pwd.value = 'secret-fictif'
      pwd.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const confirmBtn = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Confirmer et reprendre'),
    )
    expect(confirmBtn).toBeDefined()
    if (confirmBtn) await click(confirmBtn)

    await vi.waitFor(() => {
      expect(textOf(root)).toContain('Rapprochement validé et figé')
    })
    expect(callsTo(api, 'POST', /\/validate$/)).toHaveLength(2)
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('une caissière n’a pas accès aux rapprochements', async () => {
    stubSalesApi({ permissions: CASHIER })
    const { router, unmount } = await openApp(PAGE)
    expect(router.currentRoute.value.name).toBe('acces-refuse')
    unmount()
  })

  it('sur Finance du cabinet : charge la restitution comptable Q13 sans mélanger les grandeurs et propose le CSV', async () => {
    const api = stubSalesApi({ permissions: MANAGER_WITH_RECONCILE })
    api.on('GET', /^\/api\/v1\/reports\/financial$/, () =>
      json(200, {
        data: {
          period: { from: '2026-10-01', to: '2026-10-31' },
          revenue: {
            issued: { count: 2, total_gross: 110000 },
            credited: { count: 1, amount_gross: 5000 },
            net: 105000,
            by_author: [],
          },
          collections: {
            by_method: [],
            net_total: 45000,
            corrections: { reversals: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 } },
            on_legacy: { payments_count: 0, net_amount: 0 },
            by_author: [],
          },
          receivables: {
            invoices_count: 1,
            amount_due: 25000,
            of_which_legacy: { invoices_count: 0, amount_due: 0 },
            refundable_credit: { invoices_count: 0, amount: 0 },
          },
          legacy_imported: { count: 1, opening_balance: 50000 },
          cash_sessions: {
            closed_count: 0,
            expected_total: 0,
            counted_total: 0,
            variance_total: 0,
            post_closure_reversals: 0,
            open_count: 0,
          },
          freshness: { complete: true, silence_hours: 24, devices: [] },
          generated_at: '2026-10-15T09:00:00.000Z',
        },
      }),
    )
    api.on('GET', /^\/api\/v1\/reports\/accounting-export$/, () =>
      json(200, { data: accountingExportReport() }),
    )

    const { root, unmount } = await openApp(FINANCE_PAGE)

    await click(buttonByName(root, 'Aperçu comptable Q13'))
    await vi.waitFor(() => {
      expect(textOf(root)).toContain('Stock au coût connu')
    })

    const text = textOf(root)
    expect(text).toContain('320 000 FCFA')
    expect(text).toContain('6 000 FCFA')
    expect(text).toContain('1 validé(s)')
    const download = root.querySelector(
      'a[href*="/api/v1/reports/accounting-export/download"]',
    ) as HTMLAnchorElement | null
    expect(download?.getAttribute('href')).toContain('from=')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })
})

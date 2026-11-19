import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CashSessionReport } from '@/domain/contracts/generated'

import {
  buttonByName,
  CASHIER,
  click,
  forbiddenWordsIn,
  INVOICE_ID,
  json,
  MANAGER,
  openApp,
  openSession,
  REGISTERS,
  resetSales,
  SESSION_ID,
  stubSalesApi,
  textOf,
} from './support'

// Journal chronologique unifié de la caisse (`CashSessionJournal` dans `/caisse`) : fusion à l'heure
// exacte des factures encaissées, dépenses et contre-écritures, filtres par nature, lien vers la facture.
// Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

function journalReport(): CashSessionReport {
  return {
    session: {
      ...openSession({
        opening_amount: 10000,
        collected_cash: 33000,
        refunded_cash: 0,
        theoretical_cash: 39500,
      }),
      cashier_name: 'Caisse Fictive',
      closed_by_name: null,
      register_code: 'CAISSE-PRINCIPALE',
      register_name: 'Caisse principale',
    },
    cash_received: 33000,
    cash_reversed: 3000,
    cash_refunded: 0,
    movements_in: 0,
    movements_out: 3500,
    movements: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3005A',
        kind: 'EXPENSE',
        signed_amount: -3500,
        reason: 'Papier A4',
        occurred_at: '2026-10-15T09:10:00.000Z',
      },
    ],
    payments: [
      {
        payment_id: '01J9ZXK4M2Q8R7S6T5V4W3002T',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_id: '01J9ZXK4M2Q8R7S6T5V4W3002V',
        receipt_number: 'TEST-REC-2026-000001',
        method: 'CASH',
        amount: 33000,
        reversed_amount: 0,
        effective_at: '2026-10-15T08:15:00.000Z',
      },
    ],
    other_methods: [],
    journal: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3002T',
        entry_type: 'PAYMENT',
        occurred_at: '2026-10-15T08:15:00.000Z',
        signed_amount: 33000,
        method: 'CASH',
        label: 'Facture TEST-FAC-2026-000001',
        detail: 'Reçu TEST-REC-2026-000001',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_number: 'TEST-REC-2026-000001',
        patient_name: 'Élodie Patient Fictif',
        movement_kind: null,
        reference: null,
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3005A',
        entry_type: 'CASH_MOVEMENT',
        occurred_at: '2026-10-15T09:10:00.000Z',
        signed_amount: -3500,
        method: 'CASH',
        label: 'Dépense',
        detail: 'Fournitures — Papier A4',
        invoice_id: null,
        invoice_number: null,
        receipt_number: null,
        patient_name: null,
        movement_kind: 'EXPENSE',
        reference: 'BON-042',
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3006R',
        entry_type: 'PAYMENT_REVERSAL',
        occurred_at: '2026-10-15T10:05:00.000Z',
        signed_amount: -3000,
        method: 'CASH',
        label: 'Contre-écriture TEST-FAC-2026-000001',
        detail: 'Erreur de caisse',
        invoice_id: INVOICE_ID,
        invoice_number: 'TEST-FAC-2026-000001',
        receipt_number: null,
        patient_name: 'Élodie Patient Fictif',
        movement_kind: null,
        reference: null,
      },
    ],
    generated_at: '2026-10-15T12:00:00.000Z',
  }
}

describe('journal chronologique de la caisse', () => {
  it('fusionne factures encaissées, dépenses et contre-écritures avec filtres par nature', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/cash-registers$/, () => json(200, { data: REGISTERS }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: openSession() }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/([^/]+)\/report$/, () =>
      json(200, { data: journalReport() }),
    )
    api.on('GET', /^\/api\/v1\/cash-sessions\/([^/]+)\/movements$/, () =>
      json(200, { data: { session: openSession(), movements: [], available_cash: 39500 } }),
    )
    api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: [] }))
    api.on('GET', /^\/api\/v1\/expenses$/, () =>
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )

    const { root, unmount } = await openApp('/ventes/caisse')
    await vi.waitFor(() => expect(textOf(root)).toContain('Journal chronologique de la caisse'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Facture TEST-FAC-2026-000001'))

    const full = textOf(root)
    expect(full).toContain('Reçu TEST-REC-2026-000001')
    expect(full).toContain('Élodie Patient Fictif')
    expect(full).toContain('+33 000 FCFA')
    expect(full).toContain('Fournitures — Papier A4')
    expect(full).toContain('Réf. BON-042')
    expect(full).toContain('−3 500 FCFA')
    expect(full).toContain('Contre-écriture TEST-FAC-2026-000001')
    expect(full).toContain('−3 000 FCFA')

    const invoiceLink = [...root.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Facture TEST-FAC-2026-000001'),
    )
    expect(invoiceLink?.getAttribute('href')).toBe(`/ventes/factures/${INVOICE_ID}`)

    // Filtre : Factures & reçus uniquement (paiement + contre-écriture)
    await click(buttonByName(root, 'Factures & reçus (1)'))
    expect(textOf(root)).toContain('Facture TEST-FAC-2026-000001')
    expect(textOf(root)).toContain('Contre-écriture TEST-FAC-2026-000001')
    expect(textOf(root)).not.toContain('Fournitures — Papier A4')

    // Filtre : Dépenses & mouvements uniquement
    await click(buttonByName(root, 'Dépenses & mouvements (1)'))
    expect(textOf(root)).toContain('Fournitures — Papier A4')
    expect(textOf(root)).not.toContain('Facture TEST-FAC-2026-000001')

    // Retour à Tout
    await click(buttonByName(root, 'Tout (3)'))
    expect(textOf(root)).toContain('Facture TEST-FAC-2026-000001')
    expect(textOf(root)).toContain('Fournitures — Papier A4')
    expect(forbiddenWordsIn(root)).toEqual([])

    expect(SESSION_ID).toBeTruthy()
    unmount()
  })

  it('affiche et masque le journal d’une session depuis la caisse du jour', async () => {
    const api = stubSalesApi({ permissions: [...MANAGER, 'finance.global.read'] })
    api.on('GET', /^\/api\/v1\/reports\/cash-day$/, () =>
      json(200, {
        data: {
          date: '2026-10-15',
          scope: 'CLINIC',
          collections: [],
          net_total: 33000,
          sessions: [
            {
              ...openSession(),
              cashier_name: 'Caisse Fictive',
              closed_by_name: null,
              register_code: 'CAISSE-PRINCIPALE',
              register_name: 'Caisse principale',
            },
          ],
          issued: { count: 1, total_gross: 33000 },
          credited: { count: 0, amount_gross: 0 },
          outstanding: { invoices_count: 0, amount_due: 0, refundable_credit: 0 },
          generated_at: '2026-10-15T12:00:00.000Z',
        },
      }),
    )
    api.on('GET', /^\/api\/v1\/cash-sessions\/([^/]+)\/report$/, () =>
      json(200, { data: journalReport() }),
    )

    const { root, unmount } = await openApp('/ventes/caisse-du-jour')
    await vi.waitFor(() => expect(textOf(root)).toContain('Sessions de caisse du jour'))
    expect(textOf(root)).not.toContain('Journal chronologique de la caisse')

    await click(buttonByName(root, 'Voir le journal de caisse'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Journal chronologique de la caisse'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Facture TEST-FAC-2026-000001'))
    expect(textOf(root)).toContain('Fournitures — Papier A4')

    await click(buttonByName(root, 'Masquer le journal'))
    await vi.waitFor(() => expect(textOf(root)).not.toContain('Journal chronologique de la caisse'))
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })
})

import { describe, expect, it } from 'vitest'

import {
  collectionBlockedByReview,
  countedLocal,
  effectiveBalance,
  effectiveLedgerVersion,
  type LocalFactLike,
  localPaymentsFor,
  localReceiptOf,
  notYetOnServer,
} from '@/domain/billing/localPayments'

import { issuedInvoice } from './support'

// Encaissements enregistrés sur le poste (G1 ; AT37, AT38) : facture de 80 000, acompte de 30 000 puis solde de
// 50 000 sans réseau. Le reste dû et la version attendue suivent le journal local, jamais un double compte après la
// synchronisation. Données FICTIVES.

const INVOICE = issuedInvoice(0)
const CASHIER = { userId: '01J9ZXK4M2Q8R7S6T5V4W30002', displayName: 'Caisse (démonstration)' }

function fact(
  amount: number,
  index: number,
  state: LocalFactLike['state'] = 'local',
  overrides: Record<string, unknown> = {},
): LocalFactLike {
  return {
    state,
    fact: {
      commandId: `01J9ZXK4M2Q8R7S6T5V4W3C0${index}`,
      commandName: 'RegisterPayment',
      entityId: INVOICE.id,
      number: `TEST-REC-2026-00005${index}`,
      recordedAt: `2026-10-28T10:0${index}:00.000Z`,
      payload: {
        invoice_id: INVOICE.id,
        payment_id: `01J9ZXK4M2Q8R7S6T5V4W3P0${index}`,
        receipt_id: `01J9ZXK4M2Q8R7S6T5V4W3R0${index}`,
        amount,
        method: 'MTN_MOMO',
        reference: `MOMO-${index}`,
        effective_at: `2026-10-28T10:0${index}:00.000Z`,
        ...overrides,
      },
    },
  }
}

describe('encaissements du poste', () => {
  it('ne retient que les encaissements de cette facture, avec leur numéro de reçu définitif', () => {
    const other = fact(10_000, 3, 'local', { invoice_id: '01J9ZXK4M2Q8R7S6T5V4W3OTHER' })
    const issued = { ...fact(1, 4), fact: { ...fact(1, 4).fact, commandName: 'IssueInvoice' } }
    const payments = localPaymentsFor(INVOICE.id, [fact(30_000, 1), fact(50_000, 2), other, issued])
    expect(payments.map((payment) => [payment.amount, payment.receiptNumber])).toEqual([
      [30_000, 'TEST-REC-2026-000051'],
      [50_000, 'TEST-REC-2026-000052'],
    ])
    expect(payments[0]?.method).toBe('MTN_MOMO')
  })

  it('ignore un fait sans identifiant de paiement, sans montant ou sans mode connu', () => {
    const broken = [
      fact(5_000, 1, 'local', { payment_id: null }),
      fact(5_000, 2, 'local', { amount: '5000' }),
      fact(5_000, 3, 'local', { method: 'TROC' }),
    ]
    expect(localPaymentsFor(INVOICE.id, broken)).toEqual([])
  })

  it('le serveur fait foi : un encaissement qu’il connaît déjà n’est plus montré à part', () => {
    const payments = localPaymentsFor(INVOICE.id, [fact(30_000, 1), fact(50_000, 2)])
    const known = [{ id: payments[0]?.paymentId ?? '' }]
    expect(notYetOnServer(payments, known).map((payment) => payment.amount)).toEqual([50_000])
  })
})

describe('reste à encaisser et version attendue', () => {
  it('30 000 puis 50 000 : le reste passe de 80 000 à 50 000 puis à 0, jamais compté deux fois', () => {
    const first = localPaymentsFor(INVOICE.id, [fact(30_000, 1)])
    expect(effectiveBalance(INVOICE.balance, first)).toMatchObject({
      paid_net: 30_000,
      balance_due: 50_000,
    })
    const both = localPaymentsFor(INVOICE.id, [fact(30_000, 1), fact(50_000, 2)])
    expect(effectiveBalance(INVOICE.balance, both)).toMatchObject({
      paid_net: 80_000,
      balance_due: 0,
    })
  })

  it('un conflit ou un rejet ne se compte pas dans le reste dû ; un conflit bloque le nouvel encaissement', () => {
    const payments = localPaymentsFor(INVOICE.id, [
      fact(30_000, 1, 'conflict'),
      fact(10_000, 2, 'rejected'),
      fact(5_000, 3, 'pending'),
    ])
    expect(countedLocal(payments).map((payment) => payment.amount)).toEqual([5_000])
    expect(effectiveBalance(INVOICE.balance, payments).balance_due).toBe(75_000)
    expect(collectionBlockedByReview(payments)).toBe(true)
  })

  it('la version du grand livre avance d’un par fait du poste pas encore final', () => {
    const payments = localPaymentsFor(INVOICE.id, [
      fact(30_000, 1),
      fact(10_000, 2, 'pending'),
      fact(5_000, 3, 'rejected'),
      fact(5_000, 4, 'conflict'),
    ])
    expect(effectiveLedgerVersion(1, payments)).toBe(4)
    expect(effectiveLedgerVersion(null, payments)).toBeNull()
  })
})

describe('reçu d’un encaissement du poste', () => {
  const payments = localPaymentsFor(INVOICE.id, [fact(30_000, 1), fact(50_000, 2)])

  it('acompte puis règlement du solde : montants avant et après dans l’ordre du journal', () => {
    const deposit = localReceiptOf({
      invoice: INVOICE,
      pending: payments,
      payment: payments[0]!,
      cashier: CASHIER,
    })
    expect(deposit?.number).toBe('TEST-REC-2026-000051')
    expect(deposit?.snapshot).toMatchObject({
      kind: 'DEPOSIT',
      paid_net_before: 0,
      paid_net_after: 30_000,
      balance_after: 50_000,
    })
    const balance = localReceiptOf({
      invoice: INVOICE,
      pending: payments,
      payment: payments[1]!,
      cashier: CASHIER,
    })
    expect(balance?.snapshot).toMatchObject({
      kind: 'BALANCE_SETTLEMENT',
      paid_net_before: 30_000,
      paid_net_after: 80_000,
      balance_after: 0,
    })
    expect(balance?.snapshot.invoice.number).toBe(INVOICE.number)
    expect(balance?.snapshot.cashier.display_name).toBe('Caisse (démonstration)')
    expect(balance?.snapshot.template_version).toBe('receipt.v1')
    expect(balance?.document).toBeNull()
  })

  it('une facture sans figés d’émission ne produit pas de reçu', () => {
    const draft = { ...INVOICE, number: null, issued_at: null }
    expect(
      localReceiptOf({
        invoice: draft,
        pending: payments,
        payment: payments[0]!,
        cashier: CASHIER,
      }),
    ).toBeNull()
  })
})

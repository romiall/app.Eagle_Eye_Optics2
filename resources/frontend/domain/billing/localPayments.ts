import type {
  Invoice,
  InvoiceBalance,
  InvoicePayment,
  PaymentsMethod,
  Receipt,
} from '@/domain/contracts/generated'

import { isPaymentMethod } from './payment'

/**
 * Encaissements enregistrés sur CE poste préparé (G1 ; fichier 19, AT37, AT38) et leur effet sur ce que la facture
 * affiche. Un encaissement fait sans réseau est un fait financier du journal local : son reçu porte déjà son numéro
 * définitif (plage du poste), mais le serveur ne le connaît pas avant la synchronisation. La facture le montre donc à
 * part, jamais « sur le serveur », avec l'état de sa commande, et le reste à encaisser en tient compte. Règles pures :
 * aucune lecture du coffre ici (service d'application `localPayments`).
 *
 * Seul `RegisterPayment` se fait sur le poste (contre-écriture, avoir et remboursement restent en ligne) : le solde
 * d'une facture vu du poste est donc le solde du serveur moins les encaissements du poste qu'il ne connaît pas encore.
 */

/** États d'une commande du poste (mêmes valeurs que `LocalSyncState`, sans importer le moteur du poste). */
export type LocalPaymentState =
  'local' | 'pending' | 'waiting_dependency' | 'conflict' | 'acknowledged' | 'rejected'

/** Encaissement du journal local. */
export interface LocalPayment {
  commandId: string
  paymentId: string
  receiptId: string | null
  /** Numéro définitif de la plage du poste (jamais renuméroté à la synchronisation). */
  receiptNumber: string | null
  amount: number
  method: PaymentsMethod
  reference: string | null
  effectiveAt: string
  recordedAt: string
  state: LocalPaymentState
}

/** Fait local lu dans le coffre (forme structurelle de `LocalFactRecord`). */
export interface LocalFactLike {
  fact: {
    commandId: string
    commandName: string
    entityId: string
    payload: Record<string, unknown>
    number: string | null
    recordedAt: string
  }
  state: LocalPaymentState
}

/** Enregistré sur le poste et compté dans le reste dû, pas encore consolidé : jamais conflit ni rejet. */
const COUNTED: ReadonlySet<LocalPaymentState> = new Set(['local', 'pending', 'waiting_dependency'])

/** Commande pas encore finale : elle a avancé la version du grand livre local. */
const NOT_FINAL: ReadonlySet<LocalPaymentState> = new Set([
  'local',
  'pending',
  'waiting_dependency',
  'conflict',
])

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Encaissements du journal local pour une facture, dans l'ordre du journal. */
export function localPaymentsFor(
  invoiceId: string,
  records: readonly LocalFactLike[],
): LocalPayment[] {
  const found: LocalPayment[] = []
  for (const { fact, state } of records) {
    if (fact.commandName !== 'RegisterPayment') continue
    const payload = fact.payload
    if (payload['invoice_id'] !== invoiceId) continue
    const paymentId = text(payload['payment_id'])
    const amount = payload['amount']
    const method = text(payload['method'])
    if (paymentId === null || typeof amount !== 'number' || !isPaymentMethod(method)) continue
    found.push({
      commandId: fact.commandId,
      paymentId,
      receiptId: text(payload['receipt_id']),
      receiptNumber: fact.number,
      amount,
      method,
      reference: text(payload['reference']),
      effectiveAt: text(payload['effective_at']) ?? fact.recordedAt,
      recordedAt: fact.recordedAt,
      state,
    })
  }
  return found
}

/** Encaissements du poste que la lecture du serveur ne contient pas (même identifiant : le serveur fait foi). */
export function notYetOnServer(
  payments: readonly LocalPayment[],
  server: readonly Pick<InvoicePayment, 'id'>[],
): LocalPayment[] {
  const known = new Set(server.map((payment) => payment.id))
  return payments.filter((payment) => !known.has(payment.paymentId))
}

/** Encaissements comptés dans le reste dû (enregistrés ou en attente ; ni conflit, ni rejet). */
export function countedLocal(payments: readonly LocalPayment[]): LocalPayment[] {
  return payments.filter((payment) => COUNTED.has(payment.state))
}

/** Un encaissement du poste est en conflit : aucun nouvel encaissement sans décision de la gérante (contrat 23). */
export function collectionBlockedByReview(payments: readonly LocalPayment[]): boolean {
  return payments.some((payment) => payment.state === 'conflict')
}

function sum(payments: readonly LocalPayment[]): number {
  return payments.reduce((total, payment) => total + payment.amount, 0)
}

/** Montants de la facture, encaissements du poste compris (le total et le reste suivent ce qui est enregistré). */
export function effectiveBalance(
  balance: InvoiceBalance,
  pending: readonly LocalPayment[],
): InvoiceBalance {
  const counted = sum(countedLocal(pending))
  if (counted === 0) return balance
  return {
    ...balance,
    paid_net: balance.paid_net + counted,
    balance_due: balance.balance_due - counted,
  }
}

/**
 * Version du grand livre à attendre pour la prochaine commande du poste : celle du serveur, plus un par fait du poste
 * qu'il ne connaît pas et dont la commande n'est pas finale (comme `ledger_version` du journal local).
 */
export function effectiveLedgerVersion(
  version: number | null,
  pending: readonly LocalPayment[],
): number | null {
  if (version === null) return null
  return version + pending.filter((payment) => NOT_FINAL.has(payment.state)).length
}

/**
 * Reçu d'un encaissement du poste, au format du reçu du serveur, pour en produire le PDF sans réseau : numéro de la
 * plage du poste, identité du patient et en-tête du cabinet figés à l'émission de la facture, montants avant et après
 * calculés dans l'ordre du journal. Rend null si la facture n'a pas ses figés (facture non émise).
 */
export function localReceiptOf(input: {
  invoice: Invoice
  pending: readonly LocalPayment[]
  payment: LocalPayment
  cashier: { userId: string; displayName: string }
}): Receipt | null {
  const { invoice, payment, cashier } = input
  const patient = invoice.patient_snapshot
  const clinic = invoice.clinic_snapshot
  if (
    patient === null ||
    clinic === null ||
    invoice.number === null ||
    invoice.issued_at === null ||
    payment.receiptNumber === null
  ) {
    return null
  }
  const earlier: LocalPayment[] = []
  for (const candidate of input.pending) {
    if (candidate.paymentId === payment.paymentId) break
    earlier.push(candidate)
  }
  const paidBefore = invoice.balance.paid_net + sum(countedLocal(earlier))
  const paidAfter = paidBefore + payment.amount
  const balanceAfter = invoice.balance.balance_due - sum(countedLocal(earlier)) - payment.amount
  const receiptId = payment.receiptId ?? payment.paymentId
  return {
    id: receiptId,
    payment_id: payment.paymentId,
    invoice_id: invoice.id,
    number: payment.receiptNumber,
    issued_at: payment.recordedAt,
    issued_by: cashier.userId,
    document: null,
    snapshot: {
      receipt_id: receiptId,
      receipt_number: payment.receiptNumber,
      issued_at: payment.recordedAt,
      effective_at: payment.effectiveAt,
      invoice: {
        invoice_id: invoice.id,
        number: invoice.number,
        issued_at: invoice.issued_at,
        total_gross: invoice.balance.total_gross,
      },
      patient: { ...patient },
      payment: {
        payment_id: payment.paymentId,
        amount: payment.amount,
        currency: 'XAF',
        method: payment.method,
        reference: payment.reference,
      },
      paid_net_before: paidBefore,
      paid_net_after: paidAfter,
      balance_after: balanceAfter,
      kind: balanceAfter <= 0 ? 'BALANCE_SETTLEMENT' : 'DEPOSIT',
      cashier: { user_id: cashier.userId, display_name: cashier.displayName },
      clinic: { ...clinic },
      template_version: 'receipt.v1',
    },
  }
}

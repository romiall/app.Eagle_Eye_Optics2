import type { DocumentClinic } from '@/documents/data/clinic'
import type { CashSessionReportData } from '@/documents/data/financial'
import type {
  CashDayReport,
  CashMovementsKind,
  CashSessionReport,
  PaymentsMethod,
} from '@/domain/contracts/generated'

/**
 * Relevé de session et caisse du jour (B05, R01 minimal) : règles pures qui préparent l'affichage et le
 * modèle du PDF du relevé (`CASH_SESSION_REPORT`, produit sur le poste). Aucun montant n'est calculé
 * autrement qu'à partir des faits rendus par le serveur ; aucun état « payé ».
 *
 * Tiroir espèces du PDF : le modèle attend fond + encaissés − remboursés + entrées − sorties = attendu.
 * Une contre-écriture d'un encaissement en espèces n'est pas une sortie d'argent : elle est déduite des
 * encaissés (« encaissés nets »), comme dans la projection du serveur (`theoretical_cash`).
 */

const MOVEMENT_LABELS: Readonly<Record<CashMovementsKind, string>> = {
  DEPOSIT: 'Entrée autorisée',
  WITHDRAWAL: 'Sortie autorisée',
  EXPENSE: 'Dépense',
  OPENING_CORRECTION: 'Correction du fond',
}

export function cashMovementLabel(kind: CashMovementsKind): string {
  return MOVEMENT_LABELS[kind]
}

/** Nom affichable d'un compte : celui rendu par le serveur, sinon un identifiant court (jamais inventé). */
export function accountLabel(name: string | null, id: string): string {
  return name !== null && name.trim() !== '' ? name : `Compte …${id.slice(-6)}`
}

/** Espèces attendues du relevé : la photographie figée d'une session close, sinon la projection. */
export function reportExpected(report: CashSessionReport): number {
  const session = report.session
  return session.closed_at !== null && session.expected_amount !== null
    ? session.expected_amount
    : session.theoretical_cash
}

/**
 * Données du PDF du relevé d'une session, depuis la ressource du serveur. Une session close dont les
 * espèces attendues figées ne correspondent plus aux faits (contre-écriture postérieure à la clôture) est
 * refusée par le modèle : le PDF n'est pas produit, l'écran le dit (jamais un relevé arrangé).
 */
export function cashSessionReportData(
  report: CashSessionReport,
  clinic: DocumentClinic,
  templateVersion: string,
): CashSessionReportData {
  const session = report.session
  return {
    templateVersion,
    sessionId: session.id,
    cashierName: accountLabel(session.cashier_name, session.cashier_id),
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openingAmount: session.opening_amount,
    cashReceived: report.cash_received - report.cash_reversed,
    cashRefunded: report.cash_refunded,
    cashIn: report.movements_in,
    cashOut: report.movements_out,
    expectedAmount: reportExpected(report),
    countedAmount: session.closed_at === null ? null : session.counted_amount,
    variance: session.closed_at === null ? null : session.variance,
    varianceReason: session.variance_reason,
    otherMethods: report.other_methods.map((entry) => ({
      method: entry.method,
      count: entry.count,
      amount: entry.amount,
    })),
    movements: report.movements.map((movement) => ({
      at: movement.occurred_at,
      label:
        movement.reason === null || movement.reason === ''
          ? cashMovementLabel(movement.kind)
          : `${cashMovementLabel(movement.kind)} : ${movement.reason}`,
      amount: movement.signed_amount,
    })),
    receipts: report.payments
      .filter(
        (payment): payment is typeof payment & { receipt_number: string } =>
          payment.receipt_number !== null,
      )
      .map((payment) => ({
        receiptNumber: payment.receipt_number,
        effectiveAt: payment.effective_at,
        method: payment.method,
        amount: payment.amount,
        invoiceNumber: payment.invoice_number ?? '—',
      })),
    journal: report.journal.map((entry) => {
      const extras = [
        entry.patient_name,
        entry.detail,
        entry.reference ? `Réf. ${entry.reference}` : null,
      ].filter((value): value is string => value !== null && value !== '')
      return {
        at: entry.occurred_at,
        entryType: entry.entry_type,
        label: entry.label,
        detail: extras.length > 0 ? extras.join(' · ') : null,
        method: entry.method,
        amount: entry.signed_amount,
      }
    }),
    clinic,
  }
}

/** Ligne de la caisse du jour, par mode : encaissé, contre-écritures, remboursements, net. */
export interface DayMethodRow {
  method: PaymentsMethod
  count: number
  collected: number
  reversed: number
  refunded: number
  net: number
}

export function dayMethodRows(report: CashDayReport): DayMethodRow[] {
  return report.collections.map((entry) => ({
    method: entry.method,
    count: entry.payments_count,
    collected: entry.payments_amount,
    reversed: entry.reversals_amount,
    refunded: entry.refunds_amount,
    net: entry.net_amount,
  }))
}

/** Espèces nettes du jour (tiroir), distinctes des autres modes rapprochés à part. */
export function dayCashNet(report: CashDayReport): number {
  return report.collections.find((entry) => entry.method === 'CASH')?.net_amount ?? 0
}

/** Somme nette des modes hors espèces (mobile money, virement, chèque, autre). */
export function dayOtherNet(report: CashDayReport): number {
  return report.collections
    .filter((entry) => entry.method !== 'CASH')
    .reduce((total, entry) => total + entry.net_amount, 0)
}

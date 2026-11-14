import type {
  AccountingExportReport,
  PaymentReconciliation,
  PaymentReconciliationCandidate,
  PaymentReconciliationLine,
  PaymentReconciliationLinesStatus,
  PaymentReconciliationsMethod,
  PaymentReconciliationsStatus,
} from '@/domain/contracts/generated'
import type { CivilDate } from '@/domain/values/civilDate'
import { newUlid } from '@/domain/values/ulid'

export const RECONCILIATION_METHODS: readonly PaymentReconciliationsMethod[] = [
  'CASH',
  'MTN_MOMO',
  'ORANGE_MONEY',
  'BANK_TRANSFER',
  'CHEQUE',
  'OTHER',
]

export const RECONCILIATION_STATUS_LABELS: Readonly<Record<PaymentReconciliationsStatus, string>> =
  {
    DRAFT: 'Brouillon',
    VALIDATED: 'Validé',
  }

export const RECONCILIATION_LINE_STATUS_LABELS: Readonly<
  Record<PaymentReconciliationLinesStatus, string>
> = {
  MATCHED: 'Pointé',
  UNMATCHED: 'Écriture du relevé sans pièce interne',
  DISPUTED: 'Écart en litige',
}

export const ACCOUNTING_SECTION_LABELS: Readonly<
  Record<AccountingExportReport['lines'][number]['section'], string>
> = {
  REVENUE_INVOICE: 'Vente (facture émise)',
  REVENUE_CREDIT_NOTE: 'Avoir émis',
  COLLECTION_PAYMENT: 'Encaissement',
  COLLECTION_REVERSAL: 'Contre-écriture',
  COLLECTION_REFUND: 'Remboursement',
  EXPENSE: 'Dépense de caisse',
  OTHER_CASH_MOVEMENT: 'Autre mouvement de caisse',
  RECONCILIATION: 'Rapprochement de canal',
}

export interface ReconciliationDraftLine {
  readonly lineId: string
  readonly paymentId: string | null
  readonly refundId: string | null
  readonly externalReference: string
  readonly statementAmount: number
  readonly expectedItemAmount: number | null
  readonly status: PaymentReconciliationLinesStatus
  readonly note: string
  readonly label: string
}

function timezoneLocalComponentsAsUtcMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(new Date(epochMs))
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  )
}

export function civilMidnightToUtcIso(day: CivilDate, timeZone: string): string {
  const targetAsUtc = Date.UTC(day.year, day.month - 1, day.day, 0, 0, 0)
  const firstOffset = timezoneLocalComponentsAsUtcMs(targetAsUtc, timeZone) - targetAsUtc
  let exact = targetAsUtc - firstOffset
  const secondOffset = timezoneLocalComponentsAsUtcMs(exact, timeZone) - exact
  if (secondOffset !== firstOffset) {
    exact = targetAsUtc - secondOffset
  }
  return new Date(exact).toISOString()
}

export function civilRangeToUtcWindow(
  from: CivilDate,
  to: CivilDate,
  timeZone: string,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: civilMidnightToUtcIso(from, timeZone),
    endsAt: civilMidnightToUtcIso(to.addDays(1), timeZone),
  }
}

export function draftLinesFromSaved(
  lines: readonly PaymentReconciliationLine[],
): ReconciliationDraftLine[] {
  return lines.map((line) => ({
    lineId: line.id,
    paymentId: line.payment_id,
    refundId: line.refund_id,
    externalReference: line.external_reference ?? '',
    statementAmount: line.statement_amount,
    expectedItemAmount: line.expected_item_amount,
    status: line.status,
    note: line.note ?? '',
    label:
      line.piece_number !== null
        ? `${line.kind === 'REFUND' ? 'Remboursement' : 'Reçu'} ${line.piece_number}`
        : 'Écriture du relevé',
  }))
}

export function draftLineFromCandidate(
  candidate: PaymentReconciliationCandidate,
  status: PaymentReconciliationLinesStatus = 'MATCHED',
): ReconciliationDraftLine {
  const piece = candidate.piece_number ?? candidate.invoice_number ?? 'Pièce'
  const prefix = candidate.kind === 'REFUND' ? 'Remboursement' : 'Reçu'
  const who = candidate.patient_name ? ` · ${candidate.patient_name}` : ''
  return {
    lineId: newUlid(),
    paymentId: candidate.payment_id,
    refundId: candidate.refund_id,
    externalReference: candidate.reference ?? '',
    statementAmount: candidate.amount,
    expectedItemAmount: candidate.amount,
    status,
    note: '',
    label: `${prefix} ${piece}${who}`,
  }
}

export function candidateKey(candidate: {
  payment_id: string | null
  refund_id: string | null
}): string {
  if (candidate.payment_id !== null) return `P:${candidate.payment_id}`
  if (candidate.refund_id !== null) return `R:${candidate.refund_id}`
  return 'NONE'
}

export function manualDraftLine(input: {
  externalReference: string
  statementAmount: number
  status: 'UNMATCHED' | 'DISPUTED'
  note: string
}): ReconciliationDraftLine {
  return {
    lineId: newUlid(),
    paymentId: null,
    refundId: null,
    externalReference: input.externalReference.trim(),
    statementAmount: input.statementAmount,
    expectedItemAmount: null,
    status: input.status,
    note: input.note.trim(),
    label: input.status === 'DISPUTED' ? 'Litige relevé' : 'Écriture sans pièce interne',
  }
}

export function linesTotalAmount(lines: readonly { statementAmount: number }[]): number {
  return lines.reduce((sum, line) => sum + line.statementAmount, 0)
}

export function computeVariance(
  expectedAmount: number,
  statementAmount: number | null,
): number | null {
  return statementAmount === null ? null : statementAmount - expectedAmount
}

export function validationProblem(input: {
  statementAmount: number | null
  expectedAmount: number
  varianceReason: string
}): string | null {
  if (input.statementAmount === null) {
    return 'Saisissez le montant net du relevé avant de valider.'
  }
  if (input.statementAmount !== input.expectedAmount && input.varianceReason.trim().length < 3) {
    return 'Un écart non nul exige un motif explicite (3 caractères au moins).'
  }
  return null
}

export function serializeLinesForRequest(lines: readonly ReconciliationDraftLine[]) {
  return lines.map((line) => ({
    line_id: line.lineId,
    payment_id: line.paymentId,
    refund_id: line.refundId,
    external_reference: line.externalReference.trim() === '' ? null : line.externalReference.trim(),
    statement_amount: line.statementAmount,
    status: line.status,
    note: line.note.trim() === '' ? null : line.note.trim(),
  }))
}

export function isEditableReconciliation(reconciliation: PaymentReconciliation | null): boolean {
  return reconciliation === null || reconciliation.status === 'DRAFT'
}

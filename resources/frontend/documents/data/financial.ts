import type {
  CreditNoteSnapshot,
  Invoice,
  InvoiceClinicSnapshot,
  InvoicePatientSnapshot,
  InvoiceTaxSnapshot,
  PaymentsMethod,
  ReceiptSnapshot,
  RefundSnapshot,
  RefundsMethod,
} from '@/domain/contracts/generated'

import { invalid } from '../engine/errors'
import type { DocumentLogo } from '../engine/model'
import { clinicFromSnapshot, type DocumentClinic } from './clinic'

/**
 * Données d'entrée des pièces financières (D01), alignées sur les snapshots figés du serveur
 * (`contracts/snapshots/*.json`, types `ReceiptSnapshot`, `CreditNoteSnapshot`, `RefundSnapshot`,
 * `Invoice*Snapshot`) et sur la ressource `Invoice`. Les noms sont en camelCase ; les adaptateurs
 * ci-dessous (`...FromSnapshot`) sont les seuls à connaître la forme du serveur. Un modèle de
 * document ne lit QUE ces types : il n'accède ni au réseau, ni à la base, ni à la configuration
 * courante. Les montants sont des entiers FCFA, les quantités et taux des chaînes décimales exactes.
 *
 * La ressource `Invoice` porte les snapshots figés de l'émission (`clinic_snapshot`, `patient_snapshot`,
 * `tax_snapshot`, null pour un brouillon) : `invoiceFromResource` les utilise ; pour un brouillon,
 * l'appelant fournit cabinet, patient et régime fiscal courants.
 */
export interface PatientIdentity {
  patientId: string
  recordNumber: string
  lastName: string
  firstNames: string | null
}

export interface TaxRuleData {
  code: string
  label: string
  ratePercent: string | null
  validatedAt: string | null
  legalNote: string | null
}

export interface InvoiceTaxData {
  regime: 'NO_TAX_CONFIGURED' | 'VALIDATED_RULES'
  rules: readonly TaxRuleData[]
}

export interface InvoiceLineData {
  position: number
  reference: string | null
  description: string
  unitCode: string
  /** Quantité décimale canonique (« 1.000 »). */
  quantity: string
  unitPriceGross: number
  discountGross: number
  lineTotalGross: number
  taxCode: string
  taxRatePercent: string | null
  taxAmount: number | null
}

/** Situation connue à l'émission, avec les reçus qui la justifient ; jamais un « payé » sans pièce. */
export interface PaymentAtIssueData {
  paidNet: number
  balance: number
  asOf: string
  receiptNumbers: readonly string[]
}

export interface InvoiceDocumentData {
  templateVersion: string
  invoiceId: string
  /** Null : brouillon (aucun numéro définitif, filigrane BROUILLON). */
  number: string | null
  status: 'DRAFT' | 'ISSUED'
  issuedAt: string | null
  dueDate: string | null
  clinic: DocumentClinic
  patient: PatientIdentity
  tax: InvoiceTaxData
  lines: readonly InvoiceLineData[]
  totalGross: number
  issuedByName: string | null
  paymentAtIssue: PaymentAtIssueData | null
}

/**
 * Destinataire d'un devis (L1D07) : un patient (identité de son dossier) OU un prospect sans dossier (nom et
 * téléphone), figé dans la révision imprimée.
 */
export type QuoteRecipientData =
  | { kind: 'PATIENT'; patient: PatientIdentity }
  | { kind: 'PROSPECT'; name: string; phone: string | null }

export interface QuoteDocumentData {
  templateVersion: string
  quoteId: string
  number: string | null
  /** Révision imprimée (1 à l'émission, puis une par correction) ; null pour un brouillon. */
  revisionNo: number | null
  /** Instant de la première émission (null : brouillon). */
  issuedAt: string | null
  /** Instant de la révision imprimée, quand elle n'est pas la première (null sinon). */
  revisedAt: string | null
  /** Motif d'une révision au-delà de la première (null sinon). */
  revisionReason: string | null
  validUntil: string | null
  clinic: DocumentClinic
  recipient: QuoteRecipientData
  tax: InvoiceTaxData
  lines: readonly InvoiceLineData[]
  totalGross: number
  createdByName: string | null
}

export interface ReceiptDocumentData {
  templateVersion: string
  receiptId: string
  receiptNumber: string
  issuedAt: string
  effectiveAt: string
  invoice: { number: string; issuedAt: string; totalGross: number }
  patient: PatientIdentity
  payment: { amount: number; method: PaymentsMethod; reference: string | null }
  paidNetBefore: number
  paidNetAfter: number
  balanceAfter: number
  /** Nature calculée par le serveur : jamais saisie. */
  kind: 'DEPOSIT' | 'BALANCE_SETTLEMENT'
  cashierName: string
  clinic: DocumentClinic
}

export interface CreditNoteLineData {
  description: string
  quantity: string | null
  amountGross: number
  taxAmount: number | null
}

export interface CreditNoteDocumentData {
  templateVersion: string
  creditNoteId: string
  number: string
  issuedAt: string
  invoice: { number: string; issuedAt: string; totalGross: number }
  patient: PatientIdentity
  lines: readonly CreditNoteLineData[]
  amountGross: number
  reason: string
  issuedByName: string
  /** Identifiant de l'autorisation de la gérante : seule une référence courte est imprimée. */
  approvalId: string
  tax: InvoiceTaxData
  clinic: DocumentClinic
}

export interface RefundDocumentData {
  templateVersion: string
  refundId: string
  number: string
  effectiveAt: string
  creditNoteNumber: string
  invoice: { number: string; issuedAt: string; totalGross: number }
  beneficiary: PatientIdentity
  amount: number
  method: RefundsMethod
  reference: string | null
  createdByName: string
  clinic: DocumentClinic
}

export interface StatementInvoiceRow {
  number: string
  issuedAt: string
  /** Créance d'ouverture reprise d'un carnet papier : présentée à part, jamais comme une vente du jour. */
  origin: 'NATIVE' | 'LEGACY_BALANCE'
  totalGross: number
  credited: number
  paidNet: number
  refunded: number
  /** Solde comptable signé : positif = reste à payer, négatif = crédit à rembourser. */
  balance: number
}

export interface StatementPaymentRow {
  receiptNumber: string
  effectiveAt: string
  method: PaymentsMethod
  amount: number
  invoiceNumber: string
}

export interface StatementCreditRow {
  number: string
  issuedAt: string
  invoiceNumber: string
  amountGross: number
}

export interface StatementRefundRow {
  number: string
  effectiveAt: string
  method: RefundsMethod
  amount: number
  invoiceNumber: string
}

export interface AccountStatementData {
  templateVersion: string
  statementId: string
  /** Instant du calcul : l'état de compte est daté, il n'est pas une pièce permanente. */
  asOf: string
  clinic: DocumentClinic
  patient: PatientIdentity
  invoices: readonly StatementInvoiceRow[]
  payments: readonly StatementPaymentRow[]
  creditNotes: readonly StatementCreditRow[]
  refunds: readonly StatementRefundRow[]
  preparedByName: string
}

export interface CashMovementRow {
  at: string
  label: string
  /** Positif : entrée de caisse ; négatif : sortie. */
  amount: number
}

export interface CashMethodTotal {
  method: PaymentsMethod
  count: number
  amount: number
}

export interface CashSessionJournalRow {
  at: string
  entryType: 'PAYMENT' | 'CASH_MOVEMENT' | 'PAYMENT_REVERSAL' | 'REFUND'
  label: string
  detail: string | null
  method: PaymentsMethod
  amount: number
}

export interface CashSessionReportData {
  templateVersion: string
  sessionId: string
  cashierName: string
  openedAt: string
  /** Null : session non clôturée, relevé provisoire. */
  closedAt: string | null
  openingAmount: number
  cashReceived: number
  cashRefunded: number
  cashIn: number
  cashOut: number
  expectedAmount: number
  countedAmount: number | null
  variance: number | null
  varianceReason: string | null
  /** Modes sans tiroir (mobile money, virement, chèque) : rapprochés à part, pas dans le tiroir espèces. */
  otherMethods: readonly CashMethodTotal[]
  movements: readonly CashMovementRow[]
  receipts: readonly StatementPaymentRow[]
  journal?: readonly CashSessionJournalRow[]
  clinic: DocumentClinic
}

// --- Adaptateurs depuis les contrats du serveur ----------------------------------------------------

interface SnapshotPatient {
  patient_id: string
  record_number: string
  last_name: string
  first_names: string | null
}

export function patientFromSnapshot(snapshot: SnapshotPatient): PatientIdentity {
  return {
    patientId: snapshot.patient_id,
    recordNumber: snapshot.record_number,
    lastName: snapshot.last_name,
    firstNames: snapshot.first_names,
  }
}

export function taxFromSnapshot(snapshot: InvoiceTaxSnapshot): InvoiceTaxData {
  return {
    regime: snapshot.regime,
    rules: snapshot.rules.map((rule) => ({
      code: rule.code,
      label: rule.label,
      ratePercent: rule.rate_percent,
      validatedAt: rule.validated_at,
      legalNote: rule.legal_note,
    })),
  }
}

export function receiptFromSnapshot(
  snapshot: ReceiptSnapshot,
  logo: DocumentLogo | null = null,
): ReceiptDocumentData {
  return {
    templateVersion: snapshot.template_version,
    receiptId: snapshot.receipt_id,
    receiptNumber: snapshot.receipt_number,
    issuedAt: snapshot.issued_at,
    effectiveAt: snapshot.effective_at,
    invoice: {
      number: snapshot.invoice.number,
      issuedAt: snapshot.invoice.issued_at,
      totalGross: snapshot.invoice.total_gross,
    },
    patient: patientFromSnapshot(snapshot.patient),
    payment: {
      amount: snapshot.payment.amount,
      method: snapshot.payment.method,
      reference: snapshot.payment.reference,
    },
    paidNetBefore: snapshot.paid_net_before,
    paidNetAfter: snapshot.paid_net_after,
    balanceAfter: snapshot.balance_after,
    kind: snapshot.kind,
    cashierName: snapshot.cashier.display_name,
    clinic: clinicFromSnapshot(snapshot.clinic, logo),
  }
}

export function creditNoteFromSnapshot(
  snapshot: CreditNoteSnapshot,
  logo: DocumentLogo | null = null,
): CreditNoteDocumentData {
  return {
    templateVersion: snapshot.template_version,
    creditNoteId: snapshot.credit_note_id,
    number: snapshot.number,
    issuedAt: snapshot.issued_at,
    invoice: {
      number: snapshot.invoice.number,
      issuedAt: snapshot.invoice.issued_at,
      totalGross: snapshot.invoice.total_gross,
    },
    patient: patientFromSnapshot(snapshot.patient),
    lines: snapshot.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      amountGross: line.amount_gross,
      taxAmount: line.tax_amount,
    })),
    amountGross: snapshot.amount_gross,
    reason: snapshot.reason,
    issuedByName: snapshot.issued_by.display_name,
    approvalId: snapshot.approval_id,
    tax: taxFromSnapshot(snapshot.tax),
    clinic: clinicFromSnapshot(snapshot.clinic, logo),
  }
}

export function refundFromSnapshot(
  snapshot: RefundSnapshot,
  logo: DocumentLogo | null = null,
): RefundDocumentData {
  return {
    templateVersion: snapshot.template_version,
    refundId: snapshot.refund_id,
    number: snapshot.number,
    effectiveAt: snapshot.effective_at,
    creditNoteNumber: snapshot.credit_note.number,
    invoice: {
      number: snapshot.invoice.number,
      issuedAt: snapshot.invoice.issued_at,
      totalGross: snapshot.invoice.total_gross,
    },
    beneficiary: patientFromSnapshot(snapshot.beneficiary),
    amount: snapshot.amount,
    method: snapshot.method,
    reference: snapshot.reference,
    createdByName: snapshot.created_by.display_name,
    clinic: clinicFromSnapshot(snapshot.clinic, logo),
  }
}

/** Contenus figés à l'émission que porte la ressource `Invoice` (null pour un brouillon). */
interface FrozenSnapshots {
  patient_snapshot?: InvoicePatientSnapshot | null
  clinic_snapshot?: InvoiceClinicSnapshot | null
  tax_snapshot?: InvoiceTaxSnapshot | null
}

export interface InvoiceResourceInput {
  invoice: Invoice
  /**
   * Cabinet, patient et régime fiscal COURANTS, requis pour un BROUILLON (rien n'est encore figé).
   * Pour une facture émise, les snapshots figés de la ressource (`clinic_snapshot`, `patient_snapshot`,
   * `tax_snapshot`) l'emportent toujours : le document d'une facture émise n'est jamais produit de
   * l'identité ni des prix actuels (fichier 11).
   */
  clinic?: InvoiceClinicSnapshot | undefined
  patient?: InvoicePatientSnapshot | undefined
  tax?: InvoiceTaxSnapshot | undefined
  issuedByName: string | null
  templateVersion: string
  logo?: DocumentLogo | null | undefined
  paymentAtIssue?: PaymentAtIssueData | null | undefined
}

const NO_TAX: InvoiceTaxSnapshot = { regime: 'NO_TAX_CONFIGURED', rules: [] }

/**
 * Facture de la ressource serveur. Une facture abandonnée n'a pas de document ; une facture émise doit
 * porter son numéro, sa date d'émission et ses trois snapshots figés.
 */
export function invoiceFromResource(input: InvoiceResourceInput): InvoiceDocumentData {
  const { invoice } = input
  if (invoice.status === 'ABANDONED') {
    throw invalid('invoice.abandoned', 'status', 'Une facture abandonnée ne s’imprime pas.')
  }
  const issued = invoice.status === 'ISSUED'
  if (issued && (invoice.number === null || invoice.issued_at === null)) {
    throw invalid(
      'invoice.issued_without_number',
      'number',
      'Une facture émise doit porter un numéro et une date d’émission.',
    )
  }
  const frozen = invoice as Invoice & FrozenSnapshots
  const clinic = issued ? (frozen.clinic_snapshot ?? input.clinic) : input.clinic
  const patient = issued ? (frozen.patient_snapshot ?? input.patient) : input.patient
  const tax = issued ? (frozen.tax_snapshot ?? input.tax) : (input.tax ?? NO_TAX)
  if (clinic === undefined || clinic === null || patient === undefined || patient === null) {
    throw invalid(
      'invoice.snapshot_missing',
      'snapshots',
      'Le cabinet et le patient de la facture manquent : une facture émise porte ses snapshots figés.',
    )
  }
  if (tax === undefined || tax === null) {
    throw invalid(
      'invoice.snapshot_missing',
      'tax_snapshot',
      'Le régime fiscal figé de la facture manque.',
    )
  }
  return {
    templateVersion: input.templateVersion,
    invoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status,
    issuedAt: invoice.issued_at,
    dueDate: invoice.due_date,
    clinic: clinicFromSnapshot(clinic, input.logo ?? null),
    patient: patientFromSnapshot(patient),
    tax: taxFromSnapshot(tax),
    lines: invoice.lines.map((line) => ({
      position: line.position,
      reference: line.reference_snapshot,
      description: line.description_snapshot,
      unitCode: line.unit_snapshot,
      quantity: line.quantity,
      unitPriceGross: line.unit_price_gross,
      discountGross: line.discount_gross,
      lineTotalGross: line.line_total_gross,
      taxCode: line.tax_code_snapshot,
      taxRatePercent: line.tax_rate_snapshot,
      taxAmount: line.tax_amount,
    })),
    totalGross: invoice.total_gross,
    issuedByName: input.issuedByName,
    paymentAtIssue: input.paymentAtIssue ?? null,
  }
}

/**
 * Lignes de l'état de compte d'un patient à partir de ses factures (ressource `Invoice`). Seuls les
 * paiements CONFIRMÉS figurent comme encaissements ; un paiement en attente ou rejeté n'est jamais
 * présenté comme reçu. Les factures brouillon ou abandonnées sont ignorées.
 */
export function statementRowsFromInvoices(invoices: readonly Invoice[]): {
  invoices: StatementInvoiceRow[]
  payments: StatementPaymentRow[]
  creditNotes: StatementCreditRow[]
  refunds: StatementRefundRow[]
} {
  const issued = invoices.filter(
    (invoice) =>
      invoice.status === 'ISSUED' && invoice.number !== null && invoice.issued_at !== null,
  )
  return {
    invoices: issued.map((invoice) => ({
      number: invoice.number ?? '',
      issuedAt: invoice.issued_at ?? '',
      origin: invoice.origin,
      totalGross: invoice.total_gross,
      credited: invoice.balance.credited,
      paidNet: invoice.balance.paid_net,
      refunded: invoice.balance.refunded,
      balance: invoice.balance.balance_due,
    })),
    payments: issued.flatMap((invoice) =>
      invoice.payments
        .filter((payment) => payment.status === 'CONFIRMED' && payment.receipt_number !== null)
        .map((payment) => ({
          receiptNumber: payment.receipt_number ?? '',
          effectiveAt: payment.effective_at,
          method: payment.method,
          amount: payment.amount,
          invoiceNumber: invoice.number ?? '',
        })),
    ),
    creditNotes: issued.flatMap((invoice) =>
      invoice.credit_notes
        .filter(
          (note) => note.status === 'ISSUED' && note.number !== null && note.issued_at !== null,
        )
        .map((note) => ({
          number: note.number ?? '',
          issuedAt: note.issued_at ?? '',
          invoiceNumber: invoice.number ?? '',
          amountGross: note.amount_gross,
        })),
    ),
    refunds: issued.flatMap((invoice) =>
      invoice.refunds.map((refund) => ({
        number: refund.number,
        effectiveAt: refund.effective_at,
        method: refund.method,
        amount: refund.amount,
        invoiceNumber: invoice.number ?? '',
      })),
    ),
  }
}

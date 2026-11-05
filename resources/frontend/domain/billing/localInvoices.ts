import type {
  Invoice,
  InvoiceClinicSnapshot,
  InvoiceLine,
  InvoicePatientSnapshot,
  InvoiceTaxSnapshot,
  PaymentsMethod,
} from '../contracts/generated'
import { Quantity, Rate } from '../values/decimal'
import { computeLineAmounts, invoiceTotal, type LineAmounts } from './lineAmounts'
import { applicableTaxRule, type LocalCatalog, type LocalCatalogItem } from './localCatalog'
import type { LocalFactLike, LocalPaymentState } from './localPayments'
import { isPaymentMethod } from './payment'

/**
 * Factures créées sur CE poste préparé (G1 ; fichier 19, AT37), reconstruites par REJEU des faits financiers du journal
 * local, dans l'ordre : `CreateInvoiceDraft` pose le brouillon, chaque `UpdateDraft` remplace ses lignes (version du
 * brouillon +1), `IssueInvoice` l'émet avec le numéro de la plage du poste. Un fait ne change jamais : rejouer tous les
 * faits donne la même facture à chaque lecture, quel que soit le nombre de modifications du brouillon.
 *
 * La facture rendue a la forme de celle du serveur (`Invoice`), pour que les écrans de la facture et de ses PDF travaillent
 * sans réseau : lignes figées d'après le CATALOGUE FIGÉ du poste (référence, catégorie, unité, règle fiscale applicable),
 * montants des MÊMES règles pures que le serveur (`computeLineAmounts`), identité du patient, en-tête du cabinet et règles
 * fiscales figés à l'émission. Les encaissements du poste ne sont pas dans cette facture : ils s'y ajoutent comme pour une
 * facture du serveur (`localPayments`). Le serveur reste seul juge à la synchronisation : tant qu'il n'a pas répondu, ces
 * valeurs sont celles « de ce poste ». Seules les factures CRÉÉES sur ce poste se reconstruisent (une facture du serveur
 * attribuée au poste se lit sur le serveur). Règles pures : aucune lecture du coffre ici (service `localInvoices`).
 */
export interface LocalInvoiceContext {
  /** Catalogue figé du poste (null : non lisible ; les lignes gardent alors leur désignation et leurs prix, sans taxe). */
  catalog: LocalCatalog | null
  /** Identité figée à l'émission pour un patient de ce poste (null : patient inconnu du poste). */
  patient: (patientId: string) => InvoicePatientSnapshot | null
  /** En-tête du cabinet figé à l'émission (null : non connu ; la facture reste alors un brouillon lisible, non émise). */
  clinic: InvoiceClinicSnapshot | null
  /** Profil qui émet (celui de la session ouverte sur le poste). */
  issuer: { userId: string; displayName: string } | null
}

export interface LocalInvoice {
  invoice: Invoice
  /** État de la DERNIÈRE commande de brouillon ou d'émission de la facture (les encaissements ont les leurs). */
  state: LocalPaymentState
}

/** Catégorie et unité d'une ligne libre (comme `DraftLines::FREE_LINE_*` du serveur). */
const FREE_LINE_CATEGORY = 'OTHER'
const FREE_LINE_UNIT = 'UNIT'
const NO_TAX_CONFIGURED = 'NO_TAX_CONFIGURED'

/** Une proposition du poste qui n'est ni consolidée ni rejetée : elle prime sur le serveur (F10, AT42). */
export function isUnconsolidatedInvoice(state: LocalPaymentState): boolean {
  return state !== 'acknowledged' && state !== 'rejected'
}

/** Encaissement du poste que le serveur a déjà consolidé (ACK) : il fait partie de la facture, plus de son « en attente ». */
interface ConsolidatedPayment {
  id: string
  amount: number
  method: PaymentsMethod
  reference: string | null
  effectiveAt: string
  recordedAt: string
  receiptId: string | null
  receiptNumber: string | null
}

interface Working {
  patientId: string
  visitId: string | null
  dueDate: string | null
  draftVersion: number
  lines: unknown[]
  issued: { number: string | null; issuedAt: string } | null
  payments: ConsolidatedPayment[]
  state: LocalPaymentState
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function builtLine(
  raw: unknown,
  catalog: LocalCatalog | null,
): { line: InvoiceLine; amounts: LineAmounts } | null {
  const row = record(raw)
  if (row === null) return null
  const id = text(row['line_id'])
  const position = row['position']
  const description = text(row['description'])
  const quantity = text(row['quantity'])
  const unitPrice = row['unit_price_gross']
  const discount = row['discount_gross']
  if (
    id === null ||
    typeof position !== 'number' ||
    description === null ||
    quantity === null ||
    typeof unitPrice !== 'number' ||
    typeof discount !== 'number'
  ) {
    return null
  }
  const itemId = text(row['catalog_item_id'])
  const item: LocalCatalogItem | null =
    itemId === null || catalog === null
      ? null
      : (catalog.items.find((candidate) => candidate.id === itemId) ?? null)
  const rule = item === null || catalog === null ? null : applicableTaxRule(catalog, item)
  try {
    const decimal = Quantity.of(quantity)
    const amounts = computeLineAmounts(
      decimal,
      unitPrice,
      discount,
      rule === null || rule.rate_percent === null ? null : Rate.of(rule.rate_percent),
      item?.quantity_integer_only ?? true,
    )
    return {
      amounts,
      line: {
        id,
        position,
        catalog_item_id: itemId,
        reference_snapshot: item?.reference ?? null,
        description_snapshot: description,
        category_snapshot: item?.category_code ?? FREE_LINE_CATEGORY,
        unit_snapshot: item?.unit_code ?? FREE_LINE_UNIT,
        quantity: decimal.canonical(),
        unit_price_gross: unitPrice,
        discount_gross: discount,
        line_total_gross: amounts.net,
        tax_code_snapshot: rule?.code ?? NO_TAX_CONFIGURED,
        tax_rate_snapshot: rule?.rate_percent ?? null,
        tax_amount: amounts.taxAmount,
        prescription_id: text(row['prescription_id']),
      },
    }
  } catch {
    // Valeur que les règles partagées refusent : le serveur la refuserait aussi, la facture n'est pas reconstruite.
    return null
  }
}

function taxSnapshotOf(
  catalog: LocalCatalog | null,
  lines: readonly InvoiceLine[],
): InvoiceTaxSnapshot {
  const used = new Set(lines.map((line) => line.tax_code_snapshot))
  const rules = (catalog?.taxRules ?? [])
    .filter(
      (rule) => used.has(rule.code) && rule.rate_percent !== null && rule.validated_at !== null,
    )
    .map((rule) => ({
      tax_rule_id: rule.id,
      code: rule.code,
      label: rule.code,
      rate_percent: rule.rate_percent,
      validated_at: rule.validated_at,
      legal_note: null,
    }))
  return { regime: rules.length === 0 ? 'NO_TAX_CONFIGURED' : 'VALIDATED_RULES', rules }
}

/** Situation de règlement d'une facture du poste d'après ses seuls encaissements consolidés (même vocabulaire que le serveur). */
function settlementOf(
  issued: boolean,
  total: number,
  paid: number,
): Invoice['balance']['settlement'] {
  if (!issued) return 'NOT_ISSUED'
  const due = total - paid
  if (due < 0) return 'IN_CREDIT'
  if (due === 0) return 'SETTLED'
  return paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID'
}

function invoiceOf(
  id: string,
  working: Working,
  context: LocalInvoiceContext,
): LocalInvoice | null {
  const built = working.lines.map((raw) => builtLine(raw, context.catalog))
  if (built.some((entry) => entry === null)) return null
  const entries = built.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  entries.sort((left, right) => left.line.position - right.line.position)
  const lines = entries.map((entry) => entry.line)
  let total: number
  try {
    total = invoiceTotal(entries.map((entry) => entry.amounts))
  } catch {
    return null
  }

  const issued = working.issued
  const patient = issued === null ? null : context.patient(working.patientId)
  const clinic = issued === null ? null : context.clinic
  // Une émission dont l'identité du patient ou l'en-tête du cabinet ne sont pas connus du poste n'est pas présentée émise :
  // ses figés manqueraient (PDF, reçus). Le brouillon, lui, reste lisible.
  if (issued !== null && (patient === null || clinic === null || issued.number === null))
    return null

  const paid = working.payments.reduce((sum, payment) => sum + payment.amount, 0)

  const invoice: Invoice = {
    id,
    patient_id: working.patientId,
    visit_id: working.visitId,
    quote_id: null,
    number: issued?.number ?? null,
    status: issued === null ? 'DRAFT' : 'ISSUED',
    issued_at: issued?.issuedAt ?? null,
    issued_by: issued === null ? null : (context.issuer?.userId ?? null),
    issued_by_name: issued === null ? null : (context.issuer?.displayName ?? null),
    due_date: working.dueDate,
    currency: 'XAF',
    total_gross: total,
    origin: 'NATIVE',
    legacy_reference: null,
    draft_version: working.draftVersion,
    // 1 à l'émission puis +1 par encaissement consolidé (comme le compteur du journal et `ledger_version` du serveur).
    ledger_version: issued === null ? null : 1 + working.payments.length,
    balance: {
      total_gross: total,
      paid_net: paid,
      credited: 0,
      refunded: 0,
      balance_due: issued === null ? 0 : total - paid,
      credit_available: 0,
      settlement: settlementOf(issued !== null, total, paid),
    },
    lines,
    payments: working.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      effective_at: payment.effectiveAt,
      confirmed_at: payment.recordedAt,
      status: 'CONFIRMED',
      receipt_id: payment.receiptId,
      receipt_number: payment.receiptNumber,
      reversed_amount: 0,
      received_by: context.issuer?.userId ?? '',
      received_by_name: context.issuer?.displayName ?? null,
    })),
    reversals: [],
    credit_notes: [],
    refunds: [],
    write_owner: null,
    document: null,
    patient_snapshot: patient,
    clinic_snapshot: clinic,
    tax_snapshot: issued === null ? null : taxSnapshotOf(context.catalog, lines),
  }
  return { invoice, state: working.state }
}

/** Factures créées sur ce poste, par identifiant ; les faits sont donnés dans l'ordre du journal. */
export function foldLocalInvoices(
  records: readonly LocalFactLike[],
  context: LocalInvoiceContext,
): Map<string, LocalInvoice> {
  const drafts = new Map<string, Working>()
  for (const { fact, state } of records) {
    const payload = fact.payload
    const id = text(payload['invoice_id']) ?? fact.entityId
    if (fact.commandName === 'CreateInvoiceDraft') {
      const patientId = text(payload['patient_id'])
      if (patientId === null) continue
      drafts.set(id, {
        patientId,
        visitId: text(payload['visit_id']),
        dueDate: text(payload['due_date']),
        draftVersion: 1,
        lines: Array.isArray(payload['lines']) ? payload['lines'] : [],
        issued: null,
        payments: [],
        state,
      })
      continue
    }
    if (fact.commandName === 'RegisterPayment') {
      // Seuls les encaissements CONSOLIDÉS entrent dans la facture : ceux qui attendent encore leur ACK restent « du poste »
      // (`localPayments`, avec leur état), pour ne jamais être pris pour des pièces du serveur.
      const owner = drafts.get(id)
      const paymentId = text(payload['payment_id'])
      const amount = payload['amount']
      const method = text(payload['method'])
      if (
        owner === undefined ||
        owner.issued === null ||
        state !== 'acknowledged' ||
        paymentId === null ||
        typeof amount !== 'number' ||
        !isPaymentMethod(method)
      ) {
        continue
      }
      owner.payments.push({
        id: paymentId,
        amount,
        method,
        reference: text(payload['reference']),
        effectiveAt: text(payload['effective_at']) ?? fact.recordedAt,
        recordedAt: fact.recordedAt,
        receiptId: text(payload['receipt_id']),
        receiptNumber: fact.number,
      })
      continue
    }
    const current = drafts.get(id)
    // Facture du serveur (pas de création locale) ou déjà émise : rien à rejouer.
    if (current === undefined || current.issued !== null) continue
    if (fact.commandName === 'UpdateDraft') {
      current.visitId = text(payload['visit_id'])
      current.dueDate = text(payload['due_date'])
      current.lines = Array.isArray(payload['lines']) ? payload['lines'] : []
      current.draftVersion += 1
      current.state = state
    } else if (fact.commandName === 'IssueInvoice') {
      current.issued = {
        number: fact.number ?? text(payload['number']),
        issuedAt: text(payload['issued_at']) ?? fact.recordedAt,
      }
      current.state = state
    }
  }

  const invoices = new Map<string, LocalInvoice>()
  for (const [id, working] of drafts) {
    const invoice = invoiceOf(id, working, context)
    if (invoice !== null) invoices.set(id, invoice)
  }
  return invoices
}

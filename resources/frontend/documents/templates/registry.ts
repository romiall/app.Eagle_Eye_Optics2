import type { GeneratedDocumentsDocumentType } from '@/domain/contracts/generated'

import type {
  ClinicalRecordData,
  MedicationOrderData,
  OpticalPrescriptionData,
  ReferralLetterData,
} from '../data/clinical'
import type {
  AccountStatementData,
  CashSessionReportData,
  CreditNoteDocumentData,
  InvoiceDocumentData,
  QuoteDocumentData,
  ReceiptDocumentData,
  RefundDocumentData,
} from '../data/financial'
import type { WorkshopOrderDocumentData } from '../data/workshop'
import { invalid } from '../engine/errors'
import type { DocumentKind, DocumentModel } from '../engine/model'
import type { BuildOptions } from './common'
import { buildAccountStatement } from './credits/accountStatement'
import { buildCreditNote } from './credits/creditNote'
import { buildRefund } from './credits/refund'
import { buildClinicalRecord } from './clinical/clinicalRecord'
import { buildMedicationOrder } from './clinical/medicationOrder'
import { buildOpticalPrescription } from './clinical/opticalPrescription'
import { buildReferralLetter } from './clinical/referralLetter'
import { buildCashSessionReport } from './financial/cashSession'
import { buildInvoice } from './financial/invoice'
import { buildQuote } from './financial/quote'
import { buildReceipt } from './financial/receipt'
import { buildWorkshopOrder } from './workshop/workOrder'

/**
 * Registre des modèles versionnés (D01, D02 ; contrat 23 : « l'ancien template et ses fontes restent
 * disponibles pour toute source en attente »). Une pièce porte la version de modèle de son snapshot
 * (`template_version`) ; on la régénère TOUJOURS avec cette version, jamais avec la plus récente.
 * Une version inconnue est refusée : on n'imprime pas une pièce émise avec un autre modèle.
 *
 * `TEST-1` est la première version : toutes les mentions du cabinet sont des paramètres, et un
 * cabinet sans mentions validées obtient un document de TEST marqué. Quand les mentions réelles
 * seront validées, une nouvelle version s'AJOUTE (par exemple « 1 ») sans retirer `TEST-1`, et
 * `contracts/compatibility.json` la déclare.
 *
 * Le serveur écrit ses propres noms PROVISOIRES de version (`PendingDocuments::INVOICE_TEMPLATE` et
 * `RECEIPT_TEMPLATE` dans `generated_documents.template_version` et dans le snapshot du reçu) :
 * `invoice.v1`, `receipt.v1`, `credit_note.v1` et `refund.v1` sont enregistrés ici comme alias du même modèle. Convention retenue :
 * `<type>.v<n>` (voir `CLINICAL_TEMPLATE_VERSIONS`) ; une ligne de `SERVER_VERSIONS` suffit pour accepter
 * un autre nom (avoir, remboursement…) quand le serveur en écrira un.
 */
export const TEMPLATE_VERSION = 'TEST-1'

/** Noms de version déjà écrits par le serveur pour un type de document. */
const SERVER_VERSIONS = {
  INVOICE: 'invoice.v1',
  RECEIPT: 'receipt.v1',
  CREDIT_NOTE: 'credit_note.v1',
  REFUND: 'refund.v1',
  /** Révision de devis (L1D07) : `PendingDocuments::QUOTE_TEMPLATE` et `snapshot.template_version`. */
  QUOTE: 'quote.v1',
  /** Bon laboratoire atelier optique (L1D04) : `PendingDocuments::WORKSHOP_TEMPLATE`. */
  WORKSHOP: 'workshop.v1',
} as const

/**
 * Versions des documents CLINIQUES, même convention `<type>.v<n>` que les pièces financières (type =
 * `document_type` en minuscules : `credit_note.v1`, `cash_session_report.v1`…). La mention « document de
 * test » n'est pas dans le nom : elle vient du cabinet (`clinic.test_document`, faux seulement quand
 * `production_documents_enabled`), comme pour la facture et le reçu.
 *  - `optical_prescription.v1` : écrit par le serveur dans `generated_documents.template_version` à la
 *    validation (`ValidatePrescriptionHandler::TEMPLATE_VERSION`) ;
 *  - `clinical_record.v1` : fiche de consultation (type connu du serveur, aucune ligne écrite à ce jalon) ;
 *  - `medication_order.v1`, `referral_letter.v1` : documents PROPRES AU POSTE, sans `document_type`
 *    serveur (aucune ligne `generated_documents`).
 */
export const CLINICAL_TEMPLATE_VERSIONS = {
  OPTICAL_PRESCRIPTION: 'optical_prescription.v1',
  CLINICAL_RECORD: 'clinical_record.v1',
  MEDICATION_ORDER: 'medication_order.v1',
  REFERRAL_LETTER: 'referral_letter.v1',
} as const

export interface DocumentDataByKind {
  INVOICE: InvoiceDocumentData
  RECEIPT: ReceiptDocumentData
  CREDIT_NOTE: CreditNoteDocumentData
  REFUND: RefundDocumentData
  ACCOUNT_STATEMENT: AccountStatementData
  QUOTE: QuoteDocumentData
  OPTICAL_PRESCRIPTION: OpticalPrescriptionData
  CLINICAL_RECORD: ClinicalRecordData
  WORKSHOP: WorkshopOrderDocumentData
  MEDICATION_ORDER: MedicationOrderData
  REFERRAL_LETTER: ReferralLetterData
  CASH_SESSION_REPORT: CashSessionReportData
}

type Builder<K extends DocumentKind> = (
  data: DocumentDataByKind[K],
  options?: BuildOptions,
) => DocumentModel

const REGISTRY: { readonly [K in DocumentKind]: Readonly<Record<string, Builder<K>>> } = {
  INVOICE: { [TEMPLATE_VERSION]: buildInvoice, [SERVER_VERSIONS.INVOICE]: buildInvoice },
  RECEIPT: { [TEMPLATE_VERSION]: buildReceipt, [SERVER_VERSIONS.RECEIPT]: buildReceipt },
  CREDIT_NOTE: {
    [TEMPLATE_VERSION]: buildCreditNote,
    [SERVER_VERSIONS.CREDIT_NOTE]: buildCreditNote,
  },
  REFUND: { [TEMPLATE_VERSION]: buildRefund, [SERVER_VERSIONS.REFUND]: buildRefund },
  ACCOUNT_STATEMENT: { [TEMPLATE_VERSION]: buildAccountStatement },
  QUOTE: { [TEMPLATE_VERSION]: buildQuote, [SERVER_VERSIONS.QUOTE]: buildQuote },
  OPTICAL_PRESCRIPTION: {
    [TEMPLATE_VERSION]: buildOpticalPrescription,
    [CLINICAL_TEMPLATE_VERSIONS.OPTICAL_PRESCRIPTION]: buildOpticalPrescription,
  },
  CLINICAL_RECORD: {
    [TEMPLATE_VERSION]: buildClinicalRecord,
    [CLINICAL_TEMPLATE_VERSIONS.CLINICAL_RECORD]: buildClinicalRecord,
  },
  WORKSHOP: {
    [TEMPLATE_VERSION]: buildWorkshopOrder,
    [SERVER_VERSIONS.WORKSHOP]: buildWorkshopOrder,
  },
  MEDICATION_ORDER: {
    [TEMPLATE_VERSION]: buildMedicationOrder,
    [CLINICAL_TEMPLATE_VERSIONS.MEDICATION_ORDER]: buildMedicationOrder,
  },
  REFERRAL_LETTER: {
    [TEMPLATE_VERSION]: buildReferralLetter,
    [CLINICAL_TEMPLATE_VERSIONS.REFERRAL_LETTER]: buildReferralLetter,
  },
  CASH_SESSION_REPORT: { [TEMPLATE_VERSION]: buildCashSessionReport },
}

export const DOCUMENT_KINDS = Object.keys(REGISTRY) as DocumentKind[]

/** Versions de modèle disponibles pour un type de document. */
export function templateVersionsOf(kind: DocumentKind): string[] {
  return Object.keys(REGISTRY[kind])
}

export function hasTemplate(kind: DocumentKind, version: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY[kind], version)
}

/**
 * Modèle de document d'une pièce, construit avec la version de modèle de ses données. Fonction pure :
 * mêmes données, même modèle, même PDF.
 */
export function buildDocument<K extends DocumentKind>(
  kind: K,
  data: DocumentDataByKind[K],
  options?: BuildOptions,
): DocumentModel {
  const builders = REGISTRY[kind] as Readonly<Record<string, Builder<K>>>
  const version = data.templateVersion
  const builder = Object.prototype.hasOwnProperty.call(builders, version)
    ? builders[version]
    : undefined
  if (builder === undefined) {
    throw invalid(
      'template.unknown_version',
      'template_version',
      'Modèle de document introuvable : une pièce émise ne se régénère pas avec un autre modèle.',
    )
  }
  return builder(data, options)
}

const SERVER_TYPES: ReadonlySet<string> = new Set<GeneratedDocumentsDocumentType>([
  'INVOICE',
  'RECEIPT',
  'CREDIT_NOTE',
  'REFUND',
  'OPTICAL_PRESCRIPTION',
  'CLINICAL_RECORD',
  'ACCOUNT_STATEMENT',
  'QUOTE',
  'WORKSHOP',
])

/** Type enregistré côté serveur (`generated_documents.document_type`), ou null si le type reste local au poste. */
export function serverDocumentType(kind: DocumentKind): GeneratedDocumentsDocumentType | null {
  return SERVER_TYPES.has(kind) ? (kind as GeneratedDocumentsDocumentType) : null
}

/** Entrées à déclarer dans `contracts/compatibility.json` (`document_templates`) pour les types connus du serveur. */
export function templateCompatibility(): {
  document_type: GeneratedDocumentsDocumentType
  template_version: string
}[] {
  const entries: { document_type: GeneratedDocumentsDocumentType; template_version: string }[] = []
  for (const kind of DOCUMENT_KINDS) {
    const type = serverDocumentType(kind)
    if (type === null) continue
    for (const version of templateVersionsOf(kind)) {
      entries.push({ document_type: type, template_version: version })
    }
  }
  return entries
}

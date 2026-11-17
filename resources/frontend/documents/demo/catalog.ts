import { isClinicalDocument } from '../access'
import type { DocumentKind, DocumentModel } from '../engine/model'
import type { BuildOptions } from '../templates/common'
import { buildDocument, type DocumentDataByKind } from '../templates/registry'
import {
  demoAccountStatement,
  demoCashSession,
  demoClinicalRecord,
  demoCreditNote,
  demoDraftInvoice,
  demoInvoice,
  demoLongInvoice,
  demoMedicationOrder,
  demoPrescription,
  demoPrescriptionNoCorrection,
  demoQuote,
  demoReceiptDeposit,
  demoReceiptSettlement,
  demoReferralLetter,
  demoRefund,
  demoWorkshopOrder,
} from './fixtures'

/** Instant fixe des brouillons de démonstration : le rendu reste identique d'une exécution à l'autre. */
export const DEMO_NOW = '2026-10-22T09:00:00.000Z'

export interface DemoDocument {
  id: string
  label: string
  kind: DocumentKind
  /** Document clinique : l'aperçu exige le droit clinique. */
  clinical: boolean
  build: (options?: BuildOptions) => DocumentModel
}

function entry<K extends DocumentKind>(
  id: string,
  label: string,
  kind: K,
  data: () => DocumentDataByKind[K],
  fixed: BuildOptions = {},
): DemoDocument {
  return {
    id,
    label,
    kind,
    clinical: isClinicalDocument(kind),
    build: (options) => buildDocument(kind, data(), { now: DEMO_NOW, ...fixed, ...options }),
  }
}

/**
 * Jeu de documents de démonstration (données fictives) : sert à l'écran d'aperçu, aux tests de modèle
 * et au rendu « golden » (`tests/frontend/documents/golden/`). Couvre facture courte et longue,
 * brouillon, devis, reçus d'acompte et de solde (A4 et ticket), duplicata, avoir, remboursement, état
 * de compte, relevé de caisse, prescriptions (complète et avec absence de correction), ordonnance,
 * lettre d'orientation et dossier clinique.
 */
export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  entry('facture-courte', 'Facture courte (80 000 FCFA)', 'INVOICE', demoInvoice),
  entry('facture-longue', 'Facture longue (plusieurs pages)', 'INVOICE', () => demoLongInvoice()),
  entry('facture-brouillon', 'Facture brouillon', 'INVOICE', demoDraftInvoice),
  entry('devis', 'Devis (préparatoire)', 'QUOTE', demoQuote),
  entry('recu-acompte', 'Reçu d’acompte (30 000 FCFA)', 'RECEIPT', demoReceiptDeposit),
  entry('recu-solde', 'Reçu de règlement du solde (50 000 FCFA)', 'RECEIPT', demoReceiptSettlement),
  entry('recu-ticket', 'Reçu d’acompte, ticket 80 mm', 'RECEIPT', demoReceiptDeposit, {
    format: 'TICKET_80',
  }),
  entry('recu-duplicata', 'Reçu d’acompte, duplicata', 'RECEIPT', demoReceiptDeposit, {
    copy: { kind: 'DUPLICATA', reprintNumber: 1, reprintedAt: '2026-10-22T08:30:00.000Z' },
  }),
  entry('avoir', 'Avoir (10 000 FCFA)', 'CREDIT_NOTE', demoCreditNote),
  entry('remboursement', 'Reçu de remboursement (10 000 FCFA)', 'REFUND', demoRefund),
  entry('etat-de-compte', 'État de compte', 'ACCOUNT_STATEMENT', demoAccountStatement),
  entry('caisse-cloturee', 'Clôture de caisse', 'CASH_SESSION_REPORT', () => demoCashSession(true)),
  entry('caisse-provisoire', 'Relevé de caisse provisoire', 'CASH_SESSION_REPORT', () =>
    demoCashSession(false),
  ),
  entry('prescription', 'Prescription optique', 'OPTICAL_PRESCRIPTION', demoPrescription),
  entry(
    'prescription-sans-correction',
    'Prescription avec absence de correction (OG)',
    'OPTICAL_PRESCRIPTION',
    demoPrescriptionNoCorrection,
  ),
  entry('prescription-brouillon', 'Prescription brouillon', 'OPTICAL_PRESCRIPTION', () =>
    demoPrescription({ status: 'DRAFT', validatedAt: null }),
  ),
  entry('ordonnance', 'Ordonnance de médicaments', 'MEDICATION_ORDER', demoMedicationOrder),
  entry('lettre-orientation', 'Lettre d’orientation', 'REFERRAL_LETTER', demoReferralLetter),
  entry('dossier-clinique', 'Fiche de consultation', 'CLINICAL_RECORD', demoClinicalRecord),
  entry('bon-laboratoire', 'Bon laboratoire anonymisé', 'WORKSHOP', demoWorkshopOrder),
]

export function demoDocumentById(id: string): DemoDocument | undefined {
  return DEMO_DOCUMENTS.find((document) => document.id === id)
}

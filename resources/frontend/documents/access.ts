import type { DocumentKind } from './engine/model'

/**
 * Droits d'accès aux documents (D01, D02 ; fichiers 09 et 11). Un document clinique n'est généré, aperçu
 * ni imprimé que pour un profil qui a le droit clinique : un reçu ne donne jamais accès à une
 * prescription ni au dossier, et la caisse n'ouvre pas de document clinique. Chaque entrée liste les
 * permissions dont UNE suffit (codes du référentiel `permissions`). Le serveur et le coffre local
 * revérifient : ce tableau guide l'interface, il ne remplace pas leurs contrôles.
 */
export const DOCUMENT_PERMISSIONS: Readonly<Record<DocumentKind, readonly string[]>> = {
  INVOICE: ['invoice.read', 'invoice.create', 'invoice.issue'],
  QUOTE: ['invoice.read', 'invoice.create'],
  RECEIPT: ['payment.collect', 'invoice.read', 'cash.own_session'],
  CREDIT_NOTE: ['credit_note.issue', 'invoice.read'],
  REFUND: ['refund.execute', 'invoice.read'],
  ACCOUNT_STATEMENT: ['invoice.read', 'finance.global.read'],
  CASH_SESSION_REPORT: ['cash.own_session', 'cash.manage'],
  OPTICAL_PRESCRIPTION: ['clinical.read'],
  MEDICATION_ORDER: ['clinical.read'],
  REFERRAL_LETTER: ['clinical.read'],
  CLINICAL_RECORD: ['clinical.export'],
  WORKSHOP: ['workshop.manage'],
}

const CLINICAL_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'OPTICAL_PRESCRIPTION',
  'MEDICATION_ORDER',
  'REFERRAL_LETTER',
  'CLINICAL_RECORD',
])

export function isClinicalDocument(kind: DocumentKind): boolean {
  return CLINICAL_KINDS.has(kind)
}

/** Compartiment du coffre local qui chiffre la pièce (voir `vault.md`, D18). */
export function documentCompartment(kind: DocumentKind): 'FINANCIAL' | 'CLINICAL' {
  return isClinicalDocument(kind) ? 'CLINICAL' : 'FINANCIAL'
}

/** Vrai si l'une des permissions données ouvre ce type de document. */
export function mayOpenDocument(kind: DocumentKind, permissions: readonly string[]): boolean {
  return DOCUMENT_PERMISSIONS[kind].some((permission) => permissions.includes(permission))
}

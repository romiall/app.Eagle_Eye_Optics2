import type { DocumentKind, DocumentModel } from '../engine/model'

/**
 * Nom de fichier d'un PDF (D01) : le numéro de la pièce, ou le type et la date. JAMAIS un nom de
 * personne, un numéro de dossier patient ni un montant : ce nom apparaît dans la liste des
 * téléchargements du poste. L'adresse de l'aperçu (URL d'objet) est aléatoire et ne contient aucun nom.
 */
const PREFIXES: Readonly<Record<DocumentKind, string>> = {
  INVOICE: 'facture',
  RECEIPT: 'recu',
  CREDIT_NOTE: 'avoir',
  REFUND: 'remboursement',
  ACCOUNT_STATEMENT: 'etat-de-compte',
  QUOTE: 'devis',
  OPTICAL_PRESCRIPTION: 'prescription-optique',
  CLINICAL_RECORD: 'dossier-clinique',
  MEDICATION_ORDER: 'ordonnance',
  REFERRAL_LETTER: 'lettre-orientation',
  CASH_SESSION_REPORT: 'releve-de-caisse',
  WORKSHOP: 'bon-laboratoire',
}

const NAME_LIMIT = 80

function clean(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

export function documentFileName(model: DocumentModel): string {
  const prefix = PREFIXES[model.kind]
  const day = model.meta.documentAt.slice(0, 10).replace(/-/g, '')
  const base =
    model.meta.documentNumber === null
      ? `${prefix}-${day}`
      : `${prefix}-${clean(model.meta.documentNumber)}`
  const draft = model.meta.draft ? '-brouillon' : ''
  const copy = model.meta.copy.kind === 'DUPLICATA' ? '-duplicata' : ''
  return `${clean(base).slice(0, NAME_LIMIT)}${draft}${copy}.pdf`
}

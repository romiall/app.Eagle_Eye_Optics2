import type { StockMovementsKind } from '@/domain/contracts/generated'

/**
 * Historique des mouvements de stock d'un article (cahier des charges §6, EE026). Un mouvement est un fait physique
 * append-only : jamais modifié, jamais supprimé ; une erreur se corrige par un mouvement contraire, motivé.
 */
export const MOVEMENT_KIND_LABELS: Record<StockMovementsKind, string> = {
  OPENING: 'Stock d’ouverture',
  RECEIPT: 'Réception fournisseur',
  SALE_DELIVERY: 'Remise au patient',
  PATIENT_RETURN: 'Retour du patient',
  BREAKAGE: 'Casse ou perte',
  SUPPLIER_RETURN: 'Retour au fournisseur',
  ADJUSTMENT: 'Ajustement d’inventaire',
}

/** Types proposés au filtre, dans l'ordre de la vie d'un article. */
export const MOVEMENT_KIND_ORDER: readonly StockMovementsKind[] = [
  'OPENING',
  'RECEIPT',
  'SALE_DELIVERY',
  'PATIENT_RETURN',
  'BREAKAGE',
  'SUPPLIER_RETURN',
  'ADJUSTMENT',
]

/** Une sortie du stock porte une quantité négative : le serveur rend toujours la quantité signée. */
export function isOutgoing(signedQuantity: string): boolean {
  return signedQuantity.startsWith('-')
}

/** Valeur absolue d'une quantité signée en chaîne exacte (jamais de flottant). */
export function absoluteQuantity(signedQuantity: string): string {
  return isOutgoing(signedQuantity) ? signedQuantity.slice(1) : signedQuantity
}

/** Signe affiché devant la quantité : « + » à l'entrée, « − » (vrai moins) à la sortie. */
export function movementSign(signedQuantity: string): string {
  return isOutgoing(signedQuantity) ? '−' : '+'
}

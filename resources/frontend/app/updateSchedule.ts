/**
 * Quand chercher une nouvelle version de l'application (O06). Règles pures : ni réseau, ni horloge, ni service worker ;
 * le service `appUpdate` les applique à la recherche du navigateur (`Workbox.update()`).
 *
 * Un navigateur ne cherche une nouvelle version qu'à l'ouverture d'une page (et, pour un service worker déjà actif, au
 * plus toutes les 24 heures) : un onglet resté ouvert toute la journée, ou un poste qui ne ferme jamais le navigateur,
 * continuerait d'afficher l'ancienne version sans que rien ne la signale. La recherche se fait donc aussi quand la
 * personne REVIENT sur l'application (onglet qui redevient visible, fenêtre qui reprend le focus, réseau qui revient),
 * à intervalle régulier tant que la page est affichée, et sur demande. Un plancher évite d'interroger le serveur à chaque
 * changement de fenêtre.
 */

/** Recherche périodique tant que la page est affichée (propositions, à confirmer avec le cabinet). */
export const UPDATE_CHECK_PERIOD_MS = 15 * 60 * 1000

/** Deux recherches automatiques ne se suivent jamais de plus près (la demande de la personne passe toujours). */
export const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000

/** Ce qui déclenche une recherche : retour sur l'application, réseau revenu, minuteur, bouton. */
export type UpdateCheckTrigger = 'return' | 'online' | 'periodic' | 'manual'

export interface UpdateCheckContext {
  trigger: UpdateCheckTrigger
  /** Instant courant (millisecondes). */
  now: number
  /** Instant de la dernière recherche faite (millisecondes), null si aucune. */
  lastCheckAt: number | null
  /** La page est affichée (onglet visible). */
  visible: boolean
  /** Le navigateur se dit en ligne. */
  online: boolean
  /** Une recherche est déjà en cours. */
  searching: boolean
}

/**
 * Faut-il chercher maintenant ? Jamais pendant une recherche ni hors ligne ; la demande de la personne passe sinon
 * toujours ; une recherche automatique attend que la page soit affichée et que le plancher soit passé.
 */
export function shouldCheckForUpdate(context: UpdateCheckContext): boolean {
  if (context.searching || !context.online) return false
  if (context.trigger === 'manual') return true
  if (!context.visible) return false
  return (
    context.lastCheckAt === null || context.now - context.lastCheckAt >= UPDATE_CHECK_MIN_GAP_MS
  )
}

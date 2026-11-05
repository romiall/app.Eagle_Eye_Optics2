import { isSyncRefused } from '@/offline/api'

/**
 * Message d'un échange manqué de « Synchroniser maintenant » (O05, O07). Serveur injoignable : rien n'est perdu, les
 * pièces repartent au prochain essai. Refus EXPLICITE du serveur (poste remplacé ou déclaré perdu, autorisation
 * expirée ou retirée) : un nouvel essai n'y changera rien, l'écran dit pourquoi et ce qu'il faut faire.
 */
export function syncFailureMessage(error: unknown): string {
  if (!isSyncRefused(error))
    return 'Échange impossible pour le moment : les pièces restent enregistrées sur ce poste et repartiront au prochain essai.'
  if (error.code === 'GRANT_EXPIRED_OR_REVOKED')
    return 'L’autorisation de ce profil sur ce poste a expiré ou a été retirée : préparez de nouveau le profil en ligne (étape 3). Les pièces restent enregistrées sur ce poste.'
  return `Le serveur refuse l’échange : ${error.message} Les pièces restent enregistrées sur ce poste ; voyez avec la gérante avant tout nouvel enregistrement ici.`
}

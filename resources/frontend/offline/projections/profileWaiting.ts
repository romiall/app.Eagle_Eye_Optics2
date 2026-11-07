/**
 * Pièces d'un journal commun qui attendent l'ouverture d'un autre profil (P04), lues par l'application : la logique est
 * dans `offline/profile-switch/waiting.ts` (aucun accès au coffre, aucun contenu), exposée ici comme les autres projections
 * du moteur local, seul chemin d'import des services d'application.
 */
export {
  waitingSentences,
  waitingTotal,
  type WaitingByCompartment,
} from '../profile-switch/waiting'

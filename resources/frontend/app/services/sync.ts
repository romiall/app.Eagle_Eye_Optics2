import { inject, type InjectionKey, type Ref } from 'vue'

import type { WaitingByCompartment } from '@/offline/projections/profileWaiting'

export {
  waitingSentences,
  waitingTotal,
  type WaitingByCompartment,
} from '@/offline/projections/profileWaiting'
export {
  DOCUMENT_STATE_LABELS,
  type DocumentState,
  type LocalSyncState,
  SYNC_STATE_LABELS,
} from '@/offline/projections/syncStates'

/**
 * État de synchronisation du poste, distinct de l'état du réseau (F10) : ce que le journal du poste
 * (O04) contient encore à envoyer, les conflits à revoir, les PDF à régénérer et le dernier échange
 * réussi avec le serveur. Fourni par le poste préparé ; absent tant qu'aucun poste n'est préparé
 * (aucun état n'est alors annoncé : il n'y a rien de local à synchroniser).
 */
export interface DeviceSyncSummary {
  /** Commits locaux pas encore envoyés. */
  local: number
  /** Envoyés, sans ACK final. */
  pending: number
  /** Attendent une pièce liée. */
  waitingDependency: number
  /** Conflits à résoudre par décision explicite. */
  conflicts: number
  /**
   * Commandes d'autres profils du même poste, chiffrées dans leur compartiment : elles ne partent
   * qu'à l'ouverture de leur profil (contrat 23 : journal commun, compartiments par droits).
   */
  otherProfiles: number
  /**
   * Les mêmes commandes, par compartiment (P04) : l'écran dit QUEL profil doit s'ouvrir pour les envoyer. Absent : l'état
   * générique « d'autres profils » est annoncé.
   */
  otherCompartments?: WaitingByCompartment
  /** PDF locaux à régénérer (échec de génération ou d'impression). */
  documentsFailed: number
  /** PDF prêts sur le poste mais pas encore déposés sur le serveur (statut central en attente). */
  documentsToUpload: number
  /** Instant serveur du dernier échange réussi (push ou pull), ou null. */
  lastExchangeAt: string | null
  /** Le dernier essai d'échange a échoué (serveur muet ou en erreur). */
  lastAttemptFailed: boolean
}

export interface SyncStateSource {
  summary: Readonly<Ref<DeviceSyncSummary | null>>
  /** Lance un échange maintenant (bouton « Synchroniser »), si le poste le permet. */
  syncNow?: () => Promise<void>
}

export const SYNC_STATE_KEY: InjectionKey<SyncStateSource> = Symbol('eeo-sync-state')

export function useSyncStateSource(): SyncStateSource | null {
  return inject(SYNC_STATE_KEY, null)
}

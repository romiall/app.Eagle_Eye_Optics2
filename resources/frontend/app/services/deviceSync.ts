import { shallowRef, watch } from 'vue'

import type { LocalSyncIssue } from '@/offline/api'

import type { DeviceSyncSummary, SyncStateSource } from './sync'
import { deviceSyncOrNull, vaultView } from './vault'

export type { LocalSyncIssue } from '@/offline/api'

/**
 * État de synchronisation du poste préparé (O05, F10), fourni à l'application sous `SYNC_STATE_KEY` : compteurs du
 * journal (à envoyer, en attente d'ACK, en attente d'une pièce, en conflit, d'autres profils), dernier échange réussi,
 * échec du dernier essai, et commandes à revoir. Null tant que le module `offline` est fermé ou qu'aucun coffre de poste
 * enrôlé n'est ouvert : rien n'est alors annoncé.
 *
 * Échanges : bouton « Synchroniser », retour du réseau, intervalle régulier et peu après chaque enregistrement sur ce
 * poste. Un échec ne perd rien : les commandes restent dans le journal et repartent telles quelles.
 *
 * Les PDF locaux restent comptés à zéro ici : leur dépôt après l'ACK de la pièce source relève de D01.
 */
const summary = shallowRef<DeviceSyncSummary | null>(null)
const issues = shallowRef<LocalSyncIssue[]>([])

export const deviceSyncIssues = issues

export async function refreshDeviceSync(): Promise<void> {
  const current = deviceSyncOrNull()
  if (current === null) {
    summary.value = null
    issues.value = []
    return
  }
  try {
    const data = await current.summary()
    summary.value = {
      local: data.local,
      pending: data.pending,
      waitingDependency: data.waitingDependency,
      conflicts: data.conflicts,
      otherProfiles: data.otherProfiles,
      otherCompartments: data.otherCompartments,
      documentsFailed: 0,
      documentsToUpload: 0,
      lastExchangeAt: data.lastExchangeAt,
      lastAttemptFailed: data.lastAttemptFailed,
    }
    issues.value = await current.issues()
  } catch {
    // Coffre verrouillé entre-temps : plus rien à annoncer pour ce profil.
    summary.value = null
    issues.value = []
  }
}

/** Un échange maintenant (push puis pull) ; l'état est relu ensuite, même en cas d'échec (qui est relevé). */
export async function syncDeviceNow(): Promise<void> {
  const current = deviceSyncOrNull()
  if (current === null) return
  try {
    await current.syncNow()
  } finally {
    await refreshDeviceSync()
  }
}

async function quietSync(): Promise<void> {
  if (deviceSyncOrNull() === null) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await refreshDeviceSync()
    return
  }
  try {
    await syncDeviceNow()
  } catch {
    // L'échec est annoncé par l'état (« Dernier essai d'échange sans réponse du serveur »).
  }
}

let scheduled: ReturnType<typeof setTimeout> | null = null

/** Échange peu après un enregistrement sur ce poste (regroupe des enregistrements rapprochés). */
export function scheduleDeviceSync(delayMs = 1500): void {
  void refreshDeviceSync()
  if (scheduled !== null) clearTimeout(scheduled)
  scheduled = setTimeout(() => {
    scheduled = null
    void quietSync()
  }, delayMs)
}

/** Déclencheurs automatiques (application du navigateur) ; rend la fonction qui les retire. */
export function installDeviceSync(intervalMs = 60_000): () => void {
  const onOnline = (): void => {
    void quietSync()
  }
  window.addEventListener('online', onOnline)
  const timer = setInterval(() => {
    void quietSync()
  }, intervalMs)
  const stopWatch = watch(
    () => [vaultView.value.session?.profileId ?? null, vaultView.value.deviceId] as const,
    () => {
      void quietSync()
    },
    { immediate: true },
  )
  return () => {
    window.removeEventListener('online', onOnline)
    clearInterval(timer)
    stopWatch()
  }
}

export const deviceSyncState: SyncStateSource = {
  summary,
  syncNow: syncDeviceNow,
}

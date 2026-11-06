import { readonly, shallowRef } from 'vue'
import type { Workbox } from 'workbox-window'

import {
  shouldCheckForUpdate,
  UPDATE_CHECK_PERIOD_MS,
  type UpdateCheckTrigger,
} from '../updateSchedule'
import { type UpdateReadiness, updateReadinessForThisDevice } from './vault'

/**
 * Mise à jour de l'application PROPOSÉE, jamais imposée (O06 ; fiche : « Proposer SW update sans remplacement
 * forcé » ; `pwa.config.ts` : `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`).
 *
 * Trois temps :
 *  1. RECHERCHE. Un navigateur ne cherche une nouvelle version qu'à l'ouverture d'une page : le service la demande
 *     aussi au retour sur l'application (onglet visible, fenêtre qui reprend le focus, réseau revenu), à intervalle
 *     régulier et sur demande (`updateSchedule.ts`). Sans cela, un onglet resté ouvert garde l'ancienne version sans
 *     que rien ne le dise (constaté le 2026-10-30).
 *  2. ANNONCE. Quand la nouvelle version est installée dans le navigateur (service worker en attente), la bannière
 *     (`UpdatePrompt`) l'annonce sur tous les écrans, sans jamais pouvoir être masquée tant qu'elle attend, avec le
 *     contrôle du poste (`updateReadinessForThisDevice` : pièces en attente et compatibilité de la release, profil
 *     verrouillé, export récent, stockage).
 *  3. INSTALLATION. Elle n'a lieu que sur demande de la personne, et seulement si rien ne la bloque ; elle active le
 *     nouveau service worker puis recharge la page. Rien n'est purgé : ni le coffre, ni le journal, ni les PDF ; la
 *     migration du schéma local est additive.
 *
 * Limite déclarée : un service worker en attente s'active aussi quand TOUS les onglets de l'application sont fermés
 * (comportement des navigateurs). C'est sans risque tant que la release garde les versions des pièces en attente
 * (`contracts/compatibility.json`, règle « jamais retirer une version tant qu'un poste en détient », éprouvée par
 * tests/frontend/offline/compatibility-guard.test.ts) ; la nouvelle version ouvre la base en avant sans rien supprimer.
 */
export interface AppUpdateState {
  /** Ce navigateur a un service worker enregistré : une nouvelle version peut y être cherchée et installée. */
  supported: boolean
  /** Une nouvelle version est installée dans le navigateur et attend l'accord de la personne. */
  available: boolean
  /** Contrôle du poste (pièces en attente, compatibilité, export, stockage) pour cette installation. */
  readiness: UpdateReadiness | null
  /** Le contrôle du poste est en cours. */
  checking: boolean
  /** L'installation est demandée : la page se recharge dès que la nouvelle version prend la main. */
  applying: boolean
  /** L'installation n'a pas abouti dans le délai : la personne est invitée à recharger la page. */
  installStalled: boolean
  /** Une autre fenêtre a installé la nouvelle version : cette page garde l'ancien code et doit être rechargée. */
  reloadNeeded: boolean
  /** Détails de la bannière dépliés (la bannière elle-même ne se masque jamais tant qu'une version attend). */
  expanded: boolean
  /** Une recherche de nouvelle version est en cours. */
  searching: boolean
  /** Le navigateur télécharge la nouvelle version (elle sera annoncée dès qu'elle est prête). */
  downloading: boolean
  /** Dernière recherche faite (millisecondes), null si aucune depuis l'ouverture de cette page. */
  lastCheckedAt: number | null
  /** La dernière recherche a échoué (serveur ou réseau). */
  searchFailed: boolean
}

/** Une installation qui n'a pas pris la main au bout de ce délai est déclarée « non aboutie » (ni rechargement, ni perte). */
export const INSTALL_STALL_MS = 20_000

/** Une page encore là ce délai après `reload()` n'a pas été rechargée : le rechargement a été refusé. */
export const RELOAD_REFUSED_MS = 5_000

/** Ce que le service demande au navigateur : ses événements et ses minuteurs, remplaçables dans les tests. */
export interface UpdateEnvironment {
  now(): number
  /** La page est affichée (onglet visible). */
  visible(): boolean
  /** Le navigateur se dit en ligne. */
  online(): boolean
  /** Écoute le retour sur l'application ; rend la fonction qui retire les écouteurs. */
  onReturn(listener: (trigger: 'return' | 'online') => void): () => void
  /** Minuteur périodique ; rend la fonction qui l'arrête. */
  every(milliseconds: number, task: () => void): () => void
  /** Délai unique ; rend la fonction qui l'annule. */
  later(milliseconds: number, task: () => void): () => void
  reload(): void
}

export function browserEnvironment(): UpdateEnvironment {
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === 'visible',
    online: () => navigator.onLine,
    onReturn(listener) {
      const onVisibility = (): void => {
        if (document.visibilityState === 'visible') listener('return')
      }
      const onFocus = (): void => listener('return')
      const onOnline = (): void => listener('online')
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onFocus)
      window.addEventListener('online', onOnline)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('online', onOnline)
      }
    },
    every(milliseconds, task) {
      const id = window.setInterval(task, milliseconds)
      return () => window.clearInterval(id)
    },
    later(milliseconds, task) {
      const id = window.setTimeout(task, milliseconds)
      return () => window.clearTimeout(id)
    },
    reload: () => window.location.reload(),
  }
}

function initialState(): AppUpdateState {
  return {
    supported: false,
    available: false,
    readiness: null,
    checking: false,
    applying: false,
    installStalled: false,
    reloadNeeded: false,
    expanded: false,
    searching: false,
    downloading: false,
    lastCheckedAt: null,
    searchFailed: false,
  }
}

const state = shallowRef<AppUpdateState>(initialState())
let workbox: Workbox | null = null
let environment: UpdateEnvironment = browserEnvironment()
let stopWatching: () => void = () => undefined
let cancelStall: () => void = () => undefined

export const appUpdateState = readonly(state)

function patch(changes: Partial<AppUpdateState>): void {
  state.value = { ...state.value, ...changes }
}

/**
 * Branche l'annonce et la recherche sur le service worker enregistré (aucun effet sans service worker : serveur de
 * développement, navigateur sans service worker). Rend la fonction qui débranche tout.
 */
export function watchServiceWorkerUpdates(
  instance: Workbox | null,
  env: UpdateEnvironment = browserEnvironment(),
): () => void {
  stopWatching()
  workbox = instance
  environment = env
  if (instance === null) {
    patch({ supported: false })
    return () => undefined
  }
  patch({ supported: true })

  const onInstalling = (): void => patch({ downloading: true })
  const onWaiting = (): void => {
    patch({ available: true, downloading: false, installStalled: false })
    void refreshUpdateReadiness()
  }
  const onRedundant = (): void => patch({ downloading: false })
  const onControlling = (): void => {
    cancelStall()
    if (state.value.applying) {
      environment.reload()
      // Si la page est encore là après ce délai, le rechargement a été refusé (le navigateur demande confirmation quand
      // une saisie n'est pas enregistrée) : la nouvelle version est active mais cette page garde l'ancien code.
      cancelStall = environment.later(RELOAD_REFUSED_MS, () =>
        patch({ applying: false, available: false, reloadNeeded: true }),
      )
      return
    }
    // Une autre fenêtre a installé la nouvelle version : cette page garde l'ancien code, dont les fichiers ne sont plus
    // précachés. Elle ne se recharge pas d'elle-même (une saisie en cours serait perdue) : la personne en est avertie.
    patch({ reloadNeeded: true, available: false, downloading: false })
  }
  instance.addEventListener('installing', onInstalling)
  instance.addEventListener('waiting', onWaiting)
  instance.addEventListener('redundant', onRedundant)
  instance.addEventListener('controlling', onControlling)
  const stopReturn = env.onReturn((trigger) => void checkForUpdate(trigger))
  const stopPeriodic = env.every(UPDATE_CHECK_PERIOD_MS, () => void checkForUpdate('periodic'))

  stopWatching = () => {
    instance.removeEventListener('installing', onInstalling)
    instance.removeEventListener('waiting', onWaiting)
    instance.removeEventListener('redundant', onRedundant)
    instance.removeEventListener('controlling', onControlling)
    stopReturn()
    stopPeriodic()
    cancelStall()
    stopWatching = () => undefined
  }
  return stopWatching
}

/**
 * Demande au navigateur de chercher une nouvelle version. Les recherches automatiques respectent le plancher et la
 * visibilité de la page (`updateSchedule.ts`) ; celle que la personne demande passe toujours, hors ligne exceptée.
 */
export async function checkForUpdate(trigger: UpdateCheckTrigger): Promise<void> {
  const instance = workbox
  if (instance === null) return
  const now = environment.now()
  if (trigger === 'manual' && !environment.online()) {
    // La personne a demandé une recherche sans réseau : elle doit le savoir, pas recevoir un silence.
    patch({ searchFailed: true, lastCheckedAt: now })
    return
  }
  const allowed = shouldCheckForUpdate({
    trigger,
    now,
    lastCheckAt: state.value.lastCheckedAt,
    visible: environment.visible(),
    online: environment.online(),
    searching: state.value.searching,
  })
  if (!allowed) return
  patch({ searching: true, searchFailed: false })
  try {
    await instance.update()
    patch({ searching: false, lastCheckedAt: now })
  } catch {
    // Serveur ou réseau injoignable : rien n'est perdu, la prochaine recherche réessaiera.
    patch({ searching: false, searchFailed: true, lastCheckedAt: now })
  }
  // Une version déjà annoncée peut avoir changé de statut pendant que la personne travaillait (pièces envoyées ou créées).
  if (state.value.available) await refreshUpdateReadiness()
}

export async function refreshUpdateReadiness(): Promise<UpdateReadiness> {
  patch({ checking: true })
  try {
    const readiness = await updateReadinessForThisDevice()
    patch({ readiness, checking: false })
    return readiness
  } catch {
    // Le poste n'a pas pu être lu : par prudence, l'installation reste à confirmer après synchronisation.
    const readiness: UpdateReadiness = {
      decision: 'BLOCKED',
      pendingCount: 0,
      reasons: [
        {
          code: 'COMPATIBILITY_UNKNOWN',
          blocking: true,
          message: 'Le poste n’a pas pu être vérifié : réessayez après avoir ouvert votre profil.',
        },
      ],
    }
    patch({ readiness, checking: false })
    return readiness
  }
}

export type ApplyOutcome = 'APPLIED' | 'BLOCKED' | 'NEEDS_CONFIRMATION' | 'UNAVAILABLE'

/**
 * Installe la nouvelle version : refusée si un motif bloque ; à confirmer explicitement (`confirmed`) si des pièces
 * attendent ou qu'un avertissement existe. La page se recharge quand la nouvelle version prend la main ; si elle ne le
 * fait pas dans `INSTALL_STALL_MS`, l'état `installStalled` invite à recharger la page à la main.
 */
export async function applyUpdate(confirmed: boolean): Promise<ApplyOutcome> {
  const readiness = await refreshUpdateReadiness()
  if (readiness.decision === 'BLOCKED') return 'BLOCKED'
  if (readiness.decision === 'CONFIRM' && !confirmed) return 'NEEDS_CONFIRMATION'
  const instance = workbox
  if (instance === null || !state.value.available) return 'UNAVAILABLE'
  patch({ applying: true, installStalled: false })
  cancelStall()
  cancelStall = environment.later(INSTALL_STALL_MS, () =>
    patch({ applying: false, installStalled: true }),
  )
  instance.messageSkipWaiting()
  return 'APPLIED'
}

/** Recharge cette page (une autre fenêtre a installé la nouvelle version, ou l'installation n'a pas abouti). */
export function reloadApplication(): void {
  environment.reload()
}

/** Déplie ou replie les détails de la bannière ; la bannière elle-même reste affichée. */
export function toggleUpdateDetails(): void {
  patch({ expanded: !state.value.expanded })
}

export function resetAppUpdateForTests(): void {
  stopWatching()
  cancelStall()
  workbox = null
  environment = browserEnvironment()
  state.value = initialState()
}

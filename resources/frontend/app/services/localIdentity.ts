import { ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { adoptLocalAccount, dropLocalAccount, session, type SessionStatus } from '@/app/session'

import {
  checkVaultSession,
  detectVault,
  localAccountOfSession,
  lockVault,
  refreshLocalCommands,
  refreshVault,
  rememberClinic,
  touchVault,
  unlockVault,
  vaultView,
} from './vault'

/**
 * Identité d'action du poste (vault.md D14, D27) : qui travaille sur ce poste, avec ou sans le serveur.
 *
 *  - session du SERVEUR ouverte : c'est elle (droits du serveur) ; le coffre, s'il est ouvert au nom d'un autre
 *    compte, est signalé (`identityDiverges`) et n'écrit plus rien ;
 *  - sinon, coffre de ce poste déverrouillé par la personne : son profil fait foi (`session.status === 'local'`),
 *    avec les droits SIGNÉS de son grant ; seuls les écrans marqués `offlineCapable` s'ouvrent ;
 *  - sinon, et si le coffre existe : l'écran public de déverrouillage vient AVANT la connexion au serveur ;
 *  - sans coffre : le flux d'avant (connexion au serveur), inchangé.
 *
 * Ce module ne contient que la décision et ses gestes : le coffre reste dans `vault.ts` (façade `@/offline/api`), la
 * session du serveur dans `session.ts`.
 */

let boot: Promise<void> | null = null

/**
 * Titre de l'écran que la session locale a refusé d'ouvrir parce qu'il lit le serveur (null sinon) : l'accueil le dit
 * à la personne au lieu de la laisser devant une page qui n'a pas bougé.
 */
export const offlineRefusal = ref<string | null>(null)

/** Destination après déverrouillage : un chemin interne seulement, jamais une autre origine. */
export function afterUnlockPath(next: unknown): string {
  const value = Array.isArray(next) ? next[0] : next
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

/** Détecte une seule fois le coffre de ce navigateur ; sans coffre (ou base illisible), rien n'est ouvert. */
export function ensureVaultReady(): Promise<void> {
  boot ??= detectVault().catch(() => undefined)
  return boot
}

/** Sessions sans identité d'action : rien n'est connu de la personne qui travaille. */
const WITHOUT_IDENTITY: readonly SessionStatus[] = ['unknown', 'anonymous', 'unverified']

/** Un coffre existe ici, mais ce navigateur ne l'a pas déverrouillé (verrouillé, endommagé ou trop récent). */
export function vaultAwaitsUnlock(): boolean {
  const status = vaultView.value.status
  return status === 'locked' || status === 'damaged' || status === 'too-new'
}

/** Aucune identité d'action et un coffre à ouvrir : l'écran de déverrouillage passe avant la connexion (D27). */
export function vaultNeedsUnlock(): boolean {
  return vaultAwaitsUnlock() && WITHOUT_IDENTITY.includes(session.status)
}

/** Point d'entrée de l'application pour une adresse : déverrouillage du poste s'il y a lieu, sinon connexion. */
export function entryRoute(path: string): RouteLocationRaw {
  return {
    name: vaultNeedsUnlock() ? 'deverrouiller' : 'connexion',
    query: path === '/' ? {} : { suite: path },
  }
}

/**
 * Ouvre la session locale d'après le coffre déverrouillé. Sans effet quand le serveur a déjà une session (il est
 * l'autorité) : le coffre reste alors ouvert à côté, sans devenir l'identité d'action.
 */
export async function adoptLocalIdentity(): Promise<void> {
  const account = await localAccountOfSession()
  if (account === null) return
  if (adoptLocalAccount(account)) {
    // Le module `offline` est maintenant ouvert pour l'écran : le coffre, le moteur et la synchronisation se relisent.
    await refreshVault()
    await refreshLocalCommands()
  }
}

/**
 * Déverrouille le profil choisi (secret ressaisi, tentatives limitées par le coffre) et ouvre la session locale. Les
 * erreurs sont celles du coffre (`VaultError` à code stable) : l'écran les traduit.
 */
export async function unlockLocalProfile(profileId: string, secret: string): Promise<void> {
  await unlockVault(profileId, secret)
  await adoptLocalIdentity()
}

/**
 * Verrouille le coffre (D12, D15) : synchrone côté application, sans réseau, avant toute déconnexion du serveur. La
 * session locale se referme ; la session du serveur, elle, n'est pas touchée.
 */
export async function lockLocalProfile(reason = 'USER'): Promise<void> {
  await lockVault(reason)
  dropLocalAccount()
}

const ACTIVITY_WRITE_MS = 15_000
const SESSION_CHECK_MS = 15_000

/**
 * Surveillance du poste (navigateur) : l'activité de la personne prolonge la session du coffre, le contrôle
 * périodique verrouille après 30 minutes sans activité, horloge reculée ou session terminée par un autre onglet
 * (D12, D13), et la session locale suit le coffre. Retient aussi le résumé du cabinet à chaque session du serveur, pour
 * le démarrage suivant sans serveur. Rend la fonction qui retire tout.
 */
export function installVaultWatch(): () => void {
  let lastTouch = 0
  const onActivity = (): void => {
    const now = Date.now()
    if (now - lastTouch < ACTIVITY_WRITE_MS) return
    lastTouch = now
    void touchVault()
  }
  const check = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void checkVaultSession()
  }
  window.addEventListener('pointerdown', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
  const timer = setInterval(check, SESSION_CHECK_MS)
  // Coffre verrouillé (ici ou dans un autre onglet) : la session locale se referme avec lui.
  const stopLock = watch(
    () => vaultView.value.session,
    (opened) => {
      if (opened === null) dropLocalAccount()
    },
  )
  // Session du serveur ouverte : son résumé du cabinet est retenu dans le coffre (s'il existe).
  const stopClinic = watch(
    () => (session.status === 'authenticated' ? session.account?.id : null),
    (account) => {
      if (account !== null && account !== undefined) void rememberClinic()
    },
    { immediate: true },
  )
  return () => {
    window.removeEventListener('pointerdown', onActivity)
    window.removeEventListener('keydown', onActivity)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', check)
    clearInterval(timer)
    stopLock()
    stopClinic()
  }
}

/** Réservé aux tests : le démarrage est refait. */
export function resetLocalIdentityForTests(): void {
  boot = null
}

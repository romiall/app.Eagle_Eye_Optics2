import { computed, reactive, readonly } from 'vue'

import type { LoginRequest, Me, MeResponse } from '@/domain/contracts/generated'

import { ApiError, apiRequest, NetworkUnavailable, prepareSession } from './api'

/**
 * Session du personnel côté SPA (session Sanctum du serveur, fichier 23). Les droits affichés
 * viennent de `/auth/me` : ils guident l'interface, le serveur les revérifie à chaque action.
 *
 * `unverified` : la session n'a pas pu être vérifiée (serveur muet ou en erreur) ; l'interface le
 * dit sans conclure à une déconnexion ni ouvrir d'écran protégé.
 *
 * `local` (D27) : aucune session du serveur n'est vérifiée, et le profil du coffre de ce poste, déverrouillé
 * par la personne elle-même, fait foi. `account` est alors construit depuis le coffre (droits du grant signé,
 * dernier résumé du cabinet connu) ; seuls les écrans marqués `offlineCapable` s'ouvrent. Le serveur reste
 * l'autorité : dès qu'il répond avec une session, c'est elle qui prend la place (`authenticated`) ; son absence
 * ou son silence ne retire jamais le profil local.
 *
 * `expired` : le serveur a répondu 401 ou 419 à une session que cet écran avait ouverte. Le dernier
 * compte reste connu (`lastAccount`), l'écran en cours et ses saisies restent affichés et la
 * reconnexion se fait sur place. `anonymous` : aucun compte connu (jamais connecté, ou déconnecté).
 * Seule une réponse explicite 401 ou 419 change une session ouverte ; un réseau coupé ou une erreur
 * du serveur pendant une relecture (`revalidateSession`) ne la dégrade jamais : le poste hors ligne
 * continue de travailler et le serveur revérifie les droits à chaque action.
 */
export type SessionStatus =
  'unknown' | 'anonymous' | 'authenticated' | 'unverified' | 'expired' | 'local'

interface SessionState {
  status: SessionStatus
  account: Me | null
  /**
   * Dernier compte connu de cet écran, conservé quand la session expire : la reconnexion sur place
   * (`ReauthDialog`) ne vaut que pour ce compte, jamais pour un autre. Effacé par la déconnexion.
   */
  lastAccount: Me | null
}

const state = reactive<SessionState>({ status: 'unknown', account: null, lastAccount: null })

/**
 * Époque de la session : incrémentée par chaque connexion et déconnexion. Une relecture lancée
 * avant un changement d'époque et terminée après est ignorée (une réponse tardive ne ressuscite pas
 * une session fermée ni n'écrase la connexion qui l'a suivie).
 */
let epoch = 0

export const session = readonly(state)

/**
 * Modules ouverts par l'exploitant (mise en service progressive, `EEO_ENABLED_MODULES` côté serveur),
 * lus dans `/auth/me`. Un module livré dans le code reste invisible tant qu'il n'y figure pas ; le
 * serveur répond 404 à ses routes. Sans session connectée, aucun module n'est ouvert.
 */
export const enabledModules = computed<readonly string[]>(
  () => state.account?.clinic.enabled_modules ?? [],
)

export const currentPermissions = computed<readonly string[]>(
  () => state.account?.permissions ?? [],
)

export function can(permission: string): boolean {
  return currentPermissions.value.includes(permission)
}

export function canAny(permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(permission))
}

/**
 * Compte dont les droits guident l'écran en cours : le compte connecté ; si la session a expiré sur
 * cet écran (401), le dernier compte connu, pour que l'écran ne bascule pas en « lecture seule » ni ne
 * retire ses boutons pendant la reconnexion sur place (la saisie et ses boutons de reprise restent). Le
 * serveur revérifie chaque action ; une session perdue n'ouvre aucun droit nouveau.
 */
function screenAccount(): Me | null {
  return state.account ?? (state.status === 'expired' ? state.lastAccount : null)
}

/** Droit tel que l'écran en cours l'affiche (voir `screenAccount`). */
export function canOnScreen(permission: string): boolean {
  return screenAccount()?.permissions.includes(permission) ?? false
}

/** Module ouvert tel que l'écran en cours l'affiche (voir `screenAccount`). */
export function moduleOpenOnScreen(code: string): boolean {
  return screenAccount()?.clinic.enabled_modules.includes(code) ?? false
}

/**
 * Vrai si le serveur contrôle réellement le paiement de l'examen (`EEO_EXAM_FEE_CONTROL=billed`, lu dans
 * `/auth/me`). Absent (serveur plus ancien) ou `OFF` : faux, l'écran dit « non contrôlé ».
 */
export function examFeeControlledOnScreen(): boolean {
  return screenAccount()?.clinic.exam_fee_control === 'BILLED'
}

/** Identité de la session : compte connecté, sinon dernier compte connu de cet écran, sinon null. */
export function knownAccountId(): string | null {
  return state.account?.id ?? state.lastAccount?.id ?? null
}

/**
 * Lecture de `/auth/me`. `downgrade: false` (relecture d'une session ouverte) ne change rien sur une
 * absence de réponse ou une erreur du serveur ; `true` (démarrage, session déjà non vérifiée) range
 * la session en « non vérifiée ». Un 401 ou 419 la range en « expirée » si un compte était connu,
 * sinon en « anonyme ».
 */
async function readSession(downgrade: boolean): Promise<SessionStatus> {
  const started = epoch
  try {
    const response = await apiRequest<MeResponse>('GET', '/api/v1/auth/me')
    if (started !== epoch) return state.status
    state.account = response.data
    state.lastAccount = response.data
    state.status = 'authenticated'
  } catch (error) {
    if (started !== epoch && (error instanceof ApiError || error instanceof NetworkUnavailable)) {
      return state.status
    }
    if (
      state.status === 'local' &&
      (error instanceof ApiError || error instanceof NetworkUnavailable)
    ) {
      // Profil du coffre en service (D27) : ni l'absence de réponse du serveur, ni l'absence de session chez lui, ne le retirent.
      return state.status
    }
    if (error instanceof ApiError && (error.status === 401 || error.status === 419)) {
      state.account = null
      state.status = state.lastAccount === null ? 'anonymous' : 'expired'
    } else if (error instanceof NetworkUnavailable || error instanceof ApiError) {
      // Aucune réponse, ou une erreur du serveur (5xx, maintenance) : rien n'est conclu.
      if (downgrade && state.status !== 'expired') state.status = 'unverified'
    } else {
      throw error
    }
  }
  return state.status
}

export function refreshSession(): Promise<SessionStatus> {
  return readSession(true)
}

/**
 * Ouvre la session LOCALE (D27) avec le compte construit depuis le coffre déverrouillé. Rendu faux, sans rien changer,
 * quand le serveur a déjà une session ouverte (il est l'autorité) ou qu'une session expirée garde des saisies à
 * reprendre sur place : le profil local ne s'y substitue jamais. Le dernier compte du SERVEUR (`lastAccount`) reste
 * intact.
 */
export function adoptLocalAccount(account: Me): boolean {
  if (state.status === 'authenticated' || state.status === 'expired') return false
  state.account = account
  state.status = 'local'
  return true
}

/**
 * Referme la session locale (coffre verrouillé : inactivité, bouton, autre onglet). La session du serveur n'est pas
 * connue : elle sera relue (`unverified`). Sans effet hors session locale.
 */
export function dropLocalAccount(): void {
  if (state.status !== 'local') return
  state.account = null
  state.status = 'unverified'
}

/**
 * Relecture d'une session déjà ouverte (retour sur l'onglet) : ne la dégrade jamais sur une panne.
 * Un autre onglet connecté à un autre compte remplace le compte affiché ; les saisies commencées
 * sous l'ancien compte sont alors refusées à l'envoi (`useMutation`).
 */
export function revalidateSession(): Promise<SessionStatus> {
  return readSession(false)
}

export async function signIn(credentials: LoginRequest): Promise<Me> {
  await prepareSession()
  const response = await apiRequest<MeResponse>('POST', '/api/v1/auth/login', credentials)
  epoch += 1
  state.account = response.data
  state.lastAccount = response.data
  state.status = 'authenticated'
  return response.data
}

/**
 * Déconnexion : la session n'est dite fermée qu'une fois fermée par le serveur. Sans réponse, ou sur
 * une erreur, l'exception remonte et le compte reste affiché : sur un poste partagé, la personne
 * suivante ne doit pas hériter d'une session que l'écran prétendrait fermée. Une session déjà
 * expirée (401) est fermée ; un jeton CSRF périmé (419) est renouvelé une fois.
 */
export async function signOut(): Promise<void> {
  try {
    await apiRequest<null>('POST', '/api/v1/auth/logout')
  } catch (error) {
    if (error instanceof ApiError && error.status === 419) {
      await prepareSession()
      await apiRequest<null>('POST', '/api/v1/auth/logout').catch((retry: unknown) => {
        if (!(retry instanceof ApiError && retry.status === 401)) throw retry
      })
    } else if (!(error instanceof ApiError && error.status === 401)) {
      throw error
    }
  }
  epoch += 1
  state.account = null
  state.lastAccount = null
  state.status = 'anonymous'
}

/** Réservé aux tests : état initial. */
export function resetSessionForTests(): void {
  state.account = null
  state.lastAccount = null
  state.status = 'unknown'
}

import { readonly, shallowRef } from 'vue'

import { ApiError } from '@/app/api'
import { APP_RELEASE } from '@/app/release'
import { installDocumentStore } from '@/app/services/documents'
import { moduleOpenOnScreen, session as appSession } from '@/app/session'
import { MemoryDocumentStore } from '@/documents/store/memory'
import { clinicTimeZone, DEFAULT_CLINIC_TIME_ZONE } from '@/app/clinicTime'
import type { ClinicSummary, Me, Release, Replacement } from '@/domain/contracts/generated'
import {
  type DeviceSync,
  type ExportManifest,
  type GrantClaims,
  type ImportReport,
  isVaultError,
  type LocalCommands,
  type LocalFactRecord,
  type OfflineVault,
  type OpenedExport,
  openOfflineVault,
  type PreparedRecovery,
  type ProfileSummary,
  type PulledRecord,
  type RecoveredPushReport,
  type RecoveryTransport,
  type ReleaseCompatibility,
  type SessionInfo,
  type StorageHealth,
  SyncRefused,
  type UpdateReadiness,
  type VaultStatus,
  vaultDatabaseExists,
} from '@/offline/api'

import {
  enrollDevice,
  getDevicePreparation,
  getSigningKeys,
  getSyncCompatibility,
  issueOfflineGrant,
  type PrepareDeviceInput,
  prepareDeviceResources,
  pushRecoveredCommands,
  reconcileReplacement,
  replaceDevice,
} from './devices'
import { httpSyncTransport } from './syncTransport'

// Ce que les écrans emploient du coffre passe par ce service (règle ESLint : jamais @/offline dans une page).
export { isRecoveryError, isVaultError, localSecrets } from '@/offline/api'
export type {
  ExportManifest,
  GrantClaims,
  ImportReport,
  PreparedRecovery,
  PulledRecord,
  RecoveredPushReport,
  StorageHealth,
  UpdateReadiness,
  UpdateReason,
} from '@/offline/api'

/**
 * Coffre local du poste vu par l'application (O01, O02) : état réactif et opérations de PRÉPARATION du poste. Le
 * coffre n'est ouvert que si l'exploitant a ouvert le module `offline` : sans lui, rien ne touche à IndexedDB et
 * l'application se comporte exactement comme avant (en ligne).
 *
 * Il permet à la gérante de créer le coffre du poste, d'enrôler le poste et de préparer les profils (grants signés
 * vérifiés et conservés) et ses ressources ; le journal du poste (O04) et sa synchronisation (O05) n'agissent que
 * module `offline` ouvert et coffre ouvert. Les PDF originaux d'une session ouverte sont conservés chiffrés dans le
 * coffre.
 */
export interface VaultView {
  status: VaultStatus | 'unavailable'
  session: SessionInfo | null
  profiles: ProfileSummary[]
  deviceId: string | null
}

const state = shallowRef<VaultView>({
  status: 'unavailable',
  session: null,
  profiles: [],
  deviceId: null,
})
let instance: OfflineVault | null = null
let commands: LocalCommands | null = null
let sync: DeviceSync | null = null
/**
 * Le coffre de CE navigateur existe (détecté au démarrage sans le créer, D27). C'est la seule raison, avec le module
 * `offline` ouvert par le serveur, d'ouvrir la base : un navigateur sans coffre ne touche jamais à IndexedDB.
 */
let vaultDetected = false
/** Dernier résumé du cabinet écrit dans le coffre (évite de réécrire à chaque relecture de la session). */
let notedClinic: string | null = null

/**
 * Vrai si le profil du coffre ouvert n'est pas le compte connecté au serveur : aucune commande n'est alors écrite sur
 * ce poste au nom de l'autre (D27, « jamais rejouée au nom d'un autre compte »). L'écran le signale.
 */
export function identityDiverges(): boolean {
  const opened = state.value.session
  const account = appSession.status === 'authenticated' ? appSession.account : null
  return opened !== null && account !== null && opened.userId !== account.id
}

/**
 * Moteur de commandes local (O04) du coffre OUVERT, si le module `offline` est ouvert : null sinon (rien ne change
 * pour l'application en ligne). Ses droits sont relus après déverrouillage, préparation et chaque commit.
 */
export function localCommandsOrNull(): LocalCommands | null {
  if (!offlineModuleOpen() || instance === null || state.value.session === null) return null
  if (identityDiverges()) return null
  commands ??= instance.localCommands({ timeZone: clinicTimeZone() })
  return commands
}

/**
 * Synchronisation (O05) du coffre OUVERT d'un poste enrôlé, si le module `offline` est ouvert : null sinon (aucun état
 * de synchronisation n'est alors annoncé).
 */
export function deviceSyncOrNull(): DeviceSync | null {
  if (
    !offlineModuleOpen() ||
    instance === null ||
    state.value.session === null ||
    state.value.deviceId === null
  )
    return null
  sync ??= instance.sync({ transport: httpSyncTransport })
  return sync
}

/**
 * Faits financiers enregistrés sur CE poste, avec l'état de leur commande (O04, O05) : vide si le module `offline` est
 * fermé, le coffre fermé ou le compartiment financier fermé pour la session. Lecture seule : aucune écriture ici.
 */
export async function localFinancialFacts(): Promise<LocalFactRecord[]> {
  return localFactsOf('FINANCIAL')
}

/**
 * Faits ADMINISTRATIFS enregistrés sur CE poste (fiches patient créées ou modifiées ici), avec l'état de leur commande :
 * mêmes conditions que les faits financiers (module ouvert, coffre ouvert, compartiment ouvert pour la session).
 */
export async function localAdministrativeFacts(): Promise<LocalFactRecord[]> {
  return localFactsOf('ADMINISTRATIVE')
}

async function localFactsOf(
  compartment: 'FINANCIAL' | 'ADMINISTRATIVE',
): Promise<LocalFactRecord[]> {
  if (!offlineModuleOpen() || instance === null || state.value.session === null) return []
  try {
    return await instance.localFacts(compartment)
  } catch (error) {
    if (isVaultError(error)) return []
    throw error
  }
}

/**
 * Catalogue et règles fiscales FIGÉS de ce poste (remis à sa préparation, jamais de coût d'achat) : valeur brute à lire
 * avec `readLocalCatalog`, ou null si le module `offline` est fermé, le coffre fermé, le compartiment administratif fermé
 * pour la session, ou le catalogue jamais remis. Lecture seule.
 */
export async function localCatalogSnapshot(): Promise<unknown> {
  if (!offlineModuleOpen() || instance === null || state.value.session === null) return null
  try {
    return await instance.catalogSnapshot()
  } catch (error) {
    if (isVaultError(error)) return null
    throw error
  }
}

/**
 * Annuaire du poste (A2) : projections du serveur reçues par le pull pour un type d'entité du compartiment administratif
 * (`ids` : ces entités seulement). Vide si le module `offline` est fermé, le coffre fermé ou le compartiment fermé pour la
 * session. Lecture seule, jamais le réseau.
 */
export async function localPulledRecords(
  entityType: string,
  ids?: readonly string[],
): Promise<PulledRecord[]> {
  if (!offlineModuleOpen() || instance === null || state.value.session === null) return []
  try {
    return await instance.pulledRecords('ADMINISTRATIVE', entityType, ids)
  } catch (error) {
    if (isVaultError(error)) return []
    throw error
  }
}

/**
 * Repère de l'annuaire du poste : session ouverte + dernier pull. Il change à chaque déverrouillage et à chaque page de pull
 * validée ; null quand rien ne peut être lu (module fermé, coffre fermé) : l'annuaire gardé en mémoire doit alors être oublié.
 */
export async function localPullStamp(): Promise<string | null> {
  const session = state.value.session
  if (!offlineModuleOpen() || instance === null || session === null) return null
  try {
    return `${session.sessionId}:${(await instance.lastPullAt()) ?? 'jamais'}`
  } catch (error) {
    if (isVaultError(error)) return null
    throw error
  }
}

export async function refreshLocalCommands(): Promise<void> {
  const current = localCommandsOrNull()
  if (current !== null) await current.refresh()
}

export const vaultView = readonly(state)

/** Vrai si le module de préparation des postes est ouvert pour l'écran en cours. */
export function offlineModuleOpen(): boolean {
  return moduleOpenOnScreen('offline')
}

function vault(): OfflineVault {
  if (!offlineModuleOpen() && !vaultDetected) {
    throw new Error('Module de préparation des postes fermé.')
  }
  instance ??= openOfflineVault()
  return instance
}

export async function refreshVault(): Promise<VaultView> {
  if (!offlineModuleOpen() && !vaultDetected) {
    state.value = { status: 'unavailable', session: null, profiles: [], deviceId: null }
    return state.value
  }
  const current = vault()
  const status = await current.status()
  state.value = {
    status,
    session: current.session(),
    profiles: status === 'absent' ? [] : await current.profiles(),
    deviceId: status === 'absent' ? null : await current.deviceId(),
  }
  if (status !== 'absent') void rememberClinic()
  return state.value
}

/**
 * Détecte au démarrage le coffre de CE navigateur, sans le créer, et lit son état (D27) : le serveur peut être
 * injoignable, le module `offline` n'est alors pas connu. Sans coffre, rien n'est ouvert et rien ne change.
 */
export async function detectVault(): Promise<void> {
  if (!(await vaultDatabaseExists())) return
  vaultDetected = true
  await refreshVault()
}

/**
 * Retient dans le coffre le résumé du cabinet de la session serveur ouverte (nom, fuseau, modules) : il sert à ouvrir
 * une session locale quand le serveur est injoignable. Écrit seulement s'il a changé ; une erreur du coffre n'arrête rien.
 */
export async function rememberClinic(): Promise<void> {
  const account = appSession.status === 'authenticated' ? appSession.account : null
  if (account === null || instance === null || state.value.status === 'absent') return
  // Copie simple : un objet réactif de Vue ne se clone pas pour IndexedDB.
  const clinic = JSON.parse(JSON.stringify(account.clinic)) as ClinicSummary
  const serialized = JSON.stringify(clinic)
  if (serialized === notedClinic) return
  try {
    await instance.noteClinic(clinic)
    notedClinic = serialized
  } catch {
    // Le résumé sera réécrit à la prochaine relecture de la session.
  }
}

/**
 * Compte local de la session du coffre ouverte (D27) : identité et droits SIGNÉS du grant (rien d'autre n'est cru),
 * résumé du cabinet de la dernière session serveur, `offline` toujours ouvert (le coffre existe). Sans grant valide,
 * aucun droit : le profil se déverrouille mais ne peut rien faire (l'écran l'explique, la préparation se refait en ligne).
 */
export async function localAccountOfSession(): Promise<Me | null> {
  if (instance === null) return null
  const opened = instance.session()
  if (opened === null) return null
  const [profiles, grants, clinic, clinicId] = await Promise.all([
    instance.profiles(),
    instance.grants(),
    instance.clinic(),
    instance.clinicId(),
  ])
  const profile = profiles.find((row) => row.profileId === opened.profileId)
  const grant =
    opened.grantId === null ? null : (grants.find((row) => row.grantId === opened.grantId) ?? null)
  const modules = new Set([...(clinic?.enabled_modules ?? []), 'offline'])
  return {
    id: opened.userId,
    login: profile?.login ?? '',
    display_name: opened.displayName,
    email: null,
    active: true,
    version: 1,
    roles: [],
    permissions: grant?.permissions ?? [],
    clinic: {
      id: clinic?.id ?? clinicId,
      name: clinic?.name ?? 'Cabinet',
      timezone: clinic?.timezone ?? DEFAULT_CLINIC_TIME_ZONE,
      currency: 'XAF',
      production_documents_enabled: clinic?.production_documents_enabled ?? false,
      enabled_modules: [...modules],
      exam_fee_control: clinic?.exam_fee_control ?? 'OFF',
    },
  }
}

/** Activité de la personne sur ce coffre (frappe, clic) : persistée au plus toutes les 15 s par le coffre (D13). */
export async function touchVault(): Promise<void> {
  if (instance === null || state.value.session === null) return
  await instance.touch().catch(() => undefined)
}

/**
 * Contrôle périodique de la session du coffre : verrouillage après 30 minutes sans activité, horloge reculée, session
 * terminée par un autre onglet (D12, D13). Rend vrai quand le coffre vient de se verrouiller ici.
 */
export async function checkVaultSession(): Promise<boolean> {
  if (instance === null || state.value.session === null) return false
  await instance.checkInactivity().catch(() => undefined)
  if (instance.session() !== null) return false
  afterLock()
  await refreshVault()
  return true
}

/** Oublis à faire quand le coffre se referme (D12) : ce qu'un service garde déchiffré en mémoire, l'annuaire du poste par exemple. */
const lockListeners = new Set<() => void>()

export function whenVaultLocks(forget: () => void): void {
  lockListeners.add(forget)
}

/** Ce que le verrouillage défait côté application : moteur, synchronisation, conservation des PDF en mémoire, annuaire. */
function afterLock(): void {
  commands = null
  sync = null
  for (const forget of lockListeners) forget()
  // Coffre verrouillé : retour à la conservation volatile (l'écran le dit, comme avant).
  installDocumentStore(new MemoryDocumentStore(), { persistent: false })
}

export async function vaultStorageHealth(): Promise<StorageHealth> {
  return vault().storageHealth()
}

/** Création du coffre par la gérante connectée (son identité vient de la session serveur, jamais d'une saisie). */
export async function prepareVaultForManager(secret: string): Promise<PreparedRecovery> {
  const account = appSession.account
  if (account === null) throw new Error('Session non vérifiée : reconnectez-vous.')
  return vault().prepareVault({
    clinicId: account.clinic.id,
    profile: {
      userId: account.id,
      login: account.login,
      displayName: account.display_name,
      permissions: account.permissions,
    },
    secret,
  })
}

export async function unlockVault(profileId: string, secret: string): Promise<SessionInfo> {
  const opened = await vault().unlock(profileId, secret)
  // Les PDF originaux d'une session ouverte sont conservés chiffrés dans le coffre (O01).
  installDocumentStore(vault().documentStore(), { persistent: true })
  commands = null
  sync = null
  await refreshVault()
  await refreshLocalCommands()
  return opened
}

export async function lockVault(reason = 'USER'): Promise<void> {
  if (instance === null) return
  await instance.lock(reason)
  afterLock()
  await refreshVault()
}

/**
 * Enrôle CE poste : clé ES256 du poste créée dans le coffre (secret de la gérante ressaisi), preuve de possession,
 * enrôlement serveur, liaison du coffre au `device_id`, clés publiques du serveur épinglées.
 */
export async function enrollThisDevice(input: {
  managerSecret: string
  deviceCode: string
  name: string
  appVersion: string
}): Promise<string> {
  const current = vault()
  const opened = current.session()
  const account = appSession.account
  if (opened === null || account === null)
    throw new Error('Ouvrez le coffre de ce poste avant de l’enrôler.')
  if ((await current.deviceId()) !== null) throw new Error('Ce poste est déjà enrôlé.')
  const keys = await getSigningKeys()
  await current.pinServerKeys(
    keys.keys.map((key) => ({
      kid: key.kid,
      status: key.status,
      jwk: { kty: 'EC', crv: 'P-256', x: key.jwk.x, y: key.jwk.y },
    })),
  )
  if (!opened.canSign)
    await current.createSigningKey({ profileId: opened.profileId, secret: input.managerSecret })
  const body = await current.enrollmentBody({
    deviceCode: input.deviceCode,
    name: input.name,
    responsibleUserId: account.id,
    appVersion: input.appVersion,
    issuedAt: new Date().toISOString(),
  })
  const device = await enrollDevice(body)
  await current.bindDevice(device.device_id)
  await refreshVault()
  return device.device_id
}

/** Prépare un profil de ce poste : grant signé émis par le serveur, VÉRIFIÉ localement puis conservé. */
export async function prepareProfileGrant(
  userId: string,
  validHours: number | null = null,
): Promise<GrantClaims> {
  const current = vault()
  const deviceId = await current.deviceId()
  if (deviceId === null) throw new Error('Enrôlez ce poste avant de préparer ses profils.')
  const keys = await getSigningKeys()
  await current.pinServerKeys(
    keys.keys.map((key) => ({
      kid: key.kid,
      status: key.status,
      jwk: { kty: 'EC', crv: 'P-256', x: key.jwk.x, y: key.jwk.y },
    })),
  )
  const grant = await issueOfflineGrant(deviceId, userId, validHours)
  const claims = await current.acceptGrant(grant)
  await current.noteServerTime(grant.issued_at)
  return claims
}

/**
 * Ajoute le profil local d'un compte préparé : la personne saisit ELLE-MÊME son secret local sur ce poste (aucun
 * secret initial connu de la gérante) ; la gérante ressaisit le sien pour lui envelopper les clés de ses
 * compartiments, déduits des permissions de son grant signé.
 */
export async function addLocalProfile(input: {
  managerSecret: string
  member: { id: string; login: string; display_name: string }
  claims: GrantClaims
  holderSecret: string
}): Promise<string> {
  const current = vault()
  const opened = current.session()
  if (opened === null) throw new Error('Ouvrez le coffre de ce poste avant d’y ajouter un profil.')
  const profileId = await current.addProfile(
    { profileId: opened.profileId, secret: input.managerSecret },
    {
      userId: input.member.id,
      login: input.member.login,
      displayName: input.member.display_name,
      permissions: input.claims.permissions,
    },
    input.holderSecret,
  )
  await refreshVault()
  return profileId
}

/**
 * Prépare les RESSOURCES de ce poste (O03) : plages de numéros, quotas, factures attribuées, demandés au serveur par la
 * gérante, puis conservés dans le coffre (curseurs locaux jamais reculés) avec le catalogue figé.
 */
export async function prepareThisDeviceResources(
  input: PrepareDeviceInput,
): Promise<{ ranges: number; quotas: number; owners: number }> {
  const current = vault()
  const deviceId = await current.deviceId()
  if (deviceId === null) throw new Error('Enrôlez ce poste avant de préparer ses ressources.')
  const preparation = await prepareDeviceResources(deviceId, input)
  const counts = await current.storePreparation(preparation)
  await refreshLocalCommands()
  return counts
}

/** Relit la préparation de ce poste (reconnexion) et la fusionne dans le coffre. */
export async function refreshThisDevicePreparation(): Promise<{
  ranges: number
  quotas: number
  owners: number
}> {
  const current = vault()
  const deviceId = await current.deviceId()
  if (deviceId === null) throw new Error('Enrôlez ce poste avant de relire ses ressources.')
  const counts = await current.storePreparation(await getDevicePreparation(deviceId))
  await refreshLocalCommands()
  return counts
}

// --- Mise à jour sûre (O06) -------------------------------------------------------------------------------------

/**
 * La nouvelle version proposée peut-elle s'installer maintenant ? Sans module `offline` ouvert ni coffre, rien n'attend
 * sur ce poste : FREE. Sinon la déclaration du serveur est relue (null si injoignable) et comparée aux pièces en attente.
 */
export async function updateReadinessForThisDevice(): Promise<UpdateReadiness> {
  if (!offlineModuleOpen()) return { decision: 'FREE', reasons: [], pendingCount: 0 }
  const compatibility: ReleaseCompatibility | null = await getSyncCompatibility().catch(() => null)
  return vault().updateReadiness(compatibility)
}

// --- Export et reprise d'un poste (O07) -------------------------------------------------------------------------

/** Fait télécharger un texte par le navigateur (aucun envoi réseau). */
function download(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Export chiffré de ce poste (profil ouvert), téléchargé par le navigateur ; rend le manifeste affiché à l'écran. */
export async function exportThisDevice(): Promise<{ fileName: string; manifest: ExportManifest }> {
  const result = await vault().exportDevice(APP_RELEASE)
  download(result.fileName, result.text)
  return { fileName: result.fileName, manifest: result.manifest }
}

let openedExport: OpenedExport | null = null

/** Ouvre l'export d'un ANCIEN poste avec la clé de récupération de la gérante ; rien n'est écrit. */
export async function openOldDeviceExport(
  text: string,
  recoveryKey: string,
): Promise<ExportManifest> {
  openedExport = await vault().openExport(text, recoveryKey)
  return openedExport.manifest
}

/** Range l'export ouvert dans ce coffre (commandes signées et pièces rescellées), sans rien envoyer. */
export async function importOldDeviceExport(): Promise<ImportReport> {
  if (openedExport === null) throw new Error('Ouvrez d’abord l’export de l’ancien poste.')
  const report = await vault().importExport(openedExport)
  openedExport = null
  return report
}

/** Déclare au serveur que ce poste remplace l'ancien (gérante, mot de passe confirmé). */
export async function declareReplacement(
  oldDeviceId: string,
  reason: string,
): Promise<Replacement> {
  const deviceId = await vault().deviceId()
  if (deviceId === null) throw new Error('Enrôlez ce poste avant de déclarer le remplacement.')
  return replaceDevice(oldDeviceId, deviceId, reason)
}

/** Transport de la reprise : erreurs explicites du serveur rendues comme refus de synchronisation (code stable). */
const recoveryTransport: RecoveryTransport = {
  pushRecovered: async (oldDeviceId, body) => {
    try {
      return await pushRecoveredCommands(oldDeviceId, body)
    } catch (error) {
      if (error instanceof ApiError && error.fromApplication && error.status !== 423) {
        throw new SyncRefused(error.status, error.code, error.message, error.details)
      }
      throw error
    }
  },
}

/**
 * Transmet toutes les commandes signées de l'ancien poste, lot par lot, tant que chaque lot avance. S'arrête sur une
 * commande en revue ou en attente d'une pièce liée (la gérante décide dans « Conflits de synchronisation »).
 */
export async function transmitRecoveredCommands(oldDeviceId: string): Promise<RecoveredPushReport> {
  const total: RecoveredPushReport = {
    sent: 0,
    accepted: 0,
    waiting: 0,
    conflicts: 0,
    rejected: 0,
    complete: false,
    prefix: null,
  }
  for (let round = 0; round < 200; round += 1) {
    const report = await vault().pushRecovered(recoveryTransport, oldDeviceId)
    total.sent += report.sent
    total.accepted += report.accepted
    total.waiting += report.waiting
    total.conflicts += report.conflicts
    total.rejected += report.rejected
    total.prefix = report.prefix ?? total.prefix
    total.complete = report.complete
    if (report.complete || report.sent === 0 || report.conflicts > 0 || report.waiting > 0) break
  }
  return total
}

/** Clôture côté serveur des ressources de l'ancien poste, puis trace locale de la reprise terminée. */
export async function reconcileOldDevice(input: {
  exportId: string
  oldDeviceId: string
  lastDeviceSequence: string
  lastEventHash: string | null
  reason: string
}): Promise<Release> {
  const release = await reconcileReplacement(input.oldDeviceId, {
    last_device_sequence: input.lastDeviceSequence,
    last_event_hash: input.lastEventHash,
    reason: input.reason,
  })
  await vault().markReconciled(input.exportId)
  return release
}

/** Reprises enregistrées sur ce poste (exports ouverts, commandes encore à transmettre). */
export async function deviceRecoveryStatus(): Promise<
  Awaited<ReturnType<OfflineVault['recoveryStatus']>>
> {
  return vault().recoveryStatus()
}

export function resetVaultServiceForTests(): void {
  instance?.dispose()
  instance = null
  commands = null
  sync = null
  openedExport = null
  vaultDetected = false
  notedClinic = null
  state.value = { status: 'unavailable', session: null, profiles: [], deviceId: null }
}

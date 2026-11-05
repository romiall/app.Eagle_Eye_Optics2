import type { DocumentStore } from '../documents/store/port'
import type { ClinicSummary, Preparation } from '../domain/contracts/generated'

import { storePreparation } from './allocations/allocations'
import { CommandJournal } from './command-journal/journal'
import {
  LocalCommandBus,
  type LocalCommandRequest,
  type LocalCommitResult,
  type LocalReadiness,
} from './LocalCommandBus'
import {
  type LocalFactRecord,
  type LocalHeadRecord,
  localFacts,
  localHeads,
} from './projections/localRecords'
import {
  type JournalSyncSummary,
  type LocalSyncIssue,
  SyncEngine,
  type SyncReport,
} from './sync/engine'
import { lastPullAt, type PulledRecord, pulledRecord, pulledRecords } from './sync/pull'
import type { SyncTransport } from './sync/transport'
import { type DeviceExport, exportDevice } from './recovery/exportDevice'
import { type OpenedExport, openExport } from './recovery/openArchive'
import {
  type ImportReport,
  importExport,
  markReconciled,
  pushRecovered,
  type RecoveredPushReport,
  type RecoveryTransport,
  recoveryStatus,
} from './recovery/restore'
import { updateReadiness } from './update/updateCheck'
import type { ReleaseCompatibility, UpdateReadiness } from './update/updateGate'

import type { Compartment } from './compartments'
import { generatePassphrase, secretProblem, type SecretProblem } from './crypto/secrets'
import type { KdfPolicy } from './crypto/kdf'
import {
  acceptGrant,
  enrollmentBody,
  type EnrollmentInput,
  type GrantClaims,
  pinnedGrantCheck,
  type PinnedKey,
} from './enrollment/enrollment'
import type { PublicJwk } from './signing/jws'
import { VaultDatabase, VAULT_DB_NAME } from './vault/db'
import { VaultDocumentStore } from './vault/documentStore'
import {
  browserStoragePort,
  type StorageHealth,
  storageHealth,
  type StoragePort,
} from './vault/storageHealth'
import {
  broadcastChannel,
  type PreparedRecovery,
  type ProfileInput,
  type ProfileSummary,
  type SessionInfo,
  Vault,
  type VaultStatus,
} from './vault/vault'

/**
 * Façade du moteur local (vault.md D26) : SEUL point d'entrée du coffre importable par les services d'application
 * (`app/services/…`, règle ESLint d'architecture). Elle n'expose ni table, ni `CryptoKey`, ni secret : des
 * opérations typées dont les erreurs sont des `VaultError` à code stable.
 *
 * O01 et O02 : coffre, profils, compartiments, conservation chiffrée des PDF, clé du poste, enrôlement et grants
 * vérifiés. O03 : ressources préparées (plages, quotas, propriétés, catalogue figé). O04 : moteur de commandes local
 * (commit atomique dans le journal commun du poste) et lectures des enregistrements du poste. O05 : synchronisation
 * (push du journal, ACK, pull des changements, conflits du poste) ; une commande enregistrée sur ce poste n'est
 * « consolidée sur le serveur » qu'à son ACK final enregistré localement, jamais avant. O06 : contrôle d'une mise à jour
 * (rien n'est purgé). O07 : export chiffré du poste, ouverture d'un export avec la clé de récupération, reprise des
 * commandes signées d'un poste remplacé (mêmes identifiants et numéros), sans cloner aucun droit.
 */
export type {
  PreparedRecovery,
  ProfileInput,
  ProfileSummary,
  SessionInfo,
  VaultStatus,
} from './vault/vault'
export type { StorageHealth } from './vault/storageHealth'
export type { GrantClaims, PinnedKey } from './enrollment/enrollment'
export type { PublicJwk } from './signing/jws'
export type { Compartment } from './compartments'
export { VaultError, isVaultError, type VaultErrorCode } from './vault/errors'
export { compartmentsOf } from './compartments'
export type { LocalCommandRequest, LocalCommitResult, LocalReadiness } from './LocalCommandBus'
export type { LocalFactRecord, LocalHeadRecord } from './projections/localRecords'
export type { JournalSyncSummary, LocalSyncIssue, SyncReport } from './sync/engine'
export type { PulledRecord } from './sync/pull'
export { isSyncRefused, SyncRefused, type SyncTransport } from './sync/transport'
export type { DeviceExport } from './recovery/exportDevice'
export type { ExportManifest } from './recovery/archive'
export { isRecoveryError, RecoveryError, type RecoveryErrorCode } from './recovery/archive'
export type { OpenedExport } from './recovery/openArchive'
export type { ImportReport, RecoveredPushReport, RecoveryTransport } from './recovery/restore'
export type {
  ReleaseCompatibility,
  UpdateDecision,
  UpdateReadiness,
  UpdateReason,
} from './update/updateGate'
export { LOCAL_SCHEMA_VERSION } from './migrations/registry'

/** Synchronisation du poste (O05), vue par l'application : un échange, les compteurs, les commandes à revoir. */
export interface DeviceSync {
  syncNow(): Promise<SyncReport>
  summary(): Promise<JournalSyncSummary>
  issues(): Promise<LocalSyncIssue[]>
  pulled(
    compartment: Compartment,
    entityType: string,
    entityId: string,
  ): Promise<PulledRecord | null>
}

/** Moteur de commandes local du poste (O04), vu par l'application : choix synchrone du chemin et commit atomique. */
export interface LocalCommands {
  handles(request: LocalCommandRequest): boolean
  commit(request: LocalCommandRequest): Promise<LocalCommitResult>
  refresh(): Promise<LocalReadiness>
  readiness(): LocalReadiness
}

/** Journal du poste en lecture (tableau de bord, préparation d'O05) : jamais une suppression. */
export interface JournalView {
  head(): Promise<{ deviceSequence: number; eventHash: string | null }>
  pendingCount(): Promise<number>
  waitingCompartments(): Promise<string[]>
}

export interface GrantSummary {
  grantId: string
  userId: string
  /** Cabinet du grant signé (null si le grant ne le porte pas). */
  clinicId: string | null
  /** Permissions figées dans le grant signé : celles de la session locale quand le serveur est injoignable. */
  permissions: string[]
  compartments: Compartment[]
  validUntil: string
}

export interface OfflineVault {
  status(): Promise<VaultStatus>
  session(): SessionInfo | null
  profiles(): Promise<ProfileSummary[]>
  deviceId(): Promise<string | null>
  /** Cabinet auquel ce coffre appartient (identité du coffre, immuable). */
  clinicId(): Promise<string>
  /** Retient le résumé du cabinet lu à la dernière session serveur (D27 : session locale sans serveur). */
  noteClinic(clinic: ClinicSummary): Promise<void>
  /** Dernier résumé du cabinet retenu ; null s'il manque ou si sa forme est altérée. */
  clinic(): Promise<ClinicSummary | null>
  prepareVault(input: {
    clinicId: string
    profile: ProfileInput
    secret: string
  }): Promise<PreparedRecovery>
  unlock(profileId: string, secret: string): Promise<SessionInfo>
  lock(reason: string): Promise<void>
  addProfile(
    actor: { profileId: string; secret: string },
    profile: ProfileInput,
    holderSecret: string,
  ): Promise<string>
  changeSecret(profileId: string, current: string, next: string): Promise<void>
  resetSecretWithRecovery(recovery: string, profileId: string, next: string): Promise<void>
  removeProfile(actor: { profileId: string; secret: string }, profileId: string): Promise<void>
  verifyRecoveryKey(recovery: string): Promise<boolean>
  storageHealth(): Promise<StorageHealth>
  createSigningKey(actor: { profileId: string; secret: string }): Promise<PublicJwk>
  enrollmentBody(input: EnrollmentInput): Promise<Record<string, unknown>>
  bindDevice(deviceId: string): Promise<void>
  pinServerKeys(keys: readonly PinnedKey[]): Promise<void>
  noteServerTime(serverIso: string): Promise<void>
  acceptGrant(grant: {
    grant_id: string
    user_id: string
    device_id: string
    signed_payload: string
  }): Promise<GrantClaims>
  grants(): Promise<GrantSummary[]>
  /** Conservation chiffrée des PDF de la session ouverte (à installer avec `installDocumentStore`). */
  documentStore(options?: { quotaBytes?: number }): DocumentStore
  /** O03 : ressources préparées reçues du serveur, fusionnées sans jamais reculer un curseur local. */
  storePreparation(
    preparation: Preparation,
  ): Promise<{ ranges: number; quotas: number; owners: number }>
  /** O04 : moteur de commandes local (une instance par coffre ouvert). */
  localCommands(options: { timeZone: string }): LocalCommands
  journal(): JournalView
  /** O05 : moteur de synchronisation du coffre ouvert (une instance par coffre ouvert). */
  sync(options: { transport: SyncTransport }): DeviceSync
  localFacts(compartment: Compartment): Promise<LocalFactRecord[]>
  localHeads(headType: string): Promise<LocalHeadRecord[]>
  /**
   * Catalogue et règles fiscales FIGÉS remis à la préparation du poste (entité scellée `catalog_snapshot`, compartiment
   * administratif) : sa valeur brute, ou null s'il n'a jamais été remis. À lire avec `readLocalCatalog`.
   */
  catalogSnapshot(): Promise<unknown>
  /**
   * Annuaire du poste (A2) : projections du serveur reçues par le pull pour un type d'entité (les `ids` donnés seulement, ou
   * toutes). Vide si le compartiment est fermé pour la session ; jamais le réseau.
   */
  pulledRecords(
    compartment: Compartment,
    entityType: string,
    ids?: readonly string[],
  ): Promise<PulledRecord[]>
  /** Instant du dernier pull du compte ouvert (l'annuaire est à jour jusque-là) ; null s'il n'y en a jamais eu. */
  lastPullAt(): Promise<string | null>
  onBeforeLock(hook: () => Promise<void> | void): () => void
  touch(): Promise<void>
  checkInactivity(): Promise<string | null>
  /** O06 : la mise à jour proposée peut-elle s'installer maintenant sans risque pour les pièces du poste ? */
  updateReadiness(compatibility: ReleaseCompatibility | null): Promise<UpdateReadiness>
  /** O07 : export chiffré du poste (profil ouvert) ; le fichier est rendu, jamais envoyé. */
  exportDevice(release: string): Promise<DeviceExport>
  /** O07 : ouverture d'un export d'un ANCIEN poste avec la clé de récupération (rien n'est écrit). */
  openExport(text: string, recoveryKey: string): Promise<OpenedExport>
  importExport(opened: OpenedExport): Promise<ImportReport>
  pushRecovered(transport: RecoveryTransport, oldDeviceId: string): Promise<RecoveredPushReport>
  markReconciled(exportId: string): Promise<void>
  recoveryStatus(): Promise<Awaited<ReturnType<typeof recoveryStatus>>>
  dispose(): void
}

export interface OpenOfflineVaultOptions {
  databaseName?: string
  /** Fournisseur IndexedDB (tests : `fake-indexeddb`). */
  indexedDB?: IDBFactory
  keyRange?: typeof IDBKeyRange
  kdfPolicy?: KdfPolicy
  storagePort?: StoragePort
  now?: () => number
}

export function openOfflineVault(options: OpenOfflineVaultOptions = {}): OfflineVault {
  const db = new VaultDatabase(options.databaseName ?? VAULT_DB_NAME, {
    ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
    ...(options.keyRange === undefined ? {} : { IDBKeyRange: options.keyRange }),
  })
  let vault: Vault | null = null
  const self = (): Vault => {
    if (vault === null) throw new Error('Coffre non initialisé')
    return vault
  }
  vault = new Vault({
    db,
    channel: broadcastChannel(),
    ...(options.kdfPolicy === undefined ? {} : { kdfPolicy: options.kdfPolicy }),
    ...(options.now === undefined ? {} : { now: options.now }),
    grantCheck: pinnedGrantCheck(
      () => self().serverKeys(),
      () => self().clinicId(),
    ),
  })
  const now = options.now ?? (() => Date.now())
  const roundTrip = async (): Promise<boolean> => {
    const probe = `${now()}`
    await db.vault_meta.put({ key: 'storage_probe', value: probe })
    const read = await db.vault_meta.get('storage_probe')
    await db.vault_meta.delete('storage_probe')
    return read?.value === probe
  }
  const port = options.storagePort ?? browserStoragePort(roundTrip)

  return {
    status: () => self().status(),
    session: () => self().session(),
    profiles: () => self().profiles(),
    deviceId: () => self().deviceId(),
    clinicId: () => self().clinicId(),
    noteClinic: (clinic) => self().noteClinic({ ...clinic }),
    clinic: async () => clinicSummaryOf(await self().clinicSummary()),
    prepareVault: (input) => self().prepareVault(input),
    unlock: (profileId, secret) => self().unlock(profileId, secret),
    lock: (reason) => self().lock(reason),
    addProfile: (actor, profile, holderSecret) => self().addProfile(actor, profile, holderSecret),
    changeSecret: (profileId, current, next) => self().changeSecret(profileId, current, next),
    resetSecretWithRecovery: (recovery, profileId, next) =>
      self().resetSecretWithRecovery(recovery, profileId, next),
    removeProfile: (actor, profileId) => self().removeProfile(actor, profileId),
    verifyRecoveryKey: (recovery) => self().verifyRecoveryKey(recovery),
    storageHealth: () => storageHealth(port),
    createSigningKey: (actor) => self().createSigningKey(actor),
    enrollmentBody: (input) => enrollmentBody(self(), input),
    bindDevice: (deviceId) => self().bindDevice(deviceId),
    pinServerKeys: (keys) => self().pinServerKeys(keys),
    noteServerTime: (serverIso) => self().noteServerTime(serverIso),
    acceptGrant: (grant) => acceptGrant(self(), grant, new Date(now()).toISOString()),
    grants: async () =>
      (await self().grants()).map((row) => ({
        grantId: row.grantId,
        userId: row.userId,
        clinicId: typeof row.claims['clinic_id'] === 'string' ? row.claims['clinic_id'] : null,
        permissions: Array.isArray(row.claims['permissions'])
          ? row.claims['permissions'].filter((code): code is string => typeof code === 'string')
          : [],
        compartments: (Array.isArray(row.claims['compartments'])
          ? row.claims['compartments']
          : []) as Compartment[],
        validUntil: row.validUntil,
      })),
    documentStore: (storeOptions = {}) => new VaultDocumentStore(self(), storeOptions),
    storePreparation: (preparation) =>
      storePreparation(self(), preparation, new Date(now()).toISOString()),
    localCommands: (busOptions) => {
      const bus = new LocalCommandBus(self(), { timeZone: busOptions.timeZone, now })
      return {
        handles: (request) => bus.handles(request),
        commit: (request) => bus.commit(request),
        refresh: () => bus.refresh(),
        readiness: () => bus.readinessSnapshot(),
      }
    },
    journal: () => {
      const journal = new CommandJournal(self())
      return {
        head: () => journal.head(),
        pendingCount: async () => (await journal.pending(Number.MAX_SAFE_INTEGER)).length,
        waitingCompartments: () => journal.waitingCompartments(),
      }
    },
    sync: (syncOptions) => {
      const engine = new SyncEngine(self(), { transport: syncOptions.transport, now })
      return {
        syncNow: () => engine.syncNow(),
        summary: () => engine.summary(),
        issues: () => engine.issues(),
        pulled: (compartment, entityType, entityId) =>
          pulledRecord(self(), compartment, entityType, entityId),
      }
    },
    localFacts: (compartment) => localFacts(self(), compartment),
    localHeads: (headType) => localHeads(self(), headType),
    catalogSnapshot: async () =>
      (await self().getEntity<unknown>('catalog_snapshot', 'current'))?.value ?? null,
    pulledRecords: (compartment, entityType, ids) =>
      pulledRecords(self(), compartment, entityType, ids ?? null),
    lastPullAt: () => lastPullAt(self()),
    onBeforeLock: (hook) => self().onBeforeLock(hook),
    touch: () => self().touch(),
    checkInactivity: () => self().checkInactivity(),
    updateReadiness: async (compatibility) => {
      const estimate = await port.estimate().catch(() => ({ quota: null, usage: null }))
      return updateReadiness(self(), compatibility, estimate, now())
    },
    exportDevice: (release) => exportDevice(self(), { release, now }),
    openExport: (text, recoveryKey) => openExport(text, recoveryKey),
    importExport: (opened) => importExport(self(), opened, now),
    pushRecovered: (transport, oldDeviceId) => pushRecovered(self(), transport, oldDeviceId, now),
    markReconciled: (exportId) => markReconciled(self(), exportId, now),
    recoveryStatus: () => recoveryStatus(self()),
    dispose: () => {
      self().dispose()
      db.close()
    },
  }
}

/** Résumé du cabinet relu depuis le coffre : forme contrôlée, jamais crue (une valeur altérée rend null). */
function clinicSummaryOf(value: Record<string, unknown> | null): ClinicSummary | null {
  if (value === null) return null
  const text = (field: string): string | null =>
    typeof value[field] === 'string' && value[field] !== '' ? (value[field] as string) : null
  const id = text('id')
  const name = text('name')
  const timezone = text('timezone')
  const modules = value['enabled_modules']
  if (id === null || name === null || timezone === null) return null
  if (!Array.isArray(modules) || !modules.every((code) => typeof code === 'string')) return null
  if (typeof value['production_documents_enabled'] !== 'boolean') return null
  return {
    id,
    name,
    timezone,
    currency: 'XAF',
    production_documents_enabled: value['production_documents_enabled'],
    enabled_modules: [...(modules as string[])],
    exam_fee_control: value['exam_fee_control'] === 'BILLED' ? 'BILLED' : 'OFF',
  }
}

/**
 * Le coffre de CE navigateur existe-t-il déjà ? Répond sans l'ouvrir ni le créer (`indexedDB.databases()`), pour que
 * l'application décide au démarrage, serveur injoignable compris, d'afficher le déverrouillage (D27). Un navigateur
 * qui ne sait pas lister ses bases répond non : l'application suit alors le flux d'avant (module ouvert par le serveur).
 */
export async function vaultDatabaseExists(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
  name: string = VAULT_DB_NAME,
): Promise<boolean> {
  if (factory === undefined || typeof factory.databases !== 'function') return false
  try {
    return (await factory.databases()).some((database) => database.name === name)
  } catch {
    return false
  }
}

/** Secret local proposé (4 mots de 5 lettres) et contrôle d'un secret saisi (D8), sans aucun stockage. */
export const localSecrets = { generatePassphrase, secretProblem } as const
export type { SecretProblem }

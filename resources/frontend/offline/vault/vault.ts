import {
  type Compartment,
  COMPARTMENTS,
  compartmentsOf,
  ENTITY_COMPARTMENTS,
  isCompartment,
} from '../compartments'
import { type AadPart } from '../crypto/aad'
import { openJson, type Sealed, sealJson, open, seal } from '../crypto/aead'
import {
  equalBytes,
  fromBase64Url,
  type RandomBytes,
  toBase64Url,
  webRandom,
} from '../crypto/bytes'
import {
  assertKdfParams,
  checkKcv,
  deriveProfileKek,
  deriveRecoveryKek,
  generateCompartmentKey,
  type KdfParams,
  KdfParamsRejected,
  type KdfPolicy,
  makeKcv,
  PRODUCTION_KDF_POLICY,
  unwrapAesKey,
  unwrapSigningKey,
  wrap,
} from '../crypto/kdf'
import { generateRecoveryKey, parseRecoveryKey, secretProblem } from '../crypto/secrets'
import { type SelfTestOutcome, webCryptoSelfTest } from '../crypto/selftest'
import { type PublicJwk, signCompact, thumbprint } from '../signing/jws'
import { newUlid } from '../../domain/values/ulid'

import {
  type DocumentRow,
  type DraftRow,
  type EntityRow,
  type EnvelopeRow,
  type EnvelopeSlot,
  type EventRow,
  type GrantRow,
  type JournalRow,
  type ProfileRow,
  type RecoveredCommandRow,
  type SealedRow,
  VAULT_FORMAT_VERSION,
  VAULT_MIN_WRITER_VERSION,
  type VaultDatabase,
} from './db'
import { VaultError } from './errors'

/**
 * Coffre local chiffré du poste (O01, `docs/implementation/vault.md` — la conception v2 fait foi ; les numéros D…
 * renvoient à son registre des décisions).
 *
 * Principes appliqués ici :
 *  - une clé AES-GCM aléatoire par compartiment (`keyId` 1 au départ), enveloppée par profil (KEK dérivée du secret
 *    local) et par la clé de récupération de la gérante ; la clé de signature ES256 du poste est enveloppée pour
 *    chaque profil qui signe (D19), jamais pour la récupération ;
 *  - en session : clés NON extractables seulement (D1) ; toute ré-enveloppe exige de ressaisir un secret ;
 *  - trois phases (D2) : calculs Web Crypto hors transaction, vérification en mémoire, puis UNE transaction Dexie
 *    qui ne fait qu'écrire des lignes prêtes et revérifie la session (comparaison d'époque) ;
 *  - tentatives limitées (D10), session persistée et plusieurs onglets (D11), verrouillage (D12), inactivité (D13) ;
 *  - un profil n'ouvre que les compartiments dont il détient l'enveloppe ET que son grant signé accorde (O02) : un
 *    grant altéré refuse l'ouverture ; sans grant valide, la session est en lecture seule.
 *
 * Aucune méthode n'expose une table ni une `CryptoKey` : la façade `offline/api.ts` est seule importée par l'app.
 */
export type VaultStatus = 'absent' | 'locked' | 'unlocked' | 'damaged' | 'too-new'

export type SessionAuthority =
  /** Coffre pas encore lié à un poste enrôlé : préparation par la gérante seulement. */
  | 'preparation'
  /** Grant signé valide : autorité locale bornée (les écritures arriveront avec O04). */
  | 'granted'
  /** Grant absent ou expiré : lecture des données déjà présentes, aucune nouvelle opération sensible. */
  | 'read-only'
  /** Horloge du poste antérieure à la dernière heure du serveur connue : opérations datées bloquées. */
  | 'clock-suspect'

export interface SessionInfo {
  sessionId: string
  profileId: string
  userId: string
  displayName: string
  compartments: Compartment[]
  canSign: boolean
  authority: SessionAuthority
  grantId: string | null
}

export interface ProfileSummary {
  profileId: string
  userId: string
  login: string
  displayName: string
  /** Instant (ms) avant lequel aucune tentative n'est admise, sinon null. */
  blockedUntil: number | null
}

export interface ProfileInput {
  userId: string
  login: string
  displayName: string
  /** Permissions EFFECTIVES du compte (celles de son grant signé quand il existe). */
  permissions: readonly string[]
}

export interface PreparedRecovery {
  /** Clé de récupération à faire noter par la gérante, HORS du poste. Elle n'est plus jamais affichée ensuite. */
  recoveryKey: string
  /** Écrit seulement si la clé ressaisie est exactement celle affichée (D9). */
  commit(recoveryInput: string): Promise<void>
}

export interface GrantCheck {
  /** Grants enregistrés pour ce compte et ce poste ; rend le premier valide et l'autorité qui en découle. */
  evaluate(
    rows: readonly GrantRow[],
    userId: string,
    deviceId: string,
    now: number,
  ): Promise<{
    grant: GrantRow | null
    compartments: Compartment[] | null
    authority: SessionAuthority
    invalid: boolean
  }>
}

export interface VaultChannel {
  post(message: VaultBroadcast): void
  subscribe(handler: (message: VaultBroadcast) => void): () => void
}

export type VaultBroadcast =
  | { type: 'lock'; sessionId: string; reason: string }
  | { type: 'session-started'; sessionId: string; profileId: string }
  | { type: 'profiles-changed' }

export interface VaultDeps {
  db: VaultDatabase
  subtle?: SubtleCrypto
  random?: RandomBytes
  now?: () => number
  kdfPolicy?: KdfPolicy
  channel?: VaultChannel | null
  selfTest?: () => Promise<SelfTestOutcome>
  grantCheck?: GrantCheck
}

interface Identity {
  vaultId: string
  clinicId: string
  deviceId: string | null
  createdAt: string
}

interface SessionMeta {
  sessionId: string
  profileId: string
  startedAt: number
  endedAt: number | null
  endReason: string | null
  lastActivityAt: number
}

interface LiveSession {
  info: SessionInfo
  keys: Map<Compartment, CryptoKey>
  signingKey: CryptoKey | null
  epoch: number
}

const INACTIVITY_MS = 30 * 60 * 1000
const ACTIVITY_WRITE_MS = 15 * 1000
const CLOCK_BACK_TOLERANCE_MS = 60 * 1000
const LOCK_HOOK_MS = 2000

function sealedRow(sealed: Sealed): SealedRow {
  return { nonce: sealed.nonce, ciphertext: sealed.ciphertext }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function throttleUntil(failures: number, now: number): number | null {
  if (failures < 5) return null
  return now + Math.min(900, 30 * 2 ** (failures - 5)) * 1000
}

export class Vault {
  private readonly db: VaultDatabase
  private readonly subtle: SubtleCrypto
  private readonly random: RandomBytes
  private readonly now: () => number
  private readonly policy: KdfPolicy
  private readonly channel: VaultChannel | null
  private readonly selfTest: () => Promise<SelfTestOutcome>
  private readonly grantCheck: GrantCheck | null
  private live: LiveSession | null = null
  private epoch = 0
  private lastActivityWrite = 0
  private readonly lockHooks = new Set<() => Promise<void> | void>()
  private readonly unsubscribe: (() => void) | null

  constructor(deps: VaultDeps) {
    this.db = deps.db
    this.subtle = deps.subtle ?? globalThis.crypto.subtle
    this.random = deps.random ?? webRandom
    this.now = deps.now ?? (() => Date.now())
    this.policy = deps.kdfPolicy ?? PRODUCTION_KDF_POLICY
    this.channel = deps.channel ?? null
    this.selfTest = deps.selfTest ?? (() => webCryptoSelfTest(this.subtle))
    this.grantCheck = deps.grantCheck ?? null
    this.unsubscribe = this.channel?.subscribe((message) => void this.onBroadcast(message)) ?? null
  }

  dispose(): void {
    this.unsubscribe?.()
    this.live = null
  }

  // --- État ---------------------------------------------------------------------------------------------------

  async status(): Promise<VaultStatus> {
    let format: unknown
    let identity: unknown
    try {
      format = (await this.db.vault_meta.get('format'))?.value
      identity = (await this.db.vault_meta.get('identity'))?.value
    } catch {
      return 'damaged'
    }
    if (format === undefined && identity === undefined) return 'absent'
    if (!this.formatOk(format)) {
      return typeof format === 'object' && format !== null ? 'too-new' : 'damaged'
    }
    if (identity === undefined) return 'damaged'
    return this.live === null ? 'locked' : 'unlocked'
  }

  session(): SessionInfo | null {
    return this.live === null
      ? null
      : { ...this.live.info, compartments: [...this.live.info.compartments] }
  }

  async profiles(): Promise<ProfileSummary[]> {
    const rows = await this.db.profiles.toArray()
    return rows
      .filter((row) => row.state === 'ACTIVE')
      .map((row) => ({
        profileId: row.id,
        userId: row.userId,
        login: row.login,
        displayName: row.displayName,
        blockedUntil:
          row.attempts.blockedUntil !== null && row.attempts.blockedUntil > this.now()
            ? row.attempts.blockedUntil
            : null,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'fr'))
  }

  async deviceId(): Promise<string | null> {
    return (await this.identity()).deviceId
  }

  async clinicId(): Promise<string> {
    return (await this.identity()).clinicId
  }

  // --- Création (D9 : deux phases) -----------------------------------------------------------------------------

  async prepareVault(input: {
    clinicId: string
    profile: ProfileInput
    secret: string
  }): Promise<PreparedRecovery> {
    await this.assertSelfTest()
    if ((await this.status()) !== 'absent') throw new VaultError('VAULT_ALREADY_EXISTS')
    if (secretProblem(input.secret, input.profile.login) !== null)
      throw new VaultError('SECRET_TOO_WEAK')
    const compartments = compartmentsOf(input.profile.permissions)
    if (!compartments.includes('MANAGER')) throw new VaultError('COMPARTMENT_NOT_AVAILABLE')

    // Phase A : toute la cryptographie, hors transaction.
    const vaultId = newUlid()
    const profileId = newUlid()
    const createdAt = iso(this.now())
    const keys = new Map<Compartment, CryptoKey>()
    for (const compartment of COMPARTMENTS)
      keys.set(compartment, await generateCompartmentKey(this.deps()))
    const salt = this.random(16)
    const kdf: KdfParams = {
      salt: toBase64Url(salt),
      iterations: this.policy.defaultIterations,
      normalization: 'NFKC',
    }
    const kek = await deriveProfileKek(input.secret, salt, kdf.iterations, this.deps())
    const kcv = await makeKcv(kek, this.kcvAad(vaultId, profileId, 1), this.deps())
    const recovery = await generateRecoveryKey(this.random, this.subtle)
    const recoveryKek = await deriveRecoveryKek(recovery.bytes, vaultId, this.deps())
    const envelopes: EnvelopeRow[] = []
    for (const compartment of COMPARTMENTS) {
      const key = keys.get(compartment)
      if (key === undefined) continue
      if (compartments.includes(compartment)) {
        envelopes.push(
          await this.envelope(
            key,
            kek,
            input.clinicId,
            vaultId,
            profileId,
            compartment,
            1,
            'raw',
            1,
          ),
        )
      }
      envelopes.push(
        await this.envelope(
          key,
          recoveryKek.kek,
          input.clinicId,
          vaultId,
          'RECOVERY',
          compartment,
          1,
          'raw',
          1,
        ),
      )
    }
    keys.clear()

    // Phase B : chaque enveloppe candidate s'ouvre avec sa KEK.
    for (const envelope of envelopes) {
      const owner = envelope.profileId === 'RECOVERY' ? recoveryKek.kek : kek
      await this.unwrapEnvelope(envelope, owner, input.clinicId, vaultId, false)
    }

    const profile: ProfileRow = {
      id: profileId,
      userId: input.profile.userId,
      login: input.profile.login,
      displayName: input.profile.displayName,
      state: 'ACTIVE',
      kdf,
      kekVersion: 1,
      kcv: sealedRow(kcv),
      attempts: { failures: 0, blockedUntil: null },
      createdAt,
      updatedAt: createdAt,
    }
    const shown = recovery.text
    return {
      recoveryKey: shown,
      commit: async (recoveryInput: string) => {
        const typed = await parseRecoveryKey(recoveryInput, this.subtle)
        if (typed === null || !equalBytes(typed, recovery.bytes))
          throw new VaultError('RECOVERY_KEY_MISMATCH')
        // Phase C : une seule transaction ; un coffre créé entre-temps (autre onglet) l'emporte.
        await this.db.transaction(
          'rw',
          [this.db.vault_meta, this.db.profiles, this.db.key_envelopes, this.db.vault_events],
          async () => {
            if ((await this.db.vault_meta.get('identity')) !== undefined)
              throw new VaultError('VAULT_ALREADY_EXISTS')
            await this.db.vault_meta.bulkPut([
              {
                key: 'format',
                value: {
                  formatVersion: VAULT_FORMAT_VERSION,
                  minWriterVersion: VAULT_MIN_WRITER_VERSION,
                },
              },
              {
                key: 'identity',
                value: {
                  vaultId,
                  clinicId: input.clinicId,
                  deviceId: null,
                  createdAt,
                } satisfies Identity,
              },
              {
                key: 'keys',
                value: Object.fromEntries(COMPARTMENTS.map((compartment) => [compartment, 1])),
              },
              {
                key: 'recovery',
                value: { verifier: recoveryKek.verifier, ackedAt: iso(this.now()), generation: 1 },
              },
            ])
            await this.db.profiles.add(profile)
            await this.db.key_envelopes.bulkAdd(envelopes)
            await this.event('vault_created', profileId, {})
          },
        )
      },
    }
  }

  // --- Déverrouillage, verrouillage ----------------------------------------------------------------------------

  async unlock(profileId: string, secret: string): Promise<SessionInfo> {
    const status = await this.status()
    if (status === 'absent') throw new VaultError('VAULT_ABSENT')
    if (status === 'too-new') throw new VaultError('VAULT_FORMAT_TOO_NEW')
    if (status === 'damaged') throw new VaultError('VAULT_DAMAGED')
    const identity = await this.identity()
    const profile = await this.db.profiles.get(profileId)
    if (profile === undefined || profile.state !== 'ACTIVE') {
      // Même chemin de calcul qu'un profil connu : aucune information par la durée (D10).
      await deriveProfileKek(secret, this.random(16), this.policy.minIterations, this.deps())
      throw new VaultError('AUTH_FAILED')
    }
    await this.reserveAttempt(profileId)
    try {
      assertKdfParams(profile.kdf, this.policy)
    } catch (error) {
      if (error instanceof KdfParamsRejected) throw new VaultError('KDF_PARAMS_REJECTED')
      throw error
    }
    const kek = await deriveProfileKek(
      secret,
      fromBase64Url(profile.kdf.salt),
      profile.kdf.iterations,
      this.deps(),
    )
    if (
      !(await checkKcv(
        kek,
        profile.kcv,
        this.kcvAad(identity.vaultId, profile.id, profile.kekVersion),
        this.deps(),
      ))
    ) {
      await this.recordFailure(profileId)
      throw new VaultError('AUTH_FAILED')
    }

    const envelopes = await this.db.key_envelopes.where('profileId').equals(profileId).toArray()
    const currentKeys = await this.keyIds()
    const keys = new Map<Compartment, CryptoKey>()
    let signingKey: CryptoKey | null = null
    for (const envelope of envelopes) {
      try {
        if (envelope.slot === 'DEVICE_SIGNING') {
          signingKey = await unwrapSigningKey(
            envelope.wrapped,
            kek,
            this.envelopeAad(identity, envelope),
            false,
            this.deps(),
          )
        } else if (currentKeys[envelope.slot] === envelope.keyId) {
          keys.set(
            envelope.slot,
            await this.unwrapEnvelope(envelope, kek, identity.clinicId, identity.vaultId, false),
          )
        }
      } catch {
        throw new VaultError('ENVELOPE_CORRUPT', { profileId, slot: envelope.slot })
      }
    }
    if (keys.size === 0) throw new VaultError('PROFILE_WITHOUT_COMPARTMENT')

    // Grant signé du serveur (O02) : vérifié AVANT d'ouvrir un compartiment.
    let authority: SessionAuthority = 'preparation'
    let grantId: string | null = null
    if (identity.deviceId !== null) {
      const rows = await this.db.grants.where('userId').equals(profile.userId).toArray()
      const verdict =
        this.grantCheck === null
          ? {
              grant: null,
              compartments: null,
              authority: 'read-only' as SessionAuthority,
              invalid: false,
            }
          : await this.grantCheck.evaluate(rows, profile.userId, identity.deviceId, this.now())
      if (verdict.invalid) {
        keys.clear()
        await this.event('grant_refused', profileId, {})
        throw new VaultError('GRANT_INVALID')
      }
      authority = verdict.authority
      grantId = verdict.grant?.grantId ?? null
      if (verdict.compartments !== null) {
        for (const compartment of [...keys.keys()]) {
          if (!verdict.compartments.includes(compartment)) keys.delete(compartment)
        }
        if (keys.size === 0) throw new VaultError('PROFILE_WITHOUT_COMPARTMENT')
      }
    }
    const lastServer = (await this.db.vault_meta.get('server_time'))?.value
    if (typeof lastServer === 'string' && this.now() < Date.parse(lastServer) - 5 * 60 * 1000) {
      authority = 'clock-suspect'
    }

    const now = this.now()
    const sessionId = newUlid(now)
    await this.db.transaction(
      'rw',
      [this.db.vault_meta, this.db.profiles, this.db.vault_events],
      async () => {
        const previous = (await this.db.vault_meta.get('session'))?.value as SessionMeta | undefined
        const current = await this.db.profiles.get(profileId)
        if (current === undefined || current.state !== 'ACTIVE')
          throw new VaultError('PROFILE_NOT_FOUND')
        await this.db.profiles.put({
          ...current,
          attempts: { failures: 0, blockedUntil: null },
          updatedAt: iso(now),
        })
        if (
          previous !== undefined &&
          previous.endedAt === null &&
          previous.profileId !== profileId
        ) {
          await this.event('session_superseded', previous.profileId, {})
        }
        const meta: SessionMeta = {
          sessionId,
          profileId,
          startedAt: now,
          endedAt: null,
          endReason: null,
          lastActivityAt: now,
        }
        await this.db.vault_meta.put({ key: 'session', value: meta })
        await this.event('unlocked', profileId, { authority })
      },
    )

    this.epoch += 1
    this.live = {
      info: {
        sessionId,
        profileId,
        userId: profile.userId,
        displayName: profile.displayName,
        compartments: COMPARTMENTS.filter((compartment) => keys.has(compartment)),
        canSign: signingKey !== null,
        authority,
        grantId,
      },
      keys,
      signingKey,
      epoch: this.epoch,
    }
    this.lastActivityWrite = now
    this.channel?.post({ type: 'session-started', sessionId, profileId })
    return this.session() as SessionInfo
  }

  /** Crochet appelé avant le verrouillage (2 s au plus) : enregistrer les brouillons ouverts (D12, D22). */
  onBeforeLock(hook: () => Promise<void> | void): () => void {
    this.lockHooks.add(hook)
    return () => this.lockHooks.delete(hook)
  }

  /**
   * Verrouille : l'intention est immédiate (époque), les opérations en vol rejettent `VAULT_LOCKED`, les crochets ont
   * 2 s, puis les références aux clés disparaissent. La mémoire physique n'est pas effacée (limite déclarée).
   */
  async lock(reason: string, broadcast = true): Promise<void> {
    const live = this.live
    if (live === null) return
    this.epoch += 1
    await Promise.race([
      Promise.allSettled([...this.lockHooks].map((hook) => Promise.resolve().then(hook))),
      new Promise((resolve) => setTimeout(resolve, LOCK_HOOK_MS)),
    ])
    this.live = null
    live.keys.clear()
    try {
      await this.db.transaction('rw', [this.db.vault_meta, this.db.vault_events], async () => {
        const meta = (await this.db.vault_meta.get('session'))?.value as SessionMeta | undefined
        if (meta !== undefined && meta.sessionId === live.info.sessionId && meta.endedAt === null) {
          await this.db.vault_meta.put({
            key: 'session',
            value: { ...meta, endedAt: this.now(), endReason: reason },
          })
        }
        await this.event('locked', live.info.profileId, { reason })
      })
    } finally {
      if (broadcast) this.channel?.post({ type: 'lock', sessionId: live.info.sessionId, reason })
    }
  }

  /** Activité de la personne (frappe, clic) : persistée au plus toutes les 15 s (D13). */
  async touch(): Promise<void> {
    const live = this.live
    const now = this.now()
    if (live === null || now - this.lastActivityWrite < ACTIVITY_WRITE_MS) return
    this.lastActivityWrite = now
    const meta = (await this.db.vault_meta.get('session'))?.value as SessionMeta | undefined
    if (meta !== undefined && meta.sessionId === live.info.sessionId && meta.endedAt === null) {
      await this.db.vault_meta.put({ key: 'session', value: { ...meta, lastActivityAt: now } })
    }
  }

  /**
   * À appeler périodiquement et au retour du focus : verrouille après 30 minutes sans activité (tous onglets
   * confondus, l'horodatage est persisté), ou si l'horloge du poste recule (D13). Rend la raison, ou null.
   */
  async checkInactivity(): Promise<string | null> {
    const live = this.live
    if (live === null) return null
    const meta = (await this.db.vault_meta.get('session'))?.value as SessionMeta | undefined
    const now = this.now()
    if (meta === undefined || meta.sessionId !== live.info.sessionId || meta.endedAt !== null) {
      await this.lock('SESSION_ENDED', false)
      return 'SESSION_ENDED'
    }
    if (now < meta.lastActivityAt - CLOCK_BACK_TOLERANCE_MS) {
      await this.lock('CLOCK')
      return 'CLOCK'
    }
    if (now - meta.lastActivityAt >= INACTIVITY_MS) {
      await this.lock('INACTIVITY')
      return 'INACTIVITY'
    }
    return null
  }

  // --- Profils (D1 : ressaisie du secret de l'acteur) ----------------------------------------------------------

  async addProfile(
    actor: { profileId: string; secret: string },
    input: ProfileInput,
    holderSecret: string,
  ): Promise<string> {
    const identity = await this.identity()
    const needed = compartmentsOf(input.permissions)
    if (needed.length === 0) throw new VaultError('PROFILE_WITHOUT_COMPARTMENT')
    if (secretProblem(holderSecret, input.login) !== null) throw new VaultError('SECRET_TOO_WEAK')
    const existing = await this.db.profiles.where('userId').equals(input.userId).toArray()
    if (existing.some((row) => row.state === 'ACTIVE')) throw new VaultError('PROFILE_EXISTS')

    const actorKek = await this.stepUp(actor.profileId, actor.secret)
    const actorEnvelopes = await this.db.key_envelopes
      .where('profileId')
      .equals(actor.profileId)
      .toArray()
    const currentKeys = await this.keyIds()
    const profileId = newUlid()
    const salt = this.random(16)
    const kdf: KdfParams = {
      salt: toBase64Url(salt),
      iterations: this.policy.defaultIterations,
      normalization: 'NFKC',
    }
    const holderKek = await deriveProfileKek(holderSecret, salt, kdf.iterations, this.deps())
    const kcv = await makeKcv(holderKek, this.kcvAad(identity.vaultId, profileId, 1), this.deps())

    const envelopes: EnvelopeRow[] = []
    for (const compartment of needed) {
      const source = actorEnvelopes.find(
        (row) => row.slot === compartment && row.keyId === currentKeys[compartment],
      )
      if (source === undefined) throw new VaultError('COMPARTMENT_NOT_AVAILABLE')
      const extractable = await this.unwrapEnvelope(
        source,
        actorKek,
        identity.clinicId,
        identity.vaultId,
        true,
      )
      envelopes.push(
        await this.envelope(
          extractable,
          holderKek,
          identity.clinicId,
          identity.vaultId,
          profileId,
          compartment,
          source.keyId,
          'raw',
          1,
        ),
      )
    }
    const signing = actorEnvelopes.find((row) => row.slot === 'DEVICE_SIGNING')
    if (signing !== undefined) {
      const extractable = await unwrapSigningKey(
        signing.wrapped,
        actorKek,
        this.envelopeAad(identity, signing),
        true,
        this.deps(),
      )
      envelopes.push(
        await this.envelope(
          extractable,
          holderKek,
          identity.clinicId,
          identity.vaultId,
          profileId,
          'DEVICE_SIGNING',
          signing.keyId,
          'pkcs8',
          1,
        ),
      )
    }
    // Phase B : la nouvelle personne ouvrira bien ses enveloppes.
    for (const envelope of envelopes) await this.verifyEnvelope(envelope, holderKek, identity)

    const now = iso(this.now())
    await this.db.transaction(
      'rw',
      [this.db.profiles, this.db.key_envelopes, this.db.vault_events],
      async () => {
        const again = await this.db.profiles.where('userId').equals(input.userId).toArray()
        if (again.some((row) => row.state === 'ACTIVE')) throw new VaultError('PROFILE_EXISTS')
        await this.db.profiles.add({
          id: profileId,
          userId: input.userId,
          login: input.login,
          displayName: input.displayName,
          state: 'ACTIVE',
          kdf,
          kekVersion: 1,
          kcv: sealedRow(kcv),
          attempts: { failures: 0, blockedUntil: null },
          createdAt: now,
          updatedAt: now,
        })
        await this.db.key_envelopes.bulkAdd(envelopes)
        await this.event('profile_added', actor.profileId, {
          profile: profileId,
          compartments: needed.join(','),
        })
      },
    )
    this.channel?.post({ type: 'profiles-changed' })
    return profileId
  }

  async changeSecret(profileId: string, current: string, next: string): Promise<void> {
    const profile = await this.activeProfile(profileId)
    if (secretProblem(next, profile.login) !== null) throw new VaultError('SECRET_TOO_WEAK')
    const kek = await this.stepUp(profileId, current)
    await this.rewrapProfile(profile, kek, next, 'secret_changed')
  }

  async resetSecretWithRecovery(
    recoveryInput: string,
    profileId: string,
    next: string,
  ): Promise<void> {
    const identity = await this.identity()
    const profile = await this.activeProfile(profileId)
    if (secretProblem(next, profile.login) !== null) throw new VaultError('SECRET_TOO_WEAK')
    const recoveryKek = await this.recoveryKek(recoveryInput, identity)
    const owned = await this.db.key_envelopes.where('profileId').equals(profileId).toArray()
    const recoveryRows = await this.db.key_envelopes.where('profileId').equals('RECOVERY').toArray()

    const salt = this.random(16)
    const kdf: KdfParams = {
      salt: toBase64Url(salt),
      iterations: this.policy.defaultIterations,
      normalization: 'NFKC',
    }
    const kekVersion = profile.kekVersion + 1
    const newKek = await deriveProfileKek(next, salt, kdf.iterations, this.deps())
    const kcv = await makeKcv(
      newKek,
      this.kcvAad(identity.vaultId, profileId, kekVersion),
      this.deps(),
    )
    const envelopes: EnvelopeRow[] = []
    for (const row of owned) {
      if (row.slot === 'DEVICE_SIGNING') continue // la clé du poste n'entre pas dans la récupération (D19)
      const source = recoveryRows.find(
        (candidate) => candidate.slot === row.slot && candidate.keyId === row.keyId,
      )
      if (source === undefined)
        throw new VaultError('ENVELOPE_CORRUPT', { profileId: 'RECOVERY', slot: row.slot })
      const extractable = await this.unwrapEnvelope(
        source,
        recoveryKek,
        identity.clinicId,
        identity.vaultId,
        true,
      )
      envelopes.push(
        await this.envelope(
          extractable,
          newKek,
          identity.clinicId,
          identity.vaultId,
          profileId,
          row.slot,
          row.keyId,
          'raw',
          kekVersion,
        ),
      )
    }
    for (const envelope of envelopes) await this.verifyEnvelope(envelope, newKek, identity)

    await this.db.transaction(
      'rw',
      [this.db.profiles, this.db.key_envelopes, this.db.vault_events],
      async () => {
        const fresh = await this.activeProfile(profileId)
        await this.db.key_envelopes.where('profileId').equals(profileId).delete()
        await this.db.key_envelopes.bulkAdd(envelopes)
        await this.db.profiles.put({
          ...fresh,
          kdf,
          kekVersion,
          kcv: sealedRow(kcv),
          attempts: { failures: 0, blockedUntil: null },
          updatedAt: iso(this.now()),
        })
        await this.event('secret_reset_with_recovery', profileId, {
          signing_key_dropped: owned.some((row) => row.slot === 'DEVICE_SIGNING'),
        })
      },
    )
  }

  async removeProfile(
    actor: { profileId: string; secret: string },
    profileId: string,
  ): Promise<void> {
    await this.stepUp(actor.profileId, actor.secret)
    await this.db.transaction(
      'rw',
      [this.db.profiles, this.db.key_envelopes, this.db.vault_events],
      async () => {
        const target = await this.activeProfile(profileId)
        const managers = (await this.db.key_envelopes.toArray())
          .filter((row) => row.slot === 'MANAGER' && row.profileId !== 'RECOVERY')
          .map((row) => row.profileId)
        const remaining = new Set(managers.filter((id) => id !== profileId))
        const activeRemaining = (await this.db.profiles.bulkGet([...remaining])).filter(
          (row) => row?.state === 'ACTIVE',
        )
        if (managers.includes(profileId) && activeRemaining.length === 0)
          throw new VaultError('LAST_MANAGER_REQUIRED')
        await this.db.key_envelopes.where('profileId').equals(profileId).delete()
        await this.db.profiles.put({ ...target, state: 'REMOVED', updatedAt: iso(this.now()) })
        await this.event('profile_removed', actor.profileId, {
          profile: profileId,
          rotation_required: true,
        })
      },
    )
    if (this.live?.info.profileId === profileId) await this.lock('PROFILE_REMOVED')
    this.channel?.post({ type: 'profiles-changed' })
  }

  async verifyRecoveryKey(recoveryInput: string): Promise<boolean> {
    try {
      await this.recoveryKek(recoveryInput, await this.identity())
      return true
    } catch {
      return false
    }
  }

  // --- Poste enrôlé et signature (O02) ---------------------------------------------------------------------------

  /** Lie le coffre au `device_id` attribué par le serveur (une seule fois). */
  async bindDevice(deviceId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.vault_meta, this.db.vault_events], async () => {
      const identity = (await this.db.vault_meta.get('identity'))?.value as Identity | undefined
      if (identity === undefined) throw new VaultError('VAULT_ABSENT')
      if (identity.deviceId !== null && identity.deviceId !== deviceId)
        throw new VaultError('DEVICE_ALREADY_BOUND')
      await this.db.vault_meta.put({ key: 'identity', value: { ...identity, deviceId } })
      await this.event('device_bound', this.live?.info.profileId ?? null, { device: deviceId })
    })
  }

  /**
   * Crée la paire ES256 du poste (D19) : clé privée enveloppée pour le profil qui la crée (secret ressaisi), jamais
   * pour la récupération ; clé publique conservée en clair pour l'enrôlement. Les autres profils la reçoivent à leur
   * ajout. Refuse une seconde paire.
   */
  async createSigningKey(actor: { profileId: string; secret: string }): Promise<PublicJwk> {
    const identity = await this.identity()
    if ((await this.db.vault_meta.get('signing_public')) !== undefined)
      throw new VaultError('DEVICE_ALREADY_BOUND')
    const kek = await this.stepUp(actor.profileId, actor.secret)
    const pair = await this.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    const exported = (await this.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    const publicJwk: PublicJwk = {
      kty: 'EC',
      crv: 'P-256',
      x: String(exported.x),
      y: String(exported.y),
    }
    const envelope = await this.envelope(
      pair.privateKey,
      kek,
      identity.clinicId,
      identity.vaultId,
      actor.profileId,
      'DEVICE_SIGNING',
      1,
      'pkcs8',
      (await this.activeProfile(actor.profileId)).kekVersion,
    )
    await this.verifyEnvelope(envelope, kek, identity)
    await this.db.transaction(
      'rw',
      [this.db.vault_meta, this.db.key_envelopes, this.db.vault_events],
      async () => {
        if ((await this.db.vault_meta.get('signing_public')) !== undefined)
          throw new VaultError('DEVICE_ALREADY_BOUND')
        await this.db.vault_meta.put({ key: 'signing_public', value: publicJwk })
        await this.db.key_envelopes.put(envelope)
        await this.event('signing_key_created', actor.profileId, {})
      },
    )
    if (this.live?.info.profileId === actor.profileId) {
      this.live.signingKey = await unwrapSigningKey(
        envelope.wrapped,
        kek,
        this.envelopeAad(identity, envelope),
        false,
        this.deps(),
      )
      this.live.info.canSign = true
    }
    return publicJwk
  }

  async signingPublicKey(): Promise<PublicJwk | null> {
    return (
      ((await this.db.vault_meta.get('signing_public'))?.value as PublicJwk | undefined) ?? null
    )
  }

  /** Signe un JWS compact avec la clé du poste de la session ouverte (jamais exposée). */
  async signJws(payload: Record<string, unknown>, kid: string, type: string): Promise<string> {
    const live = this.requireLive()
    if (live.signingKey === null) throw new VaultError('SIGNING_KEY_ABSENT')
    const result = await signCompact(payload, live.signingKey, kid, type, { subtle: this.subtle })
    this.assertEpoch(live)
    return result
  }

  async storeGrant(row: GrantRow): Promise<void> {
    await this.db.transaction('rw', [this.db.grants, this.db.vault_events], async () => {
      await this.db.grants.put(row)
      await this.event('grant_stored', this.live?.info.profileId ?? null, {
        grant: row.grantId,
        user: row.userId,
      })
    })
  }

  async grants(): Promise<GrantRow[]> {
    return this.db.grants.toArray()
  }

  async pinServerKeys(
    keys: readonly { kid: string; status: string; jwk: PublicJwk }[],
  ): Promise<void> {
    await this.db.vault_meta.put({
      key: 'server_keys',
      value: keys.map((key) => ({ kid: key.kid, status: key.status, jwk: key.jwk })),
    })
  }

  async serverKeys(): Promise<{ kid: string; status: string; jwk: PublicJwk }[]> {
    const value = (await this.db.vault_meta.get('server_keys'))?.value
    return Array.isArray(value) ? (value as { kid: string; status: string; jwk: PublicJwk }[]) : []
  }

  /** Dernière heure du serveur connue (préparation) : un recul de l'horloge du poste au-delà rend la session suspecte. */
  async noteServerTime(serverIso: string): Promise<void> {
    await this.db.vault_meta.put({ key: 'server_time', value: serverIso })
  }

  /**
   * Résumé du cabinet lu à la dernière session serveur (nom, fuseau, modules ouverts…) : il permet d'ouvrir une session
   * locale quand le serveur est injoignable au démarrage (D27). Aucune donnée de santé ni secret ; écrit même coffre
   * verrouillé. La forme est contrôlée à la lecture : une valeur altérée est ignorée, jamais crue.
   */
  async noteClinic(summary: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.vault_meta.put({ key: 'clinic_summary', value: { ...summary } })
  }

  async clinicSummary(): Promise<Record<string, unknown> | null> {
    const value = (await this.db.vault_meta.get('clinic_summary'))?.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  }

  // --- Commit local (O04) : phase A hors transaction, phase C dans UNE transaction ----------------------------

  /**
   * Contexte d'une commande locale : identité du coffre, poste, session, dernière heure du serveur et `kid` du poste
   * (empreinte RFC 7638 de sa clé publique). Aucune clé n'est exposée.
   */
  async commandContext(): Promise<{
    clinicId: string
    vaultId: string
    deviceId: string | null
    session: SessionInfo
    serverTime: string | null
    kid: string | null
  }> {
    const live = this.requireLive()
    const identity = await this.identity()
    const publicJwk = await this.signingPublicKey()
    const serverTime = (await this.db.vault_meta.get('server_time'))?.value
    return {
      clinicId: identity.clinicId,
      vaultId: identity.vaultId,
      deviceId: identity.deviceId,
      session: { ...live.info, compartments: [...live.info.compartments] },
      serverTime: typeof serverTime === 'string' ? serverTime : null,
      kid: publicJwk === null ? null : await thumbprint(publicJwk, { subtle: this.subtle }),
    }
  }

  /** Grant de la session ouverte (permissions figées signées par le serveur), ou null. */
  async sessionGrant(): Promise<GrantRow | null> {
    const live = this.requireLive()
    if (live.info.grantId === null) return null
    return (await this.db.grants.get(live.info.grantId)) ?? null
  }

  /** Phase A : ligne d'entité scellée, PRÊTE à écrire (aucune écriture ici). */
  async sealEntityRow(
    type: string,
    entityId: string,
    version: number,
    value: unknown,
  ): Promise<EntityRow> {
    const live = this.requireLive()
    const compartment = this.compartmentOfType(type)
    const key = this.keyFor(live, compartment)
    const identity = await this.identity()
    const keyId = (await this.keyIds())[compartment]
    const sealed = await sealJson(
      key,
      value,
      'entity',
      [identity.clinicId, identity.vaultId, compartment, keyId, type, entityId, version],
      this.deps(),
    )
    this.assertEpoch(live)
    return {
      id: `${type}:${entityId}`,
      compartment,
      type,
      entityId,
      version,
      keyId,
      ...sealedRow(sealed),
    }
  }

  /** Phase A : charge d'une commande du journal scellée dans le compartiment de la commande (AAD « command »). */
  async sealCommandPayload(
    compartment: Compartment,
    commandId: string,
    deviceSequence: number,
    value: unknown,
  ): Promise<SealedRow & { keyId: number }> {
    const live = this.requireLive()
    const key = this.keyFor(live, compartment)
    const identity = await this.identity()
    const keyId = (await this.keyIds())[compartment]
    const sealed = await sealJson(
      key,
      value,
      'command',
      [
        identity.clinicId,
        identity.vaultId,
        compartment,
        keyId,
        'command',
        commandId,
        deviceSequence,
      ],
      this.deps(),
    )
    this.assertEpoch(live)
    return { ...sealedRow(sealed), keyId }
  }

  /** O05 : charge d'une commande du journal, si la session détient la clé de son compartiment. */
  async openCommandPayload<T>(row: JournalRow): Promise<T> {
    const live = this.requireLive()
    const key = this.keyFor(live, row.compartment)
    const identity = await this.identity()
    try {
      const value = await openJson<T>(
        key,
        row.payload,
        'command',
        [
          identity.clinicId,
          identity.vaultId,
          row.compartment,
          row.payload.keyId,
          'command',
          row.commandId,
          row.deviceSequence,
        ],
        this.deps(),
      )
      this.assertEpoch(live)
      return value
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'command_journal', id: row.commandId })
    }
  }

  /**
   * Phase C : UNE transaction Dexie sur le coffre, les ressources, le journal, les états et les têtes, qui revérifie
   * d'abord la session persistée (D11). `work` n'écrit que des lignes déjà prêtes et ne fait AUCUN appel Web Crypto ni
   * réseau (contrat 23) ; une exception annule tout. Réservé au moteur de commandes local (`offline/`).
   */
  async commitLocal<T>(work: (db: VaultDatabase) => Promise<T>): Promise<T> {
    const live = this.requireLive()
    if (live.info.authority !== 'granted') throw new VaultError('GRANT_REQUIRED')
    return this.db.transaction(
      'rw',
      [
        this.db.vault_meta,
        this.db.encrypted_entities,
        this.db.allocations,
        this.db.command_journal,
        this.db.command_status,
        this.db.aggregate_heads,
        this.db.pull_cursors,
        this.db.vault_events,
      ],
      async () => {
        await this.assertSession(live)
        return work(this.db)
      },
    )
  }

  /** Lecture hors transaction des tables du moteur local (ressources, journal, têtes, curseurs) ; jamais une clé. */
  localTables(): Pick<
    VaultDatabase,
    | 'allocations'
    | 'command_journal'
    | 'command_status'
    | 'aggregate_heads'
    | 'encrypted_entities'
    | 'pull_cursors'
  > {
    this.requireLive()
    return this.db
  }

  /** État du dernier échange avec le serveur (O05) : instant serveur du dernier succès, échec du dernier essai. */
  async syncStatus(): Promise<{ lastExchangeAt: string | null; lastAttemptFailed: boolean }> {
    const value = (await this.db.vault_meta.get('sync_status'))?.value as
      { lastExchangeAt?: unknown; lastAttemptFailed?: unknown } | undefined
    return {
      lastExchangeAt: typeof value?.lastExchangeAt === 'string' ? value.lastExchangeAt : null,
      lastAttemptFailed: value?.lastAttemptFailed === true,
    }
  }

  async noteSyncStatus(status: {
    lastExchangeAt: string | null
    lastAttemptFailed: boolean
  }): Promise<void> {
    await this.db.vault_meta.put({ key: 'sync_status', value: { ...status } })
  }

  /** Transaction des ressources préparées (O03) : écriture en clair, sans clé, session ouverte exigée. */
  async writeAllocations<T>(work: (db: VaultDatabase) => Promise<T>): Promise<T> {
    const live = this.requireLive()
    return this.db.transaction(
      'rw',
      [this.db.vault_meta, this.db.allocations, this.db.vault_events],
      async () => {
        await this.assertSession(live)
        return work(this.db)
      },
    )
  }

  // --- Données scellées -----------------------------------------------------------------------------------------

  async putEntity(type: string, entityId: string, version: number, value: unknown): Promise<void> {
    const live = this.requireLive()
    const row = await this.sealEntityRow(type, entityId, version, value)
    await this.db.transaction('rw', [this.db.vault_meta, this.db.encrypted_entities], async () => {
      await this.assertSession(live)
      const existing = await this.db.encrypted_entities.get(row.id)
      if (existing !== undefined && existing.version >= version)
        throw new VaultError('VERSION_NOT_NEWER')
      await this.db.encrypted_entities.put(row)
    })
  }

  async getEntity<T>(
    type: string,
    entityId: string,
  ): Promise<{ version: number; value: T } | null> {
    const live = this.requireLive()
    const compartment = this.compartmentOfType(type)
    const key = this.keyFor(live, compartment)
    const row = await this.db.encrypted_entities.get(`${type}:${entityId}`)
    if (row === undefined) return null
    const identity = await this.identity()
    if (row.compartment !== compartment || row.type !== type || row.entityId !== entityId) {
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'encrypted_entities', id: row.id })
    }
    try {
      const value = await openJson<T>(
        key,
        row,
        'entity',
        [identity.clinicId, identity.vaultId, compartment, row.keyId, type, entityId, row.version],
        this.deps(),
      )
      this.assertEpoch(live)
      return { version: row.version, value }
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'encrypted_entities', id: row.id })
    }
  }

  /** Entités d'un type, déchiffrées ; `idPrefix` : seules celles dont l'identifiant commence ainsi sont ouvertes. */
  async listEntities<T>(
    type: string,
    idPrefix = '',
  ): Promise<{ entityId: string; version: number; value: T }[]> {
    const compartment = this.compartmentOfType(type)
    this.keyFor(this.requireLive(), compartment)
    const rows = await this.db.encrypted_entities
      .where('[compartment+type]')
      .equals([compartment, type])
      .toArray()
    const out: { entityId: string; version: number; value: T }[] = []
    for (const row of rows) {
      if (!row.entityId.startsWith(idPrefix)) continue
      const entry = await this.getEntity<T>(type, row.entityId)
      if (entry !== null) out.push({ entityId: row.entityId, ...entry })
    }
    return out
  }

  /** Pièce PDF et ses métadonnées scellées séparément (`content` absent tant que le PDF n'est pas généré). */
  async putDocument(input: {
    id: string
    kind: string
    compartment: Compartment
    entityId: string | null
    version: number
    meta: unknown
    bytes: Uint8Array | null
  }): Promise<void> {
    const live = this.requireLive()
    const key = this.keyFor(live, input.compartment)
    const identity = await this.identity()
    const keyId = (await this.keyIds())[input.compartment]
    const aad = (part: string): AadPart[] => [
      identity.clinicId,
      identity.vaultId,
      input.compartment,
      keyId,
      input.kind,
      input.id,
      input.version,
      part,
    ]
    const meta = await sealJson(key, input.meta, 'document', aad('meta'), this.deps())
    const content =
      input.bytes === null
        ? null
        : await seal(key, input.bytes, 'document', aad('content'), this.deps())
    const row: DocumentRow = {
      id: input.id,
      compartment: input.compartment,
      kind: input.kind,
      entityId: input.entityId,
      version: input.version,
      keyId,
      meta: sealedRow(meta),
      content: content === null ? null : sealedRow(content),
    }
    await this.db.transaction('rw', [this.db.vault_meta, this.db.encrypted_documents], async () => {
      await this.assertSession(live)
      await this.db.encrypted_documents.put(row)
    })
  }

  async getDocument<M>(
    id: string,
  ): Promise<{ compartment: Compartment; meta: M; bytes: Uint8Array | null } | null> {
    const live = this.requireLive()
    const row = await this.db.encrypted_documents.get(id)
    if (row === undefined) return null
    const key = this.keyFor(live, row.compartment)
    const identity = await this.identity()
    const aad = (part: string): AadPart[] => [
      identity.clinicId,
      identity.vaultId,
      row.compartment,
      row.keyId,
      row.kind,
      row.id,
      row.version,
      part,
    ]
    try {
      const meta = await openJson<M>(key, row.meta, 'document', aad('meta'), this.deps())
      const bytes =
        row.content === null
          ? null
          : await open(key, row.content, 'document', aad('content'), this.deps())
      this.assertEpoch(live)
      return { compartment: row.compartment, meta, bytes }
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'encrypted_documents', id })
    }
  }

  /** Identifiants des pièces des compartiments ouverts par la session (index opaque seulement). */
  async documentIds(filter: { kind?: string; entityId?: string } = {}): Promise<string[]> {
    const live = this.requireLive()
    const rows = await this.db.encrypted_documents.toArray()
    return rows
      .filter((row) => live.keys.has(row.compartment))
      .filter((row) => filter.kind === undefined || row.kind === filter.kind)
      .filter((row) => filter.entityId === undefined || row.entityId === filter.entityId)
      .map((row) => row.id)
  }

  async deleteDocument(id: string): Promise<void> {
    const live = this.requireLive()
    await this.db.transaction('rw', [this.db.vault_meta, this.db.encrypted_documents], async () => {
      await this.assertSession(live)
      await this.db.encrypted_documents.delete(id)
    })
  }

  async putDraft(draftKey: string, compartment: Compartment, value: unknown): Promise<void> {
    const live = this.requireLive()
    const key = this.keyFor(live, compartment)
    const identity = await this.identity()
    const keyId = (await this.keyIds())[compartment]
    const id = `${live.info.profileId}:${draftKey}`
    const previous = await this.db.encrypted_drafts.get(id)
    const version = (previous?.version ?? 0) + 1
    const sealed = await sealJson(
      key,
      value,
      'draft',
      [
        identity.clinicId,
        identity.vaultId,
        compartment,
        keyId,
        live.info.profileId,
        draftKey,
        version,
      ],
      this.deps(),
    )
    const row: DraftRow = {
      id,
      profileId: live.info.profileId,
      compartment,
      version,
      keyId,
      savedAt: iso(this.now()),
      ...sealedRow(sealed),
    }
    await this.db.transaction('rw', [this.db.vault_meta, this.db.encrypted_drafts], async () => {
      await this.assertSession(live)
      await this.db.encrypted_drafts.put(row)
    })
  }

  async getDraft<T>(draftKey: string): Promise<{ savedAt: string; value: T } | null> {
    const live = this.requireLive()
    const id = `${live.info.profileId}:${draftKey}`
    const row = await this.db.encrypted_drafts.get(id)
    if (row === undefined) return null
    const key = this.keyFor(live, row.compartment)
    const identity = await this.identity()
    try {
      const value = await openJson<T>(
        key,
        row,
        'draft',
        [
          identity.clinicId,
          identity.vaultId,
          row.compartment,
          row.keyId,
          live.info.profileId,
          draftKey,
          row.version,
        ],
        this.deps(),
      )
      this.assertEpoch(live)
      return { savedAt: row.savedAt, value }
    } catch {
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'encrypted_drafts', id })
    }
  }

  async deleteDraft(draftKey: string): Promise<void> {
    const live = this.requireLive()
    await this.db.encrypted_drafts.delete(`${live.info.profileId}:${draftKey}`)
  }

  async listDrafts(): Promise<{ draftKey: string; compartment: Compartment; savedAt: string }[]> {
    const live = this.requireLive()
    const prefix = `${live.info.profileId}:`
    const rows = await this.db.encrypted_drafts.where('id').startsWith(prefix).toArray()
    return rows.map((row) => ({
      draftKey: row.id.slice(prefix.length),
      compartment: row.compartment,
      savedAt: row.savedAt,
    }))
  }

  async events(limit = 100): Promise<EventRow[]> {
    return (await this.db.vault_events.reverse().limit(limit).toArray()).reverse()
  }

  // --- Export et reprise d'un poste (O07) ------------------------------------------------------------------------

  /**
   * Matériel d'un export chiffré du poste : identité, versions de clés, vérificateur de la clé de récupération et
   * enveloppes `RECOVERY` (déjà scellées sous la KEK de récupération, détenue hors du poste par la gérante). Aucune
   * enveloppe de profil, ni clé de signature du poste, ni grant : un export ne clone aucun droit (D19).
   */
  async exportMaterial(): Promise<{
    identity: { vaultId: string; clinicId: string; deviceId: string | null; createdAt: string }
    keys: Record<Compartment, number>
    format: unknown
    recoveryVerifier: string
    recoveryEnvelopes: EnvelopeRow[]
    compartments: Compartment[]
  }> {
    const live = this.requireLive()
    const identity = await this.identity()
    const recovery = (await this.db.vault_meta.get('recovery'))?.value as
      { verifier?: unknown } | undefined
    if (typeof recovery?.verifier !== 'string') throw new VaultError('VAULT_DAMAGED')
    const recoveryEnvelopes = (
      await this.db.key_envelopes.where('profileId').equals('RECOVERY').toArray()
    ).filter((row) => row.slot !== 'DEVICE_SIGNING')
    return {
      identity: { ...identity },
      keys: await this.keyIds(),
      format: (await this.db.vault_meta.get('format'))?.value,
      recoveryVerifier: recovery.verifier,
      recoveryEnvelopes,
      compartments: [...live.keys.keys()],
    }
  }

  /**
   * Scelle la clé aléatoire d'un export (32 octets) sous une clé de compartiment de la session : elle ne se rouvre qu'avec
   * la même clé de compartiment, que seule la clé de récupération redonne hors de ce poste (enveloppe `RECOVERY`).
   * Préférence : MANAGER, FINANCIAL, ADMINISTRATIVE, CLINICAL (le premier ouvert par la session).
   */
  async sealExportKey(
    raw: Uint8Array,
    exportId: string,
    createdAt: string,
  ): Promise<{ compartment: Compartment; keyId: number; sealed: SealedRow }> {
    const live = this.requireLive()
    const compartment = (['MANAGER', 'FINANCIAL', 'ADMINISTRATIVE', 'CLINICAL'] as const).find(
      (candidate) => live.keys.has(candidate),
    )
    if (compartment === undefined) throw new VaultError('COMPARTMENT_NOT_AVAILABLE')
    const identity = await this.identity()
    const keyId = (await this.keyIds())[compartment]
    const sealed = await seal(
      this.keyFor(live, compartment),
      raw,
      'export',
      [identity.clinicId, identity.vaultId, compartment, keyId, 'export-key', exportId, createdAt],
      this.deps(),
    )
    this.assertEpoch(live)
    return { compartment, keyId, sealed: sealedRow(sealed) }
  }

  /**
   * Lignes exportées, telles que stockées (chiffrées par compartiment, métadonnées opaques) : entités, pièces, brouillons,
   * journal commun et états, têtes, ressources, profils (identité d'écran seulement), journal de sécurité, reprises.
   */
  async exportRows(): Promise<Record<string, unknown[]>> {
    this.requireLive()
    const profiles = (await this.db.profiles.toArray()).map((row) => ({
      id: row.id,
      userId: row.userId,
      login: row.login,
      displayName: row.displayName,
      state: row.state,
    }))
    return {
      encrypted_entities: await this.db.encrypted_entities.toArray(),
      encrypted_documents: await this.db.encrypted_documents.toArray(),
      encrypted_drafts: await this.db.encrypted_drafts.toArray(),
      command_journal: await this.db.command_journal.orderBy('deviceSequence').toArray(),
      command_status: await this.db.command_status.toArray(),
      aggregate_heads: await this.db.aggregate_heads.toArray(),
      allocations: await this.db.allocations.toArray(),
      profiles,
      vault_events: await this.db.vault_events.toArray(),
      recovered_exports: await this.db.recovered_exports.toArray(),
      recovered_commands: await this.db.recovered_commands.toArray(),
    }
  }

  /** Trace d'un export réalisé (instant, identifiant, commandes en attente) : lue avant une mise à jour (O06). */
  async noteExport(info: {
    exportId: string
    at: string
    pending: number
    bytes: number
  }): Promise<void> {
    const live = this.requireLive()
    await this.db.transaction('rw', [this.db.vault_meta, this.db.vault_events], async () => {
      await this.assertSession(live)
      await this.db.vault_meta.put({ key: 'last_export', value: { ...info } })
      await this.event('device_exported', live.info.profileId, {
        export: info.exportId,
        pending: info.pending,
        bytes: info.bytes,
      })
    })
  }

  /** Dernier export réalisé sur ce poste, ou null (lecture sans session : métadonnée non sensible). */
  async lastExport(): Promise<{ exportId: string; at: string; pending: number } | null> {
    const value = (await this.db.vault_meta.get('last_export'))?.value as
      { exportId?: unknown; at?: unknown; pending?: unknown } | undefined
    if (typeof value?.exportId !== 'string' || typeof value.at !== 'string') return null
    return {
      exportId: value.exportId,
      at: value.at,
      pending: typeof value.pending === 'number' ? value.pending : 0,
    }
  }

  /** Phase A : commande signée d'un ancien poste scellée dans CE coffre, compartiment d'origine (AAD « command »). */
  async sealRecoveredCommand(
    compartment: Compartment,
    commandId: string,
    value: unknown,
  ): Promise<{ keyId: number; sealed: SealedRow }> {
    const live = this.requireLive()
    const identity = await this.identity()
    const keyId = (await this.keyIds())[compartment]
    const sealed = await sealJson(
      this.keyFor(live, compartment),
      value,
      'command',
      [identity.clinicId, identity.vaultId, compartment, keyId, 'recovered', commandId],
      this.deps(),
    )
    this.assertEpoch(live)
    return { keyId, sealed: sealedRow(sealed) }
  }

  async openRecoveredCommand<T>(row: RecoveredCommandRow): Promise<T> {
    const live = this.requireLive()
    const identity = await this.identity()
    try {
      const value = await openJson<T>(
        this.keyFor(live, row.compartment),
        row.sealed,
        'command',
        [
          identity.clinicId,
          identity.vaultId,
          row.compartment,
          row.keyId,
          'recovered',
          row.commandId,
        ],
        this.deps(),
      )
      this.assertEpoch(live)
      return value
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError('ROW_DECRYPT_FAILED', { table: 'recovered_commands', id: row.commandId })
    }
  }

  /** Phase A : pièce d'un ancien poste rescellée dans CE coffre (mêmes identifiant, genre, version). */
  async sealDocumentRow(input: {
    id: string
    kind: string
    compartment: Compartment
    entityId: string | null
    version: number
    meta: unknown
    bytes: Uint8Array | null
  }): Promise<DocumentRow> {
    const live = this.requireLive()
    const key = this.keyFor(live, input.compartment)
    const identity = await this.identity()
    const keyId = (await this.keyIds())[input.compartment]
    const aad = (part: string): AadPart[] => [
      identity.clinicId,
      identity.vaultId,
      input.compartment,
      keyId,
      input.kind,
      input.id,
      input.version,
      part,
    ]
    const meta = await sealJson(key, input.meta, 'document', aad('meta'), this.deps())
    const content =
      input.bytes === null
        ? null
        : await seal(key, input.bytes, 'document', aad('content'), this.deps())
    this.assertEpoch(live)
    return {
      id: input.id,
      compartment: input.compartment,
      kind: input.kind,
      entityId: input.entityId,
      version: input.version,
      keyId,
      meta: sealedRow(meta),
      content: content === null ? null : sealedRow(content),
    }
  }

  /**
   * Phase C de la reprise : UNE transaction sur les reprises, les pièces et le journal de sécurité, session revérifiée ;
   * `work` n'écrit que des lignes déjà scellées (aucun appel Web Crypto ni réseau).
   */
  async commitRecovery<T>(work: (db: VaultDatabase) => Promise<T>): Promise<T> {
    const live = this.requireLive()
    return this.db.transaction(
      'rw',
      [
        this.db.vault_meta,
        this.db.recovered_exports,
        this.db.recovered_commands,
        this.db.encrypted_documents,
        this.db.vault_events,
      ],
      async () => {
        await this.assertSession(live)
        return work(this.db)
      },
    )
  }

  /** Lecture des reprises (exports ouverts, commandes de l'ancien poste) ; jamais une clé. */
  recoveryTables(): Pick<VaultDatabase, 'recovered_exports' | 'recovered_commands'> {
    this.requireLive()
    return this.db
  }

  /** Trace de sécurité d'une étape de reprise (sans secret ni donnée patient). */
  async noteRecovery(type: string, detail: EventRow['detail']): Promise<void> {
    const live = this.requireLive()
    await this.db.transaction('rw', [this.db.vault_meta, this.db.vault_events], async () => {
      await this.assertSession(live)
      await this.event(type, live.info.profileId, detail)
    })
  }

  /** Commandes du journal en attente avec leur version de schéma et de règles (contrôle de mise à jour, O06). */
  async pendingVersions(): Promise<
    { commandName: string; schemaVersion: string; rulesVersion: string; compartment: Compartment }[]
  > {
    const statuses = new Map(
      (await this.db.command_status.toArray()).map((row) => [row.commandId, row.state]),
    )
    return (await this.db.command_journal.toArray())
      .filter((row) => !['ACCEPTED', 'REJECTED'].includes(statuses.get(row.commandId) ?? 'LOCAL'))
      .map((row) => ({
        commandName: row.commandName,
        schemaVersion: String(row.core['schema_version'] ?? ''),
        rulesVersion: String(row.core['rules_version'] ?? ''),
        compartment: row.compartment,
      }))
  }

  /** Version du schéma IndexedDB effectivement ouverte (O06). */
  async schemaVersion(): Promise<number> {
    if (!this.db.isOpen()) await this.db.open()
    return this.db.verno
  }

  // --- Interne --------------------------------------------------------------------------------------------------

  private deps(): { subtle: SubtleCrypto; random: RandomBytes } {
    return { subtle: this.subtle, random: this.random }
  }

  private formatOk(format: unknown): boolean {
    if (typeof format !== 'object' || format === null) return false
    const { formatVersion, minWriterVersion } = format as {
      formatVersion?: unknown
      minWriterVersion?: unknown
    }
    return (
      typeof formatVersion === 'number' &&
      typeof minWriterVersion === 'number' &&
      minWriterVersion <= VAULT_FORMAT_VERSION
    )
  }

  private async assertSelfTest(): Promise<void> {
    const outcome = await this.selfTest()
    if (outcome === 'insecure-context') throw new VaultError('INSECURE_CONTEXT')
    if (outcome !== 'ok') throw new VaultError('WEBCRYPTO_SELFTEST_FAILED')
  }

  private async identity(): Promise<Identity> {
    const value = (await this.db.vault_meta.get('identity'))?.value as Identity | undefined
    if (value === undefined) throw new VaultError('VAULT_ABSENT')
    return value
  }

  private async keyIds(): Promise<Record<Compartment, number>> {
    const value = (await this.db.vault_meta.get('keys'))?.value as
      Partial<Record<Compartment, number>> | undefined
    return {
      ADMINISTRATIVE: value?.ADMINISTRATIVE ?? 1,
      CLINICAL: value?.CLINICAL ?? 1,
      FINANCIAL: value?.FINANCIAL ?? 1,
      MANAGER: value?.MANAGER ?? 1,
    }
  }

  private kcvAad(vaultId: string, profileId: string, kekVersion: number): AadPart[] {
    return [vaultId, profileId, kekVersion]
  }

  private envelopeAad(identity: Identity, envelope: EnvelopeRow): AadPart[] {
    return [
      identity.clinicId,
      identity.vaultId,
      envelope.profileId,
      envelope.slot,
      envelope.keyId,
      envelope.format,
      envelope.kekVersion,
    ]
  }

  private async envelope(
    key: CryptoKey,
    kek: CryptoKey,
    clinicId: string,
    vaultId: string,
    owner: string,
    slot: EnvelopeSlot,
    keyId: number,
    format: 'raw' | 'pkcs8',
    kekVersion: number,
  ): Promise<EnvelopeRow> {
    const row: EnvelopeRow = {
      id: `${owner}:${slot}:${keyId}`,
      profileId: owner,
      slot,
      keyId,
      format,
      kekVersion,
      wrapped: { nonce: new Uint8Array(), ciphertext: new Uint8Array() },
    }
    const identity: Identity = { vaultId, clinicId, deviceId: null, createdAt: '' }
    row.wrapped = sealedRow(
      await wrap(key, kek, format, this.envelopeAad(identity, row), this.deps()),
    )
    return row
  }

  private async unwrapEnvelope(
    envelope: EnvelopeRow,
    kek: CryptoKey,
    clinicId: string,
    vaultId: string,
    extractable: boolean,
  ): Promise<CryptoKey> {
    const identity: Identity = { vaultId, clinicId, deviceId: null, createdAt: '' }
    return unwrapAesKey(
      envelope.wrapped,
      kek,
      this.envelopeAad(identity, envelope),
      extractable,
      this.deps(),
    )
  }

  private async verifyEnvelope(
    envelope: EnvelopeRow,
    kek: CryptoKey,
    identity: Identity,
  ): Promise<void> {
    if (envelope.slot === 'DEVICE_SIGNING') {
      await unwrapSigningKey(
        envelope.wrapped,
        kek,
        this.envelopeAad(identity, envelope),
        false,
        this.deps(),
      )
    } else {
      await this.unwrapEnvelope(envelope, kek, identity.clinicId, identity.vaultId, false)
    }
  }

  /** Ressaisie du secret d'un profil (D1) : rend sa KEK, jamais conservée. */
  private async stepUp(profileId: string, secret: string): Promise<CryptoKey> {
    const identity = await this.identity()
    const profile = await this.activeProfile(profileId)
    try {
      assertKdfParams(profile.kdf, this.policy)
    } catch {
      throw new VaultError('KDF_PARAMS_REJECTED')
    }
    const kek = await deriveProfileKek(
      secret,
      fromBase64Url(profile.kdf.salt),
      profile.kdf.iterations,
      this.deps(),
    )
    if (
      !(await checkKcv(
        kek,
        profile.kcv,
        this.kcvAad(identity.vaultId, profileId, profile.kekVersion),
        this.deps(),
      ))
    ) {
      throw new VaultError('STEP_UP_FAILED')
    }
    return kek
  }

  private async recoveryKek(input: string, identity: Identity): Promise<CryptoKey> {
    const bytes = await parseRecoveryKey(input, this.subtle)
    if (bytes === null) throw new VaultError('RECOVERY_KEY_INVALID')
    const derived = await deriveRecoveryKek(bytes, identity.vaultId, this.deps())
    const recovery = (await this.db.vault_meta.get('recovery'))?.value as
      { verifier?: string } | undefined
    if (recovery?.verifier !== derived.verifier) throw new VaultError('RECOVERY_KEY_INVALID')
    return derived.kek
  }

  private async rewrapProfile(
    profile: ProfileRow,
    currentKek: CryptoKey,
    next: string,
    eventType: string,
  ): Promise<void> {
    const identity = await this.identity()
    const owned = await this.db.key_envelopes.where('profileId').equals(profile.id).toArray()
    const salt = this.random(16)
    const kdf: KdfParams = {
      salt: toBase64Url(salt),
      iterations: this.policy.defaultIterations,
      normalization: 'NFKC',
    }
    const kekVersion = profile.kekVersion + 1
    const newKek = await deriveProfileKek(next, salt, kdf.iterations, this.deps())
    const kcv = await makeKcv(
      newKek,
      this.kcvAad(identity.vaultId, profile.id, kekVersion),
      this.deps(),
    )
    const envelopes: EnvelopeRow[] = []
    for (const row of owned) {
      const aad = this.envelopeAad(identity, row)
      const extractable =
        row.slot === 'DEVICE_SIGNING'
          ? await unwrapSigningKey(row.wrapped, currentKek, aad, true, this.deps())
          : await unwrapAesKey(row.wrapped, currentKek, aad, true, this.deps())
      envelopes.push(
        await this.envelope(
          extractable,
          newKek,
          identity.clinicId,
          identity.vaultId,
          profile.id,
          row.slot,
          row.keyId,
          row.format,
          kekVersion,
        ),
      )
    }
    for (const envelope of envelopes) await this.verifyEnvelope(envelope, newKek, identity)
    await this.db.transaction(
      'rw',
      [this.db.profiles, this.db.key_envelopes, this.db.vault_events],
      async () => {
        const fresh = await this.activeProfile(profile.id)
        if (fresh.kekVersion !== profile.kekVersion) throw new VaultError('VAULT_SESSION_STALE')
        await this.db.key_envelopes.where('profileId').equals(profile.id).delete()
        await this.db.key_envelopes.bulkAdd(envelopes)
        await this.db.profiles.put({
          ...fresh,
          kdf,
          kekVersion,
          kcv: sealedRow(kcv),
          updatedAt: iso(this.now()),
        })
        await this.event(eventType, profile.id, {})
      },
    )
  }

  private async activeProfile(profileId: string): Promise<ProfileRow> {
    const profile = await this.db.profiles.get(profileId)
    if (profile === undefined || profile.state !== 'ACTIVE')
      throw new VaultError('PROFILE_NOT_FOUND')
    return profile
  }

  /** D10 : la tentative est réservée AVANT la dérivation (une page fermée pendant le calcul compte un échec). */
  private async reserveAttempt(profileId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.profiles], async () => {
      const profile = await this.activeProfile(profileId)
      const now = this.now()
      if (profile.attempts.blockedUntil !== null && profile.attempts.blockedUntil > now) {
        throw new VaultError('AUTH_THROTTLED', { retryAt: profile.attempts.blockedUntil })
      }
      await this.db.profiles.put({
        ...profile,
        attempts: { failures: profile.attempts.failures + 1, blockedUntil: null },
      })
    })
  }

  private async recordFailure(profileId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.profiles, this.db.vault_events], async () => {
      const profile = await this.activeProfile(profileId)
      const blockedUntil = throttleUntil(profile.attempts.failures, this.now())
      await this.db.profiles.put({
        ...profile,
        attempts: { failures: profile.attempts.failures, blockedUntil },
      })
      if (blockedUntil !== null)
        await this.event('unlock_throttled', profileId, { failures: profile.attempts.failures })
    })
  }

  private requireLive(): LiveSession {
    if (this.live === null) throw new VaultError('VAULT_LOCKED')
    return this.live
  }

  private assertEpoch(live: LiveSession): void {
    if (this.live !== live || live.epoch !== this.epoch) throw new VaultError('VAULT_LOCKED')
  }

  /** D11 : la session persistée est relue DANS la transaction d'écriture. */
  private async assertSession(live: LiveSession): Promise<void> {
    this.assertEpoch(live)
    const meta = (await this.db.vault_meta.get('session'))?.value as SessionMeta | undefined
    if (meta === undefined || meta.sessionId !== live.info.sessionId || meta.endedAt !== null) {
      throw new VaultError('VAULT_SESSION_STALE')
    }
  }

  private compartmentOfType(type: string): Compartment {
    const compartment = ENTITY_COMPARTMENTS[type]
    if (compartment === undefined || !isCompartment(compartment))
      throw new VaultError('ENTITY_TYPE_UNREGISTERED')
    return compartment
  }

  private keyFor(live: LiveSession, compartment: Compartment): CryptoKey {
    const key = live.keys.get(compartment)
    if (key === undefined) throw new VaultError('COMPARTMENT_NOT_AVAILABLE')
    return key
  }

  private async event(
    type: string,
    profileId: string | null,
    detail: EventRow['detail'],
  ): Promise<void> {
    await this.db.vault_events.add({ type, at: iso(this.now()), profileId, detail })
  }

  private async onBroadcast(message: VaultBroadcast): Promise<void> {
    const live = this.live
    if (live === null) return
    if (message.type === 'lock' && message.sessionId === live.info.sessionId) {
      await this.lock(message.reason, false)
    } else if (message.type === 'session-started' && message.profileId !== live.info.profileId) {
      await this.lock('SUPERSEDED', false)
    }
  }
}

/** Canal entre onglets par `BroadcastChannel` quand le navigateur l'offre ; sinon aucun (le CAS suffit, D11). */
export function broadcastChannel(name = 'eeo-vault'): VaultChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(name)
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<VaultBroadcast>): void => handler(event.data)
      channel.addEventListener('message', listener)
      return () => channel.removeEventListener('message', listener)
    },
  }
}

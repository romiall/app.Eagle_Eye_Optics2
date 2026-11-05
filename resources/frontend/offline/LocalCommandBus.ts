import {
  localAvailableUnits,
  nextNumber,
  ownsInvoice,
  quantityUnits,
  remainingNumbers,
  unitsToQuantity,
} from './allocations/allocations'
import { COMMAND_COMPARTMENTS, type Compartment } from './compartments'
import {
  type CommandCore,
  COMMAND_JWS_TYPE,
  counter,
  eventHash,
  intentHash,
  journalContract,
  type JournalContract,
  NUMBER_FIELDS,
  routingCore,
} from './command-journal/core'
import { withJournalLock } from './locks/deviceLock'
import { SYNC_APPLICABLE_COMMANDS } from './sync/applicable'
import type { AllocationRow, EntityRow, JournalRow } from './vault/db'
import { VaultError } from './vault/errors'
import type { Vault } from './vault/vault'
import { newUlid } from '../domain/values/ulid'

/**
 * Moteur de commandes LOCAL du poste préparé (O04 ; fichier 19 « Commande atomique et impression » ; contrat 23
 * « Journal local et commit »). Une commande locale :
 *
 *  1. vérifie le profil (session ouverte, grant signé valide, compartiment de la commande, permission figée dans le
 *     grant), la propriété de la facture (une seule caisse écrit son solde), la version attendue, le numéro et le quota ;
 *  2. calcule le candidat HORS transaction : numéro pris au curseur de la plage, réserves sous quota, cœur du contrat
 *     23, `event_hash` (JCS + SHA-256), signature ES256 du poste, charge scellée dans le compartiment, projection
 *     locale de l'entité et fait immuable scellés ;
 *  3. ouvre UNE transaction qui revérifie la tête du journal, l'idempotence, le curseur des plages, la version de
 *     l'entité et les quotas (CAS), puis écrit TOUT ou RIEN : journal, état LOCAL, projection, fait, curseurs, quotas,
 *     propriété, tête. Un CAS obsolète (autre onglet, autre profil) abandonne ce candidat et RECALCULE (au plus trois
 *     fois) : aucune pièce n'est affichée avant le commit, aucun numéro n'est brûlé par un échec ;
 *  4. rend l'instant du commit : « Enregistré sur ce poste » n'est dit qu'APRÈS ce commit réel.
 *
 * Idempotence locale : une clé d'idempotence déjà committée rend la commande existante (même intention) ; une autre
 * charge sous la même clé est refusée. Aucune commande n'est jamais supprimée du journal (append-only) ; seul un ACK
 * final d'O05 la sort de la file active.
 *
 * Projections locales (versions) : la tête de l'entité garde un compteur par nature de version attendue (entité,
 * brouillon, grand livre, état). Une facture créée localement suit `draft` 1 à la création, +1 par modification,
 * figé à l'émission ; `ledger` vaut 1 à l'émission puis +1 par fait financier (comme `ledger_version` du serveur).
 * Une entité connue seulement du serveur part de la version que l'écran annonce. Le serveur revalide tout à la
 * synchronisation (O05) : ces versions évitent seulement deux écritures locales concurrentes sur la même base.
 */

export interface LocalCommandRequest {
  name: string
  payload: Readonly<Record<string, unknown>>
  expectedVersion: number | null
  idempotencyKey: string
}

export interface LocalCommitResult {
  commandId: string
  deviceSequence: number
  recordedAt: string
  replayed: boolean
  /** Numéro de pièce consommé dans la plage du poste (définitif, jamais renuméroté), ou null. */
  number: string | null
  /** Charge telle que journalisée (numéro, réserves et propriété renseignés). */
  payload: Record<string, unknown>
}

export interface LocalCommandBusOptions {
  /** Fuseau du cabinet : année de la série de numéros (jamais l'année UTC). */
  timeZone: string
  now?: () => number
  newId?: () => string
  subtle?: SubtleCrypto
  maxAttempts?: number
  lock?: <T>(work: () => Promise<T>) => Promise<T>
}

/** État des droits locaux pour le choix synchrone du chemin (rafraîchi après déverrouillage, préparation, commit). */
export interface LocalReadiness {
  ready: boolean
  compartments: readonly Compartment[]
  permissions: readonly string[]
  ownedInvoices: ReadonlySet<string>
  localInvoices: ReadonlySet<string>
  remaining: Readonly<Record<string, number>>
}

const NOT_READY: LocalReadiness = {
  ready: false,
  compartments: [],
  permissions: [],
  ownedInvoices: new Set(),
  localInvoices: new Set(),
  remaining: {},
}

/** Type de projection locale (registre ENTITY_COMPARTMENTS) de chaque agrégat du contrat. */
export const TABLE_ENTITY_TYPES: Readonly<Record<string, string>> = {
  patient_records: 'patient',
  visits: 'visit',
  consultations: 'consultation',
  optical_prescriptions: 'prescription',
  invoices: 'invoice',
  cash_sessions: 'cash_session',
  deliveries: 'delivery',
  physical_returns: 'physical_return',
  stock_movements: 'stock_movement',
  follow_up_plans: 'follow_up',
  appointments: 'appointment',
  contact_tasks: 'contact_task',
  approvals: 'approval',
}

/** Type des faits immuables (un par commande), par compartiment. */
export const FACT_TYPES: Readonly<Record<Compartment, string>> = {
  ADMINISTRATIVE: 'local_fact_administrative',
  CLINICAL: 'local_fact_clinical',
  FINANCIAL: 'local_fact_financial',
  MANAGER: 'local_fact_manager',
}

/** Projection locale d'une entité modifiée par le journal du poste. */
export interface LocalHead {
  entityType: string
  entityId: string
  origin: 'local' | 'server'
  versions: Partial<Record<'entity' | 'draft' | 'ledger' | 'state', number>>
  state: Record<string, unknown>
  commandIds: string[]
  lastCommandAt: string
}

/** Fait immuable d'une commande locale (lisible par les écrans via les projections fusionnées). */
export interface LocalFact {
  commandId: string
  commandName: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  number: string | null
  recordedAt: string
  /**
   * Version de l'entité que l'écran affichait quand la commande a été prise (null : création ou commande sans version).
   * Absente des faits scellés avant A2. Elle dit si une modification d'une fiche du serveur est déjà reprise par le pull.
   */
  expectedVersion?: number | null
}

class StaleCandidate extends Error {
  constructor(reason: string) {
    super(`Candidat local obsolète : ${reason}`)
    this.name = 'StaleCandidate'
  }
}

const LEDGER_COMMANDS = new Set([
  'RegisterPayment',
  'ReversePayment',
  'IssueCreditNote',
  'RefundCredit',
])

function civilYear(at: number, timeZone: string): number {
  const text = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date(at))
  return Number(text)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

interface PlannedReservation {
  quota: Extract<AllocationRow, { kind: 'STOCK_QUOTA' }>
  units: number
  entry: Record<string, unknown>
}

export class LocalCommandBus {
  private readonly timeZone: string
  private readonly now: () => number
  private readonly newId: () => string
  private readonly subtle: SubtleCrypto
  private readonly maxAttempts: number
  private readonly lock: <T>(work: () => Promise<T>) => Promise<T>
  private readiness: LocalReadiness = NOT_READY

  constructor(
    private readonly vault: Vault,
    options: LocalCommandBusOptions,
  ) {
    this.timeZone = options.timeZone
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? newUlid
    this.subtle = options.subtle ?? globalThis.crypto.subtle
    this.maxAttempts = options.maxAttempts ?? 3
    this.lock = options.lock ?? withJournalLock
  }

  /** Droits locaux connus (choix SYNCHRONE du chemin par le répartiteur des mutations). */
  readinessSnapshot(): LocalReadiness {
    return this.readiness
  }

  /** Relit session, grant, propriétés, factures locales et numéros restants. Jamais d'exception : non prêt sinon. */
  async refresh(): Promise<LocalReadiness> {
    try {
      const session = this.vault.session()
      if (session === null || session.authority !== 'granted') {
        this.readiness = NOT_READY
        return this.readiness
      }
      const grant = await this.vault.sessionGrant()
      const permissions = Array.isArray(grant?.claims['permissions'])
        ? (grant.claims['permissions'] as unknown[]).filter(
            (item): item is string => typeof item === 'string',
          )
        : []
      const tables = this.vault.localTables()
      const allocations = await tables.allocations.toArray()
      const year = civilYear(this.now(), this.timeZone)
      const remaining: Record<string, number> = {}
      for (const type of Object.keys(NUMBER_FIELDS))
        remaining[type] = remainingNumbers(allocations, type, year)
      const invoiceHeads = await tables.encrypted_entities
        .where('[compartment+type]')
        .equals(['FINANCIAL', 'invoice'])
        .toArray()
      this.readiness = {
        ready: (await this.vault.deviceId()) !== null && session.canSign,
        compartments: session.compartments,
        permissions,
        ownedInvoices: new Set(
          allocations
            .filter((row) => row.kind === 'WRITE_OWNER' && row.status === 'ACTIVE')
            .map((row) => (row as { invoiceId: string }).invoiceId),
        ),
        localInvoices: new Set(invoiceHeads.map((row) => row.entityId)),
        remaining,
      }
    } catch {
      this.readiness = NOT_READY
    }
    return this.readiness
  }

  /**
   * Ce poste enregistre-t-il lui-même cette commande ? Commande du journal, poste prêt, compartiment et permission du
   * grant, propriété de la facture (créée ici ou attribuée à ce poste), et un numéro disponible si la série en exige.
   */
  handles(request: LocalCommandRequest): boolean {
    const contract = journalContract(request.name)
    const compartment = COMMAND_COMPARTMENTS[request.name]
    const state = this.readiness
    if (contract === null || compartment === undefined || !state.ready) return false
    // O05 : seules les commandes que le serveur sait appliquer depuis un poste s'enregistrent ici.
    if (!SYNC_APPLICABLE_COMMANDS.has(request.name)) return false
    if (
      !state.compartments.includes(compartment) ||
      !state.permissions.includes(contract.permission)
    )
      return false
    if (contract.entityType === 'invoices' && request.name !== 'CreateInvoiceDraft') {
      const invoiceId = request.payload[contract.entityIdField]
      if (typeof invoiceId !== 'string') return false
      if (!state.localInvoices.has(invoiceId) && !state.ownedInvoices.has(invoiceId)) return false
    }
    if (contract.numberType !== null && (state.remaining[contract.numberType] ?? 0) <= 0)
      return false
    return true
  }

  /** Commit local atomique (voir l'en-tête). Lève une `VaultError` à code stable ; rien n'est écrit sur un échec. */
  async commit(request: LocalCommandRequest): Promise<LocalCommitResult> {
    const contract = journalContract(request.name)
    const compartment = COMMAND_COMPARTMENTS[request.name]
    if (contract === null || compartment === undefined) throw new VaultError('COMMAND_NOT_GRANTED')
    const entityId = request.payload[contract.entityIdField]
    if (typeof entityId !== 'string' || entityId === '') throw new VaultError('COMMAND_NOT_GRANTED')
    const intent = await intentHash(
      request.name,
      request.payload,
      request.expectedVersion,
      this.subtle,
    )

    const result = await this.lock(async () => {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          return await this.attempt(request, contract, compartment, entityId, intent)
        } catch (error) {
          if (!(error instanceof StaleCandidate)) throw error
        }
      }
      throw new VaultError('LOCAL_COMMIT_CONTENDED')
    })
    await this.refresh()
    return result
  }

  private async replayOf(row: JournalRow, intent: string): Promise<LocalCommitResult> {
    if (row.intentHash !== intent) throw new VaultError('IDEMPOTENCY_PAYLOAD_MISMATCH')
    const payload = await this.vault.openCommandPayload<Record<string, unknown>>(row)
    const contract = journalContract(row.commandName)
    const field =
      contract?.numberType === null || contract === null
        ? null
        : (NUMBER_FIELDS[contract.numberType] ?? null)
    const number = field === null ? null : payload[field]
    return {
      commandId: row.commandId,
      deviceSequence: row.deviceSequence,
      recordedAt: row.recordedAt,
      replayed: true,
      number: typeof number === 'string' ? number : null,
      payload,
    }
  }

  private async attempt(
    request: LocalCommandRequest,
    contract: JournalContract,
    compartment: Compartment,
    entityId: string,
    intent: string,
  ): Promise<LocalCommitResult> {
    const tables = this.vault.localTables()

    // Idempotence : une intention déjà committée est rendue telle quelle.
    const existing = await tables.command_journal
      .where('idempotencyKey')
      .equals(request.idempotencyKey)
      .first()
    if (existing !== undefined) return this.replayOf(existing, intent)

    const context = await this.vault.commandContext()
    const session = context.session
    if (session.authority !== 'granted' || session.grantId === null)
      throw new VaultError('GRANT_REQUIRED')
    if (context.deviceId === null) throw new VaultError('DEVICE_NOT_BOUND')
    if (context.kid === null || !session.canSign) throw new VaultError('SIGNING_KEY_ABSENT')
    if (context.serverTime === null) throw new VaultError('GRANT_REQUIRED')
    if (!session.compartments.includes(compartment))
      throw new VaultError('COMPARTMENT_NOT_AVAILABLE')
    const grant = await this.vault.sessionGrant()
    const permissions = Array.isArray(grant?.claims['permissions'])
      ? (grant.claims['permissions'] as unknown[])
      : []
    if (!permissions.includes(contract.permission)) throw new VaultError('COMMAND_NOT_GRANTED')
    const rulesVersion =
      typeof grant?.claims['rules_version'] === 'string' ? grant.claims['rules_version'] : null
    if (rulesVersion === null) throw new VaultError('GRANT_REQUIRED')

    // Lectures de base (comparées de nouveau dans la transaction).
    const journalHead = (await tables.aggregate_heads.get('journal')) ?? null
    const allocations = await tables.allocations.toArray()
    const headType = TABLE_ENTITY_TYPES[contract.entityType]
    if (headType === undefined) throw new VaultError('ENTITY_TYPE_UNREGISTERED')
    const headRow = (await tables.encrypted_entities.get(`${headType}:${entityId}`)) ?? null
    const head =
      headRow === null
        ? null
        : ((await this.vault.getEntity<LocalHead>(headType, entityId))?.value ?? null)

    // Propriété : une seule caisse écrit le solde d'une facture.
    if (contract.entityType === 'invoices' && request.name !== 'CreateInvoiceDraft') {
      if (head?.origin !== 'local' && !ownsInvoice(allocations, entityId))
        throw new VaultError('WRITE_OWNER_REQUIRED')
    }

    // Versions attendues (projection locale).
    const versions = { ...(head?.versions ?? {}) }
    const kind = contract.expectedVersion
    if (kind === 'none') {
      if (head !== null) throw new VaultError('LOCAL_VERSION_CONFLICT')
      versions.entity = 1
      if (contract.entityType === 'invoices') versions.draft = 1
    } else if (kind === 'state') {
      versions.state = (versions.state ?? 0) + 1
    } else {
      const known = versions[kind]
      if (request.expectedVersion === null) throw new VaultError('LOCAL_VERSION_CONFLICT')
      if (known !== undefined && known !== request.expectedVersion)
        throw new VaultError('LOCAL_VERSION_CONFLICT')
      if (request.name === 'IssueInvoice') {
        versions.ledger = 1
      } else {
        versions[kind] = request.expectedVersion + 1
      }
    }

    const at = this.now()
    const recordedAt = new Date(at).toISOString()
    const commandId = this.newId()
    const deviceSequence = (journalHead?.deviceSequence ?? 0) + 1
    const payload: Record<string, unknown> = { ...request.payload }

    // Numéro de pièce : prochain numéro de la plage du poste, pour l'année du fuseau du cabinet.
    let planned: ReturnType<typeof nextNumber> = null
    if (contract.numberType !== null) {
      planned = nextNumber(allocations, contract.numberType, civilYear(at, this.timeZone))
      if (planned === null) throw new VaultError('NUMBER_RANGE_EXHAUSTED')
      const field = NUMBER_FIELDS[contract.numberType]
      if (field !== undefined) payload[field] = planned.rendered
    }

    // Émission locale : propriété importée dans la même transaction, réserves sous quota pour les articles stockés.
    let reservations: PlannedReservation[] = []
    let ownerId: string | null = null
    if (request.name === 'IssueInvoice') {
      ownerId =
        typeof payload['write_owner_id'] === 'string' ? payload['write_owner_id'] : this.newId()
      payload['write_owner_id'] = ownerId
      reservations = await this.planReservations(payload, head, allocations)
      payload['reservations'] = reservations.map((planned) => planned.entry)
    }

    const core: CommandCore = {
      command_id: commandId,
      command_name: request.name,
      device_id: context.deviceId,
      actor_id: session.userId,
      grant_id: session.grantId,
      clinic_id: context.clinicId,
      device_sequence: counter(deviceSequence),
      previous_event_hash: journalHead?.eventHash ?? null,
      schema_version: contract.schemaVersion,
      rules_version: rulesVersion,
      occurred_at_local: recordedAt,
      last_server_time: context.serverTime,
      entity_type: contract.entityType,
      entity_id: entityId,
      expected_version: request.expectedVersion,
      number_allocation_id: planned?.allocation.id ?? null,
      stock_allocation_ids: [...new Set(reservations.map((item) => item.quota.id))].sort(),
      payload,
    }
    const hash = await eventHash(core, this.subtle)
    const signature = await this.vault.signJws(
      { command_id: commandId, device_id: context.deviceId, event_hash: hash },
      context.kid,
      COMMAND_JWS_TYPE,
    )
    const sealedPayload = await this.vault.sealCommandPayload(
      compartment,
      commandId,
      deviceSequence,
      payload,
    )

    const nextHead: LocalHead = {
      entityType: contract.entityType,
      entityId,
      origin: head?.origin ?? (kind === 'none' ? 'local' : 'server'),
      versions,
      state: LEDGER_COMMANDS.has(request.name)
        ? asRecord(head?.state)
        : { ...asRecord(head?.state), ...payload },
      commandIds: [...(head?.commandIds ?? []), commandId],
      lastCommandAt: recordedAt,
    }
    const headEntity: EntityRow = await this.vault.sealEntityRow(
      headType,
      entityId,
      (headRow?.version ?? 0) + 1,
      nextHead,
    )
    const fact: LocalFact = {
      commandId,
      commandName: request.name,
      entityType: contract.entityType,
      entityId,
      payload,
      number: planned?.rendered ?? null,
      recordedAt,
      expectedVersion: request.expectedVersion,
    }
    const factEntity: EntityRow = await this.vault.sealEntityRow(
      FACT_TYPES[compartment],
      commandId,
      1,
      fact,
    )

    const journalRow: JournalRow = {
      commandId,
      deviceSequence,
      idempotencyKey: request.idempotencyKey,
      intentHash: intent,
      commandName: request.name,
      compartment,
      core: routingCore(core),
      previousEventHash: core.previous_event_hash,
      eventHash: hash,
      signature,
      payload: sealedPayload,
      entityType: contract.entityType,
      entityId,
      recordedAt,
    }

    // Phase C : comparaisons puis écritures, tout ou rien.
    return this.vault.commitLocal(async (db) => {
      const replay = await db.command_journal
        .where('idempotencyKey')
        .equals(request.idempotencyKey)
        .first()
      if (replay !== undefined) throw new StaleCandidate('clé déjà committée par un autre onglet')
      const currentHead = (await db.aggregate_heads.get('journal')) ?? null
      if (
        (currentHead?.deviceSequence ?? 0) !== (journalHead?.deviceSequence ?? 0) ||
        (currentHead?.eventHash ?? null) !== (journalHead?.eventHash ?? null)
      ) {
        throw new StaleCandidate('tête du journal')
      }
      const currentEntity = (await db.encrypted_entities.get(headEntity.id)) ?? null
      if ((currentEntity?.version ?? 0) !== (headRow?.version ?? 0))
        throw new StaleCandidate('version de l’entité')
      if (planned !== null) {
        const range = await db.allocations.get(planned.allocation.id)
        if (
          range === undefined ||
          range.kind !== 'NUMBER_RANGE' ||
          range.status !== 'ACTIVE' ||
          range.nextValue !== planned.value
        ) {
          throw new StaleCandidate('curseur de la plage')
        }
        await db.allocations.put({
          ...range,
          nextValue: range.nextValue + 1,
          version: range.version + 1,
          updatedAt: recordedAt,
        })
      }
      for (const reservation of reservations) {
        const quota = await db.allocations.get(reservation.quota.id)
        if (
          quota === undefined ||
          quota.kind !== 'STOCK_QUOTA' ||
          quota.version !== reservation.quota.version
        )
          throw new StaleCandidate('quota')
        if (localAvailableUnits(quota) < reservation.units)
          throw new VaultError('LOCAL_QUOTA_EXCEEDED')
        await db.allocations.put({
          ...quota,
          reservedLocalUnits: quota.reservedLocalUnits + reservation.units,
          version: quota.version + 1,
          updatedAt: recordedAt,
        })
      }
      if (ownerId !== null && !ownsInvoice(await db.allocations.toArray(), entityId)) {
        await db.allocations.put({
          id: ownerId,
          kind: 'WRITE_OWNER',
          status: 'ACTIVE',
          invoiceId: entityId,
          epoch: 1,
          version: 1,
          updatedAt: recordedAt,
        })
      }
      await db.command_journal.add(journalRow)
      await db.command_status.put({
        commandId,
        state: 'LOCAL',
        attempts: 0,
        updatedAt: recordedAt,
        references: null,
      })
      await db.encrypted_entities.put(headEntity)
      await db.encrypted_entities.put(factEntity)
      await db.aggregate_heads.put({
        key: 'journal',
        deviceSequence,
        eventHash: hash,
        updatedAt: recordedAt,
      })
      return {
        commandId,
        deviceSequence,
        recordedAt,
        replayed: false,
        number: planned?.rendered ?? null,
        payload,
      }
    })
  }

  /**
   * Réserves sous quota de l'émission locale (fichier 19 « Droits de stock ») : une ligne d'article STOCKÉ du brouillon
   * local réserve sa quantité sur UN quota actif de cet article dont le disponible local suffit. Des réserves déjà
   * fournies par l'écran sont vérifiées telles quelles. Aucun quota suffisant : refus, rien n'est écrit.
   */
  private async planReservations(
    payload: Record<string, unknown>,
    head: LocalHead | null,
    allocations: readonly AllocationRow[],
  ): Promise<PlannedReservation[]> {
    const quotas = allocations.filter(
      (row): row is Extract<AllocationRow, { kind: 'STOCK_QUOTA' }> =>
        row.kind === 'STOCK_QUOTA' && row.status === 'ACTIVE',
    )
    const given = Array.isArray(payload['reservations'])
      ? (payload['reservations'] as unknown[])
      : []
    const planned: PlannedReservation[] = []
    const used = new Map<string, number>()
    const take = (
      quota: Extract<AllocationRow, { kind: 'STOCK_QUOTA' }>,
      units: number,
    ): boolean => {
      const already = used.get(quota.id) ?? 0
      if (localAvailableUnits(quota) - already < units) return false
      used.set(quota.id, already + units)
      return true
    }

    if (given.length > 0) {
      for (const raw of given) {
        const entry = asRecord(raw)
        const quota = quotas.find((candidate) => candidate.id === entry['device_allocation_id'])
        const units =
          typeof entry['quantity'] === 'string' ? quantityUnits(entry['quantity']) : null
        if (quota === undefined || units === null || units <= 0 || !take(quota, units))
          throw new VaultError('LOCAL_QUOTA_EXCEEDED')
        planned.push({ quota, units, entry })
      }
      return planned
    }

    const catalog = await this.vault
      .getEntity<{ snapshot?: { items?: { id: string; stock_mode: string }[] } }>(
        'catalog_snapshot',
        'current',
      )
      .catch(() => null)
    const stocked = new Set(
      (catalog?.value.snapshot?.items ?? [])
        .filter((item) => item.stock_mode === 'STOCKED')
        .map((item) => item.id),
    )
    const lines = Array.isArray(head?.state['lines']) ? (head.state['lines'] as unknown[]) : []
    for (const raw of lines) {
      const line = asRecord(raw)
      const itemId = line['catalog_item_id']
      if (typeof itemId !== 'string' || !stocked.has(itemId)) continue
      const units = typeof line['quantity'] === 'string' ? quantityUnits(line['quantity']) : null
      if (units === null || units <= 0) throw new VaultError('LOCAL_QUOTA_EXCEEDED')
      const quota = quotas.find(
        (candidate) => candidate.itemId === itemId && take(candidate, units),
      )
      if (quota === undefined) throw new VaultError('LOCAL_QUOTA_EXCEEDED')
      planned.push({
        quota,
        units,
        entry: {
          reservation_id: this.newId(),
          invoice_line_id: line['line_id'],
          item_id: itemId,
          stock_position_id: quota.stockPositionId,
          stock_lot_id: quota.stockLotId,
          device_allocation_id: quota.id,
          quantity: unitsToQuantity(units),
        },
      })
    }
    return planned
  }
}

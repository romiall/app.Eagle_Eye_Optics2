import type { Change, PullPage } from '../../domain/contracts/generated'

import { CommandJournal } from '../command-journal/journal'
import { type Compartment, ENTITY_COMPARTMENTS } from '../compartments'
import { type LocalHead, TABLE_ENTITY_TYPES } from '../LocalCommandBus'
import type { CommandState, EntityRow } from '../vault/db'
import { VaultError } from '../vault/errors'
import type { Vault } from '../vault/vault'

import type { SyncTransport } from './transport'

/**
 * Pull des changements publiés par le serveur (O05 ; contrat 23 « publication pull transactionnelle ») et fusion dans
 * les projections du poste (F10) :
 *
 *  - chaque page est d'abord scellée HORS transaction (projection du serveur dans le compartiment de sa visibilité,
 *    `PUBLIC` dans l'administratif), puis écrite avec le curseur dans UNE transaction : le curseur n'avance qu'avec la
 *    page entière, jamais avant (contrat 23) ; un autre onglet qui a avancé le curseur entre-temps fait recommencer ;
 *  - la projection du serveur (`pulled_<compartiment>`) fait foi pour ce qu'elle contient ; une proposition du poste non
 *    finalisée n'est jamais masquée : la tête locale d'une entité n'est recalée sur les versions du serveur que si
 *    TOUTES les commandes qui l'ont modifiée sont finalisées (ACK ACCEPTED ou REJECTED) ;
 *  - un changement d'un compartiment que le profil ne sait pas ouvrir n'est pas écrit (le serveur ne l'envoie pas).
 */
export const PULL_MAX_PAGES = 20

/** Projection du serveur conservée sur le poste. */
export interface PulledRecord {
  entityType: string
  entityId: string
  entityVersion: number
  changeKind: string
  changeSequence: string
  recordedAt: string
  data: Record<string, unknown>
}

export interface PullReport {
  pages: number
  changes: number
  serverTime: string | null
}

export const PULLED_TYPES: Readonly<Record<Compartment, string>> = {
  ADMINISTRATIVE: 'pulled_administrative',
  CLINICAL: 'pulled_clinical',
  FINANCIAL: 'pulled_financial',
  MANAGER: 'pulled_manager',
}

const FINAL: ReadonlySet<CommandState> = new Set(['ACCEPTED', 'REJECTED'])

class PullContended extends Error {}

export function compartmentOfVisibility(visibility: Change['visibility']): Compartment {
  return visibility === 'PUBLIC' ? 'ADMINISTRATIVE' : visibility
}

/** Identifiant de la projection d'une entité du serveur dans le coffre. */
export function pulledKey(entityType: string, entityId: string): string {
  return `${entityType}/${entityId}`
}

function versionsFromServer(change: Change): LocalHead['versions'] {
  const data = change.data as Record<string, unknown>
  const versions: LocalHead['versions'] = {}
  if (change.entity_type === 'invoices') {
    if (typeof data['draft_version'] === 'number') versions.draft = data['draft_version']
    if (typeof data['ledger_version'] === 'number') versions.ledger = data['ledger_version']
  } else if (typeof data['version'] === 'number') {
    versions.entity = data['version']
  }
  return versions
}

interface Planned {
  row: EntityRow
  expectedVersion: number
}

async function planPage(
  vault: Vault,
  journal: CommandJournal,
  page: PullPage,
  compartments: readonly Compartment[],
): Promise<Planned[]> {
  const tables = vault.localTables()
  const statuses = await journal.statuses()
  const planned = new Map<string, Planned>()

  for (const change of page.changes) {
    const compartment = compartmentOfVisibility(change.visibility)
    if (!compartments.includes(compartment)) continue
    const type = PULLED_TYPES[compartment]
    const key = pulledKey(change.entity_type, change.entity_id)
    const existing = await tables.encrypted_entities.get(`${type}:${key}`)
    const record: PulledRecord = {
      entityType: change.entity_type,
      entityId: change.entity_id,
      entityVersion: change.entity_version,
      changeKind: change.change_kind,
      changeSequence: change.change_sequence,
      recordedAt: change.recorded_at,
      data: change.data as Record<string, unknown>,
    }
    const expected = existing?.version ?? 0
    const row = await vault.sealEntityRow(type, key, expected + 1, record)
    // Une même entité deux fois dans la page : la dernière (publiée après) l'emporte.
    planned.set(row.id, { row, expectedVersion: expected })

    // Tête locale recalée sur le serveur seulement si plus rien du poste n'attend sur cette entité.
    const headType = TABLE_ENTITY_TYPES[change.entity_type]
    if (
      headType === undefined ||
      !compartments.includes(ENTITY_COMPARTMENTS[headType] as Compartment)
    )
      continue
    const headRow = await tables.encrypted_entities.get(`${headType}:${change.entity_id}`)
    if (headRow === undefined) continue
    const head = await vault.getEntity<LocalHead>(headType, change.entity_id)
    if (head === null) continue
    const settled = head.value.commandIds.every((commandId) => {
      const state = statuses.get(commandId)?.state
      return state !== undefined && FINAL.has(state)
    })
    const versions = versionsFromServer(change)
    if (!settled || Object.keys(versions).length === 0) continue
    const next: LocalHead = { ...head.value, versions: { ...head.value.versions, ...versions } }
    const headSealed = await vault.sealEntityRow(
      headType,
      change.entity_id,
      headRow.version + 1,
      next,
    )
    planned.set(headSealed.id, { row: headSealed, expectedVersion: headRow.version })
  }
  return [...planned.values()]
}

/** Pages du serveur jusqu'à la fin (ou `maxPages`), chacune commitée avec son curseur. */
export async function pullChanges(
  vault: Vault,
  transport: SyncTransport,
  options: { now: () => number; maxPages?: number },
): Promise<PullReport> {
  const session = vault.session()
  if (session === null || session.authority !== 'granted') throw new VaultError('GRANT_REQUIRED')
  const deviceId = await vault.deviceId()
  if (deviceId === null) throw new VaultError('DEVICE_NOT_BOUND')
  const journal = new CommandJournal(vault)
  const report: PullReport = { pages: 0, changes: 0, serverTime: null }

  for (let pageIndex = 0; pageIndex < (options.maxPages ?? PULL_MAX_PAGES); pageIndex += 1) {
    let hasMore: boolean
    for (let attempt = 1; ; attempt += 1) {
      const previous = (await vault.localTables().pull_cursors.get(session.userId)) ?? null
      const page = await transport.pull(deviceId, previous?.cursor ?? null)
      const planned = await planPage(vault, journal, page, session.compartments)
      try {
        await vault.commitLocal(async (db) => {
          const current = (await db.pull_cursors.get(session.userId)) ?? null
          if ((current?.cursor ?? null) !== (previous?.cursor ?? null)) throw new PullContended()
          for (const item of planned) {
            const now = await db.encrypted_entities.get(item.row.id)
            if ((now?.version ?? 0) !== item.expectedVersion) throw new PullContended()
          }
          for (const item of planned) await db.encrypted_entities.put(item.row)
          await db.pull_cursors.put({
            userId: session.userId,
            cursor: page.next_cursor,
            pulledAt: new Date(options.now()).toISOString(),
          })
        })
      } catch (error) {
        if (error instanceof PullContended && attempt < 3) continue
        throw error
      }
      await vault.noteServerTime(page.server_time)
      report.pages += 1
      report.changes += page.changes.length
      report.serverTime = page.server_time
      hasMore = page.has_more
      break
    }
    if (!hasMore) break
  }
  return report
}

/**
 * Projections du serveur d'un type d'entité (annuaire du poste, A2) : celles des `ids` donnés (une lecture chacune, le
 * reste du coffre n'est pas déchiffré) ou, sans `ids`, toutes. Vide si le profil n'ouvre pas le compartiment : jamais une
 * entité d'un compartiment fermé. Une ligne altérée fait échouer toute la lecture (`ROW_DECRYPT_FAILED`) : rien n'est
 * montré à moitié.
 */
export async function pulledRecords(
  vault: Vault,
  compartment: Compartment,
  entityType: string,
  ids: readonly string[] | null = null,
): Promise<PulledRecord[]> {
  const session = vault.session()
  if (session === null || !session.compartments.includes(compartment)) return []
  if (ids !== null) {
    const found = await Promise.all(
      ids.map((entityId) => pulledRecord(vault, compartment, entityType, entityId)),
    )
    return found.filter((record): record is PulledRecord => record !== null)
  }
  const entries = await vault.listEntities<PulledRecord>(
    PULLED_TYPES[compartment],
    `${entityType}/`,
  )
  return entries.map((entry) => entry.value)
}

/** Instant du dernier échange de pull du compte ouvert (jusque-là, l'annuaire est à jour) ; null s'il n'y en a jamais eu. */
export async function lastPullAt(vault: Vault): Promise<string | null> {
  const session = vault.session()
  if (session === null) return null
  return (await vault.localTables().pull_cursors.get(session.userId))?.pulledAt ?? null
}

/** Projection du serveur d'une entité, si le profil sait l'ouvrir ; null sinon. */
export async function pulledRecord(
  vault: Vault,
  compartment: Compartment,
  entityType: string,
  entityId: string,
): Promise<PulledRecord | null> {
  const session = vault.session()
  if (session === null || !session.compartments.includes(compartment)) return null
  return (
    (
      await vault.getEntity<PulledRecord>(
        PULLED_TYPES[compartment],
        pulledKey(entityType, entityId),
      )
    )?.value ?? null
  )
}

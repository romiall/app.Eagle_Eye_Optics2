// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import {
  assertAdditive,
  declareLocalSchema,
  LOCAL_SCHEMA,
  LOCAL_SCHEMA_VERSION,
  tablesAt,
} from '@/offline/migrations/registry'
import { VaultDatabase } from '@/offline/vault/db'

/**
 * Schéma local du poste (O06 ; AT45 ; EE042, EE044) sur IndexedDB simulée : une base v4 REMPLIE (journal en attente de
 * deux profils, états, pièce PDF chiffrée, métadonnées du coffre) passe en v5 sans perdre une ligne ; une coupure
 * pendant la migration laisse la base en v4 intacte ; une base plus récente que le client n'est jamais purgée ; le
 * registre n'admet que des ajouts. Données fictives.
 */
const CLINIC = '01J9ZXK4M2Q8R7S6T5V4W3C001'

function options(factory: IDBFactory): ConstructorParameters<typeof Dexie>[1] {
  return { indexedDB: factory, IDBKeyRange }
}

async function fillV4(db: VaultDatabase): Promise<void> {
  await db.vault_meta.put({
    key: 'identity',
    value: {
      vaultId: '01J9ZXK4M2Q8R7S6T5V4W3V001',
      clinicId: CLINIC,
      deviceId: '01J9ZXK4M2Q8R7S6T5V4W3D001',
      createdAt: '2026-10-22T08:00:00.000Z',
    },
  })
  await db.vault_meta.put({ key: 'format', value: { formatVersion: 1, minWriterVersion: 1 } })
  const sealed = { nonce: new Uint8Array([1, 2, 3]), ciphertext: new Uint8Array([4, 5, 6]) }
  for (const [sequence, compartment] of [
    [1, 'ADMINISTRATIVE'],
    [2, 'FINANCIAL'],
    [3, 'FINANCIAL'],
  ] as const) {
    const commandId = `01J9ZXK4M2Q8R7S6T5V4W3K00${sequence}`
    await db.command_journal.put({
      commandId,
      deviceSequence: sequence,
      idempotencyKey: commandId,
      intentHash: 'a'.repeat(64),
      commandName: sequence === 1 ? 'CreatePatient' : 'RegisterPayment',
      compartment,
      core: { command_id: commandId, schema_version: '1', rules_version: '2026-10-14.1' },
      previousEventHash: sequence === 1 ? null : 'b'.repeat(64),
      eventHash: 'b'.repeat(64),
      signature: 'eyJ.test.sig',
      payload: { ...sealed, keyId: 1 },
      entityType: 'invoices',
      entityId: '01J9ZXK4M2Q8R7S6T5V4W3F001',
      recordedAt: '2026-10-22T09:20:00.000Z',
    })
    await db.command_status.put({
      commandId,
      state: sequence === 1 ? 'ACCEPTED' : 'LOCAL',
      attempts: 0,
      updatedAt: '2026-10-22T09:20:00.000Z',
      references: null,
    })
  }
  await db.aggregate_heads.put({
    key: 'journal',
    deviceSequence: 3,
    eventHash: 'b'.repeat(64),
    updatedAt: '2026-10-22T09:21:00.000Z',
  })
  await db.encrypted_documents.put({
    id: 'RECEIPT|01J9ZXK4M2Q8R7S6T5V4W3R001|1',
    compartment: 'FINANCIAL',
    kind: 'RECEIPT',
    entityId: '01J9ZXK4M2Q8R7S6T5V4W3R001',
    version: 1,
    keyId: 1,
    meta: sealed,
    content: sealed,
  })
  await db.pull_cursors.put({
    userId: '01J9ZXK4M2Q8R7S6T5V4W3U001',
    cursor: 'curseur-fictif',
    pulledAt: '2026-10-22T09:00:00.000Z',
  })
}

async function counts(db: VaultDatabase): Promise<Record<string, number>> {
  return {
    journal: await db.command_journal.count(),
    status: await db.command_status.count(),
    documents: await db.encrypted_documents.count(),
    cursors: await db.pull_cursors.count(),
    meta: await db.vault_meta.count(),
  }
}

describe('schéma local du poste (O06)', () => {
  it('le registre est additif, ordonné et déclaré dans la compatibilité', () => {
    expect(() => assertAdditive()).not.toThrow()
    expect(LOCAL_SCHEMA_VERSION).toBe(5)
    expect(tablesAt(4)).not.toContain('recovered_commands')
    expect(tablesAt(5)).toContain('recovered_commands')
    expect(() =>
      assertAdditive([
        ...LOCAL_SCHEMA,
        { version: 6, task: 'test', summary: 'suppression', stores: { pull_cursors: '' } },
      ]),
    ).toThrow(/supprimée/)
    expect(() =>
      assertAdditive([
        ...LOCAL_SCHEMA,
        { version: 6, task: 'test', summary: 'clé', stores: { pull_cursors: 'cursor' } },
      ]),
    ).toThrow(/clé primaire/)
    expect(() => assertAdditive([LOCAL_SCHEMA[1]!])).toThrow(/ordre/)

    const compatibility = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts/compatibility.json'), 'utf8'),
    ) as { local_schema_versions: number[]; vault_formats: number[] }
    for (const entry of LOCAL_SCHEMA)
      expect(compatibility.local_schema_versions).toContain(entry.version)
    expect(compatibility.vault_formats).toContain(1)
  })

  it('une base v4 remplie passe en v5 sans perdre une ligne ni une commande en attente', async () => {
    const factory = new IDBFactory()
    const v4 = new VaultDatabase('eeo-device-migration', options(factory), 4)
    await v4.open()
    expect(v4.verno).toBe(4)
    await fillV4(v4)
    const before = await counts(v4)
    v4.close()

    const v5 = new VaultDatabase('eeo-device-migration', options(factory))
    await v5.open()
    expect(v5.verno).toBe(5)
    expect(await counts(v5)).toEqual(before)
    expect(
      (await v5.command_status.where('state').equals('LOCAL').toArray()).map(
        (row) => row.commandId,
      ),
    ).toEqual(['01J9ZXK4M2Q8R7S6T5V4W3K002', '01J9ZXK4M2Q8R7S6T5V4W3K003'])
    expect(
      (await v5.encrypted_documents.get('RECEIPT|01J9ZXK4M2Q8R7S6T5V4W3R001|1'))?.content
        ?.ciphertext,
    ).toEqual(new Uint8Array([4, 5, 6]))
    expect(await v5.recovered_commands.count()).toBe(0)
    v5.close()
  })

  it('une coupure pendant la migration laisse la base v4 intacte', async () => {
    const factory = new IDBFactory()
    const v4 = new VaultDatabase('eeo-device-coupure', options(factory), 4)
    await fillV4(v4)
    const before = await counts(v4)
    v4.close()

    const interrupted = new Dexie('eeo-device-coupure', options(factory))
    declareLocalSchema(interrupted, 4)
    interrupted
      .version(5)
      .stores({
        recovered_exports: 'exportId, oldDeviceId',
        recovered_commands: 'commandId, [oldDeviceId+deviceSequence], state',
      })
      .upgrade(async (tx) => {
        await tx.table('recovered_exports').add({ exportId: 'partiel', oldDeviceId: 'x' })
        throw new Error('Coupure simulée pendant la migration')
      })
    await expect(interrupted.open()).rejects.toThrow()
    interrupted.close()

    const reopened = new VaultDatabase('eeo-device-coupure', options(factory), 4)
    await reopened.open()
    expect(reopened.verno).toBe(4)
    expect(await counts(reopened)).toEqual(before)
    reopened.close()

    // La migration réelle reprend ensuite normalement.
    const v5 = new VaultDatabase('eeo-device-coupure', options(factory))
    await v5.open()
    expect(await counts(v5)).toEqual(before)
    expect(await v5.recovered_exports.count()).toBe(0)
    v5.close()
  })

  it('un client plus ancien que la base refuse de l’ouvrir sans rien purger', async () => {
    const factory = new IDBFactory()
    const v5 = new VaultDatabase('eeo-device-recente', options(factory))
    await fillV4(v5)
    const before = await counts(v5)
    v5.close()

    const older = new VaultDatabase('eeo-device-recente', options(factory), 4)
    await expect(older.open()).rejects.toThrow()
    older.close()

    const again = new VaultDatabase('eeo-device-recente', options(factory))
    expect(await counts(again)).toEqual(before)
    again.close()
  })

  it('CHAQUE palier N-1 → N du registre conserve toutes les lignes et tous les index (rien n’est réécrit)', async () => {
    // Pour chaque version k du registre : une base k remplie (deux lignes dans chaque table, d'après la déclaration),
    // puis ouverte par le client courant. Un palier qui supprimerait une table, réécrirait une ligne ou retirerait un
    // index ferait échouer ce test ; un palier ajouté plus tard est couvert sans rien écrire.
    expect(LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(2)
    for (let k = 1; k < LOCAL_SCHEMA_VERSION; k += 1) {
      const factory = new IDBFactory()
      const name = `eeo-device-palier-${k}`
      const previous = new VaultDatabase(name, options(factory), k)
      await previous.open()
      expect(previous.verno, `base ouverte en v${k}`).toBe(k)

      const tables = tablesAt(k)
      for (const table of tables) {
        const spec = LOCAL_SCHEMA.slice(0, k)
          .map((entry) => entry.stores[table])
          .filter((candidate): candidate is string => candidate !== undefined)
          .at(-1)
        await previous
          .table(table)
          .bulkAdd([sampleRow(table, spec ?? '', 1), sampleRow(table, spec ?? '', 2)])
      }
      const rowsBefore = new Map<string, unknown[]>()
      const indexesBefore = new Map<string, string[]>()
      for (const table of tables) {
        rowsBefore.set(table, await previous.table(table).toArray())
        indexesBefore.set(
          table,
          previous.table(table).schema.indexes.map((index) => index.name),
        )
        expect(rowsBefore.get(table), `${table} remplie en v${k}`).toHaveLength(2)
      }
      previous.close()

      const current = new VaultDatabase(name, options(factory))
      await current.open()
      expect(current.verno, `migration v${k} → v${LOCAL_SCHEMA_VERSION}`).toBe(LOCAL_SCHEMA_VERSION)
      for (const table of tables) {
        expect(await current.table(table).toArray(), `${table} après v${k} → courante`).toEqual(
          rowsBefore.get(table),
        )
        const indexesAfter = current.table(table).schema.indexes.map((index) => index.name)
        expect(indexesAfter, `index de ${table} après v${k} → courante`).toEqual(
          expect.arrayContaining(indexesBefore.get(table) ?? []),
        )
      }
      for (const table of tablesAt(LOCAL_SCHEMA_VERSION).filter((t) => !tables.includes(t))) {
        expect(await current.table(table).count(), `${table} ajoutée après v${k}`).toBe(0)
      }
      current.close()
    }
  })
})

/**
 * Ligne d'exemple pour une table d'après sa déclaration Dexie (`'commandId, &deviceSequence, [entityType+entityId]'`) :
 * chaque champ nommé (clé primaire, index simples, index composés) reçoit une valeur propre à la ligne ; une clé
 * auto-incrémentée (`++seq`) est laissée à IndexedDB.
 */
function sampleRow(table: string, spec: string, n: number): Record<string, string> {
  const tokens = spec
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
  const row: Record<string, string> = {}
  tokens.forEach((token, position) => {
    if (position === 0 && token.startsWith('++')) return
    const bare = token.replace(/^(\+\+|&|\*)/, '').replace(/[[\]]/g, '')
    for (const field of bare.split('+')) if (field !== '') row[field] = `${table}.${field}.${n}`
  })
  return row
}

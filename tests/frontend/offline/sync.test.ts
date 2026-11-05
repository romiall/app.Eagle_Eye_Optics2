// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'

import type {
  Ack,
  PullPage,
  PushRequest,
  PushResponse,
  SignedCommand,
} from '@/domain/contracts/generated'
import { assembleCore, eventHash } from '@/offline/command-journal/core'
import { CommandJournal } from '@/offline/command-journal/journal'
import { LocalCommandBus } from '@/offline/LocalCommandBus'
import { SyncEngine } from '@/offline/sync/engine'
import { lastPullAt, pullChanges, pulledRecord, pulledRecords } from '@/offline/sync/pull'
import { pushJournal } from '@/offline/sync/push'
import { SyncRefused, type SyncTransport } from '@/offline/sync/transport'
import { thumbprint, verifyCompact } from '@/offline/signing/jws'

import { type PreparedDevice, DEVICE, prepared } from './support/preparedDevice'

/**
 * Synchronisation du poste (O05 ; fiche « Crash après commit avant ACK ; conflit N puis reprise N+1 ; pull avec
 * commits entrelacés » ; AT38, AT39, AT42) sur IndexedDB simulée, contre un serveur fictif qui vérifie l'empreinte JCS,
 * la signature ES256 (kid = empreinte RFC 7638 de la clé du poste) et le chaînage :
 *
 *  - ordre du journal, chaînage et signature conservés à l'envoi ;
 *  - rejeu après une réponse perdue : mêmes identifiants, aucun double effet, ACK existant ;
 *  - ACK partiel : les commandes sans ACK restent envoyées et repartent, rien n'est retiré ;
 *  - conflit puis rejet décidé : la commande reste dans la file jusqu'à l'ACK final, jamais rétrogradée ;
 *  - coupure puis réouverture du coffre : le journal et les états survivent, les mêmes commandes repartent ;
 *  - serveur restauré (rang manquant) : renvoi depuis le rang demandé ;
 *  - pull : curseur commité avec la page, projections du serveur scellées, tête locale recalée seulement si finalisée.
 */
let device: PreparedDevice | null = null

afterEach(() => {
  device?.vault.dispose()
  device?.db.close()
  device = null
})

let ids = 0
function newId(): string {
  ids += 1
  return `01J9ZXK4M2Q8R7S6T5V4W3${String(ids).padStart(4, '0')}`
}

function patientPayload(patientId: string): Record<string, unknown> {
  return {
    patient_id: patientId,
    record_number_usage_id: newId(),
    record_number: null,
    last_name: 'PATIENT HORS LIGNE',
    first_names: 'Fictive',
    sex: 'F',
    birth_date: '1990-05-12',
    birth_date_missing_reason: null,
    phone_primary: '600000001',
    phone_secondary: null,
    phone_missing_reason: null,
    address: null,
    profession: null,
    guardian_contact: null,
    legacy_record: false,
    first_known_visit_on: null,
    first_visit_certified: false,
    legacy_record_number: null,
  }
}

async function commitPatients(current: PreparedDevice, count: number): Promise<string[]> {
  const bus = new LocalCommandBus(current.vault, {
    timeZone: 'Africa/Douala',
    now: () => current.clock.now,
    newId,
  })
  await bus.refresh()
  const commandIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const result = await bus.commit({
      name: 'CreatePatient',
      payload: patientPayload(newId()),
      expectedVersion: null,
      idempotencyKey: `cle-sync-${newId()}`,
    })
    commandIds.push(result.commandId)
  }
  return commandIds
}

function ack(command: SignedCommand, status: Ack['status'], extra: Partial<Ack> = {}): Ack {
  return {
    command_id: command.core.command_id,
    device_sequence: command.core.device_sequence,
    status,
    result_references:
      status === 'ACCEPTED' || status === 'ALREADY_ACCEPTED'
        ? { patient_id: String(command.core.entity_id) }
        : {},
    versions: status === 'ACCEPTED' || status === 'ALREADY_ACCEPTED' ? { entity_version: 1 } : {},
    dependencies: [],
    conflict_id: null,
    error_code: null,
    reason: null,
    ...extra,
  }
}

/** Serveur fictif : vérifie empreinte, signature et chaînage ; applique dans l'ordre ; un fait par identifiant. */
class FakeServer implements SyncTransport {
  readonly pushes: PushRequest[] = []
  readonly applied = new Map<string, string>()
  prefix = 0
  lastHash: string | null = null
  /** Perd la réponse du prochain envoi APRÈS avoir appliqué (crash après commit, avant l'ACK). */
  loseNextResponse = false
  /** N'acquitte qu'un nombre limité de commandes par envoi (les suivantes restent reçues). */
  ackLimit: number | null = null
  /** Rang en conflit et décision ultérieure. */
  conflictAt: number | null = null
  rejected = new Set<string>()
  /** Base « restaurée » : le prochain envoi répond rang manquant. */
  gapOnce: number | null = null
  pages: PullPage[] = []
  readonly pulls: (string | null)[] = []

  constructor(private readonly jwk: PreparedDevice['devicePublicJwk']) {}

  async push(body: PushRequest): Promise<PushResponse> {
    this.pushes.push(body)
    if (this.gapOnce !== null) {
      const expected = this.gapOnce
      this.gapOnce = null
      if (Number(body.commands[0].core.device_sequence) !== expected) {
        this.prefix = expected - 1
        throw new SyncRefused(409, 'SYNC_SEQUENCE_GAP', 'Rang manquant.', {
          expected_sequence: String(expected),
        })
      }
    }
    const kid = await thumbprint(this.jwk)
    const results: Ack[] = []
    for (const command of body.commands) {
      const hash = await eventHash(command.core as never)
      expect(hash).toBe(command.event_hash)
      const claims = await verifyCompact(command.signature, this.jwk, kid, 'eeo-command+jws')
      expect(claims).toEqual({
        command_id: command.core.command_id,
        device_id: DEVICE,
        event_hash: hash,
      })
      const sequence = Number(command.core.device_sequence)
      if (this.applied.has(command.core.command_id)) {
        results.push(ack(command, 'ALREADY_ACCEPTED'))
        continue
      }
      if (this.rejected.has(command.core.command_id)) {
        results.push(
          ack(command, 'REJECTED', {
            conflict_id: '01J9ZXK4M2Q8R7S6T5V4W3K001',
            error_code: 'PAYMENT_EXCEEDS_BALANCE',
            reason: 'Rejetée après revue (test)',
          }),
        )
        if (sequence === this.prefix + 1) {
          this.prefix = sequence
          this.lastHash = command.event_hash
        }
        continue
      }
      if (this.ackLimit !== null && results.length >= this.ackLimit) break
      if (sequence !== this.prefix + 1 || command.core.previous_event_hash !== this.lastHash) break
      if (this.conflictAt === sequence) {
        results.push(
          ack(command, 'CONFLICT_REQUIRES_REVIEW', {
            conflict_id: '01J9ZXK4M2Q8R7S6T5V4W3K001',
            error_code: 'PAYMENT_EXCEEDS_BALANCE',
            reason: 'Montant au-delà du reste dû.',
          }),
        )
        break
      }
      this.applied.set(command.core.command_id, command.event_hash)
      this.prefix = sequence
      this.lastHash = command.event_hash
      results.push(ack(command, 'ACCEPTED'))
    }
    const response: PushResponse = {
      results,
      finalized_prefix: { last_sequence: String(this.prefix), last_hash: this.lastHash },
      server_time: '2026-10-22T09:40:00.000Z',
    }
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new Error('Réponse perdue (réseau coupé)')
    }
    return response
  }

  async pull(_deviceId: string, cursor: string | null): Promise<PullPage> {
    this.pulls.push(cursor)
    const index = cursor === null ? 0 : Number(cursor.replace('curseur-signe-', ''))
    return (
      this.pages[index] ?? {
        changes: [],
        next_cursor: cursor ?? 'curseur-signe-0000',
        has_more: false,
        server_time: '2026-10-22T09:41:00.000Z',
      }
    )
  }
}

async function states(current: PreparedDevice, commandIds: readonly string[]): Promise<string[]> {
  return Promise.all(
    commandIds.map(async (id) => (await current.db.command_status.get(id))?.state ?? 'ABSENT'),
  )
}

const now = (): number => device?.clock.now ?? Date.now()

describe('push du journal', () => {
  it('envoie dans l’ordre du journal, chaîné et signé, puis enregistre les ACK finaux', async () => {
    device = await prepared()
    const commandIds = await commitPatients(device, 3)
    const server = new FakeServer(device.devicePublicJwk)

    const report = await pushJournal(device.vault, server, { now })

    expect(report).toMatchObject({
      sent: 3,
      acknowledged: 3,
      conflicts: 0,
      prefix: { lastSequence: 3 },
    })
    const body = server.pushes[0] as PushRequest
    expect(body.commands.map((command) => command.core.device_sequence)).toEqual(['1', '2', '3'])
    expect(body.commands[1]?.core.previous_event_hash).toBe(body.commands[0]?.event_hash)
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED'])
    expect(
      (await device.db.command_status.get(commandIds[0] ?? ''))?.references?.['result_references'],
    ).toEqual({ patient_id: body.commands[0]?.core.entity_id })

    // Rien de nouveau : aucun envoi ; le journal n'est jamais vidé.
    expect((await pushJournal(device.vault, server, { now })).sent).toBe(0)
    expect(await device.db.command_journal.count()).toBe(3)
  })

  it('rejoue les MÊMES commandes après une réponse perdue, sans double effet', async () => {
    device = await prepared()
    const commandIds = await commitPatients(device, 2)
    const server = new FakeServer(device.devicePublicJwk)
    server.loseNextResponse = true

    await expect(pushJournal(device.vault, server, { now })).rejects.toThrow('Réponse perdue')
    expect(await states(device, commandIds)).toEqual(['SENT', 'SENT'])
    expect(server.applied.size).toBe(2)

    const report = await pushJournal(device.vault, server, { now })
    expect(report.acknowledged).toBe(2)
    const [first, second] = server.pushes
    expect(second?.commands.map((command) => [command.core.command_id, command.signature])).toEqual(
      first?.commands.map((command) => [command.core.command_id, command.signature]),
    )
    expect(server.applied.size).toBe(2)
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'ACCEPTED'])
  })

  it('garde les commandes sans ACK après un ACK partiel et les renvoie ensuite', async () => {
    device = await prepared()
    const commandIds = await commitPatients(device, 3)
    const server = new FakeServer(device.devicePublicJwk)
    server.ackLimit = 2

    await pushJournal(device.vault, server, { now })
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'ACCEPTED', 'SENT'])

    server.ackLimit = null
    await pushJournal(device.vault, server, { now })
    expect(server.pushes[1]?.commands.map((command) => command.core.device_sequence)).toEqual(['3'])
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED'])
  })

  it('garde un conflit dans la file, n’envoie la suite qu’après décision et ne rétrograde jamais un ACK final', async () => {
    device = await prepared()
    const commandIds = await commitPatients(device, 3)
    const server = new FakeServer(device.devicePublicJwk)
    server.conflictAt = 2

    const first = await pushJournal(device.vault, server, { now })
    expect(first).toMatchObject({ acknowledged: 1, conflicts: 1 })
    expect(await states(device, commandIds)).toEqual([
      'ACCEPTED',
      'CONFLICT_REQUIRES_REVIEW',
      'SENT',
    ])
    const engine = new SyncEngine(device.vault, { transport: server, now })
    expect(await engine.summary()).toMatchObject({ conflicts: 1, pending: 1, local: 0 })
    expect((await engine.issues())[0]).toMatchObject({
      commandId: commandIds[1],
      state: 'CONFLICT_REQUIRES_REVIEW',
      reason: 'Montant au-delà du reste dû.',
    })

    // Décision de la gérante côté serveur : rejet du rang 2 ; le rang 3 reprend (N puis N+1).
    server.conflictAt = null
    server.rejected.add(commandIds[1] ?? '')
    await pushJournal(device.vault, server, { now })
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'REJECTED', 'ACCEPTED'])

    // Un ACK non final tardif ne rétrograde pas un ACK final.
    await new CommandJournal(device.vault).recordAck(
      commandIds[1] ?? '',
      'CONFLICT_REQUIRES_REVIEW',
      null,
      '2026-10-22T09:50:00.000Z',
    )
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'REJECTED', 'ACCEPTED'])
    expect(await device.db.command_journal.count()).toBe(3)
  })

  it('survit à une coupure et à la réouverture du coffre : les mêmes commandes repartent', async () => {
    device = await prepared()
    const commandIds = await commitPatients(device, 2)
    const offline: SyncTransport = {
      push: async () => {
        throw new Error('Serveur injoignable')
      },
      pull: async () => {
        throw new Error('Serveur injoignable')
      },
    }
    const engine = new SyncEngine(device.vault, { transport: offline, now })
    await expect(engine.syncNow()).rejects.toThrow('Serveur injoignable')
    expect((await engine.summary()).lastAttemptFailed).toBe(true)

    device = await device.reopen()
    expect(await states(device, commandIds)).toEqual(['SENT', 'SENT'])
    const server = new FakeServer(device.devicePublicJwk)
    const report = await new SyncEngine(device.vault, { transport: server, now }).syncNow()
    expect(report.push.acknowledged).toBe(2)
    expect(server.pushes[0]?.commands.map((command) => command.core.command_id)).toEqual(commandIds)
    expect(await states(device, commandIds)).toEqual(['ACCEPTED', 'ACCEPTED'])
    expect(
      (await new SyncEngine(device.vault, { transport: server, now }).summary()).lastExchangeAt,
    ).toBe('2026-10-22T09:41:00.000Z')
  })

  it('renvoie le journal depuis le rang que le serveur n’a pas reçu (base restaurée)', async () => {
    device = await prepared()
    const firstIds = await commitPatients(device, 2)
    const server = new FakeServer(device.devicePublicJwk)
    await pushJournal(device.vault, server, { now })
    const nextIds = await commitPatients(device, 1)

    // Le serveur a perdu ses rangs (restauration) : il demande le journal depuis le rang 1.
    server.applied.clear()
    server.lastHash = null
    server.gapOnce = 1
    await pushJournal(device.vault, server, { now })

    expect(server.pushes[2]?.commands.map((command) => command.core.device_sequence)).toEqual([
      '1',
      '2',
      '3',
    ])
    expect(await states(device, [...firstIds, ...nextIds])).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
    ])
  })

  it('reconstitue le cœur à l’identique pour l’envoi (empreinte inchangée)', async () => {
    device = await prepared()
    await commitPatients(device, 1)
    const journal = new CommandJournal(device.vault)
    const [pending] = await journal.pending()
    if (pending === undefined) throw new Error('Une commande du journal est attendue.')
    const signed = await journal.signed(pending.row)
    expect(await eventHash(assembleCore(pending.row.core, signed.core.payload))).toBe(
      pending.row.eventHash,
    )
  })
})

describe('pull des changements', () => {
  it('commite le curseur avec la page, scelle les projections du serveur et reprend au curseur après réouverture', async () => {
    device = await prepared()
    const server = new FakeServer(device.devicePublicJwk)
    server.pages = [
      {
        changes: [
          {
            change_sequence: '11',
            entity_type: 'patient_records',
            entity_id: '01J9ZXK4M2Q8R7S6T5V4W3PB01',
            entity_version: 2,
            change_kind: 'UPDATED',
            visibility: 'ADMINISTRATIVE',
            recorded_at: '2026-10-22T09:35:00.000Z',
            data: { id: '01J9ZXK4M2Q8R7S6T5V4W3PB01', record_number: 'EE-2026-0007', version: 2 },
          },
        ],
        next_cursor: 'curseur-signe-1',
        has_more: true,
        server_time: '2026-10-22T09:41:00.000Z',
      },
      {
        changes: [
          {
            change_sequence: '12',
            entity_type: 'catalog_items',
            entity_id: '01J9ZXK4M2Q8R7S6T5V4W3I002',
            entity_version: 3,
            change_kind: 'UPDATED',
            visibility: 'PUBLIC',
            recorded_at: '2026-10-22T09:36:00.000Z',
            data: { id: '01J9ZXK4M2Q8R7S6T5V4W3I002', sale_price: 15000 },
          },
        ],
        next_cursor: 'curseur-signe-2',
        has_more: false,
        server_time: '2026-10-22T09:41:00.000Z',
      },
    ]
    const engine = new SyncEngine(device.vault, { transport: server, now })
    expect(await lastPullAt(device.vault)).toBeNull()

    const report = await engine.syncNow()

    expect(report.pull).toMatchObject({ pages: 2, changes: 2 })
    expect(server.pulls).toEqual([null, 'curseur-signe-1'])
    // Annuaire du poste (A2) : la liste d'un type ne rend que ce type, ou les seuls identifiants demandés.
    const directory = await pulledRecords(device.vault, 'ADMINISTRATIVE', 'patient_records')
    expect(directory.map((record) => record.entityId)).toEqual(['01J9ZXK4M2Q8R7S6T5V4W3PB01'])
    expect(
      await pulledRecords(device.vault, 'ADMINISTRATIVE', 'patient_records', [
        '01J9ZXK4M2Q8R7S6T5V4W3PB01',
        '01J9ZXK4M2Q8R7S6T5V4W3PB09',
      ]),
    ).toHaveLength(1)
    expect(await pulledRecords(device.vault, 'ADMINISTRATIVE', 'catalog_items')).toHaveLength(1)
    expect(await pulledRecords(device.vault, 'ADMINISTRATIVE', 'visits')).toEqual([])
    expect(await lastPullAt(device.vault)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const patient = await pulledRecord(
      device.vault,
      'ADMINISTRATIVE',
      'patient_records',
      '01J9ZXK4M2Q8R7S6T5V4W3PB01',
    )
    expect(patient?.data['record_number']).toBe('EE-2026-0007')
    expect(
      (
        await pulledRecord(
          device.vault,
          'ADMINISTRATIVE',
          'catalog_items',
          '01J9ZXK4M2Q8R7S6T5V4W3I002',
        )
      )?.entityVersion,
    ).toBe(3)
    // Projection scellée : rien en clair dans la ligne IndexedDB.
    const raw = await device.db.encrypted_entities.get(
      'pulled_administrative:patient_records/01J9ZXK4M2Q8R7S6T5V4W3PB01',
    )
    expect(JSON.stringify(raw)).not.toContain('EE-2026-0007')

    // Le poste ne rouvre pas derrière la dernière heure du serveur reçue (sinon l'horloge est suspecte, lecture seule).
    device.clock.now = Date.parse('2026-10-22T09:42:00.000Z')
    device = await device.reopen()
    const again = new FakeServer(device.devicePublicJwk)
    await new SyncEngine(device.vault, { transport: again, now }).syncNow()
    expect(again.pulls).toEqual(['curseur-signe-2'])
  })

  it('ne recale la tête locale sur le serveur que si toutes ses commandes sont finalisées', async () => {
    const current = await prepared()
    device = current
    const [commandId] = await commitPatients(current, 1)
    const row = await current.db.command_journal.get(commandId ?? '')
    const patientId = String(row?.entityId)
    const change = (version: number): PullPage => ({
      changes: [
        {
          change_sequence: String(20 + version),
          entity_type: 'patient_records',
          entity_id: patientId,
          entity_version: version,
          change_kind: 'UPDATED',
          visibility: 'ADMINISTRATIVE',
          recorded_at: '2026-10-22T09:35:00.000Z',
          data: { id: patientId, version },
        },
      ],
      next_cursor: 'curseur-signe-0001',
      has_more: false,
      server_time: '2026-10-22T09:41:00.000Z',
    })
    const head = async (): Promise<number | undefined> =>
      (await current.vault.getEntity<{ versions: { entity?: number } }>('patient', patientId))
        ?.value.versions.entity

    // Commande encore non finalisée : la proposition du poste n'est pas masquée.
    const blocked: SyncTransport = {
      push: async () => {
        throw new Error('Serveur injoignable')
      },
      pull: async () => change(5),
    }
    await pullChanges(current.vault, blocked, { now })
    expect(await head()).toBe(1)

    // Commande acquittée : la tête suit la version du serveur.
    await new CommandJournal(current.vault).recordAck(
      commandId ?? '',
      'ACCEPTED',
      null,
      '2026-10-22T09:45:00.000Z',
    )
    const settled: SyncTransport = { push: blocked.push, pull: async () => change(6) }
    await pullChanges(current.vault, settled, { now })
    expect(await head()).toBe(6)
  })
})

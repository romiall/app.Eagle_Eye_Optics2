// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'

import type { PushRequest, PushResponse } from '@/domain/contracts/generated'
import { LocalCommandBus } from '@/offline/LocalCommandBus'
import { isRecoveryError, type RecoveryErrorCode } from '@/offline/recovery/archive'
import { exportDevice } from '@/offline/recovery/exportDevice'
import { openExport } from '@/offline/recovery/openArchive'
import {
  importExport,
  pushRecovered,
  recoveredPending,
  type RecoveryTransport,
} from '@/offline/recovery/restore'

import { type PreparedDevice, prepared, preparedDevice } from './support/preparedDevice'

/**
 * Export chiffré d'un poste et reprise sur un poste neuf (O07 ; « Mêmes IDs/numéros pour anciens faits », « Aucun clone
 * actif des droits non consommés » ; AT39, AT44) sur IndexedDB simulée. Le parcours complet contre la vraie application
 * est dans tests/e2e/device-recovery.spec.ts ; ici, les refus et l'idempotence. Données fictives.
 */
const NEW_DEVICE = '01J9ZXK4M2Q8R7S6T5V4W3D002'
const SENTINEL = 'NOM-SENTINELLE-EXPORT'
const devices: PreparedDevice[] = []

afterEach(() => {
  for (const device of devices.splice(0)) {
    device.vault.dispose()
    device.db.close()
  }
})

let ids = 0
function newId(): string {
  ids += 1
  return `01J9ZXK4M2Q8R7S6T5V4W3${String(ids).padStart(4, '0')}`
}

async function track(device: Promise<PreparedDevice>): Promise<PreparedDevice> {
  const ready = await device
  devices.push(ready)
  return ready
}

/** Poste d'origine avec une fiche patient enregistrée localement (non synchronisée), puis son export. */
async function exportedDevice(): Promise<{ old: PreparedDevice; text: string; commandId: string }> {
  const old = await track(prepared())
  const bus = new LocalCommandBus(old.vault, {
    timeZone: 'Africa/Douala',
    now: () => old.clock.now,
    newId,
  })
  await bus.refresh()
  const result = await bus.commit({
    name: 'CreatePatient',
    payload: {
      patient_id: newId(),
      record_number_usage_id: newId(),
      record_number: null,
      last_name: SENTINEL,
      first_names: 'Test',
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
    },
    expectedVersion: null,
    idempotencyKey: 'cle-export-0001',
  })
  const { text } = await exportDevice(old.vault, { release: 'test', now: () => old.clock.now })
  return { old, text, commandId: result.commandId }
}

async function expectRecoveryCode(
  promise: Promise<unknown>,
  code: RecoveryErrorCode,
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(isRecoveryError(error, code), String(error)).toBe(true)
    return
  }
  throw new Error(`${code} attendu`)
}

describe('export chiffré du poste', () => {
  it('ne contient aucune donnée en clair et se rouvre avec la clé de récupération', async () => {
    const { old, text, commandId } = await exportedDevice()

    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain('signing')
    const opened = await openExport(text, old.recoveryKey ?? '')
    expect(opened.manifest.journal).toMatchObject({ commands: 1, pending: 1 })
    expect(opened.file.device_id).toBe(old.deviceId)
    const [row] = opened.journal
    if (row === undefined) throw new Error('journal exporté vide')
    expect(row.commandId).toBe(commandId)
    expect((await opened.openCommand(row))['last_name']).toBe(SENTINEL)
  })

  it('refuse une mauvaise clé, un fichier illisible, une autre version ou un contenu altéré', async () => {
    const { old, text } = await exportedDevice()
    const other = await track(preparedDevice({ deviceId: NEW_DEVICE }))

    await expectRecoveryCode(openExport(text, other.recoveryKey ?? ''), 'RECOVERY_KEY_INVALID')
    await expectRecoveryCode(openExport('pas du json', old.recoveryKey ?? ''), 'EXPORT_UNREADABLE')
    const file = JSON.parse(text) as { version: number; content: { sha256: string } }
    await expectRecoveryCode(
      openExport(JSON.stringify({ ...file, version: 2 }), old.recoveryKey ?? ''),
      'EXPORT_FORMAT_UNSUPPORTED',
    )
    await expectRecoveryCode(
      openExport(
        JSON.stringify({ ...file, content: { ...file.content, sha256: '0'.repeat(64) } }),
        old.recoveryKey ?? '',
      ),
      'EXPORT_CORRUPT',
    )
  })
})

describe('reprise sur un poste neuf', () => {
  it('range les commandes signées d’origine une seule fois, jamais sur le poste exporté lui-même', async () => {
    const { old, text, commandId } = await exportedDevice()
    const opened = await openExport(text, old.recoveryKey ?? '')

    await expectRecoveryCode(
      importExport(old.vault, opened, () => old.clock.now),
      'EXPORT_SAME_DEVICE',
    )

    const fresh = await track(preparedDevice({ deviceId: NEW_DEVICE }))
    const first = await importExport(fresh.vault, opened, () => fresh.clock.now)
    expect(first).toMatchObject({ oldDeviceId: old.deviceId, commands: 1, alreadyImported: false })
    const again = await importExport(fresh.vault, opened, () => fresh.clock.now)
    expect(again.alreadyImported).toBe(true)

    const pending = await recoveredPending(fresh.vault, old.deviceId)
    expect(pending.map((row) => row.commandId)).toEqual([commandId])
    // Rien dans le journal ni les ressources du poste neuf : aucun droit de l'ancien poste n'est repris.
    expect(await fresh.db.command_journal.count()).toBe(0)
    expect(await fresh.db.allocations.count()).toBe(0)
  })

  it('transmet les commandes TELLES QUELLES au nom de l’ancien poste, puis plus rien une fois acceptées', async () => {
    const { old, text, commandId } = await exportedDevice()
    const original = await old.db.command_journal.get(commandId)
    const fresh = await track(preparedDevice({ deviceId: NEW_DEVICE }))
    await importExport(
      fresh.vault,
      await openExport(text, old.recoveryKey ?? ''),
      () => fresh.clock.now,
    )

    const sent: { oldDeviceId: string; body: PushRequest }[] = []
    const transport: RecoveryTransport = {
      pushRecovered: async (oldDeviceId, body): Promise<PushResponse> => {
        sent.push({ oldDeviceId, body })
        return {
          results: body.commands.map((command) => ({
            command_id: command.core.command_id,
            status: 'ACCEPTED',
          })),
          finalized_prefix: { last_sequence: '1', last_hash: original?.eventHash ?? null },
        } as unknown as PushResponse
      },
    }

    const report = await pushRecovered(fresh.vault, transport, old.deviceId, () => fresh.clock.now)
    expect(report).toMatchObject({ sent: 1, accepted: 1, complete: true })
    const [call] = sent
    expect(call?.oldDeviceId).toBe(old.deviceId)
    expect(call?.body.device_id).toBe(old.deviceId)
    const [command] = call?.body.commands ?? []
    expect(command?.core.command_id).toBe(commandId)
    expect(command?.event_hash).toBe(original?.eventHash)
    expect(command?.signature).toBe(original?.signature)

    const replay = await pushRecovered(fresh.vault, transport, old.deviceId, () => fresh.clock.now)
    expect(replay).toMatchObject({ sent: 0, complete: true })
    expect(sent).toHaveLength(1)
  })
})

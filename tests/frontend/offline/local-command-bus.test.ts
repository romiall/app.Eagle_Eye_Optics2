// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'

import { canonicalize } from '@/offline/signing/jcs'
import { thumbprint, verifyCompact } from '@/offline/signing/jws'
import { CommandJournal } from '@/offline/command-journal/journal'
import { assembleCore, eventHash } from '@/offline/command-journal/core'
import { LocalCommandBus } from '@/offline/LocalCommandBus'
import { isVaultError, type VaultErrorCode } from '@/offline/vault/errors'

import { type PreparedDevice, prepared } from './support/preparedDevice'

/**
 * Commit local du poste (O04 ; fiche : « Aucune pièce affichée avant commit », « Collision locale recalcule sans
 * double effet », « Commande retrouve résultat idempotent après reprise » ; AT36, AT37, AT41) sur IndexedDB simulée :
 * journal commun chaîné (séquence, empreinte précédente), cœur JCS haché et signé par la clé du poste, charge scellée,
 * numéro pris dans la plage du poste, propriété de facture, réserves sous quota, idempotence, atomicité, collision
 * entre deux commits concurrents, reprise après réouverture du coffre sans rien perdre avant l'ACK. Données fictives.
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

function bus(
  current: PreparedDevice,
  options: { lock?: <T>(work: () => Promise<T>) => Promise<T> } = {},
): LocalCommandBus {
  return new LocalCommandBus(current.vault, {
    timeZone: 'Africa/Douala',
    now: () => current.clock.now,
    newId,
    ...options,
  })
}

function patientPayload(patientId: string, name = 'PATIENT FICTIF'): Record<string, unknown> {
  return {
    patient_id: patientId,
    record_number_usage_id: newId(),
    record_number: null,
    last_name: name,
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
  }
}

async function expectCode(promise: Promise<unknown>, code: VaultErrorCode): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(isVaultError(error, code), String(error)).toBe(true)
    return
  }
  throw new Error(`${code} attendu`)
}

describe('commit local', () => {
  it('journalise, signe, scelle et numérote dans la plage du poste, tout dans une transaction', async () => {
    device = await prepared()
    const engine = bus(device)
    await engine.refresh()

    const result = await engine.commit({
      name: 'CreatePatient',
      payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PA01', 'NOM-SENTINELLE'),
      expectedVersion: null,
      idempotencyKey: 'cle-patient-0001',
    })

    expect(result.number).toBe('EE-2026-0041')
    expect(result.deviceSequence).toBe(1)
    const row = await device.db.command_journal.get(result.commandId)
    if (row === undefined) throw new Error('journal vide')
    expect(row.previousEventHash).toBeNull()
    expect(row.core['device_sequence']).toBe('1')
    expect((await device.db.command_status.get(result.commandId))?.state).toBe('LOCAL')
    expect((await device.db.aggregate_heads.get('journal'))?.deviceSequence).toBe(1)
    const range = await device.db.allocations.get('01J9ZXK4M2Q8R7S6T5V4W3A001')
    expect(range).toMatchObject({ nextValue: 42 })

    // Empreinte recalculée depuis le cœur reconstitué ; signature vérifiable avec la clé publique du poste.
    const payload = await device.vault.openCommandPayload<Record<string, unknown>>(row)
    const core = assembleCore(row.core, payload)
    expect(await eventHash(core)).toBe(row.eventHash)
    const signed = await verifyCompact(
      row.signature,
      device.devicePublicJwk,
      await thumbprint(device.devicePublicJwk),
      'eeo-command+jws',
    )
    expect(signed['event_hash']).toBe(row.eventHash)
    expect(payload['record_number']).toBe('EE-2026-0041')

    // Aucune donnée patient en clair dans les tables du poste.
    const raw =
      JSON.stringify(await device.db.command_journal.toArray()) +
      JSON.stringify(await device.db.encrypted_entities.toArray())
    expect(raw).not.toContain('NOM-SENTINELLE')
    expect(canonicalize(row.core)).not.toContain('NOM-SENTINELLE')
  })

  it('chaîne les commandes : séquence croissante, empreinte précédente', async () => {
    device = await prepared()
    const engine = bus(device)
    const first = await engine.commit({
      name: 'CreatePatient',
      payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PA02'),
      expectedVersion: null,
      idempotencyKey: 'cle-patient-0002',
    })
    const second = await engine.commit({
      name: 'CreatePatient',
      payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PA03'),
      expectedVersion: null,
      idempotencyKey: 'cle-patient-0003',
    })

    const firstRow = await device.db.command_journal.get(first.commandId)
    const secondRow = await device.db.command_journal.get(second.commandId)
    expect(secondRow?.deviceSequence).toBe(2)
    expect(secondRow?.previousEventHash).toBe(firstRow?.eventHash)
    expect(second.number).toBe('EE-2026-0042')
  })

  it('même clé, même intention : résultat rendu sans nouvelle écriture ; autre charge : refus', async () => {
    device = await prepared()
    const engine = bus(device)
    const payload = patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PA04')
    const first = await engine.commit({
      name: 'CreatePatient',
      payload,
      expectedVersion: null,
      idempotencyKey: 'cle-patient-0004',
    })
    const again = await engine.commit({
      name: 'CreatePatient',
      payload,
      expectedVersion: null,
      idempotencyKey: 'cle-patient-0004',
    })

    expect(again.replayed).toBe(true)
    expect(again.commandId).toBe(first.commandId)
    expect(again.number).toBe(first.number)
    expect(await device.db.command_journal.count()).toBe(1)
    await expectCode(
      engine.commit({
        name: 'CreatePatient',
        payload: { ...payload, last_name: 'AUTRE' },
        expectedVersion: null,
        idempotencyKey: 'cle-patient-0004',
      }),
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
    )
  })

  it('plage épuisée : refus avant tout effet, l’écran l’annonce par handles()', async () => {
    device = await prepared()
    const engine = bus(device)
    for (let index = 0; index < 3; index += 1) {
      await engine.commit({
        name: 'CreatePatient',
        payload: patientPayload(`01J9ZXK4M2Q8R7S6T5V4W3PB0${index}`),
        expectedVersion: null,
        idempotencyKey: `cle-epuise-000${index}`,
      })
    }
    expect(
      engine.handles({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PB09'),
        expectedVersion: null,
        idempotencyKey: 'cle-epuise-0009',
      }),
    ).toBe(false)
    await expectCode(
      engine.commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PB09'),
        expectedVersion: null,
        idempotencyKey: 'cle-epuise-0009',
      }),
      'NUMBER_RANGE_EXHAUSTED',
    )
    expect(await device.db.command_journal.count()).toBe(3)
  })

  it('un échec dans la transaction n’écrit rien : ni journal, ni numéro, ni tête', async () => {
    device = await prepared()
    const engine = bus(device)
    const original = device.db.aggregate_heads.put.bind(device.db.aggregate_heads)
    device.db.aggregate_heads.put = (() =>
      Promise.reject(new Error('panne simulée'))) as unknown as typeof device.db.aggregate_heads.put

    await expect(
      engine.commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PC01'),
        expectedVersion: null,
        idempotencyKey: 'cle-panne-0001',
      }),
    ).rejects.toThrow()
    device.db.aggregate_heads.put = original

    expect(await device.db.command_journal.count()).toBe(0)
    expect(await device.db.command_status.count()).toBe(0)
    expect(await device.db.allocations.get('01J9ZXK4M2Q8R7S6T5V4W3A001')).toMatchObject({
      nextValue: 41,
    })
  })

  it('deux commits concurrents sans verrou d’onglet : le CAS recalcule, deux séquences et deux numéros distincts', async () => {
    device = await prepared()
    const engine = bus(device, { lock: (work) => work() })
    const [left, right] = await Promise.all([
      engine.commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PD01'),
        expectedVersion: null,
        idempotencyKey: 'cle-collision-01',
      }),
      engine.commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PD02'),
        expectedVersion: null,
        idempotencyKey: 'cle-collision-02',
      }),
    ])

    expect(new Set([left.deviceSequence, right.deviceSequence])).toEqual(new Set([1, 2]))
    expect(left.number).not.toBe(right.number)
    expect(await device.db.command_journal.count()).toBe(2)
  })

  it('après réouverture du coffre, rien n’est perdu ni effacé avant l’ACK ; l’ACK final sort la commande de la file', async () => {
    device = await prepared()
    const intent = patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PE01')
    const result = await bus(device).commit({
      name: 'CreatePatient',
      payload: intent,
      expectedVersion: null,
      idempotencyKey: 'cle-reprise-0001',
    })

    device = await device.reopen()
    const journal = new CommandJournal(device.vault)
    const pending = await journal.pending()
    expect(pending.map((item) => item.row.commandId)).toEqual([result.commandId])
    expect(pending[0]?.state).toBe('LOCAL')
    // La même intention reprise après le redémarrage retrouve la commande committée (aucun second patient, même numéro).
    const replay = await bus(device).commit({
      name: 'CreatePatient',
      payload: intent,
      expectedVersion: null,
      idempotencyKey: 'cle-reprise-0001',
    })
    expect(replay.replayed).toBe(true)
    expect(replay.number).toBe(result.number)
    const signed = await journal.signed(pending[0]!.row)
    expect(signed.event_hash).toBe(pending[0]!.row.eventHash)
    expect(signed.core.device_sequence).toBe('1')

    await journal.recordAck(
      result.commandId,
      'WAITING_DEPENDENCY',
      null,
      '2026-10-22T10:00:00.000Z',
    )
    expect(await journal.pending()).toHaveLength(1)
    await journal.recordAck(
      result.commandId,
      'ACCEPTED',
      { patient_id: '01J9ZXK4M2Q8R7S6T5V4W3PE01' },
      '2026-10-22T10:01:00.000Z',
    )
    expect(await journal.pending()).toHaveLength(0)
    expect(await device.db.command_journal.count()).toBe(1)
    // Un ACK final n'est jamais rétrogradé.
    await journal.recordAck(
      result.commandId,
      'WAITING_DEPENDENCY',
      null,
      '2026-10-22T10:02:00.000Z',
    )
    expect((await device.db.command_status.get(result.commandId))?.state).toBe('ACCEPTED')
  })
})

describe('droits et propriété', () => {
  it('sans grant valide (lecture seule) : aucune écriture locale', async () => {
    device = await prepared({ validUntil: '2026-10-22T09:10:00.000Z' })
    await expectCode(
      bus(device).commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PF01'),
        expectedVersion: null,
        idempotencyKey: 'cle-lecture-0001',
      }),
      'GRANT_REQUIRED',
    )
  })

  it('une permission absente du grant refuse la commande', async () => {
    device = await prepared({ permissions: ['patient.read', 'invoice.read', 'users.manage'] })
    const engine = bus(device)
    await engine.refresh()
    expect(
      engine.handles({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PG01'),
        expectedVersion: null,
        idempotencyKey: 'cle-droit-0001',
      }),
    ).toBe(false)
    await expectCode(
      engine.commit({
        name: 'CreatePatient',
        payload: patientPayload('01J9ZXK4M2Q8R7S6T5V4W3PG01'),
        expectedVersion: null,
        idempotencyKey: 'cle-droit-0001',
      }),
      'COMMAND_NOT_GRANTED',
    )
  })

  it('un encaissement exige la propriété de la facture ; le reçu prend son numéro dans la plage du poste', async () => {
    device = await prepared()
    const engine = bus(device)
    await engine.refresh()
    const payment = (invoiceId: string): Record<string, unknown> => ({
      invoice_id: invoiceId,
      payment_id: newId(),
      receipt_id: newId(),
      receipt_number_usage_id: newId(),
      receipt_number: null,
      amount: 20000,
      currency: 'XAF',
      method: 'CASH',
      reference: null,
      effective_at: '2026-10-22T09:29:00.000Z',
      cash_session_id: null,
      retroactive_reason: null,
      receipt_document_id: newId(),
    })

    expect(
      engine.handles({
        name: 'RegisterPayment',
        payload: payment('01J9ZXK4M2Q8R7S6T5V4W3FZZZ'),
        expectedVersion: 1,
        idempotencyKey: 'cle-paiement-0001',
      }),
    ).toBe(false)
    await expectCode(
      engine.commit({
        name: 'RegisterPayment',
        payload: payment('01J9ZXK4M2Q8R7S6T5V4W3FZZZ'),
        expectedVersion: 1,
        idempotencyKey: 'cle-paiement-0001',
      }),
      'WRITE_OWNER_REQUIRED',
    )

    const owned = '01J9ZXK4M2Q8R7S6T5V4W3F001'
    const done = await engine.commit({
      name: 'RegisterPayment',
      payload: payment(owned),
      expectedVersion: 3,
      idempotencyKey: 'cle-paiement-0002',
    })
    expect(done.number).toBe('TEST-REC-2026-000001')
    // La version attendue suivante est celle que le poste a projetée (grand livre + 1).
    await expectCode(
      engine.commit({
        name: 'RegisterPayment',
        payload: payment(owned),
        expectedVersion: 3,
        idempotencyKey: 'cle-paiement-0003',
      }),
      'LOCAL_VERSION_CONFLICT',
    )
    const next = await engine.commit({
      name: 'RegisterPayment',
      payload: payment(owned),
      expectedVersion: 4,
      idempotencyKey: 'cle-paiement-0004',
    })
    expect(next.number).toBe('TEST-REC-2026-000002')
  })

  it('émission locale : propriété importée et réserve sous quota pour l’article stocké, jamais au-delà du quota', async () => {
    device = await prepared()
    const engine = bus(device)
    const invoiceId = '01J9ZXK4M2Q8R7S6T5V4W3F777'
    const line = (quantity: string): Record<string, unknown> => ({
      line_id: newId(),
      position: 1,
      catalog_item_id: '01J9ZXK4M2Q8R7S6T5V4W3I001',
      description: 'Monture fictive',
      quantity,
      unit_price_gross: 40000,
      discount_gross: 0,
      prescription_id: null,
    })
    await engine.commit({
      name: 'CreateInvoiceDraft',
      payload: {
        invoice_id: invoiceId,
        patient_id: '01J9ZXK4M2Q8R7S6T5V4W3PA01',
        visit_id: null,
        due_date: null,
        lines: [line('2')],
      },
      expectedVersion: null,
      idempotencyKey: 'cle-brouillon-0001',
    })

    const issued = await engine.commit({
      name: 'IssueInvoice',
      payload: {
        invoice_id: invoiceId,
        number_usage_id: newId(),
        number: null,
        issued_at: '2026-10-22T09:29:00.000Z',
        total_gross: 80000,
        write_owner_id: null,
        catalog_snapshot_sha256: 'b'.repeat(64),
        reservations: [],
      },
      expectedVersion: 1,
      idempotencyKey: 'cle-emission-0001',
    })

    expect(issued.number).toBe('TEST-FAC-2026-000301')
    expect(issued.payload['reservations']).toHaveLength(1)
    expect((issued.payload['reservations'] as Record<string, unknown>[])[0]).toMatchObject({
      device_allocation_id: '01J9ZXK4M2Q8R7S6T5V4W3Q001',
      quantity: '2',
    })
    expect(await device.db.allocations.get('01J9ZXK4M2Q8R7S6T5V4W3Q001')).toMatchObject({
      reservedLocalUnits: 2000,
    })
    const owners = (await device.db.allocations.toArray()).filter(
      (row) => row.kind === 'WRITE_OWNER' && row.invoiceId === invoiceId,
    )
    expect(owners).toHaveLength(1)

    // Une seconde facture de 2 montures dépasse le quota local restant (1) : refusée, rien n'est écrit.
    const other = '01J9ZXK4M2Q8R7S6T5V4W3F778'
    await engine.commit({
      name: 'CreateInvoiceDraft',
      payload: {
        invoice_id: other,
        patient_id: '01J9ZXK4M2Q8R7S6T5V4W3PA01',
        visit_id: null,
        due_date: null,
        lines: [line('2')],
      },
      expectedVersion: null,
      idempotencyKey: 'cle-brouillon-0002',
    })
    const before = await device.db.command_journal.count()
    await expectCode(
      engine.commit({
        name: 'IssueInvoice',
        payload: {
          invoice_id: other,
          number_usage_id: newId(),
          number: null,
          issued_at: '2026-10-22T09:29:00.000Z',
          total_gross: 80000,
          write_owner_id: null,
          catalog_snapshot_sha256: 'b'.repeat(64),
          reservations: [],
        },
        expectedVersion: 1,
        idempotencyKey: 'cle-emission-0002',
      }),
      'LOCAL_QUOTA_EXCEEDED',
    )
    expect(await device.db.command_journal.count()).toBe(before)
    expect(await device.db.allocations.get('01J9ZXK4M2Q8R7S6T5V4W3A002')).toMatchObject({
      nextValue: 302,
    })
  })

  it('journalise une dépense locale (EXPENSE) et refuse les mouvements à approbation locale (DEPOSIT)', async () => {
    device = await prepared()
    const engine = bus(device)
    await engine.refresh()

    const depositReq = {
      name: 'RecordCashMovement',
      payload: {
        movement_id: '01J9ZXK4M2Q8R7S6T5V4W3MV01',
        cash_session_id: '01J9ZXK4M2Q8R7S6T5V4W3S001',
        movement_kind: 'DEPOSIT',
        method: 'CASH',
        signed_amount: 5000,
        expense_category_id: null,
        reason: 'Apport monnaie',
        reference: null,
        approval_id: null,
        occurred_at: '2026-10-22T09:29:00.000Z',
      },
      expectedVersion: null,
      idempotencyKey: 'cle-mv-deposit',
    }
    expect(engine.handles(depositReq)).toBe(false)

    const expenseReq = {
      name: 'RecordCashMovement',
      payload: {
        movement_id: '01J9ZXK4M2Q8R7S6T5V4W3MV02',
        cash_session_id: null,
        movement_kind: 'EXPENSE',
        method: 'MTN_MOMO',
        signed_amount: -4500,
        expense_category_id: '01J9ZXK4M2Q8R7S6T5V4W3C001',
        reason: null,
        reference: null,
        approval_id: null,
        occurred_at: '2026-10-22T09:29:00.000Z',
      },
      expectedVersion: null,
      idempotencyKey: 'cle-mv-expense',
    }
    expect(engine.handles(expenseReq)).toBe(true)

    const result = await engine.commit(expenseReq)
    expect(result.replayed).toBe(false)
    expect(result.payload).toMatchObject({
      movement_kind: 'EXPENSE',
      method: 'MTN_MOMO',
      signed_amount: -4500,
    })
  })
})

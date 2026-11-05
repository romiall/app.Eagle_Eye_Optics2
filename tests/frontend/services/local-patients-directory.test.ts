import { beforeEach, describe, expect, it, vi } from 'vitest'

import { localPatients, resetLocalPatientsForTests } from '@/app/services/localPatients'
import type { PulledRecord } from '@/offline/api'

/**
 * Annuaire du poste (A2) : ce que `localPatients` lit du coffre selon la portée demandée. Sans portée, seuls les faits du
 * journal sont lus ; avec des identifiants, ces fiches du serveur seulement ; avec l'annuaire complet, toutes, gardées en
 * mémoire tant que le repère (session + dernier pull) ne change pas. Données fictives.
 */
const ID = '01J9ZXK4M2Q8R7S6T5V4W3PB01'
const OTHER = '01J9ZXK4M2Q8R7S6T5V4W3PB02'
const THIRD = '01J9ZXK4M2Q8R7S6T5V4W3PB03'

const vault = vi.hoisted(() => ({
  facts: [] as unknown[],
  pulled: [] as { entityType: string; entityId: string; data: unknown }[],
  stamp: null as string | null,
  reads: [] as (readonly string[] | undefined)[],
  stampReads: 0,
  forget: null as (() => void) | null,
}))

vi.mock('@/app/services/vault', () => ({
  whenVaultLocks: vi.fn((forget: () => void) => {
    vault.forget = forget
  }),
  localAdministrativeFacts: vi.fn(async () => vault.facts),
  localPulledRecords: vi.fn(async (_type: string, ids?: readonly string[]) => {
    vault.reads.push(ids)
    return ids === undefined
      ? vault.pulled
      : vault.pulled.filter((record) => ids.includes(record.entityId))
  }),
  localPullStamp: vi.fn(async () => {
    vault.stampReads += 1
    return vault.stamp
  }),
}))

function wire(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    record_number: 'EE-2026-0007',
    last_name: 'Ngono',
    first_names: 'Paul',
    sex: 'M',
    birth_date: '1979-06-12',
    phone_primary: '+237 677 00 00 07',
    archived: false,
    merged_into_patient_id: null,
    version: 3,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-20T08:00:00.000Z',
    ...fields,
  }
}

function pulled(id: string, fields: Record<string, unknown> = {}): PulledRecord {
  return {
    entityType: 'patient_records',
    entityId: id,
    entityVersion: 3,
    changeKind: 'UPDATED',
    changeSequence: '11',
    recordedAt: '2026-10-22T09:35:00.000Z',
    data: wire(id, fields),
  }
}

beforeEach(() => {
  vault.facts = []
  vault.pulled = []
  vault.stamp = 'S1:2026-10-30T08:00:00.000Z'
  vault.reads = []
  vault.stampReads = 0
  resetLocalPatientsForTests()
})

describe('portée de la lecture', () => {
  it('sans portée, seuls les faits du journal sont lus : ni l’annuaire ni son repère ne sont ouverts', async () => {
    vault.pulled = [pulled(ID)]

    const map = await localPatients()

    expect(map.size).toBe(0)
    expect(vault.reads).toEqual([])
    expect(vault.stampReads).toBe(0)
  })

  it('avec des identifiants, ces fiches du serveur seulement sont lues', async () => {
    vault.pulled = [pulled(ID), pulled(OTHER, { last_name: 'Tchoua' })]

    const map = await localPatients({ ids: [ID] })

    expect([...map.keys()]).toEqual([ID])
    expect(map.get(ID)?.patient.last_name).toBe('Ngono')
    expect(map.get(ID)?.state).toBe('acknowledged')
    expect(vault.reads).toEqual([[ID]])
  })

  it('une liste d’identifiants vide ne lit rien', async () => {
    vault.pulled = [pulled(ID)]

    expect((await localPatients({ ids: [] })).size).toBe(0)
    expect(vault.reads).toEqual([])
  })

  it('une projection vide, illisible ou dont l’identité ne correspond pas à sa clé est écartée, jamais corrigée', async () => {
    vault.pulled = [
      { ...pulled(ID), data: {} },
      { ...pulled(OTHER), data: wire(ID) },
      { ...pulled(THIRD, { version: 0 }) },
      pulled('01J9ZXK4M2Q8R7S6T5V4W3PB04'),
    ]

    const map = await localPatients({ directory: true })

    expect([...map.keys()]).toEqual(['01J9ZXK4M2Q8R7S6T5V4W3PB04'])
  })

  it('les faits du poste s’appliquent par-dessus la fiche du serveur lue', async () => {
    vault.pulled = [pulled(ID)]
    vault.facts = [
      {
        state: 'pending',
        fact: {
          commandId: '01J9ZXK4M2Q8R7S6T5V4W3PC01',
          commandName: 'UpdatePatient',
          entityType: 'patient_records',
          entityId: ID,
          payload: { patient_id: ID, changes: { phone_primary: '+237 699 11 22 33' } },
          number: null,
          recordedAt: '2026-10-28T11:00:00.000Z',
          expectedVersion: 3,
        },
      },
    ]

    const entry = (await localPatients({ ids: [ID] })).get(ID)

    expect(entry?.patient).toMatchObject({ phone_primary: '+237 699 11 22 33', version: 4 })
    expect(entry?.state).toBe('pending')
  })
})

describe('annuaire gardé en mémoire', () => {
  it('lu une fois par repère, relu quand le repère change, oublié quand plus rien ne peut être lu', async () => {
    vault.pulled = [pulled(ID)]

    await localPatients({ directory: true })
    await localPatients({ directory: true })
    expect(vault.reads).toHaveLength(1)

    // Un pull validé (ou un nouveau déverrouillage) change le repère : l’annuaire est relu.
    vault.stamp = 'S1:2026-10-30T09:00:00.000Z'
    await localPatients({ directory: true })
    expect(vault.reads).toHaveLength(2)

    // Coffre fermé : rien n’est lu et l’annuaire gardé en mémoire est oublié.
    vault.stamp = null
    expect((await localPatients({ directory: true })).size).toBe(0)
    expect(vault.reads).toHaveLength(2)

    vault.stamp = 'S1:2026-10-30T09:00:00.000Z'
    await localPatients({ directory: true })
    expect(vault.reads).toHaveLength(3)
  })

  it('chaque verrouillage du coffre fait oublier l’annuaire gardé en mémoire (D12), même si le repère est inchangé', async () => {
    vault.pulled = [pulled(ID)]
    await localPatients({ directory: true })
    expect(vault.forget).not.toBeNull()

    vault.forget?.()
    await localPatients({ directory: true })

    expect(vault.reads).toHaveLength(2)
  })

  it('un autre déverrouillage (autre session) ne réutilise pas l’annuaire de la session précédente', async () => {
    vault.pulled = [pulled(ID)]
    await localPatients({ directory: true })

    vault.stamp = 'S2:2026-10-30T08:00:00.000Z'
    await localPatients({ directory: true })

    expect(vault.reads).toHaveLength(2)
  })

  it('l’annuaire en mémoire ne cache pas les faits du poste, relus à chaque lecture', async () => {
    vault.pulled = [pulled(ID)]
    await localPatients({ directory: true })

    vault.facts = [
      {
        state: 'local',
        fact: {
          commandId: '01J9ZXK4M2Q8R7S6T5V4W3PC02',
          commandName: 'CreatePatient',
          entityType: 'patient_records',
          entityId: OTHER,
          payload: {
            patient_id: OTHER,
            last_name: 'Mbarga',
            sex: 'F',
            record_number: 'EE-2026-0042',
          },
          number: 'EE-2026-0042',
          recordedAt: '2026-10-28T10:00:00.000Z',
        },
      },
    ]
    const map = await localPatients({ directory: true })

    expect([...map.keys()].sort()).toEqual([ID, OTHER].sort())
    expect(vault.reads).toHaveLength(1)
  })
})

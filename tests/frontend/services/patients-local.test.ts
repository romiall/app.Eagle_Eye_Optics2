import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NetworkUnavailable } from '@/app/api'
import { localPatients } from '@/app/services/localPatients'
import { getPatient, searchPatients } from '@/app/services/patients'
import type { LocalPatient } from '@/domain/patients/local'

/**
 * Lectures des fiches patient : la proposition du poste pas encore consolidée prime sur le serveur ; serveur injoignable,
 * la copie du poste répond (données de ce poste seulement, jamais une absence affirmée) ; la recherche ne retombe sur le
 * poste que si l'écran le demande, la détection de doublons exigeant toujours le serveur. Données fictives.
 */
const ID = '01J9ZXK4M2Q8R7S6T5V4W3PA01'
const OTHER = '01J9ZXK4M2Q8R7S6T5V4W3PA02'

const locals = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock('@/app/services/localPatients', () => ({
  localPatients: vi.fn(async () => locals.map),
}))

function patient(id: string, lastName: string, record: string) {
  return {
    id,
    record_number: record,
    last_name: lastName,
    first_names: 'Marie',
    sex: 'F' as const,
    birth_date: '1985-03-04',
    phone_primary: '+237 600 00 01 02',
    archived: false,
    merged_into_patient_id: null,
    version: 1,
    birth_date_missing_reason: null,
    phone_secondary: null,
    phone_missing_reason: null,
    address: null,
    profession: null,
    guardian_contact: null,
    legacy_record: false,
    first_known_visit_on: null,
    first_visit_certified: false,
    legacy_record_number: null,
    created_at: '2026-10-28T10:00:00.000Z',
    updated_at: '2026-10-28T10:00:00.000Z',
  }
}

function setLocal(id: string, lastName: string, record: string, state: string): void {
  const entry: LocalPatient = { patient: patient(id, lastName, record), state }
  locals.map.set(id, entry)
}

function summary(id: string, lastName: string, record: string) {
  return {
    id,
    record_number: record,
    last_name: lastName,
    first_names: 'Marie',
    sex: 'F',
    birth_date: '1985-03-04',
    phone_primary: '+237 600 00 01 02',
    archived: false,
    merged_into_patient_id: null,
    version: 1,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  locals.map = new Map()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPatient', () => {
  it('une fiche du poste pas encore consolidée est lue SUR le poste, sans appeler le serveur qui l’ignore', async () => {
    setLocal(ID, 'Mbarga', 'EE-2026-0042', 'local')

    const result = await getPatient(ID)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.data.last_name).toBe('Mbarga')
    expect(result.freshness).toEqual({ serverAsOf: null, complete: false })
    expect(result.live).toBe(false)
  })

  it('une fiche inconnue du poste vient du serveur, avec sa fraîcheur', async () => {
    fetchMock.mockResolvedValue(json(200, { data: patient(ID, 'Du serveur', 'EE-2026-0001') }))

    const result = await getPatient(ID)

    expect(result.data.last_name).toBe('Du serveur')
    expect(result.live).toBe(true)
    expect(result.freshness.serverAsOf).not.toBeNull()
  })

  it('une fiche consolidée suit le serveur quand il répond, et la copie du poste quand il ne répond pas', async () => {
    setLocal(ID, 'Copie du poste', 'EE-2026-0042', 'acknowledged')
    fetchMock.mockResolvedValueOnce(json(200, { data: patient(ID, 'Du serveur', 'EE-2026-0042') }))
    expect((await getPatient(ID)).data.last_name).toBe('Du serveur')

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await getPatient(ID)
    expect(offline.data.last_name).toBe('Copie du poste')
    expect(offline.live).toBe(false)
  })

  it('une erreur du serveur n’est jamais remplacée par la copie du poste (fiche inconnue : 404)', async () => {
    setLocal(ID, 'Copie du poste', 'EE-2026-0042', 'acknowledged')
    fetchMock.mockResolvedValue(
      json(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'Ressource introuvable.' } }),
    )

    await expect(getPatient(ID)).rejects.toMatchObject({ status: 404 })
  })

  it('sans copie du poste, un serveur injoignable reste un réseau coupé', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(getPatient(ID)).rejects.toBeInstanceOf(NetworkUnavailable)
  })

  it('ne demande à l’annuaire du poste que la fiche lue, jamais l’annuaire entier', async () => {
    fetchMock.mockResolvedValue(json(200, { data: patient(ID, 'Du serveur', 'EE-2026-0001') }))

    await getPatient(ID)

    expect(vi.mocked(localPatients)).toHaveBeenLastCalledWith({ ids: [ID] })
  })
})

describe('searchPatients', () => {
  it('sans « includeLocal », un serveur injoignable lève toujours le réseau coupé (détection de doublons)', async () => {
    setLocal(ID, 'Mbarga', 'EE-2026-0042', 'local')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchPatients('Mbarga')).rejects.toBeInstanceOf(NetworkUnavailable)
  })

  it('« includeLocal » et serveur injoignable : les fiches du poste répondent, sans affirmer d’absence', async () => {
    setLocal(ID, 'Mbarga', 'EE-2026-0042', 'local')
    setLocal(OTHER, 'Tchoua', 'EE-2026-0043', 'pending')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await searchPatients('mbarga', 1, { includeLocal: true })

    expect(result.data.data.map((row) => row.id)).toEqual([ID])
    expect(result.freshness).toEqual({ serverAsOf: null, complete: false })
    expect(result.live).toBe(false)
  })

  it('« includeLocal » sans aucune fiche du poste : une page vide NON confirmée par le serveur', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await searchPatients('inconnu', 1, { includeLocal: true })

    expect(result.data.data).toEqual([])
    expect(result.live).toBe(false)
  })

  it('serveur joint : les fiches du poste pas encore consolidées s’ajoutent en tête de la première page', async () => {
    setLocal(ID, 'Mbarga', 'EE-2026-0042', 'local')
    setLocal(OTHER, 'Mbarga', 'EE-2026-0001', 'acknowledged')
    fetchMock.mockResolvedValue(
      json(200, {
        data: [summary(OTHER, 'Mbarga', 'EE-2026-0001')],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
      }),
    )

    const result = await searchPatients('Mbarga', 1, { includeLocal: true })

    expect(result.data.data.map((row) => row.id)).toEqual([ID, OTHER])
    expect(result.data.meta.total).toBe(2)
    expect(result.live).toBe(true)
  })

  it('serveur joint, page suivante ou aucune fiche en attente : la réponse du serveur telle quelle', async () => {
    setLocal(ID, 'Mbarga', 'EE-2026-0042', 'local')
    const page = {
      data: [summary(OTHER, 'Mbarga', 'EE-2026-0001')],
      meta: { current_page: 2, last_page: 2, per_page: 25, total: 26 },
    }
    fetchMock.mockResolvedValue(json(200, page))

    const second = await searchPatients('Mbarga', 2, { includeLocal: true })

    expect(second.data).toEqual(page)
  })

  it('l’annuaire du poste n’est ouvert que serveur injoignable : serveur joint, seules les fiches du poste comptent', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await searchPatients('mbarga', 1, { includeLocal: true })
    expect(vi.mocked(localPatients)).toHaveBeenLastCalledWith({ directory: true })

    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
    )
    await searchPatients('mbarga', 1, { includeLocal: true })
    expect(vi.mocked(localPatients)).toHaveBeenLastCalledWith({})
  })

  it('serveur injoignable : une fiche du serveur reçue par le pull se retrouve, une fiche fusionnée dans une autre jamais', async () => {
    setLocal(ID, 'Ngono', 'EE-2026-0007', 'acknowledged')
    locals.map.set(OTHER, {
      patient: { ...patient(OTHER, 'Ngono', 'EE-2026-0008'), merged_into_patient_id: ID },
      state: 'acknowledged',
    })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await searchPatients('ngono', 1, { includeLocal: true })

    expect(result.data.data.map((row) => row.id)).toEqual([ID])
    expect(result.live).toBe(false)
  })

  it('serveur joint : une fiche du serveur déjà reçue par le pull n’est jamais ajoutée en double à la réponse du serveur', async () => {
    setLocal(OTHER, 'Mbarga', 'EE-2026-0001', 'acknowledged')
    fetchMock.mockResolvedValue(
      json(200, {
        data: [summary(OTHER, 'Mbarga', 'EE-2026-0001')],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
      }),
    )

    const result = await searchPatients('Mbarga', 1, { includeLocal: true })

    expect(result.data.data.map((row) => row.id)).toEqual([OTHER])
    expect(result.data.meta.total).toBe(1)
  })
})

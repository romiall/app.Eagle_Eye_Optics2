import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settle } from '../settings/support'
import {
  buttonByName,
  callsTo,
  click,
  consultation,
  CONSULTATION_ID,
  errorWithDetails,
  openConsultation,
  PATHS,
  prescription,
  PRESCRIPTION_ID,
  READ_ONLY,
  resetEverything,
  stubConsultationApi,
  textOf,
} from './support'

/**
 * « Supprimer le brouillon » d'une prescription (chantier « CRUD des écrans », tranche 3a) : visible seulement pour un
 * brouillon enregistré et avec l'écriture clinique, confirmation, jeton `expected_updated_at` lu avec le brouillon, liste
 * relue, refus du serveur dit tel quel ; une prescription validée ne se supprime jamais. Données fictives.
 */
const URL = `/consultations/${CONSULTATION_ID}/prescriptions`
const TITLE = 'Supprimer le brouillon de la version 1 ?'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T09:42:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

const inProgress = () => consultation({ status: 'IN_PROGRESS', version: 2 })

function dialogTitled(root: HTMLElement, title: string): HTMLDialogElement {
  const found = [...root.querySelectorAll('dialog')].find((dialog) =>
    dialog.querySelector('h2')?.textContent?.includes(title),
  )
  if (found === undefined) throw new Error(`Boîte « ${title} » introuvable.`)
  return found
}

describe('écran de prescription : Supprimer le brouillon', () => {
  it('un brouillon enregistré se supprime après confirmation, avec le jeton lu, puis la liste est relue', async () => {
    const api = stubConsultationApi({ consultation: inProgress(), prescriptions: [prescription()] })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    expect(buttonByName(root, 'Supprimer le brouillon')).not.toBeNull()
    expect(buttonByName(root, 'Supprimer le brouillon')?.getAttribute('aria-label')).toBe(
      'Supprimer le brouillon de la version 1',
    )
    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    const dialog = dialogTitled(root, TITLE)
    expect(callsTo(api, 'POST', PATHS.prescriptionDelete)).toHaveLength(0)

    await click(buttonByName(dialog, 'Supprimer le brouillon'))
    await settle()

    const [call] = callsTo(api, 'POST', PATHS.prescriptionDelete)
    expect(call?.path).toBe(`/api/v1/prescriptions/${PRESCRIPTION_ID}/delete`)
    expect(call?.body).toEqual({
      prescription_id: PRESCRIPTION_ID,
      expected_updated_at: '2026-10-22T09:40:00.000Z',
      expected_version: null,
    })
    expect(call?.headers['Idempotency-Key']).toMatch(/^[0-9A-Z]{26}$/)
    const text = textOf(root)
    expect(text).toContain('Brouillon supprimé')
    expect(text).toContain('Aucune prescription')
    expect(buttonByName(root, 'Valider la prescription')).toBeNull()
    unmount()
  })

  it('« Garder le brouillon » ne supprime rien', async () => {
    const api = stubConsultationApi({ consultation: inProgress(), prescriptions: [prescription()] })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    await click(buttonByName(dialogTitled(root, TITLE), 'Garder le brouillon'))
    await settle()

    expect(callsTo(api, 'POST', PATHS.prescriptionDelete)).toHaveLength(0)
    expect(api.prescriptions).toHaveLength(1)
    expect(root.querySelector('dialog[open]')).toBeNull()
    unmount()
  })

  it('une prescription validée n’offre jamais la suppression', async () => {
    stubConsultationApi({
      consultation: inProgress(),
      prescriptions: [
        prescription({ status: 'VALIDATED', validated_at: '2026-10-22T09:41:00.000Z' }),
      ],
    })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    expect(textOf(root)).toContain('Version 1')
    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
    unmount()
  })

  it('en lecture seule, aucun bouton de suppression', async () => {
    stubConsultationApi({
      permissions: READ_ONLY,
      consultation: inProgress(),
      prescriptions: [prescription()],
    })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
    unmount()
  })

  it('un refus du serveur (validée entre-temps) est dit tel quel et la liste est relue', async () => {
    const api = stubConsultationApi({
      consultation: inProgress(),
      prescriptions: [prescription()],
      handlers: {
        deletePrescription: () => {
          api.prescriptions = [
            prescription({ status: 'VALIDATED', validated_at: '2026-10-22T09:41:00.000Z' }),
          ]
          return errorWithDetails(
            409,
            'STATE_TRANSITION_REFUSED',
            'Cette prescription est validée : elle est immuable.',
            { current_status: 'VALIDATED' },
          )
        },
      },
    })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    await click(buttonByName(dialogTitled(root, TITLE), 'Supprimer le brouillon'))
    await settle()

    const text = textOf(root)
    expect(text).toContain('Brouillon non supprimé')
    expect(text).toContain('Cette prescription est validée')
    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
    unmount()
  })

  it('un brouillon modifié ailleurs (jeton périmé) n’est pas supprimé et l’écran le dit', async () => {
    stubConsultationApi({
      consultation: inProgress(),
      prescriptions: [prescription()],
      handlers: {
        deletePrescription: () =>
          errorWithDetails(409, 'VERSION_CONFLICT', 'Prescription modifiée entre-temps.', {
            current_updated_at: '2026-10-22T09:41:00.000Z',
          }),
      },
    })
    const { root, unmount } = await openConsultation(URL)
    await settle()

    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    await click(buttonByName(dialogTitled(root, TITLE), 'Supprimer le brouillon'))
    await settle()

    expect(textOf(root)).toContain('Ce brouillon a été modifié entre-temps')
    unmount()
  })
})

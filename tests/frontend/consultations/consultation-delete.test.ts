import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsultationSummary } from '@/domain/contracts/generated'
import { takeFlash } from '@/pages/consultations/flash'

import { click } from '../patients/support'
import {
  callsTo as settingsCallsTo,
  CLINICIAN_PERMISSIONS,
  CONSULTATION_ID as LIST_CONSULTATION_ID,
  consultationPage,
  consultationSummary,
  json,
  MANAGER_PERMISSIONS,
  openApp as openListApp,
  type Recorded,
  resetEverything as resetListEverything,
  settle,
  STAFF_ID,
  stubSettingsApi,
  textOf as listTextOf,
} from '../settings/support'
import {
  buttonByName,
  callsTo,
  CLINICIAN,
  consultation,
  CONSULTATION_ID,
  errorWithDetails,
  openConsultation,
  PATHS,
  READ_ONLY,
  resetEverything,
  stubConsultationApi,
  textOf,
} from './support'

/**
 * Boutons « Modifier » et « Supprimer » d'un examen (liste et éditeur) : visibles selon l'état et les droits, la
 * suppression passe par une confirmation puis par la commande du serveur (version attendue, clé d'idempotence), le
 * refus du serveur est dit tel quel, un examen en cours ou terminé ne propose jamais « Supprimer ». Données fictives.
 */
const DELETE_URL = /\/api\/v1\/consultations\/[^/]+\/delete$/

afterEach(() => {
  resetListEverything()
  resetEverything()
  takeFlash()
  vi.unstubAllGlobals()
})

function link(root: ParentNode, label: string): HTMLAnchorElement | null {
  return (
    ([...root.querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === label) as
      HTMLAnchorElement | undefined) ?? null
  )
}

function dialogOf(root: ParentNode): HTMLDialogElement {
  const dialog = root.querySelector('dialog')
  if (dialog === null) throw new Error('Boîte de confirmation introuvable.')
  return dialog
}

/** Serveur simulé de la liste : les examens rendus changent d'un test à l'autre, la suppression est facultative. */
function listApi(
  items: () => ConsultationSummary[],
  options: { permissions?: string[]; remove?: (request: Recorded) => Response } = {},
) {
  return stubSettingsApi({
    permissions: options.permissions ?? CLINICIAN_PERMISSIONS,
    handlers: {
      'GET /api/v1/consultations': () => json(200, consultationPage(items())),
      ...(options.remove === undefined
        ? {}
        : { 'POST /api/v1/consultations/:id/delete': options.remove }),
    },
  })
}

const REFUSAL = errorWithDetails(
  409,
  'STATE_TRANSITION_REFUSED',
  'Cet examen est en cours : des rubriques y sont déjà enregistrées.',
  { current_status: 'IN_PROGRESS' },
)

describe('liste des examens : Modifier et Supprimer', () => {
  it('un brouillon du professionnel connecté offre Modifier et Supprimer', async () => {
    listApi(() => [consultationSummary({ status: 'DRAFT', version: 1 })])
    const { root } = await openListApp('/consultations')
    await settle()

    expect(link(root, 'Modifier')?.getAttribute('href')).toBe(
      `/consultations/${LIST_CONSULTATION_ID}`,
    )
    expect(buttonByName(root, 'Supprimer')).not.toBeNull()
    expect(buttonByName(root, 'Supprimer')?.getAttribute('aria-label')).toBe(
      'Supprimer l’examen de PATIENT FICTIF Élodie',
    )
  })

  it('un examen en cours se modifie mais ne se supprime pas', async () => {
    listApi(() => [consultationSummary({ status: 'IN_PROGRESS' })])
    const { root } = await openListApp('/consultations')
    await settle()

    expect(link(root, 'Modifier')).not.toBeNull()
    expect(buttonByName(root, 'Supprimer')).toBeNull()
  })

  it('un examen terminé s’ouvre en correction et ne se supprime jamais, même pour la gérante', async () => {
    listApi(
      () => [
        consultationSummary({
          status: 'COMPLETED',
          completed_at: '2026-10-22T10:00:00.000Z',
          current_revision: 1,
        }),
      ],
      { permissions: [...MANAGER_PERMISSIONS, 'clinical.amend'] },
    )
    const { root } = await openListApp('/consultations')
    await settle()

    expect(link(root, 'Modifier')?.getAttribute('href')).toBe(
      `/consultations/${LIST_CONSULTATION_ID}?corriger=1`,
    )
    // Le nom accessible commence par le libellé visible (WCAG 2.5.3) et dit qu'une correction crée une révision.
    const name = link(root, 'Modifier')?.getAttribute('aria-label') ?? ''
    expect(name.startsWith('Modifier')).toBe(true)
    expect(name).toContain('nouvelle révision')
    expect(buttonByName(root, 'Supprimer')).toBeNull()
  })

  it('sans le droit d’écrire, aucune carte n’offre Modifier ni Supprimer', async () => {
    listApi(() => [consultationSummary({ status: 'DRAFT' })], {
      permissions: ['clinical.read', 'patient.read'],
    })
    const { root } = await openListApp('/consultations')
    await settle()

    expect(listTextOf(root)).toContain('PATIENT FICTIF')
    expect(link(root, 'Modifier')).toBeNull()
    expect(buttonByName(root, 'Supprimer')).toBeNull()
  })

  it('le brouillon d’un autre professionnel ne se supprime pas, mais se modifie', async () => {
    const other = { id: STAFF_ID, display_name: 'Autre Professionnel' }
    listApi(() => [consultationSummary({ status: 'DRAFT', clinician: other })], {
      permissions: CLINICIAN_PERMISSIONS,
    })
    const { root } = await openListApp('/consultations')
    await settle()

    expect(buttonByName(root, 'Supprimer')).toBeNull()
    expect(link(root, 'Modifier')).not.toBeNull()
  })

  it('la gérante supprime le brouillon d’un autre professionnel', async () => {
    const other = { id: STAFF_ID, display_name: 'Autre Professionnel' }
    listApi(() => [consultationSummary({ status: 'DRAFT', clinician: other })], {
      permissions: MANAGER_PERMISSIONS,
    })
    const { root } = await openListApp('/consultations')
    await settle()

    expect(buttonByName(root, 'Supprimer')).not.toBeNull()
  })

  it('« Supprimer » demande confirmation, envoie la version attendue puis relit la liste', async () => {
    let items = [consultationSummary({ status: 'DRAFT', version: 1 })]
    const api = listApi(() => items, {
      remove: () => {
        items = []
        return json(200, {
          data: {
            consultation_id: LIST_CONSULTATION_ID,
            visit_id: '01J9ZXK4M2Q8R7S6T5V4W30V11',
            visit_status: 'ARRIVED',
            visit_version: 3,
          },
        })
      },
    })
    const { root } = await openListApp('/consultations')
    await settle()

    await click(buttonByName(root, 'Supprimer'))
    await settle()
    const dialog = dialogOf(root)
    expect(dialog.textContent).toContain('Supprimer l’examen de PATIENT FICTIF Élodie ?')
    expect(dialog.textContent).toContain('aucune rubrique enregistrée')
    expect(settingsCallsTo(api, 'POST', DELETE_URL)).toHaveLength(0)

    await click(buttonByName(dialog, 'Supprimer le brouillon'))
    await settle()

    const sent = settingsCallsTo(api, 'POST', DELETE_URL)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.path).toBe(`/api/v1/consultations/${LIST_CONSULTATION_ID}/delete`)
    expect(sent[0]?.body).toEqual({ consultation_id: LIST_CONSULTATION_ID, expected_version: 1 })
    expect(settingsCallsTo(api, 'GET', /\/api\/v1\/consultations$/).length).toBeGreaterThanOrEqual(
      2,
    )
    const text = listTextOf(root)
    expect(text).toContain('Examen supprimé')
    expect(text).toContain('Sa visite est revenue dans la file du jour')
    expect(text).not.toContain('PATIENT FICTIF')
    expect(root.querySelector('dialog')).toBeNull()
  })

  it('« Garder le brouillon » ne supprime rien', async () => {
    const api = listApi(() => [consultationSummary({ status: 'DRAFT', version: 1 })], {
      remove: () => json(200, {}),
    })
    const { root } = await openListApp('/consultations')
    await settle()

    await click(buttonByName(root, 'Supprimer'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Garder le brouillon'))
    await settle()

    expect(settingsCallsTo(api, 'POST', DELETE_URL)).toHaveLength(0)
    expect(root.querySelector('dialog')).toBeNull()
    expect(listTextOf(root)).toContain('PATIENT FICTIF')
  })

  it('un examen déjà supprimé ailleurs répond « introuvable » et l’écran le dit', async () => {
    let items = [consultationSummary({ status: 'DRAFT', version: 1 })]
    const api = listApi(() => items, {
      remove: () => {
        items = []
        return json(404, {
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Consultation introuvable.', details: {} },
          correlation_id: 'corr-test-0404',
        })
      },
    })
    const { root } = await openListApp('/consultations')
    await settle()

    await click(buttonByName(root, 'Supprimer'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Supprimer le brouillon'))
    await settle()

    expect(settingsCallsTo(api, 'POST', DELETE_URL)).toHaveLength(1)
    expect(listTextOf(root)).toContain('Examen non supprimé')
    expect(listTextOf(root)).toContain('n’existe plus')
  })

  it('un refus 409 du serveur (examen commencé entre-temps) s’affiche avec son message', async () => {
    let items = [consultationSummary({ status: 'DRAFT', version: 1 })]
    listApi(() => items, {
      remove: () => {
        items = [consultationSummary({ status: 'IN_PROGRESS', version: 2 })]
        return REFUSAL.clone()
      },
    })
    const { root } = await openListApp('/consultations')
    await settle()

    await click(buttonByName(root, 'Supprimer'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Supprimer le brouillon'))
    await settle()

    const text = listTextOf(root)
    expect(text).toContain('Examen non supprimé')
    expect(text).toContain('Cet examen est en cours')
    expect(buttonByName(root, 'Supprimer')).toBeNull()
    expect(link(root, 'Modifier')).not.toBeNull()
  })
})

describe('éditeur de consultation : Supprimer le brouillon', () => {
  it('un brouillon du professionnel connecté offre « Supprimer le brouillon »', async () => {
    stubConsultationApi({ consultation: consultation({ status: 'DRAFT', version: 1 }) })
    const { root } = await openConsultation()
    await settle()

    expect(buttonByName(root, 'Supprimer le brouillon')).not.toBeNull()
  })

  it('un examen en cours ou terminé n’offre jamais « Supprimer le brouillon »', async () => {
    stubConsultationApi({ consultation: consultation({ status: 'IN_PROGRESS', version: 2 }) })
    const first = await openConsultation()
    await settle()
    expect(buttonByName(first.root, 'Supprimer le brouillon')).toBeNull()
    first.unmount()

    stubConsultationApi({
      consultation: consultation({
        status: 'COMPLETED',
        version: 4,
        current_revision: 1,
        completed_at: '2026-10-22T10:00:00.000Z',
      }),
    })
    const second = await openConsultation()
    await settle()
    expect(buttonByName(second.root, 'Supprimer le brouillon')).toBeNull()
    expect(buttonByName(second.root, 'Corriger l’examen')).not.toBeNull()
  })

  it('en lecture seule, aucun bouton de suppression', async () => {
    stubConsultationApi({
      permissions: READ_ONLY,
      consultation: consultation({ status: 'DRAFT', version: 1 }),
    })
    const { root } = await openConsultation()
    await settle()

    expect(textOf(root)).toContain('Lecture seule')
    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
  })

  it('le brouillon d’un autre professionnel ne se supprime pas sans l’autorité de la gérante', async () => {
    stubConsultationApi({
      permissions: CLINICIAN,
      consultation: consultation({
        status: 'DRAFT',
        version: 1,
        clinician_id: '01J9ZXK4M2Q8R7S6T5V4W30S99',
      }),
    })
    const { root } = await openConsultation()
    await settle()

    expect(buttonByName(root, 'Enregistrer')).not.toBeNull()
    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
  })

  it('la gérante supprime le brouillon d’un autre professionnel', async () => {
    stubConsultationApi({
      permissions: [...CLINICIAN, 'approval.decide'],
      consultation: consultation({
        status: 'DRAFT',
        version: 1,
        clinician_id: '01J9ZXK4M2Q8R7S6T5V4W30S99',
      }),
    })
    const { root } = await openConsultation()
    await settle()

    expect(buttonByName(root, 'Supprimer le brouillon')).not.toBeNull()
  })

  it('confirmer envoie la version et la clé d’idempotence puis revient à la liste avec le message', async () => {
    const api = stubConsultationApi({ consultation: consultation({ status: 'DRAFT', version: 1 }) })
    const { root, router } = await openConsultation()
    await settle()

    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Supprimer le brouillon'))
    await settle()

    const sent = callsTo(api, 'POST', PATHS.delete)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.path).toBe(`/api/v1/consultations/${CONSULTATION_ID}/delete`)
    expect(sent[0]?.body).toEqual({ consultation_id: CONSULTATION_ID, expected_version: 1 })
    expect(sent[0]?.headers['Idempotency-Key']).toMatch(/^[0-9A-Z]{26}$/)
    expect(router.currentRoute.value.name).toBe('consultations')
    expect(textOf(root)).toContain('Examen supprimé')
    expect(api.removed).toBe(true)
  })

  it('un refus du serveur est dit dans l’éditeur et le dossier est relu', async () => {
    const api = stubConsultationApi({
      consultation: consultation({ status: 'DRAFT', version: 1 }),
      handlers: {
        remove: () => {
          api.server = consultation({ status: 'IN_PROGRESS', version: 2 })
          return REFUSAL.clone()
        },
      },
    })
    const { root } = await openConsultation()
    await settle()

    await click(buttonByName(root, 'Supprimer le brouillon'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Supprimer le brouillon'))
    await settle()

    const text = textOf(root)
    expect(text).toContain('Examen non supprimé')
    expect(text).toContain('Cet examen est en cours')
    expect(buttonByName(root, 'Supprimer le brouillon')).toBeNull()
  })

  it('depuis « Modifier » d’un examen terminé, l’éditeur s’ouvre directement en correction', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'COMPLETED',
        version: 4,
        current_revision: 1,
        completed_at: '2026-10-22T10:00:00.000Z',
      }),
    })
    const { root } = await openConsultation(`/consultations/${CONSULTATION_ID}?corriger=1`)
    await settle()

    expect(textOf(root)).toContain('Correction en cours')
  })

  it('sans la demande de correction, un examen terminé reste en lecture seule', async () => {
    stubConsultationApi({
      consultation: consultation({
        status: 'COMPLETED',
        version: 4,
        current_revision: 1,
        completed_at: '2026-10-22T10:00:00.000Z',
      }),
    })
    const { root } = await openConsultation()
    await settle()

    expect(textOf(root)).not.toContain('Correction en cours')
    expect(textOf(root)).toContain('Examen terminé')
  })
})

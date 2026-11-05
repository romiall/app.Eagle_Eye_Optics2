import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FollowUpPlan } from '@/domain/contracts/generated'

import {
  apiError,
  buttonByName,
  callsTo,
  click,
  CLINICIAN_PERMISSIONS,
  json,
  openApp,
  resetEverything,
  settle,
  stubSettingsApi,
  textOf,
  type,
} from '../settings/support'

/**
 * « Annuler le contrôle » recommandé (chantier « CRUD des écrans », tranche 3a) : visible pour un contrôle ACTIF seulement,
 * pour qui programme les contrôles avec la lecture clinique ; motif obligatoire, version attendue, message du résultat ;
 * un contrôle programmé par un rendez-vous, annulé ou clos ne l'offre pas ; refus du serveur dit tel quel. Données
 * fictives.
 */
const PLAN = '01J9ZXK4M2Q8R7S6T5V4W30F01'
const PATIENT = '01J9ZXK4M2Q8R7S6T5V4W30P01'
const CONSULTATION = '01J9ZXK4M2Q8R7S6T5V4W30C01'
const CLINICIAN = [...CLINICIAN_PERMISSIONS, 'follow_up.write', 'agenda.read']
const RECEPTION = ['patient.read', 'visit.register', 'agenda.read', 'agenda.write']

function plan(overrides: Partial<FollowUpPlan> = {}): FollowUpPlan {
  return {
    id: PLAN,
    consultation_id: CONSULTATION,
    patient_id: PATIENT,
    patient: {
      id: PATIENT,
      record_number: 'EE-2026-0001',
      last_name: 'PATIENT FICTIF',
      first_names: 'Test',
    },
    reason: 'ROUTINE',
    anchor_kind: 'CONSULTATION',
    anchor_date: '2026-10-22',
    interval_value: 3,
    interval_unit: 'MONTH',
    recommended_date: '2026-11-10',
    date_origin: 'CALCULATED',
    manual_reason: null,
    reminder_enabled: true,
    preferred_channel: 'CALL',
    advance_value: 7,
    advance_unit: 'DAY',
    reminder_date: '2026-11-03',
    notes: null,
    status: 'ACTIVE',
    appointment_id: null,
    version: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetEverything()
})

function dialogOf(root: ParentNode): HTMLDialogElement {
  const dialog = [...root.querySelectorAll('dialog')].find((candidate) =>
    candidate.textContent?.includes('Annuler le contrôle de'),
  )
  if (dialog === undefined) throw new Error('Boîte d’annulation introuvable.')
  return dialog
}

function listApi(plans: () => FollowUpPlan[], permissions: string[], cancel?: () => Response) {
  return stubSettingsApi({
    permissions,
    handlers: {
      'GET /api/v1/contact-tasks': () => json(200, { data: [] }),
      'GET /api/v1/follow-ups': () => json(200, { data: plans() }),
      ...(cancel === undefined ? {} : { 'POST /api/v1/follow-ups/:id/cancel': cancel }),
    },
  })
}

describe('patients à rappeler : Annuler le contrôle', () => {
  it('un contrôle actif s’annule avec un motif obligatoire et la version, puis la liste est relue', async () => {
    let current = [plan()]
    const api = listApi(
      () => current,
      CLINICIAN,
      () => {
        current = []
        return json(200, { data: plan({ status: 'CANCELLED', version: 2 }) })
      },
    )
    const { root, unmount } = await openApp('/suivis')
    await settle()

    const open = buttonByName(root, 'Annuler le contrôle')
    expect(open?.getAttribute('aria-label')).toBe('Annuler le contrôle de PATIENT FICTIF Test')
    await click(open)
    await settle()

    // Sans motif : refusé à l'écran, rien n'est envoyé.
    await click(buttonByName(dialogOf(root), 'Annuler le contrôle'))
    expect(callsTo(api, 'POST', /\/follow-ups\/.+\/cancel$/)).toHaveLength(0)
    expect(dialogOf(root).textContent).toContain('Indiquez le motif de l’annulation')

    await type(dialogOf(root), 'Motif de l’annulation (obligatoire)', 'Patient suivi ailleurs')
    await click(buttonByName(dialogOf(root), 'Annuler le contrôle'))
    await settle()

    const sent = callsTo(api, 'POST', /\/follow-ups\/.+\/cancel$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.path).toBe(`/api/v1/follow-ups/${PLAN}/cancel`)
    expect(sent[0]?.body).toEqual({
      follow_up_plan_id: PLAN,
      reason: 'Patient suivi ailleurs',
      expected_version: 1,
    })
    expect(textOf(root)).toContain('Le contrôle recommandé a été annulé')
    expect(buttonByName(root, 'Annuler le contrôle')).toBeNull()
    unmount()
  })

  it('un contrôle programmé par un rendez-vous, annulé ou clos n’offre pas l’annulation', async () => {
    listApi(
      () => [
        plan({ status: 'SCHEDULED', appointment_id: '01J9ZXK4M2Q8R7S6T5V4W30A01' }),
        plan({ id: '01J9ZXK4M2Q8R7S6T5V4W30F02', status: 'CLOSED' }),
      ],
      CLINICIAN,
    )
    const { root, unmount } = await openApp('/suivis')
    await settle()

    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(buttonByName(root, 'Annuler le contrôle')).toBeNull()
    unmount()
  })

  it('sans follow_up.write (accueil) ou sans la lecture clinique, aucun bouton', async () => {
    listApi(() => [plan({ reason: null })], RECEPTION)
    const { root, unmount } = await openApp('/suivis')
    await settle()

    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(buttonByName(root, 'Annuler le contrôle')).toBeNull()
    unmount()
  })

  it('le refus du serveur (programmé entre-temps) est dit tel quel et la liste est relue', async () => {
    let current = [plan()]
    listApi(
      () => current,
      CLINICIAN,
      () => {
        current = [
          plan({ status: 'SCHEDULED', version: 2, appointment_id: '01J9ZXK4M2Q8R7S6T5V4W30A01' }),
        ]
        return json(409, {
          error: {
            code: 'STATE_TRANSITION_REFUSED',
            message:
              'Un rendez-vous est programmé pour ce contrôle : annulez d’abord le rendez-vous.',
            details: { current_status: 'SCHEDULED' },
          },
          correlation_id: 'corr-test-0409',
        })
      },
    )
    const { root, unmount } = await openApp('/suivis')
    await settle()

    await click(buttonByName(root, 'Annuler le contrôle'))
    await settle()
    await type(dialogOf(root), 'Motif de l’annulation (obligatoire)', 'Patient suivi ailleurs')
    await click(buttonByName(dialogOf(root), 'Annuler le contrôle'))
    await settle()

    expect(textOf(root)).toContain('Un rendez-vous est programmé pour ce contrôle')
    expect(buttonByName(root, 'Annuler le contrôle')).toBeNull()
    unmount()
  })

  it('« Garder le contrôle » n’envoie rien', async () => {
    const api = listApi(
      () => [plan()],
      CLINICIAN,
      () => apiError(500, 'ERREUR', 'Ne doit pas être appelé.'),
    )
    const { root, unmount } = await openApp('/suivis')
    await settle()

    await click(buttonByName(root, 'Annuler le contrôle'))
    await settle()
    await click(buttonByName(dialogOf(root), 'Garder le contrôle'))
    await settle()

    expect(callsTo(api, 'POST', /\/follow-ups\/.+\/cancel$/)).toHaveLength(0)
    expect(buttonByName(root, 'Annuler le contrôle')).not.toBeNull()
    unmount()
  })
})

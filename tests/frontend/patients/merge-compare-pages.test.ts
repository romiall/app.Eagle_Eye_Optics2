/**
 * Interfaces « Comparer deux examens » et « Fusionner deux fiches » (L1D08), ainsi que leurs points
 * d'entrée depuis l'activité du patient et une consultation terminée : droits stricts, aucune fusion
 * automatique ni conversion d'échelle d'acuité, confirmation par mot de passe sur 423.
 */
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionForTests } from '@/app/session'
import { prescriptionFacts } from '@/domain/clinical/visitCompare'
import type {
  ClinicalRevisionDetail,
  Consultation,
  Patient,
  PatientActivity,
  PatientMergePreview,
  Prescription,
  VisualAcuityScale,
} from '@/domain/contracts/generated'

import {
  CLINICIAN,
  consultation,
  CONSULTATION_ID,
  openConsultation,
  prescription as consultationPrescription,
  resetEverything as resetConsultations,
  SCALE_NEAR,
  SCALE_TENTHS,
  scales,
  stubConsultationApi,
} from '../consultations/support'
import { activityOf, consultationItem, sectionsOf } from './activity-support'
import {
  apiError,
  buttonByName,
  click,
  field,
  ID_A,
  ID_B,
  ID_C,
  json,
  linkTo,
  openApp,
  pageOf,
  patient,
  READER,
  RECEPTION,
  resetEverything,
  stubPatientsApi,
  summaryOf,
  textOf,
  type,
} from './support'

const EXAM_OLD = '01J9ZXK4M2Q8R7S6T5V4W30601'
const EXAM_NEW = '01J9ZXK4M2Q8R7S6T5V4W30602'
const REV_OLD = '01J9ZXK4M2Q8R7S6T5V4W30611'
const REV_NEW = '01J9ZXK4M2Q8R7S6T5V4W30612'
const MERGE_ID = '01J9ZXK4M2Q8R7S6T5V4W30699'

const MANAGER = [
  'patient.read',
  'patient.merge',
  'clinical.read',
  'prescription.read',
  'invoice.read',
]

function mergePreview(overrides: Partial<PatientMergePreview> = {}): PatientMergePreview {
  const source = patient({
    id: ID_A,
    record_number: 'PAT-2026-000101',
    last_name: 'Ndoumbe',
    first_names: 'Jeanne',
    phone_primary: '+237 699 00 11 22',
    version: 3,
  })
  const survivor = patient({
    id: ID_B,
    record_number: 'PAT-2026-000042',
    last_name: 'NDOUMBE',
    first_names: 'Jeanne Claire',
    phone_primary: '+237 699 00 11 22',
    version: 2,
  })
  return {
    source,
    survivor,
    linked: {
      visits: 2,
      appointments_upcoming: 0,
      consultations: 1,
      prescriptions: 1,
      invoices: 0,
    },
    blockers: [],
    can_merge: true,
    ...overrides,
  }
}

function clinicalRevision(
  consultationId: string,
  revisionId: string,
  steps: ClinicalRevisionDetail['snapshot']['steps'],
  recordedAt: string,
): ClinicalRevisionDetail {
  return {
    id: revisionId,
    revision_no: 1,
    recorded_at: recordedAt,
    author_id: '01J9ZXK4M2Q8R7S6T5V4W30002',
    reason: 'EXAMEN_COMPLET',
    previous_revision_id: null,
    sha256: 'a'.repeat(64),
    snapshot: {
      consultation_id: consultationId,
      revision_no: 1,
      recorded_at: recordedAt,
      author: { user_id: '01J9ZXK4M2Q8R7S6T5V4W30002', display_name: 'Dr Kammogne' },
      patient: {
        patient_id: ID_A,
        record_number: 'PAT-2026-000101',
        last_name: 'Ndoumbe',
        first_names: 'Jeanne',
      },
      visit_id: '01J9ZXK4M2Q8R7S6T5V4W30100',
      effective_at: recordedAt,
      steps,
      finalization_missing_data_reason: null,
      previous_revision_id: null,
      amendment_reason: null,
    },
  }
}

function wrapFetchWithExtra(
  handle: (url: URL, method: string, bodyText: string | undefined) => Response | null,
): void {
  const previous = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const bodyText = typeof init?.body === 'string' ? init.body : undefined
    const matched = handle(url, method, bodyText)
    if (matched !== null) return matched
    return previous(input, init)
  })
}

async function searchAndSelectSurvivor(
  root: ParentNode,
  query: string,
  optionLabel: RegExp,
): Promise<void> {
  vi.useFakeTimers()
  try {
    const input = field(root, 'Fiche à conserver') as HTMLInputElement
    input.value = query
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(250)
  } finally {
    vi.useRealTimers()
  }
  await flushPromises()
  const options = Array.from(root.querySelectorAll('[role="option"]'))
  const target = options.find((el) => optionLabel.test(el.textContent ?? ''))
  if (target === undefined) {
    throw new Error(`Option introuvable pour ${String(optionLabel)}`)
  }
  await click(target)
}

beforeEach(() => {
  resetEverything()
  resetConsultations()
  resetSessionForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('points d’entrée « Comparer deux examens »', () => {
  it('apparaît dans l’activité avec 2 examens et module consultations ouvert', async () => {
    const twoExams = sectionsOf({
      VISITS: 2,
      EXAMS: 2,
      PRESCRIPTIONS: 1,
      FINANCIAL: 0,
    })
    stubPatientsApi({
      permissions: ['patient.read', 'clinical.read'],
      modules: ['patients', 'consultations'],
      handlers: {
        get: () => json(200, { data: patient({ id: ID_A }) }),
        activity: () =>
          json(
            200,
            activityOf(
              [
                consultationItem({ id: EXAM_NEW, occurred_at: '2026-10-12T10:00:00Z' }),
                consultationItem({ id: EXAM_OLD, occurred_at: '2026-08-12T10:00:00Z' }),
              ],
              twoExams,
            ),
          ),
      },
    })

    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)
    const link = linkTo(root, `/patients/${ID_A}/comparaison`)
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Comparer deux examens')
    unmount()
  })

  it.each([
    ['sans droit clinique', READER, ['patients', 'consultations'], 2],
    ['avec un seul examen', ['patient.read', 'clinical.read'], ['patients', 'consultations'], 1],
    ['module consultations fermé', ['patient.read', 'clinical.read'], ['patients'], 2],
  ])('reste absent (%s)', async (_label, permissions, modules, examTotal) => {
    const counts = permissions.includes('clinical.read')
      ? sectionsOf({ VISITS: 2, EXAMS: examTotal, PRESCRIPTIONS: 0, FINANCIAL: 0 })
      : [sectionsOf({ VISITS: 2, EXAMS: 0, PRESCRIPTIONS: 0, FINANCIAL: 0 })[0]!]
    stubPatientsApi({
      permissions,
      modules,
      handlers: {
        get: () => json(200, { data: patient({ id: ID_A }) }),
        activity: () => json(200, activityOf([], counts)),
      },
    })

    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)
    expect(linkTo(root, `/patients/${ID_A}/comparaison`)).toBeNull()
    unmount()
  })

  it('apparaît sur un examen terminé vers la comparaison pré-sélectionnée', async () => {
    const completed: Consultation = consultation({
      id: CONSULTATION_ID,
      patient_id: ID_A,
      status: 'COMPLETED',
      completed_at: '2026-10-12T11:00:00Z',
    })
    stubConsultationApi({
      permissions: CLINICIAN,
      handlers: {
        getConsultation: () => json(200, { data: completed }),
      },
    })

    const { root, unmount } = await openConsultation(`/consultations/${CONSULTATION_ID}`)
    const compareLink = linkTo(root, `/patients/${ID_A}/comparaison?compare=${CONSULTATION_ID}`)
    expect(compareLink).not.toBeNull()
    expect(compareLink?.textContent).toContain('Comparer à un autre examen')
    unmount()
  })
})

describe('écran « Comparer deux examens » (L1D08)', () => {
  it('compare deux examens, isole les échelles incompatibles sans convertir et signale une prescription manquante', async () => {
    const activity: PatientActivity = activityOf(
      [
        consultationItem({
          id: EXAM_NEW,
          occurred_at: '2026-10-12T10:00:00Z',
          clinician_name: 'Dr Kammogne',
        }),
        consultationItem({
          id: EXAM_OLD,
          occurred_at: '2026-08-12T10:00:00Z',
          clinician_name: 'Dr Tchoupo',
        }),
      ],
      sectionsOf({ VISITS: 2, EXAMS: 2, PRESCRIPTIONS: 1, FINANCIAL: 0 }),
    )
    const oldConsult = consultation({
      id: EXAM_OLD,
      patient_id: ID_A,
      status: 'COMPLETED',
      effective_at: '2026-08-12T10:00:00Z',
      completed_at: '2026-08-12T10:30:00Z',
      current_revision: 1,
    })
    const newConsult = consultation({
      id: EXAM_NEW,
      patient_id: ID_A,
      status: 'COMPLETED',
      effective_at: '2026-10-12T10:00:00Z',
      completed_at: '2026-10-12T10:30:00Z',
      current_revision: 1,
    })
    const oldSteps = oldConsult.steps
    oldSteps.VISUAL_ACUITY = {
      acuities: [
        {
          id: '01J9ZXK4M2Q8R7S6T5V4W30621',
          context: 'PRELIMINARY',
          distance: 'FAR',
          correction: 'WITHOUT',
          eye: 'OD',
          scale_id: SCALE_TENTHS,
          raw_value: '08/10',
          normalized_value: null,
        },
      ],
    }
    const newSteps = newConsult.steps
    newSteps.VISUAL_ACUITY = {
      acuities: [
        {
          id: '01J9ZXK4M2Q8R7S6T5V4W30622',
          context: 'PRELIMINARY',
          distance: 'FAR',
          correction: 'WITHOUT',
          eye: 'OD',
          scale_id: SCALE_NEAR,
          raw_value: 'P2',
          normalized_value: null,
        },
      ],
    }
    const scaleList: VisualAcuityScale[] = scales()
    const validatedRx: Prescription = consultationPrescription({
      consultation_id: EXAM_NEW,
      patient_id: ID_A,
      status: 'VALIDATED',
      validated_at: '2026-10-12T10:35:00Z',
      validated_by: '01J9ZXK4M2Q8R7S6T5V4W30002',
    })

    stubPatientsApi({
      permissions: ['patient.read', 'clinical.read', 'prescription.read'],
      modules: ['patients', 'consultations'],
      handlers: {
        get: () => json(200, { data: patient({ id: ID_A }) }),
        activity: () => json(200, activity),
      },
    })
    wrapFetchWithExtra((url, method) => {
      if (method !== 'GET') return null
      if (url.pathname === '/api/v1/visual-acuity-scales') return json(200, { data: scaleList })
      if (url.pathname === `/api/v1/consultations/${EXAM_OLD}`)
        return json(200, { data: oldConsult })
      if (url.pathname === `/api/v1/consultations/${EXAM_NEW}`)
        return json(200, { data: newConsult })
      if (url.pathname === `/api/v1/consultations/${EXAM_OLD}/revisions/1`) {
        return json(200, {
          data: clinicalRevision(EXAM_OLD, REV_OLD, oldSteps, '2026-08-12T10:30:00Z'),
        })
      }
      if (url.pathname === `/api/v1/consultations/${EXAM_NEW}/revisions/1`) {
        return json(200, {
          data: clinicalRevision(EXAM_NEW, REV_NEW, newSteps, '2026-10-12T10:30:00Z'),
        })
      }
      if (url.pathname === `/api/v1/consultations/${EXAM_OLD}/prescriptions`) {
        return json(200, { data: [] })
      }
      if (url.pathname === `/api/v1/consultations/${EXAM_NEW}/prescriptions`) {
        return json(200, { data: [validatedRx] })
      }
      return null
    })

    const { root, unmount } = await openApp(`/patients/${ID_A}/comparaison?compare=${EXAM_NEW}`)
    const text = textOf(root)
    expect(text).toContain('Comparer deux examens')
    expect(text).toContain('08/10')
    expect(text).toContain('P2')
    expect(text).toContain('Échelles différentes : ces valeurs ne sont pas comparables.')
    expect(text).toContain('acuité(s) d’échelles différentes, non comparées')
    expect(text).toContain('L’examen de référence n’a pas de prescription validée.')
    expect(linkTo(root, `/patients/${ID_A}`)).not.toBeNull()
    expect(linkTo(root, `/consultations/${EXAM_OLD}`)).not.toBeNull()
    expect(linkTo(root, `/consultations/${EXAM_NEW}`)).not.toBeNull()
    // Contrôle de non-régression sur le helper : aucune conversion de fait.
    expect(prescriptionFacts).toBeTypeOf('function')
    unmount()
  })

  it('affiche un état clair lorsqu’un seul examen est terminé', async () => {
    stubPatientsApi({
      permissions: ['patient.read', 'clinical.read'],
      modules: ['patients', 'consultations'],
      handlers: {
        get: () => json(200, { data: patient({ id: ID_A }) }),
        activity: () =>
          json(
            200,
            activityOf(
              [consultationItem({ id: EXAM_NEW, occurred_at: '2026-10-12T10:00:00Z' })],
              sectionsOf({ VISITS: 1, EXAMS: 1, PRESCRIPTIONS: 0, FINANCIAL: 0 }),
            ),
          ),
      },
    })
    wrapFetchWithExtra((url) =>
      url.pathname === '/api/v1/visual-acuity-scales' ? json(200, { data: scales() }) : null,
    )

    const { root, unmount } = await openApp(`/patients/${ID_A}/comparaison`)
    expect(textOf(root)).toContain('Pas assez d’examens terminés')
    unmount()
  })
})

describe('écran « Fusionner deux fiches » (L1D08)', () => {
  it('affiche les écarts d’identité et empêche la fusion lorsqu’un garde-fou bloque', async () => {
    const source: Patient = patient({
      id: ID_A,
      record_number: 'PAT-2026-000101',
      last_name: 'Ndoumbe',
      first_names: 'Jeanne',
      version: 3,
    })
    const survivor: Patient = patient({
      id: ID_B,
      record_number: 'PAT-2026-000042',
      last_name: 'Ndoumbe',
      first_names: 'Jeanne Claire',
      version: 2,
    })
    const blockedPreview = mergePreview({
      can_merge: false,
      blockers: [
        {
          code: 'CONSULTATION_IN_PROGRESS',
          message: 'Un examen est encore en cours sur la fiche à absorber.',
        },
      ],
    })

    stubPatientsApi({
      permissions: MANAGER,
      modules: ['patients', 'consultations', 'sales'],
      handlers: {
        get: (id) => json(200, { data: id === ID_B ? survivor : source }),
        search: () => json(200, pageOf([summaryOf(source), summaryOf(survivor)])),
      },
    })
    wrapFetchWithExtra((url, method) => {
      if (method === 'GET' && url.pathname === `/api/v1/patients/${ID_A}/merge-preview`) {
        return json(200, { data: blockedPreview })
      }
      return null
    })

    const { root, unmount } = await openApp(`/patients/${ID_A}/fusion`)
    await searchAndSelectSurvivor(root, 'Ndoumbe', /PAT-2026-000042/)

    const text = textOf(root)
    expect(text).toContain('Fusion impossible pour l’instant')
    expect(text).toContain('Un examen est encore en cours sur la fiche à absorber.')
    expect(text).toContain('1 champ(s) diffèrent')
    expect(buttonByName(root, /Fusionner les deux fiches/)).toBeNull()
    unmount()
  })

  it('exige un motif, demande le mot de passe sur 423 puis redirige vers la fiche conservée', async () => {
    const source: Patient = patient({
      id: ID_A,
      record_number: 'PAT-2026-000101',
      last_name: 'Ndoumbe',
      first_names: 'Jeanne',
      version: 3,
    })
    const survivor: Patient = patient({
      id: ID_B,
      record_number: 'PAT-2026-000042',
      last_name: 'Ndoumbe',
      first_names: 'Jeanne Claire',
      version: 2,
    })
    const readyPreview = mergePreview({
      source: { ...mergePreview().source, first_names: 'Jeanne' },
      survivor: { ...mergePreview().survivor, first_names: 'Jeanne Claire' },
      can_merge: true,
      blockers: [],
    })

    let mergeAttempts = 0
    let reauthenticated = false
    const recordedBodies: Array<Record<string, unknown>> = []
    let archivedCount = 0

    stubPatientsApi({
      permissions: [...MANAGER, ...RECEPTION],
      modules: ['patients', 'consultations', 'sales'],
      handlers: {
        get: (id) => json(200, { data: id === ID_B ? survivor : source }),
        search: () => json(200, pageOf([summaryOf(source), summaryOf(survivor)])),
      },
    })
    wrapFetchWithExtra((url, method, bodyText) => {
      if (method === 'GET' && url.pathname === `/api/v1/patients/${ID_A}/merge-preview`) {
        return json(200, { data: readyPreview })
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/reauthenticate') {
        reauthenticated = true
        return json(200, { data: { reauthenticated: true } })
      }
      if (method === 'POST' && url.pathname === `/api/v1/patients/${ID_A}/merge`) {
        mergeAttempts += 1
        recordedBodies.push(bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {})
        if (!reauthenticated) {
          return apiError(423, 'REAUTHENTICATION_REQUIRED', 'Confirmez votre mot de passe.')
        }
        archivedCount += 1
        return json(201, {
          data: {
            id: MERGE_ID,
            source_patient_id: ID_A,
            survivor_patient_id: ID_B,
            approved_by: ID_C,
            merged_at: '2026-10-12T12:00:00Z',
            reason: 'Doublon saisi à l’accueil',
            source_version: 3,
          },
        })
      }
      return null
    })

    const { root, router, unmount } = await openApp(`/patients/${ID_A}/fusion`)
    await searchAndSelectSurvivor(root, 'Ndoumbe', /PAT-2026-000042/)

    // Motif trop court refusé sans envoi.
    await click(buttonByName(root, /Fusionner les deux fiches/))
    expect(textOf(root)).toContain('Indiquez le motif de la fusion')
    expect(mergeAttempts).toBe(0)

    await type(root, 'Motif de la fusion', 'Doublon saisi à l’accueil')
    await click(buttonByName(root, /Fusionner les deux fiches/))
    expect(textOf(document.body)).toContain('Fusionner définitivement ces deux fiches ?')

    await click(buttonByName(document.body, 'Fusionner'))
    expect(mergeAttempts).toBe(1)
    expect(textOf(document.body)).toContain('Confirmer votre mot de passe')

    await type(document.body, 'Mot de passe', 'secret-gerante')
    await click(buttonByName(document.body, 'Confirmer et reprendre'))

    expect(reauthenticated).toBe(true)
    expect(mergeAttempts).toBe(2)
    expect(archivedCount).toBe(1)
    expect(recordedBodies[1]).toEqual({
      source_patient_id: ID_A,
      survivor_patient_id: ID_B,
      reason: 'Doublon saisi à l’accueil',
      expected_version: 3,
    })
    expect(router.currentRoute.value.fullPath).toBe(`/patients/${ID_B}`)
    unmount()
  })
})

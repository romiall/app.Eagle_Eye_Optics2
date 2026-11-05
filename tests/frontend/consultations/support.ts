// Serveur simulé et aides de saisie pour les tests de la consultation par étapes (C01 à C04) et du
// démarrage de l'examen depuis la file du jour. Données FICTIVES. `fetch` est remplacé : le vrai client HTTP, le
// vrai répartiteur de mutations et le vrai routeur travaillent contre des réponses au format des
// contrats F06 (Consultation, ConsultationResponse, Visit, VisitPage, Patient). Le serveur simulé est
// ÉTATFUL : un enregistrement d'étape change la consultation (version, état, étape) que la lecture
// suivante rend, comme le serveur réel ; la finalisation et la correction écrivent des révisions
// relisibles, les prescriptions se créent, se modifient et se valident.
import { flushPromises } from '@vue/test-utils'
import { vi, type Mock } from 'vitest'

import type {
  ClinicalRevisionDetail,
  Consultation,
  ConsultationHeaderPatient,
  MeResponse,
  Patient,
  Prescription,
  Visit,
  VisualAcuityScale,
} from '@/domain/contracts/generated'

import {
  apiError,
  buttonByName,
  click,
  field,
  hasField,
  ID_A,
  json,
  linkTo,
  openApp,
  patient as basePatient,
  textOf,
  type,
  type Recorded,
} from '../patients/support'
import { ALL_TEST_MODULES, meResponse } from '../shell/server'
import {
  resetEverything as resetVisitsEverything,
  VISIT_A,
  visit,
  visitPage,
} from '../visits/support'

export {
  apiError,
  buttonByName,
  click,
  field,
  hasField,
  ID_A,
  json,
  linkTo,
  openApp,
  textOf,
  type,
  type Recorded,
  VISIT_A,
  visit,
  visitPage,
}

export const CONSULTATION_ID = '01J9ZXK4M2Q8R7S6T5V4W30501'
/** Identifiant du compte de `meResponse` : le professionnel de la consultation. */
export const ACCOUNT_ID = '01J9ZXK4M2Q8R7S6T5V4W30002'

/** Professionnel : lit et saisit les consultations, lit les patients et la file. */
export const CLINICIAN = [
  'clinical.read',
  'clinical.write',
  'clinical.complete',
  'clinical.amend',
  'patient.read',
  'visit.register',
  'agenda.read',
]
/** Lecture seule : consulte sans modifier. */
export const READ_ONLY = ['clinical.read', 'patient.read', 'agenda.read']

type Steps = Consultation['steps']

export function emptySteps(): Steps {
  return {
    ANAMNESIS: {
      symptoms: null,
      wears_glasses: null,
      glasses_duration: null,
      previous_correction_available: null,
      complaints: [],
    },
    HISTORIES: { histories: [] },
    VISUAL_ACUITY: { acuities: [] },
    REFRACTION: { measurements: [], refraction_observations: null, ametropias: [] },
    CENTERING: {
      centering_id: null,
      pd_total: null,
      pd_od: null,
      pd_og: null,
      inconsistency_reason: null,
    },
    MEDICATIONS: { orders: [] },
    CONCLUSION: {
      conclusion: null,
      referral: null,
      referral_urgency: null,
      referral_reasons: [],
    },
  }
}

export function consultation(
  overrides: Partial<Omit<Consultation, 'steps'>> & {
    steps?: Partial<Record<keyof Steps, unknown>>
  } = {},
): Consultation {
  const { steps, ...rest } = overrides
  return {
    id: CONSULTATION_ID,
    visit_id: VISIT_A,
    patient_id: ID_A,
    clinician_id: ACCOUNT_ID,
    effective_at: '2026-10-22T09:42:00.000Z',
    date_change_reason: null,
    status: 'DRAFT',
    current_revision: 0,
    completed_at: null,
    finalization_missing_data_reason: null,
    version: 1,
    steps: { ...emptySteps(), ...(steps ?? {}) } as Steps,
    revisions: [],
    patient: patientSummary(),
    ...rest,
  }
}

/** Identité de base rendue avec la consultation (en-tête), tirée de la fiche fictive. */
export function patientSummary(source: Patient = basePatient()): ConsultationHeaderPatient {
  return {
    id: source.id,
    record_number: source.record_number,
    last_name: source.last_name,
    first_names: source.first_names,
    sex: source.sex,
    birth_date: source.birth_date,
    profession: source.profession,
  }
}

/** Échelles d'acuité de DÉMONSTRATION (fictives), comme `eeo:clinical:scales --demo` les crée. */
export const SCALE_TENTHS = '01J9ZXK4M2Q8R7S6T5V4W30701'
export const SCALE_NEAR = '01J9ZXK4M2Q8R7S6T5V4W30702'
export function scales(): VisualAcuityScale[] {
  return [
    {
      id: SCALE_TENTHS,
      code: 'DEMO_DIXIEMES',
      label: 'Dixièmes (X/10) — DÉMONSTRATION',
      description: null,
      active: true,
    },
    {
      id: SCALE_NEAR,
      code: 'DEMO_PRES',
      label: 'Vision de près (Parinaud) — DÉMONSTRATION',
      description: null,
      active: true,
    },
  ]
}

export const PRESCRIPTION_ID = '01J9ZXK4M2Q8R7S6T5V4W30801'

/** Prescription fictive (brouillon par défaut) au format de la ressource `Prescription`. */
export function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: PRESCRIPTION_ID,
    series_id: '01J9ZXK4M2Q8R7S6T5V4W30802',
    version_no: 1,
    supersedes_id: null,
    patient_id: ID_A,
    origin: 'INTERNAL',
    consultation_id: CONSULTATION_ID,
    external_prescriber: null,
    external_prescribed_on: null,
    external_file_id: null,
    status: 'DRAFT',
    usage_code: 'PERMANENT',
    usage_other: null,
    lens_type_code: 'SINGLE_VISION',
    lens_type_other: null,
    lens_index: '1.50',
    lens_index_other: null,
    pd_total: '62.00',
    pd_od: '31.00',
    pd_og: '31.00',
    pd_inconsistency_reason: null,
    notes: null,
    eyes: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W30803',
        eye: 'OD',
        no_correction: false,
        sphere: '-1.25',
        cylinder: '-0.50',
        axis: 90,
        addition: null,
        fitting_height: null,
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W30804',
        eye: 'OG',
        no_correction: false,
        sphere: '-1.00',
        cylinder: null,
        axis: null,
        addition: null,
        fitting_height: null,
      },
    ],
    treatments: [],
    validated_at: null,
    validated_by: null,
    validated_by_name: null,
    document_id: null,
    updated_at: '2026-10-22T09:40:00.000Z',
    ...overrides,
  }
}

export function patient(overrides: Partial<Patient> = {}): Patient {
  return basePatient(overrides)
}

/** Refus du serveur avec valeurs actualisées (`details`) : conflit de version, refus d'état. */
export function errorWithDetails(
  status: number,
  code: string,
  message: string,
  details: Record<string, string | number | null>,
  fields?: Record<string, string[]>,
): Response {
  return json(status, {
    error: { code, message, details, ...(fields === undefined ? {} : { fields }) },
    correlation_id: 'corr-test-0200',
  })
}

type Reply = Response | 'network'
type Handler<A extends unknown[]> = (...args: A) => Reply | Promise<Reply>

export interface ConsultationApi {
  /** Réponse de GET /auth/me ; modifiable pendant le test (session expirée…). */
  me: MeResponse | 'anonymous' | 'unreachable'
  /** Consultation enregistrée sur le serveur : un enregistrement d'étape la change. */
  server: Consultation
  patient: Patient
  getConsultation: Handler<[id: string, request: Recorded]>
  getPatient: Handler<[id: string, request: Recorded]>
  /** Suppression d'un examen resté brouillon (POST /consultations/:id/delete). */
  remove: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  /** Vrai après une suppression acceptée : la consultation répond ensuite 404. */
  removed: boolean
  save: Handler<[id: string, step: string, body: Record<string, unknown>, request: Recorded]>
  start: Handler<[visitId: string, body: Record<string, unknown>, request: Recorded]>
  list: Handler<[day: string | null, page: number, request: Recorded]>
  /** Échelles d'acuité du cabinet (GET /visual-acuity-scales). */
  scales: VisualAcuityScale[]
  getScales: Handler<[request: Recorded]>
  complete: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  amend: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  getRevision: Handler<[id: string, revisionNo: number, request: Recorded]>
  /** Révisions figées (avec snapshot) écrites par `complete` et `amend`. */
  revisionDetails: ClinicalRevisionDetail[]
  /** Prescriptions du serveur simulé (toutes versions). */
  prescriptions: Prescription[]
  listPrescriptions: Handler<[consultationId: string, request: Recorded]>
  createPrescription: Handler<[path: string, body: Record<string, unknown>, request: Recorded]>
  getPrescription: Handler<[id: string, request: Recorded]>
  updatePrescription: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  /** Suppression d'un brouillon de prescription (POST /prescriptions/:id/delete). */
  deletePrescription: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  validatePrescription: Handler<[id: string, body: Record<string, unknown>, request: Recorded]>
  requests: Recorded[]
  fetchMock: Mock
}

const CONSULTATION_PATH = /^\/api\/v1\/consultations\/([^/]+)$/
const STEP_PATH = /^\/api\/v1\/consultations\/([^/]+)\/steps\/([^/]+)$/
const START_PATH = /^\/api\/v1\/visits\/([^/]+)\/consultations$/
const PATIENT_PATH = /^\/api\/v1\/patients\/([^/]+)$/
const COMPLETE_PATH = /^\/api\/v1\/consultations\/([^/]+)\/complete$/
const AMEND_PATH = /^\/api\/v1\/consultations\/([^/]+)\/amendments$/
const DELETE_PATH = /^\/api\/v1\/consultations\/([^/]+)\/delete$/
const REVISION_PATH = /^\/api\/v1\/consultations\/([^/]+)\/revisions\/([0-9]+)$/
const CONSULTATION_PRESCRIPTIONS_PATH = /^\/api\/v1\/consultations\/([^/]+)\/prescriptions$/
const PRESCRIPTION_PATH = /^\/api\/v1\/prescriptions\/([^/]+)$/
const PRESCRIPTION_REVISION_PATH = /^\/api\/v1\/prescriptions\/([^/]+)\/revisions$/
const PRESCRIPTION_VALIDATE_PATH = /^\/api\/v1\/prescriptions\/([^/]+)\/validate$/
const PRESCRIPTION_DELETE_PATH = /^\/api\/v1\/prescriptions\/([^/]+)\/delete$/
const SCALES_PATH = /^\/api\/v1\/visual-acuity-scales$/

/** Adresses des routes C02 à C04, pour filtrer les requêtes enregistrées. */
export const PATHS = {
  complete: COMPLETE_PATH,
  amend: AMEND_PATH,
  delete: DELETE_PATH,
  revision: REVISION_PATH,
  consultationPrescriptions: CONSULTATION_PRESCRIPTIONS_PATH,
  prescription: PRESCRIPTION_PATH,
  prescriptionDelete: PRESCRIPTION_DELETE_PATH,
  prescriptionRevision: PRESCRIPTION_REVISION_PATH,
  prescriptionValidate: PRESCRIPTION_VALIDATE_PATH,
  scales: SCALES_PATH,
} as const

export function callsTo(api: ConsultationApi, method: string, path: RegExp): Recorded[] {
  return api.requests.filter((request) => request.method === method && path.test(request.path))
}

export function patchCalls(api: ConsultationApi): Recorded[] {
  return callsTo(api, 'PATCH', STEP_PATH)
}

export function startCalls(api: ConsultationApi): Recorded[] {
  return callsTo(api, 'POST', START_PATH)
}

export function consultationReads(api: ConsultationApi): Recorded[] {
  return callsTo(api, 'GET', CONSULTATION_PATH)
}

export function listCalls(api: ConsultationApi): Recorded[] {
  return callsTo(api, 'GET', /^\/api\/v1\/visits$/)
}

export function stubConsultationApi(
  options: {
    permissions?: string[]
    modules?: readonly string[]
    displayName?: string
    consultation?: Consultation
    patient?: Patient
    handlers?: Partial<
      Pick<
        ConsultationApi,
        | 'getConsultation'
        | 'getPatient'
        | 'remove'
        | 'save'
        | 'start'
        | 'list'
        | 'getScales'
        | 'complete'
        | 'amend'
        | 'getRevision'
        | 'listPrescriptions'
        | 'createPrescription'
        | 'getPrescription'
        | 'updatePrescription'
        | 'deletePrescription'
        | 'validatePrescription'
      >
    >
    scales?: VisualAcuityScale[]
    prescriptions?: Prescription[]
    revisionDetails?: ClinicalRevisionDetail[]
  } = {},
): ConsultationApi {
  const requests: Recorded[] = []
  const api = {
    me: meResponse(options.permissions ?? CLINICIAN, options.displayName ?? 'Dr Fictif', [
      ...(options.modules ?? ALL_TEST_MODULES),
    ]),
    server: options.consultation ?? consultation(),
    patient: options.patient ?? patient(),
    scales: options.scales ?? scales(),
    prescriptions: options.prescriptions ?? [],
    revisionDetails: options.revisionDetails ?? [],
    requests,
  } as ConsultationApi

  api.removed = false
  api.getConsultation =
    options.handlers?.getConsultation ??
    (() =>
      api.removed
        ? apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
        : json(200, { data: api.server }))
  api.getPatient = options.handlers?.getPatient ?? (() => json(200, { data: api.patient }))
  api.remove =
    options.handlers?.remove ??
    ((id, body) => {
      if (api.removed || id !== api.server.id) {
        return apiError(404, 'RESOURCE_NOT_FOUND', 'Consultation introuvable.')
      }
      if (api.server.status !== 'DRAFT') {
        return errorWithDetails(409, 'STATE_TRANSITION_REFUSED', 'Cet examen ne se supprime pas.', {
          current_status: api.server.status,
        })
      }
      if (body['expected_version'] !== api.server.version) {
        return errorWithDetails(409, 'VERSION_CONFLICT', 'La consultation a été modifiée.', {
          current_version: api.server.version,
        })
      }
      api.removed = true
      return json(200, {
        data: {
          consultation_id: id,
          visit_id: api.server.visit_id,
          visit_status: 'ARRIVED',
          visit_version: 3,
        },
      })
    })
  api.save =
    options.handlers?.save ??
    ((_id, step, body) => {
      if (body['expected_version'] !== api.server.version) {
        return errorWithDetails(409, 'VERSION_CONFLICT', 'La consultation a été modifiée.', {
          current_version: api.server.version,
        })
      }
      const sent = body['step'] as { data: unknown }
      api.server = {
        ...api.server,
        status: 'IN_PROGRESS',
        version: api.server.version + 1,
        steps: { ...api.server.steps, [step]: sent.data } as Steps,
      }
      return json(200, { data: api.server })
    })
  api.start =
    options.handlers?.start ??
    ((visitId, body) => {
      api.server = consultation({
        id: String(body['consultation_id']),
        visit_id: visitId,
        patient_id: String(body['patient_id']),
        effective_at: String(body['effective_at']),
        status: 'DRAFT',
      })
      return json(201, { data: api.server })
    })
  api.list = options.handlers?.list ?? (() => json(200, visitPage([])))
  api.getScales = options.handlers?.getScales ?? (() => json(200, { data: api.scales }))

  const versionConflict = (body: Record<string, unknown>): Response | null =>
    body['expected_version'] !== api.server.version
      ? errorWithDetails(409, 'VERSION_CONFLICT', 'La consultation a été modifiée.', {
          current_version: api.server.version,
        })
      : null
  const freeze = (
    revisionId: string,
    revisionNo: number,
    previous: string | null,
    reason: string,
    amendment: string | null,
  ): void => {
    const recordedAt = new Date().toISOString()
    const meta = {
      id: revisionId,
      revision_no: revisionNo,
      recorded_at: recordedAt,
      author_id: ACCOUNT_ID,
      reason,
      previous_revision_id: previous,
      sha256: 'a'.repeat(64),
    }
    api.server = { ...api.server, revisions: [...api.server.revisions, meta] }
    api.revisionDetails = [
      ...api.revisionDetails,
      {
        ...meta,
        snapshot: {
          consultation_id: api.server.id,
          revision_no: revisionNo,
          recorded_at: recordedAt,
          author: { user_id: ACCOUNT_ID, display_name: 'Dr Fictif' },
          patient: {
            patient_id: api.server.patient.id,
            record_number: api.server.patient.record_number,
            last_name: api.server.patient.last_name,
            first_names: api.server.patient.first_names,
          },
          visit_id: api.server.visit_id,
          effective_at: api.server.effective_at,
          steps: structuredClone(api.server.steps),
          finalization_missing_data_reason: api.server.finalization_missing_data_reason,
          previous_revision_id: previous,
          amendment_reason: amendment,
        },
      },
    ]
  }

  api.complete =
    options.handlers?.complete ??
    ((_id, body) => {
      const conflict = versionConflict(body)
      if (conflict !== null) return conflict
      api.server = {
        ...api.server,
        status: 'COMPLETED',
        version: api.server.version + 1,
        current_revision: 1,
        completed_at: new Date().toISOString(),
        finalization_missing_data_reason:
          (body['finalization_missing_data_reason'] as string | null | undefined) ?? null,
      }
      freeze(String(body['revision_id']), 1, null, 'Finalisation de la consultation', null)
      return json(200, { data: api.server })
    })

  api.amend =
    options.handlers?.amend ??
    ((_id, body) => {
      const conflict = versionConflict(body)
      if (conflict !== null) return conflict
      const changed = body['steps'] as { step: string; data: unknown }[]
      const steps: Partial<Record<keyof Steps, unknown>> = { ...api.server.steps }
      for (const item of changed) steps[item.step as keyof Steps] = item.data
      const revisionNo = api.server.current_revision + 1
      api.server = {
        ...api.server,
        steps: steps as Steps,
        version: api.server.version + 1,
        current_revision: revisionNo,
      }
      freeze(
        String(body['revision_id']),
        revisionNo,
        String(body['previous_revision_id']),
        String(body['reason']),
        String(body['reason']),
      )
      return json(201, { data: api.server })
    })

  api.getRevision =
    options.handlers?.getRevision ??
    ((_id, revisionNo) => {
      const found = api.revisionDetails.find((revision) => revision.revision_no === revisionNo)
      return found === undefined
        ? apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
        : json(200, { data: found })
    })

  const findPrescription = (id: string): Prescription | undefined =>
    api.prescriptions.find((item) => item.id === id)
  const replacePrescription = (next: Prescription): void => {
    api.prescriptions = api.prescriptions.map((item) => (item.id === next.id ? next : item))
  }

  api.listPrescriptions =
    options.handlers?.listPrescriptions ??
    ((consultationId) =>
      json(200, {
        data: api.prescriptions
          .filter((item) => item.consultation_id === consultationId)
          .sort((a, b) => b.version_no - a.version_no),
      }))

  api.createPrescription =
    options.handlers?.createPrescription ??
    ((_path, body) => {
      const content = { ...body }
      delete content['expected_version']
      const id = String(content['prescription_id'])
      delete content['prescription_id']
      const created = {
        ...(content as unknown as Omit<Prescription, 'id'>),
        id,
        status: 'DRAFT',
        validated_at: null,
        validated_by: null,
        validated_by_name: null,
        document_id: null,
        updated_at: new Date().toISOString(),
      } as Prescription
      api.prescriptions = [...api.prescriptions, created]
      return json(201, { data: created })
    })

  api.getPrescription =
    options.handlers?.getPrescription ??
    ((id) => {
      const found = findPrescription(id)
      return found === undefined
        ? apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
        : json(200, { data: found })
    })

  api.updatePrescription =
    options.handlers?.updatePrescription ??
    ((id, body) => {
      const found = findPrescription(id)
      if (found === undefined) return apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
      if (found.status !== 'DRAFT') {
        return errorWithDetails(409, 'STATE_TRANSITION_REFUSED', 'Prescription validée.', {
          current_status: found.status,
        })
      }
      if (body['expected_updated_at'] !== found.updated_at) {
        return errorWithDetails(409, 'VERSION_CONFLICT', 'Prescription modifiée entre-temps.', {
          current_updated_at: found.updated_at,
        })
      }
      const next = {
        ...found,
        ...(body['changes'] as Partial<Prescription>),
        updated_at: new Date(Date.parse(found.updated_at) + 1000).toISOString(),
      } as Prescription
      replacePrescription(next)
      return json(200, { data: next })
    })

  api.deletePrescription =
    options.handlers?.deletePrescription ??
    ((id, body) => {
      const found = findPrescription(id)
      if (found === undefined) return apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
      if (found.status !== 'DRAFT') {
        return errorWithDetails(409, 'STATE_TRANSITION_REFUSED', 'Prescription validée.', {
          current_status: found.status,
        })
      }
      if (body['expected_updated_at'] !== found.updated_at) {
        return errorWithDetails(409, 'VERSION_CONFLICT', 'Prescription modifiée entre-temps.', {
          current_updated_at: found.updated_at,
        })
      }
      api.prescriptions = api.prescriptions.filter((item) => item.id !== id)
      return json(200, {
        data: {
          prescription_id: id,
          patient_id: found.patient_id,
          consultation_id: found.consultation_id,
          version_no: found.version_no,
        },
      })
    })

  api.validatePrescription =
    options.handlers?.validatePrescription ??
    ((id, body) => {
      const found = findPrescription(id)
      if (found === undefined) return apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
      if (found.status !== 'DRAFT') {
        return errorWithDetails(409, 'STATE_TRANSITION_REFUSED', 'Prescription déjà validée.', {
          current_status: found.status,
        })
      }
      const next = {
        ...found,
        status: 'VALIDATED',
        validated_at: new Date().toISOString(),
        validated_by: ACCOUNT_ID,
        validated_by_name: 'Professionnel (démonstration)',
        document_id: String(body['document_id']),
        updated_at: new Date().toISOString(),
      } as Prescription
      replacePrescription(next)
      return json(200, { data: next })
    })

  api.fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'https://cabinet.test')
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const request: Recorded = { method, path: url.pathname, query: url.searchParams, body, headers }
    requests.push(request)

    const settle = async (reply: Reply | Promise<Reply>): Promise<Response> => {
      const value = await reply
      if (value === 'network') throw new TypeError('Failed to fetch')
      return value
    }

    if (url.pathname === '/up') return json(200, { status: 'ok' })
    if (url.pathname === '/api/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname === '/api/v1/auth/me') {
      if (api.me === 'unreachable') throw new TypeError('Failed to fetch')
      if (api.me === 'anonymous') return apiError(401, 'AUTH_REQUIRED', 'Connexion requise.')
      return json(200, api.me)
    }
    if (url.pathname === '/api/v1/visits' && method === 'GET') {
      return settle(
        api.list(
          url.searchParams.get('date'),
          Number(url.searchParams.get('page') ?? '1'),
          request,
        ),
      )
    }
    if (SCALES_PATH.test(url.pathname) && method === 'GET') return settle(api.getScales(request))
    const completed = COMPLETE_PATH.exec(url.pathname)
    if (completed !== null && method === 'POST') {
      return settle(api.complete(decodeURIComponent(completed[1] ?? ''), body ?? {}, request))
    }
    const amended = AMEND_PATH.exec(url.pathname)
    if (amended !== null && method === 'POST') {
      return settle(api.amend(decodeURIComponent(amended[1] ?? ''), body ?? {}, request))
    }
    const removing = DELETE_PATH.exec(url.pathname)
    if (removing !== null && method === 'POST') {
      return settle(api.remove(decodeURIComponent(removing[1] ?? ''), body ?? {}, request))
    }
    const revision = REVISION_PATH.exec(url.pathname)
    if (revision !== null && method === 'GET') {
      return settle(
        api.getRevision(decodeURIComponent(revision[1] ?? ''), Number(revision[2]), request),
      )
    }
    const listed = CONSULTATION_PRESCRIPTIONS_PATH.exec(url.pathname)
    if (listed !== null && method === 'GET') {
      return settle(api.listPrescriptions(decodeURIComponent(listed[1] ?? ''), request))
    }
    if (
      method === 'POST' &&
      (listed !== null ||
        url.pathname === '/api/v1/prescriptions/external' ||
        PRESCRIPTION_REVISION_PATH.test(url.pathname))
    ) {
      return settle(api.createPrescription(url.pathname, body ?? {}, request))
    }
    const removedPrescription = PRESCRIPTION_DELETE_PATH.exec(url.pathname)
    if (removedPrescription !== null && method === 'POST') {
      return settle(
        api.deletePrescription(
          decodeURIComponent(removedPrescription[1] ?? ''),
          body ?? {},
          request,
        ),
      )
    }
    const validated = PRESCRIPTION_VALIDATE_PATH.exec(url.pathname)
    if (validated !== null && method === 'POST') {
      return settle(
        api.validatePrescription(decodeURIComponent(validated[1] ?? ''), body ?? {}, request),
      )
    }
    const single = PRESCRIPTION_PATH.exec(url.pathname)
    if (single !== null && method === 'GET') {
      return settle(api.getPrescription(decodeURIComponent(single[1] ?? ''), request))
    }
    if (single !== null && method === 'PATCH') {
      return settle(
        api.updatePrescription(decodeURIComponent(single[1] ?? ''), body ?? {}, request),
      )
    }
    const started = START_PATH.exec(url.pathname)
    if (started !== null && method === 'POST') {
      return settle(api.start(decodeURIComponent(started[1] ?? ''), body ?? {}, request))
    }
    const stepped = STEP_PATH.exec(url.pathname)
    if (stepped !== null && method === 'PATCH') {
      return settle(
        api.save(
          decodeURIComponent(stepped[1] ?? ''),
          decodeURIComponent(stepped[2] ?? ''),
          body ?? {},
          request,
        ),
      )
    }
    const one = CONSULTATION_PATH.exec(url.pathname)
    if (one !== null && method === 'GET') {
      return settle(api.getConsultation(decodeURIComponent(one[1] ?? ''), request))
    }
    const person = PATIENT_PATH.exec(url.pathname)
    if (person !== null && method === 'GET') {
      return settle(api.getPatient(decodeURIComponent(person[1] ?? ''), request))
    }
    return apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
  })
  vi.stubGlobal('fetch', api.fetchMock)
  return api
}

export function resetEverything(): void {
  resetVisitsEverything()
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    // Stockage indisponible : rien à nettoyer.
  }
}

export const CONSULTATION_URL = `/consultations/${CONSULTATION_ID}`

/** Visite démarrable : examen de vue arrivé, sans consultation. */
export function startable(overrides: Partial<Visit> = {}): Visit {
  return visit({ ...overrides })
}

// --- Saisie comme l'utilisateur -------------------------------------------------------------------

/**
 * Case à cocher ou bouton radio dont le libellé est exactement `label`, sinon commence par `label`,
 * dans `root`.
 */
export function box(root: ParentNode, label: string): HTMLInputElement {
  const labels = [...root.querySelectorAll('label')]
  const text = (candidate: HTMLLabelElement): string =>
    candidate.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const labelElement =
    labels.find((candidate) => text(candidate) === label) ??
    labels.find((candidate) => text(candidate).startsWith(label))
  const id = labelElement?.getAttribute('for')
  const element = id === undefined || id === null ? null : root.querySelector(`[id="${id}"]`)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Case « ${label} » introuvable.`)
  return element
}

/** Coche ou décoche une case (clic, comme l'utilisateur). */
export async function toggle(root: ParentNode, label: string): Promise<void> {
  const element = box(root, label)
  element.click()
  await flushPromises()
}

/** Choix d'un groupe de boutons radio ou de cases : « Oui » dans « Porte actuellement des lunettes ». */
export async function choice(root: ParentNode, legend: string, label: string): Promise<void> {
  box(group(root, legend), label).click()
  await flushPromises()
}

/** Groupe (fieldset) dont la légende commence par `legend`. */
export function group(root: ParentNode, legend: string): HTMLFieldSetElement {
  const found = [...root.querySelectorAll('fieldset')].find((candidate) =>
    candidate.querySelector('legend')?.textContent?.trim().startsWith(legend),
  )
  if (found === undefined) throw new Error(`Groupe « ${legend} » introuvable.`)
  return found
}

export async function choose(root: ParentNode, label: string, value: string): Promise<void> {
  const element = field(root, label)
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

export async function submitForm(root: ParentNode): Promise<void> {
  const form = root.querySelector('main form[novalidate]')
  if (form === null) throw new Error('Formulaire introuvable.')
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

/** Ouvre la consultation par son adresse. */
export async function openConsultation(path = CONSULTATION_URL) {
  return openApp(path)
}

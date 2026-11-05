// Serveur simulé des écrans Paramètres (personnel, cabinet), du changement de mot de passe et de la liste des
// examens. Données FICTIVES. `fetch` est remplacé : le vrai client HTTP et le vrai routeur travaillent contre
// des réponses au format des contrats (`contracts/schemas/resources/{access,clinical}.json`).
import { flushPromises } from '@vue/test-utils'
import { vi, type Mock } from 'vitest'

import type {
  ClinicSettings,
  ConsultationSummary,
  ConsultationSummaryPage,
  MeResponse,
  StaffMember,
  StaffMemberPage,
} from '@/domain/contracts/generated'
import { takeSettingsFlash } from '@/pages/settings/flash'

import { apiError, json, resetEverything as resetPatients } from '../patients/support'
import { ALL_TEST_MODULES, meResponse } from '../shell/server'

export {
  apiError,
  buttonByName,
  choose,
  field,
  json,
  openApp,
  textOf,
  type,
} from '../patients/support'

export const SELF_ID = '01J9ZXK4M2Q8R7S6T5V4W30002'
export const STAFF_ID = '01J9ZXK4M2Q8R7S6T5V4W30S01'
export const MANAGER_ID = '01J9ZXK4M2Q8R7S6T5V4W30S02'
export const CLINIC_ID = '01J9ZXK4M2Q8R7S6T5V4W30003'
export const CONSULTATION_ID = '01J9ZXK4M2Q8R7S6T5V4W30C11'

export const MANAGER_PERMISSIONS = [
  'patient.read',
  'clinical.read',
  'clinical.write',
  'invoice.read',
  'users.manage',
  'approval.decide',
  'audit.read',
]
export const RECEPTION_PERMISSIONS = [
  'patient.read',
  'patient.create',
  'visit.register',
  'agenda.read',
]
export const CLINICIAN_PERMISSIONS = [
  'patient.read',
  'visit.register',
  'clinical.read',
  'clinical.write',
]

export async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await flushPromises()
}

/** Clic comme l'utilisateur ; un bouton d'envoi soumet son formulaire (jsdom). */
export async function click(element: Element | null): Promise<void> {
  if (element === null) throw new Error('Élément à cliquer introuvable.')
  const form =
    element instanceof HTMLButtonElement && element.type === 'submit' ? element.form : null
  if (form !== null) {
    if (!element.hasAttribute('disabled')) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
  } else {
    ;(element as HTMLElement).click()
  }
  await settle()
}

export function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: STAFF_ID,
    login: 'accueil.fictif',
    display_name: 'Accueil Fictif',
    email: null,
    active: true,
    version: 3,
    roles: ['RECEPTION'],
    permissions: ['patient.read', 'patient.create', 'visit.register', 'agenda.read'],
    ...overrides,
  }
}

export function staffPage(members: StaffMember[]): StaffMemberPage {
  return {
    data: members.map((entry) => ({
      id: entry.id,
      login: entry.login,
      display_name: entry.display_name,
      email: entry.email,
      active: entry.active,
      version: entry.version,
      roles: entry.roles,
    })),
    meta: { current_page: 1, last_page: 1, per_page: 50, total: members.length },
  }
}

export function clinicSettings(overrides: Partial<ClinicSettings> = {}): ClinicSettings {
  return {
    id: CLINIC_ID,
    name: 'TEST CABINET FICTIF',
    timezone: 'Africa/Douala',
    currency: 'XAF',
    address: 'Rue fictive 1',
    phone: '+237 600 00 00 00',
    email: null,
    tax_identifier: null,
    professional_mentions: null,
    document_settings: { footer_lines: ['Pied fictif'], extra_key: 'conservée' },
    production_documents_enabled: false,
    ...overrides,
  }
}

export function consultationSummary(
  overrides: Partial<ConsultationSummary> = {},
): ConsultationSummary {
  return {
    id: CONSULTATION_ID,
    visit_id: '01J9ZXK4M2Q8R7S6T5V4W30V11',
    patient_id: '01J9ZXK4M2Q8R7S6T5V4W30P11',
    status: 'IN_PROGRESS',
    effective_at: '2026-10-22T09:20:00.000Z',
    completed_at: null,
    current_revision: 0,
    version: 2,
    patient: {
      id: '01J9ZXK4M2Q8R7S6T5V4W30P11',
      record_number: 'EE-2026-0042',
      last_name: 'PATIENT FICTIF',
      first_names: 'Élodie',
      sex: 'F',
      birth_date: '1990-05-17',
    },
    clinician: { id: SELF_ID, display_name: 'Professionnel Fictif' },
    ...overrides,
  }
}

export function consultationPage(items: ConsultationSummary[]): ConsultationSummaryPage {
  return { data: items, meta: { current_page: 1, last_page: 1, per_page: 50, total: items.length } }
}

export interface Recorded {
  method: string
  path: string
  query: URLSearchParams
  body: Record<string, unknown> | null
}

type Reply = Response | 'network'
type Handler = (request: Recorded) => Reply | Promise<Reply>

export interface SettingsApi {
  me: MeResponse
  requests: Recorded[]
  fetchMock: Mock
}

/**
 * Routes simulées : `handlers` associe « MÉTHODE chemin » (chemin exact ou expression régulière en texte,
 * par exemple `PATCH /api/v1/staff/:id`) à une réponse. Une route sans réponse donnée répond 404.
 */
export function stubSettingsApi(
  options: {
    permissions?: string[]
    modules?: readonly string[]
    accountId?: string
    handlers?: Record<string, Handler>
  } = {},
): SettingsApi {
  const requests: Recorded[] = []
  const me = meResponse(options.permissions ?? MANAGER_PERMISSIONS, 'Gérante Fictive', [
    ...(options.modules ?? ALL_TEST_MODULES),
  ])
  if (options.accountId !== undefined) me.data.id = options.accountId
  const handlers = options.handlers ?? {}

  const route = (method: string, path: string): Handler | undefined => {
    for (const [key, handler] of Object.entries(handlers)) {
      const [keyMethod, keyPath] = key.split(' ')
      if (keyMethod !== method || keyPath === undefined) continue
      const pattern = new RegExp(`^${keyPath.replace(/:id/g, '[^/]+')}$`)
      if (pattern.test(path)) return handler
    }
    return undefined
  }

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'https://cabinet.test')
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const request: Recorded = { method, path: url.pathname, query: url.searchParams, body }
    requests.push(request)

    if (url.pathname === '/up') return json(200, { status: 'ok' })
    if (url.pathname === '/api/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname === '/api/v1/auth/me') return json(200, me)
    const handler = route(method, url.pathname)
    if (handler === undefined) return apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.')
    const reply = await handler(request)
    if (reply === 'network') throw new TypeError('Failed to fetch')
    return reply
  })
  vi.stubGlobal('fetch', fetchMock)
  return { me, requests, fetchMock }
}

export function callsTo(api: SettingsApi, method: string, path: RegExp): Recorded[] {
  return api.requests.filter((request) => request.method === method && path.test(request.path))
}

export function resetEverything(): void {
  resetPatients()
  takeSettingsFlash()
}

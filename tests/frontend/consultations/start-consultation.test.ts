import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Visit } from '@/domain/contracts/generated'

import {
  CLINICIAN,
  click,
  json,
  openApp,
  READ_ONLY,
  resetEverything,
  startCalls,
  stubConsultationApi,
  textOf,
  visit,
  visitPage,
} from './support'
import {
  chooseResult,
  ID_A,
  pageOf,
  patient,
  searchPatientField,
  summaryOf,
  VISIT_A,
  VISIT_B,
  VISIT_C,
} from '../visits/support'

// Boîte « Nouvelle consultation » de l'écran des examens (C01) : les examens à faire de la file du jour se
// démarrent en un clic ; un autre patient se cherche, son arrivée est enregistrée (RegisterVisit) PUIS son
// examen démarré (StartConsultation), deux commandes à deux clés. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-10-22T09:42:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

const ULID = /^[0-9A-Z]{26}$/
const VISIT_D = '01J9ZXK4M2Q8R7S6T5V4W30024'
const VISIT_E = '01J9ZXK4M2Q8R7S6T5V4W30025'
const FOUND = patient({ id: ID_A, last_name: 'NGONO FICTIVE', first_names: 'Marie' })

const exam = (id: string, overrides: Partial<Visit> = {}) =>
  visit({ id, occurred_at: '2026-10-22T08:00:00.000Z', ...overrides })

/** Un exemple de chaque cas : examen arrivé, suivi, achat, examen en cours, attente de paiement. */
function day() {
  return visitPage([
    exam(VISIT_A),
    exam(VISIT_B, { reason: 'DIRECT_PURCHASE', exam_fee_control: 'NOT_APPLICABLE' }),
    exam(VISIT_C, { reason: 'FOLLOW_UP' }),
    exam(VISIT_D, {
      status: 'IN_CONSULTATION',
      consultation_id: '01J9ZXK4M2Q8R7S6T5V4W30501',
      consultation_status: 'IN_PROGRESS',
    }),
    exam(VISIT_E, { status: 'AWAITING_EXAM_FEE' }),
  ])
}

/** Ajoute au serveur simulé la recherche de patients et l'enregistrement d'une arrivée (deux routes de plus). */
function withArrivals(api: ReturnType<typeof stubConsultationApi>) {
  const registered: { body: Record<string, unknown>; key: string | undefined }[] = []
  const base = api.fetchMock
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'https://cabinet.test')
      const method = init?.method ?? 'GET'
      if (url.pathname === '/api/v1/patients' && method === 'GET') {
        return json(200, pageOf([summaryOf(FOUND)]))
      }
      if (url.pathname === '/api/v1/visits' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const headers = (init?.headers ?? {}) as Record<string, string>
        registered.push({ body, key: headers['Idempotency-Key'] })
        return json(201, {
          data: visit({
            id: String(body['visit_id']),
            patient_id: String(body['patient_id']),
            reason: body['reason'] as Visit['reason'],
            occurred_at: String(body['occurred_at']),
            patient: {
              ...visit().patient,
              last_name: FOUND.last_name,
              first_names: FOUND.first_names,
            },
          }),
        })
      }
      return base(input, init)
    }),
  )
  return registered
}

function dialogOf(root: HTMLElement): HTMLDialogElement {
  const found = root.querySelector('dialog')
  if (found === null) throw new Error('Boîte « Nouvelle consultation » absente.')
  return found
}

function buttons(scope: ParentNode): string[] {
  return [...scope.querySelectorAll('button')].map(
    (button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  )
}

async function openDialog(root: HTMLElement): Promise<HTMLDialogElement> {
  const opener = [...root.querySelectorAll('main button')].find(
    (button) => button.textContent?.trim() === 'Nouvelle consultation',
  )
  await click(opener ?? null)
  await flushPromises()
  return dialogOf(root)
}

describe('bouton « Nouvelle consultation » de l’écran des examens', () => {
  it('ouvre la boîte : seuls les examens à faire de la file du jour, démarrables en un clic', async () => {
    const api = stubConsultationApi({ handlers: { list: () => json(200, day()) } })
    const { root, router, unmount } = await openApp('/consultations')

    expect(root.querySelector('dialog')).toBeNull()
    const dialog = await openDialog(root)

    expect(dialog.querySelector('h2')?.textContent?.trim()).toBe('Nouvelle consultation')
    const names = [
      ...dialog.querySelectorAll('section[aria-labelledby="nouvelle-consultation-file"] ul > li'),
    ].map((item) => item.textContent?.replace(/\s+/g, ' ') ?? '')
    // Examen arrivé, suivi arrivé et attente de paiement ; ni l'achat direct ni l'examen déjà en cours.
    expect(names).toHaveLength(3)
    expect(names.some((text) => text.includes('Prêt') || text.includes('En consultation'))).toBe(
      false,
    )
    expect(textOf(dialog)).toContain('En attente du paiement de l’examen')
    expect(buttons(dialog).filter((label) => label === 'Démarrer l’examen')).toHaveLength(2)

    const first = dialog.querySelector('button[aria-label^="Démarrer l’examen de"]')
    await click(first)
    await flushPromises()

    expect(startCalls(api)).toHaveLength(1)
    expect(startCalls(api)[0]?.path).toBe(`/api/v1/visits/${VISIT_A}/consultations`)
    expect(router.currentRoute.value.fullPath).toMatch(/^\/consultations\/[0-9A-Z]{26}$/)
    unmount()
  })

  it('sans droit d’écriture clinique, le bouton n’existe pas', async () => {
    stubConsultationApi({ permissions: READ_ONLY })
    const { root, unmount } = await openApp('/consultations')

    expect(buttons(root)).not.toContain('Nouvelle consultation')
    unmount()
  })

  it('l’adresse ?nouvelle=1 ouvre la boîte ; la fermer ne la rouvre pas', async () => {
    stubConsultationApi({ handlers: { list: () => json(200, day()) } })
    const { root, router, unmount } = await openApp('/consultations?nouvelle=1&jour=tous')
    await flushPromises()

    const dialog = dialogOf(root)
    expect(dialog.querySelector('h2')?.textContent?.trim()).toBe('Nouvelle consultation')

    await click(buttonIn(dialog, 'Fermer'))
    await flushPromises()

    expect(root.querySelector('dialog')).toBeNull()
    expect(router.currentRoute.value.query).toEqual({ jour: 'tous' })
    unmount()
  })

  it('une file du jour vide le dit, sans inventer de patient', async () => {
    stubConsultationApi({ handlers: { list: () => json(200, visitPage([])) } })
    const { root, unmount } = await openApp('/consultations')
    const dialog = await openDialog(root)

    expect(textOf(dialog)).toContain('Aucun patient n’attend un examen dans la file du jour.')
    expect(buttons(dialog)).not.toContain('Démarrer l’examen')
    unmount()
  })
})

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement | null {
  return (
    ([...scope.querySelectorAll('button')].find(
      (button) => button.textContent?.replace(/\s+/g, ' ').trim() === label,
    ) as HTMLButtonElement | undefined) ?? null
  )
}

describe('un autre patient', () => {
  async function chooseFound(dialog: HTMLDialogElement): Promise<void> {
    const input = await searchPatientField(dialog, 'ngono')
    await chooseResult(input, 0)
    expect(textOf(dialog)).toContain('NGONO FICTIVE')
  }

  it('sans arrivée aujourd’hui : enregistre l’arrivée (Examen de vue) puis démarre l’examen, avec deux clés', async () => {
    const api = stubConsultationApi({ handlers: { list: () => json(200, visitPage([])) } })
    const registered = withArrivals(api)
    const { root, router, unmount } = await openApp('/consultations')
    const dialog = await openDialog(root)

    await chooseFound(dialog)
    expect(textOf(dialog)).toContain('Ce patient n’est pas dans la file du jour')
    await click(buttonIn(dialog, 'Enregistrer l’arrivée et démarrer l’examen'))
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(registered).toHaveLength(1)
    expect(registered[0]?.body).toMatchObject({
      visit_id: expect.stringMatching(ULID),
      patient_id: ID_A,
      reason: 'EXAM',
      occurred_at: expect.stringMatching(/^2026-10-22T09:42:00./),
      appointment_id: null,
      administrative_note: null,
    })
    expect(startCalls(api)).toHaveLength(1)
    const [started] = startCalls(api)
    expect(started?.path).toBe(
      `/api/v1/visits/${String(registered[0]?.body['visit_id'])}/consultations`,
    )
    expect(started?.headers['Idempotency-Key']).toMatch(ULID)
    expect(started?.headers['Idempotency-Key']).not.toBe(registered[0]?.key)
    expect(router.currentRoute.value.fullPath).toMatch(/^\/consultations\/[0-9A-Z]{26}$/)
    unmount()
  })

  it('déjà arrivé aujourd’hui : propose de démarrer cette visite, n’enregistre aucune seconde arrivée', async () => {
    const api = stubConsultationApi({
      handlers: {
        list: () =>
          json(
            200,
            visitPage([
              exam(VISIT_C, {
                patient_id: ID_A,
                patient: { ...visit().patient, last_name: 'NGONO FICTIVE', first_names: 'Marie' },
              }),
            ]),
          ),
      },
    })
    const registered = withArrivals(api)
    const { root, unmount } = await openApp('/consultations')
    const dialog = await openDialog(root)
    // Le patient est déjà dans la file : son bouton est aussi dans la liste ; on le retrouve par la recherche.
    await chooseFound(dialog)

    expect(textOf(dialog)).toContain('Arrivé aujourd’hui à')
    expect(buttonIn(dialog, 'Enregistrer l’arrivée et démarrer l’examen')).toBeNull()
    expect(registered).toHaveLength(0)
    unmount()
  })

  it('sans visit.register : l’accueil doit enregistrer l’arrivée, aucun bouton ne le laisse croire', async () => {
    const api = stubConsultationApi({
      permissions: CLINICIAN.filter((code) => code !== 'visit.register'),
      handlers: { list: () => json(200, visitPage([])) },
    })
    const registered = withArrivals(api)
    const { root, unmount } = await openApp('/consultations')
    const dialog = await openDialog(root)
    await chooseFound(dialog)

    expect(textOf(dialog)).toContain('l’accueil doit d’abord enregistrer son arrivée')
    expect(buttonIn(dialog, 'Enregistrer l’arrivée et démarrer l’examen')).toBeNull()
    expect(registered).toHaveLength(0)
    unmount()
  })

  it('file du jour illisible : aucune arrivée n’est enregistrée (une arrivée existante ne peut pas être écartée)', async () => {
    const api = stubConsultationApi({ handlers: { list: () => 'network' } })
    const registered = withArrivals(api)
    const { root, unmount } = await openApp('/consultations')
    const dialog = await openDialog(root)
    await chooseFound(dialog)

    expect(textOf(dialog)).toContain('La file du jour n’a pas pu être lue en entier')
    expect(buttonIn(dialog, 'Enregistrer l’arrivée et démarrer l’examen')).toBeNull()
    expect(registered).toHaveLength(0)
    unmount()
  })

  it('sans droit de créer une fiche, le patient neuf passe par l’accueil ; avec ce droit, le lien « Nouveau patient » existe', async () => {
    stubConsultationApi({ handlers: { list: () => json(200, visitPage([])) } })
    const first = await openApp('/consultations')
    const without = await openDialog(first.root)
    expect(without.querySelector('a[href="/patients/nouveau"]')).toBeNull()
    expect(textOf(without)).toContain('L’accueil crée sa fiche')
    first.unmount()

    resetEverything()
    stubConsultationApi({
      permissions: [...CLINICIAN, 'patient.create'],
      handlers: { list: () => json(200, visitPage([])) },
    })
    const second = await openApp('/consultations')
    const withRight = await openDialog(second.root)
    expect(withRight.querySelector('a[href="/patients/nouveau"]')?.textContent).toBe(
      'Nouveau patient',
    )
    second.unmount()
  })
})

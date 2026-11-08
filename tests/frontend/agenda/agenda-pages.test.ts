import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgendaConfiguration, Appointment, ContactTask } from '@/domain/contracts/generated'

import { typeDate } from '../patients/support'
import {
  apiError,
  buttonByName,
  callsTo,
  choose,
  click,
  json,
  openApp,
  resetEverything,
  settle,
  stubSettingsApi,
  textOf,
  type,
} from '../settings/support'

/**
 * Écrans de l'agenda (S01) et des patients à rappeler (S02) contre un serveur simulé : rendez-vous confirmé seulement
 * à la réponse du serveur, créneau pris entre-temps dit et relu, annulation motivée avec la version, droits (aucune
 * action sans agenda.write), module fermé, tentative de contact enregistrée avec la version, aucun envoi annoncé.
 * Données fictives.
 */
const RESOURCE = '01J9ZXK4M2Q8R7S6T5V4W30R01'
const SERVICE = '01J9ZXK4M2Q8R7S6T5V4W30S01'
const PATIENT = '01J9ZXK4M2Q8R7S6T5V4W30P01'
const APPOINTMENT = '01J9ZXK4M2Q8R7S6T5V4W30A01'
const TASK = '01J9ZXK4M2Q8R7S6T5V4W30T01'

const RECEPTION = ['patient.read', 'visit.register', 'agenda.read', 'agenda.write']
const CASHIER = ['patient.read', 'agenda.read', 'invoice.read']

function configuration(): AgendaConfiguration {
  return {
    resources: [
      {
        id: RESOURCE,
        name: 'Salle fictive',
        professional_user_id: null,
        professional_name: null,
        active: true,
        slot_duration_minutes: 15,
        version: 1,
        opening_hours: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W30H01',
            weekday: 5,
            opens_at: '08:00',
            closes_at: '12:00',
            valid_from: null,
            valid_to: null,
          },
        ],
      },
    ],
    services: [
      { id: SERVICE, name: 'Prestation fictive', duration_minutes: 30, active: true, version: 1 },
    ],
    exceptions: [],
  }
}

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: APPOINTMENT,
    patient_id: PATIENT,
    patient: {
      id: PATIENT,
      record_number: 'EE-2026-0001',
      last_name: 'PATIENT FICTIF',
      first_names: 'Test',
    },
    prospect_contact_id: null,
    follow_up_id: null,
    resource_id: RESOURCE,
    resource_name: 'Salle fictive',
    service_id: SERVICE,
    service_name: 'Prestation fictive',
    starts_at: '2026-10-23T07:00:00.000Z',
    ends_at: '2026-10-23T07:30:00.000Z',
    status: 'CONFIRMED',
    source: 'INTERNAL',
    administrative_reason: null,
    cancel_reason: null,
    visit_id: null,
    version: 1,
    ...overrides,
  }
}

function task(overrides: Partial<ContactTask> = {}): ContactTask {
  return {
    id: TASK,
    patient_id: PATIENT,
    patient: {
      id: PATIENT,
      record_number: 'EE-2026-0001',
      last_name: 'PATIENT FICTIF',
      first_names: 'Test',
    },
    prospect_contact_id: null,
    follow_up_id: '01J9ZXK4M2Q8R7S6T5V4W30F01',
    appointment_id: null,
    invoice_id: null,
    source_type: 'FOLLOW_UP',
    source_date: '2026-10-22',
    source_starts_at: null,
    due_at: '2026-10-21T23:00:00.000Z',
    channel: 'CALL',
    status: 'PENDING',
    next_attempt_at: null,
    assigned_to: null,
    administrative_notes: null,
    attempts: [],
    version: 1,
    ...overrides,
  }
}

/** Bouton dont le nom accessible (aria-label) correspond : le texte visible est plus court (« Annuler »). */
function buttonByLabel(root: ParentNode, name: RegExp): HTMLButtonElement | null {
  return (
    ([...root.querySelectorAll('button')].find((button) =>
      name.test(button.getAttribute('aria-label') ?? ''),
    ) as HTMLButtonElement | undefined) ?? null
  )
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

describe('agenda', () => {
  it('liste les rendez-vous du jour et annule avec un motif et la version', async () => {
    const api = stubSettingsApi({
      permissions: RECEPTION,
      handlers: {
        'GET /api/v1/agenda/configuration': () => json(200, { data: configuration() }),
        'GET /api/v1/appointments': () => json(200, { data: [appointment()] }),
        'POST /api/v1/appointments/:id/cancel': () =>
          json(200, {
            data: appointment({
              status: 'CANCELLED',
              cancel_reason: 'Patient indisponible',
              version: 2,
            }),
          }),
      },
    })
    const { root, unmount } = await openApp('/agenda')
    await settle()

    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(textOf(root)).toContain('Confirmé')
    await click(buttonByLabel(root, /Annuler le rendez-vous de/))
    await type(root, 'Motif de l’annulation (obligatoire)', 'Patient indisponible')
    await click(buttonByName(root, 'Annuler le rendez-vous'))

    const cancel = callsTo(api, 'POST', /\/appointments\/.+\/cancel$/)
    expect(cancel).toHaveLength(1)
    expect(cancel[0]!.body).toEqual({ reason: 'Patient indisponible', expected_version: 1 })
    expect(textOf(root)).toContain('annulé sur le serveur')
    unmount()
  })

  it('lire la date saisie ne change ni le titre ni les cartes : seul « Afficher » lit la nouvelle période', async () => {
    // Constaté en CI un dimanche (police large) : le titre « Agenda du dimanche 8 novembre » passait de deux lignes à une
    // dès la sortie du champ « Jour », le bouton « Afficher » montait sous le clic qui le visait et le clic était perdu ;
    // l'écran affichait alors « Aucun rendez-vous ce jour-là » pour un jour qu'il n'avait pas lu.
    const api = stubSettingsApi({
      permissions: RECEPTION,
      handlers: {
        'GET /api/v1/agenda/configuration': () => json(200, { data: configuration() }),
        'GET /api/v1/appointments': (request) =>
          json(200, { data: request.query.get('from') === '2026-10-23' ? [appointment()] : [] }),
      },
    })
    const { root, unmount } = await openApp('/agenda')
    await settle()
    expect(textOf(root)).toContain('Agenda du vendredi 23 octobre 2026')
    expect(textOf(root)).toContain('PATIENT FICTIF')

    // Sortie du champ : la date est lue, mais rien n'est relu ni redessiné.
    await typeDate(root, 'Jour', '26/10/2026')
    expect(textOf(root)).toContain('Agenda du vendredi 23 octobre 2026')
    expect(textOf(root)).not.toContain('Agenda du lundi 26 octobre 2026')
    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(textOf(root)).not.toContain('Aucun rendez-vous ce jour-là')
    expect(callsTo(api, 'GET', /\/appointments$/)).toHaveLength(1)

    // « Afficher » lit la période saisie, puis le titre et les cartes la suivent.
    await click(buttonByName(root, 'Afficher'))
    const reads = callsTo(api, 'GET', /\/appointments$/)
    expect(reads).toHaveLength(2)
    expect(reads[1]!.query.get('from')).toBe('2026-10-26')
    expect(reads[1]!.query.get('to')).toBe('2026-10-26')
    expect(textOf(root)).toContain('Agenda du lundi 26 octobre 2026')
    expect(textOf(root)).toContain('Aucun rendez-vous ce jour-là')
    expect(textOf(root)).not.toContain('PATIENT FICTIF')
    unmount()
  })

  it('sans agenda.write : aucune action, et le module fermé n’ouvre rien', async () => {
    stubSettingsApi({
      permissions: CASHIER,
      handlers: {
        'GET /api/v1/agenda/configuration': () => json(200, { data: configuration() }),
        'GET /api/v1/appointments': () => json(200, { data: [appointment()] }),
      },
    })
    const { root, unmount } = await openApp('/agenda')
    await settle()
    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(buttonByLabel(root, /Annuler le rendez-vous de/)).toBeNull()
    expect(buttonByLabel(root, /Déplacer le rendez-vous de/)).toBeNull()
    expect(textOf(root)).not.toContain('Nouveau rendez-vous')
    unmount()

    // Nouvelle session : celle de l'écran précédent (tous modules ouverts) ne doit pas servir à la suivante.
    vi.unstubAllGlobals()
    resetEverything()
    stubSettingsApi({ permissions: RECEPTION, modules: ['today', 'patients'] })
    const closed = await openApp('/agenda')
    await settle()
    expect(textOf(closed.root)).not.toContain('Agenda du')
    closed.unmount()
  })

  it('un rendez-vous n’est dit confirmé qu’à la réponse du serveur ; un créneau pris entre-temps est relu', async () => {
    let attempts = 0
    const api = stubSettingsApi({
      permissions: RECEPTION,
      handlers: {
        'GET /api/v1/agenda/configuration': () => json(200, { data: configuration() }),
        'GET /api/v1/patients/:id': () =>
          json(200, {
            data: {
              id: PATIENT,
              record_number: 'EE-2026-0001',
              last_name: 'PATIENT FICTIF',
              first_names: 'Test',
            },
          }),
        'GET /api/v1/agenda/slots': () =>
          json(200, {
            data: {
              date: '2026-10-23',
              resource_id: RESOURCE,
              service_id: SERVICE,
              duration_minutes: 30,
              slots: [
                { starts_at: '2026-10-23T07:00:00.000Z', ends_at: '2026-10-23T07:30:00.000Z' },
              ],
            },
          }),
        'POST /api/v1/appointments': () => {
          attempts += 1
          return attempts === 1
            ? apiError(409, 'SLOT_UNAVAILABLE', 'Ce créneau n’est plus libre.')
            : json(201, { data: appointment() })
        },
      },
    })
    const { root, unmount } = await openApp(`/agenda/nouveau?patient=${PATIENT}`)
    await settle()
    expect(textOf(root)).toContain('PATIENT FICTIF')

    await choose(root, 'Prestation', SERVICE)
    await choose(root, 'Professionnel ou salle', RESOURCE)
    await settle()
    const radio = root.querySelector<HTMLInputElement>('input[name="rdv-creneau"]')
    expect(radio).not.toBeNull()
    radio!.checked = true
    radio!.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    await click(buttonByName(root, 'Confirmer le rendez-vous'))
    expect(textOf(root)).toContain('Ce créneau n’est plus libre.')
    expect(textOf(root)).not.toContain('Rendez-vous confirmé')
    expect(callsTo(api, 'GET', /\/agenda\/slots$/).length).toBeGreaterThanOrEqual(2)

    const again = root.querySelector<HTMLInputElement>('input[name="rdv-creneau"]')
    again!.checked = true
    again!.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    await click(buttonByName(root, 'Confirmer le rendez-vous'))
    expect(textOf(root)).toContain('Rendez-vous confirmé par le serveur')
    const created = callsTo(api, 'POST', /\/appointments$/)
    expect(created[1]!.body).toMatchObject({
      patient_id: PATIENT,
      resource_id: RESOURCE,
      service_id: SERVICE,
      expected_version: null,
    })
    unmount()
  })
})

describe('patients à rappeler', () => {
  it('note une tentative avec la version de la tâche, sans annoncer aucun envoi', async () => {
    const api = stubSettingsApi({
      permissions: RECEPTION,
      handlers: {
        'GET /api/v1/contact-tasks': () => json(200, { data: [task()] }),
        'GET /api/v1/follow-ups': () => json(200, { data: [] }),
        'POST /api/v1/contact-tasks/:id/attempts': () =>
          json(201, {
            data: {
              attempt_id: '01J9ZXK4M2Q8R7S6T5V4W30X01',
              task: task({ status: 'CONTACTED', version: 2 }),
            },
          }),
      },
    })
    const { root, unmount } = await openApp('/suivis')
    await settle()

    expect(textOf(root)).toContain('l’application n’envoie aucun message')
    expect(textOf(root)).toContain('Appel téléphonique')
    await click(buttonByName(root, 'Noter un contact'))
    await choose(root, 'Résultat', 'CONTACTED')
    await click(buttonByName(root, 'Enregistrer la tentative'))

    const sent = callsTo(api, 'POST', /\/contact-tasks\/.+\/attempts$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.body).toMatchObject({
      task_id: TASK,
      result: 'CONTACTED',
      next_status: 'CONTACTED',
      expected_version: 1,
    })
    expect(textOf(root)).toContain('enregistrée sur le serveur')
    unmount()
  })
})

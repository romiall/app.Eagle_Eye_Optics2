import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activityOf,
  CASHIER_READ,
  CLINICIAN_READ,
  CONSULTATION_ID,
  consultationItem,
  invoiceItem,
  MANAGER_READ,
  managerActivity,
  prescriptionItem,
  receiptItem,
  sectionsOf,
  visitItem,
} from './activity-support'
import {
  apiError,
  buttonByName,
  callsTo,
  click,
  ID_A,
  json,
  linkTo,
  openApp,
  patient,
  READER,
  resetEverything,
  stubPatientsApi,
  textOf,
} from './support'

// Onglet « Activité » du dossier patient : sections selon les droits (aucune mention d'une section non
// autorisée), ordre du plus récent au plus ancien, filtres, vides confirmés distincts d'un serveur muet,
// liens seulement vers un écran existant et ouvrable, lisible à 360 px. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

const ACTIVITY = /^\/api\/v1\/patients\/[^/]+\/activity$/

function main(root: ParentNode): Element {
  const element = root.querySelector('main')
  if (element === null) throw new Error('Contenu principal introuvable.')
  return element
}

function items(root: ParentNode): HTMLLIElement[] {
  return [...root.querySelectorAll<HTMLLIElement>('#activite-liste > li')]
}

/** Titre visible de chaque élément (texte réservé aux lecteurs d'écran retiré). */
function titles(root: ParentNode): string[] {
  return items(root).map((item) => {
    const title = item.querySelectorAll('p')[1]?.cloneNode(true) as HTMLElement | undefined
    title?.querySelectorAll('.sr-only').forEach((hidden) => hidden.remove())
    return (title?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })
}

function chips(root: ParentNode): { text: string; pressed: string | null }[] {
  const group = root.querySelector('[role="group"][aria-label="Filtrer l’activité"]')
  return [...(group?.querySelectorAll('button') ?? [])].map((button) => ({
    text: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
    pressed: button.getAttribute('aria-pressed'),
  }))
}

describe('onglet « Activité » du dossier patient', () => {
  it('l’accueil ne voit que les visites, sans filtre ni mention des autres sections', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () =>
          json(
            200,
            activityOf(
              [
                visitItem(),
                visitItem({
                  id: '01J9ZXK4M2Q8R7S6T5V4W30402',
                  occurred_at: '2026-10-01T07:00:00.000Z',
                  reason: 'DIRECT_PURCHASE',
                  status: 'COMPLETED',
                }),
              ],
              sectionsOf({ VISITS: 2 }),
            ),
          ),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')
    expect(document.title).toBe('Activité du patient – Eagle’s Eye Optics Medical')
    const current = root.querySelector(
      'nav[aria-label="Sections du dossier patient"] a[aria-current="page"]',
    )
    expect(current?.textContent?.trim()).toBe('Activité')
    expect(titles(root)).toEqual(['Visite : Retrait de commande', 'Visite : Achat direct'])
    const text = textOf(main(root))
    expect(text).toContain('15/10/2026 à 10h00')
    expect(text).toContain('Statut : Arrivé')
    expect(text).toContain('Statut : Terminé')
    // Une seule section visible : pas de filtre, et rien ne dit qu'il en existerait d'autres.
    expect(chips(root)).toEqual([])
    expect(text).not.toMatch(
      /examens|ordonnance|prescription|pièce|facture|reçu|consultation|masqu|non accessible/i,
    )
    expect(textOf(main(root))).toContain('Données du serveur au 15/10/2026 à 10h00.')

    const calls = callsTo(api, 'GET', ACTIVITY)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe(`/api/v1/patients/${ID_A}/activity`)
    expect(calls[0]?.query.get('page')).toBe('1')
    expect(calls[0]?.query.has('section')).toBe(false)
    unmount()
  })

  it('la gérante voit toutes les sections, du plus récent au plus ancien, avec leurs filtres', async () => {
    stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, managerActivity()),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    expect(chips(root)).toEqual([
      { text: 'Tout (7)', pressed: 'true' },
      { text: 'Visites (2)', pressed: 'false' },
      { text: 'Examens (1)', pressed: 'false' },
      { text: 'Ordonnances (2)', pressed: 'false' },
      { text: 'Pièces financières (2)', pressed: 'false' },
    ])
    expect(titles(root)).toEqual([
      'Visite : Retrait de commande',
      'Reçu TEST-REC-000001',
      'Facture TEST-FAC-000001',
      'Prescription optique, version 2',
      'Ordonnance de médicaments',
      'Examen de vue',
      'Visite : Examen de vue',
    ])
    const text = textOf(main(root))
    expect(text).toContain('Encaissement : 20 000 FCFA (MTN Mobile Money)')
    expect(text).toContain('Montant : 50 000 FCFA')
    expect(text).toContain('Reste dû : 30 000 FCFA (encaissé : 20 000 FCFA)')
    expect(text).toContain('État : Validée')
    expect(text).toContain('Consultation : Terminé')
    expect(text).toContain('Professionnel : Professionnel Fictif')
    expect(text).not.toMatch(/pay[ée]|soldée|gratuit/i)

    // L'examen et l'ordonnance de médicaments ouvrent la consultation ; la prescription, ses versions.
    const consultationLinks = root.querySelectorAll(`a[href="/consultations/${CONSULTATION_ID}"]`)
    expect(consultationLinks).toHaveLength(2)
    expect(linkTo(root, `/consultations/${CONSULTATION_ID}/prescriptions`)).not.toBeNull()
    // Les pièces n'ont pas encore d'écran : texte simple.
    expect(items(root)[1]?.querySelector('a')).toBeNull()
    expect(items(root)[2]?.querySelector('a')).toBeNull()
    unmount()
  })

  it('un filtre ne lit que sa section et dit un vide confirmé propre à la section', async () => {
    const sections = sectionsOf({ VISITS: 2, EXAMS: 0, PRESCRIPTIONS: 2, FINANCIAL: 2 })
    const api = stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: (_id, section) => {
          if (section === 'FINANCIAL') {
            return json(
              200,
              activityOf([receiptItem(), invoiceItem()], sections, { section: 'FINANCIAL' }),
            )
          }
          if (section === 'EXAMS') {
            return json(200, activityOf([], sections, { section: 'EXAMS' }))
          }
          return json(200, activityOf(managerActivity().data, sections, { total: 6 }))
        },
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    await click(buttonByName(root, 'Pièces financières (2)'))
    const financial = callsTo(api, 'GET', ACTIVITY).at(-1)
    expect(financial?.query.get('section')).toBe('FINANCIAL')
    expect(financial?.query.get('page')).toBe('1')
    expect(titles(root)).toEqual(['Reçu TEST-REC-000001', 'Facture TEST-FAC-000001'])
    expect(chips(root).find((chip) => chip.pressed === 'true')?.text).toBe('Pièces financières (2)')

    await click(buttonByName(root, 'Examens (0)'))
    expect(textOf(main(root))).toContain('Aucun examen enregistré')
    expect(items(root)).toHaveLength(0)

    await click(buttonByName(root, 'Tout (6)'))
    expect(callsTo(api, 'GET', ACTIVITY).at(-1)?.query.has('section')).toBe(false)
    expect(items(root).length).toBeGreaterThan(2)
    unmount()
  })

  it('un dossier vide le dit seulement après réponse du serveur, selon les sections visibles', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, activityOf([], sectionsOf({ VISITS: 0 }))),
      },
    })
    const reception = await openApp(`/patients/${ID_A}/activite`)
    expect(textOf(main(reception.root))).toContain('Aucune visite enregistrée')
    expect(textOf(main(reception.root))).not.toContain('Aucune activité')
    reception.unmount()
    resetEverything()

    stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () =>
          json(
            200,
            activityOf([], sectionsOf({ VISITS: 0, EXAMS: 0, PRESCRIPTIONS: 0, FINANCIAL: 0 })),
          ),
      },
    })
    const manager = await openApp(`/patients/${ID_A}/activite`)
    expect(textOf(main(manager.root))).toContain('Aucune activité enregistrée')
    manager.unmount()
  })

  it('serveur injoignable : « Activité indisponible », jamais un dossier vide ; « Réessayer » relit', async () => {
    let up = false
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () =>
          up ? json(200, activityOf([visitItem()], sectionsOf({ VISITS: 1 }))) : 'network',
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    const text = textOf(main(root))
    expect(text).toContain('Activité indisponible')
    expect(text).toContain('Cela ne prouve pas que le dossier soit vide')
    expect(text).not.toContain('Aucune')
    expect(items(root)).toHaveLength(0)

    up = true
    await click(buttonByName(root, 'Réessayer'))
    expect(callsTo(api, 'GET', ACTIVITY)).toHaveLength(2)
    expect(titles(root)).toEqual(['Visite : Retrait de commande'])
    expect(textOf(main(root))).not.toContain('Activité indisponible')
    unmount()
  })

  it('droits insuffisants (403) et fiche inconnue (404) sont dits sans liste', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => apiError(403, 'ACTION_FORBIDDEN', 'Action non autorisée.'),
      },
    })
    const forbidden = await openApp(`/patients/${ID_A}/activite`)
    expect(textOf(main(forbidden.root))).toContain('Droits insuffisants')
    expect(items(forbidden.root)).toHaveLength(0)
    forbidden.unmount()
    resetEverything()

    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => apiError(404, 'RESOURCE_NOT_FOUND', 'Ressource introuvable.'),
      },
    })
    const missing = await openApp(`/patients/${ID_A}/activite`)
    expect(textOf(main(missing.root))).toContain('Fiche introuvable')
    expect(textOf(main(missing.root))).not.toContain('Aucune')
    missing.unmount()
  })

  it('un lien n’apparaît que vers un écran existant que le compte peut ouvrir', async () => {
    const OTHER = '01J9ZXK4M2Q8R7S6T5V4W30502'
    const listed = activityOf(
      [
        consultationItem(),
        prescriptionItem({
          origin: 'EXTERNAL',
          screen_path: null,
          consultation_id: null,
          status: 'DRAFT',
          version_no: 1,
          external_prescribed_on: '2026-09-30',
        }),
        visitItem({ screen_path: `/visites/${OTHER}` }),
        consultationItem({ id: OTHER, screen_path: '//exemple.test/consultations' }),
      ],
      sectionsOf({ VISITS: 1, EXAMS: 2, PRESCRIPTIONS: 1 }),
    )
    stubPatientsApi({
      permissions: CLINICIAN_READ,
      handlers: { get: () => json(200, { data: patient() }), activity: () => json(200, listed) },
    })
    const clinician = await openApp(`/patients/${ID_A}/activite`)
    const rows = items(clinician.root)
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe(
      `/consultations/${CONSULTATION_ID}`,
    )
    // Ordonnance externe : pas d'écran, texte simple, date d'origine dite.
    expect(rows[1]?.querySelector('a')).toBeNull()
    expect(textOf(rows[1] as Element)).toContain('Ordonnance externe transcrite, version 1')
    expect(textOf(rows[1] as Element)).toContain('Prescrite à l’extérieur le 30/09/2026')
    // Adresse inconnue de cette version, ou hors de l'application : jamais un lien.
    expect(rows[2]?.querySelector('a')).toBeNull()
    expect(rows[3]?.querySelector('a')).toBeNull()
    expect(clinician.root.querySelector('a[href^="//"]')).toBeNull()
    clinician.unmount()
    resetEverything()

    // Module « consultations » fermé : l'examen reste listé, sans lien.
    stubPatientsApi({
      permissions: CLINICIAN_READ,
      modules: ['patients'],
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, activityOf([consultationItem()], sectionsOf({ EXAMS: 1 }))),
      },
    })
    const closed = await openApp(`/patients/${ID_A}/activite`)
    expect(titles(closed.root)).toEqual(['Examen de vue'])
    expect(items(closed.root)[0]?.querySelector('a')).toBeNull()
    closed.unmount()
    resetEverything()

    // Sans clinical.read, même une adresse reçue n'ouvre rien (défense en profondeur).
    stubPatientsApi({
      permissions: CASHIER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, activityOf([consultationItem()], sectionsOf({ VISITS: 0 }))),
      },
    })
    const cashier = await openApp(`/patients/${ID_A}/activite`)
    expect(items(cashier.root)[0]?.querySelector('a')).toBeNull()
    cashier.unmount()
  })

  it('applique le filtre initial ?section=EXAMS et ouvre les pièces financières et ordonnances externes selon screen_path', async () => {
    const sections = sectionsOf({ VISITS: 1, EXAMS: 1, PRESCRIPTIONS: 1, FINANCIAL: 2 })
    const externalPrescription = prescriptionItem({
      origin: 'EXTERNAL',
      screen_path: `/patients/${ID_A}/prescriptions`,
      consultation_id: null,
    })
    const linkedInvoice = invoiceItem({
      screen_path: '/ventes/factures/01J9ZXK4M2Q8R7S6T5V4W30601',
    })
    const linkedReceipt = receiptItem({
      screen_path: '/ventes/factures/01J9ZXK4M2Q8R7S6T5V4W30601',
    })

    const api = stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: (_id, section) =>
          json(
            200,
            activityOf([consultationItem()], sections, {
              section: section === 'EXAMS' ? 'EXAMS' : null,
            }),
          ),
      },
    })
    const filtered = await openApp(`/patients/${ID_A}/activite?section=EXAMS`)
    expect(callsTo(api, 'GET', ACTIVITY).at(-1)?.query.get('section')).toBe('EXAMS')
    expect(chips(filtered.root).find((chip) => chip.pressed === 'true')?.text).toBe('Examens (1)')
    filtered.unmount()
    resetEverything()

    stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () =>
          json(200, activityOf([linkedReceipt, linkedInvoice, externalPrescription], sections)),
      },
    })
    const opened = await openApp(`/patients/${ID_A}/activite`)
    const invoiceLinks = opened.root.querySelectorAll(
      'a[href="/ventes/factures/01J9ZXK4M2Q8R7S6T5V4W30601"]',
    )
    expect(invoiceLinks).toHaveLength(2)
    expect(linkTo(opened.root, `/patients/${ID_A}/prescriptions`)).not.toBeNull()
    opened.unmount()
    resetEverything()

    // Module « sales » fermé : la facture reste listée sans lien cliquable.
    stubPatientsApi({
      permissions: MANAGER_READ,
      modules: ['patients', 'consultations'],
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, activityOf([linkedInvoice], sections)),
      },
    })
    const noSales = await openApp(`/patients/${ID_A}/activite`)
    expect(items(noSales.root)[0]?.querySelector('a')).toBeNull()
    noSales.unmount()
  })

  it('ne dit jamais « payé » : solde projeté, contre-passation et crédit à rembourser', async () => {
    stubPatientsApi({
      permissions: CASHIER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () =>
          json(
            200,
            activityOf(
              [
                invoiceItem({ settlement: 'SETTLED', balance_due: 0, paid_net: 50000 }),
                invoiceItem({
                  id: '01J9ZXK4M2Q8R7S6T5V4W30602',
                  number: 'TEST-FAC-000002',
                  settlement: 'IN_CREDIT',
                  balance_due: -3000,
                  credit_available: 3000,
                }),
                invoiceItem({
                  id: '01J9ZXK4M2Q8R7S6T5V4W30603',
                  number: 'TEST-FAC-000003',
                  settlement: 'UNPAID',
                  balance_due: 15000,
                  paid_net: 0,
                }),
                receiptItem({ reversed_amount: 20000 }),
              ],
              sectionsOf({ VISITS: 0, FINANCIAL: 4 }),
            ),
          ),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    const text = textOf(main(root))
    expect(text).toContain('Solde nul : reste dû 0 FCFA')
    expect(text).toContain('Crédit à rembourser : 3 000 FCFA')
    expect(text).toContain('Reste dû : 15 000 FCFA (aucun encaissement net)')
    expect(text).toContain('Contre-passé : 20 000 FCFA (le reçu reste conservé)')
    expect(text).not.toMatch(/pay[ée]|soldée|réglée|gratuit/i)
    unmount()
  })

  it('pagination : la page suivante est lue, la liste remplacée et le titre reçoit le focus', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: (_id, _section, page) =>
          json(
            200,
            activityOf(
              [
                visitItem({
                  id: page === 1 ? '01J9ZXK4M2Q8R7S6T5V4W30411' : '01J9ZXK4M2Q8R7S6T5V4W30412',
                  reason: page === 1 ? 'PICKUP' : 'FOLLOW_UP',
                }),
              ],
              sectionsOf({ VISITS: 30 }),
              { current_page: page, last_page: 2, total: 30 },
            ),
          ),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)
    expect(textOf(main(root))).toContain('Page 1 sur 2 · 30 éléments')

    await click(buttonByName(root, 'Page suivante'))
    await flushPromises()

    expect(callsTo(api, 'GET', ACTIVITY).at(-1)?.query.get('page')).toBe('2')
    expect(titles(root)).toEqual(['Visite : Contrôle de suivi'])
    expect(document.activeElement?.id).toBe('titre-activite')
    unmount()
  })

  it('reste lisible à 360 px : cartes empilées, aucun tableau, retours à la ligne et cibles de 44 px', async () => {
    stubPatientsApi({
      permissions: MANAGER_READ,
      handlers: {
        get: () => json(200, { data: patient() }),
        activity: () => json(200, managerActivity()),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}/activite`)

    expect(main(root).querySelector('table')).toBeNull()
    expect(root.querySelector('#activite-liste')?.tagName).toBe('OL')
    for (const item of items(root)) expect(item.className).toContain('break-words')
    const group = root.querySelector('[role="group"][aria-label="Filtrer l’activité"]')
    expect(group?.className).toContain('flex-wrap')
    const tabs = root.querySelector('nav[aria-label="Sections du dossier patient"] ul')
    expect(tabs?.className).toContain('flex-wrap')
    for (const button of group?.querySelectorAll('button') ?? []) {
      expect(button.className).toContain('min-h-11')
    }
    for (const link of root.querySelectorAll('#activite-liste a')) {
      expect(link.className).toContain('min-h-11')
    }
    unmount()
  })

  it('la fiche d’identité propose l’onglet « Activité » sans lire l’activité', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const { root, router, unmount } = await openApp(`/patients/${ID_A}`)

    const tabs = root.querySelector('nav[aria-label="Sections du dossier patient"]')
    expect(tabs?.querySelector('a[aria-current="page"]')?.textContent?.trim()).toBe('Identité')
    expect(linkTo(root, `/patients/${ID_A}/activite`)?.textContent?.trim()).toBe('Activité')
    expect(callsTo(api, 'GET', ACTIVITY)).toHaveLength(0)

    await router.push(`/patients/${ID_A}/activite`)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('patient-activite')
    expect(callsTo(api, 'GET', ACTIVITY)).toHaveLength(1)
    unmount()
  })

  it('module fermé ou sans droit de lecture : l’activité n’est pas lue', async () => {
    const closed = stubPatientsApi({ permissions: READER, modules: [] })
    const first = await openApp(`/patients/${ID_A}/activite`)
    expect(first.root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(callsTo(closed, 'GET', ACTIVITY)).toHaveLength(0)
    first.unmount()
    resetEverything()

    const noRight = stubPatientsApi({ permissions: ['invoice.read'] })
    const second = await openApp(`/patients/${ID_A}/activite`)
    expect(second.router.currentRoute.value.name).toBe('acces-refuse')
    expect(callsTo(noRight, 'GET', ACTIVITY)).toHaveLength(0)
    second.unmount()
  })
})

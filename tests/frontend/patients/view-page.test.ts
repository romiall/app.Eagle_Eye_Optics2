import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiError,
  buttonByName,
  callsTo,
  click,
  ID_A,
  ID_B,
  json,
  linkTo,
  openApp,
  patient,
  READER,
  RECEPTION,
  resetEverything,
  stubPatientsApi,
  textOf,
} from './support'

// Fiche patient (P01, P02 ; AT03) : identité complète, âge et fraîcheur, droit de modifier,
// 404 distinct d'un vide, aucun contenu clinique. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

describe('fiche patient', () => {
  it('affiche l’identité complète, le numéro, l’âge et la fraîcheur', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () =>
          json(200, {
            data: patient({
              phone_secondary: '+237600000002',
              address: 'Quartier fictif\nDouala',
              created_at: '2026-10-14T09:30:00.000Z',
              updated_at: '2026-10-15T08:15:00.000Z',
            }),
          }),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')
    expect(document.title).toBe('Dossier patient – Eagle’s Eye Optics Medical')
    const text = textOf(root)
    expect(text).toContain('Dossier EE-2026-0001')
    expect(text).toContain('Féminin')
    expect(text).toContain('17/05/1990 (36 ans)')
    expect(text).toContain('+237600000001')
    expect(text).toContain('+237600000002')
    expect(text).toContain('Enseignante')
    expect(text).toContain('Fiche créée le')
    expect(text).toContain('14/10/2026 à 10h30')
    expect(text).toContain('15/10/2026 à 09h15')
    // Heure de la réponse du serveur, à l'heure du cabinet (UTC+1).
    expect(text).toContain('Données du serveur au 15/10/2026 à 10h00.')
    // L'adresse multiligne garde ses retours à la ligne.
    const address = [...root.querySelectorAll('dd')].find((dd) =>
      dd.textContent?.includes('Quartier'),
    )
    expect(address?.className).toContain('whitespace-pre-line')
    expect(callsTo(api, 'GET', /^\/api\/v1\/patients\/[^/]+$/)).toHaveLength(1)

    unmount()
  })

  it('dit « âge non renseigné » et la raison d’absence, sans inventer de date', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () =>
          json(200, {
            data: patient({
              birth_date: null,
              birth_date_missing_reason: 'Patient sans pièce',
              phone_primary: null,
              phone_missing_reason: 'Pas de téléphone',
              first_names: null,
              address: null,
              profession: null,
            }),
          }),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    const text = textOf(root)
    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF')
    expect(text).toContain('Non renseigné (raison : Patient sans pièce) (âge non renseigné)')
    expect(text).toContain('Non renseigné (raison : Pas de téléphone)')
    expect(text).toContain('âge non renseigné')
    unmount()
  })

  it('un champ vide du serveur est dit « Non renseigné », jamais une case vide', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () =>
          json(200, {
            data: patient({ first_names: '', address: ' ', profession: '', phone_secondary: '' }),
          }),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    const values = [...root.querySelectorAll('dd')].map((dd) => dd.textContent?.trim())
    expect(values.filter((value) => value === 'Non renseigné')).toHaveLength(4)
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('PATIENT FICTIF')
    unmount()
  })

  it('un ancien dossier reporté le dit, avec son ancien numéro', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: () =>
          json(200, {
            data: patient({
              legacy_record: true,
              legacy_record_number: 'CLASSEUR-12',
              first_known_visit_on: '2019-03-04',
            }),
          }),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).toContain('Repris de l’ancien classeur (n° CLASSEUR-12)')
    expect(textOf(root)).toContain('première visite connue le 04/03/2019')
    unmount()
  })

  it('n’affiche aucune donnée clinique et ne lit que la fiche d’identité', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).not.toMatch(/consultation|ordonnance|diagnostic|réfraction|prescription/i)
    const paths = api.requests.map((request) => request.path)
    expect(paths.filter((path) => path.startsWith('/api/v1/patients'))).toEqual([
      `/api/v1/patients/${ID_A}`,
    ])
    unmount()
  })

  it('« Modifier » n’apparaît qu’avec le droit patient.update', async () => {
    stubPatientsApi({
      permissions: RECEPTION,
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const withRight = await openApp(`/patients/${ID_A}`)
    expect(linkTo(withRight.root, `/patients/${ID_A}/modifier`)?.textContent?.trim()).toBe(
      'Modifier',
    )
    withRight.unmount()
    resetEverything()

    stubPatientsApi({
      permissions: READER,
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const readOnly = await openApp(`/patients/${ID_A}`)
    expect(readOnly.root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')
    expect(linkTo(readOnly.root, `/patients/${ID_A}/modifier`)).toBeNull()
    expect(buttonByName(readOnly.root, 'Modifier')).toBeNull()
    readOnly.unmount()
  })

  it('une fiche archivée ou fusionnée le dit et ne propose pas de la modifier', async () => {
    stubPatientsApi({
      permissions: RECEPTION,
      handlers: {
        get: () => json(200, { data: patient({ archived: true, merged_into_patient_id: ID_B }) }),
      },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).toContain('Fiche archivée')
    expect(textOf(root)).toContain('Cette fiche a été fusionnée dans une autre')
    expect(linkTo(root, `/patients/${ID_B}`)?.textContent?.trim()).toBe('Ouvrir la fiche conservée')
    expect(linkTo(root, `/patients/${ID_A}/modifier`)).toBeNull()
    unmount()
  })

  it('fiche inconnue (404) : erreur de l’application, pas « aucun résultat »', async () => {
    stubPatientsApi({ permissions: READER })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).toContain('Fiche introuvable')
    expect(textOf(root)).not.toContain('Aucun résultat')
    expect(textOf(root)).not.toContain('PATIENT FICTIF')
    // Pas de bouton « Réessayer » pour une fiche qui n'existe pas.
    expect(buttonByName(root, 'Réessayer')).toBeNull()
    unmount()
  })

  it('serveur injoignable : fiche indisponible, relue par « Réessayer »', async () => {
    let up = false
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { get: () => (up ? json(200, { data: patient() }) : 'network') },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).toContain('Fiche indisponible')
    expect(root.querySelector('dl')).toBeNull()

    up = true
    await click(buttonByName(root, 'Réessayer'))

    expect(callsTo(api, 'GET', /^\/api\/v1\/patients\/[^/]+$/)).toHaveLength(2)
    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')
    expect(textOf(root)).not.toContain('Fiche indisponible')
    unmount()
  })

  it('si l’autre fiche ne peut pas être lue, la fiche précédente n’est jamais montrée à sa place', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: { get: (id) => (id === ID_A ? json(200, { data: patient() }) : 'network') },
    })
    const { root, router, unmount } = await openApp(`/patients/${ID_A}`)
    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')

    await router.push(`/patients/${ID_B}`)
    await flushPromises()

    expect(textOf(root)).toContain('Fiche indisponible')
    expect(textOf(root)).not.toContain('PATIENT FICTIF')
    expect(textOf(root)).not.toContain('EE-2026-0001')
    unmount()
  })

  it('droits insuffisants (403) : dit sans afficher de fiche', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: { get: () => apiError(403, 'ACTION_FORBIDDEN', 'Action non autorisée.') },
    })
    const { root, unmount } = await openApp(`/patients/${ID_A}`)

    expect(textOf(root)).toContain('Droits insuffisants')
    expect(textOf(root)).not.toContain('PATIENT FICTIF')
    unmount()
  })

  it('un identifiant qui n’est pas un ULID mène à « page introuvable » sans appeler le serveur', async () => {
    const api = stubPatientsApi({ permissions: READER })
    const { root, unmount } = await openApp('/patients/pas-un-identifiant')

    expect(root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(callsTo(api, 'GET', /^\/api\/v1\/patients\/[^/]+$/)).toHaveLength(0)
    unmount()
  })

  it('lit une autre fiche quand l’adresse change, sans garder la précédente', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        get: (id) =>
          json(200, {
            data: patient(
              id === ID_A
                ? {}
                : {
                    id: ID_B,
                    last_name: 'AUTRE FICTIF',
                    first_names: null,
                    record_number: 'EE-2026-0002',
                  },
            ),
          }),
      },
    })
    const { root, router, unmount } = await openApp(`/patients/${ID_A}`)
    expect(root.querySelector('h1')?.textContent).toBe('PATIENT FICTIF Élodie Marie')

    await router.push(`/patients/${ID_B}`)
    await flushPromises()

    expect(root.querySelector('h1')?.textContent).toBe('AUTRE FICTIF')
    expect(textOf(root)).toContain('EE-2026-0002')
    unmount()
  })

  it('module fermé ou sans droit de lecture : la fiche n’est pas lue', async () => {
    const closed = stubPatientsApi({ permissions: READER, modules: [] })
    const first = await openApp(`/patients/${ID_A}`)
    expect(first.root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(callsTo(closed, 'GET', /^\/api\/v1\/patients\/[^/]+$/)).toHaveLength(0)
    first.unmount()
    resetEverything()

    const noRight = stubPatientsApi({ permissions: ['invoice.read'] })
    const second = await openApp(`/patients/${ID_A}`)
    expect(second.router.currentRoute.value.name).toBe('acces-refuse')
    expect(callsTo(noRight, 'GET', /^\/api\/v1\/patients\/[^/]+$/)).toHaveLength(0)
    second.unmount()
  })

  it('affiche « Accès directs du dossier » et les actions d’en-tête selon les droits, cachés au lecteur seul', async () => {
    stubPatientsApi({
      permissions: [
        'patient.read',
        'patient.update',
        'visit.register',
        'agenda.write',
        'clinical.read',
        'invoice.read',
        'invoice.create',
        'workshop.manage',
      ],
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const manager = await openApp(`/patients/${ID_A}`)
    expect(textOf(manager.root)).toContain('Accès directs du dossier')
    expect(linkTo(manager.root, `/patients/${ID_A}/activite?section=EXAMS`)).not.toBeNull()
    expect(linkTo(manager.root, `/patients/${ID_A}/activite?section=PRESCRIPTIONS`)).not.toBeNull()
    expect(linkTo(manager.root, `/patients/${ID_A}/prescriptions`)).not.toBeNull()
    expect(linkTo(manager.root, `/ventes/factures?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/ventes/devis?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/atelier?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/aujourdhui/arrivee?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/agenda/nouveau?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/ventes/factures/nouvelle?patient=${ID_A}`)).not.toBeNull()
    expect(linkTo(manager.root, `/ventes/devis/nouveau?patient=${ID_A}`)).not.toBeNull()
    manager.unmount()
    resetEverything()

    stubPatientsApi({
      permissions: READER,
      handlers: { get: () => json(200, { data: patient() }) },
    })
    const reader = await openApp(`/patients/${ID_A}`)
    expect(textOf(reader.root)).not.toContain('Accès directs du dossier')
    expect(linkTo(reader.root, `/atelier?patient=${ID_A}`)).toBeNull()
    reader.unmount()
  })
})

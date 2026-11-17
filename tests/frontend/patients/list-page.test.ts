import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionForTests } from '@/app/session'
import type { PatientPage } from '@/domain/contracts/generated'

import {
  apiError,
  buttonByName,
  callsTo,
  click,
  field,
  hostPage503,
  ID_A,
  ID_B,
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

// Recherche de patients (P02 ; AT03, AT04) : seuil de 2 caractères, états du fichier 04, « aucun
// résultat » seulement sur réponse du serveur, pagination, aucune donnée personnelle dans l'URL.
// Données FICTIVES.
const SEARCH = /^\/api\/v1\/patients$/

async function search(root: HTMLElement, text: string): Promise<void> {
  await type(root, 'Rechercher un patient', text)
  await click(buttonByName(root, 'Rechercher'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetEverything()
})

describe('écran Patients : recherche et liste', () => {
  it('s’ouvre en chargeant directement la liste des patients avec le sélecteur de lignes', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const { root, unmount } = await openApp('/patients')

    expect(root.querySelector('h1')?.textContent).toBe('Patients')
    expect(document.title).toBe('Patients – Eagle’s Eye Optics Medical')
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(1)
    expect(textOf(root)).toContain('Liste des patients')
    expect(textOf(root)).toContain('PATIENT FICTIF Élodie')
    const select = root.querySelector('select#patients-per-page') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    expect(select?.value).toBe('25')
    const input = field(root, 'Rechercher un patient')
    expect(input.getAttribute('type')).toBe('search')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(root.querySelector('form[role="search"]')).not.toBeNull()

    unmount()
  })

  it('refuse un texte de moins de 2 caractères sans appel supplémentaire au serveur', async () => {
    const api = stubPatientsApi({ permissions: READER })
    const { root, unmount } = await openApp('/patients')

    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(1)

    await search(root, 'a')

    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(1)
    const input = field(root, 'Rechercher un patient')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(textOf(root)).toContain('Saisissez au moins 2 caractères pour lancer la recherche.')
    expect(document.activeElement).toBe(input)

    await search(root, '   ')
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(1)
    expect(textOf(root)).toContain('Saisissez au moins 2 caractères : un nom')

    // La correction efface l'erreur ; 2 caractères suffisent.
    await search(root, 'ab')
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(2)
    expect(input.getAttribute('aria-invalid')).toBeNull()

    unmount()
  })

  it('cherche par Entrée : texte nettoyé, page 1, accents conservés', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const { root, unmount } = await openApp('/patients')

    await type(root, 'Rechercher un patient', '  Éb   Ngono ')
    root
      .querySelector('form[role="search"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    const call = callsTo(api, 'GET', SEARCH).at(-1)
    expect(call?.query.get('query')).toBe('Éb Ngono')
    expect(call?.query.get('page')).toBe('1')
    unmount()
  })

  it('affiche nom, numéro, âge et téléphone de chaque résultat, avec un lien vers la fiche', async () => {
    const withoutBirth = patient({
      id: ID_B,
      record_number: 'EE-2026-0002',
      last_name: 'AUTRE FICTIF',
      first_names: null,
      birth_date: null,
      phone_primary: null,
    })
    stubPatientsApi({
      permissions: READER,
      handlers: {
        search: () => json(200, pageOf([summaryOf(patient()), summaryOf(withoutBirth)])),
      },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    const rows = [...root.querySelectorAll('main ul li')].map((row) => textOf(row))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('PATIENT FICTIF Élodie Marie')
    expect(rows[0]).toContain('Dossier EE-2026-0001')
    expect(rows[0]).toContain('36 ans')
    expect(rows[0]).toContain('+237600000001')
    expect(rows[1]).toContain('AUTRE FICTIF')
    expect(rows[1]).toContain('âge non renseigné')
    expect(rows[1]).toContain('téléphone non renseigné')
    expect(linkTo(root, `/patients/${ID_A}`)).not.toBeNull()
    expect(linkTo(root, `/patients/${ID_B}`)).not.toBeNull()
    expect(textOf(root)).toContain('2 patients trouvés')
    // Identité seulement : rien de clinique ni de financier à la caisse.
    expect(textOf(root)).not.toMatch(/consultation|ordonnance|diagnostic|prix d’achat/i)

    unmount()
  })

  it('signale les fiches archivées et fusionnées dans la liste', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        search: () =>
          json(
            200,
            pageOf([
              summaryOf(patient({ archived: true })),
              summaryOf(patient({ id: ID_B, merged_into_patient_id: ID_A })),
            ]),
          ),
      },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Fiche archivée')
    expect(textOf(root)).toContain('Fiche fusionnée')
    unmount()
  })

  it('« Aucun résultat » seulement quand le serveur a répondu à cette recherche', async () => {
    stubPatientsApi({ permissions: RECEPTION })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'inconnu')

    expect(textOf(root)).toContain('Aucun résultat')
    expect(textOf(root)).not.toContain('Recherche serveur indisponible')
    // Créer n'est proposé qu'après une recherche, à qui en a le droit.
    const create = [...root.querySelectorAll('main a')].find(
      (link) => link.textContent?.trim() === 'Créer un patient',
    )
    expect(create?.getAttribute('href')).toBe('/patients/nouveau')
    unmount()
  })

  it('serveur injoignable : « Recherche serveur indisponible », jamais « Aucun résultat »', async () => {
    let answer: 'network' | 'ok' = 'network'
    const api = stubPatientsApi({
      permissions: RECEPTION,
      handlers: {
        search: () =>
          answer === 'network' ? 'network' : json(200, pageOf([summaryOf(patient())])),
      },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Recherche serveur indisponible')
    expect(textOf(root)).toContain('ne prouve pas qu’aucun patient ne correspond')
    expect(textOf(root)).not.toContain('Aucun résultat')
    expect(root.querySelector('main ul li')).toBeNull()

    // « Réessayer » relit : la liste apparaît dès que le serveur répond.
    answer = 'ok'
    await click(buttonByName(root, 'Réessayer'))
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(3)
    expect(textOf(root)).toContain('PATIENT FICTIF')
    expect(textOf(root)).not.toContain('Recherche serveur indisponible')

    unmount()
  })

  it('une page d’erreur de l’hébergeur (503 HTML) n’est pas « aucun résultat » non plus', async () => {
    stubPatientsApi({ permissions: READER, handlers: { search: () => hostPage503() } })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Recherche serveur indisponible')
    expect(textOf(root)).not.toContain('Aucun résultat')
    unmount()
  })

  it('une erreur 5xx de l’application est aussi « indisponible »', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: { search: () => apiError(500, 'INTERNAL_ERROR', 'Erreur interne.') },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Recherche serveur indisponible')
    unmount()
  })

  it('un refus 422 du serveur est dit, avec son message', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: {
        search: () =>
          apiError(422, 'VALIDATION_FAILED', 'Requête invalide.', {
            query: ['Le serveur demande au moins 2 caractères.'],
          }),
      },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'ab')

    expect(textOf(root)).toContain('La recherche a échoué')
    expect(textOf(root)).toContain('Le serveur demande au moins 2 caractères.')
    expect(textOf(root)).not.toContain('Aucun résultat')
    unmount()
  })

  it('droits insuffisants (403) : dit sans prétendre qu’il n’y a rien', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: { search: () => apiError(403, 'ACTION_FORBIDDEN', 'Action non autorisée.') },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Droits insuffisants')
    expect(textOf(root)).not.toContain('Aucun résultat')
    unmount()
  })

  it('session expirée (401) : la coquille propose « Se reconnecter », la recherche reste affichée', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => apiError(401, 'AUTH_REQUIRED', 'Connexion requise.') },
    })
    const { root, router, unmount } = await openApp('/patients')
    await type(root, 'Rechercher un patient', 'fictif')
    api.me = 'anonymous'

    await click(buttonByName(root, 'Rechercher'))

    expect(textOf(root)).toContain('Session expirée')
    expect(buttonByName(root, 'Se reconnecter')).not.toBeNull()
    // Aucune navigation : l'écran et le texte cherché restent en place.
    expect(router.currentRoute.value.path).toBe('/patients')
    expect(field(root, 'Rechercher un patient').value).toBe('fictif')
    unmount()
  })

  it('pagination : 25 par page, page demandée au serveur, focus sur les résultats', async () => {
    const pages = new Map<number, PatientPage>([
      [1, pageOf([summaryOf(patient())], { current_page: 1, last_page: 3, total: 61 })],
      [
        2,
        pageOf([summaryOf(patient({ id: ID_B, last_name: 'DEUXIEME FICTIF' }))], {
          current_page: 2,
          last_page: 3,
          total: 61,
        }),
      ],
    ])
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: (_query, page) => json(200, pages.get(page) ?? pageOf([])) },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')

    expect(textOf(root)).toContain('Page 1 sur 3 · 61 résultats')
    expect(buttonByName(root, 'Page précédente')?.disabled).toBe(true)
    expect(buttonByName(root, 'Page suivante')?.disabled).toBe(false)

    await click(buttonByName(root, 'Page suivante'))

    const pagesAsked = callsTo(api, 'GET', SEARCH)
      .filter((call) => call.query.get('query') === 'fictif')
      .map((call) => call.query.get('page'))
    expect(pagesAsked).toEqual(['1', '2'])
    expect(textOf(root)).toContain('DEUXIEME FICTIF')
    expect(textOf(root)).toContain('Page 2 sur 3')
    expect(textOf(root)).not.toContain('PATIENT FICTIF Élodie')
    expect(document.activeElement?.id).toBe('titre-resultats')
    expect(buttonByName(root, 'Page précédente')?.disabled).toBe(false)

    unmount()
  })

  it('une page qui n’existe plus n’est pas « aucun résultat » : retour à la première page', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        search: (_query, page) =>
          json(
            200,
            page === 1
              ? pageOf([summaryOf(patient())], { current_page: 1, last_page: 2, total: 26 })
              : pageOf([], { current_page: 2, last_page: 1, total: 3 }),
          ),
      },
    })
    const { root, unmount } = await openApp('/patients')
    await search(root, 'fictif')

    await click(buttonByName(root, 'Page suivante'))

    expect(textOf(root)).toContain('Cette page ne contient plus de résultats')
    expect(textOf(root)).not.toContain('Aucun résultat')
    await click(buttonByName(root, 'Revenir à la première page'))
    expect(callsTo(api, 'GET', SEARCH).at(-1)?.query.get('page')).toBe('1')
    unmount()
  })

  it('une réponse tardive d’une recherche précédente ne remplace pas la recherche courante', async () => {
    let releaseFirst: (response: Response) => void = () => undefined
    stubPatientsApi({
      permissions: READER,
      handlers: {
        search: (query) =>
          query === 'premier'
            ? new Promise<Response>((resolve) => {
                releaseFirst = resolve
              })
            : json(200, pageOf([summaryOf(patient({ last_name: 'SECOND FICTIF' }))])),
      },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'premier')
    expect(textOf(root)).toContain('Recherche en cours')
    await search(root, 'second')
    expect(textOf(root)).toContain('SECOND FICTIF')

    releaseFirst(json(200, pageOf([summaryOf(patient({ last_name: 'PREMIER FICTIF' }))])))
    await flushPromises()

    expect(textOf(root)).toContain('SECOND FICTIF')
    expect(textOf(root)).not.toContain('PREMIER FICTIF')
    unmount()
  })

  it('une recherche vide du serveur après une liste pleine ne garde pas l’ancienne liste', async () => {
    let empty = false
    stubPatientsApi({
      permissions: READER,
      handlers: {
        search: () => json(200, pageOf(empty ? [] : [summaryOf(patient())])),
      },
    })
    const { root, unmount } = await openApp('/patients')
    await search(root, 'fictif')
    expect(textOf(root)).toContain('PATIENT FICTIF')

    empty = true
    await search(root, 'rien')

    expect(textOf(root)).toContain('Aucun résultat')
    expect(textOf(root)).not.toContain('PATIENT FICTIF')
    unmount()
  })
})

describe('écran Patients : droits, module et vie privée', () => {
  it('lecture seule : pas de « Nouveau patient », ni dans l’en-tête de l’écran ni dans les résultats', async () => {
    stubPatientsApi({ permissions: READER })
    const { root, unmount } = await openApp('/patients')
    await search(root, 'inconnu')

    expect(linkTo(root, '/patients/nouveau')).toBeNull()
    expect(textOf(root)).toContain('Aucun résultat')
    unmount()
  })

  it('« Nouveau patient » est proposé avec le droit de création', async () => {
    stubPatientsApi({ permissions: RECEPTION })
    const { root, unmount } = await openApp('/patients')

    expect(linkTo(root, '/patients/nouveau')?.textContent?.trim()).toBe('Nouveau patient')
    unmount()
  })

  it('sans patient.read : accès refusé', async () => {
    stubPatientsApi({ permissions: ['invoice.read'] })
    const { router, unmount } = await openApp('/patients')

    expect(router.currentRoute.value.name).toBe('acces-refuse')
    unmount()
  })

  it('module « patients » non ouvert : page introuvable, comme le serveur', async () => {
    const api = stubPatientsApi({ permissions: READER, modules: [] })
    const { root, unmount } = await openApp('/patients')

    expect(root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(0)
    unmount()
  })

  it('aucun nom ni téléphone dans l’adresse du navigateur', async () => {
    stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const { root, router, unmount } = await openApp('/patients')

    await search(root, 'Élodie 600000001')

    expect(router.currentRoute.value.fullPath).toBe('/patients')
    await click(linkTo(root, `/patients/${ID_A}`))
    expect(router.currentRoute.value.fullPath).toBe(`/patients/${ID_A}`)
    unmount()
  })

  it('garde la recherche en mémoire pour revenir de la fiche, sans stockage du navigateur', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: {
        search: () => json(200, pageOf([summaryOf(patient())])),
        get: () => json(200, { data: patient() }),
      },
    })
    const { root, router, unmount } = await openApp('/patients')
    await search(root, 'fictif')
    await click(linkTo(root, `/patients/${ID_A}`))
    expect(router.currentRoute.value.name).toBe('patient')

    await router.push('/patients')
    await flushPromises()

    expect(field(root, 'Rechercher un patient').value).toBe('fictif')
    expect(textOf(root)).toContain('PATIENT FICTIF')
    // La liste est relue (jamais une copie ancienne) et rien n'est écrit dans le navigateur.
    expect(callsTo(api, 'GET', SEARCH)).toHaveLength(3)
    expect(JSON.stringify(Object.entries(window.localStorage))).toBe('[]')
    expect(JSON.stringify(Object.entries(window.sessionStorage))).toBe('[]')
    unmount()
  })

  it('un autre compte sur le même poste ne voit pas la recherche du précédent', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const first = await openApp('/patients')
    await search(first.root, 'fictif')
    first.unmount()
    document.body.innerHTML = ''

    // Une autre personne se connecte : autre identifiant de compte.
    const other = JSON.parse(JSON.stringify(api.me)) as typeof api.me
    if (typeof other === 'object') other.data.id = '01J9ZXK4M2Q8R7S6T5V4W39999'
    api.me = other
    resetSessionForTests()

    const second = await openApp('/patients')

    expect(field(second.root, 'Rechercher un patient').value).toBe('')
    // La recherche précédente n'est pas reprise : la requête au serveur est vide (aucun paramètre query).
    expect(callsTo(api, 'GET', SEARCH).at(-1)?.query.get('query')).toBeNull()
    second.unmount()
  })

  it('permet de régler le nombre de lignes par page (15, 20, 25, 50)', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const { root, unmount } = await openApp('/patients')

    const select = root.querySelector('select#patients-per-page') as HTMLSelectElement
    expect(select.value).toBe('25')

    select.value = '15'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    const lastCall = callsTo(api, 'GET', SEARCH).at(-1)
    expect(lastCall?.query.get('per_page')).toBe('15')
    unmount()
  })

  it('bouton Effacer réinitialise la recherche et recharge tous les patients', async () => {
    const api = stubPatientsApi({
      permissions: READER,
      handlers: { search: () => json(200, pageOf([summaryOf(patient())])) },
    })
    const { root, unmount } = await openApp('/patients')

    await search(root, 'fictif')
    expect(buttonByName(root, 'Effacer')).not.toBeNull()

    await click(buttonByName(root, 'Effacer'))
    expect(field(root, 'Rechercher un patient').value).toBe('')
    const lastCall = callsTo(api, 'GET', SEARCH).at(-1)
    expect(lastCall?.query.get('query')).toBeNull()
    unmount()
  })
})

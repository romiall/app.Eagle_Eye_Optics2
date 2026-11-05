import { flushPromises } from '@vue/test-utils'
import { h } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { createEeoApp } from '@/app/bootstrap'
import { resetNetworkForTests } from '@/app/network'
import { resetSessionForTests } from '@/app/session'

import { meResponse, stubServer } from './shell/server'

async function mountAt(path: string) {
  const { app, router } = createEeoApp(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await flushPromises()

  return { root, router, unmount: () => app.unmount() }
}

afterEach(() => {
  resetSessionForTests()
  resetNetworkForTests()
  document.body.innerHTML = ''
})

describe('amorçage de la coquille Vue', () => {
  it('monte l’accueil en français sans serveur, sans conclure à une déconnexion', async () => {
    stubServer({ me: 'unreachable' })
    const { root, unmount } = await mountAt('/')

    expect(root.querySelector('h1')?.textContent).toBe('Application du cabinet')
    const brand = root.querySelector('header p')
    // Texte en casse normale (lu comme des mots), affiché en capitales par le style.
    expect(brand?.textContent?.trim()).toBe('Eagle’s Eye Optics Medical – Gestion des patients')
    expect(brand?.classList.contains('uppercase')).toBe(true)
    expect(root.querySelector('main#contenu')).not.toBeNull()
    expect(root.textContent).toContain('Serveur injoignable')
    expect(root.querySelector('nav')).toBeNull()

    unmount()
  })

  it('affiche une page « introuvable » en français pour toute URL inconnue du routeur', async () => {
    stubServer({ me: meResponse(['patient.read']) })
    const { root, unmount } = await mountAt('/une/url/inconnue')

    expect(root.querySelector('h1')?.textContent).toBe('Page introuvable')
    expect(root.querySelector('main a')?.getAttribute('href')).toBe('/')
    expect(document.title).toBe('Page introuvable – Eagle’s Eye Optics Medical')

    unmount()
  })

  it('ne déclare que les routes de la coquille, des patients, de la file du jour, des consultations, des documents, des ventes et des paramètres', () => {
    const { router } = createEeoApp(createMemoryHistory())

    expect(router.getRoutes().map((route) => String(route.name))).toEqual(
      expect.arrayContaining([
        'connexion',
        'deverrouiller',
        'accueil',
        'acces-refuse',
        'introuvable',
        'aujourdhui',
        'arrivee',
        'patients',
        'patient-nouveau',
        'patient',
        'patient-modifier',
        'patient-activite',
        'consultation',
        'documents-apercu',
        'ventes',
        'caisse',
        'caisse-du-jour',
        'factures',
        'facture-nouvelle',
        'facture',
        'catalogue',
        'taxes',
        'stock',
        'consultations',
        'consultation-historique',
        'consultation-prescriptions',
        'parametres',
        'parametres-personnel',
        'parametres-personnel-nouveau',
        'parametres-compte',
        'parametres-cabinet',
        'mot-de-passe',
        'approbations',
        'parametres-poste',
        'conflits-synchronisation',
        'patient-prescriptions',
        'patient-fusion',
        'patient-comparaison',
        'categories-depenses',
        'devis',
        'devis-nouveau',
        'devis-detail',
        'import-catalogue',
        'stock-movement',
        'parametres-exports',
        'statistiques',
        'agenda',
        'rendez-vous-nouveau',
        'agenda-configuration',
        'suivis',
        'aide',
      ]),
    )
    // 11 routes d'origine + historique (C03) + prescription (C04) + aperçu des documents (D02)
    // + activité du patient (onglet du dossier) + ventes et caisse (8 : B01 à B05, I00)
    // + caisse du jour (R01 minimal) + liste des examens + paramètres (5 : F09)
    // + changement de son mot de passe + approbations (B06) + préparation du poste (O01, O02)
    // + prescriptions, fusion et comparaison du patient + catégories de dépenses + devis (3)
    // + import du catalogue + casse/ajustement + exports + statistiques + agenda (3) + suivis + aide
    // + déverrouillage du poste (D27).
    // Total recompté sur le routeur réel : 51 routes, aucun nom en double.
    const names = router.getRoutes().map((route) => String(route.name))
    expect(new Set(names).size).toBe(names.length)
    expect(router.getRoutes()).toHaveLength(51)
    // Chaque route métier dépend de son module (mise en service progressive) et de ses permissions.
    // Les onglets cliniques du dossier (prescriptions, comparaison des examens) dépendent du module « consultations ».
    const clinicalTabs = ['patient-prescriptions', 'patient-comparaison']
    for (const route of router.getRoutes().filter((entry) => entry.path.startsWith('/patients'))) {
      expect(route.meta.module, String(route.name)).toBe(
        clinicalTabs.includes(String(route.name)) ? 'consultations' : 'patients',
      )
      expect(route.meta.permissions?.length, String(route.name)).toBeGreaterThan(0)
    }
    // La consultation (C01) se lit avec clinical.read, module « consultations » ; l'adresse n'accepte
    // qu'un identifiant ULID. La liste des examens n'a aucune valeur clinique.
    const consultations = router
      .getRoutes()
      .filter((entry) => entry.path.startsWith('/consultations'))
    for (const route of consultations) {
      expect(route.meta.module, String(route.name)).toBe('consultations')
      expect(route.meta.permissions, String(route.name)).toEqual(['clinical.read'])
    }
    expect(consultations.map((route) => String(route.name)).sort()).toEqual([
      'consultation',
      'consultation-historique',
      'consultation-prescriptions',
      'consultations',
    ])
    expect(router.resolve('/consultations').name).toBe('consultations')
    expect(router.resolve('/consultations/01J9ZXK4M2Q8R7S6T5V4W30501').name).toBe('consultation')
    // Les paramètres dépendent du module « settings » ; le mot de passe de son compte, d'aucun module.
    for (const route of router
      .getRoutes()
      .filter((entry) => entry.path.startsWith('/parametres'))) {
      // La préparation du poste et les conflits de synchronisation relèvent du module « offline » (fermé par défaut).
      const expected = ['parametres-poste', 'conflits-synchronisation'].includes(String(route.name))
        ? 'offline'
        : 'settings'
      expect(route.meta.module, String(route.name)).toBe(expected)
      expect(route.meta.permissions?.length, String(route.name)).toBeGreaterThan(0)
    }
    expect(router.resolve('/mon-compte/mot-de-passe').meta.module).toBeUndefined()
    for (const path of ['/consultations/abc', '/consultations/01J9ZXK4M2Q8R7S6T5V4W30501/etape']) {
      expect(router.resolve(path).name, path).toBe('introuvable')
    }
    // La file se lit avec l'une OU l'autre permission ; l'arrivée s'enregistre avec visit.register.
    const today = new Map(
      router
        .getRoutes()
        .filter((entry) => entry.path.startsWith('/aujourdhui'))
        .map((route) => [
          String(route.name),
          [route.path, route.meta.module, route.meta.permissions],
        ]),
    )
    expect(Object.fromEntries(today)).toEqual({
      aujourdhui: ['/aujourdhui', 'today', ['visit.register', 'agenda.read']],
      arrivee: ['/aujourdhui/arrivee', 'today', ['visit.register']],
    })
  })

  it('renvoie vers la connexion sans session, avec le seul chemin interne', async () => {
    stubServer({ me: 'anonymous' })
    const { root, router, unmount } = await mountAt('/une-page')

    expect(router.currentRoute.value.name).toBe('connexion')
    expect(router.currentRoute.value.query).toEqual({ suite: '/une-page' })
    expect(root.querySelector('h1')?.textContent).toBe('Connexion')
    expect(document.title).toBe('Connexion – Eagle’s Eye Optics Medical')

    unmount()
  })

  it('accueille le compte connecté sans présenter de module futur comme livré', async () => {
    // Gérante : toutes les permissions, mais l'exploitant n'a encore ouvert aucun module (les écrans
    // patient sont livrés dans le code, pas ouverts) : ni menu, ni action, aucune parole sur les droits.
    stubServer({
      me: meResponse(
        ['patient.read', 'invoice.read', 'agenda.read', 'users.manage'],
        'Gérante Fictive',
        [],
      ),
    })
    const { root, unmount } = await mountAt('/')

    expect(root.querySelector('h1')?.textContent).toBe('Bonjour Gérante Fictive')
    expect(root.querySelector('nav')).toBeNull()
    expect(root.textContent).toContain('Aucun module métier livré pour l’instant')
    const brand = root.querySelector('header a')
    expect(brand?.getAttribute('href')).toBe('/')
    expect(brand?.textContent).toContain('(accueil)')
    expect(root.querySelector('header')?.textContent).toContain('Gérante Fictive')
    const headerButtons = [...root.querySelectorAll('header button')].map((button) =>
      button.textContent?.trim(),
    )
    expect(headerButtons).toEqual(['Aide', 'Se déconnecter'])

    unmount()
  })

  it('présente les écrans patient livrés dès que l’exploitant ouvre le module « patients »', async () => {
    stubServer({
      me: meResponse(['patient.read', 'patient.create', 'invoice.read'], 'Réception Fictive', [
        'patients',
      ]),
    })
    const { root, unmount } = await mountAt('/')

    const actions = [...root.querySelectorAll('main nav a')].map((link) => link.textContent?.trim())
    expect(actions).toEqual(['Nouveau patient', 'Rechercher'])
    const menu = [...root.querySelectorAll('nav[aria-label="Navigation principale"] a')].map(
      (link) => link.textContent?.trim(),
    )
    expect(menu).toEqual(['Accueil', 'Patients'])
    expect(root.textContent).not.toContain('Aucun module métier livré')

    unmount()
  })

  it('présente la file du jour dès que l’exploitant ouvre le module « today »', async () => {
    stubServer({
      me: meResponse(['visit.register', 'patient.read', 'invoice.read'], 'Réception Fictive', [
        'today',
      ]),
    })
    const { root, unmount } = await mountAt('/')

    const actions = [...root.querySelectorAll('main nav a')].map((link) => link.textContent?.trim())
    expect(actions).toEqual(['Consultations du jour'])
    expect(root.querySelector('main nav a')?.getAttribute('href')).toBe('/aujourdhui')
    const menu = [...root.querySelectorAll('nav[aria-label="Navigation principale"] a')].map(
      (link) => link.textContent?.trim(),
    )
    // « Patients » reste fermé : le module `patients` n'est pas ouvert, la file du jour l'est.
    expect(menu).toEqual(['Accueil', 'Aujourd’hui'])

    unmount()
  })

  it('refuse une page dont le compte n’a pas la permission', async () => {
    stubServer({ me: meResponse(['patient.read']) })
    const { router } = createEeoApp(createMemoryHistory())
    router.addRoute({
      path: '/reserve-gerante',
      name: 'reserve-gerante',
      component: { render: () => h('p', 'Réservé') },
      meta: { permissions: ['users.manage'] },
    })
    await router.push('/reserve-gerante')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('acces-refuse')
  })

  it('n’interroge le serveur qu’une fois pour la session', async () => {
    const fetchMock = stubServer({ me: meResponse(['patient.read']) })
    const { router, unmount } = await mountAt('/')
    await router.push('/acces-refuse')
    await router.push('/')

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/auth/me')).toHaveLength(
      1,
    )
    unmount()
  })
})

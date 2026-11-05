import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { adoptLocalAccount, refreshSession, resetSessionForTests } from '@/app/session'
import type { Me } from '@/domain/contracts/generated'
import type { HandbookPart, HandbookTopic, PageHelp } from '@/domain/help/model'
import { KNOWN_MODULES, PROFILES, profileByCode } from '@/domain/help/profiles'
import HelpPage from '@/pages/help/HelpPage.vue'
import {
  findTopic,
  neighbours,
  queryText,
  readerFor,
  resultsTitle,
  screenGroups,
  startCards,
  visibleParts,
  visiblePages,
} from '@/pages/help/documentation'

import { meResponse, stubServer } from '../shell/server'

/**
 * Écran « Documentation » (`/aide`) : accueil, rubrique par son ancre, fiche d'un écran, recherche, choix du
 * profil de lecture réservé à la gérante, sommaire, focus du titre, chargement et reprise, session locale.
 * Le contenu est FICTIF (le chargeur `@/domain/help/loader` est remplacé) : ce test vérifie l'écran, pas la
 * rédaction du vrai contenu (voir content-guards.test.ts). Routeur à noms de routes fictifs, session réelle.
 */
const loader = vi.hoisted(() => ({ handbook: vi.fn(), pages: vi.fn() }))

vi.mock('@/domain/help/loader', () => ({
  loadHandbook: () => loader.handbook() as unknown,
  loadPageHelp: () => loader.pages() as unknown,
}))

// --- Contenu fictif -------------------------------------------------------------------------------

function topic(id: string, title: string, over: Partial<HandbookTopic> = {}): HandbookTopic {
  return {
    id,
    title,
    summary: `Ce qu’on apprend dans « ${title} ».`,
    module: null,
    anyPermission: [],
    blocks: [],
    ...over,
  }
}

const PARTS: readonly HandbookPart[] = [
  {
    id: 'demarrer',
    title: 'Démarrer',
    icon: 'home',
    summary: 'Ce que fait l’application et comment s’y repérer.',
    topics: [
      topic('bienvenue', 'Bienvenue dans l’application', {
        intro: 'Cliquez sur « Patients » pour commencer.',
        blocks: [
          { kind: 'points', title: 'Ce que fait l’outil', items: ['Une fiche par patient.'] },
          { kind: 'note', tone: 'info', text: 'Rien n’est jamais effacé.' },
        ],
        related: [
          { topic: 'parcours-accueillir', label: 'Accueillir un patient', why: 'Le parcours.' },
          { topic: 'avant-installation', label: 'Avant l’installation', why: 'Réservé.' },
          { route: 'patients', label: 'L’écran Patients' },
          { route: 'caisse', label: 'L’écran Caisse', why: 'Pour encaisser.' },
          { route: 'facture', label: 'Une facture', why: 'Adresse incomplète.' },
        ],
      }),
      topic('profils', 'Les profils', { audience: ['MANAGER', 'RECEPTION'] }),
    ],
  },
  {
    id: 'parcours',
    title: 'Parcours pas à pas',
    icon: 'list',
    summary: 'Les tâches du cabinet, de bout en bout.',
    topics: [
      topic('parcours-accueillir', 'Accueillir un patient', {
        module: 'patients',
        anyPermission: ['patient.read'],
        audience: ['RECEPTION'],
        maturity: 'validation',
        keywords: ['arrivée'],
      }),
      topic('parcours-vente', 'Vendre et encaisser une facture', {
        module: 'sales',
        anyPermission: ['invoice.read'],
        summary: 'Émettre une facture puis encaisser.',
        blocks: [{ kind: 'steps', items: ['Cliquez sur « Émettre la facture ».'] }],
      }),
      topic('parcours-caisse', 'Tenir la caisse', {
        module: 'sales',
        anyPermission: ['cash.own_session', 'cash.manage'],
      }),
    ],
  },
  {
    id: 'guides-profils',
    title: 'Guides par profil',
    icon: 'users',
    summary: 'Votre journée avec l’application.',
    topics: [
      topic('guide-accueil', 'Guide de l’accueil', { audience: ['RECEPTION'] }),
      topic('guide-caisse', 'Guide de la caissière', { audience: ['CASHIER'] }),
    ],
  },
  {
    id: 'glossaire',
    title: 'Glossaire',
    icon: 'tag',
    summary: 'Le sens des mots.',
    topics: [topic('glossaire-optique', 'Glossaire : mots d’optique')],
  },
  {
    id: 'depannage',
    title: 'Dépannage',
    icon: 'alert',
    summary: 'Les messages et les limites.',
    topics: [topic('depannage-messages', 'Comprendre les messages')],
  },
  {
    id: 'mise-en-service',
    title: 'Mise en service',
    icon: 'settings',
    summary: 'Préparer l’outil avant l’ouverture.',
    topics: [
      topic('avant-installation', 'Avant l’installation', { anyPermission: ['users.manage'] }),
    ],
  },
]

function page(route: string, title: string, over: Partial<PageHelp> = {}): PageHelp {
  return {
    route,
    title,
    module: null,
    anyPermission: [],
    purpose: `Vous êtes sur l’écran « ${title} ».`,
    actions: [],
    tasks: [],
    rules: [],
    next: [],
    ...over,
  }
}

const PAGES: readonly PageHelp[] = [
  page('accueil', 'Accueil'),
  page('aide', 'Documentation'),
  page('patients', 'Patients', {
    module: 'patients',
    anyPermission: ['patient.read'],
    purpose: 'Retrouvez un patient avec « Rechercher ».',
    actions: [{ label: 'Rechercher', effect: 'Affiche les fiches.' }],
    tasks: [
      { id: 'retrouver', title: 'Retrouver un patient', steps: ['Cliquez sur « Rechercher ».'] },
      { id: 'creer', title: 'Créer un patient', steps: ['Cliquez sur « Nouveau patient ».'] },
    ],
    next: [
      { route: 'caisse', label: 'Caisse', why: 'Pour encaisser.' },
      { topic: 'parcours-accueillir', label: 'Accueillir un patient' },
    ],
  }),
  page('caisse', 'Caisse', {
    module: 'sales',
    anyPermission: ['cash.own_session', 'cash.manage'],
  }),
  page('facture', 'Facture', { module: 'sales', anyPermission: ['invoice.read'] }),
  page('statistiques', 'Statistiques', {
    module: 'reports',
    anyPermission: ['statistics.activity'],
  }),
  page('postes', 'Postes hors ligne', { module: 'offline', anyPermission: ['offline.enroll'] }),
]

// --- Comptes, routeur et montage --------------------------------------------------------------------

const RECEPTION = ['patient.read', 'patient.create', 'visit.register', 'agenda.read']
const RECEPTION_MODULES = ['today', 'patients', 'agenda']
const MANAGER = [
  'patient.read',
  'invoice.read',
  'cash.manage',
  'statistics.activity',
  'offline.enroll',
  'users.manage',
]
const MANAGER_MODULES = ['today', 'patients', 'sales', 'reports', 'settings']

async function signInAs(
  permissions: readonly string[],
  modules: readonly string[],
  roles: Me['roles'] = ['MANAGER'],
): Promise<void> {
  const me = meResponse([...permissions], 'Compte Fictif', [...modules])
  me.data.roles = roles
  stubServer({ me })
  await refreshSession()
}

const EMPTY_PAGE = { render: () => null }

/** Routes fictives : des écrans libres, réservés, d'un module, utilisables sans serveur, à paramètre. */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'accueil', component: EMPTY_PAGE, meta: { offlineCapable: true } },
      { path: '/aide', name: 'aide', component: EMPTY_PAGE, meta: { offlineCapable: true } },
      {
        path: '/patients',
        name: 'patients',
        component: EMPTY_PAGE,
        meta: { permissions: ['patient.read'], module: 'patients', offlineCapable: true },
      },
      {
        path: '/ventes/caisse',
        name: 'caisse',
        component: EMPTY_PAGE,
        meta: { permissions: ['cash.own_session', 'cash.manage'], module: 'sales' },
      },
      {
        path: '/ventes/factures/:id',
        name: 'facture',
        component: EMPTY_PAGE,
        meta: { permissions: ['invoice.read'], module: 'sales' },
      },
    ],
  })
}

const wrappers: VueWrapper[] = []

/** Ouvre l'écran à une adresse, session déjà ouverte, contenu chargé (sauf `settle: false`). */
async function open(
  path = '/aide',
  options: { settle?: boolean } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(HelpPage, { attachTo: document.body, global: { plugins: [router] } })
  wrappers.push(wrapper)
  if (options.settle !== false) await flushPromises()
  return { wrapper, router }
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  loader.handbook.mockImplementation(() => Promise.resolve({ HANDBOOK_PARTS: PARTS }))
  loader.pages.mockImplementation(() => Promise.resolve({ PAGE_HELP: PAGES }))
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  resetSessionForTests()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  document.body.innerHTML = ''
})

// --- Aides de lecture --------------------------------------------------------------------------------

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} : introuvable`)
  return value
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Ce que renvoie `get` : un élément trouvé (il existe, sinon `get` a levé une erreur). */
type Found = Omit<DOMWrapper<Element>, 'exists'>

/** Le sommaire (la navigation nommée) de l'écran. */
function nav(wrapper: VueWrapper): Found {
  return wrapper.get('nav[aria-label="Sommaire de la documentation"]')
}

/** Titre du contenu (`h2` qui reçoit le focus). */
function title(wrapper: VueWrapper): Found {
  return wrapper.get('h2[tabindex="-1"]')
}

/** Le focus arrive au titre au tour suivant (après le défilement du routeur) : attente large, poste chargé. */
async function expectTitleFocused(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(() => expect(document.activeElement).toBe(title(wrapper).element), {
    timeout: 4000,
  })
}

/** La zone de contenu (à droite du sommaire sur ordinateur) : la plus extérieure des zones `@container`. */
function content(wrapper: VueWrapper): Found {
  return wrapper.get('.\\@container')
}

/** Une rubrique d'une fiche ou d'une page, retrouvée par son titre (`aria-labelledby` → titre). */
function sectionTitled(wrapper: VueWrapper, name: string): DOMWrapper<Element> {
  const found = wrapper.findAll('section[aria-labelledby]').find((section) => {
    const heading = document.getElementById(section.attributes('aria-labelledby') ?? '')
    return heading !== null && squash(heading.textContent ?? '') === name
  })
  return must(found, `rubrique « ${name} »`)
}

function hrefs(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href') ?? '')
}

function navTexts(wrapper: VueWrapper): string[] {
  return nav(wrapper)
    .findAll('summary')
    .map((summary) => squash(summary.text()))
}

function partDetails(wrapper: VueWrapper, name: string): HTMLDetailsElement {
  const found = nav(wrapper)
    .findAll('details')
    .find((details) => squash(details.get('summary').text()) === name)
  return must(found?.element as HTMLDetailsElement | undefined, `partie « ${name} »`)
}

// --- Chargement --------------------------------------------------------------------------------------

describe('chargement du contenu', () => {
  it('annonce « Chargement de la documentation… » (zone vive), puis affiche l’accueil', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    let release: (() => void) | undefined
    loader.handbook.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ HANDBOOK_PARTS: PARTS })
        }),
    )
    const { wrapper } = await open('/aide', { settle: false })
    await flushPromises()

    const status = wrapper.get('[aria-live="polite"] [role="status"]')
    expect(status.text()).toContain('Chargement de la documentation…')
    expect(status.attributes('aria-busy')).toBe('true')
    // Le sommaire existe déjà (lien d'accueil), les parties arrivent avec le contenu.
    expect(nav(wrapper).text()).toContain('Accueil de la documentation')
    expect(nav(wrapper).findAll('details')).toHaveLength(0)
    expect(wrapper.find('h2').exists()).toBe(false)

    release?.()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Chargement de la documentation…')
    expect(title(wrapper).text()).toBe('Accueil de la documentation')
    expect(nav(wrapper).findAll('details').length).toBeGreaterThan(0)
  })

  it('échec du chargement : message et « Réessayer », qui reprend jusqu’au contenu', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    loader.pages.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    const { wrapper } = await open()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('La documentation n’a pas pu s’ouvrir.')
    expect(alert.text()).toContain('rechargez la page')
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Chargement de la documentation…')

    const retry = must(
      wrapper.findAll('button').find((button) => button.text() === 'Réessayer'),
      'bouton « Réessayer »',
    )
    await retry.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(title(wrapper).text()).toBe('Accueil de la documentation')
    expect(loader.handbook).toHaveBeenCalledTimes(2)
  })

  it('un second échec reste dit, sans boucle', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    loader.handbook.mockImplementation(() => Promise.reject(new Error('Failed to fetch')))
    const { wrapper } = await open()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Réessayer')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('La documentation n’a pas pu s’ouvrir.')
    expect(loader.handbook).toHaveBeenCalledTimes(2)
  })
})

// --- En-tête et accueil ---------------------------------------------------------------------------------

describe('en-tête et accueil', () => {
  it('titre de niveau 1 « Aide et documentation », sous-titre, icône d’aide', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    const h1 = wrapper.get('h1')
    expect(h1.text()).toBe('Aide et documentation')
    expect(h1.attributes('id')).toBe('titre-aide')
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe('titre-aide')
    expect(wrapper.text()).toContain(
      'Comment utiliser l’application, métier par métier et écran par écran.',
    )
  })

  it('accueil : mot d’accueil, « Par où commencer », une carte par partie visible', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    expect(title(wrapper).text()).toBe('Accueil de la documentation')
    expect(wrapper.text()).toContain('Elle ne montre que ce que votre compte peut ouvrir.')

    const headings = wrapper.findAll('h3').map((heading) => heading.text())
    expect(headings).toEqual(['Par où commencer', 'Les parties de la documentation'])

    // Cartes de départ : cinq questions, « Je prépare l’installation » seulement si sa cible est visible.
    const cards = wrapper.findAll('h4').map((heading) => heading.text())
    expect(cards.slice(0, 4)).toEqual([
      'Je découvre l’outil',
      'Je cherche comment faire',
      'Mon profil',
      'Un mot ou un message que je ne comprends pas',
    ])
    expect(cards).not.toContain('Je prépare l’installation')

    // Une carte par partie visible : « Mise en service » est réservée à la gestion du personnel.
    expect(cards).toEqual(
      expect.arrayContaining([
        'Démarrer',
        'Parcours pas à pas',
        'Guides par profil',
        'Glossaire',
        'Dépannage',
      ]),
    )
    expect(cards).not.toContain('Mise en service')
  })

  it('cartes de départ : cibles lues par ce compte, guide du profil en premier', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES, ['CASHIER'])
    const { wrapper } = await open()

    const card = (heading: string) => {
      const found = content(wrapper)
        .findAll('li')
        .find((item) => item.find('h4').exists() && item.get('h4').text() === heading)
      return must(found, `carte « ${heading} »`)
    }
    expect(hrefs(card('Je découvre l’outil').element)).toEqual(['/aide#/bienvenue'])
    // Première rubrique des parcours visible pour ce compte.
    expect(hrefs(card('Je cherche comment faire').element)).toEqual(['/aide#/parcours-accueillir'])
    // La caissière lit d'abord son guide.
    expect(hrefs(card('Mon profil').element)).toEqual([
      '/aide#/guide-caisse',
      '/aide#/guide-accueil',
    ])
    expect(hrefs(card('Un mot ou un message que je ne comprends pas').element)).toEqual([
      '/aide#/glossaire-optique',
      '/aide#/depannage-messages',
    ])
  })

  it('la gérante voit « Je prépare l’installation » et la partie « Mise en service »', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()

    const cards = wrapper.findAll('h4').map((heading) => heading.text())
    expect(cards).toContain('Je prépare l’installation')
    expect(cards).toContain('Mise en service')
    expect(hrefs(wrapper.element)).toContain('/aide#/avant-installation')
  })

  it('« Référence des écrans » : les fiches visibles, groupées par module', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    const reference = must(
      content(wrapper)
        .findAll('li')
        .find(
          (item) => item.find('h4').exists() && item.get('h4').text() === 'Référence des écrans',
        ),
      'carte de la référence',
    )
    const groups = reference
      .findAll('details')
      .map((details) => squash(details.get('summary').text()))
    // Accueil et documentation n'ont pas de module ; Patients dépend du module « patients ».
    expect(groups).toEqual(['Patients', 'Accès et général'])
    expect(hrefs(reference.element)).toEqual([
      '/aide#/ecran/patients',
      '/aide#/ecran/accueil',
      '/aide#/ecran/aide',
    ])
  })

  it('« Imprimer cette page » ouvre l’impression, bouton caché à l’impression', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { wrapper } = await open()

    const button = must(
      wrapper.findAll('button').find((candidate) => candidate.text() === 'Imprimer cette page'),
      'bouton « Imprimer cette page »',
    )
    expect(button.classes()).toContain('print:hidden')
    await button.trigger('click')
    expect(print).toHaveBeenCalledTimes(1)

    // Recherche, sommaire et lien de retour sont cachés à l'impression ; le contenu reste.
    expect(wrapper.get('aside').classes()).toContain('print:hidden')
    expect(wrapper.get('aside').classes()).toContain('xl:sticky')
  })
})

// --- Une rubrique ---------------------------------------------------------------------------------------

describe('rubrique (#/identifiant)', () => {
  it('titre, résumé, pastilles, introduction, blocs, partie et rubriques voisines', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/parcours-accueillir')

    expect(title(wrapper).text()).toBe('Accueillir un patient')
    expect(wrapper.get('article').attributes('aria-labelledby')).toBe(
      title(wrapper).attributes('id'),
    )
    expect(wrapper.text()).toContain('Ce qu’on apprend dans')
    // Pastilles : profils concernés et maturité « validation ».
    const profiles = wrapper.get('ul[aria-label="Profils concernés"]')
    expect(profiles.findAll('li').map((item) => squash(item.text()))).toEqual(['Accueil'])
    expect(wrapper.text()).toContain('En cours de validation : pas encore ouvert au cabinet')
    // Voisines dans la partie : « Précédente » n'existe pas (première), « Suivante » est cachée à ce compte.
    expect(
      wrapper.find('nav[aria-label="Autres rubriques de la partie Parcours pas à pas"]').exists(),
    ).toBe(false)
  })

  it('blocs en niveau 3 sous le titre de niveau 2, libellés d’écran en puces, introduction', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/bienvenue')

    expect(title(wrapper).element.tagName).toBe('H2')
    expect(wrapper.get('article').text()).toContain('Cliquez sur')
    const labels = wrapper.findAll('article .help-label').map((label) => squash(label.text()))
    expect(labels.some((label) => label.includes('Patients'))).toBe(true)
    expect(wrapper.get('article h3').text()).toBe('Ce que fait l’outil')
    expect(wrapper.get('article [role="note"]').text()).toContain('Rien n’est jamais effacé.')
    // La partie est nommée au-dessus du titre.
    expect(wrapper.get('article header p').text()).toBe('Démarrer')
  })

  it('« Pour aller plus loin » : rubriques lisibles, écrans ouverts ; rien ne trahit le reste', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/bienvenue')

    const related = sectionTitled(wrapper, 'Pour aller plus loin')
    // Rubrique lisible : lien ; rubrique réservée (mise en service) : absente avec sa raison.
    expect(hrefs(related.element)).toEqual(['/aide#/parcours-accueillir', '/patients'])
    expect(related.text()).toContain('Le parcours.')
    expect(related.text()).not.toContain('Avant l’installation')
    expect(related.text()).not.toContain('Réservé.')
    // Écran de module fermé / sans droit : ni lien, ni nom, ni raison. Écran à paramètre : caché aussi.
    expect(related.text()).not.toContain('L’écran Caisse')
    expect(related.text()).not.toContain('Pour encaisser.')
    expect(related.text()).not.toContain('Une facture')
  })

  it('la gérante suit aussi la rubrique réservée et les écrans de ses droits', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/bienvenue')

    const related = sectionTitled(wrapper, 'Pour aller plus loin')
    expect(hrefs(related.element)).toEqual([
      '/aide#/parcours-accueillir',
      '/aide#/avant-installation',
      '/patients',
      '/ventes/caisse',
    ])
    // Écran à paramètre : jamais proposé (l'adresse serait incomplète).
    expect(related.text()).not.toContain('Une facture')
  })

  it('précédente et suivante dans la partie, seulement parmi les rubriques visibles', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/parcours-vente')

    const around = wrapper.get('nav[aria-label="Autres rubriques de la partie Parcours pas à pas"]')
    expect(around.classes()).toContain('print:hidden')
    expect(hrefs(around.element)).toEqual(['/aide#/parcours-accueillir', '/aide#/parcours-caisse'])
    const texts = around.findAll('a').map((link) => squash(link.text()))
    // Le nom accessible du lien dit le sens (« Précédente : … ») ; le deux-points est lu, jamais affiché.
    expect(texts).toEqual(['Précédente : Accueillir un patient', 'Suivante : Tenir la caisse'])
    expect(around.findAll('.sr-only').map((hidden) => hidden.text())).toEqual([':', ':'])
  })

  it('une partie réduite par les droits ne propose que ses rubriques visibles', async () => {
    // Droits d'un compte qui lit les ventes mais pas la caisse : « Tenir la caisse » n'est pas voisine.
    await signInAs(['patient.read', 'invoice.read'], ['patients', 'sales'], ['CASHIER'])
    const { wrapper } = await open('/aide#/parcours-vente')

    const around = wrapper.get('nav[aria-label="Autres rubriques de la partie Parcours pas à pas"]')
    expect(hrefs(around.element)).toEqual(['/aide#/parcours-accueillir'])
  })

  it('rubrique inconnue ou invisible : message, lien vers l’accueil, aucune trace du contenu', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    for (const hash of ['#/avant-installation', '#/parcours-vente', '#/rubrique-inconnue']) {
      const { wrapper } = await open(`/aide${hash}`)

      expect(title(wrapper).text()).toBe('Rubrique introuvable')
      expect(wrapper.text()).toContain(
        'Cette rubrique n’existe pas ou n’est pas ouverte à votre compte.',
      )
      const home = must(
        wrapper
          .findAll('a')
          .find((link) => squash(link.text()) === 'Revenir à l’accueil de la documentation'),
        'lien vers l’accueil de la documentation',
      )
      expect(home.attributes('href')).toBe('/aide')
      expect(wrapper.text()).not.toContain('Vendre et encaisser')
      expect(hrefs(wrapper.element).filter((href) => href.endsWith(hash))).toEqual([])
    }
  })

  it('une ancre mal formée mène à l’accueil', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/Mauvaise_Ancre')

    expect(title(wrapper).text()).toBe('Accueil de la documentation')
  })
})

// --- La fiche d'un écran ----------------------------------------------------------------------------------

describe('fiche d’un écran (#/ecran/nom)', () => {
  it('titre de l’écran puis la fiche (niveau 3), avec les droits du lecteur', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/ecran/patients')

    expect(title(wrapper).text()).toBe('Patients')
    expect(wrapper.text()).toContain('Référence des écrans')
    const rubrics = wrapper.findAll('section h3').map((heading) => heading.text())
    expect(rubrics.slice(0, 2)).toEqual(['Vous êtes ici', 'Ce que vous pouvez faire ici'])
    expect(wrapper.get('section .help-label').text()).toContain('Rechercher')
  })

  it('« Ouvrir cet écran » : lien quand l’écran s’ouvre pour ce lecteur', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/ecran/patients')

    const open_ = must(
      wrapper.findAll('a').find((link) => squash(link.text()) === 'Ouvrir cet écran'),
      'lien « Ouvrir cet écran »',
    )
    expect(open_.attributes('href')).toBe('/patients')
  })

  it('le lien « Ensuite » vers un écran fermé à ce lecteur n’est pas montré', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide#/ecran/patients')

    const next = sectionTitled(wrapper, 'Ensuite')
    // La caisse (module « sales ») est fermée ici ; la rubrique de documentation reste.
    expect(hrefs(next.element)).toEqual(['/aide#/parcours-accueillir'])
    expect(next.text()).not.toContain('Pour encaisser.')
  })

  it('pas de « Ouvrir cet écran » pour une adresse à paramètre ni pour une page sans route', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/ecran/facture')

    expect(title(wrapper).text()).toBe('Facture')
    expect(wrapper.text()).not.toContain('Ouvrir cet écran')
  })

  it('fiche invisible ou inconnue : message, et aucun lien vers elle', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    for (const route of ['caisse', 'facture', 'inconnue']) {
      const { wrapper } = await open(`/aide#/ecran/${route}`)

      expect(title(wrapper).text()).toBe('Écran introuvable')
      expect(wrapper.text()).toContain(
        'Cette rubrique n’existe pas ou n’est pas ouverte à votre compte.',
      )
      expect(wrapper.find('a[href$="#/ecran/' + route + '"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Vous êtes ici')
    }
  })

  it('les modules fermés n’ont aucune fiche dans la référence', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/ecran/postes')

    // « offline » n'est pas ouvert : la fiche des postes est cachée, même à la gérante.
    expect(title(wrapper).text()).toBe('Écran introuvable')
    expect(hrefs(nav(wrapper).element).filter((href) => href.endsWith('/ecran/postes'))).toEqual([])
  })
})

// --- La recherche --------------------------------------------------------------------------------------------

describe('recherche (?q=)', () => {
  it('résultats : titre, partie, extrait, liens vers l’ancre de la rubrique ou de la fiche', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide?q=facture')

    expect(title(wrapper).text()).toBe('2 résultats pour « facture »')
    const items = content(wrapper).findAll('li')
    expect(items).toHaveLength(2)
    const found = items.map((item) => ({
      title: squash(item.get('a').text()),
      href: item.get('a').attributes('href'),
      group: squash(item.get('p').text()),
    }))
    // Classés par pertinence : le titre et le résumé de la rubrique, puis la fiche d'écran.
    expect(found).toEqual([
      {
        title: 'Vendre et encaisser une facture',
        href: '/aide#/parcours-vente',
        group: 'Parcours pas à pas',
      },
      { title: 'Facture', href: '/aide#/ecran/facture', group: 'Référence des écrans' },
    ])
    expect(wrapper.text()).not.toContain('Aucun résultat')
    // Aucune rubrique d'accueil pendant une recherche : le sommaire n'a aucun lien « courant ».
    expect(nav(wrapper).findAll('a[aria-current="page"]')).toHaveLength(0)
  })

  it('la recherche ne parcourt que ce que le lecteur peut lire', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open('/aide?q=facture')

    expect(title(wrapper).text()).toBe('Aucun résultat')
    expect(wrapper.text()).toContain('Aucune rubrique ni fiche d’écran ne contient tous les mots')
  })

  it('« Aucun résultat » : suggestion de reformuler et lien vers l’accueil de la documentation', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide?q=zzzz')

    expect(title(wrapper).text()).toBe('Aucun résultat')
    expect(wrapper.text()).toContain('« zzzz »')
    expect(wrapper.text()).toContain('Essayez avec moins de mots')
    const home = must(
      wrapper
        .findAll('a')
        .find((link) => squash(link.text()) === 'Revenir à l’accueil de la documentation'),
      'lien vers l’accueil de la documentation',
    )
    expect(home.attributes('href')).toBe('/aide')
  })

  it('un mot d’une seule lettre ne cherche rien : l’écran explique la règle', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide?q=a')

    expect(title(wrapper).text()).toBe('Aucun résultat')
    expect(wrapper.text()).toContain('Un mot compte au moins deux lettres.')
  })

  it('un extrait garde les libellés d’écran en puces', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide?q=rechercher')

    expect(title(wrapper).text()).toBe('1 résultat pour « rechercher »')
    expect(content(wrapper).get('li .help-label').text()).toContain('Rechercher')
  })

  it('le champ est le formulaire de recherche « Chercher dans la documentation »', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    const form = wrapper.get('form[role="search"]')
    expect(form.attributes('aria-label')).toBe('Chercher dans la documentation')
    const input = form.get('input[type="search"]')
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toContain(
      'Chercher dans la documentation',
    )
    expect(squash(form.get('button[type="submit"]').text())).toBe('Chercher')
  })

  it('envoyer le formulaire ouvre les résultats (?q=) et l’adresse reste la référence du champ', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open()

    const input = wrapper.get<HTMLInputElement>('input[type="search"]')
    await input.setValue('  facture   émettre ')
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/aide')
    expect(router.currentRoute.value.query).toEqual({ q: 'facture émettre' })
    expect(router.currentRoute.value.hash).toBe('')
    expect(title(wrapper).text()).toBe('1 résultat pour « facture émettre »')
    expect(input.element.value).toBe('facture émettre')

    // Retour arrière : le champ reprend la valeur de l'adresse.
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(input.element.value).toBe('')
  })

  it('la valeur du paramètre q remplit le champ à l’ouverture', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide?q=caisse')

    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('caisse')
  })

  it('un champ vide ne cherche pas ; vidé pendant une recherche, il revient à l’accueil', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open('/aide#/bienvenue')
    const form = wrapper.get('form[role="search"]')

    await form.trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/aide#/bienvenue')

    await wrapper.get('input[type="search"]').setValue('facture')
    await form.trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ q: 'facture' })

    await wrapper.get('input[type="search"]').setValue('   ')
    await form.trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/aide')
    expect(title(wrapper).text()).toBe('Accueil de la documentation')
  })

  it('un résultat ouvre la rubrique et efface la recherche de l’adresse', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open('/aide?q=facture')

    await content(wrapper).get('li a[href="/aide#/parcours-vente"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/aide#/parcours-vente')
    expect(title(wrapper).text()).toBe('Vendre et encaisser une facture')
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('')
  })
})

// --- Lire l'aide comme un autre profil --------------------------------------------------------------------

describe('« Lire l’aide comme » (gestion du personnel)', () => {
  it('absent sans le droit de gérer le personnel', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    expect(wrapper.text()).not.toContain('Lire l’aide comme')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Inclure les modules fermés')
  })

  it('présent pour la gérante : « Mon compte » puis les quatre profils par leur nom', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()

    const select = wrapper.get('select')
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toContain(
      'Lire l’aide comme',
    )
    expect(select.findAll('option').map((option) => squash(option.text()))).toEqual([
      'Mon compte',
      'Gérante',
      'Accueil',
      'Professionnel',
      'Caissière',
    ])
    expect(wrapper.text()).toContain('Inclure les modules fermés')
    // Aucun rappel tant que la lecture est celle du compte.
    expect(wrapper.text()).not.toContain('Vous lisez la documentation')
  })

  it('lire comme l’accueil : seules les rubriques et fiches de ce profil, partie « Mise en service » retirée', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()
    expect(navTexts(wrapper)).toContain('Mise en service')

    await wrapper.get('select').setValue('RECEPTION')
    await flushPromises()

    expect(navTexts(wrapper)).not.toContain('Mise en service')
    expect(navTexts(wrapper)).toEqual(
      expect.arrayContaining(['Démarrer', 'Parcours pas à pas', 'Guides par profil']),
    )
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/avant-installation')
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/parcours-vente')
    expect(hrefs(nav(wrapper).element)).toContain('/aide#/parcours-accueillir')
    // Fiches : seule celle de l'accueil des patients (module « patients » ouvert) et les écrans généraux.
    expect(hrefs(nav(wrapper).element)).toContain('/aide#/ecran/patients')
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/ecran/caisse')
    // Rappel visible de la lecture simulée.
    expect(wrapper.text()).toContain('Vous lisez la documentation comme le profil « Accueil ».')
    expect(wrapper.text()).not.toContain('modules fermés inclus')

    // Retour à « Mon compte » : tout revient.
    await wrapper.get('select').setValue('')
    await flushPromises()
    expect(navTexts(wrapper)).toContain('Mise en service')
    expect(wrapper.text()).not.toContain('Vous lisez la documentation')
  })

  it('lire comme la caissière : la caisse est lue si son module est ouvert', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()

    await wrapper.get('select').setValue('CASHIER')
    await flushPromises()

    expect(hrefs(nav(wrapper).element)).toContain('/aide#/parcours-vente')
    expect(hrefs(nav(wrapper).element)).toContain('/aide#/ecran/caisse')
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/ecran/statistiques')
  })

  it('un module fermé reste caché, même au profil qui en aurait le droit', async () => {
    await signInAs(MANAGER, ['today', 'patients', 'settings'])
    const { wrapper } = await open()

    await wrapper.get('select').setValue('CASHIER')
    await flushPromises()

    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/parcours-vente')
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/ecran/caisse')
  })

  it('« Inclure les modules fermés » : la documentation de ce que le cabinet n’a pas ouvert', async () => {
    await signInAs(MANAGER, ['today', 'patients', 'settings'])
    const { wrapper } = await open()
    await wrapper.get('select').setValue('CASHIER')
    await flushPromises()
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/parcours-vente')

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(hrefs(nav(wrapper).element)).toContain('/aide#/parcours-vente')
    expect(hrefs(nav(wrapper).element)).toContain('/aide#/ecran/caisse')
    // Un module ouvert ne donne aucun droit : l'écran des postes exige « offline.enroll », que la caissière n'a pas.
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/ecran/postes')
    expect(wrapper.text()).toContain(
      'Vous lisez la documentation comme le profil « Caissière », modules fermés inclus.',
    )
  })

  it('les modules fermés sans profil : la documentation de son compte, modules fermés inclus', async () => {
    await signInAs(MANAGER, ['today', 'patients', 'settings'])
    const { wrapper } = await open()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(hrefs(nav(wrapper).element)).toContain('/aide#/parcours-vente')
    expect(wrapper.text()).toContain(
      'Vous lisez la documentation de votre compte, modules fermés inclus.',
    )
  })

  it('les liens suivent le lecteur choisi : un écran fermé à ce profil n’est pas proposé', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/bienvenue')
    const related = () => hrefs(sectionTitled(wrapper, 'Pour aller plus loin').element)
    expect(related()).toContain('/ventes/caisse')

    await wrapper.get('select').setValue('RECEPTION')
    await flushPromises()

    expect(related()).not.toContain('/ventes/caisse')
    expect(related()).toContain('/patients')
  })

  it('la rubrique affichée disparaît si le profil choisi ne peut pas la lire', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/avant-installation')
    expect(title(wrapper).text()).toBe('Avant l’installation')

    await wrapper.get('select').setValue('RECEPTION')
    await flushPromises()

    expect(title(wrapper).text()).toBe('Rubrique introuvable')
  })
})

// --- Le sommaire -------------------------------------------------------------------------------------------

describe('sommaire de la documentation', () => {
  it('une navigation nommée : accueil, une partie repliable par thème, puis la référence des écrans', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()

    const links = nav(wrapper).findAll('a')
    expect(squash(links[0]?.text() ?? '')).toBe('Accueil de la documentation')
    expect(links[0]?.attributes('href')).toBe('/aide')
    expect(navTexts(wrapper).slice(0, 7)).toEqual([
      'Démarrer',
      'Parcours pas à pas',
      'Guides par profil',
      'Glossaire',
      'Dépannage',
      'Mise en service',
      'Référence des écrans',
    ])
    // Groupes de la référence, dans l'ordre des modules.
    expect(navTexts(wrapper).slice(7)).toEqual([
      'Patients',
      'Ventes et caisse',
      'Statistiques',
      'Accès et général',
    ])
  })

  it('l’accueil est la page courante, rien d’autre ne porte aria-current', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open()

    const current = nav(wrapper).findAll('a[aria-current]')
    expect(current).toHaveLength(1)
    expect(current[0]?.attributes('aria-current')).toBe('page')
    expect(squash(current[0]?.text() ?? '')).toBe('Accueil de la documentation')
  })

  it('la rubrique affichée est seule « page courante », et sa partie est ouverte', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/parcours-vente')

    const current = nav(wrapper).findAll('a[aria-current="page"]')
    expect(current.map((link) => squash(link.text()))).toEqual(['Vendre et encaisser une facture'])
    expect(nav(wrapper).findAll('a[aria-current]')).toHaveLength(1)
    expect(partDetails(wrapper, 'Parcours pas à pas').open).toBe(true)
    expect(partDetails(wrapper, 'Démarrer').open).toBe(false)
    expect(partDetails(wrapper, 'Référence des écrans').open).toBe(false)
  })

  it('la fiche affichée ouvre la référence et son groupe', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/ecran/caisse')

    expect(
      nav(wrapper)
        .findAll('a[aria-current="page"]')
        .map((link) => squash(link.text())),
    ).toEqual(['Caisse'])
    expect(partDetails(wrapper, 'Référence des écrans').open).toBe(true)
    expect(partDetails(wrapper, 'Ventes et caisse').open).toBe(true)
    expect(partDetails(wrapper, 'Patients').open).toBe(false)
  })

  it('suivre un lien change la partie ouverte, sans refermer celles que la personne a ouvertes', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open('/aide#/parcours-vente')
    partDetails(wrapper, 'Glossaire').open = true

    await router.push('/aide#/profils')
    await flushPromises()

    expect(partDetails(wrapper, 'Démarrer').open).toBe(true)
    expect(partDetails(wrapper, 'Parcours pas à pas').open).toBe(false)
    expect(partDetails(wrapper, 'Glossaire').open).toBe(true)
  })

  it('un clic sur un titre du sommaire ouvre la rubrique', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open()

    await nav(wrapper).get('a[href="/aide#/glossaire-optique"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/aide#/glossaire-optique')
    expect(title(wrapper).text()).toBe('Glossaire : mots d’optique')
  })

  it('une partie sans rubrique visible disparaît du sommaire', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    expect(navTexts(wrapper)).toEqual([
      'Démarrer',
      'Parcours pas à pas',
      'Guides par profil',
      'Glossaire',
      'Dépannage',
      'Référence des écrans',
      'Patients',
      'Accès et général',
    ])
  })

  it('le volet latéral est une zone nommée, cachée à l’impression et collée au défilement sur ordinateur', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper } = await open()

    const aside = wrapper.get('aside')
    expect(aside.attributes('aria-label')).toBe('Recherche et sommaire')
    expect(aside.classes()).toEqual(
      expect.arrayContaining(['print:hidden', 'xl:sticky', 'xl:top-6', 'xl:overflow-y-auto']),
    )
    expect(aside.attributes('class')).toContain('xl:max-h-[calc(100vh_-_3rem)]')
    // Sommaire repliable « Sommaire » sur téléphone et tablette, caché dès l'ordinateur.
    const summary = aside.get(':scope > details > summary')
    expect(squash(summary.text())).toBe('Sommaire')
    expect(summary.classes()).toContain('xl:hidden')
  })
})

// --- Mise en page : sommaire replié, impression ----------------------------------------------------------

describe('mise en page', () => {
  it('petit écran : le sommaire est fermé, et se referme après chaque navigation', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    const { wrapper, router } = await open()
    const menu = must(wrapper.get('aside > details').element as HTMLDetailsElement, 'sommaire')
    expect(menu.open).toBe(false)

    menu.open = true
    await router.push('/aide#/bienvenue')
    await flushPromises()
    expect(menu.open).toBe(false)

    menu.open = true
    await router.push('/aide?q=patient')
    await flushPromises()
    expect(menu.open).toBe(false)
  })

  it('grand écran (80 rem) : le sommaire est ouvert d’office et suit la largeur', async () => {
    await signInAs(RECEPTION, RECEPTION_MODULES)
    let listener: ((event: { matches: boolean }) => void) | undefined
    const query = {
      matches: true,
      addEventListener: vi.fn((_type: string, callback: (event: { matches: boolean }) => void) => {
        listener = callback
      }),
      removeEventListener: vi.fn(),
    }
    const matchMedia = vi.fn(() => query)
    vi.stubGlobal('matchMedia', matchMedia)

    const { wrapper, router } = await open()
    const menu = wrapper.get('aside > details').element as HTMLDetailsElement

    expect(matchMedia).toHaveBeenCalledWith('(min-width: 80rem)')
    expect(menu.open).toBe(true)
    expect(query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    // Sur grand écran, la navigation ne referme pas le sommaire (il n'a pas de bouton pour le rouvrir).
    await router.push('/aide#/bienvenue')
    await flushPromises()
    expect(menu.open).toBe(true)

    // L'écran se rétrécit : le sommaire se replie ; il se rouvre quand l'écran s'élargit.
    listener?.({ matches: false })
    await flushPromises()
    expect(menu.open).toBe(false)
    listener?.({ matches: true })
    await flushPromises()
    expect(menu.open).toBe(true)

    wrapper.unmount()
    wrappers.pop()
    expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('à l’impression, les blocs repliés se déplient puis se replient (aussi pour Ctrl+P)', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/ecran/patients')
    // La fiche porte deux tâches : la première est ouverte d'office, la seconde repliée.
    const tasks = Array.from(content(wrapper).element.querySelectorAll('details'))
    expect(tasks.map((details) => details.open)).toEqual([true, false])

    window.dispatchEvent(new Event('beforeprint'))
    expect(tasks.map((details) => details.open)).toEqual([true, true])

    window.dispatchEvent(new Event('afterprint'))
    expect(tasks.map((details) => details.open)).toEqual([true, false])
    // Le sommaire n'est jamais touché : il est caché à l'impression.
    expect(wrapper.get('aside > details').attributes('open')).toBeUndefined()
  })

  it('une tâche que la personne avait ouverte reste ouverte après l’impression', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/ecran/patients')
    const tasks = Array.from(content(wrapper).element.querySelectorAll('details'))
    must(tasks[1], 'seconde tâche').open = true

    window.dispatchEvent(new Event('beforeprint'))
    window.dispatchEvent(new Event('afterprint'))

    expect(tasks.map((details) => details.open)).toEqual([true, true])
  })
})

// --- Focus du titre ----------------------------------------------------------------------------------------------

describe('focus du titre à chaque changement de lieu', () => {
  it('le titre du contenu reçoit le focus et défile en vue', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper, router } = await open()
    // À l'accueil, rien n'est déplacé à l'ouverture.
    expect(document.activeElement).toBe(document.body)

    await router.push('/aide#/parcours-vente')
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('Vendre et encaisser une facture')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })

    await router.push('/aide?q=facture')
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('2 résultats pour « facture »')

    await router.push('/aide#/ecran/caisse')
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('Caisse')

    await router.push('/aide#/inconnue')
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('Rubrique introuvable')

    await router.push('/aide')
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('Accueil de la documentation')
  })

  it('le titre est un titre de niveau 2 focalisable par programme seulement (tabindex -1)', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/profils')

    expect(title(wrapper).element.tagName).toBe('H2')
    expect(title(wrapper).attributes('tabindex')).toBe('-1')
    expect(title(wrapper).classes()).toContain('scroll-mt-6')
  })

  it('lien profond : le titre est mis en vue dès que le contenu est chargé', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { wrapper } = await open('/aide#/parcours-caisse')

    await expectTitleFocused(wrapper)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('pendant le chargement, le focus attend le contenu', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    let release: (() => void) | undefined
    loader.pages.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ PAGE_HELP: PAGES })
        }),
    )
    const { wrapper, router } = await open('/aide', { settle: false })
    await router.push('/aide#/profils')
    await flushPromises()
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(document.activeElement).toBe(document.body)

    release?.()
    await expectTitleFocused(wrapper)
    expect(title(wrapper).text()).toBe('Les profils')
  })

  it('quitter l’écran ne déplace plus le focus', async () => {
    await signInAs(MANAGER, MANAGER_MODULES)
    const { router } = await open()

    await router.push('/patients')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.activeElement).toBe(document.body)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

// --- Session locale (poste préparé, serveur arrêté) -----------------------------------------------------

describe('session locale', () => {
  it('l’écran s’ouvre et lit son contenu sans serveur ; les écrans qui demandent le serveur sont nommés', async () => {
    adoptLocalAccount(meResponse([...MANAGER], 'Profil local', [...MANAGER_MODULES]).data)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await open('/aide#/bienvenue')

    expect(title(wrapper).text()).toBe('Bienvenue dans l’application')
    expect(fetchMock).not.toHaveBeenCalled()

    const related = sectionTitled(wrapper, 'Pour aller plus loin')
    // Les rubriques restent lisibles ; l'écran des patients s'ouvre sans serveur (offlineCapable) ; la caisse,
    // qui lit le serveur, est nommée sans lien avec sa mention.
    expect(hrefs(related.element)).toEqual([
      '/aide#/parcours-accueillir',
      '/aide#/avant-installation',
      '/patients',
    ])
    const caisse = must(
      related.findAll('li').find((item) => item.text().includes('L’écran Caisse')),
      'ligne « L’écran Caisse »',
    )
    expect(caisse.find('a').exists()).toBe(false)
    expect(squash(caisse.text())).toContain('(demande le serveur)')
    expect(caisse.text()).toContain('Pour encaisser.')
  })

  it('« Ouvrir cet écran » : un écran qui demande le serveur n’est pas proposé', async () => {
    adoptLocalAccount(meResponse([...MANAGER], 'Profil local', [...MANAGER_MODULES]).data)
    const { wrapper } = await open('/aide#/ecran/caisse')

    expect(title(wrapper).text()).toBe('Caisse')
    expect(wrapper.text()).not.toContain('Ouvrir cet écran')

    const patients = await open('/aide#/ecran/patients')
    expect(patients.wrapper.text()).toContain('Ouvrir cet écran')
  })
})

// --- Règles pures ------------------------------------------------------------------------------------------------

describe('documentation.ts : règles pures', () => {
  const own = { permissions: ['patient.read'], modules: ['patients'] }

  it('le lecteur : le compte, ou les droits d’un profil ; les modules fermés s’ajoutent à la demande', () => {
    expect(readerFor(null, false, own)).toEqual(own)
    const asCashier = readerFor('CASHIER', false, own)
    expect(asCashier.permissions).toContain('invoice.issue')
    expect(asCashier.modules).toEqual(['patients'])
    const all = readerFor(null, true, own)
    expect(all.permissions).toEqual(['patient.read'])
    expect(all.modules).toEqual(
      expect.arrayContaining(['today', 'patients', 'sales', 'offline', 'settings']),
    )
  })

  it('parties et fiches visibles : module ouvert ET un des droits', () => {
    const parts = visibleParts(PARTS, own)
    expect(parts.map((part) => part.id)).toEqual([
      'demarrer',
      'parcours',
      'guides-profils',
      'glossaire',
      'depannage',
    ])
    expect(parts[1]?.topics.map((entry) => entry.id)).toEqual(['parcours-accueillir'])
    expect(visiblePages(PAGES, own).map((entry) => entry.route)).toEqual([
      'accueil',
      'aide',
      'patients',
    ])
    expect(visibleParts(PARTS, { permissions: [], modules: [] }).map((part) => part.id)).toEqual([
      'demarrer',
      'guides-profils',
      'glossaire',
      'depannage',
    ])
    // Les données d'origine ne sont jamais modifiées.
    expect(PARTS[1]?.topics).toHaveLength(3)
  })

  it('groupes de la référence : ordre des modules, sans module à la fin, modules inconnus rangés à part', () => {
    const groups = screenGroups([
      page('accueil', 'Accueil'),
      page('nouveau', 'Un écran futur', { module: 'futur', anyPermission: ['x.read'] }),
      page('patients', 'Patients', { module: 'patients' }),
      page('stock', 'Stock', { module: 'stock' }),
      page('aujourdhui', 'Aujourd’hui', { module: 'today' }),
    ])
    expect(groups.map((group) => group.title)).toEqual([
      'File du jour',
      'Patients',
      'Stock',
      'Accès et général',
      'Autres écrans',
    ])
    expect(groups[4]?.pages.map((entry) => entry.route)).toEqual(['nouveau'])
    expect(screenGroups([])).toEqual([])
  })

  it('une rubrique et sa partie ; les voisines d’une rubrique', () => {
    const found = findTopic(PARTS, 'parcours-vente')
    expect(found?.part.id).toBe('parcours')
    expect(found?.topic.title).toBe('Vendre et encaisser une facture')
    expect(findTopic(PARTS, 'inconnue')).toBeUndefined()

    const part = must(found?.part, 'partie')
    expect(neighbours(part, 'parcours-accueillir')).toEqual({
      previous: undefined,
      next: part.topics[1],
    })
    expect(neighbours(part, 'parcours-vente').previous?.id).toBe('parcours-accueillir')
    expect(neighbours(part, 'parcours-caisse').next).toBeUndefined()
    expect(neighbours(part, 'inconnue')).toEqual({ previous: undefined, next: undefined })
  })

  it('cartes de départ : jamais de carte sans cible lisible', () => {
    expect(startCards([], [])).toEqual([])
    const cards = startCards(PARTS, [])
    expect(cards.map((card) => card.id)).toEqual([
      'decouvrir',
      'faire',
      'profil',
      'installation',
      'comprendre',
    ])
    const profile = cards.find((card) => card.id === 'profil')
    expect(profile?.links.map((link) => link.hash)).toEqual(['#/guide-accueil', '#/guide-caisse'])
    expect(
      startCards(PARTS, ['CASHIER']).find((card) => card.id === 'profil')?.links[0]?.hash,
    ).toBe('#/guide-caisse')
    // Sans guides ni glossaire rédigés, les cartes correspondantes disparaissent.
    const bare = startCards(
      PARTS.filter((part) => ['demarrer', 'parcours'].includes(part.id)),
      [],
    )
    expect(bare.map((card) => card.id)).toEqual(['decouvrir', 'faire'])
  })

  it('texte de recherche et titre des résultats', () => {
    expect(queryText('facture')).toBe('facture')
    expect(queryText(['premier', 'second'])).toBe('premier')
    expect(queryText(null)).toBe('')
    expect(queryText(undefined)).toBe('')
    expect(queryText([null])).toBe('')
    expect(resultsTitle(1)).toBe('1 résultat')
    expect(resultsTitle(7)).toBe('7 résultats')
    expect(resultsTitle(30)).toBe('Les 30 premiers résultats')
  })
})

// --- Le vrai contenu ---------------------------------------------------------------------------------------------

describe('avec le vrai contenu de l’aide', () => {
  async function useRealContent() {
    const handbook = await import('@/domain/help/handbook')
    const pagesModule = await import('@/domain/help/pages')
    loader.handbook.mockImplementation(() => Promise.resolve(handbook))
    loader.pages.mockImplementation(() => Promise.resolve(pagesModule))
    return { handbook, pagesModule }
  }

  it('chaque rubrique et chaque fiche d’écran s’affichent sous leur titre, sans avertissement', async () => {
    const { handbook, pagesModule } = await useRealContent()
    await signInAs(profileByCode('MANAGER').permissions, KNOWN_MODULES)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, router } = await open('/aide')
    expect(title(wrapper).text()).toBe('Accueil de la documentation')

    for (const entry of handbook.HANDBOOK_TOPICS) {
      await router.push({ name: 'aide', hash: `#/${entry.id}` })
      await flushPromises()
      expect(title(wrapper).text(), `rubrique « ${entry.id} »`).toBe(entry.title)
    }
    for (const entry of pagesModule.PAGE_HELP) {
      await router.push({ name: 'aide', hash: `#/ecran/${entry.route}` })
      await flushPromises()
      expect(title(wrapper).text(), `fiche « ${entry.route} »`).toBe(entry.title)
    }

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  }, 120_000)

  it.each(PROFILES.map((profile) => ({ code: profile.code, label: profile.label })))(
    'profil $label : chaque lien du sommaire mène à un contenu lisible',
    async ({ code }) => {
      await useRealContent()
      await signInAs(profileByCode(code).permissions, KNOWN_MODULES, [code])
      const { wrapper, router } = await open('/aide')

      const links = hrefs(nav(wrapper).element).filter((href) => href.includes('#/'))
      expect(links.length).toBeGreaterThan(10)
      for (const href of links) {
        await router.push(href)
        await flushPromises()
        expect(['Rubrique introuvable', 'Écran introuvable'], href).not.toContain(
          title(wrapper).text(),
        )
      }
    },
    120_000,
  )

  it('un compte sans module ouvert ne lit que les rubriques générales', async () => {
    await useRealContent()
    await signInAs(profileByCode('RECEPTION').permissions, [])
    const { wrapper } = await open('/aide')

    const links = hrefs(nav(wrapper).element).filter((href) => href.includes('#/'))
    // Les écrans des modules fermés n'ont aucune fiche ; les rubriques générales (démarrer…) restent.
    expect(links).toContain('/aide#/bienvenue')
    expect(links.filter((href) => href.includes('#/ecran/patients'))).toEqual([])
    expect(hrefs(nav(wrapper).element)).not.toContain('/aide#/avant-installation')
  })
})

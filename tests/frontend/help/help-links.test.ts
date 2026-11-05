import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adoptLocalAccount, refreshSession, resetSessionForTests } from '@/app/session'
import PageHelpView from '@/components/help/PageHelpView.vue'
import {
  type HelpLinkContext,
  type HelpLinkState,
  resolveLinkState,
  useHelpLinkState,
} from '@/components/help/useHelpLinks'
import type { PageHelp } from '@/domain/help/model'

import { meResponse, stubServer } from '../shell/server'

/**
 * Écrans cités par l'aide (« Ensuite ») : ce que l'aide PROPOSE à ce compte, calculé comme le routeur au moment
 * d'ouvrir l'écran (`resolveLinkState`, `useHelpLinkState`), puis la façon dont la fiche d'un écran en tient
 * compte (propriété `linkState` de `PageHelpView`) : un écran fermé ou interdit n'est pas montré, un écran qui
 * demande le serveur est nommé sans lien. Routes, comptes et fiches FICTIFS : seul ce qui est mesuré est celui
 * du routeur réel (meta `permissions`, `module`, `offlineCapable`) et de la session réelle.
 */
const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  resetSessionForTests()
  document.body.innerHTML = ''
})

const PAGE = { render: () => null }

/** Écrans de toutes les sortes : libre, réservé à des droits, d'un module, utilisable sans serveur, à paramètre. */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'accueil', component: PAGE, meta: { offlineCapable: true } },
      { path: '/libre', name: 'libre', component: PAGE },
      { path: '/aide', name: 'aide', component: PAGE, meta: { offlineCapable: true } },
      {
        path: '/patients',
        name: 'patients',
        component: PAGE,
        meta: { permissions: ['patient.read'], module: 'patients' },
      },
      {
        path: '/ventes',
        name: 'ventes',
        component: PAGE,
        meta: { permissions: ['invoice.read', 'invoice.create'], module: 'sales' },
      },
      {
        path: '/reglages',
        name: 'reglages',
        component: PAGE,
        meta: { permissions: ['users.manage'], module: 'settings', offlineCapable: true },
      },
      { path: '/sans-droit', name: 'sans-droit', component: PAGE, meta: { permissions: [] } },
      {
        path: '/dossier/:id',
        name: 'dossier',
        component: PAGE,
        meta: { permissions: ['patient.read'] },
      },
    ],
  })
}

const online = (permissions: string[], modules: string[]): HelpLinkContext => ({
  permissions,
  modules,
  local: false,
})
const local = (permissions: string[], modules: string[] = []): HelpLinkContext => ({
  permissions,
  modules,
  local: true,
})

describe('resolveLinkState : ce que l’aide propose, comme le routeur', () => {
  const router = makeRouter()

  interface Case {
    what: string
    route: string
    context: HelpLinkContext
    expected: HelpLinkState
  }

  describe('session du serveur', () => {
    it.each<Case>([
      { what: 'écran sans condition', route: 'libre', context: online([], []), expected: 'open' },
      {
        what: 'accueil, sans droit ni module',
        route: 'accueil',
        context: online([], []),
        expected: 'open',
      },
      {
        what: 'droit et module présents',
        route: 'patients',
        context: online(['patient.read'], ['patients']),
        expected: 'open',
      },
      {
        what: 'droit absent',
        route: 'patients',
        context: online([], ['patients']),
        expected: 'hidden',
      },
      {
        what: 'module fermé par l’exploitant',
        route: 'patients',
        context: online(['patient.read'], ['today']),
        expected: 'hidden',
      },
      {
        what: 'droit absent ET module fermé',
        route: 'patients',
        context: online([], []),
        expected: 'hidden',
      },
      {
        what: 'un seul des droits suffit',
        route: 'ventes',
        context: online(['invoice.create'], ['sales']),
        expected: 'open',
      },
      {
        what: 'aucun des droits de l’écran',
        route: 'ventes',
        context: online(['patient.read'], ['sales']),
        expected: 'hidden',
      },
      {
        // Comme la garde du routeur : une liste de droits vide n'ouvre l'écran à personne.
        what: 'liste de droits vide',
        route: 'sans-droit',
        context: online(['patient.read'], ['patients']),
        expected: 'hidden',
      },
      {
        what: 'écran à paramètre (adresse incomplète)',
        route: 'dossier',
        context: online(['patient.read'], []),
        expected: 'hidden',
      },
      {
        what: 'route inconnue',
        route: 'inconnue',
        context: online(['patient.read'], ['patients']),
        expected: 'hidden',
      },
    ])('$what : « $route » → $expected', ({ route, context, expected }) => {
      expect(resolveLinkState(router, route, context)).toBe(expected)
    })
  })

  describe('session locale (poste préparé, serveur non joint)', () => {
    it.each<Case>([
      {
        what: 'écran qui lit le serveur',
        route: 'patients',
        context: local(['patient.read'], ['patients']),
        expected: 'server',
      },
      {
        what: 'écran qui lit le serveur, sans droit',
        route: 'patients',
        context: local([]),
        expected: 'server',
      },
      {
        what: 'écran sans condition, mais non prévu pour le poste',
        route: 'libre',
        context: local([]),
        expected: 'server',
      },
      { what: 'accueil', route: 'accueil', context: local([]), expected: 'open' },
      { what: 'documentation', route: 'aide', context: local([]), expected: 'open' },
      {
        what: 'écran du poste avec son droit',
        route: 'reglages',
        context: local(['users.manage']),
        expected: 'open',
      },
      {
        what: 'écran du poste sans son droit',
        route: 'reglages',
        context: local(['patient.read']),
        expected: 'hidden',
      },
      {
        // La garde du routeur ne regarde pas les modules d'une session locale : l'aide non plus.
        what: 'modules inconnus en session locale',
        route: 'reglages',
        context: local(['users.manage'], []),
        expected: 'open',
      },
      {
        what: 'écran à paramètre',
        route: 'dossier',
        context: local(['patient.read']),
        expected: 'hidden',
      },
      {
        what: 'route inconnue',
        route: 'inconnue',
        context: local(['patient.read']),
        expected: 'hidden',
      },
    ])('$what : « $route » → $expected', ({ route, context, expected }) => {
      expect(resolveLinkState(router, route, context)).toBe(expected)
    })
  })

  it('ne lève jamais d’erreur, même pour un nom de route absurde', () => {
    for (const route of ['', ' ', '/patients', 'constructor', '__proto__']) {
      expect(() => resolveLinkState(router, route, online([], []))).not.toThrow()
      expect(resolveLinkState(router, route, online([], []))).toBe('hidden')
    }
  })
})

describe('useHelpLinkState : le compte connecté', () => {
  function mountProbe(): { linkState: (route: string) => HelpLinkState; wrapper: VueWrapper } {
    let linkState: ((route: string) => HelpLinkState) | undefined
    const Probe = defineComponent({
      setup() {
        const state = useHelpLinkState()
        linkState = state
        const patients = computed(() => state('patients'))
        return () => h('p', patients.value)
      },
    })
    const wrapper = track(mount(Probe, { global: { plugins: [makeRouter()] } }))
    if (linkState === undefined) throw new Error('useHelpLinkState n’a rien rendu')
    return { linkState, wrapper }
  }

  async function signInAs(permissions: string[], modules: string[]): Promise<void> {
    stubServer({ me: meResponse(permissions, 'Compte Fictif', modules) })
    await refreshSession()
  }

  it('session du serveur : droits et modules du compte', async () => {
    await signInAs(['patient.read'], ['patients'])
    const { linkState } = mountProbe()

    expect(linkState('patients')).toBe('open')
    expect(linkState('accueil')).toBe('open')
    expect(linkState('ventes')).toBe('hidden')
    expect(linkState('reglages')).toBe('hidden')
    expect(linkState('inconnue')).toBe('hidden')
  })

  it('session du serveur : un module fermé masque l’écran même avec son droit', async () => {
    await signInAs(['patient.read', 'invoice.read'], ['patients'])
    const { linkState } = mountProbe()

    expect(linkState('patients')).toBe('open')
    expect(linkState('ventes')).toBe('hidden')
  })

  it('session locale : seuls les écrans du poste s’ouvrent, les autres demandent le serveur', () => {
    adoptLocalAccount(
      meResponse(['patient.read', 'users.manage'], 'Profil local', ['offline']).data,
    )
    const { linkState } = mountProbe()

    expect(linkState('patients')).toBe('server')
    expect(linkState('libre')).toBe('server')
    expect(linkState('accueil')).toBe('open')
    expect(linkState('aide')).toBe('open')
    expect(linkState('reglages')).toBe('open')
  })

  it('session locale : un écran du poste réservé à un droit que le profil n’a pas reste caché', () => {
    adoptLocalAccount(meResponse(['patient.read'], 'Profil local', ['offline']).data)
    const { linkState } = mountProbe()

    expect(linkState('reglages')).toBe('hidden')
  })

  it('sans compte connu : rien de réservé n’est proposé', () => {
    const { linkState } = mountProbe()

    expect(linkState('accueil')).toBe('open')
    expect(linkState('patients')).toBe('hidden')
    expect(linkState('ventes')).toBe('hidden')
  })

  it('suit la session : un changement de compte met à jour ce qui est lu dans un calcul réactif', async () => {
    await signInAs(['patient.read'], ['patients'])
    const { wrapper } = mountProbe()
    expect(wrapper.text()).toBe('open')

    // Le serveur n'est plus joint : le profil du coffre prend le relais (D27).
    resetSessionForTests()
    adoptLocalAccount(meResponse(['patient.read'], 'Profil local', ['offline']).data)
    await nextTick()
    expect(wrapper.text()).toBe('server')

    resetSessionForTests()
    await nextTick()
    expect(wrapper.text()).toBe('hidden')
  })
})

describe('PageHelpView : « Ensuite » selon l’état de chaque écran cité', () => {
  const FICHE: PageHelp = {
    route: 'exemple',
    title: 'Écran d’exemple',
    module: null,
    anyPermission: [],
    purpose: 'Un écran pour essayer les liens.',
    actions: [],
    tasks: [],
    rules: [],
    next: [
      { route: 'libre', label: 'Écran ouvert', why: 'Pour retrouver « Nom ».' },
      { route: 'ventes', label: 'Écran du serveur', why: 'Le poste ne le connaît pas.' },
      { route: 'patients', label: 'Écran fermé', why: 'Module fermé ou droit absent.' },
      { topic: 'parcours-accueillir', label: 'Accueillir un patient', why: 'Le parcours complet.' },
    ],
  }

  const STATES: Readonly<Record<string, HelpLinkState>> = {
    libre: 'open',
    ventes: 'server',
    patients: 'hidden',
  }
  const known = (route: string): HelpLinkState => STATES[route] ?? 'hidden'

  function mountView(help: PageHelp, linkState?: (route: string) => HelpLinkState): VueWrapper {
    return track(
      mount(PageHelpView, {
        props: { help, permissions: [], ...(linkState === undefined ? {} : { linkState }) },
        global: { plugins: [makeRouter()] },
      }),
    )
  }

  function nextSection(wrapper: VueWrapper) {
    return wrapper.findAll('section').find((section) => section.find('h3').text() === 'Ensuite')
  }

  it('écran ouvert : un vrai lien', () => {
    const next = nextSection(mountView(FICHE, known))

    const link = next?.find('a[href="/libre"]')
    expect(link?.text()).toBe('Écran ouvert')
    expect(next?.text()).toContain('Pour retrouver')
  })

  it('écran fermé ou interdit : ni lien, ni nom, ni raison, rien ne trahit son existence', () => {
    const wrapper = mountView(FICHE, known)
    const next = nextSection(wrapper)

    expect(next?.text()).not.toContain('Écran fermé')
    expect(next?.text()).not.toContain('Module fermé ou droit absent.')
    expect(next?.find('a[href="/patients"]').exists()).toBe(false)
    expect(next?.findAll('li')).toHaveLength(3)
  })

  it('écran qui demande le serveur : son nom en texte, « (demande le serveur) », sans lien', () => {
    const next = nextSection(mountView(FICHE, known))

    expect(next?.find('a[href="/ventes"]').exists()).toBe(false)
    const item = next?.findAll('li').find((entry) => entry.text().includes('Écran du serveur'))
    expect(item?.text()).toContain('Écran du serveur')
    expect(item?.text()).toContain('(demande le serveur)')
    expect(item?.text()).toContain('Le poste ne le connaît pas.')
    expect(item?.find('a').exists()).toBe(false)
  })

  it('une rubrique de la documentation reste toujours proposée : elle ne dépend pas du compte', () => {
    const asked: string[] = []
    const wrapper = mountView(FICHE, (route) => {
      asked.push(route)
      return 'hidden'
    })

    const topic = nextSection(wrapper)?.find('a[href="/aide#/parcours-accueillir"]')
    expect(topic?.text()).toBe('Accueillir un patient')
    // L'état n'est demandé que pour les écrans, jamais pour une rubrique.
    expect(asked).not.toContain('parcours-accueillir')
    expect(new Set(asked)).toEqual(new Set(['libre', 'ventes', 'patients']))
  })

  it('sans état fourni, tous les écrans sont proposés comme avant', () => {
    const next = nextSection(mountView(FICHE))

    expect(next?.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/libre',
      '/ventes',
      '/patients',
      '/aide#/parcours-accueillir',
    ])
    expect(next?.text()).not.toContain('(demande le serveur)')
  })

  it('tous les écrans cités fermés : la rubrique « Ensuite » disparaît', () => {
    const help: PageHelp = {
      ...FICHE,
      next: [
        { route: 'patients', label: 'Écran fermé' },
        { route: 'inconnue', label: 'Écran absent' },
      ],
    }
    const wrapper = mountView(help, known)

    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['Vous êtes ici'])
    expect(wrapper.text()).not.toContain('Écran fermé')
  })

  it('un écran à la fois ouvert et fermé ailleurs : seul l’état du compte décide', () => {
    // Même fiche, deux comptes : la fiche n'est jamais plus bavarde que l'écran.
    const closed = nextSection(mountView(FICHE, () => 'hidden'))
    const open = nextSection(mountView(FICHE, () => 'open'))

    expect(closed?.findAll('li')).toHaveLength(1)
    expect(open?.findAll('li')).toHaveLength(4)
  })

  it('suit le changement d’état sans remonter la fiche (calcul réactif)', async () => {
    const reachable = ref(false)
    const wrapper = mountView(FICHE, (route) =>
      route === 'libre' && reachable.value ? 'open' : known(route) === 'open' ? 'server' : 'hidden',
    )
    expect(nextSection(wrapper)?.find('a[href="/libre"]').exists()).toBe(false)
    expect(nextSection(wrapper)?.text()).toContain('(demande le serveur)')

    reachable.value = true
    await nextTick()
    await flushPromises()

    expect(nextSection(wrapper)?.find('a[href="/libre"]').exists()).toBe(true)
  })

  it('un lien ouvert émet navigate au clic, un écran qui demande le serveur n’a rien à cliquer', async () => {
    const wrapper = mountView(FICHE, known)
    const next = nextSection(wrapper)

    await next?.get('a[href="/libre"]').trigger('click')
    expect(wrapper.emitted('navigate')).toHaveLength(1)

    const item = next?.findAll('li').find((entry) => entry.text().includes('Écran du serveur'))
    await item?.trigger('click')
    expect(wrapper.emitted('navigate')).toHaveLength(1)
  })

  it('ne produit aucun avertissement Vue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mountView(FICHE, known)
    await flushPromises()

    expect(warn).not.toHaveBeenCalled()
  })
})

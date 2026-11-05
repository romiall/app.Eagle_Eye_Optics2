import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEeoApp } from '@/app/bootstrap'
import { resetNetworkForTests } from '@/app/network'
import { adoptLocalAccount, refreshSession, resetSessionForTests } from '@/app/session'
import HelpLauncher from '@/components/help/HelpLauncher.vue'
import type { PageHelp } from '@/domain/help/model'

import { meResponse, stubServer } from '../shell/server'

/**
 * Bouton « Aide » de l'en-tête et son panneau (`HelpLauncher`, docs/implementation/help.md) : ouverture et
 * fermeture, focus, Échap, raccourci ?, chargement à la demande (attente, erreur, reprise), fiche suivie selon
 * la route et filtrée par les droits, recherche dans la documentation, lien « Toute la documentation », session
 * locale. Le contenu (`@/domain/help/loader`) est remplacé par des fiches FICTIVES : ce test mesure le panneau,
 * pas la rédaction. Le navigateur réel (focus rendu, touche ?, 360 px, vraie politique de sécurité) est mesuré
 * par tests/e2e/help.spec.ts ; jsdom n'a ni `showModal` ni mise en page, donc la boîte s'y ouvre par l'attribut
 * `open` (le repli de `ConfirmDialog`) et le chemin natif est essayé avec des doubles de `showModal` et `close`.
 */
const loader = vi.hoisted(() => ({ loadPageHelp: vi.fn(), loadHandbook: vi.fn() }))
vi.mock('@/domain/help/loader', () => loader)

const FICHE_ACCUEIL: PageHelp = {
  route: 'accueil',
  title: 'Accueil de l’exemple',
  module: null,
  anyPermission: [],
  purpose: 'Le point de départ de l’exemple.',
  actions: [],
  tasks: [],
  rules: [],
  next: [
    { route: 'patients', label: 'Chercher un patient', why: 'Pour retrouver une fiche.' },
    { topic: 'bienvenue', label: 'Bienvenue' },
  ],
}

const FICHE_PATIENTS: PageHelp = {
  route: 'patients',
  title: 'Patients de l’exemple',
  module: 'patients',
  anyPermission: ['patient.read'],
  purpose: 'Retrouvez une fiche avec « Rechercher ».',
  actions: [
    { label: 'Rechercher', effect: 'Affiche les fiches qui correspondent.' },
    {
      label: 'Nouveau patient',
      effect: 'Ouvre le formulaire de création.',
      anyPermission: ['patient.create'],
    },
  ],
  tasks: [
    {
      id: 'retrouver',
      title: 'Retrouver une fiche',
      steps: ['Saisissez un nom.', 'Cliquez sur « Rechercher ».'],
      result: 'La fiche s’ouvre.',
    },
    {
      id: 'creer',
      title: 'Créer une fiche',
      anyPermission: ['patient.create'],
      steps: ['Cliquez sur « Nouveau patient ».'],
    },
  ],
  rules: ['La recherche part à 2 caractères.'],
  next: [
    { route: 'arrivee', label: 'Enregistrer une arrivée', why: 'Quand le patient est là.' },
    { route: 'stock', label: 'Voir le stock', why: 'Pour les montures.' },
    { topic: 'parcours-accueillir', label: 'Accueillir un patient' },
  ],
  terms: ['Numéro de dossier'],
}

const FICHE_ARRIVEE: PageHelp = {
  route: 'arrivee',
  title: 'Arrivée de l’exemple',
  module: 'today',
  anyPermission: ['visit.register'],
  purpose: 'Enregistrez l’arrivée du patient.',
  actions: [],
  tasks: [],
  rules: [],
  next: [],
}

const FICHES: readonly PageHelp[] = [FICHE_ACCUEIL, FICHE_PATIENTS, FICHE_ARRIVEE]
const PAGES = {
  PAGE_HELP: FICHES,
  pageHelpFor: (route: unknown): PageHelp | undefined =>
    typeof route === 'string' ? FICHES.find((fiche) => fiche.route === route) : undefined,
}

const SCREEN = { render: () => null }

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        name: 'accueil',
        component: SCREEN,
        meta: { title: 'Accueil', offlineCapable: true },
      },
      {
        path: '/patients',
        name: 'patients',
        component: SCREEN,
        meta: { title: 'Patients', permissions: ['patient.read'], module: 'patients' },
      },
      {
        path: '/arrivee',
        name: 'arrivee',
        component: SCREEN,
        meta: { title: 'Arrivée', permissions: ['visit.register'], module: 'today' },
      },
      {
        path: '/stock',
        name: 'stock',
        component: SCREEN,
        meta: { title: 'Stock', permissions: ['stock.read'], module: 'stock' },
      },
      {
        path: '/sans-fiche',
        name: 'sans-fiche',
        component: SCREEN,
        meta: { title: 'Écran sans fiche', offlineCapable: true },
      },
      {
        path: '/aide',
        name: 'aide',
        component: SCREEN,
        meta: { title: 'Documentation', offlineCapable: true },
      },
    ],
  })
}

/** Page d'hôte : des champs de saisie de toutes sortes, un bouton ailleurs, et le lanceur. */
const Host = defineComponent({
  setup: () => () =>
    h('div', [
      h('input', { id: 'champ', type: 'text' }),
      h('textarea', { id: 'zone' }),
      h('select', { id: 'liste' }, [h('option', 'A')]),
      h('div', { id: 'editable', contenteditable: 'true', tabindex: 0 }),
      h('div', { id: 'verrouille', contenteditable: 'false', tabindex: 0 }),
      h('button', { id: 'ailleurs', type: 'button' }, 'Ailleurs'),
      h(HelpLauncher),
    ]),
})

const wrappers: VueWrapper[] = []
const MODULES = ['patients', 'today']
const RECEPTION = ['patient.read', 'patient.create', 'visit.register']
const READER = ['patient.read']

async function signInAs(
  permissions: readonly string[],
  modules: readonly string[] = MODULES,
): Promise<void> {
  stubServer({ me: meResponse([...permissions], 'Compte Fictif', [...modules]) })
  await refreshSession()
}

async function mountLauncher(path = '/patients'): Promise<Router> {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  wrappers.push(mount(Host, { attachTo: document.body, global: { plugins: [router] } }))
  await flushPromises()
  return router
}

beforeEach(async () => {
  loader.loadPageHelp.mockResolvedValue(PAGES)
  await signInAs(RECEPTION)
})

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  resetSessionForTests()
  resetNetworkForTests()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  document.body.innerHTML = ''
})

// --- Lecture du DOM -------------------------------------------------------------------------------

function query<T extends Element>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`« ${selector} » introuvable`)
  return found
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
const PANEL = 'dialog[data-help-panel]'
const panel = (): HTMLDialogElement => query<HTMLDialogElement>(PANEL)
/** Le panneau n'existe qu'après la première demande : fermé = absent, ou présent sans l'attribut `open`. */
const isOpen = (): boolean => document.querySelector(PANEL)?.hasAttribute('open') ?? false
const panelText = (): string => squash(panel().textContent)
const panelTitle = (): string => squash(query('h2', panel()).textContent)
const headings = (): string[] =>
  [...panel().querySelectorAll('h3')].map((heading) => squash(heading.textContent))

function buttonNamed(name: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (button) => squash(button.textContent) === name,
  )
  if (found === undefined) throw new Error(`Bouton « ${name} » introuvable`)
  return found
}

const aide = (): HTMLButtonElement => buttonNamed('Aide')

function linkTo(href: string): HTMLAnchorElement {
  return query<HTMLAnchorElement>(`a[href="${href}"]`, panel())
}

async function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  await flushPromises()
  return event
}

async function openPanel(): Promise<void> {
  aide().click()
  await flushPromises()
}

async function closeWithEscape(): Promise<Event> {
  const cancel = new Event('cancel', { cancelable: true })
  panel().dispatchEvent(cancel)
  await flushPromises()
  return cancel
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

const searchInput = (): HTMLInputElement => query<HTMLInputElement>('input[type="search"]', panel())

// --- Le bouton ------------------------------------------------------------------------------------

describe('le bouton « Aide » de l’en-tête', () => {
  it('est un bouton discret qui annonce une boîte de dialogue et son raccourci', async () => {
    await mountLauncher()
    const button = aide()

    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-keyshortcuts')).toBe('?')
    // Même gabarit que « Se déconnecter » : bouton discret de 44 px, icône décorative devant le libellé.
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('bg-transparent')
    expect(squash(button.textContent)).toBe('Aide')
    expect(query('svg', button).getAttribute('aria-hidden')).toBe('true')
  })

  it('reste fermé tant qu’on ne le demande pas : rien dans la boîte, rien chargé', async () => {
    await mountLauncher()

    expect(isOpen()).toBe(false)
    // Aucune boîte dans le document : un écran qui cherche la sienne ne tombe jamais sur celle de l'en-tête.
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('Vous êtes ici')
    expect(document.body.textContent).not.toContain('Chargement')
    expect(loader.loadPageHelp).not.toHaveBeenCalled()
  })

  it('n’utilise aucun stockage du navigateur', async () => {
    await mountLauncher()
    await openPanel()
    await closeWithEscape()
    await openPanel()

    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})

// --- Ouverture et fermeture -----------------------------------------------------------------------

describe('ouverture et fermeture du panneau', () => {
  it('un clic ouvre le panneau : dialogue « Aide de cette page », titre et fiche de l’écran', async () => {
    await mountLauncher()
    await openPanel()

    expect(isOpen()).toBe(true)
    expect(aide().getAttribute('aria-expanded')).toBe('true')
    // Nom du dialogue : la petite ligne d'en-tête, pas le titre de la fiche.
    const name = query(`[id="${panel().getAttribute('aria-labelledby') ?? ''}"]`, panel())
    expect(squash(name.textContent)).toBe('Aide de cette page')
    expect(panelTitle()).toBe('Patients de l’exemple')
    expect(headings()).toEqual([
      'Vous êtes ici',
      'Ce que vous pouvez faire ici',
      'Pas à pas',
      'Comment ça marche',
      'Ensuite',
      'Mots utiles',
    ])
    expect(panelText()).toContain('Retrouvez une fiche avec « Rechercher ».')
  })

  it('le titre de la fiche est un titre de niveau 2, les rubriques sont de niveau 3', async () => {
    await mountLauncher()
    await openPanel()

    expect(panel().querySelectorAll('h2')).toHaveLength(1)
    expect(panel().querySelectorAll('h1')).toHaveLength(0)
    expect(headings()).toContain('Vous êtes ici')
  })

  it('le focus va sur le titre de la fiche à l’ouverture et revient au bouton à la fermeture', async () => {
    await mountLauncher()
    await openPanel()

    expect(document.activeElement).toBe(query('h2', panel()))
    expect(query('h2', panel()).getAttribute('tabindex')).toBe('-1')

    buttonNamed('Fermer', panel()).click()
    await flushPromises()

    expect(isOpen()).toBe(false)
    expect(aide().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(aide())
    expect(panel().querySelector('*')).toBeNull()
  })

  it('Échap ferme le panneau (fermeture native reprise) et rend le focus au bouton', async () => {
    await mountLauncher()
    await openPanel()

    const cancel = await closeWithEscape()

    expect(cancel.defaultPrevented).toBe(true)
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(aide())
  })

  it('une fermeture sans « cancel » annulable (Échap répété) tient l’état et le focus à jour', async () => {
    await mountLauncher()
    await openPanel()

    panel().removeAttribute('open')
    panel().dispatchEvent(new Event('close'))
    await flushPromises()

    expect(aide().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(aide())
    expect(panel().querySelector('*')).toBeNull()
  })

  it('l’événement « close » d’une fermeture précédente n’éteint pas le panneau rouvert entre-temps', async () => {
    await mountLauncher()
    await openPanel()
    await closeWithEscape()
    await openPanel()
    expect(isOpen()).toBe(true)

    // Le navigateur livre « close » APRÈS la fermeture : la boîte est déjà rouverte.
    panel().dispatchEvent(new Event('close'))
    await flushPromises()

    expect(isOpen()).toBe(true)
    expect(aide().getAttribute('aria-expanded')).toBe('true')
    expect(panelTitle()).toBe('Patients de l’exemple')
  })

  it('se rouvre autant de fois qu’on veut, sans recharger le contenu', async () => {
    await mountLauncher()
    for (let time = 0; time < 3; time += 1) {
      await openPanel()
      expect(isOpen()).toBe(true)
      expect(panelTitle()).toBe('Patients de l’exemple')
      await closeWithEscape()
      expect(isOpen()).toBe(false)
    }

    expect(loader.loadPageHelp).toHaveBeenCalledTimes(1)
  })

  it('essaie la boîte native : showModal à l’ouverture, close à la fermeture', async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: showModal,
      configurable: true,
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      value: close,
      configurable: true,
    })
    await mountLauncher()

    await openPanel()
    expect(showModal).toHaveBeenCalledOnce()
    expect(isOpen()).toBe(true)

    buttonNamed('Fermer', panel()).click()
    await flushPromises()
    expect(close).toHaveBeenCalledOnce()
    expect(isOpen()).toBe(false)
    expect(aide().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(aide())
  })

  it('si showModal échoue, le panneau s’ouvre quand même', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: () => {
        throw new DOMException('Déjà ouverte', 'InvalidStateError')
      },
      configurable: true,
    })
    await mountLauncher()

    await openPanel()

    expect(isOpen()).toBe(true)
    expect(panelTitle()).toBe('Patients de l’exemple')
  })

  describe('clic sur le fond', () => {
    it('ferme le panneau quand le geste commence et finit sur le fond', async () => {
      await mountLauncher()
      await openPanel()

      panel().dispatchEvent(new Event('pointerdown', { bubbles: true }))
      panel().click()
      await flushPromises()

      expect(isOpen()).toBe(false)
      expect(document.activeElement).toBe(aide())
    })

    it('ne ferme pas le panneau pour un clic dans son contenu', async () => {
      await mountLauncher()
      await openPanel()
      const inside = query<HTMLElement>('h2', panel())

      inside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      inside.click()
      await flushPromises()

      expect(isOpen()).toBe(true)
    })

    it('ne ferme pas le panneau quand une sélection commencée dedans finit sur le fond', async () => {
      await mountLauncher()
      await openPanel()

      query('h2', panel()).dispatchEvent(new Event('pointerdown', { bubbles: true }))
      panel().click()
      await flushPromises()

      expect(isOpen()).toBe(true)
    })

    it('ne ferme pas le panneau pour un clic qui n’a pas commencé sur le fond', async () => {
      await mountLauncher()
      await openPanel()

      panel().click()
      await flushPromises()

      expect(isOpen()).toBe(true)
    })
  })
})

// --- La touche ? ----------------------------------------------------------------------------------

describe('la touche ?', () => {
  it('ouvre le panneau hors d’un champ de saisie, puis le ferme', async () => {
    await mountLauncher()

    const opening = await press('?')
    expect(opening.defaultPrevented).toBe(true)
    expect(isOpen()).toBe(true)
    expect(panelTitle()).toBe('Patients de l’exemple')
    expect(aide().getAttribute('aria-expanded')).toBe('true')

    await press('?')
    expect(isOpen()).toBe(false)
    expect(aide().getAttribute('aria-expanded')).toBe('false')
  })

  it('s’écrit avec Maj sur la plupart des claviers : Maj ne l’empêche pas', async () => {
    await mountLauncher()

    await press('?', { shiftKey: true })

    expect(isOpen()).toBe(true)
  })

  it.each([
    ['un champ de texte', '#champ'],
    ['une zone de texte', '#zone'],
    ['une liste', '#liste'],
    ['une zone modifiable', '#editable'],
  ])('ne fait rien dans %s : le caractère reste à saisir', async (_name, selector) => {
    await mountLauncher()
    const target = query<HTMLElement>(selector)
    target.focus()

    const event = await press('?', {}, target)

    expect(event.defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
    expect(loader.loadPageHelp).not.toHaveBeenCalled()
  })

  it('ne fait rien dans un champ qui contient un sous-élément (zone modifiable imbriquée)', async () => {
    await mountLauncher()
    const nested = document.createElement('span')
    query('#editable').append(nested)

    await press('?', {}, nested)

    expect(isOpen()).toBe(false)
  })

  it('ne fait rien dans le champ de recherche du panneau lui-même', async () => {
    await mountLauncher()
    await openPanel()
    const field = searchInput()
    field.focus()

    await press('?', {}, field)

    expect(isOpen()).toBe(true)
  })

  it('ouvre l’aide depuis un élément qui n’est pas un champ, même focalisé (bouton, zone non modifiable)', async () => {
    await mountLauncher()

    for (const selector of ['#ailleurs', '#verrouille']) {
      query<HTMLElement>(selector).focus()
      await press('?', {}, query(selector))
      expect(isOpen(), selector).toBe(true)
      await closeWithEscape()
    }
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd ou Windows', { metaKey: true }],
  ])('ne fait rien avec %s enfoncée', async (_name, modifier) => {
    await mountLauncher()

    const event = await press('?', modifier)

    expect(event.defaultPrevented).toBe(false)
    expect(isOpen()).toBe(false)
  })

  it.each(['!', '/', 'a', 'Escape', 'F1'])('ne fait rien pour la touche « %s »', async (key) => {
    await mountLauncher()

    await press(key)

    expect(isOpen()).toBe(false)
  })

  it('ne fait rien pour une touche maintenue enfoncée, ni pendant une composition de texte', async () => {
    await mountLauncher()

    await press('?', { repeat: true })
    await press('?', { isComposing: true })

    expect(isOpen()).toBe(false)
  })

  it('ne fait rien quand un autre écouteur a déjà pris la touche (événement annulé)', async () => {
    await mountLauncher()
    const taken = (event: Event): void => event.preventDefault()
    document.body.addEventListener('keydown', taken)

    await press('?')
    document.body.removeEventListener('keydown', taken)

    expect(isOpen()).toBe(false)
  })

  it('ne s’ouvre pas par-dessus une autre boîte de dialogue (confirmation, reconnexion)', async () => {
    await mountLauncher()
    const other = document.createElement('dialog')
    other.setAttribute('open', '')
    document.body.append(other)

    await press('?')
    expect(isOpen()).toBe(false)

    other.removeAttribute('open')
    await press('?')
    expect(isOpen()).toBe(true)
  })

  it('rend le focus à l’élément qui l’avait quand la touche a ouvert l’aide', async () => {
    await mountLauncher()
    const elsewhere = query<HTMLButtonElement>('#ailleurs')
    elsewhere.focus()

    await press('?', {}, elsewhere)
    expect(document.activeElement).toBe(query('h2', panel()))
    await press('?')

    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(elsewhere)
  })

  it('rend le focus au bouton « Aide » quand rien n’avait le focus', async () => {
    await mountLauncher()
    expect(document.activeElement).toBe(document.body)

    await press('?')
    await closeWithEscape()

    expect(document.activeElement).toBe(aide())
  })

  it('se retrouve au bouton si l’élément qui avait le focus a disparu entre-temps', async () => {
    await mountLauncher()
    const elsewhere = query<HTMLButtonElement>('#ailleurs')
    elsewhere.focus()
    await press('?', {}, elsewhere)

    elsewhere.remove()
    await closeWithEscape()

    expect(document.activeElement).toBe(aide())
  })

  it('l’écouteur est retiré quand le bouton disparaît (déconnexion)', async () => {
    await mountLauncher()
    wrappers.pop()?.unmount()
    loader.loadPageHelp.mockClear()

    await press('?')

    expect(document.querySelector('dialog')).toBeNull()
    expect(loader.loadPageHelp).not.toHaveBeenCalled()
  })
})

// --- Chargement à la demande ----------------------------------------------------------------------

describe('chargement du contenu', () => {
  it('au premier clic seulement : attente annoncée, titre de l’écran déjà là, puis la fiche', async () => {
    let release: (value: unknown) => void = () => undefined
    loader.loadPageHelp.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await mountLauncher()
    expect(loader.loadPageHelp).not.toHaveBeenCalled()

    await openPanel()

    expect(loader.loadPageHelp).toHaveBeenCalledOnce()
    const status = query('[role="status"]', panel())
    expect(squash(status.textContent)).toBe('Chargement de l’aide…')
    expect(status.getAttribute('aria-live')).toBe('polite')
    // Le titre est celui de l'écran tant que la fiche n'est pas là, et le pied est déjà utilisable.
    expect(panelTitle()).toBe('Patients')
    expect(document.activeElement).toBe(query('h2', panel()))
    expect(searchInput()).not.toBeNull()
    expect(panelText()).toContain('Toute la documentation')

    release(PAGES)
    await flushPromises()

    expect(panel().querySelector('[role="status"]')).toBeNull()
    expect(panelTitle()).toBe('Patients de l’exemple')
    expect(headings()).toContain('Vous êtes ici')
    // Le focus reste sur le titre : le rendu de la fiche ne le déplace pas.
    expect(document.activeElement).toBe(query('h2', panel()))
  })

  it('une demande en cours n’est pas doublée par un nouvel appui', async () => {
    let release: (value: unknown) => void = () => undefined
    loader.loadPageHelp.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await mountLauncher()

    await openPanel()
    await closeWithEscape()
    await openPanel()
    expect(loader.loadPageHelp).toHaveBeenCalledOnce()

    release(PAGES)
    await flushPromises()
    expect(panelTitle()).toBe('Patients de l’exemple')
  })

  it('une erreur le dit et propose « Réessayer », qui charge puis affiche la fiche', async () => {
    loader.loadPageHelp.mockRejectedValueOnce(new Error('morceau introuvable'))
    await mountLauncher()

    await openPanel()

    expect(squash(query('[role="alert"]', panel()).textContent)).toBe(
      'L’aide n’a pas pu être chargée. Réessayez.',
    )
    expect(panelTitle()).toBe('Patients')
    expect(headings()).toEqual([])

    buttonNamed('Réessayer', panel()).click()
    await flushPromises()

    expect(loader.loadPageHelp).toHaveBeenCalledTimes(2)
    expect(panel().querySelector('[role="alert"]')).toBeNull()
    expect(panelTitle()).toBe('Patients de l’exemple')
    expect(headings()).toContain('Vous êtes ici')
  })

  it('une nouvelle erreur au nouvel essai reste dite, sans fiche', async () => {
    loader.loadPageHelp.mockRejectedValue(new Error('hors ligne'))
    await mountLauncher()
    await openPanel()

    buttonNamed('Réessayer', panel()).click()
    await flushPromises()

    expect(loader.loadPageHelp).toHaveBeenCalledTimes(2)
    expect(squash(query('[role="alert"]', panel()).textContent)).toContain(
      'n’a pas pu être chargée',
    )
    expect(headings()).toEqual([])
  })

  it('rouvrir le panneau après une erreur réessaie sans qu’on le demande', async () => {
    loader.loadPageHelp.mockRejectedValueOnce(new Error('morceau introuvable'))
    await mountLauncher()
    await openPanel()
    expect(query('[role="alert"]', panel())).not.toBeNull()
    await closeWithEscape()

    await openPanel()

    expect(loader.loadPageHelp).toHaveBeenCalledTimes(2)
    expect(panel().querySelector('[role="alert"]')).toBeNull()
    expect(panelTitle()).toBe('Patients de l’exemple')
  })

  it('même en erreur, la recherche et le lien vers la documentation restent proposés', async () => {
    loader.loadPageHelp.mockRejectedValue(new Error('hors ligne'))
    await mountLauncher()
    await openPanel()

    expect(searchInput()).not.toBeNull()
    expect(linkTo('/aide')).not.toBeNull()
  })
})

// --- La fiche selon l'écran et le compte ----------------------------------------------------------

describe('la fiche de l’écran en cours', () => {
  it('suit la route : un changement d’écran avec le panneau ouvert change la fiche', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()
    expect(panelTitle()).toBe('Patients de l’exemple')

    await router.push('/arrivee')
    await flushPromises()

    expect(isOpen()).toBe(true)
    expect(panelTitle()).toBe('Arrivée de l’exemple')
    expect(panelText()).toContain('Enregistrez l’arrivée du patient.')
    expect(panelText()).not.toContain('Retrouvez une fiche')
  })

  it('un écran sans fiche : le dit, avec les deux accès du pied', async () => {
    await mountLauncher('/sans-fiche')
    await openPanel()

    expect(panelTitle()).toBe('Écran sans fiche')
    expect(panelText()).toContain('Cet écran n’a pas encore de fiche d’aide.')
    expect(headings()).toEqual([])
    expect(searchInput()).not.toBeNull()
    expect(linkTo('/aide')).not.toBeNull()
    expect(panelText()).toContain('La touche ? ouvre cette aide.')
  })

  it('un écran sans titre ni fiche garde un titre lisible', async () => {
    const router = await mountLauncher('/')
    router.addRoute({ path: '/anonyme', name: 'anonyme', component: SCREEN })
    await router.push('/anonyme')
    await flushPromises()
    await openPanel()

    expect(panelTitle()).toBe('Cet écran')
    expect(panelText()).toContain('Cet écran n’a pas encore de fiche d’aide.')
  })

  describe('selon les droits du compte', () => {
    it('un compte qui peut créer voit l’action et la tâche de création, sans ligne de réserve', async () => {
      await mountLauncher('/patients')
      await openPanel()

      expect(panelText()).toContain('Nouveau patient')
      expect(panelText()).toContain('Créer une fiche')
      expect(panelText()).not.toContain('Des actions réservées à d’autres profils')
    })

    it('un compte en lecture seule ne les voit pas, et une ligne discrète le dit', async () => {
      resetSessionForTests()
      await signInAs(READER)
      await mountLauncher('/patients')
      await openPanel()

      expect(panelText()).toContain('Rechercher')
      expect(panelText()).toContain('Retrouver une fiche')
      expect(panelText()).not.toContain('Nouveau patient')
      expect(panelText()).not.toContain('Créer une fiche')
      expect(panelText()).toContain(
        'Des actions réservées à d’autres profils ne sont pas affichées.',
      )
    })

    it('suit un changement de droits sans rouvrir le panneau', async () => {
      resetSessionForTests()
      await signInAs(READER)
      await mountLauncher('/patients')
      await openPanel()
      expect(panelText()).not.toContain('Nouveau patient')

      await signInAs(RECEPTION)
      await flushPromises()

      expect(isOpen()).toBe(true)
      expect(panelText()).toContain('Nouveau patient')
    })

    it('propose les écrans cités que le compte peut ouvrir, et seulement ceux-là', async () => {
      await mountLauncher('/patients')
      await openPanel()

      // « Enregistrer une arrivée » : droit et module présents. « Voir le stock » : module fermé, droit absent.
      expect(linkTo('/arrivee')).not.toBeNull()
      expect(panelText()).toContain('Enregistrer une arrivée')
      expect(panelText()).toContain('Quand le patient est là.')
      expect(panelText()).not.toContain('Voir le stock')
      expect(panelText()).not.toContain('Pour les montures.')
      expect(panel().querySelector('a[href="/stock"]')).toBeNull()
      // Une rubrique de la documentation reste proposée.
      expect(linkTo('/aide#/parcours-accueillir')).not.toBeNull()
    })

    it('retire l’écran cité dont le compte n’a pas le droit', async () => {
      resetSessionForTests()
      await signInAs(READER)
      await mountLauncher('/patients')
      await openPanel()

      expect(panel().querySelector('a[href="/arrivee"]')).toBeNull()
      expect(panelText()).not.toContain('Enregistrer une arrivée')
      expect(panelText()).not.toContain('Quand le patient est là.')
    })

    it('retire l’écran cité dont le module est fermé, même avec le droit', async () => {
      resetSessionForTests()
      await signInAs(RECEPTION, ['patients'])
      await mountLauncher('/patients')
      await openPanel()

      expect(panel().querySelector('a[href="/arrivee"]')).toBeNull()
      expect(panelText()).not.toContain('Enregistrer une arrivée')
    })

    it('décrit les actions sans les proposer : ni bouton ni lien dans « Ce que vous pouvez faire ici »', async () => {
      await mountLauncher('/patients')
      await openPanel()

      const actions = [...panel().querySelectorAll('section')].find(
        (section) =>
          squash(section.querySelector('h3')?.textContent) === 'Ce que vous pouvez faire ici',
      )
      expect(actions).toBeDefined()
      expect(actions?.querySelectorAll('dt')).toHaveLength(2)
      expect(actions?.querySelector('button, a, input')).toBeNull()
      // L'aide n'appelle jamais le serveur ni la documentation globale pour décrire une fiche.
      expect(loader.loadHandbook).not.toHaveBeenCalled()
    })
  })

  describe('session locale (poste préparé, serveur non joint)', () => {
    beforeEach(() => {
      resetSessionForTests()
      adoptLocalAccount(meResponse([...RECEPTION], 'Profil local', ['offline', ...MODULES]).data)
    })

    it('s’ouvre sans toucher au serveur : le contenu vient du paquet de l’application', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await mountLauncher('/')

      await openPanel()
      await closeWithEscape()
      await openPanel()

      expect(isOpen()).toBe(true)
      expect(panelTitle()).toBe('Accueil de l’exemple')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('nomme sans lien l’écran qui demande le serveur, avec « (demande le serveur) »', async () => {
      await mountLauncher('/')
      await openPanel()

      expect(panel().querySelector('a[href="/patients"]')).toBeNull()
      expect(panelText()).toContain('Chercher un patient')
      expect(panelText()).toContain('(demande le serveur)')
      expect(panelText()).toContain('Pour retrouver une fiche.')
      // Une rubrique de la documentation est dans le paquet : elle reste un lien.
      expect(linkTo('/aide#/bienvenue')).not.toBeNull()
    })

    it('avec le serveur, le même écran est un vrai lien, sans mention', async () => {
      resetSessionForTests()
      await signInAs(RECEPTION)
      await mountLauncher('/')
      await openPanel()

      expect(linkTo('/patients')).not.toBeNull()
      expect(panelText()).not.toContain('(demande le serveur)')
    })

    it('le lien vers la documentation et la recherche restent ouverts : l’écran « Documentation » est prévu pour le poste', async () => {
      const router = await mountLauncher('/')
      await openPanel()

      expect(linkTo('/aide')).not.toBeNull()
      await typeInto(searchInput(), 'caisse')
      buttonNamed('Chercher', panel()).click()
      await flushPromises()

      expect(router.currentRoute.value.fullPath).toBe('/aide?q=caisse')
      expect(isOpen()).toBe(false)
    })
  })
})

// --- Liens de la fiche ----------------------------------------------------------------------------

describe('liens du panneau', () => {
  it('un lien interne cliqué ouvre l’écran et ferme le panneau', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    linkTo('/arrivee').click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('arrivee')
    expect(isOpen()).toBe(false)
    expect(aide().getAttribute('aria-expanded')).toBe('false')
  })

  it('un lien vers une rubrique de la documentation mène à l’écran Documentation, sur son ancre', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    linkTo('/aide#/parcours-accueillir').click()
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/aide#/parcours-accueillir')
    expect(isOpen()).toBe(false)
  })

  it('un mot utile mène au glossaire et ferme le panneau', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    linkTo('/aide#/glossaire-gestion').click()
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/aide#/glossaire-gestion')
    expect(isOpen()).toBe(false)
  })

  it('ouvrir un lien dans un autre onglet (Ctrl, Cmd, Maj) laisse le panneau en place', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    const link = linkTo('/arrivee')
    // jsdom ne navigue pas : le clic est neutralisé APRÈS les écouteurs du composant.
    link.addEventListener('click', (event) => event.preventDefault())
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifier }))
      await flushPromises()
    }

    expect(isOpen()).toBe(true)
    expect(router.currentRoute.value.name).toBe('patients')
  })

  describe('« Toute la documentation »', () => {
    it('ouvre l’écran Documentation et ferme le panneau', async () => {
      const router = await mountLauncher('/patients')
      await openPanel()

      const link = linkTo('/aide')
      expect(squash(link.textContent)).toBe('Toute la documentation')
      link.click()
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('aide')
      expect(router.currentRoute.value.fullPath).toBe('/aide')
      expect(isOpen()).toBe(false)
    })

    it('est aussi proposé quand on est déjà sur la documentation, et ferme le panneau', async () => {
      const router = await mountLauncher('/aide')
      await openPanel()

      linkTo('/aide').click()
      await flushPromises()

      expect(router.currentRoute.value.fullPath).toBe('/aide')
      expect(isOpen()).toBe(false)
    })

    it('ouvert dans un autre onglet (Ctrl), il laisse le panneau en place', async () => {
      await mountLauncher('/patients')
      await openPanel()

      const link = linkTo('/aide')
      link.addEventListener('click', (event) => event.preventDefault())
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
      )
      await flushPromises()

      expect(isOpen()).toBe(true)
    })
  })
})

// --- Recherche dans la documentation --------------------------------------------------------------

describe('recherche dans la documentation', () => {
  it('est un formulaire de recherche nommé, avec son champ et son bouton « Chercher »', async () => {
    await mountLauncher()
    await openPanel()

    const form = query<HTMLFormElement>('form[role="search"]', panel())
    expect(form.getAttribute('aria-label')).toBe('Chercher dans la documentation')
    const field = searchInput()
    const label = query<HTMLLabelElement>(`label[for="${field.id}"]`, form)
    expect(squash(label.textContent)).toBe('Chercher dans la documentation')
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(buttonNamed('Chercher', form).getAttribute('type')).toBe('submit')
    expect(field.value).toBe('')
  })

  it('ferme le panneau et ouvre la documentation sur les résultats', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    await typeInto(searchInput(), 'facture')
    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('aide')
    expect(router.currentRoute.value.query).toEqual({ q: 'facture' })
    expect(router.currentRoute.value.fullPath).toBe('/aide?q=facture')
    expect(isOpen()).toBe(false)
  })

  it('Entrée dans le champ lance la recherche', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    await typeInto(searchInput(), 'reçu')
    query<HTMLFormElement>('form[role="search"]', panel()).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ q: 'reçu' })
    expect(isOpen()).toBe(false)
  })

  it('garde les mots tels que saisis, espaces superflues retirées', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()

    await typeInto(searchInput(), '   Prise   de  RENDEZ-VOUS  ')
    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ q: 'Prise de RENDEZ-VOUS' })
  })

  it('une recherche vide est refusée avec un message, le panneau reste ouvert', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()
    const field = searchInput()

    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('patients')
    expect(isOpen()).toBe(true)
    const message = query('p[id$="-recherche-erreur"]', panel())
    expect(squash(message.textContent)).toContain(
      'Saisissez au moins 2 caractères pour lancer la recherche.',
    )
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe(message.id)
    expect(document.activeElement).toBe(field)
  })

  it.each([
    ['des espaces seulement', '    '],
    ['une seule lettre', 'a'],
    ['des mots d’une lettre', 'a b c'],
  ])('refuse aussi %s : la recherche ne trouverait rien', async (_name, text) => {
    const router = await mountLauncher('/patients')
    await openPanel()

    await typeInto(searchInput(), text)
    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('patients')
    expect(panelText()).toContain('Saisissez au moins 2 caractères')
  })

  it('le message disparaît dès que la recherche est valide', async () => {
    const router = await mountLauncher('/patients')
    await openPanel()
    buttonNamed('Chercher', panel()).click()
    await flushPromises()
    expect(panelText()).toContain('Saisissez au moins 2 caractères')

    await typeInto(searchInput(), 'ordonnance')
    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ q: 'ordonnance' })
    expect(isOpen()).toBe(false)
  })

  it('repart d’un champ vide et sans message à chaque ouverture', async () => {
    await mountLauncher('/patients')
    await openPanel()
    await typeInto(searchInput(), 'x')
    buttonNamed('Chercher', panel()).click()
    await flushPromises()
    expect(panelText()).toContain('Saisissez au moins 2 caractères')
    await closeWithEscape()

    await openPanel()

    expect(searchInput().value).toBe('')
    expect(panelText()).not.toContain('Saisissez au moins 2 caractères')
    expect(searchInput().getAttribute('aria-invalid')).toBeNull()
  })

  it('le texte cherché ne va que dans l’adresse de l’écran Documentation, jamais ailleurs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await mountLauncher('/patients')
    await openPanel()

    await typeInto(searchInput(), 'facture')
    buttonNamed('Chercher', panel()).click()
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})

// --- Dans la vraie coquille -----------------------------------------------------------------------

describe('dans la coquille de l’application (App.vue)', () => {
  async function mountShell(path: string) {
    stubServer({ me: meResponse([...RECEPTION], 'Gérante Fictive', [...MODULES]) })
    const { app, router } = createEeoApp(createMemoryHistory(), {
      navigation: { modules: [], homeActions: [] },
    })
    await router.push(path)
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    app.mount(root)
    await flushPromises()
    return { root, router, unmount: () => app.unmount() }
  }

  it('le lien « Aide » est devenu le bouton du panneau, à côté de « Se déconnecter »', async () => {
    const { root, unmount } = await mountShell('/')
    const header = query<HTMLElement>('header', root)

    expect(header.querySelector('a[href="/aide"]')).toBeNull()
    const buttons = [...header.querySelectorAll('button')].map((button) =>
      squash(button.textContent),
    )
    expect(buttons[buttons.indexOf('Aide') + 1]).toBe('Se déconnecter')
    const help = buttonNamed('Aide', header)
    expect(help.getAttribute('aria-haspopup')).toBe('dialog')
    expect(help.getAttribute('aria-keyshortcuts')).toBe('?')
    expect(help.className).toBe(buttonNamed('Se déconnecter', header).className)

    unmount()
  })

  it('ouvre la fiche de l’écran en cours, se ferme avec Échap et rend le focus au bouton', async () => {
    const { root, unmount } = await mountShell('/')

    buttonNamed('Aide', root).click()
    await flushPromises()
    const dialog = query<HTMLDialogElement>('header dialog', root)
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(squash(query('h2', dialog).textContent)).toBe('Accueil de l’exemple')

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    await flushPromises()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(buttonNamed('Aide', root))

    unmount()
  })

  it('un clic sur un lien du panneau change d’écran, ferme le panneau et laisse le focus au contenu', async () => {
    const { root, router, unmount } = await mountShell('/')
    buttonNamed('Aide', root).click()
    await flushPromises()
    const dialog = query<HTMLDialogElement>('header dialog', root)

    // « Chercher un patient » : l'écran cité par la fiche, ouvert à ce compte.
    query<HTMLAnchorElement>('a[href="/patients"]', dialog).click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('patients')
    expect(dialog.hasAttribute('open')).toBe(false)
    // Le routeur place le focus sur le contenu après chaque navigation (WCAG 2.4.3) : il garde le dernier mot.
    expect(document.activeElement?.id).toBe('contenu')

    unmount()
  })

  it('n’est pas montré sans compte connecté', async () => {
    resetSessionForTests()
    stubServer({ me: 'anonymous' })
    const { app, router } = createEeoApp(createMemoryHistory(), {
      navigation: { modules: [], homeActions: [] },
    })
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.append(root)
    app.mount(root)
    await flushPromises()

    expect(root.querySelector('dialog')).toBeNull()
    expect(
      [...root.querySelectorAll('button')].some((button) => squash(button.textContent) === 'Aide'),
    ).toBe(false)

    app.unmount()
  })
})

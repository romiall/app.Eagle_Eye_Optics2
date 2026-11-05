import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import HelpBlocks from '@/components/help/HelpBlocks.vue'
import HelpText from '@/components/help/HelpText.vue'
import PageHelpView from '@/components/help/PageHelpView.vue'
import type { HelpBlock, PageHelp } from '@/domain/help/model'

/**
 * Rendu de l'aide intégrée : les trois composants de `components/help/` (texte avec libellés d'écran,
 * blocs de la documentation, fiche d'un écran). Fiches et blocs FICTIFS passés en propriétés : ce test
 * vérifie la présentation et les règles d'affichage (ordre et titres des rubriques, droits, maturité,
 * liens, libellés en puces, blocs, absence d'interprétation HTML), pas la rédaction du vrai contenu.
 */
const wrappers: VueWrapper[] = []
function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount()
})

// Espace insécable (U+00A0), écrite par son code : écrite telle quelle, elle passerait pour une espace.
const NBSP = String.fromCharCode(0xa0)
/** Un libellé tel que la puce l'écrit : guillemets français collés par des espaces insécables. */
function chip(label: string): string {
  return `«${NBSP}${label}${NBSP}»`
}

const EMPTY_PAGE = { render: () => null }

async function makeRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'accueil', component: EMPTY_PAGE },
      { path: '/patients', name: 'patients', component: EMPTY_PAGE },
      { path: '/arrivee', name: 'arrivee', component: EMPTY_PAGE },
      { path: '/aide', name: 'aide', component: EMPTY_PAGE },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

const NO_RIGHT: readonly string[] = []
const CAN_CREATE: readonly string[] = ['patient.create']
const CAN_EVERYTHING: readonly string[] = ['patient.read', 'patient.create', 'patient.merge']

const TITLES = [
  'Vous êtes ici',
  'Ce que vous pouvez faire ici',
  'Pas à pas',
  'Comment ça marche',
  'Ensuite',
  'À savoir',
  'Si ça ne marche pas',
  'Mots utiles',
]

/** Fiche fictive complète : les huit rubriques, deux actions et deux tâches réservées à des droits. */
const FICHE: PageHelp = {
  route: 'exemple',
  title: 'Écran d’exemple',
  module: 'patients',
  anyPermission: ['patient.read'],
  purpose: 'Retrouvez une fiche avec « Rechercher » avant tout autre geste.',
  actions: [
    { label: 'Rechercher', effect: 'Affiche les fiches qui correspondent à « Nom ».' },
    {
      label: 'Nouveau patient',
      effect: 'Ouvre le formulaire de création.',
      anyPermission: ['patient.create'],
    },
    {
      label: 'Fusionner les fiches',
      effect: 'Réunit deux fiches en une seule.',
      anyPermission: ['patient.merge'],
    },
  ],
  tasks: [
    {
      id: 'retrouver',
      title: 'Retrouver une fiche',
      steps: [
        'Saisissez un nom dans « Nom ».',
        'Cliquez sur « Rechercher ».',
        'Ouvrez la fiche de la liste.',
      ],
      result: 'La fiche s’ouvre.',
    },
    {
      id: 'creer',
      title: 'Créer une fiche',
      anyPermission: ['patient.create'],
      steps: ['Cliquez sur « Nouveau patient ».', 'Remplissez le formulaire.'],
      result: 'La fiche est créée.',
    },
    {
      id: 'fusionner',
      title: 'Réunir deux fiches',
      anyPermission: ['patient.merge'],
      steps: ['Cliquez sur « Fusionner les fiches ».'],
    },
  ],
  rules: ['La recherche part à 2 caractères.', 'Rien n’est réuni automatiquement.'],
  next: [
    { route: 'patients', label: 'Patients', why: 'Pour retrouver « Nom ».' },
    { route: 'arrivee', label: 'Enregistrer une arrivée' },
    { topic: 'parcours-accueillir', label: 'Accueillir un patient', why: 'Le parcours complet.' },
  ],
  tips: ['Cherchez aussi par téléphone.', 'Le numéro de dossier figure sur les reçus.'],
  problems: [
    { symptom: '« Aucun résultat »', remedy: 'Vérifiez l’orthographe.' },
    { symptom: 'Un message rouge sous un champ', remedy: 'Corrigez le champ indiqué.' },
  ],
  terms: ['OD', 'Acuité visuelle', 'Numéro de dossier', 'Écart pupillaire'],
}

/** Fiche minimale : une seule rubrique à afficher, les autres sont vides. */
const FICHE_MINIMALE: PageHelp = {
  route: 'minimale',
  title: 'Écran minimal',
  module: null,
  anyPermission: [],
  purpose: 'Un écran sans rien d’autre.',
  actions: [],
  tasks: [],
  rules: [],
  next: [],
}

interface ViewOptions {
  level?: 2 | 3
  expandFirstTask?: boolean
}

async function mountView(
  help: PageHelp,
  permissions: readonly string[],
  options: ViewOptions = {},
): Promise<VueWrapper> {
  const router = await makeRouter()
  return track(
    mount(PageHelpView, {
      props: { help, permissions, ...options },
      global: { plugins: [router] },
    }),
  )
}

/** La rubrique dont le titre est exactement `title` (une `section` nommée par son titre). */
function sectionOf(wrapper: VueWrapper, title: string): DOMWrapper<Element> {
  const found = wrapper
    .findAll('section')
    .find((section) => section.find('h3, h2').text() === title)
  if (found === undefined) throw new Error(`Rubrique « ${title} » absente`)
  return found
}

const HOSTILE =
  '<img src=x onerror=alert(1)> <script>boom()</script> <b>gras</b> &amp; « <i>x</i> »'

/**
 * Monte `HelpText` dans un paragraphe d'hôte. Sa racine est un fragment : `text()` d'un test-utils
 * rogne chaque nœud racine l'un après l'autre et perdrait les espaces entre un libellé et le texte.
 */
function mountText(text: string): VueWrapper {
  return track(mount({ render: () => h('p', [h(HelpText, { text })]) }))
}

describe('HelpText : texte et libellés d’écran', () => {
  it('rend chaque libellé écrit « comme ceci » en puce, guillemets conservés et espaces insécables', () => {
    const wrapper = mountText('Cliquez sur « Enregistrer le patient » puis sur « Fermer ».')

    expect(wrapper.findAll('.help-label').map((label) => label.text())).toEqual([
      chip('Enregistrer le patient'),
      chip('Fermer'),
    ])
    // Le texte entre les puces reste tel quel, espaces comprises.
    expect(wrapper.text()).toBe(
      `Cliquez sur ${chip('Enregistrer le patient')} puis sur ${chip('Fermer')}.`,
    )
  })

  it('un texte sans libellé reste du texte simple', () => {
    const wrapper = mountText('Aucun libellé ici.')

    expect(wrapper.find('.help-label').exists()).toBe(false)
    expect(wrapper.text()).toBe('Aucun libellé ici.')
  })

  it('un guillemet jamais refermé n’est pas une puce', () => {
    const wrapper = mountText('Texte « ouvert sans fin')

    expect(wrapper.find('.help-label').exists()).toBe(false)
    expect(wrapper.text()).toBe('Texte « ouvert sans fin')
  })

  it('un texte vide ne rend rien', () => {
    const wrapper = mountText('')

    expect(wrapper.find('.help-label').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('n’ajoute aucun élément autour du texte : la racine est un fragment', () => {
    const wrapper = mountText('Avant « Libellé » après')
    const host = wrapper.element

    // Seuls comptent les nœuds visibles (Vue pose des repères de fragment vides).
    const nodes = (Array.from(host.childNodes) as ChildNode[]).filter(
      (node) => node.textContent !== '',
    )
    expect(nodes.map((node) => node.nodeName)).toEqual(['#text', 'SPAN', '#text'])
    expect(host.textContent).toBe(`Avant ${chip('Libellé')} après`)
    expect((nodes[1] as HTMLElement).className).toBe('help-label')
  })

  it('n’interprète jamais de HTML, ni dans le texte ni dans un libellé', () => {
    const wrapper = mountText(HOSTILE)

    expect(wrapper.find('img, script, b, i').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)> <script>boom()</script>')
    // Une entité reste écrite telle quelle : elle n'est pas décodée.
    expect(wrapper.text()).toContain('&amp;')
    expect(wrapper.get('.help-label').text()).toBe(chip('<i>x</i>'))
  })
})

describe('HelpBlocks : un rendu par type de bloc', () => {
  async function mountBlocks(blocks: readonly HelpBlock[], level?: 3 | 4): Promise<VueWrapper> {
    return track(
      mount(HelpBlocks, {
        props: level === undefined ? { blocks } : { blocks, level },
      }),
    )
  }

  it('étapes : liste numérotée à pastilles dorées, libellés en puces, titre de niveau 3', async () => {
    const wrapper = await mountBlocks([
      {
        kind: 'steps',
        title: 'Pour créer une fiche',
        items: ['Cliquez sur « Enregistrer ».', 'Relisez la fiche.'],
      },
    ])

    expect(wrapper.get('h3').text()).toBe('Pour créer une fiche')
    const list = wrapper.get('ol')
    expect(list.attributes('role')).toBe('list')
    const items = list.findAll('li')
    expect(items).toHaveLength(2)
    const badges = items.map((item) => item.get('span'))
    expect(badges.map((badge) => badge.text())).toEqual(['1', '2'])
    expect(badges.every((badge) => badge.attributes('aria-hidden') === 'true')).toBe(true)
    expect(badges[0]?.classes()).toEqual(
      expect.arrayContaining(['rounded-full', 'bg-gold-soft', 'text-gold-ink']),
    )
    expect(items[0]?.get('.help-label').text()).toBe(chip('Enregistrer'))
  })

  it('le niveau des titres de bloc est réglable (4 sous un titre de niveau 3)', async () => {
    const wrapper = await mountBlocks(
      [
        { kind: 'steps', title: 'Étapes', items: ['Une étape.'] },
        { kind: 'points', title: 'Points', items: ['Un point.'] },
        { kind: 'faq', title: 'Questions', items: [{ q: 'Pourquoi ?', a: 'Parce que.' }] },
        { kind: 'terms', title: 'Mots', items: [{ term: 'OD', definition: 'Œil droit.' }] },
        { kind: 'flow', title: 'Chemin', stages: [{ label: 'Accueil', text: 'Premier pas.' }] },
      ],
      4,
    )

    expect(wrapper.findAll('h4').map((heading) => heading.text())).toEqual([
      'Étapes',
      'Points',
      'Questions',
      'Mots',
      'Chemin',
    ])
    expect(wrapper.find('h3').exists()).toBe(false)
  })

  it('puces : liste sans numéro, puces dorées décoratives', async () => {
    const wrapper = await mountBlocks([
      { kind: 'points', items: ['Premier point.', 'Second point avec « Libellé ».'] },
    ])

    expect(wrapper.find('h3').exists()).toBe(false)
    const items = wrapper.get('ul').findAll('li')
    expect(wrapper.get('ul').attributes('role')).toBe('list')
    expect(items.map((item) => item.text())).toEqual([
      'Premier point.',
      `Second point avec ${chip('Libellé')}.`,
    ])
    const bullet = items[0]?.get('span')
    expect(bullet?.attributes('aria-hidden')).toBe('true')
    expect(bullet?.classes()).toContain('bg-gold')
  })

  it('notes : le fond ET le symbole changent avec le ton, et le ton est lu aux lecteurs d’écran', async () => {
    const wrapper = await mountBlocks([
      { kind: 'note', tone: 'info', text: 'Une information.' },
      { kind: 'note', tone: 'warning', text: 'Un avertissement.' },
      { kind: 'note', tone: 'tip', text: 'Un conseil.' },
      { kind: 'note', text: 'Une note sans ton.' },
    ])
    const notes = wrapper.findAll('[role="note"]')
    expect(notes).toHaveLength(4)
    const [info, warning, tip, untoned] = notes
    if (info === undefined || warning === undefined || tip === undefined || untoned === undefined)
      throw new Error('Quatre notes attendues')

    expect(info.classes()).toContain('bg-primary-soft')
    expect(warning.classes()).toContain('bg-warning-soft')
    expect(tip.classes()).toContain('bg-accent-soft')
    // Sans ton, la note est une information.
    expect(untoned.classes()).toContain('bg-primary-soft')

    // Jamais la couleur seule : le tracé du symbole diffère d'un ton à l'autre.
    const symbol = (note: DOMWrapper<Element>): string =>
      note
        .findAll('svg path')
        .map((path) => path.attributes('d'))
        .join('|')
    const symbols = [info, warning, tip].map(symbol)
    expect(new Set(symbols).size).toBe(3)
    expect(symbol(untoned)).toBe(symbol(info))
    for (const note of notes) expect(note.get('svg').attributes('aria-hidden')).toBe('true')

    // Le mot du ton est lu à voix haute (masqué à l'écran), avant le texte de la note.
    expect(info.get('.sr-only').text()).toBe('Information :')
    expect(warning.get('.sr-only').text()).toBe('Attention :')
    expect(tip.get('.sr-only').text()).toBe('Conseil :')
    expect(warning.text()).toBe('Attention : Un avertissement.')
  })

  it('enchaînement : une liste d’étapes reliées, en colonnes selon leur nombre', async () => {
    const stage = (label: string) => ({ label, text: `Ce qui se passe à « ${label} ».` })
    const wrapper = await mountBlocks([
      { kind: 'flow', title: 'Le chemin', stages: ['Accueil', 'Examen', 'Vente'].map(stage) },
      { kind: 'flow', stages: ['A', 'B', 'C', 'D'].map(stage) },
      { kind: 'flow', stages: ['A', 'B', 'C', 'D', 'E'].map(stage) },
      { kind: 'flow', stages: ['A', 'B'].map(stage) },
    ])

    expect(wrapper.get('h3').text()).toBe('Le chemin')
    const lists = wrapper.findAll('ol')
    expect(lists.map((list) => list.attributes('role'))).toEqual(['list', 'list', 'list', 'list'])
    expect(lists.map((list) => list.findAll(':scope > li').length)).toEqual([3, 4, 5, 2])
    // Colonnes quand le cadre est large : 3, 2 × 2 pour quatre étapes, 3 au plus, 2.
    expect(
      lists.map((list) => (list.element as HTMLElement).style.getPropertyValue('--flow-columns')),
    ).toEqual(['3', '2', '3', '2'])

    // Chaque étape : sa pastille numérotée, son nom, son texte (libellés en puces).
    const first = lists[0]?.findAll(':scope > li')[1]
    expect(first?.text()).toContain('2')
    expect(first?.text()).toContain('Examen')
    expect(first?.get('.help-label').text()).toBe(chip('Examen'))

    // Flèches : vers le bas entre deux étapes (cadre étroit), vers la droite dans une rangée seulement.
    const arrows = (list: DOMWrapper<Element>) => {
      const items = list.findAll(':scope > li')
      return {
        down: items.filter((item) =>
          item.findAll('svg').some((svg) => svg.classes().includes('@xl:hidden')),
        ).length,
        right: items.map((item) =>
          item.findAll('svg').some((svg) => svg.classes().includes('@xl:block')),
        ),
      }
    }
    expect(arrows(lists[0] as DOMWrapper<Element>)).toEqual({ down: 2, right: [true, true, false] })
    expect(arrows(lists[1] as DOMWrapper<Element>)).toEqual({
      down: 3,
      right: [true, false, true, false],
    })
    expect(arrows(lists[2] as DOMWrapper<Element>)).toEqual({
      down: 4,
      right: [true, true, false, true, false],
    })
    expect(arrows(lists[3] as DOMWrapper<Element>)).toEqual({ down: 1, right: [true, false] })
  })

  it('tableau : légende, en-têtes de colonne et de ligne, cadre défilant atteignable au clavier', async () => {
    const wrapper = await mountBlocks([
      {
        kind: 'table',
        title: 'Qui fait quoi',
        head: ['Profil', 'Peut faire'],
        rows: [
          ['Accueil', 'Créer une fiche avec « Nouveau patient »'],
          ['Caisse', 'Encaisser'],
        ],
      },
    ])

    const frame = wrapper.get('.data-table-wrap')
    expect(frame.attributes('role')).toBe('region')
    expect(frame.attributes('tabindex')).toBe('0')
    const caption = wrapper.get('caption')
    expect(caption.text()).toBe('Qui fait quoi')
    expect(frame.attributes('aria-labelledby')).toBe(caption.attributes('id'))
    expect(frame.attributes('aria-label')).toBeUndefined()

    const heads = wrapper.findAll('thead th')
    expect(heads.map((cell) => cell.text())).toEqual(['Profil', 'Peut faire'])
    expect(heads.every((cell) => cell.attributes('scope') === 'col')).toBe(true)

    const rowHeads = wrapper.findAll('tbody th')
    expect(rowHeads.map((cell) => cell.text())).toEqual(['Accueil', 'Caisse'])
    expect(rowHeads.every((cell) => cell.attributes('scope') === 'row')).toBe(true)
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual([
      `Créer une fiche avec ${chip('Nouveau patient')}`,
      'Encaisser',
    ])
    expect(wrapper.get('table').classes()).toContain('data-table')
  })

  it('tableau sans titre : pas de légende, mais le cadre défilant garde un nom', async () => {
    const wrapper = await mountBlocks([
      { kind: 'table', head: ['A', 'B'], rows: [['1', '2', '3'], ['4']] },
    ])

    expect(wrapper.find('caption').exists()).toBe(false)
    const frame = wrapper.get('.data-table-wrap')
    expect(frame.attributes('aria-label')).toBe('Tableau')
    expect(frame.attributes('aria-labelledby')).toBeUndefined()
    // Une ligne plus longue ou plus courte que l'en-tête s'affiche sans erreur.
    expect(wrapper.findAll('tbody tr').map((row) => row.findAll('th, td').length)).toEqual([3, 1])
  })

  it('deux tableaux ont chacun leur légende et leur identifiant', async () => {
    const wrapper = await mountBlocks([
      { kind: 'table', title: 'Premier', head: ['A'], rows: [['1']] },
      { kind: 'table', title: 'Second', head: ['B'], rows: [['2']] },
    ])
    const ids = wrapper.findAll('caption').map((caption) => caption.attributes('id'))

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(
      wrapper.findAll('.data-table-wrap').map((frame) => frame.attributes('aria-labelledby')),
    ).toEqual(ids)
  })

  it('questions fréquentes : une question fermée par défaut, la réponse dessous', async () => {
    const wrapper = await mountBlocks([
      {
        kind: 'faq',
        title: 'Questions fréquentes',
        items: [
          { q: 'Où est « Rechercher » ?', a: 'En haut de l’écran.' },
          { q: 'Et le reste ?', a: 'Plus bas.' },
        ],
      },
    ])

    expect(wrapper.get('h3').text()).toBe('Questions fréquentes')
    const questions = wrapper.findAll('details')
    expect(questions).toHaveLength(2)
    expect(questions.every((question) => question.attributes('open') === undefined)).toBe(true)
    expect(questions[0]?.get('summary').text()).toBe(`Où est ${chip('Rechercher')} ?`)
    expect(questions[0]?.get('summary').classes()).toContain('min-h-11')
    expect(questions[0]?.text()).toContain('En haut de l’écran.')
    expect(questions[1]?.get('summary').text()).toBe('Et le reste ?')
  })

  it('définitions : un mot, son sens', async () => {
    const wrapper = await mountBlocks([
      {
        kind: 'terms',
        title: 'Mots d’optique',
        items: [
          { term: 'OD', definition: 'Œil droit.' },
          { term: 'Axe', definition: 'Orientation du cylindre en degrés.' },
        ],
      },
    ])

    expect(wrapper.get('h3').text()).toBe('Mots d’optique')
    expect(wrapper.findAll('dl dt').map((term) => term.text())).toEqual(['OD', 'Axe'])
    expect(wrapper.findAll('dl dd').map((meaning) => meaning.text())).toEqual([
      'Œil droit.',
      'Orientation du cylindre en degrés.',
    ])
  })

  it('n’interprète jamais de HTML, dans aucun type de bloc', async () => {
    const wrapper = await mountBlocks([
      { kind: 'steps', title: HOSTILE, items: [HOSTILE] },
      { kind: 'points', title: HOSTILE, items: [HOSTILE] },
      { kind: 'note', tone: 'warning', text: HOSTILE },
      { kind: 'flow', title: HOSTILE, stages: [{ label: HOSTILE, text: HOSTILE }] },
      { kind: 'table', title: HOSTILE, head: [HOSTILE], rows: [[HOSTILE, HOSTILE]] },
      { kind: 'faq', title: HOSTILE, items: [{ q: HOSTILE, a: HOSTILE }] },
      { kind: 'terms', title: HOSTILE, items: [{ term: HOSTILE, definition: HOSTILE }] },
    ])

    expect(wrapper.find('img, script, b, i').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.text()).toContain('<script>boom()</script>')
    expect(wrapper.text()).not.toContain('gras </b>')
  })

  it('une liste vide de blocs n’affiche rien', async () => {
    const wrapper = await mountBlocks([])

    expect(wrapper.find('div').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})

describe('PageHelpView : la fiche d’un écran', () => {
  it('affiche les huit rubriques dans l’ordre, avec leurs titres exacts', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING)

    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(TITLES)
    expect(wrapper.find('h2').exists()).toBe(false)
    // Chaque rubrique est une région nommée par son propre titre.
    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(TITLES.length)
    for (const section of sections) {
      const heading = section.get('h3')
      expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    }
  })

  it('les titres de rubrique suivent le niveau demandé (2 quand la fiche est la page)', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING, { level: 2 })

    expect(wrapper.findAll('h2').map((heading) => heading.text())).toEqual(TITLES)
    expect(wrapper.find('h3').exists()).toBe(false)
  })

  it('n’affiche pas une rubrique vide', async () => {
    const wrapper = await mountView(FICHE_MINIMALE, NO_RIGHT)

    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['Vous êtes ici'])
    expect(wrapper.text()).toContain('Un écran sans rien d’autre.')
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.find('dl').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('rend « Vous êtes ici » avec ses libellés en puces', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING)
    const here = sectionOf(wrapper, 'Vous êtes ici')

    expect(here.get('.help-label').text()).toBe(chip('Rechercher'))
    expect(here.text()).toContain(
      `Retrouvez une fiche avec ${chip('Rechercher')} avant tout autre geste.`,
    )
  })

  it('actions : le libellé en puce, puis son effet', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING)
    const actions = sectionOf(wrapper, 'Ce que vous pouvez faire ici')

    expect(actions.findAll('dt').map((term) => term.text())).toEqual([
      chip('Rechercher'),
      chip('Nouveau patient'),
      chip('Fusionner les fiches'),
    ])
    expect(actions.findAll('dd').map((meaning) => meaning.text())).toEqual([
      `Affiche les fiches qui correspondent à ${chip('Nom')}.`,
      'Ouvre le formulaire de création.',
      'Réunit deux fiches en une seule.',
    ])
    expect(actions.findAll('dt .help-label')).toHaveLength(3)
  })

  describe('droits', () => {
    it('sans aucun droit : ni l’action ni la tâche réservées ne sont montrées', async () => {
      const wrapper = await mountView(FICHE, NO_RIGHT)

      const actions = sectionOf(wrapper, 'Ce que vous pouvez faire ici')
      expect(actions.findAll('dt').map((term) => term.text())).toEqual([chip('Rechercher')])
      const tasks = sectionOf(wrapper, 'Pas à pas')
      expect(tasks.findAll('summary').map((task) => task.text())).toEqual(['Retrouver une fiche'])
      for (const reserved of [
        'Nouveau patient',
        'Fusionner les fiches',
        'Créer une fiche',
        'Réunir deux fiches',
      ]) {
        expect(wrapper.text(), reserved).not.toContain(reserved)
      }
    })

    it('avec le droit de créer : la création apparaît, la fusion reste cachée', async () => {
      const wrapper = await mountView(FICHE, CAN_CREATE)

      const actions = sectionOf(wrapper, 'Ce que vous pouvez faire ici')
      expect(actions.findAll('dt').map((term) => term.text())).toEqual([
        chip('Rechercher'),
        chip('Nouveau patient'),
      ])
      const tasks = sectionOf(wrapper, 'Pas à pas')
      expect(tasks.findAll('summary').map((task) => task.text())).toEqual([
        'Retrouver une fiche',
        'Créer une fiche',
      ])
      expect(wrapper.text()).not.toContain('Fusionner les fiches')
      expect(wrapper.text()).not.toContain('Réunir deux fiches')
    })

    it('avec tous les droits : tout est montré', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)

      const tasks = sectionOf(wrapper, 'Pas à pas')
      expect(tasks.findAll('summary').map((task) => task.text())).toEqual([
        'Retrouver une fiche',
        'Créer une fiche',
        'Réunir deux fiches',
      ])
      expect(sectionOf(wrapper, 'Ce que vous pouvez faire ici').findAll('dt')).toHaveLength(3)
    })

    it('dit sans rien révéler que des actions sont réservées à d’autres profils', async () => {
      const notice = 'Des actions réservées à d’autres profils ne sont pas affichées.'

      expect((await mountView(FICHE, NO_RIGHT)).text()).toContain(notice)
      expect((await mountView(FICHE, CAN_CREATE)).text()).toContain(notice)
      // Rien n'est caché pour ce compte : la ligne disparaît.
      expect((await mountView(FICHE, CAN_EVERYTHING)).text()).not.toContain(notice)
      expect((await mountView(FICHE_MINIMALE, NO_RIGHT)).text()).not.toContain(notice)
    })

    it('un compte qui ne peut ni agir ni suivre une tâche voit quand même la ligne de réserve', async () => {
      const reserved: PageHelp = {
        ...FICHE_MINIMALE,
        actions: [{ label: 'Fusionner', effect: 'Réunit.', anyPermission: ['patient.merge'] }],
        tasks: [{ id: 'x', title: 'Réunir', steps: ['Étape.'], anyPermission: ['patient.merge'] }],
      }
      const wrapper = await mountView(reserved, NO_RIGHT)

      expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['Vous êtes ici'])
      expect(wrapper.text()).toContain(
        'Des actions réservées à d’autres profils ne sont pas affichées.',
      )
    })
  })

  describe('pas à pas', () => {
    it('une tâche par `details`, la première ouverte, les autres fermées', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const tasks = wrapper.findAll('details')

      expect(tasks).toHaveLength(3)
      expect(tasks.map((task) => task.attributes('open') !== undefined)).toEqual([
        true,
        false,
        false,
      ])
      expect(tasks.map((task) => task.get('summary').text())).toEqual([
        'Retrouver une fiche',
        'Créer une fiche',
        'Réunir deux fiches',
      ])
      expect(tasks[0]?.get('summary').classes()).toContain('min-h-11')
    })

    it('expandFirstTask à faux : toutes les tâches restent fermées', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING, { expandFirstTask: false })

      expect(wrapper.findAll('details').map((task) => task.attributes('open'))).toEqual([
        undefined,
        undefined,
        undefined,
      ])
    })

    it('étapes numérotées par pastilles, libellés en puces, puis le résultat', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const task = wrapper.findAll('details')[0]

      const steps = task?.findAll('ol li')
      expect(steps).toHaveLength(3)
      expect(steps?.map((step) => step.get('span').text())).toEqual(['1', '2', '3'])
      expect(steps?.[0]?.text()).toContain(`Saisissez un nom dans ${chip('Nom')}.`)
      expect(steps?.[1]?.get('.help-label').text()).toBe(chip('Rechercher'))
      expect(task?.text()).toContain('Résultat : La fiche s’ouvre.')
    })

    it('une tâche sans résultat n’affiche pas de ligne « Résultat »', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const merge = wrapper.findAll('details')[2]

      expect(merge?.text()).toContain('Cliquez sur')
      expect(merge?.text()).not.toContain('Résultat')
    })

    it('une autre fiche repart à zéro : sa première tâche s’ouvre, même si la précédente avait changé', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const second = wrapper.findAll('details')[1]
      if (second === undefined) throw new Error('Deuxième tâche attendue')
      ;(second.element as HTMLDetailsElement).open = true

      const other: PageHelp = {
        ...FICHE,
        route: 'autre',
        tasks: [
          { id: 'retrouver', title: 'Autre première', steps: ['Un.'] },
          { id: 'creer', title: 'Autre seconde', steps: ['Deux.'] },
        ],
      }
      await wrapper.setProps({ help: other })

      const tasks = wrapper.findAll('details')
      expect(tasks.map((task) => task.get('summary').text())).toEqual([
        'Autre première',
        'Autre seconde',
      ])
      expect(tasks.map((task) => (task.element as HTMLDetailsElement).open)).toEqual([true, false])
    })
  })

  describe('maturité', () => {
    const NOTICE =
      'Cette fonction est en cours de validation : elle n’est pas encore ouverte au cabinet.'

    it('une fiche en validation le dit en tête, en avertissement', async () => {
      const wrapper = await mountView({ ...FICHE, maturity: 'validation' }, CAN_EVERYTHING)
      const note = wrapper.get('[role="note"]')

      expect(note.text()).toContain(NOTICE)
      expect(note.classes()).toContain('bg-warning-soft')
      expect(note.get('.sr-only').text()).toBe('Attention :')
      // En tête : avant la première rubrique.
      const first = wrapper.element.firstElementChild
      expect(first?.contains(note.element)).toBe(true)
      expect(first?.querySelector('section')).toBeNull()
    })

    it('une fiche ouverte ne porte aucun avertissement', async () => {
      expect(
        (await mountView({ ...FICHE, maturity: 'available' }, CAN_EVERYTHING))
          .find('[role="note"]')
          .exists(),
      ).toBe(false)
      expect((await mountView(FICHE, CAN_EVERYTHING)).find('[role="note"]').exists()).toBe(false)
      expect((await mountView(FICHE, CAN_EVERYTHING)).text()).not.toContain(
        'en cours de validation',
      )
    })
  })

  describe('liens', () => {
    it('« Ensuite » : une route mène à son écran, une rubrique à la documentation', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const next = sectionOf(wrapper, 'Ensuite')
      const links = next.findAll('a')

      expect(links.map((link) => link.attributes('href'))).toEqual([
        '/patients',
        '/arrivee',
        '/aide#/parcours-accueillir',
      ])
      expect(links.map((link) => link.text())).toEqual([
        'Patients',
        'Enregistrer une arrivée',
        'Accueillir un patient',
      ])
      // Cible de 44 px au moins.
      expect(links.every((link) => link.classes().includes('min-h-11'))).toBe(true)
      // La raison de la suite est dite en texte secondaire, libellés en puces.
      expect(next.text()).toContain(`Pour retrouver ${chip('Nom')}.`)
      expect(next.text()).toContain('Le parcours complet.')
      expect(next.findAll('li')[1]?.text()).toBe('Enregistrer une arrivée')
    })

    it('« Mots utiles » : chaque mot mène à la rubrique du glossaire qui le définit', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const words = sectionOf(wrapper, 'Mots utiles')
      const links = words.findAll('a')

      expect(links.map((link) => link.text())).toEqual([
        'OD',
        'Acuité visuelle',
        'Numéro de dossier',
        'Écart pupillaire',
      ])
      expect(links.map((link) => link.attributes('href'))).toEqual([
        '/aide#/glossaire-optique',
        '/aide#/glossaire-optique',
        '/aide#/glossaire-gestion',
        '/aide#/glossaire-optique',
      ])
      // Le nom accessible commence par le mot visible (WCAG 2.5.3) et dit où mène le lien.
      expect(links.map((link) => link.attributes('aria-label'))).toEqual([
        'OD : voir la définition dans le glossaire',
        'Acuité visuelle : voir la définition dans le glossaire',
        'Numéro de dossier : voir la définition dans le glossaire',
        'Écart pupillaire : voir la définition dans le glossaire',
      ])
      expect(links.every((link) => link.classes().includes('min-h-11'))).toBe(true)
    })

    it('classe un mot d’optique sans tenir compte des accents ni de la casse', async () => {
      const wrapper = await mountView(
        { ...FICHE_MINIMALE, terms: ['autorefracteur', 'ECART PUPILLAIRE', 'Collyre', 'Doublon'] },
        NO_RIGHT,
      )
      const links = sectionOf(wrapper, 'Mots utiles').findAll('a')

      expect(links.map((link) => link.attributes('href'))).toEqual([
        '/aide#/glossaire-optique',
        '/aide#/glossaire-optique',
        '/aide#/glossaire-optique',
        '/aide#/glossaire-gestion',
      ])
    })

    it('émet navigate à chaque clic sur un lien interne, et seulement alors', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      expect(wrapper.emitted('navigate')).toBeUndefined()

      await sectionOf(wrapper, 'Ensuite').get('a[href="/patients"]').trigger('click')
      expect(wrapper.emitted('navigate')).toHaveLength(1)

      await sectionOf(wrapper, 'Ensuite')
        .get('a[href="/aide#/parcours-accueillir"]')
        .trigger('click')
      expect(wrapper.emitted('navigate')).toHaveLength(2)

      await sectionOf(wrapper, 'Mots utiles').get('a').trigger('click')
      expect(wrapper.emitted('navigate')).toHaveLength(3)

      // Cliquer ailleurs (un titre de tâche, du texte) n'émet rien.
      await wrapper.get('summary').trigger('click')
      await sectionOf(wrapper, 'Vous êtes ici').get('p').trigger('click')
      expect(wrapper.emitted('navigate')).toHaveLength(3)
    })

    it('un clic qui ouvre le lien ailleurs (Ctrl, Cmd, Maj) ne ferme pas l’hôte', async () => {
      const wrapper = await mountView(FICHE, CAN_EVERYTHING)
      const link = sectionOf(wrapper, 'Ensuite').get('a[href="/patients"]')
      // jsdom ne navigue pas : le clic est neutralisé APRÈS les écouteurs du composant.
      link.element.addEventListener('click', (event) => event.preventDefault())

      await link.trigger('click', { ctrlKey: true })
      await link.trigger('click', { metaKey: true })
      await link.trigger('click', { shiftKey: true })

      expect(wrapper.emitted('navigate')).toBeUndefined()
    })

    it('le clic d’un lien interne navigue vraiment (routeur)', async () => {
      const router = await makeRouter()
      const wrapper = track(
        mount(PageHelpView, {
          props: { help: FICHE, permissions: CAN_EVERYTHING },
          global: { plugins: [router] },
        }),
      )

      await sectionOf(wrapper, 'Ensuite').get('a[href="/arrivee"]').trigger('click')
      await router.isReady()
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('arrivee'))
      await sectionOf(wrapper, 'Mots utiles').get('a').trigger('click')
      await vi.waitFor(() =>
        expect(router.currentRoute.value.fullPath).toBe('/aide#/glossaire-optique'),
      )
    })

    it('un lien vers une route inconnue s’écrit en texte au lieu de faire échouer la fiche', async () => {
      const help: PageHelp = {
        ...FICHE_MINIMALE,
        next: [
          { route: 'inconnue', label: 'Ailleurs', why: 'Une route qui n’existe pas.' },
          { route: 'patients', label: 'Patients' },
        ],
      }
      const wrapper = await mountView(help, NO_RIGHT)
      const next = sectionOf(wrapper, 'Ensuite')

      expect(next.findAll('a').map((link) => link.text())).toEqual(['Patients'])
      expect(next.text()).toContain('Ailleurs')
      expect(next.text()).toContain('Une route qui n’existe pas.')
    })

    it('sans routeur, la fiche s’affiche et les liens s’écrivent en texte', async () => {
      const wrapper = track(
        mount(PageHelpView, { props: { help: FICHE, permissions: CAN_EVERYTHING } }),
      )

      expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(TITLES)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(sectionOf(wrapper, 'Ensuite').text()).toContain('Accueillir un patient')
      expect(sectionOf(wrapper, 'Mots utiles').text()).toContain('Acuité visuelle')
    })
  })

  it('« Comment ça marche » et « À savoir » : des puces', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING)

    expect(
      sectionOf(wrapper, 'Comment ça marche')
        .findAll('ul li')
        .map((item) => item.text()),
    ).toEqual(['La recherche part à 2 caractères.', 'Rien n’est réuni automatiquement.'])
    expect(sectionOf(wrapper, 'À savoir').findAll('ul li')).toHaveLength(2)
  })

  it('« Si ça ne marche pas » : le symptôme, puis le remède', async () => {
    const wrapper = await mountView(FICHE, CAN_EVERYTHING)
    const problems = sectionOf(wrapper, 'Si ça ne marche pas').findAll('li')

    expect(problems).toHaveLength(2)
    const paragraphs = problems[0]?.findAll('p')
    expect(paragraphs?.map((paragraph) => paragraph.text())).toEqual([
      chip('Aucun résultat'),
      'Vérifiez l’orthographe.',
    ])
    expect(paragraphs?.[0]?.classes()).toContain('font-semibold')
    expect(paragraphs?.[0]?.find('.help-label').exists()).toBe(true)
    expect(problems[1]?.findAll('p').map((paragraph) => paragraph.text())).toEqual([
      'Un message rouge sous un champ',
      'Corrigez le champ indiqué.',
    ])
  })

  it('n’interprète jamais de HTML dans une fiche', async () => {
    const hostile: PageHelp = {
      ...FICHE,
      purpose: HOSTILE,
      actions: [{ label: HOSTILE, effect: HOSTILE }],
      tasks: [{ id: 'x', title: HOSTILE, steps: [HOSTILE], result: HOSTILE }],
      rules: [HOSTILE],
      next: [{ route: 'patients', label: HOSTILE, why: HOSTILE }],
      tips: [HOSTILE],
      problems: [{ symptom: HOSTILE, remedy: HOSTILE }],
      terms: [HOSTILE],
    }
    const wrapper = await mountView(hostile, NO_RIGHT)

    expect(wrapper.find('img, script, b, i').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.text()).toContain('<script>boom()</script>')
  })

  it('ne produit aucun avertissement Vue (clés, attributs, fragments)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await mountView({ ...FICHE, maturity: 'validation' }, CAN_EVERYTHING)
    track(mount(HelpText, { props: { text: 'Un « libellé » simple.' } }))
    track(
      mount(HelpBlocks, {
        props: {
          blocks: [
            { kind: 'steps', items: ['Un.'] },
            { kind: 'table', title: 'T', head: ['A'], rows: [['1']] },
            { kind: 'flow', stages: [{ label: 'A', text: 'B' }] },
          ],
        },
      }),
    )

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

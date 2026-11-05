import { describe, expect, it } from 'vitest'

import type { HandbookTopic, HelpBlock, PageHelp } from '@/domain/help/model'

import {
  BANNED_WORDS,
  type CheckContext,
  checkPage,
  checkTexts,
  checkTopic,
  countWords,
  findPromises,
  formatProblem,
  glossaryDefinitions,
  normalizeExceptions,
  type Problem,
  type RouteFacts,
  routeFacts,
} from './support/checks'
import {
  decodeEntities,
  isHelpContent,
  LabelCorpus,
  locateEntry,
  normalizeLabel,
  readApplicationSources,
  readContentFiles,
  readSeed,
  readServerModules,
} from './support/sources'

/**
 * Mécanismes des gardes du contenu de l'aide, éprouvés sur du contenu d'exemple (aucun vrai contenu
 * ici : ce fichier passe quel que soit l'état de la rédaction). Chaque règle du contrat y a son cas
 * qui échoue et son cas qui passe ; le contrat sur le vrai contenu est `content-guards.test.ts`.
 */

const corpus = new LabelCorpus([
  {
    path: 'resources/frontend/pages/patients/PatientListPage.vue',
    text: '<h1>Patients</h1><button>Rechercher</button>\n<label>Rechercher un\n   patient</label> <a>Nouveau patient</a> <p>Date d’acuité &amp; autres&nbsp;choses</p> Axes',
  },
  { path: 'database/02_reference_data.sql', text: "('COMPLAINT', 'Baisse de vision')" },
  {
    path: 'resources/frontend/domain/help/content/pages-exemple.ts',
    text: "'Phrase écrite seulement dans l’aide'",
  },
  { path: 'resources/frontend/domain/help/guide.ts', text: "'Ancienne aide seulement'" },
])

const route = (name: string, overrides: Partial<RouteFacts> = {}): [string, RouteFacts] => [
  name,
  {
    name,
    hasParams: false,
    isPublic: false,
    title: null,
    module: null,
    permissions: [],
    ...overrides,
  },
]

const CTX: CheckContext = {
  labels: corpus,
  labelExceptions: normalizeExceptions({ 'Message assemblé': 'texte composé à l’exécution' }),
  routes: new Map([
    route('patients', { title: 'Patients', module: 'patients', permissions: ['patient.read'] }),
    route('patient', { hasParams: true, module: 'patients', permissions: ['patient.read'] }),
    route('parametres-poste', { module: 'offline', permissions: ['offline.enroll'] }),
  ]),
  topicIds: new Set(['parcours-accueillir']),
  permissionCodes: new Set(['patient.read', 'patient.create', 'offline.enroll']),
  glossaryTerms: new Set(['Numéro de dossier', 'OD']),
  knownModules: new Set(['patients', 'offline']),
  profileCodes: new Set(['MANAGER', 'RECEPTION']),
}

const PAGE: PageHelp = {
  route: 'patients',
  title: 'Patients',
  module: 'patients',
  anyPermission: ['patient.read'],
  purpose: 'Retrouvez la fiche d’un patient avant de l’accueillir.',
  actions: [
    {
      label: 'Rechercher',
      effect: 'Affiche les fiches qui correspondent à « Rechercher un patient ».',
    },
  ],
  tasks: [
    {
      id: 'retrouver-un-patient',
      title: 'Retrouver un patient',
      steps: ['Saisissez un nom dans « Rechercher un patient ».', 'Cliquez sur « Rechercher ».'],
      result: 'La fiche s’ouvre.',
    },
  ],
  rules: ['La recherche part à partir de 2 caractères.'],
  next: [
    { route: 'patients', label: 'Patients', why: 'Pour chercher.' },
    { topic: 'parcours-accueillir', label: 'Accueillir un patient' },
  ],
  tips: ['Cherchez aussi par téléphone.'],
  problems: [{ symptom: 'Aucun résultat.', remedy: 'Vérifiez l’orthographe.' }],
  terms: ['Numéro de dossier'],
}

const TOPIC: HandbookTopic = {
  id: 'parcours-accueillir',
  title: 'Accueillir un patient',
  summary: 'Du comptoir à la file du jour.',
  module: null,
  anyPermission: [],
  intro: 'Voici le parcours.',
  blocks: [
    { kind: 'steps', items: ['Cliquez sur « Nouveau patient ».'] },
    { kind: 'table', title: 'Profils', head: ['Profil', 'Rôle'], rows: [['Accueil', 'Identité']] },
  ],
  related: [{ topic: 'parcours-accueillir', label: 'Ce parcours' }],
}

const page = (overrides: Partial<PageHelp> = {}): PageHelp => ({ ...PAGE, ...overrides })
const topic = (overrides: Partial<HandbookTopic> = {}): HandbookTopic => ({
  ...TOPIC,
  ...overrides,
})
const blocks = (...list: HelpBlock[]): Partial<HandbookTopic> => ({ blocks: list })
const errors = (problems: readonly Problem[]): string[] =>
  problems.filter((problem) => problem.level === 'error').map((problem) => problem.field)
const warnings = (problems: readonly Problem[]): string[] =>
  problems.filter((problem) => problem.level === 'warning').map((problem) => problem.field)
const messages = (problems: readonly Problem[]): string =>
  problems.map((problem) => problem.message).join(' | ')
const words = (count: number): string => Array.from({ length: count }, () => 'mot').join(' ')
/** Valeur hors type, comme en écrirait un rédacteur qui ignore la compilation. */
const bad = <T>(value: unknown): T => value as T

describe('libellés : normalisation et corpus', () => {
  it('ramène apostrophes, espaces insécables et retours à la ligne à une forme unique', () => {
    expect(normalizeLabel('  Date d’acuité  \n visuelle ')).toBe("Date d'acuité visuelle")
    expect(decodeEntities('a&nbsp;b &amp; c &#39;d&rsquo; &#xE9; &inconnue;')).toBe(
      "a b & c 'd' é &inconnue;",
    )
  })

  it('retrouve un libellé coupé sur plusieurs lignes, avec apostrophe et entités', () => {
    expect(corpus.has('Rechercher un patient')).toBe(true)
    expect(corpus.has('Date d’acuité & autres choses')).toBe(true)
    expect(corpus.has('Baisse de vision')).toBe(true)
  })

  it('ne trouve pas un libellé au milieu d’un mot, ni un libellé inventé', () => {
    expect(corpus.has('Axe')).toBe(false)
    expect(corpus.has('Axes')).toBe(true)
    expect(corpus.has('Bouton fantôme')).toBe(false)
    expect(corpus.has('')).toBe(false)
  })

  it('ignore le contenu de l’aide lui-même, ancienne aide comprise', () => {
    expect(corpus.has('Phrase écrite seulement dans l’aide')).toBe(false)
    expect(corpus.has('Ancienne aide seulement')).toBe(false)
    expect(corpus.files.some(isHelpContent)).toBe(false)
    expect(corpus.files).toHaveLength(2)
    expect(isHelpContent('resources/frontend/domain/help/profiles.ts')).toBe(false)
    expect(isHelpContent('resources/frontend/components/help/HelpText.vue')).toBe(false)
  })

  it('signale une forme proche (casse ou accents) sans la compter comme trouvée', () => {
    expect(corpus.has('rechercher')).toBe(false)
    expect(corpus.looselyHas('rechercher')).toBe(true)
    expect(corpus.looselyHas('Baisse de vue')).toBe(false)
  })

  it('lit le vrai code de l’application et jamais le contenu de l’aide', () => {
    const sources = readApplicationSources()
    const paths = sources.map((source) => source.path)
    expect(paths).toContain('resources/frontend/app/router.ts')
    expect(paths).toContain('database/02_reference_data.sql')
    expect(paths.some((path) => path.includes('\\'))).toBe(false)
    expect(paths.some(isHelpContent)).toBe(true)
    const real = new LabelCorpus(sources)
    expect(real.files.some(isHelpContent)).toBe(false)
    expect(real.has('Se déconnecter')).toBe(true)
    expect(real.has('Enregistrer une arrivée')).toBe(true)
    expect(real.has('Baisse de vision')).toBe(true)
    expect(real.has('Bouton qui n’existe nulle part dans cette application')).toBe(false)
  }, 60_000)
})

describe('textes : règles communes', () => {
  const problems = (text: string): Problem[] => checkPage(page({ rules: [text] }), CTX)

  it('accepte un libellé existant, une exception déclarée et une ellipse finale', () => {
    expect(problems('Cliquez sur « Rechercher » puis sur « Nouveau patient ».')).toEqual([])
    expect(problems('Voir « Message assemblé ».')).toEqual([])
    expect(problems('Cliquez sur « Rechercher… ».')).toEqual([])
    expect(problems('Voir « Date d’acuité & autres choses ».')).toEqual([])
  })

  it('refuse un libellé introuvable et propose la forme proche', () => {
    const found = problems('Cliquez sur « Bouton fantôme ».')
    expect(errors(found)).toEqual(['rules[0]'])
    expect(messages(found)).toContain('introuvable dans l’application')
    expect(messages(found)).toContain('LABEL_EXCEPTIONS')
    expect(found[0]?.value).toBe('« Bouton fantôme »')
    expect(messages(problems('Cliquez sur « rechercher ».'))).toContain('casse ou accents')
  })

  it.each([
    'La facture est payée.',
    'Elle est soldée.',
    'Montant payé',
    'Une consultation gratuite.',
    'Consultation gratuitement ouverte.',
    'Dette acquittée.',
    'Les factures PAYÉES',
  ])('refuse le statut interdit : %s', (text) => {
    expect(errors(problems(text))).toEqual(['rules[0]'])
    expect(BANNED_WORDS.test(text)).toBe(true)
  })

  it.each([
    'Le solde de la facture est le reste à encaisser.',
    'Vous pouvez payer en espèces ; le patient paye au comptoir.',
    'La facture est encaissée puis émise.',
    'Les soldes de fin de saison.',
    'Pays et payeur',
  ])('laisse passer les mots de l’application : %s', (text) => {
    expect(BANNED_WORDS.test(text)).toBe(false)
    expect(errors(problems(text))).toEqual([])
  })

  it.each(['TODO relire', 'À compléter plus tard', 'Lorem ipsum', 'Montant ???', 'FIXME'])(
    'refuse une marque de travail inachevé : %s',
    (text) => {
      expect(errors(problems(text))).toEqual(['rules[0]'])
    },
  )

  it('refuse des guillemets non appariés ou imbriqués, avertit s’il manque une espace', () => {
    expect(errors(problems('Cliquez sur « Rechercher.'))).toContain('rules[0]')
    expect(errors(problems('Voir « Rechercher « Nouveau patient » ».'))).toContain('rules[0]')
    const tight = problems('Cliquez sur «Rechercher».')
    expect(errors(tight)).toEqual([])
    expect(warnings(tight)).toEqual(['rules[0]'])
  })

  it('refuse une balise HTML et un texte vide ou absent', () => {
    expect(errors(problems('Cliquez sur <b>Rechercher</b>.'))).toEqual(['rules[0]'])
    expect(errors(problems('   '))).toEqual(['rules[0]'])
    expect(errors(checkPage(page({ rules: [42 as unknown as string] }), CTX))).toEqual(['rules[0]'])
    expect(errors(problems('Si a < b et c > d, ouvrir « Rechercher ».'))).toEqual([])
  })

  it('compte les mots et ne tolère qu’une marge avant d’échouer', () => {
    expect(countWords('  un  deux\ttrois\n')).toBe(3)
    expect(countWords('   ')).toBe(0)
    const limited = (count: number): Problem[] => checkPage(page({ purpose: words(count) }), CTX)
    expect(limited(45)).toEqual([])
    expect(warnings(limited(46))).toEqual(['purpose'])
    expect(errors(limited(46))).toEqual([])
    expect(errors(limited(68))).toEqual(['purpose'])
  })

  it('contrôle des textes isolés (parties du plan)', () => {
    expect(checkTexts({ summary: 'Les mots de l’optique.' }, CTX)).toEqual([])
    expect(errors(checkTexts({ summary: 'Une aide gratuite.' }, CTX))).toEqual(['summary'])
  })
})

describe('promesses que l’application ne tient pas', () => {
  it.each([
    'Vous pouvez travailler sans Internet.',
    'Les ordonnances sont enregistrées sur ce poste.',
    'Pas besoin de connexion pour vendre.',
    'La caisse fonctionne hors ligne.',
    'Un SMS de rappel est envoyé au patient.',
    'Le rappel automatique prévient le patient.',
  ])('repère : %s', (text) => {
    expect(findPromises(text)).toHaveLength(1)
  })

  it.each([
    'Sans connexion, l’écran ne s’ouvre pas.',
    'Le travail hors ligne n’est pas encore disponible.',
    'Le message « Hors ligne » s’affiche en haut de l’écran.',
    'Aucun SMS n’est envoyé : les suivis sont des tâches internes.',
    'Le mode hors ligne arrivera dans une prochaine version.',
    'Rien n’est enregistré sur ce poste.',
    'L’application a besoin d’une connexion Internet.',
  ])('laisse passer, car la phrase nie, reporte ou cite un libellé : %s', (text) => {
    expect(findPromises(text)).toEqual([])
  })

  it('une fiche en maturité « validation » peut parler du poste, jamais promettre des messages', () => {
    const offline = 'Les fiches créées sans connexion sont enregistrées sur ce poste.'
    expect(errors(checkPage(page({ rules: [offline] }), CTX))).toEqual(['rules[0]'])
    expect(errors(checkPage(page({ rules: [offline], maturity: 'validation' }), CTX))).toEqual([])
    const sms = 'Un SMS de rappel est envoyé au patient.'
    expect(errors(checkPage(page({ rules: [sms], maturity: 'validation' }), CTX))).toEqual([
      'rules[0]',
    ])
  })

  it('les rubriques suivent la même règle', () => {
    const promise = blocks({ kind: 'note', text: 'Le travail sans Internet est prêt.' })
    expect(errors(checkTopic(topic(promise), CTX))).toEqual(['blocks[0].text'])
    expect(errors(checkTopic(topic({ ...promise, maturity: 'validation' }), CTX))).toEqual([])
  })
})

describe('fiche d’écran', () => {
  it('une fiche juste ne donne aucun constat', () => {
    expect(checkPage(PAGE, CTX)).toEqual([])
  })

  it('exige une route du routeur, son module et ses droits', () => {
    expect(errors(checkPage(page({ route: 'inconnue' }), CTX))).toEqual(['route'])
    expect(errors(checkPage(page({ module: null }), CTX))).toEqual(['module'])
    expect(errors(checkPage(page({ anyPermission: ['patient.create'] }), CTX))).toEqual([
      'anyPermission',
    ])
    expect(errors(checkPage(page({ anyPermission: [] }), CTX))).toEqual(['anyPermission'])
    expect(errors(checkPage(page({ module: 'fantome' }), CTX))).toEqual(['module', 'module'])
  })

  it('avertit seulement quand le titre diffère de celui de la route', () => {
    const found = checkPage(page({ title: 'Les patients' }), CTX)
    expect(errors(found)).toEqual([])
    expect(warnings(found)).toEqual(['title'])
  })

  it('refuse un droit absent du semis, sur la fiche, une action ou une tâche', () => {
    const [action] = PAGE.actions
    const [task] = PAGE.tasks
    expect(action).toBeDefined()
    expect(task).toBeDefined()
    expect(
      errors(checkPage(page({ actions: [{ ...action!, anyPermission: ['patient.voler'] }] }), CTX)),
    ).toEqual(['actions[0].anyPermission'])
    expect(
      errors(checkPage(page({ tasks: [{ ...task!, anyPermission: ['patient.voler'] }] }), CTX)),
    ).toEqual(['tasks[0].anyPermission'])
  })

  it('exige une action ou une tâche, et des libellés d’action existants', () => {
    expect(errors(checkPage(page({ actions: [], tasks: [] }), CTX))).toEqual(['actions'])
    const missing = checkPage(
      page({ actions: [{ label: 'Bouton fantôme', effect: 'Fait un effet.' }] }),
      CTX,
    )
    expect(errors(missing)).toEqual(['actions[0].label'])
    expect(messages(missing)).toContain('libellé d’action introuvable')
    expect(
      errors(checkPage(page({ actions: [{ label: 'Rechercher…', effect: 'Cherche.' }] }), CTX)),
    ).toEqual([])
  })

  it('refuse les identifiants de tâche en double ou mal formés, et une tâche sans étape', () => {
    const [task] = PAGE.tasks
    const twice = checkPage(page({ tasks: [task!, { ...task!, title: 'Autre' }] }), CTX)
    expect(errors(twice)).toEqual(['tasks[1].id'])
    expect(errors(checkPage(page({ tasks: [{ ...task!, id: 'Créer le patient' }] }), CTX))).toEqual(
      ['tasks[0].id'],
    )
    expect(errors(checkPage(page({ tasks: [{ ...task!, steps: [] }] }), CTX))).toEqual([
      'tasks[0].steps',
    ])
  })

  it('compte les éléments : avertissement au-delà des limites du guide', () => {
    const [action] = PAGE.actions
    const [task] = PAGE.tasks
    const many = <T>(item: T, count: number): T[] => Array.from({ length: count }, () => item)
    const found = checkPage(
      page({
        actions: many(action!, 11),
        tasks: many({ ...task!, id: 'x' }, 4),
        rules: many('Règle.', 7),
        next: many({ route: 'patients', label: 'Patients' }, 5),
        tips: many('Conseil.', 6),
        problems: many({ symptom: 'Symptôme.', remedy: 'Remède.' }, 6),
      }),
      CTX,
    )
    expect(warnings(found)).toEqual(
      expect.arrayContaining(['actions', 'tasks', 'rules', 'next', 'tips', 'problems']),
    )
    const invoice = route('facture', { module: 'sales', permissions: ['patient.read'] })
    const withInvoice: CheckContext = { ...CTX, routes: new Map([...CTX.routes, invoice]) }
    const invoiceTasks = many({ ...task!, id: 'x' }, 5)
    expect(
      warnings(
        checkPage(page({ route: 'facture', module: 'sales', tasks: invoiceTasks }), withInvoice),
      ),
    ).not.toContain('tasks')
  })

  it('mesure effet, étapes et règles', () => {
    const [action] = PAGE.actions
    const [task] = PAGE.tasks
    expect(
      warnings(checkPage(page({ actions: [{ ...action!, effect: words(26) }] }), CTX)),
    ).toEqual(['actions[0].effect'])
    expect(errors(checkPage(page({ actions: [{ ...action!, effect: words(40) }] }), CTX))).toEqual([
      'actions[0].effect',
    ])
    expect(warnings(checkPage(page({ tasks: [{ ...task!, steps: [words(31)] }] }), CTX))).toEqual([
      'tasks[0].steps[0]',
    ])
    expect(errors(checkPage(page({ rules: [words(60)] }), CTX))).toEqual(['rules[0]'])
  })

  it('vérifie les liens « Ensuite » : route sans paramètre, rubrique existante', () => {
    const next = (item: PageHelp['next'][number]): Problem[] =>
      checkPage(page({ next: [item] }), CTX)
    expect(errors(next({ route: 'patient', label: 'Dossier' }))).toEqual(['next[0].route'])
    expect(messages(next({ route: 'patient', label: 'Dossier' }))).toContain('paramètre')
    expect(errors(next({ route: 'nulle-part', label: 'Ailleurs' }))).toEqual(['next[0].route'])
    expect(errors(next({ topic: 'rubrique-fantome', label: 'Lire' }))).toEqual(['next[0].topic'])
    expect(errors(next({ route: 'patients', label: '' }))).toEqual(['next[0].label'])
    expect(
      errors(next({ route: 'patients', label: 'Patients', why: 'Quand c’est « payé ».' })),
    ).toEqual(['next[0].why', 'next[0].why'])
  })

  it('exige des termes définis par le glossaire', () => {
    expect(errors(checkPage(page({ terms: ['Mot inventé'] }), CTX))).toEqual(['terms[0]'])
    const twice = checkPage(page({ terms: ['OD', 'OD'] }), CTX)
    expect(errors(twice)).toEqual([])
    expect(warnings(twice)).toEqual(['terms[1]'])
  })

  it('exige la maturité « validation » pour le module « offline »', () => {
    const poste = page({
      route: 'parametres-poste',
      module: 'offline',
      anyPermission: ['offline.enroll'],
    })
    expect(errors(checkPage(poste, CTX))).toEqual(['maturity'])
    expect(errors(checkPage({ ...poste, maturity: 'validation' }, CTX))).toEqual([])
    expect(errors(checkPage({ ...poste, maturity: bad<'validation'>('prete') }, CTX))).toEqual([
      'maturity',
      'maturity',
    ])
  })

  it('une fiche mal formée devient un constat, pas une exception', () => {
    const broken = Object.fromEntries(Object.entries(PAGE).filter(([key]) => key !== 'actions'))
    const found = checkPage(bad<PageHelp>(broken), CTX)
    expect(errors(found)).toContain('(entrée)')
    expect(messages(found)).toContain('contenu mal formé')
  })
})

describe('rubrique de la documentation', () => {
  it('une rubrique juste ne donne aucun constat', () => {
    expect(checkTopic(TOPIC, CTX)).toEqual([])
  })

  it('exige identifiant, titre, résumé, au moins un bloc, un module connu, un profil connu', () => {
    expect(errors(checkTopic(topic({ id: 'Parcours Accueil' }), CTX))).toEqual(['id'])
    expect(errors(checkTopic(topic({ title: '' }), CTX))).toEqual(['title'])
    expect(errors(checkTopic(topic({ summary: '' }), CTX))).toEqual(['summary'])
    expect(errors(checkTopic(topic({ blocks: [] }), CTX))).toEqual(['blocks'])
    expect(errors(checkTopic(topic({ module: 'fantome' }), CTX))).toEqual(['module'])
    expect(errors(checkTopic(topic({ anyPermission: ['patient.voler'] }), CTX))).toEqual([
      'anyPermission',
    ])
    expect(
      errors(checkTopic(topic({ audience: ['MANAGER', bad<'MANAGER'>('STAGIAIRE')] }), CTX)),
    ).toEqual(['audience'])
    expect(errors(checkTopic(topic({ module: 'offline' }), CTX))).toEqual(['maturity'])
  })

  it('contrôle chaque type de bloc', () => {
    const table = (rows: string[][]): Partial<HandbookTopic> =>
      blocks({ kind: 'table', title: 'T', head: ['A', 'B'], rows })
    expect(errors(checkTopic(topic(table([['seule']])), CTX))).toEqual(['blocks[0].rows[0]'])
    expect(errors(checkTopic(topic(table([['a', '']])), CTX))).toEqual([])
    expect(
      warnings(checkTopic(topic(blocks({ kind: 'table', head: ['A'], rows: [['x']] })), CTX)),
    ).toEqual(['blocks[0]'])
    expect(errors(checkTopic(topic(blocks({ kind: 'steps', items: [] })), CTX))).toEqual([
      'blocks[0].items',
    ])
    expect(errors(checkTopic(topic(blocks({ kind: 'note', text: 'Soldée.' })), CTX))).toEqual([
      'blocks[0].text',
    ])
    expect(
      errors(
        checkTopic(topic(blocks({ kind: 'note', tone: bad<'info'>('danger'), text: 'Ok.' })), CTX),
      ),
    ).toEqual(['blocks[0].tone'])
    expect(errors(checkTopic(topic(blocks({ kind: 'flow', stages: [] })), CTX))).toEqual([
      'blocks[0].stages',
    ])
    expect(
      errors(checkTopic(topic(blocks({ kind: 'faq', items: [{ q: '', a: 'Oui.' }] })), CTX)),
    ).toEqual(['blocks[0].items[0].q'])
    expect(
      errors(
        checkTopic(
          topic(blocks({ kind: 'terms', items: [{ term: 'OD', definition: 'Œil droit.' }] })),
          CTX,
        ),
      ),
    ).toEqual([])
    expect(errors(checkTopic(topic(blocks(bad<HelpBlock>({ kind: 'dessin' }))), CTX))).toEqual([
      'blocks[0]',
    ])
  })

  it('vérifie « Pour aller plus loin » et avertit d’une rubrique trop longue', () => {
    expect(
      errors(checkTopic(topic({ related: [{ topic: 'fantome', label: 'Lire' }] }), CTX)),
    ).toEqual(['related[0].topic'])
    const long = blocks({ kind: 'points', items: [`${words(2000)}.`] })
    expect(warnings(checkTopic(topic(long), CTX))).toEqual(['blocks'])
    const dense = blocks(
      { kind: 'points', items: [`${words(2000)}.`] },
      { kind: 'terms', items: [{ term: 'OD', definition: 'Œil droit.' }] },
    )
    expect(warnings(checkTopic(topic(dense), CTX))).toEqual([])
    expect(warnings(checkTopic(topic({ summary: words(40) }), CTX))).toEqual(['summary'])
  })
})

describe('routes, glossaire, semis et fichiers de contenu', () => {
  it('relève dans le routeur le nom, les paramètres, le module et les droits', () => {
    const facts = routeFacts([
      { name: 'a', path: '/a', meta: { public: true, title: 'A' } },
      { name: 'b', path: '/b/:id([0-9]+)', meta: { module: 'sales', permissions: ['x.y'] } },
      { name: undefined, path: '/sans-nom', meta: {} },
    ])
    expect([...facts.keys()]).toEqual(['a', 'b'])
    expect(facts.get('a')).toEqual({
      name: 'a',
      hasParams: false,
      isPublic: true,
      title: 'A',
      module: null,
      permissions: [],
    })
    expect(facts.get('b')).toMatchObject({ hasParams: true, module: 'sales', permissions: ['x.y'] })
  })

  it('relève les termes définis, avec les rubriques qui les définissent', () => {
    const definitions = glossaryDefinitions(
      [
        topic({
          id: 'glossaire-optique',
          ...blocks({ kind: 'terms', items: [{ term: 'OD', definition: 'Œil droit.' }] }),
        }),
        topic({
          id: 'glossaire-gestion',
          ...blocks(
            { kind: 'note', text: 'Ignoré.' },
            {
              kind: 'terms',
              items: [
                { term: 'OD', definition: 'Encore.' },
                { term: 'Lot', definition: 'Un lot.' },
              ],
            },
          ),
        }),
      ],
      ['glossaire-optique', 'glossaire-gestion', 'absente'],
    )
    expect(definitions.get('OD')).toEqual(['glossaire-optique', 'glossaire-gestion'])
    expect(definitions.get('Lot')).toEqual(['glossaire-gestion'])
    expect(definitions.size).toBe(2)
  })

  it('lit le semis : droits, profils et droits par profil', () => {
    const seed = readSeed()
    expect(seed.permissions.has('patient.read')).toBe(true)
    expect(seed.permissions.has('users.manage')).toBe(true)
    expect(seed.permissions.has('MANAGER')).toBe(false)
    expect([...seed.roles].sort()).toEqual(['CASHIER', 'CLINICIAN', 'MANAGER', 'RECEPTION'])
    expect(seed.rolePermissions.get('MANAGER')?.has('users.manage')).toBe(true)
    expect(seed.rolePermissions.get('RECEPTION')?.has('payment.collect')).toBe(false)
  })

  it('lit les modules du serveur', () => {
    expect(readServerModules()).toEqual(expect.arrayContaining(['sales', 'patients', 'offline']))
  })

  it('retrouve le fichier qui déclare une fiche ou une rubrique, pas ceux qui la citent', () => {
    const files = [
      {
        name: 'content/pages-a.ts',
        text: "export const A = [\n  {\n    route: 'patients',\n    next: [\n      {\n        route: 'arrivee',\n        label: 'x',\n      },\n    ],\n    tasks: [\n      {\n        id: 'retrouver',\n      },\n    ],\n  },\n]\n",
      },
      {
        name: 'content/handbook-b.ts',
        text: "export const B = [\n  {\n    id: 'bienvenue',\n    title: 'x',\r\n  },\n]\n",
      },
      { name: 'content/pages-c.ts', text: "x = [\n  {\n    route: 'patients',\n" },
    ]
    expect(locateEntry(files, 'page', 'patients')).toBe('content/pages-a.ts + content/pages-c.ts')
    expect(locateEntry(files, 'page', 'arrivee')).toBe('(fichier de contenu introuvable)')
    expect(locateEntry(files, 'topic', 'bienvenue')).toBe('content/handbook-b.ts')
    expect(locateEntry(files, 'topic', 'retrouver')).toBe('(fichier de contenu introuvable)')
    expect(readContentFiles().every((file) => file.name.startsWith('content/'))).toBe(true)
  })

  it('formate un constat : fichier › entrée › champ : message — valeur', () => {
    expect(
      formatProblem('content/pages-a.ts', 'fiche « patients »', {
        level: 'error',
        field: 'actions[2].effect',
        message: 'effect trop long',
        value: 'texte',
      }),
    ).toBe(
      'content/pages-a.ts › fiche « patients » › actions[2].effect : effect trop long — valeur : texte',
    )
    expect(
      formatProblem('f.ts', 'e', { level: 'warning', field: 'champ', message: 'message' }),
    ).toBe('f.ts › e › champ : message')
  })
})

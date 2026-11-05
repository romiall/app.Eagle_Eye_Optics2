// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { HelpAccess, HelpAction, HelpBlock, HelpTask, PageHelp } from '@/domain/help/model'
import {
  actionsFor,
  blockText,
  hasAccess,
  hashFor,
  type HelpLocation,
  hiddenCount,
  type InlineSegment,
  parseHash,
  splitInline,
  tasksFor,
} from '@/domain/help/rules'

/**
 * Règles pures de l'aide intégrée : qui voit quoi, découpage des libellés d'écran dans un texte,
 * adresse (ancre) d'une rubrique ou d'un écran, textes d'un bloc pour la recherche. Ces règles
 * décident ce qu'une personne lit ou non : une erreur y montrerait à la caisse l'aide des examens,
 * ou casserait un lien de la documentation. Toutes les fiches et rubriques ci-dessous sont
 * FICTIVES : jamais le vrai contenu, qui s'écrit en parallèle.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** Fige en profondeur : toute écriture dans une fiche ou un bloc fait alors échouer le test. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function access(module: string | null, ...anyPermission: string[]): HelpAccess {
  return { module, anyPermission }
}

function page(overrides: Partial<PageHelp> = {}): PageHelp {
  return {
    route: 'ecran-fictif',
    title: 'Écran fictif',
    module: null,
    anyPermission: [],
    purpose: 'Un écran inventé pour les tests.',
    actions: [],
    tasks: [],
    rules: [],
    next: [],
    ...overrides,
  }
}

describe('hasAccess : qui voit une rubrique ou une fiche', () => {
  it('ouvre à tout compte connecté ce qui n’exige ni module ni droit', () => {
    expect(hasAccess(access(null), [], [])).toBe(true)
    expect(hasAccess(access(null), ['patient.read'], ['patients'])).toBe(true)
  })

  it('exige que le module soit ouvert, même pour un compte qui a tous les droits', () => {
    const rubrique = access('consultations', 'clinical.read')

    expect(hasAccess(rubrique, ['clinical.read'], [])).toBe(false)
    expect(hasAccess(rubrique, ['clinical.read'], ['patients', 'sales'])).toBe(false)
    expect(hasAccess(rubrique, ['clinical.read'], ['patients', 'consultations'])).toBe(true)
  })

  it('ne demande aucun droit quand la liste est vide, mais garde la règle du module', () => {
    expect(hasAccess(access('sales'), [], ['sales'])).toBe(true)
    expect(hasAccess(access('sales'), [], ['patients'])).toBe(false)
    expect(hasAccess(access('sales'), [], [])).toBe(false)
  })

  it('accepte le compte qui détient un seul des droits de la liste', () => {
    const rubrique = access('sales', 'invoice.read', 'payment.collect', 'cash.own_session')

    expect(hasAccess(rubrique, ['payment.collect'], ['sales'])).toBe(true)
    expect(hasAccess(rubrique, ['patient.read', 'cash.own_session'], ['sales'])).toBe(true)
  })

  it('refuse le compte qui n’en détient aucun, module ouvert ou non', () => {
    const rubrique = access('sales', 'invoice.read', 'payment.collect')

    expect(hasAccess(rubrique, [], ['sales'])).toBe(false)
    expect(hasAccess(rubrique, ['patient.read', 'clinical.read'], ['sales'])).toBe(false)
    expect(hasAccess(access(null, 'invoice.read'), ['patient.read'], ['sales'])).toBe(false)
  })

  it('compare les codes tels quels : ni préfixe, ni suffixe, ni majuscules', () => {
    const rubrique = access(null, 'patient.read')

    expect(hasAccess(rubrique, ['patient'], [])).toBe(false)
    expect(hasAccess(rubrique, ['patient.read.all'], [])).toBe(false)
    expect(hasAccess(rubrique, ['patient.reads'], [])).toBe(false)
    expect(hasAccess(rubrique, ['PATIENT.READ'], [])).toBe(false)
    expect(hasAccess(access('sales'), [], ['Sales'])).toBe(false)
  })

  it('ne confond jamais un module avec un droit', () => {
    // Un module ouvert ne donne aucun droit, et un droit n'ouvre aucun module.
    expect(hasAccess(access(null, 'patients'), [], ['patients'])).toBe(false)
    expect(hasAccess(access('patients'), ['patients'], [])).toBe(false)
  })
})

describe('actionsFor, tasksFor et hiddenCount : la fiche selon les droits du compte', () => {
  const SEARCH: HelpAction = { label: 'Rechercher', effect: 'Affiche les fiches trouvées.' }
  const CREATE: HelpAction = {
    label: 'Nouveau patient',
    effect: 'Ouvre le formulaire de création.',
    anyPermission: ['patient.create'],
  }
  const MERGE: HelpAction = {
    label: 'Fusionner',
    effect: 'Réunit deux fiches.',
    anyPermission: ['patient.merge', 'approval.decide'],
  }
  const PRINT: HelpAction = {
    label: 'Imprimer',
    effect: 'Imprime la liste.',
    anyPermission: [],
  }

  const LOOK_UP: HelpTask = {
    id: 'retrouver',
    title: 'Retrouver un patient',
    steps: ['Saisissez un nom.'],
  }
  const ENROLL: HelpTask = {
    id: 'creer',
    title: 'Créer un patient',
    steps: ['Cliquez sur « Nouveau patient ».'],
    result: 'La fiche s’ouvre.',
    anyPermission: ['patient.create'],
  }
  const COMBINE: HelpTask = {
    id: 'fusionner',
    title: 'Fusionner deux fiches',
    steps: ['Ouvrez la première fiche.'],
    anyPermission: ['patient.merge'],
  }

  const HELP = deepFreeze(
    page({ actions: [SEARCH, CREATE, MERGE, PRINT], tasks: [LOOK_UP, ENROLL, COMBINE] }),
  )

  const labels = (actions: readonly HelpAction[]) => actions.map((action) => action.label)
  const taskIds = (tasks: readonly HelpTask[]) => tasks.map((task) => task.id)

  it('montre à tout compte, même sans aucun droit, ce qui n’est pas réservé', () => {
    // Une liste vide `anyPermission: []` veut dire « pas de restriction », comme l'absence de liste.
    expect(labels(actionsFor(HELP, []))).toEqual(['Rechercher', 'Imprimer'])
    expect(taskIds(tasksFor(HELP, []))).toEqual(['retrouver'])
  })

  it('ajoute ce que le compte a le droit de faire, dans l’ordre de la fiche', () => {
    expect(labels(actionsFor(HELP, ['patient.create']))).toEqual([
      'Rechercher',
      'Nouveau patient',
      'Imprimer',
    ])
    expect(taskIds(tasksFor(HELP, ['patient.create']))).toEqual(['retrouver', 'creer'])
  })

  it('suffit d’un seul des droits d’une liste', () => {
    expect(labels(actionsFor(HELP, ['approval.decide']))).toEqual([
      'Rechercher',
      'Fusionner',
      'Imprimer',
    ])
    expect(labels(actionsFor(HELP, ['patient.merge']))).toContain('Fusionner')
    // La tâche « Fusionner » ne liste que patient.merge : approval.decide ne l'ouvre pas.
    expect(taskIds(tasksFor(HELP, ['approval.decide']))).toEqual(['retrouver'])
  })

  it('montre tout à qui détient les droits, et ignore ceux que la fiche ne cite pas', () => {
    const rights = ['patient.create', 'patient.merge', 'stock.adjust']

    expect(labels(actionsFor(HELP, rights))).toEqual([
      'Rechercher',
      'Nouveau patient',
      'Fusionner',
      'Imprimer',
    ])
    expect(taskIds(tasksFor(HELP, rights))).toEqual(['retrouver', 'creer', 'fusionner'])
  })

  it('compare les codes tels quels, sans préfixe ni majuscules', () => {
    for (const nearMiss of ['patient', 'patient.creates', 'PATIENT.CREATE', 'patient.create ']) {
      expect(labels(actionsFor(HELP, [nearMiss])), nearMiss).not.toContain('Nouveau patient')
      expect(taskIds(tasksFor(HELP, [nearMiss])), nearMiss).not.toContain('creer')
    }
  })

  it('rend de nouvelles listes, jamais les tableaux de la fiche, et ne la modifie pas', () => {
    const everything = ['patient.create', 'patient.merge']
    const actions = actionsFor(HELP, everything)
    const tasks = tasksFor(HELP, everything)

    // La fiche est figée : une écriture dans l'une des deux fonctions lèverait une erreur.
    expect(actions).toEqual(HELP.actions)
    expect(actions).not.toBe(HELP.actions)
    expect(actions[0]).toBe(HELP.actions[0])
    expect(tasks).toEqual(HELP.tasks)
    expect(tasks).not.toBe(HELP.tasks)
    // Trier le résultat (un composant peut le faire) ne dérange donc pas la fiche partagée.
    actions.reverse()
    expect(HELP.actions[0]?.label).toBe('Rechercher')
  })

  it('compte les actions et les tâches réservées à d’autres comptes', () => {
    // Sans droit : Nouveau patient et Fusionner cachés (2), Créer et Fusionner cachés (2).
    expect(hiddenCount(HELP, [])).toBe(4)
    // patient.create : seul Fusionner (action) et Fusionner (tâche) restent cachés.
    expect(hiddenCount(HELP, ['patient.create'])).toBe(2)
    // approval.decide ouvre l'action « Fusionner » mais aucune tâche réservée.
    expect(hiddenCount(HELP, ['approval.decide'])).toBe(3)
    expect(hiddenCount(HELP, ['patient.create', 'patient.merge'])).toBe(0)
  })

  it('vaut toujours le total moins ce que le compte voit', () => {
    const accounts = [[], ['patient.create'], ['patient.merge'], ['approval.decide'], ['x.y']]

    for (const permissions of accounts) {
      const visible = actionsFor(HELP, permissions).length + tasksFor(HELP, permissions).length

      expect(hiddenCount(HELP, permissions), permissions.join(',')).toBe(
        HELP.actions.length + HELP.tasks.length - visible,
      )
    }
  })

  it('vaut 0 pour une fiche sans action ni tâche réservée, quels que soient les droits', () => {
    const open = page({ actions: [SEARCH, PRINT], tasks: [LOOK_UP] })

    expect(hiddenCount(open, [])).toBe(0)
    expect(hiddenCount(open, ['patient.create'])).toBe(0)
    expect(hiddenCount(page(), [])).toBe(0)
  })
})

describe('splitInline : libellés d’écran rendus en puces', () => {
  const text = (value: string): InlineSegment => ({ kind: 'text', value })
  const label = (value: string): InlineSegment => ({ kind: 'label', value })

  it('rend un texte sans libellé en un seul segment de texte', () => {
    expect(splitInline('Saisissez au moins deux caractères.')).toEqual([
      text('Saisissez au moins deux caractères.'),
    ])
  })

  it('ne rend aucun segment pour un texte vide', () => {
    expect(splitInline('')).toEqual([])
  })

  it('isole un libellé entre deux morceaux de texte, sans ses guillemets', () => {
    expect(splitInline('Cliquez sur « Enregistrer » puis fermez.')).toEqual([
      text('Cliquez sur '),
      label('Enregistrer'),
      text(' puis fermez.'),
    ])
  })

  it('isole plusieurs libellés dans l’ordre, avec le texte qui les sépare', () => {
    expect(
      splitInline('Choisissez « Espèces » ou « Mobile money », puis « Encaisser » à la fin.'),
    ).toEqual([
      text('Choisissez '),
      label('Espèces'),
      text(' ou '),
      label('Mobile money'),
      text(', puis '),
      label('Encaisser'),
      text(' à la fin.'),
    ])
  })

  it('n’insère aucun texte vide : libellé en tête, en queue ou collé à un autre', () => {
    expect(splitInline('« Enregistrer »')).toEqual([label('Enregistrer')])
    expect(splitInline('« A » puis')).toEqual([label('A'), text(' puis')])
    expect(splitInline('puis « A »')).toEqual([text('puis '), label('A')])
    expect(splitInline('« A »« B »')).toEqual([label('A'), label('B')])
  })

  it('retire les espaces autour du libellé, insécables et fines comprises', () => {
    // La typographie française met une espace insécable (ou fine) à l'intérieur des guillemets.
    expect(splitInline('«  Enregistrer  »')).toEqual([label('Enregistrer')])
    expect(splitInline('« Enregistrer »')).toEqual([label('Enregistrer')])
    expect(splitInline('« Enregistrer »')).toEqual([label('Enregistrer')])
    expect(splitInline('«Enregistrer»')).toEqual([label('Enregistrer')])
  })

  it('garde le libellé tel qu’il est écrit : casse, accents, apostrophe, espaces internes', () => {
    expect(splitInline('Ouvrez « Aujourd’hui » ou « Rendez-vous à rappeler ».')).toEqual([
      text('Ouvrez '),
      label('Aujourd’hui'),
      text(' ou '),
      label('Rendez-vous à rappeler'),
      text('.'),
    ])
    expect(splitInline('« OD »')).toEqual([label('OD')])
  })

  it('laisse en texte un guillemet ouvrant jamais fermé', () => {
    expect(splitInline('« Enregistrer sans fermer')).toEqual([text('« Enregistrer sans fermer')])
    expect(splitInline('Cliquez sur « Enregistrer')).toEqual([text('Cliquez sur « Enregistrer')])
  })

  it('laisse en texte un guillemet fermant seul et des guillemets vides', () => {
    expect(splitInline('Enregistrer »')).toEqual([text('Enregistrer »')])
    expect(splitInline('» A «')).toEqual([text('» A «')])
    expect(splitInline('Rien ici : «»')).toEqual([text('Rien ici : «»')])
  })

  it('ne reconnaît que les guillemets français « »', () => {
    const autres =
      '"Enregistrer" “Enregistrer” ‘Enregistrer’ ‹ Enregistrer › <<Enregistrer>> (Enregistrer) [Enregistrer]'

    expect(splitInline(autres)).toEqual([text(autres)])
  })

  it('n’interprète jamais de HTML : chevrons, balises et entités restent du texte', () => {
    expect(
      splitInline('<b>Gras</b> &amp; « <i>Italique</i> » <script>alert(1)</script> 1 < 2 > 0'),
    ).toEqual([
      text('<b>Gras</b> &amp; '),
      label('<i>Italique</i>'),
      text(' <script>alert(1)</script> 1 < 2 > 0'),
    ])
    expect(splitInline('« <img src=x onerror=alert(1)> »')).toEqual([
      label('<img src=x onerror=alert(1)>'),
    ])
  })

  it('ne perd et n’invente aucun caractère, quelle que soit l’entrée', () => {
    const hostile = [
      ' ',
      '«',
      '»',
      '«»',
      '« »',
      '«  »',
      '»«',
      '« A',
      'A »',
      '« A « B »',
      '« A » »',
      '« « A » »',
      '«« A »»',
      '« A »« B »« C »',
      '«\n»',
      '« Premier\nSecond »',
      '« »',
      '«   »',
      '<<A>>',
      '"A" ‹B›',
      `« ${'mot '.repeat(30)}»`,
      'Texte sans libellé.',
    ]
    // Guillemets et espaces de toute sorte ne comptent pas : ce qui doit être conservé, ce sont les mots.
    const squeeze = (value: string) => value.replace(/[«»\s]/g, '')

    for (const input of hostile) {
      const segments = splitInline(input)

      expect(squeeze(segments.map((segment) => segment.value).join('')), input).toBe(squeeze(input))
      expect(
        segments.every((segment) => segment.value !== ''),
        input,
      ).toBe(true)
      // Deux morceaux de texte consécutifs auraient dû être un seul.
      segments.slice(1).forEach((segment, position) => {
        expect(segment.kind === 'text' && segments[position]?.kind === 'text', input).toBe(false)
      })
    }
  })
})

describe('hashFor et parseHash : adresses de la documentation', () => {
  const home: HelpLocation = { kind: 'home' }

  it('écrit l’accueil sans ancre, une rubrique « #/… » et un écran « #/ecran/… »', () => {
    expect(hashFor(home)).toBe('')
    expect(hashFor({ kind: 'topic', id: 'parcours-vente' })).toBe('#/parcours-vente')
    expect(hashFor({ kind: 'screen', route: 'patients' })).toBe('#/ecran/patients')
  })

  it('lit ces mêmes ancres', () => {
    expect(parseHash('#/parcours-vente')).toEqual({ kind: 'topic', id: 'parcours-vente' })
    expect(parseHash('#/ecran/patients')).toEqual({ kind: 'screen', route: 'patients' })
    expect(parseHash('')).toEqual(home)
  })

  it('fait l’aller-retour pour tout identifiant de rubrique ou nom d’écran valide', () => {
    const ids = [
      'bienvenue',
      'glossaire-optique',
      'notion-visite-examen',
      'depannage-limites',
      'a',
      'x1',
      '2026',
      // « ecran » n'est un préfixe que suivi d'une barre : une rubrique peut s'appeler ainsi.
      'ecran',
    ]
    const routes = ['patients', 'patient-nouveau', 'parametres-personnel-nouveau', 'ecran']
    const locations: HelpLocation[] = [
      home,
      ...ids.map((id): HelpLocation => ({ kind: 'topic', id })),
      ...routes.map((route): HelpLocation => ({ kind: 'screen', route })),
    ]

    for (const location of locations) {
      expect(parseHash(hashFor(location)), JSON.stringify(location)).toEqual(location)
    }
  })

  it('mène à l’accueil pour toute ancre inconnue ou mal formée', () => {
    const hostile = [
      '#',
      '#/',
      '#//',
      '#/ecran/',
      '#/ecran/x/',
      '#/ecran/patients/extra',
      '#/ecran/../patients',
      '#/../etc/passwd',
      '#/Parcours-Vente',
      '#/parcours_vente',
      '#/parcours vente',
      '#/parcours%20vente',
      '#/parcours-vente\n',
      '#/parcours-vente#suite',
      '#/ecran/patients?x=1',
      '#/<script>alert(1)</script>',
      '#/éco',
      '##/a',
      ' #/a',
      '#/a ',
      '#parcours-vente',
      '/parcours-vente',
      'parcours-vente',
      'http://exemple.test/#/parcours-vente',
    ]

    for (const hash of hostile) expect(parseHash(hash), JSON.stringify(hash)).toEqual(home)
  })

  it('refuse, à la lecture, une ancre fabriquée avec un identifiant invalide', () => {
    // hashFor ne contrôle rien : c'est parseHash qui garde l'entrée de l'écran Documentation.
    expect(parseHash(hashFor({ kind: 'topic', id: 'Parcours Vente' }))).toEqual(home)
    expect(parseHash(hashFor({ kind: 'topic', id: '../secret' }))).toEqual(home)
    expect(parseHash(hashFor({ kind: 'screen', route: 'patient_view' }))).toEqual(home)
    expect(parseHash(hashFor({ kind: 'screen', route: '' }))).toEqual(home)
  })

  it('retrouve intact le nom de chaque route nommée du routeur dans une ancre d’écran', () => {
    // La « Référence des écrans » ancre chaque fiche sur le nom de sa route : un nom en majuscules,
    // avec un tiret bas ou un point serait renvoyé à l'accueil par parseHash.
    const source = readFileSync(join(ROOT, 'resources', 'frontend', 'app', 'router.ts'), 'utf8')
    const names = [...new Set([...source.matchAll(/\bname: '([^']+)'/g)].map((m) => m[1] ?? ''))]

    expect(names.length).toBeGreaterThan(10)
    expect(names).toContain('patients')
    for (const name of names) {
      expect(parseHash(hashFor({ kind: 'screen', route: name })), name).toEqual({
        kind: 'screen',
        route: name,
      })
    }
  })
})

describe('blockText : tous les textes d’un bloc, pour la recherche', () => {
  /** Un bloc de chaque type : le type mappé oblige à en ajouter un dès qu'un nouveau type existe. */
  const BLOCKS: { [K in HelpBlock['kind']]: Extract<HelpBlock, { kind: K }> } = deepFreeze({
    steps: {
      kind: 'steps',
      title: 'Étapes de la vente',
      items: ['Ouvrez la facture.', 'Ajoutez la monture.'],
    },
    points: {
      kind: 'points',
      title: 'À retenir',
      items: ['Une facture émise ne change plus.', 'Un reçu garde son numéro.'],
    },
    note: {
      kind: 'note',
      tone: 'warning',
      text: 'Vérifiez le téléphone avant de créer une fiche.',
    },
    flow: {
      kind: 'flow',
      title: 'Du devis à la facture',
      stages: [
        { label: 'Devis', text: 'Le patient choisit.' },
        { label: 'Facture', text: 'Le cabinet émet.' },
      ],
    },
    table: {
      kind: 'table',
      title: 'Qui fait quoi',
      head: ['Profil', 'Geste'],
      rows: [
        ['Accueil', 'Crée la fiche'],
        ['Caissière', 'Encaisse'],
      ],
    },
    faq: {
      kind: 'faq',
      title: 'Questions fréquentes',
      items: [
        { q: 'Puis-je modifier une facture émise ?', a: 'Non, créez une pièce de correction.' },
        { q: 'Et un reçu ?', a: 'Il garde son numéro.' },
      ],
    },
    terms: {
      kind: 'terms',
      title: 'Mots utiles',
      items: [
        { term: 'Sphère', definition: 'Puissance du verre.' },
        { term: 'Axe', definition: 'Orientation du cylindre.' },
      ],
    },
  })

  /** Les textes réels du bloc : les titres vides que `blockText` peut renvoyer ne comptent pas. */
  const texts = (block: HelpBlock) => blockText(block).filter((value) => value !== '')

  /** Tout ce qu'une personne lit dans le bloc : toutes les chaînes, hors `kind` et `tone`. */
  function readable(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap((item: unknown) => readable(item))
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, item]) =>
        key === 'kind' || key === 'tone' ? [] : readable(item),
      )
    }
    return []
  }

  function untitled(block: HelpBlock): HelpBlock {
    return Object.fromEntries(
      Object.entries(block).filter(([key]) => key !== 'title'),
    ) as unknown as HelpBlock
  }

  it('steps : le titre puis chaque étape', () => {
    expect(texts(BLOCKS.steps)).toEqual([
      'Étapes de la vente',
      'Ouvrez la facture.',
      'Ajoutez la monture.',
    ])
  })

  it('points : le titre puis chaque point', () => {
    expect(texts(BLOCKS.points)).toEqual([
      'À retenir',
      'Une facture émise ne change plus.',
      'Un reçu garde son numéro.',
    ])
  })

  it('note : le texte seul, jamais le ton', () => {
    expect(texts(BLOCKS.note)).toEqual(['Vérifiez le téléphone avant de créer une fiche.'])
    expect(blockText(BLOCKS.note)).not.toContain('warning')
  })

  it('flow : le titre, puis le nom et le texte de chaque étape', () => {
    expect(texts(BLOCKS.flow)).toEqual([
      'Du devis à la facture',
      'Devis',
      'Le patient choisit.',
      'Facture',
      'Le cabinet émet.',
    ])
  })

  it('table : le titre, les en-têtes, puis les cellules ligne par ligne', () => {
    expect(texts(BLOCKS.table)).toEqual([
      'Qui fait quoi',
      'Profil',
      'Geste',
      'Accueil',
      'Crée la fiche',
      'Caissière',
      'Encaisse',
    ])
  })

  it('faq : le titre, puis chaque question suivie de sa réponse', () => {
    expect(texts(BLOCKS.faq)).toEqual([
      'Questions fréquentes',
      'Puis-je modifier une facture émise ?',
      'Non, créez une pièce de correction.',
      'Et un reçu ?',
      'Il garde son numéro.',
    ])
  })

  it('terms : le titre, puis chaque terme suivi de sa définition', () => {
    expect(texts(BLOCKS.terms)).toEqual([
      'Mots utiles',
      'Sphère',
      'Puissance du verre.',
      'Axe',
      'Orientation du cylindre.',
    ])
  })

  it('n’oublie aucun texte affiché, pour chaque type de bloc', () => {
    // Si un type de bloc gagne un champ de texte (une légende, par exemple), ce test échoue tant que
    // la recherche ne le lit pas : un mot affiché doit être un mot trouvable.
    for (const [kind, block] of Object.entries(BLOCKS)) {
      expect([...texts(block)].sort(), kind).toEqual([...readable(block)].sort())
    }
  })

  it('ne renvoie aucun texte inventé quand le titre est absent', () => {
    for (const [kind, block] of Object.entries(BLOCKS)) {
      const bare = untitled(block)

      expect(blockText(bare).join(' '), kind).not.toContain('undefined')
      expect([...texts(bare)].sort(), kind).toEqual([...readable(bare)].sort())
    }
    expect(texts(untitled(BLOCKS.steps))).toEqual(['Ouvrez la facture.', 'Ajoutez la monture.'])
  })

  it('rend une liste vide de texte pour un bloc sans contenu', () => {
    expect(texts({ kind: 'steps', items: [] })).toEqual([])
    expect(texts({ kind: 'table', head: [], rows: [] })).toEqual([])
    expect(texts({ kind: 'faq', items: [] })).toEqual([])
  })

  it('ne modifie pas le bloc (les blocs de la documentation sont partagés)', () => {
    // Les blocs ci-dessus sont figés en profondeur : une écriture lèverait une erreur.
    expect(() => {
      for (const block of Object.values(BLOCKS)) blockText(block)
    }).not.toThrow()
  })
})

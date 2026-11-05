// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { HandbookPart, HandbookTopic, HelpBlock, PageHelp } from '@/domain/help/model'
import { hasAccess } from '@/domain/help/rules'
import {
  buildIndex,
  normalizeText,
  queryWords,
  SCREENS_GROUP,
  type SearchHit,
  searchIndex,
} from '@/domain/help/search'

/**
 * Recherche dans la documentation : un index construit sur ce que le compte a le droit de lire, puis
 * une recherche sans accent ni casse où CHAQUE mot saisi doit se retrouver dans l'entrée. Une erreur
 * ici cache la bonne page à une personne pressée, ou la lui montre sous dix résultats sans rapport.
 * Rubriques et fiches ci-dessous FICTIVES : jamais le vrai contenu, qui s'écrit en parallèle.
 */

const NEUTRAL = 'Texte neutre.'

/** Fige en profondeur : toute écriture de l'index ou de la recherche dans le contenu ferait échouer le test. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function topic(id: string, title: string, overrides: Partial<HandbookTopic> = {}): HandbookTopic {
  return {
    id,
    title,
    summary: NEUTRAL,
    module: null,
    anyPermission: [],
    blocks: [],
    ...overrides,
  }
}

function part(title: string, ...topics: HandbookTopic[]): HandbookPart {
  return {
    id: normalizeText(title).replace(/[^a-z0-9]+/g, '-'),
    title,
    icon: 'info',
    summary: NEUTRAL,
    topics,
  }
}

function screen(route: string, title: string, overrides: Partial<PageHelp> = {}): PageHelp {
  return {
    route,
    title,
    module: null,
    anyPermission: [],
    purpose: NEUTRAL,
    actions: [],
    tasks: [],
    rules: [],
    next: [],
    ...overrides,
  }
}

const note = (text: string): HelpBlock => ({ kind: 'note', text })
const idsOf = (hits: readonly SearchHit[]) => hits.map((hit) => hit.entry.id)

/** Index de quelques rubriques rangées dans une seule partie. */
const indexOfTopics = (...topics: HandbookTopic[]) => buildIndex([part('Partie', ...topics)], [])

const SALE = topic('parcours-vente', 'Vendre une paire de lunettes', {
  summary: 'De la facture au reçu. Un geste après l’autre !',
  keywords: ['monture', 'Verres correcteurs'],
  intro: 'Une vente commence par une facture.',
  blocks: [
    {
      kind: 'steps',
      title: 'Les étapes',
      items: ['Ouvrez « Nouvelle facture ».', 'Ajoutez la monture.'],
    },
    { kind: 'note', tone: 'warning', text: 'Une facture émise ne se modifie plus.' },
  ],
})

const EXAM = topic('parcours-examen', 'Faire passer un examen de vue', {
  summary: 'Accueillir le patient, mesurer, puis rédiger l’ordonnance.',
  keywords: ['réfraction'],
  blocks: [
    {
      kind: 'faq',
      items: [{ q: 'Que mesure-t-on ?', a: 'La vue de chaque œil, l’œil droit d’abord.' }],
    },
  ],
})

const GLOSSARY = topic('glossaire-optique', 'Glossaire de l’optique', {
  blocks: [
    {
      kind: 'terms',
      items: [
        { term: 'Monture', definition: 'La structure qui porte les verres.' },
        { term: 'Collyre', definition: 'Un médicament qui se met dans l’œil.' },
      ],
    },
  ],
})

const INVOICES = screen('factures', 'Factures', {
  purpose: 'Retrouvez une facture et son reste à encaisser.',
  actions: [{ label: 'Nouvelle facture', effect: 'Ouvre un brouillon.' }],
  tasks: [
    {
      id: 'retrouver',
      title: 'Retrouver une facture',
      steps: ['Saisissez le numéro EE-2026-0001.'],
      result: 'La facture s’ouvre.',
    },
    { id: 'sans-resultat', title: 'Fermer la liste', steps: ['Cliquez sur « Fermer ».'] },
  ],
  rules: ['Une facture émise ne se modifie plus.'],
  tips: ['Cherchez aussi par patient.'],
  problems: [{ symptom: 'Aucun résultat', remedy: 'Vérifiez le numéro.' }],
  terms: ['Reste à encaisser'],
})

const CASH = screen('caisse', 'Caisse', {
  purpose: 'Ouvrir la caisse, encaisser, compter les espèces.',
  rules: ['La caisse du jour se ferme chaque soir.'],
})

const PARTS = deepFreeze([part('Parcours pas à pas', SALE, EXAM), part('Glossaire', GLOSSARY)])
const PAGES = deepFreeze([INVOICES, CASH])
const CABINET = buildIndex(PARTS, PAGES)

describe('normalizeText : la forme sous laquelle on compare', () => {
  it('passe en minuscules et retire les accents', () => {
    expect(normalizeText('ÉCRAN')).toBe('ecran')
    expect(normalizeText('Prescription à la réfraction')).toBe('prescription a la refraction')
    expect(normalizeText('Çà, où ? Ïl ôte sa forêt, ûn Âne')).toBe(
      'ca, ou ? il ote sa foret, un ane',
    )
  })

  it('écrit la ligature œ en deux lettres, en minuscule comme en majuscule', () => {
    expect(normalizeText('œil')).toBe('oeil')
    expect(normalizeText('Œil droit')).toBe('oeil droit')
    expect(normalizeText('CŒUR')).toBe('coeur')
    expect(normalizeText('sœur')).toBe('soeur')
  })

  it('ramène les apostrophes typographiques à l’apostrophe droite', () => {
    expect(normalizeText('l’œil')).toBe("l'oeil")
    expect(normalizeText('l‘œil')).toBe("l'oeil")
    expect(normalizeText('lʼœil')).toBe("l'oeil")
    expect(normalizeText("l'œil")).toBe("l'oeil")
  })

  it('replie toute suite d’espaces, insécables comprises, en une seule et rogne les bords', () => {
    expect(normalizeText('  a \t b\n\nc d e  ')).toBe('a b c d e')
    expect(normalizeText('80 000 FCFA')).toBe('80 000 fcfa')
    expect(normalizeText('   ')).toBe('')
    expect(normalizeText('')).toBe('')
  })

  it('retire aussi les accents déjà décomposés', () => {
    expect(normalizeText('réfraction')).toBe('refraction')
  })

  it('garde chiffres, tirets et ponctuation : un numéro de dossier reste cherchable', () => {
    expect(normalizeText('EE-2026-0001')).toBe('ee-2026-0001')
    expect(normalizeText('Reste : 50 000 FCFA ?')).toBe('reste : 50 000 fcfa ?')
  })

  it('donne la même forme à toutes les écritures d’un même mot', () => {
    const forms = ['Réfraction', 'RÉFRACTION', 'réfraction', 'refraction', 'réfraction']

    expect(new Set(forms.map((form) => normalizeText(form))).size).toBe(1)
  })

  it('est idempotente', () => {
    const texts = [
      'Œil rouge / inflammation',
      'L’acuité visuelle',
      '  Reçu   n 12  ',
      'EE-2026-0001',
    ]

    for (const text of texts) expect(normalizeText(normalizeText(text))).toBe(normalizeText(text))
  })
})

describe('queryWords : les mots d’une requête', () => {
  it('découpe sur les espaces et normalise chaque mot', () => {
    expect(queryWords('  Ordonnance   Médicaments ')).toEqual(['ordonnance', 'medicaments'])
    expect(queryWords('L’ŒIL droit')).toEqual(["l'oeil", 'droit'])
  })

  it('écarte les mots d’une seule lettre', () => {
    expect(queryWords('a b cc d')).toEqual(['cc'])
    expect(queryWords('à')).toEqual([])
  })

  it('garde les mots de deux lettres : OD, OG et OU', () => {
    expect(queryWords('OD OG OU')).toEqual(['od', 'og', 'ou'])
  })

  it('ne rend aucun mot pour une requête vide ou blanche', () => {
    expect(queryWords('')).toEqual([])
    expect(queryWords(' \t\n  ')).toEqual([])
  })

  it('garde un numéro de dossier d’un seul tenant', () => {
    expect(queryWords('EE-2026-0001')).toEqual(['ee-2026-0001'])
  })
})

describe('buildIndex : une entrée par rubrique et par écran', () => {
  it('range les rubriques par partie, dans l’ordre, puis les écrans', () => {
    const index = buildIndex(
      [part('Premier', topic('a', 'A'), topic('b', 'B')), part('Second', topic('c', 'C'))],
      [screen('x', 'X'), screen('y', 'Y')],
    )

    expect(index.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'topic:a',
      'topic:b',
      'topic:c',
      'screen:x',
      'screen:y',
    ])
  })

  it('ne rend rien sans rubrique ni écran', () => {
    expect(buildIndex([], [])).toEqual([])
    expect(buildIndex([part('Vide')], [])).toEqual([])
  })

  it('décrit une rubrique : partie, textes d’origine et textes normalisés', () => {
    const entry = indexOfTopics(SALE)[0]

    expect(entry).toMatchObject({
      kind: 'topic',
      id: 'parcours-vente',
      title: 'Vendre une paire de lunettes',
      group: 'Partie',
      summary: 'De la facture au reçu. Un geste après l’autre !',
      titleKey: 'vendre une paire de lunettes',
      summaryKey: "de la facture au recu. un geste apres l'autre !",
      keywordsKey: 'monture verres correcteurs',
    })
    // Le corps réunit l'introduction et le texte de chaque bloc, jamais le titre ni le résumé.
    expect(entry?.bodyKey).toBe(
      'une vente commence par une facture. les etapes ouvrez « nouvelle facture ». ' +
        'ajoutez la monture. une facture emise ne se modifie plus.',
    )
  })

  it('range chaque rubrique sous le titre de sa partie', () => {
    const index = buildIndex(PARTS, [])

    expect(index.map((entry) => entry.group)).toEqual([
      'Parcours pas à pas',
      'Parcours pas à pas',
      'Glossaire',
    ])
  })

  it('garde en phrases d’origine le résumé puis chaque texte du corps, séparément', () => {
    expect(indexOfTopics(SALE)[0]?.sentences).toEqual([
      'De la facture au reçu.',
      'Un geste après l’autre !',
      'Une vente commence par une facture.',
      'Les étapes',
      'Ouvrez « Nouvelle facture ».',
      'Ajoutez la monture.',
      'Une facture émise ne se modifie plus.',
    ])
  })

  it('coupe les phrases après . ! ou ? suivis d’une espace, et nulle part ailleurs', () => {
    const entry = indexOfTopics(
      topic('t', 'T', {
        summary: 'Un.',
        intro: 'Premier point. Deuxième point ? Troisième point ! Quatrième : EE-2026-0001.',
      }),
    )[0]

    expect(entry?.sentences).toEqual([
      'Un.',
      'Premier point.',
      'Deuxième point ?',
      'Troisième point !',
      'Quatrième : EE-2026-0001.',
    ])
  })

  it('accepte une rubrique sans mots-clés, introduction ni bloc', () => {
    const entry = indexOfTopics(topic('t', 'Titre seul'))[0]

    expect(entry?.keywordsKey).toBe('')
    expect(entry?.bodyKey).toBe('')
    expect(entry?.sentences).toEqual([NEUTRAL])
  })

  it('décrit un écran : « Référence des écrans », purpose en résumé, terms en mots-clés', () => {
    const entry = buildIndex([], [INVOICES])[0]

    expect(SCREENS_GROUP).toBe('Référence des écrans')
    expect(entry).toMatchObject({
      kind: 'screen',
      id: 'factures',
      title: 'Factures',
      group: SCREENS_GROUP,
      summary: 'Retrouvez une facture et son reste à encaisser.',
      titleKey: 'factures',
      summaryKey: 'retrouvez une facture et son reste a encaisser.',
      keywordsKey: 'reste a encaisser',
    })
  })

  it('indexe le texte de l’écran : actions, tâches, règles, conseils et problèmes', () => {
    expect(buildIndex([], [INVOICES])[0]?.bodyKey).toBe(
      'nouvelle facture ouvre un brouillon. ' +
        "retrouver une facture saisissez le numero ee-2026-0001. la facture s'ouvre. " +
        'fermer la liste cliquez sur « fermer ». ' +
        'une facture emise ne se modifie plus. cherchez aussi par patient. ' +
        'aucun resultat verifiez le numero.',
    )
  })

  it('accepte un écran sans conseils, sans problèmes ni mots du glossaire', () => {
    const entry = buildIndex([], [CASH])[0]

    expect(entry?.keywordsKey).toBe('')
    expect(entry?.bodyKey).toBe('la caisse du jour se ferme chaque soir.')
    expect(entry?.sentences).toEqual([
      'Ouvrir la caisse, encaisser, compter les espèces.',
      'La caisse du jour se ferme chaque soir.',
    ])
  })

  it('indexe le texte de chaque type de bloc d’une rubrique', () => {
    const blocks: HelpBlock[] = [
      { kind: 'steps', title: 'Abricot', items: ['Banane'] },
      { kind: 'points', items: ['Cerise'] },
      note('Datte'),
      { kind: 'flow', stages: [{ label: 'Figue', text: 'Goyave' }] },
      { kind: 'table', head: ['Kiwi'], rows: [['Litchi']] },
      { kind: 'faq', items: [{ q: 'Mangue ?', a: 'Noix' }] },
      { kind: 'terms', items: [{ term: 'Olive', definition: 'Pomme' }] },
    ]
    const index = indexOfTopics(topic('t', 'T', { blocks }))
    const words = ['abricot', 'banane', 'cerise', 'datte', 'figue', 'goyave', 'kiwi', 'litchi']
    const more = ['mangue', 'noix', 'olive', 'pomme']

    for (const word of [...words, ...more]) {
      expect(idsOf(searchIndex(index, word)), word).toEqual(['t'])
    }
  })
})

describe('searchIndex : la recherche', () => {
  it('ne rend rien pour une requête vide, blanche ou sans mot de deux lettres', () => {
    for (const query of ['', '   ', 'a', ' a b ', ' ', '\t']) {
      expect(searchIndex(CABINET, query), JSON.stringify(query)).toEqual([])
    }
    expect(searchIndex([], 'facture')).toEqual([])
  })

  it('ne rend rien quand aucune entrée ne contient le mot', () => {
    expect(searchIndex(CABINET, 'inexistant')).toEqual([])
  })

  it('ignore un mot d’une lettre au lieu d’en faire une contrainte', () => {
    expect(idsOf(searchIndex(CABINET, 'monture x'))).toEqual(idsOf(searchIndex(CABINET, 'monture')))
  })

  it('exige tous les mots, dans n’importe quel ordre', () => {
    expect(idsOf(searchIndex(CABINET, 'monture'))).toEqual(['parcours-vente', 'glossaire-optique'])
    expect(idsOf(searchIndex(CABINET, 'monture collyre'))).toEqual(['glossaire-optique'])
    expect(idsOf(searchIndex(CABINET, 'collyre monture'))).toEqual(['glossaire-optique'])
    expect(idsOf(searchIndex(CABINET, 'monture verres'))).toEqual(
      idsOf(searchIndex(CABINET, 'verres monture')),
    )
    expect(idsOf(searchIndex(CABINET, 'monture verres'))).toEqual([
      'parcours-vente',
      'glossaire-optique',
    ])
  })

  it('ne rend rien quand les mots se trouvent dans des entrées différentes', () => {
    // « facture » est dans la vente et dans l'écran Factures ; « œil » dans l'examen et le glossaire.
    expect(idsOf(searchIndex(CABINET, 'facture'))).toEqual(['factures', 'parcours-vente'])
    expect(idsOf(searchIndex(CABINET, 'oeil'))).toEqual(['parcours-examen', 'glossaire-optique'])
    expect(searchIndex(CABINET, 'facture oeil')).toEqual([])
  })

  it('accepte des mots répartis entre le titre, les mots-clés, le résumé et le texte', () => {
    // « réfraction » est un mot-clé de l'examen, « ordonnance » son résumé, « droit » sa FAQ.
    expect(idsOf(searchIndex(CABINET, 'refraction ordonnance droit'))).toEqual(['parcours-examen'])
  })

  it('trouve une entrée par un début de mot', () => {
    expect(idsOf(searchIndex(CABINET, 'ordon'))).toEqual(['parcours-examen'])
    expect(idsOf(searchIndex(CABINET, 'enca'))).toEqual(['factures', 'caisse'])
  })

  it('ignore casse, accents, ligature œ et apostrophe typographique', () => {
    const examOnly = ['parcours-examen']

    for (const query of ['RÉFRACTION', 'réfraction', 'Refraction', 'réfraction']) {
      expect(idsOf(searchIndex(CABINET, query)), query).toEqual(examOnly)
    }
    for (const query of ['œil', 'Œil', 'oeil', 'OEIL']) {
      expect(idsOf(searchIndex(CABINET, query)), query).toEqual([
        'parcours-examen',
        'glossaire-optique',
      ])
    }
    // « l’œil » (texte) se retrouve avec l'apostrophe droite et sans la ligature, et inversement.
    for (const query of ["l'oeil", 'l’œil', 'L’ŒIL']) {
      expect(idsOf(searchIndex(CABINET, query)), query).toEqual([
        'parcours-examen',
        'glossaire-optique',
      ])
    }
  })

  it('retrouve un numéro de dossier ou de facture tel quel', () => {
    expect(idsOf(searchIndex(CABINET, 'EE-2026-0001'))).toEqual(['factures'])
    expect(idsOf(searchIndex(CABINET, 'ee-2026'))).toEqual(['factures'])
  })

  it('traite la requête comme du texte, jamais comme une expression régulière', () => {
    for (const query of ['((', '[a-z]+', '.*', '\\d+', '$^', '<script>', 'monture|collyre']) {
      expect(searchIndex(CABINET, query), query).toEqual([])
    }
  })

  it('range les rubriques et les écrans dans la même liste, avec leur partie', () => {
    const hits = searchIndex(CABINET, 'facture')

    expect(hits.map((hit) => [hit.entry.kind, hit.entry.group])).toEqual([
      ['screen', SCREENS_GROUP],
      ['topic', 'Parcours pas à pas'],
    ])
  })

  it('rend les entrées de l’index telles quelles et ne modifie ni l’index ni le contenu', () => {
    const before = CABINET.map((entry) => entry.id)
    const hits = searchIndex(CABINET, 'facture')

    expect(hits[0]?.entry).toBe(CABINET.find((entry) => entry.id === 'factures'))
    expect(hits.every((hit) => hit.score > 0)).toBe(true)
    // Le contenu est figé en profondeur : une écriture lèverait une erreur.
    expect(CABINET.map((entry) => entry.id)).toEqual(before)
  })
})

describe('searchIndex : classement', () => {
  it('place le titre avant les mots-clés, avant le résumé, avant le texte', () => {
    // Le même mot, cherché à un seul endroit de chaque rubrique, rangées exprès dans le désordre.
    const index = indexOfTopics(
      topic('corps', 'Alpha', { blocks: [note('La monture se choisit en dernier.')] }),
      topic('resume', 'Bravo', { summary: 'Choisir la monture.' }),
      topic('mots-cles', 'Charlie', { keywords: ['monture'] }),
      topic('titre', 'Choix de la monture'),
    )
    const hits = searchIndex(index, 'monture')

    expect(idsOf(hits)).toEqual(['titre', 'mots-cles', 'resume', 'corps'])
    expect(hits.map((hit) => hit.score)).toEqual(
      [...hits.map((hit) => hit.score)].sort((a, b) => b - a),
    )
    expect(new Set(hits.map((hit) => hit.score)).size).toBe(4)
  })

  it('compte les mots du glossaire d’un écran comme des mots-clés', () => {
    const index = buildIndex(
      [],
      [
        screen('texte', 'Écran A', { rules: ['L’acuité visuelle se note pour chaque œil.'] }),
        screen('mots', 'Écran B', { terms: ['Acuité visuelle'] }),
      ],
    )

    expect(idsOf(searchIndex(index, 'acuite'))).toEqual(['mots', 'texte'])
  })

  it('place un mot qui commence un mot du titre avant un mot qui le contient au milieu', () => {
    const index = indexOfTopics(
      topic('milieu', 'Autoréfraction'),
      topic('debut', 'Réfraction subjective'),
    )

    expect(idsOf(searchIndex(index, 'refraction'))).toEqual(['debut', 'milieu'])
  })

  it('cumule les mots de la requête : plus ils sont dans le titre, mieux l’entrée est classée', () => {
    const index = indexOfTopics(
      topic('un-mot', 'Facture émise', { blocks: [note('Le reçu suit.')] }),
      topic('deux-mots', 'Facture et reçu'),
      topic('aucun-titre', 'Autre', { blocks: [note('Une facture, un reçu.')] }),
    )

    expect(idsOf(searchIndex(index, 'facture recu'))).toEqual([
      'deux-mots',
      'un-mot',
      'aucun-titre',
    ])
  })

  it('départage à score égal par l’ordre alphabétique français du titre', () => {
    // Trois rubriques où « carte » n'est que dans le texte : même score. Un tri par code de caractère
    // renverrait « Écran » en dernier (É vient après Z) ; l'alphabet français le place avant « Zéro ».
    const index = indexOfTopics(
      topic('zero', 'Zéro papier', { blocks: [note('La carte suffit.')] }),
      topic('accueil', 'Accueil', { blocks: [note('La carte suffit.')] }),
      topic('ecran', 'Écran de veille', { blocks: [note('La carte suffit.')] }),
    )
    const hits = searchIndex(index, 'carte')

    expect(new Set(hits.map((hit) => hit.score)).size).toBe(1)
    expect(idsOf(hits)).toEqual(['accueil', 'ecran', 'zero'])
  })
})

describe('searchIndex : limite', () => {
  const weak = Array.from({ length: 40 }, (_, position) =>
    topic(`faible-${position}`, `Rubrique ${String(position).padStart(2, '0')}`, {
      blocks: [note('Le mot carte apparaît ici.')],
    }),
  )
  const strong = [
    topic('fort-1', 'Carte de fidélité'),
    topic('fort-2', 'Ma carte'),
    topic('fort-3', 'Cartes'),
  ]

  it('rend 30 résultats au plus par défaut', () => {
    const hits = searchIndex(indexOfTopics(...weak), 'carte')

    expect(hits).toHaveLength(30)
    expect(idsOf(hits)).toEqual(weak.slice(0, 30).map((rubrique) => rubrique.id))
  })

  it('rend la limite demandée, ou tout si elle est plus grande que le nombre de résultats', () => {
    const index = indexOfTopics(...weak)

    expect(searchIndex(index, 'carte', 5)).toHaveLength(5)
    expect(searchIndex(index, 'carte', 1000)).toHaveLength(40)
    expect(searchIndex(index, 'carte', 0)).toEqual([])
  })

  it('garde les mieux classées quand la limite coupe', () => {
    // Les rubriques fortes sont rangées APRÈS les quarante faibles : seul le score les fait remonter.
    const hits = searchIndex(indexOfTopics(...weak, ...strong), 'carte', 3)

    expect(new Set(idsOf(hits))).toEqual(new Set(['fort-1', 'fort-2', 'fort-3']))
  })
})

describe('searchIndex : extrait', () => {
  function snippetOf(topics: HandbookTopic[], query: string): string | undefined {
    return searchIndex(indexOfTopics(...topics), query)[0]?.snippet
  }

  it('cite la première phrase qui contient le mot, avec ses accents et sa casse d’origine', () => {
    const sheet = topic('t', 'Rubrique', {
      summary: 'Accueillir le patient.',
      intro: 'Première étape : rédiger l’Ordonnance. Deuxième étape : l’imprimer.',
    })

    expect(snippetOf([sheet], 'ORDONNANCE')).toBe('Première étape : rédiger l’Ordonnance.')
    expect(snippetOf([sheet], 'redige')).toBe('Première étape : rédiger l’Ordonnance.')
  })

  it('cherche le premier mot de la requête, pas les suivants', () => {
    const sheet = topic('t', 'Rubrique', {
      intro: 'Première étape : rédiger l’ordonnance. Deuxième étape : l’imprimer.',
    })

    expect(snippetOf([sheet], 'imprimer ordonnance')).toBe('Deuxième étape : l’imprimer.')
    expect(snippetOf([sheet], 'ordonnance imprimer')).toBe('Première étape : rédiger l’ordonnance.')
  })

  it('commence par le résumé, avant le corps', () => {
    const sheet = topic('t', 'Rubrique', {
      summary: 'Lire la facture.',
      intro: 'La facture est définitive.',
    })

    expect(snippetOf([sheet], 'facture')).toBe('Lire la facture.')
  })

  it('reste vide quand seul le titre contient le mot', () => {
    const hits = searchIndex(indexOfTopics(topic('t', 'Glaucome')), 'glaucome')

    expect(idsOf(hits)).toEqual(['t'])
    expect(hits[0]?.snippet).toBe('')
  })

  it('cite aussi les phrases d’un écran', () => {
    const hits = searchIndex(CABINET, 'brouillon')

    expect(hits[0]?.entry.id).toBe('factures')
    expect(hits[0]?.snippet).toBe('Ouvre un brouillon.')
  })

  it('garde une phrase de 180 caractères entière et coupe au-delà à 177 plus « … »', () => {
    const lead = 'Le mot cherché ouvre cette phrase : '
    const exactly180 = lead + 'a'.repeat(180 - lead.length)
    const exactly181 = lead + 'a'.repeat(181 - lead.length)

    expect(exactly180).toHaveLength(180)
    expect(exactly181).toHaveLength(181)
    expect(snippetOf([topic('t', 'Rubrique', { intro: exactly180 })], 'cherche')).toBe(exactly180)

    const cut = snippetOf([topic('t', 'Rubrique', { intro: exactly181 })], 'cherche')

    expect(cut).toBe(`${exactly181.slice(0, 177)}…`)
    expect(cut).toHaveLength(178)
  })
})

describe('un index limité aux droits du compte', () => {
  const MANAGER_ONLY = topic('guide-gerante', 'Guide de la gérante', {
    anyPermission: ['users.manage'],
    blocks: [note('Créez les comptes du personnel.')],
  })
  const FOR_ALL = topic('bienvenue', 'Bienvenue', { blocks: [note('Voici votre journée.')] })
  const SETTINGS = topic('reglages', 'Réglages du poste', {
    module: 'settings',
    blocks: [note('Choisissez la langue du personnel.')],
  })

  /** Ce que fait l'écran Documentation : ne passer à l'index que ce que le compte peut lire. */
  function indexFor(permissions: readonly string[], modules: readonly string[]) {
    const readable = [part('Tout', FOR_ALL, MANAGER_ONLY, SETTINGS)].map((candidate) => ({
      ...candidate,
      topics: candidate.topics.filter((rubrique) => hasAccess(rubrique, permissions, modules)),
    }))
    return buildIndex(readable, [])
  }

  it('ne retrouve jamais une rubrique que le compte n’a pas le droit de lire', () => {
    expect(idsOf(searchIndex(indexFor([], ['patients']), 'personnel'))).toEqual([])
    expect(idsOf(searchIndex(indexFor(['users.manage'], ['patients']), 'personnel'))).toEqual([
      'guide-gerante',
    ])
  })

  it('ne retrouve pas non plus une rubrique dont le module est fermé', () => {
    expect(idsOf(searchIndex(indexFor([], ['patients']), 'langue'))).toEqual([])
    expect(idsOf(searchIndex(indexFor([], ['settings']), 'langue'))).toEqual(['reglages'])
  })
})

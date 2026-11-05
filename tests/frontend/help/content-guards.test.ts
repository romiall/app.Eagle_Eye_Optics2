import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createEeoRouter } from '@/app/router'
import { HANDBOOK_TOPICS, PART_PLANS } from '@/domain/help/handbook'
import type { HandbookTopic, PageHelp } from '@/domain/help/model'
import { PAGE_HELP } from '@/domain/help/pages'
import { KNOWN_MODULES, PROFILES } from '@/domain/help/profiles'

import {
  type CheckContext,
  checkPage,
  checkTexts,
  checkTopic,
  errorsOf,
  formatProblem,
  glossaryDefinitions,
  normalizeExceptions,
  type Problem,
  routeFacts,
  warningsOf,
} from './support/checks'
import {
  LabelCorpus,
  locateEntry,
  readApplicationSources,
  readContentFiles,
  readSeed,
  readServerModules,
} from './support/sources'

/**
 * Contrat automatique du VRAI contenu de l'aide intégrée (`PAGE_HELP` de pages.ts, `HANDBOOK_*` de
 * handbook.ts), port du vérificateur de rédaction : chaque libellé cité « entre guillemets » et chaque
 * libellé d'action existent dans l'application, chaque lien mène quelque part, `module` et droits
 * d'une fiche égalent ceux de sa route, aucun texte ne dit « payé », « soldé », « acquitté » ni
 * « gratuit », ne laisse de marque d'inachevé ni ne promet ce que l'application ne fait pas, les
 * longueurs et les champs obligatoires sont tenus ; puis la couverture (une fiche par écran, les
 * rubriques du plan), le glossaire et les rubriques de mise en service.
 *
 * Lire un échec : chaque ligne dit `fichier › entrée › champ : constat — valeur`. Les libellés se
 * vérifient dans le code de l'application (`resources/frontend/**` hors contenu de l'aide, et le
 * semis des données de référence) ; un libellé qui ne peut pas y figurer tel quel se déclare dans
 * LABEL_EXCEPTIONS, avec sa raison. Les avertissements (dépassement modéré d'une limite, titre
 * différent de la route, typographie) sont affichés sans bloquer ; `EEO_HELP_STRICT=1` les bloque.
 * Les mécanismes eux-mêmes sont éprouvés dans `content-checks.test.ts`.
 */

/**
 * Libellés cités par l'aide qui ne figurent pas tels quels dans le code (par exemple un message
 * assemblé à l'exécution). Clé : le libellé ; valeur : pourquoi il est inévitable. Une exception
 * qui existe en fait dans le code, ou qui n'a pas de raison, fait échouer le contrat.
 */
const LABEL_EXCEPTIONS: Readonly<Record<string, string>> = {}

const STRICT = process.env['EEO_HELP_STRICT'] === '1'

/** Écrans publics (sans session) : leur fiche est facultative, celle de tout autre écran est obligatoire. */
const PUBLIC_ROUTES = ['connexion', 'deverrouiller']

const PART_IDS = [
  'demarrer',
  'parcours',
  'guides-profils',
  'notions',
  'glossaire',
  'depannage',
  'mise-en-service',
]

const GLOSSARY_TOPICS = ['glossaire-optique', 'glossaire-gestion']

/** Termes que « Mots utiles » (PageHelpView) relie à glossaire-optique ; tout autre terme mène à glossaire-gestion. */
const OPTICAL_TERMS = [
  'OD',
  'OG',
  'OU',
  'Acuité visuelle',
  'Autoréfracteur',
  'Réfraction subjective',
  'Sphère',
  'Cylindre',
  'Axe',
  'Addition',
  'Écart pupillaire',
  'Dioptrie',
  'Prescription optique',
  'Ordonnance de médicaments',
  'Ordonnance externe',
  'Orientation',
  'Contrôle recommandé',
  'Monture',
  'Verres',
  'Collyre',
]

const FIX_HINT = 'Corriger le fichier de contenu indiqué (guide : docs/implementation/help.md).'

const LABELS = new LabelCorpus(readApplicationSources())
const CONTENT_FILES = readContentFiles()
const SEED = readSeed()
const ROUTES = routeFacts(createEeoRouter(createMemoryHistory()).getRoutes())
const DEFINITIONS = glossaryDefinitions(HANDBOOK_TOPICS, GLOSSARY_TOPICS)
const PLAN_IDS = PART_PLANS.flatMap((part) => part.topicIds)

const CTX: CheckContext = {
  labels: LABELS,
  labelExceptions: normalizeExceptions(LABEL_EXCEPTIONS),
  routes: ROUTES,
  topicIds: new Set(HANDBOOK_TOPICS.map((topic) => topic.id)),
  permissionCodes: SEED.permissions,
  glossaryTerms: new Set(DEFINITIONS.keys()),
  knownModules: new Set(KNOWN_MODULES),
  profileCodes: new Set(PROFILES.map((profile) => profile.code)),
}

const pageOrigin = (page: PageHelp): string => locateEntry(CONTENT_FILES, 'page', page.route)
const topicOrigin = (topic: HandbookTopic): string => locateEntry(CONTENT_FILES, 'topic', topic.id)
const pageName = (page: PageHelp): string => `fiche « ${page.route} »`
const topicName = (topic: HandbookTopic): string => `rubrique « ${topic.id} »`

function lines(origin: string, entry: string, problems: readonly Problem[]): string[] {
  return problems.map((problem) => formatProblem(origin, entry, problem))
}

describe('couverture des écrans', () => {
  const covered = PAGE_HELP.map((page) => page.route)

  it('le routeur déclare des écrans publics connus', () => {
    expect(ROUTES.size).toBeGreaterThan(20)
    const found = [...ROUTES.values()].filter((route) => route.isPublic).map((route) => route.name)
    expect(
      found.sort(),
      'Écran public nouveau ou retiré : mettre à jour PUBLIC_ROUTES (ou écrire sa fiche).',
    ).toEqual([...PUBLIC_ROUTES].sort())
  })

  it('chaque route nommée, hors écrans publics, a une fiche d’aide', () => {
    const missing = [...ROUTES.values()]
      .filter((route) => !route.isPublic && !covered.includes(route.name))
      .map((route) => `${route.name} (${route.title ?? 'sans titre'})`)
    expect(
      missing,
      'Routes sans fiche : ajouter la fiche (même nom que la route) dans domain/help/content/pages-*.ts.',
    ).toEqual([])
  })

  it('chaque fiche correspond à une route du routeur', () => {
    const orphans = PAGE_HELP.filter((page) => !ROUTES.has(page.route)).map((page) =>
      formatProblem(pageOrigin(page), pageName(page), {
        level: 'error',
        field: 'route',
        message: 'aucune route nommée ainsi dans router.ts',
        value: page.route,
      }),
    )
    expect(orphans).toEqual([])
  })

  it('une seule fiche par route', () => {
    const doubles = covered
      .filter((route, index) => covered.indexOf(route) !== index)
      .map((route) => `${route} : fiches dans ${locateEntry(CONTENT_FILES, 'page', route)}`)
    expect(doubles).toEqual([])
  })
})

describe('plan de la documentation', () => {
  const written = HANDBOOK_TOPICS.map((topic) => topic.id)

  it('les parties du plan sont celles du guide, dans l’ordre', () => {
    expect(PART_PLANS.map((part) => part.id)).toEqual(PART_IDS)
  })

  it('chaque partie du plan a un titre, une icône et un résumé sans mot interdit', () => {
    const problems = PART_PLANS.flatMap((part) =>
      lines(
        'domain/help/handbook.ts',
        `partie « ${part.id} »`,
        checkTexts({ title: part.title, icon: part.icon, summary: part.summary }, CTX),
      ),
    )
    expect(problems).toEqual([])
  })

  it(`les ${PLAN_IDS.length} identifiants de rubrique du plan sont tous distincts`, () => {
    const doubles = PLAN_IDS.filter((id, index) => PLAN_IDS.indexOf(id) !== index)
    expect(doubles, 'Une rubrique est rangée dans deux parties de PART_PLANS.').toEqual([])
  })

  it(`les ${PLAN_IDS.length} rubriques du plan existent toutes`, () => {
    const missing = PLAN_IDS.filter((id) => !written.includes(id))
    expect(missing, 'Rubriques du plan sans contenu (domain/help/content/handbook-*.ts).').toEqual(
      [],
    )
  })

  it('aucune rubrique n’est hors plan (aucun lien ne pourrait y mener)', () => {
    const outside = HANDBOOK_TOPICS.filter((topic) => !PLAN_IDS.includes(topic.id)).map(
      (topic) =>
        `${topicOrigin(topic)} › ${topicName(topic)} : absente de PART_PLANS (handbook.ts)`,
    )
    expect(outside).toEqual([])
  })

  it('aucun identifiant de rubrique en double', () => {
    const doubles = written
      .filter((id, index) => written.indexOf(id) !== index)
      .map((id) => `${id} : déclarée dans ${locateEntry(CONTENT_FILES, 'topic', id)}`)
    expect(doubles).toEqual([])
  })

  it('les rubriques de la partie « Mise en service » exigent users.manage', () => {
    const part = PART_PLANS.find((candidate) => candidate.id === 'mise-en-service')
    expect(part, 'La partie « mise-en-service » manque à PART_PLANS.').toBeDefined()
    const wrong = (part?.topicIds ?? []).flatMap((id) => {
      const topic = HANDBOOK_TOPICS.find((candidate) => candidate.id === id)
      if (topic === undefined) return [`${id} : rubrique absente`]
      const actual = [...topic.anyPermission].sort().join(', ')
      return actual === 'users.manage'
        ? []
        : [
            `${topicOrigin(topic)} › ${topicName(topic)} › anyPermission : [${actual}] au lieu de [users.manage]`,
          ]
    })
    expect(wrong).toEqual([])
  })
})

describe('glossaire', () => {
  it('les rubriques glossaire-optique et glossaire-gestion définissent des termes', () => {
    for (const id of GLOSSARY_TOPICS) {
      const defined = [...DEFINITIONS.values()].filter((topics) => topics.includes(id))
      expect(defined.length, `${id} : aucun bloc « terms » ou rubrique absente`).toBeGreaterThan(0)
    }
  })

  it('chaque terme du glossaire y est défini une seule fois', () => {
    const doubles = [...DEFINITIONS]
      .filter(([, topics]) => topics.length > 1)
      .map(([term, topics]) => `« ${term} » défini ${topics.length} fois (${topics.join(', ')})`)
    expect(doubles).toEqual([])
  })

  it('les termes d’optique sont définis par glossaire-optique, et seulement eux', () => {
    const optical = [...DEFINITIONS]
      .filter(([, topics]) => topics.includes('glossaire-optique'))
      .map(([term]) => term)
    expect(
      {
        manquants: OPTICAL_TERMS.filter((term) => !optical.includes(term)),
        enTrop: optical.filter((term) => !OPTICAL_TERMS.includes(term)),
      },
      'PageHelpView relie ces vingt termes à glossaire-optique et tous les autres à glossaire-gestion.',
    ).toEqual({ manquants: [], enTrop: [] })
  })
})

describe('fiches d’écran : contrat de rédaction', () => {
  it.each(PAGE_HELP.map((page) => ({ route: page.route, page })))(
    'fiche « $route » : libellés, liens, droits, longueurs, glossaire, promesses',
    ({ page }) => {
      expect(
        lines(pageOrigin(page), pageName(page), errorsOf(checkPage(page, CTX))),
        FIX_HINT,
      ).toEqual([])
    },
    30_000,
  )
})

describe('rubriques de la documentation : contrat de rédaction', () => {
  it.each(HANDBOOK_TOPICS.map((topic) => ({ id: topic.id, topic })))(
    'rubrique « $id » : libellés, liens, droits, blocs, promesses',
    ({ topic }) => {
      expect(
        lines(topicOrigin(topic), topicName(topic), errorsOf(checkTopic(topic, CTX))),
        FIX_HINT,
      ).toEqual([])
    },
    30_000,
  )
})

describe('profils, droits et modules', () => {
  it('les profils de profiles.ts sont ceux du semis', () => {
    expect(PROFILES.map((profile) => profile.code).sort()).toEqual([...SEED.roles].sort())
  })

  it.each(PROFILES.map((profile) => ({ code: profile.code, profile })))(
    'droits du profil $code : égaux à role_permissions du semis',
    ({ code, profile }) => {
      expect([...profile.permissions].sort()).toEqual(
        [...(SEED.rolePermissions.get(code) ?? [])].sort(),
      )
    },
  )

  it('KNOWN_MODULES ne contient que des modules connus du serveur (Modules.php)', () => {
    const server = new Set(readServerModules())
    expect(KNOWN_MODULES.filter((module) => !server.has(module))).toEqual([])
  })

  it('chaque module déclaré par une route est connu de l’aide (KNOWN_MODULES)', () => {
    const unknown = [...ROUTES.values()]
      .filter((route) => route.module !== null && !KNOWN_MODULES.includes(route.module))
      .map((route) => `${route.name} : ${route.module}`)
    expect(unknown).toEqual([])
  })
})

describe('exceptions de libellés', () => {
  it('chaque exception a une raison et n’existe pas déjà dans le code', () => {
    const faulty = Object.entries(LABEL_EXCEPTIONS).flatMap(([label, reason]) => {
      if (reason.trim() === '') return [`« ${label} » : raison absente`]
      return LABELS.has(label)
        ? [`« ${label} » : existe dans le code, l’exception est inutile`]
        : []
    })
    expect(faulty).toEqual([])
  })
})

describe('avertissements de rédaction', () => {
  it('sont affichés sans bloquer (EEO_HELP_STRICT=1 les bloque)', () => {
    const warnings = [
      ...PAGE_HELP.flatMap((page) =>
        lines(pageOrigin(page), pageName(page), warningsOf(checkPage(page, CTX))),
      ),
      ...HANDBOOK_TOPICS.flatMap((topic) =>
        lines(topicOrigin(topic), topicName(topic), warningsOf(checkTopic(topic, CTX))),
      ),
    ]
    if (warnings.length > 0) {
      console.warn(`${warnings.length} avertissement(s) de rédaction :\n${warnings.join('\n')}`)
    }
    if (STRICT) expect(warnings).toEqual([])
  })
})

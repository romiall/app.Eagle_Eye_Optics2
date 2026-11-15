// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FORBIDDEN_SETTLEMENT_WORDS } from '@/domain/billing/payment'

/**
 * Registre final du gate G7 (`docs/evidence/requirements-final.json`) : il ne peut pas dériver en silence. Les énoncés et
 * les lots viennent de la matrice de traçabilité (fichier 17) et du fichier 14 mot pour mot ; chaque exigence a son
 * statut, ses preuves (fichiers et tests qui EXISTENT) et ses écarts nommés ; un scénario non réussi ou une intégration
 * simulée interdit le statut DONE ; les totaux sont ceux des enregistrements et ceux de `docs/evidence/G7.md`. Ce test
 * ne juge pas que le projet est livré : il juge que le registre dit vrai.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..')

interface Evidence {
  kind: string
  path: string
  tests: string[]
}
interface Gap {
  kind: string
  owner: string
  detail: string
  blocks_delivery: boolean
}
interface Requirement {
  id: string
  title: string
  matrix_lot: string
  status: string
  integration_mode: string
  scenarios: { id: string; result: string }[]
  evidence: Evidence[]
  gaps: Gap[]
  note: string | null
}
interface AfterScenario {
  id: string
  lot: string
  expected: string
  result: string
  mode: string
  observed: string
  evidence: Evidence[]
  limits: string[]
}
interface Register {
  summary: Record<string, number>
  scenarios_after_l0_summary: Record<string, number>
  requirements: Requirement[]
  scenarios_after_l0: AfterScenario[]
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')
const register = JSON.parse(read('docs/evidence/requirements-final.json')) as Register
const l0 = JSON.parse(read('docs/evidence/acceptance-L0.json')) as {
  scenarios: { id: string; result: string }[]
}

const STATUSES = ['DONE', 'DONE_WITH_RESERVES', 'PARTIAL']
const GAP_KINDS = [
  'simulated',
  'people',
  'hardware',
  'client',
  'decision',
  'not_built',
  'open_count',
]
const AUTOMATED = ['PHPUnit', 'Vitest', 'Playwright']

const matrix = new Map<string, { title: string; lot: string; scenarios: string }>()
for (const line of read('specifications/17-matrice-tracabilite.md').split('\n')) {
  const match = /^\| (EE\d{3}) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/.exec(line)
  if (match !== null) {
    matrix.set(match[1] ?? '', {
      title: (match[2] ?? '').trim(),
      lot: (match[4] ?? '').trim(),
      scenarios: (match[6] ?? '').trim(),
    })
  }
}

const spec14 = new Map<string, { lot: string; expected: string }>()
for (const line of read('specifications/14-recette-et-scenarios.md').split('\n')) {
  const match = /^\| (AT\d\d) \| (L\d(?:\/L\d)?) \| (.*?) \|$/.exec(line)
  if (match !== null && !spec14.has(match[1] ?? '')) {
    spec14.set(match[1] ?? '', { lot: match[2] ?? '', expected: (match[3] ?? '').trim() })
  }
}

const results = new Map<string, string>([
  ...l0.scenarios.map((scenario): [string, string] => [scenario.id, scenario.result]),
  ...register.scenarios_after_l0.map((scenario): [string, string] => [
    scenario.id,
    scenario.result,
  ]),
])

/** Les scénarios cités par une ligne de la matrice : « AT10–AT17 AT38–AT42 » est développé. */
function scenarioIds(text: string): string[] {
  const ids: string[] = []
  for (const token of text.match(/AT\d\d(?:[–-]AT\d\d)?/g) ?? []) {
    const [from, to] = token.split(/[–-]/)
    if (to === undefined) ids.push(token)
    else {
      for (let n = Number((from ?? '').slice(2)); n <= Number(to.slice(2)); n += 1) {
        ids.push(`AT${String(n).padStart(2, '0')}`)
      }
    }
  }
  return ids
}

function checkEvidence(entry: Evidence): string[] {
  const problems: string[] = []
  if (!existsSync(join(ROOT, entry.path))) return [`fichier absent : ${entry.path}`]
  const text = read(entry.path)
  for (const name of entry.tests) {
    if (!text.includes(name)) problems.push(`${entry.path} ne contient pas « ${name} »`)
  }
  return problems
}

describe('registre final des exigences (G7)', () => {
  it('couvre EE001 à EE046 dans l’ordre, avec l’énoncé et le lot de la matrice mot pour mot', () => {
    expect(register.requirements.map((requirement) => requirement.id)).toEqual(
      Array.from({ length: 46 }, (_, index) => `EE${String(index + 1).padStart(3, '0')}`),
    )
    for (const requirement of register.requirements) {
      expect(requirement.title, requirement.id).toBe(matrix.get(requirement.id)?.title)
      expect(requirement.matrix_lot, requirement.id).toBe(matrix.get(requirement.id)?.lot)
    }
  })

  it('donne à chaque exigence un statut connu, des preuves existantes et, hors DONE, des écarts nommés', () => {
    const problems: string[] = []
    for (const requirement of register.requirements) {
      const label = requirement.id
      if (!STATUSES.includes(requirement.status)) problems.push(`${label} : statut inconnu`)
      if (requirement.scenarios.length + requirement.evidence.length === 0) {
        problems.push(`${label} : aucune preuve`)
      }
      for (const entry of requirement.evidence) {
        problems.push(...checkEvidence(entry).map((problem) => `${label} : ${problem}`))
      }
      if (requirement.status === 'DONE' && requirement.gaps.length > 0) {
        problems.push(`${label} : DONE avec des écarts`)
      }
      if (requirement.status !== 'DONE' && requirement.gaps.length === 0) {
        problems.push(`${label} : ${requirement.status} sans écart nommé`)
      }
      if (
        requirement.status === 'PARTIAL' &&
        !requirement.gaps.some((gap) => gap.blocks_delivery)
      ) {
        problems.push(
          `${label} : PARTIAL sans écart qui bloque la livraison de la partie manquante`,
        )
      }
      for (const gap of requirement.gaps) {
        if (!GAP_KINDS.includes(gap.kind))
          problems.push(`${label} : type d’écart inconnu « ${gap.kind} »`)
        if (gap.owner.trim() === '' || gap.detail.trim() === '') {
          problems.push(`${label} : écart sans responsable ou sans détail`)
        }
        if (typeof gap.blocks_delivery !== 'boolean')
          problems.push(`${label} : blocks_delivery manquant`)
      }
    }
    expect(problems).toEqual([])
  })

  it('cite tous les scénarios de sa ligne de la matrice, avec leur résultat réel, et n’est jamais DONE si l’un échoue', () => {
    const problems: string[] = []
    for (const requirement of register.requirements) {
      const expected = scenarioIds(matrix.get(requirement.id)?.scenarios ?? '').filter((id) =>
        results.has(id),
      )
      expect(
        requirement.scenarios.map((scenario) => scenario.id),
        requirement.id,
      ).toEqual(expected)
      for (const scenario of requirement.scenarios) {
        if (results.get(scenario.id) !== scenario.result) {
          problems.push(
            `${requirement.id} : ${scenario.id} vaut ${results.get(scenario.id)}, pas ${scenario.result}`,
          )
        }
        if (scenario.result !== 'PASS' && requirement.status === 'DONE') {
          problems.push(`${requirement.id} : DONE alors que ${scenario.id} est ${scenario.result}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('n’annonce jamais une intégration simulée comme active', () => {
    const simulated = register.requirements.filter(
      (requirement) => requirement.integration_mode === 'fake',
    )
    expect(simulated.map((requirement) => requirement.id).length).toBeGreaterThanOrEqual(8)
    for (const requirement of simulated) {
      expect(requirement.status, requirement.id).not.toBe('DONE')
      expect(
        requirement.gaps.some((gap) => gap.kind === 'simulated'),
        `${requirement.id} doit nommer l’écart « simulated »`,
      ).toBe(true)
    }
    // Les canaux externes de la matrice (Google, rappels, WhatsApp, Kommo, assistant, connaissances) restent PARTIAL.
    for (const id of ['EE031', 'EE032', 'EE035', 'EE036', 'EE037', 'EE038']) {
      expect(register.requirements.find((requirement) => requirement.id === id)?.status, id).toBe(
        'PARTIAL',
      )
    }
  })

  it('a des totaux égaux à ceux des enregistrements et à ceux du bilan de G7.md', () => {
    const counted: Record<string, number> = { total: register.requirements.length }
    for (const requirement of register.requirements) {
      counted[requirement.status] = (counted[requirement.status] ?? 0) + 1
    }
    expect(register.summary).toEqual(counted)
    const bilan = /Bilan : (\d+) DONE · (\d+) DONE_WITH_RESERVES · (\d+) PARTIAL sur (\d+)/.exec(
      read('docs/evidence/G7.md'),
    )
    expect(
      bilan,
      'G7.md doit porter la ligne « Bilan : n DONE · n DONE_WITH_RESERVES · n PARTIAL sur n »',
    ).not.toBeNull()
    expect(bilan?.slice(1).map(Number)).toEqual([
      counted['DONE'] ?? 0,
      counted['DONE_WITH_RESERVES'] ?? 0,
      counted['PARTIAL'] ?? 0,
      counted['total'],
    ])
  })
})

describe('scénarios AT30 à AT35 du registre final', () => {
  it('reprennent le lot et l’attendu du fichier 14 mot pour mot', () => {
    expect(register.scenarios_after_l0.map((scenario) => scenario.id)).toEqual([
      'AT30',
      'AT31',
      'AT32',
      'AT33',
      'AT34',
      'AT35',
    ])
    for (const scenario of register.scenarios_after_l0) {
      expect(scenario.lot, scenario.id).toBe(spec14.get(scenario.id)?.lot)
      expect(scenario.expected, scenario.id).toBe(spec14.get(scenario.id)?.expected)
    }
  })

  it('reposent sur des tests automatisés qui existent, et disent leurs limites quand le mode est simulé', () => {
    const problems: string[] = []
    for (const scenario of register.scenarios_after_l0) {
      if (
        scenario.result === 'PASS' &&
        !scenario.evidence.some((entry) => AUTOMATED.includes(entry.kind))
      ) {
        problems.push(`${scenario.id} : PASS sans test automatisé`)
      }
      for (const entry of scenario.evidence) {
        problems.push(...checkEvidence(entry).map((problem) => `${scenario.id} : ${problem}`))
      }
      if (scenario.mode === 'fake' && scenario.limits.length === 0) {
        problems.push(`${scenario.id} : mode simulé sans limite déclarée`)
      }
    }
    const passed = register.scenarios_after_l0.filter(
      (scenario) => scenario.result === 'PASS',
    ).length
    expect(register.scenarios_after_l0_summary).toEqual({
      PASS: passed,
      total: register.scenarios_after_l0.length,
    })
    expect(problems).toEqual([])
  })
})

describe('vocabulaire du registre', () => {
  it('n’emploie dans ses propres textes aucun mot de règlement interdit (payé, soldé, acquitté, gratuit)', () => {
    // Les énoncés de la matrice et du fichier 14 sont cités mot pour mot (ils disent « payé ») : seuls les textes écrits ici sont jugés.
    const authored = [
      ...register.requirements.flatMap((requirement) => [
        requirement.note ?? '',
        ...requirement.gaps.map((gap) => gap.detail),
      ]),
      ...register.scenarios_after_l0.flatMap((scenario) => [scenario.observed, ...scenario.limits]),
    ]
      .join(' ')
      .toLowerCase()
    expect(FORBIDDEN_SETTLEMENT_WORDS.filter((word) => authored.includes(word))).toEqual([])
  })
})

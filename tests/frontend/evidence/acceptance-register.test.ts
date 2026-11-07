// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Registre de recette L0 du gate G3 (`docs/evidence/acceptance-L0.json`, fichier 25 « Registre de preuves ») : il ne peut
 * pas dériver en silence. Les énoncés viennent du fichier 14 mot pour mot, chaque PASS repose sur au moins un test
 * automatisé, chaque BLOCKED dit lequel de ses volets l'est et pourquoi, chaque test cité existe dans son fichier (un test
 * renommé ou supprimé fait échouer la CI au lieu de laisser une preuve fantôme), et les totaux sont ceux des
 * enregistrements. Ce test ne juge pas que la recette est réussie : il juge que le registre dit vrai.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..')

interface Evidence {
  kind: string
  path: string
  tests: string[]
}
interface Part {
  part: string
  result: string
  why?: string
}
interface Scenario {
  id: string
  lot: string
  scenario: string
  expected: string
  result: string
  observed: string
  evidence: Evidence[]
  limits: string[]
  parts?: Part[]
  defect: string | null
  correction: string | null
  build: { commit: string; release: string }
  date: string
}
interface IntegrationScenario {
  id: string
  level: string
  result: string
  evidence: Evidence[]
  note: string | null
  build: { commit: string }
}
interface Register {
  scenarios: Scenario[]
  integration_scenarios: IntegrationScenario[]
  summary: Record<string, number>
  integration_summary: Record<string, number>
  candidate: { commit: string; release: string; branch: string }
  ci: { run_id: number; url: string; commit: string; conclusion: string }
}

const register = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'evidence', 'acceptance-L0.json'), 'utf8'),
) as Register

const RESULTS = ['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED']
const EXPECTED_IDS = [
  ...Array.from({ length: 29 }, (_, index) => `AT${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `AT${String(index + 36)}`),
]

/** Lignes des tableaux « Scénarios L0 » et « Scénarios hors-ligne obligatoires L0 » du fichier 14. */
function specificationRows(): Map<string, { scenario: string; expected: string }> {
  const rows = new Map<string, { scenario: string; expected: string }>()
  const text = readFileSync(join(ROOT, 'specifications', '14-recette-et-scenarios.md'), 'utf8')
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\| (AT\d\d) \| (.*?) \| (.*?) \|$/.exec(line)
    if (match !== null && !rows.has(match[1] ?? '')) {
      rows.set(match[1] ?? '', {
        scenario: (match[2] ?? '').trim(),
        expected: (match[3] ?? '').trim(),
      })
    }
  }
  return rows
}

function allEvidence(): Evidence[] {
  return [
    ...register.scenarios.flatMap((scenario) => scenario.evidence),
    ...register.integration_scenarios.flatMap((scenario) => scenario.evidence),
  ]
}

describe('registre de recette L0 (gate G3)', () => {
  it('liste exactement les 39 scénarios L0 du fichier 14, dans l’ordre', () => {
    expect(register.scenarios.map((scenario) => scenario.id)).toEqual(EXPECTED_IDS)
    expect(register.scenarios).toHaveLength(39)
  })

  it('reprend l’énoncé et le résultat attendu du fichier 14, mot pour mot', () => {
    const rows = specificationRows()
    for (const scenario of register.scenarios) {
      const row = rows.get(scenario.id)
      expect(row, `${scenario.id} : absent du fichier 14`).toBeDefined()
      expect(scenario.scenario, `${scenario.id} : énoncé`).toBe(row?.scenario)
      expect(scenario.expected, `${scenario.id} : résultat attendu`).toBe(row?.expected)
      expect(scenario.lot).toBe('L0')
    }
  })

  it('n’accepte qu’un résultat PASS, FAIL, NOT_RUN ou BLOCKED et jamais de PASS sans test automatisé', () => {
    for (const scenario of register.scenarios) {
      expect(RESULTS, `${scenario.id} : résultat`).toContain(scenario.result)
      expect(scenario.observed.length, `${scenario.id} : observé`).toBeGreaterThan(40)
      if (scenario.result === 'PASS') {
        const automated = scenario.evidence.filter((entry) => entry.kind !== 'Document')
        expect(automated.length, `${scenario.id} : PASS sans test automatisé`).toBeGreaterThan(0)
      }
    }
  })

  it('un scénario BLOCKED nomme le volet bloqué et pourquoi ; un PASS n’a aucun volet bloqué', () => {
    for (const scenario of register.scenarios) {
      const blocked = (scenario.parts ?? []).filter((part) => part.result === 'BLOCKED')
      if (scenario.result === 'BLOCKED') {
        expect(blocked.length, `${scenario.id} : BLOCKED sans volet bloqué`).toBeGreaterThan(0)
        for (const part of blocked) {
          expect(
            (part.why ?? '').length,
            `${scenario.id} : « ${part.part} » sans raison`,
          ).toBeGreaterThan(30)
        }
      } else {
        expect(blocked, `${scenario.id} : un PASS ne cache aucun volet bloqué`).toEqual([])
      }
      expect(scenario.defect).toBeNull()
      expect(scenario.correction).toBeNull()
    }
  })

  it('chaque preuve citée existe : fichier présent et chaque test nommé dans son fichier', () => {
    for (const entry of allEvidence()) {
      const path = join(ROOT, entry.path)
      expect(existsSync(path), `fichier introuvable : ${entry.path}`).toBe(true)
      const text = readFileSync(path, 'utf8')
      for (const name of entry.tests) {
        expect(text.includes(name), `test introuvable dans ${entry.path} : ${name}`).toBe(true)
      }
    }
  })

  it('les totaux du résumé sont ceux des enregistrements', () => {
    const count = (items: { result: string }[]): Record<string, number> => {
      const totals: Record<string, number> = {}
      for (const item of items) totals[item.result] = (totals[item.result] ?? 0) + 1
      return { ...totals, total: items.length }
    }
    expect(register.summary).toEqual(count(register.scenarios))
    expect(register.integration_summary).toEqual(count(register.integration_scenarios))
  })

  it('identifie le build candidat et la CI qui l’a jugé', () => {
    expect(register.candidate.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(register.candidate.branch).toBe('main')
    expect(register.ci.commit).toBe(register.candidate.commit)
    expect(register.ci.run_id).toBeGreaterThan(0)
    expect(register.ci.url).toContain(String(register.ci.run_id))
    expect(register.ci.conclusion).toBe('success')
    for (const scenario of register.scenarios) {
      expect(scenario.build.commit, `${scenario.id} : build`).toBe(register.candidate.commit)
      expect(scenario.build.release).toBe(register.candidate.release)
      expect(scenario.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('les IT critiques sont prouvés, les autres déclarés hors L0 avec leur raison', () => {
    for (const scenario of register.integration_scenarios) {
      expect(scenario.build.commit).toBe(register.candidate.commit)
      if (scenario.level === 'critique') {
        expect(scenario.result, `${scenario.id}`).toBe('PASS')
        expect(
          scenario.evidence.length,
          `${scenario.id} : un IT critique sans preuve`,
        ).toBeGreaterThan(0)
      } else {
        expect(scenario.level).toBe('hors L0')
        expect(scenario.result).toBe('NOT_RUN')
        expect((scenario.note ?? '').length, `${scenario.id} : raison`).toBeGreaterThan(20)
      }
    }
    expect(register.integration_scenarios.map((scenario) => scenario.id)).toEqual(
      Array.from({ length: 22 }, (_, index) => `IT${String(index + 1).padStart(2, '0')}`),
    )
  })
})

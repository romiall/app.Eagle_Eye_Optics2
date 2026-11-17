// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LENS_INDEX_LABELS,
  LENS_TREATMENT_LABELS,
  LENS_TYPE_LABELS,
  OPTICAL_USAGE_LABELS,
  PAYMENT_METHOD_LABELS,
  paymentMethodLabel,
  UNIT_LABELS,
  unitLabel,
} from '@/documents/data/labels'
import { serverDocumentType, DOCUMENT_KINDS } from '@/documents/templates/registry'

// Les libellés imprimés ne sont jamais inventés : ce sont ceux du référentiel seedé
// (database/02_reference_data.sql). Ce test relit le SQL et exige l'égalité exacte, comme pour les
// termes cliniques.
const ROOT = join(import.meta.dirname, '..', '..', '..')
const SQL = readFileSync(join(ROOT, 'database', '02_reference_data.sql'), 'utf8')

function statement(table: string): string {
  const start = SQL.indexOf(`INSERT INTO \`${table}\``)
  expect(start, table).toBeGreaterThanOrEqual(0)
  return SQL.slice(start, SQL.indexOf(';\n', start))
}

function clinicalTerms(group: string): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const match of statement('clinical_terms').matchAll(
    /\('([A-Z_]+)', '([^']+)', '((?:[^']|'')*)', (\d+), (\d+)\)/g,
  )) {
    if (match[1] === group) labels[match[2] ?? ''] = (match[3] ?? '').replaceAll("''", "'")
  }
  return labels
}

describe('libellés imprimés = référentiel seedé', () => {
  it('unités (table units)', () => {
    const sql: Record<string, string> = {}
    for (const match of statement('units').matchAll(/\('([A-Z_]+)', '((?:[^']|'')*)', [01]\)/g)) {
      sql[match[1] ?? ''] = (match[2] ?? '').replaceAll("''", "'")
    }

    expect(Object.keys(sql).length).toBeGreaterThanOrEqual(4)
    expect(UNIT_LABELS).toEqual(sql)
  })

  it.each([
    ['OPTICAL_USAGE', OPTICAL_USAGE_LABELS],
    ['LENS_TYPE', LENS_TYPE_LABELS],
    ['LENS_TREATMENT', LENS_TREATMENT_LABELS],
    ['LENS_INDEX', LENS_INDEX_LABELS],
  ] as const)('termes cliniques du groupe %s', (group, labels) => {
    const sql = clinicalTerms(group)

    expect(Object.keys(sql).length).toBeGreaterThanOrEqual(5)
    expect(labels).toEqual(sql)
  })

  it('un code d’unité inconnu est imprimé tel quel', () => {
    expect(unitLabel('PAIR')).toBe('Paire')
    expect(unitLabel('BOITE')).toBe('BOITE')
  })
})

describe('modes de règlement', () => {
  const contract = JSON.parse(
    readFileSync(join(ROOT, 'contracts', 'schemas', 'enums.json'), 'utf8'),
  ) as { $defs: Record<string, { enum: string[] }> }

  it('chaque mode du contrat (paiements et remboursements) a un libellé français', () => {
    for (const key of ['payments.method', 'refunds.method']) {
      const methods = contract.$defs[key]?.enum ?? []
      expect(methods.length, key).toBe(6)
      expect(Object.keys(PAYMENT_METHOD_LABELS).sort(), key).toEqual([...methods].sort())
    }
  })

  it('un mode inconnu est imprimé tel quel, jamais deviné', () => {
    expect(paymentMethodLabel('CASH')).toBe('Espèces')
    expect(paymentMethodLabel('CRYPTO')).toBe('CRYPTO')
  })
})

describe('types de documents', () => {
  const contract = JSON.parse(
    readFileSync(join(ROOT, 'contracts', 'schemas', 'enums.json'), 'utf8'),
  ) as { $defs: Record<string, { enum: string[] }> }
  const server = contract.$defs['generated_documents.document_type']?.enum ?? []

  it('tout type enregistré côté serveur par le moteur existe dans generated_documents.document_type', () => {
    for (const kind of DOCUMENT_KINDS) {
      const type = serverDocumentType(kind)
      if (type !== null) expect(server, kind).toContain(type)
    }
  })

  it('les types du serveur sans modèle ici (atelier, créance d’ouverture) sont connus : lots suivants', () => {
    const covered = new Set(DOCUMENT_KINDS.map((kind) => serverDocumentType(kind)))
    const missing = server.filter((type) => !covered.has(type as never))

    expect(missing.sort()).toEqual(['LEGACY_BALANCE'])
  })
})

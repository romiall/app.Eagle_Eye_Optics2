import { describe, expect, it } from 'vitest'

import {
  applicableTaxRule,
  catalogItemOf,
  type LocalCatalog,
  readLocalCatalog,
  searchLocalCatalog,
} from '@/domain/billing/localCatalog'

/**
 * Catalogue et règles fiscales FIGÉS du poste préparé (`catalog_snapshot` du coffre) : lecture défensive, règle fiscale
 * applicable seulement si active ET validée, recherche sans casse ni accents, articles actifs seulement, 25 par page.
 * Données fictives.
 */
const TAX_OK = '01J9ZXK4M2Q8R7S6T5V4W3TX01'
const TAX_DRAFT = '01J9ZXK4M2Q8R7S6T5V4W3TX02'
const TAX_OFF = '01J9ZXK4M2Q8R7S6T5V4W3TX03'

function item(index: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `01J9ZXK4M2Q8R7S6T5V4W3IT${String(index).padStart(2, '0')}`,
    reference: `DEMO-${String(index).padStart(3, '0')}`,
    category_code: 'FRAME',
    name: `Monture fictive ${String(index).padStart(2, '0')}`,
    unit_code: 'UNIT',
    quantity_integer_only: true,
    sale_price: 40000,
    tax_rule_id: TAX_OK,
    stock_mode: 'NONE',
    requires_expiry: false,
    active: true,
    version: 1,
    ...fields,
  }
}

function snapshot(items: unknown[], rules?: unknown[]): unknown {
  return {
    catalog_version: 'catalogue-abc123def456',
    snapshot_sha256: 'a'.repeat(64),
    rules_version: 'rules.v1',
    snapshot: {
      items,
      tax_rules: rules ?? [
        {
          id: TAX_OK,
          code: 'TEST_TAXE_FICTIVE',
          rate_percent: '10.0000',
          active: true,
          validated_at: '2026-10-01T09:00:00.000Z',
          version: 1,
        },
        {
          id: TAX_DRAFT,
          code: 'TEST_BROUILLON',
          rate_percent: '5.0000',
          active: true,
          validated_at: null,
          version: 1,
        },
        {
          id: TAX_OFF,
          code: 'TEST_INACTIVE',
          rate_percent: '5.0000',
          active: false,
          validated_at: '2026-10-01T09:00:00.000Z',
          version: 1,
        },
      ],
    },
  }
}

function catalogOf(items: unknown[], rules?: unknown[]): LocalCatalog {
  const catalog = readLocalCatalog(snapshot(items, rules))
  if (catalog === null) throw new Error('catalogue attendu')
  return catalog
}

describe('lecture du catalogue figé', () => {
  it('lit les articles, les règles fiscales, la version et l’empreinte du grant', () => {
    const catalog = catalogOf([item(1), item(2, { stock_mode: 'STOCKED', tax_rule_id: null })])

    expect(catalog.items).toHaveLength(2)
    expect(catalog.items[1]).toMatchObject({
      stock_mode: 'STOCKED',
      tax_rule_id: null,
      sale_price: 40000,
    })
    expect(catalog.taxRules.map((rule) => rule.code)).toEqual([
      'TEST_TAXE_FICTIVE',
      'TEST_BROUILLON',
      'TEST_INACTIVE',
    ])
    expect(catalog.catalogVersion).toBe('catalogue-abc123def456')
    expect(catalog.snapshotSha256).toBe('a'.repeat(64))
  })

  it('une valeur absente ou altérée ne donne aucun catalogue ; une ligne illisible est ignorée sans écarter les autres', () => {
    expect(readLocalCatalog(null)).toBeNull()
    expect(readLocalCatalog('oups')).toBeNull()
    expect(readLocalCatalog({ snapshot: 'oups' })).toBeNull()
    expect(readLocalCatalog({ snapshot: { items: 'oups' } })).toBeNull()

    const catalog = catalogOf([
      item(1),
      item(2, { sale_price: 'cher' }),
      item(3, { stock_mode: 'INCONNU' }),
      item(4, { sale_price: -5 }),
      item(5, { name: '' }),
      null,
      item(6),
    ])
    expect(catalog.items.map((entry) => entry.reference)).toEqual(['DEMO-001', 'DEMO-006'])
  })
})

describe('règle fiscale applicable', () => {
  const catalog = catalogOf([
    item(1),
    item(2, { tax_rule_id: TAX_DRAFT }),
    item(3, { tax_rule_id: TAX_OFF }),
    item(4, { tax_rule_id: null }),
    item(5, { tax_rule_id: '01J9ZXK4M2Q8R7S6T5V4W3TX99' }),
  ])
  const byRef = (reference: string) => {
    const found = catalog.items.find((entry) => entry.reference === reference)
    if (found === undefined) throw new Error(reference)
    return found
  }

  it('une règle active, avec un taux et une validation de la gérante, s’applique', () => {
    expect(applicableTaxRule(catalog, byRef('DEMO-001'))?.code).toBe('TEST_TAXE_FICTIVE')
  })

  it('jamais une règle non validée, inactive, inconnue, ni l’absence de règle', () => {
    for (const reference of ['DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005']) {
      expect(applicableTaxRule(catalog, byRef(reference)), reference).toBeNull()
    }
  })

  it('une règle sans taux ne s’applique pas : aucun taux n’est inventé', () => {
    const noRate = catalogOf(
      [item(1)],
      [
        {
          id: TAX_OK,
          code: 'SANS_TAUX',
          rate_percent: null,
          active: true,
          validated_at: '2026-10-01T09:00:00.000Z',
          version: 1,
        },
      ],
    )
    const only = noRate.items[0]
    if (only === undefined) throw new Error('article attendu')
    expect(applicableTaxRule(noRate, only)).toBeNull()
  })
})

describe('article au format du serveur', () => {
  it('reprend les champs du catalogue figé, sans marque, seuil ni coût d’achat', () => {
    const catalog = catalogOf([item(1, { stock_mode: 'MADE_TO_ORDER', requires_expiry: true })])
    const first = catalog.items[0]
    if (first === undefined) throw new Error('article attendu')

    expect(catalogItemOf(first)).toEqual({
      id: first.id,
      reference: 'DEMO-001',
      category_code: 'FRAME',
      name: 'Monture fictive 01',
      brand: null,
      model: null,
      unit_code: 'UNIT',
      quantity_integer_only: true,
      sale_price: 40000,
      tax_rule_id: TAX_OK,
      stock_mode: 'MADE_TO_ORDER',
      requires_expiry: true,
      low_stock_threshold: null,
      expiry_alert_days: null,
      active: true,
      public_visibility: false,
      version: 1,
    })
    expect(catalogItemOf(first)).not.toHaveProperty('purchase_cost')
  })
})

describe('recherche dans le catalogue du poste', () => {
  const catalog = catalogOf([
    item(1, { name: 'Verres progressifs', reference: 'DEMO-VERRES' }),
    item(2, { name: 'Examen de vue (fictif)', reference: 'DEMO-EXAMEN' }),
    item(3, { name: 'Monture éclair', reference: 'DEMO-MONTURE' }),
    item(4, { name: 'Monture retirée', reference: 'DEMO-OLD', active: false }),
  ])

  it('sans texte : les articles actifs seulement, triés par nom', () => {
    const page = searchLocalCatalog(catalog, '', 1)

    expect(page.data.map((entry) => entry.reference)).toEqual([
      'DEMO-EXAMEN',
      'DEMO-MONTURE',
      'DEMO-VERRES',
    ])
    expect(page.meta).toEqual({ current_page: 1, last_page: 1, per_page: 25, total: 3 })
  })

  it('chaque mot figure dans la référence ou le nom, sans casse, accents ni ordre des mots', () => {
    const refs = (query: string) =>
      searchLocalCatalog(catalog, query, 1).data.map((entry) => entry.reference)

    expect(refs('monture')).toEqual(['DEMO-MONTURE'])
    expect(refs('ECLAIR monture')).toEqual(['DEMO-MONTURE'])
    expect(refs('demo-exam')).toEqual(['DEMO-EXAMEN'])
    expect(refs('examen vue')).toEqual(['DEMO-EXAMEN'])
    expect(refs('verres')).toEqual(['DEMO-VERRES'])
    expect(refs('introuvable')).toEqual([])
    // Un article retiré du catalogue n’est plus proposé.
    expect(refs('retirée')).toEqual([])
  })

  it('25 par page, avec le total des articles de ce poste', () => {
    const many = catalogOf(
      Array.from({ length: 30 }, (_, index) =>
        item(index + 1, { name: `Article ${String(index + 1).padStart(2, '0')}` }),
      ),
    )

    const first = searchLocalCatalog(many, 'article', 1)
    expect(first.data).toHaveLength(25)
    expect(first.data[0]?.name).toBe('Article 01')
    expect(first.meta).toEqual({ current_page: 1, last_page: 2, per_page: 25, total: 30 })
    expect(searchLocalCatalog(many, 'article', 2).data).toHaveLength(5)
  })
})

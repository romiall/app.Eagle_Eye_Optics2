import type { CatalogItem, CatalogItemsStockMode, CatalogPage } from '../contracts/generated'
import { intDiv } from '../values/integer'
import { searchKey } from '../values/text'

/**
 * Catalogue et règles fiscales FIGÉS remis à ce poste à sa préparation (fichier 19 ; `CatalogSnapshot::content()` du
 * serveur, dont l'empreinte est signée dans le grant) : ce que le poste applique pour facturer sans réseau. Jamais de coût
 * d'achat. Règles pures : aucune lecture du coffre ici (service d'application `localCatalog`), aucune valeur inventée —
 * une règle fiscale n'est appliquée que si elle est active ET validée par la gérante (comme `TaxRegime::applicable`).
 */
export interface LocalCatalogItem {
  id: string
  reference: string
  category_code: string
  name: string
  unit_code: string
  quantity_integer_only: boolean
  sale_price: number
  tax_rule_id: string | null
  stock_mode: CatalogItemsStockMode
  requires_expiry: boolean
  active: boolean
  version: number
}

export interface LocalTaxRule {
  id: string
  code: string
  /** Taux canonique « 19.2500 » (décimal à 4 décimales) ou null : aucun taux n'est inventé. */
  rate_percent: string | null
  active: boolean
  validated_at: string | null
  version: number
}

export interface LocalCatalog {
  items: LocalCatalogItem[]
  taxRules: LocalTaxRule[]
  /** Version et empreinte du catalogue figé (celles du grant). */
  catalogVersion: string | null
  snapshotSha256: string | null
}

const STOCK_MODES: readonly CatalogItemsStockMode[] = ['NONE', 'STOCKED', 'MADE_TO_ORDER']

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function itemOf(raw: unknown): LocalCatalogItem | null {
  const row = record(raw)
  if (row === null) return null
  const id = text(row['id'])
  const reference = text(row['reference'])
  const name = text(row['name'])
  const category = text(row['category_code'])
  const unit = text(row['unit_code'])
  const price = integer(row['sale_price'])
  const version = integer(row['version'])
  const mode = STOCK_MODES.find((candidate) => candidate === row['stock_mode'])
  if (
    id === null ||
    reference === null ||
    name === null ||
    category === null ||
    unit === null ||
    price === null ||
    price < 0 ||
    version === null ||
    mode === undefined
  ) {
    return null
  }
  const taxRule = row['tax_rule_id']
  return {
    id,
    reference,
    category_code: category,
    name,
    unit_code: unit,
    quantity_integer_only: row['quantity_integer_only'] === true,
    sale_price: price,
    tax_rule_id: typeof taxRule === 'string' && taxRule !== '' ? taxRule : null,
    stock_mode: mode,
    requires_expiry: row['requires_expiry'] === true,
    active: row['active'] === true,
    version,
  }
}

function ruleOf(raw: unknown): LocalTaxRule | null {
  const row = record(raw)
  if (row === null) return null
  const id = text(row['id'])
  const code = text(row['code'])
  const version = integer(row['version'])
  if (id === null || code === null || version === null) return null
  return {
    id,
    code,
    rate_percent: text(row['rate_percent']),
    active: row['active'] === true,
    validated_at: text(row['validated_at']),
    version,
  }
}

/**
 * Catalogue du poste lu dans l'entité scellée `catalog_snapshot` (`{ catalog_version, snapshot_sha256, snapshot }`).
 * Une valeur absente ou altérée donne null (le poste ne facture alors pas sur un catalogue qu'il ne peut pas lire) ; une
 * ligne illisible est ignorée sans écarter les autres.
 */
export function readLocalCatalog(value: unknown): LocalCatalog | null {
  const entity = record(value)
  const snapshot = record(entity?.['snapshot'])
  if (entity === null || snapshot === null) return null
  const items = Array.isArray(snapshot['items']) ? snapshot['items'] : null
  const rules = Array.isArray(snapshot['tax_rules']) ? snapshot['tax_rules'] : []
  if (items === null) return null
  return {
    items: items.map(itemOf).filter((item): item is LocalCatalogItem => item !== null),
    taxRules: rules.map(ruleOf).filter((rule): rule is LocalTaxRule => rule !== null),
    catalogVersion: text(entity['catalog_version']),
    snapshotSha256: text(entity['snapshot_sha256']),
  }
}

/** Règle fiscale APPLICABLE à un article : active, avec un taux et une validation de la gérante ; sinon aucune. */
export function applicableTaxRule(
  catalog: Pick<LocalCatalog, 'taxRules'>,
  item: Pick<LocalCatalogItem, 'tax_rule_id'>,
): LocalTaxRule | null {
  if (item.tax_rule_id === null) return null
  const rule = catalog.taxRules.find((candidate) => candidate.id === item.tax_rule_id)
  if (rule === undefined) return null
  return rule.active && rule.rate_percent !== null && rule.validated_at !== null ? rule : null
}

/** Article du catalogue du poste au format du serveur (sans marque, modèle, seuils ni coût d'achat). */
export function catalogItemOf(item: LocalCatalogItem): CatalogItem {
  return {
    id: item.id,
    reference: item.reference,
    category_code: item.category_code,
    name: item.name,
    brand: null,
    model: null,
    unit_code: item.unit_code,
    quantity_integer_only: item.quantity_integer_only,
    sale_price: item.sale_price,
    tax_rule_id: item.tax_rule_id,
    stock_mode: item.stock_mode,
    requires_expiry: item.requires_expiry,
    low_stock_threshold: null,
    expiry_alert_days: null,
    active: item.active,
    public_visibility: false,
    version: item.version,
  }
}

const PAGE_SIZE = 25

function keyOf(value: string): string {
  try {
    return searchKey(value)
  } catch {
    return ''
  }
}

/**
 * Recherche dans le catalogue du poste : chaque mot saisi figure dans la référence ou le nom (casse, accents, ponctuation
 * et ordre des mots ignorés) ; sans texte, les articles actifs. Seuls les articles ACTIFS sont proposés, triés par nom
 * puis référence, 25 par page. Le catalogue du poste est celui de sa préparation : il peut être plus ancien que celui du
 * serveur (l'écran le dit).
 */
export function searchLocalCatalog(
  catalog: LocalCatalog,
  query: string,
  page: number,
): CatalogPage {
  const words = keyOf(query)
    .split(' ')
    .filter((word) => word !== '')
  const matches = catalog.items
    .filter((item) => item.active)
    .filter((item) => {
      if (words.length === 0) return true
      const haystack = keyOf(`${item.reference} ${item.name}`)
      return words.every((word) => haystack.includes(word))
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'fr') || left.reference.localeCompare(right.reference),
    )
  const start = (page - 1) * PAGE_SIZE
  return {
    data: matches.slice(start, start + PAGE_SIZE).map(catalogItemOf),
    meta: {
      current_page: page,
      last_page: Math.max(1, intDiv(matches.length + PAGE_SIZE - 1, PAGE_SIZE)),
      per_page: PAGE_SIZE,
      total: matches.length,
    },
  }
}

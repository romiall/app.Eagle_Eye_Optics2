import type {
  InventoryCountLine,
  OpenInventoryCountRequest,
  RecordInventoryCountsRequest,
} from '../contracts/generated'
import { RuleViolation } from '../errors'
import { FixedDecimal, Quantity } from '../values/decimal'
import { trimBlanks } from '../values/text'

/**
 * Inventaires (L1D02, EE026, EE030), EN LIGNE : l'écran saisit les quantités comptées (zéro admis, vide = pas encore
 * compté) et le motif des écarts ; le serveur juge le théorique au moment du comptage de chaque ligne et n'ajuste le
 * stock qu'à la validation de la gérante, par des mouvements signés. Ces règles servent les messages avant envoi.
 */
export const COUNT_REASON_MAX = 1000

/** Corps d'une écriture : la couche de mutation y ajoute `expected_version` null. */
type Body<T> = Omit<T, 'expected_version'>
export const INVENTORY_REFERENCE_MAX = 64

export interface CountLineForm {
  lineId: string
  /** Quantité comptée saisie ; vide = pas encore comptée. */
  counted: string
  reason: string
}

/** Quantité saisie vers sa forme canonique `DECIMAL(12,3)` ; vide → null ; virgule française admise. */
export function parseCounted(
  text: string,
  integerOnly: boolean,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = trimBlanks(text).replace(',', '.')
  if (trimmed === '') return { ok: true, value: null }
  try {
    const quantity = Quantity.parse(trimmed, 'counted_quantity')
    if (quantity === null) return { ok: true, value: null }
    if (integerOnly && !quantity.isInteger()) {
      return { ok: false, message: 'Cet article se vend à l’unité : quantité entière obligatoire.' }
    }
    return { ok: true, value: quantity.canonical() }
  } catch (error) {
    if (!(error instanceof RuleViolation)) throw error
    return {
      ok: false,
      message: 'Quantité invalide : un nombre positif ou zéro, trois décimales au plus.',
    }
  }
}

/** Écart signé entre le comptage et le théorique figé (brut, avant les mouvements postérieurs) ; null si pas compté. */
export function varianceOf(theoretical: string, counted: string | null): string | null {
  if (counted === null) return null
  const difference = Quantity.of(counted).units - Quantity.of(theoretical).units
  return FixedDecimal.fromUnits(difference, Quantity.SCALE).canonical()
}

export function isZeroQuantity(value: string): boolean {
  return Quantity.of(value).units === 0n
}

export function countFormOf(line: InventoryCountLine): CountLineForm {
  return {
    lineId: line.line_id,
    counted: line.counted_quantity === null ? '' : line.counted_quantity,
    reason: line.variance_reason ?? '',
  }
}

export interface CountChecked {
  /** Erreur de quantité par ligne. */
  errors: Record<string, string>
  /** Lignes modifiées, prêtes à envoyer ; null si une quantité est refusée. */
  request: Body<RecordInventoryCountsRequest> | null
}

/**
 * Lignes dont le comptage ou le motif a changé depuis la dernière lecture du serveur : seules elles sont envoyées.
 */
export function checkCountChanges(input: {
  lines: readonly InventoryCountLine[]
  forms: Readonly<Record<string, CountLineForm>>
  integerOnly: (itemId: string) => boolean
}): CountChecked {
  const errors: Record<string, string> = {}
  const changes: RecordInventoryCountsRequest['lines'][number][] = []
  for (const line of input.lines) {
    const form = input.forms[line.line_id]
    if (form === undefined) continue
    const parsed = parseCounted(form.counted, input.integerOnly(line.item_id))
    if (!parsed.ok) {
      errors[line.line_id] = parsed.message
      continue
    }
    const reason = trimBlanks(form.reason)
    if (reason.length > COUNT_REASON_MAX) {
      errors[line.line_id] = `Le motif compte au plus ${COUNT_REASON_MAX} caractères.`
      continue
    }
    const storedReason = line.variance_reason ?? ''
    if (parsed.value === line.counted_quantity && reason === storedReason) continue
    changes.push({
      line_id: line.line_id,
      counted_quantity: parsed.value,
      variance_reason: reason === '' ? null : reason,
    })
  }
  const [first, ...rest] = changes
  if (Object.keys(errors).length > 0 || first === undefined) return { errors, request: null }
  return { errors, request: { lines: [first, ...rest] } }
}

export function defaultInventoryReference(today: string): string {
  return `INV-${today}`
}

export function validateOpenInventory(input: { locationId: string | null; reference: string }): {
  errors: { locationId?: string; reference?: string }
  request: Body<OpenInventoryCountRequest> | null
} {
  const errors: { locationId?: string; reference?: string } = {}
  const reference = trimBlanks(input.reference)
  if (input.locationId === null) errors.locationId = 'Choisissez l’emplacement à inventorier.'
  if (reference === '') errors.reference = 'La référence de l’inventaire est obligatoire.'
  else if (reference.length > INVENTORY_REFERENCE_MAX) {
    errors.reference = `Au plus ${INVENTORY_REFERENCE_MAX} caractères.`
  }
  if (Object.keys(errors).length > 0 || input.locationId === null) return { errors, request: null }
  return { errors, request: { location_id: input.locationId, reference } }
}

export const INVENTORY_STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: 'Ouvert : comptage en cours',
  COUNTED: 'Compté : à valider par la gérante',
  VALIDATED: 'Validé',
  ABANDONED: 'Abandonné',
}

/** Clé d'erreur du serveur (`lines.<id>` ou `reason`) vers un message par ligne et un message général. */
export function mapInventoryServerErrors(fields: Readonly<Record<string, string>>): {
  lines: Record<string, string>
  general: string | null
} {
  const lines: Record<string, string> = {}
  const others: string[] = []
  for (const [key, message] of Object.entries(fields)) {
    const match = /^lines\.([0-9A-Za-z]{26})$/u.exec(key)
    if (match?.[1] !== undefined) lines[match[1]] = message
    else others.push(message)
  }
  return { lines, general: others.length > 0 ? others.join(' ') : null }
}

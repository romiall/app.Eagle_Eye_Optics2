import type {
  CatalogItem,
  GoodsReceipt,
  GoodsReceiptDraftRequest,
  Supplier,
  SupplierRequest,
  ValidateGoodsReceiptRequest,
} from '../contracts/generated'
import { RuleViolation } from '../errors'
import { CivilDate } from '../values/civilDate'
import { Quantity } from '../values/decimal'
import { Instant } from '../values/instant'
import { trimBlanks } from '../values/text'

/**
 * Achats (L1D01, EE026, EE027), EN LIGNE : fournisseurs et réceptions. Ces règles servent l'écran (messages avant envoi) ;
 * le serveur reste seul juge à chaque commande et rejoue les mêmes contrôles. Un brouillon de réception ne touche jamais
 * au stock : le lot (numéro, expiration) et la confirmation du coût se donnent à la VALIDATION, qui écrit lots et
 * mouvements. Un coût d'achat inconnu reste `null`, jamais 0.
 */
export const SUPPLIER_NAME_MIN = 2
export const SUPPLIER_NAME_MAX = 180
export const SUPPLIER_CODE_MAX = 64
export const SUPPLIER_PHONE_MAX = 32
export const SUPPLIER_EMAIL_MAX = 254
export const SUPPLIER_ADDRESS_MAX = 2000
export const DELIVERY_REFERENCE_MAX = 100
export const RECEIPT_NOTES_MAX = 2000
export const BATCH_NUMBER_MAX = 80
export const MAX_RECEIPT_LINES = 200

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** Corps d'une écriture : la couche de mutation y ajoute `expected_version` null (ces ressources n'ont pas de version). */
type Body<T> = Omit<T, 'expected_version'>

// --- Fournisseurs --------------------------------------------------------------------------------------------------

export interface SupplierForm {
  name: string
  reference: string
  phone: string
  email: string
  address: string
  isOpticalLab: boolean
  active: boolean
}

export type SupplierField = 'name' | 'reference' | 'phone' | 'email' | 'address'

export function emptySupplierForm(): SupplierForm {
  return {
    name: '',
    reference: '',
    phone: '',
    email: '',
    address: '',
    isOpticalLab: false,
    active: true,
  }
}

export function supplierFormOf(supplier: Supplier): SupplierForm {
  return {
    name: supplier.name,
    reference: supplier.reference,
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    isOpticalLab: supplier.is_optical_lab,
    active: supplier.active,
  }
}

export function validateSupplier(form: SupplierForm): {
  errors: Partial<Record<SupplierField, string>>
  request: Body<SupplierRequest> | null
} {
  const errors: Partial<Record<SupplierField, string>> = {}
  const name = trimBlanks(form.name)
  const reference = trimBlanks(form.reference)
  const phone = trimBlanks(form.phone)
  const email = trimBlanks(form.email)
  const address = trimBlanks(form.address)
  if (name.length < SUPPLIER_NAME_MIN) {
    errors.name = `Le nom du fournisseur compte au moins ${SUPPLIER_NAME_MIN} caractères.`
  } else if (name.length > SUPPLIER_NAME_MAX) {
    errors.name = `Le nom compte au plus ${SUPPLIER_NAME_MAX} caractères.`
  }
  if (reference === '') errors.reference = 'Le code du fournisseur est obligatoire.'
  else if (reference.length > SUPPLIER_CODE_MAX) {
    errors.reference = `Le code compte au plus ${SUPPLIER_CODE_MAX} caractères.`
  }
  if (phone.length > SUPPLIER_PHONE_MAX) {
    errors.phone = `Le téléphone compte au plus ${SUPPLIER_PHONE_MAX} caractères.`
  }
  if (email !== '' && (!EMAIL_PATTERN.test(email) || email.length > SUPPLIER_EMAIL_MAX)) {
    errors.email = 'Adresse e-mail invalide.'
  }
  if (address.length > SUPPLIER_ADDRESS_MAX) {
    errors.address = `L’adresse compte au plus ${SUPPLIER_ADDRESS_MAX} caractères.`
  }
  if (Object.keys(errors).length > 0) return { errors, request: null }
  return {
    errors,
    request: {
      name,
      reference,
      phone: phone === '' ? null : phone,
      email: email === '' ? null : email,
      address: address === '' ? null : address,
      is_optical_lab: form.isOpticalLab,
      active: form.active,
    },
  }
}

/** Champ du formulaire visé par une erreur du serveur (clé de `error.fields`), ou null. */
export function supplierFieldFromServer(key: string): SupplierField | null {
  return ['name', 'reference', 'phone', 'email', 'address'].includes(key)
    ? (key as SupplierField)
    : null
}

// --- Brouillon de réception ---------------------------------------------------------------------------------------

export interface ReceiptLineForm {
  /** Clé locale de la ligne (liste d'écran) : jamais envoyée. */
  key: string
  itemId: string | null
  quantity: string | null
  /** FCFA par unité ; null = coût INCONNU (jamais 0). */
  unitCost: number | null
}

export interface ReceiptForm {
  supplierId: string | null
  locationId: string | null
  supplierReference: string
  /** Date civile de réception `AAAA-MM-JJ` (fuseau du cabinet) ou null. */
  receivedOn: string | null
  notes: string
  lines: ReceiptLineForm[]
}

export type ReceiptHeaderField =
  'supplierId' | 'locationId' | 'supplierReference' | 'receivedOn' | 'notes'
export type ReceiptLineField = 'itemId' | 'quantity' | 'unitCost'

export interface ReceiptErrors {
  header: Partial<Record<ReceiptHeaderField, string>>
  /** Erreurs par clé locale de ligne. */
  lines: Record<string, Partial<Record<ReceiptLineField, string>>>
  general: string | null
}

export function emptyReceiptErrors(): ReceiptErrors {
  return { header: {}, lines: {}, general: null }
}

export function hasReceiptErrors(errors: ReceiptErrors): boolean {
  return (
    errors.general !== null ||
    Object.keys(errors.header).length > 0 ||
    Object.values(errors.lines).some((line) => Object.keys(line).length > 0)
  )
}

export function emptyReceiptForm(): ReceiptForm {
  return {
    supplierId: null,
    locationId: null,
    supplierReference: '',
    receivedOn: null,
    notes: '',
    lines: [],
  }
}

export function receiptFormOf(
  receipt: GoodsReceipt,
  timeZone: string,
  keyOf: () => string,
): ReceiptForm {
  const received = Instant.parse(receipt.received_at, 'received_at')
  return {
    supplierId: receipt.supplier_id,
    locationId: receipt.location_id,
    supplierReference: receipt.supplier_reference,
    receivedOn: received === null ? null : received.civilDate(timeZone).toString(),
    notes: receipt.notes ?? '',
    lines: receipt.lines.map((line) => ({
      key: keyOf(),
      itemId: line.item_id,
      quantity: line.quantity,
      unitCost: line.unit_cost,
    })),
  }
}

/**
 * Contrôle d'un brouillon avant envoi. `today` : date civile du jour dans le fuseau du cabinet (jamais une date future).
 */
export function validateReceiptDraft(input: {
  form: ReceiptForm
  items: ReadonlyMap<string, CatalogItem>
  today: string
}): ReceiptErrors {
  const errors = emptyReceiptErrors()
  const { form } = input
  if (form.supplierId === null) errors.header.supplierId = 'Choisissez le fournisseur.'
  if (form.locationId === null) errors.header.locationId = 'Choisissez l’emplacement de réception.'
  const reference = trimBlanks(form.supplierReference)
  if (reference === '') {
    errors.header.supplierReference = 'La référence de livraison (bon ou facture) est obligatoire.'
  } else if (reference.length > DELIVERY_REFERENCE_MAX) {
    errors.header.supplierReference = `Au plus ${DELIVERY_REFERENCE_MAX} caractères.`
  }
  if (form.receivedOn === null) errors.header.receivedOn = 'La date de réception est obligatoire.'
  else if (CivilDate.parse(form.receivedOn) === null) {
    errors.header.receivedOn = 'Date de réception invalide.'
  } else if (form.receivedOn > input.today) {
    errors.header.receivedOn = 'La date de réception ne peut pas être dans le futur.'
  }
  if (trimBlanks(form.notes).length > RECEIPT_NOTES_MAX) {
    errors.header.notes = `Au plus ${RECEIPT_NOTES_MAX} caractères.`
  }
  if (form.lines.length === 0) errors.general = 'Ajoutez au moins une ligne à la réception.'
  else if (form.lines.length > MAX_RECEIPT_LINES) {
    errors.general = `Une réception compte au plus ${MAX_RECEIPT_LINES} lignes.`
  }
  for (const line of form.lines) {
    const lineErrors: Partial<Record<ReceiptLineField, string>> = {}
    const item = line.itemId === null ? undefined : input.items.get(line.itemId)
    if (item === undefined) lineErrors.itemId = 'Choisissez un article géré en stock.'
    else if (item.stock_mode !== 'STOCKED' || !item.active) {
      lineErrors.itemId = 'Seul un article actif géré en stock se reçoit.'
    }
    if (line.quantity === null) lineErrors.quantity = 'La quantité est obligatoire.'
    else {
      try {
        Quantity.forLine(Quantity.of(line.quantity), item?.quantity_integer_only ?? false)
      } catch (error) {
        if (!(error instanceof RuleViolation)) throw error
        lineErrors.quantity = error.message
      }
    }
    if (line.unitCost !== null && (!Number.isInteger(line.unitCost) || line.unitCost < 0)) {
      lineErrors.unitCost = 'Le coût est un montant entier en FCFA (laissez vide s’il est inconnu).'
    }
    if (Object.keys(lineErrors).length > 0) errors.lines[line.key] = lineErrors
  }
  return errors
}

/**
 * Instant de réception envoyé : la date du jour garde l'instant présent (jamais dans le futur), une date passée vaut midi UTC
 * (même jour civil à Douala comme à Paris).
 */
export function receivedAtInstant(receivedOn: string, today: string, nowInstant: string): string {
  return receivedOn === today ? nowInstant : `${receivedOn}T12:00:00.000Z`
}

export function buildReceiptDraftRequest(input: {
  form: ReceiptForm
  today: string
  nowInstant: string
}): Body<GoodsReceiptDraftRequest> {
  const { form } = input
  const notes = trimBlanks(form.notes)
  const lines = form.lines.map((line) => ({
    item_id: line.itemId ?? '',
    quantity: line.quantity ?? '',
    unit_cost: line.unitCost,
  }))
  const [first, ...rest] = lines
  if (first === undefined) throw new RangeError('Une réception compte au moins une ligne.')
  return {
    supplier_id: form.supplierId ?? '',
    location_id: form.locationId ?? '',
    supplier_reference: trimBlanks(form.supplierReference),
    received_at: receivedAtInstant(form.receivedOn ?? input.today, input.today, input.nowInstant),
    notes: notes === '' ? null : notes,
    lines: [first, ...rest],
  }
}

// --- Validation d'une réception : lot et coût de chaque ligne -----------------------------------------------------

export interface ConfirmLineForm {
  position: number
  batchNumber: string
  /** Date civile `AAAA-MM-JJ` ou null. */
  expiresOn: string | null
  unitCost: number | null
}

export type ConfirmLineField = 'batchNumber' | 'expiresOn' | 'unitCost'

export function confirmationFormOf(receipt: GoodsReceipt): ConfirmLineForm[] {
  return receipt.lines.map((line) => ({
    position: line.position,
    batchNumber: line.lot?.batch_number ?? '',
    expiresOn: line.lot?.expires_on ?? null,
    unitCost: line.unit_cost,
  }))
}

/**
 * Contrôle de la confirmation (lot et coût final de chaque ligne) avant la validation. Un article périssable exige un lot
 * daté ; un lot déjà expiré à la date de réception est refusé ; le serveur juge de plus les lots connus (expiration,
 * coût, quarantaine) et les positions déjà suivies par lots.
 */
export function validateConfirmation(input: {
  lines: readonly ConfirmLineForm[]
  receipt: GoodsReceipt
  items: ReadonlyMap<string, CatalogItem>
  receivedOn: string
}): Record<number, Partial<Record<ConfirmLineField, string>>> {
  const errors: Record<number, Partial<Record<ConfirmLineField, string>>> = {}
  for (const line of input.lines) {
    const stored = input.receipt.lines.find((entry) => entry.position === line.position)
    const item = stored === undefined ? undefined : input.items.get(stored.item_id)
    const lineErrors: Partial<Record<ConfirmLineField, string>> = {}
    const batch = trimBlanks(line.batchNumber)
    if (batch.length > BATCH_NUMBER_MAX) {
      lineErrors.batchNumber = `Au plus ${BATCH_NUMBER_MAX} caractères.`
    }
    if (item?.requires_expiry === true) {
      if (batch === '') lineErrors.batchNumber = 'Cet article périssable exige un numéro de lot.'
      if (line.expiresOn === null) {
        lineErrors.expiresOn = 'Cet article périssable exige une date d’expiration.'
      }
    }
    if (batch === '' && line.expiresOn !== null && item?.requires_expiry !== true) {
      lineErrors.batchNumber = 'Indiquez le numéro du lot de cette date d’expiration.'
    }
    if (line.expiresOn !== null) {
      if (CivilDate.parse(line.expiresOn) === null)
        lineErrors.expiresOn = 'Date d’expiration invalide.'
      else if (line.expiresOn < input.receivedOn) {
        lineErrors.expiresOn =
          'Ce lot est déjà expiré à la date de réception : il ne peut pas entrer en stock.'
      }
    }
    if (line.unitCost !== null && (!Number.isInteger(line.unitCost) || line.unitCost < 0)) {
      lineErrors.unitCost = 'Le coût est un montant entier en FCFA (laissez vide s’il est inconnu).'
    }
    if (Object.keys(lineErrors).length > 0) errors[line.position] = lineErrors
  }
  return errors
}

export function buildValidateRequest(
  lines: readonly ConfirmLineForm[],
): Body<ValidateGoodsReceiptRequest> {
  const mapped = [...lines]
    .sort((left, right) => left.position - right.position)
    .map((line) => {
      const batch = trimBlanks(line.batchNumber)
      return {
        position: line.position,
        lot: batch === '' ? null : { batch_number: batch, expires_on: line.expiresOn },
        unit_cost: line.unitCost,
      }
    })
  const [first, ...rest] = mapped
  if (first === undefined) throw new RangeError('Une réception compte au moins une ligne.')
  return { lines: [first, ...rest] }
}

// --- Erreurs du serveur -------------------------------------------------------------------------------------------

export interface ServerReceiptErrors {
  header: Partial<Record<ReceiptHeaderField, string>>
  /** Erreurs par rang de ligne (0 = première ligne de la charge envoyée). */
  lines: Record<number, Partial<Record<ReceiptLineField | ConfirmLineField, string>>>
  general: string | null
}

const HEADER_KEYS: Readonly<Record<string, ReceiptHeaderField>> = {
  supplier_id: 'supplierId',
  location_id: 'locationId',
  supplier_reference: 'supplierReference',
  received_at: 'receivedOn',
  notes: 'notes',
}

/**
 * Clés d'erreur du serveur (`supplier_reference`, `lines.2.item_id`, `lines.0.lot.expires_on`…) vers les champs de
 * l'écran ; ce qui ne se rattache à aucun champ devient un message général (jamais une erreur perdue).
 */
export function mapReceiptServerErrors(
  fields: Readonly<Record<string, string>>,
): ServerReceiptErrors {
  const result: ServerReceiptErrors = { header: {}, lines: {}, general: null }
  const others: string[] = []
  for (const [key, message] of Object.entries(fields)) {
    const header = HEADER_KEYS[key]
    if (header !== undefined) {
      result.header[header] = message
      continue
    }
    const match =
      /^lines\.(\d+)\.(item_id|quantity|unit_cost|lot|lot\.batch_number|lot\.expires_on|position)$/u.exec(
        key,
      )
    if (match !== null) {
      const index = Number(match[1])
      const target: Partial<Record<ReceiptLineField | ConfirmLineField, string>> =
        result.lines[index] ?? {}
      switch (match[2]) {
        case 'item_id':
          target.itemId = message
          break
        case 'quantity':
          target.quantity = message
          break
        case 'unit_cost':
          target.unitCost = message
          break
        case 'lot.expires_on':
          target.expiresOn = message
          break
        default:
          target.batchNumber = message
      }
      result.lines[index] = target
      continue
    }
    others.push(message)
  }
  if (others.length > 0) result.general = others.join(' ')
  return result
}

export const RECEIPT_STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Brouillon',
  VALIDATED: 'Validée',
  ABANDONED: 'Abandonnée',
}

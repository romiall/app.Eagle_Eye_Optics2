/**
 * Mouvements d'espèces hors vente d'une session de caisse (L1D05) : règles d'écran, sans effet, identiques à celles
 * du serveur (`CashMovements::assertShape`). Le montant saisi est TOUJOURS positif ; le sens vient de la nature :
 * un dépôt entre dans le tiroir, un retrait ou une dépense en sort, une correction de l'ouverture va dans le sens
 * choisi. Une dépense a une catégorie, et elle seule. Une sortie ne dépasse jamais les espèces attendues du tiroir.
 * Jamais un paiement : ni facture, ni reçu.
 */
import { isPaymentMethod, PAYMENT_METHODS } from '@/domain/billing/payment'
import type {
  CashMovementSubject,
  PaymentsMethod,
  RecordCashMovementPayload,
} from '@/domain/contracts/generated'

export type CashMovementKind = CashMovementSubject['movement_kind']
export type CorrectionDirection = 'IN' | 'OUT'

export const MOVEMENT_KINDS: readonly CashMovementKind[] = [
  'EXPENSE',
  'WITHDRAWAL',
  'DEPOSIT',
  'OPENING_CORRECTION',
]

export const EXPENSE_METHODS: readonly PaymentsMethod[] = PAYMENT_METHODS

export const MOVEMENT_KIND_LABELS: Readonly<Record<CashMovementKind, string>> = {
  EXPENSE: 'Dépense',
  WITHDRAWAL: 'Sortie de caisse (coffre / banque)',
  DEPOSIT: 'Entrée d’espèces en caisse',
  OPENING_CORRECTION: 'Correction de l’ouverture',
}

export const MOVEMENT_REASON_MIN = 3
export const MOVEMENT_REASON_MAX = 500
export const MOVEMENT_REFERENCE_MAX = 180
export const MOVEMENT_AMOUNT_MAX = 1_000_000_000_000

export interface MovementInput {
  kind: CashMovementKind | null
  /** Canal de règlement (par défaut CASH ; autres canaux uniquement pour EXPENSE). */
  method?: PaymentsMethod | null
  /** Montant saisi en FCFA, positif (null : non saisi). */
  amount: number | null
  /** Sens d'une correction de l'ouverture (ignoré pour les autres natures). */
  direction: CorrectionDirection | null
  categoryId: string | null
  reason: string
  reference: string
}

export interface CheckedMovement {
  kind: CashMovementKind
  method: PaymentsMethod
  signedAmount: number
  categoryId: string | null
  reason: string | null
  reference: string | null
}

export type MovementCheck =
  | { ok: true; movement: CheckedMovement }
  | {
      ok: false
      errors: Partial<
        Record<
          'kind' | 'method' | 'amount' | 'direction' | 'category' | 'reason' | 'reference',
          string
        >
      >
    }

/** Montant signé d'un mouvement : entrée positive, sortie négative. */
export function signedAmountFor(
  kind: CashMovementKind,
  amount: number,
  direction: CorrectionDirection | null,
): number {
  if (kind === 'DEPOSIT') return amount
  if (kind === 'OPENING_CORRECTION') return direction === 'OUT' ? -amount : amount
  return -amount
}

/**
 * Vérifie la saisie. `available` : espèces attendues du tiroir à l'affichage (null si aucune session ouverte ou
 * inconnu hors tiroir). Pour EXPENSE, motif et référence sont facultatifs ; pour DEPOSIT, WITHDRAWAL et
 * OPENING_CORRECTION, le canal est obligatoirement CASH et le motif est obligatoire (3 à 500 caractères).
 */
export function checkMovement(
  input: MovementInput,
  available: number | null,
  hasOpenSession = available !== null,
): MovementCheck {
  const errors: Partial<
    Record<'kind' | 'method' | 'amount' | 'direction' | 'category' | 'reason' | 'reference', string>
  > = {}
  const method = input.method === undefined ? 'CASH' : input.method

  if (input.kind === null) errors.kind = 'Choisissez la nature du mouvement.'
  if (method === null || !isPaymentMethod(method)) {
    errors.method = 'Choisissez le canal de règlement.'
  } else if (input.kind !== null && input.kind !== 'EXPENSE' && method !== 'CASH') {
    errors.method = 'Seule une dépense peut être enregistrée hors tiroir espèces.'
  } else if (method === 'CASH' && !hasOpenSession) {
    errors.method =
      input.kind === 'EXPENSE'
        ? 'Aucune session de caisse ouverte : ouvrez la caisse ou choisissez un autre canal.'
        : 'Une opération sur le tiroir exige une session de caisse ouverte.'
  }

  if (input.amount === null || !Number.isSafeInteger(input.amount) || input.amount <= 0) {
    errors.amount = 'Indiquez un montant en FCFA, supérieur à zéro.'
  } else if (input.amount > MOVEMENT_AMOUNT_MAX) {
    errors.amount = 'Montant trop élevé.'
  }
  if (input.kind === 'OPENING_CORRECTION' && input.direction === null) {
    errors.direction = 'Indiquez si la correction ajoute ou retire des espèces.'
  }
  if (input.kind === 'EXPENSE' && input.categoryId === null) {
    errors.category = 'Choisissez la catégorie de la dépense.'
  }
  const reason = input.reason.trim()
  if (input.kind === 'EXPENSE') {
    if (reason.length > 0 && reason.length < MOVEMENT_REASON_MIN) {
      errors.reason = `Si vous précisez un motif, indiquez au moins ${MOVEMENT_REASON_MIN} caractères.`
    } else if (reason.length > MOVEMENT_REASON_MAX) {
      errors.reason = `Le motif dépasse ${MOVEMENT_REASON_MAX} caractères.`
    }
  } else {
    if (reason.length < MOVEMENT_REASON_MIN) {
      errors.reason = `Indiquez le motif (au moins ${MOVEMENT_REASON_MIN} caractères).`
    } else if (reason.length > MOVEMENT_REASON_MAX) {
      errors.reason = `Le motif dépasse ${MOVEMENT_REASON_MAX} caractères.`
    }
  }
  const reference = input.reference.trim()
  if (reference.length > MOVEMENT_REFERENCE_MAX) {
    errors.reference = `La référence dépasse ${MOVEMENT_REFERENCE_MAX} caractères.`
  }
  if (
    input.kind !== null &&
    input.amount !== null &&
    method === 'CASH' &&
    available !== null &&
    errors.amount === undefined
  ) {
    const signed = signedAmountFor(input.kind, input.amount, input.direction)
    if (signed < 0 && available + signed < 0) {
      errors.amount = `Le tiroir ne contient en théorie que ${available} FCFA : une sortie ne peut pas les dépasser.`
    }
  }
  if (
    Object.keys(errors).length > 0 ||
    input.kind === null ||
    input.amount === null ||
    method === null ||
    !isPaymentMethod(method)
  ) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    movement: {
      kind: input.kind,
      method,
      signedAmount: signedAmountFor(input.kind, input.amount, input.direction),
      categoryId: input.kind === 'EXPENSE' ? input.categoryId : null,
      reason: reason === '' ? null : reason,
      reference: reference === '' ? null : reference,
    },
  }
}

export type RecordCashMovementRequestPayload = {
  [K in keyof RecordCashMovementPayload]: RecordCashMovementPayload[K]
}

/** Charge exacte de `RecordCashMovement` pour envoi en ligne ou enregistrement sur poste préparé. */
export function buildCashMovementPayload(input: {
  movementId: string
  cashSessionId: string | null
  checked: CheckedMovement
  approvalId: string | null
  occurredAt: string
}): RecordCashMovementRequestPayload {
  return {
    movement_id: input.movementId,
    cash_session_id: input.checked.method === 'CASH' ? input.cashSessionId : null,
    movement_kind: input.checked.kind,
    method: input.checked.method,
    signed_amount: input.checked.signedAmount,
    expense_category_id: input.checked.categoryId,
    reason: input.checked.reason,
    reference: input.checked.reference,
    approval_id: input.approvalId,
    occurred_at: input.occurredAt,
  }
}

/** Somme signée des mouvements de la liste : entrées moins sorties (entiers exacts). */
export function movementsTotal(movements: readonly { signed_amount: number }[]): number {
  return movements.reduce((sum, movement) => sum + movement.signed_amount, 0)
}

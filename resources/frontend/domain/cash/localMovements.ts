import { isPaymentMethod } from '@/domain/billing/payment'
import type { PaymentsMethod } from '@/domain/contracts/generated'

/** États d'un fait dans le journal du poste (forme structurelle de `LocalSyncState`, sans couplage à `@/offline`). */
export type LocalCashSyncState =
  'local' | 'pending' | 'waiting_dependency' | 'conflict' | 'acknowledged' | 'rejected'

/** Fait financier lu dans le coffre (typage structurel de `LocalFactRecord`). */
export interface CashLocalFactRecord {
  state: LocalCashSyncState
  fact: {
    commandId: string
    commandName: string
    entityId: string
    payload: Readonly<Record<string, unknown>>
    recordedAt: string
  }
}

/**
 * Dépenses enregistrées sur CE poste (commandes `RecordCashMovement` de nature `EXPENSE` issues du journal local),
 * pas encore consolidées sur le serveur (`local`, `pending`, `waiting_dependency` ou `conflict`). Permet
 * d'afficher immédiatement les dépenses saisies hors ligne et d'ajuster le disponible du tiroir espèces sur le
 * poste avant synchronisation.
 */
export interface LocalExpense {
  movementId: string
  cashSessionId: string | null
  method: PaymentsMethod
  signedAmount: number
  expenseCategoryId: string | null
  reason: string | null
  reference: string | null
  occurredAt: string
  commandId: string
  recordedAt: string
  state: LocalCashSyncState
}

export interface LocalCashSession {
  cashSessionId: string
  cashRegisterId: string
  openingAmount: number
  openedAt: string
  commandId: string
  state: LocalCashSyncState
}

const FINAL_STATES: ReadonlySet<LocalCashSyncState> = new Set(['acknowledged', 'rejected'])
const COUNTED_STATES: ReadonlySet<LocalCashSyncState> = new Set([
  'local',
  'pending',
  'waiting_dependency',
])

export function isLocalExpensePending(fact: { state: LocalCashSyncState }): boolean {
  return !FINAL_STATES.has(fact.state)
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Extrait les dépenses locales triées de la plus récente à la plus ancienne. */
export function localExpensesFromFacts(records: readonly CashLocalFactRecord[]): LocalExpense[] {
  const expenses: LocalExpense[] = []
  for (const record of records) {
    const { fact, state } = record
    if (fact.commandName !== 'RecordCashMovement') continue
    if (fact.payload['movement_kind'] !== 'EXPENSE') continue
    const rawMethod = fact.payload['method']
    const method: PaymentsMethod =
      typeof rawMethod === 'string' && isPaymentMethod(rawMethod) ? rawMethod : 'CASH'
    const amount = fact.payload['signed_amount']
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount >= 0) continue
    expenses.push({
      movementId: asStringOrNull(fact.payload['movement_id']) ?? fact.entityId,
      cashSessionId: asStringOrNull(fact.payload['cash_session_id']),
      method,
      signedAmount: amount,
      expenseCategoryId: asStringOrNull(fact.payload['expense_category_id']),
      reason: asStringOrNull(fact.payload['reason']),
      reference: asStringOrNull(fact.payload['reference']),
      occurredAt: asStringOrNull(fact.payload['occurred_at']) ?? fact.recordedAt,
      commandId: fact.commandId,
      recordedAt: fact.recordedAt,
      state,
    })
  }
  return expenses.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

/** Dépenses locales encore absentes de la projection serveur (jamais de double compte). */
export function pendingLocalExpenses(
  local: readonly LocalExpense[],
  serverIds: ReadonlySet<string> = new Set(),
): LocalExpense[] {
  return local.filter(
    (expense) => !FINAL_STATES.has(expense.state) && !serverIds.has(expense.movementId),
  )
}

/** Variations négatives du tiroir pour une session donnée dues aux dépenses locales non finalisées sans conflit. */
export function localDrawerExpenseDelta(
  records: readonly CashLocalFactRecord[],
  cashSessionId: string | null,
  serverMovementIds: ReadonlySet<string> = new Set(),
): number {
  if (cashSessionId === null) return 0
  return pendingLocalExpenses(localExpensesFromFacts(records), serverMovementIds)
    .filter(
      (expense) =>
        COUNTED_STATES.has(expense.state) &&
        expense.method === 'CASH' &&
        expense.cashSessionId === cashSessionId,
    )
    .reduce((sum, expense) => sum + expense.signedAmount, 0)
}

/** Session ouverte localement sur ce poste mais pas encore consolidée sur le serveur. */
export function localPendingCashSession(
  records: readonly CashLocalFactRecord[],
): LocalCashSession | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record === undefined) continue
    const { fact, state } = record
    if (fact.commandName !== 'OpenCashSession') continue
    if (FINAL_STATES.has(state)) continue
    const cashSessionId = asStringOrNull(fact.payload['cash_session_id']) ?? fact.entityId
    const cashRegisterId = asStringOrNull(fact.payload['cash_register_id'])
    const openingAmount = fact.payload['opening_amount']
    const openedAt = asStringOrNull(fact.payload['opened_at']) ?? fact.recordedAt
    if (
      cashRegisterId === null ||
      typeof openingAmount !== 'number' ||
      !Number.isSafeInteger(openingAmount)
    ) {
      continue
    }
    return {
      cashSessionId,
      cashRegisterId,
      openingAmount,
      openedAt,
      commandId: fact.commandId,
      state,
    }
  }
  return null
}

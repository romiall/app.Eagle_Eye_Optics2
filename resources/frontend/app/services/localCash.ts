import { NetworkUnavailable } from '@/app/api'
import { getCurrentCashSession, listExpenseCategories } from '@/app/services/billing'
import {
  localCurrentCashSessionSnapshot,
  localExpenseCategoriesSnapshot,
  localFinancialFacts,
  noteLocalCurrentCashSession,
  noteLocalExpenseCategories,
} from '@/app/services/vault'
import type { CashSession, ExpenseCategory } from '@/domain/contracts/generated'
import {
  type LocalCashSession,
  type LocalExpense,
  localDrawerExpenseDelta,
  localExpensesFromFacts,
  localPendingCashSession,
  pendingLocalExpenses,
} from '@/domain/cash/localMovements'

export type { LocalCashSession, LocalExpense } from '@/domain/cash/localMovements'
export {
  isLocalExpensePending,
  localDrawerExpenseDelta,
  pendingLocalExpenses,
} from '@/domain/cash/localMovements'

/** Lit les dépenses locales encore sur ce poste (compartiment FINANCIAL, coffre ouvert). */
export async function loadLocalExpenses(
  serverMovementIds: ReadonlySet<string> = new Set(),
): Promise<LocalExpense[]> {
  return pendingLocalExpenses(
    localExpensesFromFacts(await localFinancialFacts()),
    serverMovementIds,
  )
}

/** Ajustement net (<= 0) des espèces disponibles d'une session dû aux dépenses non consolidées. */
export async function loadLocalDrawerDelta(
  cashSessionId: string | null,
  serverMovementIds: ReadonlySet<string> = new Set(),
): Promise<number> {
  return localDrawerExpenseDelta(await localFinancialFacts(), cashSessionId, serverMovementIds)
}

/** Session ouverte localement sur ce poste (si OpenCashSession vient d'être commis hors ligne). */
export async function loadLocalOpenedSession(): Promise<LocalCashSession | null> {
  return localPendingCashSession(await localFinancialFacts())
}

/**
 * Lit les catégories de dépenses sur le serveur et les mémorise dans le coffre chiffré si possible ;
 * si le réseau est indisponible et que le coffre en contient une copie, retourne la copie du poste.
 */
export async function loadExpenseCategoriesWithFallback(): Promise<{
  categories: ExpenseCategory[]
  fromDevice: boolean
}> {
  try {
    const res = await listExpenseCategories()
    await noteLocalExpenseCategories(res.data)
    return { categories: res.data, fromDevice: false }
  } catch (error) {
    if (error instanceof NetworkUnavailable) {
      const cached = await localExpenseCategoriesSnapshot()
      if (cached !== null) {
        return { categories: cached, fromDevice: true }
      }
    }
    throw error
  }
}

/**
 * Lit la session de caisse courante sur le serveur et la mémorise dans le coffre chiffré ;
 * si le réseau est indisponible, retourne une éventuelle session ouverte mémorisée ou ouverte localement.
 */
export async function loadCurrentCashSessionWithFallback(): Promise<{
  session: CashSession | null
  localPending: LocalCashSession | null
  fromDevice: boolean
}> {
  try {
    const res = await getCurrentCashSession()
    await noteLocalCurrentCashSession(res.data)
    return { session: res.data, localPending: null, fromDevice: false }
  } catch (error) {
    if (error instanceof NetworkUnavailable) {
      const localPending = await loadLocalOpenedSession()
      const cached = await localCurrentCashSessionSnapshot()
      if (cached !== null || localPending !== null) {
        return {
          session: cached?.session ?? null,
          localPending,
          fromDevice: true,
        }
      }
    }
    throw error
  }
}

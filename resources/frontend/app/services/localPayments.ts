import { localFinancialFacts } from '@/app/services/vault'
import { type LocalPayment, localPaymentsFor } from '@/domain/billing/localPayments'

export type { LocalPayment } from '@/domain/billing/localPayments'
export {
  collectionBlockedByReview,
  countedLocal,
  effectiveBalance,
  effectiveLedgerVersion,
  localReceiptOf,
  notYetOnServer,
} from '@/domain/billing/localPayments'

/**
 * Encaissements enregistrés sur CE poste pour une facture (G1), lus dans le coffre ouvert : le module `offline` fermé
 * ou le coffre verrouillé en rendent une liste vide (rien n'est alors annoncé). Jamais une écriture, jamais le réseau.
 */
export async function loadLocalPayments(invoiceId: string): Promise<LocalPayment[]> {
  return localPaymentsFor(invoiceId, await localFinancialFacts())
}

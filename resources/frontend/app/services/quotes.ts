import { apiRequest } from '@/app/api'
import type { Quote, QuotePage, QuoteResponse, QuotesStatus } from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lectures des devis (L1D07), EN LIGNE seulement, comme les factures : chaque lecture rend la donnée avec sa
 * fraîcheur (heure de la réponse du serveur à CET appel). Une erreur du serveur est propagée telle quelle (404 d'un
 * module fermé ou d'un devis inconnu, 403, 422) ; un réseau coupé reste `NetworkUnavailable`, jamais une liste vide.
 * Rien n'est conservé sur le poste. Les écritures passent par le répartiteur de mutations (`useMutation`, routes
 * explicites `/quotes/...`).
 */
function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export interface QuoteFilters {
  status?: QuotesStatus | null
  patientId?: string | null
  page?: number
}

/** Devis, les plus récents d'abord (25 par page), avec leur destinataire et leur statut à l'instant. */
export async function listQuotes(filters: QuoteFilters = {}): Promise<ReadOutcome<QuotePage>> {
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page invalide.')
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null)
    parameters.set('status', filters.status)
  if (filters.patientId !== undefined && filters.patientId !== null) {
    if (!isUlid(filters.patientId)) throw new RangeError('Identifiant de patient invalide.')
    parameters.set('patient_id', filters.patientId)
  }
  return answered(await apiRequest<QuotePage>('GET', `/api/v1/quotes?${parameters}`))
}

/** Devis, lignes actuelles, révisions figées (snapshot, document) et factures nées de sa conversion. */
export async function getQuote(id: string): Promise<ReadOutcome<Quote>> {
  if (!isUlid(id)) throw new RangeError('Identifiant de devis invalide.')
  const response = await apiRequest<QuoteResponse>(
    'GET',
    `/api/v1/quotes/${encodeURIComponent(id)}`,
  )
  return answered(response.data)
}

/** Chemin (relatif à `/api/v1`) d'une écriture sur un devis, pour la route explicite du répartiteur. */
export function quotePath(
  id: string,
  action: '' | 'issue' | 'revisions' | 'decision' | 'conversions' | 'delete',
): string {
  if (!isUlid(id)) throw new RangeError('Identifiant de devis invalide.')
  const base = `/quotes/${encodeURIComponent(id)}`
  return action === '' ? base : `${base}/${action}`
}

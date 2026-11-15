import { apiRequest } from '@/app/api'
import type {
  Publication,
  PublicationPage,
  PublicationResponse,
  PublicContentList,
} from '@/domain/contracts/generated'
import { isUlid, newUlid } from '@/domain/values/ulid'

import type { ReadOutcome } from './reads'

/**
 * Lectures et envois du serveur pour le site public (L3D02), EN LIGNE seulement, droit `site.publish` (gérante).
 * Les écritures JSON (fiches, contenus, publication) passent par `useMutation` ; ici : les lectures, l'image (octets
 * bruts, avec sa note de droits) et son retrait.
 */
export async function listPublications(
  filters: { status?: string | null; page?: number } = {},
): Promise<ReadOutcome<PublicationPage>> {
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Page invalide.')
  }
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    parameters.set('status', filters.status)
  }
  const data = await apiRequest<PublicationPage>('GET', `/api/v1/publications?${parameters}`)
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export async function listPublicContents(): Promise<ReadOutcome<PublicContentList>> {
  const data = await apiRequest<PublicContentList>('GET', '/api/v1/public-contents')
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

/** Adresse de l'image d'une fiche pour la gérante (brouillon compris) : même origine, jamais publique. */
export function publicationMediaUrl(mediaId: string): string {
  return `/api/v1/publication-media/${mediaId}`
}

export async function attachPublicationMedia(
  publicationId: string,
  file: File,
  alt: string,
  rights: string,
  order: number,
): Promise<Publication> {
  if (!isUlid(publicationId)) {
    throw new RangeError('Identifiant de fiche invalide.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const parameters = new URLSearchParams({
    alt_text: alt.trim(),
    rights_note: rights.trim(),
    display_order: String(order),
  })
  const response = await apiRequest<PublicationResponse>(
    'POST',
    `/api/v1/publications/${publicationId}/media?${parameters}`,
    bytes,
    { 'Content-Type': file.type, 'Idempotency-Key': newUlid() },
  )
  return response.data
}

export async function removePublicationMedia(
  publicationId: string,
  mediaId: string,
): Promise<Publication> {
  if (!isUlid(publicationId) || !isUlid(mediaId)) {
    throw new RangeError('Identifiant invalide.')
  }
  const response = await apiRequest<PublicationResponse>(
    'DELETE',
    `/api/v1/publications/${publicationId}/media/${mediaId}`,
    undefined,
    { 'Idempotency-Key': newUlid() },
  )
  return response.data
}

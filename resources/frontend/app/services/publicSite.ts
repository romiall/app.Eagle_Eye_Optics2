import { apiRequest } from '@/app/api'
import type {
  BookingReceipt,
  BookingReceiptResponse,
  BookingRequest,
  PublicContent,
  PublicContentPublicList,
  PublicService,
  PublicServiceList,
  PublicSlot,
  PublicSlotList,
  ShowroomItem,
  ShowroomItemResponse,
  ShowroomPage,
} from '@/domain/contracts/generated'

import type { ReadOutcome } from './reads'

/**
 * Lectures et dépôt du site public (L3D02, L3D03) : pages SANS compte, adresses `/public/v1`. Aucune donnée clinique et
 * aucun identifiant interne autre que la prestation et le créneau choisis par le visiteur ; le serveur ne dit jamais
 * si un téléphone correspond à un patient (AT35). EN LIGNE seulement : une demande n'est jamais gardée « pour plus tard »
 * sur l'appareil d'un visiteur, elle est envoyée ou elle ne l'est pas.
 */
const PUBLIC = '/public/v1'

function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export async function listPublicServices(): Promise<ReadOutcome<PublicService[]>> {
  return answered((await apiRequest<PublicServiceList>('GET', `${PUBLIC}/services`)).data)
}

/** Créneaux libres d'une prestation sur une fenêtre de 14 jours au plus (bornes ISO, `to` après `from`). */
export async function listPublicSlots(
  serviceId: string,
  from: string,
  to: string,
): Promise<ReadOutcome<PublicSlot[]>> {
  const parameters = new URLSearchParams({ service_id: serviceId, from, to })
  return answered((await apiRequest<PublicSlotList>('GET', `${PUBLIC}/slots?${parameters}`)).data)
}

/**
 * Dépose une demande de rendez-vous. La MÊME clé d'idempotence est reprise tant que la demande est la même : une réponse
 * perdue puis un nouvel envoi ne font jamais deux demandes.
 */
export async function requestPublicBooking(
  request: BookingRequest,
  idempotencyKey: string,
): Promise<BookingReceipt> {
  const response = await apiRequest<BookingReceiptResponse>(
    'POST',
    `${PUBLIC}/booking-requests`,
    request,
    { 'Idempotency-Key': idempotencyKey },
  )
  return response.data
}

export async function listShowroom(
  filters: { style?: string | null; brand?: string | null; page?: number } = {},
): Promise<ReadOutcome<ShowroomPage>> {
  const page = filters.page ?? 1
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Page invalide.')
  }
  const parameters = new URLSearchParams({ page: String(page) })
  if (filters.style) parameters.set('style', filters.style)
  if (filters.brand) parameters.set('brand', filters.brand)
  return answered(await apiRequest<ShowroomPage>('GET', `${PUBLIC}/showroom?${parameters}`))
}

export async function getShowroomItem(slug: string): Promise<ReadOutcome<ShowroomItem>> {
  if (!/^[a-z0-9-]{1,180}$/.test(slug)) {
    throw new RangeError('Adresse de référence invalide.')
  }
  const response = await apiRequest<ShowroomItemResponse>(
    'GET',
    `${PUBLIC}/showroom/${encodeURIComponent(slug)}`,
  )
  return answered(response.data)
}

/** Contenus approuvés du site (accueil, horaires, localisation, contact…) : seules les révisions publiées. */
export async function listSiteContents(): Promise<ReadOutcome<PublicContent[]>> {
  return answered((await apiRequest<PublicContentPublicList>('GET', `${PUBLIC}/contents`)).data)
}

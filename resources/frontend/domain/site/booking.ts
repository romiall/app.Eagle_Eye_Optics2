import type { BookingRequest, PublicSlot } from '@/domain/contracts/generated'
import { RuleViolation } from '@/domain/errors'
import { CivilDate } from '@/domain/values/civilDate'
import { normalizePhone } from '@/domain/values/text'

/**
 * Règles de la prise de rendez-vous du public (L3D03, AT33, AT35) : ce que le visiteur saisit, ce qui part au serveur.
 * Le serveur rejuge tout (prestation ouverte au public, créneau encore libre, consentement, anti-abus) ; ces règles
 * nomment le champ en faute sans aller-retour. Aucune donnée de santé n'est demandée ni envoyée.
 */
export const NAME_MIN = 2
export const NAME_MAX = 180
export const EMAIL_MAX = 254

/** Fenêtre de lecture des créneaux : une semaine à la fois (le serveur en admet 14 au plus), huit semaines au plus. */
export const SLOT_WINDOW_DAYS = 7
export const SLOT_WINDOWS_MAX = 8
const DAY_MILLISECONDS = 86_400_000

export interface BookingForm {
  name: string
  phone: string
  email: string
  consent: boolean
  /** Piège à robots : un visiteur humain ne le voit pas et ne le remplit jamais. */
  website: string
}

export type BookingField = 'service' | 'slot' | 'name' | 'phone' | 'email' | 'consent'
export type BookingErrors = Partial<Record<BookingField, string>>

export function emptyBookingForm(): BookingForm {
  return { name: '', phone: '', email: '', consent: false, website: '' }
}

export function hasBookingErrors(errors: BookingErrors): boolean {
  return Object.values(errors).some((message) => message !== undefined)
}

/** Fenêtre `index` (0 : maintenant, puis semaine par semaine, sans trou ni recouvrement) en bornes ISO. */
export function slotWindow(startMilliseconds: number, index: number): { from: string; to: string } {
  const from = startMilliseconds + index * SLOT_WINDOW_DAYS * DAY_MILLISECONDS
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + SLOT_WINDOW_DAYS * DAY_MILLISECONDS).toISOString(),
  }
}

export interface SlotDay {
  /** Jour civil du cabinet, « AAAA-MM-JJ ». */
  day: string
  /** Un seul créneau par heure de début, dans l'ordre des heures. */
  slots: PublicSlot[]
}

/**
 * Créneaux regroupés par jour civil DU CABINET (jamais par minuit UTC) : deux ressources libres à la même heure ne font
 * qu'un bouton, la ressource retenue est celle du premier créneau.
 */
export function groupSlotsByDay(slots: readonly PublicSlot[], timeZone: string): SlotDay[] {
  const days = new Map<string, PublicSlot[]>()
  const ordered = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  for (const slot of ordered) {
    const day = CivilDate.fromEpochMilliseconds(Date.parse(slot.starts_at), timeZone).toString()
    const list = days.get(day) ?? []
    if (!list.some((known) => known.starts_at === slot.starts_at)) list.push(slot)
    days.set(day, list)
  }
  return [...days.entries()].map(([day, list]) => ({ day, slots: list }))
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateBooking(
  form: BookingForm,
  serviceId: string | null,
  slotStart: string | null,
): BookingErrors {
  const errors: BookingErrors = {}
  if (serviceId === null) errors.service = 'Choisissez la prestation.'
  if (slotStart === null) errors.slot = 'Choisissez un créneau.'
  const name = form.name.trim()
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.name = 'Indiquez votre nom et votre prénom.'
  }
  try {
    if (normalizePhone(form.phone, 'phone') === null) {
      errors.phone = 'Indiquez un numéro de téléphone pour que le cabinet puisse vous répondre.'
    }
  } catch (failure) {
    if (!(failure instanceof RuleViolation)) throw failure
    errors.phone = failure.message
  }
  const email = form.email.trim()
  if (email !== '' && (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))) {
    errors.email =
      'Cette adresse e-mail n’est pas valide. Laissez le champ vide si vous n’en avez pas.'
  }
  if (!form.consent) {
    errors.consent = 'Cochez la case pour que le cabinet puisse traiter votre demande.'
  }
  return errors
}

/** Champ du formulaire pour un nom de champ du serveur (refus 422), ou null s'il n'a pas de champ. */
export function bookingFieldFromServer(key: string): BookingField | null {
  switch (key) {
    case 'service_id':
      return 'service'
    case 'starts_at':
    case 'resource_id':
      return 'slot'
    case 'name':
      return 'name'
    case 'phone':
      return 'phone'
    case 'email':
      return 'email'
    case 'consent':
      return 'consent'
    default:
      return null
  }
}

/**
 * Corps de la demande. Le piège à robots n'est envoyé que s'il a été rempli (jamais par un visiteur) ; la référence du
 * showroom, seulement si la demande en vient.
 */
export function buildBookingRequest(
  form: BookingForm,
  serviceId: string,
  slot: PublicSlot,
  publicationSlug: string | null,
): BookingRequest {
  const email = form.email.trim()
  return {
    service_id: serviceId,
    resource_id: slot.resource_id,
    starts_at: slot.starts_at,
    name: form.name.trim(),
    phone: form.phone.trim(),
    ...(email === '' ? {} : { email }),
    consent: true,
    ...(publicationSlug === null ? {} : { publication_slug: publicationSlug }),
    ...(form.website === '' ? {} : { website: form.website }),
  }
}

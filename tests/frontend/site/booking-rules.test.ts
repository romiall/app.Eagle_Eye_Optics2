import { describe, expect, it } from 'vitest'

import type { PublicSlot } from '@/domain/contracts/generated'
import {
  buildBookingRequest,
  bookingFieldFromServer,
  emptyBookingForm,
  groupSlotsByDay,
  hasBookingErrors,
  SLOT_WINDOW_DAYS,
  slotWindow,
  validateBooking,
} from '@/domain/site/booking'

// Règles de la prise de rendez-vous du public (L3D03, AT33, AT35). Données FICTIVES. Identifiants au format ULID.
const SERVICE = '01J9ZXK4M2Q8R7S6T5V4WS0001'
const ROOM_A = '01J9ZXK4M2Q8R7S6T5V4WR0001'
const ROOM_B = '01J9ZXK4M2Q8R7S6T5V4WR0002'

function slot(startsAt: string, resource = ROOM_A): PublicSlot {
  return {
    service_id: SERVICE,
    resource_id: resource,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
  }
}

const VALID = {
  ...emptyBookingForm(),
  name: 'Visiteur Fictif',
  phone: '+237 699 00 11 22',
  consent: true,
}

describe('créneaux du public', () => {
  it('regroupe par jour civil DU CABINET et non par minuit UTC', () => {
    // 23 h 30 UTC le 30 novembre est 00 h 30 le 1er décembre à Douala (UTC+1) : c'est le jour suivant.
    const days = groupSlotsByDay(
      [slot('2026-11-30T23:30:00.000Z'), slot('2026-11-30T08:00:00.000Z')],
      'Africa/Douala',
    )
    expect(days.map((entry) => entry.day)).toEqual(['2026-11-30', '2026-12-01'])
    expect(days[1]?.slots.map((entry) => entry.starts_at)).toEqual(['2026-11-30T23:30:00.000Z'])
  })

  it('ne fait qu’un bouton par heure de début même si deux ressources sont libres, dans l’ordre des heures', () => {
    const days = groupSlotsByDay(
      [
        slot('2026-11-30T09:00:00.000Z', ROOM_B),
        slot('2026-11-30T08:00:00.000Z', ROOM_A),
        slot('2026-11-30T08:00:00.000Z', ROOM_B),
      ],
      'Africa/Douala',
    )
    expect(days).toHaveLength(1)
    expect(days[0]?.slots.map((entry) => `${entry.starts_at}|${entry.resource_id}`)).toEqual([
      `2026-11-30T08:00:00.000Z|${ROOM_A}`,
      `2026-11-30T09:00:00.000Z|${ROOM_B}`,
    ])
  })

  it('lit une semaine à la fois, sans trou ni recouvrement', () => {
    const start = Date.parse('2026-11-30T08:00:00.000Z')
    const first = slotWindow(start, 0)
    const second = slotWindow(start, 1)
    expect(first.from).toBe('2026-11-30T08:00:00.000Z')
    expect(second.from).toBe(first.to)
    expect(Date.parse(second.to) - Date.parse(second.from)).toBe(SLOT_WINDOW_DAYS * 86_400_000)
  })
})

describe('demande de rendez-vous', () => {
  const chosen = '2026-11-30T08:00:00.000Z'

  it('une demande complète ne signale aucune erreur', () => {
    expect(hasBookingErrors(validateBooking(VALID, SERVICE, chosen))).toBe(false)
  })

  it('nomme chaque champ en faute', () => {
    const errors = validateBooking(emptyBookingForm(), null, null)
    expect(Object.keys(errors).sort()).toEqual(['consent', 'name', 'phone', 'service', 'slot'])
  })

  it('refuse un téléphone qui n’en est pas un et une adresse e-mail invalide, mais accepte l’absence d’e-mail', () => {
    expect(validateBooking({ ...VALID, phone: 'appelez-moi' }, SERVICE, chosen).phone).toMatch(
      /chiffres/,
    )
    expect(validateBooking({ ...VALID, phone: '12' }, SERVICE, chosen).phone).toMatch(/3 à 31/)
    expect(validateBooking({ ...VALID, email: 'pas-une-adresse' }, SERVICE, chosen).email).toMatch(
      /pas valide/,
    )
    expect(validateBooking({ ...VALID, email: '' }, SERVICE, chosen).email).toBeUndefined()
  })

  it('construit la demande avec la ressource du créneau, sans champ vide ni piège rempli', () => {
    expect(buildBookingRequest(VALID, SERVICE, slot(chosen), null)).toEqual({
      service_id: SERVICE,
      resource_id: ROOM_A,
      starts_at: chosen,
      name: 'Visiteur Fictif',
      phone: '+237 699 00 11 22',
      consent: true,
    })
    expect(
      buildBookingRequest(
        { ...VALID, email: ' visiteur@exemple.test ' },
        SERVICE,
        slot(chosen),
        'monture-legere-fictive',
      ),
    ).toMatchObject({ email: 'visiteur@exemple.test', publication_slug: 'monture-legere-fictive' })
    expect(
      buildBookingRequest({ ...VALID, website: 'x' }, SERVICE, slot(chosen), null),
    ).toMatchObject({
      website: 'x',
    })
  })

  it('associe les champs du serveur à ceux du formulaire', () => {
    expect(bookingFieldFromServer('service_id')).toBe('service')
    expect(bookingFieldFromServer('starts_at')).toBe('slot')
    expect(bookingFieldFromServer('phone')).toBe('phone')
    expect(bookingFieldFromServer('request')).toBeNull()
  })
})

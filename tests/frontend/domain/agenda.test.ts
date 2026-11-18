import { describe, expect, it } from 'vitest'

import {
  calculatedDate,
  canMarkNoShow,
  canRegisterArrival,
  groupByDay,
  isChangeable,
  monthGridWeeks,
  NEXT_STATUSES,
  nextAttemptAllowed,
  nextAttemptRequired,
  openingHourErrors,
  shownDays,
  validateCancelReason,
  weekdayIndex,
} from '@/domain/agenda/agenda'
import type { Appointment } from '@/domain/contracts/generated'
import { CivilDate } from '@/domain/values/civilDate'

/**
 * Règles pures de l'agenda (S01) et des suivis (S02), jumelles du serveur : semaine du lundi, transitions d'un
 * rendez-vous, créneaux hebdomadaires, date de contrôle au calendrier civil, résultats d'une tentative. Fictif.
 */
const day = (iso: string): CivilDate => CivilDate.fromString(iso)
const ZONE = 'Africa/Douala'

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: '01J9ZXK4M2Q8R7S6T5V4W30A01',
    patient_id: '01J9ZXK4M2Q8R7S6T5V4W30P01',
    patient: {
      id: '01J9ZXK4M2Q8R7S6T5V4W30P01',
      record_number: 'EE-2026-0001',
      last_name: 'PATIENT FICTIF',
      first_names: 'Test',
    },
    prospect_contact_id: null,
    follow_up_id: null,
    resource_id: '01J9ZXK4M2Q8R7S6T5V4W30R01',
    resource_name: 'Salle fictive',
    service_id: '01J9ZXK4M2Q8R7S6T5V4W30S01',
    service_name: 'Prestation fictive',
    starts_at: '2026-10-23T07:00:00.000Z',
    ends_at: '2026-10-23T07:30:00.000Z',
    status: 'CONFIRMED',
    source: 'INTERNAL',
    administrative_reason: null,
    cancel_reason: null,
    visit_id: null,
    version: 1,
    ...overrides,
  }
}

describe('jours affichés', () => {
  it('la semaine va du lundi au dimanche (le 2026-10-22 est un jeudi)', () => {
    expect(weekdayIndex(day('2026-10-22'))).toBe(3)
    const week = shownDays(day('2026-10-22'), 'week').map((entry) => entry.toString())
    expect(week).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ])
    expect(shownDays(day('2026-10-22'), 'day').map((entry) => entry.toString())).toEqual([
      '2026-10-22',
    ])
  })

  it('le calendrier mensuel couvre des semaines complètes du lundi au dimanche', () => {
    // Octobre 2026 commence un jeudi (1er = jeudi -> 28 sept.) et finit un samedi (31 = samedi -> 1er nov.).
    const weeks = monthGridWeeks(day('2026-10-15'))
    expect(weeks).toHaveLength(5)
    expect(weeks[0]?.[0]?.day.toString()).toBe('2026-09-28')
    expect(weeks[0]?.[0]?.inMonth).toBe(false)
    expect(weeks[0]?.[3]?.day.toString()).toBe('2026-10-01')
    expect(weeks[0]?.[3]?.inMonth).toBe(true)
    expect(weeks[4]?.[6]?.day.toString()).toBe('2026-11-01')
    expect(weeks[4]?.[6]?.inMonth).toBe(false)
    expect(shownDays(day('2026-10-15'), 'month')).toHaveLength(35)
  })

  it('un rendez-vous appartient au jour civil du cabinet, pas au jour UTC', () => {
    const late = appointment({
      id: '01J9ZXK4M2Q8R7S6T5V4W30A02',
      starts_at: '2026-10-22T23:30:00.000Z',
      ends_at: '2026-10-23T00:00:00.000Z',
    })
    const groups = groupByDay([appointment(), late], [day('2026-10-22'), day('2026-10-23')], ZONE)
    expect(groups[0]!.appointments).toHaveLength(0)
    expect(groups[1]!.appointments.map((entry) => entry.id)).toEqual([
      '01J9ZXK4M2Q8R7S6T5V4W30A02',
      '01J9ZXK4M2Q8R7S6T5V4W30A01',
    ])
  })
})

describe('transitions d’un rendez-vous', () => {
  it('seuls un rendez-vous confirmé ou à confirmer se modifient', () => {
    expect(isChangeable(appointment())).toBe(true)
    for (const status of ['ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(isChangeable(appointment({ status }))).toBe(false)
    }
  })

  it('l’absence ne se constate qu’après l’heure', () => {
    expect(canMarkNoShow(appointment(), Date.parse('2026-10-23T06:59:00.000Z'))).toBe(false)
    expect(canMarkNoShow(appointment(), Date.parse('2026-10-23T07:00:00.000Z'))).toBe(true)
  })

  it('l’arrivée se propose le jour même, une seule fois', () => {
    expect(canRegisterArrival(appointment(), day('2026-10-23'), ZONE)).toBe(true)
    expect(canRegisterArrival(appointment(), day('2026-10-22'), ZONE)).toBe(false)
    expect(
      canRegisterArrival(
        appointment({ visit_id: '01J9ZXK4M2Q8R7S6T5V4W30V01' }),
        day('2026-10-23'),
        ZONE,
      ),
    ).toBe(false)
  })

  it('le motif d’annulation est obligatoire et borné', () => {
    expect(validateCancelReason('  ab ').ok).toBe(false)
    expect(validateCancelReason('Patient indisponible')).toEqual({
      ok: true,
      reason: 'Patient indisponible',
    })
    expect(validateCancelReason('x'.repeat(1001)).ok).toBe(false)
  })
})

describe('créneaux hebdomadaires', () => {
  it('refuse les heures invalides, inversées et les chevauchements du même jour', () => {
    const errors = openingHourErrors([
      { id: 'a', weekday: 1, opens_at: '08:00', closes_at: '12:00' },
      { id: 'b', weekday: 1, opens_at: '11:00', closes_at: '13:00' },
      { id: 'c', weekday: 2, opens_at: '12:00', closes_at: '12:00' },
      { id: 'd', weekday: 3, opens_at: '8h', closes_at: '12:00' },
      { id: 'e', weekday: 2, opens_at: '08:00', closes_at: '11:00' },
    ])
    expect(Object.keys(errors).sort()).toEqual(['1', '2', '3'])
  })
})

describe('contrôle recommandé', () => {
  it('date de départ + délai au calendrier civil, jamais sans délai', () => {
    expect(calculatedDate(day('2026-10-22'), 3, 'MONTH')?.toString()).toBe('2027-01-22')
    expect(calculatedDate(day('2027-01-31'), 1, 'MONTH')?.toString()).toBe('2027-02-28')
    expect(calculatedDate(day('2026-10-22'), 12, 'DAY')?.toString()).toBe('2026-11-03')
    expect(calculatedDate(null, 3, 'MONTH')).toBeNull()
    expect(calculatedDate(day('2026-10-22'), null, null)).toBeNull()
  })
})

describe('tentatives de contact', () => {
  it('chaque résultat mène aux états du serveur', () => {
    expect(NEXT_STATUSES.BOOKED).toEqual(['BOOKED'])
    expect(NEXT_STATUSES.NO_RESPONSE).toEqual(['NO_RESPONSE', 'POSTPONED'])
    expect(NEXT_STATUSES.FAILED).toEqual(['PENDING', 'NO_RESPONSE'])
  })

  it('un report exige la date de nouvelle tentative ; un état clos n’en a pas', () => {
    expect(nextAttemptRequired('POSTPONED')).toBe(true)
    expect(nextAttemptAllowed('CONTACTED')).toBe(false)
    expect(nextAttemptAllowed('NO_RESPONSE')).toBe(true)
  })
})

import { CivilDate } from '@/domain/values/civilDate'

import { session } from './session'

/**
 * Fuseau et jour civil du cabinet. Le fuseau vient du cabinet connecté (`/auth/me`, proposition
 * « Africa/Douala » d'après les sources) ; sans compte connu, la valeur par défaut est celle des
 * composants d'affichage. Le jour civil sert aux règles « naissance non future » et à l'âge : il
 * n'est jamais déduit d'un minuit UTC.
 */
export const DEFAULT_CLINIC_TIME_ZONE = 'Africa/Douala'

export function clinicTimeZone(): string {
  return (
    session.account?.clinic.timezone ??
    session.lastAccount?.clinic.timezone ??
    DEFAULT_CLINIC_TIME_ZONE
  )
}

/** Jour civil du cabinet à l'instant `now` (millisecondes). */
export function clinicToday(now: number = Date.now()): CivilDate {
  try {
    return CivilDate.fromEpochMilliseconds(now, clinicTimeZone())
  } catch (error) {
    // Fuseau inconnu du navigateur : le fuseau par défaut vaut mieux qu'un écran inutilisable.
    if (!(error instanceof RangeError)) throw error
    return CivilDate.fromEpochMilliseconds(now, DEFAULT_CLINIC_TIME_ZONE)
  }
}

/** Heure d'un instant UTC à l'heure du cabinet : « 10h42 » (file du jour, arrivées). */
export function formatTimeFr(instant: string): string {
  const stamp = (timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant))
    const read = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '00'
    return `${read('hour')}h${read('minute')}`
  }
  try {
    return stamp(clinicTimeZone())
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return stamp(DEFAULT_CLINIC_TIME_ZONE)
  }
}

/**
 * Jour civil en toutes lettres : « jeudi 22 octobre 2026 ». C'est une date du calendrier, sans fuseau :
 * elle est mise en forme à midi UTC pour qu'aucun fuseau d'affichage ne change le jour.
 */
export function formatDayFr(day: CivilDate): string {
  const noon = Date.UTC(day.year, day.month - 1, day.day, 12)
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(noon))
}

/**
 * Mois et année en toutes lettres : « novembre 2026 » (calendrier mensuel de l'agenda).
 */
export function formatMonthYearFr(day: CivilDate): string {
  const noon = Date.UTC(day.year, day.month - 1, day.day, 12)
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(noon))
}

/** Instant UTC affiché à l'heure du cabinet : « 15/10/2026 à 10h42 ». */
export function formatInstantFr(instant: string): string {
  const stamp = (timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant))
    const read = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '00'
    return `${read('day')}/${read('month')}/${read('year')} à ${read('hour')}h${read('minute')}`
  }
  try {
    return stamp(clinicTimeZone())
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return stamp(DEFAULT_CLINIC_TIME_ZONE)
  }
}

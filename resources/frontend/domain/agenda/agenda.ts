/**
 * Règles pures de l'agenda (S01) et des suivis (S02) : libellés, semaine du lundi au dimanche, créneaux et
 * transitions d'un rendez-vous, délais de contrôle proposés par le fichier 02, résultats d'une tentative de contact
 * (jumeaux des règles serveur : `AppointmentTransitions`, `RecordContactAttemptHandler::NEXT`,
 * `CreateFollowUpHandler`). Ni Vue, ni réseau, ni stockage, aucune arithmétique flottante.
 */
import type {
  Appointment,
  AppointmentsStatus,
  ContactAttemptsResult,
  ContactTasksChannel,
  ContactTasksStatus,
  FollowUpPlansAdvanceUnit,
  FollowUpPlansAnchorKind,
  FollowUpPlansIntervalUnit,
  FollowUpPlansPreferredChannel,
  FollowUpPlansReason,
  FollowUpPlansStatus,
} from '@/domain/contracts/generated'
import { recommendedDate } from '@/domain/scheduling/followUp'
import { CivilDate } from '@/domain/values/civilDate'
import { floorMod, intDiv } from '@/domain/values/integer'

// --- Libellés --------------------------------------------------------------------------------------

export const APPOINTMENT_STATUS_LABELS: Readonly<Record<AppointmentsStatus, string>> = {
  PENDING_CONFIRMATION: 'À confirmer',
  CONFIRMED: 'Confirmé',
  ARRIVED: 'Arrivé',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
  NO_SHOW: 'Absent',
}

export const APPOINTMENT_STATUS_SYMBOLS: Readonly<Record<AppointmentsStatus, string>> = {
  PENDING_CONFIRMATION: '○',
  CONFIRMED: '●',
  ARRIVED: '✓',
  COMPLETED: '✓',
  CANCELLED: '✕',
  NO_SHOW: '⚠',
}

/** 1 = lundi … 7 = dimanche (comme `resource_opening_hours.weekday`). */
export const WEEKDAY_LABELS: Readonly<Record<number, string>> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
}

export const CONTACT_STATUS_LABELS: Readonly<Record<ContactTasksStatus, string>> = {
  PENDING: 'À contacter',
  CONTACTED: 'Contacté',
  BOOKED: 'RDV pris',
  NO_RESPONSE: 'Sans réponse',
  REFUSED: 'Refus',
  POSTPONED: 'Reporté',
  CANCELLED: 'Sans objet (programmation remplacée ou annulée)',
}

export const CONTACT_RESULT_LABELS: Readonly<Record<ContactAttemptsResult, string>> = {
  CONTACTED: 'Contacté',
  BOOKED: 'RDV pris',
  NO_RESPONSE: 'Sans réponse',
  REFUSED: 'Refus',
  POSTPONED: 'Reporté',
  FAILED: 'Échec (numéro injoignable…)',
}

/** Canal souhaité : en L0 aucun message ne part, la personne contacte elle-même le patient. */
export const CHANNEL_LABELS: Readonly<Record<ContactTasksChannel, string>> = {
  INTERNAL: 'Interne (au cabinet)',
  CALL: 'Appel téléphonique',
  SMS: 'SMS, à envoyer soi-même',
  WHATSAPP: 'WhatsApp, à envoyer soi-même',
}

export const FOLLOW_UP_REASON_LABELS: Readonly<Record<FollowUpPlansReason, string>> = {
  ROUTINE: 'Contrôle de routine',
  DROPS: 'Contrôle après collyre',
  OTHER: 'Autre contrôle',
}

export const ANCHOR_KIND_LABELS: Readonly<Record<FollowUpPlansAnchorKind, string>> = {
  CONSULTATION: 'Date de la consultation',
  TREATMENT_START: 'Début du traitement',
  TREATMENT_END: 'Fin du traitement',
  MANUAL: 'Date saisie à la main',
}

export const FOLLOW_UP_STATUS_LABELS: Readonly<Record<FollowUpPlansStatus, string>> = {
  ACTIVE: 'À programmer',
  SCHEDULED: 'Rendez-vous programmé',
  CLOSED: 'Clos',
  CANCELLED: 'Annulé',
}

export const PREFERRED_CHANNELS: readonly FollowUpPlansPreferredChannel[] = [
  'CALL',
  'SMS',
  'WHATSAPP',
  'INTERNAL',
]

// --- Semaine et jours ------------------------------------------------------------------------------

/** Mode d'affichage de l'agenda interne : jour, semaine ou calendrier mensuel. */
export type AgendaView = 'day' | 'week' | 'month'

/** Cellule d'une grille mensuelle (du lundi au dimanche). */
export interface CalendarCell {
  readonly day: CivilDate
  readonly inMonth: boolean
}

/** Lundi = 0 … dimanche = 6 (le 1970-01-01 était un jeudi). */
export function weekdayIndex(day: CivilDate): number {
  return floorMod(day.dayNumber() + 3, 7)
}

/** Jours complets d'une grille mensuelle (du lundi de la 1re semaine au dimanche de la dernière). */
export function monthGridDays(day: CivilDate): CivilDate[] {
  const first = CivilDate.of(day.year, day.month, 1)
  const start = first.addDays(-weekdayIndex(first))
  const last = first.addMonths(1).addDays(-1)
  const end = last.addDays(6 - weekdayIndex(last))
  const total = end.dayNumber() - start.dayNumber() + 1
  return Array.from({ length: total }, (_, offset) => start.addDays(offset))
}

/** Grille mensuelle découpée en semaines complètes de 7 jours (lundi à dimanche). */
export function monthGridWeeks(day: CivilDate): CalendarCell[][] {
  const days = monthGridDays(day)
  const weeks: CalendarCell[][] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(
      days.slice(index, index + 7).map((entry) => ({
        day: entry,
        inMonth: entry.year === day.year && entry.month === day.month,
      })),
    )
  }
  return weeks
}

/** Jours affichés : un jour, la semaine (lundi–dimanche) ou la grille du mois qui le contient. */
export function shownDays(day: CivilDate, view: AgendaView): CivilDate[] {
  if (view === 'day') return [day]
  if (view === 'month') return monthGridDays(day)
  const monday = day.addDays(-weekdayIndex(day))
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => monday.addDays(offset))
}

/** Jour civil (fuseau du cabinet) d'un instant ISO. */
export function dayOf(instant: string, timeZone: string): CivilDate {
  return CivilDate.fromEpochMilliseconds(Date.parse(instant), timeZone)
}

/** Rendez-vous groupés par jour civil du cabinet, chaque jour du plus tôt au plus tard. */
export function groupByDay(
  appointments: readonly Appointment[],
  days: readonly CivilDate[],
  timeZone: string,
): { day: CivilDate; appointments: Appointment[] }[] {
  return days.map((day) => ({
    day,
    appointments: appointments
      .filter((appointment) => dayOf(appointment.starts_at, timeZone).compare(day) === 0)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
  }))
}

// --- Transitions d'un rendez-vous ------------------------------------------------------------------

/** Un rendez-vous se déplace, s'annule ou se constate absent tant qu'il n'a pas eu lieu. */
export function isChangeable(appointment: Pick<Appointment, 'status'>): boolean {
  return appointment.status === 'CONFIRMED' || appointment.status === 'PENDING_CONFIRMATION'
}

/** L'absence ne se constate qu'une fois l'heure du rendez-vous passée. */
export function canMarkNoShow(
  appointment: Pick<Appointment, 'status' | 'starts_at'>,
  now: number,
): boolean {
  return isChangeable(appointment) && Date.parse(appointment.starts_at) <= now
}

/** « Enregistrer l'arrivée » : rendez-vous confirmé, sans arrivée, du jour même. */
export function canRegisterArrival(
  appointment: Pick<Appointment, 'status' | 'starts_at' | 'visit_id' | 'patient_id'>,
  today: CivilDate,
  timeZone: string,
): boolean {
  return (
    isChangeable(appointment) &&
    appointment.visit_id === null &&
    appointment.patient_id !== null &&
    dayOf(appointment.starts_at, timeZone).compare(today) === 0
  )
}

export const CANCEL_REASON_MIN_LENGTH = 3
export const CANCEL_REASON_MAX_LENGTH = 1000

export function validateCancelReason(
  reason: string,
): { ok: true; reason: string } | { ok: false; error: string } {
  const trimmed = reason.trim()
  if (trimmed.length < CANCEL_REASON_MIN_LENGTH) {
    return {
      ok: false,
      error: `Indiquez le motif de l’annulation (au moins ${CANCEL_REASON_MIN_LENGTH} caractères).`,
    }
  }
  if (trimmed.length > CANCEL_REASON_MAX_LENGTH) {
    return { ok: false, error: `Le motif compte au plus ${CANCEL_REASON_MAX_LENGTH} caractères.` }
  }
  return { ok: true, reason: trimmed }
}

// --- Créneaux hebdomadaires (configuration) --------------------------------------------------------

export interface OpeningHourRow {
  id: string
  weekday: number
  opens_at: string
  closes_at: string
}

const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/

/** Heure locale « HH:MM » → minutes depuis minuit, ou null. */
export function minutesOf(time: string): number | null {
  const match = TIME.exec(time)
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function formatMinutes(minutes: number): string {
  return `${String(intDiv(minutes, 60)).padStart(2, '0')}:${String(floorMod(minutes, 60)).padStart(2, '0')}`
}

/** Erreurs des créneaux hebdomadaires, par ligne (mêmes règles que le serveur). */
export function openingHourErrors(rows: readonly OpeningHourRow[]): Record<number, string> {
  const errors: Record<number, string> = {}
  rows.forEach((row, index) => {
    const opens = minutesOf(row.opens_at)
    const closes = minutesOf(row.closes_at)
    if (opens === null || closes === null) {
      errors[index] = 'Heures au format HH:MM.'
      return
    }
    if (closes <= opens) {
      errors[index] = 'L’heure de fermeture doit suivre l’heure d’ouverture.'
      return
    }
    rows.forEach((other, otherIndex) => {
      if (otherIndex >= index || other.weekday !== row.weekday) return
      const otherOpens = minutesOf(other.opens_at)
      const otherCloses = minutesOf(other.closes_at)
      if (
        otherOpens !== null &&
        otherCloses !== null &&
        opens < otherCloses &&
        otherOpens < closes
      ) {
        errors[index] = 'Ce créneau chevauche un autre créneau du même jour.'
      }
    })
  })
  return errors
}

// --- Contrôle recommandé ---------------------------------------------------------------------------

/** Délais proposés par le fichier 02 ; le professionnel choisit (aucun choix médical automatique). */
export const INTERVAL_PRESETS: readonly {
  key: string
  label: string
  value: number
  unit: FollowUpPlansIntervalUnit
}[] = [
  { key: '10d', label: '10 jours', value: 10, unit: 'DAY' },
  { key: '12d', label: '12 jours', value: 12, unit: 'DAY' },
  { key: '14d', label: '14 jours', value: 14, unit: 'DAY' },
  { key: '3m', label: '3 mois', value: 3, unit: 'MONTH' },
  { key: '6m', label: '6 mois', value: 6, unit: 'MONTH' },
  { key: '1y', label: '1 an', value: 1, unit: 'YEAR' },
  { key: '2y', label: '2 ans', value: 2, unit: 'YEAR' },
]

/** Avances de rappel proposées par le fichier 02 (1, 3 ou 7 jours, ou 1 mois avant). */
export const ADVANCE_PRESETS: readonly {
  key: string
  label: string
  value: number | null
  unit: FollowUpPlansAdvanceUnit | null
}[] = [
  { key: 'none', label: 'Le jour même', value: null, unit: null },
  { key: '1d', label: '1 jour avant', value: 1, unit: 'DAY' },
  { key: '3d', label: '3 jours avant', value: 3, unit: 'DAY' },
  { key: '7d', label: '7 jours avant', value: 7, unit: 'DAY' },
  { key: '1m', label: '1 mois avant', value: 1, unit: 'MONTH' },
]

/** Date recommandée calculée (départ + délai au calendrier civil), ou null si le calcul est impossible. */
export function calculatedDate(
  anchor: CivilDate | null,
  value: number | null,
  unit: FollowUpPlansIntervalUnit | null,
): CivilDate | null {
  if (anchor === null || value === null || unit === null || value < 1) return null
  try {
    return recommendedDate(anchor, value, unit)
  } catch {
    return null
  }
}

// --- Tentative de contact --------------------------------------------------------------------------

/** Prochain état admis pour chaque résultat (jumeau de `RecordContactAttemptHandler::NEXT`). */
export const NEXT_STATUSES: Readonly<Record<ContactAttemptsResult, readonly ContactTasksStatus[]>> =
  {
    CONTACTED: ['CONTACTED'],
    BOOKED: ['BOOKED'],
    REFUSED: ['REFUSED'],
    NO_RESPONSE: ['NO_RESPONSE', 'POSTPONED'],
    POSTPONED: ['POSTPONED'],
    FAILED: ['PENDING', 'NO_RESPONSE'],
  }

/** États encore à traiter (une nouvelle tentative est possible). */
export const OPEN_TASK_STATUSES: readonly ContactTasksStatus[] = [
  'PENDING',
  'NO_RESPONSE',
  'POSTPONED',
]

export function isOpenTask(status: ContactTasksStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status)
}

/** La date de nouvelle tentative est exigée pour un report, interdite pour un état clos. */
export function nextAttemptRequired(next: ContactTasksStatus): boolean {
  return next === 'POSTPONED'
}

export function nextAttemptAllowed(next: ContactTasksStatus): boolean {
  return isOpenTask(next)
}

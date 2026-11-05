import type {
  Patient,
  PatientPage,
  PatientRecordsSex,
  PatientSummary,
} from '../contracts/generated'

import { intDiv } from '../values/integer'
import { searchKey } from '../values/text'
import { searchTerm } from './duplicates'
import { SEX_CODES } from './identity'

/**
 * Fiches patient enregistrées sur CE poste (hors ligne ou pas encore consolidées), reconstruites par REJEU des faits
 * du journal local, dans l'ordre : `CreatePatient` pose la fiche, chaque `UpdatePatient` y applique ses champs. Un fait
 * ne change jamais ; rejouer tous les faits donne la même fiche à chaque lecture, quel que soit le nombre de
 * modifications (la projection de tête du poste ne garde que la dernière charge d'une modification).
 *
 * Une fiche CRÉÉE sur ce poste se reconstruit seule. Une fiche du SERVEUR (annuaire du poste, A2 : projection reçue par le
 * pull) sert de base aux modifications faites ici ; sans annuaire, une fiche du serveur modifiée sur le poste n'a pas de
 * base locale (l'écran la lit sur le serveur). Règles pures : ni Vue, ni coffre, ni réseau (typage structurel du fait).
 */
export interface LocalPatientFact {
  commandName: string
  entityId: string
  payload: Readonly<Record<string, unknown>>
  number: string | null
  recordedAt: string
  /** Version affichée quand la commande a été prise ; absente des faits d'avant l'annuaire (le rejeu compte alors +1). */
  expectedVersion?: number | null
}

export interface LocalPatientEntry {
  fact: LocalPatientFact
  /** État de synchronisation de la commande de ce fait (`local`, `pending`, `acknowledged`, `conflict`…). */
  state: string
}

export interface LocalPatient {
  patient: Patient
  /** État de la DERNIÈRE commande qui a touché la fiche. */
  state: string
}

/** Une proposition du poste qui n'est ni consolidée ni rejetée : elle prime sur le serveur (F10, AT42). */
export function isUnconsolidated(state: string): boolean {
  return state !== 'acknowledged' && state !== 'rejected'
}

/** État d'une fiche du serveur que ce poste n'a pas touchée : consolidée par définition, le serveur fait foi quand il répond. */
const SERVER_STATE = 'acknowledged'

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInstant(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value))
}

function sexOf(value: unknown, fallback: PatientRecordsSex): PatientRecordsSex {
  return SEX_CODES.find((code) => code === value) ?? fallback
}

/**
 * Fiche du serveur remise par le pull (même représentation que l'API en ligne), relue avec méfiance : une projection vide
 * (entité disparue), d'une autre forme ou sans identité exploitable n'est pas une fiche (null), jamais une fiche à moitié.
 */
export function patientOfPulled(data: unknown): Patient | null {
  if (!isRecord(data)) return null
  const id = text(data['id'])
  const recordNumber = text(data['record_number'])
  const lastName = text(data['last_name'])
  const sex = SEX_CODES.find((code) => code === data['sex'])
  const version = data['version']
  const merged = data['merged_into_patient_id']
  if (id === null || id === '' || recordNumber === null || recordNumber === '') return null
  if (lastName === null || lastName.trim() === '' || sex === undefined) return null
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return null
  if (typeof data['archived'] !== 'boolean') return null
  if (merged !== null && typeof merged !== 'string') return null
  // Horodatages exigés par le contrat : l'écran les met en forme, une date illisible ferait échouer son rendu.
  const createdAt = text(data['created_at'])
  const updatedAt = text(data['updated_at'])
  if (!isInstant(createdAt) || !isInstant(updatedAt)) return null
  const guardian = data['guardian_contact']
  return {
    id,
    record_number: recordNumber,
    last_name: lastName,
    first_names: text(data['first_names']),
    sex,
    birth_date: text(data['birth_date']),
    phone_primary: text(data['phone_primary']),
    archived: data['archived'],
    merged_into_patient_id: merged,
    version,
    birth_date_missing_reason: text(data['birth_date_missing_reason']),
    phone_secondary: text(data['phone_secondary']),
    phone_missing_reason: text(data['phone_missing_reason']),
    address: text(data['address']),
    profession: text(data['profession']),
    guardian_contact: isRecord(guardian) ? guardian : null,
    legacy_record: data['legacy_record'] === true,
    first_known_visit_on: text(data['first_known_visit_on']),
    first_visit_certified: data['first_visit_certified'] === true,
    legacy_record_number: text(data['legacy_record_number']),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

function created(fact: LocalPatientFact): Patient {
  const payload = fact.payload
  return {
    id: fact.entityId,
    record_number: text(payload['record_number']) ?? fact.number ?? '',
    last_name: text(payload['last_name']) ?? '',
    first_names: text(payload['first_names']),
    sex: sexOf(payload['sex'], 'UNKNOWN'),
    birth_date: text(payload['birth_date']),
    phone_primary: text(payload['phone_primary']),
    archived: false,
    merged_into_patient_id: null,
    version: 1,
    birth_date_missing_reason: text(payload['birth_date_missing_reason']),
    phone_secondary: text(payload['phone_secondary']),
    phone_missing_reason: text(payload['phone_missing_reason']),
    address: text(payload['address']),
    profession: text(payload['profession']),
    guardian_contact: null,
    legacy_record: payload['legacy_record'] === true,
    first_known_visit_on: text(payload['first_known_visit_on']),
    first_visit_certified: payload['first_visit_certified'] === true,
    legacy_record_number: text(payload['legacy_record_number']),
    created_at: fact.recordedAt,
    updated_at: fact.recordedAt,
  }
}

/** Applique les champs d'identité d'un `UpdatePatient` (un champ vidé vaut null ; le nom ne devient jamais vide). */
function updated(base: Patient, fact: LocalPatientFact): Patient {
  const changes = fact.payload['changes']
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return base
  const fields = changes as Record<string, unknown>
  // Version attendue par la commande + 1, comme le compteur d'entité du journal (même quand le pull a avancé la fiche du serveur).
  const version =
    (typeof fact.expectedVersion === 'number' ? fact.expectedVersion : base.version) + 1
  const next: Patient = { ...base, version, updated_at: fact.recordedAt }
  const lastName = text(fields['last_name'])
  if (lastName !== null && lastName.trim() !== '') next.last_name = lastName
  if ('first_names' in fields) next.first_names = text(fields['first_names'])
  if ('sex' in fields) next.sex = sexOf(fields['sex'], base.sex)
  if ('birth_date' in fields) next.birth_date = text(fields['birth_date'])
  if ('birth_date_missing_reason' in fields) {
    next.birth_date_missing_reason = text(fields['birth_date_missing_reason'])
  }
  if ('phone_primary' in fields) next.phone_primary = text(fields['phone_primary'])
  if ('phone_secondary' in fields) next.phone_secondary = text(fields['phone_secondary'])
  if ('phone_missing_reason' in fields) {
    next.phone_missing_reason = text(fields['phone_missing_reason'])
  }
  if ('address' in fields) next.address = text(fields['address'])
  if ('profession' in fields) next.profession = text(fields['profession'])
  return next
}

/**
 * Une modification acquittée est REPRISE par le pull quand la fiche du serveur a atteint la version qu'elle a produite
 * (version attendue + 1) : la rejouer de nouveau défairait un changement plus récent du serveur sur les mêmes champs.
 */
function takenUpByPull(fact: LocalPatientFact, state: string, server: Patient): boolean {
  return (
    state === 'acknowledged' &&
    typeof fact.expectedVersion === 'number' &&
    server.version >= fact.expectedVersion + 1
  )
}

/**
 * Fiches reconstruites, par identifiant ; les faits sont donnés dans l'ordre du journal. `server` : fiches du serveur reçues
 * par le pull (annuaire du poste), sans lesquelles une fiche du serveur n'a pas de base locale.
 *
 *  - une fiche du serveur que ce poste n'a pas touchée est rendue telle quelle, consolidée par définition ;
 *  - une modification faite ici s'applique par-dessus la fiche du serveur (refusée, elle ne change rien ; déjà reprise par
 *    le pull, elle n'est pas rejouée) ;
 *  - une fiche créée ici puis reçue du serveur : la proposition du poste pas encore consolidée prime (AT42) ; consolidée,
 *    la plus récente des deux fait foi.
 */
export function foldLocalPatients(
  entries: readonly LocalPatientEntry[],
  server: ReadonlyMap<string, Patient> = new Map(),
): Map<string, LocalPatient> {
  const patients = new Map<string, LocalPatient>()
  const fromServer = new Set<string>()
  for (const { fact, state } of entries) {
    const id = fact.entityId
    if (fact.commandName === 'CreatePatient') {
      patients.set(id, { patient: created(fact), state })
      fromServer.delete(id)
      continue
    }
    if (fact.commandName !== 'UpdatePatient') continue
    const own = patients.get(id)
    const base = server.get(id)
    if (base !== undefined && (own === undefined || fromServer.has(id))) {
      if (state === 'rejected') continue
      const current = own?.patient ?? base
      patients.set(id, {
        patient: takenUpByPull(fact, state, base) ? current : updated(current, fact),
        state,
      })
      fromServer.add(id)
    } else if (own !== undefined) {
      patients.set(id, { patient: updated(own.patient, fact), state })
    }
  }
  for (const [id, patient] of server) {
    const own = patients.get(id)
    if (own === undefined) {
      patients.set(id, { patient, state: SERVER_STATE })
    } else if (!isUnconsolidated(own.state) && patient.version >= own.patient.version) {
      patients.set(id, { patient, state: own.state })
    }
  }
  return patients
}

export function patientSummary(patient: Patient): PatientSummary {
  return {
    id: patient.id,
    record_number: patient.record_number,
    last_name: patient.last_name,
    first_names: patient.first_names,
    sex: patient.sex,
    birth_date: patient.birth_date,
    phone_primary: patient.phone_primary,
    archived: patient.archived,
    merged_into_patient_id: patient.merged_into_patient_id,
    version: patient.version,
  }
}

/** Clé de recherche du serveur (minuscules, sans accents ni ponctuation) : « Éloïse » et « eloise » se retrouvent. */
function plain(value: string): string {
  try {
    return searchKey(value)
  } catch {
    return ''
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Recherche LOCALE, jumelle approchée de celle du serveur : chaque mot de la saisie figure dans le nom ou les prénoms
 * (casse, accents et ordre des mots ignorés), ou les chiffres saisis figurent dans un téléphone, ou la saisie figure
 * dans le numéro de dossier. Elle ne porte que sur les fiches de ce poste : un résultat vide n'affirme jamais l'absence.
 */
export function matchesLocalSearch(patient: Patient, query: string): boolean {
  // Comme le serveur : une fiche fusionnée dans une autre n'est jamais proposée.
  if (patient.merged_into_patient_id !== null) return false
  const term = searchTerm(query)
  if (!term.ok) return false
  const wanted = plain(term.text)
  const name = plain(`${patient.last_name} ${patient.first_names ?? ''}`)
  if (wanted !== '' && wanted.split(' ').every((word) => name.includes(word))) return true
  const digits = digitsOf(term.text)
  if (
    digits.length >= 2 &&
    [patient.phone_primary, patient.phone_secondary].some(
      (phone) => phone !== null && digitsOf(phone).includes(digits),
    )
  ) {
    return true
  }
  return wanted !== '' && plain(patient.record_number).includes(wanted)
}

const PAGE_SIZE = 25

/** Page de résultats locaux (25 par page), triés par nom puis prénoms ; `total` ne compte que les fiches de ce poste. */
export function localPatientPage(patients: readonly Patient[], page: number): PatientPage {
  const sorted = [...patients].sort(
    (left, right) =>
      left.last_name.localeCompare(right.last_name, 'fr') ||
      (left.first_names ?? '').localeCompare(right.first_names ?? '', 'fr'),
  )
  const start = (page - 1) * PAGE_SIZE
  return {
    data: sorted.slice(start, start + PAGE_SIZE).map(patientSummary),
    meta: {
      current_page: page,
      last_page: Math.max(1, intDiv(sorted.length + PAGE_SIZE - 1, PAGE_SIZE)),
      per_page: PAGE_SIZE,
      total: sorted.length,
    },
  }
}

import type { Patient } from '@/domain/contracts/generated'
import {
  foldLocalPatients,
  type LocalPatient,
  type LocalPatientEntry,
  patientOfPulled,
} from '@/domain/patients/local'

import {
  localAdministrativeFacts,
  localPulledRecords,
  localPullStamp,
  type PulledRecord,
  whenVaultLocks,
} from './vault'

/** Ce que l'appelant demande en plus des faits du journal : l'annuaire complet du serveur, ou quelques fiches. */
export interface LocalPatientScope {
  /** Toutes les fiches du serveur reçues par le pull (recherche sans réseau). Coûteux : serveur injoignable seulement. */
  directory?: boolean
  /** Ces fiches du serveur seulement (lecture d'une fiche, identité d'une facture) : le reste n'est pas déchiffré. */
  ids?: readonly string[]
}

const PATIENTS = 'patient_records'

/**
 * Annuaire du poste gardé EN MÉMOIRE le temps de la session ouverte et du dernier pull : il est relu dès que le repère
 * change (déverrouillage, nouvelle page de pull) et oublié à chaque verrouillage du coffre (D12). La mémoire physique n'est
 * pas effacée : la promesse est celle du coffre, plus aucune référence applicative.
 */
let directory: { stamp: string; patients: Map<string, Patient> } | null = null

whenVaultLocks(() => {
  directory = null
})

export function resetLocalPatientsForTests(): void {
  directory = null
}

function serverPatients(records: readonly PulledRecord[]): Map<string, Patient> {
  const patients = new Map<string, Patient>()
  for (const record of records) {
    const patient = patientOfPulled(record.data)
    // Une projection dont l'identité ne correspond pas à sa clé est écartée, jamais corrigée.
    if (patient !== null && patient.id === record.entityId) patients.set(patient.id, patient)
  }
  return patients
}

async function serverDirectory(scope: LocalPatientScope): Promise<Map<string, Patient>> {
  if (scope.directory === true) {
    const stamp = await localPullStamp()
    if (stamp === null) {
      directory = null
      return new Map()
    }
    if (directory?.stamp === stamp) return directory.patients
    const patients = serverPatients(await localPulledRecords(PATIENTS))
    directory = { stamp, patients }
    return patients
  }
  if (scope.ids === undefined || scope.ids.length === 0) return new Map()
  return serverPatients(await localPulledRecords(PATIENTS, scope.ids))
}

/**
 * Fiches patient de CE poste : créées ou modifiées ici (consolidées ou non), reconstruites par rejeu des faits du journal
 * local (`domain/patients/local`), et fiches du SERVEUR déjà reçues par le pull (annuaire du poste) quand l'appelant les
 * demande (`scope`). Sans `scope`, seuls les faits du journal sont lus. Vide tant que le coffre est fermé, que le module
 * hors-ligne l'est, ou que le profil n'a pas le compartiment administratif : rien n'est alors lu ni supposé. Lecture seule,
 * jamais d'écriture ici.
 */
export async function localPatients(
  scope: LocalPatientScope = {},
): Promise<Map<string, LocalPatient>> {
  const [records, server] = await Promise.all([localAdministrativeFacts(), serverDirectory(scope)])
  const entries: LocalPatientEntry[] = records
    .filter((record) => record.fact.entityType === 'patient_records')
    .map((record) => ({ fact: record.fact, state: record.state }))
  return foldLocalPatients(entries, server)
}

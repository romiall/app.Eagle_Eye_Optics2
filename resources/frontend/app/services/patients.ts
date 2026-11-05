import { apiRequest, NetworkUnavailable } from '@/app/api'
import type {
  Patient,
  PatientActivity,
  PatientActivityMeta,
  PatientMergePreview,
  PatientMergePreviewResponse,
  PatientPage,
  PatientResponse,
} from '@/domain/contracts/generated'
import { searchTerm } from '@/domain/patients/duplicates'
import { isUnconsolidated, localPatientPage, matchesLocalSearch } from '@/domain/patients/local'

import { localPatients } from './localPatients'
import type { ReadOutcome } from './reads'

/**
 * Lectures du serveur pour les écrans patient (P01, P02). Chaque lecture rend la donnée avec sa
 * fraîcheur (`serverAsOf` : l'heure de la réponse du serveur à CET appel, `complete`) et `live`
 * vrai : seul un vide `live` peut devenir « aucun résultat » (`useRead`). Une erreur du serveur est
 * propagée telle quelle : un 404 est une erreur d'application (fiche inconnue), jamais une liste
 * vide ; un réseau coupé reste `NetworkUnavailable`.
 *
 * Fiches de CE poste (créées ou modifiées hors ligne, `localPatients`) : une fiche pas encore consolidée prime sur
 * le serveur (F10, AT42) ; serveur injoignable, la copie du poste répond, avec une fraîcheur qui dit « données de ce
 * poste seulement » (`serverAsOf` null, `live` faux : jamais une absence affirmée). L'annuaire du poste (fiches du serveur
 * reçues par le pull) répond de même, et n'est jamais ouvert tant que le serveur répond. La recherche ne retombe sur le
 * poste que si l'écran le demande (`includeLocal`) : la détection de doublons, elle, exige le serveur.
 */
function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

/** Donnée lue sur CE poste seulement : fraîcheur « ce poste », jamais un vide affirmé (`live` faux). */
function fromThisDevice<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: null, complete: false }, live: false }
}

/**
 * Recherche paginée : nom ou prénom (casse, accents et ordre des mots ignorés), téléphone (chiffres)
 * ou numéro de dossier. Moins de 2 caractères n'est jamais envoyé : l'écran le refuse avant.
 */
export async function searchPatients(
  query: string,
  page = 1,
  options: { includeLocal?: boolean } = {},
): Promise<ReadOutcome<PatientPage>> {
  const term = searchTerm(query)
  if (!term.ok) throw new RangeError('La recherche demande 2 caractères au moins.')
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page de résultats invalide.')
  const parameters = new URLSearchParams({ query: term.text, page: String(page) })
  let response: PatientPage | null = null
  try {
    response = await apiRequest<PatientPage>('GET', `/api/v1/patients?${parameters}`)
  } catch (error) {
    // Serveur injoignable : seules les fiches de CE poste peuvent répondre, et seulement si l'écran l'a demandé.
    if (!(options.includeLocal === true && error instanceof NetworkUnavailable)) throw error
  }
  if (options.includeLocal !== true) return answered(response as PatientPage)

  // Serveur injoignable : l'annuaire du poste (fiches reçues par le pull) répond avec les fiches de ce poste ; serveur joint,
  // seules les fiches du poste pas encore consolidées comptent, l'annuaire n'est pas ouvert.
  const local = [...(await localPatients(response === null ? { directory: true } : {})).values()]
  if (response === null) {
    const matches = local.filter((entry) => matchesLocalSearch(entry.patient, query))
    return fromThisDevice(
      localPatientPage(
        matches.map((entry) => entry.patient),
        page,
      ),
    )
  }
  // Serveur joint : les fiches du poste pas encore consolidées s'ajoutent en tête de la première page (AT42).
  const known = new Set(response.data.map((summary) => summary.id))
  const extra = local.filter(
    (entry) =>
      isUnconsolidated(entry.state) &&
      !known.has(entry.patient.id) &&
      matchesLocalSearch(entry.patient, query),
  )
  if (page !== 1 || extra.length === 0) return answered(response)
  const merged = localPatientPage(
    extra.map((entry) => entry.patient),
    1,
  )
  return answered({
    data: [...merged.data, ...response.data],
    meta: { ...response.meta, total: response.meta.total + merged.data.length },
  })
}

/** Fiche d'un patient. Identité seulement : aucune donnée clinique. */
export async function getPatient(id: string): Promise<ReadOutcome<Patient>> {
  const local = (await localPatients({ ids: [id] })).get(id) ?? null
  // Proposition du poste pas encore consolidée : elle prime sur le serveur, qui ne la connaît pas encore (F10).
  if (local !== null && isUnconsolidated(local.state)) return fromThisDevice(local.patient)
  try {
    const response = await apiRequest<PatientResponse>(
      'GET',
      `/api/v1/patients/${encodeURIComponent(id)}`,
    )
    return answered(response.data)
  } catch (error) {
    // Serveur injoignable : la copie du poste, consolidée ou non, vaut mieux qu'une fiche introuvable.
    if (local !== null && error instanceof NetworkUnavailable) return fromThisDevice(local.patient)
    throw error
  }
}

/** Section de l'activité d'un patient (filtre facultatif). */
export type ActivitySectionCode = NonNullable<PatientActivityMeta['section']>

/**
 * Une page (25 éléments) de l'activité d'un patient, du plus récent au plus ancien : visites, et selon
 * les droits du compte, examens, ordonnances et pièces financières (le serveur n'envoie que les sections
 * autorisées, sans aucune mention des autres). `section` null : toutes les sections visibles.
 */
export async function listPatientActivity(
  id: string,
  section: ActivitySectionCode | null = null,
  page = 1,
): Promise<ReadOutcome<PatientActivity>> {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Page d’activité invalide.')
  const parameters = new URLSearchParams({ page: String(page) })
  if (section !== null) parameters.set('section', section)
  const response = await apiRequest<PatientActivity>(
    'GET',
    `/api/v1/patients/${encodeURIComponent(id)}/activity?${parameters}`,
  )
  return answered(response)
}

/**
 * Aperçu de la fusion de la fiche `sourceId` dans la fiche `survivorId` (L1D08, gérante) : identités côte à
 * côte, éléments rattachés à la fiche absorbée (selon les droits du compte) et garde-fous. Lecture seule.
 */
export async function previewPatientMerge(
  sourceId: string,
  survivorId: string,
): Promise<ReadOutcome<PatientMergePreview>> {
  const parameters = new URLSearchParams({ into: survivorId })
  const response = await apiRequest<PatientMergePreviewResponse>(
    'GET',
    `/api/v1/patients/${encodeURIComponent(sourceId)}/merge-preview?${parameters}`,
  )
  return answered(response.data)
}

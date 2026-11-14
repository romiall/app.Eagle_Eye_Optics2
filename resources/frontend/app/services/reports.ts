import { apiRequest } from '@/app/api'
import type {
  ActivityReport,
  ActivityReportResponse,
  ClinicalReport,
  ClinicalReportResponse,
  ManagementReport,
  ManagementReportResponse,
} from '@/domain/contracts/generated'

import type { ReadOutcome } from './reads'

/**
 * Statistiques du dossier patient (R02), EN LIGNE : deux lectures séparées par leurs droits (activité
 * administrative `statistics.activity`, statistiques cliniques `statistics.clinical`). Période de jours
 * civils du cabinet, bornes incluses (AAAA-MM-JJ) ; rien n'est calculé ni conservé sur le poste.
 */
function query(from: string, to: string): string {
  for (const day of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new RangeError('Date invalide (AAAA-MM-JJ attendu).')
  }
  return new URLSearchParams({ from, to }).toString()
}

function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export async function getActivityReport(
  from: string,
  to: string,
): Promise<ReadOutcome<ActivityReport>> {
  const response = await apiRequest<ActivityReportResponse>(
    'GET',
    `/api/v1/reports/activity?${query(from, to)}`,
  )
  return answered(response.data)
}

export async function getClinicalReport(
  from: string,
  to: string,
): Promise<ReadOutcome<ClinicalReport>> {
  const response = await apiRequest<ClinicalReportResponse>(
    'GET',
    `/api/v1/reports/clinical?${query(from, to)}`,
  )
  return answered(response.data)
}

export async function getManagementReport(
  from: string,
  to: string,
): Promise<ReadOutcome<ManagementReport>> {
  const response = await apiRequest<ManagementReportResponse>(
    'GET',
    `/api/v1/reports/management?${query(from, to)}`,
  )
  return answered(response.data)
}

export function managementDownloadUrl(from: string, to: string, format: 'csv' | 'json'): string {
  return `/api/v1/reports/management/download?${query(from, to)}&format=${format}`
}

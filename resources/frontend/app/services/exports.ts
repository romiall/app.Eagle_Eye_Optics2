import { apiRequest } from '@/app/api'
import type {
  ExportManifest,
  ExportManifestResponse,
  ExportRequest,
  ExportRequestList,
  ExportRequestsExportType,
} from '@/domain/contracts/generated'

import type { ReadOutcome } from './reads'

/**
 * Exports contrôlés (X02), EN LIGNE : la demande inscrit l'export, l'archive est produite par la tâche
 * planifiée du serveur (quelques minutes), puis se télécharge pendant 48 h. Rien n'est produit ni conservé
 * dans le navigateur ; le téléchargement passe par la session (lien privé, jamais une URL publique).
 */
export type ExportType = ExportRequestsExportType

export const EXPORT_TYPE_LABELS: Readonly<Record<ExportType, string>> = {
  PATIENT_RECORD: 'Dossier d’un patient',
  PATIENTS: 'Patients et visites',
  FINANCE: 'Ventes, encaissements et caisse',
  STOCK: 'Catalogue et stock',
  FULL_HANDOVER: 'Remise complète des données',
}

export const EXPORT_STATUS_LABELS: Readonly<Record<ExportRequest['status'], string>> = {
  REQUESTED: 'Demandé : en attente de production',
  PROCESSING: 'En cours de production',
  READY: 'Prêt à télécharger',
  FAILED: 'Échec de la production',
  EXPIRED: 'Expiré',
}

export type ExportScopeRole = 'MANAGER' | 'CLINICIAN' | 'CASHIER' | 'RECEPTION'

export const EXPORT_SCOPE_ROLE_LABELS: Readonly<Record<ExportScopeRole, string>> = {
  MANAGER: 'Gérante (portée maximale autorisée)',
  CLINICIAN: 'Clinicien (clinique, patients et quantités stock)',
  CASHIER: 'Caisse (données opérationnelles sans finance globale ni clinique)',
  RECEPTION: 'Accueil (patients et visites uniquement)',
}

function answered<T>(data: T): ReadOutcome<T> {
  return { data, freshness: { serverAsOf: new Date().toISOString(), complete: true }, live: true }
}

export async function listExports(): Promise<ReadOutcome<ExportRequest[]>> {
  const response = await apiRequest<ExportRequestList>('GET', '/api/v1/exports')
  return answered(response.data)
}

export async function getExportManifest(id: string): Promise<ReadOutcome<ExportManifest>> {
  const response = await apiRequest<ExportManifestResponse>(
    'GET',
    `/api/v1/exports/${encodeURIComponent(id)}/manifest`,
  )
  return answered(response.data)
}

/** Adresse privée de l'archive (cookie de session ; le serveur contrôle le compte et le délai). */
export function exportDownloadUrl(id: string): string {
  return `/api/v1/exports/${encodeURIComponent(id)}/download`
}

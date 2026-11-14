import type {
  ExportManifest,
  ManagementReport,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

/**
 * Règles d'affichage des tableaux de gestion multi-domaines (L1D09) :
 * calculs et mises en forme 100 % entiers (points de base bps et FCFA entiers, aucun flottant).
 */

export type ExcludedSectionCode = ManagementReport['excluded_sections'][number]['section']
export type ExclusionReason = ManagementReport['excluded_sections'][number]['reason']
export type UnknownDomain = ManagementReport['unknowns'][number]['domain']

export const SECTION_LABELS: Readonly<Record<ExcludedSectionCode, string>> = {
  FINANCE: 'Finance du cabinet',
  STOCK: 'État du stock',
  STOCK_VALUATION: 'Valorisation du stock',
  WORKSHOP: 'Atelier optique',
  PATIENTS: 'Activité et patients',
  CLINICAL: 'Consultations et clinique',
}

export const EXCLUSION_REASON_LABELS: Readonly<Record<ExclusionReason, string>> = {
  PERMISSION_MISSING: 'Droit manquant pour ce profil',
  MODULE_DISABLED: 'Module non activé dans cette installation',
}

export const UNKNOWN_DOMAIN_LABELS: Readonly<Record<UnknownDomain, string>> = {
  FINANCE: 'Finance',
  STOCK: 'Stock',
  WORKSHOP: 'Atelier',
  PATIENTS: 'Patients',
  CLINICAL: 'Clinique',
  SYNC: 'Postes hors ligne',
}

export const WORKSHOP_STATUS_LABELS: Readonly<Record<WorkshopOrdersStatus, string>> = {
  ORDERED: 'Commandé au laboratoire',
  RECEIVED: 'Verres reçus',
  MOUNTING: 'En montage',
  QUALITY_CHECK: 'Contrôle qualité',
  READY: 'Prêt pour remise',
  DELIVERED: 'Remis au patient',
  CANCELLED: 'Annulé',
}

export const FILTER_MODE_LABELS: Readonly<
  Record<ExportManifest['tables'][number]['filter_mode'], string>
> = {
  PERIOD_FILTERED: 'Filtré sur la période',
  PATIENT_SCOPED: 'Filtré sur le patient',
  SNAPSHOT_MASTER: 'Référentiel à la lecture',
}

/**
 * Formate un écart ou taux exprimé en points de base entiers (100 bps = 1,00 %) sans aucun flottant.
 * Ex. : 6000 → « +60,00 % » (ou « 60,00 % » si signed = false).
 */
export function formatBpsPercent(bps: number | null, signed = true): string {
  if (bps === null) return 'N/D'
  const sign = signed ? (bps > 0 ? '+' : bps < 0 ? '-' : '') : bps < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(bps))).padStart(3, '0')
  const whole = digits.slice(0, -2)
  const decimals = digits.slice(-2)
  return `${sign}${whole},${decimals}\u{A0}%`
}

export function formatMoneyDelta(delta: number, deltaPctBps: number | null): string {
  const signed = delta > 0 ? `+${formatMoney(delta)}` : formatMoney(delta)
  return deltaPctBps === null ? signed : `${signed} (${formatBpsPercent(deltaPctBps)})`
}

export function formatCountDelta(delta: number, deltaPctBps: number | null): string {
  const signed = delta > 0 ? `+${delta}` : String(delta)
  return deltaPctBps === null ? signed : `${signed} (${formatBpsPercent(deltaPctBps)})`
}

export function sectionLabel(code: ExcludedSectionCode): string {
  return SECTION_LABELS[code]
}

export function exclusionReasonLabel(reason: ExclusionReason): string {
  return EXCLUSION_REASON_LABELS[reason]
}

export function unknownDomainLabel(domain: UnknownDomain): string {
  return UNKNOWN_DOMAIN_LABELS[domain]
}

export function workshopStatusLabel(status: WorkshopOrdersStatus): string {
  return WORKSHOP_STATUS_LABELS[status]
}

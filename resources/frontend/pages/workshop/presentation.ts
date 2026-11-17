import type { ChipTone } from '@/components/layout/StatusChip.vue'
import { formatAxis, formatDiopter, formatMillimeters, MISSING } from '@/documents/engine/format'
import type {
  WorkshopEligiblePrescription,
  WorkshopOrderEye,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'

/**
 * Mise en forme partagée des écrans d'atelier optique (L1D04) : teintes des puces d'état et
 * présentation uniforme des mesures optiques OD/OG (sans flottant).
 */
export const WORKSHOP_STATUS_TONES: Readonly<Record<WorkshopOrdersStatus, ChipTone>> = {
  ORDERED: 'info',
  RECEIVED: 'info',
  MOUNTING: 'gold',
  QUALITY_CHECK: 'gold',
  READY: 'success',
  DELIVERED: 'neutral',
  CANCELLED: 'danger',
}

export interface OpticalSpecDisplayRow {
  eye: 'OD' | 'OG'
  sphere: string
  cylinder: string
  axis: string
  addition: string
  pd: string
  fittingHeight: string
  extra: string
}

export function prescriptionEyeDisplayRows(
  prescription: WorkshopEligiblePrescription,
): OpticalSpecDisplayRow[] {
  const ordered = [...prescription.eyes].sort((a, b) =>
    a.eye === b.eye ? 0 : a.eye === 'OD' ? -1 : 1,
  )
  return ordered.map((eye) => ({
    eye: eye.eye,
    sphere: eye.no_correction
      ? 'Aucune correction'
      : eye.sphere === null
        ? MISSING
        : formatDiopter(eye.sphere, `${eye.eye}.sphere`),
    cylinder: eye.no_correction
      ? MISSING
      : eye.cylinder === null
        ? MISSING
        : formatDiopter(eye.cylinder, `${eye.eye}.cylinder`),
    axis:
      eye.no_correction || eye.axis === null ? MISSING : formatAxis(eye.axis, `${eye.eye}.axis`),
    addition:
      eye.no_correction || eye.addition === null
        ? MISSING
        : formatDiopter(eye.addition, `${eye.eye}.addition`),
    pd:
      eye.eye === 'OD'
        ? prescription.pd_od === null
          ? MISSING
          : formatMillimeters(prescription.pd_od, 'pd_od')
        : prescription.pd_og === null
          ? MISSING
          : formatMillimeters(prescription.pd_og, 'pd_og'),
    fittingHeight:
      eye.fitting_height === null
        ? MISSING
        : formatMillimeters(eye.fitting_height, `${eye.eye}.fitting_height`),
    extra: '',
  }))
}

export function workshopEyeDisplayRows(eyes: readonly WorkshopOrderEye[]): OpticalSpecDisplayRow[] {
  const ordered = [...eyes].sort((a, b) => (a.eye === b.eye ? 0 : a.eye === 'OD' ? -1 : 1))
  return ordered.map((eye) => {
    const details = [eye.lens_type]
    if (eye.lens_index !== null && eye.lens_index.trim() !== '') {
      details.push(`indice ${eye.lens_index}`)
    }
    if (eye.treatments_snapshot.length > 0) {
      details.push(eye.treatments_snapshot.join(', '))
    }
    return {
      eye: eye.eye,
      sphere: eye.sphere === null ? MISSING : formatDiopter(eye.sphere, `${eye.eye}.sphere`),
      cylinder:
        eye.cylinder === null ? MISSING : formatDiopter(eye.cylinder, `${eye.eye}.cylinder`),
      axis: eye.axis === null ? MISSING : formatAxis(eye.axis, `${eye.eye}.axis`),
      addition:
        eye.addition === null ? MISSING : formatDiopter(eye.addition, `${eye.eye}.addition`),
      pd: eye.pd === null ? MISSING : formatMillimeters(eye.pd, `${eye.eye}.pd`),
      fittingHeight:
        eye.fitting_height === null
          ? MISSING
          : formatMillimeters(eye.fitting_height, `${eye.eye}.fitting_height`),
      extra: details.join(' · '),
    }
  })
}

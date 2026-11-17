import type {
  AdvanceWorkshopOrderRequest,
  CreateWorkshopOrderRequest,
  WorkshopEligiblePrescription,
  WorkshopEventsEventType,
  WorkshopEventsQualityResult,
  WorkshopOrder,
  WorkshopOrdersStatus,
} from '@/domain/contracts/generated'
import { RuleViolation } from '@/domain/errors'
import { Diopter, Quantity } from '@/domain/values/decimal'
import { trimBlanks } from '@/domain/values/text'

/**
 * Règles pures de présentation et de validation client de l'atelier optique (L1D04) : libellés d'états,
 * transitions autorisées (conformes à `WorkshopOrderRules.php`), validation sans flottant des mesures
 * optiques (DP, hauteur) et construction des requêtes.
 */
export const WORKSHOP_STATUS_LABELS: Readonly<Record<WorkshopOrdersStatus, string>> = {
  ORDERED: 'Commandée au laboratoire',
  RECEIVED: 'Reçue du laboratoire',
  MOUNTING: 'En montage',
  QUALITY_CHECK: 'Contrôle qualité',
  READY: 'Prête à remettre',
  DELIVERED: 'Remise au patient',
  CANCELLED: 'Annulée',
}

export const WORKSHOP_EVENT_LABELS: Readonly<Record<WorkshopEventsEventType, string>> = {
  STATUS_CHANGE: 'Changement d’étape',
  QUALITY_CHECK: 'Contrôle qualité',
  REWORK: 'Reprise atelier / labo',
  ADJUSTMENT: 'Ajustement / note',
  CANCEL: 'Annulation',
}

export const WORKSHOP_QUALITY_LABELS: Readonly<Record<WorkshopEventsQualityResult, string>> = {
  PASSED: 'Conforme',
  FAILED: 'Non conforme',
  NOT_APPLICABLE: 'Sans objet',
}

export const CLINICAL_TERM_FALLBACK_LABELS: Readonly<Record<string, string>> = {
  SINGLE_VISION: 'Unifocal',
  BIFOCAL: 'Bifocal',
  PROGRESSIVE: 'Progressif',
  ANTI_FATIGUE: 'Anti-fatigue',
  DISTANCE: 'Vision de loin',
  NEAR: 'Vision de près',
  PERMANENT: 'Lunettes permanentes',
  COMPUTER_WORK: 'Travail / ordinateur',
  PROGRESSIVE_USAGE: 'Progressifs',
  ANTI_REFLECTION: 'Anti-reflet',
  BLUE_LIGHT_FILTER: 'Filtre lumière bleue / Blue-Cut',
  HARD_ANTI_SCRATCH: 'Durci / anti-rayures',
  HMC: 'HMC',
  PHOTOCHROMIC: 'Photochromique',
  TINTED: 'Teinté',
  UV: 'UV',
  OTHER: 'Autre',
}

export function prescriptionLensTypeDefault(prescription: WorkshopEligiblePrescription): string {
  const code = prescription.lens_type_code
  if (code === null || code.trim() === '') return ''
  if (
    code === 'OTHER' &&
    prescription.lens_type_other !== null &&
    trimBlanks(prescription.lens_type_other) !== ''
  ) {
    return trimBlanks(prescription.lens_type_other).slice(0, 100)
  }
  return CLINICAL_TERM_FALLBACK_LABELS[code] ?? code
}

export function prescriptionLabel(prescription: WorkshopEligiblePrescription): string {
  const originLabel = prescription.origin === 'EXTERNAL' ? 'externe' : 'interne'
  const lens = prescriptionLensTypeDefault(prescription)
  const indexPart = prescription.lens_index !== null ? ` · indice ${prescription.lens_index}` : ''
  return `v${prescription.version_no} (${originLabel})${lens !== '' ? ` · ${lens}` : ''}${indexPart}`
}

export interface NextForwardAction {
  eventType: 'STATUS_CHANGE'
  target: WorkshopOrdersStatus
  label: string
}

export function nextForwardAction(status: WorkshopOrdersStatus): NextForwardAction | null {
  switch (status) {
    case 'ORDERED':
      return {
        eventType: 'STATUS_CHANGE',
        target: 'RECEIVED',
        label: 'Enregistrer la réception labo',
      }
    case 'RECEIVED':
      return { eventType: 'STATUS_CHANGE', target: 'MOUNTING', label: 'Passer en montage' }
    case 'MOUNTING':
      return {
        eventType: 'STATUS_CHANGE',
        target: 'QUALITY_CHECK',
        label: 'Envoyer au contrôle qualité',
      }
    default:
      return null
  }
}

export function isTerminalWorkshopStatus(status: WorkshopOrdersStatus): boolean {
  return status === 'DELIVERED' || status === 'CANCELLED'
}

export function canDeliverWorkshopOrder(order: WorkshopOrder): boolean {
  return order.status === 'READY' && order.eligible_delivery_lines.length > 0
}

export function canReworkWorkshopOrder(status: WorkshopOrdersStatus): boolean {
  return ['RECEIVED', 'MOUNTING', 'QUALITY_CHECK', 'READY'].includes(status)
}

/** Convertit une date civile « AAAA-MM-JJ » en instant ISO (17h00 heure du cabinet par défaut). */
export function civilDateToExpectedInstant(civilDate: string | null): string | null {
  if (civilDate === null || trimBlanks(civilDate) === '') return null
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(civilDate)
  if (match === null) return null
  // 17h00 heure Afrique/Douala (UTC+1) = 16:00:00.000Z.
  return `${match[1]}-${match[2]}-${match[3]}T16:00:00.000Z`
}

export interface CreateWorkshopOrderInput {
  invoiceLineId: string | null
  prescriptionId: string | null
  supplierId: string | null
  frameItemId: string | null
  frameReferenceSnapshot: string
  labReference: string
  expectedDate: string | null
  quantity: string | null
  lensType: string
  pdOd: string | null
  pdOg: string | null
  fittingHeightOd: string | null
  fittingHeightOg: string | null
  notes: string
}

export interface CreateWorkshopValidation {
  errors: Record<string, string>
  request: Omit<CreateWorkshopOrderRequest, 'expected_version'> | null
}

function validatePositiveMeasure(
  raw: string | null,
  field: string,
  errors: Record<string, string>,
): string | null {
  if (raw === null || trimBlanks(raw) === '') return null
  try {
    const parsed = Diopter.parse(raw, field)
    if (parsed === null) return null
    if (parsed.units <= 0n) {
      errors[field] = 'La mesure doit être strictement positive.'
      return null
    }
    return parsed.canonical()
  } catch (error) {
    errors[field] = error instanceof RuleViolation ? error.message : 'Mesure invalide.'
    return null
  }
}

export function validateCreateWorkshopOrder(
  input: CreateWorkshopOrderInput,
  maxQuantityCanonical: string | null,
): CreateWorkshopValidation {
  const errors: Record<string, string> = {}

  if (input.invoiceLineId === null || trimBlanks(input.invoiceLineId) === '') {
    errors['invoice_line_id'] = 'Sélectionnez une ligne de facture admissible.'
  }
  if (input.prescriptionId === null || trimBlanks(input.prescriptionId) === '') {
    errors['prescription_id'] = 'Sélectionnez une prescription optique validée.'
  }
  if (input.supplierId === null || trimBlanks(input.supplierId) === '') {
    errors['supplier_id'] = 'Sélectionnez un laboratoire optique actif.'
  }

  let quantityCanonical: string | null = null
  if (input.quantity === null || trimBlanks(input.quantity) === '') {
    errors['quantity'] = 'La quantité est obligatoire.'
  } else {
    try {
      const parsed = Quantity.forLine(
        Quantity.parse(input.quantity, 'quantity') ??
          (() => {
            throw RuleViolation.invalid(
              'quantity',
              'quantity.required',
              'La quantité est obligatoire.',
            )
          })(),
        false,
        'quantity',
      )
      if (maxQuantityCanonical !== null) {
        const remaining = Quantity.of(maxQuantityCanonical, 'quantity')
        if (parsed.units > remaining.units) {
          errors['quantity'] =
            `La quantité dépasse le reliquat à commander (${remaining.canonical()}).`
        }
      }
      quantityCanonical = parsed.canonical()
    } catch (error) {
      errors['quantity'] = error instanceof RuleViolation ? error.message : 'Quantité invalide.'
    }
  }

  const lensTypeTrimmed = trimBlanks(input.lensType)
  if (lensTypeTrimmed === '') {
    errors['lens_type'] = 'Le type de verre est obligatoire pour le bon laboratoire.'
  } else if (lensTypeTrimmed.length > 100) {
    errors['lens_type'] = 'Le type de verre ne peut pas dépasser 100 caractères.'
  }

  const labRefTrimmed = trimBlanks(input.labReference)
  if (labRefTrimmed.length > 100) {
    errors['lab_reference'] = 'La référence laboratoire ne peut pas dépasser 100 caractères.'
  }

  const frameRefTrimmed = trimBlanks(input.frameReferenceSnapshot)
  if (frameRefTrimmed.length > 100) {
    errors['frame_reference_snapshot'] = 'La référence monture ne peut pas dépasser 100 caractères.'
  }

  const pdOd = validatePositiveMeasure(input.pdOd, 'pd_od', errors)
  const pdOg = validatePositiveMeasure(input.pdOg, 'pd_og', errors)
  const fittingOd = validatePositiveMeasure(input.fittingHeightOd, 'fitting_height_od', errors)
  const fittingOg = validatePositiveMeasure(input.fittingHeightOg, 'fitting_height_og', errors)

  let expectedAt: string | null = null
  if (input.expectedDate !== null && trimBlanks(input.expectedDate) !== '') {
    expectedAt = civilDateToExpectedInstant(input.expectedDate)
    if (expectedAt === null) {
      errors['expected_at'] = 'Date d’échéance attendue invalide.'
    }
  }

  if (Object.keys(errors).length > 0 || quantityCanonical === null) {
    return { errors, request: null }
  }

  return {
    errors: {},
    request: {
      invoice_line_id: input.invoiceLineId!,
      prescription_id: input.prescriptionId!,
      supplier_id: input.supplierId!,
      frame_item_id:
        input.frameItemId && trimBlanks(input.frameItemId) !== '' ? input.frameItemId : null,
      frame_reference_snapshot: frameRefTrimmed === '' ? null : frameRefTrimmed,
      lab_reference: labRefTrimmed === '' ? null : labRefTrimmed,
      expected_at: expectedAt,
      quantity: quantityCanonical,
      lens_type: lensTypeTrimmed,
      pd_od: pdOd,
      pd_og: pdOg,
      fitting_height_od: fittingOd,
      fitting_height_og: fittingOg,
      notes: trimBlanks(input.notes) === '' ? null : trimBlanks(input.notes),
    },
  }
}

export function buildAdvanceWorkshopPayload(input: {
  orderId: string
  eventType: WorkshopEventsEventType
  newStatus?: WorkshopOrdersStatus | null
  qualityResult?: WorkshopEventsQualityResult | null
  observations?: string | null
  deliveryLineId?: string | null
  labReference?: string | null
}): Omit<AdvanceWorkshopOrderRequest, 'expected_version'> {
  const obs =
    input.observations === undefined || input.observations === null
      ? null
      : trimBlanks(input.observations)
  const payload: Omit<AdvanceWorkshopOrderRequest, 'expected_version'> = {
    workshop_order_id: input.orderId,
    event_type: input.eventType,
    new_status: input.newStatus ?? null,
    quality_result: input.qualityResult ?? null,
    observations: obs === '' ? null : obs,
    delivery_line_id: input.deliveryLineId ?? null,
  }
  if (input.labReference !== undefined) {
    const cleanRef = input.labReference === null ? null : trimBlanks(input.labReference)
    payload.lab_reference = cleanRef === '' ? null : cleanRef
  }
  return payload
}

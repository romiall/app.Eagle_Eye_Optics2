import type { WorkshopOrderSnapshot } from '@/domain/contracts/generated'

import type { DocumentLogo } from '../engine/model'
import { clinicFromSnapshot, type DocumentClinic } from './clinic'

/**
 * Données d'entrée du bon laboratoire (L1D04) : strictement anonymisées pour le sous-traitant optique.
 * Ne transporte NI nom ni téléphone du patient, NI antécédents médicaux, NI prix ni règlement :
 * uniquement le `recordNumber` du dossier patient, la monture, le laboratoire destinataire et les
 * paramètres techniques OD/OG figés depuis la version précise de la prescription.
 */
export interface WorkshopOrderEyeData {
  eye: 'OD' | 'OG'
  sphere: string | null
  cylinder: string | null
  axis: number | null
  addition: string | null
  pd: string | null
  fittingHeight: string | null
  lensType: string
  lensIndex: string | null
  treatments: readonly string[]
  frameReferenceSnapshot: string | null
}

export interface WorkshopOrderDocumentData {
  templateVersion: string
  workshopOrderId: string
  reference: string
  labReference: string | null
  orderedAt: string
  expectedAt: string | null
  quantity: string
  notes: string | null
  clinic: DocumentClinic
  patientRecordNumber: string
  supplier: {
    name: string
    reference: string
    phone: string | null
    email: string | null
  }
  frame: {
    reference: string
    name: string
    brand: string | null
    model: string | null
  } | null
  invoiceLine: {
    invoiceNumber: string
    description: string
  }
  prescription: {
    versionNo: number
    origin: 'INTERNAL' | 'EXTERNAL'
    validatedAt: string
    externalPrescriber: string | null
    externalPrescribedOn: string | null
    usageLabel: string | null
    lensTypeLabel: string
    lensIndexLabel: string | null
    pdTotal: string | null
    pdOd: string | null
    pdOg: string | null
    pdInconsistencyReason: string | null
    notes: string | null
    treatments: readonly string[]
    eyes: readonly WorkshopOrderEyeData[]
  }
  createdByName: string
}

export function workshopOrderFromSnapshot(
  snapshot: WorkshopOrderSnapshot,
  logo: DocumentLogo | null = null,
): WorkshopOrderDocumentData {
  return {
    templateVersion: snapshot.template_version,
    workshopOrderId: snapshot.workshop_order_id,
    reference: snapshot.reference,
    labReference: snapshot.lab_reference,
    orderedAt: snapshot.ordered_at,
    expectedAt: snapshot.expected_at,
    quantity: snapshot.quantity,
    notes: snapshot.notes,
    clinic: clinicFromSnapshot(snapshot.clinic, logo),
    patientRecordNumber: snapshot.patient.record_number,
    supplier: {
      name: snapshot.supplier.name,
      reference: snapshot.supplier.reference,
      phone: snapshot.supplier.phone,
      email: snapshot.supplier.email,
    },
    frame:
      snapshot.frame === null
        ? null
        : {
            reference: snapshot.frame.reference,
            name: snapshot.frame.name,
            brand: snapshot.frame.brand,
            model: snapshot.frame.model,
          },
    invoiceLine: {
      invoiceNumber: snapshot.invoice_line.invoice_number,
      description: snapshot.invoice_line.description,
    },
    prescription: {
      versionNo: snapshot.prescription.version_no,
      origin: snapshot.prescription.origin,
      validatedAt: snapshot.prescription.validated_at,
      externalPrescriber: snapshot.prescription.external_prescriber,
      externalPrescribedOn: snapshot.prescription.external_prescribed_on,
      usageLabel: snapshot.prescription.usage_label,
      lensTypeLabel: snapshot.prescription.lens_type_label,
      lensIndexLabel: snapshot.prescription.lens_index_label,
      pdTotal: snapshot.prescription.pd_total,
      pdOd: snapshot.prescription.pd_od,
      pdOg: snapshot.prescription.pd_og,
      pdInconsistencyReason: snapshot.prescription.pd_inconsistency_reason,
      notes: snapshot.prescription.notes,
      treatments: snapshot.prescription.treatments,
      eyes: snapshot.prescription.eyes.map((eye) => ({
        eye: eye.eye,
        sphere: eye.sphere,
        cylinder: eye.cylinder,
        axis: eye.axis,
        addition: eye.addition,
        pd: eye.pd,
        fittingHeight: eye.fitting_height,
        lensType: eye.lens_type,
        lensIndex: eye.lens_index,
        treatments: eye.treatments_snapshot,
        frameReferenceSnapshot: eye.frame_reference_snapshot,
      })),
    },
    createdByName: snapshot.created_by.display_name,
  }
}

import type { WorkshopOrderDocumentData } from '../../data/workshop'
import { invalid } from '../../engine/errors'
import {
  formatAxis,
  formatCivilDateFr,
  formatDateFr,
  formatDateTimeFr,
  formatDiopter,
  formatMillimeters,
  formatQuantity,
  MISSING,
} from '../../engine/format'
import {
  type Block,
  type DocumentModel,
  type FieldRow,
  fields,
  heading,
  paragraph,
  row,
  table,
  type TableColumn,
} from '../../engine/model'
import {
  assembleModel,
  type BuildOptions,
  requireInstant,
  requireText,
  resolveOptions,
} from '../common'
import { EYE_LABELS, NOT_MEASURED_LEGEND } from '../clinical/shared'

function column(
  key: string,
  header: string,
  width: TableColumn['width'],
  align: TableColumn['align'],
): TableColumn {
  return { key, header, width, align }
}

/**
 * Bon laboratoire / fiche d'ordre atelier (L1D04, fichier 11) : strictement anonymisé pour le
 * laboratoire sous-traitant. Contient le code dossier patient (`recordNumber`), les mesures OD/OG
 * figées, l'indice, les traitements, les écarts pupillaires/hauteurs, le type de verre, la monture
 * et les coordonnées du laboratoire. JAMAIS de nom de patient, JAMAIS d'antécédents, JAMAIS de prix.
 */
export function buildWorkshopOrder(
  data: WorkshopOrderDocumentData,
  options?: BuildOptions,
): DocumentModel {
  const resolved = resolveOptions(options)
  const timeZone = data.clinic.timezone

  requireText(data.reference, 'reference')
  requireInstant(data.orderedAt, 'ordered_at')
  requireText(data.patientRecordNumber, 'record_number')
  requireText(data.supplier.name, 'supplier.name')

  if (data.prescription.eyes.length === 0) {
    throw invalid(
      'workshop.no_eyes',
      'prescription.eyes',
      'Le bon laboratoire exige au moins un œil prescrit.',
    )
  }

  const headerFields: FieldRow[] = [
    { label: 'Code patient (dossier)', value: data.patientRecordNumber },
    { label: 'Laboratoire', value: `${data.supplier.name} (${data.supplier.reference})` },
    { label: 'Date d’envoi', value: formatDateTimeFr(data.orderedAt, timeZone, 'ordered_at') },
    {
      label: 'Échéance prévue',
      value:
        data.expectedAt === null ? MISSING : formatDateFr(data.expectedAt, timeZone, 'expected_at'),
    },
    { label: 'Référence laboratoire', value: data.labReference ?? MISSING },
    { label: 'Pièce d’origine', value: `Facture ${data.invoiceLine.invoiceNumber}` },
    { label: 'Quantité', value: formatQuantity(data.quantity, 'quantity') },
  ]

  const labDetails: FieldRow[] = []
  if (data.supplier.phone !== null) {
    labDetails.push({ label: 'Téléphone laboratoire', value: data.supplier.phone })
  }
  if (data.supplier.email !== null) {
    labDetails.push({ label: 'Courriel laboratoire', value: data.supplier.email })
  }

  const frameLabel =
    data.frame !== null
      ? [data.frame.reference, data.frame.brand, data.frame.model, data.frame.name]
          .filter((part): part is string => part !== null && part.trim() !== '')
          .join(' — ')
      : (data.prescription.eyes[0]?.frameReferenceSnapshot ?? MISSING)

  const eyeRows = data.prescription.eyes.map((eye) => {
    const lensSummary =
      eye.lensIndex === null ? eye.lensType : `${eye.lensType} (indice ${eye.lensIndex})`
    return row([
      EYE_LABELS[eye.eye],
      formatDiopter(eye.sphere, `${eye.eye}.sphere`),
      formatDiopter(eye.cylinder, `${eye.eye}.cylinder`),
      formatAxis(eye.axis, `${eye.eye}.axis`),
      formatDiopter(eye.addition, `${eye.eye}.addition`),
      formatMillimeters(eye.pd, `${eye.eye}.pd`),
      formatMillimeters(eye.fittingHeight, `${eye.eye}.fitting_height`),
      lensSummary,
    ])
  })

  const prescriptionOriginText =
    data.prescription.origin === 'EXTERNAL'
      ? `Externe${data.prescription.externalPrescriber ? ` (${data.prescription.externalPrescriber})` : ''}${data.prescription.externalPrescribedOn ? `, ordonnance du ${formatCivilDateFr(data.prescription.externalPrescribedOn, 'external_prescribed_on')}` : ''}`
      : 'Interne (cabinet)'

  const specRows: FieldRow[] = [
    {
      label: 'Prescription figée',
      value: `Version v${data.prescription.versionNo} · ${prescriptionOriginText}`,
    },
    {
      label: 'Validée le',
      value: formatDateTimeFr(data.prescription.validatedAt, timeZone, 'validated_at'),
    },
    { label: 'Usage optique', value: data.prescription.usageLabel ?? MISSING },
    { label: 'Type de verre', value: data.prescription.lensTypeLabel },
    { label: 'Indice', value: data.prescription.lensIndexLabel ?? MISSING },
    {
      label: 'Traitements',
      value:
        data.prescription.treatments.length > 0 ? data.prescription.treatments.join(', ') : MISSING,
    },
    { label: 'DP totale', value: formatMillimeters(data.prescription.pdTotal, 'pd_total') },
  ]
  if (
    data.prescription.pdInconsistencyReason !== null &&
    data.prescription.pdInconsistencyReason.trim() !== ''
  ) {
    specRows.push({
      label: 'Justification de l’écart DP',
      value: data.prescription.pdInconsistencyReason,
    })
  }
  if (data.prescription.notes !== null && data.prescription.notes.trim() !== '') {
    specRows.push({ label: 'Notes prescription', value: data.prescription.notes })
  }
  if (data.notes !== null && data.notes.trim() !== '') {
    specRows.push({ label: 'Instructions atelier', value: data.notes })
  }
  specRows.push({ label: 'Établi par', value: data.createdByName })

  const body: Block[] = [
    heading('Équipement et monture', 2),
    fields(
      [
        { label: 'Désignation commande', value: data.invoiceLine.description },
        { label: 'Monture', value: frameLabel },
      ],
      1,
    ),
    table(
      'Correction et centrage OD / OG',
      [
        column('eye', 'Œil', { mm: 26 }, 'left'),
        column('sphere', 'Sphère', { mm: 16 }, 'right'),
        column('cylinder', 'Cyl.', { mm: 16 }, 'right'),
        column('axis', 'Axe', { mm: 14 }, 'right'),
        column('addition', 'Add.', { mm: 16 }, 'right'),
        column('pd', 'DP', { mm: 18 }, 'right'),
        column('height', 'Hauteur', { mm: 18 }, 'right'),
        column('lens', 'Verre / Indice', { fr: 1 }, 'left'),
      ],
      eyeRows,
      { sizePt: 8.5 },
    ),
    heading('Spécifications techniques et traçabilité', 2),
    fields(specRows, 1),
  ]

  if (labDetails.length > 0) {
    body.push(fields(labDetails, 2))
  }

  body.push(
    paragraph(NOT_MEASURED_LEGEND, { muted: true, sizePt: 8 }),
    paragraph(
      'Document technique anonymisé pour le laboratoire optique : seul le code dossier du patient figure sur ce bon (sans identité nominative, sans antécédents médicaux et sans montant).',
      { muted: true, sizePt: 8 },
    ),
  )

  return assembleModel({
    kind: 'WORKSHOP',
    templateVersion: data.templateVersion,
    clinic: data.clinic,
    options: resolved,
    family: 'financial',
    heading: 'BON LABORATOIRE',
    subtitle: 'Ordre de montage anonymisé',
    number: data.reference,
    documentAt: data.orderedAt,
    draft: false,
    headerFields,
    pdfTitle: `Bon laboratoire ${data.reference}`,
    body,
    warnings: [],
  })
}

// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type {
  Consultation,
  CreditNoteSnapshot,
  Invoice,
  InvoiceClinicSnapshot,
  InvoicePatientSnapshot,
  InvoiceTaxSnapshot,
  Prescription,
  ReceiptSnapshot,
  RefundSnapshot,
} from '@/domain/contracts/generated'
import { clinicFromSnapshot, readDocumentSettings } from '@/documents/data/clinic'
import {
  acuityRowsFromResource,
  clinicalPatientFromFields,
  consultationEntryFromResource,
  prescriptionFromResource,
  prescriptionSummaryFromResource,
} from '@/documents/data/clinicalAdapters'
import { defaultClinicalLabels } from '@/documents/data/clinicalLabels'
import {
  creditNoteFromSnapshot,
  invoiceFromResource,
  receiptFromSnapshot,
  refundFromSnapshot,
  statementRowsFromInvoices,
} from '@/documents/data/financial'
import { demoClinic } from '@/documents/demo/fixtures'
import { DocumentDataError } from '@/documents/engine/errors'
import { MISSING } from '@/documents/engine/format'
import { buildCreditNote } from '@/documents/templates/credits/creditNote'
import { buildRefund } from '@/documents/templates/credits/refund'
import { buildClinicalRecord } from '@/documents/templates/clinical/clinicalRecord'
import { buildOpticalPrescription } from '@/documents/templates/clinical/opticalPrescription'
import { buildInvoice } from '@/documents/templates/financial/invoice'
import { buildReceipt } from '@/documents/templates/financial/receipt'
import { hasTemplate, TEMPLATE_VERSION } from '@/documents/templates/registry'

import { layout, printedText } from './support'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function fixture<T>(path: string): T {
  const content = JSON.parse(readFileSync(join(ROOT, 'contracts', 'fixtures', path), 'utf8')) as {
    data: T
  }
  return content.data
}

const receiptSnapshot = fixture<ReceiptSnapshot>('snapshots/receipt.deposit.valid.json')
const invoiceResource = fixture<{ data: Invoice }>('resources/invoice.issued.valid.json').data

const ID_USER = '01J9ZXK4M2Q8R7S6T5V4W30005'

describe('reçu : adaptateur du snapshot du serveur (contracts/snapshots/receipt.json)', () => {
  const data = receiptFromSnapshot(receiptSnapshot)

  it('reprend chaque champ du snapshot sans le modifier', () => {
    expect(data.templateVersion).toBe(receiptSnapshot.template_version)
    expect(data.receiptNumber).toBe('TEST-REC-000001')
    expect(data.payment).toEqual({
      amount: 30000,
      method: 'MTN_MOMO',
      reference: 'REFERENCE_FICTIVE',
    })
    expect(data.paidNetBefore).toBe(0)
    expect(data.paidNetAfter).toBe(30000)
    expect(data.balanceAfter).toBe(50000)
    expect(data.kind).toBe('DEPOSIT')
    expect(data.cashierName).toBe('Caisse (démonstration)')
    expect(data.patient.recordNumber).toBe('TEST-P-000001')
    expect(data.clinic.testDocument).toBe(true)
    expect(data.clinic.timezone).toBe('Africa/Douala')
  })

  it('la version de modèle du snapshot du serveur est disponible dans le registre', () => {
    expect(receiptSnapshot.template_version).toBe(TEMPLATE_VERSION)
    expect(hasTemplate('RECEIPT', receiptSnapshot.template_version)).toBe(true)
  })

  it('le reçu produit correspond exactement au snapshot (numéros, montants, patient)', () => {
    const text = printedText(layout(buildReceipt(data)))

    expect(text).toContain('Numéro | TEST-REC-000001')
    expect(text).toContain('Facture n° | TEST-FAC-000001')
    expect(text).toContain('PATIENT FICTIF Élodie Marie')
    expect(text).toContain('Mode de règlement | Mobile money MTN')
    expect(text).toContain('Référence | REFERENCE_FICTIVE')
  })

  it('le cabinet vient du snapshot figé, pas de la configuration courante', () => {
    const later = demoClinic({ name: 'Nom actuel du cabinet' })

    expect(data.clinic.name).toBe(receiptSnapshot.clinic.name)
    expect(data.clinic.name).not.toBe(later.name)
  })
})

describe('avoir et remboursement : adaptateurs des snapshots du serveur', () => {
  const clinic: InvoiceClinicSnapshot = receiptSnapshot.clinic
  const patient = receiptSnapshot.patient

  const creditNote: CreditNoteSnapshot = {
    credit_note_id: '01J9ZXK4M2Q8R7S6T5V4W3002X',
    number: 'TEST-AV-000001',
    issued_at: '2026-10-20T10:00:00.000Z',
    invoice: receiptSnapshot.invoice,
    patient,
    lines: [
      {
        invoice_line_id: '01J9ZXK4M2Q8R7S6T5V4W3001W',
        description: 'Examen de vue (fictif)',
        quantity: '1.000',
        amount_gross: 5000,
        tax_amount: null,
      },
    ],
    amount_gross: 5000,
    reason: 'Motif fictif',
    issued_by: { user_id: ID_USER, display_name: 'Gérante (démonstration)' },
    approval_id: '01J9ZXK4M2Q8R7S6T5V4W3002Z',
    tax: { regime: 'NO_TAX_CONFIGURED', rules: [] },
    clinic,
    template_version: TEMPLATE_VERSION,
  }

  const refund: RefundSnapshot = {
    refund_id: '01J9ZXK4M2Q8R7S6T5V4W3002Y',
    number: 'TEST-RMB-000001',
    effective_at: '2026-10-20T10:30:00.000Z',
    credit_note: { credit_note_id: creditNote.credit_note_id, number: creditNote.number },
    invoice: receiptSnapshot.invoice,
    beneficiary: patient,
    amount: 5000,
    currency: 'XAF',
    method: 'CASH',
    reference: null,
    created_by: { user_id: ID_USER, display_name: 'Gérante (démonstration)' },
    clinic,
    template_version: TEMPLATE_VERSION,
  }

  it('l’avoir reprend ses lignes, son motif, son auteur et son régime fiscal figé', () => {
    const data = creditNoteFromSnapshot(creditNote)

    expect(data.lines).toEqual([
      {
        description: 'Examen de vue (fictif)',
        quantity: '1.000',
        amountGross: 5000,
        taxAmount: null,
      },
    ])
    expect(data.reason).toBe('Motif fictif')
    expect(data.approvalId).toBe('01J9ZXK4M2Q8R7S6T5V4W3002Z')
    expect(data.tax.regime).toBe('NO_TAX_CONFIGURED')
    expect(printedText(layout(buildCreditNote(data)))).toContain('Montant de l’avoir')
    expect(hasTemplate('CREDIT_NOTE', creditNote.template_version)).toBe(true)
  })

  it('le remboursement reprend avoir, facture, bénéficiaire, mode et auteur', () => {
    const data = refundFromSnapshot(refund)

    expect(data.creditNoteNumber).toBe('TEST-AV-000001')
    expect(data.beneficiary.lastName).toBe('PATIENT FICTIF')
    expect(data.createdByName).toBe('Gérante (démonstration)')
    expect(printedText(layout(buildRefund(data)))).toContain('Montant remboursé')
    expect(hasTemplate('REFUND', refund.template_version)).toBe(true)
  })
})

/** Ressource facture modifiée sans dépendre de la forme exacte des types générés. */
function variant(invoice: Invoice, patch: Record<string, unknown>): Invoice {
  return { ...invoice, ...patch } as Invoice
}

describe('facture : adaptateur de la ressource Invoice (snapshots figés)', () => {
  const clinic: InvoiceClinicSnapshot = receiptSnapshot.clinic
  const patient: InvoicePatientSnapshot = receiptSnapshot.patient
  const tax: InvoiceTaxSnapshot = { regime: 'NO_TAX_CONFIGURED', rules: [] }
  const base = { issuedByName: 'Caisse (démonstration)', templateVersion: TEMPLATE_VERSION }

  it('une facture émise reprend lignes, numéro, date, total et snapshots figés de la ressource', () => {
    const data = invoiceFromResource({ invoice: invoiceResource, ...base })

    expect(data.number).toBe('TEST-FAC-000001')
    expect(data.status).toBe('ISSUED')
    expect(data.issuedAt).toBe('2026-10-14T09:30:00.000Z')
    expect(data.lines).toHaveLength(1)
    expect(data.lines[0]).toMatchObject({
      reference: 'EX-001',
      description: 'Examen de vue (fictif)',
      unitCode: 'SERVICE',
      quantity: '1',
      unitPriceGross: 15000,
      lineTotalGross: 15000,
    })
    expect(data.patient.recordNumber).toBe('TEST-P-000001')
    expect(data.clinic.testDocument).toBe(true)
    expect(data.clinic.name).toBe(receiptSnapshot.clinic.name)
    expect(data.tax.regime).toBe('NO_TAX_CONFIGURED')
  })

  it('les snapshots figés l’emportent sur l’identité et le cabinet courants (AT08)', () => {
    const data = invoiceFromResource({
      invoice: invoiceResource,
      ...base,
      clinic: { ...clinic, name: 'Nouveau nom du cabinet' },
      patient: { ...patient, last_name: 'NOUVEAU NOM' },
    })

    expect(data.clinic.name).toBe(receiptSnapshot.clinic.name)
    expect(data.patient.lastName).toBe('PATIENT FICTIF')
  })

  it('une facture émise dont les snapshots manquent est refusée, jamais complétée par la configuration courante', () => {
    const stripped = variant(invoiceResource, {
      patient_snapshot: null,
      clinic_snapshot: null,
      tax_snapshot: null,
    })

    expect(() => invoiceFromResource({ invoice: stripped, ...base })).toThrow(DocumentDataError)
  })

  it('un brouillon reçoit cabinet et patient courants de l’appelant (rien n’est encore figé)', () => {
    const draft = variant(invoiceResource, {
      status: 'DRAFT',
      number: null,
      issued_at: null,
      patient_snapshot: null,
      clinic_snapshot: null,
      tax_snapshot: null,
    })

    expect(() => invoiceFromResource({ invoice: draft, ...base })).toThrow(DocumentDataError)
    const data = invoiceFromResource({ invoice: draft, ...base, clinic, patient })
    expect(data.status).toBe('DRAFT')
    expect(data.number).toBeNull()
    expect(data.tax.regime).toBe('NO_TAX_CONFIGURED')
    expect(data.patient.recordNumber).toBe('TEST-P-000001')
    // Un brouillon ne passe pas le régime fiscal courant s'il n'est pas fourni : aucune taxe inventée.
    expect(invoiceFromResource({ invoice: draft, ...base, clinic, patient, tax }).tax).toEqual(
      data.tax,
    )
  })

  it('le gabarit refuse la facture d’exemple dont le total ne suit pas les lignes (80 000 pour 15 000)', () => {
    const data = invoiceFromResource({ invoice: invoiceResource, ...base })

    expect(() => buildInvoice(data)).toThrow(DocumentDataError)
    expect(() => buildInvoice({ ...data, totalGross: 15000 })).not.toThrow()
  })

  it('refuse une facture abandonnée et une facture émise sans numéro', () => {
    expect(() =>
      invoiceFromResource({ invoice: variant(invoiceResource, { status: 'ABANDONED' }), ...base }),
    ).toThrow(DocumentDataError)
    expect(() =>
      invoiceFromResource({ invoice: variant(invoiceResource, { number: null }), ...base }),
    ).toThrow(DocumentDataError)
  })

  it('l’état de compte ne retient que les paiements CONFIRMÉS avec reçu, et les factures émises', () => {
    const first = invoiceResource.payments[0]
    if (first === undefined) throw new Error('Paiement d’exemple absent.')
    const pending = {
      ...first,
      id: '01J9ZXK4M2Q8R7S6T5V4W30099',
      status: 'PENDING' as const,
      receipt_number: null,
      receipt_id: null,
    }
    const draft = variant(invoiceResource, {
      id: '01J9ZXK4M2Q8R7S6T5V4W30098',
      status: 'DRAFT',
      number: null,
      issued_at: null,
    })
    const rows = statementRowsFromInvoices([
      variant(invoiceResource, { payments: [...invoiceResource.payments, pending] }),
      draft,
    ])

    expect(rows.invoices).toHaveLength(1)
    expect(rows.invoices[0]).toMatchObject({
      number: 'TEST-FAC-000001',
      paidNet: 30000,
      balance: 50000,
    })
    expect(rows.payments).toEqual([
      {
        receiptNumber: 'TEST-REC-000001',
        effectiveAt: '2026-10-14T09:30:00.000Z',
        method: 'MTN_MOMO',
        amount: 30000,
        invoiceNumber: 'TEST-FAC-000001',
      },
    ])
    expect(rows.creditNotes).toEqual([])
    expect(rows.refunds).toEqual([])
  })
})

describe('cabinet : paramètres du document', () => {
  it('lit les clés connues de document_settings et ignore le reste', () => {
    const settings = readDocumentSettings({
      header_lines: ['  Ligne A  ', '', 42, 'Ligne B'],
      footer_lines: 'pas une liste',
      payment_terms: '  Conditions fictives  ',
      inconnue: 'ignorée',
    })

    expect(settings.headerLines).toEqual(['Ligne A', 'Ligne B'])
    expect(settings.footerLines).toEqual([])
    expect(settings.paymentTerms).toBe('Conditions fictives')
  })

  it('un réglage absent ou malformé ne bloque jamais une impression', () => {
    for (const raw of [null, undefined, 'texte', 12, ['x']]) {
      expect(readDocumentSettings(raw)).toEqual({
        headerLines: [],
        footerLines: [],
        paymentTerms: null,
      })
    }
  })

  it('borne le nombre et la longueur des lignes', () => {
    const settings = readDocumentSettings({
      header_lines: Array.from({ length: 20 }, (_, index) => `L${index}`),
      payment_terms: 'x'.repeat(5000),
    })

    expect(settings.headerLines).toHaveLength(6)
    expect(settings.paymentTerms?.length).toBe(1000)
  })

  it('les champs vides du snapshot du cabinet deviennent absents (null), pas des chaînes vides', () => {
    const clinic = clinicFromSnapshot({ ...receiptSnapshot.clinic, address: '  ', phone: '' })

    expect(clinic.address).toBeNull()
    expect(clinic.phone).toBeNull()
  })
})

// --- Documents cliniques ---------------------------------------------------------------------------

const PATIENT = clinicalPatientFromFields({
  record_number: 'TEST-P-000001',
  last_name: 'PATIENT FICTIF',
  first_names: 'Élodie Marie',
  sex: 'F',
  birth_date: '1990-05-17',
})

function eyeResource(
  eye: 'OD' | 'OG',
  overrides: Partial<Prescription['eyes'][number]> = {},
): Prescription['eyes'][number] {
  return {
    id: eye === 'OD' ? '01J9ZXK4M2Q8R7S6T5V4W30041' : '01J9ZXK4M2Q8R7S6T5V4W30042',
    eye,
    no_correction: false,
    sphere: '-1.25',
    cylinder: '-0.50',
    axis: 90,
    addition: '2.00',
    fitting_height: '22.00',
    ...overrides,
  }
}

function prescriptionResource(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: '01J9ZXK4M2Q8R7S6T5V4W30033',
    series_id: '01J9ZXK4M2Q8R7S6T5V4W30043',
    version_no: 2,
    supersedes_id: null,
    patient_id: '01J9ZXK4M2Q8R7S6T5V4W30001',
    origin: 'INTERNAL',
    consultation_id: '01J9ZXK4M2Q8R7S6T5V4W30037',
    external_prescriber: null,
    external_prescribed_on: null,
    external_file_id: null,
    status: 'VALIDATED',
    usage_code: 'PROGRESSIVE',
    usage_other: null,
    lens_type_code: 'OTHER',
    lens_type_other: 'Type saisi fictif',
    lens_index: '1.60',
    lens_index_other: null,
    pd_total: '63.00',
    pd_od: '31.50',
    pd_og: '31.50',
    pd_inconsistency_reason: null,
    notes: null,
    eyes: [eyeResource('OG', { sphere: '0.75', cylinder: '0.00', axis: null }), eyeResource('OD')],
    treatments: [
      { id: '01J9ZXK4M2Q8R7S6T5V4W30044', term_code: 'ANTI_REFLECTION', other_text: null },
      { id: '01J9ZXK4M2Q8R7S6T5V4W30045', term_code: 'OTHER', other_text: 'traitement fictif' },
    ],
    validated_at: '2026-10-14T09:10:00.000Z',
    validated_by: ID_USER,
    validated_by_name: null,
    document_id: null,
    updated_at: '2026-10-14T09:10:00.000Z',
    ...overrides,
  }
}

describe('prescription : adaptateur de la ressource Prescription', () => {
  const labels = defaultClinicalLabels()
  const data = prescriptionFromResource({
    prescription: prescriptionResource(),
    clinic: demoClinic(),
    patient: PATIENT,
    professional: { displayName: 'Professionnel (démonstration)', professionalNumber: null },
    consultationAt: '2026-10-14T08:40:00.000Z',
    labels,
    templateVersion: TEMPLATE_VERSION,
  })

  it('met les yeux dans l’ordre OD puis OG, quel que soit l’ordre du serveur', () => {
    expect(data.body.eyes.map((eye) => eye.eye)).toEqual(['OD', 'OG'])
    expect(data.body.eyes[1]).toMatchObject({ sphere: '0.75', cylinder: '0.00', axis: null })
  })

  it('résout les codes en libellés du référentiel ; « Autre » garde sa précision saisie', () => {
    expect(data.body.usage).toBe('Progressifs')
    expect(data.body.lensType).toBe('Autre : Type saisi fictif')
    expect(data.body.lensIndex).toBe('1.60')
    expect(data.body.treatments).toEqual(['Anti-reflet', 'Autre : traitement fictif'])
  })

  it('imprime la prescription telle que le serveur la décrit (version, statut, DP)', () => {
    const text = printedText(layout(buildOpticalPrescription(data)))

    expect(data.versionNo).toBe(2)
    expect(data.status).toBe('VALIDATED')
    expect(text).toContain('Version | 2')
    expect(text).toContain('Sexe | Féminin')
    expect(text).toContain('OD (œil droit) | -1,25 | -0,50 | 90° | +2,00')
    expect(text).toContain(`OG (œil gauche) | +0,75 | 0,00 | ${MISSING} | +2,00`)
  })

  it('un code inconnu est imprimé tel quel, jamais deviné', () => {
    const unknown = prescriptionFromResource({
      prescription: prescriptionResource({ usage_code: 'CODE_INCONNU' }),
      clinic: demoClinic(),
      patient: PATIENT,
      professional: null,
      consultationAt: null,
      labels,
      templateVersion: TEMPLATE_VERSION,
    })

    expect(unknown.body.usage).toBe('CODE_INCONNU')
  })

  it('refuse une prescription sans œil droit ou sans œil gauche', () => {
    expect(() =>
      prescriptionFromResource({
        prescription: prescriptionResource({
          eyes: [eyeResource('OD'), eyeResource('OD', { id: '01J9ZXK4M2Q8R7S6T5V4W30046' })],
        }),
        clinic: demoClinic(),
        patient: PATIENT,
        professional: null,
        consultationAt: null,
        labels,
        templateVersion: TEMPLATE_VERSION,
      }),
    ).toThrow(DocumentDataError)
  })

  it('le résumé pour le dossier garde la version et la date de validation', () => {
    const summary = prescriptionSummaryFromResource(prescriptionResource(), labels)

    expect(summary).toMatchObject({
      versionNo: 2,
      status: 'VALIDATED',
      at: '2026-10-14T09:10:00.000Z',
    })
  })
})

describe('patient clinique : adaptateur des champs du patient', () => {
  it('un sexe « non renseigné » n’est pas imprimé', () => {
    const patient = clinicalPatientFromFields({
      record_number: 'TEST-P-000002',
      last_name: 'PATIENT FICTIF',
      first_names: null,
      sex: 'UNKNOWN',
      birth_date: null,
    })

    expect(patient.sex).toBeNull()
    expect(patient.birthDate).toBeNull()
  })
})

describe('consultation : adaptateur de la ressource Consultation', () => {
  const labels = defaultClinicalLabels()
  const scale = '01J9ZXK4M2Q8R7S6T5V4W30047'

  function consultation(): Consultation {
    return {
      id: '01J9ZXK4M2Q8R7S6T5V4W30037',
      visit_id: '01J9ZXK4M2Q8R7S6T5V4W3000A',
      patient_id: '01J9ZXK4M2Q8R7S6T5V4W30001',
      clinician_id: ID_USER,
      effective_at: '2026-10-14T08:40:00.000Z',
      date_change_reason: null,
      status: 'COMPLETED',
      current_revision: 1,
      completed_at: '2026-10-14T09:00:00.000Z',
      finalization_missing_data_reason: null,
      version: 3,
      patient: {
        id: '01J9ZXK4M2Q8R7S6T5V4W30001',
        record_number: 'TEST-P-000001',
        last_name: 'PATIENT FICTIF',
        first_names: 'Élodie Marie',
        sex: 'F',
        birth_date: '1990-05-17',
        profession: null,
      },
      steps: {
        ANAMNESIS: {
          symptoms: 'Texte fictif',
          wears_glasses: true,
          glasses_duration: null,
          previous_correction_available: null,
          complaints: [
            { id: '01J9ZXK4M2Q8R7S6T5V4W30051', term_code: 'BLURRED_VISION', other_text: null },
            { id: '01J9ZXK4M2Q8R7S6T5V4W30052', term_code: 'OTHER', other_text: 'motif fictif' },
          ],
        },
        HISTORIES: {
          histories: [
            {
              id: '01J9ZXK4M2Q8R7S6T5V4W30053',
              history_group: 'MEDICAL_HISTORY',
              known_none: false,
              comments: null,
              terms: [
                { id: '01J9ZXK4M2Q8R7S6T5V4W30054', term_code: 'DIABETES', other_text: null },
              ],
            },
          ],
        },
        VISUAL_ACUITY: {
          acuities: [
            {
              id: '01J9ZXK4M2Q8R7S6T5V4W30055',
              context: 'PRELIMINARY',
              distance: 'FAR',
              correction: 'WITHOUT',
              eye: 'OG',
              scale_id: scale,
              raw_value: '6/10',
              normalized_value: null,
            },
            {
              id: '01J9ZXK4M2Q8R7S6T5V4W30056',
              context: 'PRELIMINARY',
              distance: 'FAR',
              correction: 'WITHOUT',
              eye: 'OD',
              scale_id: scale,
              raw_value: '5/10',
              normalized_value: null,
            },
          ],
        },
        REFRACTION: {
          measurements: [
            {
              id: '01J9ZXK4M2Q8R7S6T5V4W30057',
              stage: 'SUBJECTIVE',
              eye: 'OD',
              sphere: '-1.25',
              cylinder: null,
              axis: null,
              addition: null,
            },
          ],
          refraction_observations: null,
          ametropias: [{ id: '01J9ZXK4M2Q8R7S6T5V4W30059', term_code: 'MYOPIA', other_text: null }],
        },
        CENTERING: {
          centering_id: null,
          pd_total: '63.00',
          pd_od: null,
          pd_og: null,
          inconsistency_reason: null,
        },
        MEDICATIONS: {
          orders: [
            {
              id: '01J9ZXK4M2Q8R7S6T5V4W3005A',
              catalog_item_id: null,
              name: 'Collyre fictif (démonstration)',
              form: 'DROPS',
              form_other: null,
              strength: null,
              dosage: '1 goutte',
              frequency: null,
              duration_text: null,
              duration_value: 7,
              duration_unit: 'DAY',
              instructions: null,
            },
          ],
        },
        CONCLUSION: {
          conclusion: 'Conclusion fictive',
          referral: true,
          referral_urgency: 'RECOMMENDED',
          referral_reasons: [
            { id: '01J9ZXK4M2Q8R7S6T5V4W30058', term_code: 'SUSPECTED_GLAUCOMA', other_text: null },
          ],
        },
      },
      revisions: [],
    }
  }

  it('résout les motifs, antécédents, urgence et motifs d’orientation en libellés', () => {
    const entry = consultationEntryFromResource({
      consultation: consultation(),
      clinicianName: 'Professionnel (démonstration)',
      labels,
    })

    expect(entry.complaints).toEqual(['Vision floue', 'Autre : motif fictif'])
    expect(entry.histories).toEqual([
      { group: 'Antécédents médicaux', knownNone: false, terms: ['Diabète'], comments: null },
    ])
    expect(entry.referralUrgency).toBe('Consultation recommandée')
    expect(entry.referralReasons).toEqual(['Suspicion de glaucome'])
    expect(entry.referral).toBe(true)
    expect(entry.status).toBe('COMPLETED')
    expect(entry.revisionNo).toBe(1)
  })

  it('lit les sept rubriques, dont MEDICATIONS (tel que saisi) et les amétropies choisies', () => {
    const entry = consultationEntryFromResource({
      consultation: consultation(),
      clinicianName: 'Professionnel (démonstration)',
      labels,
    })

    expect(entry.ametropias).toEqual(['Myopie'])
    expect(entry.refractionObservations).toBeNull()
    expect(entry.medications).toEqual([
      {
        name: 'Collyre fictif (démonstration)',
        form: 'Collyre',
        strength: null,
        posology: '1 goutte',
        frequency: null,
        duration: '7 jour(s)',
        instructions: null,
      },
    ])
  })

  it('regroupe les acuités par contexte, distance et correction, OD avant OG, valeur originale conservée', () => {
    const rows = acuityRowsFromResource(consultation().steps.VISUAL_ACUITY.acuities, labels)

    expect(rows).toEqual([
      {
        context: 'Préliminaire',
        distance: 'De loin',
        correction: 'Sans correction',
        od: '5/10',
        og: '6/10',
        ou: MISSING,
        scale: null,
      },
    ])
  })

  it('un résolveur d’échelle fourni par l’écran clinique nomme l’échelle utilisée', () => {
    const named = { ...labels, scale: () => 'Monoyer (fictive)' }
    const rows = acuityRowsFromResource(consultation().steps.VISUAL_ACUITY.acuities, named)

    expect(rows[0]?.scale).toBe('Monoyer (fictive)')
  })

  it('le dossier produit n’agrège aucune mesure : une mesure absente reste un tiret', () => {
    const entry = consultationEntryFromResource({
      consultation: consultation(),
      clinicianName: 'Professionnel (démonstration)',
      labels,
    })
    const text = printedText(
      layout(
        buildClinicalRecord({
          templateVersion: TEMPLATE_VERSION,
          recordId: '01J9ZXK4M2Q8R7S6T5V4W30036',
          selection: 'SINGLE',
          exportedAt: '2026-10-22T09:00:00.000Z',
          exportedByName: 'Professionnel (démonstration)',
          clinic: demoClinic(),
          patient: PATIENT,
          consultations: [entry],
          prescriptions: [],
        }),
      ),
    )

    expect(text).toContain('Réfraction subjective | OD (œil droit) | -1,25')
    expect(text).toContain(`${MISSING} | ${MISSING} | ${MISSING}`)
    expect(text).toContain('Orienté vers ophtalmologiste')
    expect(text).toContain('Niveau d’urgence | Consultation recommandée')
  })
})

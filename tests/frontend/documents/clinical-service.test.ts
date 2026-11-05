// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ClinicalPrintRefused,
  consultationDocument,
  consultationPrintables,
  prescriptionDocument,
  prescriptionScreenModel,
  printablePrescription,
} from '@/app/services/clinicalDocuments'
import {
  DocumentAccessError,
  documentStore,
  resetDocumentStoreForTests,
} from '@/app/services/documents'
import { NBSP } from '@/documents/engine/charset'
import type { TableBlock } from '@/documents/engine/model'
import type {
  ClinicalRevisionDetail,
  ClinicalRevisionSnapshot,
  Consultation,
  Prescription,
} from '@/domain/contracts/generated'

import { FORBIDDEN_WORDS, printedText } from './support'

// Service des documents cliniques (D02, C04) : ce qui est proposé selon l'état et les droits, lecture de la
// révision FIGÉE au moment de l'impression (jamais la saisie affichée), droits vérifiés avant toute lecture,
// conservation de l'original (port volatil), nom du professionnel jamais deviné. Le rendu jsPDF est remplacé
// par des octets dérivés du texte mis en page (le vrai rendu est testé par pdf.test.ts). Données FICTIVES.
const state = vi.hoisted(() => ({
  account: null as null | {
    id: string
    display_name: string
    permissions: string[]
    clinic: {
      id: string
      name: string
      timezone: string
      currency: 'XAF'
      production_documents_enabled: boolean
      enabled_modules: string[]
    }
  },
  revisions: new Map<number, unknown>(),
  prescriptions: [] as unknown[],
  reads: [] as string[],
  failure: null as Error | null,
}))

vi.mock('@/app/session', () => ({
  session: {
    get account() {
      return state.account
    },
  },
  canOnScreen: (permission: string) => state.account?.permissions.includes(permission) ?? false,
  currentPermissions: {
    get value() {
      return state.account?.permissions ?? []
    },
  },
}))

vi.mock('@/app/services/consultations', () => {
  const live = <T>(data: T) => ({
    data,
    freshness: { serverAsOf: '2026-10-22T09:00:00.000Z', complete: true },
    live: true,
  })
  return {
    getRevision: async (_id: string, revisionNo: number) => {
      state.reads.push(`revision:${revisionNo}`)
      if (state.failure !== null) throw state.failure
      const found = state.revisions.get(revisionNo)
      if (found === undefined) throw new Error('Révision absente du serveur simulé.')
      return live(found)
    },
    getConsultationPrescriptions: async () => {
      state.reads.push('prescriptions')
      return live(state.prescriptions)
    },
  }
})

vi.mock('@/documents/engine/pdf', async () => {
  const support = await import('./support')
  return {
    renderDocument: (model: Parameters<typeof support.layout>[0]) => {
      const plan = support.layout(model)
      return {
        bytes: new TextEncoder().encode(`%PDF-fictif\n${support.printedText(plan)}`),
        pageCount: plan.pages.length,
        warnings: [...plan.warnings],
        plan,
      }
    },
  }
})

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SNAPSHOT = (
  JSON.parse(
    readFileSync(
      join(ROOT, 'contracts', 'fixtures', 'snapshots', 'clinical-revision.valid.json'),
      'utf8',
    ),
  ) as { data: ClinicalRevisionSnapshot }
).data

const ME = '01J9ZXK4M2Q8R7S6T5V4W30006'
const COLLEAGUE = '01J9ZXK4M2Q8R7S6T5V4W30008'
const STRANGER = '01J9ZXK4M2Q8R7S6T5V4W30009'
const REVISION_ID = '01J9ZXK4M2Q8R7S6T5V4W3001R'
const CLINICAL = ['clinical.read', 'clinical.write', 'clinical.complete', 'clinical.amend']
const CASHIER = ['invoice.read', 'invoice.create', 'payment.collect', 'cash.own_session']

function signIn(permissions: string[], displayName = 'Dr Fictif'): void {
  state.account = {
    id: ME,
    display_name: displayName,
    permissions,
    clinic: {
      id: '01J9ZXK4M2Q8R7S6T5V4W30003',
      name: 'TEST CABINET FICTIF',
      timezone: 'Africa/Douala',
      currency: 'XAF',
      production_documents_enabled: false,
      enabled_modules: ['consultations'],
    },
  }
}

function revisionDetail(
  revisionNo = 1,
  snapshot: Partial<ClinicalRevisionSnapshot> = {},
): ClinicalRevisionDetail {
  const merged = { ...structuredClone(SNAPSHOT), revision_no: revisionNo, ...snapshot }
  return {
    id: revisionNo === 1 ? REVISION_ID : `01J9ZXK4M2Q8R7S6T5V4W3001${revisionNo}`,
    revision_no: revisionNo,
    recorded_at: merged.recorded_at,
    author_id: merged.author.user_id,
    reason: 'Finalisation de la consultation',
    previous_revision_id: null,
    sha256: 'a'.repeat(64),
    snapshot: merged,
  }
}

/** Consultation TERMINÉE dont l'état courant diffère de la révision figée (saisie affichée « en cours »). */
function consultation(overrides: Partial<Consultation> = {}): Consultation {
  return {
    id: SNAPSHOT.consultation_id,
    visit_id: SNAPSHOT.visit_id,
    patient_id: SNAPSHOT.patient.patient_id,
    clinician_id: ME,
    effective_at: SNAPSHOT.effective_at,
    date_change_reason: null,
    status: 'COMPLETED',
    current_revision: 1,
    completed_at: SNAPSHOT.recorded_at,
    finalization_missing_data_reason: null,
    version: 4,
    patient: {
      id: SNAPSHOT.patient.patient_id,
      record_number: SNAPSHOT.patient.record_number,
      last_name: SNAPSHOT.patient.last_name,
      first_names: SNAPSHOT.patient.first_names,
      sex: 'F',
      birth_date: '1990-05-17',
      profession: null,
    },
    steps: {
      ...structuredClone(SNAPSHOT.steps),
      MEDICATIONS: {
        orders: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3003A',
            catalog_item_id: null,
            name: 'SAISIE AFFICHEE NON FIGEE',
            form: 'DROPS',
            form_other: null,
            strength: null,
            dosage: null,
            frequency: null,
            duration_text: null,
            duration_value: null,
            duration_unit: null,
            instructions: null,
          },
        ],
      },
      CONCLUSION: { ...SNAPSHOT.steps.CONCLUSION, referral: true, referral_urgency: 'RECOMMENDED' },
    },
    revisions: [
      {
        id: REVISION_ID,
        revision_no: 1,
        recorded_at: SNAPSHOT.recorded_at,
        author_id: SNAPSHOT.author.user_id,
        reason: 'Finalisation de la consultation',
        previous_revision_id: null,
        sha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  }
}

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: '01J9ZXK4M2Q8R7S6T5V4W3002E',
    series_id: '01J9ZXK4M2Q8R7S6T5V4W3002F',
    version_no: 1,
    supersedes_id: null,
    patient_id: SNAPSHOT.patient.patient_id,
    origin: 'INTERNAL',
    consultation_id: SNAPSHOT.consultation_id,
    external_prescriber: null,
    external_prescribed_on: null,
    external_file_id: null,
    status: 'VALIDATED',
    usage_code: 'PERMANENT',
    usage_other: null,
    lens_type_code: 'SINGLE_VISION',
    lens_type_other: null,
    lens_index: '1.60',
    lens_index_other: null,
    pd_total: '62.00',
    pd_od: null,
    pd_og: null,
    pd_inconsistency_reason: null,
    notes: null,
    eyes: [
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3002G',
        eye: 'OD',
        no_correction: false,
        sphere: '-1.25',
        cylinder: '-0.50',
        axis: 90,
        addition: null,
        fitting_height: null,
      },
      {
        id: '01J9ZXK4M2Q8R7S6T5V4W3002H',
        eye: 'OG',
        no_correction: true,
        sphere: null,
        cylinder: null,
        axis: null,
        addition: null,
        fitting_height: null,
      },
    ],
    treatments: [
      { id: '01J9ZXK4M2Q8R7S6T5V4W3002K', term_code: 'ANTI_REFLECTION', other_text: null },
    ],
    validated_at: '2026-10-14T09:40:00.000Z',
    validated_by: ME,
    validated_by_name: null,
    document_id: '01J9ZXK4M2Q8R7S6T5V4W3002J',
    updated_at: '2026-10-14T09:40:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  state.revisions = new Map([[1, revisionDetail(1)]])
  state.prescriptions = []
  state.reads = []
  state.failure = null
})

afterEach(() => {
  state.account = null
  resetDocumentStoreForTests()
})

describe('documents proposés selon l’état et les droits', () => {
  it('rien pour un examen en cours ou un brouillon, même avec tous les droits', () => {
    signIn([...CLINICAL, 'clinical.export'])

    expect(
      consultationPrintables(consultation({ status: 'IN_PROGRESS', current_revision: 0 })),
    ).toEqual([])
    expect(consultationPrintables(consultation({ status: 'DRAFT', current_revision: 0 }))).toEqual(
      [],
    )
  })

  it('examen terminé : la fiche demande clinical.export ; l’ordonnance et la lettre, clinical.read', () => {
    signIn(CLINICAL)
    expect(consultationPrintables(consultation()).map((item) => item.kind)).toEqual([
      'MEDICATION_ORDER',
      'REFERRAL_LETTER',
    ])

    signIn([...CLINICAL, 'clinical.export'])
    expect(consultationPrintables(consultation()).map((item) => [item.kind, item.label])).toEqual([
      ['CLINICAL_RECORD', 'Aperçu de la fiche de consultation'],
      ['MEDICATION_ORDER', 'Aperçu de l’ordonnance de médicaments'],
      ['REFERRAL_LETTER', 'Aperçu de la lettre d’orientation'],
    ])
  })

  it('sans médicaments ni orientation, seule la fiche est proposée', () => {
    signIn([...CLINICAL, 'clinical.export'])
    const plain = consultation()
    plain.steps = {
      ...plain.steps,
      MEDICATIONS: { orders: [] },
      CONCLUSION: { ...plain.steps.CONCLUSION, referral: false },
    }

    expect(consultationPrintables(plain).map((item) => item.kind)).toEqual(['CLINICAL_RECORD'])
  })

  it('un compte de caisse ne se voit proposer aucun document clinique', () => {
    signIn(CASHIER)

    expect(consultationPrintables(consultation())).toEqual([])
  })

  it('seule la dernière version VALIDÉE d’une prescription s’imprime', () => {
    const draft = prescription({
      id: '01J9ZXK4M2Q8R7S6T5V4W3002M',
      version_no: 2,
      status: 'DRAFT',
      validated_at: null,
      validated_by: null,
    })
    const validated = prescription()

    expect(printablePrescription([draft, validated])?.id).toBe(validated.id)
    expect(printablePrescription([draft])).toBeNull()
    expect(printablePrescription([])).toBeNull()
  })
})

describe('documents d’un examen : révision figée relue au moment de l’impression', () => {
  it('les droits sont vérifiés AVANT toute lecture du dossier', async () => {
    signIn(CASHIER)

    await expect(consultationDocument('MEDICATION_ORDER', consultation())).rejects.toBeInstanceOf(
      DocumentAccessError,
    )
    await expect(consultationDocument('CLINICAL_RECORD', consultation())).rejects.toBeInstanceOf(
      DocumentAccessError,
    )
    expect(state.reads).toEqual([])
  })

  it('un examen non terminé ne s’imprime pas, rien n’est lu', async () => {
    signIn(CLINICAL)

    await expect(
      consultationDocument(
        'MEDICATION_ORDER',
        consultation({ status: 'IN_PROGRESS', current_revision: 0 }),
      ),
    ).rejects.toBeInstanceOf(ClinicalPrintRefused)
    expect(state.reads).toEqual([])
  })

  it('l’ordonnance vient de la révision figée, pas de la saisie affichée ; l’original est conservé une fois', async () => {
    signIn(CLINICAL)

    const first = await consultationDocument('MEDICATION_ORDER', consultation())
    const again = await consultationDocument('MEDICATION_ORDER', consultation())
    const text = printedText(first.plan)

    expect(state.reads).toEqual(['revision:1', 'revision:1'])
    expect(first.model.kind).toBe('MEDICATION_ORDER')
    expect(first.model.templateVersion).toBe('medication_order.v1')
    // Le produit vient de la révision figée ; dans la colonne « Produit » (sept colonnes en A4), son nom
    // passe sur deux lignes : le contenu se lit sur la cellule, le texte imprimé en garde chaque partie.
    const products = first.model.body.find(
      (block): block is TableBlock =>
        block.kind === 'table' && block.caption === 'Produits prescrits',
    )
    expect(products?.rows.map((row) => row.cells[0])).toEqual(['Collyre fictif (démonstration)'])
    expect(text).toContain('Collyre fictif')
    expect(text).toContain('(démonstration)')
    expect(text).not.toContain('SAISIE AFFICHEE NON FIGEE')
    expect(text).toContain('DOCUMENT DE TEST')
    expect(first.fileName).toBe('ordonnance-20261014.pdf')
    expect(again.sha256).toBe(first.sha256)

    const kept = await documentStore().list({ documentType: 'MEDICATION_ORDER' })
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      sourceKey: `medication_order:${REVISION_ID}`,
      revisionNo: 1,
      entityId: REVISION_ID,
      templateVersion: 'medication_order.v1',
      state: 'ready',
      upload: 'not_uploaded',
    })
    expect(JSON.stringify(kept[0])).not.toMatch(/PATIENT|Collyre|lodie/)
  })

  it('une révision qui ne correspond pas à l’examen affiché est refusée', async () => {
    signIn(CLINICAL)
    state.revisions = new Map([
      [1, revisionDetail(1, { consultation_id: '01J9ZXK4M2Q8R7S6T5V4W3009Y' })],
    ])

    await expect(consultationDocument('REFERRAL_LETTER', consultation())).rejects.toBeInstanceOf(
      ClinicalPrintRefused,
    )
  })

  it('une lecture impossible n’imprime rien (aucune copie ancienne, aucune saisie en cours)', async () => {
    signIn(CLINICAL)
    state.failure = new Error('Serveur injoignable')

    await expect(consultationDocument('MEDICATION_ORDER', consultation())).rejects.toThrow(
      'Serveur injoignable',
    )
    expect(await documentStore().list()).toEqual([])
  })

  it('la lettre n’est produite que si la révision figée propose l’orientation', async () => {
    signIn(CLINICAL)

    // La saisie affichée dit « orientation oui », la révision figée dit « non » : la révision l’emporte.
    await expect(consultationDocument('REFERRAL_LETTER', consultation())).rejects.toBeInstanceOf(
      ClinicalPrintRefused,
    )
    expect(await documentStore().list({ documentType: 'REFERRAL_LETTER' })).toEqual([])
  })

  it('la fiche est un export daté : auteur, version, prescriptions validées ; elle n’est pas conservée comme original', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'))
    try {
      signIn([...CLINICAL, 'clinical.export'], 'Dr Exportateur Fictif')
      state.prescriptions = [
        prescription({ id: '01J9ZXK4M2Q8R7S6T5V4W3002M', version_no: 2, status: 'DRAFT' }),
        prescription(),
      ]

      const rendered = await consultationDocument('CLINICAL_RECORD', consultation())
      const text = printedText(rendered.plan)

      expect(state.reads).toEqual(['revision:1', 'prescriptions'])
      expect(rendered.model.templateVersion).toBe('clinical_record.v1')
      expect(text).toContain('Exporté par | Dr Exportateur Fictif')
      expect(text).toContain('Exporté le | 22/10/2026 à 10h00')
      expect(text).toContain('Auteur de la révision | Professionnel (démonstration)')
      expect(text).toContain('Prescription optique, version 1 (validée, 14/10/2026)')
      expect(text).not.toContain('version 2 (brouillon')
      expect(rendered.fileName).toBe('dossier-clinique-20261022.pdf')
      expect(await documentStore().list({ documentType: 'CLINICAL_RECORD' })).toEqual([])
      for (const word of FORBIDDEN_WORDS) expect(text).not.toMatch(word)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('prescription optique', () => {
  it('un brouillon ne s’imprime pas', async () => {
    signIn(CLINICAL)

    await expect(
      prescriptionDocument(
        prescription({ status: 'DRAFT', validated_at: null, validated_by: null }),
        consultation(),
      ),
    ).rejects.toBeInstanceOf(ClinicalPrintRefused)
    expect(await documentStore().list()).toEqual([])
  })

  it('sans clinical.read, refus avant tout rendu', async () => {
    signIn(CASHIER)

    await expect(prescriptionDocument(prescription(), consultation())).rejects.toBeInstanceOf(
      DocumentAccessError,
    )
  })

  it('validée par le compte connecté : son nom, la version du serveur, l’original sous la clé du serveur', async () => {
    signIn(CLINICAL, 'Dr Fictif')

    const rendered = await prescriptionDocument(prescription(), consultation())
    const text = printedText(rendered.plan)

    expect(state.reads).toEqual([])
    expect(rendered.model.templateVersion).toBe('optical_prescription.v1')
    expect(text).toContain('PRESCRIPTION OPTIQUE')
    expect(text).toContain('Prescripteur | Dr Fictif')
    expect(text).toContain('OD (œil droit) | -1,25 | -0,50 | 90° | —')
    expect(text).toContain('Absence de correction')
    expect(rendered.fileName).toBe('prescription-optique-20261014.pdf')
    const [kept] = await documentStore().list({ documentType: 'OPTICAL_PRESCRIPTION' })
    expect(kept).toMatchObject({
      sourceKey: 'optical_prescription:01J9ZXK4M2Q8R7S6T5V4W3002E',
      revisionNo: 1,
      documentId: '01J9ZXK4M2Q8R7S6T5V4W3002J',
      entityId: '01J9ZXK4M2Q8R7S6T5V4W3002E',
    })
  })

  it('validée par un autre professionnel : son nom figé dans une révision qu’il a enregistrée', async () => {
    signIn(CLINICAL, 'Gérante Fictive')
    state.revisions = new Map([
      [
        1,
        revisionDetail(1, { author: { user_id: COLLEAGUE, display_name: 'Dr Collègue Fictif' } }),
      ],
    ])
    const exam = consultation()
    exam.revisions = exam.revisions.map((item) => ({ ...item, author_id: COLLEAGUE }))

    const rendered = await prescriptionDocument(prescription({ validated_by: COLLEAGUE }), exam)

    expect(state.reads).toEqual(['revision:1'])
    expect(printedText(rendered.plan)).toContain('Prescripteur | Dr Collègue Fictif')
  })

  it('le nom du validateur lu par le serveur permet l’impression depuis un autre compte autorisé', async () => {
    signIn(CLINICAL)

    const rendered = await prescriptionDocument(
      prescription({ validated_by: STRANGER, validated_by_name: 'Dr Validateur Fictif' }),
      consultation(),
    )

    expect(state.reads).toEqual([])
    expect(printedText(rendered.plan)).toContain('Prescripteur | Dr Validateur Fictif')
  })

  it('un nom que rien ne fournit n’est jamais deviné : refus explicite', async () => {
    signIn(CLINICAL)

    await expect(
      prescriptionDocument(prescription({ validated_by: STRANGER }), consultation()),
    ).rejects.toThrow('imprimez-la depuis son compte')
  })

  it('réimpression après un changement d’identité : l’original conservé est rouvert, signalé', async () => {
    signIn(CLINICAL)
    const exam = consultation()
    const original = await prescriptionDocument(prescription(), exam)
    const renamed = { ...exam, patient: { ...exam.patient, last_name: 'NOUVEAU NOM FICTIF' } }

    const reprint = await prescriptionDocument(prescription(), renamed)

    expect(reprint.sha256).toBe(original.sha256)
    expect(reprint.warnings.some((warning) => warning.startsWith('Réimpression'))).toBe(true)
  })

  it('l’écran de lecture affiche les mêmes valeurs que le document (signe, zéro visible, tiret, unités)', () => {
    const model = prescriptionScreenModel(
      prescription({
        status: 'DRAFT',
        eyes: [
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3002G',
            eye: 'OD',
            no_correction: false,
            sphere: '1.25',
            cylinder: '0.00',
            axis: 0,
            addition: null,
            fitting_height: '22.00',
          },
          {
            id: '01J9ZXK4M2Q8R7S6T5V4W3002H',
            eye: 'OG',
            no_correction: true,
            sphere: null,
            cylinder: null,
            axis: null,
            addition: null,
            fitting_height: null,
          },
        ],
      }),
    )

    expect(model.status).toBe('DRAFT')
    expect(model.eyes[0]).toMatchObject({
      eye: 'OD',
      sphere: '+1,25',
      cylinder: '0,00',
      axis: '0°',
      addition: '—',
      fittingHeight: `22,00${NBSP}mm`,
    })
    expect(model.eyes[1]).toMatchObject({ eye: 'OG', noCorrection: true, sphere: '—' })
    expect(model.pd).toEqual({ total: `62,00${NBSP}mm`, od: '—', og: '—' })
    expect(model.usage).toBe('Lunettes permanentes')
    expect(model.lensType).toBe('Unifocal')
    expect(model.treatments).toEqual(['Anti-reflet'])
  })
})

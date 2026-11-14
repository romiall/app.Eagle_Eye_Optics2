import type { DocumentClinic } from '../data/clinic'
import { EMPTY_DOCUMENT_SETTINGS } from '../data/clinic'
import type {
  ClinicalPatient,
  ClinicalRecordData,
  MedicationOrderData,
  OpticalPrescriptionData,
  PrescriptionBody,
  ReferralLetterData,
} from '../data/clinical'
import type {
  AccountStatementData,
  CashSessionReportData,
  CreditNoteDocumentData,
  InvoiceDocumentData,
  InvoiceLineData,
  PatientIdentity,
  QuoteDocumentData,
  ReceiptDocumentData,
  RefundDocumentData,
} from '../data/financial'
import type { WorkshopOrderDocumentData } from '../data/workshop'
import { TEMPLATE_VERSION } from '../templates/registry'

/**
 * Données de DÉMONSTRATION des documents (D01, D02) : toutes FICTIVES et marquées. Elles servent à
 * l'écran d'aperçu, aux tests de modèle et au rendu « golden ». Aucune ne vient d'un patient réel ;
 * aucun nom, montant, numéro ni mention n'est celui du cabinet. Le cabinet de démonstration n'a ni
 * adresse, ni identifiant fiscal, ni logo : les emplacements sont signalés « à renseigner ».
 */
export const DEMO_TIME_ZONE = 'Africa/Douala'

// Identifiants ULID fictifs (alphabet de Crockford).
const ID = {
  clinic: '01J9ZXK4M2Q8R7S6T5V4W30069',
  patient: '01J9ZXK4M2Q8R7S6T5V4W30001',
  invoice: '01J9ZXK4M2Q8R7S6T5V4W30026',
  invoiceB: '01J9ZXK4M2Q8R7S6T5V4W30027',
  invoiceC: '01J9ZXK4M2Q8R7S6T5V4W30028',
  receipt1: '01J9ZXK4M2Q8R7S6T5V4W3002V',
  receipt2: '01J9ZXK4M2Q8R7S6T5V4W3002W',
  creditNote: '01J9ZXK4M2Q8R7S6T5V4W3002X',
  refund: '01J9ZXK4M2Q8R7S6T5V4W3002Y',
  approval: '01J9ZXK4M2Q8R7S6T5V4W3002Z',
  statement: '01J9ZXK4M2Q8R7S6T5V4W30030',
  session: '01J9ZXK4M2Q8R7S6T5V4W30031',
  quote: '01J9ZXK4M2Q8R7S6T5V4W30032',
  prescription: '01J9ZXK4M2Q8R7S6T5V4W30033',
  order: '01J9ZXK4M2Q8R7S6T5V4W30034',
  letter: '01J9ZXK4M2Q8R7S6T5V4W30035',
  record: '01J9ZXK4M2Q8R7S6T5V4W30036',
  consultation: '01J9ZXK4M2Q8R7S6T5V4W30037',
  workshopOrder: '01J9ZXK4M2Q8R7S6T5V4W30038',
} as const

export const DEMO_IDS = ID

export const DEMO_ISSUED_AT = '2026-10-14T09:30:00.000Z'
export const DEMO_SETTLED_AT = '2026-10-16T14:05:00.000Z'

export function demoClinic(overrides: Partial<DocumentClinic> = {}): DocumentClinic {
  return {
    name: 'CABINET DE DÉMONSTRATION — DONNÉES FICTIVES',
    address: null,
    phone: null,
    email: null,
    taxIdentifier: null,
    professionalMentions: null,
    settings: EMPTY_DOCUMENT_SETTINGS,
    currency: 'XAF',
    timezone: DEMO_TIME_ZONE,
    testDocument: true,
    logo: null,
    ...overrides,
  }
}

export function demoPatient(overrides: Partial<PatientIdentity> = {}): PatientIdentity {
  return {
    patientId: ID.patient,
    recordNumber: 'TEST-P-000001',
    lastName: 'PATIENT FICTIF',
    firstNames: 'Élodie Marie',
    ...overrides,
  }
}

export function demoClinicalPatient(overrides: Partial<ClinicalPatient> = {}): ClinicalPatient {
  return {
    recordNumber: 'TEST-P-000001',
    lastName: 'PATIENT FICTIF',
    firstNames: 'Élodie Marie',
    sex: 'Féminin',
    birthDate: '1990-05-17',
    ...overrides,
  }
}

function line(
  position: number,
  description: string,
  unitCode: string,
  quantity: string,
  unitPrice: number,
  discount: number,
  reference: string | null,
): InvoiceLineData {
  const quantityUnits = Number(quantity.replace('.', ''))
  const gross = Math.round((quantityUnits * unitPrice) / 1000)
  return {
    position,
    reference,
    description,
    unitCode,
    quantity,
    unitPriceGross: unitPrice,
    discountGross: discount,
    lineTotalGross: gross - discount,
    taxCode: 'NO_TAX_CONFIGURED',
    taxRatePercent: null,
    taxAmount: null,
  }
}

const TAX_NONE = { regime: 'NO_TAX_CONFIGURED', rules: [] } as const

/** Facture courte : 80 000 FCFA (exemple du fichier 03). */
export function demoInvoice(overrides: Partial<InvoiceDocumentData> = {}): InvoiceDocumentData {
  const lines = [
    line(1, 'Examen de vue (fictif)', 'SERVICE', '1.000', 15000, 0, 'EX-001'),
    line(2, 'Monture fictive modèle Alpha', 'UNIT', '1.000', 25000, 0, 'MT-001'),
    line(3, 'Verres progressifs 1.60 (fictifs)', 'PAIR', '1.000', 45000, 5000, 'VR-001'),
  ]
  return {
    templateVersion: TEMPLATE_VERSION,
    invoiceId: ID.invoice,
    number: 'TEST-FAC-000001',
    status: 'ISSUED',
    issuedAt: DEMO_ISSUED_AT,
    dueDate: null,
    clinic: demoClinic(),
    patient: demoPatient(),
    tax: TAX_NONE,
    lines,
    totalGross: 80000,
    issuedByName: 'Caisse (démonstration)',
    paymentAtIssue: null,
    ...overrides,
  }
}

/** Facture longue : plusieurs pages, désignations longues, nom de patient long. */
export function demoLongInvoice(lineCount = 48): InvoiceDocumentData {
  const lines: InvoiceLineData[] = []
  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(
      line(
        index,
        `Article fictif n° ${index} : désignation volontairement très longue pour vérifier le retour à la ligne dans la colonne de désignation, accents compris (é, è, ê, à, ç, œ)`,
        index % 3 === 0 ? 'PAIR' : 'UNIT',
        index % 4 === 0 ? '2.000' : '1.000',
        1000 * index + 250,
        index % 5 === 0 ? 500 : 0,
        `ART-${String(index).padStart(3, '0')}`,
      ),
    )
  }
  const totalGross = lines.reduce((total, current) => total + current.lineTotalGross, 0)
  return demoInvoice({
    invoiceId: ID.invoiceB,
    number: 'TEST-FAC-000002',
    lines,
    totalGross,
    patient: demoPatient({
      lastName: 'PATIENT FICTIF AUX NOMS COMPOSÉS TRÈS LONGS POUR VÉRIFIER LA PLACE DISPONIBLE',
      firstNames: 'Élodie Marie-Thérèse Anne-Sophie Joséphine',
    }),
  })
}

export function demoDraftInvoice(): InvoiceDocumentData {
  return demoInvoice({ number: null, status: 'DRAFT', issuedAt: null, issuedByName: null })
}

export function demoQuote(): QuoteDocumentData {
  const invoice = demoInvoice()
  return {
    templateVersion: TEMPLATE_VERSION,
    quoteId: ID.quote,
    number: null,
    revisionNo: null,
    issuedAt: null,
    revisedAt: null,
    revisionReason: null,
    validUntil: '2026-11-14',
    clinic: demoClinic(),
    recipient: { kind: 'PATIENT', patient: demoPatient() },
    tax: invoice.tax,
    lines: invoice.lines,
    totalGross: invoice.totalGross,
    createdByName: 'Caisse (démonstration)',
  }
}

function receipt(
  overrides: Partial<ReceiptDocumentData>,
  amount: number,
  before: number,
  method: ReceiptDocumentData['payment']['method'],
): ReceiptDocumentData {
  const after = before + amount
  const balance = 80000 - after
  return {
    templateVersion: TEMPLATE_VERSION,
    receiptId: ID.receipt1,
    receiptNumber: 'TEST-REC-000001',
    issuedAt: DEMO_ISSUED_AT,
    effectiveAt: DEMO_ISSUED_AT,
    invoice: { number: 'TEST-FAC-000001', issuedAt: DEMO_ISSUED_AT, totalGross: 80000 },
    patient: demoPatient(),
    payment: { amount, method, reference: method === 'CASH' ? null : 'REFERENCE_FICTIVE' },
    paidNetBefore: before,
    paidNetAfter: after,
    balanceAfter: balance,
    kind: balance === 0 ? 'BALANCE_SETTLEMENT' : 'DEPOSIT',
    cashierName: 'Caisse (démonstration)',
    clinic: demoClinic(),
    ...overrides,
  }
}

/** Reçu d'acompte : 30 000 FCFA sur 80 000, reste 50 000. */
export function demoReceiptDeposit(): ReceiptDocumentData {
  return receipt({}, 30000, 0, 'MTN_MOMO')
}

/** Reçu de règlement du solde : 50 000 FCFA, reste 0, émis deux jours après le versement saisi. */
export function demoReceiptSettlement(): ReceiptDocumentData {
  return receipt(
    {
      receiptId: ID.receipt2,
      receiptNumber: 'TEST-REC-000002',
      effectiveAt: '2026-10-16T13:58:00.000Z',
      issuedAt: DEMO_SETTLED_AT,
    },
    50000,
    30000,
    'CASH',
  )
}

export function demoCreditNote(): CreditNoteDocumentData {
  return {
    templateVersion: TEMPLATE_VERSION,
    creditNoteId: ID.creditNote,
    number: 'TEST-AV-000001',
    issuedAt: '2026-10-20T10:00:00.000Z',
    invoice: { number: 'TEST-FAC-000001', issuedAt: DEMO_ISSUED_AT, totalGross: 80000 },
    patient: demoPatient(),
    lines: [
      {
        description: 'Verres progressifs 1.60 (fictifs) : correction commerciale',
        quantity: null,
        amountGross: 10000,
        taxAmount: null,
      },
    ],
    amountGross: 10000,
    reason: 'Geste commercial de démonstration (motif fictif).',
    issuedByName: 'Gérante (démonstration)',
    approvalId: ID.approval,
    tax: TAX_NONE,
    clinic: demoClinic(),
  }
}

export function demoRefund(): RefundDocumentData {
  return {
    templateVersion: TEMPLATE_VERSION,
    refundId: ID.refund,
    number: 'TEST-RMB-000001',
    effectiveAt: '2026-10-20T10:30:00.000Z',
    creditNoteNumber: 'TEST-AV-000001',
    invoice: { number: 'TEST-FAC-000001', issuedAt: DEMO_ISSUED_AT, totalGross: 80000 },
    beneficiary: demoPatient(),
    amount: 10000,
    method: 'CASH',
    reference: null,
    createdByName: 'Gérante (démonstration)',
    clinic: demoClinic(),
  }
}

export function demoAccountStatement(): AccountStatementData {
  return {
    templateVersion: TEMPLATE_VERSION,
    statementId: ID.statement,
    asOf: '2026-10-22T08:15:00.000Z',
    clinic: demoClinic(),
    patient: demoPatient(),
    invoices: [
      {
        number: 'TEST-FAC-000001',
        issuedAt: DEMO_ISSUED_AT,
        origin: 'NATIVE',
        totalGross: 80000,
        credited: 0,
        paidNet: 30000,
        refunded: 0,
        balance: 50000,
      },
      {
        number: 'TEST-OUV-000001',
        issuedAt: '2026-09-01T08:00:00.000Z',
        origin: 'LEGACY_BALANCE',
        totalGross: 120000,
        credited: 0,
        paidNet: 0,
        refunded: 0,
        balance: 120000,
      },
      {
        number: 'TEST-FAC-000003',
        issuedAt: '2026-10-18T11:00:00.000Z',
        origin: 'NATIVE',
        totalGross: 40000,
        credited: 10000,
        paidNet: 40000,
        refunded: 0,
        balance: -10000,
      },
    ],
    payments: [
      {
        receiptNumber: 'TEST-REC-000001',
        effectiveAt: DEMO_ISSUED_AT,
        method: 'MTN_MOMO',
        amount: 30000,
        invoiceNumber: 'TEST-FAC-000001',
      },
      {
        receiptNumber: 'TEST-REC-000003',
        effectiveAt: '2026-10-18T11:05:00.000Z',
        method: 'CASH',
        amount: 40000,
        invoiceNumber: 'TEST-FAC-000003',
      },
    ],
    creditNotes: [
      {
        number: 'TEST-AV-000002',
        issuedAt: '2026-10-19T09:00:00.000Z',
        invoiceNumber: 'TEST-FAC-000003',
        amountGross: 10000,
      },
    ],
    refunds: [],
    preparedByName: 'Caisse (démonstration)',
  }
}

export function demoCashSession(closed = true): CashSessionReportData {
  return {
    templateVersion: TEMPLATE_VERSION,
    sessionId: ID.session,
    cashierName: 'Caisse (démonstration)',
    openedAt: '2026-10-20T07:30:00.000Z',
    closedAt: closed ? '2026-10-20T16:00:00.000Z' : null,
    openingAmount: 20000,
    cashReceived: 80000,
    cashRefunded: 10000,
    cashIn: 0,
    cashOut: 5000,
    expectedAmount: 85000,
    countedAmount: closed ? 84500 : null,
    variance: closed ? -500 : null,
    varianceReason: closed ? 'Erreur de rendu de monnaie (motif fictif).' : null,
    otherMethods: [{ method: 'MTN_MOMO', count: 1, amount: 30000 }],
    movements: [
      { at: '2026-10-20T12:00:00.000Z', label: 'Achat de fournitures (fictif)', amount: -5000 },
    ],
    receipts: [
      {
        receiptNumber: 'TEST-REC-000002',
        effectiveAt: '2026-10-20T08:10:00.000Z',
        method: 'CASH',
        amount: 80000,
        invoiceNumber: 'TEST-FAC-000001',
      },
    ],
    clinic: demoClinic(),
  }
}

// --- Documents cliniques ---------------------------------------------------------------------------

export function demoPrescriptionBody(): PrescriptionBody {
  return {
    eyes: [
      {
        eye: 'OD',
        noCorrection: false,
        sphere: '-1.25',
        cylinder: '-0.50',
        axis: 90,
        addition: '2.00',
        fittingHeight: '22.00',
      },
      {
        eye: 'OG',
        noCorrection: false,
        sphere: '0.75',
        cylinder: '0.00',
        axis: null,
        addition: '2.00',
        fittingHeight: '22.00',
      },
    ],
    pdTotal: '63.00',
    pdOd: '31.50',
    pdOg: '31.50',
    pdInconsistencyReason: null,
    usage: 'Progressifs',
    lensType: 'Progressif',
    lensIndex: '1.60',
    treatments: ['Anti-reflet', 'Durci / anti-rayures'],
    notes: 'Observation fictive saisie par le professionnel de démonstration.',
  }
}

export function demoPrescription(
  overrides: Partial<OpticalPrescriptionData> = {},
): OpticalPrescriptionData {
  return {
    templateVersion: TEMPLATE_VERSION,
    prescriptionId: ID.prescription,
    versionNo: 1,
    status: 'VALIDATED',
    origin: 'INTERNAL',
    consultationAt: '2026-10-14T08:40:00.000Z',
    validatedAt: '2026-10-14T09:10:00.000Z',
    clinic: demoClinic(),
    patient: demoClinicalPatient(),
    professional: { displayName: 'Professionnel (démonstration)', professionalNumber: null },
    externalPrescriber: null,
    externalPrescribedOn: null,
    body: demoPrescriptionBody(),
    ...overrides,
  }
}

/** Prescription dont un œil n'est pas corrigé et dont l'addition n'est pas mesurée. */
export function demoPrescriptionNoCorrection(): OpticalPrescriptionData {
  const body = demoPrescriptionBody()
  return demoPrescription({
    versionNo: 2,
    body: {
      ...body,
      eyes: [
        { ...body.eyes[0], addition: null },
        {
          eye: 'OG',
          noCorrection: true,
          sphere: null,
          cylinder: null,
          axis: null,
          addition: null,
          fittingHeight: null,
        },
      ],
      pdTotal: null,
      pdOg: null,
    },
  })
}

export function demoMedicationOrder(): MedicationOrderData {
  return {
    templateVersion: TEMPLATE_VERSION,
    orderId: ID.order,
    status: 'VALIDATED',
    orderedAt: '2026-10-14T09:15:00.000Z',
    clinic: demoClinic(),
    patient: demoClinicalPatient(),
    professional: { displayName: 'Professionnel (démonstration)', professionalNumber: null },
    items: [
      {
        name: 'Produit fictif A (démonstration)',
        form: 'Collyre',
        strength: 'dosage fictif',
        posology: 'posologie saisie (exemple fictif)',
        frequency: 'fréquence saisie (exemple fictif)',
        duration: null,
        instructions: null,
      },
      {
        name: 'Produit fictif B (démonstration)',
        form: null,
        strength: null,
        posology: null,
        frequency: null,
        duration: null,
        instructions: 'instruction saisie (exemple fictif)',
      },
    ],
    notes: null,
  }
}

export function demoReferralLetter(): ReferralLetterData {
  return {
    templateVersion: TEMPLATE_VERSION,
    letterId: ID.letter,
    status: 'VALIDATED',
    letterAt: '2026-10-14T09:20:00.000Z',
    clinic: demoClinic(),
    patient: demoClinicalPatient(),
    professional: { displayName: 'Professionnel (démonstration)', professionalNumber: null },
    addressee: null,
    urgency: 'Consultation recommandée',
    reasons: ['Autre'],
    summary: 'Résumé clinique fictif rédigé par le professionnel de démonstration.',
    measurements: ['OD : sphère -1,25 ; OG : sphère +0,75 (exemple fictif)'],
  }
}

export function demoClinicalRecord(): ClinicalRecordData {
  return {
    templateVersion: TEMPLATE_VERSION,
    recordId: ID.record,
    selection: 'SINGLE',
    exportedAt: '2026-10-22T09:00:00.000Z',
    exportedByName: 'Professionnel (démonstration)',
    clinic: demoClinic(),
    patient: demoClinicalPatient(),
    consultations: [
      {
        consultationId: ID.consultation,
        revisionNo: 1,
        status: 'COMPLETED',
        effectiveAt: '2026-10-14T08:40:00.000Z',
        clinicianName: 'Professionnel (démonstration)',
        complaints: ['Vision floue', 'Fatigue visuelle'],
        symptoms: 'Texte fictif saisi pour la démonstration.',
        wearsGlasses: true,
        glassesDuration: 'depuis 2 ans (fictif)',
        previousCorrectionAvailable: false,
        histories: [
          { group: 'Antécédents oculaires', knownNone: true, terms: [], comments: null },
          { group: 'Antécédents médicaux', knownNone: false, terms: ['Diabète'], comments: null },
          { group: 'Antécédents familiaux oculaires', knownNone: false, terms: [], comments: null },
        ],
        acuities: [
          {
            context: 'Préliminaire',
            distance: 'De loin',
            correction: 'Sans correction',
            od: '5/10',
            og: '6/10',
            ou: '7/10',
            scale: 'échelle fictive',
          },
          {
            context: 'Après réfraction',
            distance: 'Non précisée',
            correction: 'Avec correction',
            od: '10/10',
            og: '10/10',
            ou: '10/10',
            scale: 'échelle fictive',
          },
        ],
        refraction: [
          {
            stage: 'Subjective',
            eye: 'OD',
            sphere: '-1.25',
            cylinder: '-0.50',
            axis: 90,
            addition: '2.00',
          },
          {
            stage: 'Subjective',
            eye: 'OG',
            sphere: '0.75',
            cylinder: '0.00',
            axis: null,
            addition: '2.00',
          },
        ],
        refractionObservations: null,
        ametropias: ['Myopie', 'Presbytie'],
        pdTotal: '63.00',
        pdOd: '31.50',
        pdOg: '31.50',
        pdInconsistencyReason: null,
        medications: [
          {
            name: 'Produit fictif A (démonstration)',
            form: 'Collyre',
            strength: null,
            posology: 'posologie saisie (exemple fictif)',
            frequency: null,
            duration: null,
            instructions: null,
          },
        ],
        conclusion: 'Conclusion fictive saisie par le professionnel de démonstration.',
        referral: false,
        referralUrgency: null,
        referralReasons: [],
        missingDataReason: null,
        amendmentReason: null,
      },
    ],
    prescriptions: [
      {
        versionNo: 1,
        status: 'VALIDATED',
        at: '2026-10-14T09:10:00.000Z',
        body: demoPrescriptionBody(),
      },
    ],
  }
}

export function demoWorkshopOrder(): WorkshopOrderDocumentData {
  return {
    templateVersion: TEMPLATE_VERSION,
    workshopOrderId: ID.workshopOrder,
    reference: 'TEST-ATL-2026-000001',
    labReference: 'LAB-DEMO-01',
    orderedAt: '2026-10-14T10:15:00.000Z',
    expectedAt: '2026-10-19T16:00:00.000Z',
    quantity: '1.000',
    notes: 'Montage démonstration (aucune donnée réelle).',
    clinic: demoClinic(),
    patientRecordNumber: 'TEST-P-000001',
    supplier: {
      name: 'Laboratoire Optique de Démonstration',
      reference: 'LAB-DEMO',
      phone: null,
      email: null,
    },
    frame: {
      reference: 'TEST-MON-001',
      name: 'Monture Demo Cerclée',
      brand: 'Marque Demo',
      model: 'Modèle Demo',
    },
    invoiceLine: {
      invoiceNumber: 'TEST-FAC-2026-000001',
      description: 'Verres progressifs + montage (démonstration)',
    },
    prescription: {
      versionNo: 1,
      origin: 'INTERNAL',
      validatedAt: '2026-10-14T09:10:00.000Z',
      externalPrescriber: null,
      externalPrescribedOn: null,
      usageLabel: 'Progressifs',
      lensTypeLabel: 'Progressif',
      lensIndexLabel: '1.60',
      pdTotal: '63.00',
      pdOd: '31.50',
      pdOg: '31.50',
      pdInconsistencyReason: null,
      notes: 'Note optique de démonstration.',
      treatments: ['Anti-reflet', 'Durci / anti-rayures'],
      eyes: [
        {
          eye: 'OD',
          sphere: '-1.25',
          cylinder: '-0.50',
          axis: 90,
          addition: '2.00',
          pd: '31.50',
          fittingHeight: '18.50',
          lensType: 'Progressif',
          lensIndex: '1.60',
          treatments: ['Anti-reflet', 'Durci / anti-rayures'],
          frameReferenceSnapshot: 'TEST-MON-001 — Marque Demo Monture Demo Cerclée',
        },
        {
          eye: 'OG',
          sphere: '0.75',
          cylinder: '0.00',
          axis: null,
          addition: '2.00',
          pd: '31.50',
          fittingHeight: '18.50',
          lensType: 'Progressif',
          lensIndex: '1.60',
          treatments: ['Anti-reflet', 'Durci / anti-rayures'],
          frameReferenceSnapshot: 'TEST-MON-001 — Marque Demo Monture Demo Cerclée',
        },
      ],
    },
    createdByName: 'Professionnel (démonstration)',
  }
}

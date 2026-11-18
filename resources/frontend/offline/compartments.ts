/**
 * Compartiments du coffre (vault.md D16 à D18), recopiés de `contracts/compartments.json` (contrat partagé avec le
 * serveur, `App\Offline\Compartments`) ; `tests/frontend/offline/compartments.test.ts` relit le JSON et exige
 * l'égalité exacte. Une entité, un document ou une commande appartient à UN compartiment ; un profil n'ouvre que les
 * compartiments dont il détient une enveloppe ET que son grant signé lui accorde.
 */
export const COMPARTMENTS = ['ADMINISTRATIVE', 'CLINICAL', 'FINANCIAL', 'MANAGER'] as const
export type Compartment = (typeof COMPARTMENTS)[number]

export function isCompartment(value: unknown): value is Compartment {
  return typeof value === 'string' && (COMPARTMENTS as readonly string[]).includes(value)
}

/** Classe de chaque permission du référentiel (null : aucun compartiment, traitements du serveur). */
export const PERMISSION_COMPARTMENTS: Readonly<Record<string, Compartment | null>> = Object.freeze({
  'patient.read': 'ADMINISTRATIVE',
  'patient.create': 'ADMINISTRATIVE',
  'patient.update': 'ADMINISTRATIVE',
  'patient.merge': 'ADMINISTRATIVE',
  'visit.register': 'ADMINISTRATIVE',
  'agenda.read': 'ADMINISTRATIVE',
  'agenda.write': 'ADMINISTRATIVE',
  'follow_up.write': 'ADMINISTRATIVE',
  'catalog.read': 'ADMINISTRATIVE',
  'stock.read': 'ADMINISTRATIVE',
  'approval.request': 'ADMINISTRATIVE',
  'statistics.activity': 'ADMINISTRATIVE',
  'exam_fee.collect': 'ADMINISTRATIVE',
  'clinical.read': 'CLINICAL',
  'clinical.write': 'CLINICAL',
  'clinical.complete': 'CLINICAL',
  'clinical.amend': 'CLINICAL',
  'clinical.export': 'CLINICAL',
  'statistics.clinical': 'CLINICAL',
  'invoice.read': 'FINANCIAL',
  'invoice.create': 'FINANCIAL',
  'invoice.issue': 'FINANCIAL',
  'payment.collect': 'FINANCIAL',
  'payment.reverse': 'FINANCIAL',
  'credit_note.issue': 'FINANCIAL',
  'refund.execute': 'FINANCIAL',
  'delivery.confirm': 'FINANCIAL',
  'cash.own_session': 'FINANCIAL',
  'cash.manage': 'FINANCIAL',
  'approval.decide': 'MANAGER',
  'finance.global.read': 'MANAGER',
  'finance.reconcile': 'MANAGER',
  'catalog.manage': 'MANAGER',
  'catalog.purchase_cost.read': 'MANAGER',
  'stock.receive': 'MANAGER',
  'stock.adjust': 'MANAGER',
  'stock.inventory': 'MANAGER',
  'stock.valuation.read': 'MANAGER',
  'users.manage': 'MANAGER',
  'audit.read': 'MANAGER',
  'export.global': 'MANAGER',
  'backup.manage': 'MANAGER',
  'offline.enroll': 'MANAGER',
  'workshop.manage': null,
  'communication.manage': null,
  'conversation.takeover': null,
  'knowledge.manage': null,
  'site.publish': null,
  'integration.manage': null,
})

/** Compartiment de chaque commande du journal d'un poste (scellée entière dans un seul compartiment). */
export const COMMAND_COMPARTMENTS: Readonly<Record<string, Compartment>> = Object.freeze({
  CreatePatient: 'ADMINISTRATIVE',
  UpdatePatient: 'ADMINISTRATIVE',
  RegisterVisit: 'ADMINISTRATIVE',
  CreateAppointment: 'ADMINISTRATIVE',
  RecordContactAttempt: 'ADMINISTRATIVE',
  RequestApproval: 'ADMINISTRATIVE',
  DecideApproval: 'ADMINISTRATIVE',
  StartConsultation: 'CLINICAL',
  SaveClinicalStep: 'CLINICAL',
  CompleteConsultation: 'CLINICAL',
  AmendConsultation: 'CLINICAL',
  CreatePrescription: 'CLINICAL',
  ValidatePrescription: 'CLINICAL',
  CreateFollowUp: 'CLINICAL',
  CreateInvoiceDraft: 'FINANCIAL',
  UpdateDraft: 'FINANCIAL',
  IssueInvoice: 'FINANCIAL',
  RegisterPayment: 'FINANCIAL',
  ReversePayment: 'FINANCIAL',
  IssueCreditNote: 'FINANCIAL',
  RefundCredit: 'FINANCIAL',
  OpenCashSession: 'FINANCIAL',
  CloseCashSession: 'FINANCIAL',
  RecordCashMovement: 'FINANCIAL',
  ConfirmDelivery: 'FINANCIAL',
  RegisterPhysicalReturn: 'FINANCIAL',
  RegisterStockMovement: 'MANAGER',
})

/** Compartiments ouverts par des permissions, dans l'ordre du contrat. */
export function compartmentsOf(permissions: readonly string[]): Compartment[] {
  const found = new Set<Compartment>()
  for (const permission of permissions) {
    const compartment = PERMISSION_COMPARTMENTS[permission]
    if (compartment !== undefined && compartment !== null) found.add(compartment)
  }
  return COMPARTMENTS.filter((compartment) => found.has(compartment))
}

/**
 * Types d'entités scellées dans le coffre et leur compartiment (D18) : un type absent est refusé AVANT tout
 * chiffrement (`ENTITY_TYPE_UNREGISTERED`), un couple type / compartiment incohérent aussi (`COMPARTMENT_MISMATCH`).
 * O04 et O05 compléteront ce registre avec leurs projections.
 */
export const ENTITY_COMPARTMENTS: Readonly<Record<string, Compartment>> = Object.freeze({
  patient: 'ADMINISTRATIVE',
  visit: 'ADMINISTRATIVE',
  catalog_snapshot: 'ADMINISTRATIVE',
  consultation: 'CLINICAL',
  prescription: 'CLINICAL',
  invoice: 'FINANCIAL',
  payment: 'FINANCIAL',
  receipt: 'FINANCIAL',
  cash_session: 'FINANCIAL',
  cash_movement: 'FINANCIAL',
  expense_categories_snapshot: 'FINANCIAL',
  current_cash_session: 'FINANCIAL',
  stock_quota: 'MANAGER',
  // O04 : projections locales des autres agrégats du journal (compartiment = celui de la commande qui les écrit) …
  appointment: 'ADMINISTRATIVE',
  contact_task: 'ADMINISTRATIVE',
  approval: 'ADMINISTRATIVE',
  follow_up: 'CLINICAL',
  delivery: 'FINANCIAL',
  physical_return: 'FINANCIAL',
  stock_movement: 'MANAGER',
  // … et faits immuables d'une commande locale, un type par compartiment.
  local_fact_administrative: 'ADMINISTRATIVE',
  local_fact_clinical: 'CLINICAL',
  local_fact_financial: 'FINANCIAL',
  local_fact_manager: 'MANAGER',
  // O05 : projections du serveur reçues par le pull, scellées dans le compartiment de leur visibilité (PUBLIC → administratif).
  pulled_administrative: 'ADMINISTRATIVE',
  pulled_clinical: 'CLINICAL',
  pulled_financial: 'FINANCIAL',
  pulled_manager: 'MANAGER',
})

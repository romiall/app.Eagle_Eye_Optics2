import type { ProfileCode } from './model'

/**
 * Les quatre profils du cabinet et les droits que chacun reçoit par défaut. Copie du semis
 * `role_permissions` de `database/02_reference_data.sql` : un test compare les deux, car la
 * documentation « voir l'aide comme… » montre ce que ces profils voient réellement. Un compte peut
 * porter plusieurs profils et des dérogations nominatives ; l'aide ne décrit que les profils.
 */
export interface ProfileInfo {
  readonly code: ProfileCode
  /** Nom court affiché dans l'aide. */
  readonly label: string
  /** Une phrase : qui est ce profil au cabinet. */
  readonly role: string
  readonly permissions: readonly string[]
}

const RECEPTION_PERMISSIONS = [
  'patient.read',
  'patient.create',
  'patient.update',
  'visit.register',
  'agenda.read',
  'agenda.write',
  'statistics.activity',
  'approval.request',
] as const

const CLINICIAN_PERMISSIONS = [
  'patient.read',
  'visit.register',
  'clinical.read',
  'clinical.write',
  'clinical.complete',
  'clinical.amend',
  'clinical.export',
  'agenda.read',
  'agenda.write',
  'follow_up.write',
  'catalog.read',
  'stock.read',
  'statistics.clinical',
  'approval.request',
] as const

const CASHIER_PERMISSIONS = [
  'patient.read',
  'agenda.read',
  'catalog.read',
  'invoice.read',
  'invoice.create',
  'invoice.issue',
  'payment.collect',
  'delivery.confirm',
  'stock.read',
  'cash.own_session',
  'approval.request',
] as const

const MANAGER_PERMISSIONS = [
  'patient.read',
  'patient.create',
  'patient.update',
  'patient.merge',
  'visit.register',
  'exam_fee.collect',
  'clinical.read',
  'clinical.write',
  'clinical.complete',
  'clinical.amend',
  'clinical.export',
  'agenda.read',
  'agenda.write',
  'follow_up.write',
  'catalog.read',
  'catalog.manage',
  'catalog.purchase_cost.read',
  'invoice.read',
  'invoice.create',
  'invoice.issue',
  'payment.collect',
  'payment.reverse',
  'credit_note.issue',
  'refund.execute',
  'delivery.confirm',
  'approval.request',
  'approval.decide',
  'stock.read',
  'stock.receive',
  'stock.adjust',
  'stock.inventory',
  'stock.valuation.read',
  'cash.own_session',
  'cash.manage',
  'finance.global.read',
  'finance.reconcile',
  'statistics.activity',
  'statistics.clinical',
  'workshop.manage',
  'communication.manage',
  'conversation.takeover',
  'knowledge.manage',
  'site.publish',
  'integration.manage',
  'users.manage',
  'audit.read',
  'export.global',
  'backup.manage',
  'offline.enroll',
] as const

export const PROFILES: readonly ProfileInfo[] = [
  {
    code: 'MANAGER',
    label: 'Gérante',
    role: 'Dirige le cabinet : accès métier total, autorisations, paramètres, caisse et statistiques.',
    permissions: MANAGER_PERMISSIONS,
  },
  {
    code: 'RECEPTION',
    label: 'Accueil',
    role: 'Accueille les patients : identité, arrivées et agenda.',
    permissions: RECEPTION_PERMISSIONS,
  },
  {
    code: 'CLINICIAN',
    label: 'Professionnel',
    role: 'Réalise l’examen de vue, saisit le dossier médical et les prescriptions.',
    permissions: CLINICIAN_PERMISSIONS,
  },
  {
    code: 'CASHIER',
    label: 'Caissière',
    role: 'Vend : factures, encaissements, remises d’articles et session de caisse.',
    permissions: CASHIER_PERMISSIONS,
  },
]

/** Modules que l'application connaît (`app/Support/Modules.php`), pour « inclure les modules fermés ». */
export const KNOWN_MODULES: readonly string[] = [
  'today',
  'patients',
  'consultations',
  'agenda',
  'sales',
  'stock',
  'reports',
  'settings',
  'offline',
]

export function profileByCode(code: ProfileCode): ProfileInfo {
  const found = PROFILES.find((profile) => profile.code === code)
  if (found === undefined) throw new Error(`Profil inconnu : ${code}`)
  return found
}

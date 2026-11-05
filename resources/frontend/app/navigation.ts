import { inject, type InjectionKey } from 'vue'

/**
 * Entrées de navigation (fichier 04) : chacune déclare ses permissions (l'une suffit, codes du
 * référentiel seedé) et la tâche du backlog qui livre son écran. Une entrée n'apparaît que si elle
 * est LIVRÉE et autorisée : L0 n'affiche jamais un écran futur vide comme si sa fonction existait.
 * Livrer un écran, c'est passer `delivered` à true dans la même modification que son écran, sa
 * route et ses tests. Les chemins des entrées non livrées sont indicatifs : la tâche qui livre
 * l'écran fixe le sien.
 */
export interface NavigationEntry {
  id: string
  label: string
  path: string
  /** Codes `permissions` : l'un d'eux suffit (le serveur revérifie chaque action). */
  permissions: readonly string[]
  /** Tâche du backlog qui livre l'écran. */
  deliveredBy: string
  delivered: boolean
  /**
   * Module de mise en service progressive dont l'entrée dépend (code de `EEO_ENABLED_MODULES`) ;
   * à défaut, l'identifiant de l'entrée (un module de la navigation est son propre code).
   */
  module?: string
}

/** Code du module qui doit être ouvert pour que l'entrée apparaisse. */
export function moduleOf(entry: NavigationEntry): string {
  return entry.module ?? entry.id
}

/** Module de la navigation principale, dans l'ordre du fichier 04. */
export interface AppModule extends NavigationEntry {
  /** Raccourci de la barre du téléphone (Aujourd'hui, Patients, Agenda ; le reste sous « Plus »). */
  mobileShortcut: boolean
}

/** Action d'accueil du modèle de dossier patient (fichier 04, « Actions d'accueil DP »). */
export type HomeAction = NavigationEntry

export const APP_MODULES: readonly AppModule[] = [
  {
    id: 'today',
    label: 'Aujourd’hui',
    path: '/aujourdhui',
    // Comme la route de la file du serveur : l'une OU l'autre suffit (aucune donnée clinique).
    permissions: ['visit.register', 'agenda.read'],
    deliveredBy: 'P03',
    delivered: true,
    mobileShortcut: true,
  },
  {
    id: 'patients',
    label: 'Patients',
    path: '/patients',
    permissions: ['patient.read'],
    deliveredBy: 'P02',
    delivered: true,
    mobileShortcut: true,
  },
  {
    id: 'consultations',
    label: 'Consultations',
    path: '/consultations',
    permissions: ['clinical.read'],
    // Liste des examens du cabinet (C01 à C04, en ligne) : le dossier s'ouvre sur la consultation.
    deliveredBy: 'C01',
    delivered: true,
    mobileShortcut: false,
  },
  {
    id: 'agenda',
    label: 'Agenda',
    path: '/agenda',
    permissions: ['agenda.read'],
    // Agenda interne (S01, en ligne) : vues jour et semaine, prise de rendez-vous, patients à rappeler (S02).
    deliveredBy: 'S01',
    delivered: true,
    mobileShortcut: true,
  },
  {
    id: 'sales',
    label: 'Ventes et caisse',
    path: '/ventes',
    permissions: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
    // Caisse, brouillon, émission, encaissement, catalogue (B01 à B05), en ligne ; le stock (I01) reste à livrer.
    deliveredBy: 'B02',
    delivered: true,
    mobileShortcut: false,
  },
  {
    id: 'stock',
    label: 'Stock',
    path: '/stock',
    permissions: ['stock.read'],
    deliveredBy: 'I01',
    delivered: false,
    mobileShortcut: false,
  },
  {
    id: 'workshop',
    label: 'Atelier',
    path: '/atelier',
    permissions: ['workshop.manage'],
    deliveredBy: 'L1D04',
    delivered: false,
    mobileShortcut: false,
  },
  {
    id: 'communication',
    label: 'Communication',
    path: '/communication',
    permissions: ['communication.manage'],
    deliveredBy: 'L2D06',
    delivered: false,
    mobileShortcut: false,
  },
  {
    id: 'reports',
    label: 'Rapports',
    path: '/rapports',
    permissions: ['finance.global.read', 'statistics.activity', 'statistics.clinical'],
    deliveredBy: 'R01',
    delivered: false,
    mobileShortcut: false,
  },
  {
    id: 'settings',
    label: 'Paramètres',
    path: '/parametres',
    permissions: ['users.manage', 'approval.decide'],
    // Comptes du personnel et identité du cabinet (écrans F09 des routes F05) ; les autorisations (B06)
    // s'y ajoutent quand leur écran existe.
    deliveredBy: 'F09',
    delivered: true,
    mobileShortcut: false,
  },
  {
    // Préparation des postes pour le hors-ligne (O01, O02) : sans entrée de menu ; l'écran s'ouvre depuis les
    // Paramètres quand l'exploitant a ouvert le module « offline ». Le travail sans Internet viendra avec O03 à O05.
    id: 'offline',
    label: 'Postes hors-ligne',
    path: '/parametres/poste',
    permissions: ['offline.enroll'],
    deliveredBy: 'O05',
    delivered: false,
    mobileShortcut: false,
  },
]

export const HOME_ACTIONS: readonly HomeAction[] = [
  {
    id: 'new-patient',
    label: 'Nouveau patient',
    path: '/patients/nouveau',
    permissions: ['patient.create'],
    deliveredBy: 'P01',
    delivered: true,
    module: 'patients',
  },
  {
    id: 'new-consultation',
    label: 'Nouvelle consultation',
    // Mène à l'écran des examens avec la boîte « Nouvelle consultation » ouverte (préréglage par l'adresse).
    path: '/consultations?nouvelle=1',
    permissions: ['clinical.write'],
    deliveredBy: 'C01',
    delivered: true,
    module: 'consultations',
  },
  {
    id: 'search',
    label: 'Rechercher',
    path: '/patients',
    permissions: ['patient.read'],
    deliveredBy: 'P02',
    delivered: true,
    module: 'patients',
  },
  {
    id: 'appointment',
    label: 'Rendez-vous',
    path: '/agenda/nouveau',
    permissions: ['agenda.write'],
    deliveredBy: 'S01',
    delivered: true,
    module: 'agenda',
  },
  {
    id: 'consultations-today',
    label: 'Consultations du jour',
    path: '/aujourdhui',
    permissions: ['visit.register', 'agenda.read'],
    deliveredBy: 'P03',
    delivered: true,
    module: 'today',
  },
  {
    id: 'statistics',
    label: 'Statistiques',
    path: '/rapports/statistiques',
    permissions: ['statistics.activity', 'statistics.clinical'],
    deliveredBy: 'R02',
    delivered: true,
    module: 'reports',
  },
  {
    id: 'settings',
    label: 'Paramètres',
    path: '/parametres',
    permissions: ['users.manage', 'approval.decide'],
    deliveredBy: 'F09',
    delivered: true,
    module: 'settings',
  },
]

/**
 * Entrées à présenter à un compte : livrées dans le code, autorisées par ses droits ET ouvertes par
 * l'exploitant (`enabledModules`), dans l'ordre déclaré. Sans liste de modules ouverts, aucune entrée
 * n'apparaît : un module terminé reste caché tant qu'il n'est pas activé.
 */
export function visibleEntries<T extends NavigationEntry>(
  permissions: readonly string[],
  entries: readonly T[],
  enabledModules: readonly string[],
): T[] {
  return entries.filter(
    (entry) =>
      entry.delivered &&
      enabledModules.includes(moduleOf(entry)) &&
      entry.permissions.some((permission) => permissions.includes(permission)),
  )
}

export function visibleModules(
  permissions: readonly string[],
  enabledModules: readonly string[],
  modules: readonly AppModule[] = APP_MODULES,
): AppModule[] {
  return visibleEntries(permissions, modules, enabledModules)
}

export function visibleHomeActions(
  permissions: readonly string[],
  enabledModules: readonly string[],
  actions: readonly HomeAction[] = HOME_ACTIONS,
): HomeAction[] {
  return visibleEntries(permissions, actions, enabledModules)
}

/**
 * Activité d'un raccourci de travail : l'accueil les regroupe par profil de travail (accueil des patients,
 * examens, caisse, administration) sans jamais nommer un profil : seuls les droits et les modules ouverts
 * décident de ce qui apparaît, comme pour le menu.
 */
export type WorkGroup = 'reception' | 'exams' | 'cash' | 'administration'

export const WORK_GROUP_LABELS: Readonly<Record<WorkGroup, string>> = {
  reception: 'Accueil des patients',
  exams: 'Examens',
  cash: 'Caisse et ventes',
  administration: 'Administration',
}

/** Raccourci de travail de l'accueil (en plus des actions d'accueil du dossier patient, fichier 04). */
export interface WorkShortcut extends NavigationEntry {
  group: WorkGroup
}

export const WORK_SHORTCUTS: readonly WorkShortcut[] = [
  {
    id: 'contact-tasks',
    label: 'Patients à rappeler',
    path: '/suivis',
    permissions: ['agenda.read'],
    deliveredBy: 'S02',
    delivered: true,
    module: 'agenda',
    group: 'reception',
  },
  {
    id: 'arrival',
    label: 'Enregistrer une arrivée',
    path: '/aujourdhui/arrivee',
    permissions: ['visit.register'],
    deliveredBy: 'P03',
    delivered: true,
    module: 'today',
    group: 'reception',
  },
  {
    id: 'start-exam',
    // Même libellé que l'action d'accueil « Nouvelle consultation » : même geste, retrouvé avec les autres examens.
    label: 'Nouvelle consultation',
    path: '/consultations?nouvelle=1',
    permissions: ['clinical.write'],
    deliveredBy: 'C01',
    delivered: true,
    module: 'consultations',
    group: 'exams',
  },
  {
    id: 'exams-in-progress',
    label: 'Mes examens en cours',
    path: '/consultations?jour=tous&etat=IN_PROGRESS&mes=1',
    permissions: ['clinical.write'],
    deliveredBy: 'C01',
    delivered: true,
    module: 'consultations',
    group: 'exams',
  },
  {
    id: 'exams-today',
    label: 'Examens du jour',
    path: '/consultations',
    permissions: ['clinical.read'],
    deliveredBy: 'C01',
    delivered: true,
    module: 'consultations',
    group: 'exams',
  },
  {
    id: 'cash-session',
    label: 'Caisse',
    path: '/ventes/caisse',
    permissions: ['cash.own_session'],
    deliveredBy: 'B05',
    delivered: true,
    module: 'sales',
    group: 'cash',
  },
  {
    id: 'new-invoice',
    label: 'Nouvelle facture',
    path: '/ventes/factures/nouvelle',
    permissions: ['invoice.create', 'exam_fee.collect'],
    deliveredBy: 'B02',
    delivered: true,
    module: 'sales',
    group: 'cash',
  },
  {
    id: 'invoices',
    label: 'Factures',
    path: '/ventes/factures',
    permissions: ['invoice.read'],
    deliveredBy: 'B02',
    delivered: true,
    module: 'sales',
    group: 'cash',
  },
  {
    id: 'staff',
    label: 'Personnel',
    path: '/parametres/personnel',
    permissions: ['users.manage'],
    deliveredBy: 'F09',
    delivered: true,
    module: 'settings',
    group: 'administration',
  },
  {
    id: 'clinic-settings',
    label: 'Cabinet et documents',
    path: '/parametres/cabinet',
    permissions: ['users.manage'],
    deliveredBy: 'F09',
    delivered: true,
    module: 'settings',
    group: 'administration',
  },
  {
    id: 'catalog',
    label: 'Catalogue',
    path: '/ventes/catalogue',
    permissions: ['catalog.manage'],
    deliveredBy: 'B01',
    delivered: true,
    module: 'sales',
    group: 'administration',
  },
]

export function visibleWorkShortcuts(
  permissions: readonly string[],
  enabledModules: readonly string[],
  shortcuts: readonly WorkShortcut[] = WORK_SHORTCUTS,
): WorkShortcut[] {
  return visibleEntries(permissions, shortcuts, enabledModules)
}

/** Catalogue de navigation de l'application ; les tests en injectent un autre (écrans fictifs). */
export interface NavigationCatalog {
  modules: readonly AppModule[]
  homeActions: readonly HomeAction[]
  /** Raccourcis de travail de l'accueil, par activité (absents d'un catalogue de test : aucun). */
  workShortcuts?: readonly WorkShortcut[]
}

export const DEFAULT_NAVIGATION: NavigationCatalog = {
  modules: APP_MODULES,
  homeActions: HOME_ACTIONS,
  workShortcuts: WORK_SHORTCUTS,
}

export const NAVIGATION_KEY: InjectionKey<NavigationCatalog> = Symbol('eeo-navigation')

export function useNavigationCatalog(): NavigationCatalog {
  return inject(NAVIGATION_KEY, DEFAULT_NAVIGATION)
}

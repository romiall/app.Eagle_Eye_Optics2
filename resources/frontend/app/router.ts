import { nextTick } from 'vue'
import { createRouter, createWebHistory, type Router, type RouterHistory } from 'vue-router'

import { DOCUMENT_PERMISSIONS } from '@/documents/access'
import ChangePasswordPage from '@/pages/account/ChangePasswordPage.vue'
import ClinicalComparePage from '@/pages/clinical/Compare.vue'
import ConsultationHistoryPage from '@/pages/consultations/ConsultationHistoryPage.vue'
import ConsultationListPage from '@/pages/consultations/ConsultationListPage.vue'
import ConsultationPage from '@/pages/consultations/ConsultationPage.vue'
import PrescriptionsPage from '@/pages/consultations/PrescriptionsPage.vue'
import DocumentPreviewPage from '@/pages/documents/DocumentPreviewPage.vue'
import ForbiddenPage from '@/pages/ForbiddenPage.vue'
import HelpPage from '@/pages/help/HelpPage.vue'
import HomePage from '@/pages/HomePage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'
import PatientActivityPage from '@/pages/patients/PatientActivityPage.vue'
import PatientCreatePage from '@/pages/patients/PatientCreatePage.vue'
import PatientEditPage from '@/pages/patients/PatientEditPage.vue'
import PatientPrescriptionsPage from '@/pages/patients/PatientPrescriptionsPage.vue'
import PatientListPage from '@/pages/patients/PatientListPage.vue'
import PatientViewPage from '@/pages/patients/PatientViewPage.vue'
import StatisticsPage from '@/pages/reports/StatisticsPage.vue'
import UnlockPage from '@/pages/UnlockPage.vue'
import AgendaPage from '@/pages/agenda/AgendaPage.vue'
import AgendaSettingsPage from '@/pages/agenda/AgendaSettingsPage.vue'
import NewAppointmentPage from '@/pages/agenda/NewAppointmentPage.vue'
import FollowUpsPage from '@/pages/follow-ups/FollowUpsPage.vue'
import ApprovalsPage from '@/pages/manager/Approvals.vue'
import ImportsPage from '@/pages/manager/Imports.vue'
import PatientMergePage from '@/pages/manager/PatientMerge.vue'
import SyncConflictsPage from '@/pages/manager/SyncConflicts.vue'
import DevicePreparationPage from '@/pages/settings/DevicePreparationPage.vue'
import CashDayPage from '@/pages/cash/CashDayPage.vue'
import CashSessionPage from '@/pages/cash/CashSessionPage.vue'
import ExpenseCategoriesPage from '@/pages/cash/ExpenseCategories.vue'
import CatalogPage from '@/pages/sales/CatalogPage.vue'
import InvoiceCreatePage from '@/pages/sales/InvoiceCreatePage.vue'
import InvoiceListPage from '@/pages/sales/InvoiceListPage.vue'
import InvoicePage from '@/pages/sales/InvoicePage.vue'
import QuoteCreatePage from '@/pages/sales/QuoteCreatePage.vue'
import QuotePage from '@/pages/sales/QuotePage.vue'
import QuotesPage from '@/pages/sales/Quotes.vue'
import SalesHomePage from '@/pages/sales/SalesHomePage.vue'
import TaxRulesPage from '@/pages/sales/TaxRulesPage.vue'
import ClinicSettingsPage from '@/pages/settings/ClinicSettingsPage.vue'
import ExportsPage from '@/pages/settings/ExportsPage.vue'
import SettingsHomePage from '@/pages/settings/SettingsHomePage.vue'
import StaffCreatePage from '@/pages/settings/StaffCreatePage.vue'
import StaffListPage from '@/pages/settings/StaffListPage.vue'
import StaffMemberPage from '@/pages/settings/StaffMemberPage.vue'
import MovementForm from '@/pages/stock/MovementForm.vue'
import StockPage from '@/pages/stock/StockPage.vue'
import ArrivalPage from '@/pages/today/ArrivalPage.vue'
import TodayPage from '@/pages/today/TodayPage.vue'

import {
  afterUnlockPath,
  ensureVaultReady,
  offlineRefusal,
  vaultAwaitsUnlock,
  vaultNeedsUnlock,
} from './services/localIdentity'
import { canAny, enabledModules, refreshSession, session } from './session'

declare module 'vue-router' {
  interface RouteMeta {
    /** Page accessible sans session (connexion, déverrouillage du poste). */
    public?: boolean
    /**
     * Écran qui sait travailler SANS le serveur : il ne lit et n'écrit que ce que le poste a (coffre, journal local).
     * Seuls ces écrans s'ouvrent en session locale (profil du coffre, serveur non vérifié, D27) ; les autres
     * demandent le serveur et restent fermés tant qu'il ne répond pas.
     */
    offlineCapable?: boolean
    /** Permissions dont l'une suffit pour ouvrir la page (le serveur revérifie chaque action). */
    permissions?: readonly string[]
    /** Titre de l'onglet (WCAG 2.4.2), suivi du nom de l'application. */
    title?: string
    /**
     * Module de mise en service progressive dont dépend la page : tant que l'exploitant ne l'a pas
     * ouvert, la page répond « introuvable », comme la route du serveur (404).
     */
    module?: string
  }
}

export const APPLICATION_TITLE = 'Eagle’s Eye Optics Medical'

/**
 * Identifiant ULID d'une fiche ou d'une consultation dans l'adresse : toute autre forme est « page
 * introuvable ». C'est un identifiant opaque : l'adresse ne porte jamais de donnée de santé.
 */
const ULID_ID = ':id([0-9A-HJKMNP-TV-Z]{26})'

export function createEeoRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: [
      {
        path: '/connexion',
        name: 'connexion',
        component: LoginPage,
        meta: { public: true, title: 'Connexion' },
      },
      {
        // Déverrouillage du poste (D14, D27) : AVANT la connexion quand ce navigateur a un coffre et qu'aucune
        // session n'est ouverte ; fonctionne sans réseau (la coquille vient du service worker).
        path: '/deverrouiller',
        name: 'deverrouiller',
        component: UnlockPage,
        meta: { public: true, title: 'Déverrouiller ce poste' },
      },
      {
        path: '/',
        name: 'accueil',
        component: HomePage,
        meta: { title: 'Accueil', offlineCapable: true },
      },
      {
        path: '/acces-refuse',
        name: 'acces-refuse',
        component: ForbiddenPage,
        meta: { title: 'Accès refusé', offlineCapable: true },
      },
      {
        // La file se lit avec l'une OU l'autre de ces permissions, comme la route du serveur.
        path: '/aujourdhui',
        name: 'aujourdhui',
        component: TodayPage,
        meta: {
          title: 'Aujourd’hui',
          permissions: ['visit.register', 'agenda.read'],
          module: 'today',
        },
      },
      {
        path: '/aujourdhui/arrivee',
        name: 'arrivee',
        component: ArrivalPage,
        meta: {
          title: 'Enregistrer une arrivée',
          permissions: ['visit.register'],
          module: 'today',
        },
      },
      {
        path: '/patients',
        name: 'patients',
        component: PatientListPage,
        // Recherche : le serveur, et à défaut les fiches de CE poste (`searchPatients` avec `includeLocal`).
        meta: {
          title: 'Patients',
          permissions: ['patient.read'],
          module: 'patients',
          offlineCapable: true,
        },
      },
      {
        path: '/patients/nouveau',
        name: 'patient-nouveau',
        component: PatientCreatePage,
        // Création d'une fiche : écrite sur le poste (numéro de sa plage) quand il est préparé, sans le serveur.
        meta: {
          title: 'Nouveau patient',
          permissions: ['patient.create'],
          module: 'patients',
          offlineCapable: true,
        },
      },
      {
        path: `/patients/${ULID_ID}`,
        name: 'patient',
        component: PatientViewPage,
        // Fiche : le serveur, et à défaut la copie de CE poste (`getPatient`) ; les onglets du serveur sont masqués.
        meta: {
          title: 'Dossier patient',
          permissions: ['patient.read'],
          module: 'patients',
          offlineCapable: true,
        },
      },
      {
        path: `/patients/${ULID_ID}/modifier`,
        name: 'patient-modifier',
        component: PatientEditPage,
        // Modification d'une fiche de ce poste : `UpdatePatient` s'enregistre sur le poste.
        meta: {
          title: 'Modifier le patient',
          permissions: ['patient.update'],
          module: 'patients',
          offlineCapable: true,
        },
      },
      {
        // Onglet « Activité » du dossier : visites, et selon les droits du compte, examens, ordonnances
        // et pièces financières (le serveur n'envoie que les sections autorisées).
        path: `/patients/${ULID_ID}/activite`,
        name: 'patient-activite',
        component: PatientActivityPage,
        meta: { title: 'Activité du patient', permissions: ['patient.read'], module: 'patients' },
      },
      {
        // Onglet « Prescriptions » du dossier (compte clinique) : ordonnances externes transcrites, sans consultation.
        path: `/patients/${ULID_ID}/prescriptions`,
        name: 'patient-prescriptions',
        component: PatientPrescriptionsPage,
        meta: {
          title: 'Prescriptions du patient',
          permissions: ['clinical.read'],
          module: 'consultations',
        },
      },
      {
        // Fusion manuelle de deux fiches (L1D08) : la fiche de l'adresse est celle à absorber ; gérante.
        path: `/patients/${ULID_ID}/fusion`,
        name: 'patient-fusion',
        component: PatientMergePage,
        meta: {
          title: 'Fusionner deux fiches',
          permissions: ['patient.merge'],
          module: 'patients',
        },
      },
      {
        // Comparaison de deux examens terminés d'un même patient (L1D08) : rubriques et prescriptions validées.
        path: `/patients/${ULID_ID}/comparaison`,
        name: 'patient-comparaison',
        component: ClinicalComparePage,
        meta: {
          title: 'Comparer deux examens',
          permissions: ['clinical.read'],
          module: 'consultations',
        },
      },
      {
        // Liste des examens du cabinet (patient, date, état, professionnel ; aucune valeur clinique).
        path: '/consultations',
        name: 'consultations',
        component: ConsultationListPage,
        meta: { title: 'Consultations', permissions: ['clinical.read'], module: 'consultations' },
      },
      {
        // Consultation par étapes (C01) : lecture avec clinical.read ; l'écran n'offre l'enregistrement
        // qu'avec clinical.write (le serveur revérifie). Module « consultations » à ouvrir.
        path: `/consultations/${ULID_ID}`,
        name: 'consultation',
        component: ConsultationPage,
        meta: { title: 'Consultation', permissions: ['clinical.read'], module: 'consultations' },
      },
      {
        // Révisions figées d'une consultation terminée et comparaison côte à côte (C03).
        path: `/consultations/${ULID_ID}/historique`,
        name: 'consultation-historique',
        component: ConsultationHistoryPage,
        meta: {
          title: 'Révisions de la consultation',
          permissions: ['clinical.read'],
          module: 'consultations',
        },
      },
      {
        // Prescription optique de la consultation : brouillon, versions, validation (C04).
        path: `/consultations/${ULID_ID}/prescriptions`,
        name: 'consultation-prescriptions',
        component: PrescriptionsPage,
        meta: {
          title: 'Prescription optique',
          permissions: ['clinical.read'],
          module: 'consultations',
        },
      },
      {
        // Aperçu des modèles de PDF (D01, D02), données fictives. Rattaché au module « sales » (le plus
        // proche : factures, reçus) ; chaque document n'est proposé que si le compte a son droit
        // (un document clinique demande clinical.read ou clinical.export, jamais un droit de caisse).
        path: '/documents/apercu',
        name: 'documents-apercu',
        component: DocumentPreviewPage,
        meta: {
          title: 'Aperçu des documents',
          permissions: [...new Set(Object.values(DOCUMENT_PERMISSIONS).flat())],
          module: 'sales',
        },
      },
      // Ventes et caisse (B01 à B05), EN LIGNE, module « sales » ; les permissions sont celles des
      // routes du serveur (x-permission), qui revérifie chaque action. Les identifiants de l'adresse sont
      // des ULID opaques ; un patient ou une visite présélectionnés passent en paramètre opaque.
      {
        path: '/ventes',
        name: 'ventes',
        component: SalesHomePage,
        meta: {
          title: 'Ventes et caisse',
          permissions: ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
          module: 'sales',
        },
      },
      {
        path: '/ventes/caisse',
        name: 'caisse',
        component: CashSessionPage,
        meta: { title: 'Caisse', permissions: ['cash.own_session'], module: 'sales' },
      },
      {
        // Catégories de dépenses de la caisse (L1D05) : gérante.
        path: '/ventes/caisse/categories-depenses',
        name: 'categories-depenses',
        component: ExpenseCategoriesPage,
        meta: { title: 'Catégories de dépenses', permissions: ['cash.manage'], module: 'sales' },
      },
      {
        // Caisse du jour (R01 minimal) : la gérante lit tout le cabinet, une caissière ses seuls encaissements.
        path: '/ventes/caisse-du-jour',
        name: 'caisse-du-jour',
        component: CashDayPage,
        meta: {
          title: 'Caisse du jour',
          permissions: ['finance.global.read', 'cash.own_session'],
          module: 'sales',
        },
      },
      {
        path: '/ventes/factures',
        name: 'factures',
        component: InvoiceListPage,
        meta: { title: 'Factures', permissions: ['invoice.read'], module: 'sales' },
      },
      {
        path: '/ventes/factures/nouvelle',
        name: 'facture-nouvelle',
        component: InvoiceCreatePage,
        // Brouillon et émission sur le poste : `CreateInvoiceDraft`, `UpdateDraft` et `IssueInvoice` s'enregistrent sur le poste.
        meta: {
          title: 'Nouvelle facture',
          permissions: ['invoice.create', 'exam_fee.collect'],
          module: 'sales',
          offlineCapable: true,
        },
      },
      {
        path: `/ventes/factures/${ULID_ID}`,
        name: 'facture',
        component: InvoicePage,
        // Facture : le serveur, et à défaut la copie de CE poste pour une facture créée ici (`getInvoice`).
        meta: {
          title: 'Facture',
          permissions: ['invoice.read'],
          module: 'sales',
          offlineCapable: true,
        },
      },
      {
        // Devis versionnés (L1D07) : ni créance ni encaissement ; conversion explicite en brouillon de facture.
        path: '/ventes/devis',
        name: 'devis',
        component: QuotesPage,
        meta: { title: 'Devis', permissions: ['invoice.read'], module: 'sales' },
      },
      {
        path: '/ventes/devis/nouveau',
        name: 'devis-nouveau',
        component: QuoteCreatePage,
        meta: { title: 'Nouveau devis', permissions: ['invoice.create'], module: 'sales' },
      },
      {
        path: `/ventes/devis/${ULID_ID}`,
        name: 'devis-detail',
        component: QuotePage,
        meta: { title: 'Devis', permissions: ['invoice.read'], module: 'sales' },
      },
      {
        path: '/ventes/catalogue',
        name: 'catalogue',
        component: CatalogPage,
        meta: { title: 'Catalogue', permissions: ['catalog.manage'], module: 'sales' },
      },
      {
        // Import contrôlé du catalogue depuis un fichier CSV (X01) : aperçu, puis toutes les lignes ou aucune.
        path: '/ventes/catalogue/import',
        name: 'import-catalogue',
        component: ImportsPage,
        meta: { title: 'Importer le catalogue', permissions: ['catalog.manage'], module: 'sales' },
      },
      {
        path: '/ventes/taxes',
        name: 'taxes',
        component: TaxRulesPage,
        meta: { title: 'Règles fiscales', permissions: ['catalog.manage'], module: 'sales' },
      },
      {
        // Disponibilités et stock initial (I00), module « stock ». La remise au patient (I01) et le retour
        // physique (I02) se font depuis la fiche facture (`DeliveriesPanel`).
        path: '/stock',
        name: 'stock',
        component: StockPage,
        meta: { title: 'Stock', permissions: ['stock.read'], module: 'stock' },
      },
      {
        // Casse et ajustement approuvés (I02) : gérante (stock.adjust), mot de passe confirmé à l'envoi.
        path: '/stock/mouvement',
        name: 'stock-movement',
        component: MovementForm,
        meta: { title: 'Casse ou ajustement', permissions: ['stock.adjust'], module: 'stock' },
      },
      // Paramètres (module « settings ») : comptes du personnel et identité du cabinet, gérante seulement
      // (users.manage ; le serveur revérifie et exige une réauthentification pour chaque écriture).
      {
        path: '/parametres',
        name: 'parametres',
        component: SettingsHomePage,
        meta: {
          title: 'Paramètres',
          permissions: ['users.manage', 'approval.decide'],
          module: 'settings',
        },
      },
      {
        path: '/parametres/personnel',
        name: 'parametres-personnel',
        component: StaffListPage,
        meta: { title: 'Personnel', permissions: ['users.manage'], module: 'settings' },
      },
      {
        path: '/parametres/personnel/nouveau',
        name: 'parametres-personnel-nouveau',
        component: StaffCreatePage,
        meta: { title: 'Créer un compte', permissions: ['users.manage'], module: 'settings' },
      },
      {
        path: `/parametres/personnel/${ULID_ID}`,
        name: 'parametres-compte',
        component: StaffMemberPage,
        meta: { title: 'Compte du personnel', permissions: ['users.manage'], module: 'settings' },
      },
      {
        // Exports contrôlés (X02) : archive privée par export, téléchargeable 48 h.
        path: '/parametres/exports',
        name: 'parametres-exports',
        component: ExportsPage,
        meta: {
          title: 'Exports',
          permissions: ['export.global', 'clinical.export'],
          module: 'settings',
        },
      },
      {
        // Approbations exactes (B06) : la gérante décide (réauthentification à chaque décision) ; un compte qui
        // demande seulement voit ses propres demandes et leur décision (le serveur filtre).
        path: '/parametres/approbations',
        name: 'approbations',
        component: ApprovalsPage,
        meta: {
          title: 'Approbations',
          permissions: ['approval.decide', 'approval.request'],
          module: 'settings',
        },
      },
      {
        // Préparation de ce poste pour le hors-ligne (O01 à O05) : coffre chiffré, enrôlement, profils, numéros réservés
        // et synchronisation. Module « offline » (fermé par défaut).
        path: '/parametres/poste',
        name: 'parametres-poste',
        component: DevicePreparationPage,
        meta: {
          title: 'Préparer ce poste',
          permissions: ['offline.enroll'],
          module: 'offline',
          offlineCapable: true,
        },
      },
      {
        // Conflits de synchronisation des postes (O05) : décision motivée de la gérante. Module « offline ».
        path: '/parametres/conflits-synchronisation',
        name: 'conflits-synchronisation',
        component: SyncConflictsPage,
        meta: {
          title: 'Conflits de synchronisation',
          permissions: ['approval.decide'],
          module: 'offline',
        },
      },
      {
        path: '/parametres/cabinet',
        name: 'parametres-cabinet',
        component: ClinicSettingsPage,
        meta: { title: 'Cabinet et documents', permissions: ['users.manage'], module: 'settings' },
      },
      {
        // Tout compte connecté change son propre mot de passe (mot de passe initial transmis par la gérante).
        path: '/mon-compte/mot-de-passe',
        name: 'mot-de-passe',
        component: ChangePasswordPage,
        meta: { title: 'Changer mon mot de passe' },
      },
      {
        // Statistiques du dossier patient (R02), module « reports » : activité de l'accueil (statistics.activity) et
        // examens (statistics.clinical) ; l'écran ne montre que les tableaux des droits du compte.
        path: '/rapports/statistiques',
        name: 'statistiques',
        component: StatisticsPage,
        meta: {
          title: 'Statistiques',
          permissions: ['statistics.activity', 'statistics.clinical'],
          module: 'reports',
        },
      },
      {
        // Agenda interne (S01), module « agenda » : vues jour et semaine, prise de rendez-vous, configuration (gérante).
        path: '/agenda',
        name: 'agenda',
        component: AgendaPage,
        meta: { title: 'Agenda', permissions: ['agenda.read'], module: 'agenda' },
      },
      {
        path: '/agenda/nouveau',
        name: 'rendez-vous-nouveau',
        component: NewAppointmentPage,
        meta: { title: 'Nouveau rendez-vous', permissions: ['agenda.write'], module: 'agenda' },
      },
      {
        // Configuration de l'agenda : gérante (faute de droit dédié au référentiel, users.manage).
        path: '/agenda/configuration',
        name: 'agenda-configuration',
        component: AgendaSettingsPage,
        meta: {
          title: 'Configuration de l’agenda',
          permissions: ['users.manage'],
          module: 'agenda',
        },
      },
      {
        // Suivis (S02) : tâches de contact internes du jour et patients à revoir ; aucun envoi de message.
        path: '/suivis',
        name: 'suivis',
        component: FollowUpsPage,
        meta: { title: 'Patients à rappeler', permissions: ['agenda.read'], module: 'agenda' },
      },
      {
        // Aide intégrée : tout compte connecté ; elle ne montre que les écrans de ses droits et modules ouverts.
        path: '/aide',
        name: 'aide',
        component: HelpPage,
        meta: { title: 'Aide', offlineCapable: true },
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'introuvable',
        component: NotFoundPage,
        meta: { title: 'Page introuvable', offlineCapable: true },
      },
    ],
    scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
  })

  // Garde de navigation : le coffre de ce navigateur (s'il existe) est détecté, la session est lue une fois, puis
  // chaque page vérifie ses permissions. Une session non vérifiable n'est pas une déconnexion : la coquille
  // l'affiche sans rien conclure. Sans identité d'action et avec un coffre, le déverrouillage du poste passe AVANT la
  // connexion au serveur (D27) ; en session locale (profil du coffre), seuls les écrans `offlineCapable` s'ouvrent.
  router.beforeEach(async (to) => {
    // Détection du coffre et lecture de la session démarrent ensemble : la lecture de la session ne perd aucun tour.
    const vaultReady = ensureVaultReady()
    if (session.status === 'unknown') {
      await refreshSession().catch(() => undefined)
    }
    await vaultReady
    if (to.name === 'deverrouiller') {
      // Rien à déverrouiller ici (pas de coffre, ou déjà ouvert) : retour à l'application.
      return vaultAwaitsUnlock() ? true : { path: afterUnlockPath(to.query['suite']) }
    }
    if (to.meta.public === true) {
      return to.name === 'connexion' && session.status === 'authenticated'
        ? { name: 'accueil' }
        : true
    }
    if (vaultNeedsUnlock()) {
      // Seul le chemin interne est conservé, jamais de paramètre de requête (aucun dossier dans l'URL).
      return { name: 'deverrouiller', query: to.path === '/' ? {} : { suite: to.path } }
    }
    if (session.status === 'anonymous' || session.status === 'expired') {
      // Seul le chemin interne est conservé, jamais de paramètre de requête (aucun dossier dans l'URL).
      return { name: 'connexion', query: to.path === '/' ? {} : { suite: to.path } }
    }
    if (session.status === 'local') {
      if (to.meta.offlineCapable !== true) {
        // Cet écran lit le serveur : fermé tant qu'il ne répond pas. L'accueil explique pourquoi.
        offlineRefusal.value = typeof to.meta.title === 'string' ? to.meta.title : to.path
        return { name: 'accueil' }
      }
      const needed = to.meta.permissions
      return needed === undefined || canAny(needed) ? true : { name: 'acces-refuse' }
    }
    if (to.meta.module !== undefined && session.status === 'authenticated') {
      if (!enabledModules.value.includes(to.meta.module)) {
        const pathMatch = to.path.split('/').slice(1)
        return { name: 'introuvable', params: { pathMatch }, replace: true }
      }
    }
    const required = to.meta.permissions
    if (required !== undefined) {
      // Droits non vérifiables (serveur muet ou en erreur) : l'accueil explique l'état, rien ne s'ouvre.
      if (session.status !== 'authenticated') return { name: 'accueil' }
      if (!canAny(required)) return { name: 'acces-refuse' }
    }
    return true
  })

  // Après chaque navigation : titre de l'onglet, puis focus sur le contenu (sauf au premier
  // affichage) pour qu'un lecteur d'écran annonce le nouvel écran au lieu de rester sur le lien.
  router.afterEach((to, from, failure) => {
    if (failure === undefined && to.name !== 'accueil') offlineRefusal.value = null
    if (failure !== undefined || typeof document === 'undefined') return
    document.title =
      to.meta.title === undefined ? APPLICATION_TITLE : `${to.meta.title} – ${APPLICATION_TITLE}`
    if (from.matched.length > 0) {
      void nextTick(() => document.getElementById('contenu')?.focus({ preventScroll: true }))
    }
  })

  return router
}

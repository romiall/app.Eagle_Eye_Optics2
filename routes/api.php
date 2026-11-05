<?php

use App\Http\Controllers\Api\V1\AgendaController;
use App\Http\Controllers\Api\V1\AppointmentController;
use App\Http\Controllers\Api\V1\ApprovalController;
use App\Http\Controllers\Api\V1\AuditEventController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CashDayReportController;
use App\Http\Controllers\Api\V1\CashMovementController;
use App\Http\Controllers\Api\V1\CashSessionController;
use App\Http\Controllers\Api\V1\CatalogController;
use App\Http\Controllers\Api\V1\CatalogImportController;
use App\Http\Controllers\Api\V1\ClinicSettingsController;
use App\Http\Controllers\Api\V1\ConsultationController;
use App\Http\Controllers\Api\V1\ConsultationListController;
use App\Http\Controllers\Api\V1\ContactTaskController;
use App\Http\Controllers\Api\V1\CorrectionController;
use App\Http\Controllers\Api\V1\CorrectionDocumentController;
use App\Http\Controllers\Api\V1\DeliveryController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\DocumentController;
use App\Http\Controllers\Api\V1\ExportController;
use App\Http\Controllers\Api\V1\FollowUpController;
use App\Http\Controllers\Api\V1\InvoiceController;
use App\Http\Controllers\Api\V1\LegacyBalanceController;
use App\Http\Controllers\Api\V1\PatientActivityController;
use App\Http\Controllers\Api\V1\PatientController;
use App\Http\Controllers\Api\V1\PatientMergeController;
use App\Http\Controllers\Api\V1\PrescriptionController;
use App\Http\Controllers\Api\V1\QuoteController;
use App\Http\Controllers\Api\V1\ReceiptController;
use App\Http\Controllers\Api\V1\SalesSettingsController;
use App\Http\Controllers\Api\V1\StaffController;
use App\Http\Controllers\Api\V1\StatisticsController;
use App\Http\Controllers\Api\V1\StockController;
use App\Http\Controllers\Api\V1\SyncController;
use App\Http\Controllers\Api\V1\TaxRuleController;
use App\Http\Controllers\Api\V1\VisitController;
use App\Http\Controllers\Api\V1\VisualAcuityScaleController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API privée /api/v1
|--------------------------------------------------------------------------
|
| Préfixe `api` appliqué par bootstrap/app.php. Session SPA Sanctum (cookie du sous-domaine + CSRF,
| jeton obtenu par GET /api/sanctum/csrf-cookie). Toute URL inconnue sous /api répond en JSON 404 dans
| l'enveloppe du fichier 08, jamais par la coquille SPA (routes/spa.php).
*/

Route::prefix('v1')->group(function (): void {
    Route::post('auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:eeo-login-ip')
        ->name('api.auth.login');

    Route::middleware(['auth:sanctum', 'active'])->group(function (): void {
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('api.auth.logout');
        Route::get('auth/me', [AuthController::class, 'me'])->name('api.auth.me');
        Route::post('auth/reauthenticate', [AuthController::class, 'reauthenticate'])
            ->middleware('throttle:eeo-reauthenticate')
            ->name('api.auth.reauthenticate');
        // Même limite que la réauthentification (même compte, compteur partagé) : une session laissée
        // ouverte ne permet pas de deviner le mot de passe actuel sans limite.
        Route::post('auth/password', [AuthController::class, 'changePassword'])
            ->middleware('throttle:eeo-reauthenticate')
            ->name('api.auth.password');

        // Paramètres du cabinet : gérante seulement (contrat 23, « Policy gérante »). Les autres profils
        // reçoivent le nom, le fuseau et la monnaie du cabinet dans GET /auth/me.
        Route::get('clinic/settings', [ClinicSettingsController::class, 'show'])
            ->middleware('can:users.manage')
            ->name('api.clinic.settings.show');
        Route::patch('clinic/settings', [ClinicSettingsController::class, 'update'])
            ->middleware(['can:users.manage', 'reauthenticated'])
            ->name('api.clinic.settings.update');
        // Identité du cabinet imprimée sur les documents (en-tête, pied) : tout profil qui produit un document
        // (l'un des droits d'un document financier ou clinique suffit). Ne dépend d'aucun module.
        Route::get('clinic/document-identity', [ClinicSettingsController::class, 'documentIdentity'])
            ->middleware('any-permission:invoice.read,invoice.create,invoice.issue,payment.collect,cash.own_session,cash.manage,credit_note.issue,refund.execute,finance.global.read,clinical.read,clinical.export')
            ->name('api.clinic.document-identity');

        // Journal d'audit append-only : lecture seule, permission audit.read (gérante), limitée au cabinet.
        Route::get('audit-events', [AuditEventController::class, 'index'])
            ->middleware('can:audit.read')
            ->name('api.audit-events.index');

        // Comptes du personnel : gérante seulement (users.manage), mutations après réauthentification.
        Route::middleware('can:users.manage')->group(function (): void {
            Route::get('staff', [StaffController::class, 'index'])->name('api.staff.index');
            Route::get('staff/{id}', [StaffController::class, 'show'])->name('api.staff.show');

            Route::middleware('reauthenticated')->group(function (): void {
                Route::post('staff', [StaffController::class, 'store'])->name('api.staff.store');
                Route::patch('staff/{id}', [StaffController::class, 'update'])->name('api.staff.update');
                Route::post('staff/{id}/permissions', [StaffController::class, 'permissions'])->name('api.staff.permissions');
                Route::post('staff/{id}/password', [StaffController::class, 'resetPassword'])->name('api.staff.password');
            });
        });

        // Patients (P01, P02) : module « patients », ouvert par l'exploitant (EEO_ENABLED_MODULES) ; fermé,
        // chaque route répond 404 comme si elle n'existait pas. Écritures par le chemin central de commandes.
        Route::middleware('module:patients')->group(function (): void {
            Route::get('patients', [PatientController::class, 'index'])
                ->middleware(['can:patient.read', 'throttle:eeo-patient-search'])
                ->name('api.patients.index');
            // La réponse d'une écriture est la fiche complète : elle exige aussi patient.read (une dérogation
            // qui retire la lecture ne se contourne pas par l'écriture).
            Route::post('patients', [PatientController::class, 'store'])
                ->middleware(['can:patient.create', 'can:patient.read'])
                ->name('api.patients.store');
            Route::get('patients/{id}', [PatientController::class, 'show'])
                ->middleware('can:patient.read')
                ->whereUlid('id')
                ->name('api.patients.show');
            Route::patch('patients/{id}', [PatientController::class, 'update'])
                ->middleware(['can:patient.update', 'can:patient.read'])
                ->whereUlid('id')
                ->name('api.patients.update');
            // Activité du patient (onglet « Activité » de la fiche), lecture seule : visites avec patient.read ;
            // examens et ordonnances seulement avec clinical.read, pièces financières seulement avec invoice.read
            // (sections décidées par le contrôleur, jamais mentionnées sans le droit).
            Route::get('patients/{id}/activity', [PatientActivityController::class, 'index'])
                ->middleware('can:patient.read')
                ->whereUlid('id')
                ->name('api.patients.activity');
            // Fusion manuelle de deux fiches (L1D08) : aperçu (gérante, lecture seule) puis fusion (mot de passe
            // confirmé récemment). {id} est la fiche absorbée ; jamais de fusion automatique.
            Route::get('patients/{id}/merge-preview', [PatientMergeController::class, 'preview'])
                ->middleware(['can:patient.merge', 'can:patient.read'])
                ->whereUlid('id')
                ->name('api.patients.merge-preview');
            Route::post('patients/{id}/merge', [PatientMergeController::class, 'store'])
                ->middleware(['can:patient.merge', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.patients.merge');
        });

        // Visites et file du jour (P03) : module « today ». La file se lit avec l'une ou l'autre des
        // permissions listées ; l'enregistrement d'une arrivée exige visit.register.
        Route::middleware('module:today')->group(function (): void {
            Route::get('visits', [VisitController::class, 'index'])
                ->middleware('any-permission:visit.register,agenda.read')
                ->name('api.visits.index');
            Route::post('visits', [VisitController::class, 'store'])
                ->middleware('can:visit.register')
                ->name('api.visits.store');
            // Annulation d'une visite avant l'examen (P03) : même droit que l'arrivée, motif obligatoire, en ligne.
            Route::post('visits/{id}/cancel', [VisitController::class, 'cancel'])
                ->middleware('can:visit.register')
                ->whereUlid('id')
                ->name('api.visits.cancel');
        });

        // Ventes et caisse (B01 à B05) : module « sales », ouvert par l'exploitant ; fermé, chaque route répond 404.
        // Toute écriture passe par le chemin central de commandes. Les permissions des routes d'écriture sont celles
        // du contrat (`x-permission`, l'une OU l'autre pour le brouillon, l'émission et l'encaissement : le profil
        // « frais d'examen » n'a que `exam_fee.collect` et reste limité à l'article des frais d'examen).
        Route::middleware('module:sales')->group(function (): void {
            // Catalogue et règles fiscales (B01) : recherche pour les lignes, gestion par la gérante.
            Route::get('catalog', [CatalogController::class, 'index'])
                ->middleware('can:catalog.read')
                ->name('api.catalog.index');
            Route::post('catalog/items', [CatalogController::class, 'store'])
                ->middleware('can:catalog.manage')
                ->name('api.catalog.items.store');
            Route::patch('catalog/items/{id}', [CatalogController::class, 'update'])
                ->middleware('can:catalog.manage')
                ->whereUlid('id')
                ->name('api.catalog.items.update');
            // Import contrôlé du catalogue (X01) : aperçu sans écriture, puis toutes les lignes ou aucune.
            Route::post('imports/catalog', [CatalogImportController::class, 'store'])
                ->middleware(['can:catalog.manage', 'reauthenticated'])
                ->name('api.imports.catalog');
            // Reprise des créances papier (X01) : justificatif scanné, puis aperçu sans écriture et toutes les créances ou
            // aucune ; la gérante (finance.global.read), réauthentification récente.
            Route::post('legacy-balances/evidence', [LegacyBalanceController::class, 'evidence'])
                ->middleware(['can:finance.global.read', 'reauthenticated'])
                ->name('api.legacy-balances.evidence');
            Route::post('imports/legacy-balances', [LegacyBalanceController::class, 'import'])
                ->middleware(['can:finance.global.read', 'reauthenticated'])
                ->name('api.imports.legacy-balances');
            Route::get('tax-rules', [TaxRuleController::class, 'index'])
                ->middleware('can:catalog.manage')
                ->name('api.tax-rules.index');
            Route::post('tax-rules', [TaxRuleController::class, 'store'])
                ->middleware(['can:catalog.manage', 'reauthenticated'])
                ->name('api.tax-rules.store');
            Route::patch('tax-rules/{id}', [TaxRuleController::class, 'update'])
                ->middleware(['can:catalog.manage', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.tax-rules.update');

            // Brouillons, émission immuable et encaissement (B02, B03, B04).
            Route::get('invoices', [InvoiceController::class, 'index'])
                ->middleware('can:invoice.read')
                ->name('api.invoices.index');
            Route::post('invoices', [InvoiceController::class, 'store'])
                ->middleware('any-permission:invoice.create,exam_fee.collect')
                ->name('api.invoices.store');
            Route::get('invoices/{id}', [InvoiceController::class, 'show'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.invoices.show');
            Route::patch('invoices/{id}', [InvoiceController::class, 'update'])
                ->middleware('any-permission:invoice.create,exam_fee.collect')
                ->whereUlid('id')
                ->name('api.invoices.update');
            Route::post('invoices/{id}/issue', [InvoiceController::class, 'issue'])
                ->middleware('any-permission:invoice.issue,exam_fee.collect')
                ->whereUlid('id')
                ->name('api.invoices.issue');
            Route::post('invoices/{id}/payments', [InvoiceController::class, 'pay'])
                ->middleware('any-permission:payment.collect,exam_fee.collect')
                ->whereUlid('id')
                ->name('api.invoices.payments.store');
            // Abandon d'un brouillon (fichier 03) : même droit que sa modification (créateur ou gérante, en ligne).
            Route::post('invoices/{id}/abandon', [InvoiceController::class, 'abandon'])
                ->middleware('any-permission:invoice.create,exam_fee.collect')
                ->whereUlid('id')
                ->name('api.invoices.abandon');
            // Devis versionnés (L1D07) : brouillon, émission, révisions figées, réponse du client et conversion en
            // BROUILLON de facture ; ni créance, ni encaissement, ni réserve de stock.
            Route::get('quotes', [QuoteController::class, 'index'])
                ->middleware('can:invoice.read')
                ->name('api.quotes.index');
            Route::post('quotes', [QuoteController::class, 'store'])
                ->middleware('can:invoice.create')
                ->name('api.quotes.store');
            Route::get('quotes/{id}', [QuoteController::class, 'show'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.quotes.show');
            Route::patch('quotes/{id}', [QuoteController::class, 'update'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.update');
            // Suppression d'un brouillon de devis jamais émis (chantier « CRUD des écrans ») : créateur ou gérante.
            Route::post('quotes/{id}/delete', [QuoteController::class, 'delete'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.delete');
            Route::post('quotes/{id}/issue', [QuoteController::class, 'issue'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.issue');
            Route::post('quotes/{id}/revisions', [QuoteController::class, 'revise'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.revisions.store');
            Route::post('quotes/{id}/decision', [QuoteController::class, 'decide'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.decision');
            Route::post('quotes/{id}/conversions', [QuoteController::class, 'convert'])
                ->middleware('can:invoice.create')
                ->whereUlid('id')
                ->name('api.quotes.conversions.store');
            // Règles de vente du compte connecté (plafond de remise, modes à référence obligatoire) : affichage seulement.
            Route::get('sales/settings', [SalesSettingsController::class, 'show'])
                ->middleware('any-permission:invoice.read,invoice.create,payment.collect,exam_fee.collect')
                ->name('api.sales.settings');
            Route::get('receipts/{id}', [ReceiptController::class, 'show'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.receipts.show');

            // Corrections des pièces émises (B07, B08) : pièces liées, jamais de suppression ni de modification d'un
            // paiement, d'un reçu ou d'une facture. Permission propre à chaque opération, approbation exacte de la gérante
            // (ou exécution directe par elle) et réauthentification récente.
            Route::post('payments/{id}/reversals', [CorrectionController::class, 'reverse'])
                ->middleware(['can:payment.reverse', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.payments.reversals.store');
            Route::post('invoices/{id}/credit-notes', [CorrectionController::class, 'creditNote'])
                ->middleware(['can:credit_note.issue', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.invoices.credit-notes.store');
            Route::post('invoices/{id}/refunds', [CorrectionController::class, 'refund'])
                ->middleware(['can:refund.execute', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.invoices.refunds.store');
            // Lecture des pièces de correction (source de leur document PDF, produit sur le poste).
            Route::get('credit-notes/{id}', [CorrectionDocumentController::class, 'creditNote'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.credit-notes.show');
            Route::get('refunds/{id}', [CorrectionDocumentController::class, 'refund'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.refunds.show');

            // Remise au patient (I01) : reste à remettre, historique, puis remise partielle ou totale d'une facture émise ;
            // la réserve posée à l'émission est consommée, une facture non soldée exige l'approbation de la gérante.
            Route::get('invoices/{id}/deliveries', [DeliveryController::class, 'index'])
                ->middleware('can:invoice.read')
                ->whereUlid('id')
                ->name('api.invoices.deliveries.index');
            Route::post('invoices/{id}/deliveries', [DeliveryController::class, 'store'])
                ->middleware('can:delivery.confirm')
                ->whereUlid('id')
                ->name('api.invoices.deliveries.store');

            // Caisse (B05) : la caisse principale, la session ouverte du compte, ouverture et clôture.
            Route::get('cash-registers', [CashSessionController::class, 'registers'])
                ->middleware('can:cash.own_session')
                ->name('api.cash-registers.index');
            Route::get('cash-sessions/current', [CashSessionController::class, 'current'])
                ->middleware('can:cash.own_session')
                ->name('api.cash-sessions.current');
            Route::post('cash-sessions', [CashSessionController::class, 'open'])
                ->middleware('can:cash.own_session')
                ->name('api.cash-sessions.open');
            Route::post('cash-sessions/{id}/close', [CashSessionController::class, 'close'])
                ->middleware('can:cash.own_session')
                ->whereUlid('id')
                ->name('api.cash-sessions.close');
            // Sessions de tous les postes et caissières (gérante), relevé d'une session (la sienne, ou toute session pour
            // la gérante : contrôlé par le contrôleur) et caisse du jour (portée selon finance.global.read).
            Route::get('cash-sessions', [CashSessionController::class, 'index'])
                ->middleware('can:cash.manage')
                ->name('api.cash-sessions.index');
            Route::get('cash-sessions/{id}/report', [CashSessionController::class, 'report'])
                ->middleware('can:cash.own_session')
                ->whereUlid('id')
                ->name('api.cash-sessions.report');
            Route::get('reports/cash-day', [CashDayReportController::class, 'show'])
                ->middleware('any-permission:finance.global.read,cash.own_session')
                ->name('api.reports.cash-day');
            // Dépenses et mouvements hors vente d'une session ouverte (L1D05) : approbation exacte de la gérante ou son
            // exécution directe ; catégories de dépenses (gérante) ; revue de l'écart d'une session clôturée.
            Route::get('cash-sessions/{id}/movements', [CashMovementController::class, 'index'])
                ->middleware('can:cash.own_session')
                ->whereUlid('id')
                ->name('api.cash-sessions.movements.index');
            Route::post('cash-sessions/{id}/movements', [CashMovementController::class, 'store'])
                ->middleware('can:cash.own_session')
                ->whereUlid('id')
                ->name('api.cash-sessions.movements.store');
            Route::post('cash-sessions/{id}/variance-review', [CashMovementController::class, 'review'])
                ->middleware(['can:cash.manage', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.cash-sessions.variance-review');
            Route::get('expense-categories', [CashMovementController::class, 'categories'])
                ->middleware('can:cash.own_session')
                ->name('api.expense-categories.index');
            Route::post('expense-categories', [CashMovementController::class, 'saveCategory'])
                ->middleware('can:cash.manage')
                ->name('api.expense-categories.save');
        });

        // Approbations exactes (B06) : module « settings » (gestion gérante, fichier 04). Une demande porte le contenu exact
        // de l'opération ; la gérante lit toutes les demandes, un autre compte seulement les siennes ; la décision exige
        // une réauthentification récente (423 sinon).
        Route::middleware('module:settings')->group(function (): void {
            // Exports contrôlés (X02) : demande réauthentifiée, archive produite par la tâche planifiée, téléchargement
            // privé pendant 48 h ; le dossier d'un patient avec clinical.export, tout autre type avec export.global.
            Route::get('exports', [ExportController::class, 'index'])
                ->middleware('any-permission:export.global,clinical.export')
                ->name('api.exports.index');
            Route::post('exports', [ExportController::class, 'store'])
                ->middleware(['any-permission:export.global,clinical.export', 'reauthenticated'])
                ->name('api.exports.store');
            Route::get('exports/{id}', [ExportController::class, 'show'])
                ->middleware('any-permission:export.global,clinical.export')
                ->whereUlid('id')
                ->name('api.exports.show');
            Route::get('exports/{id}/download', [ExportController::class, 'download'])
                ->middleware('any-permission:export.global,clinical.export')
                ->whereUlid('id')
                ->name('api.exports.download');
            Route::get('approvals', [ApprovalController::class, 'index'])
                ->middleware('any-permission:approval.request,approval.decide')
                ->name('api.approvals.index');
            Route::post('approvals', [ApprovalController::class, 'store'])
                ->middleware('can:approval.request')
                ->name('api.approvals.store');
            Route::get('approvals/{id}', [ApprovalController::class, 'show'])
                ->middleware('any-permission:approval.request,approval.decide')
                ->whereUlid('id')
                ->name('api.approvals.show');
            Route::post('approvals/{id}/decision', [ApprovalController::class, 'decide'])
                ->middleware(['can:approval.decide', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.approvals.decide');
        });

        // Stock (I00, I02) : module « stock ». La réserve n'a pas de route : c'est un service interne de l'émission. Retour
        // physique, casse et ajustement : droit stock.adjust (gérante par défaut) et réauthentification récente.
        Route::middleware('module:stock')->group(function (): void {
            Route::post('deliveries/{id}/physical-returns', [DeliveryController::class, 'physicalReturn'])
                ->middleware(['can:stock.adjust', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.deliveries.physical-returns.store');
            Route::post('stock/movements', [StockController::class, 'movement'])
                ->middleware(['can:stock.adjust', 'reauthenticated'])
                ->name('api.stock.movements.store');
            Route::get('stock/availability', [StockController::class, 'availability'])
                ->middleware('can:stock.read')
                ->name('api.stock.availability');
            Route::get('stock/locations', [StockController::class, 'locations'])
                ->middleware('can:stock.read')
                ->name('api.stock.locations');
            Route::post('stock/opening', [StockController::class, 'opening'])
                ->middleware(['can:stock.adjust', 'reauthenticated'])
                ->name('api.stock.opening');
        });

        // Agenda interne (S01) et suivis (S02) : module « agenda ». Lecture de l'agenda (agenda.read : gérante, accueil,
        // professionnel, caisse), prise et modification des rendez-vous et tentatives de contact (agenda.write),
        // contrôles recommandés (follow_up.write ; la commande exige aussi clinical.read), configuration par la gérante
        // (users.manage, faute de droit dédié au référentiel). Écritures par le chemin central, en ligne.
        Route::middleware('module:agenda')->group(function (): void {
            Route::get('agenda/configuration', [AgendaController::class, 'configuration'])
                ->middleware('can:agenda.read')
                ->name('api.agenda.configuration');
            Route::get('agenda/slots', [AgendaController::class, 'slots'])
                ->middleware('can:agenda.read')
                ->name('api.agenda.slots');
            Route::post('agenda/resources', [AgendaController::class, 'storeResource'])
                ->middleware('can:users.manage')
                ->name('api.agenda.resources.store');
            Route::patch('agenda/resources/{id}', [AgendaController::class, 'updateResource'])
                ->middleware('can:users.manage')
                ->whereUlid('id')
                ->name('api.agenda.resources.update');
            Route::post('agenda/resources/{id}/opening-hours', [AgendaController::class, 'openingHours'])
                ->middleware('can:users.manage')
                ->whereUlid('id')
                ->name('api.agenda.resources.opening-hours');
            Route::post('agenda/resources/{id}/exceptions', [AgendaController::class, 'exception'])
                ->middleware('can:users.manage')
                ->whereUlid('id')
                ->name('api.agenda.resources.exceptions');
            Route::post('agenda/services', [AgendaController::class, 'storeService'])
                ->middleware('can:users.manage')
                ->name('api.agenda.services.store');
            Route::patch('agenda/services/{id}', [AgendaController::class, 'updateService'])
                ->middleware('can:users.manage')
                ->whereUlid('id')
                ->name('api.agenda.services.update');

            Route::get('appointments', [AppointmentController::class, 'index'])
                ->middleware('can:agenda.read')
                ->name('api.appointments.index');
            Route::post('appointments', [AppointmentController::class, 'store'])
                ->middleware('can:agenda.write')
                ->name('api.appointments.store');
            Route::post('appointments/{id}/reschedule', [AppointmentController::class, 'reschedule'])
                ->middleware('can:agenda.write')
                ->whereUlid('id')
                ->name('api.appointments.reschedule');
            Route::post('appointments/{id}/cancel', [AppointmentController::class, 'cancel'])
                ->middleware('can:agenda.write')
                ->whereUlid('id')
                ->name('api.appointments.cancel');
            Route::post('appointments/{id}/no-show', [AppointmentController::class, 'noShow'])
                ->middleware('can:agenda.write')
                ->whereUlid('id')
                ->name('api.appointments.no-show');

            Route::get('follow-ups', [FollowUpController::class, 'index'])
                ->middleware('can:agenda.read')
                ->name('api.follow-ups.index');
            Route::post('follow-ups', [FollowUpController::class, 'store'])
                ->middleware('can:follow_up.write')
                ->name('api.follow-ups.store');
            // Annulation d'un contrôle recommandé encore actif (chantier « CRUD des écrans ») : motif obligatoire.
            Route::post('follow-ups/{id}/cancel', [FollowUpController::class, 'cancel'])
                ->middleware('can:follow_up.write')
                ->whereUlid('id')
                ->name('api.follow-ups.cancel');

            Route::get('contact-tasks', [ContactTaskController::class, 'index'])
                ->middleware('can:agenda.read')
                ->name('api.contact-tasks.index');
            Route::post('contact-tasks/{id}/attempts', [ContactTaskController::class, 'attempt'])
                ->middleware('can:agenda.write')
                ->whereUlid('id')
                ->name('api.contact-tasks.attempts');
        });

        // Originaux PDF des documents générés (D01) : stockage privé, Policy par famille de document (financière ou
        // clinique) vérifiée par le contrôleur, module de la famille ouvert (404 sinon).
        Route::post('documents/{id}/content', [DocumentController::class, 'content'])
            ->middleware('any-permission:invoice.issue,payment.collect,clinical.complete')
            ->whereUlid('id')
            ->name('api.documents.content');
        Route::get('documents/{id}/download', [DocumentController::class, 'download'])
            ->middleware('any-permission:invoice.read,clinical.export')
            ->whereUlid('id')
            ->name('api.documents.download');

        // Statistiques du dossier patient (R02) : module « reports ». Deux lectures séparées par leurs droits : activité
        // administrative (statistics.activity : gérante, accueil) et statistiques cliniques (statistics.clinical :
        // gérante, professionnel). Comptages seulement, période de jours civils du cabinet.
        Route::middleware('module:reports')->group(function (): void {
            Route::get('reports/activity', [StatisticsController::class, 'activity'])
                ->middleware('can:statistics.activity')
                ->name('api.reports.activity');
            Route::get('reports/clinical', [StatisticsController::class, 'clinical'])
                ->middleware('can:statistics.clinical')
                ->name('api.reports.clinical');
        });

        // Consultation clinique (C01 à C04) : module « consultations ». Données cliniques : accueil et caisse n'ont
        // aucune de ces permissions (403 même pour une consultation existante). Le démarrage, l'enregistrement d'une
        // rubrique, la finalisation, la correction et les écritures de prescription rendent la ressource (état courant,
        // qu'un rejeu de la même clé relit), ils exigent donc aussi clinical.read : une dérogation qui retire la lecture
        // ne se contourne pas par l'écriture. L'identifiant de rubrique est contrôlé par le contrôleur (422), non par la
        // route, pour que l'erreur soit lisible. Les lectures d'un dossier sont limitées en débit par compte.
        Route::middleware('module:consultations')->group(function (): void {
            // Liste des examens (écran « Consultations ») : patient, date, état, professionnel ; aucune valeur
            // clinique. Même limite de débit que les lectures de dossier (la liste donne les identifiants).
            Route::get('consultations', [ConsultationListController::class, 'index'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->name('api.consultations.index');
            Route::get('visual-acuity-scales', [VisualAcuityScaleController::class, 'index'])
                ->middleware('can:clinical.read')
                ->name('api.visual-acuity-scales.index');
            Route::post('visits/{id}/consultations', [ConsultationController::class, 'start'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.consultations.start');
            Route::get('consultations/{id}', [ConsultationController::class, 'show'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->whereUlid('id')
                ->name('api.consultations.show');
            Route::patch('consultations/{id}/steps/{step}', [ConsultationController::class, 'saveStep'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.consultations.steps.save');
            Route::post('consultations/{id}/complete', [ConsultationController::class, 'complete'])
                ->middleware(['can:clinical.complete', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.consultations.complete');
            Route::post('consultations/{id}/amendments', [ConsultationController::class, 'amend'])
                ->middleware(['can:clinical.amend', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.consultations.amend');
            // Suppression d'un examen resté brouillon (demande du cabinet) : le serveur refuse tout autre état ; l'auteur
            // ou la gérante seulement (contrôlé par l'action). Commande en ligne, POST comme l'annulation d'une visite.
            Route::post('consultations/{id}/delete', [ConsultationController::class, 'delete'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.consultations.delete');
            Route::get('consultations/{id}/revisions/{revision_no}', [ConsultationController::class, 'revision'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->whereUlid('id')
                ->whereNumber('revision_no')
                ->name('api.consultations.revisions.show');

            // Prescriptions optiques (C04) : brouillon, nouvelle version, validation.
            Route::get('consultations/{id}/prescriptions', [PrescriptionController::class, 'index'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->whereUlid('id')
                ->name('api.prescriptions.index');
            Route::post('consultations/{id}/prescriptions', [PrescriptionController::class, 'store'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.prescriptions.store');
            Route::get('patients/{id}/prescriptions', [PrescriptionController::class, 'patientIndex'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->whereUlid('id')
                ->name('api.prescriptions.patient-index');
            Route::post('prescriptions/external', [PrescriptionController::class, 'storeExternal'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->name('api.prescriptions.store-external');
            Route::get('prescriptions/{id}', [PrescriptionController::class, 'show'])
                ->middleware(['can:clinical.read', 'throttle:eeo-consultation-read'])
                ->whereUlid('id')
                ->name('api.prescriptions.show');
            Route::patch('prescriptions/{id}', [PrescriptionController::class, 'update'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.prescriptions.update');
            // Suppression d'un brouillon de prescription (chantier « CRUD des écrans ») : même droit que sa modification ;
            // une prescription validée est immuable (409), elle se corrige par une nouvelle version.
            Route::post('prescriptions/{id}/delete', [PrescriptionController::class, 'delete'])
                ->middleware(['can:clinical.write', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.prescriptions.delete');
            Route::post('prescriptions/{id}/revisions', [PrescriptionController::class, 'revise'])
                ->middleware(['can:clinical.amend', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.prescriptions.revise');
            Route::post('prescriptions/{id}/validate', [PrescriptionController::class, 'validatePrescription'])
                ->middleware(['can:clinical.complete', 'can:clinical.read'])
                ->whereUlid('id')
                ->name('api.prescriptions.validate');
        });

        // Préparation des postes pour le hors-ligne (O02) : module « offline », gérante (`offline.enroll`). Enrôlement,
        // grants signés par profil et révocations, toutes avec réauthentification récente (423 sinon). Rien ici n'ouvre
        // encore le travail hors-ligne : journal, plages et synchronisation viennent avec O03 à O05.
        Route::middleware(['module:offline', 'can:offline.enroll'])->group(function (): void {
            Route::get('offline/signing-keys', [DeviceController::class, 'signingKeys'])
                ->name('api.offline.signing-keys');
            Route::get('devices', [DeviceController::class, 'index'])
                ->name('api.devices.index');
            Route::post('devices/enroll', [DeviceController::class, 'enroll'])
                ->middleware('reauthenticated')
                ->name('api.devices.enroll');
            Route::get('devices/{id}', [DeviceController::class, 'show'])
                ->whereUlid('id')
                ->name('api.devices.show');
            Route::get('devices/{id}/grants', [DeviceController::class, 'grants'])
                ->whereUlid('id')
                ->name('api.devices.grants.index');
            Route::post('devices/{id}/grants', [DeviceController::class, 'issueGrant'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.grants.store');
            Route::post('devices/{id}/revoke', [DeviceController::class, 'revoke'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.revoke');
            // Ressources du poste (O03) : plages, propriétés de facture, quotas ; restitution après reprise complète.
            Route::post('devices/{id}/prepare', [DeviceController::class, 'prepare'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.prepare');
            Route::get('devices/{id}/preparation', [DeviceController::class, 'preparation'])
                ->whereUlid('id')
                ->name('api.devices.preparation');
            Route::post('devices/{id}/release', [DeviceController::class, 'release'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.release');
            // Remplacement d'un poste (O07) : déclaration, reprise du journal exporté (mêmes numéros), réconciliation.
            Route::post('devices/{id}/replace', [DeviceController::class, 'replace'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.replace');
            Route::post('devices/{id}/recovered-push', [SyncController::class, 'recoveredPush'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.recovered-push');
            Route::post('devices/{id}/reconcile-replacement', [DeviceController::class, 'reconcileReplacement'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.devices.reconcile-replacement');
            Route::post('offline-grants/{id}/revoke', [DeviceController::class, 'revokeGrant'])
                ->middleware('reauthenticated')
                ->whereUlid('id')
                ->name('api.offline-grants.revoke');
        });

        // Synchronisation des postes préparés (O05) : module « offline ». Push et pull par le profil ouvert sur le poste
        // (chaque commande est jugée par SON grant ; le pull suit le grant actif ∩ les droits actuels) ; conflits et
        // décisions motivées par la gérante (`approval.decide`, réauthentification pour décider).
        Route::middleware(['module:offline'])->group(function (): void {
            Route::post('sync/push', [SyncController::class, 'push'])
                ->name('api.sync.push');
            Route::get('sync/pull', [SyncController::class, 'pull'])
                ->name('api.sync.pull');
            // Compatibilité de la release (O06) : le poste vérifie que ses commandes en attente restent reprises avant
            // d'accepter une mise à jour de l'application.
            Route::get('sync/compatibility', [SyncController::class, 'compatibility'])
                ->name('api.sync.compatibility');
            Route::get('sync/conflicts', [SyncController::class, 'conflicts'])
                ->middleware('can:approval.decide')
                ->name('api.sync.conflicts.index');
            Route::post('sync/conflicts/{id}/resolution', [SyncController::class, 'resolve'])
                ->middleware(['can:approval.decide', 'reauthenticated'])
                ->whereUlid('id')
                ->name('api.sync.conflicts.resolve');
        });
    });
});

<?php

namespace App\Providers;

use App\Application\Authorization\CommandAuthorizer;
use App\Application\CommandBus;
use App\Application\CommandBusProbe;
use App\Application\CommandRegistry;
use App\Application\Contracts\ContractValidator;
use App\Application\NullCommandBusProbe;
use App\Application\TransactionRunner;
use App\Domain\Access\AccessCommands;
use App\Domain\Access\Approvals\ApprovalCommands;
use App\Domain\Billing\BilledExamFeeControl;
use App\Domain\Billing\BillingCommands;
use App\Domain\Cash\CashCommands;
use App\Domain\Clinical\ClinicalCommands;
use App\Domain\Clinical\ExamFeeControl;
use App\Domain\Clinical\UncontrolledExamFee;
use App\Domain\Communication\CommunicationCommands;
use App\Domain\Crm\CrmCommands;
use App\Domain\Documents\DocumentCommands;
use App\Domain\Inventory\InventoryCommands;
use App\Domain\Operations\OperationsCommands;
use App\Domain\Patients\PatientCommands;
use App\Domain\PublicSite\PublicSiteCommands;
use App\Domain\Scheduling\SchedulingCommands;
use App\Domain\Workshop\WorkshopCommands;
use App\Offline\OfflineCommands;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

/**
 * Chemin central des commandes (F07, contrat 23) : registre des commandes, exécuteur de transactions, validateur
 * de contrats, autorisation et bus. Le registre est UNIQUE par application : toute commande y est déclarée une
 * fois, avec son action, ses sources admises et son schéma de contrat.
 */
final class CommandServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CommandRegistry::class);
        $this->app->singleton(ContractValidator::class);

        $this->app->singleton(TransactionRunner::class, static fn (Application $app): TransactionRunner => new TransactionRunner(
            $app->make('db'),
            $app,
            (int) config('eeo.transactions.max_attempts', 3),
            (int) config('eeo.transactions.lock_wait_timeout_seconds', 10),
        ));

        // Droits effectifs relus à chaque requête (EffectivePermissions est lui aussi « scoped »).
        $this->app->scoped(CommandAuthorizer::class);

        // Sonde d'observation des points du chemin : sans effet en production, remplacée par les tests.
        $this->app->bind(CommandBusProbe::class, NullCommandBusProbe::class);

        // Pas de singleton : le bus est reconstruit avec la sonde liée à cet instant.
        $this->app->bind(CommandBus::class);

        // Contrôle du paiement de l'examen. Par défaut (`eeo.billing.exam_fee_control` = « off ») : INACTIF, il répond
        // « non contrôlé » et le dit (UncontrolledExamFee). `billed` branche le contrôle réel (B04) : facture de frais
        // de CETTE visite réglée, ou dérogation exacte de la gérante. Toute autre valeur reste inactive (échec fermé :
        // une faute de frappe n'active jamais un contrôle à moitié configuré). Lu à la résolution, pas au démarrage.
        $this->app->bind(ExamFeeControl::class, static fn (Application $app): ExamFeeControl => BilledExamFeeControl::isActive()
            ? $app->make(BilledExamFeeControl::class)
            : $app->make(UncontrolledExamFee::class));
    }

    public function boot(): void
    {
        $registry = $this->app->make(CommandRegistry::class);

        // Chaque module déclare ici ses commandes ; une commande non enregistrée n'existe pas.
        foreach (AccessCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Approbations exactes (B06) : demande et décision de la gérante.
        foreach (ApprovalCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (PatientCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (ClinicalCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (BillingCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Exploitation (X02) : demande d'un export contrôlé.
        foreach (OperationsCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Documents générés (D01) : dépôt de l'original PDF.
        foreach (DocumentCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (CashCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (InventoryCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Agenda interne (S01) et suivis / tâches de contact internes (S02).
        foreach (SchedulingCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Préparation des postes (O02) : enrôlement, grants signés et révocations, en ligne seulement.
        foreach (OfflineCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // CRM, base de connaissances et communication (L2D03 à L2D08) : opérations en ligne seulement, par la route directe.
        foreach (CrmCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        foreach (CommunicationCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Site public (L3D02) : fiches du showroom, images et contenus publics, approuvés par la gérante.
        foreach (PublicSiteCommands::definitions() as $definition) {
            $registry->register($definition);
        }
        // Atelier optique (L1D04) : création de commande labo, suivi montage/contrôle qualité et bon laboratoire.
        foreach (WorkshopCommands::definitions() as $definition) {
            $registry->register($definition);
        }
    }
}

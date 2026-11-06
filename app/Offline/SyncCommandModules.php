<?php

namespace App\Offline;

use App\Support\Modules;

/**
 * Module propriétaire de chaque commande qu'un poste peut synchroniser (O05 ; M01 « mise en service progressive des
 * modules », `docs/implementation/modules.md`).
 *
 * Sur la route directe, le middleware `module:<code>` ferme la route d'un module non ouvert (404). Un poste n'a pas de
 * route : ses commandes arrivent par `POST /sync/push` et sont appliquées par `SyncDrain`. Sans cette table, la
 * synchronisation serait une porte dérobée vers un module que l'exploitant n'a pas ouvert. `SyncDrain` la consulte AVANT
 * toute dépendance ou tout effet : une commande d'un module fermé n'est jamais appliquée ; elle reste dans l'inbox
 * (aucune perte) et ouvre un conflit durable `MODULE_NOT_ENABLED` (CONFLICT_REQUIRES_REVIEW), que la gérante rejoue
 * (ACCEPT_LOCAL) une fois le module ouvert, ou écarte.
 *
 * Les codes sont ceux du groupe de routes qui porte la même commande en ligne (`routes/api.php`). Un test compare cette
 * table aux commandes du registre acceptant la source SYNC : une commande de poste sans module déclaré fait échouer la CI.
 */
final class SyncCommandModules
{
    /**
     * Nom de la commande → code du module (`Modules::CODES`).
     *
     * @var array<string, string>
     */
    public const OWNERS = [
        // Patients et file du jour.
        'CreatePatient' => 'patients',
        'UpdatePatient' => 'patients',
        'RegisterVisit' => 'today',
        // Examens et prescriptions.
        'StartConsultation' => 'consultations',
        'SaveClinicalStep' => 'consultations',
        'CompleteConsultation' => 'consultations',
        'AmendConsultation' => 'consultations',
        'CreatePrescription' => 'consultations',
        'ValidatePrescription' => 'consultations',
        // Agenda, contrôles et relances.
        'CreateAppointment' => 'agenda',
        'CreateFollowUp' => 'agenda',
        'RecordContactAttempt' => 'agenda',
        // Ventes et caisse.
        'CreateInvoiceDraft' => 'sales',
        'UpdateDraft' => 'sales',
        'IssueInvoice' => 'sales',
        'RegisterPayment' => 'sales',
        'ReversePayment' => 'sales',
        'IssueCreditNote' => 'sales',
        'RefundCredit' => 'sales',
        'ConfirmDelivery' => 'sales',
        'OpenCashSession' => 'sales',
        'CloseCashSession' => 'sales',
        // Stock.
        'RegisterStockMovement' => 'stock',
        'RegisterPhysicalReturn' => 'stock',
        // Approbations (routes du groupe « Paramètres »).
        'RequestApproval' => 'settings',
        'DecideApproval' => 'settings',
    ];

    /** Nom d'affichage du module (celui de la navigation) pour le motif lu par la gérante. */
    private const LABELS = [
        'today' => 'Aujourd’hui',
        'patients' => 'Patients',
        'consultations' => 'Consultations',
        'agenda' => 'Agenda',
        'sales' => 'Ventes et caisse',
        'stock' => 'Stock',
        'settings' => 'Paramètres',
    ];

    /** Code du module propriétaire, ou null si la commande n'est pas déclarée (défaut de câblage, refusé). */
    public static function of(string $commandName): ?string
    {
        return self::OWNERS[$commandName] ?? null;
    }

    /** Vrai si le module de la commande est ouvert par le déploiement ; faux pour une commande sans module déclaré. */
    public static function isOpen(string $commandName): bool
    {
        $module = self::of($commandName);

        return $module !== null && Modules::isEnabled($module);
    }

    /** Motif d'un refus pour un module fermé (ou une commande sans module), sans donnée de la charge. */
    public static function closedMessage(string $commandName): string
    {
        $module = self::of($commandName);
        if ($module === null) {
            return 'La commande « '.$commandName.' » n’a pas de module déclaré pour la synchronisation : elle est conservée, rien n’est appliqué.';
        }

        return 'Le module « '.(self::LABELS[$module] ?? $module).' » n’est pas ouvert sur ce serveur : la commande du poste est conservée, rien n’est appliqué. Elle pourra être rejouée une fois le module ouvert.';
    }
}

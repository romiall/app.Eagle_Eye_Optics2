<?php

namespace App\Domain\Documents;

use App\Application\Effects\ChangeVisibility;
use App\Models\User;

/**
 * Policy des documents générés (D01, fichier 09) par famille de `generated_documents.document_type` :
 *
 *   pièces financières  (facture, reçu, avoir, remboursement, relevé, reprise de solde, devis)
 *                        déposer : invoice.issue ou payment.collect ; télécharger : invoice.read ; classement FINANCIAL ;
 *   documents cliniques (ordonnance optique, fiche de consultation)
 *                        déposer : clinical.complete ; télécharger : clinical.export ; classement MEDICAL.
 *
 * Le bon d'atelier (WORKSHOP, L1) n'a pas encore de Policy : refusé. Une famille n'ouvre jamais l'autre : la caisse
 * ne télécharge pas une ordonnance, le professionnel ne dépose pas une facture sans le droit financier.
 */
final class DocumentPolicy
{
    private const FINANCIAL = ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'REFUND', 'ACCOUNT_STATEMENT', 'LEGACY_BALANCE', 'QUOTE'];

    private const CLINICAL = ['OPTICAL_PRESCRIPTION', 'CLINICAL_RECORD'];

    private const WORKSHOP = ['WORKSHOP'];

    public static function isFinancial(string $type): bool
    {
        return in_array($type, self::FINANCIAL, true);
    }

    public static function isClinical(string $type): bool
    {
        return in_array($type, self::CLINICAL, true);
    }

    public static function isWorkshop(string $type): bool
    {
        return in_array($type, self::WORKSHOP, true);
    }

    public static function mayStore(?User $user, string $type): bool
    {
        if ($user === null) {
            return false;
        }
        if (self::isFinancial($type)) {
            return $user->can('invoice.issue') || $user->can('payment.collect');
        }
        if (self::isWorkshop($type)) {
            return $user->can('workshop.manage');
        }

        return self::isClinical($type) && $user->can('clinical.complete');
    }

    public static function mayDownload(?User $user, string $type): bool
    {
        if ($user === null) {
            return false;
        }
        if (self::isFinancial($type)) {
            return $user->can('invoice.read');
        }
        if (self::isWorkshop($type)) {
            return $user->can('workshop.manage');
        }

        return self::isClinical($type) && $user->can('clinical.export');
    }

    /** Classement du fichier privé (`stored_files.classification`). */
    public static function classification(string $type): string
    {
        return match (true) {
            self::isClinical($type) => 'MEDICAL',
            self::isWorkshop($type) => 'INTERNAL',
            default => 'FINANCIAL',
        };
    }

    public static function visibility(string $type): ChangeVisibility
    {
        return match (true) {
            self::isClinical($type) => ChangeVisibility::Clinical,
            self::isWorkshop($type) => ChangeVisibility::Manager,
            default => ChangeVisibility::Financial,
        };
    }
}

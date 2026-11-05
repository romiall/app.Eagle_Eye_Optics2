<?php

namespace App\Domain\Billing;

use App\Application\CommandDefinition;
use App\Domain\Billing\Catalog\Handlers\CreateCatalogItemHandler;
use App\Domain\Billing\Catalog\Handlers\CreateTaxRuleHandler;
use App\Domain\Billing\Catalog\Handlers\ImportCatalogHandler;
use App\Domain\Billing\Catalog\Handlers\UpdateCatalogItemHandler;
use App\Domain\Billing\Catalog\Handlers\UpdateTaxRuleHandler;
use App\Domain\Billing\Handlers\AbandonInvoiceDraftHandler;
use App\Domain\Billing\Handlers\CreateInvoiceDraftHandler;
use App\Domain\Billing\Handlers\IssueCreditNoteHandler;
use App\Domain\Billing\Handlers\IssueInvoiceHandler;
use App\Domain\Billing\Handlers\RefundCreditHandler;
use App\Domain\Billing\Handlers\RegisterPaymentHandler;
use App\Domain\Billing\Handlers\ReversePaymentHandler;
use App\Domain\Billing\Handlers\UpdateDraftHandler;
use App\Domain\Billing\LegacyBalances\Handlers\ImportLegacyBalancesHandler;
use App\Domain\Billing\LegacyBalances\Handlers\StoreLegacyEvidenceHandler;
use App\Domain\Billing\Quotes\Handlers\ConvertQuoteHandler;
use App\Domain\Billing\Quotes\Handlers\CreateQuoteDraftHandler;
use App\Domain\Billing\Quotes\Handlers\DeleteQuoteDraftHandler;
use App\Domain\Billing\Quotes\Handlers\IssueQuoteHandler;
use App\Domain\Billing\Quotes\Handlers\RecordQuoteDecisionHandler;
use App\Domain\Billing\Quotes\Handlers\ReviseQuoteHandler;
use App\Domain\Billing\Quotes\Handlers\UpdateQuoteDraftHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes de la facturation enregistrées auprès du chemin central (F07), module `sales`.
 *
 * Quatre commandes du catalogue F06, disponibles hors-ligne à terme : `CreateInvoiceDraft`, `UpdateDraft`,
 * `IssueInvoice`, `RegisterPayment` (charge d'un poste validée par `schema`, corps de la route directe par
 * `directSchema`). Elles admettent la source d'un poste dans le registre, comme l'exige le test de conformité au
 * catalogue, mais leurs actions refusent explicitement toute source autre que la route directe tant que les plages
 * de numéros, la propriété des factures et les quotas de stock ne sont pas préparés et jugés (O03, O05). La route
 * directe, la synchronisation et les tâches appellent la MÊME action : seules les entrées propres à l'origine
 * s'ajouteront.
 *
 * Corrections (B07, B08), commandes du catalogue F06 elles aussi : `ReversePayment`, `IssueCreditNote`, `RefundCredit`,
 * chacune avec son approbation exacte (`ExactApprovals`) ; même garde « route directe seulement » pour l'instant.
 *
 * Quatre opérations EN LIGNE seulement (gérante : catalogue et règles fiscales, hors du journal d'un poste) : leur
 * corps est celui de `schemas/requests/http.json`, la clé d'idempotence est exigée par le contrat de l'API.
 */
final class BillingCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $both = [CommandSource::Direct, CommandSource::Sync];
        $onlineOnly = [CommandSource::Direct];

        return [
            new CommandDefinition(
                CreateInvoiceDraftHandler::COMMAND,
                CreateInvoiceDraftHandler::class,
                $both,
                'commands/CreateInvoiceDraft.v1.json',
                true,
                'commands/CreateInvoiceDraft.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                UpdateDraftHandler::COMMAND,
                UpdateDraftHandler::class,
                $both,
                'commands/UpdateDraft.v1.json',
                true,
                'commands/UpdateDraft.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                IssueInvoiceHandler::COMMAND,
                IssueInvoiceHandler::class,
                $both,
                'commands/IssueInvoice.v1.json',
                true,
                'commands/IssueInvoice.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                RegisterPaymentHandler::COMMAND,
                RegisterPaymentHandler::class,
                $both,
                'commands/RegisterPayment.v1.json',
                true,
                'commands/RegisterPayment.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                ReversePaymentHandler::COMMAND,
                ReversePaymentHandler::class,
                $both,
                'commands/ReversePayment.v1.json',
                true,
                'commands/ReversePayment.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                IssueCreditNoteHandler::COMMAND,
                IssueCreditNoteHandler::class,
                $both,
                'commands/IssueCreditNote.v1.json',
                true,
                'commands/IssueCreditNote.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                RefundCreditHandler::COMMAND,
                RefundCreditHandler::class,
                $both,
                'commands/RefundCredit.v1.json',
                true,
                'commands/RefundCredit.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                CreateCatalogItemHandler::COMMAND,
                CreateCatalogItemHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/CatalogItemRequest',
            ),
            new CommandDefinition(
                UpdateCatalogItemHandler::COMMAND,
                UpdateCatalogItemHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/CatalogItemRequest',
            ),
            // Import contrôlé du catalogue (X01) : toutes les lignes ou aucune, en ligne seulement.
            new CommandDefinition(
                ImportCatalogHandler::COMMAND,
                ImportCatalogHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/CatalogImportRequest',
            ),
            // Reprise des créances papier (X01) : justificatif scanné, puis toutes les créances ou aucune, en ligne seulement.
            new CommandDefinition(
                StoreLegacyEvidenceHandler::COMMAND,
                StoreLegacyEvidenceHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/StoreLegacyEvidenceCommand',
            ),
            new CommandDefinition(
                ImportLegacyBalancesHandler::COMMAND,
                ImportLegacyBalancesHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/LegacyBalanceImportRequest',
            ),
            new CommandDefinition(
                CreateTaxRuleHandler::COMMAND,
                CreateTaxRuleHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/TaxRuleRequest',
            ),
            new CommandDefinition(
                UpdateTaxRuleHandler::COMMAND,
                UpdateTaxRuleHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/TaxRuleRequest',
            ),
            // Abandon d'un brouillon (fichier 03) : en ligne seulement, hors du journal d'un poste.
            new CommandDefinition(
                AbandonInvoiceDraftHandler::COMMAND,
                AbandonInvoiceDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/AbandonInvoiceDraftRequest',
            ),
            // Devis versionnés et conversion en brouillon de facture (L1D07) : en ligne seulement, hors du journal d'un
            // poste ; un devis n'est ni une créance ni un encaissement.
            new CommandDefinition(
                CreateQuoteDraftHandler::COMMAND,
                CreateQuoteDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/CreateQuoteDraftRequest',
            ),
            new CommandDefinition(
                UpdateQuoteDraftHandler::COMMAND,
                UpdateQuoteDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/UpdateQuoteDraftRequest',
            ),
            // Suppression d'un brouillon de devis jamais émis (chantier « CRUD des écrans »), en ligne seulement.
            new CommandDefinition(
                DeleteQuoteDraftHandler::COMMAND,
                DeleteQuoteDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/DeleteQuoteDraftRequest',
            ),
            new CommandDefinition(
                IssueQuoteHandler::COMMAND,
                IssueQuoteHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/IssueQuoteRequest',
            ),
            new CommandDefinition(
                ReviseQuoteHandler::COMMAND,
                ReviseQuoteHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/ReviseQuoteRequest',
            ),
            new CommandDefinition(
                RecordQuoteDecisionHandler::COMMAND,
                RecordQuoteDecisionHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/QuoteDecisionRequest',
            ),
            new CommandDefinition(
                ConvertQuoteHandler::COMMAND,
                ConvertQuoteHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/ConvertQuoteRequest',
            ),
        ];
    }
}

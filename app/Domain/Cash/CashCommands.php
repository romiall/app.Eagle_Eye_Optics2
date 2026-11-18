<?php

namespace App\Domain\Cash;

use App\Application\CommandDefinition;
use App\Domain\Cash\Handlers\CloseCashSessionHandler;
use App\Domain\Cash\Handlers\CreatePaymentReconciliationHandler;
use App\Domain\Cash\Handlers\OpenCashSessionHandler;
use App\Domain\Cash\Handlers\RecordCashMovementHandler;
use App\Domain\Cash\Handlers\ReviewCashVarianceHandler;
use App\Domain\Cash\Handlers\SaveExpenseCategoryHandler;
use App\Domain\Cash\Handlers\StoreStatementEvidenceHandler;
use App\Domain\Cash\Handlers\UpdatePaymentReconciliationHandler;
use App\Domain\Cash\Handlers\ValidatePaymentReconciliationHandler;
use App\Domain\Shared\CommandSource;

/**
 * Sessions de caisse (B05) enregistrées auprès du chemin central (F07). Ce sont deux commandes du catalogue F06
 * (charge d'un poste validée par `schema`, corps de la route directe par `directSchema`). Elles admettent la source
 * d'un poste dans le registre, comme l'exige le test de conformité au catalogue, mais leurs actions refusent
 * explicitement toute source autre que la route directe tant que la synchronisation ne les juge pas (O03, O05).
 */
final class CashCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $both = [CommandSource::Direct, CommandSource::Sync];

        return [
            new CommandDefinition(
                OpenCashSessionHandler::COMMAND,
                OpenCashSessionHandler::class,
                $both,
                'commands/OpenCashSession.v1.json',
                true,
                'commands/OpenCashSession.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                CloseCashSessionHandler::COMMAND,
                CloseCashSessionHandler::class,
                $both,
                'commands/CloseCashSession.v1.json',
                true,
                'commands/CloseCashSession.v1.json#/$defs/DirectRequest',
            ),
            // Dépenses (en ligne ou synchronisées depuis un poste préparé) et mouvements hors vente du tiroir (L1D05).
            new CommandDefinition(
                RecordCashMovementHandler::COMMAND,
                RecordCashMovementHandler::class,
                $both,
                'commands/RecordCashMovement.v1.json',
                true,
                'commands/RecordCashMovement.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                SaveExpenseCategoryHandler::COMMAND,
                SaveExpenseCategoryHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/ExpenseCategoryRequest',
            ),
            new CommandDefinition(
                ReviewCashVarianceHandler::COMMAND,
                ReviewCashVarianceHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/CashVarianceReviewRequest',
            ),
            new CommandDefinition(
                StoreStatementEvidenceHandler::COMMAND,
                StoreStatementEvidenceHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/StoreStatementEvidenceCommand',
            ),
            new CommandDefinition(
                CreatePaymentReconciliationHandler::COMMAND,
                CreatePaymentReconciliationHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/SavePaymentReconciliationRequest',
            ),
            new CommandDefinition(
                UpdatePaymentReconciliationHandler::COMMAND,
                UpdatePaymentReconciliationHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/SavePaymentReconciliationRequest',
            ),
            new CommandDefinition(
                ValidatePaymentReconciliationHandler::COMMAND,
                ValidatePaymentReconciliationHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/ValidatePaymentReconciliationRequest',
            ),
        ];
    }
}

<?php

namespace App\Domain\Operations;

use App\Application\CommandDefinition;
use App\Domain\Operations\Handlers\RequestExportHandler;
use App\Domain\Operations\Handlers\SaveIntegrationAccountHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes d'exploitation (X02) : demande d'un export contrôlé, EN LIGNE seulement (l'archive est produite par la
 * tâche planifiée, jamais sur un poste).
 */
final class OperationsCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        return [
            new CommandDefinition(
                RequestExportHandler::COMMAND,
                RequestExportHandler::class,
                [CommandSource::Direct],
                null,
                true,
                'schemas/requests/http.json#/$defs/CreateExportRequest',
            ),
            // Compte d'intégration (L2D01) : en ligne seulement ; les identifiants du fournisseur sont validés et chiffrés par le service.
            new CommandDefinition(
                SaveIntegrationAccountHandler::COMMAND,
                SaveIntegrationAccountHandler::class,
                [CommandSource::Direct],
                null,
                true,
            ),
        ];
    }
}

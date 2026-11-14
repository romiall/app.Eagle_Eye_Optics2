<?php

namespace App\Domain\Workshop;

use App\Application\CommandDefinition;
use App\Domain\Shared\CommandSource;
use App\Domain\Workshop\Handlers\AdvanceWorkshopOrderHandler;
use App\Domain\Workshop\Handlers\CreateWorkshopOrderHandler;

/**
 * Commandes de l'atelier optique (L1D04) exécutées sur le chemin central (en ligne uniquement, clé
 * d'idempotence obligatoire).
 */
final class WorkshopCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $onlineOnly = [CommandSource::Direct];

        return [
            new CommandDefinition(
                CreateWorkshopOrderHandler::COMMAND,
                CreateWorkshopOrderHandler::class,
                $onlineOnly,
                null,
                true,
                CreateWorkshopOrderHandler::REQUEST_SCHEMA,
            ),
            new CommandDefinition(
                AdvanceWorkshopOrderHandler::COMMAND,
                AdvanceWorkshopOrderHandler::class,
                $onlineOnly,
                null,
                true,
                AdvanceWorkshopOrderHandler::REQUEST_SCHEMA,
            ),
        ];
    }
}

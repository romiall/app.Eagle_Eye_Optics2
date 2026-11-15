<?php

namespace App\Domain\Crm;

use App\Application\CommandDefinition;
use App\Domain\Crm\Handlers\ControlConversationHandler;
use App\Domain\Crm\Handlers\LinkProspectPatientHandler;
use App\Domain\Crm\Handlers\ManageKnowledgeHandler;
use App\Domain\Crm\Handlers\SaveProspectContactHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes du CRM et de la base de connaissances (L2D03 à L2D05) enregistrées auprès du chemin central (F07). Ce sont
 * des opérations EN LIGNE seulement (route directe, hors du catalogue des commandes d'un poste) : la clé d'idempotence
 * est obligatoire, le corps est validé contre la requête HTTP de la route par l'action elle-même.
 *
 * Ne sont PAS des commandes : la synchronisation des leads depuis Kommo et le tour de l'assistant, qui appellent un
 * service externe (section « Opérations à appel fournisseur » de `docs/implementation/command-bus.md`).
 */
final class CrmCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $direct = [CommandSource::Direct];

        return [
            new CommandDefinition(SaveProspectContactHandler::COMMAND, SaveProspectContactHandler::class, $direct, null, true),
            new CommandDefinition(LinkProspectPatientHandler::COMMAND, LinkProspectPatientHandler::class, $direct, null, true),
            new CommandDefinition(ControlConversationHandler::HANDOFF, ControlConversationHandler::class, $direct, null, true),
            new CommandDefinition(ControlConversationHandler::RESUME_BOT, ControlConversationHandler::class, $direct, null, true),
            new CommandDefinition(ManageKnowledgeHandler::SAVE_ENTRY, ManageKnowledgeHandler::class, $direct, null, true),
            new CommandDefinition(ManageKnowledgeHandler::CREATE_VERSION, ManageKnowledgeHandler::class, $direct, null, true),
            new CommandDefinition(ManageKnowledgeHandler::APPROVE_VERSION, ManageKnowledgeHandler::class, $direct, null, true),
            new CommandDefinition(ManageKnowledgeHandler::PUBLISH_VERSION, ManageKnowledgeHandler::class, $direct, null, true),
        ];
    }
}

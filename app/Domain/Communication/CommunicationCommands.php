<?php

namespace App\Domain\Communication;

use App\Application\CommandDefinition;
use App\Domain\Communication\Handlers\ManageCampaignHandler;
use App\Domain\Communication\Handlers\ManageMessageTemplateHandler;
use App\Domain\Communication\Handlers\RecordConsentHandler;
use App\Domain\Communication\Handlers\SaveAudienceSegmentHandler;
use App\Domain\Communication\Handlers\SaveReminderPolicyHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes de communication (L2D06 à L2D08) enregistrées auprès du chemin central (F07) : consentements, modèles de
 * messages, politiques de rappel, segments et campagnes. Opérations EN LIGNE seulement (route directe) ; la clé
 * d'idempotence est obligatoire.
 *
 * Ne sont PAS des commandes : l'envoi d'un message, le rattrapage d'une tentative et l'exécution d'une campagne, qui
 * appellent le fournisseur de messagerie hors de toute transaction (section « Opérations à appel fournisseur » de
 * `docs/implementation/command-bus.md`).
 */
final class CommunicationCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $direct = [CommandSource::Direct];

        return [
            new CommandDefinition(RecordConsentHandler::GRANT, RecordConsentHandler::class, $direct, null, true),
            new CommandDefinition(RecordConsentHandler::REVOKE, RecordConsentHandler::class, $direct, null, true),
            new CommandDefinition(ManageMessageTemplateHandler::SAVE_TEMPLATE, ManageMessageTemplateHandler::class, $direct, null, true),
            new CommandDefinition(ManageMessageTemplateHandler::CREATE_VERSION, ManageMessageTemplateHandler::class, $direct, null, true),
            new CommandDefinition(ManageMessageTemplateHandler::APPROVE_VERSION, ManageMessageTemplateHandler::class, $direct, null, true),
            new CommandDefinition(SaveReminderPolicyHandler::COMMAND, SaveReminderPolicyHandler::class, $direct, null, true),
            new CommandDefinition(SaveAudienceSegmentHandler::COMMAND, SaveAudienceSegmentHandler::class, $direct, null, true),
            new CommandDefinition(ManageCampaignHandler::SAVE, ManageCampaignHandler::class, $direct, null, true),
            new CommandDefinition(ManageCampaignHandler::FREEZE, ManageCampaignHandler::class, $direct, null, true),
            new CommandDefinition(ManageCampaignHandler::PAUSE, ManageCampaignHandler::class, $direct, null, true),
        ];
    }
}

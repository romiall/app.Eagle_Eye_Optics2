<?php

namespace App\Domain\Clinical;

use App\Application\CommandDefinition;
use App\Domain\Clinical\Handlers\AmendConsultationHandler;
use App\Domain\Clinical\Handlers\CompleteConsultationHandler;
use App\Domain\Clinical\Handlers\CreatePrescriptionHandler;
use App\Domain\Clinical\Handlers\DeleteConsultationDraftHandler;
use App\Domain\Clinical\Handlers\DeletePrescriptionDraftHandler;
use App\Domain\Clinical\Handlers\SaveClinicalStepHandler;
use App\Domain\Clinical\Handlers\StartConsultationHandler;
use App\Domain\Clinical\Handlers\UpdatePrescriptionDraftHandler;
use App\Domain\Clinical\Handlers\ValidatePrescriptionHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes de la consultation clinique enregistrées auprès du chemin central (F07) : ce sont des commandes du
 * catalogue F06 (charge d'un poste validée par `schema`, corps de la route directe par `directSchema`).
 *
 * C01 : démarrage de l'examen et enregistrement des rubriques ; C02 et C04 : rubriques mesurées et médicaments (mêmes
 * commandes) ; C03 : finalisation et correction ; C04 : prescription optique (création, version, validation).
 * Toutes sont admises pour la source SYNC au catalogue, mais leurs actions REFUSENT toute autre source que la route
 * directe tant que le coffre et les compartiments (O01 à O05) n'existent pas : le refus est explicite (403).
 *
 * `UpdatePrescriptionDraft` n'est PAS une commande du catalogue F06 : modification d'un brouillon en ligne seulement
 * (hors-ligne, une correction est une nouvelle version), sans schéma de commande ; son corps est validé par l'action.
 *
 * `DeleteConsultationDraft` (suppression d'un examen resté brouillon) n'en est pas une non plus : en ligne seulement,
 * comme le démarrage d'un examen, sans charge de poste ; son corps est validé contre sa requête HTTP.
 */
final class ClinicalCommands
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
                StartConsultationHandler::COMMAND,
                StartConsultationHandler::class,
                $both,
                'commands/StartConsultation.v1.json',
                true,
                'commands/StartConsultation.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                SaveClinicalStepHandler::COMMAND,
                SaveClinicalStepHandler::class,
                $both,
                'commands/SaveClinicalStep.v1.json',
                true,
                'commands/SaveClinicalStep.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                CompleteConsultationHandler::COMMAND,
                CompleteConsultationHandler::class,
                $both,
                'commands/CompleteConsultation.v1.json',
                true,
                'commands/CompleteConsultation.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                AmendConsultationHandler::COMMAND,
                AmendConsultationHandler::class,
                $both,
                'commands/AmendConsultation.v1.json',
                true,
                'commands/AmendConsultation.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                CreatePrescriptionHandler::COMMAND,
                CreatePrescriptionHandler::class,
                $both,
                'commands/CreatePrescription.v1.json',
                true,
                'commands/CreatePrescription.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                ValidatePrescriptionHandler::COMMAND,
                ValidatePrescriptionHandler::class,
                $both,
                'commands/ValidatePrescription.v1.json',
                true,
                'commands/ValidatePrescription.v1.json#/$defs/DirectRequest',
            ),
            new CommandDefinition(
                UpdatePrescriptionDraftHandler::COMMAND,
                UpdatePrescriptionDraftHandler::class,
                $onlineOnly,
                null,
                true,
            ),
            new CommandDefinition(
                DeleteConsultationDraftHandler::COMMAND,
                DeleteConsultationDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/DeleteConsultationDraftRequest',
            ),
            new CommandDefinition(
                DeletePrescriptionDraftHandler::COMMAND,
                DeletePrescriptionDraftHandler::class,
                $onlineOnly,
                null,
                true,
                'schemas/requests/http.json#/$defs/DeletePrescriptionDraftRequest',
            ),
        ];
    }
}

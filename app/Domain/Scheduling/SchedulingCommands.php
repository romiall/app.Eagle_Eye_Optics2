<?php

namespace App\Domain\Scheduling;

use App\Application\CommandDefinition;
use App\Domain\Communication\Handlers\RecordContactAttemptHandler;
use App\Domain\Scheduling\Handlers\AddResourceExceptionHandler;
use App\Domain\Scheduling\Handlers\CancelAppointmentHandler;
use App\Domain\Scheduling\Handlers\CancelFollowUpHandler;
use App\Domain\Scheduling\Handlers\CreateAppointmentHandler;
use App\Domain\Scheduling\Handlers\CreateFollowUpHandler;
use App\Domain\Scheduling\Handlers\MarkAppointmentNoShowHandler;
use App\Domain\Scheduling\Handlers\ReplaceOpeningHoursHandler;
use App\Domain\Scheduling\Handlers\RescheduleAppointmentHandler;
use App\Domain\Scheduling\Handlers\SaveAppointmentServiceHandler;
use App\Domain\Scheduling\Handlers\SaveSchedulingResourceHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes de l'agenda interne (S01) et des suivis (S02) enregistrées auprès du chemin central (F07). Trois sont des
 * commandes du catalogue F06 (`CreateAppointment`, `CreateFollowUp`, `RecordContactAttempt` : charge de poste validée
 * par `schema`, corps de la route directe par `directSchema`) ; elles n'acceptent pour l'instant que la route directe
 * (un rendez-vous hors ligne reste une proposition à confirmer, O05). Les autres sont EN LIGNE seulement, hors du
 * catalogue : configuration de la gérante et transitions d'un rendez-vous, corps validé contre sa requête HTTP.
 * Clé d'idempotence obligatoire partout (double clic, coupure : jamais deux rendez-vous ni deux tâches).
 */
final class SchedulingCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $both = [CommandSource::Direct, CommandSource::Sync];
        $direct = [CommandSource::Direct];
        $http = 'schemas/requests/http.json#/$defs/';

        return [
            new CommandDefinition(CreateAppointmentHandler::COMMAND, CreateAppointmentHandler::class, $both,
                'commands/CreateAppointment.v1.json', true, 'commands/CreateAppointment.v1.json#/$defs/DirectRequest'),
            new CommandDefinition(CreateFollowUpHandler::COMMAND, CreateFollowUpHandler::class, $both,
                'commands/CreateFollowUp.v1.json', true, 'commands/CreateFollowUp.v1.json#/$defs/DirectRequest'),
            new CommandDefinition(RecordContactAttemptHandler::COMMAND, RecordContactAttemptHandler::class, $both,
                'commands/RecordContactAttempt.v1.json', true, 'commands/RecordContactAttempt.v1.json#/$defs/DirectRequest'),
            new CommandDefinition(RescheduleAppointmentHandler::COMMAND, RescheduleAppointmentHandler::class, $direct,
                null, true, $http.'RescheduleAppointmentRequest'),
            new CommandDefinition(CancelAppointmentHandler::COMMAND, CancelAppointmentHandler::class, $direct,
                null, true, $http.'CancelAppointmentRequest'),
            // Annulation d'un contrôle recommandé (chantier « CRUD des écrans »), en ligne seulement.
            new CommandDefinition(CancelFollowUpHandler::COMMAND, CancelFollowUpHandler::class, $direct,
                null, true, $http.'CancelFollowUpRequest'),
            new CommandDefinition(MarkAppointmentNoShowHandler::COMMAND, MarkAppointmentNoShowHandler::class, $direct,
                null, true, $http.'MarkAppointmentNoShowRequest'),
            new CommandDefinition(SaveSchedulingResourceHandler::COMMAND, SaveSchedulingResourceHandler::class, $direct,
                null, true, $http.'SchedulingResourceRequest'),
            new CommandDefinition(ReplaceOpeningHoursHandler::COMMAND, ReplaceOpeningHoursHandler::class, $direct,
                null, true, $http.'OpeningHoursRequest'),
            new CommandDefinition(AddResourceExceptionHandler::COMMAND, AddResourceExceptionHandler::class, $direct,
                null, true, $http.'ResourceExceptionRequest'),
            new CommandDefinition(SaveAppointmentServiceHandler::COMMAND, SaveAppointmentServiceHandler::class, $direct,
                null, true, $http.'AppointmentServiceRequest'),
        ];
    }
}

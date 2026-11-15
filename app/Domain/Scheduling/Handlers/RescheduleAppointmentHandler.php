<?php

namespace App\Domain\Scheduling\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Effects\OutboxEvent;
use App\Application\Locking\TransactionLocks;
use App\Domain\Communication\ContactTasks;
use App\Domain\Scheduling\AvailabilityService;
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\CommandContext;
use App\Support\Modules;
use Illuminate\Support\Facades\DB;

/**
 * Déplacement d'un rendez-vous (S01 ; fichier 02 « Une modification met à jour les rappels et conserve la précédente
 * programmation dans le journal ») : nouveau créneau (et ressource facultative) revérifié SOUS verrou, en ignorant le
 * rendez-vous lui-même ; version attendue ; la programmation précédente reste dans l'audit ; les tâches de rappel
 * ouvertes de l'ancienne heure passent `CANCELLED` et celles de la nouvelle sont créées. En ligne seulement.
 */
final class RescheduleAppointmentHandler implements CommandHandler
{
    public const COMMAND = 'RescheduleAppointment';

    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly ContactTasks $tasks,
    ) {}

    public function permissions(): array
    {
        return ['agenda.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $appointment = AppointmentTransitions::locked($command, $context, $locks);
        $timezone = (string) $locks->clinic()->timezone;
        $payload = $command->payload;
        $errors = [];
        $start = SchedulingInput::instant($payload['starts_at'] ?? null, 'starts_at', $errors);
        $end = SchedulingInput::instant($payload['ends_at'] ?? null, 'ends_at', $errors);
        $resourceId = is_string($payload['resource_id'] ?? null) ? (string) $payload['resource_id'] : (string) $appointment->resource_id;
        $resource = DB::table('scheduling_resources')->where('clinic_id', $context->clinicId)->where('id', $resourceId)->first();
        if ($resource === null) {
            $errors['resource_id'][] = 'Ressource de l\'agenda introuvable dans ce cabinet.';
        }
        $service = DB::table('appointment_services')->where('clinic_id', $context->clinicId)->where('id', $appointment->service_id)->first();
        $now = $context->now->utc();
        if ($start !== null && $start->lessThan($now->subMinutes(5))) {
            $errors['starts_at'][] = 'Un rendez-vous ne se déplace pas dans le passé.';
        }
        SchedulingInput::throwIfAny($errors);
        assert($start !== null && $end !== null && $resource !== null && $service !== null);

        $this->availability->assertBookable($context->clinicId, $timezone, $resource, $service, $start, $end, (string) $appointment->id);

        $version = (int) $appointment->version + 1;
        DB::table('appointments')->where('clinic_id', $context->clinicId)->where('id', $appointment->id)->update([
            'resource_id' => $resourceId,
            'starts_at' => SchedulingInput::stamp($start),
            'ends_at' => SchedulingInput::stamp($end),
            'version' => $version,
            'updated_at' => SchedulingInput::stamp($now),
        ]);
        $row = DB::table('appointments')->where('clinic_id', $context->clinicId)->where('id', $appointment->id)->first();
        assert($row !== null);

        $events = Modules::isEnabled('communication') ? [new OutboxEvent(
            'AppointmentRescheduled',
            1,
            'appointments',
            (string) $appointment->id,
            $version,
            [
                'appointment_id' => (string) $appointment->id,
                'patient_id' => $row->patient_id !== null ? (string) $row->patient_id : null,
                'prospect_contact_id' => $row->prospect_contact_id !== null ? (string) $row->prospect_contact_id : null,
                'resource_id' => (string) $row->resource_id,
                'previous_starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                'starts_at' => SchedulingInput::iso((string) $row->starts_at),
                'ends_at' => SchedulingInput::iso((string) $row->ends_at),
            ],
        )] : [];

        return new CommandOutcome(
            result: ['appointment_id' => (string) $appointment->id, 'version' => $version],
            resultType: 'appointments',
            resultId: (string) $appointment->id,
            audit: [new AuditEntry('appointment.rescheduled', 'appointments', (string) $appointment->id, null, [
                'before' => [
                    'resource_id' => (string) $appointment->resource_id,
                    'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                    'ends_at' => SchedulingInput::iso((string) $appointment->ends_at),
                ],
                'after' => [
                    'resource_id' => $resourceId,
                    'starts_at' => $start->format('Y-m-d\TH:i:s.v\Z'),
                    'ends_at' => $end->format('Y-m-d\TH:i:s.v\Z'),
                ],
                'version' => $version,
            ])],
            events: $events,
            changes: [
                new ChangeRecord('appointments', (string) $appointment->id, $version, ChangeVisibility::Administrative, ChangeKind::Updated),
                ...$this->tasks->forAppointment($context->clinicId, $timezone, $row, $now),
            ],
        );
    }
}

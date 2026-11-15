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
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\CommandContext;
use App\Support\Modules;
use Illuminate\Support\Facades\DB;

/**
 * Annulation d'un rendez-vous (S01) : motif obligatoire (3 à 1000 caractères, information d'accueil), version
 * attendue, rien n'est supprimé (statut `CANCELLED`, le créneau se libère). Les tâches de rappel ouvertes passent
 * `CANCELLED` ; un contrôle recommandé programmé par ce rendez-vous redevient `ACTIVE` (le patient reste à revoir).
 * En ligne seulement.
 */
final class CancelAppointmentHandler implements CommandHandler
{
    public const COMMAND = 'CancelAppointment';

    public function __construct(private readonly ContactTasks $tasks) {}

    public function permissions(): array
    {
        return ['agenda.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $appointment = AppointmentTransitions::locked($command, $context, $locks);
        $errors = [];
        $reason = SchedulingInput::reason($command->payload['reason'] ?? null, 3, 1000, 'reason', $errors);
        SchedulingInput::throwIfAny($errors);

        $now = $context->now->utc();
        $stamp = SchedulingInput::stamp($now);
        $version = (int) $appointment->version + 1;
        DB::table('appointments')->where('clinic_id', $context->clinicId)->where('id', $appointment->id)->update([
            'status' => 'CANCELLED',
            'cancel_reason' => $reason,
            'version' => $version,
            'updated_at' => $stamp,
        ]);

        $changes = [
            new ChangeRecord('appointments', (string) $appointment->id, $version, ChangeVisibility::Administrative, ChangeKind::Updated),
            ...$this->tasks->closeOpen($context->clinicId, 'appointment_id', (string) $appointment->id, 'CANCELLED', $now),
            ...FollowUpReopening::reopen($context->clinicId, $appointment, $stamp),
        ];

        $events = Modules::isEnabled('communication') ? [new OutboxEvent(
            'AppointmentCancelled',
            1,
            'appointments',
            (string) $appointment->id,
            $version,
            [
                'appointment_id' => (string) $appointment->id,
                'patient_id' => $appointment->patient_id !== null ? (string) $appointment->patient_id : null,
                'prospect_contact_id' => $appointment->prospect_contact_id !== null ? (string) $appointment->prospect_contact_id : null,
                'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                'cancelled_at' => $now->format('Y-m-d\TH:i:s.v\Z'),
            ],
        )] : [];

        return new CommandOutcome(
            result: ['appointment_id' => (string) $appointment->id, 'version' => $version, 'status' => 'CANCELLED'],
            resultType: 'appointments',
            resultId: (string) $appointment->id,
            audit: [new AuditEntry('appointment.cancelled', 'appointments', (string) $appointment->id, $reason, [
                'previous_status' => (string) $appointment->status,
                'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                'version' => $version,
            ])],
            events: $events,
            changes: $changes,
        );
    }
}

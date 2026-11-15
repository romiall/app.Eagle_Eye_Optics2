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
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Support\Modules;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Absence constatée à un rendez-vous (S01 ; statut « absent » du fichier 02) : seulement une fois l'heure du
 * rendez-vous passée (409 `STATE_TRANSITION_REFUSED` avant), version attendue. Le créneau se libère, les rappels
 * ouverts passent `CANCELLED`, un contrôle recommandé programmé par ce rendez-vous redevient `ACTIVE`. En ligne.
 */
final class MarkAppointmentNoShowHandler implements CommandHandler
{
    public const COMMAND = 'MarkAppointmentNoShow';

    public function __construct(private readonly ContactTasks $tasks) {}

    public function permissions(): array
    {
        return ['agenda.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $appointment = AppointmentTransitions::locked($command, $context, $locks);
        $now = $context->now->utc();
        if ($now->lessThan(CarbonImmutable::parse((string) $appointment->starts_at, 'UTC'))) {
            throw BusinessError::stateRefused('L\'heure du rendez-vous n\'est pas encore passée : l\'absence ne se constate pas à l\'avance.', (string) $appointment->status);
        }

        $stamp = SchedulingInput::stamp($now);
        $version = (int) $appointment->version + 1;
        DB::table('appointments')->where('clinic_id', $context->clinicId)->where('id', $appointment->id)->update([
            'status' => 'NO_SHOW',
            'version' => $version,
            'updated_at' => $stamp,
        ]);

        $events = Modules::isEnabled('communication') ? [new OutboxEvent(
            'AppointmentNoShow',
            1,
            'appointments',
            (string) $appointment->id,
            $version,
            [
                'appointment_id' => (string) $appointment->id,
                'patient_id' => $appointment->patient_id !== null ? (string) $appointment->patient_id : null,
                'prospect_contact_id' => $appointment->prospect_contact_id !== null ? (string) $appointment->prospect_contact_id : null,
                'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                'marked_at' => $now->format('Y-m-d\TH:i:s.v\Z'),
            ],
        )] : [];

        return new CommandOutcome(
            result: ['appointment_id' => (string) $appointment->id, 'version' => $version, 'status' => 'NO_SHOW'],
            resultType: 'appointments',
            resultId: (string) $appointment->id,
            audit: [new AuditEntry('appointment.no_show', 'appointments', (string) $appointment->id, null, [
                'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
                'version' => $version,
            ])],
            events: $events,
            changes: [
                new ChangeRecord('appointments', (string) $appointment->id, $version, ChangeVisibility::Administrative, ChangeKind::Updated),
                ...$this->tasks->closeOpen($context->clinicId, 'appointment_id', (string) $appointment->id, 'CANCELLED', $now),
                ...FollowUpReopening::reopen($context->clinicId, $appointment, $stamp),
            ],
        );
    }
}

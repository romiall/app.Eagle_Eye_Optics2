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
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use App\Support\Modules;
use Illuminate\Support\Facades\DB;

/**
 * Rendez-vous interne (S01, AT23 ; fichier 02 « Le bouton Programmer un RDV choisit service, professionnel/ressource,
 * début et durée, puis confirme ») : un patient du cabinet, une ressource et une prestation actives, un créneau
 * revérifié SOUS le verrou exclusif du cabinet (horaires, exceptions, indisponibilités, autres rendez-vous). Deux
 * réservations concurrentes du même créneau sont sérialisées par ce verrou : la seconde reçoit 409
 * `SLOT_UNAVAILABLE`. Le rendez-vous est `CONFIRMED` à la réponse du serveur — jamais avant : un écran hors ligne ne
 * l'annonce pas confirmé (une proposition hors ligne `PENDING_CONFIRMATION` viendra avec O05).
 *
 * Programmé depuis un contrôle recommandé (`follow_up_id`) : le contrôle du même patient passe `SCHEDULED` et ses
 * tâches de rappel ouvertes `BOOKED` (rendez-vous pris). Les rappels internes du rendez-vous sont calculés (politiques
 * « APPOINTMENT » actives) ; aucun message n'est envoyé. Les prospects (CRM) ne sont pas encore ouverts : un rendez-vous
 * désigne un patient. Verrous : cabinet, idempotence, dossier patient (45), contrôle (48).
 */
final class CreateAppointmentHandler implements CommandHandler
{
    public const COMMAND = 'CreateAppointment';

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
        if ($context->source !== CommandSource::Direct) {
            throw BusinessError::forbidden('Un rendez-vous pris sur un poste hors ligne n\'est pas encore ouvert : il se prend en ligne.');
        }
        $payload = $command->payload;
        $appointmentId = (string) $payload['appointment_id'];
        $clinic = $locks->clinic();
        $timezone = (string) $clinic->timezone;
        $errors = [];

        $patientId = $payload['patient_id'] ?? null;
        if (($payload['prospect_contact_id'] ?? null) !== null) {
            $errors['prospect_contact_id'][] = 'Les rendez-vous de prospects ne sont pas encore ouverts : choisissez un patient.';
        }
        $patient = is_string($patientId) ? $locks->patient($patientId) : null;
        if (! is_string($patientId)) {
            $errors['patient_id'][] = 'Choisissez le patient du rendez-vous.';
        } elseif ($patient === null) {
            $errors['patient_id'][] = 'Patient introuvable dans ce cabinet.';
        } elseif ($patient->archived_at !== null || $patient->merged_into_patient_id !== null) {
            $errors['patient_id'][] = 'Cette fiche est archivée ou fusionnée : ouvrez la fiche patient actuelle.';
        }

        $followUpId = $payload['follow_up_id'] ?? null;
        $plan = null;
        if (is_string($followUpId)) {
            $plan = $locks->followUpPlan($followUpId);
            if ($plan === null) {
                $errors['follow_up_id'][] = 'Contrôle recommandé introuvable dans ce cabinet.';
            } elseif ($plan->patient_id !== $patientId) {
                $errors['follow_up_id'][] = 'Ce contrôle recommandé concerne un autre patient.';
            } elseif (in_array((string) $plan->status, ['CLOSED', 'CANCELLED'], true)) {
                $errors['follow_up_id'][] = 'Ce contrôle recommandé est clos ou annulé.';
            }
        }

        if (DB::table('appointments')->where('id', $appointmentId)->exists()) {
            $errors['appointment_id'][] = 'Cet identifiant de rendez-vous est déjà utilisé.';
        }
        $resource = DB::table('scheduling_resources')->where('clinic_id', $context->clinicId)->where('id', $payload['resource_id'])->first();
        if ($resource === null) {
            $errors['resource_id'][] = 'Ressource de l\'agenda introuvable dans ce cabinet.';
        }
        $service = DB::table('appointment_services')->where('clinic_id', $context->clinicId)->where('id', $payload['service_id'])->first();
        if ($service === null) {
            $errors['service_id'][] = 'Prestation introuvable dans ce cabinet.';
        }
        $start = SchedulingInput::instant($payload['starts_at'] ?? null, 'starts_at', $errors);
        $end = SchedulingInput::instant($payload['ends_at'] ?? null, 'ends_at', $errors);
        $reason = SchedulingInput::text($payload['administrative_reason'] ?? null, 4000, 'administrative_reason', $errors);
        $now = $context->now->utc();
        if ($start !== null && $start->lessThan($now->subMinutes(5))) {
            $errors['starts_at'][] = 'Un rendez-vous ne se prend pas dans le passé.';
        }
        SchedulingInput::throwIfAny($errors);
        assert($resource !== null && $service !== null && $start !== null && $end !== null && is_string($patientId));

        $this->availability->assertBookable($context->clinicId, $timezone, $resource, $service, $start, $end);

        $stamp = SchedulingInput::stamp($now);
        DB::table('appointments')->insert([
            'id' => $appointmentId,
            'clinic_id' => $context->clinicId,
            'patient_id' => $patientId,
            'prospect_contact_id' => null,
            'follow_up_id' => is_string($followUpId) ? $followUpId : null,
            'resource_id' => (string) $resource->id,
            'service_id' => (string) $service->id,
            'starts_at' => SchedulingInput::stamp($start),
            'ends_at' => SchedulingInput::stamp($end),
            'status' => 'CONFIRMED',
            'source' => 'INTERNAL',
            'administrative_reason' => $reason,
            'cancel_reason' => null,
            'created_by' => $context->actorId,
            'version' => 1,
            'created_at' => $stamp,
            'updated_at' => $stamp,
        ]);

        $changes = [new ChangeRecord('appointments', $appointmentId, 1, ChangeVisibility::Administrative, ChangeKind::Created)];
        if ($plan !== null) {
            $planVersion = (int) $plan->version + 1;
            DB::table('follow_up_plans')->where('clinic_id', $context->clinicId)->where('id', $plan->id)->update([
                'status' => 'SCHEDULED',
                'version' => $planVersion,
                'updated_at' => $stamp,
            ]);
            $changes[] = new ChangeRecord('follow_up_plans', (string) $plan->id, $planVersion, ChangeVisibility::Clinical, ChangeKind::Updated);
            $changes = [...$changes, ...$this->tasks->closeOpen($context->clinicId, 'follow_up_id', (string) $plan->id, 'BOOKED', $now)];
        }
        $row = DB::table('appointments')->where('clinic_id', $context->clinicId)->where('id', $appointmentId)->first();
        assert($row !== null);
        $changes = [...$changes, ...$this->tasks->forAppointment($context->clinicId, $timezone, $row, $now)];

        $events = Modules::isEnabled('communication') ? [new OutboxEvent(
            'AppointmentConfirmed',
            1,
            'appointments',
            $appointmentId,
            1,
            [
                'appointment_id' => $appointmentId,
                'patient_id' => $row->patient_id !== null ? (string) $row->patient_id : null,
                'prospect_contact_id' => $row->prospect_contact_id !== null ? (string) $row->prospect_contact_id : null,
                'resource_id' => (string) $row->resource_id,
                'service_id' => (string) $row->service_id,
                'starts_at' => SchedulingInput::iso((string) $row->starts_at),
                'ends_at' => SchedulingInput::iso((string) $row->ends_at),
                'source' => (string) $row->source,
            ],
        )] : [];

        return new CommandOutcome(
            result: ['appointment_id' => $appointmentId, 'version' => 1, 'status' => 'CONFIRMED'],
            resultType: 'appointments',
            resultId: $appointmentId,
            audit: [new AuditEntry('appointment.created', 'appointments', $appointmentId, null, [
                'patient_id' => $patientId,
                'resource_id' => (string) $resource->id,
                'service_id' => (string) $service->id,
                'starts_at' => $start->format('Y-m-d\TH:i:s.v\Z'),
                'ends_at' => $end->format('Y-m-d\TH:i:s.v\Z'),
                'follow_up_id' => is_string($followUpId) ? $followUpId : null,
            ])],
            events: $events,
            changes: $changes,
        );
    }
}

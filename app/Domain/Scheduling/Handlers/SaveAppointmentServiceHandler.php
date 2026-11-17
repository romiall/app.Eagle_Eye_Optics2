<?php

namespace App\Domain\Scheduling\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use Illuminate\Support\Facades\DB;

/**
 * Création (version attendue null) ou modification (version attendue, 409 sinon) d'une prestation réservable de
 * l'agenda (S01) : nom, durée en minutes (saisie par le cabinet, jamais inventée), active ou non, et ouverte ou non à
 * la réservation en ligne (`public_booking`, L3D03 : fermée par défaut, c'est la gérante qui décide quelles prestations
 * le public voit ; champ absent à la modification = inchangé). Une prestation désactivée n'est plus proposée, ni au public
 * ni à l'agenda ; ses rendez-vous existants restent. Aucun prix ici (le catalogue des ventes porte les prix). Gérante
 * seulement (`users.manage`), en ligne seulement.
 */
final class SaveAppointmentServiceHandler implements CommandHandler
{
    public const COMMAND = 'SaveAppointmentService';

    public function permissions(): array
    {
        return ['users.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->source !== CommandSource::Direct) {
            throw BusinessError::forbidden('La configuration de l\'agenda se fait en ligne.');
        }
        $payload = $command->payload;
        $serviceId = (string) $payload['service_id'];
        $errors = [];
        $name = SchedulingInput::text($payload['name'] ?? null, 180, 'name', $errors);
        if (! isset($errors['name']) && ($name === null || mb_strlen($name) < 2)) {
            $errors['name'][] = 'Le nom de la prestation est obligatoire (au moins 2 caractères).';
        }
        $duration = (int) $payload['duration_minutes'];
        $active = (bool) $payload['active'];
        // Absent : fermée à la création, inchangée à la modification (un ancien client ne la rouvre ni ne la ferme).
        $publicBooking = array_key_exists('public_booking', $payload) ? (bool) $payload['public_booking'] : null;
        $stamp = SchedulingInput::stamp($context->now->utc());

        if ($command->expectedVersion === null) {
            if (DB::table('appointment_services')->where('id', $serviceId)->exists()) {
                $errors['service_id'][] = 'Cet identifiant de prestation est déjà utilisé.';
            }
            SchedulingInput::throwIfAny($errors);
            DB::table('appointment_services')->insert([
                'id' => $serviceId,
                'clinic_id' => $context->clinicId,
                'name' => $name,
                'duration_minutes' => $duration,
                'catalog_item_id' => null,
                'active' => $active,
                'public_booking' => $publicBooking ?? false,
                'version' => 1,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);

            return new CommandOutcome(
                result: ['service_id' => $serviceId, 'version' => 1],
                resultType: 'appointment_services',
                resultId: $serviceId,
                audit: [new AuditEntry('agenda.service_created', 'appointment_services', $serviceId, null, ['duration_minutes' => $duration, 'public_booking' => $publicBooking ?? false])],
                changes: [new ChangeRecord('appointment_services', $serviceId, 1, ChangeVisibility::Administrative, ChangeKind::Created)],
            );
        }

        $service = $locks->appointmentService($serviceId);
        if ($service === null) {
            throw BusinessError::notFound('Prestation introuvable dans ce cabinet.');
        }
        if ((int) $service->version !== $command->expectedVersion) {
            throw new BusinessError('VERSION_CONFLICT', 'La prestation a changé depuis l\'affichage : actualisez avant de la modifier.', 409, [], null, [], ['current_version' => (int) $service->version]);
        }
        SchedulingInput::throwIfAny($errors);
        $version = (int) $service->version + 1;
        $nextPublicBooking = $publicBooking ?? (bool) $service->public_booking;
        DB::table('appointment_services')->where('clinic_id', $context->clinicId)->where('id', $serviceId)->update([
            'name' => $name,
            'duration_minutes' => $duration,
            'active' => $active,
            'public_booking' => $nextPublicBooking,
            'version' => $version,
            'updated_at' => $stamp,
        ]);

        return new CommandOutcome(
            result: ['service_id' => $serviceId, 'version' => $version],
            resultType: 'appointment_services',
            resultId: $serviceId,
            audit: [new AuditEntry('agenda.service_updated', 'appointment_services', $serviceId, null, [
                'before' => ['duration_minutes' => (int) $service->duration_minutes, 'active' => (bool) $service->active, 'public_booking' => (bool) $service->public_booking],
                'after' => ['duration_minutes' => $duration, 'active' => $active, 'public_booking' => $nextPublicBooking],
                'version' => $version,
            ])],
            changes: [new ChangeRecord('appointment_services', $serviceId, $version, ChangeVisibility::Administrative, ChangeKind::Updated)],
        );
    }
}

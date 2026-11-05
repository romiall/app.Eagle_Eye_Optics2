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
use App\Domain\Communication\ContactTasks;
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use Illuminate\Support\Facades\DB;

/**
 * Annulation d'un contrôle recommandé (chantier « CRUD des écrans », tranche 3a ; route `POST /follow-ups/{id}/cancel`) :
 * le statut passe `CANCELLED` (valeur déjà admise par le schéma, que la lecture « patients à revoir » exclut d'une
 * période), motif obligatoire (3 à 1 000 caractères, conservé dans l'audit, jamais ailleurs : la table n'a pas de colonne
 * pour lui), version attendue (409 `VERSION_CONFLICT` avec `current_version`). Rien n'est supprimé : le contrôle reste
 * lisible dans la consultation, marqué annulé ; les tâches de rappel ouvertes passent `CANCELLED`.
 *
 * Annulable seulement tant qu'il est `ACTIVE`. Un contrôle `SCHEDULED` a un rendez-vous : le rendez-vous s'annule d'abord
 * (le contrôle redevient `ACTIVE`, le patient reste à revoir) ; un contrôle déjà annulé ou clos : 409
 * `STATE_TRANSITION_REFUSED` avec `details.current_status`.
 *
 * Droit : celui qui programme un contrôle (`follow_up.write`), avec `clinical.read` (le motif du contrôle est clinique,
 * comme à la création : 403 sinon). Commande EN LIGNE seulement (les autres calendriers sont inconnus hors ligne).
 * Verrous : cabinet, idempotence, consultation (47), contrôle recommandé (48).
 */
final class CancelFollowUpHandler implements CommandHandler
{
    public const COMMAND = 'CancelFollowUp';

    public function __construct(private readonly ContactTasks $tasks) {}

    public function permissions(): array
    {
        return ['follow_up.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->source !== CommandSource::Direct) {
            throw BusinessError::forbidden('L\'annulation d\'un contrôle recommandé se fait en ligne : les autres calendriers ne sont pas connus hors ligne.');
        }
        if ($context->user === null || ! $context->user->can('clinical.read')) {
            throw BusinessError::forbidden('Le motif d\'un contrôle recommandé est clinique : la lecture clinique est exigée pour l\'annuler.');
        }

        $planId = (string) $command->payload['follow_up_plan_id'];
        $errors = [];
        $reason = SchedulingInput::reason($command->payload['reason'] ?? null, 3, 1000, 'reason', $errors);
        SchedulingInput::throwIfAny($errors);

        // Ordre des verrous : la consultation (47) avant le contrôle recommandé (48).
        $consultationId = DB::table('follow_up_plans')->where('clinic_id', $context->clinicId)->where('id', $planId)->value('consultation_id');
        if ($consultationId === null) {
            throw BusinessError::notFound('Contrôle recommandé introuvable dans ce cabinet.');
        }
        $locks->consultation((string) $consultationId);
        $plan = $locks->followUpPlan($planId);
        if ($plan === null) {
            throw BusinessError::notFound('Contrôle recommandé introuvable dans ce cabinet.');
        }
        if ($command->expectedVersion === null || (int) $plan->version !== $command->expectedVersion) {
            throw new BusinessError('VERSION_CONFLICT', 'Le contrôle recommandé a changé depuis l\'affichage : il est relu.', 409, [], null, [], ['current_version' => (int) $plan->version]);
        }
        $status = (string) $plan->status;
        if ($status !== 'ACTIVE') {
            throw BusinessError::stateRefused(
                match ($status) {
                    'SCHEDULED' => 'Un rendez-vous est programmé pour ce contrôle : annulez d\'abord le rendez-vous, le contrôle redeviendra actif.',
                    'CANCELLED' => 'Ce contrôle est déjà annulé.',
                    default => 'Ce contrôle est clos : il ne s\'annule plus.',
                },
                $status,
            );
        }

        $now = $context->now->utc();
        $stamp = SchedulingInput::stamp($now);
        $version = (int) $plan->version + 1;
        DB::table('follow_up_plans')->where('clinic_id', $context->clinicId)->where('id', $planId)->update([
            'status' => 'CANCELLED',
            'version' => $version,
            'updated_at' => $stamp,
        ]);

        return new CommandOutcome(
            result: ['follow_up_plan_id' => $planId, 'version' => $version, 'status' => 'CANCELLED'],
            resultType: 'follow_up_plans',
            resultId: $planId,
            // Audit sans texte clinique : le motif d'annulation est une information d'accueil, le reste ce sont des dates.
            audit: [new AuditEntry('follow_up.cancelled', 'follow_up_plans', $planId, $reason, [
                'consultation_id' => (string) $plan->consultation_id,
                'previous_status' => $status,
                'recommended_date' => substr((string) $plan->recommended_date, 0, 10),
                'version' => $version,
            ])],
            changes: [
                new ChangeRecord('follow_up_plans', $planId, $version, ChangeVisibility::Clinical, ChangeKind::Updated),
                ...$this->tasks->closeOpen($context->clinicId, 'follow_up_id', $planId, 'CANCELLED', $now),
            ],
        );
    }
}

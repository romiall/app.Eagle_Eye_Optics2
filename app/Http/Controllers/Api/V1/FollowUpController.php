<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Scheduling\AgendaReader;
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\SchedulingPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

/**
 * Contrôles recommandés (S02), module `agenda` : programmation depuis une consultation (`follow_up.write`, et
 * `clinical.read` vérifié par la commande), liste des patients à revoir d'une période ou des contrôles d'une
 * consultation (`agenda.read`). Le motif, les notes et le motif d'une date manuelle ne sont rendus qu'avec
 * `clinical.read` : l'accueil voit qui rappeler et quand, jamais pourquoi.
 */
final class FollowUpController extends CommandController
{
    public function index(Request $request, AgendaReader $reader): JsonResponse
    {
        $actor = $this->actor($request);
        $errors = [];
        $consultationId = $request->query('consultation_id');
        $from = null;
        $to = null;
        if ($consultationId !== null) {
            if (! is_string($consultationId) || preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/', $consultationId) !== 1) {
                $errors['consultation_id'][] = 'Identifiant invalide.';
            }
        } else {
            $from = SchedulingInput::date($request->query('from'), 'from', $errors);
            $to = SchedulingInput::date($request->query('to'), 'to', $errors);
            if ($from !== null && $to !== null) {
                if ($to->compare($from) < 0) {
                    $errors['to'][] = 'La fin de la période précède son début.';
                } elseif ($to->dayNumber() - $from->dayNumber() + 1 > AgendaReader::MAX_FOLLOW_UP_DAYS) {
                    $errors['to'][] = 'La période couvre au plus '.AgendaReader::MAX_FOLLOW_UP_DAYS.' jours.';
                }
            }
        }
        SchedulingInput::throwIfAny($errors);

        $clinical = $actor->can('clinical.read');
        $rows = $reader->followUps($actor->clinic_id, $from, $to, is_string($consultationId) ? $consultationId : null);

        return new JsonResponse(['data' => array_map(static fn (stdClass $row): array => SchedulingPresenter::followUp($row, $clinical), $rows)]);
    }

    public function store(Request $request, AgendaReader $reader): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        if ($expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null à la création.']]);
        }
        $id = is_string($payload['follow_up_plan_id'] ?? null) ? $payload['follow_up_plan_id'] : null;
        $result = $this->dispatchCommand($request, new Command('CreateFollowUp', $payload, $id, null));

        $actor = $this->actor($request);
        $row = $reader->followUp($actor->clinic_id, (string) $result->resultId);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return new JsonResponse(['data' => SchedulingPresenter::followUp($row, $actor->can('clinical.read'))], 201);
    }

    /**
     * Annulation d'un contrôle recommandé encore actif (en ligne seulement) : rend le contrôle relu après le commit
     * (statut `CANCELLED`), le motif n'étant conservé que dans l'audit.
     */
    public function cancel(Request $request, string $id, AgendaReader $reader): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $errors = [];
        if (($payload['follow_up_plan_id'] ?? null) !== $id) {
            $errors['follow_up_plan_id'] = ['L\'identifiant du contrôle du corps doit être celui de l\'adresse.'];
        }
        if (! $present) {
            $errors['expected_version'] = ['Champ obligatoire absent (version du contrôle).'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $this->dispatchCommand($request, new Command('CancelFollowUp', $payload, $id, $expected));

        $actor = $this->actor($request);
        $row = $reader->followUp($actor->clinic_id, $id);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return new JsonResponse(['data' => SchedulingPresenter::followUp($row, $actor->can('clinical.read'))]);
    }

    private function actor(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return $user;
    }
}

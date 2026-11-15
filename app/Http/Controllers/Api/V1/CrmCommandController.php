<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Crm\CrmMirror;
use App\Domain\Crm\Handlers\ControlConversationHandler;
use App\Domain\Crm\Handlers\LinkProspectPatientHandler;
use App\Domain\Crm\Handlers\SaveProspectContactHandler;
use App\Domain\Crm\ProspectContacts;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\CrmPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Prospects administratifs et prise en charge humaine des conversations (L2D03, L2D05) par le chemin central de
 * commandes (clé d'idempotence obligatoire). Les lectures du CRM, la synchronisation des leads et le tour de l'assistant
 * restent dans `CrmController` et `AssistantHandoffController` : ce sont des lectures ou des opérations à appel externe.
 */
final class CrmCommandController extends CommandController
{
    public function __construct(
        private readonly ProspectContacts $prospects,
        private readonly CrmMirror $mirror,
    ) {}

    public function storeProspect(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveProspectContactHandler::COMMAND);

        return new JsonResponse(['data' => $this->prospect($request, $result->resultId)], 201);
    }

    public function updateProspect(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveProspectContactHandler::COMMAND, $id);

        return new JsonResponse(['data' => $this->prospect($request, $result->resultId)]);
    }

    public function linkPatient(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, LinkProspectPatientHandler::COMMAND, $id);

        return new JsonResponse(['data' => $this->prospect($request, $result->resultId)]);
    }

    public function handoff(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ControlConversationHandler::HANDOFF, $id);

        return new JsonResponse(['data' => $this->conversation($request, $result->resultId)]);
    }

    public function resumeBot(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ControlConversationHandler::RESUME_BOT, $id);

        return new JsonResponse(['data' => $this->conversation($request, $result->resultId)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function prospect(Request $request, ?string $id): array
    {
        $row = $this->prospects->find($this->clinicId($request), (string) $id);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return CrmPresenter::prospect($row);
    }

    /**
     * @return array<string, mixed>
     */
    private function conversation(Request $request, ?string $id): array
    {
        $row = $this->mirror->findConversation($this->clinicId($request), (string) $id);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return CrmPresenter::conversation($row);
    }

    private function clinicId(Request $request): string
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return (string) $user->clinic_id;
    }
}

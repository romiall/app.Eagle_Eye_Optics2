<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Communication\ConsentLedger;
use App\Domain\Communication\Handlers\ManageMessageTemplateHandler;
use App\Domain\Communication\Handlers\RecordConsentHandler;
use App\Domain\Communication\Handlers\SaveReminderPolicyHandler;
use App\Domain\Communication\MessageTemplates;
use App\Domain\Communication\ReminderPolicies;
use App\Http\Controllers\CommandController;
use App\Http\Resources\CommunicationPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Consentements, modèles de messages et politiques de rappel (L2D06, L2D07) par le chemin central de commandes : clé
 * d'idempotence obligatoire, droit `communication.manage`. Les lectures, l'envoi d'un message et le rattrapage d'une
 * tentative (qui appellent le fournisseur) restent dans `CommunicationController`.
 */
final class CommunicationCommandController extends CommandController
{
    public function __construct(
        private readonly ConsentLedger $consents,
        private readonly MessageTemplates $templates,
        private readonly ReminderPolicies $policies,
    ) {}

    public function storeConsent(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, RecordConsentHandler::GRANT);

        return new JsonResponse(['data' => CommunicationPresenter::consent($this->consents->getEvent($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function revokeConsent(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, RecordConsentHandler::REVOKE);

        return new JsonResponse(['data' => CommunicationPresenter::consent($this->consents->getEvent($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function storeTemplate(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageMessageTemplateHandler::SAVE_TEMPLATE);

        return new JsonResponse(['data' => CommunicationPresenter::template($this->templates->getTemplate($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function storeTemplateVersion(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageMessageTemplateHandler::CREATE_VERSION, $id);

        return new JsonResponse(['data' => CommunicationPresenter::templateVersion($this->templates->getVersion($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function approveTemplateVersion(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageMessageTemplateHandler::APPROVE_VERSION, $id);

        return new JsonResponse(['data' => CommunicationPresenter::templateVersion($this->templates->getVersion($this->clinicId($request), (string) $result->resultId))]);
    }

    public function storeReminderPolicy(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveReminderPolicyHandler::COMMAND);

        return new JsonResponse(['data' => CommunicationPresenter::reminderPolicy($this->policies->get($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function updateReminderPolicy(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveReminderPolicyHandler::COMMAND, $id);

        return new JsonResponse(['data' => CommunicationPresenter::reminderPolicy($this->policies->get($this->clinicId($request), (string) $result->resultId))]);
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

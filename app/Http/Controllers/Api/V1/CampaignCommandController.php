<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Communication\AudienceSegments;
use App\Domain\Communication\Campaigns;
use App\Domain\Communication\Handlers\ManageCampaignHandler;
use App\Domain\Communication\Handlers\SaveAudienceSegmentHandler;
use App\Http\Controllers\CommandController;
use App\Http\Resources\CommunicationPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Segments d'audience et campagnes (L2D08) par le chemin central de commandes : clé d'idempotence obligatoire, droit
 * `communication.manage`. L'aperçu (lecture seule) et l'exécution (qui appelle le fournisseur) restent dans
 * `CampaignController` : ce ne sont pas des commandes.
 */
final class CampaignCommandController extends CommandController
{
    public function __construct(
        private readonly AudienceSegments $segments,
        private readonly Campaigns $campaigns,
    ) {}

    public function storeSegment(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveAudienceSegmentHandler::COMMAND);

        return new JsonResponse(['data' => CommunicationPresenter::audienceSegment($this->segments->get($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function updateSegment(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveAudienceSegmentHandler::COMMAND, $id);

        return new JsonResponse(['data' => CommunicationPresenter::audienceSegment($this->segments->get($this->clinicId($request), (string) $result->resultId))]);
    }

    public function storeCampaign(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageCampaignHandler::SAVE);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($this->campaigns->get($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function freezeCampaign(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageCampaignHandler::FREEZE, $id);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($this->campaigns->get($this->clinicId($request), (string) $result->resultId))]);
    }

    public function pauseCampaign(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageCampaignHandler::PAUSE, $id);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($this->campaigns->get($this->clinicId($request), (string) $result->resultId))]);
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

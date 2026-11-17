<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Crm\Handlers\ManageKnowledgeHandler;
use App\Domain\Crm\KnowledgeBase;
use App\Http\Controllers\CommandController;
use App\Http\Resources\CrmPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Base de connaissances gouvernée du cabinet (L2D04) : fiches, révisions brouillons, approbation gérante et publication
 * unique par fiche. Toute écriture passe par le chemin central de commandes (clé d'idempotence obligatoire, droit
 * `communication.manage`) ; le corps est validé par l'action contre la requête HTTP de la route.
 */
final class KnowledgeController extends CommandController
{
    public function __construct(private readonly KnowledgeBase $knowledge) {}

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $result = $this->knowledge->page(
            (string) $actor->clinic_id,
            $request->query('category'),
            $request->query('page'),
        );

        return new JsonResponse([
            'data' => array_map(
                static fn (array $entry): array => CrmPresenter::knowledgeEntry($entry),
                $result['entries'],
            ),
            'meta' => CrmPresenter::pagination($result['page']),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageKnowledgeHandler::SAVE_ENTRY);
        $entry = $this->knowledge->getEntry($this->clinicId($request), (string) $result->resultId);

        return new JsonResponse(['data' => CrmPresenter::knowledgeEntry($entry)], 201);
    }

    public function storeVersion(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageKnowledgeHandler::CREATE_VERSION, $id);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($this->knowledge->getVersion($this->clinicId($request), (string) $result->resultId))], 201);
    }

    public function approveVersion(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageKnowledgeHandler::APPROVE_VERSION, $id);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($this->knowledge->getVersion($this->clinicId($request), (string) $result->resultId))]);
    }

    public function publishVersion(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, ManageKnowledgeHandler::PUBLISH_VERSION, $id);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($this->knowledge->getVersion($this->clinicId($request), (string) $result->resultId))]);
    }

    private function actor(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return $user;
    }

    private function clinicId(Request $request): string
    {
        return (string) $this->actor($request)->clinic_id;
    }
}

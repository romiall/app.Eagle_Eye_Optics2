<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Contracts\ContractValidator;
use App\Domain\Crm\KnowledgeBase;
use App\Http\Controllers\Controller;
use App\Http\Resources\CrmPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Base de connaissances gouvernée du cabinet (L2D04) : fiches, révisions brouillons,
 * approbation gérante et publication unique par fiche.
 */
final class KnowledgeController extends Controller
{
    public function __construct(
        private readonly KnowledgeBase $knowledge,
        private readonly ContractValidator $contracts,
    ) {}

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
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/SaveKnowledgeEntryRequest', $payload);

        $created = $this->knowledge->createEntry((string) $actor->clinic_id, $actor, $payload);

        return new JsonResponse(['data' => CrmPresenter::knowledgeEntry($created)], 201);
    }

    public function storeVersion(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/CreateKnowledgeVersionRequest', $payload);

        $version = $this->knowledge->addVersion((string) $actor->clinic_id, $actor, $id, $payload);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($version)], 201);
    }

    public function approveVersion(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/KnowledgeActionRequest', $payload);

        $reason = isset($payload['reason']) && is_string($payload['reason']) ? $payload['reason'] : null;
        $version = $this->knowledge->approveVersion((string) $actor->clinic_id, $actor, $id, $reason);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($version)]);
    }

    public function publishVersion(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/KnowledgeActionRequest', $payload);

        $reason = isset($payload['reason']) && is_string($payload['reason']) ? $payload['reason'] : null;
        $version = $this->knowledge->publishVersion((string) $actor->clinic_id, $actor, $id, $reason);

        return new JsonResponse(['data' => CrmPresenter::knowledgeVersion($version)]);
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

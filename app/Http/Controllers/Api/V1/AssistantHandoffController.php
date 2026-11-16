<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Contracts\ContractValidator;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Crm\HumanHandoff;
use App\Domain\Crm\LimitedAssistant;
use App\Http\Controllers\Controller;
use App\Http\Middleware\AssignCorrelationId;
use App\Http\Resources\CrmPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

/**
 * Assistant IA borné et historique des exécutions et des transferts (L2D05). Le tour de l'assistant appelle un moteur
 * hors de toute transaction : opération à appel fournisseur, classée comme telle dans MutationRoutesTest. La prise en
 * charge humaine et la reprise par l'assistant sont des commandes (CrmCommandController).
 */
final class AssistantHandoffController extends Controller
{
    public function __construct(
        private readonly LimitedAssistant $assistant,
        private readonly HumanHandoff $handoffs,
        private readonly ContractValidator $contracts,
    ) {}

    public function assistantTurn(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $idempotencyKey = CommunicationRules::assertIdempotencyKey($request->header('Idempotency-Key'));
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/AssistantTurnRequest', $payload);

        $result = $this->assistant->runTurn(
            (string) $actor->clinic_id,
            $actor,
            $id,
            $payload,
            AssignCorrelationId::current($request),
            $idempotencyKey,
        );

        return new JsonResponse(['data' => CrmPresenter::assistantTurnResult($result)]);
    }

    public function handoffs(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $rows = $this->handoffs->listHandoffs((string) $actor->clinic_id, $id);

        return new JsonResponse([
            'data' => array_map(static fn (stdClass $row): array => CrmPresenter::handoff($row), $rows),
        ]);
    }

    public function runs(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $rows = $this->assistant->listRuns((string) $actor->clinic_id, $id);

        return new JsonResponse([
            'data' => array_map(static fn (stdClass $row): array => CrmPresenter::assistantRun($row), $rows),
        ]);
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

<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Contracts\ContractValidator;
use App\Domain\Crm\CrmMirror;
use App\Domain\Crm\ProspectContacts;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\Controller;
use App\Http\Resources\CrmPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

/**
 * Prospects administratifs, miroir Kommo CRM et conversations omnicanales (L2D03).
 */
final class CrmController extends Controller
{
    public function __construct(
        private readonly ProspectContacts $prospects,
        private readonly CrmMirror $mirror,
        private readonly ContractValidator $contracts,
    ) {}

    public function indexProspects(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $result = $this->prospects->page(
            (string) $actor->clinic_id,
            $request->query('query'),
            $request->query('page'),
        );

        return new JsonResponse([
            'data' => array_map(static fn (stdClass $row): array => CrmPresenter::prospect($row), $result['rows']),
            'meta' => CrmPresenter::pagination($result['page']),
        ]);
    }

    public function storeProspect(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/SaveProspectContactRequest', $payload);

        $row = $this->prospects->create((string) $actor->clinic_id, $actor, $payload);

        return new JsonResponse(['data' => CrmPresenter::prospect($row)], 201);
    }

    public function updateProspect(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/UpdateProspectContactRequest', $payload);

        $row = $this->prospects->update((string) $actor->clinic_id, $actor, $id, $payload);

        return new JsonResponse(['data' => CrmPresenter::prospect($row)]);
    }

    public function linkPatient(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/LinkProspectPatientRequest', $payload);

        $row = $this->prospects->linkToPatient(
            (string) $actor->clinic_id,
            $actor,
            $id,
            (string) $payload['patient_id'],
        );

        return new JsonResponse(['data' => CrmPresenter::prospect($row)]);
    }

    public function indexLeads(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $result = $this->mirror->listLeads(
            (string) $actor->clinic_id,
            $request->query('status'),
            $request->query('page'),
        );

        return new JsonResponse([
            'data' => array_map(static fn (stdClass $row): array => CrmPresenter::lead($row), $result['rows']),
            'meta' => CrmPresenter::pagination($result['page']),
        ]);
    }

    public function syncLeads(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/SyncCrmLeadsRequest', $payload);

        $accountId = isset($payload['integration_account_id']) && is_string($payload['integration_account_id'])
            ? $payload['integration_account_id']
            : null;
        $limit = isset($payload['limit']) && is_int($payload['limit']) ? $payload['limit'] : 50;

        $stats = $this->mirror->syncLeads((string) $actor->clinic_id, $actor, $accountId, $limit);

        return new JsonResponse(['data' => $stats]);
    }

    public function indexConversations(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $result = $this->mirror->listConversations(
            (string) $actor->clinic_id,
            $request->query('status'),
            $request->query('page'),
        );

        return new JsonResponse([
            'data' => array_map(static fn (stdClass $row): array => CrmPresenter::conversation($row), $result['rows']),
            'meta' => CrmPresenter::pagination($result['page']),
        ]);
    }

    public function showConversation(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $row = $this->mirror->findConversation((string) $actor->clinic_id, $id);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return new JsonResponse(['data' => CrmPresenter::conversation($row)]);
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

<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Application\Contracts\ContractValidator;
use App\Domain\Access\EffectivePermissions;
use App\Domain\Communication\AudienceSegments;
use App\Domain\Communication\Campaigns;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Http\Resources\CommunicationPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Endpoints API v1 pour les segments d'audience administratifs et les campagnes ciblées (L2D08).
 */
final class CampaignController
{
    private const CAMPAIGN_STATUSES = ['DRAFT', 'APPROVED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'];

    private const RECIPIENT_STATUSES = ['PENDING', 'ELIGIBLE', 'EXCLUDED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'CANCELLED'];

    public function __construct(
        private readonly ContractValidator $contracts,
        private readonly EffectivePermissions $permissions,
        private readonly AudienceSegments $segments,
        private readonly Campaigns $campaigns,
    ) {}

    public function listSegments(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $rows = $this->segments->list((string) $actor->clinic_id);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::audienceSegment(...), $rows),
        ]);
    }

    public function storeSegment(Request $request): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'SaveAudienceSegmentRequest');
        $row = $this->segments->create($context, $body, $key);

        return new JsonResponse(['data' => CommunicationPresenter::audienceSegment($row)], 201);
    }

    public function updateSegment(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'UpdateAudienceSegmentRequest');
        $row = $this->segments->update($context, $id, $body, $key);

        return new JsonResponse(['data' => CommunicationPresenter::audienceSegment($row)]);
    }

    public function listCampaigns(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $filters = array_filter([
            'page' => CommunicationRules::parsePositivePage($request->query('page')),
            'status' => CommunicationRules::parseOptionalEnum('status', $request->query('status'), self::CAMPAIGN_STATUSES, 'Statut de campagne invalide.'),
        ], static fn (mixed $v): bool => $v !== null);

        $result = $this->campaigns->list((string) $actor->clinic_id, $filters);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::campaign(...), $result['items']),
            'meta' => $result['meta'],
        ]);
    }

    public function storeCampaign(Request $request): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'SaveCampaignRequest');
        $row = $this->campaigns->create($context, $body, $key);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($row)], 201);
    }

    public function previewCampaign(Request $request, string $id): JsonResponse
    {
        [$context] = $this->readCommand($request, 'KnowledgeActionRequest', true);
        $preview = $this->campaigns->preview($context, $id);

        return new JsonResponse(['data' => CommunicationPresenter::campaignPreview($preview)]);
    }

    public function freezeCampaign(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'FreezeCampaignRequest', true);
        $row = $this->campaigns->freeze($context, $id, $body, $key);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($row)]);
    }

    public function executeCampaign(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'KnowledgeActionRequest', true);
        $reason = is_string($body['reason'] ?? null) ? $body['reason'] : null;
        $row = $this->campaigns->execute($context, $id, $reason, $key);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($row)]);
    }

    public function pauseCampaign(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'PauseCampaignRequest', true);
        $reason = is_string($body['reason'] ?? null) ? $body['reason'] : null;
        $row = $this->campaigns->pause($context, $id, $reason, $key);

        return new JsonResponse(['data' => CommunicationPresenter::campaign($row)]);
    }

    public function listRecipients(Request $request, string $id): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $filters = array_filter([
            'page' => CommunicationRules::parsePositivePage($request->query('page')),
            'status' => CommunicationRules::parseOptionalEnum('status', $request->query('status'), self::RECIPIENT_STATUSES, 'Statut de destinataire invalide.'),
        ], static fn (mixed $v): bool => $v !== null);

        $result = $this->campaigns->recipients((string) $actor->clinic_id, $id, $filters);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::campaignRecipient(...), $result['items']),
            'meta' => $result['meta'],
        ]);
    }

    private function authorizeCommunication(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }
        if (! $this->permissions->has($user, 'communication.manage')) {
            throw BusinessError::forbidden('Droit communication.manage requis.');
        }

        return $user;
    }

    /**
     * @return array{0: CommandContext, 1: string, 2: array<string, mixed>}
     */
    private function readCommand(Request $request, string $schemaDef, bool $optionalEmpty = false): array
    {
        $actor = $this->authorizeCommunication($request);
        $correlation = $request->attributes->get('correlation_id');
        if (! is_string($correlation) || $correlation === '') {
            $header = $request->header('X-Correlation-Id');
            $correlation = is_string($header) && $header !== '' ? $header : Ulid::generate();
        }

        $key = CommunicationRules::assertIdempotencyKey($request->header('Idempotency-Key'));
        /** @var array<string, mixed> $body */
        $body = $request->json()->all();

        if (! $optionalEmpty || $body !== []) {
            $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/'.$schemaDef, $body);
        }

        return [CommandContext::direct($actor, $correlation), $key, $body];
    }
}

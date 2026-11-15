<?php

namespace App\Http\Controllers;

use App\Domain\Operations\WebhookInboxService;
use App\Http\Resources\IntegrationPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Contrôleur public de réception des webhooks entrants et de vérification du challenge Meta.
 * Aucune session Sanctum requise ; chaque appel entrant est authentifié par signature
 * cryptographique ou jeton secret propre au compte clinique ciblé.
 */
final class PublicWebhookController extends Controller
{
    public function __construct(
        private readonly WebhookInboxService $webhooksService,
        private readonly IntegrationPresenter $presenter,
    ) {}

    public function verifyMeta(Request $request): Response
    {
        $hubMode = $this->queryString($request, ['hub.mode', 'hub_mode']);
        $verifyToken = $this->queryString($request, ['hub.verify_token', 'hub_verify_token']);
        $challenge = $this->queryString($request, ['hub.challenge', 'hub_challenge']);
        $clinicId = $this->queryString($request, ['clinic_id']);
        $accountId = $this->queryString($request, ['account_id']);

        $verifiedChallenge = $this->webhooksService->verifyMetaChallenge(
            $hubMode,
            $verifyToken,
            $challenge,
            $clinicId,
            $accountId,
        );

        return response($verifiedChallenge, 200, [
            'Content-Type' => 'text/plain; charset=UTF-8',
        ]);
    }

    public function ingest(Request $request, string $provider): JsonResponse
    {
        /** @var array<string, string|list<string>|null> $headers */
        $headers = $request->headers->all();
        /** @var array<string, mixed> $query */
        $query = $request->query();

        $result = $this->webhooksService->ingest(
            $provider,
            $request->getContent(),
            $headers,
            $query,
        );

        return response()->json([
            'data' => $this->presenter->webhookIngestResult(
                $result['accepted'],
                $result['duplicate'],
                $result['inbox_id'],
                $result['status'],
            ),
        ], 202);
    }

    /**
     * @param  list<string>  $keys
     */
    private function queryString(Request $request, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $request->query($key);
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return null;
    }
}

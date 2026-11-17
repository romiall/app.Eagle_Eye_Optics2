<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Operations\IntegrationReconciler;
use App\Domain\Operations\WebhookInboxService;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\Controller;
use App\Http\Resources\IntegrationPresenter;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use JsonException;
use stdClass;

/**
 * Contrôleur API v1 d'administration de la boîte de réception webhook et de la réconciliation.
 */
final class WebhookAdminController extends Controller
{
    public function __construct(
        private readonly WebhookInboxService $webhooksService,
        private readonly IntegrationReconciler $reconciler,
        private readonly IntegrationPresenter $presenter,
    ) {}

    public function webhooks(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);

        $page = $this->queryPositiveInt($request, 'page', 1);
        $perPage = $this->queryPerPage($request);
        $status = $request->query('status');

        $result = $this->webhooksService->listForClinic(
            $clinicId,
            $page,
            $perPage,
            is_string($status) ? $status : null,
        );

        return response()->json([
            'data' => array_map(
                fn (stdClass $row): array => $this->presenter->webhookInboxItem($row),
                $result['items'],
            ),
            'meta' => $this->presenter->paginationMeta(
                $result['current_page'],
                $result['per_page'],
                $result['total'],
            ),
        ], 200);
    }

    public function reconcile(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);
        $payload = $this->extractJsonObjectBody($request);

        $unexpected = array_diff(array_keys($payload), ['limit']);
        if ($unexpected !== []) {
            $fields = [];
            foreach ($unexpected as $key) {
                $fields[(string) $key] = ['Propriété non autorisée.'];
            }
            throw BusinessError::validation($fields);
        }

        $limit = 50;
        if (array_key_exists('limit', $payload)) {
            if (! is_int($payload['limit'])) {
                throw BusinessError::validation(['limit' => ['Entier requis entre 1 et 200.']]);
            }
            $limit = $payload['limit'];
        }

        $result = $this->reconciler->reconcile($clinicId, $limit);

        return response()->json([
            'data' => $this->presenter->reconcileResult($result),
        ], 200);
    }

    /**
     * @return array{user: User, clinicId: string}
     */
    private function authorizeManage(Request $request): array
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw BusinessError::forbidden('Authentification requise.');
        }

        if (! $user->can('integration.manage')) {
            throw BusinessError::forbidden('Permission integration.manage requise.');
        }

        return [
            'user' => $user,
            'clinicId' => (string) $user->clinic_id,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function extractJsonObjectBody(Request $request): array
    {
        $raw = trim($request->getContent());
        if ($raw === '') {
            /** @var array<string, mixed> $post */
            $post = $request->request->all();

            return $post;
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw BusinessError::validation(['payload' => ['JSON invalide.']]);
        }

        if (! is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw BusinessError::validation(['payload' => ['Un objet JSON est attendu.']]);
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    private function queryPositiveInt(Request $request, string $name, int $default): int
    {
        $raw = $request->query($name);
        if ($raw === null || $raw === '') {
            return $default;
        }

        if (is_numeric($raw) && (int) $raw >= 1) {
            return (int) $raw;
        }

        throw BusinessError::validation([$name => ['Entier positif attendu.']]);
    }

    private function queryPerPage(Request $request): int
    {
        $raw = $request->query('per_page');
        if ($raw === null || $raw === '') {
            return 25;
        }

        if ((string) $raw === '25') {
            return 25;
        }

        if ((string) $raw === '50') {
            return 50;
        }

        throw BusinessError::validation(['per_page' => ['Valeurs autorisées : 25 ou 50.']]);
    }
}

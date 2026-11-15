<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Operations\IntegrationAccounts;
use App\Domain\Operations\IntegrationHealth;
use App\Domain\Operations\OutboxProcessor;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\Controller;
use App\Http\Resources\IntegrationPresenter;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use JsonException;
use stdClass;

/**
 * Contrôleur API v1 d'administration des comptes d'intégration et de l'outbox clinique.
 */
final class IntegrationController extends Controller
{
    public function __construct(
        private readonly IntegrationHealth $healthService,
        private readonly IntegrationAccounts $accountsService,
        private readonly OutboxProcessor $outboxProcessor,
        private readonly IntegrationPresenter $presenter,
    ) {}

    public function health(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);
        $summary = $this->healthService->summary($clinicId);

        return response()->json([
            'data' => $this->presenter->health($summary),
        ], 200);
    }

    public function accounts(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);
        $rows = $this->accountsService->list($clinicId);

        return response()->json([
            'data' => array_map(
                fn (stdClass $row): array => $this->presenter->account($row),
                $rows,
            ),
        ], 200);
    }

    /**
     * Sonde de connexion : appelle le fournisseur (hors de toute transaction) puis consigne le résultat. Opération à
     * appel fournisseur, classée comme telle dans MutationRoutesTest ; la création et la modification des comptes sont
     * des commandes (IntegrationAccountController).
     */
    public function testAccount(Request $request, string $id): JsonResponse
    {
        ['user' => $user, 'clinicId' => $clinicId] = $this->authorizeManage($request);
        $result = $this->accountsService->testConnection($clinicId, $user, $id);

        return response()->json([
            'data' => $this->presenter->connectionTest(
                $result['account_id'],
                $result['provider'],
                $result['reachable'],
                $result['mode'],
                $result['status'],
                $result['checked_at'],
                $result['detail'],
            ),
        ], 200);
    }

    public function outbox(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);

        $page = $this->queryPositiveInt($request, 'page', 1);
        $perPage = $this->queryPerPage($request);
        $status = $request->query('status');
        $eventType = $request->query('event_type');

        $result = $this->outboxProcessor->listForClinic(
            $clinicId,
            $page,
            $perPage,
            is_string($status) ? $status : null,
            is_string($eventType) ? $eventType : null,
        );

        return response()->json([
            'data' => array_map(
                fn (stdClass $row): array => $this->presenter->outboxEvent($row),
                $result['items'],
            ),
            'meta' => $this->presenter->paginationMeta(
                $result['current_page'],
                $result['per_page'],
                $result['total'],
            ),
        ], 200);
    }

    public function processOutbox(Request $request): JsonResponse
    {
        ['clinicId' => $clinicId] = $this->authorizeManage($request);
        $payload = $this->extractJsonObjectBody($request, allowEmpty: true);

        $unexpected = array_diff(array_keys($payload), ['limit', 'event_types']);
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

        $eventTypes = [];
        if (array_key_exists('event_types', $payload)) {
            if (! is_array($payload['event_types'])) {
                throw BusinessError::validation(['event_types' => ['Liste de types d’événements attendue.']]);
            }
            foreach ($payload['event_types'] as $type) {
                if (! is_string($type) || trim($type) === '') {
                    throw BusinessError::validation(['event_types' => ['Chaque type d’événement doit être une chaîne non vide.']]);
                }
                $eventTypes[] = trim($type);
            }
        }

        $batch = $this->outboxProcessor->processBatch($clinicId, $limit, $eventTypes);

        return response()->json([
            'data' => $this->presenter->outboxBatchResult(
                $batch['processed'],
                $batch['failed'],
                $batch['skipped'],
                $batch['events'],
            ),
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
    private function extractJsonObjectBody(Request $request, bool $allowEmpty = false): array
    {
        $raw = trim($request->getContent());
        if ($raw === '') {
            if ($request->request->all() !== []) {
                /** @var array<string, mixed> $post */
                $post = $request->request->all();

                return $post;
            }

            if ($allowEmpty) {
                return [];
            }

            throw BusinessError::validation(['payload' => ['Corps JSON objet requis.']]);
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

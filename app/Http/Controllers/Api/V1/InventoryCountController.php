<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Inventory\Handlers\TransitionInventoryCountHandler;
use App\Domain\Inventory\InventoryCounts;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Inventaires (L1D02) : ouvrir un périmètre figé, saisir les quantités comptées, terminer, rouvrir, abandonner, et valider
 * (gérante, réauthentifiée : ajustements signés et approuvés). Module `stock`, droit `stock.inventory`. Les écritures
 * passent par le chemin central de commandes (clé d'idempotence obligatoire). Les valeurs (coût, valeur des écarts) ne sortent
 * que pour `stock.valuation.read`. Le comptage ne change JAMAIS le stock : seule la validation écrit des mouvements.
 */
final class InventoryCountController extends CommandController
{
    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        $page = InventoryCounts::page($clinicId, $request->query('status'), $request->query('location_id'), $request->query('page'));

        return new JsonResponse([
            'data' => InventoryCounts::summaries($clinicId, array_values($page->items()), $actor->can('stock.valuation.read')),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return new JsonResponse(['data' => $this->detail($request, $id)]);
    }

    public function store(Request $request): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('OpenInventoryCount', $this->body($request), null, null));

        return new JsonResponse(['data' => $this->detail($request, (string) $result->resultId)], 201);
    }

    /**
     * Saisie des quantités comptées (inventaire ouvert) : aucun mouvement, aucun stock modifié.
     */
    public function record(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('RecordInventoryCounts', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->detail($request, (string) $result->resultId)]);
    }

    public function complete(Request $request, string $id): JsonResponse
    {
        return $this->transition($request, $id, TransitionInventoryCountHandler::COMPLETE);
    }

    public function reopen(Request $request, string $id): JsonResponse
    {
        return $this->transition($request, $id, TransitionInventoryCountHandler::REOPEN);
    }

    public function abandon(Request $request, string $id): JsonResponse
    {
        return $this->transition($request, $id, TransitionInventoryCountHandler::ABANDON);
    }

    /**
     * Validation par la gérante : un mouvement ADJUSTMENT signé par écart non nul, approbation directe, valeur au coût connu.
     */
    public function validateCount(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('ValidateInventoryCount', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->detail($request, (string) $result->resultId)]);
    }

    private function transition(Request $request, string $id, string $name): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command($name, $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->detail($request, (string) $result->resultId)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function body(Request $request): array
    {
        [$payload, $expected, $present] = $this->directBody($request);
        if (! $present || $expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null (champ obligatoire : ces ressources n\'ont pas de version).']]);
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Request $request, string $id): array
    {
        $actor = $this->actor($request);

        return InventoryCounts::detail((string) $actor->clinic_id, $id, $actor->can('stock.valuation.read')) ?? throw BusinessError::notFound('Inventaire introuvable dans ce cabinet.');
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

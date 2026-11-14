<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Inventory\StockAlerts;
use App\Domain\Inventory\StockAvailabilityReader;
use App\Domain\Inventory\StockLocations;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\StockPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Stock (I00, I02) : disponibilités par position et lot, stock initial validé par la gérante, casse et ajustement
 * approuvés. Module `stock`. La réserve de stock n'a PAS de route : c'est un service interne de l'émission d'une
 * facture, consommé par la remise. Les écritures passent par le chemin central de commandes (version de la requête =
 * aucune, clé d'idempotence obligatoire).
 */
final class StockController extends CommandController
{
    public function availability(Request $request, StockAvailabilityReader $reader): JsonResponse
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        $page = $reader->page($clinicId, $request->query('item_id'), $request->query('location_id'), $request->query('page'));
        $positions = array_values($page->items());
        $lots = $reader->lots($clinicId, array_map(static fn (\stdClass $row): string => (string) $row->id, $positions));

        return new JsonResponse([
            'data' => array_map(static fn (\stdClass $row): array => StockPresenter::availability($row, $lots[(string) $row->id] ?? []), $positions),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    /**
     * Emplacements de stock actifs du cabinet (choix de l'emplacement du stock initial, filtre des disponibilités).
     */
    public function locations(Request $request): JsonResponse
    {
        $actor = $this->actor($request);

        return new JsonResponse(['data' => array_map(StockPresenter::location(...), StockLocations::list((string) $actor->clinic_id))]);
    }

    public function opening(Request $request): JsonResponse
    {
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        $result = $this->dispatchCommand($request, new Command('RegisterOpeningStock', $payload, null, null));

        /** @var list<string> $movementIds */
        $movementIds = array_values(array_map('strval', (array) ($result->result['movement_ids'] ?? [])));
        $rows = DB::table('stock_movements')
            ->where('clinic_id', $this->actor($request)->clinic_id)
            ->whereIn('id', $movementIds)
            ->orderBy('movement_position')
            ->orderBy('id')
            ->get();

        return new JsonResponse(['data' => ['movements' => array_map(static fn (\stdClass $row): array => StockPresenter::movement($row), array_values($rows->all()))]], 201);
    }

    /**
     * Casse ou ajustement approuvé (I02) : `POST /stock/movements`, réponse durable de la commande (`StockMovement`),
     * rejouée telle quelle par la même clé d'idempotence.
     */
    public function movement(Request $request): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        if (! $present || $expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null pour un mouvement (champ obligatoire).']]);
        }
        $movementId = is_string($payload['movement_id'] ?? null) ? $payload['movement_id'] : null;

        $result = $this->dispatchCommand($request, new Command('RegisterStockMovement', $payload, $movementId, null));

        return new JsonResponse(['data' => $result->result], 201);
    }

    public function alerts(Request $request): JsonResponse
    {
        $clinicId = (string) $this->actor($request)->clinic_id;
        $page = StockAlerts::page($clinicId, $request->query('status'), $request->query('kind'), $request->query('location_id'), $request->query('page'));

        return new JsonResponse([
            'data' => StockAlerts::presentMany($clinicId, array_values($page->items())),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function evaluateAlerts(Request $request): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('EvaluateStockAlerts', $this->body($request), null, null));

        return new JsonResponse(['data' => $result->result]);
    }

    public function acknowledgeAlert(Request $request, string $id): JsonResponse
    {
        $this->dispatchCommand($request, new Command('AcknowledgeStockAlert', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->alertDetail($request, $id)]);
    }

    public function resolveAlert(Request $request, string $id): JsonResponse
    {
        $this->dispatchCommand($request, new Command('ResolveStockAlert', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->alertDetail($request, $id)]);
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
    private function alertDetail(Request $request, string $id): array
    {
        return StockAlerts::find((string) $this->actor($request)->clinic_id, $id) ?? throw BusinessError::notFound('Alerte de stock introuvable dans ce cabinet.');
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

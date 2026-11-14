<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Shared\BusinessError;
use App\Domain\Workshop\Handlers\AdvanceWorkshopOrderHandler;
use App\Domain\Workshop\Handlers\CreateWorkshopOrderHandler;
use App\Domain\Workshop\WorkshopOrders;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Atelier optique et bon laboratoire (L1D04) : liste filtrée, lignes facturées admissibles, création en ligne
 * avec snapshot anonymisé et journal d'avancement append-only. Module `workshop`, droit `workshop.manage`.
 */
final class WorkshopController extends CommandController
{
    public function __construct(private readonly WorkshopOrders $orders) {}

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $result = $this->orders->page(
            (string) $actor->clinic_id,
            $request->query('status'),
            $request->query('overdue'),
            $request->query('patient_id'),
            $request->query('supplier_id'),
            $request->query('page'),
            CarbonImmutable::now('UTC'),
        );
        $page = $result['page'];

        return new JsonResponse([
            'data' => $result['rows'],
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function eligibleLines(Request $request): JsonResponse
    {
        $actor = $this->actor($request);

        return new JsonResponse([
            'data' => $this->orders->eligibleLines(
                (string) $actor->clinic_id,
                $request->query('q'),
                $request->query('patient_id'),
            ),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);

        return new JsonResponse(['data' => $this->detail($actor, $id)]);
    }

    public function store(Request $request): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        if (! $present || $expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null à la création (champ obligatoire).']]);
        }

        $result = $this->dispatchCommand(
            $request,
            new Command(CreateWorkshopOrderHandler::COMMAND, $payload, null, null),
        );

        return new JsonResponse(['data' => $this->detail($this->actor($request), (string) $result->resultId)], 201);
    }

    public function advance(Request $request, string $id): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $errors = [];
        if (($payload['workshop_order_id'] ?? null) !== $id) {
            $errors['workshop_order_id'] = ['L\'identifiant de la commande atelier du corps doit être celui de l\'adresse.'];
        }
        if (! $present || ! is_int($expected) || $expected < 1) {
            $errors['expected_version'] = ['La version attendue (entier >= 1) est obligatoire.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $result = $this->dispatchCommand(
            $request,
            new Command(AdvanceWorkshopOrderHandler::COMMAND, $payload, $id, $expected),
        );

        return new JsonResponse(['data' => $this->detail($this->actor($request), (string) $result->resultId)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(User $actor, string $id): array
    {
        $order = $this->orders->findDetail((string) $actor->clinic_id, $id, CarbonImmutable::now('UTC'));
        if ($order === null) {
            throw BusinessError::notFound();
        }

        return $order;
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

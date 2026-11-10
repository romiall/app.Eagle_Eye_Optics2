<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Inventory\GoodsReceipts;
use App\Domain\Inventory\Suppliers;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Achats (L1D01) : fournisseurs et réceptions fournisseur. Module `stock`, droit `stock.receive` (les coûts d'achat y
 * figurent : jamais `stock.read`). Les écritures passent par le chemin central de commandes (clé d'idempotence
 * obligatoire) ; la validation d'une réception exige de plus une réauthentification récente (le stock augmente).
 * Un brouillon de réception ne touche jamais au stock : seule la validation écrit lots et mouvements.
 */
final class PurchasingController extends CommandController
{
    public function suppliers(Request $request): JsonResponse
    {
        $actor = $this->actor($request);

        return new JsonResponse(['data' => Suppliers::list((string) $actor->clinic_id, $request->query('active'))]);
    }

    public function storeSupplier(Request $request): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('SaveSupplier', $this->body($request), null, null));

        return new JsonResponse(['data' => $this->supplier($request, (string) $result->resultId)], 201);
    }

    public function updateSupplier(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('SaveSupplier', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->supplier($request, (string) $result->resultId)]);
    }

    public function receipts(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        $page = GoodsReceipts::page($clinicId, $request->query('status'), $request->query('supplier_id'), $request->query('page'));

        return new JsonResponse([
            'data' => GoodsReceipts::summaries($clinicId, array_values($page->items())),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function receipt(Request $request, string $id): JsonResponse
    {
        return new JsonResponse(['data' => $this->receiptDetail($request, $id)]);
    }

    public function storeReceipt(Request $request): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('SaveGoodsReceiptDraft', $this->body($request), null, null));

        return new JsonResponse(['data' => $this->receiptDetail($request, (string) $result->resultId)], 201);
    }

    public function updateReceipt(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('SaveGoodsReceiptDraft', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->receiptDetail($request, (string) $result->resultId)]);
    }

    /**
     * Valide la réception : lots, coûts confirmés, mouvements `RECEIPT` et projections dans une transaction.
     */
    public function validateReceipt(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('ValidateGoodsReceipt', $this->body($request), $id, null));

        return new JsonResponse(['data' => $this->receiptDetail($request, (string) $result->resultId)]);
    }

    public function deleteReceipt(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command('DeleteGoodsReceiptDraft', $this->body($request), $id, null));

        return new JsonResponse(['data' => $result->result]);
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
    private function supplier(Request $request, string $id): array
    {
        return Suppliers::find((string) $this->actor($request)->clinic_id, $id) ?? throw BusinessError::notFound('Fournisseur introuvable dans ce cabinet.');
    }

    /**
     * @return array<string, mixed>
     */
    private function receiptDetail(Request $request, string $id): array
    {
        return GoodsReceipts::detail((string) $this->actor($request)->clinic_id, $id) ?? throw BusinessError::notFound('Réception introuvable dans ce cabinet.');
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

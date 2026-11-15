<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Scheduling\Handlers\DecidePublicBookingHandler;
use App\Http\Controllers\CommandController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Décision de la gérante sur une demande de réservation publique (L2D02) : confirmation ou refus, par le chemin central
 * de commandes (clé d'idempotence obligatoire, droit `agenda.write`). Le dépôt de la demande par le visiteur et la
 * consultation de la liste restent dans `PublicBookingController`.
 */
final class PublicBookingDecisionController extends CommandController
{
    public function confirm(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, DecidePublicBookingHandler::CONFIRM, $id);

        return new JsonResponse(['data' => $result->result]);
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchBody($request, DecidePublicBookingHandler::REJECT, $id);

        return new JsonResponse(['data' => $result->result]);
    }
}

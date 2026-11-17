<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Scheduling\Handlers\SaveCalendarSyncStateHandler;
use App\Http\Controllers\CommandController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Liaison d'un agenda Google à une ressource (L2D02) par le chemin central de commandes (clé d'idempotence
 * obligatoire, droit `integration.manage`). La lecture des états et la synchronisation, qui appelle Google, restent dans
 * `GoogleCalendarController` : une synchronisation n'est pas une commande.
 */
final class CalendarSyncStateController extends CommandController
{
    public function store(Request $request): JsonResponse
    {
        $result = $this->dispatchBody($request, SaveCalendarSyncStateHandler::COMMAND);

        return new JsonResponse(['data' => $result->result], 201);
    }
}

<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Scheduling\CalendarReconciliation;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\Controller;
use App\Http\Middleware\AssignCorrelationId;
use App\Http\Resources\PublicBookingPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Synchronisation Google Calendar par ressource (L2D02) : consultation des états, liaison d'un agenda
 * Google à une ressource et déclenchement d'une synchronisation incrémentale ou complète.
 */
final class GoogleCalendarController extends Controller
{
    public function states(Request $request, CalendarReconciliation $reconciliation): JsonResponse
    {
        $actor = $this->actor($request, ['integration.manage', 'agenda.read']);

        return new JsonResponse([
            'data' => array_map(
                PublicBookingPresenter::syncState(...),
                $reconciliation->listStates((string) $actor->clinic_id),
            ),
        ]);
    }

    /**
     * Synchronisation avec Google : appelle le fournisseur (hors de toute transaction). Opération à appel fournisseur,
     * classée comme telle dans MutationRoutesTest ; la liaison d'un agenda est une commande (CalendarSyncStateController).
     */
    public function sync(Request $request, CalendarReconciliation $reconciliation): JsonResponse
    {
        $actor = $this->actor($request, ['integration.manage', 'agenda.write']);
        $idempotencyKey = $this->requireIdempotencyKey($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        $result = $reconciliation->syncFromHttp(
            actor: $actor,
            correlationId: AssignCorrelationId::current($request),
            idempotencyKey: $idempotencyKey,
            payload: $payload,
        );

        return new JsonResponse(['data' => $result]);
    }

    /**
     * @param  list<string>  $anyPermissions
     */
    private function actor(Request $request, array $anyPermissions): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        foreach ($anyPermissions as $permission) {
            if ($user->hasPermission($permission)) {
                return $user;
            }
        }

        throw BusinessError::forbidden('Droit insuffisant pour accéder à la synchronisation Google Calendar.');
    }

    private function requireIdempotencyKey(Request $request): string
    {
        $raw = $request->header('Idempotency-Key');
        $trimmed = is_string($raw) ? trim($raw) : '';
        if ($trimmed === '') {
            throw BusinessError::validation([
                'Idempotency-Key' => ['En-tête Idempotency-Key obligatoire.'],
            ]);
        }

        return $trimmed;
    }
}

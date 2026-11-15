<?php

namespace App\Http\Controllers;

use App\Domain\Scheduling\PublicBooking;
use App\Domain\Shared\BusinessError;
use App\Http\Middleware\AssignCorrelationId;
use App\Http\Resources\PublicBookingPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Portail public de prise de rendez-vous (`/public/v1/*`, sans authentification) et traitement
 * back-office des demandes (`/api/v1/public-bookings*`).
 */
final class PublicBookingController extends Controller
{
    public function services(Request $request, PublicBooking $booking): JsonResponse
    {
        $clinicId = $booking->resolvePublicClinicId($this->explicitClinicId($request));

        return new JsonResponse([
            'data' => array_map(
                PublicBookingPresenter::service(...),
                $booking->listServices($clinicId),
            ),
        ]);
    }

    public function slots(Request $request, PublicBooking $booking): JsonResponse
    {
        $clinicId = $booking->resolvePublicClinicId($this->explicitClinicId($request));
        $serviceId = is_string($request->query('service_id')) && trim($request->query('service_id')) !== ''
            ? trim($request->query('service_id'))
            : null;
        $from = is_string($request->query('from')) ? $request->query('from') : null;
        $to = is_string($request->query('to')) ? $request->query('to') : null;

        return new JsonResponse([
            'data' => array_map(
                PublicBookingPresenter::slot(...),
                $booking->listSlots($clinicId, $serviceId, $from, $to),
            ),
        ]);
    }

    public function store(Request $request, PublicBooking $booking): JsonResponse
    {
        $clinicId = $booking->resolvePublicClinicId($this->explicitClinicId($request));
        $idempotencyKey = $this->requireIdempotencyKey($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        $receipt = $booking->requestBooking(
            clinicId: $clinicId,
            payload: $payload,
            requestKey: $idempotencyKey,
            correlationId: AssignCorrelationId::current($request),
        );

        return new JsonResponse(['data' => PublicBookingPresenter::receipt($receipt)], 201);
    }

    public function index(Request $request, PublicBooking $booking): JsonResponse
    {
        $actor = $this->actor($request, ['agenda.read', 'communication.manage']);
        $status = is_string($request->query('status')) && trim($request->query('status')) !== ''
            ? trim($request->query('status'))
            : null;

        $page = $booking->listRequests((string) $actor->clinic_id, $status, $request->query('page'));

        return new JsonResponse([
            'data' => array_map(PublicBookingPresenter::adminItem(...), $page->items()),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function confirm(Request $request, PublicBooking $booking, string $id): JsonResponse
    {
        $actor = $this->actor($request, ['agenda.write']);
        $idempotencyKey = $this->requireIdempotencyKey($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        $item = $booking->confirmRequest(
            actor: $actor,
            bookingId: $id,
            correlationId: AssignCorrelationId::current($request),
            idempotencyKey: $idempotencyKey,
            payload: $payload,
        );

        return new JsonResponse(['data' => $item]);
    }

    public function reject(Request $request, PublicBooking $booking, string $id): JsonResponse
    {
        $actor = $this->actor($request, ['agenda.write']);
        $idempotencyKey = $this->requireIdempotencyKey($request);
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        $item = $booking->rejectRequest(
            actor: $actor,
            bookingId: $id,
            correlationId: AssignCorrelationId::current($request),
            idempotencyKey: $idempotencyKey,
            payload: $payload,
        );

        return new JsonResponse(['data' => $item]);
    }

    private function explicitClinicId(Request $request): ?string
    {
        $query = $request->query('clinic_id');
        if (is_string($query) && trim($query) !== '') {
            return trim($query);
        }

        $header = $request->header('X-Clinic-Id');

        return is_string($header) && trim($header) !== '' ? trim($header) : null;
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

        throw BusinessError::forbidden('Droit insuffisant pour traiter les demandes de réservation.');
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

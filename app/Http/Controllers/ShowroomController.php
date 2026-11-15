<?php

namespace App\Http\Controllers;

use App\Domain\PublicSite\Publications;
use App\Domain\PublicSite\PublicContents;
use App\Domain\Scheduling\PublicBooking;
use App\Domain\Shared\BusinessError;
use App\Support\Files\PrivateFiles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Showroom et contenus publics (`/public/v1/*`, L3D02), lus SANS compte : seules les références PUBLIÉES et les contenus
 * APPROUVÉS par la gérante sortent de l'application, par une liste blanche de champs. Aucun prix d'achat, aucun stock,
 * aucune référence interne, aucune donnée de patient. Réponses mises en cache brièvement (lecture seule) ; un module
 * « communication » fermé répond 404 comme une route inexistante.
 */
final class ShowroomController extends Controller
{
    public function __construct(
        private readonly Publications $publications,
        private readonly PublicContents $contents,
        private readonly PublicBooking $booking,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $clinicId = $this->clinicId($request);
        $page = $this->publications->publicPage($clinicId, $request->query('style'), $request->query('brand'), $request->query('page'));

        return $this->cached(new JsonResponse([
            'data' => $this->publications->presentPublic($clinicId, array_values($page->items())),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
            'facets' => $this->publications->publicFacets($clinicId),
        ]));
    }

    public function show(Request $request, string $slug): JsonResponse
    {
        $clinicId = $this->clinicId($request);
        $row = $this->publications->publicBySlug($clinicId, $slug);
        if ($row === null) {
            throw BusinessError::notFound('Cette référence n\'est pas publiée.');
        }

        return $this->cached(new JsonResponse(['data' => $this->publications->presentPublic($clinicId, [$row])[0]]));
    }

    public function contents(Request $request): JsonResponse
    {
        return $this->cached(new JsonResponse(['data' => $this->contents->publicList($this->clinicId($request))]));
    }

    public function media(Request $request, string $id): Response
    {
        $media = $this->publications->publicMedia($this->clinicId($request), $id);
        $bytes = $media !== null ? PrivateFiles::read((string) $media->private_path) : null;
        if ($media === null || $bytes === null || hash('sha256', $bytes) !== (string) $media->sha256) {
            throw BusinessError::notFound('Image introuvable.');
        }

        return $this->cached(new Response($bytes, 200, ['Content-Type' => (string) $media->mime_type, 'Content-Disposition' => 'inline']));
    }

    private function clinicId(Request $request): string
    {
        $query = $request->query('clinic_id');
        $header = $request->header('X-Clinic-Id');
        $explicit = is_string($query) && trim($query) !== '' ? trim($query) : (is_string($header) && trim($header) !== '' ? trim($header) : null);

        return $this->booking->resolvePublicClinicId($explicit);
    }

    /**
     * @template T of \Symfony\Component\HttpFoundation\Response
     *
     * @param  T  $response
     * @return T
     */
    private function cached($response)
    {
        $seconds = max(0, (int) config('eeo.public_site.cache_seconds', 300));
        $response->headers->set('Cache-Control', $seconds > 0 ? 'public, max-age='.$seconds : 'no-store');

        return $response;
    }
}

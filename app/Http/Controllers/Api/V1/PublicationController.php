<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\PublicSite\Handlers\AttachCatalogMediaHandler;
use App\Domain\PublicSite\Handlers\ChangeCatalogPublicationStatusHandler;
use App\Domain\PublicSite\Handlers\RemoveCatalogMediaHandler;
use App\Domain\PublicSite\Handlers\SaveCatalogPublicationHandler;
use App\Domain\PublicSite\MediaFiles;
use App\Domain\PublicSite\Publications;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use App\Support\Files\PrivateFiles;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Fiches du showroom et leurs images (L3D02), module « communication », droit `site.publish` (gérante). Toute écriture
 * passe par le chemin central de commandes (clé d'idempotence obligatoire) ; publier et retirer exigent une
 * réauthentification récente (la route). L'image arrive en octets bruts : le contrôleur contrôle le vrai format et écrit
 * le fichier PRIVÉ, puis la commande le rattache à la fiche avec sa note de droits.
 */
final class PublicationController extends CommandController
{
    public function __construct(private readonly Publications $publications) {}

    public function index(Request $request): JsonResponse
    {
        $clinicId = $this->clinicId($request);
        $page = $this->publications->adminPage($clinicId, $request->query('status'), $request->query('page'));

        return new JsonResponse([
            'data' => $this->publications->presentAdmin($clinicId, array_values($page->items())),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $result = $this->dispatchCommand($request, new Command(SaveCatalogPublicationHandler::COMMAND, $payload, null, $expected));

        return new JsonResponse(['data' => $this->one($request, (string) $result->resultId)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $result = $this->dispatchCommand($request, new Command(SaveCatalogPublicationHandler::COMMAND, $payload, $id, $expected));

        return new JsonResponse(['data' => $this->one($request, (string) $result->resultId)]);
    }

    public function status(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $result = $this->dispatchCommand($request, new Command(ChangeCatalogPublicationStatusHandler::COMMAND, $payload, $id, $expected));

        return new JsonResponse(['data' => $this->one($request, (string) $result->resultId)]);
    }

    public function attachMedia(Request $request, string $id): JsonResponse
    {
        $clinicId = $this->clinicId($request);
        $this->publications->adminRow($clinicId, $id);

        $bytes = (string) $request->getContent();
        $checked = MediaFiles::inspect($bytes, (int) config('eeo.public_site.max_media_bytes', 3145728));
        $announced = strtolower(trim(explode(';', (string) $request->header('Content-Type'))[0]));
        if ($announced !== $checked['mime']) {
            throw BusinessError::validation(['file' => ['Le type annoncé ne correspond pas au contenu de l\'image.']]);
        }
        $path = MediaFiles::pathFor($clinicId, $checked['sha256'], $checked['extension']);
        PrivateFiles::write($path, $bytes);

        $order = $request->query('display_order');
        $this->dispatchCommand($request, new Command(AttachCatalogMediaHandler::COMMAND, [
            'alt_text' => $request->query('alt_text'),
            'rights_note' => $request->query('rights_note'),
            'display_order' => is_string($order) && ctype_digit($order) ? (int) $order : 0,
            'private_path' => $path,
            'mime_type' => $checked['mime'],
            'size_bytes' => $checked['size'],
            'sha256' => $checked['sha256'],
        ], $id, null));

        return new JsonResponse(['data' => $this->one($request, $id)], 201);
    }

    public function removeMedia(Request $request, string $id, string $mediaId): JsonResponse
    {
        if (! $this->publications->mediaBelongsTo($this->clinicId($request), $id, $mediaId)) {
            throw BusinessError::notFound('Image introuvable sur cette fiche.');
        }
        $this->dispatchCommand($request, new Command(RemoveCatalogMediaHandler::COMMAND, [], $mediaId, null));

        return new JsonResponse(['data' => $this->one($request, $id)]);
    }

    /**
     * L'image d'une fiche pour la gérante, brouillon compris (aperçu avant publication).
     */
    public function mediaFile(Request $request, string $mediaId): Response
    {
        $media = $this->publications->adminMedia($this->clinicId($request), $mediaId);
        $bytes = $media !== null ? PrivateFiles::read((string) $media->private_path) : null;
        if ($media === null || $bytes === null || hash('sha256', $bytes) !== (string) $media->sha256) {
            throw BusinessError::notFound('Image introuvable ou altérée : elle n\'est pas servie.');
        }

        return new Response($bytes, 200, ['Content-Type' => (string) $media->mime_type, 'Content-Disposition' => 'inline']);
    }

    /**
     * @return array<string, mixed>
     */
    private function one(Request $request, string $id): array
    {
        $clinicId = $this->clinicId($request);

        return $this->publications->presentAdmin($clinicId, [$this->publications->adminRow($clinicId, $id)])[0];
    }

    private function clinicId(Request $request): string
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return (string) $user->clinic_id;
    }
}

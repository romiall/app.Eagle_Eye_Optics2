<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\PublicSite\Handlers\ChangePublicContentStatusHandler;
use App\Domain\PublicSite\Handlers\SavePublicContentHandler;
use App\Domain\PublicSite\PublicContents;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Contenus publics limités (L3D02), module « communication », droit `site.publish` (gérante) : un texte par code
 * (accueil, expertises, horaires, localisation, WhatsApp, réseaux, contact), en brouillon puis publié par la gérante.
 * Écritures par le chemin central de commandes (clé d'idempotence obligatoire) ; publier exige une réauthentification
 * récente (la route).
 */
final class PublicContentController extends CommandController
{
    public function __construct(private readonly PublicContents $contents) {}

    public function index(Request $request): JsonResponse
    {
        return new JsonResponse(['data' => $this->contents->adminList($this->clinicId($request))]);
    }

    public function store(Request $request): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $result = $this->dispatchCommand($request, new Command(SavePublicContentHandler::COMMAND, $payload, null, $expected));

        return new JsonResponse(['data' => $this->one($request, (string) $result->resultId)], 201);
    }

    public function status(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $result = $this->dispatchCommand($request, new Command(ChangePublicContentStatusHandler::COMMAND, $payload, $id, $expected));

        return new JsonResponse(['data' => $this->one($request, (string) $result->resultId)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function one(Request $request, string $id): array
    {
        $row = $this->contents->find($this->clinicId($request), $id);
        if ($row === null) {
            throw BusinessError::notFound('Contenu introuvable dans ce cabinet.');
        }

        return PublicContents::present($row);
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

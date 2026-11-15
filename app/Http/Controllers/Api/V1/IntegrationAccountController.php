<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Operations\Handlers\SaveIntegrationAccountHandler;
use App\Domain\Operations\IntegrationAccounts;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\IntegrationPresenter;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use JsonException;
use stdClass;

/**
 * Comptes d'intégration (L2D01) : création et modification, par le chemin central de commandes (clé d'idempotence
 * obligatoire, droit `integration.manage`, réauthentification récente exigée par la route). Les lectures, la sonde de
 * connexion et l'outbox restent dans `IntegrationController` : ce ne sont pas des commandes. Aucun identifiant du
 * fournisseur n'est jamais rendu.
 */
final class IntegrationAccountController extends CommandController
{
    public function __construct(
        private readonly IntegrationAccounts $accounts,
        private readonly IntegrationPresenter $presenter,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command(SaveIntegrationAccountHandler::COMMAND, $this->objectBody($request)));

        return response()->json(['data' => $this->presenter->account($this->account($request, (string) $result->resultId))], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $result = $this->dispatchCommand($request, new Command(SaveIntegrationAccountHandler::COMMAND, $this->objectBody($request), $id));

        return response()->json(['data' => $this->presenter->account($this->account($request, (string) $result->resultId))], 200);
    }

    private function account(Request $request, string $accountId): stdClass
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw BusinessError::forbidden('Authentification requise.');
        }

        return $this->accounts->require((string) $user->clinic_id, $accountId);
    }

    /**
     * @return array<string, mixed>
     */
    private function objectBody(Request $request): array
    {
        $raw = trim($request->getContent());
        if ($raw === '') {
            if ($request->request->all() !== []) {
                /** @var array<string, mixed> $post */
                $post = $request->request->all();

                return $post;
            }

            throw BusinessError::validation(['payload' => ['Corps JSON objet requis.']]);
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw BusinessError::validation(['payload' => ['JSON invalide.']]);
        }

        if (! is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw BusinessError::validation(['payload' => ['Un objet JSON est attendu.']]);
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }
}

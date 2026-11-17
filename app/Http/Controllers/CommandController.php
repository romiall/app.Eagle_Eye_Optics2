<?php

namespace App\Http\Controllers;

use App\Application\Command;
use App\Application\CommandBus;
use App\Application\CommandResult;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Http\Middleware\AssignCorrelationId;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;

/**
 * Route directe → chemin central de commandes (F07). Un contrôleur de mutation ne verrouille rien, ne calcule
 * rien et n'ouvre aucune transaction : il construit la commande, la confie au bus et rend le résultat.
 *
 * Le contexte est celui du compte connecté (droits ACTUELS, relus sous le verrou du cabinet) avec la
 * corrélation de la requête. La clé d'idempotence est l'en-tête `Idempotency-Key` : obligatoire pour les
 * commandes qui l'exigent (le bus répond alors VALIDATION_FAILED), rejouée à l'identique si la première
 * réponse s'est perdue, refusée si elle est renvoyée avec un contenu différent.
 *
 * Classe abstraite plutôt que trait : l'analyse statique vérifie ce chemin même avant le premier contrôleur
 * métier qui en hérite (un trait sans utilisateur n'est pas analysé).
 */
abstract class CommandController extends Controller
{
    /**
     * Corps de la route directe : la charge de la commande et `expected_version` (entier, null ou absent). Le
     * type de la version est contrôlé ici ; sa présence et son sens (null à la création, entier ≥ 1 sinon) le
     * sont par le schéma `DirectRequest` de la commande, que le bus applique.
     *
     * @return array{0: array<string, mixed>, 1: int|null, 2: bool} charge, version attendue, `expected_version` présent
     */
    protected function directBody(Request $request): array
    {
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $present = array_key_exists('expected_version', $payload);
        $expected = $payload['expected_version'] ?? null;
        unset($payload['expected_version']);
        if ($expected !== null && ! is_int($expected)) {
            throw BusinessError::validation(['expected_version' => ['La version attendue est un entier ou null.']]);
        }

        return [$payload, $expected, $present];
    }

    /**
     * Route de mutation dont le corps JSON est la charge de la commande, sans version attendue (création ou transition
     * d'état) : un `expected_version` du corps reste dans la charge, que l'action lit elle-même.
     *
     * @param  string|null  $entityId  agrégat visé (identifiant de la route), nul pour une création
     */
    protected function dispatchBody(Request $request, string $name, ?string $entityId = null): CommandResult
    {
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();

        return $this->dispatchCommand($request, new Command($name, $payload, $entityId));
    }

    protected function dispatchCommand(Request $request, Command $command): CommandResult
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        $header = $request->header('Idempotency-Key');
        $key = is_string($header) && trim($header) !== '' ? trim($header) : null;

        return app(CommandBus::class)->dispatch(
            $command,
            CommandContext::direct($user, AssignCorrelationId::current($request)),
            $key,
        );
    }
}

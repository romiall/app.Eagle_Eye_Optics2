<?php

namespace App\Application;

use App\Application\Contracts\ContractValidator;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Models\User;

/**
 * Action du chemin central qui confie l'écriture à un service du domaine existant (L2 : intégrations, CRM, communication,
 * réservations publiques). Le chemin central a déjà pris le verrou du cabinet, contrôlé les droits sous ce verrou et
 * réservé la clé d'idempotence : le service est appelé SANS clé (c'est le bus qui rejoue une réponse perdue) et se joint
 * à la transaction du bus (`TransactionRunner::joinOrRun`), il n'en ouvre pas une seconde. Le service écrit lui-même son
 * audit : la sortie `audit` de l'action reste vide.
 *
 * Aucun appel externe ici (messagerie, Google, Kommo) : une opération qui appelle un fournisseur n'est PAS une commande
 * (section « Opérations à appel fournisseur » de `docs/implementation/command-bus.md`).
 *
 * Le résultat stocké pour le rejeu est la référence de l'agrégat (`['id' => …]`) : jamais une ligne entière, qui pourrait
 * porter un secret ou une destination chiffrée. Le contrôleur relit l'agrégat pour répondre.
 */
abstract class ServiceCommandHandler implements CommandHandler
{
    public function __construct(protected readonly ContractValidator $contracts) {}

    /**
     * Corps de la route contre la requête HTTP du contrat (`schemas/requests/http.json`).
     *
     * @param  array<string, mixed>  $payload
     */
    protected function assertRequest(string $definition, array $payload): void
    {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/'.$definition, $payload);
    }

    protected function actor(CommandContext $context): User
    {
        if ($context->user === null) {
            throw BusinessError::forbidden('Cette action exige un compte connecté.');
        }

        return $context->user;
    }

    protected static function done(string $type, string $id): CommandOutcome
    {
        return new CommandOutcome(result: ['id' => $id], resultType: $type, resultId: $id);
    }

    /**
     * Motif facultatif d'une approbation, d'une publication, d'une pause ou d'une reprise.
     *
     * @param  array<string, mixed>  $payload
     */
    protected static function reasonOf(array $payload): ?string
    {
        return isset($payload['reason']) && is_string($payload['reason']) ? $payload['reason'] : null;
    }
}

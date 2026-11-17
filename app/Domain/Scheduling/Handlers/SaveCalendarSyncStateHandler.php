<?php

namespace App\Domain\Scheduling\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Scheduling\CalendarReconciliation;
use App\Domain\Shared\CommandContext;

/**
 * Liaison d'un agenda Google à une ressource de l'agenda interne (L2D02), droit `integration.manage`. Elle ne fait
 * AUCUN appel à Google : elle enregistre seulement l'état de synchronisation (le jeton de synchronisation reste chiffré
 * et n'est jamais rendu). La synchronisation elle-même est une opération à appel fournisseur, hors du chemin central.
 */
final class SaveCalendarSyncStateHandler extends ServiceCommandHandler
{
    public const COMMAND = 'SaveCalendarSyncState';

    public function __construct(ContractValidator $contracts, private readonly CalendarReconciliation $reconciliation)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['integration.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $state = $this->reconciliation->saveState(
            actor: $this->actor($context),
            correlationId: $context->correlationId,
            idempotencyKey: null,
            payload: $command->payload,
            now: $context->now,
        );

        // L'état présenté ne porte aucun secret (le jeton chiffré n'en fait pas partie) : il est rendu tel quel.
        return new CommandOutcome(
            result: $state,
            resultType: 'calendar_sync_states',
            resultId: isset($state['id']) && is_string($state['id']) ? $state['id'] : null,
        );
    }
}

<?php

namespace App\Domain\Operations\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Operations\IntegrationAccounts;
use App\Domain\Shared\CommandContext;

/**
 * Compte d'intégration (L2D01) : création (`entityId` nul) ou modification, droit `integration.manage` et
 * réauthentification récente (middleware de la route). Les identifiants du fournisseur sont chiffrés par le service et
 * ne figurent ni dans l'audit ni dans le résultat rejoué : seule la référence du compte l'est.
 */
final class SaveIntegrationAccountHandler extends ServiceCommandHandler
{
    public const COMMAND = 'SaveIntegrationAccount';

    public function __construct(ContractValidator $contracts, private readonly IntegrationAccounts $accounts)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['integration.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $actor = $this->actor($context);
        $row = $command->entityId === null
            ? $this->accounts->create($context->clinicId, $actor, $command->payload)
            : $this->accounts->update($context->clinicId, $actor, $command->entityId, $command->payload);

        return self::done('integration_accounts', (string) $row->id);
    }
}

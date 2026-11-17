<?php

namespace App\Domain\Communication\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Communication\ReminderPolicies;
use App\Domain\Shared\CommandContext;

/**
 * Politique de rappel (L2D07) : création (`entityId` nul) ou modification sous version attendue (dans le corps :
 * `expected_version`). Elle dit QUAND relancer (J-1 à 18 h, H-2, contrôle collyre…), jamais quoi dire : le texte est celui
 * d'un modèle approuvé. Droit `communication.manage`.
 */
final class SaveReminderPolicyHandler extends ServiceCommandHandler
{
    public const COMMAND = 'SaveReminderPolicy';

    public function __construct(ContractValidator $contracts, private readonly ReminderPolicies $policies)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($command->entityId === null) {
            $this->assertRequest('SaveReminderPolicyRequest', $command->payload);
            $row = $this->policies->create($context, $command->payload, null);
        } else {
            $this->assertRequest('UpdateReminderPolicyRequest', $command->payload);
            $row = $this->policies->update($context, $command->entityId, $command->payload, null);
        }

        return self::done('reminder_policies', (string) $row->id);
    }
}

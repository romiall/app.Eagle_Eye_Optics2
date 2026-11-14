<?php

namespace App\Domain\Cash\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Locking\TransactionLocks;
use App\Domain\Cash\PaymentReconciliationWriter;
use App\Domain\Shared\CommandContext;

/** Mise à jour d'un brouillon de rapprochement par canal de paiement (L1D06). */
final class UpdatePaymentReconciliationHandler implements CommandHandler
{
    public const COMMAND = 'UpdatePaymentReconciliation';

    public function permissions(): array
    {
        return ['finance.reconcile'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        return PaymentReconciliationWriter::saveDraft($command->payload, $context, $locks, true);
    }
}

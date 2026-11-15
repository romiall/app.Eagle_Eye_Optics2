<?php

namespace App\Domain\Crm\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Crm\ProspectContacts;
use App\Domain\Shared\CommandContext;

/**
 * Rattachement d'un prospect à un patient existant (L2D03) : manuel, jamais une fusion automatique, et sans
 * recopier la moindre donnée clinique vers le prospect. Droit `communication.manage` ou `patient.read`.
 */
final class LinkProspectPatientHandler extends ServiceCommandHandler
{
    public const COMMAND = 'LinkProspectPatient';

    public function __construct(ContractValidator $contracts, private readonly ProspectContacts $prospects)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage', 'patient.read'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $this->assertRequest('LinkProspectPatientRequest', $command->payload);
        $row = $this->prospects->linkToPatient(
            $context->clinicId,
            $this->actor($context),
            (string) $command->entityId,
            (string) $command->payload['patient_id'],
        );

        return self::done('prospect_contacts', (string) $row->id);
    }
}

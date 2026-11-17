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
 * Prospect administratif (L2D03) : création (`entityId` nul) ou modification. Un prospect n'est jamais un patient :
 * il ne porte que des coordonnées administratives, sans donnée clinique. Droit `communication.manage` ou
 * `agenda.write` (l'accueil enregistre aussi les demandes de rendez-vous).
 */
final class SaveProspectContactHandler extends ServiceCommandHandler
{
    public const COMMAND = 'SaveProspectContact';

    public function __construct(ContractValidator $contracts, private readonly ProspectContacts $prospects)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage', 'agenda.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $actor = $this->actor($context);

        if ($command->entityId === null) {
            $this->assertRequest('SaveProspectContactRequest', $command->payload);
            $row = $this->prospects->create($context->clinicId, $actor, $command->payload);
        } else {
            $this->assertRequest('UpdateProspectContactRequest', $command->payload);
            $row = $this->prospects->update($context->clinicId, $actor, $command->entityId, $command->payload);
        }

        return self::done('prospect_contacts', (string) $row->id);
    }
}

<?php

namespace App\Domain\Communication\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Communication\ConsentLedger;
use App\Domain\Shared\CommandContext;
use LogicException;
use stdClass;

/**
 * Consentement ou révocation d'un destinataire (L2D06), droit `communication.manage` : un même gestionnaire sous deux
 * noms. Le registre est append-only : une révocation est un NOUVEL événement, jamais la modification de l'ancien, et
 * le dernier événement par destination, canal et finalité fait foi. La destination exacte est chiffrée ; ni l'audit ni
 * le résultat rejoué ne la portent en clair.
 */
final class RecordConsentHandler extends ServiceCommandHandler
{
    public const GRANT = 'RecordConsent';

    public const REVOKE = 'RevokeConsent';

    public function __construct(ContractValidator $contracts, private readonly ConsentLedger $consents)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $event = match ($command->name) {
            self::GRANT => $this->grant($context, $command->payload),
            self::REVOKE => $this->revoke($context, $command->payload),
            default => throw new LogicException('Commande inattendue : '.$command->name),
        };

        return self::done('consent_events', (string) $event->id);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function grant(CommandContext $context, array $payload): stdClass
    {
        $this->assertRequest('RecordConsentRequest', $payload);

        return $this->consents->recordGrant($context, $payload, null);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function revoke(CommandContext $context, array $payload): stdClass
    {
        $this->assertRequest('RevokeConsentRequest', $payload);

        return $this->consents->recordRevoke($context, $payload, null);
    }
}

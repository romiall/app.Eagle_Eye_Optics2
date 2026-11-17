<?php

namespace App\Domain\Scheduling\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Scheduling\PublicBooking;
use App\Domain\Shared\CommandContext;
use LogicException;

/**
 * Décision d'une demande de réservation publique (L2D02, L3D03), droit `agenda.write` : confirmation (elle crée le
 * rendez-vous interne, jamais un patient) ou refus. Un même gestionnaire sous deux noms. La demande est jugée sous le
 * verrou du cabinet : deux décisions simultanées sur le même créneau ne peuvent pas toutes deux réussir. Le résultat
 * rendu est la demande présentée côté gérante (référence publique, créneau, statut) : sans jeton ni coordonnée.
 */
final class DecidePublicBookingHandler extends ServiceCommandHandler
{
    public const CONFIRM = 'ConfirmPublicBooking';

    public const REJECT = 'RejectPublicBooking';

    public function __construct(ContractValidator $contracts, private readonly PublicBooking $bookings)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['agenda.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $bookingId = (string) $command->entityId;
        $actor = $this->actor($context);

        $item = match ($command->name) {
            self::CONFIRM => $this->bookings->confirmRequest($actor, $bookingId, $context->correlationId, null, $command->payload, $context->now),
            self::REJECT => $this->bookings->rejectRequest($actor, $bookingId, $context->correlationId, null, $command->payload, $context->now),
            default => throw new LogicException('Commande inattendue : '.$command->name),
        };

        return new CommandOutcome(result: $item, resultType: 'public_booking_requests', resultId: $bookingId);
    }
}

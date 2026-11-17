<?php

namespace App\Domain\Communication\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Communication\AudienceSegments;
use App\Domain\Shared\CommandContext;

/**
 * Segment d'audience administratif (L2D08) : création (`entityId` nul) ou modification sous version attendue (dans le
 * corps : `expected_version`). Les critères sont administratifs (dernière visite, solde ouvert, canal) : jamais un
 * critère clinique. Droit `communication.manage`.
 */
final class SaveAudienceSegmentHandler extends ServiceCommandHandler
{
    public const COMMAND = 'SaveAudienceSegment';

    public function __construct(ContractValidator $contracts, private readonly AudienceSegments $segments)
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
            $this->assertRequest('SaveAudienceSegmentRequest', $command->payload);
            $row = $this->segments->create($context, $command->payload, null);
        } else {
            $this->assertRequest('UpdateAudienceSegmentRequest', $command->payload);
            $row = $this->segments->update($context, $command->entityId, $command->payload, null);
        }

        return self::done('audience_segments', (string) $row->id);
    }
}

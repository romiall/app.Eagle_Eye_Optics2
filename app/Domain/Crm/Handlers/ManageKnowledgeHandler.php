<?php

namespace App\Domain\Crm\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Crm\KnowledgeBase;
use App\Domain\Shared\CommandContext;
use LogicException;

/**
 * Base de connaissances gouvernée (L2D04), droit `communication.manage` : entrée, nouvelle révision, approbation et
 * publication, un même gestionnaire sous quatre noms. Une révision publiée est immuable ; l'approbation relève en plus
 * du droit `knowledge.manage` (jugé par le service) ; seule une révision approuvée se publie. Le corpus de l'assistant
 * ne contient que des faits publics validés : aucune donnée clinique n'entre ici.
 */
final class ManageKnowledgeHandler extends ServiceCommandHandler
{
    public const SAVE_ENTRY = 'SaveKnowledgeEntry';

    public const CREATE_VERSION = 'CreateKnowledgeVersion';

    public const APPROVE_VERSION = 'ApproveKnowledgeVersion';

    public const PUBLISH_VERSION = 'PublishKnowledgeVersion';

    public function __construct(ContractValidator $contracts, private readonly KnowledgeBase $knowledge)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $actor = $this->actor($context);
        $payload = $command->payload;
        $id = (string) $command->entityId;

        switch ($command->name) {
            case self::SAVE_ENTRY:
                $this->assertRequest('SaveKnowledgeEntryRequest', $payload);
                $created = $this->knowledge->createEntry($context->clinicId, $actor, $payload);

                return self::done('knowledge_entries', (string) $created['entry']->id);
            case self::CREATE_VERSION:
                $this->assertRequest('CreateKnowledgeVersionRequest', $payload);
                $version = $this->knowledge->addVersion($context->clinicId, $actor, $id, $payload);

                return self::done('knowledge_versions', (string) $version->id);
            case self::APPROVE_VERSION:
                $this->assertRequest('KnowledgeActionRequest', $payload);
                $version = $this->knowledge->approveVersion($context->clinicId, $actor, $id, self::reasonOf($payload));

                return self::done('knowledge_versions', (string) $version->id);
            case self::PUBLISH_VERSION:
                $this->assertRequest('KnowledgeActionRequest', $payload);
                $version = $this->knowledge->publishVersion($context->clinicId, $actor, $id, self::reasonOf($payload));

                return self::done('knowledge_versions', (string) $version->id);
            default:
                throw new LogicException('Commande inattendue : '.$command->name);
        }
    }
}

<?php

namespace App\Domain\Communication\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Communication\MessageTemplates;
use App\Domain\Shared\CommandContext;
use LogicException;

/**
 * Modèles de messages versionnés (L2D06), droit `communication.manage` : création d'un modèle, nouvelle révision et
 * approbation, un même gestionnaire sous trois noms. Une révision approuvée est immuable (le texte ne se corrige que
 * par une nouvelle révision) et seules des variables administratives y sont admises : aucune donnée clinique.
 */
final class ManageMessageTemplateHandler extends ServiceCommandHandler
{
    public const SAVE_TEMPLATE = 'SaveMessageTemplate';

    public const CREATE_VERSION = 'CreateMessageTemplateVersion';

    public const APPROVE_VERSION = 'ApproveMessageTemplateVersion';

    public function __construct(ContractValidator $contracts, private readonly MessageTemplates $templates)
    {
        parent::__construct($contracts);
    }

    public function permissions(): array
    {
        return ['communication.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $id = (string) $command->entityId;

        switch ($command->name) {
            case self::SAVE_TEMPLATE:
                $this->assertRequest('SaveMessageTemplateRequest', $payload);
                $row = $this->templates->createTemplate($context, $payload, null);

                return self::done('message_templates', (string) $row->id);
            case self::CREATE_VERSION:
                $this->assertRequest('CreateMessageTemplateVersionRequest', $payload);
                $row = $this->templates->createVersion($context, $id, $payload, null);

                return self::done('message_template_versions', (string) $row->id);
            case self::APPROVE_VERSION:
                if ($payload !== []) {
                    $this->assertRequest('KnowledgeActionRequest', $payload);
                }
                $row = $this->templates->approveVersion($context, $id, self::reasonOf($payload), null);

                return self::done('message_template_versions', (string) $row->id);
            default:
                throw new LogicException('Commande inattendue : '.$command->name);
        }
    }
}

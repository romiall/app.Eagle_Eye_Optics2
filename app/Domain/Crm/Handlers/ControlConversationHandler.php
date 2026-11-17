<?php

namespace App\Domain\Crm\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Crm\HumanHandoff;
use App\Domain\Shared\CommandContext;
use App\Models\User;
use LogicException;
use stdClass;

/**
 * Prise en charge humaine d'une conversation et reprise par l'assistant (L2D05), droit `communication.manage` : un même
 * gestionnaire sous deux noms. La prise en charge arrête l'assistant et conserve un résumé ADMINISTRATIF (jamais de
 * donnée clinique) ; la reprise le relance. Les deux écrivent un transfert horodaté, sans appel externe.
 */
final class ControlConversationHandler extends ServiceCommandHandler
{
    public const HANDOFF = 'HandoffConversation';

    public const RESUME_BOT = 'ResumeConversationBot';

    public function __construct(ContractValidator $contracts, private readonly HumanHandoff $handoffs)
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
        $conversationId = (string) $command->entityId;
        $payload = $command->payload;

        $conversation = match ($command->name) {
            self::HANDOFF => $this->handoff($context, $actor, $conversationId, $payload),
            self::RESUME_BOT => $this->resume($context, $actor, $conversationId, $payload),
            default => throw new LogicException('Commande inattendue : '.$command->name),
        };

        return self::done('crm_conversations', (string) $conversation->id);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function handoff(CommandContext $context, User $actor, string $conversationId, array $payload): stdClass
    {
        $this->assertRequest('ConversationHandoffRequest', $payload);

        return $this->handoffs->handoffToHuman(
            $context->clinicId,
            $actor,
            $conversationId,
            $payload['reason'] ?? null,
            $payload['administrative_summary'] ?? null,
            (bool) ($payload['assign_to_self'] ?? false),
            'TAKEOVER',
            $context->correlationId,
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function resume(CommandContext $context, User $actor, string $conversationId, array $payload): stdClass
    {
        $this->assertRequest('KnowledgeActionRequest', $payload);

        return $this->handoffs->resumeBot($context->clinicId, $actor, $conversationId, $payload['reason'] ?? null, $context->correlationId);
    }
}

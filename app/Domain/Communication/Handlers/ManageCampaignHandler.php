<?php

namespace App\Domain\Communication\Handlers;

use App\Application\Command;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Locking\TransactionLocks;
use App\Application\ServiceCommandHandler;
use App\Domain\Communication\Campaigns;
use App\Domain\Shared\CommandContext;
use LogicException;

/**
 * Campagne ciblée (L2D08), droit `communication.manage` : brouillon, gel des destinataires et pause, un même
 * gestionnaire sous trois noms. Le gel exige l'approbation exacte de la gérante (`CAMPAIGN_SEND`) et fige l'audience ;
 * la pause arrête les envois suivants. AUCUN envoi ici : l'exécution, qui appelle le fournisseur, est une opération
 * hors du chemin central (section « Opérations à appel fournisseur » de `docs/implementation/command-bus.md`).
 */
final class ManageCampaignHandler extends ServiceCommandHandler
{
    public const SAVE = 'SaveCampaign';

    public const FREEZE = 'FreezeCampaign';

    public const PAUSE = 'PauseCampaign';

    public function __construct(ContractValidator $contracts, private readonly Campaigns $campaigns)
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
            case self::SAVE:
                $this->assertRequest('SaveCampaignRequest', $payload);
                $row = $this->campaigns->create($context, $payload, null);

                break;
            case self::FREEZE:
                if ($payload !== []) {
                    $this->assertRequest('FreezeCampaignRequest', $payload);
                }
                $row = $this->campaigns->freeze($context, $id, $payload, null);

                break;
            case self::PAUSE:
                if ($payload !== []) {
                    $this->assertRequest('PauseCampaignRequest', $payload);
                }
                $row = $this->campaigns->pause($context, $id, self::reasonOf($payload), null);

                break;
            default:
                throw new LogicException('Commande inattendue : '.$command->name);
        }

        return self::done('campaign_definitions', (string) $row->id);
    }
}

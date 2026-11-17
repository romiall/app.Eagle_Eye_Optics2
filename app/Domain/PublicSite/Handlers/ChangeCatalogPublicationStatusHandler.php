<?php

namespace App\Domain\PublicSite\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\PublicSite\Rules\PublicSiteRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Publication, retrait ou archivage d'une fiche du showroom (L3D02), droit `site.publish`, réauthentification récente
 * (la route l'exige : un contenu public engage le cabinet). PUBLIER est la décision de la gérante : elle enregistre
 * son nom et l'instant (`approved_by`, `published_at`) ; l'article doit toujours être actif et marqué « visible au
 * public ». RETIRER ramène la fiche en brouillon sans rien perdre ; ARCHIVER la range. Version attendue obligatoire.
 */
final class ChangeCatalogPublicationStatusHandler implements CommandHandler
{
    public const COMMAND = 'ChangeCatalogPublicationStatus';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $target = (string) ($command->payload['status'] ?? '');
        if (! in_array($target, PublicSiteRules::STATUSES, true)) {
            throw BusinessError::validation(['status' => ['Statut inconnu : DRAFT, PUBLISHED ou ARCHIVED.']]);
        }

        $id = (string) $command->entityId;
        $row = DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('id', $id)->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound('Fiche introuvable dans ce cabinet.');
        }
        if ($command->expectedVersion === null || (int) $row->version !== $command->expectedVersion) {
            throw BusinessError::versionConflict();
        }
        $from = (string) $row->status;
        if (! PublicSiteRules::mayTransition($from, $target)) {
            throw BusinessError::stateRefused('Cette fiche ne peut pas passer de '.$from.' à '.$target.'.', $from);
        }

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $columns = ['status' => $target, 'version' => (int) $row->version + 1, 'updated_at' => $now];

        if ($target === PublicSiteRules::PUBLISHED) {
            $this->assertPublishable((string) $context->clinicId, $row);
            $columns += ['approved_by' => $context->actorId, 'published_at' => $now];
        } elseif ($target === PublicSiteRules::DRAFT) {
            $columns += ['approved_by' => null, 'published_at' => null];
        }

        DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('id', $id)->update($columns);

        return new CommandOutcome(
            result: ['id' => $id, 'status' => $target],
            resultType: 'catalog_publications',
            resultId: $id,
            audit: [new AuditEntry(
                'site.publication_'.strtolower($target),
                'catalog_publications',
                $id,
                isset($command->payload['reason']) && is_string($command->payload['reason']) ? mb_substr(trim($command->payload['reason']), 0, 500) : null,
                ['from' => $from, 'to' => $target, 'slug' => (string) $row->slug],
            )],
        );
    }

    private function assertPublishable(string $clinicId, stdClass $publication): void
    {
        $errors = new FieldErrors;
        $item = DB::table('catalog_items')->where('clinic_id', $clinicId)->where('id', (string) $publication->catalog_item_id)->first();
        if (! $item instanceof stdClass || ! (bool) $item->active) {
            $errors->add('status', 'L\'article de cette fiche est désactivé dans le catalogue : elle ne peut pas être publiée.');
        } elseif (! (bool) $item->public_visibility) {
            $errors->add('status', 'L\'article de cette fiche n\'est plus marqué « visible au public » dans le catalogue.');
        }
        $errors->throwIfAny();
    }
}

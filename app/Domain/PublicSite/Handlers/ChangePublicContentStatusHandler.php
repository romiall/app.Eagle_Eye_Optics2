<?php

namespace App\Domain\PublicSite\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\PublicSite\Rules\PublicSiteRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Publication, retrait ou archivage d'un contenu public (L3D02), droit `site.publish`, réauthentification récente (la
 * route l'exige). PUBLIER est la décision de la gérante (`approved_by`, `published_at`) : la révision précédemment
 * publiée du même code est archivée dans la même transaction, de sorte qu'UNE SEULE révision par code est publique.
 * Une révision publiée ne se modifie jamais : on enregistre un nouveau brouillon, puis on le publie.
 */
final class ChangePublicContentStatusHandler implements CommandHandler
{
    public const COMMAND = 'ChangePublicContentStatus';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $target = (string) ($command->payload['status'] ?? '');
        if (! in_array($target, [PublicSiteRules::PUBLISHED, PublicSiteRules::ARCHIVED], true)) {
            throw BusinessError::validation(['status' => ['Statut inconnu : PUBLISHED ou ARCHIVED.']]);
        }

        $id = (string) $command->entityId;
        $row = DB::table('public_contents')->where('clinic_id', $context->clinicId)->where('id', $id)->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound('Contenu introuvable dans ce cabinet.');
        }
        if ($command->expectedVersion === null || (int) $row->version !== $command->expectedVersion) {
            throw BusinessError::versionConflict();
        }
        $from = (string) $row->status;
        if (! PublicSiteRules::mayTransition($from, $target)) {
            throw BusinessError::stateRefused('Ce contenu ne peut pas passer de '.$from.' à '.$target.'.', $from);
        }

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $columns = ['status' => $target, 'version' => (int) $row->version + 1, 'updated_at' => $now];
        if ($target === PublicSiteRules::PUBLISHED) {
            // Une seule révision publique par code : l'ancienne est archivée AVANT que la nouvelle ne soit publiée.
            DB::table('public_contents')
                ->where('clinic_id', $context->clinicId)->where('code', (string) $row->code)->where('status', PublicSiteRules::PUBLISHED)->where('id', '<>', $id)
                ->update(['status' => PublicSiteRules::ARCHIVED, 'updated_at' => $now]);
            $columns += ['approved_by' => $context->actorId, 'published_at' => $now];
        }

        DB::table('public_contents')->where('clinic_id', $context->clinicId)->where('id', $id)->update($columns);

        return new CommandOutcome(
            result: ['id' => $id, 'status' => $target],
            resultType: 'public_contents',
            resultId: $id,
            audit: [new AuditEntry('site.content_'.strtolower($target), 'public_contents', $id, null, ['from' => $from, 'to' => $target, 'code' => (string) $row->code])],
        );
    }
}

<?php

namespace App\Domain\PublicSite\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Retrait d'une image d'une fiche du showroom (L3D02), droit `site.publish` : l'image disparaît du site public à
 * l'instant. Le fichier privé reste conservé (il peut servir à une autre fiche, et une trace de ce qui a été publié
 * ne s'efface pas) ; seule l'association est supprimée, et l'audit garde qui l'a retirée.
 */
final class RemoveCatalogMediaHandler implements CommandHandler
{
    public const COMMAND = 'RemoveCatalogMedia';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $mediaId = (string) $command->entityId;
        $media = DB::table('catalog_media')->where('clinic_id', $context->clinicId)->where('id', $mediaId)->first();
        if (! $media instanceof stdClass) {
            throw BusinessError::notFound('Image introuvable dans ce cabinet.');
        }

        DB::table('catalog_media')->where('clinic_id', $context->clinicId)->where('id', $mediaId)->delete();

        return new CommandOutcome(
            result: ['id' => $mediaId, 'publication_id' => (string) $media->publication_id],
            resultType: 'catalog_media',
            resultId: $mediaId,
            audit: [new AuditEntry('site.media_removed', 'catalog_media', $mediaId, null, ['publication_id' => (string) $media->publication_id])],
        );
    }
}

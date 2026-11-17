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
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Image d'une fiche du showroom (L3D02), droit `site.publish`. Le contrôleur a déjà contrôlé les octets (vrai format, taille,
 * dimensions), calculé l'empreinte et écrit le fichier PRIVÉ ; cette action rattache le fichier (`stored_files`, classé
 * `PUBLIC_APPROVED`) puis l'image à la fiche, avec son texte alternatif et sa NOTE DE DROITS obligatoires : la gérante
 * qui dépose l'image l'approuve (`approved_by`, `approved_at`). Aucune image ne sort sans note de droits.
 */
final class AttachCatalogMediaHandler implements CommandHandler
{
    public const COMMAND = 'AttachCatalogMedia';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $errors = new FieldErrors;

        $alt = Text::trim((string) ($payload['alt_text'] ?? ''));
        if (mb_strlen($alt, 'UTF-8') < 3 || mb_strlen($alt, 'UTF-8') > 255) {
            $errors->add('alt_text', 'Le texte alternatif décrit l\'image en 3 à 255 caractères.');
        }
        $rights = Text::trim((string) ($payload['rights_note'] ?? ''));
        if (mb_strlen($rights, 'UTF-8') < 3 || mb_strlen($rights, 'UTF-8') > 1000) {
            $errors->add('rights_note', 'La note de droits est obligatoire (3 à 1 000 caractères) : qui a pris ou fourni la photo, et l\'autorisation de la publier.');
        }
        $order = $payload['display_order'] ?? 0;
        if (! is_int($order) || $order < 0 || $order > 9999) {
            $errors->add('display_order', 'L\'ordre d\'affichage est un entier de 0 à 9999.');
            $order = 0;
        }
        $errors->throwIfAny();

        $publicationId = (string) $command->entityId;
        if (! DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('id', $publicationId)->exists()) {
            throw BusinessError::notFound('Fiche introuvable dans ce cabinet.');
        }
        $count = DB::table('catalog_media')->where('clinic_id', $context->clinicId)->where('publication_id', $publicationId)->count();
        $max = max(1, (int) config('eeo.public_site.max_media_per_publication', 8));
        if ($count >= $max) {
            throw BusinessError::validation(['file' => ['Une fiche compte au plus '.$max.' images : retirez-en une avant d\'en ajouter.']]);
        }

        $sha256 = (string) ($payload['sha256'] ?? '');
        $mime = (string) ($payload['mime_type'] ?? '');
        $path = (string) ($payload['private_path'] ?? '');
        $size = $payload['size_bytes'] ?? null;
        if (preg_match('/^[0-9a-f]{64}$/', $sha256) !== 1 || ! array_key_exists($mime, PublicSiteRules::MEDIA_TYPES) || $path === '' || ! is_int($size) || $size < 1) {
            throw BusinessError::validation(['file' => ['Le fichier déposé est incomplet.']]);
        }

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $file = DB::table('stored_files')->where('clinic_id', $context->clinicId)->where('private_path', $path)->first();
        if ($file instanceof stdClass) {
            $fileId = (string) $file->id;
        } else {
            $fileId = Ulid::generate();
            DB::table('stored_files')->insert([
                'id' => $fileId, 'clinic_id' => $context->clinicId, 'private_path' => $path, 'mime_type' => $mime, 'size_bytes' => $size,
                'sha256' => $sha256, 'classification' => 'PUBLIC_APPROVED', 'encryption_key_id' => null, 'uploaded_by' => $context->actorId,
                'archived_at' => null, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        if (DB::table('catalog_media')->where('clinic_id', $context->clinicId)->where('publication_id', $publicationId)->where('file_id', $fileId)->exists()) {
            throw BusinessError::validation(['file' => ['Cette image est déjà associée à la fiche.']]);
        }

        $mediaId = Ulid::generate();
        DB::table('catalog_media')->insert([
            'id' => $mediaId, 'clinic_id' => $context->clinicId, 'publication_id' => $publicationId, 'file_id' => $fileId, 'alt_text' => $alt,
            'display_order' => $order, 'rights_note' => $rights, 'approved_by' => $context->actorId, 'approved_at' => $now,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        return new CommandOutcome(
            result: ['id' => $mediaId, 'publication_id' => $publicationId],
            resultType: 'catalog_media',
            resultId: $mediaId,
            audit: [new AuditEntry('site.media_attached', 'catalog_media', $mediaId, null, ['publication_id' => $publicationId, 'sha256' => $sha256])],
        );
    }
}

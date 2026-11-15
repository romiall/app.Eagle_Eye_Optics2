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
 * Fiche du showroom (L3D02, EE039) : brouillon créé (`entityId` nul) ou modifié sous version attendue. Droit
 * `site.publish` (gérante). La fiche décrit UN article du catalogue que la gérante a marqué « visible au public » ;
 * elle ne publie jamais seule : la publication est une décision distincte (`ChangeCatalogPublicationStatus`).
 *
 * Modifier une fiche PUBLIÉE la remet en brouillon : le texte vu du public est toujours un texte approuvé, jamais un
 * texte modifié depuis. Le prix de vente n'est montré que si la gérante le décide (`show_sale_price`) ; le coût d'achat et
 * le stock ne sont jamais lus par le site public.
 */
final class SaveCatalogPublicationHandler implements CommandHandler
{
    public const COMMAND = 'SaveCatalogPublication';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $errors = new FieldErrors;

        $title = Text::trim((string) ($payload['public_title'] ?? ''));
        if (mb_strlen($title, 'UTF-8') < 2 || mb_strlen($title, 'UTF-8') > PublicSiteRules::TITLE_MAX) {
            $errors->add('public_title', 'Le titre public compte de 2 à '.PublicSiteRules::TITLE_MAX.' caractères.');
        }
        $description = Text::trim((string) ($payload['public_description'] ?? ''));
        $length = mb_strlen($description, 'UTF-8');
        if ($length < PublicSiteRules::DESCRIPTION_MIN || $length > PublicSiteRules::DESCRIPTION_MAX) {
            $errors->add('public_description', 'La description publique compte de '.PublicSiteRules::DESCRIPTION_MIN.' à '.PublicSiteRules::DESCRIPTION_MAX.' caractères.');
        }
        $style = isset($payload['style']) && is_string($payload['style']) ? mb_strtolower(Text::trim($payload['style']), 'UTF-8') : '';
        if (mb_strlen($style, 'UTF-8') > PublicSiteRules::STYLE_MAX) {
            $errors->add('style', 'Le style compte au plus '.PublicSiteRules::STYLE_MAX.' caractères.');
        }
        $order = $payload['display_order'] ?? 0;
        if (! is_int($order) || $order < 0 || $order > 9999) {
            $errors->add('display_order', 'L\'ordre d\'affichage est un entier de 0 à 9999.');
            $order = 0;
        }
        $slug = isset($payload['slug']) && is_string($payload['slug']) && Text::trim($payload['slug']) !== ''
            ? Text::trim($payload['slug'])
            : PublicSiteRules::slugOf($title);
        if (! PublicSiteRules::isSlug($slug)) {
            $errors->add('slug', 'L\'adresse de la fiche s\'écrit en minuscules, chiffres et tirets (exemple : monture-ronde-noire).');
        }

        $id = $command->entityId;
        $existing = null;
        if ($id !== null) {
            $existing = DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('id', $id)->first();
            if (! $existing instanceof stdClass) {
                throw BusinessError::notFound('Fiche introuvable dans ce cabinet.');
            }
            if ($command->expectedVersion === null || (int) $existing->version !== $command->expectedVersion) {
                throw BusinessError::versionConflict();
            }
        }

        $itemId = $existing instanceof stdClass ? (string) $existing->catalog_item_id : (string) ($payload['catalog_item_id'] ?? '');
        if ($existing === null) {
            $this->assertEligibleItem($context->clinicId, $itemId, $errors);
        }
        if ($slug !== '' && PublicSiteRules::isSlug($slug)) {
            $clash = DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('slug', $slug);
            if ($id !== null) {
                $clash->where('id', '<>', $id);
            }
            if ($clash->exists()) {
                $errors->add('slug', 'Cette adresse est déjà utilisée par une autre fiche.');
            }
        }
        $errors->throwIfAny();

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $columns = [
            'slug' => $slug,
            'public_title' => $title,
            'public_description' => $description,
            'style' => $style === '' ? null : $style,
            'show_sale_price' => (bool) ($payload['show_sale_price'] ?? false),
            'display_order' => $order,
            'updated_at' => $now,
        ];

        if ($existing === null) {
            $id = Ulid::generate();
            DB::table('catalog_publications')->insert($columns + [
                'id' => $id, 'clinic_id' => $context->clinicId, 'catalog_item_id' => $itemId, 'status' => PublicSiteRules::DRAFT,
                'approved_by' => null, 'published_at' => null, 'version' => 1, 'created_at' => $now,
            ]);
        } else {
            DB::table('catalog_publications')->where('clinic_id', $context->clinicId)->where('id', $id)->update($columns + [
                'status' => PublicSiteRules::DRAFT, 'approved_by' => null, 'published_at' => null, 'version' => (int) $existing->version + 1,
            ]);
        }

        return new CommandOutcome(
            result: ['id' => $id],
            resultType: 'catalog_publications',
            resultId: $id,
            audit: [new AuditEntry($existing === null ? 'site.publication_created' : 'site.publication_updated', 'catalog_publications', $id, null, [
                'slug' => $slug,
                'show_sale_price' => $columns['show_sale_price'],
                'unpublished_by_edit' => $existing instanceof stdClass && $existing->status === PublicSiteRules::PUBLISHED,
            ])],
        );
    }

    private function assertEligibleItem(string $clinicId, string $itemId, FieldErrors $errors): void
    {
        if (! Ulid::isValid($itemId)) {
            $errors->add('catalog_item_id', 'Choisissez l\'article du catalogue décrit par la fiche.');

            return;
        }
        $item = DB::table('catalog_items')->where('clinic_id', $clinicId)->where('id', $itemId)->first();
        if (! $item instanceof stdClass) {
            $errors->add('catalog_item_id', 'Article introuvable dans le catalogue de ce cabinet.');

            return;
        }
        if (! (bool) $item->active) {
            $errors->add('catalog_item_id', 'Cet article est désactivé dans le catalogue.');
        }
        if (! (bool) $item->public_visibility) {
            $errors->add('catalog_item_id', 'Cet article n\'est pas marqué « visible au public » dans le catalogue : la gérante doit d\'abord l\'autoriser.');
        }
        if (DB::table('catalog_publications')->where('clinic_id', $clinicId)->where('catalog_item_id', $itemId)->exists()) {
            $errors->add('catalog_item_id', 'Cet article a déjà une fiche du showroom : modifiez-la.');
        }
    }
}

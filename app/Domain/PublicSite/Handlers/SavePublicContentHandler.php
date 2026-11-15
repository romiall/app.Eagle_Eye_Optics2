<?php

namespace App\Domain\PublicSite\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\PublicSite\Rules\PublicSiteRules;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Contenu public limité (L3D02), droit `site.publish` : un texte par code (accueil, expertises, horaires, localisation,
 * WhatsApp, réseaux, contact). Chaque enregistrement est un BROUILLON : s'il en existe déjà un pour ce code il est
 * remplacé (jamais une pile de brouillons), sinon une nouvelle révision s'ouvre ; la révision publiée reste celle du
 * site jusqu'à ce que la gérante publie la nouvelle. Le numéro WhatsApp est contrôlé : chiffres seuls, de 8 à 15.
 */
final class SavePublicContentHandler implements CommandHandler
{
    public const COMMAND = 'SavePublicContent';

    public function permissions(): array
    {
        return ['site.publish'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $errors = new FieldErrors;

        $code = (string) ($payload['code'] ?? '');
        if (! array_key_exists($code, PublicSiteRules::CONTENT_CODES)) {
            $errors->add('code', 'Choisissez l\'un des contenus prévus : '.implode(', ', array_keys(PublicSiteRules::CONTENT_CODES)).'.');
        }
        $title = Text::trim((string) ($payload['title'] ?? ''));
        if (mb_strlen($title, 'UTF-8') < 2 || mb_strlen($title, 'UTF-8') > PublicSiteRules::TITLE_MAX) {
            $errors->add('title', 'Le titre compte de 2 à '.PublicSiteRules::TITLE_MAX.' caractères.');
        }
        $content = Text::trim((string) ($payload['content'] ?? ''));
        if ($content === '' || mb_strlen($content, 'UTF-8') > PublicSiteRules::CONTENT_MAX) {
            $errors->add('content', 'Le contenu compte de 1 à '.PublicSiteRules::CONTENT_MAX.' caractères.');
        } elseif ($code === 'WHATSAPP') {
            $digits = PublicSiteRules::whatsappDigits($content);
            if ($digits === null) {
                $errors->add('content', 'Écrivez le numéro WhatsApp en chiffres, avec l\'indicatif du pays (exemple : 237600000000).');
            } else {
                $content = $digits;
            }
        }
        $errors->throwIfAny();

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $draft = DB::table('public_contents')->where('clinic_id', $context->clinicId)->where('code', $code)->where('status', PublicSiteRules::DRAFT)->first();

        if ($draft instanceof stdClass) {
            $id = (string) $draft->id;
            DB::table('public_contents')->where('clinic_id', $context->clinicId)->where('id', $id)->update([
                'title' => $title, 'content' => $content, 'version' => (int) $draft->version + 1, 'updated_at' => $now,
            ]);
            $revision = (int) $draft->revision_no;
        } else {
            $id = Ulid::generate();
            $revision = (int) DB::table('public_contents')->where('clinic_id', $context->clinicId)->where('code', $code)->max('revision_no') + 1;
            DB::table('public_contents')->insert([
                'id' => $id, 'clinic_id' => $context->clinicId, 'code' => $code, 'title' => $title, 'content' => $content, 'revision_no' => $revision,
                'status' => PublicSiteRules::DRAFT, 'approved_by' => null, 'published_at' => null, 'version' => 1, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        return new CommandOutcome(
            result: ['id' => $id],
            resultType: 'public_contents',
            resultId: $id,
            audit: [new AuditEntry('site.content_saved', 'public_contents', $id, null, ['code' => $code, 'revision_no' => $revision])],
        );
    }
}

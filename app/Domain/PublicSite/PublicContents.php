<?php

namespace App\Domain\PublicSite;

use App\Domain\PublicSite\Rules\PublicSiteRules;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures des contenus publics (L3D02) : côté gérante, pour chaque code, la révision publiée et le brouillon en cours ;
 * côté public, la seule révision PUBLIÉE de chaque code. Un contenu non publié ne sort jamais.
 */
final class PublicContents
{
    /**
     * Un enregistrement par code prévu, même sans contenu : l'écran montre ce qui reste à écrire.
     *
     * @return list<array<string, mixed>>
     */
    public function adminList(string $clinicId): array
    {
        $rows = DB::table('public_contents')->where('clinic_id', $clinicId)->whereIn('status', [PublicSiteRules::DRAFT, PublicSiteRules::PUBLISHED])
            ->orderByDesc('revision_no')->get();
        $published = [];
        $drafts = [];
        foreach ($rows as $row) {
            if ($row->status === PublicSiteRules::PUBLISHED) {
                $published[(string) $row->code] ??= $row;
            } else {
                $drafts[(string) $row->code] ??= $row;
            }
        }

        $list = [];
        foreach (PublicSiteRules::CONTENT_CODES as $code => $label) {
            $list[] = [
                'code' => $code,
                'label' => $label,
                'published' => isset($published[$code]) ? self::present($published[$code]) : null,
                'draft' => isset($drafts[$code]) ? self::present($drafts[$code]) : null,
            ];
        }

        return $list;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function publicList(string $clinicId): array
    {
        $rows = DB::table('public_contents')->where('clinic_id', $clinicId)->where('status', PublicSiteRules::PUBLISHED)->get();
        $byCode = [];
        foreach ($rows as $row) {
            $byCode[(string) $row->code] = $row;
        }

        $list = [];
        foreach (array_keys(PublicSiteRules::CONTENT_CODES) as $code) {
            if (! isset($byCode[$code])) {
                continue;
            }
            $row = $byCode[$code];
            $entry = ['code' => $code, 'title' => (string) $row->title, 'content' => (string) $row->content, 'whatsapp_url' => null];
            if ($code === 'WHATSAPP') {
                $entry['whatsapp_url'] = 'https://wa.me/'.$row->content;
            }
            $list[] = $entry;
        }

        return $list;
    }

    public function find(string $clinicId, string $id): ?stdClass
    {
        $row = DB::table('public_contents')->where('clinic_id', $clinicId)->where('id', $id)->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'code' => (string) $row->code,
            'title' => (string) $row->title,
            'content' => (string) $row->content,
            'revision_no' => (int) $row->revision_no,
            'status' => (string) $row->status,
            'published_at' => $row->published_at !== null ? CarbonImmutable::parse((string) $row->published_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z') : null,
            'version' => (int) $row->version,
        ];
    }
}

<?php

namespace App\Domain\PublicSite;

use App\Domain\PublicSite\Rules\PublicSiteRules;
use App\Domain\Shared\BusinessError;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures des fiches du showroom (L3D02) : côté gérante (brouillons compris, notes de droits) et côté public (fiches
 * PUBLIÉES seulement). Le côté public est une liste BLANCHE de champs : titre, description, style, marque, prix de vente
 * si la gérante le montre, images approuvées. Il ne lit jamais le coût d'achat, le stock, la référence interne ni l'identité
 * d'un compte : ces colonnes ne figurent dans aucune requête ci-dessous qui sert le public.
 */
final class Publications
{
    public const PER_PAGE = 25;

    public const PUBLIC_PER_PAGE = 25;

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public function adminPage(string $clinicId, mixed $status, mixed $page): LengthAwarePaginator
    {
        $query = $this->baseQuery()->where('p.clinic_id', $clinicId);
        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, PublicSiteRules::STATUSES, true)) {
                throw BusinessError::validation(['status' => ['Statut inconnu : DRAFT, PUBLISHED ou ARCHIVED.']]);
            }
            $query->where('p.status', $status);
        }

        return $query->orderBy('p.display_order')->orderBy('p.public_title')->orderBy('p.id')
            ->paginate(self::PER_PAGE, ['*'], 'page', self::pageNumber($page));
    }

    public function adminRow(string $clinicId, string $id): stdClass
    {
        $row = $this->baseQuery()->where('p.clinic_id', $clinicId)->where('p.id', $id)->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound('Fiche introuvable dans ce cabinet.');
        }

        return $row;
    }

    /**
     * @param  list<stdClass>  $rows
     * @return list<array<string, mixed>>
     */
    public function presentAdmin(string $clinicId, array $rows): array
    {
        $media = $this->mediaOf($clinicId, array_map(static fn (stdClass $row): string => (string) $row->id, $rows));

        return array_map(static fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'catalog_item_id' => (string) $row->catalog_item_id,
            'item_name' => (string) $row->item_name,
            'item_reference' => (string) $row->item_reference,
            'item_eligible' => (bool) $row->item_active && (bool) $row->item_public_visibility,
            'slug' => (string) $row->slug,
            'public_title' => (string) $row->public_title,
            'public_description' => (string) $row->public_description,
            'style' => $row->style !== null ? (string) $row->style : null,
            'show_sale_price' => (bool) $row->show_sale_price,
            'sale_price' => (int) $row->item_sale_price,
            'status' => (string) $row->status,
            'display_order' => (int) $row->display_order,
            'published_at' => $row->published_at !== null ? self::iso((string) $row->published_at) : null,
            'version' => (int) $row->version,
            'media' => array_map(static fn (stdClass $m): array => [
                'id' => (string) $m->id,
                'alt_text' => (string) $m->alt_text,
                'rights_note' => (string) $m->rights_note,
                'display_order' => (int) $m->display_order,
                'approved_at' => self::iso((string) $m->approved_at),
            ], $media[(string) $row->id] ?? []),
        ], $rows);
    }

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public function publicPage(string $clinicId, mixed $style, mixed $brand, mixed $page): LengthAwarePaginator
    {
        $query = $this->publicQuery($clinicId);
        foreach (['p.style' => $style, 'i.brand' => $brand] as $column => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            if (! is_string($value) || mb_strlen($value, 'UTF-8') > 120) {
                throw BusinessError::validation([str_contains($column, 'style') ? 'style' : 'brand' => ['Filtre invalide.']]);
            }
            $query->where($column, $value);
        }

        return $query->orderBy('p.display_order')->orderBy('p.public_title')->orderBy('p.id')
            ->paginate(self::PUBLIC_PER_PAGE, ['*'], 'page', self::pageNumber($page));
    }

    public function publicBySlug(string $clinicId, string $slug): ?stdClass
    {
        $row = $this->publicQuery($clinicId)->where('p.slug', $slug)->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Filtres proposés au visiteur : les styles et marques des fiches publiées, jamais ceux d'un brouillon.
     *
     * @return array{styles: list<string>, brands: list<string>}
     */
    public function publicFacets(string $clinicId): array
    {
        $rows = $this->publicQuery($clinicId)->get(['p.style', 'i.brand']);
        $styles = [];
        $brands = [];
        foreach ($rows as $row) {
            if ($row->style !== null && $row->style !== '') {
                $styles[(string) $row->style] = true;
            }
            if ($row->brand !== null && $row->brand !== '') {
                $brands[(string) $row->brand] = true;
            }
        }
        $styles = array_keys($styles);
        $brands = array_keys($brands);
        sort($styles);
        sort($brands);

        return ['styles' => $styles, 'brands' => $brands];
    }

    /**
     * @param  list<stdClass>  $rows
     * @return list<array<string, mixed>>
     */
    public function presentPublic(string $clinicId, array $rows): array
    {
        $media = $this->mediaOf($clinicId, array_map(static fn (stdClass $row): string => (string) $row->id, $rows));

        return array_map(static fn (stdClass $row): array => [
            'slug' => (string) $row->slug,
            'title' => (string) $row->public_title,
            'description' => (string) $row->public_description,
            'style' => $row->style !== null ? (string) $row->style : null,
            'brand' => $row->brand !== null ? (string) $row->brand : null,
            'price' => (bool) $row->show_sale_price ? (int) $row->item_sale_price : null,
            'currency' => 'XAF',
            'media' => array_map(static fn (stdClass $m): array => [
                'url' => '/public/v1/media/'.$m->id,
                'alt' => (string) $m->alt_text,
            ], $media[(string) $row->id] ?? []),
        ], $rows);
    }

    /**
     * Image servie au public : approuvée, d'une fiche PUBLIÉE dont l'article est actif et visible. Sinon null (404).
     */
    public function publicMedia(string $clinicId, string $mediaId): ?stdClass
    {
        $row = DB::table('catalog_media as m')
            ->join('catalog_publications as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 'm.clinic_id')->on('p.id', '=', 'm.publication_id');
            })
            ->join('catalog_items as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.catalog_item_id');
            })
            ->join('stored_files as f', static function ($join): void {
                $join->on('f.clinic_id', '=', 'm.clinic_id')->on('f.id', '=', 'm.file_id');
            })
            ->where('m.clinic_id', $clinicId)->where('m.id', $mediaId)
            ->where('p.status', PublicSiteRules::PUBLISHED)->where('i.active', true)->where('i.public_visibility', true)
            ->where('f.classification', 'PUBLIC_APPROVED')
            ->first(['f.private_path', 'f.mime_type', 'f.sha256']);

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Image pour la gérante, brouillon compris.
     */
    public function adminMedia(string $clinicId, string $mediaId): ?stdClass
    {
        $row = DB::table('catalog_media as m')
            ->join('stored_files as f', static function ($join): void {
                $join->on('f.clinic_id', '=', 'm.clinic_id')->on('f.id', '=', 'm.file_id');
            })
            ->where('m.clinic_id', $clinicId)->where('m.id', $mediaId)
            ->first(['f.private_path', 'f.mime_type', 'f.sha256', 'm.publication_id']);

        return $row instanceof stdClass ? $row : null;
    }

    public function mediaBelongsTo(string $clinicId, string $publicationId, string $mediaId): bool
    {
        return DB::table('catalog_media')->where('clinic_id', $clinicId)->where('publication_id', $publicationId)->where('id', $mediaId)->exists();
    }

    private function baseQuery(): Builder
    {
        return DB::table('catalog_publications as p')
            ->join('catalog_items as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.catalog_item_id');
            })
            ->select(['p.*', 'i.name as item_name', 'i.reference as item_reference', 'i.sale_price as item_sale_price',
                'i.active as item_active', 'i.public_visibility as item_public_visibility', 'i.brand as brand']);
    }

    private function publicQuery(string $clinicId): Builder
    {
        return $this->baseQuery()->where('p.clinic_id', $clinicId)->where('p.status', PublicSiteRules::PUBLISHED)
            ->where('i.active', true)->where('i.public_visibility', true);
    }

    /**
     * @param  list<string>  $publicationIds
     * @return array<string, list<stdClass>>
     */
    private function mediaOf(string $clinicId, array $publicationIds): array
    {
        if ($publicationIds === []) {
            return [];
        }
        $byPublication = [];
        foreach (DB::table('catalog_media')->where('clinic_id', $clinicId)->whereIn('publication_id', $publicationIds)
            ->orderBy('display_order')->orderBy('id')
            ->get(['id', 'publication_id', 'alt_text', 'rights_note', 'display_order', 'approved_at']) as $media) {
            $byPublication[(string) $media->publication_id][] = $media;
        }

        return $byPublication;
    }

    private static function pageNumber(mixed $page): int
    {
        if ($page === null) {
            return 1;
        }
        if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
            throw BusinessError::validation(['page' => ['La page est un entier supérieur ou égal à 1.']]);
        }

        return (int) $page;
    }

    private static function iso(string $datetime): string
    {
        return CarbonImmutable::parse($datetime, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

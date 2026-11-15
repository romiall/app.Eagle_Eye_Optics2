<?php

namespace App\Domain\PublicSite\Rules;

use Illuminate\Support\Str;

/**
 * Règles du site public (L3D02, EE039) : seules les références PUBLIÉES et les contenus APPROUVÉS par la gérante sortent
 * de l'application. Aucun prix d'achat, aucun stock, aucune donnée de patient : le site public ne lit jamais ces tables.
 *
 * Un contenu public est limité à une liste fermée de codes (vitrine, expertises, horaires, localisation, WhatsApp,
 * réseaux, contact) : ce n'est pas un gestionnaire de contenu illimité.
 */
final class PublicSiteRules
{
    public const DRAFT = 'DRAFT';

    public const PUBLISHED = 'PUBLISHED';

    public const ARCHIVED = 'ARCHIVED';

    /** @var list<string> */
    public const STATUSES = [self::DRAFT, self::PUBLISHED, self::ARCHIVED];

    /**
     * Contenus publics : code → libellé de l'écran. Le code est la clé stable lue par le site (jamais un texte libre).
     *
     * @var array<string, string>
     */
    public const CONTENT_CODES = [
        'ACCUEIL' => 'Accueil et positionnement',
        'EXPERTISES' => 'Pôles d’expertise',
        'HORAIRES' => 'Horaires d’ouverture',
        'LOCALISATION' => 'Adresse et plan d’accès',
        'WHATSAPP' => 'Numéro WhatsApp',
        'RESEAUX_SOCIAUX' => 'Réseaux sociaux',
        'CONTACT' => 'Coordonnées de contact',
    ];

    /** Images admises pour le showroom : type MIME → extension du fichier privé. */
    public const MEDIA_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    public const TITLE_MAX = 180;

    public const DESCRIPTION_MIN = 10;

    public const DESCRIPTION_MAX = 2000;

    public const CONTENT_MAX = 4000;

    public const STYLE_MAX = 100;

    /** Transitions permises d'une fiche ou d'un contenu : jamais de saut qui publierait sans approbation. */
    private const TRANSITIONS = [
        self::DRAFT => [self::PUBLISHED, self::ARCHIVED],
        self::PUBLISHED => [self::DRAFT, self::ARCHIVED],
        self::ARCHIVED => [self::DRAFT],
    ];

    public static function slugOf(string $title): string
    {
        return Str::slug($title);
    }

    public static function isSlug(string $value): bool
    {
        return preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $value) === 1 && mb_strlen($value) <= 180;
    }

    public static function mayTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    /**
     * Numéro WhatsApp : chiffres seuls (indicatif compris, sans « + » ni espaces), de 8 à 15 chiffres, tel que le lien
     * `https://wa.me/<numéro>` l'exige. Null si le texte n'est pas un numéro.
     */
    public static function whatsappDigits(string $text): ?string
    {
        $digits = preg_replace('/[\s().-]+/', '', $text) ?? '';
        $digits = ltrim($digits, '+');

        return preg_match('/^[0-9]{8,15}$/', $digits) === 1 ? $digits : null;
    }
}

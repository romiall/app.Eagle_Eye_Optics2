<?php

namespace App\Domain\PublicSite;

use App\Domain\PublicSite\Rules\PublicSiteRules;
use App\Domain\Shared\BusinessError;

/**
 * Octets d'une image du showroom (L3D02) : contrôle strict AVANT toute écriture (taille, vrai format lu dans les
 * octets, jamais le type annoncé), empreinte SHA-256 et chemin privé adressé par le contenu (aucune donnée personnelle
 * dans le chemin). Seuls JPEG, PNG et WebP sont admis ; un SVG, qui peut porter un script, ne l'est jamais.
 */
final class MediaFiles
{
    /**
     * @return array{mime: string, extension: string, sha256: string, size: int, width: int, height: int}
     */
    public static function inspect(string $bytes, int $maxBytes): array
    {
        $size = strlen($bytes);
        if ($size === 0) {
            throw BusinessError::validation(['file' => ['Aucune image reçue.']]);
        }
        if ($size > $maxBytes) {
            throw BusinessError::validation(['file' => ['L\'image dépasse '.self::megabytes($maxBytes).' Mo : réduisez-la avant de la déposer.']]);
        }

        $info = @getimagesizefromstring($bytes);
        if ($info === false || ! array_key_exists($info['mime'], PublicSiteRules::MEDIA_TYPES)) {
            throw BusinessError::validation(['file' => ['Seules les images JPEG, PNG et WebP sont acceptées.']]);
        }
        $mime = $info['mime'];
        $width = $info[0];
        $height = $info[1];
        if ($width < 200 || $height < 200 || $width > 8000 || $height > 8000) {
            throw BusinessError::validation(['file' => ['L\'image doit mesurer entre 200 et 8 000 pixels de chaque côté.']]);
        }

        return [
            'mime' => $mime,
            'extension' => PublicSiteRules::MEDIA_TYPES[$mime],
            'sha256' => hash('sha256', $bytes),
            'size' => $size,
            'width' => $width,
            'height' => $height,
        ];
    }

    public static function pathFor(string $clinicId, string $sha256, string $extension): string
    {
        return 'public-media/'.$clinicId.'/'.$sha256.'.'.$extension;
    }

    private static function megabytes(int $bytes): string
    {
        return rtrim(rtrim(number_format($bytes / 1048576, 1, ',', ''), '0'), ',');
    }
}

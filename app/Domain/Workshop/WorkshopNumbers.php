<?php

namespace App\Domain\Workshop;

use App\Application\Locking\TransactionLocks;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\DocumentNumbers;
use Carbon\CarbonImmutable;

/**
 * Numérotation centrale des commandes d'atelier optique (L1D04) : série `WORKSHOP` distincte des séries financières
 * (`BillingNumbers`). Retourne `{value, rendered, year}` pour enregistrement immédiat dans `document_number_usages`.
 */
final class WorkshopNumbers
{
    /**
     * @return array{value: int, rendered: string, year: int}
     */
    public static function allocate(TransactionLocks $locks, CommandContext $context, string $timezone, CarbonImmutable $at): array
    {
        $prefix = (string) config('eeo.numbering.workshop_prefix', 'TEST-ATL');
        $width = max(1, (int) config('eeo.numbering.width', 6));

        return DocumentNumbers::allocateCentral(
            $locks,
            $context,
            'WORKSHOP',
            $timezone,
            $at,
            static fn (string $type, int $year, int $value): string => sprintf(
                '%s-%04d-%s',
                $prefix,
                $year,
                str_pad((string) $value, $width, '0', STR_PAD_LEFT),
            ),
        );
    }
}

<?php

namespace App\Domain\Billing\Reports;

use App\Domain\Shared\BusinessError;
use App\Domain\Shared\DayWindow;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Instant;
use Carbon\CarbonImmutable;

/**
 * Période d'une lecture financière (rapport de finance, R01) : deux jours civils du cabinet (`AAAA-MM-JJ`, bornes
 * incluses, au plus 366 jours) et leur fenêtre UTC (début inclus, fin exclue) pour comparer des instants stockés en UTC.
 * Sans `from` ni `to`, la période est aujourd'hui au fuseau du cabinet. Une date illisible, absente à moitié, inversée ou
 * trop longue est refusée en 422 sur son champ, jamais remplacée en silence.
 */
final class ReportPeriod
{
    /** Période la plus longue acceptée (une année bissextile complète), comme les statistiques (R02). */
    public const MAX_DAYS = 366;

    private function __construct(
        public readonly CivilDate $from,
        public readonly CivilDate $to,
        public readonly string $start,
        public readonly string $end,
    ) {}

    public static function resolve(string $timezone, CarbonImmutable $now, mixed $from, mixed $to): self
    {
        if (self::absent($from) && self::absent($to)) {
            $today = Instant::fromEpochMilliseconds((int) $now->format('Uv'))->civilDate($timezone);
            $start = $today;
            $end = $today;
        } else {
            $errors = [];
            $start = self::date($from, 'from', $errors);
            $end = self::date($to, 'to', $errors);
            if ($start !== null && $end !== null) {
                if ($end->compare($start) < 0) {
                    $errors['to'][] = 'La fin de la période précède son début.';
                } elseif ($end->dayNumber() - $start->dayNumber() + 1 > self::MAX_DAYS) {
                    $errors['to'][] = 'La période couvre au plus '.self::MAX_DAYS.' jours.';
                }
            }
            if ($errors !== [] || $start === null || $end === null) {
                throw BusinessError::validation($errors);
            }
        }

        return new self($start, $end, DayWindow::utc($start, $timezone)[0], DayWindow::utc($end, $timezone)[1]);
    }

    private static function absent(mixed $value): bool
    {
        return $value === null || $value === '';
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function date(mixed $value, string $field, array &$errors): ?CivilDate
    {
        if (self::absent($value)) {
            $errors[$field][] = 'La date est obligatoire (AAAA-MM-JJ).';

            return null;
        }
        try {
            return CivilDate::fromString(is_string($value) ? $value : '', $field);
        } catch (RuleViolation $violation) {
            $errors[$field][] = $violation->getMessage();

            return null;
        }
    }
}

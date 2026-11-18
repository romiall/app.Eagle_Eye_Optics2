<?php

namespace App\Domain\Cash;

use App\Domain\Billing\Rules\PaymentRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\DayWindow;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Dépenses et mouvements hors vente (L1D05 ; fichier 03 : « Les sorties de caisse réelles (remboursement, dépôt,
 * retrait, dépense) sont enregistrées et autorisées […] Aucune sortie d'espèces ne doit être masquée par une remise
 * commerciale fictive » ; EE030 ; AT25, AT30).
 *
 * Natures (CHECK de `cash_movements`) :
 *   DEPOSIT              entrée d'espèces dans le tiroir (fonds de caisse complété), motif requis   montant > 0
 *   WITHDRAWAL           sortie réelle du tiroir (versement en banque, mise en coffre), motif requis montant < 0
 *   EXPENSE              dépense catégorisée (tiroir espèces ou autre canal, motif/référence         montant < 0
 *                        facultatifs, saisie directe sans approbation préalable)
 *   OPENING_CORRECTION   correction d'une erreur de saisie de l'ouverture (motif requis)             ≠ 0, signe libre
 */
final class CashMovements
{
    public const KINDS = ['DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'OPENING_CORRECTION'];

    public const PER_PAGE = 25;

    public const REASON_MIN = 3;

    public const REASON_MAX = 500;

    public const REFERENCE_MAX = 180;

    /** Plafond d'un mouvement (même borne que les montants d'une session). */
    public const MAX_AMOUNT = 1_000_000_000_000;

    /**
     * Forme d'un mouvement : nature et canal connus, cohérence tiroir/session, montant non nul dans la borne,
     * signe imposé par la nature, catégorie présente pour une dépense et seulement pour elle.
     *
     * @throws RuleViolation
     */
    public static function assertShape(string $kind, string $method, ?string $sessionId, int $signedAmount, ?string $categoryId, string $prefix = ''): void
    {
        if (! in_array($kind, self::KINDS, true)) {
            throw RuleViolation::invalid($prefix.'movement_kind', 'cash.movement_kind', 'Nature de mouvement inconnue.');
        }
        if (! in_array($method, PaymentRules::METHODS, true)) {
            throw RuleViolation::invalid($prefix.'method', 'cash.movement_method', 'Canal de règlement inconnu.');
        }
        if ($kind !== 'EXPENSE' && $method !== 'CASH') {
            throw RuleViolation::invalid($prefix.'method', 'cash.movement_method_forbidden', 'Seule une dépense peut être enregistrée hors tiroir espèces.');
        }
        if ($method === 'CASH' && $sessionId === null) {
            throw RuleViolation::invalid($prefix.'cash_session_id', 'cash.session_required', 'Une opération en espèces exige une session de caisse ouverte.');
        }
        if ($method !== 'CASH' && $sessionId !== null) {
            throw RuleViolation::invalid($prefix.'cash_session_id', 'cash.session_forbidden', 'Une dépense hors espèces ne se rattache pas à une session de caisse.');
        }
        if ($signedAmount === 0 || abs($signedAmount) > self::MAX_AMOUNT) {
            throw RuleViolation::invalid($prefix.'signed_amount', 'cash.movement_amount', 'Montant non nul attendu (en FCFA, sans décimale).');
        }
        if ($kind === 'DEPOSIT' && $signedAmount < 0) {
            throw RuleViolation::invalid($prefix.'signed_amount', 'cash.movement_sign', 'Un dépôt est une entrée : montant positif.');
        }
        if (in_array($kind, ['WITHDRAWAL', 'EXPENSE'], true) && $signedAmount > 0) {
            throw RuleViolation::invalid($prefix.'signed_amount', 'cash.movement_sign', 'Une sortie ou une dépense est négative.');
        }
        if ($kind === 'EXPENSE' && $categoryId === null) {
            throw RuleViolation::invalid($prefix.'expense_category_id', 'cash.expense_category_required', 'Choisissez la catégorie de la dépense.');
        }
        if ($kind !== 'EXPENSE' && $categoryId !== null) {
            throw RuleViolation::invalid($prefix.'expense_category_id', 'cash.expense_category_forbidden', 'Seule une dépense a une catégorie.');
        }
    }

    public static function activeCategory(string $clinicId, string $categoryId): bool
    {
        return DB::table('expense_categories')->where('clinic_id', $clinicId)->where('id', $categoryId)->where('active', 1)->exists();
    }

    /**
     * Catégories de dépenses du cabinet, actives d'abord puis par nom.
     *
     * @return list<stdClass>
     */
    public static function categories(string $clinicId, bool $activeOnly = false): array
    {
        $query = DB::table('expense_categories')->where('clinic_id', $clinicId);
        if ($activeOnly) {
            $query->where('active', 1);
        }

        return array_values($query->orderByDesc('active')->orderBy('name')->orderBy('id')->get()->all());
    }

    /**
     * Mouvements d'une session, du plus ancien au plus récent, avec la catégorie, l'auteur (nom actuel) et la forme de
     * l'autorisation (APPROVED : demande accordée ; DIRECT : exécution de la gérante ; null : dépense directe).
     *
     * @return list<stdClass>
     */
    public static function forSession(string $clinicId, string $sessionId): array
    {
        return array_values(self::baseQuery($clinicId)
            ->where('m.cash_session_id', $sessionId)
            ->orderBy('m.occurred_at')
            ->orderBy('m.id')
            ->get(self::SELECT_COLUMNS)
            ->all());
    }

    public static function findForPresentation(string $clinicId, string $movementId): ?stdClass
    {
        $row = self::baseQuery($clinicId)
            ->where('m.id', $movementId)
            ->first(self::SELECT_COLUMNS);

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Liste paginée des dépenses du cabinet (les plus récentes d'abord), filtrable par période civile, catégorie,
     * canal de règlement ou session ; une caissière ne voit que ses dépenses sauf `cash.manage`.
     *
     * @param  array{from?: mixed, to?: mixed, category_id?: mixed, method?: mixed, cash_session_id?: mixed, page?: mixed}  $filters
     * @return LengthAwarePaginator<int, stdClass>
     */
    public static function expenses(string $clinicId, string $timezone, string $actorId, bool $allClinic, array $filters): LengthAwarePaginator
    {
        $query = self::baseQuery($clinicId)->where('m.kind', 'EXPENSE');
        if (! $allClinic) {
            $query->where('m.created_by', $actorId);
        }

        $errors = [];
        $fromRaw = $filters['from'] ?? null;
        $toRaw = $filters['to'] ?? null;
        $fromDate = null;
        $toDate = null;
        if ($fromRaw !== null && $fromRaw !== '') {
            try {
                $fromDate = CivilDate::fromString(is_string($fromRaw) ? $fromRaw : '', 'from');
            } catch (RuleViolation $violation) {
                $errors['from'][] = $violation->getMessage();
            }
        }
        if ($toRaw !== null && $toRaw !== '') {
            try {
                $toDate = CivilDate::fromString(is_string($toRaw) ? $toRaw : '', 'to');
            } catch (RuleViolation $violation) {
                $errors['to'][] = $violation->getMessage();
            }
        }
        if ($fromDate !== null && $toDate !== null && $toDate->compare($fromDate) < 0) {
            $errors['to'][] = 'La fin de la période précède son début.';
        }

        $categoryId = $filters['category_id'] ?? null;
        if ($categoryId !== null && $categoryId !== '') {
            if (! is_string($categoryId) || ! Ulid::isValid($categoryId)) {
                $errors['category_id'][] = 'Catégorie invalide.';
            } else {
                $query->where('m.expense_category_id', $categoryId);
            }
        }

        $method = $filters['method'] ?? null;
        if ($method !== null && $method !== '') {
            if (! is_string($method) || ! in_array($method, PaymentRules::METHODS, true)) {
                $errors['method'][] = 'Canal de règlement inconnu.';
            } else {
                $query->where('m.method', $method);
            }
        }

        $sessionId = $filters['cash_session_id'] ?? null;
        if ($sessionId !== null && $sessionId !== '') {
            if (! is_string($sessionId) || ! Ulid::isValid($sessionId)) {
                $errors['cash_session_id'][] = 'Session de caisse invalide.';
            } else {
                $query->where('m.cash_session_id', $sessionId);
            }
        }

        $pageNumber = 1;
        $page = $filters['page'] ?? null;
        if ($page !== null && $page !== '') {
            if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                $errors['page'][] = 'La page est un entier supérieur ou égal à 1.';
            } else {
                $pageNumber = (int) $page;
            }
        }

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        if ($fromDate !== null) {
            $query->where('m.occurred_at', '>=', DayWindow::utc($fromDate, $timezone)[0]);
        }
        if ($toDate !== null) {
            $query->where('m.occurred_at', '<', DayWindow::utc($toDate, $timezone)[1]);
        }

        return $query->orderByDesc('m.occurred_at')->orderByDesc('m.id')
            ->paginate(self::PER_PAGE, self::SELECT_COLUMNS, 'page', $pageNumber);
    }

    private const SELECT_COLUMNS = [
        'm.id', 'm.cash_session_id', 'm.kind', 'm.method', 'm.signed_amount', 'm.reason', 'm.reference', 'm.occurred_at',
        'm.approval_id', 'm.expense_category_id', 'm.created_by', 'c.code as category_code', 'c.name as category_name',
        'u.display_name as created_by_name', 'a.requested_by as approval_requested_by', 'a.decided_by as approval_decided_by',
    ];

    private static function baseQuery(string $clinicId): Builder
    {
        return DB::table('cash_movements as m')
            ->leftJoin('expense_categories as c', static function (JoinClause $join): void {
                $join->on('c.clinic_id', '=', 'm.clinic_id')->on('c.id', '=', 'm.expense_category_id');
            })
            ->leftJoin('users as u', static function (JoinClause $join): void {
                $join->on('u.clinic_id', '=', 'm.clinic_id')->on('u.id', '=', 'm.created_by');
            })
            ->leftJoin('approvals as a', static function (JoinClause $join): void {
                $join->on('a.clinic_id', '=', 'm.clinic_id')->on('a.id', '=', 'm.approval_id');
            })
            ->where('m.clinic_id', $clinicId);
    }

    /**
     * Revue de l'écart d'une session clôturée par la gérante (dernier événement `cash.variance_reviewed`), ou null.
     */
    public static function varianceReview(string $clinicId, string $sessionId): ?stdClass
    {
        return DB::table('audit_events')
            ->where('clinic_id', $clinicId)
            ->where('action', 'cash.variance_reviewed')
            ->where('target_type', 'cash_sessions')
            ->where('target_id', $sessionId)
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->first(['actor_id', 'actor_name_snapshot', 'recorded_at', 'reason', 'sanitized_diff']);
    }
}

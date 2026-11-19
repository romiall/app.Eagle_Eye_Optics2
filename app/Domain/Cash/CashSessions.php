<?php

namespace App\Domain\Cash;

use App\Domain\Cash\Rules\CashClosing;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures des caisses et sessions de caisse du cabinet (B05, EE030) et projections d'une session : encaissements
 * et remboursements en espèces, contre-écritures espèces, mouvements autorisés, espèces théoriques. Toujours limité
 * au cabinet. Ces totaux sont des PROJECTIONS recalculées à chaque lecture (aucune colonne ne les stocke) ; la clôture
 * fige la photographie de l'instant dans `cash_sessions`.
 */
final class CashSessions
{
    /** Session ouverte du compte (une au plus : clé unique sur la caissière tant que la session est ouverte). */
    public static function current(string $clinicId, string $cashierId): ?stdClass
    {
        $row = DB::table('cash_sessions')
            ->where('clinic_id', $clinicId)
            ->where('cashier_id', $cashierId)
            ->whereNull('closed_at')
            ->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Session ouverte recevant l'encaissement automatique à l'émission d'une facture : d'abord celle de
     * l'auteur si elle est ouverte avant `$atDb`, sinon la plus ancienne session ouverte active du cabinet.
     */
    public static function resolveOpenForCollection(string $clinicId, string $actorId, string $atDb): ?stdClass
    {
        $own = DB::table('cash_sessions')
            ->where('clinic_id', $clinicId)
            ->where('cashier_id', $actorId)
            ->whereNull('closed_at')
            ->where('opened_at', '<=', $atDb)
            ->first();

        if ($own instanceof stdClass) {
            return $own;
        }

        $clinicSession = DB::table('cash_sessions')
            ->where('clinic_id', $clinicId)
            ->whereNull('closed_at')
            ->where('opened_at', '<=', $atDb)
            ->orderBy('opened_at')
            ->orderBy('id')
            ->first();

        return $clinicSession instanceof stdClass ? $clinicSession : null;
    }

    public static function find(string $clinicId, string $sessionId): ?stdClass
    {
        $row = DB::table('cash_sessions')->where('clinic_id', $clinicId)->where('id', $sessionId)->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Caisses actives du cabinet (la caisse principale du premier jalon : une seule, voir `eeo:sales:bootstrap`).
     *
     * @return list<stdClass>
     */
    public static function registers(string $clinicId): array
    {
        return array_values(DB::table('cash_registers')->where('clinic_id', $clinicId)->where('active', 1)->orderBy('code')->orderBy('id')->get()->all());
    }

    /**
     * @return array{received: int, reversed: int, refunded: int, moved: int}
     */
    public static function totals(string $clinicId, string $sessionId): array
    {
        $received = (int) DB::table('payments')
            ->where('clinic_id', $clinicId)
            ->where('cash_session_id', $sessionId)
            ->where('status', 'CONFIRMED')
            ->where('method', 'CASH')
            ->sum('amount');

        $reversed = (int) DB::table('payment_reversals')
            ->join('payments', static function ($join): void {
                $join->on('payments.clinic_id', '=', 'payment_reversals.clinic_id')->on('payments.id', '=', 'payment_reversals.payment_id');
            })
            ->where('payments.clinic_id', $clinicId)
            ->where('payments.cash_session_id', $sessionId)
            ->where('payments.method', 'CASH')
            ->sum('payment_reversals.amount');

        $refunded = (int) DB::table('refunds')
            ->where('clinic_id', $clinicId)
            ->where('cash_session_id', $sessionId)
            ->where('method', 'CASH')
            ->sum('amount');

        $moved = (int) DB::table('cash_movements')
            ->where('clinic_id', $clinicId)
            ->where('cash_session_id', $sessionId)
            ->sum('signed_amount');

        return ['received' => $received, 'reversed' => $reversed, 'refunded' => $refunded, 'moved' => $moved];
    }

    public static function theoretical(stdClass $session): int
    {
        $totals = self::totals((string) $session->clinic_id, (string) $session->id);

        return CashClosing::theoretical((int) $session->opening_amount, $totals['received'], $totals['reversed'], $totals['refunded'], $totals['moved']);
    }
}

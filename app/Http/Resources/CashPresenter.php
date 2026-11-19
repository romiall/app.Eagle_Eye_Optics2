<?php

namespace App\Http\Resources;

use App\Domain\Cash\CashSessions;
use Carbon\CarbonImmutable;
use stdClass;

/**
 * Représentation des caisses et sessions de caisse pour l'API (`CashRegister`, `CashSession` de
 * `schemas/resources/billing.json`). Les totaux d'une session (`collected_cash`, `refunded_cash`, `theoretical_cash`)
 * sont des PROJECTIONS recalculées à chaque lecture depuis les paiements, remboursements, contre-écritures et
 * mouvements en espèces : `expected_amount` n'est renseigné qu'à la clôture, il est alors la photographie figée.
 */
final class CashPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function register(stdClass $row): array
    {
        return ['id' => $row->id, 'code' => $row->code, 'name' => $row->name, 'active' => (bool) $row->active];
    }

    /**
     * @return array<string, mixed>
     */
    public static function session(stdClass $session): array
    {
        $totals = CashSessions::totals((string) $session->clinic_id, (string) $session->id);

        return [
            'id' => $session->id,
            'cash_register_id' => $session->cash_register_id,
            'cashier_id' => $session->cashier_id,
            'opened_at' => self::instant((string) $session->opened_at),
            'opening_amount' => (int) $session->opening_amount,
            'closed_at' => $session->closed_at === null ? null : self::instant((string) $session->closed_at),
            'counted_amount' => $session->counted_amount === null ? null : (int) $session->counted_amount,
            'expected_amount' => $session->expected_amount === null ? null : (int) $session->expected_amount,
            'variance' => $session->variance === null ? null : (int) $session->variance,
            'variance_reason' => $session->variance_reason,
            'closed_by' => $session->closed_by,
            'collected_cash' => $totals['received'],
            'refunded_cash' => $totals['refunded'],
            'theoretical_cash' => CashSessions::theoretical($session),
        ];
    }

    /**
     * Session et ses libellés (`CashSessionEntry`) : la session (`CashSession`) plus le nom ACTUEL de la caissière, de qui
     * a clôturé et la caisse. Lignes lues par `CashSessionDirectory` (colonnes `cashier_name`, `closed_by_name`,
     * `register_code`, `register_name`).
     *
     * @return array<string, mixed>
     */
    public static function entry(stdClass $session): array
    {
        return self::session($session) + [
            'cashier_name' => is_string($session->cashier_name ?? null) ? $session->cashier_name : null,
            'closed_by_name' => is_string($session->closed_by_name ?? null) ? $session->closed_by_name : null,
            'register_code' => is_string($session->register_code ?? null) ? $session->register_code : null,
            'register_name' => is_string($session->register_name ?? null) ? $session->register_name : null,
        ];
    }

    /**
     * Représentation API d'une dépense ou d'un mouvement de caisse (`CashMovement`).
     *
     * @return array<string, mixed>
     */
    public static function movement(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'cash_session_id' => $row->cash_session_id === null ? null : (string) $row->cash_session_id,
            'kind' => (string) $row->kind,
            'method' => (string) ($row->method ?? 'CASH'),
            'signed_amount' => (int) $row->signed_amount,
            'reason' => $row->reason === null ? null : (string) $row->reason,
            'reference' => $row->reference === null ? null : (string) $row->reference,
            'occurred_at' => self::instant((string) $row->occurred_at),
            'expense_category' => $row->expense_category_id === null ? null : [
                'id' => (string) $row->expense_category_id,
                'code' => (string) $row->category_code,
                'name' => (string) $row->category_name,
            ],
            'created_by' => (string) $row->created_by,
            'created_by_name' => $row->created_by_name === null ? null : (string) $row->created_by_name,
            'approval_id' => $row->approval_id === null ? null : (string) $row->approval_id,
            'approval_mode' => $row->approval_id === null
                ? null
                : ((string) $row->approval_requested_by === (string) $row->approval_decided_by ? 'DIRECT' : 'APPROVED'),
        ];
    }

    /**
     * Relevé d'une session (`CashSessionReport`) : tiroir espèces, mouvements, encaissements de la session, journal
     * chronologique unifié et autres modes de la caissière pendant la session.
     *
     * @param  array{
     *     session: stdClass,
     *     cash_received: int,
     *     cash_reversed: int,
     *     cash_refunded: int,
     *     movements_in: int,
     *     movements_out: int,
     *     movements: list<stdClass>,
     *     payments: list<stdClass>,
     *     other_methods: list<array{method: string, count: int, amount: int}>,
     *     journal: list<array{id: string, entry_type: string, occurred_at: string, signed_amount: int, method: string, label: string, detail: ?string, invoice_id: ?string, invoice_number: ?string, receipt_number: ?string, patient_name: ?string, movement_kind: ?string, reference: ?string}>
     * }  $report
     * @return array<string, mixed>
     */
    public static function report(array $report, CarbonImmutable $generatedAt): array
    {
        return [
            'session' => self::entry($report['session']),
            'cash_received' => $report['cash_received'],
            'cash_reversed' => $report['cash_reversed'],
            'cash_refunded' => $report['cash_refunded'],
            'movements_in' => $report['movements_in'],
            'movements_out' => $report['movements_out'],
            'movements' => array_map(static fn (stdClass $movement): array => [
                'id' => $movement->id,
                'kind' => $movement->kind,
                'signed_amount' => (int) $movement->signed_amount,
                'reason' => $movement->reason === null ? null : (string) $movement->reason,
                'occurred_at' => self::instant((string) $movement->occurred_at),
            ], $report['movements']),
            'payments' => array_map(static fn (stdClass $payment): array => [
                'payment_id' => $payment->payment_id,
                'invoice_id' => $payment->invoice_id,
                'invoice_number' => $payment->invoice_number,
                'receipt_id' => $payment->receipt_id,
                'receipt_number' => $payment->receipt_number,
                'method' => $payment->method,
                'amount' => (int) $payment->amount,
                'reversed_amount' => (int) $payment->reversed_amount,
                'effective_at' => self::instant((string) $payment->effective_at),
            ], $report['payments']),
            'other_methods' => $report['other_methods'],
            'journal' => array_map(static fn (array $entry): array => [
                'id' => $entry['id'],
                'entry_type' => $entry['entry_type'],
                'occurred_at' => self::instant($entry['occurred_at']),
                'signed_amount' => $entry['signed_amount'],
                'method' => $entry['method'],
                'label' => $entry['label'],
                'detail' => $entry['detail'],
                'invoice_id' => $entry['invoice_id'],
                'invoice_number' => $entry['invoice_number'],
                'receipt_number' => $entry['receipt_number'],
                'patient_name' => $entry['patient_name'],
                'movement_kind' => $entry['movement_kind'],
                'reference' => $entry['reference'],
            ], $report['journal']),
            'generated_at' => $generatedAt->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * « Caisse du jour » (`CashDayReport`) : encaissements nets par mode, sessions du jour, et pour la gérante
     * seulement, factures émises, avoirs émis et reste à encaisser (null pour la portée `OWN`).
     *
     * @param  array{scope: string, sessions: list<stdClass>, collections: list<array{method: string, payments_count: int, payments_amount: int, reversals_amount: int, refunds_amount: int, net_amount: int}>, net_total: int, issued: ?array{count: int, total_gross: int}, credited: ?array{count: int, amount_gross: int}, outstanding: ?array{invoices_count: int, amount_due: int, refundable_credit: int}}  $report
     * @return array<string, mixed>
     */
    public static function day(string $date, array $report, CarbonImmutable $generatedAt): array
    {
        return [
            'date' => $date,
            'scope' => $report['scope'],
            'collections' => $report['collections'],
            'net_total' => $report['net_total'],
            'sessions' => array_map(self::entry(...), $report['sessions']),
            'issued' => $report['issued'],
            'credited' => $report['credited'],
            'outstanding' => $report['outstanding'],
            'generated_at' => $generatedAt->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

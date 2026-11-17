<?php

namespace App\Domain\Cash;

use App\Domain\Billing\Reports\FinancialReports;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Domain\Cash\Rules\PaymentReconciliationRules;
use App\Domain\Shared\ValueObjects\Instant;
use App\Models\Clinic;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures des rapprochements par canal de paiement (L1D06) et calcul des attendus / mouvements éligibles.
 *
 * L'attendu serveur reprend exactement la vue `vw_collection_events` (encaissements confirmés − contre-écritures −
 * remboursements sur la fenêtre UTC du canal) pour ne jamais diverger du tableau financier ni de la caisse du jour.
 * Les mouvements déjà rattachés à un autre rapprochement du cabinet sont exclus des candidats pour empêcher toute
 * duplication entre relevés.
 */
final class PaymentReconciliations
{
    public static function expectedAmount(string $clinicId, string $method, string $startDb, string $endDb): int
    {
        return (int) DB::table('vw_collection_events')
            ->where('clinic_id', $clinicId)
            ->where('method', $method)
            ->where('occurred_at', '>=', $startDb)
            ->where('occurred_at', '<', $endDb)
            ->sum('signed_amount');
    }

    /**
     * @return array{
     *     method: string,
     *     period_starts_at: string,
     *     period_ends_at: string,
     *     expected_amount: int,
     *     candidates: list<array{
     *         kind: string,
     *         payment_id: ?string,
     *         refund_id: ?string,
     *         method: string,
     *         amount: int,
     *         gross_amount: int,
     *         reversed_amount: int,
     *         effective_at: string,
     *         reference: ?string,
     *         invoice_id: string,
     *         invoice_number: ?string,
     *         piece_number: ?string,
     *         patient_name: ?string
     *     }>,
     *     freshness: array<string, mixed>
     * }
     */
    public static function candidates(
        string $clinicId,
        string $method,
        Instant $start,
        Instant $end,
        ?string $forReconciliationId,
        CarbonImmutable $now,
    ): array {
        $startDb = PaymentReconciliationRules::toDatabase($start);
        $endDb = PaymentReconciliationRules::toDatabase($end);

        $usedPayments = DB::table('payment_reconciliation_lines as l')
            ->where('l.clinic_id', $clinicId)
            ->whereNotNull('l.payment_id')
            ->when($forReconciliationId !== null, fn ($q) => $q->where('l.reconciliation_id', '!=', $forReconciliationId))
            ->pluck('l.payment_id')
            ->all();

        $usedRefunds = DB::table('payment_reconciliation_lines as l')
            ->where('l.clinic_id', $clinicId)
            ->whereNotNull('l.refund_id')
            ->when($forReconciliationId !== null, fn ($q) => $q->where('l.reconciliation_id', '!=', $forReconciliationId))
            ->pluck('l.refund_id')
            ->all();

        $paymentRows = DB::table('payments as p')
            ->leftJoin('receipts as r', static function (JoinClause $join): void {
                $join->on('r.clinic_id', '=', 'p.clinic_id')->on('r.payment_id', '=', 'p.id');
            })
            ->join('invoices as i', static function (JoinClause $join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.invoice_id');
            })
            ->join('patient_records as pat', static function (JoinClause $join): void {
                $join->on('pat.clinic_id', '=', 'i.clinic_id')->on('pat.id', '=', 'i.patient_id');
            })
            ->where('p.clinic_id', $clinicId)
            ->where('p.method', $method)
            ->where('p.status', 'CONFIRMED')
            ->where('p.effective_at', '>=', $startDb)
            ->where('p.effective_at', '<', $endDb)
            ->when($usedPayments !== [], fn ($q) => $q->whereNotIn('p.id', $usedPayments))
            ->orderBy('p.effective_at')
            ->orderBy('p.id')
            ->get([
                'p.id as payment_id',
                'p.amount',
                'p.effective_at',
                'p.reference',
                'p.invoice_id',
                'i.number as invoice_number',
                'r.number as receipt_number',
                'pat.last_name',
                'pat.first_names',
            ])
            ->all();

        $paymentIds = array_map(static fn (stdClass $row): string => (string) $row->payment_id, $paymentRows);
        $reversals = $paymentIds === [] ? [] : DB::table('payment_reversals')
            ->where('clinic_id', $clinicId)
            ->whereIn('payment_id', $paymentIds)
            ->selectRaw('payment_id, SUM(amount) AS total_reversed')
            ->groupBy('payment_id')
            ->pluck('total_reversed', 'payment_id')
            ->all();

        $candidates = [];
        foreach ($paymentRows as $row) {
            $gross = (int) $row->amount;
            $rev = (int) ($reversals[(string) $row->payment_id] ?? 0);
            $candidates[] = [
                'kind' => 'PAYMENT',
                'payment_id' => (string) $row->payment_id,
                'refund_id' => null,
                'method' => $method,
                'amount' => $gross - $rev,
                'gross_amount' => $gross,
                'reversed_amount' => $rev,
                'effective_at' => self::iso((string) $row->effective_at),
                'reference' => $row->reference === null ? null : (string) $row->reference,
                'invoice_id' => (string) $row->invoice_id,
                'invoice_number' => $row->invoice_number === null ? null : (string) $row->invoice_number,
                'piece_number' => $row->receipt_number === null ? null : (string) $row->receipt_number,
                'patient_name' => self::fullName($row->last_name, $row->first_names),
            ];
        }

        $refundRows = DB::table('refunds as f')
            ->join('invoices as i', static function (JoinClause $join): void {
                $join->on('i.clinic_id', '=', 'f.clinic_id')->on('i.id', '=', 'f.invoice_id');
            })
            ->join('patient_records as pat', static function (JoinClause $join): void {
                $join->on('pat.clinic_id', '=', 'i.clinic_id')->on('pat.id', '=', 'i.patient_id');
            })
            ->where('f.clinic_id', $clinicId)
            ->where('f.method', $method)
            ->where('f.effective_at', '>=', $startDb)
            ->where('f.effective_at', '<', $endDb)
            ->when($usedRefunds !== [], fn ($q) => $q->whereNotIn('f.id', $usedRefunds))
            ->orderBy('f.effective_at')
            ->orderBy('f.id')
            ->get([
                'f.id as refund_id',
                'f.amount',
                'f.effective_at',
                'f.reference',
                'f.number as refund_number',
                'f.invoice_id',
                'i.number as invoice_number',
                'pat.last_name',
                'pat.first_names',
            ])
            ->all();

        foreach ($refundRows as $row) {
            $gross = (int) $row->amount;
            $candidates[] = [
                'kind' => 'REFUND',
                'payment_id' => null,
                'refund_id' => (string) $row->refund_id,
                'method' => $method,
                'amount' => -$gross,
                'gross_amount' => $gross,
                'reversed_amount' => 0,
                'effective_at' => self::iso((string) $row->effective_at),
                'reference' => $row->reference === null ? null : (string) $row->reference,
                'invoice_id' => (string) $row->invoice_id,
                'invoice_number' => $row->invoice_number === null ? null : (string) $row->invoice_number,
                'piece_number' => (string) $row->refund_number,
                'patient_name' => self::fullName($row->last_name, $row->first_names),
            ];
        }

        usort($candidates, static fn (array $a, array $b): int => [$a['effective_at'], $a['piece_number'] ?? ''] <=> [$b['effective_at'], $b['piece_number'] ?? '']);

        $rawTimezone = Clinic::query()->whereKey($clinicId)->value('timezone');
        $timezone = is_string($rawTimezone) && $rawTimezone !== '' ? $rawTimezone : 'Africa/Douala';
        $period = ReportPeriod::resolve(
            $timezone,
            $now,
            $start->civilDate($timezone)->toString(),
            $end->civilDate($timezone)->toString(),
        );

        return [
            'method' => $method,
            'period_starts_at' => $start->toString(),
            'period_ends_at' => $end->toString(),
            'expected_amount' => self::expectedAmount($clinicId, $method, $startDb, $endDb),
            'candidates' => $candidates,
            'freshness' => FinancialReports::freshness($clinicId, $period, $now),
        ];
    }

    /**
     * @return array{data: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    public static function list(string $clinicId, ?string $method, ?string $status, int $page, int $perPage = 25): array
    {
        $query = DB::table('payment_reconciliations as r')
            ->leftJoin('users as v', static function (JoinClause $join): void {
                $join->on('v.clinic_id', '=', 'r.clinic_id')->on('v.id', '=', 'r.validated_by');
            })
            ->leftJoin('stored_files as sf', static function (JoinClause $join): void {
                $join->on('sf.clinic_id', '=', 'r.clinic_id')->on('sf.id', '=', 'r.statement_file_id');
            })
            ->where('r.clinic_id', $clinicId)
            ->when($method !== null, fn ($q) => $q->where('r.method', $method))
            ->when($status !== null, fn ($q) => $q->where('r.status', $status));

        $total = (int) (clone $query)->count();
        $rows = $query
            ->orderByDesc('r.period_starts_at')
            ->orderByDesc('r.created_at')
            ->orderByDesc('r.id')
            ->forPage($page, $perPage)
            ->get([
                'r.*',
                'v.display_name as validated_by_name',
                'sf.sha256 as file_sha256',
                'sf.mime_type as file_mime_type',
                'sf.size_bytes as file_size_bytes',
            ])
            ->all();

        $ids = array_map(static fn (stdClass $row): string => (string) $row->id, $rows);
        $counts = [];
        if ($ids !== []) {
            foreach (
                DB::table('payment_reconciliation_lines')
                    ->where('clinic_id', $clinicId)
                    ->whereIn('reconciliation_id', $ids)
                    ->selectRaw("reconciliation_id, COUNT(*) AS total, SUM(CASE WHEN status = 'DISPUTED' THEN 1 ELSE 0 END) AS disputed, SUM(CASE WHEN status = 'UNMATCHED' THEN 1 ELSE 0 END) AS unmatched")
                    ->groupBy('reconciliation_id')
                    ->get() as $agg
            ) {
                $counts[(string) $agg->reconciliation_id] = [
                    'lines' => (int) $agg->total,
                    'disputed' => (int) $agg->disputed,
                    'unmatched' => (int) $agg->unmatched,
                ];
            }
        }

        $items = [];
        foreach ($rows as $row) {
            $id = (string) $row->id;
            $expected = (int) $row->expected_amount;
            $statement = $row->statement_amount === null ? null : (int) $row->statement_amount;
            $stat = $counts[$id] ?? ['lines' => 0, 'disputed' => 0, 'unmatched' => 0];
            $items[] = [
                'id' => $id,
                'method' => (string) $row->method,
                'period_starts_at' => self::iso((string) $row->period_starts_at),
                'period_ends_at' => self::iso((string) $row->period_ends_at),
                'status' => (string) $row->status,
                'expected_amount' => $expected,
                'statement_amount' => $statement,
                'variance_amount' => $statement === null ? null : ($statement - $expected),
                'statement_file' => self::fileResource($row),
                'variance_reason' => $row->variance_reason === null ? null : (string) $row->variance_reason,
                'validated_by' => $row->validated_by === null ? null : (string) $row->validated_by,
                'validated_by_name' => $row->validated_by_name === null ? null : (string) $row->validated_by_name,
                'validated_at' => $row->validated_at === null ? null : self::iso((string) $row->validated_at),
                'lines_count' => $stat['lines'],
                'disputed_lines_count' => $stat['disputed'],
                'unmatched_lines_count' => $stat['unmatched'],
                'created_at' => self::iso((string) $row->created_at),
                'updated_at' => self::iso((string) $row->updated_at),
            ];
        }

        return [
            'data' => $items,
            'meta' => [
                'current_page' => $page,
                'last_page' => max(1, (int) ceil($total / $perPage)),
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function find(string $clinicId, string $reconciliationId): ?array
    {
        $row = DB::table('payment_reconciliations as r')
            ->leftJoin('users as v', static function (JoinClause $join): void {
                $join->on('v.clinic_id', '=', 'r.clinic_id')->on('v.id', '=', 'r.validated_by');
            })
            ->leftJoin('stored_files as sf', static function (JoinClause $join): void {
                $join->on('sf.clinic_id', '=', 'r.clinic_id')->on('sf.id', '=', 'r.statement_file_id');
            })
            ->where('r.clinic_id', $clinicId)
            ->where('r.id', $reconciliationId)
            ->first([
                'r.*',
                'v.display_name as validated_by_name',
                'sf.sha256 as file_sha256',
                'sf.mime_type as file_mime_type',
                'sf.size_bytes as file_size_bytes',
            ]);

        if ($row === null) {
            return null;
        }

        $lineRows = DB::table('payment_reconciliation_lines as l')
            ->leftJoin('payments as p', static function (JoinClause $join): void {
                $join->on('p.clinic_id', '=', 'l.clinic_id')->on('p.id', '=', 'l.payment_id');
            })
            ->leftJoin('receipts as rec', static function (JoinClause $join): void {
                $join->on('rec.clinic_id', '=', 'p.clinic_id')->on('rec.payment_id', '=', 'p.id');
            })
            ->leftJoin('refunds as rf', static function (JoinClause $join): void {
                $join->on('rf.clinic_id', '=', 'l.clinic_id')->on('rf.id', '=', 'l.refund_id');
            })
            ->where('l.clinic_id', $clinicId)
            ->where('l.reconciliation_id', $reconciliationId)
            ->orderBy('l.created_at')
            ->orderBy('l.id')
            ->get([
                'l.*',
                'p.amount as payment_amount',
                'p.effective_at as payment_effective_at',
                'p.reference as payment_ref',
                'rec.number as receipt_number',
                'rf.amount as refund_amount',
                'rf.effective_at as refund_effective_at',
                'rf.reference as refund_ref',
                'rf.number as refund_number',
            ])
            ->all();

        $paymentIds = array_values(array_filter(array_map(static fn (stdClass $l): ?string => $l->payment_id === null ? null : (string) $l->payment_id, $lineRows)));
        $reversals = $paymentIds === [] ? [] : DB::table('payment_reversals')
            ->where('clinic_id', $clinicId)
            ->whereIn('payment_id', $paymentIds)
            ->selectRaw('payment_id, SUM(amount) AS total_reversed')
            ->groupBy('payment_id')
            ->pluck('total_reversed', 'payment_id')
            ->all();

        $matchedAmount = 0;
        $disputedCount = 0;
        $unmatchedCount = 0;
        $lines = [];
        foreach ($lineRows as $line) {
            $paymentId = $line->payment_id === null ? null : (string) $line->payment_id;
            $refundId = $line->refund_id === null ? null : (string) $line->refund_id;
            $kind = $paymentId !== null ? 'PAYMENT' : ($refundId !== null ? 'REFUND' : null);

            $expectedItem = null;
            $pieceNumber = null;
            $effectiveAt = null;
            $paymentRef = null;
            if ($paymentId !== null && $line->payment_amount !== null) {
                $expectedItem = (int) $line->payment_amount - (int) ($reversals[$paymentId] ?? 0);
                $pieceNumber = $line->receipt_number === null ? null : (string) $line->receipt_number;
                $effectiveAt = $line->payment_effective_at === null ? null : self::iso((string) $line->payment_effective_at);
                $paymentRef = $line->payment_ref === null ? null : (string) $line->payment_ref;
            } elseif ($refundId !== null && $line->refund_amount !== null) {
                $expectedItem = -((int) $line->refund_amount);
                $pieceNumber = $line->refund_number === null ? null : (string) $line->refund_number;
                $effectiveAt = $line->refund_effective_at === null ? null : self::iso((string) $line->refund_effective_at);
                $paymentRef = $line->refund_ref === null ? null : (string) $line->refund_ref;
            }

            $stmt = (int) $line->statement_amount;
            $status = (string) $line->status;
            if ($status === 'MATCHED') {
                $matchedAmount += $stmt;
            } elseif ($status === 'DISPUTED') {
                $disputedCount++;
            } elseif ($status === 'UNMATCHED') {
                $unmatchedCount++;
            }

            $lines[] = [
                'id' => (string) $line->id,
                'payment_id' => $paymentId,
                'refund_id' => $refundId,
                'external_reference' => $line->external_reference === null ? null : (string) $line->external_reference,
                'statement_amount' => $stmt,
                'expected_item_amount' => $expectedItem,
                'status' => $status,
                'note' => $line->note === null ? null : (string) $line->note,
                'kind' => $kind,
                'piece_number' => $pieceNumber,
                'effective_at' => $effectiveAt,
                'payment_reference' => $paymentRef,
            ];
        }

        $storedExpected = (int) $row->expected_amount;
        $currentExpected = (string) $row->status === 'VALIDATED'
            ? $storedExpected
            : self::expectedAmount($clinicId, (string) $row->method, (string) $row->period_starts_at, (string) $row->period_ends_at);
        $statement = $row->statement_amount === null ? null : (int) $row->statement_amount;

        return [
            'id' => (string) $row->id,
            'method' => (string) $row->method,
            'period_starts_at' => self::iso((string) $row->period_starts_at),
            'period_ends_at' => self::iso((string) $row->period_ends_at),
            'status' => (string) $row->status,
            'expected_amount' => $storedExpected,
            'current_expected_amount' => $currentExpected,
            'statement_amount' => $statement,
            'variance_amount' => $statement === null ? null : ($statement - $storedExpected),
            'matched_lines_amount' => $matchedAmount,
            'disputed_lines_count' => $disputedCount,
            'unmatched_lines_count' => $unmatchedCount,
            'statement_file' => self::fileResource($row),
            'variance_reason' => $row->variance_reason === null ? null : (string) $row->variance_reason,
            'validated_by' => $row->validated_by === null ? null : (string) $row->validated_by,
            'validated_by_name' => $row->validated_by_name === null ? null : (string) $row->validated_by_name,
            'validated_at' => $row->validated_at === null ? null : self::iso((string) $row->validated_at),
            'lines' => $lines,
            'created_at' => self::iso((string) $row->created_at),
            'updated_at' => self::iso((string) $row->updated_at),
        ];
    }

    /**
     * @return array{file_id: string, sha256: string, mime_type: string, size_bytes: int}|null
     */
    private static function fileResource(stdClass $row): ?array
    {
        if ($row->statement_file_id === null || $row->file_sha256 === null) {
            return null;
        }

        return [
            'file_id' => (string) $row->statement_file_id,
            'sha256' => (string) $row->file_sha256,
            'mime_type' => (string) $row->file_mime_type,
            'size_bytes' => (int) $row->file_size_bytes,
        ];
    }

    private static function iso(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }

    private static function fullName(mixed $last, mixed $first): ?string
    {
        $parts = array_filter([
            is_string($first) ? trim($first) : '',
            is_string($last) ? trim($last) : '',
        ], static fn (string $v): bool => $v !== '');

        return $parts === [] ? null : implode(' ', $parts);
    }
}

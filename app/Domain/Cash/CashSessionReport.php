<?php

namespace App\Domain\Cash;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Relevé d'une session de caisse (B05, fichier 03 « Caisse et indicateurs », fichier 11 « relevé de caisse ») : les
 * faits qui composent le tiroir espèces, la liste des encaissements et le journal chronologique unifié (factures
 * encaissées à leur heure exacte + dépenses/entrées/sorties/contre-écritures/remboursements), pour l'écran et le PDF.
 *
 * Aucun montant n'est inventé : tout vient des faits enregistrés, en entiers FCFA.
 */
final class CashSessionReport
{
    /**
     * @return array{
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
     * }
     */
    public static function build(stdClass $session, CarbonImmutable $now): array
    {
        $clinicId = (string) $session->clinic_id;
        $sessionId = (string) $session->id;
        $totals = CashSessions::totals($clinicId, $sessionId);

        $movements = array_values(DB::table('cash_movements as cm')
            ->leftJoin('expense_categories as ec', static function ($join): void {
                $join->on('ec.clinic_id', '=', 'cm.clinic_id')->on('ec.id', '=', 'cm.expense_category_id');
            })
            ->where('cm.clinic_id', $clinicId)
            ->where('cm.cash_session_id', $sessionId)
            ->orderBy('cm.occurred_at')
            ->orderBy('cm.id')
            ->get([
                'cm.id',
                'cm.kind',
                'cm.method',
                'cm.signed_amount',
                'cm.reason',
                'cm.reference',
                'cm.occurred_at',
                'ec.name as category_name',
            ])
            ->all());
        $in = 0;
        $out = 0;
        foreach ($movements as $movement) {
            $amount = (int) $movement->signed_amount;
            if ($amount > 0) {
                $in += $amount;
            } else {
                $out -= $amount;
            }
        }

        // Fenêtre de la session : de l'ouverture à la clôture (ou à l'instant de la lecture si elle est ouverte).
        $until = $session->closed_at === null ? $now->format('Y-m-d H:i:s.u') : (string) $session->closed_at;

        $payments = array_values(DB::table('payments')
            ->leftJoin('receipts', static function ($join): void {
                $join->on('receipts.clinic_id', '=', 'payments.clinic_id')->on('receipts.payment_id', '=', 'payments.id');
            })
            ->leftJoin('invoices', static function ($join): void {
                $join->on('invoices.clinic_id', '=', 'payments.clinic_id')->on('invoices.id', '=', 'payments.invoice_id');
            })
            ->where('payments.clinic_id', $clinicId)
            ->where('payments.status', 'CONFIRMED')
            ->where(static function ($inner) use ($sessionId, $session, $until): void {
                // Espèces : celles de la session. Autres modes : celles de la caissière pendant la session.
                $inner->where('payments.cash_session_id', $sessionId)
                    ->orWhere(static function ($other) use ($session, $until): void {
                        $other->where('payments.method', '<>', 'CASH')
                            ->where('payments.received_by', (string) $session->cashier_id)
                            ->where('payments.effective_at', '>=', (string) $session->opened_at)
                            ->where('payments.effective_at', '<=', $until);
                    });
            })
            ->orderBy('payments.effective_at')
            ->orderBy('payments.id')
            ->get([
                'payments.id as payment_id',
                'payments.invoice_id',
                'payments.method',
                'payments.amount',
                'payments.reference as payment_reference',
                'payments.effective_at',
                'receipts.id as receipt_id',
                'receipts.number as receipt_number',
                'invoices.number as invoice_number',
                'invoices.patient_snapshot as patient_snapshot',
            ])
            ->all());

        $reversed = [];
        $reversalRows = [];
        if ($payments !== []) {
            $paymentIds = array_map(static fn (stdClass $payment): string => (string) $payment->payment_id, $payments);
            foreach (DB::table('payment_reversals')
                ->where('clinic_id', $clinicId)
                ->whereIn('payment_id', $paymentIds)
                ->selectRaw('payment_id, SUM(amount) AS reversed')
                ->groupBy('payment_id')
                ->get() as $row) {
                $reversed[(string) $row->payment_id] = (int) $row->reversed;
            }
            $reversalRows = DB::table('payment_reversals as pr')
                ->join('payments as p', static function ($join): void {
                    $join->on('p.clinic_id', '=', 'pr.clinic_id')->on('p.id', '=', 'pr.payment_id');
                })
                ->leftJoin('invoices as i', static function ($join): void {
                    $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.invoice_id');
                })
                ->where('pr.clinic_id', $clinicId)
                ->where('p.cash_session_id', $sessionId)
                ->where('p.method', 'CASH')
                ->get(['pr.id', 'pr.amount', 'pr.reason', 'pr.recorded_at', 'p.invoice_id', 'i.number as invoice_number', 'i.patient_snapshot'])
                ->all();
        }

        $refundRows = DB::table('refunds as rf')
            ->leftJoin('invoices as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'rf.clinic_id')->on('i.id', '=', 'rf.invoice_id');
            })
            ->where('rf.clinic_id', $clinicId)
            ->where('rf.cash_session_id', $sessionId)
            ->where('rf.method', 'CASH')
            ->get(['rf.id', 'rf.amount', 'rf.number', 'rf.effective_at', 'rf.invoice_id', 'i.number as invoice_number', 'i.patient_snapshot'])
            ->all();

        /** @var array<string, array{method: string, count: int, amount: int}> $others */
        $others = [];
        foreach ($payments as $payment) {
            $payment->reversed_amount = $reversed[(string) $payment->payment_id] ?? 0;
            $method = (string) $payment->method;
            if ($method === 'CASH') {
                continue;
            }
            $others[$method] ??= ['method' => $method, 'count' => 0, 'amount' => 0];
            $others[$method]['count']++;
            $others[$method]['amount'] += (int) $payment->amount - (int) $payment->reversed_amount;
        }
        ksort($others);

        $journal = self::buildJournal($payments, $movements, $reversalRows, $refundRows);

        return [
            'session' => $session,
            'cash_received' => $totals['received'],
            'cash_reversed' => $totals['reversed'],
            'cash_refunded' => $totals['refunded'],
            'movements_in' => $in,
            'movements_out' => $out,
            'movements' => $movements,
            'payments' => $payments,
            'other_methods' => array_values($others),
            'journal' => $journal,
        ];
    }

    /**
     * @param  list<stdClass>  $payments
     * @param  list<stdClass>  $movements
     * @param  array<int, stdClass>  $reversals
     * @param  array<int, stdClass>  $refunds
     * @return list<array{id: string, entry_type: string, occurred_at: string, signed_amount: int, method: string, label: string, detail: ?string, invoice_id: ?string, invoice_number: ?string, receipt_number: ?string, patient_name: ?string, movement_kind: ?string, reference: ?string}>
     */
    private static function buildJournal(array $payments, array $movements, array $reversals, array $refunds): array
    {
        $entries = [];

        foreach ($payments as $payment) {
            $invoiceNumber = is_string($payment->invoice_number) ? $payment->invoice_number : null;
            $receiptNumber = is_string($payment->receipt_number) ? $payment->receipt_number : null;
            $entries[] = [
                'id' => (string) $payment->payment_id,
                'entry_type' => 'PAYMENT',
                'occurred_at' => (string) $payment->effective_at,
                'signed_amount' => (int) $payment->amount,
                'method' => (string) $payment->method,
                'label' => $invoiceNumber !== null ? 'Facture '.$invoiceNumber : 'Encaissement',
                'detail' => $receiptNumber !== null ? 'Reçu '.$receiptNumber : null,
                'invoice_id' => (string) $payment->invoice_id,
                'invoice_number' => $invoiceNumber,
                'receipt_number' => $receiptNumber,
                'patient_name' => self::patientName($payment->patient_snapshot ?? null),
                'movement_kind' => null,
                'reference' => is_string($payment->payment_reference ?? null) ? $payment->payment_reference : null,
            ];
        }

        foreach ($movements as $movement) {
            $kind = (string) $movement->kind;
            $category = is_string($movement->category_name ?? null) ? $movement->category_name : null;
            $reason = is_string($movement->reason ?? null) && trim($movement->reason) !== '' ? trim($movement->reason) : null;
            $detailParts = array_values(array_filter([$category, $reason], static fn (?string $part): bool => $part !== null));
            $entries[] = [
                'id' => (string) $movement->id,
                'entry_type' => 'CASH_MOVEMENT',
                'occurred_at' => (string) $movement->occurred_at,
                'signed_amount' => (int) $movement->signed_amount,
                'method' => (string) ($movement->method ?? 'CASH'),
                'label' => self::movementLabel($kind),
                'detail' => $detailParts === [] ? null : implode(' — ', $detailParts),
                'invoice_id' => null,
                'invoice_number' => null,
                'receipt_number' => null,
                'patient_name' => null,
                'movement_kind' => $kind,
                'reference' => is_string($movement->reference ?? null) ? $movement->reference : null,
            ];
        }

        foreach ($reversals as $reversal) {
            $invoiceNumber = is_string($reversal->invoice_number ?? null) ? $reversal->invoice_number : null;
            $entries[] = [
                'id' => (string) $reversal->id,
                'entry_type' => 'PAYMENT_REVERSAL',
                'occurred_at' => (string) $reversal->recorded_at,
                'signed_amount' => -((int) $reversal->amount),
                'method' => 'CASH',
                'label' => $invoiceNumber !== null ? 'Contre-écriture '.$invoiceNumber : 'Contre-écriture',
                'detail' => is_string($reversal->reason ?? null) ? $reversal->reason : null,
                'invoice_id' => is_string($reversal->invoice_id ?? null) ? $reversal->invoice_id : null,
                'invoice_number' => $invoiceNumber,
                'receipt_number' => null,
                'patient_name' => self::patientName($reversal->patient_snapshot ?? null),
                'movement_kind' => null,
                'reference' => null,
            ];
        }

        foreach ($refunds as $refund) {
            $invoiceNumber = is_string($refund->invoice_number ?? null) ? $refund->invoice_number : null;
            $refundNumber = is_string($refund->number ?? null) ? $refund->number : null;
            $entries[] = [
                'id' => (string) $refund->id,
                'entry_type' => 'REFUND',
                'occurred_at' => (string) $refund->effective_at,
                'signed_amount' => -((int) $refund->amount),
                'method' => 'CASH',
                'label' => $invoiceNumber !== null ? 'Remboursement '.$invoiceNumber : 'Remboursement',
                'detail' => $refundNumber !== null ? 'Pièce '.$refundNumber : null,
                'invoice_id' => is_string($refund->invoice_id ?? null) ? $refund->invoice_id : null,
                'invoice_number' => $invoiceNumber,
                'receipt_number' => $refundNumber,
                'patient_name' => self::patientName($refund->patient_snapshot ?? null),
                'movement_kind' => null,
                'reference' => null,
            ];
        }

        usort($entries, static function (array $left, array $right): int {
            $byTime = strcmp($left['occurred_at'], $right['occurred_at']);
            if ($byTime !== 0) {
                return $byTime;
            }

            return strcmp($left['id'], $right['id']);
        });

        return $entries;
    }

    private static function movementLabel(string $kind): string
    {
        return match ($kind) {
            'EXPENSE' => 'Dépense',
            'DEPOSIT' => 'Entrée motivée',
            'WITHDRAWAL' => 'Sortie motivée',
            'OPENING_CORRECTION' => 'Correction d’ouverture',
            default => $kind,
        };
    }

    private static function patientName(mixed $snapshotJson): ?string
    {
        if (! is_string($snapshotJson) || $snapshotJson === '') {
            return null;
        }
        $decoded = json_decode($snapshotJson, true);
        if (! is_array($decoded)) {
            return null;
        }
        $last = is_string($decoded['last_name'] ?? null) ? trim($decoded['last_name']) : '';
        $first = is_string($decoded['first_names'] ?? null) ? trim($decoded['first_names']) : '';
        $name = trim($last.' '.$first);

        return $name === '' ? null : mb_substr($name, 0, 180);
    }
}

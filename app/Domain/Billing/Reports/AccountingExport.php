<?php

namespace App\Domain\Billing\Reports;

use App\Domain\Inventory\Rules\StockValue;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Support\Modules;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Restitution comptable Q13 (L1D06) : sépare strictement le chiffre d'affaires (factures émises − avoirs émis, hors
 * reprises papier et devis), les encaissements nets par mode (paiements − contre-écritures − remboursements), les
 * dépenses de caisse par catégorie, les rapprochements par canal, les impayés lus à l'instant et la valorisation du
 * stock au coût connu.
 */
final class AccountingExport
{
    private const LEGACY_NOTE = 'Les reprises de créances papier (LEGACY_BALANCE) sont exclues du chiffre d\'affaires et ne font jamais double compte avec les factures émises.';

    /**
     * @return array<string, mixed>
     */
    public static function build(string $clinicId, ReportPeriod $period, CarbonImmutable $now): array
    {
        $financial = FinancialReports::build($clinicId, $period, $now);

        return [
            'period' => $financial['period'],
            'currency' => 'XAF',
            'freshness' => $financial['freshness'],
            'revenue' => [
                'invoices_count' => $financial['revenue']['issued']['count'],
                'invoiced_gross' => $financial['revenue']['issued']['total_gross'],
                'credit_notes_count' => $financial['revenue']['credited']['count'],
                'credited_gross' => $financial['revenue']['credited']['amount_gross'],
                'net_revenue' => $financial['revenue']['net'],
                'legacy_excluded_note' => self::LEGACY_NOTE,
            ],
            'collections' => [
                'by_method' => $financial['collections']['by_method'],
                'net_total' => $financial['collections']['net_total'],
                'on_legacy' => $financial['collections']['on_legacy'],
            ],
            'expenses' => self::expenses($clinicId, $period),
            'reconciliations' => self::reconciliations($clinicId, $period),
            'receivables_at_read' => $financial['receivables'],
            'stock_valuation_at_read' => Modules::isEnabled('stock') ? self::stockValuation($clinicId) : null,
            'lines' => self::journalLines($clinicId, $period),
            'generated_at' => $now->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * Génère le fichier CSV comptable Q13 (UTF-8 BOM, séparateur « ; », résumé par nature + journal typé).
     *
     * @param  array<string, mixed>  $report
     */
    public static function toCsv(array $report): string
    {
        $csvLines = [];

        $encodeCell = static function (mixed $v): string {
            if ($v === null) {
                return '';
            }
            if (is_int($v)) {
                return (string) $v;
            }
            if (is_bool($v)) {
                return $v ? 'OUI' : 'NON';
            }
            $text = (string) $v;
            if ($text !== '' && in_array($text[0], ['=', '+', '@', "\t", "\r"], true)) {
                $text = "'".$text;
            } elseif (str_starts_with($text, '-') && ! preg_match('/^-[0-9]+$/', $text)) {
                $text = "'".$text;
            }
            if (str_contains($text, ';') || str_contains($text, '"') || str_contains($text, "\n") || str_contains($text, "\r")) {
                return '"'.str_replace('"', '""', $text).'"';
            }

            return $text;
        };

        $row = static function (array $fields) use (&$csvLines, $encodeCell): void {
            $csvLines[] = implode(';', array_map($encodeCell, $fields));
        };

        $row(['EAGLES_EYE_OPTICS_EXPORT_COMPTABLE_Q13', $report['period']['from'], $report['period']['to'], $report['currency'], 'fraicheur_complete='.($report['freshness']['complete'] ? 'OUI' : 'NON')]);
        $row(['SYNTHESE', 'RUBRIQUE', 'DETAIL', 'MONTANT_XAF', 'OBSERVATION']);
        $row(['CHIFFRE_AFFAIRES', 'Factures émises (hors reprises papier)', $report['revenue']['invoices_count'].' pièce(s)', $report['revenue']['invoiced_gross'], 'Ventes constatées']);
        $row(['CHIFFRE_AFFAIRES', 'Avoirs émis (hors reprises papier)', $report['revenue']['credit_notes_count'].' pièce(s)', -$report['revenue']['credited_gross'], 'Déduits du CA']);
        $row(['CHIFFRE_AFFAIRES', 'Chiffre d\'affaires net', 'Factures - Avoirs', $report['revenue']['net_revenue'], $report['revenue']['legacy_excluded_note']]);
        $row(['ENCAISSEMENTS', 'Encaissements nets toutes voies', 'Inclut règlements sur reprises papier ('.$report['collections']['on_legacy']['net_amount'].' XAF)', $report['collections']['net_total'], 'Trésorerie distincte du CA']);
        foreach ($report['collections']['by_method'] as $methodRow) {
            $row(['ENCAISSEMENT_CANAL', $methodRow['method'], $methodRow['payments_count'].' encaissement(s)', $methodRow['net_amount'], 'Brut '.$methodRow['payments_amount'].' / Annulations '.$methodRow['reversals_amount'].' / Remboursements '.$methodRow['refunds_amount']]);
        }
        $row(['DEPENSES', 'Dépenses de caisse', $report['expenses']['movements_count'].' mouvement(s)', -$report['expenses']['total_amount'], 'Sorties hors ventes']);
        foreach ($report['expenses']['by_category'] as $catRow) {
            $row(['DEPENSE_CATEGORIE', $catRow['code'] ?? '-', $catRow['name'], -$catRow['amount'], $catRow['movements_count'].' mouvement(s)']);
        }
        $row(['RAPPROCHEMENTS', 'Rapprochements validés', $report['reconciliations']['validated_count'].' validé(s) / '.$report['reconciliations']['draft_count'].' brouillon(s)', 0, 'Voir section par canal et journal']);
        foreach ($report['reconciliations']['by_method'] as $recRow) {
            $row(['RAPPROCHEMENT_CANAL', $recRow['method'], $recRow['validated_count'].' validé(s)', $recRow['variance_total'], 'Attendu '.$recRow['expected_total'].' / Relevé '.$recRow['statement_total'].' / Litiges '.$recRow['disputed_lines']]);
        }
        $row(['IMPAYES_A_L_INSTANT', 'Créances clients (toutes périodes)', $report['receivables_at_read']['invoices_count'].' facture(s)', $report['receivables_at_read']['amount_due'], 'Dont reprises papier : '.$report['receivables_at_read']['of_which_legacy']['amount_due'].' XAF ('.$report['receivables_at_read']['of_which_legacy']['invoices_count'].')']);
        $row(['IMPAYES_A_L_INSTANT', 'Crédits clients à rembourser', $report['receivables_at_read']['refundable_credit']['invoices_count'].' facture(s)', -$report['receivables_at_read']['refundable_credit']['amount'], 'Avoirs non remboursés']);
        if ($report['stock_valuation_at_read'] !== null) {
            $row(['STOCK_VALO_INSTANT', 'Valorisation au coût connu', $report['stock_valuation_at_read']['total_positions'].' positions', $report['stock_valuation_at_read']['known_cost_value'], $report['stock_valuation_at_read']['unknown_cost_positions'].' position(s) sans coût']);
        }

        $row([]);
        $row(['SECTION', 'DATE_UTC', 'REFERENCE', 'CANAL', 'LIBELLE', 'MONTANT_SIGNE_XAF', 'HORS_CA', 'STATUT_RAPPROCHEMENT']);
        foreach ($report['lines'] as $line) {
            $row([
                $line['section'],
                $line['occurred_at'],
                $line['reference'],
                $line['channel'],
                $line['category_or_label'],
                $line['signed_amount'],
                $line['excluded_from_ca'],
                $line['reconciliation_status'],
            ]);
        }

        return "\xEF\xBB\xBF".implode("\r\n", $csvLines)."\r\n";
    }

    /**
     * @return array<string, mixed>
     */
    private static function expenses(string $clinicId, ReportPeriod $period): array
    {
        $rows = DB::table('cash_movements as m')
            ->leftJoin('expense_categories as c', static function (JoinClause $join): void {
                $join->on('c.clinic_id', '=', 'm.clinic_id')->on('c.id', '=', 'm.expense_category_id');
            })
            ->where('m.clinic_id', $clinicId)
            ->where('m.occurred_at', '>=', $period->start)
            ->where('m.occurred_at', '<', $period->end)
            ->get(['m.kind', 'm.expense_category_id', 'm.signed_amount', 'c.code as category_code', 'c.name as category_name'])
            ->all();

        $totalExpenses = 0;
        $expensesCount = 0;
        /** @var array<string, array{category_id: ?string, code: ?string, name: string, movements_count: int, amount: int}> $byCategory */
        $byCategory = [];
        $deposits = 0;
        $withdrawals = 0;
        $openingAdjustments = 0;

        foreach ($rows as $row) {
            $kind = (string) $row->kind;
            $signed = (int) $row->signed_amount;
            if ($kind === 'EXPENSE') {
                $abs = -$signed;
                $totalExpenses += $abs;
                $expensesCount++;
                $catId = $row->expense_category_id === null ? '' : (string) $row->expense_category_id;
                $byCategory[$catId] ??= [
                    'category_id' => $catId === '' ? null : $catId,
                    'code' => $row->category_code === null ? null : (string) $row->category_code,
                    'name' => $row->category_name === null ? 'Sans catégorie' : (string) $row->category_name,
                    'movements_count' => 0,
                    'amount' => 0,
                ];
                $byCategory[$catId]['movements_count']++;
                $byCategory[$catId]['amount'] += $abs;
            } elseif ($kind === 'DEPOSIT') {
                $deposits += $signed;
            } elseif ($kind === 'WITHDRAWAL') {
                $withdrawals += -$signed;
            } elseif ($kind === 'OPENING_CORRECTION') {
                $openingAdjustments += $signed;
            }
        }

        usort($byCategory, static fn (array $a, array $b): int => $a['name'] <=> $b['name']);

        return [
            'total_amount' => $totalExpenses,
            'movements_count' => $expensesCount,
            'by_category' => $byCategory,
            'other_cash_movements' => [
                'deposits' => $deposits,
                'withdrawals' => $withdrawals,
                'opening_adjustments' => $openingAdjustments,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function reconciliations(string $clinicId, ReportPeriod $period): array
    {
        $rows = DB::table('payment_reconciliations as r')
            ->where('r.clinic_id', $clinicId)
            ->where('r.period_starts_at', '<', $period->end)
            ->where('r.period_ends_at', '>', $period->start)
            ->orderBy('r.period_starts_at')
            ->orderBy('r.id')
            ->get()
            ->all();

        $ids = array_map(static fn (stdClass $r): string => (string) $r->id, $rows);
        $disputed = $ids === [] ? [] : DB::table('payment_reconciliation_lines')
            ->where('clinic_id', $clinicId)
            ->whereIn('reconciliation_id', $ids)
            ->where('status', 'DISPUTED')
            ->selectRaw('reconciliation_id, COUNT(*) AS total')
            ->groupBy('reconciliation_id')
            ->pluck('total', 'reconciliation_id')
            ->all();

        $validatedCount = 0;
        $draftCount = 0;
        /** @var array<string, array{method: string, validated_count: int, expected_total: int, statement_total: int, variance_total: int, disputed_lines: int}> $byMethod */
        $byMethod = [];
        $items = [];

        foreach ($rows as $row) {
            $id = (string) $row->id;
            $method = (string) $row->method;
            $status = (string) $row->status;
            $expected = (int) $row->expected_amount;
            $statement = $row->statement_amount === null ? null : (int) $row->statement_amount;
            $variance = $statement === null ? null : ($statement - $expected);

            if ($status === 'VALIDATED' && $statement !== null && $variance !== null) {
                $validatedCount++;
                $byMethod[$method] ??= [
                    'method' => $method,
                    'validated_count' => 0,
                    'expected_total' => 0,
                    'statement_total' => 0,
                    'variance_total' => 0,
                    'disputed_lines' => 0,
                ];
                $byMethod[$method]['validated_count']++;
                $byMethod[$method]['expected_total'] += $expected;
                $byMethod[$method]['statement_total'] += $statement;
                $byMethod[$method]['variance_total'] += $variance;
                $byMethod[$method]['disputed_lines'] += (int) ($disputed[$id] ?? 0);
            } else {
                $draftCount++;
            }

            $items[] = [
                'id' => $id,
                'method' => $method,
                'period_starts_at' => self::iso((string) $row->period_starts_at),
                'period_ends_at' => self::iso((string) $row->period_ends_at),
                'status' => $status,
                'expected_amount' => $expected,
                'statement_amount' => $statement,
                'variance_amount' => $variance,
                'validated_at' => $row->validated_at === null ? null : self::iso((string) $row->validated_at),
            ];
        }

        return [
            'validated_count' => $validatedCount,
            'draft_count' => $draftCount,
            'by_method' => array_values($byMethod),
            'items' => $items,
        ];
    }

    /**
     * @return array{known_cost_value: int, unknown_cost_positions: int, total_positions: int}
     */
    private static function stockValuation(string $clinicId): array
    {
        $positions = DB::table('stock_positions as p')
            ->join('catalog_items as i', static function (JoinClause $join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.item_id');
            })
            ->where('p.clinic_id', $clinicId)
            ->where('p.on_hand', '>', 0)
            ->get(['p.id', 'p.on_hand', 'i.purchase_cost'])
            ->all();

        $positionIds = array_map(static fn (stdClass $p): string => (string) $p->id, $positions);
        /** @var array<string, list<stdClass>> $lotsByPosition */
        $lotsByPosition = [];
        if ($positionIds !== []) {
            foreach (
                DB::table('stock_lots')
                    ->where('clinic_id', $clinicId)
                    ->whereIn('stock_position_id', $positionIds)
                    ->where('on_hand', '>', 0)
                    ->get(['stock_position_id', 'on_hand', 'unit_cost']) as $lot
            ) {
                $lotsByPosition[(string) $lot->stock_position_id][] = $lot;
            }
        }

        $knownValue = 0;
        $unknownPositions = 0;

        foreach ($positions as $position) {
            $posId = (string) $position->id;
            $posOnHand = Quantity::of((string) $position->on_hand);
            $fallbackCost = $position->purchase_cost === null ? null : (int) $position->purchase_cost;
            $lots = $lotsByPosition[$posId] ?? [];
            $lotted = FixedDecimal::fromUnits(0, Quantity::SCALE);
            $hasUnknown = false;

            foreach ($lots as $lot) {
                $qty = Quantity::of((string) $lot->on_hand);
                $lotted = $lotted->plus($qty);
                $cost = $lot->unit_cost === null ? $fallbackCost : (int) $lot->unit_cost;
                if ($cost === null) {
                    $hasUnknown = true;
                } else {
                    $knownValue += StockValue::of($qty, $cost);
                }
            }

            if ($posOnHand->units > $lotted->units) {
                $unlotted = FixedDecimal::fromUnits($posOnHand->units - $lotted->units, Quantity::SCALE);
                if ($fallbackCost === null) {
                    $hasUnknown = true;
                } else {
                    $knownValue += StockValue::of($unlotted, $fallbackCost);
                }
            }

            if ($hasUnknown) {
                $unknownPositions++;
            }
        }

        return [
            'known_cost_value' => $knownValue,
            'unknown_cost_positions' => $unknownPositions,
            'total_positions' => count($positions),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function journalLines(string $clinicId, ReportPeriod $period): array
    {
        $lines = [];

        foreach (
            DB::table('invoices')
                ->where('clinic_id', $clinicId)
                ->where('status', 'ISSUED')
                ->where('origin', 'NATIVE')
                ->where('issued_at', '>=', $period->start)
                ->where('issued_at', '<', $period->end)
                ->orderBy('issued_at')
                ->orderBy('id')
                ->get(['number', 'issued_at', 'total_gross']) as $inv
        ) {
            $lines[] = [
                'section' => 'REVENUE_INVOICE',
                'occurred_at' => self::iso((string) $inv->issued_at),
                'reference' => $inv->number === null ? null : (string) $inv->number,
                'channel' => null,
                'category_or_label' => 'Facture émise',
                'signed_amount' => (int) $inv->total_gross,
                'excluded_from_ca' => false,
                'reconciliation_status' => null,
            ];
        }

        foreach (
            DB::table('credit_notes as c')
                ->join('invoices as i', static function (JoinClause $join): void {
                    $join->on('i.clinic_id', '=', 'c.clinic_id')->on('i.id', '=', 'c.invoice_id');
                })
                ->where('c.clinic_id', $clinicId)
                ->where('c.status', 'ISSUED')
                ->where('i.origin', 'NATIVE')
                ->where('c.issued_at', '>=', $period->start)
                ->where('c.issued_at', '<', $period->end)
                ->orderBy('c.issued_at')
                ->orderBy('c.id')
                ->get(['c.number', 'c.issued_at', 'c.amount_gross', 'i.number as invoice_number']) as $cn
        ) {
            $lines[] = [
                'section' => 'REVENUE_CREDIT_NOTE',
                'occurred_at' => self::iso((string) $cn->issued_at),
                'reference' => $cn->number === null ? null : (string) $cn->number,
                'channel' => null,
                'category_or_label' => 'Avoir émis sur '.($cn->invoice_number ?? 'facture'),
                'signed_amount' => -((int) $cn->amount_gross),
                'excluded_from_ca' => false,
                'reconciliation_status' => null,
            ];
        }

        $reconciledStatusByPayment = DB::table('payment_reconciliation_lines as l')
            ->join('payment_reconciliations as r', static function (JoinClause $join): void {
                $join->on('r.clinic_id', '=', 'l.clinic_id')->on('r.id', '=', 'l.reconciliation_id');
            })
            ->where('l.clinic_id', $clinicId)
            ->whereNotNull('l.payment_id')
            ->pluck('r.status', 'l.payment_id')
            ->all();

        $reconciledStatusByRefund = DB::table('payment_reconciliation_lines as l')
            ->join('payment_reconciliations as r', static function (JoinClause $join): void {
                $join->on('r.clinic_id', '=', 'l.clinic_id')->on('r.id', '=', 'l.reconciliation_id');
            })
            ->where('l.clinic_id', $clinicId)
            ->whereNotNull('l.refund_id')
            ->pluck('r.status', 'l.refund_id')
            ->all();

        foreach (
            DB::table('payments as p')
                ->leftJoin('receipts as rec', static function (JoinClause $join): void {
                    $join->on('rec.clinic_id', '=', 'p.clinic_id')->on('rec.payment_id', '=', 'p.id');
                })
                ->join('invoices as i', static function (JoinClause $join): void {
                    $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.invoice_id');
                })
                ->where('p.clinic_id', $clinicId)
                ->where('p.status', 'CONFIRMED')
                ->where('p.effective_at', '>=', $period->start)
                ->where('p.effective_at', '<', $period->end)
                ->orderBy('p.effective_at')
                ->orderBy('p.id')
                ->get(['p.id', 'p.method', 'p.amount', 'p.effective_at', 'rec.number as receipt_number', 'i.origin', 'i.number as invoice_number']) as $pay
        ) {
            $label = 'Encaissement'.((string) $pay->origin === 'LEGACY_BALANCE' ? ' (reprise papier)' : '').' '.($pay->invoice_number ?? '');
            $lines[] = [
                'section' => 'COLLECTION_PAYMENT',
                'occurred_at' => self::iso((string) $pay->effective_at),
                'reference' => $pay->receipt_number === null ? $pay->invoice_number : (string) $pay->receipt_number,
                'channel' => (string) $pay->method,
                'category_or_label' => trim($label),
                'signed_amount' => (int) $pay->amount,
                'excluded_from_ca' => true,
                'reconciliation_status' => isset($reconciledStatusByPayment[(string) $pay->id]) ? (string) $reconciledStatusByPayment[(string) $pay->id] : null,
            ];
        }

        foreach (
            DB::table('payment_reversals as rv')
                ->join('payments as p', static function (JoinClause $join): void {
                    $join->on('p.clinic_id', '=', 'rv.clinic_id')->on('p.id', '=', 'rv.payment_id');
                })
                ->join('invoices as i', static function (JoinClause $join): void {
                    $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.invoice_id');
                })
                ->where('rv.clinic_id', $clinicId)
                ->where('rv.recorded_at', '>=', $period->start)
                ->where('rv.recorded_at', '<', $period->end)
                ->orderBy('rv.recorded_at')
                ->orderBy('rv.id')
                ->get(['rv.id', 'rv.amount', 'rv.recorded_at', 'p.method', 'i.number as invoice_number']) as $rev
        ) {
            $lines[] = [
                'section' => 'COLLECTION_REVERSAL',
                'occurred_at' => self::iso((string) $rev->recorded_at),
                'reference' => $rev->invoice_number === null ? null : (string) $rev->invoice_number,
                'channel' => (string) $rev->method,
                'category_or_label' => 'Contre-écriture d\'encaissement',
                'signed_amount' => -((int) $rev->amount),
                'excluded_from_ca' => true,
                'reconciliation_status' => null,
            ];
        }

        foreach (
            DB::table('refunds')
                ->where('clinic_id', $clinicId)
                ->where('effective_at', '>=', $period->start)
                ->where('effective_at', '<', $period->end)
                ->orderBy('effective_at')
                ->orderBy('id')
                ->get(['id', 'number', 'method', 'amount', 'effective_at']) as $rf
        ) {
            $lines[] = [
                'section' => 'COLLECTION_REFUND',
                'occurred_at' => self::iso((string) $rf->effective_at),
                'reference' => (string) $rf->number,
                'channel' => (string) $rf->method,
                'category_or_label' => 'Remboursement sur avoir',
                'signed_amount' => -((int) $rf->amount),
                'excluded_from_ca' => true,
                'reconciliation_status' => isset($reconciledStatusByRefund[(string) $rf->id]) ? (string) $reconciledStatusByRefund[(string) $rf->id] : null,
            ];
        }

        foreach (
            DB::table('cash_movements as m')
                ->leftJoin('expense_categories as c', static function (JoinClause $join): void {
                    $join->on('c.clinic_id', '=', 'm.clinic_id')->on('c.id', '=', 'm.expense_category_id');
                })
                ->where('m.clinic_id', $clinicId)
                ->where('m.occurred_at', '>=', $period->start)
                ->where('m.occurred_at', '<', $period->end)
                ->orderBy('m.occurred_at')
                ->orderBy('m.id')
                ->get(['m.kind', 'm.signed_amount', 'm.reference', 'm.reason', 'm.occurred_at', 'c.name as category_name']) as $mv
        ) {
            $isExpense = (string) $mv->kind === 'EXPENSE';
            $lines[] = [
                'section' => $isExpense ? 'EXPENSE' : 'OTHER_CASH_MOVEMENT',
                'occurred_at' => self::iso((string) $mv->occurred_at),
                'reference' => $mv->reference === null ? null : (string) $mv->reference,
                'channel' => 'CASH',
                'category_or_label' => $isExpense
                    ? ('Dépense : '.($mv->category_name ?? 'Sans catégorie').' — '.$mv->reason)
                    : ((string) $mv->kind.' — '.$mv->reason),
                'signed_amount' => (int) $mv->signed_amount,
                'excluded_from_ca' => true,
                'reconciliation_status' => null,
            ];
        }

        foreach (
            DB::table('payment_reconciliations')
                ->where('clinic_id', $clinicId)
                ->where('period_starts_at', '<', $period->end)
                ->where('period_ends_at', '>', $period->start)
                ->orderBy('period_starts_at')
                ->orderBy('id')
                ->get() as $rec
        ) {
            $stmt = $rec->statement_amount === null ? null : (int) $rec->statement_amount;
            $variance = $stmt === null ? 0 : ($stmt - (int) $rec->expected_amount);
            $lines[] = [
                'section' => 'RECONCILIATION',
                'occurred_at' => self::iso((string) ($rec->validated_at ?? $rec->period_ends_at)),
                'reference' => (string) $rec->id,
                'channel' => (string) $rec->method,
                'category_or_label' => 'Rapprochement canal (écart constaté)',
                'signed_amount' => $variance,
                'excluded_from_ca' => true,
                'reconciliation_status' => (string) $rec->status,
            ];
        }

        usort($lines, static fn (array $a, array $b): int => [$a['occurred_at'], $a['section']] <=> [$b['occurred_at'], $b['section']]);

        return $lines;
    }

    private static function iso(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

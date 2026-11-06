<?php

namespace App\Domain\Billing\Reports;

use App\Domain\Billing\Numbering\BillingNumbers;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Finance du cabinet sur une période (R01 ; fichier 03 « Caisse et indicateurs » ; fichier 06 « Reporting sans seconde
 * vérité » ; fichier 19 « Dashboard distant »), EN LIGNE, pour la gérante seule (`finance.global.read`, fichier 09).
 *
 * Indicateurs DISTINCTS, jamais mélangés ni additionnés entre eux :
 *  - chiffre d'affaires de la période = factures émises dans la période MOINS avoirs émis dans la période (vue
 *    `vw_revenue_events`, factures d'origine NATIVE : une reprise de créance papier n'est jamais une vente) ;
 *  - encaissements de la période = paiements confirmés (à leur date effective) MOINS contre-écritures et remboursements
 *    de la période (vue `vw_collection_events`) : le règlement d'aujourd'hui d'une ancienne facture augmente les
 *    encaissements d'aujourd'hui sans devenir une vente d'aujourd'hui ;
 *  - créances = restes dus des factures émises de TOUTES les périodes, à l'instant de la lecture (`vw_invoice_balances`),
 *    dont la part des reprises papier ; crédits à rembourser = ligne à part ;
 *  - vente par personne = auteur de l'ÉMISSION ; encaissement par personne = auteur du PAIEMENT : deux responsabilités
 *    qui ne se fusionnent pas ;
 *  - caisse : sessions CLÔTURÉES dans la période (attendu figé, compté, écart) et corrections comptables postérieures à la
 *    clôture (`vw_cash_session_totals`), sessions encore ouvertes.
 *
 * Pas de multiplication des lignes (« fanout ») : chaque agrégat vient d'une vue qui somme chaque registre (paiements,
 * contre-écritures, avoirs, remboursements) INDÉPENDAMMENT avant toute jointure, ou d'une requête sans jointure qui
 * multiplie ; la seule jointure (reprises papier) est 1-1 sur la clé de la facture.
 *
 * Fraîcheur (fichier 19) : le serveur ne connaît que ce qu'il a reçu. Pour chaque poste de caisse hors ligne (poste
 * ACTIF qui détient une plage de pièces financières ou la propriété d'une facture), il dit la dernière pièce reçue, les
 * commandes reçues qui attendent encore (pièce liée, conflit : écart CONNU) et, sans nouvelle depuis plus de
 * `DEVICE_SILENCE_HOURS` heures avant la fin de la période (ou l'instant de la lecture), qu'il ne peut pas savoir ce que le
 * poste détient. Les totaux ne contiennent JAMAIS une opération restée sur un poste.
 */
final class FinancialReports
{
    /**
     * Silence d'un poste (heures) au-delà duquel le serveur le dit « sans nouvelle ». Hypothèse de travail à confirmer avec
     * la gérante : `last_sync_at` est l'instant de la dernière pièce ACCEPTÉE (ou rejetée après revue) de ce poste, non du
     * dernier contact ; un poste inactif (fermé le dimanche) peut donc sembler muet sans rien détenir.
     */
    public const DEVICE_SILENCE_HOURS = 24;

    /** Séries de pièces financières : un poste qui en détient une plage active est une caisse. */
    private const FINANCIAL_SERIES = [
        BillingNumbers::INVOICE,
        BillingNumbers::RECEIPT,
        BillingNumbers::CREDIT_NOTE,
        BillingNumbers::REFUND,
        BillingNumbers::LEGACY_BALANCE,
    ];

    /**
     * @return array<string, mixed>
     */
    public static function build(string $clinicId, ReportPeriod $period, CarbonImmutable $now): array
    {
        return [
            'period' => ['from' => $period->from->toString(), 'to' => $period->to->toString()],
            'revenue' => self::revenue($clinicId, $period),
            'collections' => self::collections($clinicId, $period),
            'receivables' => self::receivables($clinicId),
            'legacy_imported' => self::legacyImported($clinicId, $period),
            'cash_sessions' => self::cashSessions($clinicId, $period),
            'freshness' => self::freshness($clinicId, $period, $now),
            'generated_at' => $now->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * Chiffre d'affaires : factures émises − avoirs émis dans la période, et ventes par auteur de l'émission.
     *
     * @return array<string, mixed>
     */
    private static function revenue(string $clinicId, ReportPeriod $period): array
    {
        $rows = DB::table('vw_revenue_events')
            ->where('clinic_id', $clinicId)
            ->where('occurred_at', '>=', $period->start)
            ->where('occurred_at', '<', $period->end)
            ->selectRaw('event_type, actor_id, COUNT(*) AS events, SUM(signed_amount) AS total')
            ->groupBy('event_type', 'actor_id')
            ->get();

        $issued = ['count' => 0, 'total_gross' => 0];
        $credited = ['count' => 0, 'amount_gross' => 0];
        /** @var array<string, array{user_id: ?string, issued_count: int, issued_gross: int, credited_count: int, credited_gross: int, net: int}> $authors */
        $authors = [];
        foreach ($rows as $row) {
            $actor = $row->actor_id === null ? '' : (string) $row->actor_id;
            $authors[$actor] ??= ['user_id' => $actor === '' ? null : $actor, 'issued_count' => 0, 'issued_gross' => 0, 'credited_count' => 0, 'credited_gross' => 0, 'net' => 0];
            $events = (int) $row->events;
            $total = (int) $row->total;
            if ((string) $row->event_type === 'INVOICE') {
                $issued['count'] += $events;
                $issued['total_gross'] += $total;
                $authors[$actor]['issued_count'] += $events;
                $authors[$actor]['issued_gross'] += $total;
            } else {
                // Les avoirs sont des montants NÉGATIFS dans la vue : rendus en valeur absolue.
                $credited['count'] += $events;
                $credited['amount_gross'] += -$total;
                $authors[$actor]['credited_count'] += $events;
                $authors[$actor]['credited_gross'] += -$total;
            }
            $authors[$actor]['net'] += $total;
        }

        return [
            'issued' => $issued,
            'credited' => $credited,
            'net' => $issued['total_gross'] - $credited['amount_gross'],
            'by_author' => self::withNames($clinicId, array_values($authors), 'user_id'),
        ];
    }

    /**
     * Encaissements : paiements − contre-écritures − remboursements dans la période, par mode et par auteur du paiement,
     * corrections à part, part des reprises de créances papier.
     *
     * @return array<string, mixed>
     */
    private static function collections(string $clinicId, ReportPeriod $period): array
    {
        $rows = DB::table('vw_collection_events')
            ->where('clinic_id', $clinicId)
            ->where('occurred_at', '>=', $period->start)
            ->where('occurred_at', '<', $period->end)
            ->selectRaw('method, event_type, actor_id, COUNT(*) AS events, SUM(signed_amount) AS total')
            ->groupBy('method', 'event_type', 'actor_id')
            ->get();

        /** @var array<string, array{method: string, payments_count: int, payments_amount: int, reversals_amount: int, refunds_amount: int, net_amount: int}> $byMethod */
        $byMethod = [];
        /** @var array<string, array{user_id: ?string, payments_count: int, payments_amount: int, reversals_amount: int, refunds_amount: int, net_amount: int}> $authors */
        $authors = [];
        $reversals = ['count' => 0, 'amount' => 0];
        $refunds = ['count' => 0, 'amount' => 0];
        $net = 0;
        foreach ($rows as $row) {
            $method = (string) $row->method;
            $actor = $row->actor_id === null ? '' : (string) $row->actor_id;
            $byMethod[$method] ??= ['method' => $method, 'payments_count' => 0, 'payments_amount' => 0, 'reversals_amount' => 0, 'refunds_amount' => 0, 'net_amount' => 0];
            $authors[$actor] ??= ['user_id' => $actor === '' ? null : $actor, 'payments_count' => 0, 'payments_amount' => 0, 'reversals_amount' => 0, 'refunds_amount' => 0, 'net_amount' => 0];
            $events = (int) $row->events;
            $total = (int) $row->total;
            switch ((string) $row->event_type) {
                case 'PAYMENT':
                    $byMethod[$method]['payments_count'] += $events;
                    $byMethod[$method]['payments_amount'] += $total;
                    $authors[$actor]['payments_count'] += $events;
                    $authors[$actor]['payments_amount'] += $total;
                    break;
                case 'PAYMENT_REVERSAL':
                    // Contre-écritures et remboursements sont des montants NÉGATIFS dans la vue : rendus en valeur absolue.
                    $byMethod[$method]['reversals_amount'] += -$total;
                    $authors[$actor]['reversals_amount'] += -$total;
                    $reversals['count'] += $events;
                    $reversals['amount'] += -$total;
                    break;
                default:
                    $byMethod[$method]['refunds_amount'] += -$total;
                    $authors[$actor]['refunds_amount'] += -$total;
                    $refunds['count'] += $events;
                    $refunds['amount'] += -$total;
            }
            $byMethod[$method]['net_amount'] += $total;
            $authors[$actor]['net_amount'] += $total;
            $net += $total;
        }
        ksort($byMethod);

        // Part des reprises de créances papier : jointure 1-1 sur la clé de la facture (aucune multiplication de lignes).
        $legacy = DB::table('vw_collection_events as e')
            ->join('invoices as i', static function ($join): void {
                $join->on('i.clinic_id', '=', 'e.clinic_id')->on('i.id', '=', 'e.invoice_id');
            })
            ->where('e.clinic_id', $clinicId)
            ->where('i.origin', 'LEGACY_BALANCE')
            ->where('e.occurred_at', '>=', $period->start)
            ->where('e.occurred_at', '<', $period->end)
            ->selectRaw("COALESCE(SUM(CASE WHEN e.event_type = 'PAYMENT' THEN 1 ELSE 0 END), 0) AS payments, COALESCE(SUM(e.signed_amount), 0) AS net")
            ->first();

        return [
            'by_method' => array_values($byMethod),
            'net_total' => $net,
            'corrections' => ['reversals' => $reversals, 'refunds' => $refunds],
            'on_legacy' => ['payments_count' => (int) ($legacy->payments ?? 0), 'net_amount' => (int) ($legacy->net ?? 0)],
            'by_author' => self::withNames($clinicId, array_values($authors), 'user_id'),
        ];
    }

    /**
     * Créances et crédits à rembourser À L'INSTANT de la lecture, toutes périodes confondues (visibles de la gérante seule).
     *
     * @return array<string, mixed>
     */
    private static function receivables(string $clinicId): array
    {
        $row = DB::table('vw_invoice_balances')
            ->where('clinic_id', $clinicId)
            ->selectRaw(
                "COALESCE(SUM(CASE WHEN amount_due > 0 THEN 1 ELSE 0 END), 0) AS open_invoices,
                 COALESCE(SUM(amount_due), 0) AS due,
                 COALESCE(SUM(CASE WHEN origin = 'LEGACY_BALANCE' AND amount_due > 0 THEN 1 ELSE 0 END), 0) AS legacy_open_invoices,
                 COALESCE(SUM(CASE WHEN origin = 'LEGACY_BALANCE' THEN amount_due ELSE 0 END), 0) AS legacy_due,
                 COALESCE(SUM(CASE WHEN refundable_credit > 0 THEN 1 ELSE 0 END), 0) AS credit_invoices,
                 COALESCE(SUM(refundable_credit), 0) AS credit",
            )
            ->first();

        return [
            'invoices_count' => (int) ($row->open_invoices ?? 0),
            'amount_due' => (int) ($row->due ?? 0),
            'of_which_legacy' => [
                'invoices_count' => (int) ($row->legacy_open_invoices ?? 0),
                'amount_due' => (int) ($row->legacy_due ?? 0),
            ],
            'refundable_credit' => [
                'invoices_count' => (int) ($row->credit_invoices ?? 0),
                'amount' => (int) ($row->credit ?? 0),
            ],
        ];
    }

    /**
     * Créances papier REPRISES dans la période (reste dû à la reprise) : hors chiffre d'affaires, hors encaissements.
     *
     * @return array{count: int, opening_balance: int}
     */
    private static function legacyImported(string $clinicId, ReportPeriod $period): array
    {
        $row = DB::table('invoices')
            ->where('clinic_id', $clinicId)
            ->where('status', 'ISSUED')
            ->where('origin', 'LEGACY_BALANCE')
            ->where('issued_at', '>=', $period->start)
            ->where('issued_at', '<', $period->end)
            ->selectRaw('COUNT(*) AS invoices, COALESCE(SUM(total_gross), 0) AS total')
            ->first();

        return ['count' => (int) ($row->invoices ?? 0), 'opening_balance' => (int) ($row->total ?? 0)];
    }

    /**
     * Caisse : sessions clôturées dans la période (attendu figé, compté, écart), corrections comptables postérieures à
     * leur clôture, sessions encore ouvertes.
     *
     * @return array{closed_count: int, expected_total: int, counted_total: int, variance_total: int, post_closure_reversals: int, open_count: int}
     */
    private static function cashSessions(string $clinicId, ReportPeriod $period): array
    {
        $closed = DB::table('vw_cash_session_totals')
            ->where('clinic_id', $clinicId)
            ->whereNotNull('closed_at')
            ->where('closed_at', '>=', $period->start)
            ->where('closed_at', '<', $period->end)
            ->selectRaw(
                'COUNT(*) AS sessions,
                 COALESCE(SUM(frozen_closing_expected_amount), 0) AS expected,
                 COALESCE(SUM(counted_amount), 0) AS counted,
                 COALESCE(SUM(variance), 0) AS variance,
                 COALESCE(SUM(post_closure_accounting_reversals), 0) AS post_closure',
            )
            ->first();
        $open = DB::table('vw_cash_session_totals')
            ->where('clinic_id', $clinicId)
            ->whereNull('closed_at')
            ->where('opened_at', '<', $period->end)
            ->count();

        return [
            'closed_count' => (int) ($closed->sessions ?? 0),
            'expected_total' => (int) ($closed->expected ?? 0),
            'counted_total' => (int) ($closed->counted ?? 0),
            'variance_total' => (int) ($closed->variance ?? 0),
            'post_closure_reversals' => (int) ($closed->post_closure ?? 0),
            'open_count' => (int) $open,
        ];
    }

    /**
     * Fraîcheur des totaux : un état par poste de caisse hors ligne ACTIF.
     *
     *  - `WAITING` : des commandes reçues de ce poste attendent (pièce liée absente, conflit) : écart CONNU, leurs faits ne
     *    sont pas dans les totaux ;
     *  - `SILENT` : rien reçu de ce poste depuis plus de DEVICE_SILENCE_HOURS avant la fin de la période (ou l'instant de la
     *    lecture, si la période n'est pas finie) : ce que le poste détient est INCONNU du serveur ;
     *  - `UP_TO_DATE` : ni l'un ni l'autre. Le serveur ne peut pas savoir ce qu'un poste n'a jamais envoyé.
     *
     * @return array{complete: bool, silence_hours: int, devices: list<array<string, mixed>>}
     */
    private static function freshness(string $clinicId, ReportPeriod $period, CarbonImmutable $now): array
    {
        $end = CarbonImmutable::parse($period->end, 'UTC');
        $horizon = $end < $now ? $end : $now;
        $silentBefore = $horizon->subHours(self::DEVICE_SILENCE_HOURS);

        $rows = DB::table('vw_device_sync_health as h')
            ->where('h.clinic_id', $clinicId)
            ->where('h.status', 'ACTIVE')
            ->where(static function (Builder $query): void {
                $query->whereExists(static function (Builder $owner): void {
                    $owner->selectRaw('1')->from('vw_active_invoice_write_owners as o')
                        ->whereColumn('o.clinic_id', 'h.clinic_id')->whereColumn('o.device_id', 'h.device_id');
                })->orWhereExists(static function (Builder $range): void {
                    $range->selectRaw('1')->from('document_number_allocations as a')
                        ->whereColumn('a.clinic_id', 'h.clinic_id')->whereColumn('a.device_id', 'h.device_id')
                        ->whereIn('a.status', ['ACTIVE', 'CLOSING'])
                        ->whereIn('a.document_type', self::FINANCIAL_SERIES);
                });
            })
            ->orderBy('h.name')
            ->orderBy('h.device_id')
            ->get(['h.device_id', 'h.name', 'h.last_sync_at', 'h.received_commands_pending', 'h.received_commands_in_conflict']);

        $complete = true;
        $devices = [];
        foreach ($rows as $row) {
            $last = $row->last_sync_at === null ? null : CarbonImmutable::parse((string) $row->last_sync_at, 'UTC');
            $pending = (int) $row->received_commands_pending;
            $conflicts = (int) $row->received_commands_in_conflict;
            if ($pending + $conflicts > 0) {
                $state = 'WAITING';
            } elseif ($last === null || $last < $silentBefore) {
                $state = 'SILENT';
            } else {
                $state = 'UP_TO_DATE';
            }
            $complete = $complete && $state === 'UP_TO_DATE';
            $devices[] = [
                'device_id' => (string) $row->device_id,
                'name' => (string) $row->name,
                'last_sync_at' => $last?->format('Y-m-d\TH:i:s.v\Z'),
                'commands_pending' => $pending,
                'commands_in_conflict' => $conflicts,
                'state' => $state,
            ];
        }

        return ['complete' => $complete, 'silence_hours' => self::DEVICE_SILENCE_HOURS, 'devices' => $devices];
    }

    /**
     * Ajoute le nom affichable de chaque auteur (null si inconnu), puis trie par nom et identifiant : ordre stable.
     *
     * @template T of array<string, mixed>
     *
     * @param  list<T>  $entries
     * @return list<array<string, mixed>>
     */
    private static function withNames(string $clinicId, array $entries, string $key): array
    {
        $ids = [];
        foreach ($entries as $entry) {
            if (is_string($entry[$key] ?? null)) {
                $ids[] = $entry[$key];
            }
        }
        /** @var array<string, string> $names */
        $names = [];
        if ($ids !== []) {
            foreach (DB::table('users')->where('clinic_id', $clinicId)->whereIn('id', $ids)->get(['id', 'display_name']) as $user) {
                $names[(string) $user->id] = (string) $user->display_name;
            }
        }

        $out = [];
        foreach ($entries as $entry) {
            $id = is_string($entry[$key] ?? null) ? $entry[$key] : null;
            $out[] = $entry + ['display_name' => $id === null ? null : ($names[$id] ?? null)];
        }
        usort(
            $out,
            static fn (array $left, array $right): int => [$left['display_name'] ?? '~', (string) ($left[$key] ?? '')] <=> [$right['display_name'] ?? '~', (string) ($right[$key] ?? '')],
        );

        return $out;
    }
}

<?php

namespace App\Domain\Operations;

use App\Domain\Billing\Reports\AccountingExport;
use App\Domain\Billing\Reports\FinancialReports;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Domain\Clinical\ActivityReports;
use App\Domain\Inventory\Rules\StockValue;
use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\DayWindow;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Support\Modules;
use Brick\Math\BigInteger;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Tableaux et exports de gestion multi-domaines (L1D09) : synthèses par profil et modules ouverts,
 * comparées à la période civile précédente équivalente, sans double compte ni valeurs inconnues
 * maquillées en zéro, avec définitions, dénominateurs, provenance et empreinte SHA-256.
 */
final class ManagementExports
{
    private const SOURCE = 'eeo.management_exports.v1';

    private const WORKSHOP_OPEN_STATUSES = ['ORDERED', 'RECEIVED', 'MOUNTING', 'QUALITY_CHECK'];

    private const WORKSHOP_STATUS_ORDER = ['ORDERED', 'RECEIVED', 'MOUNTING', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'CANCELLED'];

    public function __construct(private readonly ActivityReports $activityReports) {}

    /**
     * Construit le tableau de gestion consolidé selon les droits effectifs de l'acteur et les modules actifs.
     *
     * @param  list<string>  $permissions
     * @return array<string, mixed>
     */
    public function build(
        string $clinicId,
        string $timezone,
        array $permissions,
        mixed $from,
        mixed $to,
        CarbonImmutable $now,
    ): array {
        $period = ReportPeriod::resolve($timezone, $now, $from, $to);
        $days = $period->to->dayNumber() - $period->from->dayNumber() + 1;
        $prevTo = $period->from->addDays(-1, 'from');
        $prevFrom = $prevTo->addDays(-($days - 1), 'from');
        $previousPeriod = ReportPeriod::resolve($timezone, $now, $prevFrom->toString(), $prevTo->toString());

        $freshness = FinancialReports::freshness($clinicId, $period, $now);

        /** @var list<array{section: string, reason: string, detail: string}> $excludedSections */
        $excludedSections = [];
        /** @var list<array{domain: string, code: string, label: string, count: int, note: string}> $unknowns */
        $unknowns = [];

        $incompleteDevices = array_values(array_filter(
            $freshness['devices'],
            static fn (array $device): bool => $device['state'] !== 'UP_TO_DATE',
        ));
        if ($incompleteDevices !== []) {
            $unknowns[] = [
                'domain' => 'SYNC',
                'code' => 'sync_incomplete',
                'label' => 'Postes hors ligne non à jour ou silencieux',
                'count' => count($incompleteDevices),
                'note' => 'Les totaux n\'incluent jamais d\'écritures encore bloquées sur un poste hors ligne.',
            ];
        }

        $finance = $this->financeSection($clinicId, $permissions, $period, $previousPeriod, $now, $excludedSections, $unknowns);
        $stock = $this->stockSection($clinicId, $timezone, $permissions, $period, $now, $excludedSections, $unknowns);
        $workshop = $this->workshopSection($clinicId, $permissions, $period, $previousPeriod, $now, $excludedSections, $unknowns);
        $patients = $this->patientsSection($clinicId, $timezone, $permissions, $period, $previousPeriod, $excludedSections, $unknowns);
        $clinical = $this->clinicalSection($clinicId, $timezone, $permissions, $period, $previousPeriod, $excludedSections, $unknowns);

        $definitions = $this->definitions($finance !== null, $stock !== null, $stock !== null && $stock['valuation_at_read'] !== null, $workshop !== null, $patients !== null, $clinical !== null);

        $core = [
            'period' => ['from' => $period->from->toString(), 'to' => $period->to->toString(), 'days' => $days],
            'previous_period' => ['from' => $previousPeriod->from->toString(), 'to' => $previousPeriod->to->toString(), 'days' => $days],
            'timezone' => $timezone,
            'currency' => 'XAF',
            'freshness' => $freshness,
            'excluded_sections' => $excludedSections,
            'finance' => $finance,
            'stock' => $stock,
            'workshop' => $workshop,
            'patients' => $patients,
            'clinical' => $clinical,
            'unknowns' => $unknowns,
            'definitions' => $definitions,
        ];

        return [
            ...$core,
            'provenance' => [
                'source' => self::SOURCE,
                'period_timezone' => $timezone,
                'previous_period_rule' => sprintf('Fenêtre civile contiguë précédente de %d jour(s) (%s au %s).', $days, $previousPeriod->from->toString(), $previousPeriod->to->toString()),
                'dataset_sha256' => CanonicalJson::hash($core),
            ],
            'generated_at' => $now->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * Exporte le tableau de gestion autorisé au format CSV UTF-8 (séparateur « ; ») avec dictionnaire et provenance.
     *
     * @param  array<string, mixed>  $report
     */
    public function toCsv(array $report): string
    {
        $rows = [];
        $rows[] = ['RAPPORT_GESTION_L1D09'];
        $rows[] = ['periode_du', $report['period']['from'], 'au', $report['period']['to'], 'jours', $report['period']['days']];
        $rows[] = ['periode_precedente_du', $report['previous_period']['from'], 'au', $report['previous_period']['to'], 'devise', $report['currency']];
        $rows[] = ['fuseau', $report['timezone'], 'genere_le_utc', $report['generated_at'], 'sha256_donnees', $report['provenance']['dataset_sha256']];
        $rows[] = ['source', $report['provenance']['source'], 'regle_precedente', $report['provenance']['previous_period_rule']];
        $rows[] = [];

        $rows[] = ['SECTION', 'DOMAINE', 'INDICATEUR', 'PERIODE_N', 'PERIODE_N_1', 'ECART', 'VARIATION_PCT', 'UNITE_OU_DETAIL'];

        if (is_array($report['finance'])) {
            $fin = $report['finance'];
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'FINANCE', 'Chiffre d\'affaires net (hors reprises papier et devis)', $fin['net_revenue'], 'XAF');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'FINANCE', 'Facturation brute émise (NATIVE)', $fin['invoiced_gross'], 'XAF');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'FINANCE', 'Avoirs émis', $fin['credited_gross'], 'XAF');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'FINANCE', 'Encaissements nets', $fin['net_collections'], 'XAF');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'FINANCE', 'Dépenses de caisse', $fin['expenses_total'], 'XAF');
            $rows[] = ['INDICATEUR', 'FINANCE', 'Devis émis (hors CA)', $fin['quotes_pipeline']['issued_count'], '', '', '', 'Montant devis '.$fin['quotes_pipeline']['issued_amount'].' XAF | Acceptés '.$fin['quotes_pipeline']['accepted_count'].' | Convertis '.$fin['quotes_pipeline']['converted_count']];
            $rows[] = ['INDICATEUR', 'FINANCE', 'Créances à la lecture (toutes périodes)', $fin['receivables_at_read']['amount_due'], '', '', '', $fin['receivables_at_read']['invoices_count'].' factures dont '.$fin['receivables_at_read']['of_which_legacy_count'].' reprise(s) papier ('.$fin['receivables_at_read']['of_which_legacy_amount'].' XAF)'];
            $rows[] = ['INDICATEUR', 'FINANCE', 'Crédits à rembourser à la lecture', $fin['receivables_at_read']['refundable_credit_amount'], '', '', '', 'XAF'];
            $rows[] = ['INDICATEUR', 'FINANCE', 'Rapprochements (période)', $fin['reconciliations_period']['validated_count'], '', '', '', 'Brouillons '.$fin['reconciliations_period']['draft_count'].' | Lignes contestées '.$fin['reconciliations_period']['disputed_lines'].' | Écart '.$fin['reconciliations_period']['variance_total'].' XAF'];
            $rows[] = ['INDICATEUR', 'FINANCE', 'Sessions de caisse clôturées', $fin['cash_sessions']['closed_count'], '', '', '', 'Ouvertes '.$fin['cash_sessions']['open_count'].' | Écart total '.$fin['cash_sessions']['variance_total'].' XAF'];
        }

        if (is_array($report['stock'])) {
            $stk = $report['stock'];
            $valText = is_array($stk['valuation_at_read'])
                ? (string) $stk['valuation_at_read']['known_cost_value']
                : 'NON_AUTORISE';
            $valNote = is_array($stk['valuation_at_read'])
                ? 'Positions valorisables '.$stk['valuation_at_read']['total_positions'].' | Coût inconnu '.$stk['valuation_at_read']['unknown_cost_positions']
                : 'Droit stock.valuation.read requis';
            $rows[] = ['INDICATEUR', 'STOCK', 'Valorisation coût d\'achat connu (à la lecture)', $valText, '', '', '', $valNote];
            $rows[] = ['INDICATEUR', 'STOCK', 'Positions en stock', $stk['positions_count'], '', '', '', 'Articles sous seuil '.$stk['low_stock_items_count']];
            $rows[] = ['INDICATEUR', 'STOCK', 'Alertes actives (OPEN/ACKNOWLEDGED)', $stk['open_alerts']['total'], '', '', '', 'Seuil '.$stk['open_alerts']['low_stock'].' | Péremption proche '.$stk['open_alerts']['expiring'].' | Périmé '.$stk['open_alerts']['expired'].' | Sans échéance '.$stk['open_alerts']['without_due_date']];
            $rows[] = ['INDICATEUR', 'STOCK', 'Réceptions validées (période)', $stk['movements_in_period']['receipts_validated_count'], '', '', '', 'Ajustements '.$stk['movements_in_period']['adjustments_count'].' | Remises confirmées '.$stk['movements_in_period']['deliveries_confirmed_count'].' | Retours '.$stk['movements_in_period']['physical_returns_count']];
        }

        if (is_array($report['workshop'])) {
            $wrk = $report['workshop'];
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'WORKSHOP', 'Ordres atelier créés', $wrk['created_count'], 'ordres');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'WORKSHOP', 'Ordres prêts ou remis', $wrk['delivered_or_ready_count'], 'ordres');
            $rows[] = ['INDICATEUR', 'WORKSHOP', 'En-cours ouverts à la lecture', $wrk['open_total'], '', '', '', 'En retard '.$wrk['overdue_open_count'].' | Sans date attendue '.$wrk['unknown_expected_date_count'].' | Sans monture liée '.$wrk['orders_without_frame_item_count']];
        }

        if (is_array($report['patients'])) {
            $pat = $report['patients'];
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'PATIENTS', 'Visites non annulées', $pat['visits_count'], 'visites');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'PATIENTS', 'Patients distincts', $pat['distinct_patients'], 'patients');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'PATIENTS', 'Nouveaux patients', $pat['new_patients'], 'patients');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'PATIENTS', 'Patients anciens', $pat['returning_patients'], 'patients');
        }

        if (is_array($report['clinical'])) {
            $cli = $report['clinical'];
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'CLINICAL', 'Consultations clôturées', $cli['consultations_completed'], 'consultations');
            $this->appendComparisonCsv($rows, 'INDICATEUR', 'CLINICAL', 'Prescriptions optiques internes validées', $cli['optical_prescriptions_issued'], 'prescriptions');
            $rows[] = ['INDICATEUR', 'CLINICAL', 'Taux de prescription optique', number_format($cli['prescriptions_rate_bps'] / 100, 2, '.', ''), '', '', '', '%, Ordonnances médicaments '.$cli['medication_orders_count'].' | Orientations '.$cli['referrals_count']];
        }

        $rows[] = [];
        $rows[] = ['TYPE', 'DOMAINE', 'CODE', 'LIBELLE', 'COMPTE', 'NOTE'];
        foreach ($report['excluded_sections'] as $excl) {
            $rows[] = ['EXCLUSION', $excl['section'], $excl['reason'], '', '', $excl['detail']];
        }
        foreach ($report['unknowns'] as $unk) {
            $rows[] = ['INCONNU', $unk['domain'], $unk['code'], $unk['label'], $unk['count'], $unk['note']];
        }

        $rows[] = [];
        $rows[] = ['DICTIONNAIRE', 'DOMAINE', 'CODE', 'LIBELLE', 'FORMULE', 'DENOMINATEUR', 'EXCLUSIONS'];
        foreach ($report['definitions'] as $def) {
            $rows[] = ['DEFINITION', $def['domain'], $def['code'], $def['label'], $def['formula'], $def['denominator'], $def['exclusion_note']];
        }

        return "\u{FEFF}".implode("\r\n", array_map(fn (array $row): string => implode(';', array_map(self::csvCell(...), $row)), $rows))."\r\n";
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<array{section: string, reason: string, detail: string}>  $excluded
     * @param  list<array{domain: string, code: string, label: string, count: int, note: string}>  $unknowns
     * @return array<string, mixed>|null
     */
    private function financeSection(
        string $clinicId,
        array $permissions,
        ReportPeriod $period,
        ReportPeriod $previousPeriod,
        CarbonImmutable $now,
        array &$excluded,
        array &$unknowns,
    ): ?array {
        if (! Modules::isEnabled('sales')) {
            $excluded[] = ['section' => 'FINANCE', 'reason' => 'MODULE_DISABLED', 'detail' => 'Le module ventes et finance n\'est pas ouvert dans cet environnement.'];

            return null;
        }
        if (! in_array('finance.global.read', $permissions, true)) {
            $excluded[] = ['section' => 'FINANCE', 'reason' => 'PERMISSION_MISSING', 'detail' => 'La section finance globale requiert la permission finance.global.read.'];

            return null;
        }

        $accCurr = AccountingExport::build($clinicId, $period, $now);
        $accPrev = AccountingExport::build($clinicId, $previousPeriod, $now);
        $finCurr = FinancialReports::build($clinicId, $period, $now);

        $quotes = DB::table('quotes')
            ->where('clinic_id', $clinicId)
            ->where('issued_at', '>=', $period->start)
            ->where('issued_at', '<', $period->end)
            ->where('status', '<>', 'DRAFT')
            ->get(['status', 'total_gross']);

        $issuedCount = count($quotes);
        $issuedAmount = 0;
        $acceptedCount = 0;
        $convertedCount = 0;
        foreach ($quotes as $quote) {
            $issuedAmount += (int) $quote->total_gross;
            $status = (string) $quote->status;
            if (in_array($status, ['ACCEPTED', 'CONVERTED'], true)) {
                $acceptedCount++;
            }
            if ($status === 'CONVERTED') {
                $convertedCount++;
            }
        }

        $recCurr = $accCurr['reconciliations'];
        $disputedLines = array_sum(array_column($recCurr['by_method'], 'disputed_lines'));
        $varianceTotal = array_sum(array_column($recCurr['by_method'], 'variance_total'));

        if ($recCurr['draft_count'] > 0) {
            $unknowns[] = [
                'domain' => 'FINANCE',
                'code' => 'reconciliations_draft',
                'label' => 'Rapprochements encore en brouillon',
                'count' => (int) $recCurr['draft_count'],
                'note' => 'Des rapprochements non validés peuvent encore évoluer avant clôture.',
            ];
        }
        if ($disputedLines > 0) {
            $unknowns[] = [
                'domain' => 'FINANCE',
                'code' => 'reconciliations_disputed',
                'label' => 'Lignes de rapprochement contestées',
                'count' => (int) $disputedLines,
                'note' => 'Écarts ou références en attente d\'arbitrage lors du rapprochement.',
            ];
        }
        if ($finCurr['cash_sessions']['open_count'] > 0) {
            $unknowns[] = [
                'domain' => 'FINANCE',
                'code' => 'open_cash_sessions',
                'label' => 'Sessions de caisse encore ouvertes',
                'count' => (int) $finCurr['cash_sessions']['open_count'],
                'note' => 'Les totaux de clôture n\'intègrent pas les sessions ouvertes non comptées.',
            ];
        }
        if ($accCurr['receivables_at_read']['of_which_legacy']['invoices_count'] > 0) {
            $unknowns[] = [
                'domain' => 'FINANCE',
                'code' => 'legacy_receivables_outstanding',
                'label' => 'Reprises papier restant dues',
                'count' => (int) $accCurr['receivables_at_read']['of_which_legacy']['invoices_count'],
                'note' => 'Créances reprises (LEGACY_BALANCE) exclues du chiffre d\'affaires et suivies à part.',
            ];
        }

        $collectionsByMethod = array_map(
            static fn (array $row): array => [
                'method' => $row['method'],
                'payments_amount' => $row['payments_amount'],
                'reversals_amount' => $row['reversals_amount'],
                'refunds_amount' => $row['refunds_amount'],
                'net_amount' => $row['net_amount'],
            ],
            $accCurr['collections']['by_method'],
        );

        return [
            'net_revenue' => $this->compareMoney((int) $accCurr['revenue']['net_revenue'], (int) $accPrev['revenue']['net_revenue']),
            'invoiced_gross' => $this->compareMoney((int) $accCurr['revenue']['invoiced_gross'], (int) $accPrev['revenue']['invoiced_gross']),
            'credited_gross' => $this->compareMoney((int) $accCurr['revenue']['credited_gross'], (int) $accPrev['revenue']['credited_gross']),
            'net_collections' => $this->compareMoney((int) $accCurr['collections']['net_total'], (int) $accPrev['collections']['net_total']),
            'expenses_total' => $this->compareMoney((int) $accCurr['expenses']['total_amount'], (int) $accPrev['expenses']['total_amount']),
            'quotes_pipeline' => [
                'issued_count' => $issuedCount,
                'issued_amount' => $issuedAmount,
                'accepted_count' => $acceptedCount,
                'converted_count' => $convertedCount,
                'excluded_from_revenue_note' => 'Les devis restent strictement en avant-vente et n\'entrent jamais dans le chiffre d\'affaires.',
            ],
            'receivables_at_read' => [
                'invoices_count' => (int) $accCurr['receivables_at_read']['invoices_count'],
                'amount_due' => (int) $accCurr['receivables_at_read']['amount_due'],
                'of_which_legacy_count' => (int) $accCurr['receivables_at_read']['of_which_legacy']['invoices_count'],
                'of_which_legacy_amount' => (int) $accCurr['receivables_at_read']['of_which_legacy']['amount_due'],
                'refundable_credit_amount' => (int) $accCurr['receivables_at_read']['refundable_credit']['amount'],
            ],
            'collections_by_method' => $collectionsByMethod,
            'reconciliations_period' => [
                'validated_count' => (int) $recCurr['validated_count'],
                'draft_count' => (int) $recCurr['draft_count'],
                'disputed_lines' => (int) $disputedLines,
                'variance_total' => (int) $varianceTotal,
            ],
            'cash_sessions' => [
                'closed_count' => (int) $finCurr['cash_sessions']['closed_count'],
                'open_count' => (int) $finCurr['cash_sessions']['open_count'],
                'variance_total' => (int) $finCurr['cash_sessions']['variance_total'],
                'post_closure_reversals' => (int) $finCurr['cash_sessions']['post_closure_reversals'],
            ],
        ];
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<array{section: string, reason: string, detail: string}>  $excluded
     * @param  list<array{domain: string, code: string, label: string, count: int, note: string}>  $unknowns
     * @return array<string, mixed>|null
     */
    private function stockSection(
        string $clinicId,
        string $timezone,
        array $permissions,
        ReportPeriod $period,
        CarbonImmutable $now,
        array &$excluded,
        array &$unknowns,
    ): ?array {
        if (! Modules::isEnabled('stock')) {
            $excluded[] = ['section' => 'STOCK', 'reason' => 'MODULE_DISABLED', 'detail' => 'Le module stock n\'est pas activé.'];

            return null;
        }
        if (! in_array('stock.read', $permissions, true)) {
            $excluded[] = ['section' => 'STOCK', 'reason' => 'PERMISSION_MISSING', 'detail' => 'Les indicateurs stock requièrent la permission stock.read.'];

            return null;
        }

        $canValue = in_array('stock.valuation.read', $permissions, true);
        if (! $canValue) {
            $excluded[] = [
                'section' => 'STOCK_VALUATION',
                'reason' => 'PERMISSION_MISSING',
                'detail' => 'La valorisation financière du stock est réservée aux profils disposant de stock.valuation.read.',
            ];
        }

        $positions = DB::table('stock_positions as p')
            ->join('catalog_items as i', static function (JoinClause $join): void {
                $join->on('i.clinic_id', '=', 'p.clinic_id')->on('i.id', '=', 'p.item_id');
            })
            ->join('stock_locations as l', static function (JoinClause $join): void {
                $join->on('l.clinic_id', '=', 'p.clinic_id')->on('l.id', '=', 'p.location_id');
            })
            ->join('catalog_categories as c', 'c.code', '=', 'i.category_code')
            ->where('p.clinic_id', $clinicId)
            ->where('p.on_hand', '>', 0)
            ->get([
                'p.id',
                'p.item_id',
                'p.location_id',
                'p.on_hand',
                'i.purchase_cost',
                'i.category_code',
                'c.label as category_name',
                'l.code as location_code',
                'l.name as location_name',
            ])
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
        $unknownLots = 0;

        /** @var array<string, array{location_id: string, code: string, name: string, positions_count: int, qty: FixedDecimal, unknown_cost_positions: int}> $byLocation */
        $byLocation = [];
        /** @var array<string, array{category_code: string, category_name: string, items: array<string, true>, qty: FixedDecimal, unknown_cost_positions: int, known_cost_value: int}> $byCategory */
        $byCategory = [];

        foreach ($positions as $position) {
            $posId = (string) $position->id;
            $posOnHand = Quantity::of((string) $position->on_hand);
            $fallbackCost = $position->purchase_cost === null ? null : (int) $position->purchase_cost;
            $lots = $lotsByPosition[$posId] ?? [];
            $lotted = FixedDecimal::fromUnits(0, Quantity::SCALE);
            $hasUnknown = false;
            $positionValue = 0;

            foreach ($lots as $lot) {
                $qty = Quantity::of((string) $lot->on_hand);
                $lotted = $lotted->plus($qty);
                $cost = $lot->unit_cost === null ? $fallbackCost : (int) $lot->unit_cost;
                if ($cost === null) {
                    $hasUnknown = true;
                    $unknownLots++;
                } else {
                    $positionValue += StockValue::of($qty, $cost);
                }
            }

            if ($posOnHand->units > $lotted->units) {
                $unlotted = FixedDecimal::fromUnits($posOnHand->units - $lotted->units, Quantity::SCALE);
                if ($fallbackCost === null) {
                    $hasUnknown = true;
                } else {
                    $positionValue += StockValue::of($unlotted, $fallbackCost);
                }
            }

            if ($hasUnknown) {
                $unknownPositions++;
            }
            $knownValue += $positionValue;

            $locId = (string) $position->location_id;
            if (! isset($byLocation[$locId])) {
                $byLocation[$locId] = [
                    'location_id' => $locId,
                    'code' => (string) $position->location_code,
                    'name' => (string) $position->location_name,
                    'positions_count' => 0,
                    'qty' => FixedDecimal::fromUnits(0, Quantity::SCALE),
                    'unknown_cost_positions' => 0,
                ];
            }
            $byLocation[$locId]['positions_count']++;
            $byLocation[$locId]['qty'] = $byLocation[$locId]['qty']->plus($posOnHand);
            if ($hasUnknown) {
                $byLocation[$locId]['unknown_cost_positions']++;
            }

            $catCode = (string) $position->category_code;
            if (! isset($byCategory[$catCode])) {
                $byCategory[$catCode] = [
                    'category_code' => $catCode,
                    'category_name' => (string) $position->category_name,
                    'items' => [],
                    'qty' => FixedDecimal::fromUnits(0, Quantity::SCALE),
                    'unknown_cost_positions' => 0,
                    'known_cost_value' => 0,
                ];
            }
            $byCategory[$catCode]['items'][(string) $position->item_id] = true;
            $byCategory[$catCode]['qty'] = $byCategory[$catCode]['qty']->plus($posOnHand);
            if ($hasUnknown) {
                $byCategory[$catCode]['unknown_cost_positions']++;
            }
            $byCategory[$catCode]['known_cost_value'] += $positionValue;
        }

        if ($unknownPositions > 0) {
            $unknowns[] = [
                'domain' => 'STOCK',
                'code' => 'unknown_cost_positions',
                'label' => 'Positions stock sans coût d\'achat renseigné',
                'count' => $unknownPositions,
                'note' => 'Un coût inconnu n\'est jamais compté comme zéro dans la valorisation indicative.',
            ];
        }

        $lowStockItems = (int) DB::table('catalog_items as i')
            ->where('i.clinic_id', $clinicId)
            ->where('i.active', true)
            ->where('i.stock_mode', 'STOCKED')
            ->whereNotNull('i.low_stock_threshold')
            ->whereRaw(
                'COALESCE((SELECT SUM(sp.on_hand) FROM stock_positions sp WHERE sp.clinic_id = i.clinic_id AND sp.item_id = i.id), 0) <= i.low_stock_threshold',
            )
            ->count();

        $todayCivil = CivilDate::fromInstant(Instant::fromEpochMilliseconds((int) $now->format('Uv')), $timezone)->toString();
        $alerts = DB::table('stock_alerts')
            ->where('clinic_id', $clinicId)
            ->whereIn('status', ['OPEN', 'ACKNOWLEDGED'])
            ->get(['kind', 'due_on']);

        $alertLow = 0;
        $alertExpiring = 0;
        $alertExpired = 0;
        $alertNoDue = 0;
        foreach ($alerts as $alert) {
            if ((string) $alert->kind === 'LOW_STOCK') {
                $alertLow++;
            } elseif ($alert->due_on === null) {
                $alertNoDue++;
            } elseif (substr((string) $alert->due_on, 0, 10) <= $todayCivil) {
                $alertExpired++;
            } else {
                $alertExpiring++;
            }
        }
        if ($alertNoDue > 0) {
            $unknowns[] = [
                'domain' => 'STOCK',
                'code' => 'alerts_without_due_date',
                'label' => 'Alertes de péremption sans échéance datée',
                'count' => $alertNoDue,
                'note' => 'Alertes EXPIRY ouvertes dont la date de péremption due_on est absente.',
            ];
        }

        $totalPositions = count($positions);

        return [
            'valuation_at_read' => $canValue ? [
                'known_cost_value' => $knownValue,
                'unknown_cost_positions' => $unknownPositions,
                'unknown_cost_lots' => $unknownLots,
                'total_positions' => $totalPositions,
            ] : null,
            'valuation_hidden_reason' => $canValue ? null : 'PERMISSION_MISSING',
            'positions_count' => $totalPositions,
            'low_stock_items_count' => $lowStockItems,
            'open_alerts' => [
                'total' => count($alerts),
                'low_stock' => $alertLow,
                'expiring' => $alertExpiring,
                'expired' => $alertExpired,
                'without_due_date' => $alertNoDue,
            ],
            'movements_in_period' => [
                'receipts_validated_count' => DB::table('goods_receipts')
                    ->where('clinic_id', $clinicId)
                    ->where('status', 'VALIDATED')
                    ->where('validated_at', '>=', $period->start)
                    ->where('validated_at', '<', $period->end)
                    ->count(),
                'adjustments_count' => DB::table('stock_movements')
                    ->where('clinic_id', $clinicId)
                    ->whereIn('kind', ['ADJUSTMENT', 'BREAKAGE'])
                    ->where('occurred_at', '>=', $period->start)
                    ->where('occurred_at', '<', $period->end)
                    ->count(),
                'deliveries_confirmed_count' => DB::table('deliveries')
                    ->where('clinic_id', $clinicId)
                    ->where('status', 'CONFIRMED')
                    ->where('delivered_at', '>=', $period->start)
                    ->where('delivered_at', '<', $period->end)
                    ->count(),
                'physical_returns_count' => DB::table('physical_returns')
                    ->where('clinic_id', $clinicId)
                    ->where('occurred_at', '>=', $period->start)
                    ->where('occurred_at', '<', $period->end)
                    ->count(),
                'open_inventories_count' => DB::table('inventory_counts')
                    ->where('clinic_id', $clinicId)
                    ->whereIn('status', ['OPEN', 'COUNTED'])
                    ->count(),
                'validated_inventories_count' => DB::table('inventory_counts')
                    ->where('clinic_id', $clinicId)
                    ->where('status', 'VALIDATED')
                    ->where('validated_at', '>=', $period->start)
                    ->where('validated_at', '<', $period->end)
                    ->count(),
            ],
            'by_location' => array_values(array_map(
                static fn (array $loc): array => [
                    'location_id' => $loc['location_id'],
                    'code' => $loc['code'],
                    'name' => $loc['name'],
                    'positions_count' => $loc['positions_count'],
                    'quantity_on_hand' => $loc['qty']->canonical(),
                    'unknown_cost_positions' => $loc['unknown_cost_positions'],
                ],
                $byLocation,
            )),
            'by_category' => array_values(array_map(
                static fn (array $cat): array => [
                    'category_code' => $cat['category_code'],
                    'category_name' => $cat['category_name'],
                    'items_count' => count($cat['items']),
                    'quantity_on_hand' => $cat['qty']->canonical(),
                    'unknown_cost_positions' => $cat['unknown_cost_positions'],
                    'known_cost_value' => $canValue ? $cat['known_cost_value'] : null,
                ],
                $byCategory,
            )),
        ];
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<array{section: string, reason: string, detail: string}>  $excluded
     * @param  list<array{domain: string, code: string, label: string, count: int, note: string}>  $unknowns
     * @return array<string, mixed>|null
     */
    private function workshopSection(
        string $clinicId,
        array $permissions,
        ReportPeriod $period,
        ReportPeriod $previousPeriod,
        CarbonImmutable $now,
        array &$excluded,
        array &$unknowns,
    ): ?array {
        if (! Modules::isEnabled('workshop')) {
            $excluded[] = ['section' => 'WORKSHOP', 'reason' => 'MODULE_DISABLED', 'detail' => 'Le module atelier n\'est pas activé.'];

            return null;
        }
        if (! in_array('workshop.manage', $permissions, true)) {
            $excluded[] = ['section' => 'WORKSHOP', 'reason' => 'PERMISSION_MISSING', 'detail' => 'Le suivi atelier requiert la permission workshop.manage.'];

            return null;
        }

        $createdCurrent = DB::table('workshop_orders')
            ->where('clinic_id', $clinicId)
            ->where('status', '<>', 'CANCELLED')
            ->where('ordered_at', '>=', $period->start)
            ->where('ordered_at', '<', $period->end)
            ->count();
        $createdPrevious = DB::table('workshop_orders')
            ->where('clinic_id', $clinicId)
            ->where('status', '<>', 'CANCELLED')
            ->where('ordered_at', '>=', $previousPeriod->start)
            ->where('ordered_at', '<', $previousPeriod->end)
            ->count();

        $readyOrDelivered = static fn (ReportPeriod $p): int => (int) DB::table('workshop_events')
            ->where('clinic_id', $clinicId)
            ->whereIn('new_status', ['READY', 'DELIVERED'])
            ->where('occurred_at', '>=', $p->start)
            ->where('occurred_at', '<', $p->end)
            ->distinct()
            ->count('workshop_order_id');

        $nowSql = $now->utc()->format('Y-m-d H:i:s.v');
        $allOrders = DB::table('workshop_orders')
            ->where('clinic_id', $clinicId)
            ->get(['status', 'expected_at', 'frame_item_id']);

        $openTotal = 0;
        $overdueOpen = 0;
        $unknownExpected = 0;
        $withoutFrame = 0;
        $byStatusCount = array_fill_keys(self::WORKSHOP_STATUS_ORDER, ['count' => 0, 'overdue' => 0]);

        foreach ($allOrders as $order) {
            $st = (string) $order->status;
            if (! isset($byStatusCount[$st])) {
                $byStatusCount[$st] = ['count' => 0, 'overdue' => 0];
            }
            $byStatusCount[$st]['count']++;

            if (in_array($st, self::WORKSHOP_OPEN_STATUSES, true)) {
                $openTotal++;
                if ($order->expected_at === null) {
                    $unknownExpected++;
                } elseif ((string) $order->expected_at < $nowSql) {
                    $overdueOpen++;
                    $byStatusCount[$st]['overdue']++;
                }
                if ($order->frame_item_id === null) {
                    $withoutFrame++;
                }
            }
        }

        if ($unknownExpected > 0) {
            $unknowns[] = [
                'domain' => 'WORKSHOP',
                'code' => 'workshop_unknown_expected_date',
                'label' => 'Ordres atelier ouverts sans date de disponibilité prévue',
                'count' => $unknownExpected,
                'note' => 'Ces ordres ne peuvent pas être classés à temps ou en retard sans expected_at.',
            ];
        }

        return [
            'created_count' => $this->compareCount($createdCurrent, $createdPrevious),
            'delivered_or_ready_count' => $this->compareCount($readyOrDelivered($period), $readyOrDelivered($previousPeriod)),
            'open_total' => $openTotal,
            'overdue_open_count' => $overdueOpen,
            'unknown_expected_date_count' => $unknownExpected,
            'orders_without_frame_item_count' => $withoutFrame,
            'reworks_in_period' => DB::table('workshop_events')
                ->where('clinic_id', $clinicId)
                ->where('event_type', 'REWORK')
                ->where('occurred_at', '>=', $period->start)
                ->where('occurred_at', '<', $period->end)
                ->count(),
            'failed_qc_in_period' => DB::table('workshop_events')
                ->where('clinic_id', $clinicId)
                ->where('quality_result', 'FAILED')
                ->where('occurred_at', '>=', $period->start)
                ->where('occurred_at', '<', $period->end)
                ->count(),
            'by_status' => array_map(
                static fn (string $st): array => [
                    'status' => $st,
                    'count' => $byStatusCount[$st]['count'],
                    'overdue_count' => $byStatusCount[$st]['overdue'],
                ],
                self::WORKSHOP_STATUS_ORDER,
            ),
        ];
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<array{section: string, reason: string, detail: string}>  $excluded
     * @param  list<array{domain: string, code: string, label: string, count: int, note: string}>  $unknowns
     * @return array<string, mixed>|null
     */
    private function patientsSection(
        string $clinicId,
        string $timezone,
        array $permissions,
        ReportPeriod $period,
        ReportPeriod $previousPeriod,
        array &$excluded,
        array &$unknowns,
    ): ?array {
        if (! in_array('statistics.activity', $permissions, true)) {
            $excluded[] = ['section' => 'PATIENTS', 'reason' => 'PERMISSION_MISSING', 'detail' => 'L\'activité patients requiert la permission statistics.activity.'];

            return null;
        }

        $curr = $this->activityReports->activity($clinicId, $timezone, $period->from, $period->to);
        $prev = $this->activityReports->activity($clinicId, $timezone, $previousPeriod->from, $previousPeriod->to);

        $row = DB::table('patient_records')
            ->where('clinic_id', $clinicId)
            ->whereNull('archived_at')
            ->whereNull('merged_into_patient_id')
            ->selectRaw("
                COUNT(*) AS total_active,
                SUM(CASE WHEN birth_date IS NULL THEN 1 ELSE 0 END) AS birth_unknown,
                SUM(CASE WHEN sex = 'UNKNOWN' THEN 1 ELSE 0 END) AS sex_unknown,
                SUM(CASE WHEN phone_primary IS NULL OR phone_primary = '' THEN 1 ELSE 0 END) AS phone_unknown,
                SUM(CASE WHEN address IS NULL OR address = '' THEN 1 ELSE 0 END) AS address_unknown
            ")
            ->first();

        $birthUnknown = (int) ($row->birth_unknown ?? 0);
        $sexUnknown = (int) ($row->sex_unknown ?? 0);
        $phoneUnknown = (int) ($row->phone_unknown ?? 0);
        $addressUnknown = (int) ($row->address_unknown ?? 0);

        if ($birthUnknown > 0 || $sexUnknown > 0) {
            $unknowns[] = [
                'domain' => 'PATIENTS',
                'code' => 'patients_incomplete_identity',
                'label' => 'Dossiers patients à identité partielle (naissance ou sexe)',
                'count' => max($birthUnknown, $sexUnknown),
                'note' => sprintf('Naissance inconnue : %d | Sexe inconnu : %d | Sans téléphone : %d.', $birthUnknown, $sexUnknown, $phoneUnknown),
            ];
        }

        return [
            'visits_count' => $this->compareCount((int) $curr['visits'], (int) $prev['visits']),
            'distinct_patients' => $this->compareCount((int) $curr['patients'], (int) $prev['patients']),
            'new_patients' => $this->compareCount((int) $curr['new_patients'], (int) $prev['new_patients']),
            'returning_patients' => $this->compareCount((int) $curr['returning_patients'], (int) $prev['returning_patients']),
            'visits_by_reason' => $curr['visits_by_reason'],
            'incomplete_identity' => [
                'total_active_patients' => (int) ($row->total_active ?? 0),
                'birth_date_unknown' => $birthUnknown,
                'sex_unknown' => $sexUnknown,
                'phone_unknown' => $phoneUnknown,
                'address_unknown' => $addressUnknown,
            ],
        ];
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<array{section: string, reason: string, detail: string}>  $excluded
     * @param  list<array{domain: string, code: string, label: string, count: int, note: string}>  $unknowns
     * @return array<string, mixed>|null
     */
    private function clinicalSection(
        string $clinicId,
        string $timezone,
        array $permissions,
        ReportPeriod $period,
        ReportPeriod $previousPeriod,
        array &$excluded,
        array &$unknowns,
    ): ?array {
        if (! in_array('statistics.clinical', $permissions, true)) {
            $excluded[] = ['section' => 'CLINICAL', 'reason' => 'PERMISSION_MISSING', 'detail' => 'Les indicateurs cliniques requièrent la permission statistics.clinical.'];

            return null;
        }

        $curr = $this->activityReports->clinical($clinicId, $timezone, $period->from, $period->to);
        $prev = $this->activityReports->clinical($clinicId, $timezone, $previousPeriod->from, $previousPeriod->to);

        [$start, $end] = [DayWindow::utc($period->from, $timezone)[0], DayWindow::utc($period->to, $timezone)[1]];

        $withoutAcuity = DB::table('consultations as c')
            ->where('c.clinic_id', $clinicId)
            ->where('c.effective_at', '>=', $start)
            ->where('c.effective_at', '<', $end)
            ->whereNotExists(static function ($q): void {
                $q->select(DB::raw(1))->from('visual_acuities as va')->whereColumn('va.clinic_id', 'c.clinic_id')->whereColumn('va.consultation_id', 'c.id');
            })
            ->count();

        $withoutRefraction = DB::table('consultations as c')
            ->where('c.clinic_id', $clinicId)
            ->where('c.effective_at', '>=', $start)
            ->where('c.effective_at', '<', $end)
            ->whereNotExists(static function ($q): void {
                $q->select(DB::raw(1))->from('refraction_measurements as rm')->whereColumn('rm.clinic_id', 'c.clinic_id')->whereColumn('rm.consultation_id', 'c.id');
            })
            ->count();

        $withoutAmetropia = DB::table('consultations as c')
            ->where('c.clinic_id', $clinicId)
            ->where('c.effective_at', '>=', $start)
            ->where('c.effective_at', '<', $end)
            ->whereNotExists(static function ($q): void {
                $q->select(DB::raw(1))->from('consultation_ametropias as ca')->whereColumn('ca.clinic_id', 'c.clinic_id')->whereColumn('ca.consultation_id', 'c.id');
            })
            ->count();

        $completedCurr = (int) $curr['consultations_completed'];
        $prescCurr = (int) $curr['prescriptions_validated'];
        $rateBps = $completedCurr > 0 ? min(10000, self::pctBps($prescCurr, $completedCurr) ?? 0) : 0;

        $withoutComplaint = (int) $curr['consultations_without_complaint'];
        $referralUnknown = (int) $curr['referral_unknown'];
        if ($withoutAcuity > 0 || $withoutRefraction > 0 || $withoutAmetropia > 0) {
            $unknowns[] = [
                'domain' => 'CLINICAL',
                'code' => 'clinical_incomplete_consultations',
                'label' => 'Consultations sans mesure d\'acuité, réfraction ou amétropie',
                'count' => max($withoutAcuity, $withoutRefraction, $withoutAmetropia),
                'note' => sprintf('Sans acuité : %d | Sans réfraction : %d | Sans amétropie : %d | Sans motif : %d.', $withoutAcuity, $withoutRefraction, $withoutAmetropia, $withoutComplaint),
            ];
        }

        return [
            'consultations_completed' => $this->compareCount($completedCurr, (int) $prev['consultations_completed']),
            'optical_prescriptions_issued' => $this->compareCount($prescCurr, (int) $prev['prescriptions_validated']),
            'prescriptions_rate_bps' => $rateBps,
            'medication_orders_count' => (int) $curr['medication_orders'],
            'referrals_count' => (int) $curr['referrals'],
            'incomplete_clinical_data' => [
                'without_complaint' => $withoutComplaint,
                'without_acuity' => $withoutAcuity,
                'without_refraction' => $withoutRefraction,
                'without_ametropia' => $withoutAmetropia,
                'referral_unknown' => $referralUnknown,
            ],
            'by_ametropia' => array_map(
                static fn (array $row): array => ['code' => $row['term_code'], 'count' => $row['count']],
                $curr['ametropias'],
            ),
        ];
    }

    /**
     * @return array{current: int, previous: int, delta: int, delta_pct_bps: int|null}
     */
    private function compareCount(int $current, int $previous): array
    {
        $delta = $current - $previous;

        return [
            'current' => $current,
            'previous' => $previous,
            'delta' => $delta,
            'delta_pct_bps' => self::pctBps($delta, $previous),
        ];
    }

    /**
     * @return array{current: int, previous: int, delta: int, delta_pct_bps: int|null}
     */
    private function compareMoney(int $current, int $previous): array
    {
        $delta = $current - $previous;

        return [
            'current' => $current,
            'previous' => $previous,
            'delta' => $delta,
            'delta_pct_bps' => self::pctBps($delta, abs($previous)),
        ];
    }

    private static function pctBps(int $delta, int $denominator): ?int
    {
        if ($denominator <= 0) {
            return null;
        }
        $scaled = BigInteger::of(abs($delta))
            ->multipliedBy(10000)
            ->plus(intdiv($denominator, 2))
            ->quotient($denominator)
            ->toInt();

        return $delta < 0 ? -$scaled : $scaled;
    }

    /**
     * @return list<array{code: string, domain: string, label: string, formula: string, denominator: string, exclusion_note: string}>
     */
    private function definitions(bool $finance, bool $stock, bool $valuation, bool $workshop, bool $patients, bool $clinical): array
    {
        $defs = [];
        if ($finance) {
            $defs[] = [
                'code' => 'net_revenue',
                'domain' => 'FINANCE',
                'label' => 'Chiffre d\'affaires net',
                'formula' => 'SUM(factures NATIVE ISSUED) - SUM(avoirs ISSUED) dans [from, to] au fuseau cabinet',
                'denominator' => 'Période civile comparable N-1 de même durée',
                'exclusion_note' => 'Exclut les devis (avant-vente), les brouillons, et les reprises papier LEGACY_BALANCE.',
            ];
            $defs[] = [
                'code' => 'net_collections',
                'domain' => 'FINANCE',
                'label' => 'Encaissements nets',
                'formula' => 'Paiements confirmés - Contre-écritures - Remboursements sur la période',
                'denominator' => 'Période civile comparable N-1 de même durée',
                'exclusion_note' => 'Inclut les règlements sur créances papier sans les transformer en chiffre d\'affaires.',
            ];
        }
        if ($stock) {
            $defs[] = [
                'code' => 'stock_positions',
                'domain' => 'STOCK',
                'label' => $valuation ? 'Valorisation au coût d\'achat connu et état stock' : 'Quantités et alertes stock (sans valorisation)',
                'formula' => $valuation ? 'SUM(quantite_disponible * unit_cost_ou_purchase_cost) arrondi demi supérieur XAF' : 'Agrégation des positions > 0 par entrepôt et catégorie',
                'denominator' => 'Instant de lecture (photographie temps réel)',
                'exclusion_note' => 'Coût manquant comptabilisé dans unknown_cost_positions, jamais assimilé à zéro XAF.',
            ];
        }
        if ($workshop) {
            $defs[] = [
                'code' => 'workshop_flow',
                'domain' => 'WORKSHOP',
                'label' => 'Production et retards atelier',
                'formula' => 'Ordres non annulés créés sur [from, to] ; retards = ouverts avec expected_at < maintenant',
                'denominator' => 'Période civile N-1 pour les flux créés/livrés',
                'exclusion_note' => 'Ordres sans expected_at comptés dans unknown_expected_date_count, jamais supposés à temps.',
            ];
        }
        if ($patients) {
            $defs[] = [
                'code' => 'patient_activity',
                'domain' => 'PATIENTS',
                'label' => 'Fréquentation et nouveaux patients',
                'formula' => 'Visites non annulées ; nouveau = première visite connue dans [from, to]',
                'denominator' => 'Période civile comparable N-1 de même durée',
                'exclusion_note' => 'Patients archivés, fusionnés ou à identité incomplète signalés séparément.',
            ];
        }
        if ($clinical) {
            $defs[] = [
                'code' => 'clinical_yield',
                'domain' => 'CLINICAL',
                'label' => 'Consultations et taux de prescription',
                'formula' => '(Prescriptions optiques internes validées / Consultations clôturées) * 10000 bps',
                'denominator' => 'Consultations clôturées sur la période (0 bps si 0)',
                'exclusion_note' => 'Aucune moyenne d\'acuités visuelles (échelles hétérogènes) ; mesures manquantes listées.',
            ];
        }

        return $defs;
    }

    /**
     * @param  list<list<int|string|null>>  $rows
     * @param  array{current: int, previous: int, delta: int, delta_pct_bps: int|null}  $metric
     */
    private function appendComparisonCsv(array &$rows, string $type, string $domain, string $label, array $metric, string $unit): void
    {
        $pct = $metric['delta_pct_bps'] === null ? 'N/D' : number_format($metric['delta_pct_bps'] / 100, 2, '.', '').'%';
        $rows[] = [$type, $domain, $label, $metric['current'], $metric['previous'], $metric['delta'], $pct, $unit];
    }

    private static function csvCell(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (is_int($value)) {
            return (string) $value;
        }
        $text = (string) $value;
        if ($text !== '' && in_array($text[0], ['=', '+', '@', "\t", "\r"], true)) {
            $text = "'".$text;
        } elseif (str_starts_with($text, '-') && preg_match('/^-[0-9]+(\.[0-9]+)?%?\z/', $text) !== 1) {
            $text = "'".$text;
        }
        if (str_contains($text, ';') || str_contains($text, '"') || str_contains($text, "\n") || str_contains($text, "\r")) {
            return '"'.str_replace('"', '""', $text).'"';
        }

        return $text;
    }
}

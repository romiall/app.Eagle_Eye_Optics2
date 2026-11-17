<?php

namespace App\Domain\Workshop;

use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use App\Domain\Workshop\Rules\WorkshopOrderRules;
use App\Http\Resources\WorkshopPresenter;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures de l'atelier optique (L1D04) : liste paginée, détail complet avec yeux/journal/remises admissibles,
 * lignes facturées admissibles, prescriptions validées associées, laboratoires et montures actifs.
 */
final class WorkshopOrders
{
    public const PER_PAGE = 25;

    /**
     * @return array{page: LengthAwarePaginator<int, stdClass>, rows: list<array<string, mixed>>}
     */
    public function page(
        string $clinicId,
        mixed $status,
        mixed $overdue,
        mixed $patientId,
        mixed $supplierId,
        mixed $page,
        CarbonImmutable $now,
    ): array {
        $nowSql = $now->format('Y-m-d H:i:s.u');
        $nowIso = $now->format('Y-m-d\TH:i:s.v\Z');

        $query = DB::table('workshop_orders as wo')
            ->join('suppliers as s', static fn ($join) => $join->on('s.id', '=', 'wo.supplier_id')->on('s.clinic_id', '=', 'wo.clinic_id'))
            ->join('patient_records as p', static fn ($join) => $join->on('p.id', '=', 'wo.patient_id')->on('p.clinic_id', '=', 'wo.clinic_id'))
            ->join('invoice_lines as il', static fn ($join) => $join->on('il.id', '=', 'wo.invoice_line_id')->on('il.clinic_id', '=', 'wo.clinic_id'))
            ->join('invoices as i', static fn ($join) => $join->on('i.id', '=', 'il.invoice_id')->on('i.clinic_id', '=', 'il.clinic_id'))
            ->join('optical_prescriptions as op', static fn ($join) => $join->on('op.id', '=', 'wo.prescription_id')->on('op.clinic_id', '=', 'wo.clinic_id'))
            ->leftJoin('catalog_items as f', static fn ($join) => $join->on('f.id', '=', 'wo.frame_item_id')->on('f.clinic_id', '=', 'wo.clinic_id'))
            ->where('wo.clinic_id', $clinicId);

        if (is_string($status) && trim($status) !== '') {
            $query->where('wo.status', trim($status));
        }

        if (in_array($overdue, ['1', 'true', true, 1], true)) {
            $query->whereNotIn('wo.status', WorkshopOrderRules::TERMINAL_STATUSES)
                ->whereNotNull('wo.expected_at')
                ->where('wo.expected_at', '<', $nowSql);
        }

        if (is_string($patientId) && trim($patientId) !== '') {
            $query->where('wo.patient_id', trim($patientId));
        }

        if (is_string($supplierId) && trim($supplierId) !== '') {
            $query->where('wo.supplier_id', trim($supplierId));
        }

        $pageNo = is_numeric($page) ? max(1, (int) $page) : 1;

        /** @var LengthAwarePaginator<int, stdClass> $paginator */
        $paginator = $query
            ->orderByDesc('wo.ordered_at')
            ->orderByDesc('wo.id')
            ->select([
                'wo.*',
                's.name as supplier_name',
                'p.record_number as patient_record_number',
                'p.last_name as patient_last_name',
                'p.first_names as patient_first_names',
                'il.invoice_id',
                'il.description_snapshot as invoice_line_description',
                'i.number as invoice_number',
                'op.version_no as prescription_version_no',
                'f.reference as catalog_frame_reference',
            ])
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNo);

        /** @var list<stdClass> $items */
        $items = array_values($paginator->items());
        $orderIds = array_map(static fn (stdClass $row): string => (string) $row->id, $items);

        $documents = $this->latestDocuments($clinicId, $orderIds);
        $frameReferences = $this->frameReferenceByOrder($clinicId, $orderIds);

        $rows = array_map(
            static function (stdClass $row) use ($documents, $frameReferences, $nowIso): array {
                $id = (string) $row->id;
                $frameRef = $row->catalog_frame_reference !== null
                    ? (string) $row->catalog_frame_reference
                    : ($frameReferences[$id] ?? null);

                return WorkshopPresenter::summary($row, $frameRef, $documents[$id] ?? null, $nowIso);
            },
            $items,
        );

        return ['page' => $paginator, 'rows' => $rows];
    }

    /**
     * @return ?array<string, mixed>
     */
    public function findDetail(string $clinicId, string $id, CarbonImmutable $now): ?array
    {
        $row = DB::table('workshop_orders as wo')
            ->join('suppliers as s', static fn ($join) => $join->on('s.id', '=', 'wo.supplier_id')->on('s.clinic_id', '=', 'wo.clinic_id'))
            ->join('patient_records as p', static fn ($join) => $join->on('p.id', '=', 'wo.patient_id')->on('p.clinic_id', '=', 'wo.clinic_id'))
            ->join('invoice_lines as il', static fn ($join) => $join->on('il.id', '=', 'wo.invoice_line_id')->on('il.clinic_id', '=', 'wo.clinic_id'))
            ->join('invoices as i', static fn ($join) => $join->on('i.id', '=', 'il.invoice_id')->on('i.clinic_id', '=', 'il.clinic_id'))
            ->join('optical_prescriptions as op', static fn ($join) => $join->on('op.id', '=', 'wo.prescription_id')->on('op.clinic_id', '=', 'wo.clinic_id'))
            ->leftJoin('users as u', static fn ($join) => $join->on('u.id', '=', 'wo.created_by')->on('u.clinic_id', '=', 'wo.clinic_id'))
            ->leftJoin('catalog_items as f', static fn ($join) => $join->on('f.id', '=', 'wo.frame_item_id')->on('f.clinic_id', '=', 'wo.clinic_id'))
            ->where('wo.clinic_id', $clinicId)
            ->where('wo.id', $id)
            ->select([
                'wo.*',
                's.name as supplier_name',
                's.reference as supplier_reference',
                's.phone as supplier_phone',
                's.email as supplier_email',
                'p.record_number as patient_record_number',
                'p.last_name as patient_last_name',
                'p.first_names as patient_first_names',
                'il.invoice_id',
                'il.description_snapshot as invoice_line_description',
                'i.number as invoice_number',
                'op.series_id as prescription_series_id',
                'op.version_no as prescription_version_no',
                'op.origin as prescription_origin',
                'op.validated_at as prescription_validated_at',
                'op.usage_code as prescription_usage_code',
                'op.lens_type_code as prescription_lens_type_code',
                'op.lens_index as prescription_lens_index',
                'op.pd_total as prescription_pd_total',
                'op.pd_od as prescription_pd_od',
                'op.pd_og as prescription_pd_og',
                'u.display_name as created_by_name',
                'f.reference as catalog_frame_reference',
                'f.name as catalog_frame_name',
                'f.brand as catalog_frame_brand',
                'f.model as catalog_frame_model',
            ])
            ->first();

        if ($row === null) {
            return null;
        }

        /** @var list<stdClass> $eyes */
        $eyes = DB::table('workshop_order_eyes')
            ->where('clinic_id', $clinicId)
            ->where('workshop_order_id', $id)
            ->orderByRaw("CASE eye WHEN 'OD' THEN 1 ELSE 2 END")
            ->get()
            ->all();

        /** @var list<stdClass> $events */
        $events = DB::table('workshop_events as we')
            ->leftJoin('users as u', static fn ($join) => $join->on('u.id', '=', 'we.actor_id')->on('u.clinic_id', '=', 'we.clinic_id'))
            ->where('we.clinic_id', $clinicId)
            ->where('we.workshop_order_id', $id)
            ->orderBy('we.sequence_no')
            ->select(['we.*', 'u.display_name as actor_name'])
            ->get()
            ->all();

        /** @var list<stdClass> $deliveryLines */
        $deliveryLines = DB::table('delivery_lines as dl')
            ->join('deliveries as d', static fn ($join) => $join->on('d.id', '=', 'dl.delivery_id')->on('d.clinic_id', '=', 'dl.clinic_id'))
            ->join('catalog_items as ci', static fn ($join) => $join->on('ci.id', '=', 'dl.item_id')->on('ci.clinic_id', '=', 'dl.clinic_id'))
            ->leftJoin('stock_lots as sl', static fn ($join) => $join->on('sl.id', '=', 'dl.stock_lot_id')->on('sl.clinic_id', '=', 'dl.clinic_id'))
            ->where('dl.clinic_id', $clinicId)
            ->where('dl.invoice_line_id', $row->invoice_line_id)
            ->where('d.status', 'CONFIRMED')
            ->whereNotNull('d.delivered_at')
            ->orderByDesc('d.delivered_at')
            ->orderBy('dl.id')
            ->select([
                'dl.delivery_id',
                'dl.id as delivery_line_id',
                'd.delivered_at',
                'dl.quantity',
                'ci.name as item_name',
                'sl.batch_number',
            ])
            ->get()
            ->all();

        $documents = $this->latestDocuments($clinicId, [$id]);
        $nowIso = $now->format('Y-m-d\TH:i:s.v\Z');

        return WorkshopPresenter::detail(
            $row,
            $eyes,
            $events,
            $deliveryLines,
            $documents[$id] ?? null,
            $nowIso,
        );
    }

    /**
     * Lignes facturées admissibles à une commande atelier (reliquat > 0), prescriptions validées correspondantes,
     * laboratoires optiques et montures actifs.
     *
     * @return array{
     *   lines: list<array<string, mixed>>,
     *   prescriptions: list<array<string, mixed>>,
     *   suppliers: list<array<string, mixed>>,
     *   frames: list<array<string, mixed>>
     * }
     */
    public function eligibleLines(string $clinicId, mixed $queryText, mixed $patientId): array
    {
        $lineQuery = DB::table('invoice_lines as il')
            ->join('invoices as i', static fn ($join) => $join->on('i.id', '=', 'il.invoice_id')->on('i.clinic_id', '=', 'il.clinic_id'))
            ->join('patient_records as p', static fn ($join) => $join->on('p.id', '=', 'i.patient_id')->on('p.clinic_id', '=', 'i.clinic_id'))
            ->where('il.clinic_id', $clinicId)
            ->where('i.status', 'ISSUED')
            ->whereNotIn('il.category_snapshot', ['SERVICE', 'COLLYRE', 'DERMOCOSMETIC']);

        if (is_string($patientId) && trim($patientId) !== '') {
            $lineQuery->where('i.patient_id', trim($patientId));
        }

        if (is_string($queryText) && trim($queryText) !== '') {
            $trimmed = trim($queryText);
            $rawLike = '%'.$this->escapeLike($trimmed).'%';
            $searchKey = Text::searchKey($trimmed);
            $searchLike = $searchKey !== '' ? '%'.$this->escapeLike($searchKey).'%' : $rawLike;

            $lineQuery->where(static function ($nested) use ($rawLike, $searchLike): void {
                $nested->where('p.record_number', 'like', $rawLike)
                    ->orWhere('p.name_search', 'like', $searchLike)
                    ->orWhere('i.number', 'like', $rawLike)
                    ->orWhere('il.description_snapshot', 'like', $rawLike)
                    ->orWhere('il.reference_snapshot', 'like', $rawLike);
            });
        }

        /** @var list<stdClass> $rawLines */
        $rawLines = $lineQuery
            ->orderByDesc('i.issued_at')
            ->orderBy('il.position')
            ->limit(200)
            ->select([
                'il.id as invoice_line_id',
                'il.invoice_id',
                'i.number as invoice_number',
                'i.issued_at',
                'il.description_snapshot as description',
                'il.catalog_item_id as item_id',
                'il.reference_snapshot as item_reference',
                'il.category_snapshot as category_code',
                'il.quantity',
                'il.prescription_id as linked_prescription_id',
                'p.id as patient_id',
                'p.record_number as patient_record_number',
                'p.last_name as patient_last_name',
                'p.first_names as patient_first_names',
            ])
            ->get()
            ->all();

        $lineIds = array_map(static fn (stdClass $line): string => (string) $line->invoice_line_id, $rawLines);
        $orderedByLine = $this->orderedUnitsByInvoiceLine($clinicId, $lineIds);

        $eligibleLines = [];
        $patientIds = [];
        if (is_string($patientId) && trim($patientId) !== '') {
            $patientIds[trim($patientId)] = true;
        }

        foreach ($rawLines as $line) {
            $lineQty = Quantity::of((string) $line->quantity, 'quantity');
            $orderedUnits = $orderedByLine[(string) $line->invoice_line_id] ?? 0;
            $orderedQty = FixedDecimal::fromUnits($orderedUnits, Quantity::SCALE);
            $remainingUnits = $lineQty->units - $orderedQty->units;
            if ($remainingUnits <= 0) {
                continue;
            }
            $remainingQty = FixedDecimal::fromUnits($remainingUnits, Quantity::SCALE);
            $eligibleLines[] = WorkshopPresenter::eligibleLine($line, $orderedQty->canonical(), $remainingQty->canonical());
            $patientIds[(string) $line->patient_id] = true;
        }

        $prescriptions = $this->validatedPrescriptionsForPatients($clinicId, array_keys($patientIds));

        /** @var list<stdClass> $suppliers */
        $suppliers = DB::table('suppliers')
            ->where('clinic_id', $clinicId)
            ->where('is_optical_lab', true)
            ->where('active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'reference', 'phone', 'email'])
            ->all();

        /** @var list<stdClass> $frames */
        $frames = DB::table('catalog_items')
            ->where('clinic_id', $clinicId)
            ->where('category_code', 'FRAME')
            ->where('active', true)
            ->orderBy('name')
            ->get(['id', 'reference', 'name', 'brand', 'model'])
            ->all();

        return [
            'lines' => $eligibleLines,
            'prescriptions' => $prescriptions,
            'suppliers' => array_map(WorkshopPresenter::eligibleSupplier(...), $suppliers),
            'frames' => array_map(WorkshopPresenter::eligibleFrame(...), $frames),
        ];
    }

    /**
     * Libellés du référentiel `clinical_terms` par code pour un groupe.
     *
     * @return array<string, string>
     */
    public function termLabels(string $groupCode): array
    {
        /** @var array<string, string> $labels */
        $labels = DB::table('clinical_terms')
            ->where('group_code', $groupCode)
            ->pluck('label', 'code')
            ->map(static fn (mixed $label): string => (string) $label)
            ->all();

        return $labels;
    }

    /**
     * Somme en millièmes (`Quantity::SCALE`) des commandes non annulées par `invoice_line_id`.
     *
     * @param  list<string>  $invoiceLineIds
     * @return array<string, int>
     */
    public function orderedUnitsByInvoiceLine(string $clinicId, array $invoiceLineIds): array
    {
        if ($invoiceLineIds === []) {
            return [];
        }

        $rows = DB::table('workshop_orders')
            ->where('clinic_id', $clinicId)
            ->whereIn('invoice_line_id', $invoiceLineIds)
            ->where('status', '!=', 'CANCELLED')
            ->get(['invoice_line_id', 'quantity']);

        $totals = [];
        foreach ($rows as $row) {
            $lineId = (string) $row->invoice_line_id;
            $qty = Quantity::of((string) $row->quantity, 'quantity');
            $totals[$lineId] = ($totals[$lineId] ?? 0) + $qty->units;
        }

        return $totals;
    }

    /**
     * @param  list<string>  $orderIds
     * @return array<string, stdClass>
     */
    private function latestDocuments(string $clinicId, array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        $rows = DB::table('generated_documents')
            ->where('clinic_id', $clinicId)
            ->where('document_type', 'WORKSHOP')
            ->whereIn('workshop_order_id', $orderIds)
            ->orderByDesc('revision_no')
            ->orderByDesc('created_at')
            ->get(['id', 'workshop_order_id', 'status']);

        $byOrder = [];
        foreach ($rows as $doc) {
            $orderId = (string) $doc->workshop_order_id;
            if (! isset($byOrder[$orderId])) {
                $byOrder[$orderId] = $doc;
            }
        }

        return $byOrder;
    }

    /**
     * @param  list<string>  $orderIds
     * @return array<string, ?string>
     */
    private function frameReferenceByOrder(string $clinicId, array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        $rows = DB::table('workshop_order_eyes')
            ->where('clinic_id', $clinicId)
            ->whereIn('workshop_order_id', $orderIds)
            ->orderByRaw("CASE eye WHEN 'OD' THEN 1 ELSE 2 END")
            ->get(['workshop_order_id', 'frame_reference_snapshot']);

        $refs = [];
        foreach ($rows as $row) {
            $orderId = (string) $row->workshop_order_id;
            if (! isset($refs[$orderId]) && $row->frame_reference_snapshot !== null) {
                $refs[$orderId] = (string) $row->frame_reference_snapshot;
            }
        }

        return $refs;
    }

    /**
     * @param  list<string>  $patientIds
     * @return list<array<string, mixed>>
     */
    private function validatedPrescriptionsForPatients(string $clinicId, array $patientIds): array
    {
        if ($patientIds === []) {
            return [];
        }

        /** @var list<stdClass> $prescriptions */
        $prescriptions = DB::table('optical_prescriptions')
            ->where('clinic_id', $clinicId)
            ->where('status', 'VALIDATED')
            ->whereIn('patient_id', $patientIds)
            ->orderByDesc('validated_at')
            ->orderByDesc('version_no')
            ->get()
            ->all();

        $ids = array_map(static fn (stdClass $p): string => (string) $p->id, $prescriptions);
        if ($ids === []) {
            return [];
        }

        $treatmentsByPrescription = [];
        foreach (
            DB::table('optical_prescription_treatments')
                ->where('clinic_id', $clinicId)
                ->whereIn('prescription_id', $ids)
                ->orderBy('term_code')
                ->get(['prescription_id', 'term_code', 'other_text']) as $treatment
        ) {
            $treatmentsByPrescription[(string) $treatment->prescription_id][] = [
                'term_code' => (string) $treatment->term_code,
                'other_text' => $treatment->other_text === null ? null : (string) $treatment->other_text,
            ];
        }

        $eyesByPrescription = [];
        foreach (
            DB::table('optical_prescription_eyes')
                ->where('clinic_id', $clinicId)
                ->whereIn('prescription_id', $ids)
                ->orderByRaw("CASE eye WHEN 'OD' THEN 1 ELSE 2 END")
                ->get(['prescription_id', 'eye', 'no_correction', 'sphere', 'cylinder', 'axis', 'addition', 'fitting_height']) as $eye
        ) {
            $eyesByPrescription[(string) $eye->prescription_id][] = [
                'eye' => (string) $eye->eye,
                'no_correction' => (bool) $eye->no_correction,
                'sphere' => $eye->sphere === null ? null : (string) $eye->sphere,
                'cylinder' => $eye->cylinder === null ? null : (string) $eye->cylinder,
                'axis' => $eye->axis === null ? null : (int) $eye->axis,
                'addition' => $eye->addition === null ? null : (string) $eye->addition,
                'fitting_height' => $eye->fitting_height === null ? null : (string) $eye->fitting_height,
            ];
        }

        return array_map(
            static fn (stdClass $row): array => WorkshopPresenter::eligiblePrescription(
                $row,
                $treatmentsByPrescription[(string) $row->id] ?? [],
                $eyesByPrescription[(string) $row->id] ?? [],
            ),
            $prescriptions,
        );
    }

    private function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}

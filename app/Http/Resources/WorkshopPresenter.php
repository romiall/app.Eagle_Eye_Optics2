<?php

namespace App\Http\Resources;

use App\Domain\Workshop\Rules\WorkshopOrderRules;
use Carbon\CarbonImmutable;
use stdClass;

/**
 * Mise en forme des commandes atelier et éléments d'ouverture pour l'API (`schemas/resources/workshop.json`, L1D04).
 * Les données financières de la facture (prix, remises, paiements) et les antécédents médicaux ne sortent jamais ici.
 */
final class WorkshopPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function summary(stdClass $row, ?string $frameReference, ?stdClass $document, string $nowIso): array
    {
        $status = (string) $row->status;
        $orderedAt = self::instant((string) $row->ordered_at);
        $expectedAt = $row->expected_at === null ? null : self::instant((string) $row->expected_at);
        $receivedAt = $row->received_at === null ? null : self::instant((string) $row->received_at);

        return [
            'id' => (string) $row->id,
            'reference' => (string) $row->reference,
            'lab_reference' => $row->lab_reference === null ? null : (string) $row->lab_reference,
            'status' => $status,
            'is_overdue' => WorkshopOrderRules::isOverdue($status, $expectedAt, $nowIso),
            'ordered_at' => $orderedAt,
            'expected_at' => $expectedAt,
            'received_at' => $receivedAt,
            'ready_revision' => (int) $row->ready_revision,
            'quantity' => (string) $row->quantity,
            'supplier_id' => (string) $row->supplier_id,
            'supplier_name' => (string) $row->supplier_name,
            'patient' => self::patient(
                (string) $row->patient_id,
                (string) $row->patient_record_number,
                (string) $row->patient_last_name,
                $row->patient_first_names === null ? null : (string) $row->patient_first_names,
            ),
            'invoice_line_id' => (string) $row->invoice_line_id,
            'invoice_id' => (string) $row->invoice_id,
            'invoice_number' => (string) $row->invoice_number,
            'invoice_line_description' => (string) $row->invoice_line_description,
            'prescription_id' => (string) $row->prescription_id,
            'prescription_version_no' => (int) $row->prescription_version_no,
            'frame_item_id' => $row->frame_item_id === null ? null : (string) $row->frame_item_id,
            'frame_reference' => $frameReference,
            'version' => (int) $row->version,
            'document' => $document === null ? null : [
                'document_id' => (string) $document->id,
                'document_status' => (string) $document->status,
            ],
        ];
    }

    /**
     * @param  list<stdClass>  $eyes
     * @param  list<stdClass>  $events
     * @param  list<stdClass>  $deliveryLines
     * @return array<string, mixed>
     */
    public static function detail(
        stdClass $row,
        array $eyes,
        array $events,
        array $deliveryLines,
        ?stdClass $document,
        string $nowIso,
    ): array {
        $frameRef = $row->catalog_frame_reference !== null
            ? (string) $row->catalog_frame_reference
            : ($eyes[0]->frame_reference_snapshot ?? null);

        $base = self::summary($row, $frameRef === null ? null : (string) $frameRef, $document, $nowIso);
        /** @var array<string, mixed> $snapshot */
        $snapshot = json_decode((string) $row->snapshot, true, 512, JSON_THROW_ON_ERROR);

        return [
            ...$base,
            'notes' => $row->notes === null ? null : (string) $row->notes,
            'created_by' => (string) $row->created_by,
            'created_by_name' => $row->created_by_name === null ? null : (string) $row->created_by_name,
            'patient_id' => (string) $row->patient_id,
            'prescription' => [
                'id' => (string) $row->prescription_id,
                'series_id' => (string) $row->prescription_series_id,
                'version_no' => (int) $row->prescription_version_no,
                'origin' => (string) $row->prescription_origin,
                'validated_at' => self::instant((string) $row->prescription_validated_at),
                'usage_code' => $row->prescription_usage_code === null ? null : (string) $row->prescription_usage_code,
                'lens_type_code' => $row->prescription_lens_type_code === null ? null : (string) $row->prescription_lens_type_code,
                'lens_index' => $row->prescription_lens_index === null ? null : (string) $row->prescription_lens_index,
                'pd_total' => $row->prescription_pd_total === null ? null : (string) $row->prescription_pd_total,
                'pd_od' => $row->prescription_pd_od === null ? null : (string) $row->prescription_pd_od,
                'pd_og' => $row->prescription_pd_og === null ? null : (string) $row->prescription_pd_og,
            ],
            'supplier' => [
                'id' => (string) $row->supplier_id,
                'name' => (string) $row->supplier_name,
                'reference' => (string) $row->supplier_reference,
                'phone' => $row->supplier_phone === null ? null : (string) $row->supplier_phone,
                'email' => $row->supplier_email === null ? null : (string) $row->supplier_email,
            ],
            'frame' => $row->frame_item_id === null ? null : [
                'id' => (string) $row->frame_item_id,
                'reference' => (string) $row->catalog_frame_reference,
                'name' => (string) $row->catalog_frame_name,
                'brand' => $row->catalog_frame_brand === null ? null : (string) $row->catalog_frame_brand,
                'model' => $row->catalog_frame_model === null ? null : (string) $row->catalog_frame_model,
            ],
            'eyes' => array_map(self::eye(...), $eyes),
            'events' => array_map(self::event(...), $events),
            'eligible_delivery_lines' => array_map(self::deliveryCandidate(...), $deliveryLines),
            'snapshot' => $snapshot,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function eligibleLine(stdClass $row, string $orderedQuantity, string $remainingQuantity): array
    {
        return [
            'invoice_line_id' => (string) $row->invoice_line_id,
            'invoice_id' => (string) $row->invoice_id,
            'invoice_number' => (string) $row->invoice_number,
            'issued_at' => self::instant((string) $row->issued_at),
            'description' => (string) $row->description,
            'item_id' => $row->item_id === null ? null : (string) $row->item_id,
            'item_reference' => $row->item_reference === null ? null : (string) $row->item_reference,
            'category_code' => $row->category_code === null ? null : (string) $row->category_code,
            'quantity' => (string) $row->quantity,
            'ordered_quantity' => $orderedQuantity,
            'remaining_quantity' => $remainingQuantity,
            'linked_prescription_id' => $row->linked_prescription_id === null ? null : (string) $row->linked_prescription_id,
            'patient' => self::patient(
                (string) $row->patient_id,
                (string) $row->patient_record_number,
                (string) $row->patient_last_name,
                $row->patient_first_names === null ? null : (string) $row->patient_first_names,
            ),
        ];
    }

    /**
     * @param  list<array{term_code: string, other_text: ?string}>  $treatments
     * @param  list<array{eye: string, no_correction: bool, sphere: ?string, cylinder: ?string, axis: ?int, addition: ?string, fitting_height: ?string}>  $eyes
     * @return array<string, mixed>
     */
    public static function eligiblePrescription(stdClass $row, array $treatments, array $eyes): array
    {
        return [
            'id' => (string) $row->id,
            'patient_id' => (string) $row->patient_id,
            'series_id' => (string) $row->series_id,
            'version_no' => (int) $row->version_no,
            'origin' => (string) $row->origin,
            'validated_at' => self::instant((string) $row->validated_at),
            'usage_code' => $row->usage_code === null ? null : (string) $row->usage_code,
            'usage_other' => $row->usage_other === null ? null : (string) $row->usage_other,
            'lens_type_code' => $row->lens_type_code === null ? null : (string) $row->lens_type_code,
            'lens_type_other' => $row->lens_type_other === null ? null : (string) $row->lens_type_other,
            'lens_index' => $row->lens_index === null ? null : (string) $row->lens_index,
            'pd_total' => $row->pd_total === null ? null : (string) $row->pd_total,
            'pd_od' => $row->pd_od === null ? null : (string) $row->pd_od,
            'pd_og' => $row->pd_og === null ? null : (string) $row->pd_og,
            'treatments' => $treatments,
            'eyes' => $eyes,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function eligibleSupplier(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'reference' => (string) $row->reference,
            'phone' => $row->phone === null ? null : (string) $row->phone,
            'email' => $row->email === null ? null : (string) $row->email,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function eligibleFrame(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'reference' => (string) $row->reference,
            'name' => (string) $row->name,
            'brand' => $row->brand === null ? null : (string) $row->brand,
            'model' => $row->model === null ? null : (string) $row->model,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function patient(string $id, string $recordNumber, string $lastName, ?string $firstNames): array
    {
        return [
            'id' => $id,
            'record_number' => $recordNumber,
            'last_name' => $lastName,
            'first_names' => $firstNames,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function eye(stdClass $row): array
    {
        /** @var list<mixed> $treatments */
        $treatments = json_decode((string) $row->treatments_snapshot, true, 512, JSON_THROW_ON_ERROR);

        return [
            'id' => (string) $row->id,
            'eye' => (string) $row->eye,
            'sphere' => $row->sphere === null ? null : (string) $row->sphere,
            'cylinder' => $row->cylinder === null ? null : (string) $row->cylinder,
            'axis' => $row->axis === null ? null : (int) $row->axis,
            'addition' => $row->addition === null ? null : (string) $row->addition,
            'pd' => $row->pd === null ? null : (string) $row->pd,
            'fitting_height' => $row->fitting_height === null ? null : (string) $row->fitting_height,
            'lens_type' => (string) $row->lens_type,
            'lens_index' => $row->lens_index === null ? null : (string) $row->lens_index,
            'treatments_snapshot' => array_map(static fn (mixed $v): string => (string) $v, $treatments),
            'frame_reference_snapshot' => $row->frame_reference_snapshot === null ? null : (string) $row->frame_reference_snapshot,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function event(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'sequence_no' => (int) $row->sequence_no,
            'event_type' => (string) $row->event_type,
            'previous_status' => $row->previous_status === null ? null : (string) $row->previous_status,
            'new_status' => $row->new_status === null ? null : (string) $row->new_status,
            'quality_result' => (string) $row->quality_result,
            'observations' => $row->observations === null ? null : (string) $row->observations,
            'occurred_at' => self::instant((string) $row->occurred_at),
            'actor_id' => (string) $row->actor_id,
            'actor_name' => $row->actor_name === null ? null : (string) $row->actor_name,
            'delivery_line_id' => $row->delivery_line_id === null ? null : (string) $row->delivery_line_id,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function deliveryCandidate(stdClass $row): array
    {
        return [
            'delivery_id' => (string) $row->delivery_id,
            'delivery_line_id' => (string) $row->delivery_line_id,
            'delivered_at' => self::instant((string) $row->delivered_at),
            'quantity' => (string) $row->quantity,
            'item_name' => (string) $row->item_name,
            'batch_number' => $row->batch_number === null ? null : (string) $row->batch_number,
        ];
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

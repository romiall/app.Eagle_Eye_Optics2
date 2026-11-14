<?php

namespace App\Domain\Workshop\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Contracts\ContractValidator;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\Numbering\NumberUsages;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Billing\Snapshots\InvoiceSnapshots;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use App\Domain\Workshop\Rules\WorkshopOrderRules;
use App\Domain\Workshop\WorkshopNumbers;
use App\Domain\Workshop\WorkshopOrders;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Création d'une commande atelier optique + bon laboratoire anonymisé figé (L1D04, EE028, AT31).
 *
 * Exécutée EN LIGNE sur le chemin central : numéro central `WORKSHOP` (dans `document_number_usages`), snapshot
 * strictement anonymisé pour le laboratoire (aucun nom de patient, aucun antécédent médical, aucun prix), figement
 * des verres OD/OG depuis la version précise de la prescription validée, journal append-only et génération PDF
 * `WORKSHOP` en attente.
 *
 * Verrous : cabinet (10), idempotence (20), séquence WORKSHOP (40), dossier patient (45), facture (60).
 */
final class CreateWorkshopOrderHandler implements CommandHandler
{
    public const COMMAND = 'CreateWorkshopOrder';

    public const REQUEST_SCHEMA = 'schemas/requests/http.json#/$defs/CreateWorkshopOrderRequest';

    private const EXCLUDED_CATEGORIES = ['SERVICE', 'COLLYRE', 'DERMOCOSMETIC'];

    public function __construct(
        private readonly ContractValidator $contracts,
        private readonly WorkshopOrders $orders,
    ) {}

    public function permissions(): array
    {
        return ['workshop.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $schemaPayload = array_key_exists('expected_version', $command->payload)
            ? $command->payload
            : ($command->payload + ['expected_version' => $command->expectedVersion]);
        $this->contracts->assertCommandPayload(self::REQUEST_SCHEMA, $schemaPayload);
        $payload = $command->payload;

        if (($schemaPayload['expected_version'] ?? null) !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null à la création.']]);
        }

        $orderId = $command->entityId ?? Ulid::generate();
        $invoiceLineId = (string) $payload['invoice_line_id'];
        $prescriptionId = (string) $payload['prescription_id'];
        $supplierId = (string) $payload['supplier_id'];
        $frameItemId = isset($payload['frame_item_id']) && is_string($payload['frame_item_id']) ? $payload['frame_item_id'] : null;

        $peekLine = DB::table('invoice_lines as il')
            ->join('invoices as i', static fn ($j) => $j->on('i.id', '=', 'il.invoice_id')->on('i.clinic_id', '=', 'il.clinic_id'))
            ->where('il.clinic_id', $context->clinicId)
            ->where('il.id', $invoiceLineId)
            ->select(['il.id', 'il.invoice_id', 'il.patient_id', 'il.category_snapshot', 'i.status as invoice_status'])
            ->first();

        if ($peekLine === null) {
            throw BusinessError::validation(['invoice_line_id' => ['Ligne de facture introuvable dans ce cabinet.']]);
        }
        if ((string) $peekLine->invoice_status !== 'ISSUED') {
            throw BusinessError::stateRefused('Seule une facture émise (ISSUED) peut déclencher une commande atelier.', (string) $peekLine->invoice_status);
        }
        if (in_array((string) $peekLine->category_snapshot, self::EXCLUDED_CATEGORIES, true)) {
            throw BusinessError::validation(['invoice_line_id' => ['Cette ligne ne correspond pas à un équipement optique montable en atelier.']]);
        }

        $clinic = DB::table('clinics')->where('id', $context->clinicId)->first();
        if ($clinic === null) {
            throw BusinessError::notFound();
        }
        $timezone = trim((string) $clinic->timezone) !== '' ? (string) $clinic->timezone : 'Africa/Douala';
        $at = CarbonImmutable::now('UTC');
        $nowSql = $at->format('Y-m-d H:i:s.u');
        $nowIso = $at->format('Y-m-d\TH:i:s.v\Z');

        // Ordre strict des verrous : Sequence (40) -> Patient (45) -> Invoice (60).
        $number = WorkshopNumbers::allocate($locks, $context, $timezone, $at);
        $patientId = (string) $peekLine->patient_id;
        $invoiceId = (string) $peekLine->invoice_id;
        $locks->patient($patientId);
        $locks->invoice($invoiceId);

        $line = DB::table('invoice_lines as il')
            ->join('invoices as i', static fn ($j) => $j->on('i.id', '=', 'il.invoice_id')->on('i.clinic_id', '=', 'il.clinic_id'))
            ->join('patient_records as p', static fn ($j) => $j->on('p.id', '=', 'i.patient_id')->on('p.clinic_id', '=', 'i.clinic_id'))
            ->where('il.clinic_id', $context->clinicId)
            ->where('il.id', $invoiceLineId)
            ->select([
                'il.id',
                'il.invoice_id',
                'il.patient_id',
                'il.description_snapshot',
                'il.category_snapshot',
                'il.quantity',
                'i.number as invoice_number',
                'i.status as invoice_status',
                'p.record_number as patient_record_number',
            ])
            ->first();

        if ($line === null || (string) $line->invoice_status !== 'ISSUED') {
            throw BusinessError::stateRefused(
                'La facture n\'est plus émise.',
                $line === null ? 'UNKNOWN' : (string) $line->invoice_status,
            );
        }

        $errors = new FieldErrors;

        $requestedQty = null;
        try {
            $parsedQty = Quantity::parse((string) $payload['quantity'], 'quantity');
            if ($parsedQty === null) {
                $errors->add('quantity', 'La quantité est obligatoire.');
            } else {
                $requestedQty = Quantity::forLine($parsedQty, false, 'quantity');
            }
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }

        if ($requestedQty !== null) {
            $orderedByLine = $this->orders->orderedUnitsByInvoiceLine($context->clinicId, [$invoiceLineId]);
            $alreadyUnits = $orderedByLine[$invoiceLineId] ?? 0;
            $lineQty = Quantity::of((string) $line->quantity, 'quantity');
            $remainingUnits = $lineQty->units - $alreadyUnits;
            if ($requestedQty->units > $remainingUnits) {
                $remainingStr = FixedDecimal::fromUnits(max(0, $remainingUnits), Quantity::SCALE)->canonical();
                $errors->add('quantity', "La quantité demandée dépasse le reliquat disponible sur cette ligne ({$remainingStr}).");
            }
        }

        $prescription = DB::table('optical_prescriptions')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $prescriptionId)
            ->first();
        if ($prescription === null) {
            $errors->add('prescription_id', 'Prescription optique introuvable.');
        } else {
            if ((string) $prescription->patient_id !== $patientId) {
                $errors->add('prescription_id', 'La prescription n\'appartient pas au patient de la facture.');
            }
            if ((string) $prescription->status !== 'VALIDATED') {
                $errors->add('prescription_id', 'Seule une prescription optique validée (VALIDATED) peut être envoyée au laboratoire.');
            }
        }

        $supplier = DB::table('suppliers')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $supplierId)
            ->first();
        if ($supplier === null) {
            $errors->add('supplier_id', 'Laboratoire / fournisseur introuvable.');
        } elseif (! (bool) $supplier->is_optical_lab || ! (bool) $supplier->active) {
            $errors->add('supplier_id', 'Le fournisseur choisi n\'est pas un laboratoire optique actif.');
        }

        $frame = null;
        if ($frameItemId !== null) {
            $frame = DB::table('catalog_items')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $frameItemId)
                ->first();
            if ($frame === null) {
                $errors->add('frame_item_id', 'Monture introuvable au catalogue.');
            } elseif ((string) $frame->category_code !== 'FRAME' || ! (bool) $frame->active) {
                $errors->add('frame_item_id', 'L\'article sélectionné n\'est pas une monture active du catalogue.');
            }
        }

        $labReference = null;
        $notes = null;
        $manualFrameRef = null;
        $manualLensType = null;
        $expectedAtSql = null;
        $expectedAtIso = null;

        try {
            $labReference = Text::optional(is_string($payload['lab_reference'] ?? null) ? $payload['lab_reference'] : null, 100, 'lab_reference');
            $notes = Text::optional(is_string($payload['notes'] ?? null) ? $payload['notes'] : null, 5000, 'notes');
            $manualFrameRef = Text::optional(is_string($payload['frame_reference_snapshot'] ?? null) ? $payload['frame_reference_snapshot'] : null, 100, 'frame_reference_snapshot');
            $manualLensType = Text::optional(is_string($payload['lens_type'] ?? null) ? $payload['lens_type'] : null, 100, 'lens_type');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }

        if (isset($payload['expected_at']) && is_string($payload['expected_at']) && trim($payload['expected_at']) !== '') {
            try {
                $expectedAt = Instant::parse($payload['expected_at'], 'expected_at');
                if ($expectedAt !== null) {
                    $expectedAtSql = CarbonImmutable::createFromTimestampMsUTC($expectedAt->epochMilliseconds)->format('Y-m-d H:i:s.u');
                    $expectedAtIso = $expectedAt->toString();
                }
            } catch (RuleViolation $violation) {
                $errors->addViolation('', $violation);
            }
        }

        $pdOdOverride = WorkshopOrderRules::validatePositiveMeasure(
            isset($payload['pd_od']) && is_string($payload['pd_od']) ? $payload['pd_od'] : null,
            'pd_od',
            $errors,
        );
        $pdOgOverride = WorkshopOrderRules::validatePositiveMeasure(
            isset($payload['pd_og']) && is_string($payload['pd_og']) ? $payload['pd_og'] : null,
            'pd_og',
            $errors,
        );
        $fittingOdOverride = WorkshopOrderRules::validatePositiveMeasure(
            isset($payload['fitting_height_od']) && is_string($payload['fitting_height_od']) ? $payload['fitting_height_od'] : null,
            'fitting_height_od',
            $errors,
        );
        $fittingOgOverride = WorkshopOrderRules::validatePositiveMeasure(
            isset($payload['fitting_height_og']) && is_string($payload['fitting_height_og']) ? $payload['fitting_height_og'] : null,
            'fitting_height_og',
            $errors,
        );

        /** @var list<stdClass> $prescriptionEyes */
        $prescriptionEyes = [];
        if ($prescription !== null) {
            $prescriptionEyes = DB::table('optical_prescription_eyes')
                ->where('clinic_id', $context->clinicId)
                ->where('prescription_id', $prescriptionId)
                ->orderByRaw("CASE eye WHEN 'OD' THEN 1 ELSE 2 END")
                ->get()
                ->all();
            if ($prescriptionEyes === []) {
                $errors->add('prescription_id', 'La prescription sélectionnée ne contient aucune donnée OD/OG.');
            }
        }

        $lensTypeLabels = $this->orders->termLabels('LENS_TYPE');
        $usageLabels = $this->orders->termLabels('OPTICAL_USAGE');
        $treatmentLabels = $this->orders->termLabels('LENS_TREATMENT');

        $resolvedLensType = $manualLensType;
        if ($resolvedLensType === null && $prescription !== null) {
            $resolvedLensType = $this->resolveTermText(
                $prescription->lens_type_code === null ? null : (string) $prescription->lens_type_code,
                $prescription->lens_type_other === null ? null : (string) $prescription->lens_type_other,
                $lensTypeLabels,
                100,
            );
        }
        if ($resolvedLensType === null) {
            $errors->add('lens_type', 'Le type de verre est obligatoire pour le bon laboratoire.');
        }

        $errors->throwIfAny();

        if ($requestedQty === null || $prescription === null || $supplier === null || $resolvedLensType === null) {
            throw new \LogicException('Validation incomplète avant écriture.');
        }

        /** @var list<string> $treatments */
        $treatments = [];
        foreach (
            DB::table('optical_prescription_treatments')
                ->where('clinic_id', $context->clinicId)
                ->where('prescription_id', $prescriptionId)
                ->orderBy('term_code')
                ->get(['term_code', 'other_text']) as $treatment
        ) {
            $label = $this->resolveTermText(
                (string) $treatment->term_code,
                $treatment->other_text === null ? null : (string) $treatment->other_text,
                $treatmentLabels,
                180,
            );
            if ($label !== null) {
                $treatments[] = $label;
            }
        }

        $frameRefSnapshot = $manualFrameRef;
        if ($frameRefSnapshot === null && $frame !== null) {
            $brandPrefix = $frame->brand !== null && trim((string) $frame->brand) !== '' ? trim((string) $frame->brand).' ' : '';
            $candidate = trim((string) $frame->reference.' — '.$brandPrefix.(string) $frame->name);
            $frameRefSnapshot = mb_substr($candidate, 0, 100);
        }

        $lensIndex = $prescription->lens_index === null ? null : (string) $prescription->lens_index;
        $usageLabel = $this->resolveTermText(
            $prescription->usage_code === null ? null : (string) $prescription->usage_code,
            $prescription->usage_other === null ? null : (string) $prescription->usage_other,
            $usageLabels,
            180,
        );
        $lensIndexLabel = $lensIndex;
        if ($lensIndexLabel === null && $prescription->lens_index_other !== null && trim((string) $prescription->lens_index_other) !== '') {
            $lensIndexLabel = mb_substr(trim((string) $prescription->lens_index_other), 0, 180);
        }

        $eyeInserts = [];
        $snapshotEyes = [];
        foreach ($prescriptionEyes as $eyeRow) {
            $eyeCode = (string) $eyeRow->eye;
            $pd = $eyeCode === 'OD'
                ? ($pdOdOverride ?? ($prescription->pd_od === null ? null : (string) $prescription->pd_od))
                : ($pdOgOverride ?? ($prescription->pd_og === null ? null : (string) $prescription->pd_og));
            $fitting = $eyeCode === 'OD'
                ? ($fittingOdOverride ?? ($eyeRow->fitting_height === null ? null : (string) $eyeRow->fitting_height))
                : ($fittingOgOverride ?? ($eyeRow->fitting_height === null ? null : (string) $eyeRow->fitting_height));

            $eyeSpec = [
                'eye' => $eyeCode,
                'sphere' => $eyeRow->sphere === null ? null : (string) $eyeRow->sphere,
                'cylinder' => $eyeRow->cylinder === null ? null : (string) $eyeRow->cylinder,
                'axis' => $eyeRow->axis === null ? null : (int) $eyeRow->axis,
                'addition' => $eyeRow->addition === null ? null : (string) $eyeRow->addition,
                'pd' => $pd,
                'fitting_height' => $fitting,
                'lens_type' => $resolvedLensType,
                'lens_index' => $lensIndex,
                'treatments_snapshot' => $treatments,
                'frame_reference_snapshot' => $frameRefSnapshot,
            ];

            $snapshotEyes[] = $eyeSpec;
            $eyeInserts[] = [
                'id' => Ulid::generate(),
                'clinic_id' => $context->clinicId,
                'workshop_order_id' => $orderId,
                'eye' => $eyeCode,
                'sphere' => $eyeSpec['sphere'],
                'cylinder' => $eyeSpec['cylinder'],
                'axis' => $eyeSpec['axis'],
                'addition' => $eyeSpec['addition'],
                'pd' => $eyeSpec['pd'],
                'fitting_height' => $eyeSpec['fitting_height'],
                'lens_type' => $resolvedLensType,
                'lens_index' => $lensIndex,
                'treatments_snapshot' => json_encode($treatments, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                'frame_reference_snapshot' => $frameRefSnapshot,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ];
        }

        $actorName = (string) DB::table('users')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $context->actorId)
            ->value('display_name');
        if ($actorName === '') {
            $actorName = 'Opticien / Atelier';
        }

        // Snapshot anonymisé (L1D04, spec 11) : JAMAIS nom/téléphone patient, JAMAIS antécédents médicaux, JAMAIS prix.
        $snapshot = [
            'schema' => 1,
            'workshop_order_id' => $orderId,
            'reference' => $number['rendered'],
            'lab_reference' => $labReference,
            'ordered_at' => $nowIso,
            'expected_at' => $expectedAtIso,
            'quantity' => $requestedQty->canonical(),
            'notes' => $notes,
            'clinic' => InvoiceSnapshots::clinic($clinic),
            'patient' => [
                'patient_id' => $patientId,
                'record_number' => (string) $line->patient_record_number,
            ],
            'supplier' => [
                'supplier_id' => $supplierId,
                'name' => (string) $supplier->name,
                'reference' => (string) $supplier->reference,
                'phone' => $supplier->phone === null ? null : (string) $supplier->phone,
                'email' => $supplier->email === null ? null : (string) $supplier->email,
            ],
            'frame' => $frame === null ? null : [
                'frame_item_id' => (string) $frame->id,
                'reference' => (string) $frame->reference,
                'name' => (string) $frame->name,
                'brand' => $frame->brand === null ? null : (string) $frame->brand,
                'model' => $frame->model === null ? null : (string) $frame->model,
            ],
            'invoice_line' => [
                'invoice_id' => $invoiceId,
                'invoice_number' => (string) $line->invoice_number,
                'invoice_line_id' => $invoiceLineId,
                'description' => (string) $line->description_snapshot,
            ],
            'prescription' => [
                'prescription_id' => $prescriptionId,
                'series_id' => (string) $prescription->series_id,
                'version_no' => (int) $prescription->version_no,
                'origin' => (string) $prescription->origin,
                'validated_at' => CarbonImmutable::parse((string) $prescription->validated_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
                'external_prescriber' => $prescription->external_prescriber === null ? null : (string) $prescription->external_prescriber,
                'external_prescribed_on' => $prescription->external_prescribed_on === null ? null : (string) $prescription->external_prescribed_on,
                'usage_code' => $prescription->usage_code === null ? null : (string) $prescription->usage_code,
                'usage_label' => $usageLabel,
                'lens_type_code' => $prescription->lens_type_code === null ? null : (string) $prescription->lens_type_code,
                'lens_type_label' => $resolvedLensType,
                'lens_index' => $lensIndex,
                'lens_index_label' => $lensIndexLabel,
                'pd_total' => $prescription->pd_total === null ? null : (string) $prescription->pd_total,
                'pd_od' => $prescription->pd_od === null ? null : (string) $prescription->pd_od,
                'pd_og' => $prescription->pd_og === null ? null : (string) $prescription->pd_og,
                'pd_inconsistency_reason' => $prescription->pd_inconsistency_reason === null ? null : (string) $prescription->pd_inconsistency_reason,
                'notes' => $prescription->notes === null ? null : (string) $prescription->notes,
                'treatments' => $treatments,
                'eyes' => $snapshotEyes,
            ],
            'created_by' => [
                'user_id' => $context->actorId,
                'display_name' => $actorName,
            ],
            'template_version' => InvoiceSnapshots::isTestDocument($clinic) ? 'TEST-1' : '1',
        ];

        $snapshotViolations = $this->contracts->violations('snapshots/workshop-order.json', $snapshot);
        if ($snapshotViolations !== []) {
            throw new \LogicException('Snapshot atelier non conforme : '.json_encode($snapshotViolations, JSON_UNESCAPED_UNICODE));
        }

        DB::table('workshop_orders')->insert([
            'id' => $orderId,
            'clinic_id' => $context->clinicId,
            'patient_id' => $patientId,
            'invoice_line_id' => $invoiceLineId,
            'prescription_id' => $prescriptionId,
            'supplier_id' => $supplierId,
            'frame_item_id' => $frameItemId,
            'reference' => $number['rendered'],
            'lab_reference' => $labReference,
            'quantity' => $requestedQty->canonical(),
            'snapshot' => CanonicalJson::encode($snapshot),
            'ordered_at' => $nowSql,
            'expected_at' => $expectedAtSql,
            'received_at' => null,
            'status' => 'ORDERED',
            'ready_revision' => 0,
            'notes' => $notes,
            'created_by' => $context->actorId,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        DB::table('workshop_order_eyes')->insert($eyeInserts);

        DB::table('workshop_events')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $context->clinicId,
            'workshop_order_id' => $orderId,
            'sequence_no' => 1,
            'event_type' => 'STATUS_CHANGE',
            'previous_status' => null,
            'new_status' => 'ORDERED',
            'quality_result' => 'NOT_APPLICABLE',
            'observations' => $notes,
            'occurred_at' => $nowSql,
            'actor_id' => $context->actorId,
            'delivery_line_id' => null,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        NumberUsages::record($context, Ulid::generate(), 'WORKSHOP', $number, 'workshop_orders', $orderId, $at);
        $documentId = Ulid::generate();
        PendingDocuments::forWorkshop($context, $documentId, $orderId, $at);

        return new CommandOutcome(
            result: [
                'workshop_order_id' => $orderId,
                'reference' => $number['rendered'],
                'document_id' => $documentId,
            ],
            resultType: 'workshop_orders',
            resultId: $orderId,
            audit: [
                new AuditEntry('workshop_order.created', 'workshop_orders', $orderId, $notes, [
                    'reference' => $number['rendered'],
                    'invoice_line_id' => $invoiceLineId,
                    'prescription_id' => $prescriptionId,
                    'supplier_id' => $supplierId,
                ]),
            ],
            changes: [
                new ChangeRecord('workshop_orders', $orderId, 1, ChangeVisibility::Manager, ChangeKind::Created),
            ],
        );
    }

    /**
     * @param  array<string, string>  $labels
     */
    private function resolveTermText(?string $code, ?string $otherText, array $labels, int $maxLength): ?string
    {
        if ($code === null || trim($code) === '') {
            return null;
        }
        $normalized = trim($code);
        if ($normalized === 'OTHER' && $otherText !== null && trim($otherText) !== '') {
            return mb_substr(trim($otherText), 0, $maxLength);
        }

        $label = $labels[$normalized] ?? $normalized;

        return mb_substr(trim($label), 0, $maxLength);
    }
}

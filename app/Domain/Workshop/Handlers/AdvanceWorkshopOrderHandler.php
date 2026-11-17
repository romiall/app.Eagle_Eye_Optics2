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
use App\Application\Effects\OutboxEvent;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\BillingErrors;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Text;
use App\Domain\Workshop\Rules\WorkshopOrderRules;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Progression, contrôle qualité, reprise, ajustement ou annulation d'une commande atelier (L1D04, EE028, AT31).
 *
 * Append-only dans `workshop_events`, contrôle qualité échoué / reprise sans perdre l'historique, émission d'un
 * événement outbox `WorkshopReady` (avec `ready_revision` incrémentée) à chaque passage en `READY`, et remise au patient
 * (`DELIVERED`) obligatoirement reliée à une ligne de remise `CONFIRMED` sur la même ligne de facture.
 *
 * Verrous : cabinet (10), idempotence (20), commande atelier (65).
 */
final class AdvanceWorkshopOrderHandler implements CommandHandler
{
    public const COMMAND = 'AdvanceWorkshopOrder';

    public const REQUEST_SCHEMA = 'schemas/requests/http.json#/$defs/AdvanceWorkshopOrderRequest';

    public function __construct(private readonly ContractValidator $contracts) {}

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

        $orderId = (string) ($command->entityId ?? $payload['workshop_order_id']);
        if ($orderId !== (string) $payload['workshop_order_id']) {
            throw BusinessError::validation(['workshop_order_id' => ['L\'identifiant du corps doit correspondre à la commande atelier.']]);
        }

        $expectedVersion = $command->expectedVersion ?? ($payload['expected_version'] ?? null);
        if (! is_int($expectedVersion)) {
            throw BusinessError::validation(['expected_version' => ['La version attendue doit être un entier positif.']]);
        }

        $locks->workshopOrder($orderId);

        $order = DB::table('workshop_orders')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $orderId)
            ->first();

        if ($order === null) {
            throw BusinessError::notFound();
        }

        $currentVersion = (int) $order->version;
        if ($expectedVersion !== $currentVersion) {
            throw BillingErrors::versionConflict($currentVersion);
        }

        $deliveryLineId = isset($payload['delivery_line_id']) && is_string($payload['delivery_line_id'])
            ? $payload['delivery_line_id']
            : null;

        $plan = WorkshopOrderRules::planTransition(
            (string) $order->status,
            (string) $payload['event_type'],
            isset($payload['new_status']) && is_string($payload['new_status']) ? $payload['new_status'] : null,
            isset($payload['quality_result']) && is_string($payload['quality_result']) ? $payload['quality_result'] : null,
            isset($payload['observations']) && is_string($payload['observations']) ? $payload['observations'] : null,
            $deliveryLineId,
        );

        $errors = new FieldErrors;
        $labReference = $order->lab_reference === null ? null : (string) $order->lab_reference;
        $expectedAtSql = $order->expected_at === null ? null : (string) $order->expected_at;
        $notes = $order->notes === null ? null : (string) $order->notes;

        try {
            if (array_key_exists('lab_reference', $payload)) {
                $labReference = Text::optional(is_string($payload['lab_reference']) ? $payload['lab_reference'] : null, 100, 'lab_reference');
            }
            if (array_key_exists('notes', $payload)) {
                $notes = Text::optional(is_string($payload['notes']) ? $payload['notes'] : null, 5000, 'notes');
            }
            if (array_key_exists('expected_at', $payload)) {
                $rawExpected = $payload['expected_at'];
                if ($rawExpected === null || (is_string($rawExpected) && trim($rawExpected) === '')) {
                    $expectedAtSql = null;
                } elseif (is_string($rawExpected)) {
                    $parsed = Instant::parse($rawExpected, 'expected_at');
                    $expectedAtSql = $parsed === null
                        ? null
                        : CarbonImmutable::createFromTimestampMsUTC($parsed->epochMilliseconds)->format('Y-m-d H:i:s.u');
                }
            }
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }

        if ($plan['requires_delivery_line']) {
            if ($deliveryLineId === null) {
                $errors->add('delivery_line_id', 'La remise d\'une commande atelier exige une ligne de remise patient confirmée.');
            } else {
                $deliveryLine = DB::table('delivery_lines as dl')
                    ->join('deliveries as d', static fn ($j) => $j->on('d.id', '=', 'dl.delivery_id')->on('d.clinic_id', '=', 'dl.clinic_id'))
                    ->where('dl.clinic_id', $context->clinicId)
                    ->where('dl.id', $deliveryLineId)
                    ->where('d.status', 'CONFIRMED')
                    ->select(['dl.id', 'dl.invoice_line_id'])
                    ->first();
                if ($deliveryLine === null) {
                    $errors->add('delivery_line_id', 'Ligne de remise confirmée introuvable.');
                } elseif ((string) $deliveryLine->invoice_line_id !== (string) $order->invoice_line_id) {
                    $errors->add('delivery_line_id', 'Cette ligne de remise ne correspond pas à la ligne de facture de la commande atelier.');
                }
            }
        }

        $errors->throwIfAny();

        $at = CarbonImmutable::now('UTC');
        $nowSql = $at->format('Y-m-d H:i:s.u');
        $nowIso = $at->format('Y-m-d\TH:i:s.v\Z');

        $maxSeq = (int) (DB::table('workshop_events')
            ->where('clinic_id', $context->clinicId)
            ->where('workshop_order_id', $orderId)
            ->max('sequence_no') ?? 0);
        $nextSeq = $maxSeq + 1;

        DB::table('workshop_events')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $context->clinicId,
            'workshop_order_id' => $orderId,
            'sequence_no' => $nextSeq,
            'event_type' => $plan['event_type'],
            'previous_status' => (string) $order->status,
            'new_status' => $plan['new_status'],
            'quality_result' => $plan['quality_result'],
            'observations' => $plan['observations'],
            'occurred_at' => $nowSql,
            'actor_id' => $context->actorId,
            'delivery_line_id' => $plan['requires_delivery_line'] ? $deliveryLineId : null,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $newReadyRevision = $plan['increment_ready_revision']
            ? ((int) $order->ready_revision) + 1
            : (int) $order->ready_revision;
        $newVersion = $currentVersion + 1;

        $receivedAtSql = $plan['sets_received_at'] && $order->received_at === null
            ? $nowSql
            : ($order->received_at === null ? null : (string) $order->received_at);

        DB::table('workshop_orders')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $orderId)
            ->update([
                'status' => $plan['new_status'],
                'ready_revision' => $newReadyRevision,
                'received_at' => $receivedAtSql,
                'lab_reference' => $labReference,
                'expected_at' => $expectedAtSql,
                'notes' => $notes,
                'version' => $newVersion,
                'updated_at' => $nowSql,
            ]);

        $events = [];
        if ($plan['increment_ready_revision']) {
            $events[] = new OutboxEvent(
                'WorkshopReady',
                1,
                'workshop_orders',
                $orderId,
                $newVersion,
                [
                    'workshop_order_id' => $orderId,
                    'patient_id' => (string) $order->patient_id,
                    'invoice_line_id' => (string) $order->invoice_line_id,
                    'ready_revision' => $newReadyRevision,
                    'ready_at' => $nowIso,
                ],
            );
        }

        return new CommandOutcome(
            result: [
                'workshop_order_id' => $orderId,
                'status' => $plan['new_status'],
                'ready_revision' => $newReadyRevision,
                'version' => $newVersion,
            ],
            resultType: 'workshop_orders',
            resultId: $orderId,
            audit: [
                new AuditEntry('workshop_order.advanced', 'workshop_orders', $orderId, $plan['observations'], [
                    'event_type' => $plan['event_type'],
                    'previous_status' => (string) $order->status,
                    'new_status' => $plan['new_status'],
                    'quality_result' => $plan['quality_result'],
                    'ready_revision' => $newReadyRevision,
                    'delivery_line_id' => $plan['requires_delivery_line'] ? $deliveryLineId : null,
                ]),
            ],
            events: $events,
            changes: [
                new ChangeRecord('workshop_orders', $orderId, $newVersion, ChangeVisibility::Manager, ChangeKind::Updated),
            ],
        );
    }
}

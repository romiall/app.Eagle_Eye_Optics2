<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\Numbering\BillingNumbers;
use App\Domain\Billing\Numbering\NumberUsages;
use App\Domain\Billing\Rules\LedgerBalance;
use App\Domain\Billing\Rules\PaymentRules;
use App\Domain\Billing\Rules\Settlement;
use App\Domain\Billing\Snapshots\InvoiceSnapshots;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\ValueObjects\Instant;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Enregistrement atomique d'un paiement CONFIRMÉ et de son reçu numéroté figé (partagé entre `RegisterPaymentHandler`,
 * l'encaissement automatique à l'émission dans `IssueInvoiceHandler` et la régularisation rétroactive des factures
 * émises). Retourne le grand livre relu juste après l'écriture du paiement.
 */
final class ReceiptRecorder
{
    /**
     * @param  array{value: int, rendered: string, year: int}  $receiptNumber
     */
    public static function record(
        CommandContext $context,
        stdClass $clinic,
        stdClass $invoice,
        LedgerBalance $before,
        string $paymentId,
        string $receiptId,
        string $receiptUsageId,
        string $receiptDocumentId,
        int $amount,
        string $method,
        ?string $reference,
        ?string $cashSessionId,
        array $receiptNumber,
        Instant $effective,
        CarbonImmutable $pieceAt,
        CarbonImmutable $at,
        string $idempotencyId,
        ?string $allocationId = null,
    ): LedgerBalance {
        $invoiceId = (string) $invoice->id;
        $nowDb = $at->format('Y-m-d H:i:s.u');
        $effectiveDb = CarbonImmutable::createFromTimestampMsUTC($effective->epochMilliseconds)->format('Y-m-d H:i:s.u');

        DB::table('payments')->insert([
            'id' => $paymentId,
            'clinic_id' => $context->clinicId,
            'invoice_id' => $invoiceId,
            'amount' => $amount,
            'method' => $method,
            'reference' => $reference,
            'effective_at' => $effectiveDb,
            'status' => 'CONFIRMED',
            'confirmed_at' => $nowDb,
            'cash_session_id' => $cashSessionId,
            'received_by' => $context->actorId,
            'idempotency_id' => $idempotencyId,
            'source_device_id' => $context->deviceId,
            'sync_command_id' => $context->syncReferences?->commandId,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        NumberUsages::record(
            $context,
            $receiptUsageId,
            BillingNumbers::RECEIPT,
            $receiptNumber,
            'receipts',
            $receiptId,
            $at,
            $allocationId,
            $context->deviceId,
        );

        $after = InvoiceLedger::load($context->clinicId, $invoiceId, (int) $invoice->total_gross);
        $snapshot = [
            'receipt_id' => $receiptId,
            'receipt_number' => $receiptNumber['rendered'],
            'issued_at' => $pieceAt->format('Y-m-d\TH:i:s.v\Z'),
            'effective_at' => $effective->toString(),
            'invoice' => [
                'invoice_id' => $invoiceId,
                'number' => (string) $invoice->number,
                'issued_at' => CarbonImmutable::parse((string) $invoice->issued_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
                'total_gross' => (int) $invoice->total_gross,
            ],
            'patient' => json_decode((string) $invoice->patient_snapshot, true, 512, JSON_THROW_ON_ERROR),
            'payment' => [
                'payment_id' => $paymentId,
                'amount' => $amount,
                'currency' => (string) $invoice->currency,
                'method' => $method,
                'reference' => $reference,
            ],
            'paid_net_before' => Settlement::paidNet($before),
            'paid_net_after' => Settlement::paidNet($after),
            'balance_after' => $after->signedBalance(),
            'kind' => PaymentRules::receiptKind($after->signedBalance()),
            'cashier' => ['user_id' => $context->actorId, 'display_name' => $context->actorName],
            'clinic' => InvoiceSnapshots::clinic($clinic),
            'template_version' => PendingDocuments::RECEIPT_TEMPLATE,
        ];

        DB::table('receipts')->insert([
            'id' => $receiptId,
            'clinic_id' => $context->clinicId,
            'payment_id' => $paymentId,
            'invoice_id' => $invoiceId,
            'number' => $receiptNumber['rendered'],
            'number_usage_id' => $receiptUsageId,
            'issued_at' => $pieceAt->format('Y-m-d H:i:s.u'),
            'issued_by' => $context->actorId,
            'snapshot' => json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);

        PendingDocuments::forReceipt($context, $receiptDocumentId, $receiptId, $at);

        return $after;
    }
}

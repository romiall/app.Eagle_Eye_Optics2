<?php

namespace App\Domain\Billing;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Billing\Numbering\BillingNumbers;
use App\Domain\Billing\Rules\PaymentRules;
use App\Domain\Cash\CashSessions;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Instant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Régularisation idempotente des factures valides (`ISSUED`, origine `NATIVE`) qui ont été émises sans
 * encaissement : crée atomiquement le paiement 100 % espèces (`effective_at = issued_at`), son reçu numéroté et
 * son document en attente, rattachés à la session ouverte correspondante. Sans effet sur les factures déjà
 * partiellement ou totalement encaissées, créditées, abandonnées ou reprises papier.
 */
final class ExistingInvoiceAutoCollector
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @return array{collected: int, skipped: int}
     */
    public function collectAll(): array
    {
        $candidates = DB::table('invoices as i')
            ->where('i.status', 'ISSUED')
            ->where('i.origin', 'NATIVE')
            ->where('i.total_gross', '>', 0)
            ->whereNotNull('i.issued_at')
            ->whereNotExists(static function ($query): void {
                $query->selectRaw('1')
                    ->from('payments as p')
                    ->whereColumn('p.clinic_id', 'i.clinic_id')
                    ->whereColumn('p.invoice_id', 'i.id')
                    ->where('p.status', 'CONFIRMED');
            })
            ->whereNotExists(static function ($query): void {
                $query->selectRaw('1')
                    ->from('credit_notes as c')
                    ->whereColumn('c.clinic_id', 'i.clinic_id')
                    ->whereColumn('c.invoice_id', 'i.id')
                    ->where('c.status', 'ISSUED');
            })
            ->orderBy('i.issued_at')
            ->orderBy('i.id')
            ->get(['i.id', 'i.clinic_id']);

        $collected = 0;
        $skipped = 0;
        foreach ($candidates as $candidate) {
            $ok = $this->collectOne((string) $candidate->clinic_id, (string) $candidate->id);
            if ($ok) {
                $collected++;
            } else {
                $skipped++;
            }
        }

        return ['collected' => $collected, 'skipped' => $skipped];
    }

    public function collectOne(string $clinicId, string $invoiceId): bool
    {
        return $this->transactions->run(function () use ($clinicId, $invoiceId): bool {
            $locks = new TransactionLocks($clinicId);
            $clinic = $locks->clinic();

            $peek = DB::table('invoices')->where('clinic_id', $clinicId)->where('id', $invoiceId)->first();
            if (! $peek instanceof stdClass || (string) $peek->status !== 'ISSUED' || (string) $peek->origin !== 'NATIVE' || $peek->issued_at === null || (int) $peek->total_gross <= 0) {
                return false;
            }

            $issuedDb = (string) $peek->issued_at;
            $actorId = is_string($peek->issued_by) ? $peek->issued_by : (is_string($peek->created_by) ? $peek->created_by : null);
            $actor = $actorId !== null
                ? User::query()->where('clinic_id', $clinicId)->find($actorId)
                : User::query()->where('clinic_id', $clinicId)->where('active', 1)->first();
            if (! $actor instanceof User) {
                return false;
            }

            $sessionCandidate = CashSessions::resolveOpenForCollection($clinicId, (string) $actor->getKey(), $issuedDb);
            if ($sessionCandidate === null) {
                return false;
            }

            $issuedAt = CarbonImmutable::parse($issuedDb, 'UTC');
            $now = CarbonImmutable::now('UTC');
            $timezone = (string) ($clinic->timezone ?? 'Africa/Douala');
            $context = CommandContext::direct($actor, 'auto-collect-existing-'.$invoiceId, $now);

            // Verrous dans l'ordre du contrat : séquence (40), patient (45), facture (60), session (70).
            $receiptNumber = BillingNumbers::allocate($locks, $context, BillingNumbers::RECEIPT, $timezone, $issuedAt);
            $locks->patient((string) $peek->patient_id);
            $invoice = $locks->invoice($invoiceId);
            if ($invoice === null || (string) $invoice->status !== 'ISSUED') {
                return false;
            }
            $session = $locks->cashSession((string) $sessionCandidate->id);
            if ($session === null || $session->closed_at !== null) {
                return false;
            }

            $before = InvoiceLedger::load($clinicId, $invoiceId, (int) $invoice->total_gross);
            if ($before->amountDue() !== (int) $invoice->total_gross || $before->paymentsConfirmed > 0 || $before->creditsIssued > 0) {
                return false;
            }

            $paymentId = Ulid::generate();
            $receiptId = Ulid::generate();
            $receiptUsageId = Ulid::generate();
            $receiptDocumentId = Ulid::generate();
            $idempotencyId = Ulid::generate();
            $nowDb = $now->format('Y-m-d H:i:s.u');

            DB::table('idempotency_requests')->insert([
                'id' => $idempotencyId,
                'clinic_id' => $clinicId,
                'namespace' => 'backfill',
                'command_name' => 'AutoCollectIssuedInvoice',
                'request_key' => 'AUTO-COLLECT-'.$invoiceId,
                'payload_hash' => hash('sha256', $invoiceId),
                'status' => 'COMMITTED',
                'result_type' => 'payments',
                'result_id' => $paymentId,
                'completed_at' => $nowDb,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $effective = Instant::fromEpochMilliseconds((int) $issuedAt->format('Uv'));
            ReceiptRecorder::record(
                $context,
                $clinic,
                $invoice,
                $before,
                $paymentId,
                $receiptId,
                $receiptUsageId,
                $receiptDocumentId,
                (int) $invoice->total_gross,
                PaymentRules::CASH,
                null,
                (string) $session->id,
                $receiptNumber,
                $effective,
                $issuedAt,
                $now,
                $idempotencyId,
            );

            $this->audit->recordFor(
                $clinicId,
                (string) $actor->getKey(),
                (string) $actor->display_name,
                'payment.confirmed',
                'payments',
                $paymentId,
                'Régularisation automatique de la facture émise au journal de caisse.',
                [
                    'invoice_id' => $invoiceId,
                    'invoice_number' => (string) $invoice->number,
                    'amount' => (int) $invoice->total_gross,
                    'method' => PaymentRules::CASH,
                    'receipt_number' => $receiptNumber['rendered'],
                    'cash_session_id' => (string) $session->id,
                    'backfill' => true,
                ],
                'auto-collect-'.$invoiceId,
            );

            return true;
        });
    }
}

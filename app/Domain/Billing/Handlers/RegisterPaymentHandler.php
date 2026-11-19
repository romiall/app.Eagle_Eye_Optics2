<?php

namespace App\Domain\Billing\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Effects\OutboxEvent;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\BillingErrors;
use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\ExamFeeScope;
use App\Domain\Billing\ExamFeeVisits;
use App\Domain\Billing\Guards\AuthoredSource;
use App\Domain\Billing\InvoiceLedger;
use App\Domain\Billing\Numbering\BillingNumbers;
use App\Domain\Billing\Numbering\NumberUsages;
use App\Domain\Billing\ReceiptRecorder;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Billing\Rules\PaymentRules;
use App\Domain\Billing\Rules\Settlement;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use App\Domain\Shared\DeviceNumbers;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Encaissement d'un acompte ou du solde, avec un reçu UNIQUE par encaissement (B04, EE022, EE023, EE030, EE045, AT10,
 * AT11, AT12, AT37). Dans UNE transaction, sous le verrou du cabinet et celui de la facture : le paiement est écrit
 * CONFIRMÉ, puis son reçu numéroté (le reçu ne précède jamais le paiement : trigger `Receipt requires a confirmed
 * payment`), puis le document PDF en attente. L'encaissement est un fait constaté par un opérateur ; aucun suivi
 * d'opérateur télécom n'existe en L0.
 *
 * Aucune mise à jour de la facture émise : le solde et la `ledger_version` sont recalculés SOUS le verrou de la
 * facture à partir des faits (paiements, contre-écritures, avoirs, remboursements). La version attendue de la commande
 * est cette `ledger_version`.
 *
 * Refus, dans l'ordre : facture détenue par un poste (`WRITE_OWNER_REQUIRED`), facture non émise
 * (`STATE_TRANSITION_REFUSED`), montant au-delà du reste dû (`PAYMENT_EXCEEDS_BALANCE`, avec `amount_due` et
 * `current_version` : AT12, le second encaissement de 40 000 sur 50 000 apprend qu'il reste 10 000), version
 * périmée (`VERSION_CONFLICT` avec `current_version` et `amount_due`). Jamais de sur-encaissement, jamais de reçu
 * partiel ni de paiement sans reçu.
 *
 * Espèces : session de caisse OUVERTE, de l'auteur, antérieure à la date de l'encaissement. Autres modes : aucune
 * session. La référence est obligatoire pour mobile money et virement (paramétrable). Un encaissement daté d'un jour
 * civil antérieur exige un motif, conservé dans l'audit.
 *
 * Route directe : numéro de reçu central, jamais renuméroté ensuite. Commande d'un poste synchronisée (O05) : le numéro
 * du reçu est celui de la plage du poste, enregistré tel quel (`DeviceNumbers`) ; la facture doit être détenue par CE
 * poste (propriété active) ; la date du reçu et le contrôle de rétroactivité suivent l'instant où le poste a encaissé ;
 * le paiement garde le poste et la commande d'origine (`source_device_id`, `sync_command_id`). Profil « frais d'examen » : seules les factures
 * de frais d'examen. Contrôle du paiement de l'examen actif (`EEO_EXAM_FEE_CONTROL=billed`) : la visite de la facture
 * passe « prête pour l'examen » quand sa facture de frais est réglée (`ExamFeeVisits`, P03). Verrous : cabinet,
 * idempotence, séquence RECEIPT (40), visite de la facture (46, contrôle actif seulement), propriété de facture (50),
 * facture (60), session de caisse (70).
 */
final class RegisterPaymentHandler implements CommandHandler
{
    public const COMMAND = 'RegisterPayment';

    public function __construct(private readonly ExamFeeScope $examFee, private readonly ExamFeeVisits $visits) {}

    public function permissions(): array
    {
        return ['payment.collect', 'exam_fee.collect'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        AuthoredSource::assert($context, 'L\'encaissement');
        $sync = $context->source === CommandSource::Sync;
        if ($idempotencyId === null || $context->actorId === null) {
            throw new LogicException('Un encaissement exige une clé d\'idempotence et un auteur identifié.');
        }

        $payload = $command->payload;
        $invoiceId = (string) $payload['invoice_id'];
        $paymentId = (string) $payload['payment_id'];
        $receiptId = (string) $payload['receipt_id'];
        $usageId = (string) $payload['receipt_number_usage_id'];
        $documentId = (string) $payload['receipt_document_id'];
        $amount = (int) $payload['amount'];
        $method = (string) $payload['method'];
        $sessionId = is_string($payload['cash_session_id'] ?? null) ? $payload['cash_session_id'] : null;
        $at = CarbonImmutable::now('UTC');
        // Instant de la pièce : celui du serveur, ou celui où le poste a encaissé (commande synchronisée).
        $pieceAt = $context->pieceInstant($at);
        $clinic = $locks->clinic();
        $timezone = (string) $clinic->timezone;
        $errors = new FieldErrors;

        $reference = null;
        try {
            $reference = Text::optional(is_string($payload['reference'] ?? null) ? $payload['reference'] : null, 180, 'reference');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        if ($reference === null && PaymentRules::referenceRequired($method, self::referenceRequiredMethods())) {
            $errors->add('reference', 'La référence est obligatoire pour ce mode de règlement (numéro de transaction, de virement).');
        }
        if ($method === PaymentRules::CASH && $sessionId === null) {
            $errors->add('cash_session_id', 'Un encaissement en espèces exige une session de caisse ouverte.');
        }
        if ($method !== PaymentRules::CASH && $sessionId !== null) {
            $errors->add('cash_session_id', 'Seuls les encaissements en espèces appartiennent à une session de caisse.');
        }
        foreach ([
            ['payment_id', DB::table('payments')->where('id', $paymentId)->exists(), 'paiement'],
            ['receipt_id', DB::table('receipts')->where('id', $receiptId)->exists(), 'reçu'],
            ['receipt_number_usage_id', NumberUsages::isTaken($usageId), 'usage de numéro'],
            ['receipt_document_id', PendingDocuments::isTaken($documentId), 'document'],
        ] as [$field, $taken, $label]) {
            if ($taken) {
                $errors->add($field, 'Cet identifiant de '.$label.' est déjà utilisé.');
            }
        }

        $effective = null;
        $retroactiveReason = null;
        try {
            $effective = Instant::parse((string) $payload['effective_at'], 'effective_at');
            $now = Instant::fromEpochMilliseconds((int) $pieceAt->format('Uv'));
            if ($effective !== null) {
                PaymentRules::assertNotInFuture($effective, $now, (int) config('eeo.offline.max_clock_skew_seconds', 300));
                $retroactiveReason = Text::optional(is_string($payload['retroactive_reason'] ?? null) ? $payload['retroactive_reason'] : null, 1000, 'retroactive_reason');
                if ($retroactiveReason === null && PaymentRules::isRetroactive($effective, $now, $timezone)) {
                    $errors->add('retroactive_reason', 'Un encaissement daté d\'un jour antérieur exige un motif.');
                }
            }
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        $errors->throwIfAny();
        if ($effective === null) {
            throw new LogicException('Date effective absente sans erreur de validation.');
        }

        // 1. Numéro de reçu (séquence, rang 40, ou plage du poste), puis propriété (50) et facture (60).
        $allocationId = null;
        if ($sync) {
            $consumed = DeviceNumbers::consume($context, BillingNumbers::RECEIPT, $payload['receipt_number'] ?? null, BillingNumbers::render(...));
            $number = ['value' => $consumed['value'], 'rendered' => $consumed['rendered'], 'year' => $consumed['year']];
            $allocationId = $consumed['allocation_id'];
        } else {
            $number = BillingNumbers::allocate($locks, $context, BillingNumbers::RECEIPT, $timezone, $at);
        }
        $visit = $this->visits->lockForInvoice($locks, $context->clinicId, $invoiceId);
        $ownedHere = false;
        foreach ($locks->invoiceOwners($invoiceId) as $owner) {
            if (! in_array((string) $owner->status, ['ACTIVE', 'CLOSING'], true)) {
                continue;
            }
            if ($sync && (string) $owner->device_id === $context->deviceId) {
                $ownedHere = true;

                continue;
            }
            $name = DB::table('enrolled_devices')->where('clinic_id', $context->clinicId)->where('id', $owner->device_id)->value('name');
            throw BillingErrors::writeOwnerRequired(is_string($name) ? $name : 'poste');
        }
        if ($sync && ! $ownedHere) {
            throw new BusinessError('WRITE_OWNER_REQUIRED', 'Ce poste ne détient pas cette facture : un encaissement hors-ligne exige que la facture lui ait été attribuée ou qu\'il l\'ait émise.', 409);
        }
        $invoice = $locks->invoice($invoiceId);
        if ($invoice === null) {
            throw BusinessError::notFound('Facture introuvable dans ce cabinet.');
        }
        if ((string) $invoice->status !== 'ISSUED') {
            throw BusinessError::stateRefused('Seule une facture émise peut être encaissée.', (string) $invoice->status);
        }
        if ($this->examFee->restricted($context, 'payment.collect')) {
            $this->examFee->assertExamFeeInvoice($context->clinicId, $invoiceId);
        }

        $before = InvoiceLedger::load($context->clinicId, $invoiceId, (int) $invoice->total_gross);
        try {
            $before->assertPayment($amount);
        } catch (RuleViolation $violation) {
            $refusal = $violation->toBusinessError();

            throw new BusinessError($refusal->errorCode, $refusal->getMessage(), $refusal->httpStatus, $refusal->fields, $violation, [], $refusal->details + ['current_version' => $before->ledgerVersion]);
        }
        if ($command->expectedVersion === null || $command->expectedVersion !== $before->ledgerVersion) {
            throw BillingErrors::versionConflict($before->ledgerVersion, ['amount_due' => $before->amountDue()], 'La facture a changé depuis votre affichage : actualisez le solde avant d\'encaisser.');
        }

        // 2. Session de caisse (70) pour les espèces.
        if ($sessionId !== null) {
            $session = $locks->cashSession($sessionId);
            if ($session === null) {
                throw BusinessError::validation(['cash_session_id' => ['Session de caisse introuvable dans ce cabinet.']]);
            }
            if ($session->closed_at !== null) {
                throw BusinessError::stateRefused('Cette session de caisse est clôturée : ouvrez-en une nouvelle pour encaisser.', 'CLOSED');
            }
            if ((string) $session->cashier_id !== $context->actorId) {
                throw BusinessError::validation(['cash_session_id' => ['Cette session de caisse appartient à un autre compte.']]);
            }
            if ($effective->epochMilliseconds < (int) CarbonImmutable::parse((string) $session->opened_at, 'UTC')->format('Uv')) {
                throw BusinessError::validation(['effective_at' => ['L\'encaissement ne peut pas précéder l\'ouverture de sa session de caisse.']]);
            }
        }

        // 3. Faits : paiement CONFIRMÉ, usage du numéro, reçu, document en attente.
        $after = ReceiptRecorder::record(
            $context,
            $clinic,
            $invoice,
            $before,
            $paymentId,
            $receiptId,
            $usageId,
            $documentId,
            $amount,
            $method,
            $reference,
            $sessionId,
            $number,
            $effective,
            $pieceAt,
            $at,
            $idempotencyId,
            $allocationId,
        );
        $issuedAt = $pieceAt->format('Y-m-d\TH:i:s.v\Z');
        $effectiveAt = $effective->toString();

        $publicationVersion = InvoiceLedger::publicationVersion((int) $invoice->version, $after->ledgerVersion);
        $changes = [
            new ChangeRecord('invoices', $invoiceId, $publicationVersion, ChangeVisibility::Financial, ChangeKind::Updated),
            new ChangeRecord('payments', $paymentId, 1, ChangeVisibility::Financial, ChangeKind::Created),
            new ChangeRecord('receipts', $receiptId, 1, ChangeVisibility::Financial, ChangeKind::Created),
        ];
        $visitChange = $this->visits->refresh($context, $visit);
        if ($visitChange !== null) {
            $changes[] = $visitChange;
        }

        return new CommandOutcome(
            result: [
                'payment_id' => $paymentId,
                'receipt_id' => $receiptId,
                'receipt_number' => $number['rendered'],
                'invoice_id' => $invoiceId,
                'amount' => $amount,
                'currency' => (string) $invoice->currency,
                'method' => $method,
                'effective_at' => $effectiveAt,
                'recorded_at' => $issuedAt,
                'ledger_version' => $after->ledgerVersion,
                'balance' => Settlement::balanceArray('ISSUED', (int) $invoice->total_gross, $after),
                'receipt_document' => ['document_id' => $documentId, 'document_status' => 'PENDING'],
            ],
            resultType: 'payments',
            resultId: $paymentId,
            audit: [new AuditEntry('payment.confirmed', 'payments', $paymentId, $retroactiveReason, [
                'invoice_id' => $invoiceId,
                'amount' => $amount,
                'method' => $method,
                'receipt_number' => $number['rendered'],
                'ledger_version_before' => $before->ledgerVersion,
                'ledger_version_after' => $after->ledgerVersion,
                'balance_after' => $after->signedBalance(),
                'cash_session_id' => $sessionId,
                'receipt_kind' => PaymentRules::receiptKind($after->signedBalance()),
                'source_device_id' => $context->deviceId,
            ])],
            events: [new OutboxEvent('PaymentConfirmed', 1, 'invoices', $invoiceId, $publicationVersion, [
                'payment_id' => $paymentId,
                'invoice_id' => $invoiceId,
                'receipt_id' => $receiptId,
                'receipt_number' => $number['rendered'],
                'amount' => $amount,
                'currency' => (string) $invoice->currency,
                'method' => $method,
                'effective_at' => $effectiveAt,
            ])],
            changes: $changes,
        );
    }

    /**
     * Modes dont la référence est obligatoire (paramétrage `eeo.billing.payment_reference_required`).
     *
     * @return list<string>
     */
    private static function referenceRequiredMethods(): array
    {
        $configured = config('eeo.billing.payment_reference_required');
        if (! is_array($configured)) {
            return PaymentRules::DEFAULT_REFERENCE_REQUIRED;
        }

        return array_values(array_filter($configured, is_string(...)));
    }
}

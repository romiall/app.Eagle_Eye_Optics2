<?php

namespace App\Domain\Cash;

use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Guards\CentralOnly;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Cash\Rules\PaymentReconciliationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\ValueObjects\Money;
use Illuminate\Support\Facades\DB;

/**
 * Écriture partagée d'un brouillon de rapprochement par canal (`CreatePaymentReconciliation` et
 * `UpdatePaymentReconciliation`).
 *
 * Verrouillage croissant : clinique (rang 10) puis rapprochement (rang 75) pour empêcher deux brouillons simultanés
 * de pointer le même encaissement ou le même remboursement. Recalcule l'attendu serveur (`vw_collection_events`) et
 * remplace intégralement les lignes du brouillon ; refuse 409 si le rapprochement est déjà VALIDATED.
 */
final class PaymentReconciliationWriter
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public static function saveDraft(
        array $payload,
        CommandContext $context,
        TransactionLocks $locks,
        bool $mustExist,
    ): CommandOutcome {
        CentralOnly::assert($context, 'L\'enregistrement d\'un rapprochement de paiement');

        $reconciliationId = (string) $payload['reconciliation_id'];
        $method = (string) $payload['method'];
        $errors = new FieldErrors;
        if (! in_array($method, PaymentReconciliationRules::METHODS, true)) {
            $errors->add('method', 'Canal de paiement inconnu.');
        }

        $period = PaymentReconciliationRules::assertPeriod(
            $payload['period_starts_at'] ?? null,
            $payload['period_ends_at'] ?? null,
            $errors,
        );

        $rawLines = is_array($payload['lines'] ?? null) ? array_values($payload['lines']) : [];
        $lines = PaymentReconciliationRules::assertLines($rawLines, $errors);

        $statementAmount = isset($payload['statement_amount'])
            ? Money::signed((int) $payload['statement_amount'], 'statement_amount')
            : null;
        $statementFileId = is_string($payload['statement_file_id'] ?? null) && $payload['statement_file_id'] !== ''
            ? $payload['statement_file_id']
            : null;
        $varianceReason = PaymentReconciliationRules::nullableTrimmed($payload['variance_reason'] ?? null);

        // Verrou clinique (10) avant verrou rapprochement (75) : garantit l'unicité d'affectation des règlements.
        $locks->clinic();
        $existing = $locks->paymentReconciliation($reconciliationId);

        if ($mustExist) {
            if ($existing === null) {
                throw BusinessError::notFound('Rapprochement introuvable.');
            }
            if ((string) $existing->status !== 'DRAFT') {
                throw BusinessError::stateRefused(
                    'Un rapprochement validé est définitif : créez un autre rapprochement si une pièce supplémentaire arrive.',
                    (string) $existing->status,
                );
            }
        } elseif ($existing !== null) {
            throw BusinessError::stateRefused(
                'Un rapprochement porte déjà cet identifiant.',
                (string) $existing->status,
            );
        }

        if ($statementFileId !== null) {
            $fileOk = DB::table('stored_files')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $statementFileId)
                ->where('classification', 'FINANCIAL')
                ->exists();
            if (! $fileOk) {
                $errors->add('statement_file_id', 'Le relevé joint est introuvable dans les pièces financières du cabinet.');
            }
        }

        $paymentIds = array_values(array_filter(array_map(static fn (array $l): ?string => $l['payment_id'], $lines)));
        $refundIds = array_values(array_filter(array_map(static fn (array $l): ?string => $l['refund_id'], $lines)));

        if ($paymentIds !== []) {
            $validPayments = DB::table('payments')
                ->where('clinic_id', $context->clinicId)
                ->where('method', $method)
                ->where('status', 'CONFIRMED')
                ->whereIn('id', $paymentIds)
                ->pluck('id')
                ->all();
            $missingPayments = array_diff($paymentIds, $validPayments);
            if ($missingPayments !== []) {
                $errors->add('lines', 'Un encaissement désigné n\'appartient pas à ce canal ou n\'est pas confirmé.');
            }
        }

        if ($refundIds !== []) {
            $validRefunds = DB::table('refunds')
                ->where('clinic_id', $context->clinicId)
                ->where('method', $method)
                ->whereIn('id', $refundIds)
                ->pluck('id')
                ->all();
            $missingRefunds = array_diff($refundIds, $validRefunds);
            if ($missingRefunds !== []) {
                $errors->add('lines', 'Un remboursement désigné n\'appartient pas à ce canal.');
            }
        }
        $errors->throwIfAny();

        self::assertNoDuplicateClaimAcrossReconciliations($context->clinicId, $reconciliationId, $paymentIds, $refundIds);

        $expectedAmount = PaymentReconciliations::expectedAmount(
            $context->clinicId,
            $method,
            $period['start_db'],
            $period['end_db'],
        );
        $now = $context->now->utc()->format('Y-m-d H:i:s.u');

        if ($mustExist) {
            DB::table('payment_reconciliations')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $reconciliationId)
                ->update([
                    'method' => $method,
                    'period_starts_at' => $period['start_db'],
                    'period_ends_at' => $period['end_db'],
                    'expected_amount' => $expectedAmount,
                    'statement_amount' => $statementAmount,
                    'statement_file_id' => $statementFileId,
                    'variance_reason' => $varianceReason,
                    'updated_at' => $now,
                ]);

            DB::table('payment_reconciliation_lines')
                ->where('clinic_id', $context->clinicId)
                ->where('reconciliation_id', $reconciliationId)
                ->delete();
        } else {
            DB::table('payment_reconciliations')->insert([
                'id' => $reconciliationId,
                'clinic_id' => $context->clinicId,
                'method' => $method,
                'period_starts_at' => $period['start_db'],
                'period_ends_at' => $period['end_db'],
                'status' => 'DRAFT',
                'expected_amount' => $expectedAmount,
                'statement_amount' => $statementAmount,
                'statement_file_id' => $statementFileId,
                'validated_by' => null,
                'validated_at' => null,
                'variance_reason' => $varianceReason,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        if ($lines !== []) {
            $inserts = [];
            foreach ($lines as $line) {
                $inserts[] = [
                    'id' => $line['line_id'],
                    'clinic_id' => $context->clinicId,
                    'reconciliation_id' => $reconciliationId,
                    'payment_id' => $line['payment_id'],
                    'refund_id' => $line['refund_id'],
                    'external_reference' => $line['external_reference'],
                    'statement_amount' => $line['statement_amount'],
                    'status' => $line['status'],
                    'note' => $line['note'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            DB::table('payment_reconciliation_lines')->insert($inserts);
        }

        $resource = PaymentReconciliations::find($context->clinicId, $reconciliationId);
        assert($resource !== null);

        $action = $mustExist ? 'payment_reconciliation.updated' : 'payment_reconciliation.created';
        $kind = $mustExist ? ChangeKind::Updated : ChangeKind::Created;

        return new CommandOutcome(
            result: $resource,
            resultType: 'payment_reconciliations',
            resultId: $reconciliationId,
            audit: [
                new AuditEntry($action, 'payment_reconciliations', $reconciliationId, $varianceReason, [
                    'method' => $method,
                    'expected_amount' => $expectedAmount,
                    'statement_amount' => $statementAmount,
                    'lines_count' => count($lines),
                ]),
            ],
            changes: [new ChangeRecord('payment_reconciliations', $reconciliationId, $mustExist ? 2 : 1, ChangeVisibility::Manager, $kind)],
        );
    }

    /**
     * @param  list<string>  $paymentIds
     * @param  list<string>  $refundIds
     */
    public static function assertNoDuplicateClaimAcrossReconciliations(
        string $clinicId,
        string $reconciliationId,
        array $paymentIds,
        array $refundIds,
    ): void {
        if ($paymentIds !== []) {
            $conflict = DB::table('payment_reconciliation_lines')
                ->where('clinic_id', $clinicId)
                ->where('reconciliation_id', '!=', $reconciliationId)
                ->whereIn('payment_id', $paymentIds)
                ->first(['reconciliation_id', 'payment_id']);
            if ($conflict !== null) {
                throw BusinessError::stateRefused(
                    'Cet encaissement est déjà rattaché à un autre rapprochement ('.$conflict->reconciliation_id.') : un règlement ne se rapproche qu\'une seule fois.',
                    'DUPLICATE_LINE',
                );
            }
        }

        if ($refundIds !== []) {
            $conflict = DB::table('payment_reconciliation_lines')
                ->where('clinic_id', $clinicId)
                ->where('reconciliation_id', '!=', $reconciliationId)
                ->whereIn('refund_id', $refundIds)
                ->first(['reconciliation_id', 'refund_id']);
            if ($conflict !== null) {
                throw BusinessError::stateRefused(
                    'Ce remboursement est déjà rattaché à un autre rapprochement ('.$conflict->reconciliation_id.') : un mouvement ne se rapproche qu\'une seule fois.',
                    'DUPLICATE_LINE',
                );
            }
        }
    }
}

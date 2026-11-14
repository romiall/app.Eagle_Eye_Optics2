<?php

namespace App\Domain\Cash\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Guards\CentralOnly;
use App\Domain\Cash\PaymentReconciliations;
use App\Domain\Cash\PaymentReconciliationWriter;
use App\Domain\Cash\Rules\PaymentReconciliationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Validation réauthentifiée d'un rapprochement par canal (L1D06) : recalcule l'attendu serveur sur la fenêtre,
 * revérifie l'absence de chevauchement avec d'autres rapprochements, impose un motif dès que le relevé diffère
 * de l'attendu, et fige l'état VALIDATED avec auteur et instant serveur.
 */
final class ValidatePaymentReconciliationHandler implements CommandHandler
{
    public const COMMAND = 'ValidatePaymentReconciliation';

    public function permissions(): array
    {
        return ['finance.reconcile'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        CentralOnly::assert($context, 'La validation d\'un rapprochement de paiement');
        if ($context->actorId === null) {
            throw new LogicException('Une validation de rapprochement a toujours un auteur identifié.');
        }

        $payload = $command->payload;
        $reconciliationId = (string) $payload['reconciliation_id'];
        $statementAmount = Money::signed((int) $payload['statement_amount'], 'statement_amount');
        $statementFileId = is_string($payload['statement_file_id'] ?? null) && $payload['statement_file_id'] !== ''
            ? $payload['statement_file_id']
            : null;

        $locks->clinic();
        $row = $locks->paymentReconciliation($reconciliationId);
        if ($row === null) {
            throw BusinessError::notFound('Rapprochement introuvable.');
        }
        if ((string) $row->status !== 'DRAFT') {
            throw BusinessError::stateRefused('Ce rapprochement est déjà validé et ne peut plus changer.', (string) $row->status);
        }

        if ($statementFileId !== null) {
            $fileOk = DB::table('stored_files')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $statementFileId)
                ->where('classification', 'FINANCIAL')
                ->exists();
            if (! $fileOk) {
                throw BusinessError::validation([
                    'statement_file_id' => ['Le relevé joint est introuvable dans les pièces financières du cabinet.'],
                ]);
            }
        }

        $lineTargets = DB::table('payment_reconciliation_lines')
            ->where('clinic_id', $context->clinicId)
            ->where('reconciliation_id', $reconciliationId)
            ->get(['payment_id', 'refund_id'])
            ->all();
        $paymentIds = array_values(array_filter(array_map(static fn ($l): ?string => $l->payment_id === null ? null : (string) $l->payment_id, $lineTargets)));
        $refundIds = array_values(array_filter(array_map(static fn ($l): ?string => $l->refund_id === null ? null : (string) $l->refund_id, $lineTargets)));
        PaymentReconciliationWriter::assertNoDuplicateClaimAcrossReconciliations($context->clinicId, $reconciliationId, $paymentIds, $refundIds);

        $expectedAmount = PaymentReconciliations::expectedAmount(
            $context->clinicId,
            (string) $row->method,
            (string) $row->period_starts_at,
            (string) $row->period_ends_at,
        );
        $varianceReason = PaymentReconciliationRules::assertVarianceReason(
            $expectedAmount,
            $statementAmount,
            $payload['variance_reason'] ?? null,
        );

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        DB::table('payment_reconciliations')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $reconciliationId)
            ->update([
                'status' => 'VALIDATED',
                'expected_amount' => $expectedAmount,
                'statement_amount' => $statementAmount,
                'statement_file_id' => $statementFileId,
                'variance_reason' => $varianceReason,
                'validated_by' => $context->actorId,
                'validated_at' => $now,
                'updated_at' => $now,
            ]);

        $resource = PaymentReconciliations::find($context->clinicId, $reconciliationId);
        assert($resource !== null);

        return new CommandOutcome(
            result: $resource,
            resultType: 'payment_reconciliations',
            resultId: $reconciliationId,
            audit: [
                new AuditEntry('payment_reconciliation.validated', 'payment_reconciliations', $reconciliationId, $varianceReason, [
                    'method' => (string) $row->method,
                    'expected_amount' => $expectedAmount,
                    'statement_amount' => $statementAmount,
                    'variance_amount' => $statementAmount - $expectedAmount,
                ]),
            ],
            changes: [new ChangeRecord('payment_reconciliations', $reconciliationId, 3, ChangeVisibility::Manager, ChangeKind::Updated)],
        );
    }
}

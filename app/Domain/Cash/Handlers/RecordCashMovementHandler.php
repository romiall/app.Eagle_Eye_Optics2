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
use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Access\Approvals\ExactApprovals;
use App\Domain\Billing\Guards\ActorRights;
use App\Domain\Billing\Guards\AuthoredSource;
use App\Domain\Cash\CashMovements;
use App\Domain\Cash\CashSessions;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Dépense (tiroir espèces ou autre canal, saisie directe caissière ou gérante, motif et référence facultatifs,
 * synchronisable depuis un poste préparé) ou mouvement d'espèces hors vente d'une session de caisse OUVERTE
 * (L1D05) : dépôt, retrait ou correction de l'ouverture (motif et approbation exacte obligatoires, en ligne).
 * Jamais un paiement : ni facture, ni reçu, ni chiffre d'affaires.
 *
 * Verrous : session de caisse (70) si `cash_session_id` présent, puis approbation (90) si mouvement non dépense.
 */
final class RecordCashMovementHandler implements CommandHandler
{
    public const COMMAND = 'RecordCashMovement';

    public function __construct(private readonly ExactApprovals $approvals, private readonly ActorRights $rights) {}

    public function permissions(): array
    {
        return ['cash.own_session', 'cash.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        AuthoredSource::assert($context, 'L\'enregistrement d\'un mouvement de caisse');

        $payload = $command->payload;
        $movementId = (string) $payload['movement_id'];
        $sessionId = is_string($payload['cash_session_id'] ?? null) ? $payload['cash_session_id'] : null;
        $kind = (string) $payload['movement_kind'];
        $method = is_string($payload['method'] ?? null) ? $payload['method'] : 'CASH';
        $signedAmount = is_int($payload['signed_amount'] ?? null) ? $payload['signed_amount'] : 0;
        $categoryId = is_string($payload['expense_category_id'] ?? null) ? $payload['expense_category_id'] : null;
        $approvalId = is_string($payload['approval_id'] ?? null) ? $payload['approval_id'] : null;

        if ($context->source === CommandSource::Sync && $kind !== 'EXPENSE') {
            throw BusinessError::forbidden('Seules les dépenses peuvent être synchronisées depuis un poste ; les dépôts, retraits et corrections passent en ligne.');
        }

        $at = CarbonImmutable::now('UTC');
        $occurredAt = $context->pieceInstant($at)->format('Y-m-d H:i:s.u');
        try {
            CashMovements::assertShape($kind, $method, $sessionId, $signedAmount, $categoryId);
            $reason = Text::optional(is_string($payload['reason'] ?? null) ? $payload['reason'] : null, CashMovements::REASON_MAX, 'reason');
            $reference = Text::optional(is_string($payload['reference'] ?? null) ? $payload['reference'] : null, CashMovements::REFERENCE_MAX, 'reference');
            if (is_string($payload['occurred_at'] ?? null)) {
                $claimed = Instant::parse($payload['occurred_at'], 'occurred_at');
                $skew = ((int) config('eeo.offline.max_clock_skew_seconds', 300)) * 1000;
                if ($claimed !== null && $claimed->epochMilliseconds > ((int) $at->format('Uv')) + $skew) {
                    throw RuleViolation::invalid('occurred_at', 'cash.future_instant', 'L\'horloge du poste est en avance sur celle du serveur : vérifiez l\'heure de l\'appareil.');
                }
            }
        } catch (RuleViolation $violation) {
            throw BusinessError::validation([$violation->field => [$violation->getMessage()]]);
        }

        if ($kind !== 'EXPENSE' && ($reason === null || mb_strlen($reason) < CashMovements::REASON_MIN)) {
            throw BusinessError::validation(['reason' => ['Indiquez le motif du mouvement (au moins '.CashMovements::REASON_MIN.' caractères).']]);
        }
        if ($reason !== null && mb_strlen($reason) < CashMovements::REASON_MIN) {
            throw BusinessError::validation(['reason' => ['Un motif renseigné comporte au moins '.CashMovements::REASON_MIN.' caractères.']]);
        }
        if ($kind !== 'EXPENSE' && $approvalId === null) {
            throw BusinessError::validation(['approval_id' => ['L\'identifiant d\'autorisation est obligatoire pour ce mouvement.']]);
        }
        if (DB::table('cash_movements')->where('id', $movementId)->exists()) {
            throw BusinessError::validation(['movement_id' => ['Cet identifiant de mouvement est déjà utilisé.']]);
        }

        if ($sessionId !== null) {
            $session = $locks->cashSession($sessionId);
            if ($session === null) {
                throw BusinessError::notFound('Session de caisse introuvable dans ce cabinet.');
            }
            if ($session->closed_at !== null) {
                throw BusinessError::stateRefused('Cette session de caisse est clôturée : elle est figée, aucun mouvement ne s\'y ajoute.', 'CLOSED');
            }
            if ((string) $session->cashier_id !== (string) $context->actorId && ! $this->rights->has($context, 'cash.manage')) {
                throw BusinessError::forbidden('Cette session appartient à une autre caissière.');
            }
            $available = CashSessions::theoretical($session);
            if ($signedAmount < 0 && $available + $signedAmount < 0) {
                throw new BusinessError(
                    'VALIDATION_FAILED',
                    'Le tiroir ne contient en théorie que '.$available.' FCFA : une sortie ne peut pas dépasser les espèces présentes.',
                    422,
                    ['signed_amount' => ['Espèces théoriques disponibles : '.$available.' FCFA.']],
                    null,
                    [],
                    ['available' => $available],
                );
            }
        }

        if ($categoryId !== null && ! CashMovements::activeCategory($context->clinicId, $categoryId)) {
            throw BusinessError::validation(['expense_category_id' => ['Catégorie de dépense introuvable ou désactivée.']]);
        }

        $recordedApprovalId = null;
        $approvalMode = null;
        if ($kind !== 'EXPENSE' && $sessionId !== null && $approvalId !== null) {
            $authorization = $this->approvals->authorize($locks, $context, $approvalId, ApprovalSubject::cashMovement($sessionId, $kind, $signedAmount, $categoryId), (string) $reason);
            $recordedApprovalId = $authorization['id'];
            $approvalMode = $authorization['mode'];
        }

        $now = $at->format('Y-m-d H:i:s.u');
        DB::table('cash_movements')->insert([
            'id' => $movementId,
            'clinic_id' => $context->clinicId,
            'cash_session_id' => $sessionId,
            'kind' => $kind,
            'method' => $method,
            'signed_amount' => $signedAmount,
            'reason' => $reason,
            'approval_id' => $recordedApprovalId,
            'expense_category_id' => $categoryId,
            'reference' => $reference,
            'occurred_at' => $occurredAt,
            'created_by' => (string) $context->actorId,
            'source_device_id' => $context->deviceId,
            'sync_command_id' => $context->syncReferences?->commandId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return new CommandOutcome(
            result: ['movement_id' => $movementId, 'cash_session_id' => $sessionId, 'method' => $method, 'signed_amount' => $signedAmount, 'approval_mode' => $approvalMode],
            resultType: 'cash_movements',
            resultId: $movementId,
            audit: [new AuditEntry('cash.movement_recorded', 'cash_movements', $movementId, $reason, [
                'cash_session_id' => $sessionId,
                'movement_kind' => $kind,
                'method' => $method,
                'signed_amount' => $signedAmount,
                'expense_category_id' => $categoryId,
                'approval_id' => $recordedApprovalId,
                'approval_mode' => $approvalMode,
                'source_device_id' => $context->deviceId,
            ])],
            changes: [new ChangeRecord('cash_movements', $movementId, 1, ChangeVisibility::Financial, ChangeKind::Created)],
        );
    }
}

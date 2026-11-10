<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;

/**
 * Suppression d'un brouillon de réception jamais validé (L1D01) : droit `stock.receive`, EN LIGNE seulement. Règle
 * du projet : seul un brouillon jamais utilisé se supprime ; une réception validée est définitive (la base refuse de la
 * modifier ou de la supprimer, et une erreur se corrige par un ajustement approuvé). Un brouillon n'ayant jamais touché
 * au stock, sa suppression n'efface aucun fait ; l'audit garde la référence de livraison et le nombre de lignes.
 */
final class DeleteGoodsReceiptDraftHandler implements CommandHandler
{
    public const COMMAND = 'DeleteGoodsReceiptDraft';

    public function permissions(): array
    {
        return ['stock.receive'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $receiptId = $command->entityId;
        if ($receiptId === null) {
            throw BusinessError::notFound('Réception introuvable dans ce cabinet.');
        }
        $receipt = DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $receiptId)->first();
        if ($receipt === null) {
            throw BusinessError::notFound('Réception introuvable dans ce cabinet.');
        }
        if ((string) $receipt->status !== 'DRAFT') {
            throw BusinessError::stateRefused('Seul un brouillon de réception se supprime : une réception validée est définitive.', (string) $receipt->status);
        }

        $lines = DB::table('goods_receipt_lines')->where('clinic_id', $context->clinicId)->where('receipt_id', $receiptId)->count();
        DB::table('goods_receipt_lines')->where('clinic_id', $context->clinicId)->where('receipt_id', $receiptId)->delete();
        DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $receiptId)->delete();

        return new CommandOutcome(
            result: ['receipt_id' => $receiptId, 'deleted' => true],
            resultType: 'goods_receipts',
            resultId: $receiptId,
            audit: [new AuditEntry('stock.receipt_draft_deleted', 'goods_receipts', $receiptId, null, [
                'supplier_reference' => (string) $receipt->supplier_reference,
                'lines' => $lines,
            ])],
        );
    }
}

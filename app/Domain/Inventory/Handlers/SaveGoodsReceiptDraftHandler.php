<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Money;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Brouillon de réception fournisseur (L1D01, EE026, fichier 03 : « Réception fournisseur : quantité, coût et origine
 * documentés, validés »). Création (`entityId` nul) ou remplacement complet d'un brouillon : en-tête et lignes
 * (article, quantité, coût unitaire connu ou explicitement inconnu `null`, jamais zéro inventé). Droit `stock.receive`,
 * EN LIGNE seulement.
 *
 * Un brouillon ne touche JAMAIS au stock : ni position, ni lot, ni mouvement. Le lot (numéro, expiration) et la
 * confirmation du coût se donnent à la validation (`ValidateGoodsReceipt`), qui écrit les lots et les mouvements puis
 * finalise la réception dans la même transaction (fichier 23 : enfants écrits avant le statut final).
 *
 * La référence de livraison (bon ou facture du fournisseur) est unique par fournisseur : une même livraison ne se
 * saisit pas deux fois. Un brouillon se supprime (`DeleteGoodsReceiptDraft`) pour libérer sa référence.
 */
final class SaveGoodsReceiptDraftHandler implements CommandHandler
{
    public const COMMAND = 'SaveGoodsReceiptDraft';

    public function permissions(): array
    {
        return ['stock.receive'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->actorId === null) {
            throw new \LogicException('Un brouillon de réception a toujours un auteur identifié.');
        }
        $payload = $command->payload;
        $errors = new FieldErrors;
        $at = $context->now->utc();
        $now = $at->format('Y-m-d H:i:s.u');

        $supplierId = (string) $payload['supplier_id'];
        $locationId = (string) $payload['location_id'];
        $supplier = DB::table('suppliers')->where('clinic_id', $context->clinicId)->where('id', $supplierId)->first();
        if ($supplier === null || ! (bool) $supplier->active) {
            $errors->add('supplier_id', 'Fournisseur introuvable ou désactivé.');
        }
        $location = DB::table('stock_locations')->where('clinic_id', $context->clinicId)->where('id', $locationId)->first();
        if ($location === null || ! (bool) $location->active) {
            $errors->add('location_id', 'Emplacement introuvable ou désactivé.');
        }
        $reference = Text::trim((string) $payload['supplier_reference']);
        if ($reference === '') {
            $errors->add('supplier_reference', 'La référence de livraison (bon ou facture du fournisseur) est obligatoire.');
        }
        $notes = null;
        try {
            $notes = Text::optional(is_string($payload['notes'] ?? null) ? $payload['notes'] : null, 2000, 'notes');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        $receivedAt = null;
        try {
            $receivedAt = Instant::parse((string) $payload['received_at'], 'received_at');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        $skew = ((int) config('eeo.offline.max_clock_skew_seconds', 300)) * 1000;
        if ($receivedAt === null) {
            $errors->add('received_at', 'La date de réception est obligatoire.');
        } elseif ($receivedAt->epochMilliseconds > ((int) $at->format('Uv')) + $skew) {
            $errors->add('received_at', 'La date de réception ne peut pas être dans le futur.');
        }

        $existing = null;
        if ($command->entityId !== null) {
            $existing = DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $command->entityId)->first();
            if ($existing === null) {
                throw BusinessError::notFound('Réception introuvable dans ce cabinet.');
            }
            if ((string) $existing->status !== 'DRAFT') {
                throw BusinessError::stateRefused('Seul un brouillon de réception se modifie : une réception validée est définitive.', (string) $existing->status);
            }
        }
        if ($reference !== '') {
            $clash = DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('supplier_id', $supplierId)->where('supplier_reference', $reference);
            if ($existing !== null) {
                $clash->where('id', '<>', $existing->id);
            }
            if ($clash->exists()) {
                $errors->add('supplier_reference', 'Une réception porte déjà cette référence de livraison pour ce fournisseur.');
            }
        }

        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $payload['lines']);
        $itemIds = array_values(array_unique(array_map(static fn (array $line): string => (string) $line['item_id'], $lines)));
        $items = DB::table('catalog_items')->where('clinic_id', $context->clinicId)->whereIn('id', $itemIds)->get()->keyBy('id');
        $prepared = [];
        foreach ($lines as $index => $line) {
            $prefix = 'lines.'.$index;
            $item = $items->get((string) $line['item_id']);
            if ($item === null) {
                $errors->add($prefix.'.item_id', 'Article introuvable dans ce cabinet.');
            } elseif (! (bool) $item->active || (string) $item->stock_mode !== 'STOCKED') {
                $errors->add($prefix.'.item_id', 'Seul un article actif géré en stock se reçoit.');
            }
            $quantity = null;
            try {
                $quantity = Quantity::parse((string) $line['quantity'], 'quantity');
                if ($quantity === null) {
                    $errors->add($prefix.'.quantity', 'La quantité est obligatoire.');
                } else {
                    Quantity::forLine($quantity, $item === null ? false : (bool) $item->quantity_integer_only, 'quantity');
                }
            } catch (RuleViolation $violation) {
                $errors->addViolation($prefix, $violation);
                $quantity = null;
            }
            $unitCost = $line['unit_cost'] ?? null;
            if ($unitCost !== null) {
                try {
                    $unitCost = Money::amount((int) $unitCost, 'unit_cost');
                } catch (RuleViolation $violation) {
                    $errors->addViolation($prefix, $violation);
                }
            }
            $prepared[] = ['item_id' => (string) $line['item_id'], 'quantity' => $quantity, 'unit_cost' => $unitCost];
        }
        $errors->throwIfAny();
        if ($receivedAt === null) {
            throw new \LogicException('Saisie acceptée incomplète.');
        }

        $receivedDb = CarbonImmutable::createFromTimestampMsUTC($receivedAt->epochMilliseconds)->format('Y-m-d H:i:s.u');
        $receiptId = $existing === null ? Ulid::generate() : (string) $existing->id;
        $header = [
            'supplier_id' => $supplierId,
            'location_id' => $locationId,
            'supplier_reference' => $reference,
            'received_at' => $receivedDb,
            'notes' => $notes,
            'updated_at' => $now,
        ];
        if ($existing === null) {
            DB::table('goods_receipts')->insert($header + [
                'id' => $receiptId,
                'clinic_id' => $context->clinicId,
                'status' => 'DRAFT',
                'created_by' => $context->actorId,
                'created_at' => $now,
            ]);
        } else {
            DB::table('goods_receipt_lines')->where('clinic_id', $context->clinicId)->where('receipt_id', $receiptId)->delete();
            DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $receiptId)->update($header);
        }
        $unknownCosts = 0;
        foreach ($prepared as $index => $line) {
            if ($line['unit_cost'] === null) {
                $unknownCosts++;
            }
            DB::table('goods_receipt_lines')->insert([
                'id' => Ulid::generate(),
                'clinic_id' => $context->clinicId,
                'receipt_id' => $receiptId,
                'position' => $index + 1,
                'item_id' => $line['item_id'],
                'location_id' => $locationId,
                'stock_lot_id' => null,
                'quantity' => $line['quantity']?->canonical(),
                'unit_cost' => $line['unit_cost'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        return new CommandOutcome(
            result: ['receipt_id' => $receiptId, 'status' => 'DRAFT', 'line_count' => count($prepared)],
            resultType: 'goods_receipts',
            resultId: $receiptId,
            audit: [new AuditEntry($existing === null ? 'stock.receipt_draft_created' : 'stock.receipt_draft_updated', 'goods_receipts', $receiptId, null, [
                'supplier_reference' => $reference,
                'lines' => count($prepared),
                'unknown_cost_lines' => $unknownCosts,
            ])],
        );
    }
}

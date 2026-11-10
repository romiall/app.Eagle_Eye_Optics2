<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Money;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Text;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;
use Normalizer;
use stdClass;

/**
 * Validation d'une réception fournisseur (L1D01, EE026, EE027, AT30) : le stock n'augmente QUE par une réception
 * validée. Droit `stock.receive`, EN LIGNE seulement, clé d'idempotence obligatoire (les mouvements portent
 * l'identifiant de la commande : un rejeu rend la réponse d'origine, il ne reçoit pas deux fois).
 *
 * La charge confirme CHAQUE ligne du brouillon (par son numéro) : le lot (numéro et expiration) et le coût unitaire
 * final, connu ou explicitement inconnu (`null`, jamais zéro inventé). Dans une seule transaction : positions et lots
 * trouvés ou créés, un mouvement `RECEIPT` par ligne (`goods_receipt_line_id`), lignes complétées (`stock_lot_id`,
 * coût), puis réception passée à `VALIDATED` (le parent est finalisé APRÈS ses enfants, fichier 23 ; ensuite la base
 * refuse toute modification, `04_history_guards.sql`).
 *
 * Règles : article actif géré en stock ; lot et expiration obligatoires pour un article périssable (collyre) et pour
 * toute position déjà suivie par lots ; un lot expiré à la date locale de réception est refusé ; un lot existant garde
 * son expiration, son coût (tant qu'il a du stock) et son statut : un lot en quarantaine ne reçoit rien ; un coût
 * inconnu reste inconnu. Les projections (`stock_positions`, `stock_lots`) sont écrites avec leurs mouvements.
 *
 * Verrous : cabinet, idempotence, positions (80) puis lots (81) existants ; les lignes créées ici n'existent pour
 * personne d'autre.
 */
final class ValidateGoodsReceiptHandler implements CommandHandler
{
    public const COMMAND = 'ValidateGoodsReceipt';

    public function permissions(): array
    {
        return ['stock.receive'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($idempotencyId === null || $context->actorId === null || $command->entityId === null) {
            throw new LogicException('Une réception validée exige une clé d\'idempotence, un auteur identifié et une réception visée.');
        }
        $receiptId = $command->entityId;
        $at = $context->now->utc();
        $now = $at->format('Y-m-d H:i:s.u');
        $errors = new FieldErrors;

        $receipt = DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $receiptId)->first();
        if ($receipt === null) {
            throw BusinessError::notFound('Réception introuvable dans ce cabinet.');
        }
        if ((string) $receipt->status !== 'DRAFT') {
            throw BusinessError::stateRefused('Seul un brouillon de réception se valide : cette réception est déjà finalisée.', (string) $receipt->status);
        }
        $locationId = (string) $receipt->location_id;
        $supplier = DB::table('suppliers')->where('clinic_id', $context->clinicId)->where('id', (string) $receipt->supplier_id)->first();
        if ($supplier === null || ! (bool) $supplier->active) {
            $errors->add('supplier_id', 'Ce fournisseur est désactivé : réactivez-le avant de valider la réception.');
        }
        $location = DB::table('stock_locations')->where('clinic_id', $context->clinicId)->where('id', $locationId)->first();
        if ($location === null || ! (bool) $location->active) {
            $errors->add('location_id', 'Cet emplacement est désactivé : la réception ne peut plus y entrer.');
        }

        $stored = DB::table('goods_receipt_lines')->where('clinic_id', $context->clinicId)->where('receipt_id', $receiptId)->orderBy('position')->get();
        if ($stored->isEmpty()) {
            throw BusinessError::validation(['lines' => ['Cette réception n\'a aucune ligne : ajoutez-en avant de la valider.']]);
        }

        // La charge confirme chaque ligne du brouillon, ni plus, ni moins.
        /** @var array<int, array<string, mixed>> $given */
        $given = [];
        foreach (array_values((array) $command->payload['lines']) as $index => $input) {
            /** @var array<string, mixed> $input */
            $position = (int) $input['position'];
            if (isset($given[$position])) {
                $errors->add('lines.'.$index.'.position', 'Cette ligne est confirmée deux fois.');

                continue;
            }
            $given[$position] = ['index' => $index] + $input;
        }
        $storedPositions = array_map(static fn (stdClass $line): int => (int) $line->position, $stored->all());
        foreach ($given as $position => $input) {
            if (! in_array($position, $storedPositions, true)) {
                $errors->add('lines.'.$input['index'].'.position', 'Cette ligne n\'existe pas dans le brouillon.');
            }
        }
        foreach ($storedPositions as $position) {
            if (! isset($given[$position])) {
                $errors->add('lines', 'La ligne '.$position.' doit être confirmée (lot et coût).');
            }
        }

        $itemIds = array_values(array_unique(array_map(static fn (stdClass $line): string => (string) $line->item_id, $stored->all())));
        $items = DB::table('catalog_items')->where('clinic_id', $context->clinicId)->whereIn('id', $itemIds)->get()->keyBy('id');
        $positionRows = DB::table('stock_positions')->where('clinic_id', $context->clinicId)->where('location_id', $locationId)->whereIn('item_id', $itemIds)->get()->keyBy('item_id');
        $timezone = (string) $locks->clinic()->timezone;
        $receivedMs = (int) CarbonImmutable::parse((string) $receipt->received_at, 'UTC')->format('Uv');
        $receivedLocal = Instant::fromEpochMilliseconds($receivedMs)->civilDate($timezone, 'received_at');

        /** @var list<array{line: stdClass, item_id: string, quantity: FixedDecimal, cost: int|null, lot_key: string|null}> $plans */
        $plans = [];
        /** @var array<string, array{item_id: string, batch: string, expires_on: string|null, cost: int|null, existing: stdClass|null, lot_id: string, delta: FixedDecimal}> $lotPlans */
        $lotPlans = [];
        foreach ($stored as $line) {
            $position = (int) $line->position;
            $input = $given[$position] ?? null;
            if ($input === null) {
                continue;
            }
            $prefix = 'lines.'.$input['index'];
            $itemId = (string) $line->item_id;
            $item = $items->get($itemId);
            if ($item === null || ! (bool) $item->active || (string) $item->stock_mode !== 'STOCKED') {
                $errors->add($prefix.'.position', 'Cet article n\'est plus un article actif géré en stock.');

                continue;
            }
            $quantity = Quantity::of((string) $line->quantity);
            $cost = $input['unit_cost'] ?? null;
            if ($cost !== null) {
                try {
                    $cost = Money::amount((int) $cost, 'unit_cost');
                } catch (RuleViolation $violation) {
                    $errors->addViolation($prefix, $violation);
                    $cost = null;
                }
            }

            $positionRow = $positionRows->get($itemId);
            $hasLots = $positionRow !== null && DB::table('stock_lots')->where('clinic_id', $context->clinicId)->where('stock_position_id', (string) $positionRow->id)->exists();
            $lotInput = is_array($input['lot'] ?? null) ? $input['lot'] : null;
            if ($lotInput === null) {
                if ((bool) $item->requires_expiry) {
                    $errors->add($prefix.'.lot', 'Un article périssable ne se reçoit que sur un lot daté : indiquez le numéro de lot et l\'expiration.');
                } elseif ($hasLots) {
                    $errors->add($prefix.'.lot', 'Cet article est suivi par lots : indiquez le lot reçu.');
                }
                $plans[] = ['line' => $line, 'item_id' => $itemId, 'quantity' => $quantity, 'cost' => is_int($cost) ? $cost : null, 'lot_key' => null];

                continue;
            }

            $batch = Text::trim((string) $lotInput['batch_number']);
            if ($batch === '') {
                $errors->add($prefix.'.lot.batch_number', 'Le numéro de lot est obligatoire.');

                continue;
            }
            $expires = null;
            if (($lotInput['expires_on'] ?? null) !== null) {
                try {
                    $expires = CivilDate::fromString((string) $lotInput['expires_on'], 'expires_on');
                } catch (RuleViolation $violation) {
                    $errors->addViolation($prefix.'.lot', $violation);

                    continue;
                }
            }
            if ((bool) $item->requires_expiry && $expires === null) {
                $errors->add($prefix.'.lot.expires_on', 'Un article périssable exige la date d\'expiration du lot.');
            }
            if ($expires !== null && $expires->compare($receivedLocal) < 0) {
                $errors->add($prefix.'.lot.expires_on', 'Ce lot est déjà expiré à la date de réception : il ne peut pas entrer en stock.');
            }
            $expiresText = $expires?->toString();
            $moneyCost = is_int($cost) ? $cost : null;

            $key = $itemId.'|'.self::batchKey($batch);
            if (isset($lotPlans[$key])) {
                $planned = $lotPlans[$key];
                if ($planned['batch'] !== $batch) {
                    $errors->add($prefix.'.lot.batch_number', 'Ce lot est donné sous deux écritures différentes dans cette réception : saisissez le même numéro.');
                } elseif ($planned['expires_on'] !== $expiresText || $planned['cost'] !== $moneyCost) {
                    $errors->add($prefix.'.lot', 'Ce lot est donné avec une autre expiration ou un autre coût sur une autre ligne de cette réception.');
                } else {
                    $lotPlans[$key]['delta'] = $planned['delta']->plus($quantity);
                }
                $plans[] = ['line' => $line, 'item_id' => $itemId, 'quantity' => $quantity, 'cost' => $moneyCost, 'lot_key' => $key];

                continue;
            }

            $existingLot = DB::table('stock_lots')->where('clinic_id', $context->clinicId)->where('item_id', $itemId)->where('location_id', $locationId)->where('batch_number', $batch)->first();
            if ($existingLot !== null) {
                $lotExpires = $existingLot->expires_on === null ? null : (string) $existingLot->expires_on;
                if ($lotExpires !== $expiresText) {
                    $errors->add($prefix.'.lot.expires_on', 'Ce lot existe déjà avec '.($lotExpires === null ? 'aucune date d\'expiration' : 'l\'expiration du '.$lotExpires).' : une autre date ne s\'écrit pas sur un lot connu.');
                }
                if ((string) $existingLot->status !== 'SELLABLE') {
                    $errors->add($prefix.'.lot.batch_number', 'Ce lot est en quarantaine : il ne reçoit pas de nouvelle marchandise (choisissez un autre numéro de lot).');
                }
                $lotCost = $existingLot->unit_cost === null ? null : (int) $existingLot->unit_cost;
                if (Quantity::of((string) $existingLot->on_hand)->units > 0 && $lotCost !== $moneyCost) {
                    $errors->add($prefix.'.unit_cost', 'Ce lot existe déjà avec '.($lotCost === null ? 'un coût inconnu' : 'un coût de '.$lotCost.' FCFA').' : le coût d\'un lot en stock ne change pas (choisissez un autre numéro de lot).');
                }
            }
            $lotPlans[$key] = [
                'item_id' => $itemId,
                'batch' => $batch,
                'expires_on' => $expiresText,
                'cost' => $moneyCost,
                'existing' => $existingLot,
                'lot_id' => $existingLot === null ? Ulid::generate() : (string) $existingLot->id,
                'delta' => $quantity,
            ];
            $plans[] = ['line' => $line, 'item_id' => $itemId, 'quantity' => $quantity, 'cost' => $moneyCost, 'lot_key' => $key];
        }
        $errors->throwIfAny();

        // 1. Verrous : positions (80) puis lots (81) déjà existants, par identifiant trié (la classe trie).
        $existingPositionIds = array_values(array_map(static fn (stdClass $row): string => (string) $row->id, $positionRows->all()));
        $lockedPositions = $locks->stockPositions($existingPositionIds);
        $existingLotIds = [];
        foreach ($lotPlans as $planned) {
            if ($planned['existing'] !== null) {
                $existingLotIds[] = (string) $planned['existing']->id;
            }
        }
        $lockedLots = $locks->stockLots($existingLotIds);

        // 2. Totaux par position (créée au besoin) et par lot.
        /** @var array<string, FixedDecimal> $positionDelta */
        $positionDelta = [];
        foreach ($plans as $plan) {
            $positionDelta[$plan['item_id']] = ($positionDelta[$plan['item_id']] ?? FixedDecimal::fromUnits(0, Quantity::SCALE))->plus($plan['quantity']);
        }
        /** @var array<string, string> $positionIdByItem */
        $positionIdByItem = [];
        /** @var list<ChangeRecord> $changes */
        $changes = [];
        foreach ($positionDelta as $itemId => $delta) {
            $row = $lockedPositions[(string) ($positionRows->get($itemId)->id ?? '')] ?? null;
            if ($row === null) {
                $positionId = Ulid::generate();
                DB::table('stock_positions')->insert([
                    'id' => $positionId,
                    'clinic_id' => $context->clinicId,
                    'item_id' => $itemId,
                    'location_id' => $locationId,
                    'on_hand' => Quantity::bounded($delta->units, 'on_hand')->canonical(),
                    'reserved' => '0.000',
                    'offline_allocated' => '0.000',
                    'version' => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $changes[] = new ChangeRecord('stock_positions', $positionId, 1, ChangeVisibility::Financial, ChangeKind::Created);
            } else {
                $positionId = (string) $row->id;
                $version = (int) $row->version + 1;
                DB::table('stock_positions')->where('clinic_id', $context->clinicId)->where('id', $positionId)->update([
                    'on_hand' => Quantity::bounded(Quantity::of((string) $row->on_hand)->units + $delta->units, 'on_hand')->canonical(),
                    'version' => $version,
                    'updated_at' => $now,
                ]);
                $changes[] = new ChangeRecord('stock_positions', $positionId, $version, ChangeVisibility::Financial, ChangeKind::Updated);
            }
            $positionIdByItem[$itemId] = $positionId;
        }

        $receivedDb = CarbonImmutable::createFromTimestampMsUTC($receivedMs)->format('Y-m-d H:i:s.u');
        $lotsCreated = 0;
        foreach ($lotPlans as $planned) {
            if ($planned['existing'] === null) {
                $lotsCreated++;
                DB::table('stock_lots')->insert([
                    'id' => $planned['lot_id'],
                    'clinic_id' => $context->clinicId,
                    'item_id' => $planned['item_id'],
                    'location_id' => $locationId,
                    'stock_position_id' => $positionIdByItem[$planned['item_id']],
                    'batch_number' => $planned['batch'],
                    'expires_on' => $planned['expires_on'],
                    'received_at' => $receivedDb,
                    'unit_cost' => $planned['cost'],
                    'status' => 'SELLABLE',
                    'on_hand' => Quantity::bounded($planned['delta']->units, 'on_hand')->canonical(),
                    'reserved' => '0.000',
                    'offline_allocated' => '0.000',
                    'version' => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                continue;
            }
            $row = $lockedLots[$planned['lot_id']] ?? null;
            if ($row === null) {
                throw BusinessError::notFound('Lot de stock introuvable dans ce cabinet.');
            }
            $update = [
                'on_hand' => Quantity::bounded(Quantity::of((string) $row->on_hand)->units + $planned['delta']->units, 'on_hand')->canonical(),
                'version' => (int) $row->version + 1,
                'updated_at' => $now,
            ];
            if (Quantity::of((string) $row->on_hand)->units === 0) {
                // Un lot vidé qui reçoit de nouveau : son coût est celui de cette réception (inconnu s'il l'est).
                $update['unit_cost'] = $planned['cost'];
            }
            DB::table('stock_lots')->where('clinic_id', $context->clinicId)->where('id', $planned['lot_id'])->update($update);
        }

        // 3. Lignes complétées PUIS un mouvement par ligne, avant la finalisation du parent.
        $movementIds = [];
        $unknownCosts = 0;
        $movementPosition = 0;
        foreach ($plans as $plan) {
            $lotId = $plan['lot_key'] === null ? null : $lotPlans[$plan['lot_key']]['lot_id'];
            if ($plan['cost'] === null) {
                $unknownCosts++;
            }
            DB::table('goods_receipt_lines')->where('clinic_id', $context->clinicId)->where('id', (string) $plan['line']->id)->update([
                'stock_lot_id' => $lotId,
                'unit_cost' => $plan['cost'],
                'updated_at' => $now,
            ]);
            $movementPosition++;
            $movementId = Ulid::generate();
            $movementIds[] = $movementId;
            DB::table('stock_movements')->insert([
                'id' => $movementId,
                'clinic_id' => $context->clinicId,
                'movement_position' => $movementPosition,
                'item_id' => $plan['item_id'],
                'position_id' => $positionIdByItem[$plan['item_id']],
                'lot_id' => $lotId,
                'kind' => 'RECEIPT',
                'signed_quantity' => $plan['quantity']->canonical(),
                'unit_cost' => $plan['cost'],
                'goods_receipt_line_id' => (string) $plan['line']->id,
                'reason' => 'Réception fournisseur : '.(string) $receipt->supplier_reference,
                'occurred_at' => $receivedDb,
                'actor_id' => $context->actorId,
                'idempotency_id' => $idempotencyId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        DB::table('goods_receipts')->where('clinic_id', $context->clinicId)->where('id', $receiptId)->update([
            'status' => 'VALIDATED',
            'validated_by' => $context->actorId,
            'validated_at' => $now,
            'updated_at' => $now,
        ]);

        return new CommandOutcome(
            result: ['receipt_id' => $receiptId, 'status' => 'VALIDATED', 'movement_ids' => $movementIds, 'unknown_cost_lines' => $unknownCosts],
            resultType: 'goods_receipts',
            resultId: $receiptId,
            audit: [new AuditEntry('stock.receipt_validated', 'goods_receipts', $receiptId, null, [
                'supplier_reference' => (string) $receipt->supplier_reference,
                'lines' => count($plans),
                'movements' => count($movementIds),
                'lots_created' => $lotsCreated,
                'unknown_cost_lines' => $unknownCosts,
            ])],
            changes: $changes,
        );
    }

    /**
     * Clé de comparaison d'un numéro de lot : la base ignore casse et accents (`utf8mb4_0900_ai_ci`), deux écritures qui
     * ne diffèrent que par là désignent le MÊME lot.
     */
    private static function batchKey(string $batch): string
    {
        $decomposed = Normalizer::normalize($batch, Normalizer::FORM_D);
        $plain = (string) preg_replace('/\p{Mn}+/u', '', $decomposed === false ? $batch : $decomposed);

        return mb_strtolower($plain, 'UTF-8');
    }
}

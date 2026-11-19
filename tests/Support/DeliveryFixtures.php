<?php

namespace Tests\Support;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * Remises au patient (I01), retours physiques et mouvements hors vente (I02) par l'API réelle, données FICTIVES.
 * S'utilise avec `BillingFixtures` et `ApprovalFixtures` (cabinet, comptes, catalogue, factures, approbations).
 */
trait DeliveryFixtures
{
    /**
     * Ligne de remise par la route directe : position, lot, réserve et mouvement à null (le serveur choisit).
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function deliveryLine(string $invoiceLineId, string $itemId, string $quantity = '1', array $overrides = []): array
    {
        return array_merge([
            'delivery_line_id' => Ulid::generate(),
            'invoice_line_id' => $invoiceLineId,
            'item_id' => $itemId,
            'quantity' => $quantity,
            'stock_position_id' => null,
            'stock_lot_id' => null,
            'reservation_id' => null,
            'stock_movement_id' => null,
        ], $overrides);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function deliveryBody(string $invoiceId, array $lines, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'delivery_id' => Ulid::generate(),
            'invoice_id' => $invoiceId,
            'delivered_at' => self::NOW,
            'credit_delivery_approval_id' => null,
            'lines' => $lines,
        ], $overrides);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $overrides
     */
    protected function deliver(string $invoiceId, array $lines, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->write('POST', '/api/v1/invoices/'.$invoiceId.'/deliveries', $this->deliveryBody($invoiceId, $lines, $overrides), $as, $key);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function returnBody(string $deliveryLineId, string $itemId, string $quantity, User $approvedBy, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'physical_return_id' => Ulid::generate(),
            'delivery_line_id' => $deliveryLineId,
            'item_id' => $itemId,
            'quantity' => $quantity,
            'condition_code' => 'SELLABLE',
            'accepted_for_restock' => true,
            'approved_by' => $approvedBy->id,
            'occurred_at' => self::NOW,
            'reason' => 'Monture ne convenant pas, rapportée intacte (fictif)',
            'credit_note_id' => null,
            'stock_movement_id' => Ulid::generate(),
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function movementBody(string $itemId, string $positionId, string $signedQuantity, string $kind = 'BREAKAGE', array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'movement_id' => Ulid::generate(),
            'item_id' => $itemId,
            'position_id' => $positionId,
            'lot_id' => null,
            'kind' => $kind,
            'signed_quantity' => $signedQuantity,
            'unit_cost' => null,
            'approval_id' => Ulid::generate(),
            'reason' => 'Monture tombée pendant l\'essayage (fictif)',
            'occurred_at' => self::NOW,
        ], $overrides);
    }

    /** Ligne de facture à une position donnée (1 = première). */
    protected function invoiceLine(string $invoiceId, int $position = 1): string
    {
        return (string) DB::table('invoice_lines')->where('invoice_id', $invoiceId)->where('position', $position)->value('id');
    }

    /**
     * Facture émise par la gérante puis réglée en totalité : [facture, total].
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: string, 1: int}
     */
    protected function settledInvoice(array $lines): array
    {
        [$invoice, $total] = $this->issuedInvoice($lines, $this->manager);

        return [$invoice, $total];
    }

    /** Quantité physique d'une position (ou d'un lot), telle que MySQL la rend. */
    protected function onHand(string $table, string $id): string
    {
        return (string) DB::table($table)->where('id', $id)->value('on_hand');
    }
}

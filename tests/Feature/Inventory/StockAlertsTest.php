<?php

namespace Tests\Feature\Inventory;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\DeliveryFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Alertes de seuil de stock bas et de péremption (L1D03) :
 *  - seuil comparé au disponible central (`physique − réservé − quotas des postes`) ;
 *  - déduplication stricte (cli scheduler & API) sur `(clinic_id, dedupe_key)` et sur `StockThresholdCrossed` ;
 *  - résolution automatique sur réapprovisionnement, réouverture si nouvelle baisse ou passage en lot expiré ;
 *  - zéro mouvement de stock créé ; blocage effectif des lots expirés / en quarantaine à la remise.
 */
final class StockAlertsTest extends TestCase
{
    use BillingFixtures;
    use DeliveryFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        DB::table('catalog_items')->where('id', $this->item['frame'])->update([
            'low_stock_threshold' => '2.000',
            'updated_at' => '2026-10-22 08:00:00.000000',
        ]);
        DB::table('catalog_items')->where('id', $this->item['drops'])->update([
            'low_stock_threshold' => '1.000',
            'expiry_alert_days' => 15,
            'updated_at' => '2026-10-22 08:00:00.000000',
        ]);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_low_stock_uses_central_available_deduplicates_on_repeated_runs_and_recovers_on_replenishment(): void
    {
        // Physique 5, réservé 3, quota poste 1 => disponible central = 1 <= seuil 2 (malgré physique = 5).
        $posFrame = $this->seedPosition($this->item['frame'], '5.000', '3.000', '1.000');
        DB::table('stock_positions')->where('id', $posFrame)->update([
            'updated_at' => '2026-10-22 08:30:00.000000',
        ]);

        // Collyres largement disponibles (pas de seuil bas), lot qui expire dans 10 jours (fenêtre 15 j) + lot en quarantaine ignoré.
        $posDrops = $this->seedPosition($this->item['drops'], '6.000');
        $this->seedLot($posDrops, $this->item['drops'], 'LOT-EXP-BIENTOT', '2026-11-01', '4.000', 'SELLABLE');
        $this->seedLot($posDrops, $this->item['drops'], 'LOT-QUARANTAINE', '2026-10-25', '2.000', 'QUARANTINE');

        $eval1 = $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager);
        $eval1->assertOk()->assertJsonPath('data.opened', 2)->assertJsonPath('data.open_count', 2);

        // Exécution répétée via CLI scheduler et API : aucune alerte ni événement StockThresholdCrossed dupliqué, zéro mouvement.
        $this->artisan('eeo:stock:evaluate-alerts')->assertExitCode(0);
        $eval2 = $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager);
        $eval2->assertOk()
            ->assertJsonPath('data.opened', 0)
            ->assertJsonPath('data.reopened', 0)
            ->assertJsonPath('data.resolved', 0)
            ->assertJsonPath('data.open_count', 2);

        self::assertSame(2, DB::table('stock_alerts')->where('clinic_id', $this->clinicId)->count());
        self::assertSame(2, DB::table('outbox_events')->where('clinic_id', $this->clinicId)->where('event_type', 'StockThresholdCrossed')->count());
        self::assertSame(0, DB::table('stock_movements')->where('clinic_id', $this->clinicId)->count());

        // Lecture filtrée + contrat OpenAPI : vérifie les composantes physique/réservé/quota/disponible.
        $list = $this->read('/api/v1/stock/alerts?kind=LOW_STOCK', $this->cashier);
        $list->assertOk()->assertJsonCount(1, 'data');
        $frameAlertId = (string) $list->json('data.0.id');
        $list->assertJsonPath('data.0.on_hand', '5.000')
            ->assertJsonPath('data.0.reserved', '3.000')
            ->assertJsonPath('data.0.offline_allocated', '1.000')
            ->assertJsonPath('data.0.central_available', '1.000')
            ->assertJsonPath('data.0.low_stock_threshold', '2.000');
        $this->assertMatchesContract($list, 'schemas/resources/stock.json#/$defs/StockAlertPage');

        // Résolution manuelle avant réapprovisionnement : les runs suivants du scheduler ne la réouvrent pas sans nouveau mouvement.
        $this->write('POST', '/api/v1/stock/alerts/'.$frameAlertId.'/resolve', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.status', 'RESOLVED');

        $this->artisan('eeo:stock:evaluate-alerts')->assertExitCode(0);
        self::assertSame('RESOLVED', (string) DB::table('stock_alerts')->where('id', $frameAlertId)->value('status'));

        // Un nouvel ajustement ou sortie postérieur à la résolution réouvre l'alerte de seuil bas.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 10:00:00', 'UTC'));
        DB::table('stock_positions')->where('id', $posFrame)->update([
            'reserved' => '3.500',
            'updated_at' => '2026-10-22 10:00:00.000000',
        ]);
        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.reopened', 1);

        // Un réapprovisionnement via réception fournisseur validée fait repasser le disponible central au-dessus du seuil et résout l'alerte.
        $this->allowPermission($this->manager, 'stock.receive');
        $supplierId = $this->write('POST', '/api/v1/suppliers', [
            'expected_version' => null,
            'name' => 'Fournisseur Test',
            'reference' => 'FOU-TEST',
            'is_optical_lab' => false,
            'active' => true,
        ], $this->manager)->assertCreated()->json('data.id');

        $receiptId = $this->write('POST', '/api/v1/goods-receipts', [
            'expected_version' => null,
            'supplier_id' => $supplierId,
            'location_id' => $this->locationId,
            'supplier_reference' => 'BL-AL-01',
            'received_at' => '2026-10-22T09:00:00.000Z',
            'notes' => null,
            'lines' => [[
                'item_id' => $this->item['frame'],
                'quantity' => '10.000',
                'unit_cost' => 15000,
            ]],
        ], $this->manager)->assertCreated()->json('data.id');

        $this->actingAsReauthenticated($this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/goods-receipts/'.$receiptId.'/validate', [
                'expected_version' => null,
                'lines' => [[
                    'position' => 1,
                    'lot' => null,
                    'unit_cost' => 15000,
                ]],
            ])
            ->assertOk();

        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.resolved', 1);
        self::assertSame('RESOLVED', (string) DB::table('stock_alerts')->where('id', $frameAlertId)->value('status'));
    }

    public function test_expiry_alert_reopens_once_when_lot_crosses_expiration_and_delivery_blocks_expired_lot(): void
    {
        $this->seedPosition($this->item['frame'], '10.000');
        $posDrops = $this->seedPosition($this->item['drops'], '5.000');
        $lotId = $this->seedLot($posDrops, $this->item['drops'], 'LOT-COURANT', '2026-10-25', '3.000', 'SELLABLE');

        // 2026-10-22 : dans la fenêtre de 15 jours => alerte OPEN (expired = false), prise en compte par la gérante.
        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.opened', 1);
        $alertId = (string) DB::table('stock_alerts')->where('clinic_id', $this->clinicId)->where('kind', 'EXPIRY')->value('id');
        $this->write('POST', '/api/v1/stock/alerts/'.$alertId.'/acknowledge', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.status', 'ACKNOWLEDGED');

        // 2026-10-22 : facture émise et encaissée automatiquement en espèces (A1) avant expiration (lot vendable réservé).
        [$invoiceId] = $this->issuedInvoice([$this->line($this->item['drops'], '1')], $this->manager);
        $lineId = (string) DB::table('invoice_lines')->where('invoice_id', $invoiceId)->value('id');

        // 2026-10-26 : le lot vient de dépasser sa date de péremption (2026-10-25) => réouvre une seule fois en OPEN, zéro mouvement.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-26 09:05:00', 'UTC'));
        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.reopened', 1);
        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)
            ->assertOk()
            ->assertJsonPath('data.reopened', 0);

        $list = $this->read('/api/v1/stock/alerts?kind=EXPIRY', $this->manager);
        $list->assertOk()->assertJsonPath('data.0.expired', true)->assertJsonPath('data.0.status', 'OPEN');
        self::assertSame(0, DB::table('stock_movements')->where('clinic_id', $this->clinicId)->count());

        // Bloqué à la remise patient (aucun relâchement dû aux alertes) : même déjà réservé, un lot expiré est refusé en 422 LOT_EXPIRED.
        $this->deliver(
            $invoiceId,
            [$this->deliveryLine($lineId, $this->item['drops'], '1', ['stock_lot_id' => $lotId])],
            ['delivered_at' => '2026-10-26T09:05:00.000Z'],
            $this->manager,
        )->assertStatus(422)->assertJsonPath('error.code', 'LOT_EXPIRED');
    }

    public function test_read_only_staff_cannot_evaluate_acknowledge_or_resolve_alerts(): void
    {
        $posFrame = $this->seedPosition($this->item['frame'], '1.000');
        $this->seedLot($posFrame, $this->item['frame'], 'UNUSED', null, '1.000');

        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->cashier)->assertForbidden();
        $this->write('POST', '/api/v1/stock/alerts/evaluate', ['expected_version' => null], $this->manager)->assertOk();
        $alertId = (string) DB::table('stock_alerts')->where('clinic_id', $this->clinicId)->value('id');

        $this->write('POST', '/api/v1/stock/alerts/'.$alertId.'/acknowledge', ['expected_version' => null], $this->cashier)->assertForbidden();
        $this->write('POST', '/api/v1/stock/alerts/'.$alertId.'/resolve', ['expected_version' => null], $this->cashier)->assertForbidden();
    }
}

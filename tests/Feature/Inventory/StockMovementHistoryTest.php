<?php

namespace Tests\Feature\Inventory;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

/**
 * Historique des mouvements de stock d'un article (cahier des charges §6, EE026) : lecture seule, du plus récent au plus
 * ancien, avec motif, lot et auteur ; le coût unitaire n'est rendu qu'avec `stock.valuation.read`. Données fictives.
 */
final class StockMovementHistoryTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();

        $supplier = $this->write('POST', '/api/v1/suppliers', ['expected_version' => null, 'name' => 'Optique Distribution', 'reference' => 'FOU-001'], $this->manager);
        $supplier->assertCreated();
        $this->supplierId = (string) $supplier->json('data.id');
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Réception de montures à 18 000 FCFA, validée : un mouvement RECEIPT de plus.
     */
    private function receiveFrames(string $quantity, string $reference): void
    {
        $draft = $this->write('POST', '/api/v1/goods-receipts', ['expected_version' => null, 'supplier_id' => $this->supplierId, 'location_id' => $this->locationId,
            'supplier_reference' => $reference, 'received_at' => '2026-10-22T08:00:00.000Z', 'notes' => null,
            'lines' => [['item_id' => $this->item['frame'], 'quantity' => $quantity, 'unit_cost' => 18000]]], $this->manager);
        $draft->assertCreated();

        $this->actingAsReauthenticated($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/goods-receipts/'.$draft->json('data.id').'/validate', ['expected_version' => null, 'lines' => [['position' => 1, 'lot' => null, 'unit_cost' => 18000]]])
            ->assertOk();
    }

    private function history(string $query, ?User $as = null): TestResponse
    {
        return $this->read('/api/v1/stock/movements'.$query, $as ?? $this->manager);
    }

    public function test_la_gerante_lit_les_mouvements_d_un_article_avec_leur_cout(): void
    {
        $this->receiveFrames('5', 'BL-2026-0001');

        $response = $this->history('?item_id='.$this->item['frame']);

        $response->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.kind', 'RECEIPT')
            ->assertJsonPath('data.0.signed_quantity', '5.000')
            ->assertJsonPath('data.0.unit_cost', 18000)
            ->assertJsonPath('data.0.lot', null)
            ->assertJsonPath('meta.total', 1);
        $this->assertNotSame('', (string) $response->json('data.0.reason'));
        $this->assertNotNull($response->json('data.0.actor_name'));
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/StockMovementHistoryPage');
    }

    public function test_un_profil_qui_lit_le_stock_ne_voit_jamais_le_cout_d_achat(): void
    {
        $this->receiveFrames('5', 'BL-2026-0001');

        // La caissière consulte le stock (cahier des charges §2) : mouvements oui, coût non.
        $response = $this->history('?item_id='.$this->item['frame'], $this->cashier);

        $response->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.unit_cost', null);
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/StockMovementHistoryPage');
    }

    public function test_l_historique_va_du_plus_recent_au_plus_ancien_et_se_filtre_par_type(): void
    {
        $this->receiveFrames('5', 'BL-2026-0001');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-23 09:00:00', 'UTC'));
        $this->receiveFrames('2', 'BL-2026-0002');

        $all = $this->history('?item_id='.$this->item['frame']);

        $all->assertOk()->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.signed_quantity', '2.000')
            ->assertJsonPath('data.1.signed_quantity', '5.000');
        $this->history('?item_id='.$this->item['frame'].'&kind=RECEIPT')->assertOk()->assertJsonCount(2, 'data');
        $this->history('?item_id='.$this->item['frame'].'&kind=SALE_DELIVERY')->assertOk()->assertJsonCount(0, 'data');
        $this->history('?item_id='.$this->item['frame'].'&location_id='.$this->locationId)->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_les_entrees_invalides_sont_refusees_et_un_article_inconnu_est_introuvable(): void
    {
        $this->history('')->assertStatus(422);
        $this->history('?item_id=pas-un-ulid')->assertStatus(422);
        $this->history('?item_id='.$this->item['frame'].'&kind=INVENTE')->assertStatus(422);
        $this->history('?item_id='.$this->item['frame'].'&page=0')->assertStatus(422);
        $this->history('?item_id='.$this->item['frame'].'&location_id=x')->assertStatus(422);
        $this->history('?item_id='.Ulid::generate())->assertNotFound();
    }

    public function test_sans_le_droit_de_lire_le_stock_ou_module_ferme_l_historique_est_refuse(): void
    {
        $this->history('?item_id='.$this->item['frame'], $this->reception)->assertForbidden();

        config(['eeo.enabled_modules' => ['sales']]);
        $this->history('?item_id='.$this->item['frame'])->assertNotFound();
    }
}

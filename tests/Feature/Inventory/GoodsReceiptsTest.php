<?php

namespace Tests\Feature\Inventory;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Fournisseurs et réceptions fournisseur (L1D01, EE026, EE027, AT30) : le stock n'augmente que par une réception
 * validée ; un brouillon ne touche à rien ; un coût inconnu reste inconnu ; une réception validée est définitive ;
 * un rejeu ne reçoit pas deux fois. Réservé à `stock.receive` (gérante), en ligne seulement. Comptage fictif.
 */
final class GoodsReceiptsTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        $this->supplierId = $this->supplier()['id'];
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Écriture d'un compte (clé d'idempotence nouvelle par défaut) : ces ressources n'ont pas de version, le corps
     * porte toujours `expected_version` null (contrat).
     *
     * @param  array<string, mixed>  $body
     */
    private function send(string $method, string $uri, array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->write($method, $uri, ['expected_version' => null] + $body, $as, $key);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function supplier(array $overrides = []): array
    {
        $response = $this->send('POST', '/api/v1/suppliers', $overrides + ['name' => 'Optique Distribution', 'reference' => 'FOU-001'], $this->manager);
        $response->assertCreated();

        return (array) $response->json('data');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function receiptBody(array $lines, array $overrides = []): array
    {
        return array_merge([
            'supplier_id' => $this->supplierId,
            'location_id' => $this->locationId,
            'supplier_reference' => 'BL-2026-0001',
            'received_at' => '2026-10-22T08:00:00.000Z',
            'notes' => null,
            'lines' => $lines,
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private function receiptLine(string $itemId, string $quantity, ?int $cost = null): array
    {
        return ['item_id' => $itemId, 'quantity' => $quantity, 'unit_cost' => $cost];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function draft(array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->send('POST', '/api/v1/goods-receipts', $body, $as ?? $this->manager, $key);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function validation(string $id, array $lines, bool $reauthenticated = true, ?string $key = null, ?User $as = null): TestResponse
    {
        $user = $as ?? $this->manager;
        $client = $reauthenticated ? $this->actingAsReauthenticated($user) : $this->actingAsFresh($user);

        return $client->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])->postJson('/api/v1/goods-receipts/'.$id.'/validate', ['expected_version' => null, 'lines' => $lines]);
    }

    /**
     * @param  array{batch_number: string, expires_on: ?string}|null  $lot
     * @return array<string, mixed>
     */
    private function confirm(int $position, ?array $lot = null, ?int $cost = null): array
    {
        return ['position' => $position, 'lot' => $lot, 'unit_cost' => $cost];
    }

    /**
     * @return array<string, int>
     */
    private function stockEffects(): array
    {
        return [
            'positions' => DB::table('stock_positions')->count(),
            'lots' => DB::table('stock_lots')->count(),
            'movements' => DB::table('stock_movements')->count(),
            'receipts' => DB::table('goods_receipts')->count(),
            'lines' => DB::table('goods_receipt_lines')->count(),
            'audit' => DB::table('audit_events')->count(),
            'changes' => DB::table('sync_change_log')->count(),
        ];
    }

    // --- Fournisseurs -------------------------------------------------------------------------------------------

    public function test_la_gerante_cree_modifie_et_desactive_un_fournisseur(): void
    {
        $created = $this->send('POST', '/api/v1/suppliers', ['name' => 'Labo Douala', 'reference' => 'LAB-1', 'phone' => '+237 600 00 00 00', 'email' => 'labo@example.test', 'is_optical_lab' => true], $this->manager);
        $created->assertCreated()->assertJsonPath('data.is_optical_lab', true)->assertJsonPath('data.active', true);
        $this->assertMatchesContract($created, 'schemas/resources/stock.json#/$defs/SupplierResponse');
        $id = (string) $created->json('data.id');

        $this->send('PATCH', '/api/v1/suppliers/'.$id, ['name' => 'Labo Douala Centre', 'reference' => 'LAB-1', 'active' => false], $this->manager)
            ->assertOk()->assertJsonPath('data.name', 'Labo Douala Centre')->assertJsonPath('data.active', false)->assertJsonPath('data.phone', null);

        $all = $this->read('/api/v1/suppliers', $this->manager);
        $all->assertOk()->assertJsonCount(2, 'data');
        $this->assertMatchesContract($all, 'schemas/resources/stock.json#/$defs/SupplierList');
        $this->read('/api/v1/suppliers?active=1', $this->manager)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.reference', 'FOU-001');
        $this->read('/api/v1/suppliers?active=0', $this->manager)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id);
        $this->read('/api/v1/suppliers?active=oui', $this->manager)->assertStatus(422);
        $this->assertEqualsCanonicalizing(['stock.supplier_created', 'stock.supplier_created', 'stock.supplier_updated'], DB::table('audit_events')->where('action', 'like', 'stock.supplier_%')->pluck('action')->all());
    }

    public function test_le_code_d_un_fournisseur_est_unique_casse_et_accents_ignores(): void
    {
        $this->send('POST', '/api/v1/suppliers', ['name' => 'Autre', 'reference' => 'fou-001'], $this->manager)->assertStatus(422)->assertJson(['error' => ['fields' => ['reference' => ['Ce code est déjà utilisé par un autre fournisseur.']]]]);
        $other = $this->supplier(['name' => 'Autre fournisseur', 'reference' => 'FOU-002']);
        $this->send('PATCH', '/api/v1/suppliers/'.$other['id'], ['name' => 'Autre fournisseur', 'reference' => 'FOU-001'], $this->manager)->assertStatus(422);
        $this->send('PATCH', '/api/v1/suppliers/'.$other['id'], ['name' => 'Autre fournisseur', 'reference' => 'FOU-002'], $this->manager)->assertOk();
        $this->send('POST', '/api/v1/suppliers', ['name' => 'X', 'reference' => 'FOU-9'], $this->manager)->assertStatus(422);
        $this->send('POST', '/api/v1/suppliers', ['name' => 'Fournisseur', 'reference' => 'FOU-9', 'email' => 'pas-un-courriel'], $this->manager)->assertStatus(422);
    }

    public function test_seul_le_droit_stock_receive_ouvre_les_achats_et_un_module_ferme_repond_404(): void
    {
        foreach ([$this->cashier, $this->clinician, $this->reception] as $user) {
            $this->read('/api/v1/suppliers', $user)->assertForbidden();
            $this->read('/api/v1/goods-receipts', $user)->assertForbidden();
            $this->send('POST', '/api/v1/suppliers', ['name' => 'Interdit', 'reference' => 'X-1'], $user)->assertForbidden();
            $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')]), $user)->assertForbidden();
        }
        config(['eeo.enabled_modules' => ['sales']]);
        $this->read('/api/v1/suppliers', $this->manager)->assertNotFound();
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')]))->assertNotFound();
    }

    // --- Brouillon ----------------------------------------------------------------------------------------------

    public function test_un_brouillon_ne_touche_pas_au_stock_et_se_remplace(): void
    {
        $before = $this->stockEffects();
        $response = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '5', 18000), $this->receiptLine($this->item['drops'], '10')]));

        $response->assertCreated()->assertJsonPath('data.status', 'DRAFT')->assertJsonPath('data.line_count', 2)
            ->assertJsonPath('data.unknown_cost_lines', 1)->assertJsonPath('data.known_cost_total', 90000)
            ->assertJsonPath('data.lines.0.unit_cost', 18000)->assertJsonPath('data.lines.1.unit_cost', null)->assertJsonPath('data.lines.1.lot', null)
            ->assertJsonPath('data.supplier_name', 'Optique Distribution');
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/GoodsReceiptResponse');
        $id = (string) $response->json('data.id');

        $after = $this->stockEffects();
        $this->assertSame($before['positions'], $after['positions']);
        $this->assertSame($before['lots'], $after['lots']);
        $this->assertSame($before['movements'], $after['movements']);
        $this->assertSame($before['receipts'] + 1, $after['receipts']);

        $replaced = $this->send('PATCH', '/api/v1/goods-receipts/'.$id, $this->receiptBody([$this->receiptLine($this->item['frame'], '2', 20000)], ['supplier_reference' => 'BL-2026-0002', 'notes' => 'Livraison partielle']), $this->manager);
        $replaced->assertOk()->assertJsonPath('data.line_count', 1)->assertJsonPath('data.supplier_reference', 'BL-2026-0002')->assertJsonPath('data.notes', 'Livraison partielle')->assertJsonPath('data.known_cost_total', 40000);
        $this->assertSame(1, DB::table('goods_receipt_lines')->count());
        $this->assertSame($before['positions'], $this->stockEffects()['positions']);
    }

    public function test_le_rejeu_de_la_creation_d_un_brouillon_rend_la_reponse_d_origine(): void
    {
        $key = Ulid::generate();
        $body = $this->receiptBody([$this->receiptLine($this->item['frame'], '3')]);
        $first = $this->draft($body, null, $key);
        $first->assertCreated();
        $second = $this->draft($body, null, $key);
        $second->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, DB::table('goods_receipts')->count());
    }

    public function test_la_saisie_d_un_brouillon_est_controlee_ligne_par_ligne(): void
    {
        $before = $this->stockEffects();
        $this->draft($this->receiptBody([$this->receiptLine($this->item['exam'], '1')]))->assertStatus(422)->assertJsonPath('error.fields', ['lines.0.item_id' => ['Seul un article actif géré en stock se reçoit.']]);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['lens'], '1')]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1.5')]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '0')]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine(Ulid::generate(), '1')]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')], ['supplier_id' => Ulid::generate()]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')], ['location_id' => Ulid::generate()]))->assertStatus(422);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')], ['received_at' => '2026-10-23T09:30:00.000Z']))->assertStatus(422)->assertJson(['error' => ['fields' => ['received_at' => ['La date de réception ne peut pas être dans le futur.']]]]);
        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')], ['supplier_reference' => '   ']))->assertStatus(422);
        $this->draft($this->receiptBody([]))->assertStatus(422);
        $this->assertSame($before, $this->stockEffects());
    }

    public function test_la_reference_de_livraison_est_unique_par_fournisseur_et_se_libere_par_suppression(): void
    {
        $line = $this->receiptLine($this->item['frame'], '1');
        $first = $this->draft($this->receiptBody([$line]));
        $first->assertCreated();
        $this->draft($this->receiptBody([$line]))->assertStatus(422)->assertJson(['error' => ['fields' => ['supplier_reference' => ['Une réception porte déjà cette référence de livraison pour ce fournisseur.']]]]);
        $other = $this->supplier(['name' => 'Autre fournisseur', 'reference' => 'FOU-002']);
        $this->draft($this->receiptBody([$line], ['supplier_id' => $other['id']]))->assertCreated();

        $deleted = $this->send('POST', '/api/v1/goods-receipts/'.$first->json('data.id').'/delete', [], $this->manager);
        $deleted->assertOk()->assertJsonPath('data.deleted', true);
        $this->assertMatchesContract($deleted, 'schemas/resources/stock.json#/$defs/DeleteGoodsReceiptDraftResponse');
        $this->assertSame(0, DB::table('goods_receipt_lines')->where('receipt_id', $first->json('data.id'))->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'stock.receipt_draft_deleted')->count());
        $this->draft($this->receiptBody([$line]))->assertCreated();
    }

    // --- Validation ---------------------------------------------------------------------------------------------

    public function test_la_validation_cree_positions_lots_et_mouvements_d_une_reception_multi_lignes(): void
    {
        $draft = $this->draft($this->receiptBody([
            $this->receiptLine($this->item['frame'], '5', 18000),
            $this->receiptLine($this->item['drops'], '10'),
            $this->receiptLine($this->item['drops'], '4', 900),
        ]));
        $draft->assertCreated();
        $id = (string) $draft->json('data.id');

        $response = $this->validation($id, [
            $this->confirm(1, null, 18000),
            $this->confirm(2, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], null),
            $this->confirm(3, ['batch_number' => 'LOT-B', 'expires_on' => '2027-09-01'], 900),
        ]);

        $response->assertOk()->assertJsonPath('data.status', 'VALIDATED')->assertJsonPath('data.unknown_cost_lines', 1)->assertJsonPath('data.known_cost_total', 93600)
            ->assertJsonPath('data.lines.1.lot.batch_number', 'LOT-A')->assertJsonPath('data.lines.1.unit_cost', null)->assertJsonPath('data.lines.2.lot.expires_on', '2027-09-01');
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/GoodsReceiptResponse');

        $frame = DB::table('stock_positions')->where('item_id', $this->item['frame'])->first();
        $drops = DB::table('stock_positions')->where('item_id', $this->item['drops'])->first();
        $this->assertNotNull($frame);
        $this->assertNotNull($drops);
        $this->assertSame(['5.000', '0.000', '0.000', '5.000', 1], [$frame->on_hand, $frame->reserved, $frame->offline_allocated, $frame->central_available, (int) $frame->version]);
        $this->assertSame(['14.000', 1], [$drops->on_hand, (int) $drops->version]);
        $lots = DB::table('stock_lots')->where('item_id', $this->item['drops'])->orderBy('batch_number')->get();
        $this->assertCount(2, $lots);
        $this->assertSame(['LOT-A', '10.000', 'SELLABLE', null, '2027-03-01', $drops->id], [$lots[0]->batch_number, $lots[0]->on_hand, $lots[0]->status, $lots[0]->unit_cost, $lots[0]->expires_on, $lots[0]->stock_position_id]);
        $this->assertSame(['LOT-B', '4.000', 900, '2027-09-01'], [$lots[1]->batch_number, $lots[1]->on_hand, (int) $lots[1]->unit_cost, $lots[1]->expires_on]);

        $movements = DB::table('stock_movements')->where('kind', 'RECEIPT')->orderBy('movement_position')->get();
        $this->assertCount(3, $movements);
        $this->assertSame([1, 2, 3], $movements->pluck('movement_position')->map(static fn ($value): int => (int) $value)->all());
        $this->assertSame(['5.000', '10.000', '4.000'], $movements->pluck('signed_quantity')->all());
        $this->assertNull($movements[1]->unit_cost);
        $this->assertSame('Réception fournisseur : BL-2026-0001', $movements[0]->reason);
        $this->assertNull($movements[0]->approval_id);
        $lines = DB::table('goods_receipt_lines')->where('receipt_id', $id)->orderBy('position')->get();
        $this->assertSame([null, $lots[0]->id, $lots[1]->id], $lines->pluck('stock_lot_id')->all());
        $this->assertSame($lines->pluck('id')->all(), $movements->pluck('goods_receipt_line_id')->all());

        $receipt = DB::table('goods_receipts')->where('id', $id)->first();
        $this->assertNotNull($receipt);
        $this->assertSame(['VALIDATED', $this->manager->id], [$receipt->status, $receipt->validated_by]);
        $this->assertNotNull($receipt->validated_at);
        $published = DB::table('sync_change_log')->where('entity_type', 'stock_positions')->where('entity_id', $frame->id)->first();
        $this->assertNotNull($published);
        $this->assertSame([1, 'CREATED'], [(int) $published->entity_version, $published->change_kind]);
        $audit = DB::table('audit_events')->where('action', 'stock.receipt_validated')->first();
        $this->assertNotNull($audit);
        $this->assertStringNotContainsString('18000', (string) json_encode($audit));
    }

    public function test_une_seconde_reception_ajoute_au_stock_et_au_lot_existant(): void
    {
        $first = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '10', 700)]));
        $this->validation((string) $first->json('data.id'), [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 700)])->assertOk();
        $second = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '5', 700)], ['supplier_reference' => 'BL-2026-0002']));
        $this->validation((string) $second->json('data.id'), [$this->confirm(1, ['batch_number' => 'lot-a', 'expires_on' => '2027-03-01'], 700)])->assertOk();

        $this->assertSame(1, DB::table('stock_lots')->count());
        $lot = DB::table('stock_lots')->first();
        $position = DB::table('stock_positions')->first();
        $this->assertNotNull($lot);
        $this->assertNotNull($position);
        $this->assertSame(['LOT-A', '15.000', 2], [$lot->batch_number, $lot->on_hand, (int) $lot->version]);
        $this->assertSame(['15.000', 2], [$position->on_hand, (int) $position->version]);
        $this->assertSame(2, DB::table('stock_movements')->where('kind', 'RECEIPT')->count());
    }

    public function test_le_rejeu_de_la_validation_ne_recoit_pas_deux_fois(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '5', 18000)]));
        $id = (string) $draft->json('data.id');
        $key = Ulid::generate();
        $lines = [$this->confirm(1, null, 18000)];

        $first = $this->validation($id, $lines, true, $key);
        $first->assertOk();
        $afterFirst = $this->stockEffects();
        $second = $this->validation($id, $lines, true, $key);

        $second->assertOk();
        $this->assertSame($first->json('data'), $second->json('data'));
        $this->assertSame($afterFirst, $this->stockEffects());
        $this->assertSame('5.000', DB::table('stock_positions')->value('on_hand'));
        // Une AUTRE clé sur une réception déjà validée : refus d'état, aucun second effet.
        $this->validation($id, $lines)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->assertSame($afterFirst, $this->stockEffects());
    }

    public function test_un_article_perissable_exige_un_lot_date_non_expire(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '10')]));
        $id = (string) $draft->json('data.id');
        $before = $this->stockEffects();

        $this->validation($id, [$this->confirm(1, null)])->assertStatus(422)->assertJsonPath('error.fields', ['lines.0.lot' => ['Un article périssable ne se reçoit que sur un lot daté : indiquez le numéro de lot et l\'expiration.']]);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => null])])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.0.lot.expires_on' => ['Un article périssable exige la date d\'expiration du lot.']]]]);
        $this->validation($id, [$this->confirm(1, ['batch_number' => '  ', 'expires_on' => '2027-03-01'])])->assertStatus(422);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2026-10-21'])])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.0.lot.expires_on' => ['Ce lot est déjà expiré à la date de réception : il ne peut pas entrer en stock.']]]]);
        // Le jour même reste valable (même règle que la remise).
        $this->assertSame($before, $this->stockEffects());
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2026-10-22'])])->assertOk();
    }

    public function test_la_validation_confirme_chaque_ligne_du_brouillon_ni_plus_ni_moins(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1'), $this->receiptLine($this->item['frame'], '2')]));
        $id = (string) $draft->json('data.id');
        $before = $this->stockEffects();

        $this->validation($id, [$this->confirm(1)])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines' => ['La ligne 2 doit être confirmée (lot et coût).']]]]);
        $this->validation($id, [$this->confirm(1), $this->confirm(2), $this->confirm(3)])->assertStatus(422);
        $this->validation($id, [$this->confirm(1), $this->confirm(1), $this->confirm(2)])->assertStatus(422);
        $this->assertSame($before, $this->stockEffects());
        $this->validation($id, [$this->confirm(1), $this->confirm(2)])->assertOk();
        $this->assertSame('3.000', DB::table('stock_positions')->value('on_hand'));
    }

    public function test_un_lot_existant_garde_son_expiration_son_cout_et_sa_quarantaine(): void
    {
        $position = $this->seedPosition($this->item['drops'], '8');
        $lot = $this->seedLot($position, $this->item['drops'], 'LOT-A', '2027-03-01', '8');
        DB::table('stock_lots')->where('id', $lot)->update(['unit_cost' => 700]);
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '2')]));
        $id = (string) $draft->json('data.id');
        $before = $this->stockEffects();

        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-09-01'], 700)])->assertStatus(422)
            ->assertJson(['error' => ['fields' => ['lines.0.lot.expires_on' => ['Ce lot existe déjà avec l\'expiration du 2027-03-01 : une autre date ne s\'écrit pas sur un lot connu.']]]]);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 900)])->assertStatus(422)
            ->assertJson(['error' => ['fields' => ['lines.0.unit_cost' => ['Ce lot existe déjà avec un coût de 700 FCFA : le coût d\'un lot en stock ne change pas (choisissez un autre numéro de lot).']]]]);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], null)])->assertStatus(422);
        DB::table('stock_lots')->where('id', $lot)->update(['status' => 'QUARANTINE']);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 700)])->assertStatus(422)
            ->assertJson(['error' => ['fields' => ['lines.0.lot.batch_number' => ['Ce lot est en quarantaine : il ne reçoit pas de nouvelle marchandise (choisissez un autre numéro de lot).']]]]);
        $this->assertSame($before, $this->stockEffects());

        DB::table('stock_lots')->where('id', $lot)->update(['status' => 'SELLABLE']);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 700)])->assertOk();
        $this->assertSame('10.000', DB::table('stock_lots')->where('id', $lot)->value('on_hand'));
    }

    public function test_un_lot_vide_reprend_le_cout_de_la_nouvelle_reception(): void
    {
        $position = $this->seedPosition($this->item['drops'], '0');
        $lot = $this->seedLot($position, $this->item['drops'], 'LOT-A', '2027-03-01', '0');
        DB::table('stock_lots')->where('id', $lot)->update(['unit_cost' => 700]);
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '6')]));

        $this->validation((string) $draft->json('data.id'), [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], null)])->assertOk();

        $row = DB::table('stock_lots')->where('id', $lot)->first();
        $this->assertNotNull($row);
        $this->assertSame(['6.000', null], [$row->on_hand, $row->unit_cost]);
    }

    public function test_une_position_deja_suivie_par_lots_exige_le_lot(): void
    {
        $position = $this->seedPosition($this->item['frame'], '3');
        $this->seedLot($position, $this->item['frame'], 'LOT-F', null, '3');
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '2')]));
        $id = (string) $draft->json('data.id');

        $this->validation($id, [$this->confirm(1)])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.0.lot' => ['Cet article est suivi par lots : indiquez le lot reçu.']]]]);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-F', 'expires_on' => null])])->assertOk();
        $this->assertSame('5.000', DB::table('stock_positions')->where('id', $position)->value('on_hand'));
    }

    public function test_deux_lignes_du_meme_lot_s_additionnent_ou_se_refusent_si_elles_different(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['drops'], '3', 500), $this->receiptLine($this->item['drops'], '2', 500)]));
        $id = (string) $draft->json('data.id');
        $before = $this->stockEffects();

        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 500), $this->confirm(2, ['batch_number' => 'LOT-A', 'expires_on' => '2027-04-01'], 500)])->assertStatus(422);
        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 500), $this->confirm(2, ['batch_number' => 'lot-a', 'expires_on' => '2027-03-01'], 500)])->assertStatus(422);
        $this->assertSame($before, $this->stockEffects());

        $this->validation($id, [$this->confirm(1, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 500), $this->confirm(2, ['batch_number' => 'LOT-A', 'expires_on' => '2027-03-01'], 500)])->assertOk();
        $this->assertSame(1, DB::table('stock_lots')->count());
        $this->assertSame('5.000', DB::table('stock_lots')->value('on_hand'));
        $this->assertSame(2, DB::table('stock_movements')->count());
    }

    public function test_la_validation_exige_une_reauthentification_recente(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')]));
        $id = (string) $draft->json('data.id');

        $this->validation($id, [$this->confirm(1)], false)->assertStatus(423)->assertJsonPath('error.code', 'REAUTHENTICATION_REQUIRED');
        $this->assertSame(0, DB::table('stock_movements')->count());
    }

    public function test_un_fournisseur_desactive_refuse_les_receptions(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')]));
        $id = (string) $draft->json('data.id');
        $this->send('PATCH', '/api/v1/suppliers/'.$this->supplierId, ['name' => 'Optique Distribution', 'reference' => 'FOU-001', 'active' => false], $this->manager)->assertOk();

        $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')], ['supplier_reference' => 'BL-2']))->assertStatus(422);
        $this->validation($id, [$this->confirm(1)])->assertStatus(422)->assertJson(['error' => ['fields' => ['supplier_id' => ['Ce fournisseur est désactivé : réactivez-le avant de valider la réception.']]]]);
        $this->assertSame(0, DB::table('stock_movements')->count());
    }

    // --- Une réception validée est définitive -------------------------------------------------------------------

    public function test_une_reception_validee_est_definitive(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '5', 18000)]));
        $id = (string) $draft->json('data.id');
        $this->validation($id, [$this->confirm(1, null, 18000)])->assertOk();
        $before = $this->stockEffects();

        $this->send('PATCH', '/api/v1/goods-receipts/'.$id, $this->receiptBody([$this->receiptLine($this->item['frame'], '9')]), $this->manager)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->send('POST', '/api/v1/goods-receipts/'.$id.'/delete', [], $this->manager)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->assertSame($before, $this->stockEffects());

        // Dernier garde-fou : la base elle-même refuse de modifier ou de supprimer la réception et ses lignes.
        foreach ([
            static fn () => DB::table('goods_receipts')->where('id', $id)->update(['notes' => 'modifiée']),
            static fn () => DB::table('goods_receipts')->where('id', $id)->delete(),
            static fn () => DB::table('goods_receipt_lines')->where('receipt_id', $id)->update(['quantity' => '9.000']),
            static fn () => DB::table('goods_receipt_lines')->where('receipt_id', $id)->delete(),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('La base a accepté de modifier une réception validée.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('immutable', $exception->getMessage());
            }
        }
        $this->assertSame($before, $this->stockEffects());
    }

    public function test_la_liste_filtre_par_statut_et_fournisseur_et_montre_les_brouillons_d_abord(): void
    {
        $done = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1', 1000)]));
        $this->validation((string) $done->json('data.id'), [$this->confirm(1, null, 1000)])->assertOk();
        $open = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '2')], ['supplier_reference' => 'BL-2026-0002']));
        $open->assertCreated();

        $all = $this->read('/api/v1/goods-receipts', $this->manager);
        $all->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.status', 'DRAFT')->assertJsonPath('data.1.status', 'VALIDATED')->assertJsonPath('meta.total', 2);
        $this->assertMatchesContract($all, 'schemas/resources/stock.json#/$defs/GoodsReceiptPage');
        $this->read('/api/v1/goods-receipts?status=VALIDATED', $this->manager)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.known_cost_total', 1000);
        $this->read('/api/v1/goods-receipts?status=DRAFT&supplier_id='.$this->supplierId, $this->manager)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $open->json('data.id'));
        $this->read('/api/v1/goods-receipts?supplier_id='.Ulid::generate(), $this->manager)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/goods-receipts?status=INCONNU', $this->manager)->assertStatus(422);
        $this->read('/api/v1/goods-receipts?page=0', $this->manager)->assertStatus(422);
        $this->read('/api/v1/goods-receipts/'.Ulid::generate(), $this->manager)->assertNotFound();
    }

    public function test_un_autre_cabinet_ne_voit_ni_ne_modifie_rien(): void
    {
        $draft = $this->draft($this->receiptBody([$this->receiptLine($this->item['frame'], '1')]));
        $id = (string) $draft->json('data.id');
        $otherClinic = $this->makeClinic('AUTRE CABINET');
        $stranger = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.autre');

        $this->read('/api/v1/goods-receipts', $stranger)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/suppliers', $stranger)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/goods-receipts/'.$id, $stranger)->assertNotFound();
        $this->send('PATCH', '/api/v1/goods-receipts/'.$id, $this->receiptBody([$this->receiptLine($this->item['frame'], '9')]), $stranger)->assertNotFound();
        $this->send('PATCH', '/api/v1/suppliers/'.$this->supplierId, ['name' => 'Piraté', 'reference' => 'X-2'], $stranger)->assertNotFound();
        $this->validation($id, [$this->confirm(1)], true, null, $stranger)->assertNotFound();
        $this->send('POST', '/api/v1/goods-receipts/'.$id.'/delete', [], $stranger)->assertNotFound();
        $this->assertSame(1, DB::table('goods_receipts')->count());
    }
}

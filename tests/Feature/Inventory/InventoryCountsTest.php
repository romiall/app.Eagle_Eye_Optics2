<?php

namespace Tests\Feature\Inventory;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Inventaires (L1D02, EE026, EE030, AT30) : périmètre et théorique figés à l'ouverture, comptage sans effet sur le
 * stock, validation par la gérante en ajustements SIGNÉS et approuvés (jamais un remplacement brut), théorique jugé au
 * moment du comptage de chaque ligne, marchandise réservée ou confiée à un poste protégée, écarts valorisés au coût
 * connu avec les coûts inconnus isolés. Comptage fictif.
 */
final class InventoryCountsTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['purchase_cost' => 18000]);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function at(string $time): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 '.$time, 'UTC'));
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function send(string $method, string $uri, array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->write($method, $uri, ['expected_version' => null] + $body, $as ?? $this->manager, $key);
    }

    private function open(string $reference = 'INV-1', ?string $location = null, ?User $as = null): TestResponse
    {
        return $this->send('POST', '/api/v1/inventory-counts', ['location_id' => $location ?? $this->locationId, 'reference' => $reference], $as);
    }

    /**
     * @param  array<string, mixed>  $detail
     */
    private function lineId(array $detail, string $reference, ?string $batch = null): string
    {
        foreach ((array) $detail['lines'] as $line) {
            if ($line['item_reference'] === $reference && ($line['lot']['batch_number'] ?? null) === $batch) {
                return (string) $line['line_id'];
            }
        }
        $this->fail('Ligne '.$reference.' '.($batch ?? '(sans lot)').' introuvable.');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function record(string $id, array $lines, ?User $as = null): TestResponse
    {
        return $this->send('PATCH', '/api/v1/inventory-counts/'.$id.'/lines', ['lines' => $lines], $as);
    }

    private function counted(string $lineId, ?string $quantity, ?string $reason = null): array
    {
        return array_filter(['line_id' => $lineId, 'counted_quantity' => $quantity, 'variance_reason' => $reason], static fn ($value, $key): bool => $key !== 'variance_reason' || $value !== null, ARRAY_FILTER_USE_BOTH);
    }

    private function validation(string $id, string $reason = 'Inventaire de novembre', bool $reauthenticated = true, ?string $key = null, ?User $as = null): TestResponse
    {
        $user = $as ?? $this->manager;
        $client = $reauthenticated ? $this->actingAsReauthenticated($user) : $this->actingAsFresh($user);

        return $client->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])->postJson('/api/v1/inventory-counts/'.$id.'/validate', ['expected_version' => null, 'reason' => $reason]);
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
            'approvals' => DB::table('approvals')->count(),
            'audit' => DB::table('audit_events')->count(),
            'changes' => DB::table('sync_change_log')->count(),
        ];
    }

    /**
     * Stock de départ : monture (7, sans lot), collyre (12) en deux lots (A : 8 dont 2 réservés, coût 700 ; B : 4, coût inconnu).
     *
     * @return array{frame: string, drops: string, lotA: string, lotB: string}
     */
    private function seedStock(): array
    {
        $frame = $this->seedPosition($this->item['frame'], '7');
        $drops = $this->seedPosition($this->item['drops'], '12', '2');
        $lotA = $this->seedLot($drops, $this->item['drops'], 'LOT-A', '2027-03-01', '8', 'SELLABLE', '2');
        $lotB = $this->seedLot($drops, $this->item['drops'], 'LOT-B', '2027-09-01', '4');
        DB::table('stock_lots')->where('id', $lotA)->update(['unit_cost' => 700]);

        return ['frame' => $frame, 'drops' => $drops, 'lotA' => $lotA, 'lotB' => $lotB];
    }

    /**
     * Entrée en stock par une réception fournisseur (mouvement RECEIPT daté de l'instant courant du test).
     */
    private function receive(string $itemId, string $quantity, string $reference): void
    {
        $supplier = DB::table('suppliers')->where('clinic_id', $this->clinicId)->value('id');
        if ($supplier === null) {
            $supplier = $this->send('POST', '/api/v1/suppliers', ['name' => 'Optique Distribution', 'reference' => 'FOU-001'])->assertCreated()->json('data.id');
        }
        $draft = $this->send('POST', '/api/v1/goods-receipts', [
            'supplier_id' => $supplier, 'location_id' => $this->locationId, 'supplier_reference' => $reference, 'received_at' => '2026-10-22T08:00:00.000Z',
            'lines' => [['item_id' => $itemId, 'quantity' => $quantity, 'unit_cost' => null]],
        ]);
        $draft->assertCreated();
        $this->actingAsReauthenticated($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/goods-receipts/'.$draft->json('data.id').'/validate', ['expected_version' => null, 'lines' => [['position' => 1, 'lot' => null, 'unit_cost' => null]]])->assertOk();
    }

    // --- Ouverture ----------------------------------------------------------------------------------------------

    public function test_l_ouverture_fige_le_perimetre_et_le_theorique_par_article_et_par_lot(): void
    {
        $this->seedStock();
        $empty = $this->seedItem($this->clinicId, ['reference' => 'ZZ-VIDE', 'name' => 'Article sans stock', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 1000, 'stock_mode' => 'STOCKED']);
        $this->seedPosition($empty, '0');
        $other = $this->seedLocation($this->clinicId, 'ATELIER');
        DB::table('stock_positions')->insert(['id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'item_id' => $this->item['frame'], 'location_id' => $other, 'on_hand' => '9', 'reserved' => '0', 'offline_allocated' => '0', 'version' => 1]);
        $before = $this->stockEffects();

        $response = $this->open();

        $response->assertCreated()->assertJsonPath('data.status', 'OPEN')->assertJsonPath('data.reference', 'INV-1')->assertJsonPath('data.line_count', 3)
            ->assertJsonPath('data.counted_lines', 0)->assertJsonPath('data.variance_lines', 0)->assertJsonPath('data.variance_value_known', 0)->assertJsonPath('data.unknown_cost_lines', 0)
            ->assertJsonPath('data.snapshot_at', '2026-10-22T09:30:00.000Z');
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/InventoryCountResponse');
        $lines = (array) $response->json('data.lines');
        $this->assertSame(['CO-001|LOT-A|8.000', 'CO-001|LOT-B|4.000', 'FR-001||7.000'], array_map(static fn (array $line): string => $line['item_reference'].'|'.($line['lot']['batch_number'] ?? '').'|'.$line['theoretical_quantity'], $lines));
        $this->assertNull($lines[0]['counted_quantity']);
        // Ouvrir ne touche à aucun stock et n'écrit aucun mouvement ; la trace est l'audit.
        $after = $this->stockEffects();
        $this->assertSame($before['movements'], $after['movements']);
        $this->assertSame($before['positions'], $after['positions']);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'stock.inventory_opened')->count());
    }

    public function test_un_seul_inventaire_actif_par_emplacement_et_une_reference_unique(): void
    {
        $this->seedStock();
        $first = $this->open();
        $first->assertCreated();
        $this->open('INV-2')->assertStatus(422)->assertJson(['error' => ['fields' => ['location_id' => ['Un inventaire est déjà en cours dans cet emplacement : validez-le ou abandonnez-le avant d\'en ouvrir un autre.']]]]);
        $this->open('INV-1', $this->seedLocation($this->clinicId, 'ATELIER'))->assertStatus(422)->assertJson(['error' => ['fields' => ['reference' => ['Cette référence d\'inventaire existe déjà.']]]]);
        $this->open('INV-3', $this->seedLocation($this->clinicId, 'RESERVE'))->assertCreated();
        $this->open('INV-4', Ulid::generate())->assertStatus(422);
        $this->open('   ')->assertStatus(422);

        $this->send('POST', '/api/v1/inventory-counts/'.$first->json('data.id').'/abandon', ['reason' => 'Ouvert par erreur'])->assertOk()->assertJsonPath('data.status', 'ABANDONED');
        $this->open('INV-5')->assertCreated();
    }

    // --- Comptage ------------------------------------------------------------------------------------------------

    public function test_la_saisie_des_comptages_ne_touche_pas_au_stock_et_se_controle(): void
    {
        $stock = $this->seedStock();
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $frameLine = $this->lineId($detail, 'FR-001');
        $lotLine = $this->lineId($detail, 'CO-001', 'LOT-A');
        $before = $this->stockEffects();

        $response = $this->record($id, [$this->counted($frameLine, '5', 'Casse constatée'), $this->counted($lotLine, '0')]);

        $response->assertOk()->assertJsonPath('data.counted_lines', 2)->assertJsonPath('data.variance_lines', 2);
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/InventoryCountResponse');
        $stored = DB::table('inventory_count_lines')->where('id', $frameLine)->first();
        $this->assertNotNull($stored);
        $this->assertSame(['5.000', '-2.000', 'Casse constatée', $this->manager->id], [$stored->counted_quantity, $stored->variance_quantity, $stored->variance_reason, $stored->counted_by]);
        $this->assertSame(array_diff_key($before, ['audit' => 0]), array_diff_key($this->stockEffects(), ['audit' => 0]));
        $this->assertSame('7.000', DB::table('stock_positions')->where('id', $stock['frame'])->value('on_hand'));

        $this->record($id, [$this->counted($frameLine, '2.5')])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.0.counted_quantity' => ['Cet article se vend à l\'unité : quantité entière obligatoire.']]]]);
        $this->record($id, [$this->counted($frameLine, '-1')])->assertStatus(422);
        $this->record($id, [$this->counted(Ulid::generate(), '1')])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.0.line_id' => ['Cette ligne n\'appartient pas à cet inventaire.']]]]);
        $this->record($id, [$this->counted($frameLine, '1'), $this->counted($frameLine, '2')])->assertStatus(422);
        $this->record($id, [['line_id' => $frameLine, 'counted_quantity' => null]])->assertOk()->assertJsonPath('data.counted_lines', 1);
        $cleared = DB::table('inventory_count_lines')->where('id', $frameLine)->first();
        $this->assertNotNull($cleared);
        $this->assertNull($cleared->counted_quantity);
        $this->assertNull($cleared->counted_by);
        $this->assertSame('Casse constatée', $cleared->variance_reason);
    }

    public function test_terminer_exige_toutes_les_lignes_comptees_puis_rouvrir_et_abandonner(): void
    {
        $this->seedStock();
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $lines = array_map(fn (array $line): array => $this->counted((string) $line['line_id'], '1'), (array) $detail['lines']);

        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines' => ['3 lignes ne sont pas comptées : saisissez leur quantité (zéro si rien n\'est trouvé).']]]]);
        $this->record($id, [$lines[0], $lines[1]])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertStatus(422)->assertJson(['error' => ['fields' => ['lines' => ['Une ligne n\'est pas comptée : saisissez sa quantité (zéro si rien n\'est trouvé).']]]]);
        $this->record($id, [$lines[2]])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk()->assertJsonPath('data.status', 'COUNTED');

        // Compté : plus de saisie ; on rouvre pour corriger, jamais de validation sans comptage terminé.
        $this->record($id, [$lines[0]])->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertStatus(409);
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/reopen', [])->assertOk()->assertJsonPath('data.status', 'OPEN');
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/reopen', [])->assertStatus(409);
        $this->validation($id)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/abandon', ['reason' => 'Rayon refait'])->assertOk()->assertJsonPath('data.status', 'ABANDONED');
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/abandon', [])->assertStatus(409);
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'stock.inventory_abandoned')->count());
    }

    // --- Validation ----------------------------------------------------------------------------------------------

    public function test_la_validation_ajuste_par_des_mouvements_signes_et_valorise_les_ecarts_au_cout_connu(): void
    {
        $stock = $this->seedStock();
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $this->record($id, [
            $this->counted($this->lineId($detail, 'FR-001'), '5', 'Casse constatée'),
            $this->counted($this->lineId($detail, 'CO-001', 'LOT-A'), '9', 'Erreur de réception'),
            $this->counted($this->lineId($detail, 'CO-001', 'LOT-B'), '3', 'Flacon perdu'),
        ])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        $this->at('10:00:00');

        $response = $this->validation($id);

        $response->assertOk()->assertJsonPath('data.status', 'VALIDATED')->assertJsonPath('data.variance_lines', 3)->assertJsonPath('data.variance_value_known', -35300)->assertJsonPath('data.unknown_cost_lines', 1);
        $this->assertMatchesContract($response, 'schemas/resources/stock.json#/$defs/InventoryCountResponse');
        $byKey = [];
        foreach ((array) $response->json('data.lines') as $line) {
            $byKey[$line['item_reference'].'|'.($line['lot']['batch_number'] ?? '')] = $line;
        }
        $this->assertSame(['-2.000', 18000, -36000], [$byKey['FR-001|']['adjustment_quantity'], $byKey['FR-001|']['unit_cost'], $byKey['FR-001|']['variance_value']]);
        $this->assertSame(['1.000', 700, 700], [$byKey['CO-001|LOT-A']['adjustment_quantity'], $byKey['CO-001|LOT-A']['unit_cost'], $byKey['CO-001|LOT-A']['variance_value']]);
        $this->assertSame(['-1.000', null, null], [$byKey['CO-001|LOT-B']['adjustment_quantity'], $byKey['CO-001|LOT-B']['unit_cost'], $byKey['CO-001|LOT-B']['variance_value']]);

        // Stock ajusté par l'écart SIGNÉ, projections et mouvements ensemble.
        $this->assertSame('5.000', DB::table('stock_positions')->where('id', $stock['frame'])->value('on_hand'));
        $this->assertSame('12.000', DB::table('stock_positions')->where('id', $stock['drops'])->value('on_hand'));
        $this->assertSame(['9.000', 2], [DB::table('stock_lots')->where('id', $stock['lotA'])->value('on_hand'), (int) DB::table('stock_lots')->where('id', $stock['lotA'])->value('version')]);
        $this->assertSame('3.000', DB::table('stock_lots')->where('id', $stock['lotB'])->value('on_hand'));

        $movements = DB::table('stock_movements')->where('kind', 'ADJUSTMENT')->orderBy('movement_position')->get();
        $this->assertCount(3, $movements);
        $approval = DB::table('inventory_counts')->where('id', $id)->value('approval_id');
        $this->assertNotNull($approval);
        $this->assertSame([$approval], array_values(array_unique($movements->pluck('approval_id')->all())));
        $this->assertEqualsCanonicalizing(['-2.000', '1.000', '-1.000'], $movements->pluck('signed_quantity')->all());
        $this->assertTrue($movements->every(static fn (object $movement): bool => str_starts_with((string) $movement->reason, 'Inventaire INV-1 : ')));
        $this->assertSame([18000, 700, null], [(int) $movements->firstWhere('signed_quantity', '-2.000')?->unit_cost, (int) $movements->firstWhere('signed_quantity', '1.000')?->unit_cost, $movements->firstWhere('signed_quantity', '-1.000')?->unit_cost]);
        $this->assertSame(3, DB::table('inventory_count_lines')->where('inventory_id', $id)->whereNotNull('adjustment_movement_id')->count());
        $approvalRow = DB::table('approvals')->where('id', $approval)->first();
        $this->assertNotNull($approvalRow);
        $this->assertSame(['stock.inventory', 'inventory_counts', $id, 'CONSUMED', $this->manager->id], [$approvalRow->action_code, $approvalRow->target_type, $approvalRow->target_id, $approvalRow->status, $approvalRow->decided_by]);
        $this->assertSame(2, DB::table('sync_change_log')->where('entity_type', 'stock_positions')->whereIn('entity_id', [$stock['frame'], $stock['drops']])->where('change_kind', 'UPDATED')->count());
        $audit = DB::table('audit_events')->where('action', 'stock.inventory_validated')->first();
        $this->assertNotNull($audit);

        // Définitif : la base refuse de modifier l'inventaire validé comme ses lignes.
        foreach ([
            static fn () => DB::table('inventory_counts')->where('id', $id)->update(['reference' => 'MODIFIÉ']),
            static fn () => DB::table('inventory_count_lines')->where('inventory_id', $id)->update(['variance_reason' => 'modifié']),
            static fn () => DB::table('inventory_count_lines')->where('inventory_id', $id)->delete(),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('La base a accepté de modifier un inventaire validé.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('immutable', $exception->getMessage());
            }
        }
    }

    public function test_le_theorique_est_juge_au_moment_du_comptage_et_le_stock_n_est_jamais_remplace(): void
    {
        $frame = $this->seedPosition($this->item['frame'], '10');
        $other = $this->seedItem($this->clinicId, ['reference' => 'FR-002', 'name' => 'Monture fictive 2', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 30000, 'stock_mode' => 'STOCKED']);
        $otherPosition = $this->seedPosition($other, '6');
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];

        // 10 h 00 : une entrée de 5 AVANT le comptage de la ligne ; 10 h 30 : la monture est comptée à 15 (10 + 5), l'autre à 5.
        $this->at('10:00:00');
        $this->receive($this->item['frame'], '5', 'BL-A');
        $this->at('10:30:00');
        $this->record($id, [$this->counted($this->lineId($detail, 'FR-001'), '15'), $this->counted($this->lineId($detail, 'FR-002'), '5', 'Verre cassé')])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        // 11 h 00 : une entrée de 3 APRÈS le comptage ; 11 h 30 : validation.
        $this->at('11:00:00');
        $this->receive($this->item['frame'], '3', 'BL-B');
        $this->at('11:30:00');

        $response = $this->validation($id);

        $response->assertOk()->assertJsonPath('data.variance_lines', 1);
        $this->assertSame(1, DB::table('stock_movements')->where('kind', 'ADJUSTMENT')->count());
        // Monture : écart nul au comptage (15 = 10 + 5), le stock courant 18 (10 + 5 + 3) n'est PAS remplacé par 15.
        $this->assertSame('18.000', DB::table('stock_positions')->where('id', $frame)->value('on_hand'));
        // Autre monture : −1 appliqué au stock courant.
        $this->assertSame('5.000', DB::table('stock_positions')->where('id', $otherPosition)->value('on_hand'));
        $lineOfFrame = collect((array) $response->json('data.lines'))->firstWhere('item_reference', 'FR-001');
        $this->assertSame(['5.000', null], [$lineOfFrame['variance_quantity'], $lineOfFrame['adjustment_quantity']]);
    }

    public function test_les_reserves_et_les_quotas_ne_disparaissent_pas_au_comptage(): void
    {
        $reserved = $this->seedPosition($this->item['frame'], '10', '4');
        $quota = $this->seedItem($this->clinicId, ['reference' => 'FR-003', 'name' => 'Monture confiée à un poste', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 30000, 'stock_mode' => 'STOCKED']);
        $quotaPosition = $this->seedPosition($quota, '10', '0', '5');
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $frameLine = $this->lineId($detail, 'FR-001');
        $quotaLine = $this->lineId($detail, 'FR-003');

        $this->record($id, [$this->counted($frameLine, '3', 'Comptage bas'), $this->counted($quotaLine, '2', 'Comptage bas')])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        $before = $this->stockEffects();

        $this->validation($id)->assertStatus(409)->assertJsonPath('error.code', 'STOCK_UNAVAILABLE')->assertJsonPath('error.details.blocked_lines', 2)
            ->assertJsonFragment(['lines.'.$frameLine => ['Ligne FR-001 : le comptage retirerait de la marchandise réservée pour une vente émise ou confiée à un poste (disponible : 6.000). Traitez ces réservations avant de valider.']]);
        $this->assertSame($before, $this->stockEffects());
        $this->assertSame('COUNTED', DB::table('inventory_counts')->where('id', $id)->value('status'));

        // Comptage compatible avec la réserve (6 ≥ 4) et le quota (5 ≥ 5) : accepté, le stock suit l'écart signé.
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/reopen', [])->assertOk();
        $this->record($id, [$this->counted($frameLine, '6', 'Comptage'), $this->counted($quotaLine, '5', 'Comptage')])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        $this->validation($id)->assertOk();
        $this->assertSame(['6.000', '4.000'], [DB::table('stock_positions')->where('id', $reserved)->value('on_hand'), DB::table('stock_positions')->where('id', $reserved)->value('reserved')]);
        $this->assertSame(['5.000', '5.000'], [DB::table('stock_positions')->where('id', $quotaPosition)->value('on_hand'), DB::table('stock_positions')->where('id', $quotaPosition)->value('offline_allocated')]);
    }

    public function test_chaque_ecart_exige_son_motif_et_la_validation_exige_la_gerante_reauthentifiee(): void
    {
        $this->seedPosition($this->item['frame'], '7');
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $line = $this->lineId($detail, 'FR-001');
        $this->record($id, [$this->counted($line, '5')])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        $before = $this->stockEffects();

        $this->validation($id)->assertStatus(422)->assertJson(['error' => ['fields' => ['lines.'.$line => ['Le motif de l\'écart de la ligne FR-001 est obligatoire (3 caractères au moins).']]]]);
        $this->validation($id, 'ok')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reason']]]);
        $this->validation($id, 'Inventaire de novembre', false)->assertStatus(423)->assertJsonPath('error.code', 'REAUTHENTICATION_REQUIRED');
        $this->assertSame($before, $this->stockEffects());

        // Un compte autorisé à compter (stock.inventory) mais qui n'est pas la gérante ne valide pas.
        $this->allowPermission($this->clinician, 'stock.inventory');
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/reopen', [], $this->clinician)->assertOk();
        $this->record($id, [$this->counted($line, '5', 'Casse constatée')], $this->clinician)->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [], $this->clinician)->assertOk();
        $this->validation($id, 'Inventaire de novembre', true, null, $this->clinician)->assertForbidden()->assertJsonPath('error.code', 'ACTION_FORBIDDEN');
        $this->assertSame($before['movements'], $this->stockEffects()['movements']);
        $this->validation($id)->assertOk();
    }

    public function test_le_rejeu_de_la_validation_n_ajuste_pas_deux_fois(): void
    {
        $position = $this->seedPosition($this->item['frame'], '7');
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $this->record($id, [$this->counted($this->lineId($detail, 'FR-001'), '4', 'Casse constatée')])->assertOk();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [])->assertOk();
        $key = Ulid::generate();

        $first = $this->validation($id, 'Inventaire de novembre', true, $key);
        $first->assertOk();
        $afterFirst = $this->stockEffects();
        $second = $this->validation($id, 'Inventaire de novembre', true, $key);

        $second->assertOk();
        $this->assertSame($first->json('data'), $second->json('data'));
        $this->assertSame($afterFirst, $this->stockEffects());
        $this->assertSame('4.000', DB::table('stock_positions')->where('id', $position)->value('on_hand'));
        $this->validation($id)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->assertSame($afterFirst, $this->stockEffects());
    }

    // --- Droits, lecture et isolation ---------------------------------------------------------------------------

    public function test_seul_le_droit_stock_inventory_ouvre_les_inventaires_et_un_module_ferme_repond_404(): void
    {
        $this->seedPosition($this->item['frame'], '7');
        foreach ([$this->cashier, $this->clinician, $this->reception] as $user) {
            $this->read('/api/v1/inventory-counts', $user)->assertForbidden();
            $this->open('INV-X', null, $user)->assertForbidden();
        }
        config(['eeo.enabled_modules' => ['sales']]);
        $this->read('/api/v1/inventory-counts', $this->manager)->assertNotFound();
        $this->open()->assertNotFound();
    }

    public function test_la_liste_filtre_et_les_valeurs_sont_masquees_sans_valuation(): void
    {
        $this->seedStock();
        $done = (array) $this->open('INV-1')->json('data');
        $this->send('POST', '/api/v1/inventory-counts/'.$done['id'].'/abandon', [])->assertOk();
        $open = (array) $this->open('INV-2')->json('data');
        $this->record((string) $open['id'], [$this->counted($this->lineId($open, 'FR-001'), '5', 'Casse constatée')])->assertOk();

        $all = $this->read('/api/v1/inventory-counts', $this->manager);
        $all->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.status', 'OPEN')->assertJsonPath('data.1.status', 'ABANDONED')->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.variance_value_known', -36000);
        $this->assertMatchesContract($all, 'schemas/resources/stock.json#/$defs/InventoryCountPage');
        $this->assertArrayNotHasKey('lines', (array) $all->json('data.0'));
        $this->read('/api/v1/inventory-counts?status=ABANDONED', $this->manager)->assertOk()->assertJsonCount(1, 'data');
        $this->read('/api/v1/inventory-counts?location_id='.Ulid::generate(), $this->manager)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/inventory-counts?status=INCONNU', $this->manager)->assertStatus(422);
        $this->read('/api/v1/inventory-counts?page=0', $this->manager)->assertStatus(422);
        $this->read('/api/v1/inventory-counts/'.Ulid::generate(), $this->manager)->assertNotFound();

        // Un compte autorisé à compter sans `stock.valuation.read` ne voit ni coût ni valeur.
        $this->allowPermission($this->clinician, 'stock.inventory');
        $masked = $this->read('/api/v1/inventory-counts/'.$open['id'], $this->clinician);
        $masked->assertOk()->assertJsonPath('data.variance_value_known', null)->assertJsonPath('data.unknown_cost_lines', null);
        $this->assertSame([null, null], [$masked->json('data.lines.2.unit_cost'), $masked->json('data.lines.2.variance_value')]);
        $this->assertMatchesContract($masked, 'schemas/resources/stock.json#/$defs/InventoryCountResponse');
    }

    public function test_un_autre_cabinet_ne_voit_ni_ne_modifie_rien(): void
    {
        $this->seedPosition($this->item['frame'], '7');
        $detail = (array) $this->open()->json('data');
        $id = (string) $detail['id'];
        $stranger = $this->makeStaff($this->makeClinic('AUTRE CABINET'), 'MANAGER', 'gerante.autre');

        $this->read('/api/v1/inventory-counts', $stranger)->assertOk()->assertJsonCount(0, 'data');
        $this->read('/api/v1/inventory-counts/'.$id, $stranger)->assertNotFound();
        $this->record($id, [$this->counted($this->lineId($detail, 'FR-001'), '1')], $stranger)->assertNotFound();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/complete', [], $stranger)->assertNotFound();
        $this->send('POST', '/api/v1/inventory-counts/'.$id.'/abandon', [], $stranger)->assertNotFound();
        $this->validation($id, 'Inventaire de novembre', true, null, $stranger)->assertNotFound();
        $this->assertSame('OPEN', DB::table('inventory_counts')->where('id', $id)->value('status'));
    }
}

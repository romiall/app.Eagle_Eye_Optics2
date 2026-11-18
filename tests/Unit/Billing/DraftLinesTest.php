<?php

namespace Tests\Unit\Billing;

use App\Domain\Billing\Rules\DiscountPolicy;
use App\Domain\Billing\Rules\DraftLine;
use App\Domain\Billing\Rules\DraftLines;
use App\Domain\Billing\Rules\DraftPolicy;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\ValueObjects\Rate;
use PHPUnit\Framework\TestCase;
use stdClass;

/**
 * Validation et calcul des lignes d'un brouillon (B02, AT07, AT08) : fonctions pures, sans base. Les montants viennent
 * de `LineAmounts` (vecteurs communs PHP/TypeScript) ; ici on prouve ce que le brouillon y ajoute (catalogue, droits,
 * identifiants, désignation). Données fictives.
 */
final class DraftLinesTest extends TestCase
{
    private const ITEM_FRACTIONAL = '01J9ZXK4M2Q8R7S6T5V4W30001';

    private const ITEM_PAIR = '01J9ZXK4M2Q8R7S6T5V4W30002';

    private const ITEM_INACTIVE = '01J9ZXK4M2Q8R7S6T5V4W30003';

    private const ITEM_TAXED = '01J9ZXK4M2Q8R7S6T5V4W30004';

    private const RULE = '01J9ZXK4M2Q8R7S6T5V4W30009';

    /**
     * @param  array<string, mixed>  $fields
     */
    private function item(string $id, array $fields = []): stdClass
    {
        return (object) ($fields + [
            'id' => $id, 'reference' => 'ART-'.substr($id, -4), 'category_code' => 'OTHER', 'unit_code' => 'UNIT', 'active' => 1,
            'quantity_integer_only' => 1, 'sale_price' => 1001, 'tax_rule_id' => null, 'stock_mode' => 'NONE', 'requires_expiry' => 0,
        ]);
    }

    /**
     * @return array<string, stdClass>
     */
    private function catalog(): array
    {
        return [
            self::ITEM_FRACTIONAL => $this->item(self::ITEM_FRACTIONAL, ['quantity_integer_only' => 0, 'unit_code' => 'SERVICE', 'category_code' => 'SERVICE']),
            self::ITEM_PAIR => $this->item(self::ITEM_PAIR, ['unit_code' => 'PAIR', 'sale_price' => 60000, 'stock_mode' => 'MADE_TO_ORDER']),
            self::ITEM_INACTIVE => $this->item(self::ITEM_INACTIVE, ['active' => 0]),
            self::ITEM_TAXED => $this->item(self::ITEM_TAXED, ['sale_price' => 11000, 'tax_rule_id' => self::RULE, 'stock_mode' => 'STOCKED']),
        ];
    }

    /**
     * @return array<string, stdClass>
     */
    private function rules(): array
    {
        return [self::RULE => (object) ['id' => self::RULE, 'code' => 'TEST_TAXE', 'rate_percent' => '10.0000']];
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function line(string $itemId, array $overrides = [], int $position = 1): array
    {
        return $overrides + [
            'line_id' => '01J9ZXK4M2Q8R7S6T5V4W4'.str_pad((string) $position, 4, '0', STR_PAD_LEFT),
            'position' => $position,
            'catalog_item_id' => $itemId,
            'description' => 'Ligne fictive',
            'quantity' => '1',
            'unit_price_gross' => (int) ($this->catalog()[$itemId]->sale_price ?? 1001),
            'discount_gross' => 0,
            'prescription_id' => null,
        ];
    }

    private function manager(): DraftPolicy
    {
        return new DraftPolicy(true, true, DiscountPolicy::capFor(true, '0'), null);
    }

    private function cashier(string $cap = '0'): DraftPolicy
    {
        return new DraftPolicy(true, false, DiscountPolicy::capFor(false, $cap), null);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<DraftLine>, 1: FieldErrors, 2: FieldErrors}
     */
    private function build(array $lines, DraftPolicy $policy): array
    {
        $validation = new FieldErrors;
        $rights = new FieldErrors;
        $built = DraftLines::build($lines, $this->catalog(), $this->rules(), $policy, $validation, $rights);

        return [$built, $validation, $rights];
    }

    public function test_une_quantite_decimale_exacte_donne_le_brut_arrondi_au_franc_demi_superieur(): void
    {
        // Vecteur du contrat 23 : 1.125 × 1001 = 1126.125 → 1126.
        [$built, $validation, $rights] = $this->build([$this->line(self::ITEM_FRACTIONAL, ['quantity' => '1.125'])], $this->manager());

        $this->assertTrue($validation->isEmpty());
        $this->assertTrue($rights->isEmpty());
        $this->assertSame(1126, $built[0]->amounts->gross);
        $this->assertSame(1126, $built[0]->amounts->net);
        $this->assertSame('1.125', $built[0]->quantity->canonical());
        $this->assertSame(1126, DraftLines::total($built));
    }

    public function test_le_total_est_la_somme_des_nets_de_ligne_et_les_lignes_sont_triees_par_position(): void
    {
        [$built] = $this->build([
            $this->line(self::ITEM_PAIR, ['quantity' => '2', 'discount_gross' => 20000], 2),
            $this->line(self::ITEM_FRACTIONAL, ['quantity' => '3'], 1),
        ], $this->manager());

        $this->assertSame([1, 2], array_map(static fn (DraftLine $line): int => $line->position, $built));
        $this->assertSame(3003, $built[0]->amounts->net);
        $this->assertSame(100000, $built[1]->amounts->net, '2 × 60 000 − 20 000');
        $this->assertSame(103003, DraftLines::total($built));
    }

    public function test_une_paire_n_est_jamais_transformee_en_deux_unites(): void
    {
        [$built, $validation] = $this->build([$this->line(self::ITEM_PAIR, ['quantity' => '1.5'])], $this->manager());

        $this->assertSame([], $built);
        $this->assertArrayHasKey('lines.0.quantity', $validation->all());
    }

    public function test_une_remise_au_dela_du_brut_est_refusee_par_le_schema_meme_pour_la_gerante(): void
    {
        [, $validation] = $this->build([$this->line(self::ITEM_FRACTIONAL, ['quantity' => '1', 'discount_gross' => 1002])], $this->manager());

        $this->assertArrayHasKey('lines.0.discount_gross', $validation->all());
    }

    public function test_les_erreurs_de_toutes_les_lignes_sont_rendues_ensemble(): void
    {
        [, $validation] = $this->build([
            $this->line(self::ITEM_PAIR, ['quantity' => '1.5'], 1),
            $this->line(self::ITEM_FRACTIONAL, ['description' => '   '], 2),
            $this->line('01J9ZXK4M2Q8R7S6T5V4W3FFFF', [], 3),
        ], $this->manager());

        $this->assertSame(['lines.0.quantity', 'lines.1.description', 'lines.2.catalog_item_id'], array_keys($validation->all()));
    }

    public function test_un_article_desactive_ou_inconnu_est_refuse(): void
    {
        [, $validation] = $this->build([
            $this->line(self::ITEM_INACTIVE, [], 1),
            $this->line('01J9ZXK4M2Q8R7S6T5V4W3FFFF', [], 2),
        ], $this->manager());

        $this->assertArrayHasKey('lines.0.catalog_item_id', $validation->all());
        $this->assertArrayHasKey('lines.1.catalog_item_id', $validation->all());
    }

    public function test_identifiants_de_ligne_et_positions_sont_distincts(): void
    {
        $first = $this->line(self::ITEM_FRACTIONAL, [], 1);
        $second = $this->line(self::ITEM_FRACTIONAL, ['line_id' => $first['line_id']], 1);

        [, $validation] = $this->build([$first, $second], $this->manager());

        $this->assertArrayHasKey('lines.1.line_id', $validation->all());
        $this->assertArrayHasKey('lines.1.position', $validation->all());
    }

    public function test_la_designation_est_obligatoire_et_sans_caractere_de_controle(): void
    {
        [, $validation] = $this->build([
            $this->line(self::ITEM_FRACTIONAL, ['description' => "Deux\nlignes"], 1),
            $this->line(self::ITEM_FRACTIONAL, ['description' => str_repeat('é', 501)], 2),
        ], $this->manager());

        $this->assertArrayHasKey('lines.0.description', $validation->all());
        $this->assertArrayHasKey('lines.1.description', $validation->all());
    }

    public function test_la_taxe_comprise_n_est_ventilee_que_par_une_regle_validee_et_appliquee(): void
    {
        [$built] = $this->build([$this->line(self::ITEM_TAXED, [], 1), $this->line(self::ITEM_FRACTIONAL, [], 2)], $this->manager());

        $this->assertSame('TEST_TAXE', $built[0]->taxCodeSnapshot);
        $this->assertSame('10.0000', $built[0]->taxRate?->canonical());
        $this->assertSame(1000, $built[0]->amounts->taxAmount, '11 000 × 10 / 110');
        $this->assertSame(self::RULE, $built[0]->taxRuleId);
        $this->assertSame('NO_TAX_CONFIGURED', $built[1]->taxCodeSnapshot);
        $this->assertNull($built[1]->taxRate);
        $this->assertNull($built[1]->amounts->taxAmount, 'Aucune taxe inventée : null, pas zéro.');
    }

    public function test_une_regle_non_appliquable_n_est_pas_ventilee(): void
    {
        $validation = new FieldErrors;
        $rights = new FieldErrors;

        $built = DraftLines::build([$this->line(self::ITEM_TAXED)], $this->catalog(), [], $this->manager(), $validation, $rights);

        $this->assertSame('NO_TAX_CONFIGURED', $built[0]->taxCodeSnapshot);
        $this->assertNull($built[0]->amounts->taxAmount);
    }

    public function test_la_caissiere_ne_change_ni_le_prix_du_catalogue_ni_ne_remise(): void
    {
        [, $validation, $rights] = $this->build([
            $this->line(self::ITEM_FRACTIONAL, ['unit_price_gross' => 900], 1),
            $this->line(self::ITEM_FRACTIONAL, ['discount_gross' => 1], 2),
        ], $this->cashier());

        $this->assertTrue($validation->isEmpty());
        $this->assertArrayHasKey('lines.0.unit_price_gross', $rights->all());
        $this->assertArrayHasKey('lines.1.discount_gross', $rights->all());
    }

    public function test_la_gerante_fixe_prix_et_remise_jusqu_au_brut(): void
    {
        [$built, $validation, $rights] = $this->build([$this->line(self::ITEM_FRACTIONAL, ['unit_price_gross' => 900, 'discount_gross' => 900])], $this->manager());

        $this->assertTrue($validation->isEmpty());
        $this->assertTrue($rights->isEmpty());
        $this->assertSame(0, $built[0]->amounts->net);
    }

    public function test_un_plafond_configure_autorise_une_remise_limitee_en_pourcentage_du_brut(): void
    {
        // 5 % de 60 000 = 3 000.
        [, $validation, $rights] = $this->build([
            $this->line(self::ITEM_PAIR, ['discount_gross' => 3000], 1),
            $this->line(self::ITEM_PAIR, ['discount_gross' => 3001], 2),
        ], $this->cashier('5'));

        $this->assertTrue($validation->isEmpty());
        $this->assertSame(['lines.1.discount_gross'], array_keys($rights->all()));
    }

    public function test_une_ligne_libre_est_reservee_a_l_autorite_de_prix(): void
    {
        $free = $this->line(self::ITEM_FRACTIONAL, ['catalog_item_id' => null, 'description' => 'Réparation fictive', 'unit_price_gross' => 2500]);

        [$asCashier, , $rights] = $this->build([$free], $this->cashier());
        [$asManager, $validation, $managerRights] = $this->build([$free], $this->manager());

        $this->assertArrayHasKey('lines.0.catalog_item_id', $rights->all());
        $this->assertTrue($validation->isEmpty());
        $this->assertTrue($managerRights->isEmpty());
        $this->assertNull($asManager[0]->catalogItemId);
        $this->assertSame('OTHER', $asManager[0]->categorySnapshot);
        $this->assertSame('UNIT', $asManager[0]->unitSnapshot);
        $this->assertCount(1, $asCashier, 'La ligne est calculée, c\'est le droit qui la refuse.');
    }

    public function test_le_profil_frais_d_examen_ne_facture_que_la_prestation_fixe_a_la_quantite_un(): void
    {
        $policy = new DraftPolicy(true, false, DiscountPolicy::capFor(false, '0'), self::ITEM_FRACTIONAL);

        [, $validation, $rights] = $this->build([
            $this->line(self::ITEM_FRACTIONAL, [], 1),
            $this->line(self::ITEM_PAIR, [], 2),
            $this->line(self::ITEM_FRACTIONAL, ['quantity' => '2'], 3),
        ], $policy);

        $this->assertTrue($validation->isEmpty());
        $this->assertSame(['lines.1.catalog_item_id', 'lines.2.quantity'], array_keys($rights->all()));
    }

    public function test_a_l_emission_les_lignes_sont_recalculees_sans_regle_de_droit(): void
    {
        // Une remise accordée par la gérante au brouillon n'est pas re-contrôlée contre la caissière qui émet.
        [$built, $validation, $rights] = $this->build([$this->line(self::ITEM_PAIR, ['discount_gross' => 10000])], DraftPolicy::trusted());

        $this->assertTrue($validation->isEmpty());
        $this->assertTrue($rights->isEmpty());
        $this->assertSame(50000, $built[0]->amounts->net);
    }

    public function test_les_lignes_stockees_reprennent_la_forme_de_la_charge(): void
    {
        $row = (object) [
            'id' => '01J9ZXK4M2Q8R7S6T5V4W40001', 'position' => 2, 'catalog_item_id' => self::ITEM_PAIR, 'description_snapshot' => 'Verres',
            'quantity' => '1.000', 'unit_price_gross' => 60000, 'discount_gross' => 0, 'prescription_id' => null,
        ];

        $this->assertSame([[
            'line_id' => '01J9ZXK4M2Q8R7S6T5V4W40001', 'position' => 2, 'catalog_item_id' => self::ITEM_PAIR, 'description' => 'Verres',
            'quantity' => '1.000', 'unit_price_gross' => 60000, 'discount_gross' => 0, 'prescription_id' => null,
        ]], DraftLines::fromStored([$row]));
    }

    public function test_les_montants_non_entiers_sont_refuses(): void
    {
        [, $validation] = $this->build([$this->line(self::ITEM_FRACTIONAL, ['unit_price_gross' => 10.5, 'discount_gross' => '0'])], $this->manager());

        $this->assertSame(['lines.0.unit_price_gross', 'lines.0.discount_gross'], array_keys($validation->all()));
    }

    public function test_le_taux_de_la_regle_est_un_taux_exact(): void
    {
        $this->assertSame('10.0000', Rate::of('10')->canonical());
    }

    public function test_une_ligne_hors_catalogue_prend_la_regle_exoneree_par_defaut_si_fournie(): void
    {
        $validation = new FieldErrors;
        $rights = new FieldErrors;
        $exemptRuleId = '01J9ZXK4M2Q8R7S6T5V4W3TX02';
        $exemptRule = (object) ['id' => $exemptRuleId, 'code' => 'EXO', 'rate_percent' => '0.0000'];

        $freeLine = [
            'line_id' => '01J9ZXK4M2Q8R7S6T5V4W40099',
            'position' => 1,
            'catalog_item_id' => null,
            'description' => 'Consultation hors catalogue',
            'quantity' => '1',
            'unit_price_gross' => 3000,
            'discount_gross' => 0,
            'prescription_id' => null,
        ];
        $built = DraftLines::build(
            [$freeLine, $this->line(self::ITEM_FRACTIONAL, [], 2)],
            $this->catalog(),
            $this->rules(),
            $this->manager(),
            $validation,
            $rights,
            $exemptRule,
        );

        $this->assertTrue($validation->isEmpty());
        $this->assertTrue($rights->isEmpty());
        $this->assertSame('EXO', $built[0]->taxCodeSnapshot);
        $this->assertSame('0.0000', $built[0]->taxRate?->canonical());
        $this->assertSame($exemptRuleId, $built[0]->taxRuleId);
        $this->assertSame(0, $built[0]->amounts->taxAmount);
        // Un article du catalogue sans règle fiscale reste sans règle : l'exonération ne s'applique qu'aux lignes hors catalogue.
        $this->assertSame('NO_TAX_CONFIGURED', $built[1]->taxCodeSnapshot);
        $this->assertNull($built[1]->taxRate);
        $this->assertNull($built[1]->amounts->taxAmount);
    }
}

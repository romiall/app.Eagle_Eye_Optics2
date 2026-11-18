<?php

namespace App\Domain\Billing\Rules;

use App\Domain\Billing\Catalog\TaxRegime;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;
use App\Domain\Shared\ValueObjects\Rate;
use App\Domain\Shared\ValueObjects\Text;
use stdClass;

/**
 * Validation et calcul des lignes d'un brouillon de facture (B02, EE020, EE021, EE045). Fonction pure : le
 * catalogue et les règles fiscales applicables sont passés en paramètres, rien n'est lu en base.
 *
 * Pour chaque ligne :
 *  - identifiants de ligne et positions distincts (clés uniques du schéma) ;
 *  - désignation obligatoire, sans caractère de contrôle ;
 *  - article du catalogue actif, ou ligne LIBRE (hors catalogue) réservée à l'autorité de prix ;
 *  - quantité exacte (`DECIMAL(12,3)`, jamais convertie en nombre flottant), entière si l'article l'exige : une
 *    paire n'est jamais transformée automatiquement en deux unités ;
 *  - prix TTC unitaire = prix du catalogue pour qui n'a pas l'autorité de prix ;
 *  - brut = arrondi demi supérieur de quantité × prix, net = brut − remise, 0 ≤ remise ≤ brut (CHECK du schéma),
 *    remise plafonnée par le droit de l'auteur (`DiscountPolicy`) ;
 *  - taxe comprise ventilée seulement si une règle fiscale VALIDÉE s'applique à l'article, sinon `null`.
 *
 * Deux jeux d'erreurs : la saisie invalide (422 `VALIDATION_FAILED`) et ce qui exige l'autorisation de la gérante
 * (422 `APPROVAL_REQUIRED_OR_EXPIRED`, tant que les approbations B06 n'existent pas). Le total vient de
 * `LineAmounts::invoiceTotal` : mêmes vecteurs que le futur client.
 */
final class DraftLines
{
    /** Catégorie et unité d'une ligne libre (valeurs du référentiel `catalog_categories` et `units`). */
    public const FREE_LINE_CATEGORY = 'OTHER';

    public const FREE_LINE_UNIT = 'UNIT';

    /** Caractères de contrôle interdits dans une désignation (retours à la ligne compris : une ligne tient sur une ligne). */
    private const CONTROL_CHARACTERS = '/[\x00-\x1F\x7F]/u';

    /**
     * @param  list<array<string, mixed>>  $lines  lignes de la charge (`CreateInvoiceDraft.lines`)
     * @param  array<string, stdClass>  $items  articles du catalogue du cabinet, par identifiant
     * @param  array<string, stdClass>  $taxRules  règles fiscales applicables (actives et validées), par identifiant
     * @param  stdClass|null  $defaultFreeLineRule  règle fiscale exonérée (0 %) par défaut pour les lignes hors catalogue
     * @return list<DraftLine> triées par position
     */
    public static function build(array $lines, array $items, array $taxRules, DraftPolicy $policy, FieldErrors $validation, FieldErrors $rights, ?stdClass $defaultFreeLineRule = null): array
    {
        $built = [];
        $seenIds = [];
        $seenPositions = [];

        // Chaque ligne est un objet : le schéma de la commande l'a vérifié avant le handler (route directe et synchronisation).
        foreach ($lines as $index => $line) {
            $prefix = 'lines.'.$index;

            $lineId = is_string($line['line_id'] ?? null) ? $line['line_id'] : '';
            $position = is_int($line['position'] ?? null) ? $line['position'] : 0;
            if (isset($seenIds[$lineId])) {
                $validation->add($prefix.'.line_id', 'Identifiant de ligne en double dans le brouillon.');
            }
            if (isset($seenPositions[$position])) {
                $validation->add($prefix.'.position', 'Deux lignes occupent la même position.');
            }
            $seenIds[$lineId] = true;
            $seenPositions[$position] = true;

            $description = self::description($line['description'] ?? null, $prefix, $validation);
            $quantity = self::quantity($line['quantity'] ?? null, $prefix, $validation);
            $unitPrice = $line['unit_price_gross'] ?? null;
            $discount = $line['discount_gross'] ?? null;
            if (! is_int($unitPrice)) {
                $validation->add($prefix.'.unit_price_gross', 'Prix unitaire : un nombre entier de FCFA est attendu.');
            }
            if (! is_int($discount)) {
                $validation->add($prefix.'.discount_gross', 'Remise : un nombre entier de FCFA est attendu.');
            }

            $itemId = is_string($line['catalog_item_id'] ?? null) ? $line['catalog_item_id'] : null;
            $item = null;
            if ($itemId !== null) {
                $item = $items[$itemId] ?? null;
                if ($item === null || ! (bool) $item->active) {
                    $validation->add($prefix.'.catalog_item_id', 'Article introuvable ou désactivé dans le catalogue.');

                    continue;
                }
            } elseif ($policy->enforceRights && ! $policy->priceAuthority) {
                $rights->add($prefix.'.catalog_item_id', 'Une ligne hors catalogue exige l\'autorité de prix de la gérante.');
            }

            if ($description === null || $quantity === null || ! is_int($unitPrice) || ! is_int($discount)) {
                continue;
            }

            $integerOnly = $item === null ? true : (bool) $item->quantity_integer_only;
            $rule = $item === null
                ? $defaultFreeLineRule
                : ($item->tax_rule_id !== null ? ($taxRules[(string) $item->tax_rule_id] ?? null) : null);
            $taxRate = $rule === null ? null : Rate::of((string) $rule->rate_percent);

            try {
                $amounts = LineAmounts::compute($quantity, $unitPrice, $discount, $taxRate, $integerOnly);
            } catch (RuleViolation $violation) {
                $validation->addViolation($prefix, $violation);

                continue;
            }

            if ($policy->enforceRights) {
                self::checkRights($prefix, $item, $itemId, $quantity->canonical(), $unitPrice, $amounts, $policy, $rights);
            }

            $built[] = new DraftLine(
                id: $lineId,
                position: $position,
                catalogItemId: $itemId,
                description: $description,
                quantity: $quantity,
                unitPriceGross: $unitPrice,
                discountGross: $discount,
                prescriptionId: is_string($line['prescription_id'] ?? null) ? $line['prescription_id'] : null,
                referenceSnapshot: $item === null ? null : (string) $item->reference,
                categorySnapshot: $item === null ? self::FREE_LINE_CATEGORY : (string) $item->category_code,
                unitSnapshot: $item === null ? self::FREE_LINE_UNIT : (string) $item->unit_code,
                taxCodeSnapshot: $rule === null ? TaxRegime::NO_TAX_CONFIGURED : (string) $rule->code,
                taxRate: $taxRate,
                amounts: $amounts,
                taxRuleId: $rule === null ? null : (string) $rule->id,
                stocked: $item !== null && (string) $item->stock_mode === 'STOCKED',
                requiresExpiry: $item !== null && (bool) $item->requires_expiry,
            );
        }

        usort($built, static fn (DraftLine $left, DraftLine $right): int => $left->position <=> $right->position);

        return $built;
    }

    /**
     * Total de la facture : somme des nets de ligne, borné comme la colonne (`LineAmounts::invoiceTotal`).
     *
     * @param  list<DraftLine>  $lines
     */
    public static function total(array $lines): int
    {
        return LineAmounts::invoiceTotal(array_map(static fn (DraftLine $line): LineAmounts => $line->amounts, $lines));
    }

    /**
     * Lignes d'un brouillon déjà enregistré, remises sous la forme de la charge pour être recalculées à l'émission.
     *
     * @param  list<stdClass>  $rows  lignes `invoice_lines`
     * @return list<array<string, mixed>>
     */
    public static function fromStored(array $rows): array
    {
        return array_map(static fn (stdClass $row): array => [
            'line_id' => (string) $row->id,
            'position' => (int) $row->position,
            'catalog_item_id' => $row->catalog_item_id === null ? null : (string) $row->catalog_item_id,
            'description' => (string) $row->description_snapshot,
            'quantity' => (string) $row->quantity,
            'unit_price_gross' => (int) $row->unit_price_gross,
            'discount_gross' => (int) $row->discount_gross,
            'prescription_id' => $row->prescription_id === null ? null : (string) $row->prescription_id,
        ], $rows);
    }

    private static function description(mixed $value, string $prefix, FieldErrors $validation): ?string
    {
        if (! is_string($value)) {
            $validation->add($prefix.'.description', 'La désignation est obligatoire.');

            return null;
        }
        try {
            $trimmed = Text::optional($value, 500, 'description');
        } catch (RuleViolation $violation) {
            $validation->addViolation($prefix, $violation);

            return null;
        }
        if ($trimmed === null) {
            $validation->add($prefix.'.description', 'La désignation est obligatoire.');

            return null;
        }
        if (preg_match(self::CONTROL_CHARACTERS, $trimmed) === 1) {
            $validation->add($prefix.'.description', 'La désignation ne peut contenir ni retour à la ligne ni caractère de contrôle.');

            return null;
        }

        return $trimmed;
    }

    private static function quantity(mixed $value, string $prefix, FieldErrors $validation): ?FixedDecimal
    {
        if (! is_string($value)) {
            $validation->add($prefix.'.quantity', 'La quantité est une chaîne décimale exacte, par exemple « 1 » ou « 1.5 ».');

            return null;
        }
        try {
            $quantity = Quantity::parse($value, 'quantity');
        } catch (RuleViolation $violation) {
            $validation->addViolation($prefix, $violation);

            return null;
        }
        if ($quantity === null) {
            $validation->add($prefix.'.quantity', 'La quantité est obligatoire.');
        }

        return $quantity;
    }

    private static function checkRights(string $prefix, ?stdClass $item, ?string $itemId, string $quantity, int $unitPrice, LineAmounts $amounts, DraftPolicy $policy, FieldErrors $rights): void
    {
        if ($policy->examFeeItemId !== null) {
            // Profil « frais d'examen » : la prestation fixe, quantité 1, sans remise, rien d'autre.
            if ($itemId !== $policy->examFeeItemId) {
                $rights->add($prefix.'.catalog_item_id', 'Ce profil ne peut facturer que les frais d\'examen.');
            }
            if ($quantity !== '1.000') {
                $rights->add($prefix.'.quantity', 'Les frais d\'examen se facturent à la quantité 1.');
            }
        }

        if ($policy->priceAuthority) {
            return;
        }
        if ($item !== null && $unitPrice !== (int) $item->sale_price) {
            $rights->add($prefix.'.unit_price_gross', 'Le prix du catalogue ne se modifie pas sans l\'autorité de prix de la gérante.');
        }
        if (! DiscountPolicy::allows($amounts->gross, $amounts->discount, $policy->discountCapPercent)) {
            $rights->add($prefix.'.discount_gross', 'Cette remise dépasse celle que votre profil peut accorder : elle exige l\'autorisation exacte de la gérante.');
        }
    }
}

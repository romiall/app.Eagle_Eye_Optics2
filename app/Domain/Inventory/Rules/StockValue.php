<?php

namespace App\Domain\Inventory\Rules;

use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Money;
use Brick\Math\BigInteger;

/**
 * Valeur d'une quantité au coût d'achat connu (fichier 02 : « valorisation au coût d'achat connu ») : arrondie au
 * FCFA, demi supérieur sur la valeur absolue (même règle que le brut d'une ligne de facture, `LineAmounts`), en entier
 * exact, jamais en flottant. Une quantité négative (écart de comptage en moins) donne une valeur négative.
 *
 * Un coût INCONNU n'a aucune valeur : l'appelant le compte à part (« coût inconnu »), jamais à zéro. C'est une valeur
 * indicative de gestion : la méthode officielle de valorisation reste à définir avec le comptable (fichier 03).
 */
final class StockValue
{
    public static function of(FixedDecimal $quantity, int $unitCost): int
    {
        Money::amount($unitCost, 'unit_cost');
        $magnitude = BigInteger::of(abs($quantity->units))->multipliedBy($unitCost)->plus(500)->quotient(1000);
        if ($magnitude->isGreaterThan(Money::MAX)) {
            throw RuleViolation::invalid('quantity', 'stock.value_out_of_range', 'La valeur du stock dépasse 1 000 milliards de FCFA.');
        }
        $value = $magnitude->toInt();

        return $quantity->isNegative() ? -$value : $value;
    }
}

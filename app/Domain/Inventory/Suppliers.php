<?php

namespace App\Domain\Inventory;

use App\Domain\Shared\BusinessError;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Fournisseurs et laboratoires (`suppliers`, L1D01), lus pour la liste, le choix d'une réception et la fiche. Toujours
 * limités au cabinet. Les coordonnées sont celles d'une entreprise, jamais d'un patient.
 */
final class Suppliers
{
    /**
     * Tous les fournisseurs du cabinet (liste courte), actifs d'abord puis par nom ; `active` : 1 ou 0 pour filtrer.
     *
     * @return list<array<string, mixed>>
     */
    public static function list(string $clinicId, mixed $active = null): array
    {
        $query = DB::table('suppliers')->where('clinic_id', $clinicId);
        if ($active !== null && $active !== '') {
            if ($active !== '1' && $active !== '0' && $active !== 1 && $active !== 0) {
                throw BusinessError::validation(['active' => ['Le filtre vaut 1 (actifs) ou 0 (désactivés).']]);
            }
            $query->where('active', (int) $active);
        }

        return array_values(array_map(self::present(...), $query->orderByDesc('active')->orderBy('name')->orderBy('id')->get()->all()));
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function find(string $clinicId, string $id): ?array
    {
        $row = DB::table('suppliers')->where('clinic_id', $clinicId)->where('id', $id)->first();

        return $row === null ? null : self::present($row);
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'reference' => (string) $row->reference,
            'phone' => $row->phone === null ? null : (string) $row->phone,
            'email' => $row->email === null ? null : (string) $row->email,
            'address' => $row->address === null ? null : (string) $row->address,
            'is_optical_lab' => (bool) $row->is_optical_lab,
            'active' => (bool) $row->active,
        ];
    }
}

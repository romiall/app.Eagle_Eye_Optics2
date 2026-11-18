<?php

namespace App\Http\Resources;

use App\Domain\Patients\PatientActivity;
use App\Domain\Patients\PatientActivityPage;
use Carbon\CarbonImmutable;
use LogicException;
use stdClass;

/**
 * Représentation de l'activité d'un patient (schemas/resources/patients.json#/$defs/PatientActivity) : identifiants,
 * dates, états, numéros et montants seulement, jamais une valeur clinique.
 *
 * `meta.sections` ne liste que les sections visibles du compte, avec leur nombre d'éléments : une section absente
 * n'a ni compte ni indice. `screen_path` est l'adresse de l'écran qui ouvre l'élément, donnée seulement si cet
 * écran existe et si le compte peut l'ouvrir (droit et module) ; sinon null et l'écran affiche du texte simple.
 *
 * État de règlement d'une facture : DÉRIVÉ du solde projeté (`vw_invoice_balances`), mêmes valeurs que
 * `InvoiceBalance.settlement` du contrat (sans NOT_ISSUED : seules les factures émises figurent ici). Aucun statut
 * « payé » n'existe : SETTLED dit « solde nul », qui peut venir d'un avoir autant que d'un encaissement.
 */
final class PatientActivityPresenter
{
    /**
     * @param  array<string, bool>  $screens  écrans ouvrables par le compte : `consultations`, `sales`
     * @return array{data: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    public static function page(PatientActivityPage $page, array $screens, ?string $patientId = null): array
    {
        $sections = [];
        foreach (PatientActivity::SECTIONS as $code) {
            if (array_key_exists($code, $page->totals)) {
                $sections[] = ['section' => $code, 'total' => $page->totals[$code]];
            }
        }

        return [
            'data' => array_map(static fn (array $item): array => self::item($item, $screens, $patientId), $page->items),
            'meta' => [
                'current_page' => $page->currentPage,
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage,
                'total' => $page->total,
                'section' => $page->section,
                'sections' => $sections,
            ],
        ];
    }

    /**
     * @param  array{type: string, occurred_at: string, row: stdClass}  $item
     * @param  array<string, bool>  $screens
     * @return array<string, mixed>
     */
    private static function item(array $item, array $screens, ?string $patientId): array
    {
        $row = $item['row'];
        $common = ['type' => $item['type'], 'id' => (string) $row->id, 'occurred_at' => self::instant($item['occurred_at'])];
        $consultations = ($screens['consultations'] ?? false) === true;
        $sales = ($screens['sales'] ?? false) === true;

        return match ($item['type']) {
            PatientActivity::VISIT => $common + [
                // Aucun écran de visite : la visite se lit dans la liste.
                'screen_path' => null,
                'reason' => (string) $row->reason,
                'status' => (string) $row->status,
            ],
            PatientActivity::CONSULTATION => $common + [
                'screen_path' => $consultations ? '/consultations/'.$row->id : null,
                'status' => (string) $row->status,
                'clinician_name' => (string) $row->clinician_name,
            ],
            PatientActivity::PRESCRIPTION => $common + [
                'screen_path' => match (true) {
                    $consultations && $row->consultation_id !== null => '/consultations/'.$row->consultation_id.'/prescriptions',
                    $consultations && $patientId !== null => '/patients/'.$patientId.'/prescriptions',
                    default => null,
                },
                'origin' => (string) $row->origin,
                'status' => (string) $row->status,
                'version_no' => (int) $row->version_no,
                'consultation_id' => $row->consultation_id === null ? null : (string) $row->consultation_id,
                'external_prescribed_on' => $row->external_prescribed_on === null ? null : substr((string) $row->external_prescribed_on, 0, 10),
            ],
            PatientActivity::MEDICATION_ORDER => $common + [
                'screen_path' => $consultations ? '/consultations/'.$row->id : null,
                'consultation_id' => (string) $row->id,
                'consultation_status' => (string) $row->status,
            ],
            PatientActivity::INVOICE => $common + [
                'screen_path' => $sales ? '/ventes/factures/'.$row->id : null,
            ] + self::invoice($row),
            PatientActivity::RECEIPT => $common + [
                'screen_path' => $sales ? '/ventes/factures/'.$row->invoice_id : null,
                'number' => (string) $row->number,
                'amount' => (int) $row->amount,
                'method' => (string) $row->method,
                'reversed_amount' => (int) $row->reversed_amount,
                'invoice_id' => (string) $row->invoice_id,
                'invoice_number' => $row->invoice_number === null ? null : (string) $row->invoice_number,
            ],
            PatientActivity::CREDIT_NOTE => $common + [
                'screen_path' => $sales ? '/ventes/factures/'.$row->invoice_id : null,
                'number' => (string) $row->number,
                'amount_gross' => (int) $row->amount_gross,
                'invoice_id' => (string) $row->invoice_id,
                'invoice_number' => $row->invoice_number === null ? null : (string) $row->invoice_number,
            ],
            PatientActivity::REFUND => $common + [
                'screen_path' => $sales ? '/ventes/factures/'.$row->invoice_id : null,
                'number' => (string) $row->number,
                'amount' => (int) $row->amount,
                'method' => (string) $row->method,
                'invoice_id' => (string) $row->invoice_id,
                'invoice_number' => $row->invoice_number === null ? null : (string) $row->invoice_number,
            ],
            default => throw new LogicException('Type d\'élément inconnu : '.$item['type']),
        };
    }

    /**
     * Facture émise et son solde projeté. Sans ligne de projection (impossible pour une facture émise), le solde est
     * le total, rien n'est réputé encaissé.
     *
     * @return array<string, mixed>
     */
    private static function invoice(stdClass $row): array
    {
        $total = (int) $row->total_gross;
        $paidNet = (int) ($row->payments_confirmed ?? 0) - (int) ($row->payment_reversals ?? 0);
        $signed = $row->signed_balance === null ? $total : (int) $row->signed_balance;
        $credit = (int) ($row->refundable_credit ?? 0);

        return [
            'number' => (string) $row->number,
            'origin' => (string) $row->origin,
            'total_gross' => $total,
            'paid_net' => max(0, $paidNet),
            'balance_due' => $signed,
            'credit_available' => $credit,
            'settlement' => self::settlement($signed, $paidNet),
        ];
    }

    /**
     * Même dérivation que l'état de règlement des factures (contrat `InvoiceBalance.settlement`) : crédit à rembourser,
     * solde nul, acompte reçu, ou rien encaissé.
     */
    private static function settlement(int $signedBalance, int $paidNet): string
    {
        return match (true) {
            $signedBalance < 0 => 'IN_CREDIT',
            $signedBalance === 0 => 'SETTLED',
            $paidNet > 0 => 'PARTIALLY_PAID',
            default => 'UNPAID',
        };
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

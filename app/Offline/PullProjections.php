<?php

namespace App\Offline;

use App\Domain\Billing\InvoiceLedger;
use App\Domain\Billing\InvoiceReader;
use App\Domain\Cash\CashMovements;
use App\Domain\Patients\VisitQueue;
use App\Http\Resources\CashPresenter;
use App\Http\Resources\CatalogPresenter;
use App\Http\Resources\InvoicePresenter;
use App\Http\Resources\PatientPresenter;
use App\Http\Resources\VisitPresenter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * Projection d'une entité publiée dans le journal des changements, remise au poste par le pull (O05 ; contrat
 * `sync/pull-page.json`, `data`). Le compartiment est DÉJÀ filtré par le pull (visibilité du changement ∩ grant ∩
 * droits actuels) : une entité d'un compartiment non autorisé n'arrive jamais jusqu'ici.
 *
 * Mêmes représentations que l'API en ligne (présentateurs), jamais plus : fiche patient (administratif), visite (sans
 * l'identifiant ni le statut de sa consultation), facture et solde projeté, paiement, reçu (snapshot figé), avoir,
 * remboursement, session de caisse, article (sans coût d'achat) et règle fiscale du catalogue.
 *
 * Limite déclarée (L0) : les entités CLINIQUES (consultations, prescriptions, révisions) et les autres agrégats sont
 * publiés sans contenu (`data` vide : seulement l'identifiant et la version) ; le poste relit leur contenu en ligne.
 * Une entité disparue entre-temps rend aussi `data` vide.
 */
final class PullProjections
{
    /**
     * @return array<string, mixed>
     */
    public static function project(string $clinicId, string $entityType, string $entityId): array
    {
        return self::of($clinicId, $entityType, $entityId) ?? [];
    }

    /**
     * État central d'une entité pour l'instantané chiffré d'un conflit ; jamais d'exception (null si illisible).
     *
     * @return array<string, mixed>|null
     */
    public static function snapshot(string $clinicId, string $entityType, string $entityId): ?array
    {
        try {
            return self::of($clinicId, $entityType, $entityId);
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function of(string $clinicId, string $entityType, string $entityId): ?array
    {
        $reader = new InvoiceReader;

        switch ($entityType) {
            case 'patient_records':
                $row = self::row('patient_records', $clinicId, $entityId);

                return $row === null ? null : PatientPresenter::patient($row);
            case 'visits':
                $row = VisitQueue::find($clinicId, $entityId);

                return $row === null ? null : VisitPresenter::visit($row);
            case 'invoices':
                $invoice = $reader->find($clinicId, $entityId);
                if ($invoice === null) {
                    return null;
                }
                $ledger = (string) $invoice->status === 'DRAFT' ? null : InvoiceLedger::load($clinicId, $entityId, (int) $invoice->total_gross);

                return InvoicePresenter::summary($invoice, $ledger) + ['source_device_id' => $invoice->source_device_id];
            case 'payments':
                $row = self::row('payments', $clinicId, $entityId);

                return $row === null ? null : [
                    'id' => (string) $row->id,
                    'invoice_id' => (string) $row->invoice_id,
                    'amount' => (int) $row->amount,
                    'method' => (string) $row->method,
                    'reference' => $row->reference,
                    'effective_at' => self::instant($row->effective_at),
                    'status' => (string) $row->status,
                    'cash_session_id' => $row->cash_session_id,
                    'received_by' => $row->received_by,
                    'source_device_id' => $row->source_device_id,
                ];
            case 'receipts':
                $receipt = $reader->receipt($clinicId, $entityId);

                return $receipt === null ? null : InvoicePresenter::receipt($receipt, $reader->receiptDocument($clinicId, $entityId));
            case 'credit_notes':
                $detail = $reader->creditNote($clinicId, $entityId);

                return $detail === null ? null : InvoicePresenter::creditNote($detail);
            case 'refunds':
                $detail = $reader->refund($clinicId, $entityId);

                return $detail === null ? null : InvoicePresenter::refund($detail);
            case 'cash_sessions':
                $row = self::row('cash_sessions', $clinicId, $entityId);

                return $row === null ? null : CashPresenter::session($row);
            case 'cash_movements':
                $row = CashMovements::findForPresentation($clinicId, $entityId);

                return $row === null ? null : CashPresenter::movement($row);
            case 'catalog_items':
                $row = self::row('catalog_items', $clinicId, $entityId);

                return $row === null ? null : CatalogPresenter::item($row, false);
            case 'tax_rules':
                $row = self::row('tax_rules', $clinicId, $entityId);

                return $row === null ? null : CatalogPresenter::taxRule($row);
            default:
                return null;
        }
    }

    private static function row(string $table, string $clinicId, string $id): ?stdClass
    {
        $row = DB::table($table)->where('clinic_id', $clinicId)->where('id', $id)->first();

        return $row instanceof stdClass ? $row : null;
    }

    private static function instant(mixed $stored): ?string
    {
        return $stored === null ? null : CarbonImmutable::parse((string) $stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

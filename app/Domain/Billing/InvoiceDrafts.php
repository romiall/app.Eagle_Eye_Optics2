<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Catalog\TaxRegime;
use App\Domain\Billing\Guards\ActorRights;
use App\Domain\Billing\Rules\DiscountPolicy;
use App\Domain\Billing\Rules\DraftLine;
use App\Domain\Billing\Rules\DraftLines;
use App\Domain\Billing\Rules\DraftPolicy;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lignes d'un brouillon de facture : lecture du catalogue, validation (règles pures `DraftLines`), écriture. Service
 * commun à la création, à la modification du brouillon et à l'émission (qui recalcule et fige les lignes avec le
 * même code) ; aucune de ces écritures ne touche le stock (la réserve n'est prise qu'à l'émission : I00).
 *
 * Les lignes d'un brouillon sont les seules lignes réécrites en place : les triggers du catalogue interdisent
 * d'ajouter, modifier ou supprimer une ligne dès que la facture est émise.
 */
final class InvoiceDrafts
{
    public function __construct(private readonly ActorRights $rights, private readonly ExamFeeScope $examFee) {}

    /**
     * Droits d'écriture de l'auteur : autorité de prix (`catalog.manage`), plafond de remise de son profil, et profil
     * restreint « frais d'examen » (`exam_fee.collect` sans `invoice.create`).
     */
    public function policyFor(CommandContext $context): DraftPolicy
    {
        $authority = $this->rights->priceAuthority($context);
        $cap = config('eeo.billing.discount_cap_percent');

        $examItemId = null;
        if ($this->examFee->restricted($context, 'invoice.create')) {
            // Article non configuré : « » ne désigne aucun article, donc aucune ligne n'est admise.
            $examItemId = ExamFeeScope::itemId($context->clinicId) ?? '';
        }

        return new DraftPolicy(true, $authority, DiscountPolicy::capFor($authority, is_scalar($cap) ? (string) $cap : null), $examItemId);
    }

    /**
     * Valide les lignes et renvoie leur forme calculée, ou lève le refus 422 qui les désigne toutes :
     * `VALIDATION_FAILED` pour la saisie invalide, `APPROVAL_REQUIRED_OR_EXPIRED` pour ce qui exige la gérante.
     *
     * `$approveRights` (B06) : appelé seulement quand des lignes dépassent les droits de l'auteur (prix, ligne libre,
     * remise) ; il consomme l'approbation exacte de la gérante pour CE contenu et rend vrai, ou rend faux (refus 422).
     * Sans lui, tout dépassement est refusé.
     *
     * @param  list<array<string, mixed>>  $payloadLines
     * @param  (callable(): bool)|null  $approveRights
     * @return list<DraftLine>
     */
    public function validated(string $clinicId, string $invoiceId, string $patientId, array $payloadLines, DraftPolicy $policy, bool $checkReferences = true, ?callable $approveRights = null): array
    {
        $itemIds = [];
        foreach ($payloadLines as $line) {
            if (is_string($line['catalog_item_id'] ?? null)) {
                $itemIds[] = $line['catalog_item_id'];
            }
        }
        /** @var array<string, \stdClass> $items */
        $items = $itemIds === [] ? [] : DB::table('catalog_items')
            ->where('clinic_id', $clinicId)
            ->whereIn('id', array_values(array_unique($itemIds)))
            ->get()
            ->keyBy('id')
            ->all();

        $ruleIds = [];
        foreach ($items as $item) {
            if ($item->tax_rule_id !== null) {
                $ruleIds[] = (string) $item->tax_rule_id;
            }
        }
        $taxRules = TaxRegime::applicable($clinicId, $ruleIds);
        $defaultExempt = TaxRegime::defaultExemptForLines($clinicId, $payloadLines);

        $validation = new FieldErrors;
        $rights = new FieldErrors;
        $lines = DraftLines::build($payloadLines, $items, $taxRules, $policy, $validation, $rights, $defaultExempt);

        if ($checkReferences) {
            $this->checkReferences($clinicId, $invoiceId, $patientId, $payloadLines, $validation);
        }

        $validation->throwIfAny();
        if (! $rights->isEmpty() && ($approveRights === null || ! $approveRights())) {
            throw BillingErrors::approvalRequired(
                $rights->all(),
                'Ces lignes dépassent vos droits (prix, ligne libre ou remise) : demandez l\'approbation exacte de la gérante pour ce contenu, puis enregistrez-le de nouveau sans le modifier.',
            );
        }

        return $lines;
    }

    /**
     * Écrit les lignes validées. `$replace` : modification d'un brouillon, la liste remplace la précédente.
     *
     * @param  list<DraftLine>  $lines
     */
    public function write(string $clinicId, string $invoiceId, string $patientId, array $lines, CarbonImmutable $at, bool $replace): void
    {
        $now = $at->utc()->format('Y-m-d H:i:s.u');

        if ($replace) {
            DB::table('invoice_lines')->where('clinic_id', $clinicId)->where('invoice_id', $invoiceId)->delete();
        }

        foreach ($lines as $line) {
            DB::table('invoice_lines')->insert([
                'id' => $line->id,
                'clinic_id' => $clinicId,
                'patient_id' => $patientId,
                'invoice_id' => $invoiceId,
                'position' => $line->position,
                'catalog_item_id' => $line->catalogItemId,
                'reference_snapshot' => $line->referenceSnapshot,
                'description_snapshot' => $line->description,
                'category_snapshot' => $line->categorySnapshot,
                'unit_snapshot' => $line->unitSnapshot,
                'quantity' => $line->quantity->canonical(),
                'unit_price_gross' => $line->unitPriceGross,
                'discount_gross' => $line->discountGross,
                'line_total_gross' => $line->amounts->net,
                'tax_code_snapshot' => $line->taxCodeSnapshot,
                'tax_rate_snapshot' => $line->taxRate?->canonical(),
                'tax_amount' => $line->amounts->taxAmount,
                'prescription_id' => $line->prescriptionId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    /**
     * Identifiants de ligne libres (clé primaire globale : un identifiant pris ailleurs est un refus 422, jamais une
     * erreur SQL) et prescriptions du même patient.
     *
     * @param  list<array<string, mixed>>  $payloadLines
     */
    private function checkReferences(string $clinicId, string $invoiceId, string $patientId, array $payloadLines, FieldErrors $validation): void
    {
        $lineIds = [];
        $prescriptions = [];
        foreach ($payloadLines as $index => $line) {
            if (is_string($line['line_id'] ?? null)) {
                $lineIds[$line['line_id']] = $index;
            }
            if (is_string($line['prescription_id'] ?? null)) {
                $prescriptions[$line['prescription_id']][] = $index;
            }
        }

        if ($lineIds !== []) {
            $taken = DB::table('invoice_lines')
                ->whereIn('id', array_keys($lineIds))
                ->where('invoice_id', '<>', $invoiceId)
                ->pluck('id');
            foreach ($taken as $id) {
                $validation->add('lines.'.$lineIds[(string) $id].'.line_id', 'Cet identifiant de ligne est déjà utilisé.');
            }
        }

        if ($prescriptions !== []) {
            $found = DB::table('optical_prescriptions')
                ->where('clinic_id', $clinicId)
                ->whereIn('id', array_keys($prescriptions))
                ->pluck('patient_id', 'id');
            foreach ($prescriptions as $id => $indexes) {
                foreach ($indexes as $index) {
                    if (! isset($found[$id])) {
                        $validation->add('lines.'.$index.'.prescription_id', 'Prescription introuvable dans ce cabinet.');
                    } elseif ((string) $found[$id] !== $patientId) {
                        $validation->add('lines.'.$index.'.prescription_id', 'Cette prescription concerne un autre patient.');
                    }
                }
            }
        }
    }

    /**
     * Refus d'état d'une facture qui n'est plus un brouillon.
     */
    public static function assertDraft(\stdClass $invoice): void
    {
        if ($invoice->status !== 'DRAFT') {
            throw BusinessError::stateRefused(
                $invoice->status === 'ISSUED' ? 'Cette facture est émise : elle ne se modifie plus (avoir ou contre-écriture liés).' : 'Cette facture est abandonnée.',
                (string) $invoice->status,
            );
        }
    }
}

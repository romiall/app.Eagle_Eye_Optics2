<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Catalog\TaxRegime;
use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\Rules\DraftLine;
use App\Domain\Billing\Rules\DraftLines;
use App\Domain\Billing\Rules\DraftPolicy;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Billing\Snapshots\InvoiceSnapshots;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Instant;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Devis versionnés (L1D07 ; fichier 03 : « Le devis est facultatif en L1 et ne remplace aucun de ces objets » ; fichier
 * 06 : « Un devis ne constitue ni créance émise, ni paiement, ni réservation définitive implicite. La conversion copie
 * les données validées et conserve le lien d'origine »).
 *
 * Cycle : BROUILLON (lignes éditables, sans numéro) → ÉMIS (numéro de la série QUOTE, révision 1 figée dans
 * `quote_revisions`) → corrections éventuelles (révision 2, 3… avec motif ; chaque révision garde son snapshot et son
 * document, réimprimable à l'identique) → ACCEPTÉ ou REFUSÉ → CONVERTI (brouillon de facture créé depuis UNE révision
 * choisie, `invoices.quote_id`). Un devis n'écrit RIEN d'autre : ni facture émise, ni paiement, ni réserve de stock,
 * ni chiffre d'affaires (la caisse du jour et les rapports ne lisent que les factures émises et les encaissements).
 *
 * Les lignes passent par les MÊMES règles que celles d'un brouillon de facture (`DraftLines` : catalogue actif,
 * quantité exacte, prix imposé sans autorité de prix, remise plafonnée par le droit de l'auteur). Un dépassement de
 * droit est refusé (422 `APPROVAL_REQUIRED_OR_EXPIRED`) : sur un devis, seule la gérante fixe un prix ou une remise
 * hors du droit de l'auteur. À l'émission et à la conversion, les lignes sont recalculées telles qu'une personne
 * habilitée les a écrites (`DraftPolicy::trusted()`, même principe que l'émission d'une facture).
 *
 * L'expiration n'est pas une écriture : un devis émis ou accepté dont la date de validité est passée (jour civil du
 * cabinet) est EXPIRÉ à la lecture et ne se convertit plus ; une révision lui donne une nouvelle validité.
 */
final class Quotes
{
    /** Motif enregistré pour la révision 1 (colonne obligatoire) : l'émission elle-même. */
    public const ISSUE_REASON = 'Émission du devis';

    /** Un devis émis ou accepté porte une validité ; passée, il est expiré à la lecture. */
    private const DATED = ['ISSUED', 'ACCEPTED'];

    public function __construct(private readonly InvoiceDrafts $drafts) {}

    /** Droits d'écriture des lignes : ceux d'un brouillon de facture (autorité de prix, plafond de remise). */
    public function policyFor(CommandContext $context): DraftPolicy
    {
        return $this->drafts->policyFor($context);
    }

    /**
     * Valide les lignes d'un devis et renvoie leur forme calculée, ou lève le refus 422 qui les désigne toutes.
     *
     * @param  list<array<string, mixed>>  $payloadLines
     * @return list<DraftLine>
     */
    public function validatedLines(string $clinicId, string $quoteId, array $payloadLines, DraftPolicy $policy): array
    {
        $itemIds = [];
        $lineIds = [];
        foreach ($payloadLines as $index => $line) {
            if (is_string($line['catalog_item_id'] ?? null)) {
                $itemIds[] = $line['catalog_item_id'];
            }
            if (is_string($line['line_id'] ?? null)) {
                $lineIds[$line['line_id']] = $index;
            }
        }
        /** @var array<string, stdClass> $items */
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

        $validation = new FieldErrors;
        $rights = new FieldErrors;
        // Une ligne de devis ne désigne aucune prescription : rien n'est lu du dossier clinique.
        $lines = DraftLines::build(
            $payloadLines,
            $items,
            TaxRegime::applicable($clinicId, $ruleIds),
            $policy,
            $validation,
            $rights,
            TaxRegime::defaultExemptForLines($clinicId, $payloadLines),
        );

        // Identifiants de ligne libres : clé primaire globale, un identifiant pris par un autre devis est un refus 422.
        if ($lineIds !== []) {
            $taken = DB::table('quote_lines')
                ->whereIn('id', array_keys($lineIds))
                ->where('quote_id', '<>', $quoteId)
                ->pluck('id');
            foreach ($taken as $id) {
                $validation->add('lines.'.$lineIds[(string) $id].'.line_id', 'Cet identifiant de ligne est déjà utilisé.');
            }
        }

        $validation->throwIfAny();
        if (! $rights->isEmpty()) {
            throw BillingErrors::approvalRequired(
                $rights->all(),
                'Ces lignes dépassent vos droits (prix, ligne libre ou remise) : sur un devis, seule la gérante fixe un prix ou une remise hors de votre droit.',
            );
        }

        return $lines;
    }

    /**
     * Lignes ACTUELLES du devis (brouillon, ou dernière révision) : la liste remplace la précédente. Les révisions
     * antérieures restent dans leur snapshot, jamais réécrites.
     *
     * @param  list<DraftLine>  $lines
     */
    public function writeLines(string $clinicId, string $quoteId, array $lines, CarbonImmutable $at): void
    {
        $now = $at->utc()->format('Y-m-d H:i:s.u');
        DB::table('quote_lines')->where('clinic_id', $clinicId)->where('quote_id', $quoteId)->delete();

        foreach ($lines as $line) {
            DB::table('quote_lines')->insert([
                'id' => $line->id,
                'clinic_id' => $clinicId,
                'quote_id' => $quoteId,
                'position' => $line->position,
                'catalog_item_id' => $line->catalogItemId,
                'description_snapshot' => $line->description,
                'unit_code' => $line->unitSnapshot,
                'quantity' => $line->quantity->canonical(),
                'unit_price_gross' => $line->unitPriceGross,
                'discount_gross' => $line->discountGross,
                'line_total_gross' => $line->amounts->net,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    /**
     * Lignes enregistrées du devis, remises sous la forme de la charge pour être recalculées (émission).
     *
     * @return list<array<string, mixed>>
     */
    public static function storedLines(string $clinicId, string $quoteId): array
    {
        $rows = DB::table('quote_lines')->where('clinic_id', $clinicId)->where('quote_id', $quoteId)->orderBy('position')->get();

        return array_values(array_map(static fn (stdClass $row): array => [
            'line_id' => (string) $row->id,
            'position' => (int) $row->position,
            'catalog_item_id' => $row->catalog_item_id === null ? null : (string) $row->catalog_item_id,
            'description' => (string) $row->description_snapshot,
            'quantity' => (string) $row->quantity,
            'unit_price_gross' => (int) $row->unit_price_gross,
            'discount_gross' => (int) $row->discount_gross,
        ], $rows->all()));
    }

    /**
     * @param  list<DraftLine>  $lines
     */
    public static function total(array $lines): int
    {
        try {
            return DraftLines::total($lines);
        } catch (RuleViolation $violation) {
            throw BusinessError::validation(['lines' => [$violation->getMessage()]]);
        }
    }

    /** Jour civil du cabinet à l'instant donné (jamais un minuit UTC). */
    public static function today(stdClass $clinic, CarbonImmutable $at): CivilDate
    {
        return Instant::fromEpochMilliseconds((int) $at->format('Uv'))->civilDate((string) $clinic->timezone);
    }

    /**
     * Date de validité saisie : une date civile qui ne précède pas le jour du cabinet ; obligatoire à l'émission et à
     * la révision (le devis remis dit jusqu'à quand il vaut), facultative sur un brouillon.
     */
    public static function validUntil(mixed $value, CivilDate $today, bool $required, FieldErrors $errors): ?string
    {
        if ($value === null) {
            if ($required) {
                $errors->add('valid_until', 'Indiquez jusqu\'à quelle date le devis est valable.');
            }

            return null;
        }
        if (! is_string($value)) {
            $errors->add('valid_until', 'Date de validité invalide : AAAA-MM-JJ attendu.');

            return null;
        }
        try {
            $date = CivilDate::fromString($value, 'valid_until');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);

            return null;
        }
        if ($date->compare($today) < 0) {
            $errors->add('valid_until', 'La date de validité ne peut pas précéder la date du jour.');

            return null;
        }

        return $date->toString();
    }

    /** Devis émis ou accepté dont la date de validité est passée : expiré à la lecture, sans écriture. */
    public static function isExpired(stdClass $quote, CivilDate $today): bool
    {
        if (! in_array((string) $quote->status, self::DATED, true) || $quote->valid_until === null) {
            return false;
        }

        return CivilDate::fromString((string) $quote->valid_until)->compare($today) < 0;
    }

    /** Statut à l'instant : celui de la ligne, ou EXPIRED pour un devis émis ou accepté hors validité. */
    public static function effectiveStatus(stdClass $quote, CivilDate $today): string
    {
        return self::isExpired($quote, $today) ? 'EXPIRED' : (string) $quote->status;
    }

    /** Brouillon de facture ou facture né de ce devis et non abandonné : la conversion a déjà eu lieu. */
    public static function activeInvoice(string $clinicId, string $quoteId): ?stdClass
    {
        $row = DB::table('invoices')
            ->where('clinic_id', $clinicId)
            ->where('quote_id', $quoteId)
            ->where('status', '<>', 'ABANDONED')
            ->orderBy('created_at')
            ->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Refus d'état d'un devis qui n'est pas dans l'un des statuts admis.
     *
     * @param  list<string>  $allowed
     */
    public static function assertStatus(stdClass $quote, array $allowed, string $message): void
    {
        if (! in_array((string) $quote->status, $allowed, true)) {
            throw BusinessError::stateRefused($message, (string) $quote->status);
        }
    }

    /**
     * Destinataire figé du devis : identité administrative minimale du patient (dossier, nom, prénoms), ou nom et
     * téléphone du prospect. Jamais une donnée clinique.
     *
     * @return array{kind: string, patient_id: ?string, prospect_contact_id: ?string, record_number: ?string, last_name: string, first_names: ?string, phone: ?string}
     */
    public static function recipient(?stdClass $patient, ?stdClass $prospect): array
    {
        if ($patient !== null) {
            return [
                'kind' => 'PATIENT',
                'patient_id' => (string) $patient->id,
                'prospect_contact_id' => null,
                'record_number' => (string) $patient->record_number,
                'last_name' => (string) $patient->last_name,
                'first_names' => $patient->first_names === null ? null : (string) $patient->first_names,
                'phone' => null,
            ];
        }
        if ($prospect === null) {
            throw new \LogicException('Un devis vise exactement un patient ou un prospect.');
        }

        return [
            'kind' => 'PROSPECT',
            'patient_id' => null,
            'prospect_contact_id' => (string) $prospect->id,
            'record_number' => null,
            'last_name' => (string) $prospect->name,
            'first_names' => null,
            'phone' => $prospect->phone === null ? null : (string) $prospect->phone,
        ];
    }

    /**
     * Contenu figé d'une révision (`quote_revisions.snapshot`, forme de `contracts/snapshots/quote-revision.json`) :
     * source de son document, jamais recalculée sur l'identité, les prix ou le cabinet actuels (fichier 11).
     *
     * @param  array<string, mixed>  $recipient
     * @param  list<DraftLine>  $lines
     * @param  array<string, stdClass>  $usedRules  règles fiscales validées appliquées aux lignes
     * @return array<string, mixed>
     */
    public static function snapshot(
        string $quoteId,
        string $number,
        int $revisionNo,
        CarbonImmutable $recordedAt,
        CarbonImmutable $issuedAt,
        ?string $validUntil,
        array $recipient,
        array $lines,
        int $total,
        stdClass $clinic,
        array $usedRules,
        string $authorId,
        string $authorName,
        string $reason,
    ): array {
        return [
            'quote_id' => $quoteId,
            'number' => $number,
            'revision_no' => $revisionNo,
            'recorded_at' => self::instant($recordedAt),
            'issued_at' => self::instant($issuedAt),
            'valid_until' => $validUntil,
            'recipient' => $recipient,
            'lines' => array_map(static fn (DraftLine $line): array => [
                'line_id' => $line->id,
                'position' => $line->position,
                'catalog_item_id' => $line->catalogItemId,
                'reference' => $line->referenceSnapshot,
                'description' => $line->description,
                'unit_code' => $line->unitSnapshot,
                'quantity' => $line->quantity->canonical(),
                'unit_price_gross' => $line->unitPriceGross,
                'discount_gross' => $line->discountGross,
                'line_total_gross' => $line->amounts->net,
                'tax_code' => $line->taxCodeSnapshot,
                'tax_rate_percent' => $line->taxRate?->canonical(),
                'tax_amount' => $line->amounts->taxAmount,
            ], $lines),
            'total_gross' => $total,
            'currency' => (string) $clinic->currency,
            'tax' => InvoiceSnapshots::tax($usedRules),
            'clinic' => InvoiceSnapshots::clinic($clinic),
            'authored_by' => ['user_id' => $authorId, 'display_name' => $authorName],
            'reason' => $reason,
            'template_version' => PendingDocuments::QUOTE_TEMPLATE,
        ];
    }

    /**
     * Règles fiscales validées réellement appliquées aux lignes (pour la ventilation imprimée de la taxe comprise).
     *
     * @param  list<DraftLine>  $lines
     * @return array<string, stdClass>
     */
    public static function usedRules(string $clinicId, array $lines): array
    {
        $ids = array_values(array_filter(array_map(static fn (DraftLine $line): ?string => $line->taxRuleId, $lines)));

        return TaxRegime::applicable($clinicId, $ids);
    }

    /** Nom ACTUEL du compte auteur (figé ensuite dans la révision) ; jamais inventé. */
    public static function actorName(string $clinicId, ?string $actorId): string
    {
        if ($actorId === null) {
            throw new \LogicException('Une révision de devis a toujours un auteur identifié.');
        }
        $name = DB::table('users')->where('clinic_id', $clinicId)->where('id', $actorId)->value('display_name');

        return is_string($name) && $name !== '' ? $name : 'Compte '.substr($actorId, -6);
    }

    /**
     * @param  array<string, mixed>  $value
     */
    public static function json(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function instant(CarbonImmutable $at): string
    {
        return $at->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}

<?php

namespace App\Domain\Access\Approvals;

use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Quantity;

/**
 * Contenu EXACT d'une opération soumise à approbation (B06 : « Lier action/cible/hash/motif/durée », « Payload changé
 * ou décision expirée refusé »). Une même fonction construit le contenu à la DEMANDE (charge `subject` de
 * `RequestApproval`) et à la CONSOMMATION (charge de la commande approuvée) : l'empreinte
 * `payload_hash = SHA-256(JSON canonique)` est donc identique si, et seulement si, l'opération exécutée est celle qui a
 * été approuvée. Un montant, une ligne, un mode ou une cible différents donnent une autre empreinte, donc un refus.
 *
 * Le contenu ne porte que des identifiants et des montants (aucune donnée clinique, aucun texte libre de motif) :
 *  - dispense d'examen : visite et patient (`ExamFeeWaiver::payloadHash` en est la forme historique, identique) ;
 *  - droits d'un brouillon : facture, patient et TOUTES les lignes du brouillon (position, article, désignation,
 *    quantité, prix, remise, prescription), sans les identifiants de ligne (stables d'un envoi à l'autre seulement
 *    tant que l'écran reste ouvert) ;
 *  - contre-écriture : facture, paiement, montant ;
 *  - avoir : facture, montant total et lignes (ligne d'origine, quantité, montant), triées ;
 *  - remboursement : facture, avoir, montant, mode ;
 *  - remise à crédit : facture, reste dû au moment de la remise et lignes remises (ligne d'origine, quantité), triées ;
 *    un encaissement entre la demande et la remise change le reste dû, donc l'empreinte (nouvelle demande) ;
 *  - casse ou ajustement : position, article, lot, nature et quantité signée.
 *
 * Fonctions pures : aucune lecture en base. Les quantités sont ramenées à leur forme canonique (« 1 » = « 1.000 »).
 */
final readonly class ApprovalSubject
{
    /**
     * @param  array<string, mixed>  $content  contenu normalisé, sans la nature
     */
    private function __construct(public ApprovalKind $kind, public string $targetId, public array $content) {}

    public function actionCode(): string
    {
        return $this->kind->actionCode();
    }

    public function targetType(): string
    {
        return $this->kind->targetType();
    }

    /** Empreinte du contenu exact (`approvals.payload_hash`). */
    public function hash(): string
    {
        return CanonicalJson::hash(['action' => $this->kind->value] + $this->content);
    }

    /**
     * Forme publique : nature et contenu (réponse de l'API, audit de la demande).
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return ['kind' => $this->kind->value] + $this->content;
    }

    public static function examFeeWaiver(string $visitId, string $patientId): self
    {
        return new self(ApprovalKind::ExamFeeWaiver, $visitId, ['visit_id' => $visitId, 'patient_id' => $patientId]);
    }

    /**
     * @param  list<mixed>  $lines  lignes du brouillon telles que la commande les porte (ou relues de l'audit d'une
     *                              demande : un élément qui n'est pas une ligne est ignoré, l'empreinte ne correspondra pas)
     */
    public static function draftLineRights(string $invoiceId, string $patientId, array $lines): self
    {
        $normalized = [];
        foreach ($lines as $line) {
            if (! is_array($line)) {
                continue;
            }
            $normalized[] = [
                'position' => is_int($line['position'] ?? null) ? $line['position'] : 0,
                'catalog_item_id' => is_string($line['catalog_item_id'] ?? null) ? $line['catalog_item_id'] : null,
                'description' => is_string($line['description'] ?? null) ? $line['description'] : '',
                'quantity' => self::quantity($line['quantity'] ?? null),
                'unit_price_gross' => is_int($line['unit_price_gross'] ?? null) ? $line['unit_price_gross'] : 0,
                'discount_gross' => is_int($line['discount_gross'] ?? null) ? $line['discount_gross'] : 0,
                'prescription_id' => is_string($line['prescription_id'] ?? null) ? $line['prescription_id'] : null,
            ];
        }
        usort($normalized, static fn (array $left, array $right): int => [$left['position'], (string) $left['catalog_item_id'], $left['description']]
            <=> [$right['position'], (string) $right['catalog_item_id'], $right['description']]);

        return new self(ApprovalKind::DraftLineRights, $invoiceId, ['invoice_id' => $invoiceId, 'patient_id' => $patientId, 'lines' => $normalized]);
    }

    public static function paymentReversal(string $invoiceId, string $paymentId, int $amount): self
    {
        return new self(ApprovalKind::PaymentReversal, $paymentId, ['invoice_id' => $invoiceId, 'payment_id' => $paymentId, 'amount' => $amount]);
    }

    /**
     * @param  list<mixed>  $lines  lignes de l'avoir (ligne d'origine, quantité ou null, montant) ; même tolérance que
     *                              `draftLineRights` pour un contenu relu de l'audit
     */
    public static function creditNote(string $invoiceId, int $amountGross, array $lines): self
    {
        $normalized = [];
        foreach ($lines as $line) {
            if (! is_array($line)) {
                continue;
            }
            $normalized[] = [
                'invoice_line_id' => is_string($line['invoice_line_id'] ?? null) ? $line['invoice_line_id'] : '',
                'quantity' => ($line['quantity'] ?? null) === null ? null : self::quantity($line['quantity']),
                'amount_gross' => is_int($line['amount_gross'] ?? null) ? $line['amount_gross'] : 0,
            ];
        }
        usort($normalized, static fn (array $left, array $right): int => [$left['invoice_line_id'], $left['amount_gross'], (string) $left['quantity']]
            <=> [$right['invoice_line_id'], $right['amount_gross'], (string) $right['quantity']]);

        return new self(ApprovalKind::CreditNote, $invoiceId, ['invoice_id' => $invoiceId, 'amount_gross' => $amountGross, 'lines' => $normalized]);
    }

    public static function refund(string $invoiceId, string $creditNoteId, int $amount, string $method): self
    {
        return new self(ApprovalKind::Refund, $invoiceId, ['invoice_id' => $invoiceId, 'credit_note_id' => $creditNoteId, 'amount' => $amount, 'method' => $method]);
    }

    /**
     * @param  list<mixed>  $lines  lignes remises (ligne d'origine, quantité) ; même tolérance que `draftLineRights`
     *                              pour un contenu relu de l'audit. Deux lignes d'une même ligne d'origine sont additionnées.
     */
    public static function creditDelivery(string $invoiceId, int $amountDue, array $lines): self
    {
        $byLine = [];
        foreach ($lines as $line) {
            if (! is_array($line)) {
                continue;
            }
            $lineId = is_string($line['invoice_line_id'] ?? null) ? $line['invoice_line_id'] : '';
            $parsed = null;
            try {
                $parsed = Quantity::parse(is_string($line['quantity'] ?? null) ? $line['quantity'] : null);
            } catch (RuleViolation) {
                $parsed = null;
            }
            if ($parsed === null || (array_key_exists($lineId, $byLine) && $byLine[$lineId] === null)) {
                // Contenu non reproductible : la ligne reste vide, l'empreinte ne correspondra à aucune remise.
                $byLine[$lineId] = null;

                continue;
            }
            $byLine[$lineId] = isset($byLine[$lineId]) ? $byLine[$lineId]->plus($parsed) : $parsed;
        }
        ksort($byLine, SORT_STRING);
        $normalized = [];
        foreach ($byLine as $lineId => $quantity) {
            $normalized[] = ['invoice_line_id' => (string) $lineId, 'quantity' => $quantity?->canonical() ?? ''];
        }

        return new self(ApprovalKind::CreditDelivery, $invoiceId, ['invoice_id' => $invoiceId, 'amount_due' => $amountDue, 'lines' => $normalized]);
    }

    public static function stockMovement(string $positionId, string $itemId, ?string $lotId, string $kind, string $signedQuantity): self
    {
        return new self(ApprovalKind::StockMovement, $positionId, [
            'position_id' => $positionId,
            'item_id' => $itemId,
            'lot_id' => $lotId,
            'movement_kind' => $kind,
            'signed_quantity' => self::signedQuantity($signedQuantity),
        ]);
    }

    /**
     * Mouvement d'espèces hors vente : session, nature, montant SIGNÉ (entrée positive, sortie négative) et catégorie
     * de dépense exacts. Le motif et la référence du justificatif ne sont pas dans l'empreinte (motif de la demande).
     */
    public static function cashMovement(string $sessionId, string $kind, int $signedAmount, ?string $categoryId): self
    {
        return new self(ApprovalKind::CashMovement, $sessionId, [
            'cash_session_id' => $sessionId,
            'movement_kind' => $kind,
            'signed_amount' => $signedAmount,
            'expense_category_id' => $categoryId,
        ]);
    }

    /**
     * Envoi d'une campagne de communication : campagne, segment, révision approuvée du modèle et volume exact de
     * destinataires admissibles au gel de l'audience (L2D08).
     */
    public static function campaignSend(string $campaignId, string $segmentId, string $templateVersionId, int $eligibleCount): self
    {
        return new self(ApprovalKind::CampaignSend, $campaignId, [
            'campaign_id' => $campaignId,
            'segment_id' => $segmentId,
            'template_version_id' => $templateVersionId,
            'eligible_count' => $eligibleCount,
        ]);
    }

    /**
     * Contenu d'une DEMANDE (`RequestApproval.subject`, déjà validé par le schéma du contrat). Une nature inconnue ou un
     * champ manquant est un refus de saisie, jamais une approbation « générale ».
     *
     * @param  array<string, mixed>  $subject
     *
     * @throws RuleViolation
     */
    public static function fromRequest(array $subject): self
    {
        $kind = ApprovalKind::tryFrom(is_string($subject['kind'] ?? null) ? $subject['kind'] : '');
        $string = static function (string $field) use ($subject): string {
            $value = $subject[$field] ?? null;
            if (! is_string($value) || $value === '') {
                throw RuleViolation::invalid('subject.'.$field, 'approval.subject_field_required', 'Champ obligatoire de l\'opération à approuver.');
            }

            return $value;
        };
        $integer = static function (string $field) use ($subject): int {
            $value = $subject[$field] ?? null;
            if (! is_int($value) || $value <= 0) {
                throw RuleViolation::invalid('subject.'.$field, 'approval.subject_amount_required', 'Montant strictement positif attendu.');
            }

            return $value;
        };
        $nullableString = static function (string $field) use ($subject): ?string {
            $value = $subject[$field] ?? null;
            if ($value !== null && (! is_string($value) || $value === '')) {
                throw RuleViolation::invalid('subject.'.$field, 'approval.subject_field_invalid', 'Identifiant attendu, ou null.');
            }

            return $value;
        };
        $signedInteger = static function (string $field) use ($subject): int {
            $value = $subject[$field] ?? null;
            if (! is_int($value) || $value === 0) {
                throw RuleViolation::invalid('subject.'.$field, 'approval.subject_amount_required', 'Montant signé non nul attendu.');
            }

            return $value;
        };
        $list = static function (string $field) use ($subject): array {
            $value = $subject[$field] ?? null;
            if (! is_array($value) || ! array_is_list($value)) {
                throw RuleViolation::invalid('subject.'.$field, 'approval.subject_lines_required', 'Liste de lignes attendue.');
            }

            return $value;
        };

        return match ($kind) {
            ApprovalKind::ExamFeeWaiver => self::examFeeWaiver($string('visit_id'), $string('patient_id')),
            ApprovalKind::DraftLineRights => self::draftLineRights($string('invoice_id'), $string('patient_id'), $list('lines')),
            ApprovalKind::PaymentReversal => self::paymentReversal($string('invoice_id'), $string('payment_id'), $integer('amount')),
            ApprovalKind::CreditNote => self::creditNote($string('invoice_id'), $integer('amount_gross'), $list('lines')),
            ApprovalKind::Refund => self::refund($string('invoice_id'), $string('credit_note_id'), $integer('amount'), $string('method')),
            ApprovalKind::CreditDelivery => self::creditDelivery($string('invoice_id'), $integer('amount_due'), $list('lines')),
            ApprovalKind::StockMovement => self::stockMovement($string('position_id'), $string('item_id'), $nullableString('lot_id'), $string('movement_kind'), $string('signed_quantity')),
            ApprovalKind::CashMovement => self::cashMovement($string('cash_session_id'), $string('movement_kind'), $signedInteger('signed_amount'), $nullableString('expense_category_id')),
            ApprovalKind::CampaignSend => self::campaignSend($string('campaign_id'), $string('segment_id'), $string('template_version_id'), $integer('eligible_count')),
            null => throw RuleViolation::invalid('subject.kind', 'approval.kind_unknown', 'Nature d\'opération à approuver inconnue.'),
        };
    }

    /**
     * Contenu public relu dans l'audit de la demande, vérifié contre l'empreinte enregistrée : null s'il ne la
     * reproduit pas (contenu non vérifiable, jamais affiché comme exact).
     *
     * @param  array<string, mixed>  $stored
     * @return array<string, mixed>|null
     */
    public static function verified(array $stored, string $payloadHash): ?array
    {
        try {
            $subject = self::fromRequest($stored);
        } catch (RuleViolation) {
            return null;
        }

        return hash_equals($payloadHash, $subject->hash()) ? $subject->toArray() : null;
    }

    /** Quantité signée d'un mouvement ramenée à sa forme canonique (« -1 » = « -1.000 »). */
    private static function signedQuantity(string $value): string
    {
        try {
            return FixedDecimal::parse($value, Quantity::SCALE, Quantity::INTEGER_DIGITS, true, 'signed_quantity')?->canonical() ?? $value;
        } catch (RuleViolation) {
            return $value;
        }
    }

    private static function quantity(mixed $value): string
    {
        if (! is_string($value)) {
            return '';
        }
        try {
            return Quantity::parse($value)?->canonical() ?? $value;
        } catch (RuleViolation) {
            return $value;
        }
    }
}

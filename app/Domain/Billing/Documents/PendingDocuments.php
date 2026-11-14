<?php

namespace App\Domain\Billing\Documents;

use App\Domain\Shared\CommandContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Documents PDF d'une pièce financière, déclarés EN ATTENTE dans la transaction de la pièce (contrat 23 :
 * « IssueInvoice/RegisterPayment produisent source immuable + generated_documents PENDING dans leur transaction »).
 *
 * Le serveur ne produit aucun PDF dans la transaction (aucun effet externe, aucun fichier) : la ligne
 * `generated_documents` PENDING dit seulement que la pièce attend son document, dont le moteur de documents (D01)
 * génère puis dépose le contenu après le commit. Un PDF PENDING n'autorise JAMAIS à répéter l'opération : la pièce
 * et son numéro existent déjà (fichier 08). La clé de source identifie la pièce, la révision vaut 1 (un document
 * de pièce n'est jamais recalculé : une réimpression rouvre l'original).
 *
 * Les versions de modèle ci-dessous sont PROVISOIRES : elles seront alignées sur les modèles de D01/D02
 * (`compatibility.json`, `document_templates`) sans changer de mécanisme.
 */
final class PendingDocuments
{
    public const INVOICE_TEMPLATE = 'invoice.v1';

    public const RECEIPT_TEMPLATE = 'receipt.v1';

    /** Avoir (B07) : convention `<type>.v<n>` (billing.md, « Convention des modèles de documents »). */
    public const CREDIT_NOTE_TEMPLATE = 'credit_note.v1';

    /** Reçu de remboursement (B08). */
    public const REFUND_TEMPLATE = 'refund.v1';

    /** Devis (L1D07) : un document par révision figée (révision 1 à l'émission, puis une par correction). */
    public const QUOTE_TEMPLATE = 'quote.v1';

    /** Bon laboratoire de l'atelier (L1D04) : anonymisé (sans nom patient, antécédents ni prix). */
    public const WORKSHOP_TEMPLATE = 'workshop.v1';

    public static function workshopSourceKey(string $workshopOrderId): string
    {
        return 'workshop:'.$workshopOrderId;
    }

    public static function quoteSourceKey(string $quoteId): string
    {
        return 'quote:'.$quoteId;
    }

    public static function invoiceSourceKey(string $invoiceId): string
    {
        return 'invoice:'.$invoiceId;
    }

    public static function receiptSourceKey(string $receiptId): string
    {
        return 'receipt:'.$receiptId;
    }

    public static function creditNoteSourceKey(string $creditNoteId): string
    {
        return 'credit_note:'.$creditNoteId;
    }

    public static function refundSourceKey(string $refundId): string
    {
        return 'refund:'.$refundId;
    }

    public static function isTaken(string $documentId): bool
    {
        return DB::table('generated_documents')->where('id', $documentId)->exists();
    }

    public static function forInvoice(CommandContext $context, string $documentId, string $invoiceId, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'INVOICE', ['invoice_id' => $invoiceId], self::invoiceSourceKey($invoiceId), self::INVOICE_TEMPLATE, $at);
    }

    public static function forReceipt(CommandContext $context, string $documentId, string $receiptId, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'RECEIPT', ['receipt_id' => $receiptId], self::receiptSourceKey($receiptId), self::RECEIPT_TEMPLATE, $at);
    }

    public static function forCreditNote(CommandContext $context, string $documentId, string $creditNoteId, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'CREDIT_NOTE', ['credit_note_id' => $creditNoteId], self::creditNoteSourceKey($creditNoteId), self::CREDIT_NOTE_TEMPLATE, $at);
    }

    public static function forRefund(CommandContext $context, string $documentId, string $refundId, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'REFUND', ['refund_id' => $refundId], self::refundSourceKey($refundId), self::REFUND_TEMPLATE, $at);
    }

    /**
     * Document d'UNE révision de devis : la révision antérieure garde le sien, réimprimable à l'identique.
     */
    public static function forQuoteRevision(CommandContext $context, string $documentId, string $quoteId, int $revisionNo, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'QUOTE', ['quote_id' => $quoteId], self::quoteSourceKey($quoteId), self::QUOTE_TEMPLATE, $at, $revisionNo);
    }

    public static function forWorkshop(CommandContext $context, string $documentId, string $workshopOrderId, CarbonImmutable $at): void
    {
        self::insert($context, $documentId, 'WORKSHOP', ['workshop_order_id' => $workshopOrderId], self::workshopSourceKey($workshopOrderId), self::WORKSHOP_TEMPLATE, $at, 1);
    }

    /**
     * @param  array<string, string>  $source  la colonne de la pièce (une seule : ck_generated_documents_01)
     */
    private static function insert(CommandContext $context, string $documentId, string $type, array $source, string $sourceKey, string $template, CarbonImmutable $at, int $revisionNo = 1): void
    {
        $now = $at->utc()->format('Y-m-d H:i:s.u');

        DB::table('generated_documents')->insert($source + [
            'id' => $documentId,
            'clinic_id' => $context->clinicId,
            'document_type' => $type,
            'source_key' => $sourceKey,
            'revision_no' => $revisionNo,
            'template_version' => $template,
            'file_id' => null,
            'sha256' => null,
            'status' => 'PENDING',
            'generated_at' => null,
            'failure_code' => null,
            'source_device_id' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
}

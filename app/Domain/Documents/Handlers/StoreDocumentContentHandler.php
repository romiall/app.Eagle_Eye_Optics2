<?php

namespace App\Domain\Documents\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Locking\TransactionLocks;
use App\Domain\Documents\DocumentPolicy;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;

/**
 * Dépôt de l'ORIGINAL PDF d'un document généré (D01, `StoreDocumentContent`), EN LIGNE : le poste a produit le PDF
 * depuis le snapshot figé ; le serveur le conserve et passe le document de PENDING (ou FAILED) à READY. Charge
 * construite par le contrôleur après contrôle des octets : identifiant du document, empreinte, taille et chemin privé
 * déjà écrit.
 *
 * - Policy par famille (`DocumentPolicy`) : pièce financière avec invoice.issue ou payment.collect, document clinique
 *   avec clinical.complete ; une autre famille est refusée (403) même avec l'un des droits de la commande.
 * - Un document READY n'est plus modifié : le même contenu (même empreinte) répond sans écrire (dépôt rejoué),
 *   un contenu différent est refusé (409 `STATE_TRANSITION_REFUSED`) : l'original ne se remplace jamais.
 * - Métadonnées sans secret (`stored_files`), audit sans contenu, changement publié dans le compartiment de la famille.
 */
final class StoreDocumentContentHandler implements CommandHandler
{
    public const COMMAND = 'StoreDocumentContent';

    public function permissions(): array
    {
        return ['invoice.issue', 'payment.collect', 'clinical.complete', 'workshop.manage'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $documentId = (string) ($payload['document_id'] ?? '');
        $sha256 = (string) ($payload['sha256'] ?? '');
        $size = (int) ($payload['size_bytes'] ?? 0);
        $path = (string) ($payload['private_path'] ?? '');

        $document = DB::table('generated_documents')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $documentId)
            ->lockForUpdate()
            ->first();
        if ($document === null) {
            throw BusinessError::notFound();
        }
        $type = (string) $document->document_type;
        if (! DocumentPolicy::mayStore($context->user, $type)) {
            throw BusinessError::forbidden('Ce compte ne peut pas déposer ce type de document.');
        }

        if ($document->status === 'READY') {
            if ((string) $document->sha256 === $sha256) {
                return $this->outcome($documentId, $type, $sha256, (string) $document->file_id, [], []);
            }
            throw BusinessError::stateRefused('L\'original de ce document est déjà conservé : il ne se remplace pas.', 'READY');
        }

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $fileId = (string) (DB::table('stored_files')->where('clinic_id', $context->clinicId)->where('private_path', $path)->value('id') ?? '');
        if ($fileId === '') {
            $fileId = Ulid::generate();
            DB::table('stored_files')->insert([
                'id' => $fileId,
                'clinic_id' => $context->clinicId,
                'private_path' => $path,
                'mime_type' => 'application/pdf',
                'size_bytes' => $size,
                'sha256' => $sha256,
                'classification' => DocumentPolicy::classification($type),
                'encryption_key_id' => null,
                'uploaded_by' => (string) $context->actorId,
                'archived_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        DB::table('generated_documents')
            ->where('clinic_id', $context->clinicId)
            ->where('id', $documentId)
            ->update([
                'file_id' => $fileId,
                'sha256' => $sha256,
                'status' => 'READY',
                'generated_at' => $now,
                'failure_code' => null,
                'updated_at' => $now,
            ]);

        return $this->outcome(
            $documentId,
            $type,
            $sha256,
            $fileId,
            [new AuditEntry('document.stored', 'generated_documents', $documentId, null, [
                'document_type' => $type,
                'sha256' => $sha256,
                'size_bytes' => $size,
                'template_version' => (string) $document->template_version,
            ])],
            [new ChangeRecord('generated_documents', $documentId, (int) $document->revision_no, DocumentPolicy::visibility($type), ChangeKind::Updated)],
        );
    }

    /**
     * @param  list<AuditEntry>  $audit
     * @param  list<ChangeRecord>  $changes
     */
    private function outcome(string $documentId, string $type, string $sha256, string $fileId, array $audit, array $changes): CommandOutcome
    {
        return new CommandOutcome(
            result: ['document_id' => $documentId, 'document_type' => $type, 'sha256' => $sha256, 'file_id' => $fileId],
            resultType: 'generated_documents',
            resultId: $documentId,
            audit: $audit,
            changes: $changes,
        );
    }
}

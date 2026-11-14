<?php

namespace App\Domain\Cash\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Guards\CentralOnly;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;

/**
 * Relevé numérisé d'un canal de paiement (L1D06) : le fichier (PDF, JPEG ou PNG), déjà contrôlé et écrit sur le
 * disque privé par le contrôleur, est rattaché au cabinet (`stored_files`, classement FINANCIAL). Idempotent sur
 * le chemin adressé par son empreinte SHA-256.
 */
final class StoreStatementEvidenceHandler implements CommandHandler
{
    public const COMMAND = 'StoreStatementEvidence';

    public function permissions(): array
    {
        return ['finance.reconcile'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        CentralOnly::assert($context, 'Le dépôt d\'un relevé de rapprochement');

        $payload = $command->payload;
        $sha256 = (string) $payload['sha256'];
        $size = (int) $payload['size_bytes'];
        $mime = (string) $payload['mime_type'];
        $path = (string) $payload['private_path'];

        $existing = DB::table('stored_files')
            ->where('clinic_id', $context->clinicId)
            ->where('private_path', $path)
            ->first();
        if ($existing !== null) {
            return $this->outcome((string) $existing->id, $sha256, $mime, (int) $existing->size_bytes, []);
        }

        $id = Ulid::generate();
        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        DB::table('stored_files')->insert([
            'id' => $id,
            'clinic_id' => $context->clinicId,
            'private_path' => $path,
            'mime_type' => $mime,
            'size_bytes' => $size,
            'sha256' => $sha256,
            'classification' => 'FINANCIAL',
            'encryption_key_id' => null,
            'uploaded_by' => (string) $context->actorId,
            'archived_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->outcome($id, $sha256, $mime, $size, [
            new AuditEntry('payment_reconciliation.statement_stored', 'stored_files', $id, null, [
                'sha256' => $sha256,
                'mime_type' => $mime,
                'size_bytes' => $size,
            ]),
        ]);
    }

    /**
     * @param  list<AuditEntry>  $audit
     */
    private function outcome(string $fileId, string $sha256, string $mime, int $size, array $audit): CommandOutcome
    {
        return new CommandOutcome(
            result: ['file_id' => $fileId, 'sha256' => $sha256, 'mime_type' => $mime, 'size_bytes' => $size],
            resultType: 'stored_files',
            resultId: $fileId,
            audit: $audit,
        );
    }
}

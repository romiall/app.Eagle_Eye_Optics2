<?php

namespace App\Domain\Clinical\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Clinical\OpticalPrescriptions;
use App\Domain\Clinical\RevisionSnapshot;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Suppression d'une prescription optique encore BROUILLON (chantier « CRUD des écrans », tranche 3a ; route
 * `POST /prescriptions/{id}/delete`, EN LIGNE seulement comme sa modification). Une prescription VALIDÉE est immuable
 * (déclencheurs de la base) et se corrige par une nouvelle version : 409 `STATE_TRANSITION_REFUSED`. Un brouillon qui
 * est la version suivante d'une validée se supprime sans toucher à la validée, qui redevient la dernière version.
 *
 * - Même droit que la modification d'un brouillon (`clinical.write` ; la route exige aussi `clinical.read`) : un
 *   brouillon ne porte aucun auteur, celui qui peut le modifier peut le supprimer.
 * - Jeton de concurrence : `expected_updated_at`, comme `UpdatePrescriptionDraft` (la table n'a pas de colonne `version`) ;
 *   un écart est un 409 `VERSION_CONFLICT` avec `details.current_updated_at`.
 * - Refusé (409) quand une ligne de facture, une commande d'atelier ou un document désigne la prescription : un brouillon
 *   « jamais utilisé » est le seul qui disparaît.
 * - Les yeux et les traitements du brouillon disparaissent avec lui (les déclencheurs de la base ne protègent que les
 *   prescriptions validées) ; le fichier d'une ordonnance externe, s'il existe, reste dans `stored_files`.
 * - Audit `prescription.deleted` : série, version, origine, consultation, jamais une valeur clinique. Journal des
 *   changements : pierre tombale `ARCHIVED` (« jamais de suppression, une entité retirée est archivée »).
 *
 * Verrous : cabinet, idempotence, dossier patient (45), consultation (47) quand la prescription est interne.
 */
final class DeletePrescriptionDraftHandler implements CommandHandler
{
    public const COMMAND = 'DeletePrescriptionDraft';

    /** Pièces qui peuvent désigner une prescription : si l'une la désigne, le brouillon reste. */
    private const PRESCRIPTION_USERS = ['invoice_lines', 'workshop_orders', 'generated_documents'];

    public function __construct(private readonly OpticalPrescriptions $prescriptions) {}

    public function permissions(): array
    {
        return ['clinical.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->source !== CommandSource::Direct) {
            throw BusinessError::forbidden('La suppression d\'un brouillon de prescription depuis un poste hors-ligne n\'est pas ouverte.');
        }

        $clinicId = $context->clinicId;
        $prescriptionId = (string) $command->payload['prescription_id'];
        $expected = (string) ($command->payload['expected_updated_at'] ?? '');

        $first = $this->prescriptions->find($clinicId, $prescriptionId);
        if ($first === null) {
            throw BusinessError::notFound('Prescription introuvable dans ce cabinet (déjà supprimée ?).');
        }
        // Ordre des verrous : dossier patient (45) avant consultation (47).
        $locks->patient((string) $first->patient_id);
        if ($first->consultation_id !== null) {
            $locks->consultation((string) $first->consultation_id);
        }

        $row = $this->prescriptions->find($clinicId, $prescriptionId);
        if ($row === null) {
            throw BusinessError::notFound('Prescription introuvable dans ce cabinet (déjà supprimée ?).');
        }
        if ($row->status !== 'DRAFT') {
            throw BusinessError::stateRefused('Cette prescription est validée : elle est immuable et ne se supprime pas. Pour la corriger, créez-en une nouvelle version.', (string) $row->status);
        }
        $token = RevisionSnapshot::instant(CarbonImmutable::parse((string) $row->updated_at, 'UTC'));
        if ($expected !== $token) {
            throw new BusinessError('VERSION_CONFLICT', 'Cette prescription a été modifiée entre-temps : actualisez avant de la supprimer.', 409, [], null, [], ['current_updated_at' => $token]);
        }
        foreach (self::PRESCRIPTION_USERS as $table) {
            if (DB::table($table)->where('clinic_id', $clinicId)->where('prescription_id', $prescriptionId)->exists()) {
                throw BusinessError::stateRefused('Cette prescription est déjà utilisée (facture, atelier ou document) : elle ne se supprime pas.', (string) $row->status);
            }
        }

        // Les enfants avant le parent (aucune cascade en base).
        $this->prescriptions->deleteChildren($clinicId, $prescriptionId, true, true);
        DB::table('optical_prescriptions')->where('clinic_id', $clinicId)->where('id', $prescriptionId)->delete();

        $consultationId = $row->consultation_id === null ? null : (string) $row->consultation_id;

        return new CommandOutcome(
            result: [
                'prescription_id' => $prescriptionId,
                'patient_id' => (string) $row->patient_id,
                'consultation_id' => $consultationId,
                'version_no' => (int) $row->version_no,
            ],
            resultType: 'optical_prescriptions',
            resultId: $prescriptionId,
            audit: [new AuditEntry('prescription.deleted', 'optical_prescriptions', $prescriptionId, null, [
                'series_id' => (string) $row->series_id,
                'version_no' => (int) $row->version_no,
                'origin' => (string) $row->origin,
                'consultation_id' => $consultationId,
                'supersedes_id' => $row->supersedes_id === null ? null : (string) $row->supersedes_id,
            ])],
            changes: [new ChangeRecord('optical_prescriptions', $prescriptionId, (int) $row->version_no, ChangeVisibility::Clinical, ChangeKind::Archived)],
        );
    }
}

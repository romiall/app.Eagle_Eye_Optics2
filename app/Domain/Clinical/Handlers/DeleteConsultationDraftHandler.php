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
use App\Domain\Access\EffectivePermissions;
use App\Domain\Billing\BilledExamFeeControl;
use App\Domain\Clinical\Rules\ClinicalSteps;
use App\Domain\Patients\Rules\VisitStatus;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Suppression d'un examen resté BROUILLON (demande du cabinet : « on supprime une consultation quand elle est encore
 * en brouillon, uniquement en brouillon pour l'instant »). Un brouillon est une consultation démarrée dont aucune
 * rubrique n'est enregistrée (`status = DRAFT`, révision 0) : il ne porte aucune valeur clinique, seulement ses
 * références (visite, patient, professionnel, date). Dès qu'une rubrique est enregistrée l'examen est « en cours », puis
 * « terminé » avec une révision immuable : ni l'un ni l'autre ne se supprime (409 `STATE_TRANSITION_REFUSED`) ; un examen
 * terminé se corrige par une révision motivée (`AmendConsultation`), jamais par un écrasement ni une suppression.
 *
 * Qui : le professionnel qui a démarré l'examen (`consultations.clinician_id`) ou la gérante (`approval.decide`, la même
 * notion que « modifier le brouillon d'un autre compte » en facturation), sous réserve de `clinical.write`. Un autre
 * professionnel : 403.
 *
 * Ce que la suppression défait, dans la MÊME transaction :
 *  - la visite revient à son état d'avant l'examen, pour que la file du jour reste cohérente et que l'examen puisse
 *    être démarré de nouveau (une seule consultation par visite) : `ARRIVED` quand le paiement de l'examen n'est pas
 *    contrôlé (valeur par défaut), sinon `READY_FOR_EXAM` si une facture de frais est réglée, `AWAITING_EXAM_FEE`
 *    sinon (une dispense de la gérante, consommée par l'examen supprimé, est retirée de la visite : il en faut une
 *    nouvelle). Les factures de la visite (brouillon ou émise) ne sont pas touchées : aucune clé ne les relie à la
 *    consultation ;
 *  - les prescriptions BROUILLON de l'examen, avec leurs yeux et traitements. Une prescription VALIDÉE (immuable), une
 *    prescription déjà utilisée par une ligne de facture, une commande d'atelier ou un document, une rubrique clinique
 *    déjà enregistrée, une révision ou un contrôle recommandé programmé refusent la suppression (409) : rien n'est
 *    supprimé en cascade au-delà de ce qui est du brouillon.
 *
 * Rien d'autre ne disparaît : l'audit `consultation.deleted` (qui, quand, quelle consultation, quelle visite : jamais un
 * contenu clinique) est append-only. Le journal des changements publie la suppression comme `ARCHIVED` (pierre
 * tombale : « jamais de suppression, une entité retirée est archivée ») ; les postes ne reçoivent pas le contenu clinique
 * des consultations (publiées sans `data`), aucune projection locale n'est à défaire.
 *
 * En ligne seulement (comme le démarrage d'un examen, qui n'existe pas hors ligne). Version attendue = version de la
 * consultation (409 `VERSION_CONFLICT`). Verrous : cabinet, idempotence, visite (46), consultation (47). Un nouvel
 * appel après la suppression répond 404 ; le rejeu de la même clé rend la réponse d'origine.
 */
final class DeleteConsultationDraftHandler implements CommandHandler
{
    public const COMMAND = 'DeleteConsultationDraft';

    /** Permission qui désigne la gérante dans le référentiel (fichier 09) : elle peut supprimer le brouillon d'un autre compte. */
    public const MANAGER_PERMISSION = 'approval.decide';

    /** Tables des rubriques enregistrées : un brouillon n'en a aucune ; s'il en a une, la suppression est refusée. */
    private const CLINICAL_TABLES = [
        'consultation_complaints',
        'consultation_histories',
        'consultation_ametropias',
        'consultation_referral_reasons',
        'visual_acuities',
        'refraction_measurements',
        'autorefractor_centering',
        'medication_orders',
        'clinical_revisions',
    ];

    /** Pièces qui peuvent désigner une prescription : si l'une la désigne, la prescription (et l'examen) restent. */
    private const PRESCRIPTION_USERS = ['invoice_lines', 'workshop_orders', 'generated_documents'];

    public function __construct(
        private readonly EffectivePermissions $permissions,
        private readonly BilledExamFeeControl $examFee,
    ) {}

    public function permissions(): array
    {
        return ['clinical.write'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        if ($context->source !== CommandSource::Direct) {
            throw BusinessError::forbidden('La suppression d\'un examen depuis un poste hors-ligne n\'est pas encore ouverte.');
        }

        $consultationId = (string) $command->payload['consultation_id'];

        // Ordre des verrous : la visite (46) avant la consultation (47). Son identifiant ne change jamais.
        $visitId = DB::table('consultations')->where('clinic_id', $context->clinicId)->where('id', $consultationId)->value('visit_id');
        if ($visitId === null) {
            throw BusinessError::notFound('Consultation introuvable dans ce cabinet (déjà supprimée ?).');
        }
        $visit = $locks->visit((string) $visitId);
        $consultation = $locks->consultation($consultationId);
        if ($consultation === null || $visit === null) {
            throw BusinessError::notFound('Consultation introuvable dans ce cabinet (déjà supprimée ?).');
        }

        $status = (string) $consultation->status;
        if ($status !== ClinicalSteps::DRAFT) {
            throw BusinessError::stateRefused(
                $status === ClinicalSteps::COMPLETED
                    ? 'Cet examen est terminé : il ne se supprime pas. Pour le modifier, corrigez-le : une nouvelle révision motivée est enregistrée et les précédentes restent lisibles.'
                    : 'Cet examen est en cours : des rubriques y sont déjà enregistrées. Seul un brouillon (aucune rubrique enregistrée) se supprime.',
                $status,
            );
        }

        if ((string) $consultation->clinician_id !== (string) $context->actorId && ! $this->isManager($context)) {
            throw BusinessError::forbidden('Seul le professionnel qui a démarré cet examen, ou la gérante, peut supprimer ce brouillon.');
        }

        if ($command->expectedVersion === null || (int) $consultation->version !== $command->expectedVersion) {
            throw new BusinessError('VERSION_CONFLICT', 'Une version plus récente existe : actualisez avant de supprimer.', 409, [], null, [], ['current_version' => (int) $consultation->version]);
        }

        if ((string) $visit->status !== VisitStatus::IN_CONSULTATION) {
            throw BusinessError::stateRefused('La visite de cet examen n\'est plus en consultation : le brouillon ne peut pas être supprimé.', (string) $visit->status);
        }

        $prescriptionIds = $this->draftPrescriptionsToDelete($context->clinicId, $consultationId, $status);

        // Les enfants avant le parent (aucune cascade en base). Les yeux et traitements d'un brouillon se suppriment ;
        // ceux d'une prescription validée sont gardés par les déclencheurs de la base (refus plus haut).
        if ($prescriptionIds !== []) {
            DB::table('optical_prescription_eyes')->where('clinic_id', $context->clinicId)->whereIn('prescription_id', $prescriptionIds)->delete();
            DB::table('optical_prescription_treatments')->where('clinic_id', $context->clinicId)->whereIn('prescription_id', $prescriptionIds)->delete();
            DB::table('optical_prescriptions')->where('clinic_id', $context->clinicId)->whereIn('id', $prescriptionIds)->delete();
        }
        DB::table('consultations')->where('clinic_id', $context->clinicId)->where('id', $consultationId)->delete();

        $stamp = $context->now->utc()->format('Y-m-d H:i:s.u');
        [$restored, $proofs] = $this->visitBeforeExam($visit);
        $visitVersion = (int) $visit->version + 1;
        DB::table('visits')
            ->where('clinic_id', $context->clinicId)
            ->where('id', (string) $visitId)
            ->update($proofs + ['status' => $restored, 'version' => $visitVersion, 'updated_at' => $stamp]);

        return new CommandOutcome(
            result: [
                'consultation_id' => $consultationId,
                'visit_id' => (string) $visitId,
                'visit_status' => $restored,
                'visit_version' => $visitVersion,
            ],
            resultType: 'consultations',
            resultId: $consultationId,
            audit: [new AuditEntry('consultation.deleted', 'consultations', $consultationId, null, [
                'visit_id' => (string) $visitId,
                'patient_id' => (string) $consultation->patient_id,
                'clinician_id' => (string) $consultation->clinician_id,
                'previous_status' => $status,
                'version' => (int) $consultation->version,
                'deleted_prescription_drafts' => count($prescriptionIds),
                'visit_status' => $restored,
            ])],
            changes: [
                new ChangeRecord('visits', (string) $visitId, $visitVersion, ChangeVisibility::Administrative, ChangeKind::Updated),
                new ChangeRecord('consultations', $consultationId, (int) $consultation->version + 1, ChangeVisibility::Clinical, ChangeKind::Archived),
            ],
        );
    }

    private function isManager(CommandContext $context): bool
    {
        return $context->user !== null && $this->permissions->has($context->user, self::MANAGER_PERMISSION);
    }

    /**
     * Identifiants des prescriptions BROUILLON à supprimer avec l'examen ; refuse (409) tout ce qui ne se supprime pas :
     * rubrique ou révision enregistrée, contrôle recommandé, prescription validée ou déjà utilisée.
     *
     * @return list<string>
     */
    private function draftPrescriptionsToDelete(string $clinicId, string $consultationId, string $status): array
    {
        foreach (self::CLINICAL_TABLES as $table) {
            if (DB::table($table)->where('clinic_id', $clinicId)->where('consultation_id', $consultationId)->exists()) {
                throw BusinessError::stateRefused('Des données cliniques sont déjà enregistrées pour cet examen : il ne se supprime plus.', $status);
            }
        }
        if (DB::table('follow_up_plans')->where('clinic_id', $clinicId)->where('consultation_id', $consultationId)->exists()) {
            throw BusinessError::stateRefused('Un contrôle recommandé est programmé à partir de cet examen : il ne se supprime pas.', $status);
        }

        $prescriptions = DB::table('optical_prescriptions')
            ->where('clinic_id', $clinicId)
            ->where('consultation_id', $consultationId)
            ->get(['id', 'status']);
        $ids = [];
        foreach ($prescriptions as $prescription) {
            if ($prescription->status !== 'DRAFT') {
                throw BusinessError::stateRefused('Une prescription validée est liée à cet examen : elle est immuable, l\'examen ne se supprime pas.', $status);
            }
            $ids[] = (string) $prescription->id;
        }
        if ($ids === []) {
            return [];
        }
        foreach (self::PRESCRIPTION_USERS as $table) {
            if (DB::table($table)->where('clinic_id', $clinicId)->whereIn('prescription_id', $ids)->exists()) {
                throw BusinessError::stateRefused('Une prescription de cet examen est déjà utilisée (facture, atelier ou document) : l\'examen ne se supprime pas.', $status);
            }
        }

        return $ids;
    }

    /**
     * Statut de la visite avant l'examen et colonnes de preuve à réécrire avec lui. Paiement de l'examen non contrôlé :
     * `ARRIVED` (les deux autres statuts ne sont jamais écrits), preuves intactes. Contrôle actif et visite d'examen ou de
     * suivi : `READY_FOR_EXAM` si une facture de frais est réglée, `AWAITING_EXAM_FEE` sinon. La dispense consignée sur la
     * visite a été consommée par l'examen qui disparaît et une approbation ne sert qu'une fois : elle est retirée de la
     * visite (l'approbation reste `CONSUMED` dans son historique), l'examen suivant demandera les frais réglés ou une
     * nouvelle dispense, comme le contrôle l'exige au démarrage.
     *
     * @return array{0: string, 1: array<string, string|null>}
     */
    private function visitBeforeExam(stdClass $visit): array
    {
        if (! BilledExamFeeControl::isActive() || ! in_array((string) $visit->reason, VisitStatus::EXAM_REASONS, true)) {
            return [VisitStatus::ARRIVED, []];
        }

        $paid = $this->examFee->paidInvoices((string) $visit->clinic_id, (string) $visit->id, (string) $visit->patient_id);

        return [
            $paid !== [] ? VisitStatus::READY_FOR_EXAM : VisitStatus::AWAITING_EXAM_FEE,
            ['exam_invoice_id' => $paid[0] ?? null, 'exam_waiver_approval_id' => null],
        ];
    }
}

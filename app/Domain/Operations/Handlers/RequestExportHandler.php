<?php

namespace App\Domain\Operations\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Access\EffectivePermissions;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Domain\Operations\ExportPlan;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;

/**
 * Demande d'un export contrôlé (X02, `RequestExport`), EN LIGNE, réauthentification exigée par la route : l'export
 * est inscrit « demandé » ; l'archive est produite ensuite par la tâche planifiée (`eeo:exports:process`), jamais
 * dans la requête (hébergement simple : délai d'exécution court). Le dossier d'un patient exige clinical.export,
 * tout autre type export.global. Audit sans contenu (type, patient et filtres validés seulement).
 */
final class RequestExportHandler implements CommandHandler
{
    public const COMMAND = 'RequestExport';

    public function __construct(private readonly EffectivePermissions $effectivePermissions) {}

    public function permissions(): array
    {
        return ['export.global', 'clinical.export'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $type = $command->payload['export_type'] ?? null;
        if (! is_string($type) || ! in_array($type, ExportPlan::TYPES, true)) {
            throw BusinessError::validation(['export_type' => ['Type d\'export inconnu.']]);
        }
        if ($context->user === null || ! $context->user->can(ExportPlan::permissionFor($type))) {
            throw BusinessError::forbidden('Ce compte ne peut pas demander ce type d\'export.');
        }

        $patientId = $command->payload['patient_id'] ?? null;
        if ($type === 'PATIENT_RECORD') {
            if (! is_string($patientId) || ! DB::table('patient_records')->where('clinic_id', $context->clinicId)->where('id', $patientId)->exists()) {
                throw BusinessError::validation(['patient_id' => ['Choisissez le patient dont le dossier est exporté.']]);
            }
        } elseif ($patientId !== null) {
            throw BusinessError::validation(['patient_id' => ['Seul l\'export du dossier d\'un patient désigne un patient.']]);
        }

        $filtersInput = $command->payload['filters'] ?? null;
        $normalizedFilters = null;
        if ($filtersInput !== null) {
            if (! is_array($filtersInput) || array_is_list($filtersInput)) {
                throw BusinessError::validation(['filters' => ['Les filtres d\'export doivent être un objet structuré.']]);
            }
            $unknownKeys = array_diff(array_keys($filtersInput), ['from', 'to', 'scope_role']);
            if ($unknownKeys !== []) {
                throw BusinessError::validation(['filters' => ['Filtre d\'export inconnu : '.implode(', ', $unknownKeys).'.']]);
            }

            $fromRaw = $filtersInput['from'] ?? null;
            $toRaw = $filtersInput['to'] ?? null;
            $scopeRole = $filtersInput['scope_role'] ?? null;

            $clean = [];
            if ($fromRaw !== null || $toRaw !== null) {
                $timezone = (string) (DB::table('clinics')->where('id', $context->clinicId)->value('timezone') ?? 'Africa/Douala');
                $period = ReportPeriod::resolve($timezone !== '' ? $timezone : 'Africa/Douala', $context->now, $fromRaw, $toRaw);
                $clean['from'] = $period->from->toString();
                $clean['to'] = $period->to->toString();
            }

            if ($scopeRole !== null) {
                if (! is_string($scopeRole) || ! ExportPlan::isValidRole($scopeRole)) {
                    throw BusinessError::validation(['filters.scope_role' => ['Profil de portée inconnu.']]);
                }
                $actorPermissions = $this->effectivePermissions->for($context->user);
                $rolePermissions = ExportPlan::rolePermissions($scopeRole);
                if (array_diff($rolePermissions, $actorPermissions) !== []) {
                    throw BusinessError::forbidden('Votre profil ne permet pas de demander un export dépassant vos propres permissions.');
                }
                $clean['scope_role'] = $scopeRole;
            }

            $normalizedFilters = $clean === [] ? null : $clean;
        }

        $id = Ulid::generate();
        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        DB::table('export_requests')->insert([
            'id' => $id,
            'clinic_id' => $context->clinicId,
            'requested_by' => (string) $context->actorId,
            'export_type' => $type,
            'patient_id' => $type === 'PATIENT_RECORD' ? $patientId : null,
            'filters' => $normalizedFilters === null ? null : json_encode($normalizedFilters, JSON_THROW_ON_ERROR),
            'status' => 'REQUESTED',
            'file_id' => null,
            'completed_at' => null,
            'expires_at' => null,
            'error_code' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return new CommandOutcome(
            result: ['export_id' => $id],
            resultType: 'export_requests',
            resultId: $id,
            audit: [new AuditEntry('export.requested', 'export_requests', $id, null, [
                'export_type' => $type,
                'patient_id' => $type === 'PATIENT_RECORD' ? $patientId : null,
                'filters' => $normalizedFilters,
            ])],
        );
    }
}

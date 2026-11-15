<?php

namespace App\Http\Resources;

use App\Domain\Scheduling\FollowUpCalculator;
use App\Domain\Scheduling\SchedulingInput;
use App\Domain\Shared\ValueObjects\CivilDate;
use stdClass;

/**
 * Représentation des ressources de l'agenda pour l'API (`schemas/resources/scheduling.json`) : configuration,
 * rendez-vous, contrôles recommandés et tâches de contact. Identité administrative minimale du patient seulement ;
 * le motif clinique d'un contrôle (motif, notes, motif d'une date manuelle) n'est rendu qu'avec `clinical.read`.
 */
final class SchedulingPresenter
{
    /**
     * @param  list<stdClass>  $hours
     * @return array<string, mixed>
     */
    public static function resource(stdClass $row, array $hours): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'professional_user_id' => $row->professional_user_id === null ? null : (string) $row->professional_user_id,
            'professional_name' => isset($row->professional_name) ? (string) $row->professional_name : null,
            'active' => (bool) $row->active,
            'slot_duration_minutes' => (int) $row->slot_duration_minutes,
            'version' => (int) $row->version,
            'opening_hours' => array_map(static fn (stdClass $hour): array => self::hour($hour), $hours),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function hour(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'weekday' => (int) $row->weekday,
            'opens_at' => substr((string) $row->opens_at, 0, 5),
            'closes_at' => substr((string) $row->closes_at, 0, 5),
            'valid_from' => $row->valid_from === null ? null : substr((string) $row->valid_from, 0, 10),
            'valid_to' => $row->valid_to === null ? null : substr((string) $row->valid_to, 0, 10),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function service(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'duration_minutes' => (int) $row->duration_minutes,
            'active' => (bool) $row->active,
            'public_booking' => (bool) $row->public_booking,
            'version' => (int) $row->version,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function exception(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'resource_id' => (string) $row->resource_id,
            'starts_at' => SchedulingInput::iso((string) $row->starts_at),
            'ends_at' => SchedulingInput::iso((string) $row->ends_at),
            'is_available' => (bool) $row->is_available,
            'reason' => (string) $row->reason,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function appointment(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'patient_id' => $row->patient_id === null ? null : (string) $row->patient_id,
            'patient' => self::patient($row),
            'prospect_contact_id' => $row->prospect_contact_id === null ? null : (string) $row->prospect_contact_id,
            'follow_up_id' => $row->follow_up_id === null ? null : (string) $row->follow_up_id,
            'resource_id' => (string) $row->resource_id,
            'resource_name' => (string) $row->resource_name,
            'service_id' => (string) $row->service_id,
            'service_name' => (string) $row->service_name,
            'starts_at' => SchedulingInput::iso((string) $row->starts_at),
            'ends_at' => SchedulingInput::iso((string) $row->ends_at),
            'status' => (string) $row->status,
            'source' => (string) $row->source,
            'administrative_reason' => $row->administrative_reason,
            'cancel_reason' => $row->cancel_reason,
            'visit_id' => isset($row->visit_id) ? (string) $row->visit_id : null,
            'version' => (int) $row->version,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function followUp(stdClass $row, bool $clinical): array
    {
        $recommended = substr((string) $row->recommended_date, 0, 10);
        $reminder = (bool) $row->reminder_enabled
            ? FollowUpCalculator::reminderDate(
                CivilDate::fromString($recommended, 'recommended_date'),
                $row->advance_value === null ? null : (int) $row->advance_value,
                $row->advance_unit === null ? null : (string) $row->advance_unit,
            )->toString()
            : null;

        return [
            'id' => (string) $row->id,
            'consultation_id' => (string) $row->consultation_id,
            'patient_id' => (string) $row->patient_id,
            'patient' => self::patient($row) ?? ['id' => (string) $row->patient_id, 'record_number' => '', 'last_name' => '', 'first_names' => null],
            // Cloisonnement clinique (fichier 09) : le motif, les notes et le motif d'une date manuelle sont cliniques.
            'reason' => $clinical ? (string) $row->reason : null,
            'anchor_kind' => (string) $row->anchor_kind,
            'anchor_date' => substr((string) $row->anchor_date, 0, 10),
            'interval_value' => $row->interval_value === null ? null : (int) $row->interval_value,
            'interval_unit' => $row->interval_unit === null ? null : (string) $row->interval_unit,
            'recommended_date' => $recommended,
            'date_origin' => (string) $row->date_origin,
            'manual_reason' => $clinical ? $row->manual_reason : null,
            'reminder_enabled' => (bool) $row->reminder_enabled,
            'preferred_channel' => (string) $row->preferred_channel,
            'advance_value' => $row->advance_value === null ? null : (int) $row->advance_value,
            'advance_unit' => $row->advance_unit === null ? null : (string) $row->advance_unit,
            'reminder_date' => $reminder,
            'notes' => $clinical ? $row->notes : null,
            'status' => (string) $row->status,
            'appointment_id' => isset($row->appointment_id) ? (string) $row->appointment_id : null,
            'version' => (int) $row->version,
        ];
    }

    /**
     * @param  list<stdClass>  $attempts
     * @return array<string, mixed>
     */
    public static function contactTask(stdClass $row, array $attempts): array
    {
        $source = match (true) {
            $row->follow_up_id !== null => 'FOLLOW_UP',
            $row->appointment_id !== null => 'APPOINTMENT',
            $row->invoice_id !== null => 'INVOICE',
            default => 'WORKSHOP_ORDER',
        };

        return [
            'id' => (string) $row->id,
            'patient_id' => $row->patient_id === null ? null : (string) $row->patient_id,
            'patient' => self::patient($row),
            'prospect_contact_id' => $row->prospect_contact_id === null ? null : (string) $row->prospect_contact_id,
            'follow_up_id' => $row->follow_up_id === null ? null : (string) $row->follow_up_id,
            'appointment_id' => $row->appointment_id === null ? null : (string) $row->appointment_id,
            'invoice_id' => $row->invoice_id === null ? null : (string) $row->invoice_id,
            'source_type' => $source,
            'source_date' => isset($row->source_date) ? substr((string) $row->source_date, 0, 10) : null,
            'source_starts_at' => isset($row->source_starts_at) ? SchedulingInput::iso((string) $row->source_starts_at) : null,
            'due_at' => SchedulingInput::iso((string) $row->due_at),
            'channel' => (string) $row->channel,
            'status' => (string) $row->status,
            'next_attempt_at' => $row->next_attempt_at === null ? null : SchedulingInput::iso((string) $row->next_attempt_at),
            'assigned_to' => $row->assigned_to === null ? null : (string) $row->assigned_to,
            'administrative_notes' => $row->administrative_notes,
            'attempts' => array_map(static fn (stdClass $attempt): array => [
                'id' => (string) $attempt->id,
                'occurred_at' => SchedulingInput::iso((string) $attempt->occurred_at),
                'result' => (string) $attempt->result,
                'actor_name' => isset($attempt->actor_name) ? (string) $attempt->actor_name : null,
                'administrative_note' => $attempt->administrative_note,
            ], $attempts),
            'version' => (int) $row->version,
        ];
    }

    /**
     * @return array{id: string, record_number: string, last_name: string, first_names: string|null}|null
     */
    private static function patient(stdClass $row): ?array
    {
        if ($row->patient_id === null || ! isset($row->patient_last_name)) {
            return null;
        }

        return [
            'id' => (string) $row->patient_id,
            'record_number' => (string) $row->patient_record_number,
            'last_name' => (string) $row->patient_last_name,
            'first_names' => $row->patient_first_names === null ? null : (string) $row->patient_first_names,
        ];
    }
}

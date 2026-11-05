<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use stdClass;

/**
 * Représentation d'une consultation dans la liste des examens (schemas/resources/clinical.json#/$defs/
 * ConsultationSummary) : identité administrative de base du patient, état, dates, révision et professionnel.
 * Jamais de valeur clinique : la consultation elle-même se lit par GET /consultations/{id} (lecture tracée).
 */
final class ConsultationSummaryPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function summary(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'visit_id' => (string) $row->visit_id,
            'patient_id' => (string) $row->patient_id,
            'status' => (string) $row->status,
            'effective_at' => self::instant((string) $row->effective_at),
            'completed_at' => $row->completed_at === null ? null : self::instant((string) $row->completed_at),
            'current_revision' => (int) $row->current_revision,
            'version' => (int) $row->version,
            'patient' => [
                'id' => (string) $row->patient_id,
                'record_number' => (string) $row->patient_record_number,
                'last_name' => (string) $row->patient_last_name,
                'first_names' => $row->patient_first_names === null ? null : (string) $row->patient_first_names,
                'sex' => (string) $row->patient_sex,
                'birth_date' => $row->patient_birth_date === null ? null : (string) $row->patient_birth_date,
            ],
            'clinician' => [
                'id' => (string) $row->clinician_id,
                'display_name' => (string) $row->clinician_display_name,
            ],
        ];
    }

    private static function instant(string $stored): string
    {
        return CarbonImmutable::parse($stored, 'UTC')->format('Y-m-d\TH:i:s.v\Z');
    }
}

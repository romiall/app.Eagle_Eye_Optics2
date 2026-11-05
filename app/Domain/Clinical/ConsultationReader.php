<?php

namespace App\Domain\Clinical;

use App\Domain\Clinical\Rules\ClinicalSteps;
use App\Domain\Clinical\Rules\HistoriesStep;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use stdClass;

/**
 * Lecture d'une consultation dans les tables VIVANTES, au format `AllSteps` du contrat
 * (`clinical-steps.json`) : c'est ce que rendent `GET /consultations/{id}` et les réponses d'écriture, et ce
 * que compare l'enregistrement d'une rubrique pour reconnaître un enregistrement sans effet.
 *
 * Toujours limitée au cabinet. Une rubrique sans ligne est rendue VIDE (null, listes vides), jamais remplie de
 * valeurs par défaut : « non mesuré » n'est pas zéro. Les listes ont un ordre stable (ordre d'affichage du
 * référentiel, puis identifiant ; médicaments dans l'ordre de leur position).
 *
 * `view()` lit la consultation, ses rubriques, ses révisions et le patient d'un seul tenant : plusieurs requêtes
 * en autocommit pourraient mêler l'état d'avant et d'après une écriture concurrente.
 */
final class ConsultationReader
{
    /** Relectures tentées avant de renoncer (une écriture concurrente n'a pas fini de se terminer). */
    private const SNAPSHOT_ATTEMPTS = 3;

    private const ACUITY_ORDER = [
        'context' => ['PRELIMINARY', 'POST_REFRACTION'],
        'distance' => ['FAR', 'NEAR', 'UNSPECIFIED'],
        'correction' => ['WITHOUT', 'WITH'],
        'eye' => ['OD', 'OG', 'OU'],
    ];

    private const STAGE_ORDER = ['AUTOREFRACTOR', 'OBJECTIVE', 'SUBJECTIVE'];

    private const EYE_ORDER = ['OD', 'OG'];

    public function find(string $clinicId, string $consultationId): ?stdClass
    {
        $row = DB::table('consultations')->where('clinic_id', $clinicId)->where('id', $consultationId)->first();

        return $row instanceof stdClass ? $row : null;
    }

    /**
     * Instantané COHÉRENT de la consultation : ligne, rubriques, révisions et patient décrivent la même version.
     *
     * Aucune transaction ne s'ouvre hors du chemin central : la cohérence est obtenue en recoupant la version. Toute
     * écriture clinique incrémente `consultations.version` dans sa propre transaction, après (ou avec) ses lignes
     * enfants ; si la version relue en fin de lecture n'est pas celle du début, une écriture a eu lieu entre les
     * requêtes et l'ensemble est relu. Au-delà de trois tentatives, le serveur est dit occupé (503, à renvoyer à
     * l'identique) plutôt que de rendre un état qui n'a jamais existé.
     */
    public function view(string $clinicId, string $consultationId): ?ConsultationView
    {
        for ($attempt = 0; $attempt < self::SNAPSHOT_ATTEMPTS; $attempt++) {
            $row = $this->find($clinicId, $consultationId);
            if ($row === null) {
                return null;
            }
            $steps = $this->steps($row);
            $revisions = $this->revisions($row);
            $patient = $this->patient($row);
            $version = DB::table('consultations')->where('clinic_id', $clinicId)->where('id', $consultationId)->value('version');

            if ((int) $version === (int) $row->version) {
                return new ConsultationView($row, $steps, $revisions, $patient);
            }
        }

        throw BusinessError::serverBusy();
    }

    /**
     * @return array<string, array<string, mixed>> les sept rubriques, dans l'ordre du dossier
     */
    public function steps(stdClass $consultation): array
    {
        $steps = [];
        foreach (ClinicalSteps::ALL as $step) {
            $steps[$step] = $this->step($consultation, $step);
        }

        return $steps;
    }

    /**
     * @return array<string, mixed>
     */
    public function step(stdClass $consultation, string $step): array
    {
        return match ($step) {
            ClinicalSteps::ANAMNESIS => $this->anamnesis($consultation),
            ClinicalSteps::HISTORIES => $this->histories($consultation),
            ClinicalSteps::VISUAL_ACUITY => $this->visualAcuity($consultation),
            ClinicalSteps::REFRACTION => $this->refraction($consultation),
            ClinicalSteps::CENTERING => $this->centering($consultation),
            ClinicalSteps::MEDICATIONS => $this->medications($consultation),
            ClinicalSteps::CONCLUSION => $this->conclusion($consultation),
            default => throw new InvalidArgumentException('Rubrique inconnue : '.$step),
        };
    }

    /**
     * Identité administrative de base du patient de la consultation (en-tête de l'écran) et sa profession, que le
     * cabinet note dans son carnet : jamais de donnée clinique ni de coordonnée. Le snapshot d'une révision n'en
     * retient que son identité (`RevisionSnapshot`) : la profession n'entre pas dans l'empreinte.
     *
     * @return array<string, mixed>
     */
    public function patient(stdClass $consultation): array
    {
        $patient = DB::table('patient_records')
            ->where('clinic_id', $consultation->clinic_id)
            ->where('id', $consultation->patient_id)
            ->first(['id', 'record_number', 'last_name', 'first_names', 'sex', 'birth_date', 'profession']);
        if (! $patient instanceof stdClass) {
            // Clé étrangère composite : une consultation a toujours son patient.
            throw BusinessError::notFound();
        }

        return [
            'id' => (string) $patient->id,
            'record_number' => (string) $patient->record_number,
            'last_name' => (string) $patient->last_name,
            'first_names' => $patient->first_names === null ? null : (string) $patient->first_names,
            'sex' => (string) $patient->sex,
            'birth_date' => $patient->birth_date === null ? null : (string) $patient->birth_date,
            'profession' => $patient->profession === null ? null : (string) $patient->profession,
        ];
    }

    /**
     * Révisions figées (métadonnées seulement, jamais le snapshot) : aucune avant la finalisation.
     *
     * @return list<array<string, mixed>>
     */
    public function revisions(stdClass $consultation): array
    {
        $revisions = DB::table('clinical_revisions')
            ->where('clinic_id', $consultation->clinic_id)
            ->where('consultation_id', $consultation->id)
            ->orderBy('revision_no')
            ->get(['id', 'revision_no', 'recorded_at', 'author_id', 'reason', 'previous_revision_id', 'sha256'])
            ->map(static fn (stdClass $row): array => self::revisionMeta($row))
            ->all();

        return array_values($revisions);
    }

    /**
     * Révision figée AVEC son snapshot, telle qu'enregistrée (immuable), ou null.
     *
     * @return array<string, mixed>|null
     */
    public function revision(string $clinicId, string $consultationId, int $revisionNo): ?array
    {
        $row = DB::table('clinical_revisions')
            ->where('clinic_id', $clinicId)
            ->where('consultation_id', $consultationId)
            ->where('revision_no', $revisionNo)
            ->first();
        if (! $row instanceof stdClass) {
            return null;
        }

        $snapshot = json_decode((string) $row->snapshot, true, 512, JSON_THROW_ON_ERROR);

        return [...self::revisionMeta($row), 'snapshot' => $snapshot];
    }

    /**
     * @return array<string, mixed>
     */
    private static function revisionMeta(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'revision_no' => (int) $row->revision_no,
            'recorded_at' => (string) $row->recorded_at,
            'author_id' => (string) $row->author_id,
            'reason' => (string) $row->reason,
            'previous_revision_id' => $row->previous_revision_id === null ? null : (string) $row->previous_revision_id,
            'sha256' => (string) $row->sha256,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function anamnesis(stdClass $c): array
    {
        return [
            'symptoms' => $c->symptoms,
            'wears_glasses' => self::flag($c->wears_glasses),
            'glasses_duration' => $c->glasses_duration,
            'previous_correction_available' => self::flag($c->previous_correction_available),
            'complaints' => $this->terms('consultation_complaints', $c),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function histories(stdClass $c): array
    {
        $histories = DB::table('consultation_histories')
            ->where('clinic_id', $c->clinic_id)
            ->where('consultation_id', $c->id)
            ->get()
            ->all();
        usort($histories, static fn (stdClass $a, stdClass $b): int => array_search($a->history_group, HistoriesStep::GROUPS, true) <=> array_search($b->history_group, HistoriesStep::GROUPS, true));

        $termsByHistory = [];
        if ($histories !== []) {
            $terms = DB::table('consultation_history_terms as t')
                ->join('clinical_terms as ref', static function ($join): void {
                    $join->on('ref.group_code', '=', 't.term_group')->on('ref.code', '=', 't.term_code');
                })
                ->where('t.clinic_id', $c->clinic_id)
                ->whereIn('t.history_id', array_map(static fn (stdClass $history): string => (string) $history->id, $histories))
                ->orderBy('ref.sort_order')
                ->orderBy('t.id')
                ->get(['t.history_id', 't.id', 't.term_code', 't.other_text']);
            foreach ($terms as $term) {
                $termsByHistory[(string) $term->history_id][] = ['id' => (string) $term->id, 'term_code' => (string) $term->term_code, 'other_text' => $term->other_text];
            }
        }

        return [
            'histories' => array_map(static fn (stdClass $history): array => [
                'id' => (string) $history->id,
                'history_group' => (string) $history->history_group,
                'known_none' => (bool) $history->known_none,
                'comments' => $history->comments,
                'terms' => $termsByHistory[(string) $history->id] ?? [],
            ], $histories),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function visualAcuity(stdClass $c): array
    {
        $rows = DB::table('visual_acuities')->where('clinic_id', $c->clinic_id)->where('consultation_id', $c->id)->get()->all();
        usort($rows, static function (stdClass $a, stdClass $b): int {
            foreach (self::ACUITY_ORDER as $column => $order) {
                $compare = array_search($a->{$column}, $order, true) <=> array_search($b->{$column}, $order, true);
                if ($compare !== 0) {
                    return $compare;
                }
            }

            return strcmp((string) $a->id, (string) $b->id);
        });

        return ['acuities' => array_map(self::acuityRow(...), $rows)];
    }

    /**
     * Ligne d'acuité au format du contrat. `normalized_value` reste tel que MySQL le rend (« 0.8000 ») ou null.
     *
     * @return array<string, mixed>
     */
    public static function acuityRow(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'context' => (string) $row->context,
            'distance' => (string) $row->distance,
            'correction' => (string) $row->correction,
            'eye' => (string) $row->eye,
            'scale_id' => (string) $row->scale_id,
            'raw_value' => (string) $row->raw_value,
            'normalized_value' => $row->normalized_value === null ? null : (string) $row->normalized_value,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function refraction(stdClass $c): array
    {
        $rows = DB::table('refraction_measurements')->where('clinic_id', $c->clinic_id)->where('consultation_id', $c->id)->get()->all();
        usort($rows, static fn (stdClass $a, stdClass $b): int => [array_search($a->stage, self::STAGE_ORDER, true), array_search($a->eye, self::EYE_ORDER, true)]
            <=> [array_search($b->stage, self::STAGE_ORDER, true), array_search($b->eye, self::EYE_ORDER, true)]);

        return [
            'measurements' => array_map(self::measurementRow(...), $rows),
            'refraction_observations' => $c->refraction_observations,
            'ametropias' => $this->terms('consultation_ametropias', $c),
        ];
    }

    /**
     * Mesure de réfraction au format du contrat (formes canoniques « 1.25 », « -0.50 », « 0.00 »).
     *
     * @return array<string, mixed>
     */
    public static function measurementRow(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'stage' => (string) $row->stage,
            'eye' => (string) $row->eye,
            'sphere' => self::diopter($row->sphere),
            'cylinder' => self::diopter($row->cylinder),
            'axis' => $row->axis === null ? null : (int) $row->axis,
            'addition' => self::diopter($row->addition),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function centering(stdClass $c): array
    {
        $row = DB::table('autorefractor_centering')->where('clinic_id', $c->clinic_id)->where('consultation_id', $c->id)->first();
        if (! $row instanceof stdClass) {
            return ['centering_id' => null, 'pd_total' => null, 'pd_od' => null, 'pd_og' => null, 'inconsistency_reason' => null];
        }

        return [
            'centering_id' => (string) $row->id,
            'pd_total' => self::diopter($row->pd_total),
            'pd_od' => self::diopter($row->pd_od),
            'pd_og' => self::diopter($row->pd_og),
            'inconsistency_reason' => $row->inconsistency_reason,
        ];
    }

    /**
     * Médicaments dans l'ordre de leur position (le rang dans la liste).
     *
     * @return array<string, mixed>
     */
    private function medications(stdClass $c): array
    {
        $rows = DB::table('medication_orders')
            ->where('clinic_id', $c->clinic_id)
            ->where('consultation_id', $c->id)
            ->orderBy('position')
            ->get()
            ->all();

        return ['orders' => array_map(self::orderRow(...), $rows)];
    }

    /**
     * Ligne de médicament au format du contrat (la position n'en fait pas partie : c'est le rang dans la liste).
     *
     * @return array<string, mixed>
     */
    public static function orderRow(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'catalog_item_id' => $row->catalog_item_id === null ? null : (string) $row->catalog_item_id,
            'name' => (string) $row->name,
            'form' => (string) $row->form,
            'form_other' => $row->form_other === null ? null : (string) $row->form_other,
            'strength' => $row->strength === null ? null : (string) $row->strength,
            'dosage' => $row->dosage,
            'frequency' => $row->frequency === null ? null : (string) $row->frequency,
            'duration_text' => $row->duration_text === null ? null : (string) $row->duration_text,
            'duration_value' => $row->duration_value === null ? null : (int) $row->duration_value,
            'duration_unit' => $row->duration_unit === null ? null : (string) $row->duration_unit,
            'instructions' => $row->instructions,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function conclusion(stdClass $c): array
    {
        return [
            'conclusion' => $c->conclusion,
            'referral' => self::flag($c->referral),
            'referral_urgency' => $c->referral_urgency,
            'referral_reasons' => $this->terms('consultation_referral_reasons', $c),
        ];
    }

    /**
     * Lignes `{id, term_code, other_text}` d'une table de termes de la consultation, dans l'ordre d'affichage du
     * référentiel. Le nom de table est toujours une constante de ce fichier.
     *
     * @return list<array{id: string, term_code: string, other_text: mixed}>
     */
    private function terms(string $table, stdClass $c): array
    {
        $terms = DB::table($table.' as t')
            ->join('clinical_terms as ref', static function ($join): void {
                $join->on('ref.group_code', '=', 't.term_group')->on('ref.code', '=', 't.term_code');
            })
            ->where('t.clinic_id', $c->clinic_id)
            ->where('t.consultation_id', $c->id)
            ->orderBy('ref.sort_order')
            ->orderBy('t.id')
            ->get(['t.id', 't.term_code', 't.other_text'])
            ->map(static fn (stdClass $row): array => ['id' => (string) $row->id, 'term_code' => (string) $row->term_code, 'other_text' => $row->other_text])
            ->all();

        return array_values($terms);
    }

    private static function flag(mixed $value): ?bool
    {
        return $value === null ? null : (bool) $value;
    }

    /**
     * Mesure optique rendue par MySQL (« 1.25 », « -0.50 », « 0.00 ») en forme canonique ; null reste null.
     */
    private static function diopter(mixed $value): ?string
    {
        return $value === null ? null : FixedDecimal::fromString((string) $value, 2)->canonical();
    }
}

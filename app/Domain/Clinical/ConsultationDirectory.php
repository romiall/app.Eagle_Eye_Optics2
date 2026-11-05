<?php

namespace App\Domain\Clinical;

use App\Domain\Shared\BusinessError;
use App\Domain\Shared\DayWindow;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\ValueObjects\CivilDate;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Liste des examens du cabinet (écran « Consultations ») : les consultations, de la plus récente à la plus
 * ancienne, avec l'identité administrative de base du patient, l'état du travail et le nom du professionnel.
 * AUCUNE valeur clinique (ni motif, ni mesure, ni conclusion, ni orientation) : identifiants, dates, état et
 * numéro de révision seulement. Réservée à `clinical.read` (route) et toujours limitée au cabinet.
 *
 * Filtres facultatifs : un jour civil du cabinet (`date`, fuseau du cabinet, jamais minuit UTC), un état
 * (`status`) et « mes examens » (`mine`, professionnel connecté).
 */
final class ConsultationDirectory
{
    public const PER_PAGE = 50;

    /** @var list<string> */
    public const STATUSES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED'];

    /**
     * @return LengthAwarePaginator<int, stdClass>
     */
    public function __invoke(string $clinicId, string $timezone, string $actorId, mixed $date, mixed $status, mixed $mine, mixed $page = null): LengthAwarePaginator
    {
        $errors = [];

        $pageNumber = 1;
        if ($page !== null) {
            if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                $errors['page'] = ['La page est un entier supérieur ou égal à 1.'];
            } else {
                $pageNumber = (int) $page;
            }
        }

        $day = null;
        if ($date !== null && $date !== '') {
            try {
                $day = CivilDate::fromString(is_string($date) ? $date : '', 'date');
            } catch (RuleViolation $violation) {
                $errors['date'] = [$violation->getMessage()];
            }
        }

        $state = null;
        if ($status !== null && $status !== '') {
            if (! is_string($status) || ! in_array($status, self::STATUSES, true)) {
                $errors['status'] = ['L’état est DRAFT, IN_PROGRESS ou COMPLETED.'];
            } else {
                $state = $status;
            }
        }

        $onlyMine = false;
        if ($mine !== null && $mine !== '') {
            if ($mine === 'true' || $mine === '1') {
                $onlyMine = true;
            } elseif ($mine !== 'false' && $mine !== '0') {
                $errors['mine'] = ['Le filtre « mes examens » vaut true ou false.'];
            }
        }

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $query = DB::table('consultations')
            ->join('patient_records', static function ($join): void {
                $join->on('patient_records.clinic_id', '=', 'consultations.clinic_id')->on('patient_records.id', '=', 'consultations.patient_id');
            })
            ->join('users', static function ($join): void {
                $join->on('users.clinic_id', '=', 'consultations.clinic_id')->on('users.id', '=', 'consultations.clinician_id');
            })
            ->where('consultations.clinic_id', $clinicId);

        if ($day !== null) {
            [$start, $end] = DayWindow::utc($day, $timezone);
            $query->where('consultations.effective_at', '>=', $start)->where('consultations.effective_at', '<', $end);
        }
        if ($state !== null) {
            $query->where('consultations.status', $state);
        }
        if ($onlyMine) {
            $query->where('consultations.clinician_id', $actorId);
        }

        return $query
            ->orderByDesc('consultations.effective_at')
            ->orderByDesc('consultations.id')
            ->select([
                'consultations.id',
                'consultations.visit_id',
                'consultations.patient_id',
                'consultations.clinician_id',
                'consultations.effective_at',
                'consultations.status',
                'consultations.current_revision',
                'consultations.version',
                'consultations.completed_at',
                'patient_records.record_number as patient_record_number',
                'patient_records.last_name as patient_last_name',
                'patient_records.first_names as patient_first_names',
                'patient_records.sex as patient_sex',
                'patient_records.birth_date as patient_birth_date',
                'users.display_name as clinician_display_name',
            ])
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);
    }
}

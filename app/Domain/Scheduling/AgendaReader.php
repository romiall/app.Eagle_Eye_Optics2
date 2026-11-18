<?php

namespace App\Domain\Scheduling;

use App\Domain\Communication\ContactTasks;
use App\Domain\Shared\DayWindow;
use App\Domain\Shared\ValueObjects\CivilDate;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Lectures de l'agenda (S01, S02), toujours limitées au cabinet : configuration (ressources, créneaux, prestations,
 * exceptions à venir), rendez-vous d'une période, contrôles recommandés, tâches de contact du jour. Lignes brutes
 * jointes à l'identité administrative minimale du patient ; la mise en forme et le cloisonnement clinique sont faits
 * par `SchedulingPresenter`.
 */
final class AgendaReader
{
    /** Période la plus longue d'une liste de rendez-vous (couvre un calendrier mensuel de 6 semaines). */
    public const MAX_APPOINTMENT_DAYS = 45;

    /** Période la plus longue d'une liste de patients à revoir. */
    public const MAX_FOLLOW_UP_DAYS = 366;

    /**
     * @return array{resources: list<stdClass>, hours: array<string, list<stdClass>>, services: list<stdClass>, exceptions: list<stdClass>}
     */
    public function configuration(string $clinicId, CarbonImmutable $now): array
    {
        $resources = array_values(DB::table('scheduling_resources as r')
            ->leftJoin('users as u', static function ($join): void {
                $join->on('u.clinic_id', '=', 'r.clinic_id')->on('u.id', '=', 'r.professional_user_id');
            })
            ->where('r.clinic_id', $clinicId)
            ->orderByDesc('r.active')
            ->orderBy('r.name')
            ->orderBy('r.id')
            ->get(['r.*', 'u.display_name as professional_name'])
            ->all());

        $hours = [];
        foreach (DB::table('resource_opening_hours')->where('clinic_id', $clinicId)->orderBy('weekday')->orderBy('opens_at')->orderBy('id')->get() as $hour) {
            $hours[(string) $hour->resource_id][] = $hour;
        }

        $services = array_values(DB::table('appointment_services')
            ->where('clinic_id', $clinicId)
            ->orderByDesc('active')
            ->orderBy('name')
            ->orderBy('id')
            ->get()
            ->all());

        $exceptions = array_values(DB::table('resource_exceptions')
            ->where('clinic_id', $clinicId)
            ->where('ends_at', '>', SchedulingInput::stamp($now))
            ->where('starts_at', '<', SchedulingInput::stamp($now->addDays(90)))
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get()
            ->all());

        return ['resources' => $resources, 'hours' => $hours, 'services' => $services, 'exceptions' => $exceptions];
    }

    public function resource(string $clinicId, string $resourceId): ?stdClass
    {
        return DB::table('scheduling_resources as r')
            ->leftJoin('users as u', static function ($join): void {
                $join->on('u.clinic_id', '=', 'r.clinic_id')->on('u.id', '=', 'r.professional_user_id');
            })
            ->where('r.clinic_id', $clinicId)
            ->where('r.id', $resourceId)
            ->first(['r.*', 'u.display_name as professional_name']);
    }

    /**
     * @return list<stdClass>
     */
    public function hours(string $clinicId, string $resourceId): array
    {
        return array_values(DB::table('resource_opening_hours')
            ->where('clinic_id', $clinicId)
            ->where('resource_id', $resourceId)
            ->orderBy('weekday')
            ->orderBy('opens_at')
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * Rendez-vous d'une période de jours civils du cabinet, du plus tôt au plus tard.
     *
     * @return list<stdClass>
     */
    public function appointments(string $clinicId, string $timezone, CivilDate $from, CivilDate $to, ?string $resourceId, ?string $patientId): array
    {
        $query = $this->appointmentQuery($clinicId)
            ->where('a.starts_at', '>=', DayWindow::utc($from, $timezone)[0])
            ->where('a.starts_at', '<', DayWindow::utc($to, $timezone)[1]);
        if ($resourceId !== null) {
            $query->where('a.resource_id', $resourceId);
        }
        if ($patientId !== null) {
            $query->where('a.patient_id', $patientId);
        }

        return array_values($query->orderBy('a.starts_at')->orderBy('a.id')->get()->all());
    }

    public function appointment(string $clinicId, string $appointmentId): ?stdClass
    {
        return $this->appointmentQuery($clinicId)->where('a.id', $appointmentId)->first();
    }

    /**
     * Contrôles recommandés dont la date recommandée tombe dans une période (patients à revoir), ou ceux d'une
     * consultation ; les contrôles annulés sont exclus d'une période.
     *
     * @return list<stdClass>
     */
    public function followUps(string $clinicId, ?CivilDate $from, ?CivilDate $to, ?string $consultationId): array
    {
        $query = DB::table('follow_up_plans as f')
            ->join('patient_records as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 'f.clinic_id')->on('p.id', '=', 'f.patient_id');
            })
            ->where('f.clinic_id', $clinicId)
            ->select('f.*', ...self::patientColumns())
            ->selectSub(static function (Builder $sub): void {
                $sub->from('appointments as ap')
                    ->select('ap.id')
                    ->whereColumn('ap.clinic_id', 'f.clinic_id')
                    ->whereColumn('ap.follow_up_id', 'f.id')
                    ->whereIn('ap.status', AvailabilityService::OCCUPYING)
                    ->orderByDesc('ap.starts_at')
                    ->limit(1);
            }, 'appointment_id');
        if ($consultationId !== null) {
            $query->where('f.consultation_id', $consultationId);
        } else {
            $query->where('f.status', '<>', 'CANCELLED')
                ->where('f.recommended_date', '>=', $from?->toString())
                ->where('f.recommended_date', '<=', $to?->toString());
        }

        return array_values($query->orderBy('f.recommended_date')->orderBy('f.id')->get()->all());
    }

    public function followUp(string $clinicId, string $planId): ?stdClass
    {
        return DB::table('follow_up_plans as f')
            ->join('patient_records as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 'f.clinic_id')->on('p.id', '=', 'f.patient_id');
            })
            ->where('f.clinic_id', $clinicId)
            ->where('f.id', $planId)
            ->select('f.*', ...self::patientColumns())
            ->selectSub(static function (Builder $sub): void {
                $sub->from('appointments as ap')
                    ->select('ap.id')
                    ->whereColumn('ap.clinic_id', 'f.clinic_id')
                    ->whereColumn('ap.follow_up_id', 'f.id')
                    ->whereIn('ap.status', AvailabilityService::OCCUPYING)
                    ->orderByDesc('ap.starts_at')
                    ->limit(1);
            }, 'appointment_id')
            ->first();
    }

    /**
     * Tâches de contact d'un jour civil : ouvertes et dues au plus tard ce jour-là (retards compris), dont la nouvelle
     * tentative éventuelle tombe au plus tard ce jour-là ; plus celles traitées ce jour-là, pour voir le travail fait.
     *
     * @return list<stdClass>
     */
    public function contactTasks(string $clinicId, string $timezone, CivilDate $day): array
    {
        [$start, $end] = DayWindow::utc($day, $timezone);
        $rows = DB::table('contact_tasks as t')
            ->leftJoin('patient_records as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 't.clinic_id')->on('p.id', '=', 't.patient_id');
            })
            ->leftJoin('follow_up_plans as f', static function ($join): void {
                $join->on('f.clinic_id', '=', 't.clinic_id')->on('f.id', '=', 't.follow_up_id');
            })
            ->leftJoin('appointments as a', static function ($join): void {
                $join->on('a.clinic_id', '=', 't.clinic_id')->on('a.id', '=', 't.appointment_id');
            })
            ->where('t.clinic_id', $clinicId)
            ->where(static function ($query) use ($start, $end): void {
                $query->where(static function ($open) use ($end): void {
                    $open->whereIn('t.status', ContactTasks::OPEN)
                        ->where('t.due_at', '<', $end)
                        ->where(static fn ($next) => $next->whereNull('t.next_attempt_at')->orWhere('t.next_attempt_at', '<', $end));
                })->orWhereExists(static function ($done) use ($start, $end): void {
                    $done->select(DB::raw(1))
                        ->from('contact_attempts as ca')
                        ->whereColumn('ca.clinic_id', 't.clinic_id')
                        ->whereColumn('ca.task_id', 't.id')
                        ->where('ca.occurred_at', '>=', $start)
                        ->where('ca.occurred_at', '<', $end);
                });
            })
            ->orderBy('t.due_at')
            ->orderBy('t.id')
            ->limit(500)
            ->get(['t.*', ...self::patientColumns(), 'f.recommended_date as source_date', 'a.starts_at as source_starts_at']);

        return array_values($rows->all());
    }

    public function contactTask(string $clinicId, string $taskId): ?stdClass
    {
        return DB::table('contact_tasks as t')
            ->leftJoin('patient_records as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 't.clinic_id')->on('p.id', '=', 't.patient_id');
            })
            ->leftJoin('follow_up_plans as f', static function ($join): void {
                $join->on('f.clinic_id', '=', 't.clinic_id')->on('f.id', '=', 't.follow_up_id');
            })
            ->leftJoin('appointments as a', static function ($join): void {
                $join->on('a.clinic_id', '=', 't.clinic_id')->on('a.id', '=', 't.appointment_id');
            })
            ->where('t.clinic_id', $clinicId)
            ->where('t.id', $taskId)
            ->first(['t.*', ...self::patientColumns(), 'f.recommended_date as source_date', 'a.starts_at as source_starts_at']);
    }

    /**
     * Tentatives de plusieurs tâches, de la plus ancienne à la plus récente.
     *
     * @param  list<string>  $taskIds
     * @return array<string, list<stdClass>>
     */
    public function attempts(string $clinicId, array $taskIds): array
    {
        if ($taskIds === []) {
            return [];
        }
        $byTask = [];
        $rows = DB::table('contact_attempts as ca')
            ->leftJoin('users as u', static function ($join): void {
                $join->on('u.clinic_id', '=', 'ca.clinic_id')->on('u.id', '=', 'ca.actor_id');
            })
            ->where('ca.clinic_id', $clinicId)
            ->whereIn('ca.task_id', $taskIds)
            ->orderBy('ca.occurred_at')
            ->orderBy('ca.id')
            ->get(['ca.*', 'u.display_name as actor_name']);
        foreach ($rows as $row) {
            $byTask[(string) $row->task_id][] = $row;
        }

        return $byTask;
    }

    private function appointmentQuery(string $clinicId): Builder
    {
        return DB::table('appointments as a')
            ->join('scheduling_resources as r', static function ($join): void {
                $join->on('r.clinic_id', '=', 'a.clinic_id')->on('r.id', '=', 'a.resource_id');
            })
            ->join('appointment_services as s', static function ($join): void {
                $join->on('s.clinic_id', '=', 'a.clinic_id')->on('s.id', '=', 'a.service_id');
            })
            ->leftJoin('patient_records as p', static function ($join): void {
                $join->on('p.clinic_id', '=', 'a.clinic_id')->on('p.id', '=', 'a.patient_id');
            })
            ->where('a.clinic_id', $clinicId)
            ->select('a.*', 'r.name as resource_name', 's.name as service_name', ...self::patientColumns())
            ->selectSub(static function (Builder $sub): void {
                $sub->from('visits as v')
                    ->select('v.id')
                    ->whereColumn('v.clinic_id', 'a.clinic_id')
                    ->whereColumn('v.appointment_id', 'a.id')
                    ->where('v.status', '<>', 'CANCELLED')
                    ->orderBy('v.occurred_at')
                    ->limit(1);
            }, 'visit_id');
    }

    /**
     * @return list<string>
     */
    private static function patientColumns(): array
    {
        return [
            'p.record_number as patient_record_number',
            'p.last_name as patient_last_name',
            'p.first_names as patient_first_names',
        ];
    }
}

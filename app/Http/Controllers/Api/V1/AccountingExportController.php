<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Reports\AccountingExport;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Http\Controllers\Controller;
use App\Models\Clinic;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Restitution comptable Q13 (L1D06) : lecture structurée et téléchargement CSV, réservée à la gérante
 * (`finance.global.read`, module `sales`).
 */
final class AccountingExportController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        [$clinicId, $period, $now] = $this->resolveContext($request);

        return response()->json(['data' => AccountingExport::build($clinicId, $period, $now)], 200);
    }

    public function download(Request $request): Response
    {
        [$clinicId, $period, $now] = $this->resolveContext($request);
        $report = AccountingExport::build($clinicId, $period, $now);
        $csv = AccountingExport::toCsv($report);
        $filename = sprintf('export-comptable-q13-%s-au-%s.csv', $period->from->toString(), $period->to->toString());

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * @return array{0: string, 1: ReportPeriod, 2: CarbonImmutable}
     */
    private function resolveContext(Request $request): array
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        $timezone = (string) Clinic::query()->whereKey($clinicId)->value('timezone');
        $now = CarbonImmutable::now('UTC');
        $period = ReportPeriod::resolve(
            $timezone !== '' ? $timezone : 'Africa/Douala',
            $now,
            $request->query('from'),
            $request->query('to'),
        );

        return [$clinicId, $period, $now];
    }

    private function actor(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return $user;
    }
}

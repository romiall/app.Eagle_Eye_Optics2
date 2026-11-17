<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Access\EffectivePermissions;
use App\Domain\Operations\ManagementExports;
use App\Http\Controllers\Controller;
use App\Models\Clinic;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tableaux et exports de gestion consolidés L1D09 (module reports).
 */
final class ManagementReportController extends Controller
{
    public function __construct(
        private readonly ManagementExports $reports,
        private readonly EffectivePermissions $permissions,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $report = $this->buildReport($request);

        return new JsonResponse(['data' => $report]);
    }

    public function download(Request $request): Response
    {
        $report = $this->buildReport($request);
        $format = strtolower((string) ($request->query('format', 'csv')));
        $stamp = $report['period']['from'].'-'.$report['period']['to'];

        if ($format === 'json') {
            $payload = json_encode(['data' => $report], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);

            return response($payload, 200, [
                'Content-Type' => 'application/json; charset=UTF-8',
                'Content-Disposition' => 'attachment; filename="rapport-gestion-'.$stamp.'.json"',
                'Cache-Control' => 'no-store, private',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        }

        $csv = $this->reports->toCsv($report);

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="rapport-gestion-'.$stamp.'.csv"',
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildReport(Request $request): array
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }
        $clinicId = (string) $user->clinic_id;
        $timezone = (string) Clinic::query()->whereKey($clinicId)->value('timezone');

        return $this->reports->build(
            $clinicId,
            $timezone !== '' ? $timezone : 'Africa/Douala',
            $this->permissions->for($user),
            $request->query('from'),
            $request->query('to'),
            CarbonImmutable::now('UTC'),
        );
    }
}

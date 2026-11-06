<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Reports\FinancialReports;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Http\Controllers\Controller;
use App\Models\Clinic;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Finance du cabinet sur une période (R01, EN LIGNE), module `sales`, pour la gérante seule (`finance.global.read`,
 * fichier 09) : chiffre d'affaires, encaissements, créances, crédits à rembourser, reprises papier, corrections, caisse, et
 * la fraîcheur des totaux (postes hors ligne non synchronisés). Lecture seule ; aucun solde n'est stocké, tout est projeté
 * à l'instant de la lecture (`generated_at`). La période est en jours civils du cabinet (`from`, `to`).
 */
final class FinancialReportController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }
        $clinicId = (string) $user->clinic_id;
        $timezone = (string) Clinic::query()->whereKey($clinicId)->value('timezone');
        $now = CarbonImmutable::now('UTC');
        $period = ReportPeriod::resolve($timezone !== '' ? $timezone : 'Africa/Douala', $now, $request->query('from'), $request->query('to'));

        return new JsonResponse(['data' => FinancialReports::build($clinicId, $period, $now)]);
    }
}

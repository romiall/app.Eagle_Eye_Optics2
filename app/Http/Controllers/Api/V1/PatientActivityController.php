<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Patients\PatientActivity;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\Controller;
use App\Http\Resources\PatientActivityPresenter;
use App\Models\User;
use App\Support\Modules;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Activité d'un patient (fiche patient, onglet « Activité ») : lecture seule, module `patients`, droit `patient.read`
 * (middleware de la route). Les sections rendues dépendent des droits ACTUELS du compte (dérogations comprises) et
 * des modules ouverts par l'exploitant :
 *
 *   visites                                     patient.read (toujours, c'est le droit de la route)
 *   examens et ordonnances                      clinical.read, module « consultations » ouvert
 *   pièces financières                          invoice.read, module « sales » ouvert
 *
 * `invoice.read` est le droit de lecture des pièces du référentiel (`database/02_reference_data.sql` : « Lire facture
 * autorisée », gérante et caisse), celui des routes de factures et de reçus. Un compte qui n'a pas le droit d'une
 * section ne reçoit ni ses éléments, ni son compte, ni sa mention. Un patient d'un autre cabinet répond 404.
 */
final class PatientActivityController extends Controller
{
    public function index(Request $request, PatientActivity $activity, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $exists = DB::table('patient_records')->where('clinic_id', $actor->clinic_id)->where('id', $id)->exists();
        if (! $exists) {
            throw BusinessError::notFound();
        }

        $clinical = $actor->can('clinical.read') && Modules::isEnabled('consultations');
        $financial = $actor->can('invoice.read') && Modules::isEnabled('sales');

        $sections = [PatientActivity::VISITS];
        if ($clinical) {
            $sections[] = PatientActivity::EXAMS;
            $sections[] = PatientActivity::PRESCRIPTIONS;
        }
        if ($financial) {
            $sections[] = PatientActivity::FINANCIAL;
        }

        $page = $activity($actor->clinic_id, $id, $sections, $request->query('section'), $request->query('page'));

        // Seuls les écrans qui existent et que le compte peut ouvrir reçoivent une adresse (consultation,
        // prescriptions du dossier ou d'une consultation, factures).
        return new JsonResponse(PatientActivityPresenter::page($page, [
            'consultations' => $clinical,
            'sales' => $financial,
        ], $id));
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

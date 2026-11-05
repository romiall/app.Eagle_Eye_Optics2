<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Clinical\ClinicalReadAudit;
use App\Domain\Clinical\ConsultationReader;
use App\Domain\Clinical\OpticalPrescriptions;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\PrescriptionPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Prescriptions optiques (C04) : brouillon, nouvelle version, validation. Données CLINIQUES, réservées aux comptes qui
 * détiennent les permissions `clinical.*` (accueil et caisse : 403). Les écritures passent par le chemin central de
 * commandes ; chaque réponse relit la prescription (une réponse qui rend des valeurs cliniques est une lecture,
 * tracée sans contenu).
 *
 * Les identifiants du chemin et du corps doivent coïncider (422), jamais l'un pour l'autre : la consultation de
 * `POST /consultations/{id}/prescriptions`, la prescription corrigée de `POST /prescriptions/{id}/revisions` et la
 * prescription de `POST /prescriptions/{id}/validate`.
 */
final class PrescriptionController extends CommandController
{
    public function __construct(
        private readonly OpticalPrescriptions $prescriptions,
        private readonly ConsultationReader $consultations,
        private readonly ClinicalReadAudit $audit,
    ) {}

    /** Toutes les versions des prescriptions d'une consultation (la plus récente d'abord). */
    public function index(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        if ($this->consultations->find($clinicId, $id) === null) {
            throw BusinessError::notFound();
        }
        $list = $this->prescriptions->listForConsultation($clinicId, $id);
        $this->audit->prescriptionsListed($actor, $clinicId, $id);

        return new JsonResponse(['data' => array_map(PrescriptionPresenter::prescription(...), $list)]);
    }

    /** Prescriptions d'un patient (internes et externes), pour l'écran « Prescriptions » du dossier patient. */
    public function patientIndex(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $clinicId = (string) $actor->clinic_id;
        if (! DB::table('patient_records')->where('clinic_id', $clinicId)->where('id', $id)->exists()) {
            throw BusinessError::notFound();
        }
        $list = $this->prescriptions->listForPatient($clinicId, $id);
        $this->audit->patientPrescriptionsListed($actor, $clinicId, $id);

        return new JsonResponse(['data' => array_map(PrescriptionPresenter::prescription(...), $list)]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->respond($this->actor($request), $id, 200);
    }

    /** Prescription interne : première version de la prescription d'une consultation. */
    public function store(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $errors = [];
        if (($payload['origin'] ?? null) !== 'INTERNAL') {
            $errors['origin'] = ['Une prescription de consultation est d\'origine interne (INTERNAL).'];
        }
        if (($payload['consultation_id'] ?? null) !== $id) {
            $errors['consultation_id'] = ['L\'identifiant de la consultation du corps doit être celui de l\'adresse.'];
        }
        if (($payload['supersedes_id'] ?? null) !== null) {
            $errors['supersedes_id'] = ['Une première version ne remplace aucune prescription : utilisez la route des nouvelles versions.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        return $this->create($request, $payload, $expected);
    }

    /** Transcription d'une ordonnance externe identifiée (A13) : aucune consultation. */
    public function storeExternal(Request $request): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $errors = [];
        if (($payload['origin'] ?? null) !== 'EXTERNAL') {
            $errors['origin'] = ['Une ordonnance externe est d\'origine externe (EXTERNAL).'];
        }
        if (($payload['supersedes_id'] ?? null) !== null) {
            $errors['supersedes_id'] = ['Une première version ne remplace aucune prescription : utilisez la route des nouvelles versions.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        return $this->create($request, $payload, $expected);
    }

    /** Nouvelle version de la dernière version validée d'une série. */
    public function revise(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        if (($payload['supersedes_id'] ?? null) !== $id) {
            throw BusinessError::validation(['supersedes_id' => ['L\'identifiant de la prescription remplacée du corps doit être celui de l\'adresse.']]);
        }

        return $this->create($request, $payload, $expected);
    }

    /** Modification d'un brouillon (en ligne seulement) avec le jeton `expected_updated_at`. */
    public function update(Request $request, string $id): JsonResponse
    {
        /** @var array<string, mixed> $body */
        $body = $request->json()->all();
        // `expected_version` (null) est toléré : le répartiteur du poste l'ajoute à tout corps de route directe.
        if (array_key_exists('expected_version', $body) && $body['expected_version'] !== null) {
            throw BusinessError::validation(['expected_version' => ['Une prescription brouillon n\'a pas de version : le jeton est expected_updated_at.']]);
        }
        unset($body['expected_version']);
        $unknown = array_diff(array_keys($body), ['expected_updated_at', 'changes']);
        if ($unknown !== []) {
            $errors = [];
            foreach ($unknown as $field) {
                $errors[(string) $field] = ['Champ non prévu par le contrat.'];
            }
            throw BusinessError::validation($errors);
        }

        $this->dispatchCommand($request, new Command('UpdatePrescriptionDraft', [
            'prescription_id' => $id,
            'expected_updated_at' => $body['expected_updated_at'] ?? null,
            'changes' => $body['changes'] ?? null,
        ], $id, null));

        return $this->respond($this->actor($request), $id, 200);
    }

    /**
     * Suppression d'un brouillon (en ligne seulement), avec le jeton `expected_updated_at` comme la modification. La
     * prescription n'existe plus après la commande : la réponse rend le résultat de la commande, jamais une relecture.
     */
    public function delete(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        $errors = [];
        if (($payload['prescription_id'] ?? null) !== $id) {
            $errors['prescription_id'] = ['L\'identifiant de la prescription du corps doit être celui de l\'adresse.'];
        }
        if ($expected !== null) {
            $errors['expected_version'] = ['Une prescription brouillon n\'a pas de version : le jeton est expected_updated_at.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $result = $this->dispatchCommand($request, new Command('DeletePrescriptionDraft', $payload, $id, null));

        return new JsonResponse(['data' => $result->result]);
    }

    /** Validation : version immuable et document préparé. */
    public function validatePrescription(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        if (($payload['prescription_id'] ?? null) !== $id) {
            throw BusinessError::validation(['prescription_id' => ['L\'identifiant de la prescription du corps doit être celui de l\'adresse.']]);
        }

        $this->dispatchCommand($request, new Command('ValidatePrescription', $payload, $id, $expected));

        return $this->respond($this->actor($request), $id, 200);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function create(Request $request, array $payload, ?int $expected): JsonResponse
    {
        $prescriptionId = is_string($payload['prescription_id'] ?? null) ? $payload['prescription_id'] : null;
        $result = $this->dispatchCommand($request, new Command('CreatePrescription', $payload, $prescriptionId, $expected));

        return $this->respond($this->actor($request), (string) $result->resultId, 201);
    }

    private function respond(User $actor, string $prescriptionId, int $status): JsonResponse
    {
        $clinicId = (string) $actor->clinic_id;
        $view = $this->prescriptions->view($clinicId, $prescriptionId);
        if ($view === null) {
            throw BusinessError::notFound();
        }
        $this->audit->prescriptionViewed($actor, $clinicId, $prescriptionId);

        return new JsonResponse(['data' => PrescriptionPresenter::prescription($view)], $status);
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

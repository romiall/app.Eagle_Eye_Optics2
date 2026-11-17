<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Patients\MergePatients;
use App\Domain\Patients\PatientSearch;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\PatientPresenter;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Fiches patient du cabinet de la personne connectée (P01, P02) : identité administrative seulement. Les
 * écritures passent par le chemin central de commandes (route directe : le serveur numérote) ; les lectures
 * sont toujours filtrées par le cabinet, un identifiant d'un autre cabinet répond « introuvable ».
 */
final class PatientController extends CommandController
{
    public function index(Request $request, PatientSearch $search): JsonResponse
    {
        $page = $search(
            (string) $this->actor($request)->clinic_id,
            $request->query('query'),
            $request->query('page'),
            $request->query('per_page')
        );

        return new JsonResponse([
            'data' => array_map(PatientPresenter::summary(...), $page->items()),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $row = $this->find($actor, $id);
        // Fiches fusionnées dans celle-ci (L1D08) : numéro et date, pour retrouver une pièce émise sous l'ancien numéro.
        $merged = array_map(static fn (array $entry): array => [
            'patient_id' => $entry['patient_id'],
            'record_number' => $entry['record_number'],
            'merged_at' => CarbonImmutable::parse($entry['merged_at'], 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
        ], MergePatients::absorbed((string) $actor->clinic_id, $id));

        return new JsonResponse(['data' => PatientPresenter::patient($row) + ['merged_records' => $merged]]);
    }

    public function store(Request $request): JsonResponse
    {
        [$payload, $expected] = $this->body($request);
        if ($expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null à la création.']]);
        }
        if (! array_key_exists('expected_version', $request->json()->all())) {
            throw BusinessError::validation(['expected_version' => ['Champ obligatoire absent (null à la création).']]);
        }

        $patientId = is_string($payload['patient_id'] ?? null) ? $payload['patient_id'] : null;
        $result = $this->dispatchCommand($request, new Command('CreatePatient', $payload, $patientId, null));

        return new JsonResponse(['data' => PatientPresenter::patient($this->find($this->actor($request), (string) $result->resultId))], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->body($request);
        if (($payload['patient_id'] ?? null) !== $id) {
            throw BusinessError::validation(['patient_id' => ['L\'identifiant du corps doit être celui de l\'adresse.']]);
        }

        $result = $this->dispatchCommand($request, new Command('UpdatePatient', $payload, $id, $expected));

        return new JsonResponse(['data' => PatientPresenter::patient($this->find($this->actor($request), (string) $result->resultId))]);
    }

    /**
     * Corps de la route directe : la charge de la commande et `expected_version` (entier ou null).
     *
     * @return array{0: array<string, mixed>, 1: int|null}
     */
    private function body(Request $request): array
    {
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $expected = $payload['expected_version'] ?? null;
        unset($payload['expected_version']);
        if ($expected !== null && ! is_int($expected)) {
            throw BusinessError::validation(['expected_version' => ['La version attendue est un entier ou null.']]);
        }

        return [$payload, $expected];
    }

    private function find(User $actor, string $id): \stdClass
    {
        $row = DB::table('patient_records')->where('clinic_id', $actor->clinic_id)->where('id', $id)->first();
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return $row;
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

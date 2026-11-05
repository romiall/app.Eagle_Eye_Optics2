<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Clinical\ClinicalReadAudit;
use App\Domain\Clinical\ConsultationReader;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Http\Resources\ConsultationPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Consultations du cabinet de la personne connectée (C01 à C03) : données CLINIQUES, réservées aux comptes qui
 * détiennent les permissions `clinical.*` (accueil et caisse n'y ont aucun accès, quelle que soit la
 * consultation). Les écritures passent par le chemin central de commandes ; la lecture est toujours limitée au
 * cabinet (un identifiant d'un autre cabinet répond « introuvable »), tracée dans l'audit sans contenu et limitée
 * en débit par compte (limiteur `eeo-consultation-read`, posé sur les routes de lecture).
 *
 * Chaque réponse relit la consultation dans les tables vivantes APRÈS le commit, d'un seul tenant (instantané
 * cohérent, voir `ConsultationReader::view`) : c'est l'état courant, qui peut déjà intégrer l'écriture d'un autre
 * poste survenue entre-temps (la version rendue est alors plus récente). Une réponse d'écriture REND le dossier
 * complet : c'est donc une lecture, tracée comme telle (au plus un événement par compte et par consultation toutes
 * les 10 minutes), y compris pour un enregistrement sans effet ou le rejeu d'une clé.
 */
final class ConsultationController extends CommandController
{
    public function __construct(
        private readonly ConsultationReader $reader,
        private readonly ClinicalReadAudit $audit,
    ) {}

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->respond($this->actor($request), $id, 200);
    }

    public function start(Request $request, string $id): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        if (! $present) {
            throw BusinessError::validation(['expected_version' => ['Champ obligatoire absent (null au démarrage).']]);
        }
        if (($payload['visit_id'] ?? null) !== $id) {
            throw BusinessError::validation(['visit_id' => ['L\'identifiant de la visite du corps doit être celui de l\'adresse.']]);
        }

        $consultationId = is_string($payload['consultation_id'] ?? null) ? $payload['consultation_id'] : null;
        $result = $this->dispatchCommand($request, new Command('StartConsultation', $payload, $consultationId, $expected));

        return $this->respond($this->actor($request), (string) $result->resultId, 201);
    }

    public function saveStep(Request $request, string $id, string $step): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);

        $errors = [];
        if (($payload['consultation_id'] ?? null) !== $id) {
            $errors['consultation_id'] = ['L\'identifiant de la consultation du corps doit être celui de l\'adresse.'];
        }
        $submitted = $payload['step'] ?? null;
        if (is_array($submitted) && ($submitted['step'] ?? null) !== $step) {
            $errors['step.step'] = ['La rubrique du corps doit être celle de l\'adresse.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $this->dispatchCommand($request, new Command('SaveClinicalStep', $payload, $id, $expected));

        return $this->respond($this->actor($request), $id, 200);
    }

    /**
     * Finalisation (C03) : fige la révision 1 et termine la consultation.
     */
    public function complete(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        if (($payload['consultation_id'] ?? null) !== $id) {
            throw BusinessError::validation(['consultation_id' => ['L\'identifiant de la consultation du corps doit être celui de l\'adresse.']]);
        }

        $this->dispatchCommand($request, new Command('CompleteConsultation', $payload, $id, $expected));

        return $this->respond($this->actor($request), $id, 200);
    }

    /**
     * Correction motivée (C03) : nouvelle révision immuable d'une consultation terminée.
     */
    public function amend(Request $request, string $id): JsonResponse
    {
        [$payload, $expected] = $this->directBody($request);
        if (($payload['consultation_id'] ?? null) !== $id) {
            throw BusinessError::validation(['consultation_id' => ['L\'identifiant de la consultation du corps doit être celui de l\'adresse.']]);
        }

        $this->dispatchCommand($request, new Command('AmendConsultation', $payload, $id, $expected));

        return $this->respond($this->actor($request), $id, 201);
    }

    /**
     * Suppression d'un examen resté brouillon (en ligne seulement) : le serveur refuse tout autre état. La consultation
     * n'existe plus après la commande : la réponse rend le résultat de la commande (visite remise dans son état d'avant),
     * jamais une relecture du dossier ; le rejeu de la même clé rend la même réponse.
     */
    public function delete(Request $request, string $id): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $errors = [];
        if (($payload['consultation_id'] ?? null) !== $id) {
            $errors['consultation_id'] = ['L\'identifiant de la consultation du corps doit être celui de l\'adresse.'];
        }
        if (! $present) {
            $errors['expected_version'] = ['Champ obligatoire absent (version de la consultation).'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $result = $this->dispatchCommand($request, new Command('DeleteConsultationDraft', $payload, $id, $expected));

        return new JsonResponse(['data' => $result->result]);
    }

    /**
     * Révision figée d'une consultation, avec son snapshot (lecture seule, tracée sans contenu).
     */
    public function revision(Request $request, string $id, string $revision_no): JsonResponse
    {
        $actor = $this->actor($request);
        $revision = $this->reader->revision((string) $actor->clinic_id, $id, (int) $revision_no);
        if ($revision === null) {
            throw BusinessError::notFound();
        }
        $this->audit->revisionViewed($actor, (string) $actor->clinic_id, (string) $revision['id']);

        return new JsonResponse(['data' => ConsultationPresenter::revision($revision)]);
    }

    private function respond(User $actor, string $consultationId, int $status): JsonResponse
    {
        $view = $this->reader->view((string) $actor->clinic_id, $consultationId);
        if ($view === null) {
            throw BusinessError::notFound();
        }
        // La réponse REND le dossier : c'est une lecture, tracée (au plus un événement par intervalle).
        $this->audit->consultationViewed($actor, $view->row);

        return new JsonResponse(['data' => ConsultationPresenter::consultation($view)], $status);
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

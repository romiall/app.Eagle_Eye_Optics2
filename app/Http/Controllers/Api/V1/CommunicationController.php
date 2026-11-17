<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Application\Contracts\ContractValidator;
use App\Domain\Access\EffectivePermissions;
use App\Domain\Communication\ConsentLedger;
use App\Domain\Communication\MessageTemplates;
use App\Domain\Communication\ReminderPolicies;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Communication\SendTransactionalMessage;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Http\Resources\CommunicationPresenter;
use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Lectures des consentements, modèles de messages et politiques de rappel, et envois transactionnels (L2D06 et L2D07).
 * L'envoi d'un message et le rattrapage d'une tentative appellent le fournisseur de messagerie ENTRE deux transactions,
 * jamais dedans : opérations à appel fournisseur, classées comme telles dans MutationRoutesTest (clé d'idempotence
 * obligatoire, jugée par le service). Les écritures de consentements, modèles et politiques sont des commandes
 * (CommunicationCommandController).
 */
final class CommunicationController
{
    private const ATTEMPT_STATUSES = ['PLANNED', 'SUBMITTED', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN', 'CANCELLED'];

    public function __construct(
        private readonly ContractValidator $contracts,
        private readonly EffectivePermissions $permissions,
        private readonly ConsentLedger $consents,
        private readonly MessageTemplates $templates,
        private readonly ReminderPolicies $policies,
        private readonly SendTransactionalMessage $sender,
    ) {}

    public function listConsents(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $filters = array_filter([
            'page' => CommunicationRules::parsePositivePage($request->query('page')),
            'patient_id' => CommunicationRules::parseOptionalUlid('patient_id', $request->query('patient_id')),
            'prospect_contact_id' => CommunicationRules::parseOptionalUlid('prospect_contact_id', $request->query('prospect_contact_id')),
            'channel' => CommunicationRules::parseOptionalEnum('channel', $request->query('channel'), CommunicationRules::CONSENT_CHANNELS, 'Canal de filtre invalide.'),
            'purpose' => CommunicationRules::parseOptionalEnum('purpose', $request->query('purpose'), CommunicationRules::CONSENT_PURPOSES, 'Finalité de filtre invalide.'),
        ], static fn (mixed $v): bool => $v !== null);

        $result = $this->consents->list((string) $actor->clinic_id, $filters);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::consent(...), $result['items']),
            'meta' => $result['meta'],
        ]);
    }

    public function listTemplates(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $result = $this->templates->list((string) $actor->clinic_id);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::template(...), $result['items']),
        ]);
    }

    public function listReminderPolicies(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $result = $this->policies->list((string) $actor->clinic_id);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::reminderPolicy(...), $result['items']),
        ]);
    }

    public function listAttempts(Request $request): JsonResponse
    {
        $actor = $this->authorizeCommunication($request);
        $filters = array_filter([
            'page' => CommunicationRules::parsePositivePage($request->query('page')),
            'status' => CommunicationRules::parseOptionalEnum('status', $request->query('status'), self::ATTEMPT_STATUSES, 'Statut de tentative invalide.'),
            'task_id' => CommunicationRules::parseOptionalUlid('task_id', $request->query('task_id')),
        ], static fn (mixed $v): bool => $v !== null);

        $result = $this->sender->listAttempts((string) $actor->clinic_id, $filters);

        return new JsonResponse([
            'data' => array_map(CommunicationPresenter::messageAttempt(...), $result['items']),
            'meta' => $result['meta'],
        ]);
    }

    public function sendTaskMessage(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'SendTaskMessageRequest', true);
        $row = $this->sender->sendForTask($context, $id, $body, $key);

        return new JsonResponse(['data' => CommunicationPresenter::messageAttempt($row)], 201);
    }

    public function reconcileAttempt(Request $request, string $id): JsonResponse
    {
        [$context, $key, $body] = $this->readCommand($request, 'KnowledgeActionRequest', true);
        $reason = is_string($body['reason'] ?? null) ? $body['reason'] : null;
        $row = $this->sender->reconcileAttempt($context, $id, $reason, $key);

        return new JsonResponse(['data' => CommunicationPresenter::messageAttempt($row)]);
    }

    private function authorizeCommunication(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }
        if (! $this->permissions->has($user, 'communication.manage')) {
            throw BusinessError::forbidden('Droit communication.manage requis.');
        }

        return $user;
    }

    /**
     * @return array{0: CommandContext, 1: string, 2: array<string, mixed>}
     */
    private function readCommand(Request $request, string $schemaDef, bool $optionalEmpty = false): array
    {
        $actor = $this->authorizeCommunication($request);
        $correlation = $request->attributes->get('correlation_id');
        if (! is_string($correlation) || $correlation === '') {
            $header = $request->header('X-Correlation-Id');
            $correlation = is_string($header) && $header !== '' ? $header : Ulid::generate();
        }

        $key = CommunicationRules::assertIdempotencyKey($request->header('Idempotency-Key'));
        /** @var array<string, mixed> $body */
        $body = $request->json()->all();

        if (! $optionalEmpty || $body !== []) {
            $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/'.$schemaDef, $body);
        }

        return [CommandContext::direct($actor, $correlation), $key, $body];
    }
}

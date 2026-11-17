<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Cash\PaymentReconciliations;
use App\Domain\Cash\Rules\PaymentReconciliationRules;
use App\Domain\Documents\DocumentFiles;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\ValueObjects\Instant;
use App\Http\Controllers\CommandController;
use App\Models\User;
use App\Support\Files\PrivateFiles;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/**
 * Rapprochements par canal de paiement (L1D06 : Mobile Money, banque, chèque, espèces), module « sales »,
 * droit `finance.reconcile`. Les validations et dépôts de relevés exigent une réauthentification récente (`423`).
 */
final class PaymentReconciliationController extends CommandController
{
    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $method = $request->query('method');
        $status = $request->query('status');
        $errors = [];

        if (is_string($method) && $method !== '' && ! in_array($method, PaymentReconciliationRules::METHODS, true)) {
            $errors['method'][] = 'Canal de paiement inconnu.';
        }
        if (is_string($status) && $status !== '' && ! in_array($status, PaymentReconciliationRules::STATUSES, true)) {
            $errors['status'][] = 'Statut de rapprochement inconnu.';
        }
        $rawPage = $request->query('page');
        $page = 1;
        if ($rawPage !== null && $rawPage !== '') {
            if (! is_string($rawPage) || filter_var($rawPage, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                $errors['page'][] = 'La page est un entier supérieur ou égal à 1.';
            } else {
                $page = (int) $rawPage;
            }
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $result = PaymentReconciliations::list(
            (string) $actor->clinic_id,
            is_string($method) && $method !== '' ? $method : null,
            is_string($status) && $status !== '' ? $status : null,
            $page,
        );

        return response()->json($result, 200);
    }

    public function candidates(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $method = $request->query('method');
        $starts = $request->query('period_starts_at');
        $ends = $request->query('period_ends_at');
        $forId = $request->query('reconciliation_id');

        $errors = [];
        if (! is_string($method) || ! in_array($method, PaymentReconciliationRules::METHODS, true)) {
            $errors['method'][] = 'Le canal de paiement est obligatoire.';
        }
        $startInstant = null;
        $endInstant = null;
        try {
            $startInstant = is_string($starts) ? Instant::parse($starts, 'period_starts_at') : null;
            if ($startInstant === null) {
                $errors['period_starts_at'][] = 'Début de période UTC obligatoire.';
            }
        } catch (\Throwable $e) {
            $errors['period_starts_at'][] = $e->getMessage();
        }
        try {
            $endInstant = is_string($ends) ? Instant::parse($ends, 'period_ends_at') : null;
            if ($endInstant === null) {
                $errors['period_ends_at'][] = 'Fin de période UTC obligatoire.';
            }
        } catch (\Throwable $e) {
            $errors['period_ends_at'][] = $e->getMessage();
        }
        if ($startInstant !== null && $endInstant !== null && $endInstant->epochMilliseconds <= $startInstant->epochMilliseconds) {
            $errors['period_ends_at'][] = 'La fin de la période doit être postérieure à son début.';
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        assert(is_string($method) && $startInstant !== null && $endInstant !== null);
        $now = CarbonImmutable::now('UTC');
        $data = PaymentReconciliations::candidates(
            (string) $actor->clinic_id,
            $method,
            $startInstant,
            $endInstant,
            is_string($forId) && $forId !== '' ? $forId : null,
            $now,
        );

        return response()->json(['data' => $data], 200);
    }

    public function storeStatementFile(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $bytes = (string) $request->getContent();
        $announced = $request->header('X-Content-Sha256');
        $checked = DocumentFiles::inspectEvidence($bytes, is_string($announced) && $announced !== '' ? $announced : null);
        $path = DocumentFiles::evidencePathFor((string) $actor->clinic_id, $checked['sha256'], $checked['extension']);
        PrivateFiles::write($path, $bytes);

        $result = $this->dispatchCommand($request, new Command('StoreStatementEvidence', [
            'sha256' => $checked['sha256'],
            'size_bytes' => $checked['size'],
            'mime_type' => $checked['mime_type'],
            'private_path' => $path,
        ], null, null));

        return response()->json(['data' => $result->result], 201);
    }

    public function downloadStatementFile(Request $request, string $id): Response
    {
        $actor = $this->actor($request);
        $file = DB::table('stored_files')
            ->where('clinic_id', (string) $actor->clinic_id)
            ->where('id', $id)
            ->where('classification', 'FINANCIAL')
            ->first(['private_path', 'mime_type']);

        if ($file === null || ! is_string($file->private_path)) {
            throw BusinessError::notFound('Relevé introuvable.');
        }

        $bytes = PrivateFiles::read($file->private_path);
        if ($bytes === null) {
            throw BusinessError::notFound('Contenu du relevé introuvable.');
        }

        return response($bytes, 200, [
            'Content-Type' => (string) $file->mime_type,
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $payload = $this->unversionedPayload($request, null);
        $id = is_string($payload['reconciliation_id'] ?? null) ? $payload['reconciliation_id'] : null;
        $result = $this->dispatchCommand($request, new Command('CreatePaymentReconciliation', $payload, $id, null));

        return response()->json(['data' => $result->result], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $reconciliation = PaymentReconciliations::find((string) $actor->clinic_id, $id);
        if ($reconciliation === null) {
            throw BusinessError::notFound('Rapprochement introuvable.');
        }

        return response()->json(['data' => $reconciliation], 200);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $payload = $this->unversionedPayload($request, $id);
        $result = $this->dispatchCommand($request, new Command('UpdatePaymentReconciliation', $payload, $id, null));

        return response()->json(['data' => $result->result], 200);
    }

    public function validateReconciliation(Request $request, string $id): JsonResponse
    {
        $payload = $this->unversionedPayload($request, $id);
        $result = $this->dispatchCommand($request, new Command('ValidatePaymentReconciliation', $payload, $id, null));

        return response()->json(['data' => $result->result], 200);
    }

    /**
     * @return array<string, mixed>
     */
    private function unversionedPayload(Request $request, ?string $routeId): array
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $errors = [];
        if (! $present || $expected !== null) {
            $errors['expected_version'] = ['La version attendue vaut null (champ obligatoire).'];
        }
        if ($routeId !== null && ($payload['reconciliation_id'] ?? null) !== $routeId) {
            $errors['reconciliation_id'] = ['L\'identifiant du corps doit correspondre à l\'adresse de la ressource.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        return $payload;
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

<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Billing\InvoiceReader;
use App\Domain\Billing\QuoteReader;
use App\Domain\Billing\Quotes;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Http\Controllers\CommandController;
use App\Http\Resources\InvoicePresenter;
use App\Http\Resources\QuotePresenter;
use App\Models\Clinic;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Devis du cabinet (L1D07) : brouillon, émission, révisions figées, réponse du client et conversion en BROUILLON de
 * facture. Toute écriture passe par le chemin central de commandes (droits relus sous verrou, idempotence, audit) ;
 * ce contrôleur ne calcule rien. Module `sales`, EN LIGNE.
 *
 * Réponses d'écriture : le devis relu APRÈS le commit ; la conversion rend le brouillon de facture créé (201), relu
 * lui aussi, qui porte `quote_id`. Aucun devis n'entre dans le chiffre d'affaires ni dans l'encaissé.
 */
final class QuoteController extends CommandController
{
    public function __construct(private readonly QuoteReader $reader, private readonly InvoiceReader $invoices) {}

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $today = $this->today($actor);
        $page = $this->reader->page((string) $actor->clinic_id, $request->query('status'), $request->query('patient_id'), $request->query('page'), $today);

        return new JsonResponse([
            'data' => array_map(static fn (\stdClass $row): array => QuotePresenter::summary($row, $today), array_values($page->items())),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return new JsonResponse(['data' => $this->present($request, $id)]);
    }

    public function store(Request $request): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        if (! $present || $expected !== null) {
            throw BusinessError::validation(['expected_version' => ['La version attendue vaut null à la création (champ obligatoire).']]);
        }

        $quoteId = is_string($payload['quote_id'] ?? null) ? $payload['quote_id'] : null;
        $result = $this->dispatchCommand($request, new Command('CreateQuoteDraft', $payload, $quoteId, null));

        return new JsonResponse(['data' => $this->present($request, (string) $result->resultId)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        return $this->versioned($request, $id, 'UpdateQuoteDraft');
    }

    /**
     * Suppression d'un brouillon jamais émis : le devis n'existe plus après la commande, la réponse rend le résultat de
     * la commande (jamais une relecture) ; le rejeu de la même clé rend la même réponse.
     */
    public function delete(Request $request, string $id): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $this->assertSameQuote($payload, $id, $present);

        $result = $this->dispatchCommand($request, new Command('DeleteQuoteDraft', $payload, $id, $expected));

        return new JsonResponse(['data' => $result->result]);
    }

    public function issue(Request $request, string $id): JsonResponse
    {
        return $this->versioned($request, $id, 'IssueQuote');
    }

    public function revise(Request $request, string $id): JsonResponse
    {
        return $this->versioned($request, $id, 'ReviseQuote', 201);
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        return $this->versioned($request, $id, 'RecordQuoteDecision');
    }

    /**
     * Conversion d'une révision en brouillon de facture : rend la facture créée (relue après le commit).
     */
    public function convert(Request $request, string $id): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $this->assertSameQuote($payload, $id, $present);

        $result = $this->dispatchCommand($request, new Command('ConvertQuote', $payload, $id, $expected));

        $row = $this->invoices->find((string) $this->actor($request)->clinic_id, (string) $result->resultId);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return new JsonResponse(['data' => InvoicePresenter::invoice($this->invoices->detail($row))], 201);
    }

    private function versioned(Request $request, string $id, string $command, int $status = 200): JsonResponse
    {
        [$payload, $expected, $present] = $this->directBody($request);
        $this->assertSameQuote($payload, $id, $present);

        $result = $this->dispatchCommand($request, new Command($command, $payload, $id, $expected));

        return new JsonResponse(['data' => $this->present($request, (string) $result->resultId)], $status);
    }

    /**
     * L'identifiant du devis du corps est celui de l'adresse, et la version attendue est présente.
     *
     * @param  array<string, mixed>  $payload
     */
    private function assertSameQuote(array $payload, string $id, bool $versionPresent): void
    {
        $errors = [];
        if (($payload['quote_id'] ?? null) !== $id) {
            $errors['quote_id'] = ['L\'identifiant du devis du corps doit être celui de l\'adresse.'];
        }
        if (! $versionPresent) {
            $errors['expected_version'] = ['Champ obligatoire absent.'];
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function present(Request $request, string $quoteId): array
    {
        $actor = $this->actor($request);
        $row = $this->reader->find((string) $actor->clinic_id, $quoteId);
        if ($row === null) {
            throw BusinessError::notFound();
        }

        return QuotePresenter::quote($this->reader->detail($row), $this->today($actor));
    }

    /** Jour civil du cabinet de la personne connectée (validité des devis). */
    private function today(User $actor): CivilDate
    {
        $timezone = (string) Clinic::query()->whereKey($actor->clinic_id)->value('timezone');

        return Quotes::today((object) ['timezone' => $timezone !== '' ? $timezone : 'Africa/Douala'], CarbonImmutable::now('UTC'));
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

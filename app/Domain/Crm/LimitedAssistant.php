<?php

namespace App\Domain\Crm;

use App\Application\Effects\IdempotencyStore;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\CivilDate;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Text;
use App\Http\Middleware\AssignCorrelationId;
use App\Models\User;
use App\Support\Integrations\Assistant\AssistantEngineInterface;
use App\Support\Integrations\Assistant\DeterministicAssistantEngine;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Assistant IA borné (L2D05) :
 * - Refuse de répondre lorsque la conversation est en `HUMAN_TAKEOVER` ou `CLOSED` (409 `STATE_TRANSITION_REFUSED`) ;
 * - Détecte les questions cliniques/médicales et déclenche un handoff automatique `REQUEST` ;
 * - S'appuie exclusivement sur les fiches PUBLIÉES de la base de connaissances et des outils administratifs assainis ;
 * - Journalise chaque exécution dans `assistant_runs` avec `knowledge_version_ids` et `sanitized_tool_results`.
 */
final class LimitedAssistant
{
    private const CLINICAL_REFUSAL_REPLY = 'Je ne peux pas fournir d\'avis médical, interpréter une ordonnance ni recommander un traitement. Je transmets immédiatement votre demande à un professionnel du cabinet qui vous répondra.';

    /** Mots entiers (clés normalisées sans accents via `Text::searchKey`) déclenchant le garde-fou clinique. */
    private const CLINICAL_WHOLE_WORDS = [
        'symptome',
        'symptomes',
        'douleur',
        'douleurs',
        'mal',
        'ordonnance',
        'ordonnances',
        'diagnostic',
        'diagnostiquer',
        'diagnostique',
        'medicament',
        'medicaments',
        'collyre',
        'collyres',
        'gouttes',
        'dioptrie',
        'dioptries',
        'sphere',
        'cylindre',
        'axe',
        'glaucome',
        'cataracte',
        'conjonctivite',
        'infection',
        'inflammation',
        'prescription',
        'prescriptions',
        'maladie',
        'maladies',
        'pathologie',
        'pathologies',
        'retine',
        'cornee',
        'ophtalmologue',
        'medecin',
        'chirurgie',
        'myopie',
        'astigmatisme',
        'presbytie',
        'hypermetropie',
        'strabisme',
        'dmla',
        'traitement',
        'saignement',
        'symptom',
        'symptoms',
        'pain',
        'diagnosis',
        'medication',
        'glaucoma',
        'disease',
    ];

    /** Expressions multi-mots déclenchant le garde-fou clinique. */
    private const CLINICAL_PHRASES = [
        'tension oculaire',
        'fond d oeil',
        'vision floue',
        'perte de vision',
        'oeil rouge',
        'yeux rouges',
        'baisse de vision',
    ];

    public function __construct(
        private readonly Container $container,
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
        private readonly IdempotencyStore $idempotency,
        private readonly AssistantTools $tools,
        private readonly HumanHandoff $handoffs,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     * @return array{
     *     run: stdClass,
     *     reply: string,
     *     handoff_triggered: bool,
     *     clinical_refusal: bool,
     *     conversation_status: string,
     *     knowledge_citations: list<string>,
     *     booking_reference: ?string,
     * }
     */
    public function runTurn(
        string $clinicId,
        User $actor,
        string $conversationId,
        array $payload,
        ?string $correlationId = null,
        ?string $idempotencyKey = null,
    ): array {
        if (! (bool) config('eeo.integrations.assistant.enabled', true)) {
            throw new BusinessError('ASSISTANT_DISABLED', 'L\'assistant automatisé est actuellement désactivé pour ce cabinet.', 503);
        }

        if (! Ulid::isValid($conversationId)) {
            throw BusinessError::notFound();
        }

        [$message, $serviceId, $preferredStartsAt] = $this->validateInput($payload);
        $resolvedCorrelation = $correlationId ?? AssignCorrelationId::current(request());
        $startedAt = CarbonImmutable::now('UTC');
        $context = CommandContext::direct($actor, $resolvedCorrelation, $startedAt);
        $cleanKey = $idempotencyKey !== null && trim($idempotencyKey) !== ''
            ? strtoupper(trim($idempotencyKey))
            : null;
        $fingerprint = hash('sha256', (string) json_encode([
            'conversation_id' => $conversationId,
            'message' => $message,
            'service_id' => $serviceId,
            'preferred_starts_at' => $preferredStartsAt?->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ], JSON_THROW_ON_ERROR));

        $convMeta = DB::table('crm_conversations as c')
            ->leftJoin('crm_leads as l', static function ($join): void {
                $join->on('l.clinic_id', '=', 'c.clinic_id')
                    ->on('l.id', '=', 'c.crm_lead_id');
            })
            ->where('c.clinic_id', $clinicId)
            ->where('c.id', $conversationId)
            ->first(['c.id', 'c.status', 'c.crm_lead_id', 'l.prospect_contact_id']);

        if ($convMeta === null) {
            throw BusinessError::notFound();
        }

        $leadIdHint = $convMeta->crm_lead_id !== null ? (string) $convMeta->crm_lead_id : null;
        $prospectIdHint = $convMeta->prospect_contact_id !== null ? (string) $convMeta->prospect_contact_id : null;
        $isClinical = self::containsClinicalIntent($message);

        /**
         * Phase 1 (verrou + idempotence) : rejoue exactement une réponse perdue ou conflictuelle, sinon réserve la clé
         * avant tout appel au moteur externe et traite le refus clinique en une seule transaction.
         *
         * @var array{
         *     replayed: ?array{
         *         run: stdClass,
         *         reply: string,
         *         handoff_triggered: bool,
         *         clinical_refusal: bool,
         *         conversation_status: string,
         *         knowledge_citations: list<string>,
         *         booking_reference: ?string,
         *     },
         *     reservation: ?string,
         *     clinic_timezone: string,
         * } $prepared
         */
        $prepared = $this->transactions->run(function () use (
            $clinicId,
            $conversationId,
            $leadIdHint,
            $context,
            $message,
            $serviceId,
            $startedAt,
            $cleanKey,
            $fingerprint,
            $isClinical,
        ): array {
            $locks = new TransactionLocks($clinicId);
            $clinic = $locks->clinic();

            $reservation = null;
            if ($cleanKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'RunAssistantTurn', $cleanKey);
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    if ($existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                        return [
                            'replayed' => $this->replayTurnResult($clinicId, $existingIdem->result_payload),
                            'reservation' => null,
                            'clinic_timezone' => (string) $clinic->timezone,
                        ];
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, 'RunAssistantTurn', $cleanKey, $fingerprint);
                }
            }

            if ($leadIdHint !== null) {
                $locks->crmLead($leadIdHint);
            }
            $conv = $locks->crmConversation($conversationId);
            if ($conv === null) {
                throw BusinessError::notFound();
            }
            if ((string) $conv->status !== 'BOT_ACTIVE') {
                throw BusinessError::stateRefused(
                    'L\'assistant est arrêté car cette conversation est en prise en charge humaine ou clôturée.',
                    (string) $conv->status,
                );
            }

            if ($isClinical) {
                $result = $this->recordClinicalRefusalUnderLocks($clinicId, $conversationId, $locks, $context, $conv, $message, $startedAt, $reservation);

                return [
                    'replayed' => $result,
                    'reservation' => null,
                    'clinic_timezone' => (string) $clinic->timezone,
                ];
            }

            if ($serviceId !== null) {
                $serviceExists = DB::table('appointment_services')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $serviceId)
                    ->where('active', true)
                    ->where('public_booking', true)
                    ->exists();
                if (! $serviceExists) {
                    throw BusinessError::validation(['service_id' => ['Prestation introuvable ou non ouverte à la réservation en ligne.']]);
                }
            }

            return [
                'replayed' => null,
                'reservation' => $reservation,
                'clinic_timezone' => (string) $clinic->timezone,
            ];
        });

        if ($prepared['replayed'] !== null) {
            return $prepared['replayed'];
        }

        $reservation = $prepared['reservation'];
        $maxTools = max(1, (int) config('eeo.integrations.assistant.max_tools_per_run', 5));
        $toolResults = [];
        $toolCount = 0;

        $publishedKnowledge = $this->tools->listPublishedKnowledge($clinicId);
        $toolResults[] = ['tool' => 'listPublishedKnowledge', 'count' => count($publishedKnowledge)];
        $toolCount++;

        $services = [];
        if ($toolCount < $maxTools) {
            $services = $this->tools->getBookableServices($clinicId);
            $toolResults[] = ['tool' => 'getBookableServices', 'count' => count($services)];
            $toolCount++;
        }

        $catalogItems = [];
        if ($toolCount < $maxTools) {
            $catalogItems = $this->tools->getPublicCatalog($clinicId);
            $toolResults[] = ['tool' => 'get_public_catalog', 'count' => count($catalogItems)];
            $toolCount++;
        }

        $slots = [];
        $candidateResourceId = null;
        if ($serviceId !== null && $toolCount < $maxTools) {
            $clinicTimezone = $prepared['clinic_timezone'] !== '' ? $prepared['clinic_timezone'] : 'Africa/Douala';
            $targetDate = ($preferredStartsAt ?? $startedAt)->setTimezone($clinicTimezone)->format('Y-m-d');
            $day = CivilDate::fromString($targetDate, 'preferred_starts_at');
            $slots = $this->tools->getAvailableSlots($clinicId, $serviceId, $day, $startedAt);
            $toolResults[] = ['tool' => 'getAvailableSlots', 'service_id' => $serviceId, 'date' => $targetDate, 'count' => count($slots)];
            $toolCount++;

            if ($preferredStartsAt !== null) {
                $targetIso = $preferredStartsAt->utc()->format('Y-m-d\TH:i:s.v\Z');
                foreach ($slots as $slot) {
                    if ($slot['starts_at'] === $targetIso) {
                        $candidateResourceId = $slot['resource_id'];
                        break;
                    }
                }
            }
        }

        $bookingReference = null;
        $bookingError = null;
        if ($serviceId !== null && $preferredStartsAt !== null && $toolCount < $maxTools) {
            if ($prospectIdHint !== null && $candidateResourceId !== null) {
                try {
                    $requestKey = 'assistant:'.$conversationId.':'.sha1($serviceId.'|'.$preferredStartsAt->utc()->format('Y-m-d\TH:i:s.v\Z'));
                    $booking = $this->tools->createPublicBookingRequest(
                        $clinicId,
                        $prospectIdHint,
                        $serviceId,
                        $candidateResourceId,
                        $preferredStartsAt,
                        $requestKey,
                        $startedAt,
                    );
                    $bookingReference = $booking['public_reference'];
                    $toolResults[] = [
                        'tool' => 'createPublicBookingRequest',
                        'booked' => true,
                        'public_reference' => $bookingReference,
                    ];
                } catch (BusinessError) {
                    $bookingError = 'Ce créneau n\'est plus disponible ; consultez les créneaux proposés.';
                    $toolResults[] = [
                        'tool' => 'createPublicBookingRequest',
                        'booked' => false,
                        'reason' => 'SLOT_UNAVAILABLE',
                    ];
                }
            } else {
                $bookingError = 'Aucun créneau disponible à l\'horaire demandé ; voici les prochaines disponibilités.';
                $toolResults[] = [
                    'tool' => 'createPublicBookingRequest',
                    'booked' => false,
                    'reason' => 'SLOT_UNAVAILABLE',
                ];
            }
        }

        // Appel au moteur externe hors de toute transaction de base de données.
        $engine = $this->engine();
        $engineOutput = $engine->respond(
            $message,
            $publishedKnowledge,
            [
                'services' => $services,
                'slots' => $slots,
                'catalog_items' => $catalogItems,
                'booking_reference' => $bookingReference,
            ],
            $bookingError,
        );

        return $this->transactions->run(function () use (
            $clinicId,
            $conversationId,
            $leadIdHint,
            $context,
            $toolResults,
            $startedAt,
            $engine,
            $engineOutput,
            $bookingReference,
            $reservation,
        ): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            if ($leadIdHint !== null) {
                $locks->crmLead($leadIdHint);
            }
            $conv = $locks->crmConversation($conversationId);
            if ($conv === null) {
                throw BusinessError::notFound();
            }
            if ((string) $conv->status !== 'BOT_ACTIVE') {
                throw BusinessError::stateRefused(
                    'L\'assistant est arrêté car cette conversation est en prise en charge humaine ou clôturée.',
                    (string) $conv->status,
                );
            }

            $completedAt = CarbonImmutable::now('UTC');
            if ($completedAt->lessThan($startedAt)) {
                $completedAt = $startedAt;
            }
            $startedSql = $startedAt->format('Y-m-d H:i:s.u');
            $completedSql = $completedAt->format('Y-m-d H:i:s.u');

            $runId = Ulid::generate();
            DB::table('assistant_runs')->insert([
                'id' => $runId,
                'clinic_id' => $clinicId,
                'conversation_id' => $conversationId,
                'engine_name' => $engine->engineName(),
                'model_name' => $engine->modelName(),
                'rules_version' => $engine->rulesVersion(),
                'started_at' => $startedSql,
                'completed_at' => $completedSql,
                'status' => 'COMPLETED',
                'input_tokens' => $engineOutput['input_tokens'],
                'output_tokens' => $engineOutput['output_tokens'],
                'knowledge_version_ids' => json_encode($engineOutput['knowledge_version_ids'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'sanitized_tool_results' => json_encode($toolResults, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'error_code' => null,
                'created_at' => $completedSql,
                'updated_at' => $completedSql,
            ]);

            DB::table('crm_conversations')
                ->where('clinic_id', $clinicId)
                ->where('id', $conversationId)
                ->update([
                    'last_activity_at' => $completedSql,
                    'updated_at' => $completedSql,
                ]);

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'assistant.turn_completed',
                'assistant_runs',
                $runId,
                null,
                [
                    'conversation_id' => $conversationId,
                    'knowledge_version_count' => count($engineOutput['knowledge_version_ids']),
                    'booking_reference' => $bookingReference,
                ],
                $context->correlationId,
            );

            $result = [
                'reply' => $engineOutput['reply'],
                'handoff_triggered' => false,
                'clinical_refusal' => false,
                'conversation_status' => 'BOT_ACTIVE',
                'knowledge_citations' => $engineOutput['knowledge_citations'],
                'booking_reference' => $bookingReference,
            ];

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'assistant_runs', $runId, [
                    'run_id' => $runId,
                    ...$result,
                ]);
            }

            $runRow = DB::table('assistant_runs')->where('clinic_id', $clinicId)->where('id', $runId)->first();
            assert($runRow instanceof stdClass);

            return ['run' => $runRow, ...$result];
        });
    }

    /**
     * @return list<stdClass>
     */
    public function listRuns(string $clinicId, string $conversationId): array
    {
        if (! Ulid::isValid($conversationId)) {
            throw BusinessError::notFound();
        }

        $exists = DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('id', $conversationId)
            ->exists();
        if (! $exists) {
            throw BusinessError::notFound();
        }

        /** @var list<stdClass> */
        return array_values(DB::table('assistant_runs')
            ->where('clinic_id', $clinicId)
            ->where('conversation_id', $conversationId)
            ->orderBy('started_at')
            ->orderBy('id')
            ->get()
            ->all());
    }

    public static function containsClinicalIntent(string $message): bool
    {
        $normalized = Text::searchKey($message);
        if ($normalized === '') {
            return false;
        }

        foreach (self::CLINICAL_PHRASES as $phrase) {
            if (str_contains(' '.$normalized.' ', ' '.$phrase.' ')) {
                return true;
            }
        }

        $tokens = array_values(array_filter(explode(' ', $normalized), static fn (string $token): bool => $token !== ''));
        foreach ($tokens as $token) {
            if (in_array($token, self::CLINICAL_WHOLE_WORDS, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{
     *     run: stdClass,
     *     reply: string,
     *     handoff_triggered: bool,
     *     clinical_refusal: bool,
     *     conversation_status: string,
     *     knowledge_citations: list<string>,
     *     booking_reference: ?string,
     * }
     */
    private function replayTurnResult(string $clinicId, string $resultPayload): array
    {
        /** @var array{
         *     run_id: string,
         *     reply: string,
         *     handoff_triggered: bool,
         *     clinical_refusal: bool,
         *     conversation_status: string,
         *     knowledge_citations: list<string>,
         *     booking_reference: ?string,
         * } $cached */
        $cached = json_decode($resultPayload, true, 512, JSON_THROW_ON_ERROR);
        $runRow = DB::table('assistant_runs')
            ->where('clinic_id', $clinicId)
            ->where('id', $cached['run_id'])
            ->first();
        assert($runRow instanceof stdClass);

        return [
            'run' => $runRow,
            'reply' => $cached['reply'],
            'handoff_triggered' => $cached['handoff_triggered'],
            'clinical_refusal' => $cached['clinical_refusal'],
            'conversation_status' => $cached['conversation_status'],
            'knowledge_citations' => $cached['knowledge_citations'],
            'booking_reference' => $cached['booking_reference'],
        ];
    }

    /**
     * @return array{
     *     run: stdClass,
     *     reply: string,
     *     handoff_triggered: bool,
     *     clinical_refusal: bool,
     *     conversation_status: string,
     *     knowledge_citations: list<string>,
     *     booking_reference: ?string,
     * }
     */
    private function recordClinicalRefusalUnderLocks(
        string $clinicId,
        string $conversationId,
        TransactionLocks $locks,
        CommandContext $context,
        stdClass $conv,
        string $message,
        CarbonImmutable $startedAt,
        ?string $reservation,
    ): array {
        $engine = $this->engine();
        $completedAt = CarbonImmutable::now('UTC');
        if ($completedAt->lessThan($startedAt)) {
            $completedAt = $startedAt;
        }
        $startedSql = $startedAt->format('Y-m-d H:i:s.u');
        $completedSql = $completedAt->format('Y-m-d H:i:s.u');

        $this->handoffs->applyHandoffUnderLocks(
            $locks,
            $context,
            $conv,
            'Question à caractère clinique ou médical détectée : transfert automatique vers un conseiller.',
            'Motif : demande clinique détectée lors de l\'échange avec l\'assistant.',
            null,
            'REQUEST',
            $completedAt,
        );

        $runId = Ulid::generate();
        $inputTokens = max(1, (int) ceil(mb_strlen($message, 'UTF-8') / 4));
        $outputTokens = max(1, (int) ceil(mb_strlen(self::CLINICAL_REFUSAL_REPLY, 'UTF-8') / 4));

        DB::table('assistant_runs')->insert([
            'id' => $runId,
            'clinic_id' => $clinicId,
            'conversation_id' => $conversationId,
            'engine_name' => $engine->engineName(),
            'model_name' => $engine->modelName(),
            'rules_version' => $engine->rulesVersion(),
            'started_at' => $startedSql,
            'completed_at' => $completedSql,
            'status' => 'HANDOFF',
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'knowledge_version_ids' => json_encode([], JSON_THROW_ON_ERROR),
            'sanitized_tool_results' => json_encode([
                ['tool' => 'clinical_keyword_guard', 'matched' => true, 'handoff_event' => 'REQUEST'],
            ], JSON_THROW_ON_ERROR),
            'error_code' => 'CLINICAL_REFUSAL_HANDOFF',
            'created_at' => $completedSql,
            'updated_at' => $completedSql,
        ]);

        $result = [
            'reply' => self::CLINICAL_REFUSAL_REPLY,
            'handoff_triggered' => true,
            'clinical_refusal' => true,
            'conversation_status' => 'HUMAN_TAKEOVER',
            'knowledge_citations' => [],
            'booking_reference' => null,
        ];

        if ($reservation !== null) {
            $this->idempotency->complete($context, $reservation, 'assistant_runs', $runId, [
                'run_id' => $runId,
                ...$result,
            ]);
        }

        $runRow = DB::table('assistant_runs')->where('clinic_id', $clinicId)->where('id', $runId)->first();
        assert($runRow instanceof stdClass);

        return ['run' => $runRow, ...$result];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{0: string, 1: ?string, 2: ?CarbonImmutable}
     */
    private function validateInput(array $payload): array
    {
        $errors = [];

        $rawMessage = $payload['message'] ?? null;
        $message = null;
        if (! is_string($rawMessage)) {
            $errors['message'][] = 'Le message est obligatoire.';
        } else {
            try {
                $message = Text::optional($rawMessage, 2000, 'message');
                if ($message === null) {
                    $errors['message'][] = 'Le message ne peut pas être vide.';
                }
            } catch (RuleViolation $violation) {
                $errors['message'][] = $violation->getMessage();
            }
        }

        $serviceId = $payload['service_id'] ?? null;
        if ($serviceId !== null && (! is_string($serviceId) || ! Ulid::isValid($serviceId))) {
            $errors['service_id'][] = 'Identifiant de prestation invalide (ULID attendu).';
        }

        $preferredRaw = $payload['preferred_starts_at'] ?? null;
        $preferred = null;
        if ($preferredRaw !== null) {
            if (! is_string($preferredRaw)) {
                $errors['preferred_starts_at'][] = 'Date et heure souhaitées invalides.';
            } else {
                try {
                    $parsed = Instant::parse($preferredRaw, 'preferred_starts_at');
                    if ($parsed === null) {
                        $errors['preferred_starts_at'][] = 'Date et heure souhaitées invalides.';
                    } else {
                        $preferred = CarbonImmutable::createFromTimestampMsUTC($parsed->epochMilliseconds);
                    }
                } catch (RuleViolation $violation) {
                    $errors['preferred_starts_at'][] = $violation->getMessage();
                }
            }
            if ($serviceId === null) {
                $errors['service_id'][] = 'Choisissez une prestation pour vérifier ou réserver ce créneau.';
            }
        }

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert($message !== null);

        return [$message, is_string($serviceId) ? $serviceId : null, $preferred];
    }

    private function engine(): AssistantEngineInterface
    {
        if ($this->container->bound(AssistantEngineInterface::class)) {
            /** @var AssistantEngineInterface */
            return $this->container->make(AssistantEngineInterface::class);
        }

        return $this->container->make(DeterministicAssistantEngine::class);
    }
}

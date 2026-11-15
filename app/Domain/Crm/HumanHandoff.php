<?php

namespace App\Domain\Crm;

use App\Application\Effects\OutboxEvent;
use App\Application\Effects\OutboxWriter;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use App\Http\Middleware\AssignCorrelationId;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Escalade humaine et reprise bot (L2D05) : verrouille `crmConversation` (rang 42), met à jour
 * `crm_conversations` (`takeover_at` obligatoire pour `HUMAN_TAKEOVER`), journalise dans
 * `conversation_handoffs` et publie `HumanHandoffRequested` dans `outbox_events`.
 */
final class HumanHandoff
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
        private readonly OutboxWriter $outbox,
    ) {}

    public function handoffToHuman(
        string $clinicId,
        ?User $actor,
        string $conversationId,
        mixed $reason,
        mixed $administrativeSummary = null,
        bool $assignToSelf = false,
        string $eventType = 'TAKEOVER',
        ?string $correlationId = null,
    ): stdClass {
        if (! Ulid::isValid($conversationId)) {
            throw BusinessError::notFound();
        }
        if (! in_array($eventType, ['REQUEST', 'TAKEOVER', 'CLOSE'], true)) {
            throw BusinessError::validation(['event_type' => ['Type de transfert invalide.']]);
        }

        $errors = [];
        $cleanReason = self::requiredReason($reason, $errors);
        $cleanSummary = self::optionalSummary($administrativeSummary, $errors);
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert($cleanReason !== null);

        $resolvedCorrelation = $correlationId ?? AssignCorrelationId::current(request());
        $now = CarbonImmutable::now('UTC');
        $context = $actor !== null
            ? CommandContext::direct($actor, $resolvedCorrelation, $now)
            : CommandContext::job($clinicId, 'crm.handoff', $resolvedCorrelation, $now);

        $leadIdHint = DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('id', $conversationId)
            ->value('crm_lead_id');

        return $this->transactions->run(function () use (
            $clinicId,
            $conversationId,
            $leadIdHint,
            $context,
            $cleanReason,
            $cleanSummary,
            $assignToSelf,
            $actor,
            $eventType,
            $now,
        ): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            if (is_string($leadIdHint) && $leadIdHint !== '') {
                $locks->crmLead($leadIdHint);
            }

            $conv = $locks->crmConversation($conversationId);
            if ($conv === null) {
                throw BusinessError::notFound();
            }

            if ((string) $conv->status === 'CLOSED') {
                throw BusinessError::stateRefused('Cette conversation est clôturée.', 'CLOSED');
            }
            if ((string) $conv->status === 'HUMAN_TAKEOVER' && $eventType !== 'CLOSE') {
                throw BusinessError::stateRefused('Cette conversation est déjà prise en charge par un conseiller.', 'HUMAN_TAKEOVER');
            }

            $ownerId = $assignToSelf && $actor !== null ? (string) $actor->getKey() : null;

            return $this->applyHandoffUnderLocks(
                $locks,
                $context,
                $conv,
                $cleanReason,
                $cleanSummary,
                $ownerId,
                $eventType,
                $now,
            );
        });
    }

    /**
     * Applique un transfert humain sous verrous déjà tenus (`clinic`, `crmLead` si présent, `crmConversation`).
     */
    public function applyHandoffUnderLocks(
        TransactionLocks $locks,
        CommandContext $context,
        stdClass $conversation,
        string $reason,
        ?string $administrativeSummary,
        ?string $humanOwnerId,
        string $eventType,
        CarbonImmutable $now,
    ): stdClass {
        $clinicId = $context->clinicId;
        $conversationId = (string) $conversation->id;
        $nowSql = $now->utc()->format('Y-m-d H:i:s.u');
        $nowIso = $now->utc()->format('Y-m-d\TH:i:s.v\Z');
        $newStatus = $eventType === 'CLOSE' ? 'CLOSED' : 'HUMAN_TAKEOVER';
        $newVersion = (int) $conversation->version + 1;

        $updates = [
            'status' => $newStatus,
            'last_activity_at' => $nowSql,
            'version' => $newVersion,
            'updated_at' => $nowSql,
        ];

        if ($newStatus === 'HUMAN_TAKEOVER') {
            $updates['takeover_at'] = $nowSql;
            $updates['takeover_reason'] = $reason;
            if ($administrativeSummary !== null) {
                $updates['administrative_summary'] = $administrativeSummary;
            }
            if ($humanOwnerId !== null) {
                $updates['human_owner_id'] = $humanOwnerId;
            }
        }

        DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('id', $conversationId)
            ->update($updates);

        $leadId = $conversation->crm_lead_id !== null ? (string) $conversation->crm_lead_id : null;
        if ($leadId !== null) {
            DB::table('crm_leads')
                ->where('clinic_id', $clinicId)
                ->where('id', $leadId)
                ->where('status', 'OPEN')
                ->update([
                    'status' => $newStatus === 'CLOSED' ? 'CLOSED' : 'HUMAN_TAKEOVER',
                    'updated_at' => $nowSql,
                ]);
        }

        $handoffId = Ulid::generate();
        DB::table('conversation_handoffs')->insert([
            'id' => $handoffId,
            'clinic_id' => $clinicId,
            'conversation_id' => $conversationId,
            'event_type' => $eventType,
            'actor_id' => $context->actorId,
            'reason' => $reason,
            'administrative_summary' => $administrativeSummary,
            'occurred_at' => $nowSql,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $this->outbox->write($context, [
            new OutboxEvent(
                'HumanHandoffRequested',
                1,
                'crm_conversations',
                $conversationId,
                $newVersion,
                [
                    'handoff_id' => $handoffId,
                    'conversation_id' => $conversationId,
                    'lead_id' => $leadId,
                    'event_type' => $eventType,
                    'occurred_at' => $nowIso,
                ],
            ),
        ]);

        $this->audit->recordFor(
            $clinicId,
            $context->actorId,
            $context->actorName,
            $eventType === 'REQUEST' ? 'crm.handoff_requested' : 'crm.handoff_takeover',
            'crm_conversations',
            $conversationId,
            $reason,
            [
                'event_type' => $eventType,
                'new_status' => $newStatus,
            ],
            $context->correlationId,
        );

        $updated = DB::table('crm_conversations')->where('clinic_id', $clinicId)->where('id', $conversationId)->first();
        assert($updated instanceof stdClass);

        return $updated;
    }

    public function resumeBot(
        string $clinicId,
        User $actor,
        string $conversationId,
        mixed $reason = null,
        ?string $correlationId = null,
    ): stdClass {
        if (! Ulid::isValid($conversationId)) {
            throw BusinessError::notFound();
        }

        $errors = [];
        $cleanReason = null;
        if ($reason !== null) {
            if (! is_string($reason)) {
                $errors['reason'][] = 'Le motif doit être une chaîne de caractères.';
            } else {
                try {
                    $cleanReason = Text::optional($reason, 1000, 'reason');
                } catch (RuleViolation $violation) {
                    $errors['reason'][] = $violation->getMessage();
                }
            }
        }
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }

        $effectiveReason = $cleanReason ?? 'Reprise de la conversation par l\'assistant.';
        $resolvedCorrelation = $correlationId ?? AssignCorrelationId::current(request());
        $now = CarbonImmutable::now('UTC');
        $context = CommandContext::direct($actor, $resolvedCorrelation, $now);

        $leadIdHint = DB::table('crm_conversations')
            ->where('clinic_id', $clinicId)
            ->where('id', $conversationId)
            ->value('crm_lead_id');

        return $this->transactions->run(function () use ($clinicId, $actor, $conversationId, $leadIdHint, $context, $effectiveReason, $now): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            if (is_string($leadIdHint) && $leadIdHint !== '') {
                $locks->crmLead($leadIdHint);
            }

            $conv = $locks->crmConversation($conversationId);
            if ($conv === null) {
                throw BusinessError::notFound();
            }

            if ((string) $conv->status !== 'HUMAN_TAKEOVER') {
                throw BusinessError::stateRefused(
                    'Seule une conversation en prise en charge humaine peut être rendue à l\'assistant.',
                    (string) $conv->status,
                );
            }

            $nowSql = $now->utc()->format('Y-m-d H:i:s.u');
            $nowIso = $now->utc()->format('Y-m-d\TH:i:s.v\Z');
            $newVersion = (int) $conv->version + 1;

            DB::table('crm_conversations')
                ->where('clinic_id', $clinicId)
                ->where('id', $conversationId)
                ->update([
                    'status' => 'BOT_ACTIVE',
                    'human_owner_id' => null,
                    'bot_resumed_at' => $nowSql,
                    'bot_resumed_by' => (string) $actor->getKey(),
                    'last_activity_at' => $nowSql,
                    'version' => $newVersion,
                    'updated_at' => $nowSql,
                ]);

            $leadId = $conv->crm_lead_id !== null ? (string) $conv->crm_lead_id : null;
            if ($leadId !== null) {
                DB::table('crm_leads')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $leadId)
                    ->where('status', 'HUMAN_TAKEOVER')
                    ->update([
                        'status' => 'OPEN',
                        'updated_at' => $nowSql,
                    ]);
            }

            $handoffId = Ulid::generate();
            DB::table('conversation_handoffs')->insert([
                'id' => $handoffId,
                'clinic_id' => $clinicId,
                'conversation_id' => $conversationId,
                'event_type' => 'RESUME_BOT',
                'actor_id' => (string) $actor->getKey(),
                'reason' => $effectiveReason,
                'administrative_summary' => null,
                'occurred_at' => $nowSql,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            $this->outbox->write($context, [
                new OutboxEvent(
                    'HumanHandoffRequested',
                    1,
                    'crm_conversations',
                    $conversationId,
                    $newVersion,
                    [
                        'handoff_id' => $handoffId,
                        'conversation_id' => $conversationId,
                        'lead_id' => $leadId,
                        'event_type' => 'RESUME_BOT',
                        'occurred_at' => $nowIso,
                    ],
                ),
            ]);

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'crm.bot_resumed',
                'crm_conversations',
                $conversationId,
                $effectiveReason,
                ['new_status' => 'BOT_ACTIVE'],
                $context->correlationId,
            );

            $updated = DB::table('crm_conversations')->where('clinic_id', $clinicId)->where('id', $conversationId)->first();
            assert($updated instanceof stdClass);

            return $updated;
        });
    }

    /**
     * @return list<stdClass>
     */
    public function listHandoffs(string $clinicId, string $conversationId): array
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
        return array_values(DB::table('conversation_handoffs')
            ->where('clinic_id', $clinicId)
            ->where('conversation_id', $conversationId)
            ->orderBy('occurred_at')
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function requiredReason(mixed $value, array &$errors): ?string
    {
        if (! is_string($value)) {
            $errors['reason'][] = 'Le motif du transfert (au moins 3 caractères) est obligatoire.';

            return null;
        }
        try {
            $trimmed = Text::optional($value, 2000, 'reason');
        } catch (RuleViolation $violation) {
            $errors['reason'][] = $violation->getMessage();

            return null;
        }
        if ($trimmed === null || mb_strlen($trimmed, 'UTF-8') < 3) {
            $errors['reason'][] = 'Le motif du transfert doit contenir au moins 3 caractères.';

            return null;
        }

        return $trimmed;
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function optionalSummary(mixed $value, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            $errors['administrative_summary'][] = 'Le résumé administratif doit être une chaîne de caractères.';

            return null;
        }
        try {
            return Text::optional($value, 4000, 'administrative_summary');
        } catch (RuleViolation $violation) {
            $errors['administrative_summary'][] = $violation->getMessage();

            return null;
        }
    }
}

<?php

namespace App\Domain\Scheduling;

use App\Application\Contracts\ContractValidator;
use App\Application\Effects\IdempotencyStore;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CanonicalJson;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Models\User;
use App\Support\Integrations\GoogleCalendar\CalendarTokenCipher;
use App\Support\Integrations\GoogleCalendar\GoogleCalendarClientFactory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * Réconciliation bidirectionnelle Google Calendar (L2D02) :
 * - associe une ressource du cabinet à un agenda Google (`calendar_sync_states`, verrou rang 37) ;
 * - chiffre le `syncToken` localement via libsodium (`sync_token_ciphertext`, jamais exposé) ;
 * - pousse les rendez-vous actifs sous forme assainie (référence + libellé de prestation + UTC, zéro donnée
 *   clinique ni note patient) et suit l'état dans `external_links` ;
 * - importe les plages occupées Google distantes dans `calendar_blocks` (`origin = 'GOOGLE'`) ;
 * - détecte les chevauchements et modifications concurrentes (`external_links.status = 'CONFLICT'`,
 *   `calendar_sync_states.status = 'STALE'`).
 */
final class CalendarReconciliation
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly GoogleCalendarClientFactory $clients,
        private readonly CalendarTokenCipher $cipher,
        private readonly AuditRecorder $audit,
        private readonly ContractValidator $contracts,
        private readonly IdempotencyStore $idempotency,
    ) {}

    /**
     * @return list<stdClass>
     */
    public function listStates(string $clinicId): array
    {
        return array_values(
            DB::table('calendar_sync_states')
                ->where('clinic_id', $clinicId)
                ->orderBy('resource_id')
                ->orderBy('id')
                ->get()
                ->all(),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function saveState(
        User $actor,
        string $correlationId,
        ?string $idempotencyKey,
        array $payload,
        ?CarbonImmutable $now = null,
    ): array {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/SaveCalendarSyncStateRequest', $payload);
        $clinicId = (string) $actor->clinic_id;
        $accountId = (string) $payload['integration_account_id'];
        $resourceId = (string) $payload['resource_id'];
        $calendarId = trim((string) $payload['external_calendar_id']);
        $requestedStatus = isset($payload['status']) && is_string($payload['status']) ? $payload['status'] : null;

        if ($calendarId === '' || mb_strlen($calendarId) > 255) {
            throw BusinessError::validation(['external_calendar_id' => ['Identifiant d\'agenda Google invalide (1 à 255 caractères).']]);
        }

        $context = CommandContext::direct($actor, $correlationId, $now);
        $hash = CanonicalJson::hash($payload);

        return $this->transactions->run(function () use ($context, $clinicId, $accountId, $resourceId, $calendarId, $requestedStatus, $idempotencyKey, $hash): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $idemId = null;
            if ($idempotencyKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SaveCalendarSyncState', $idempotencyKey);
                if ($existingIdem !== null) {
                    if ((string) $existingIdem->payload_hash !== $hash) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    if ((string) $existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                        /** @var array<string, mixed> $decoded */
                        $decoded = json_decode($existingIdem->result_payload, true, 512, JSON_THROW_ON_ERROR);

                        return $decoded;
                    }
                    $this->idempotency->restart($context, (string) $existingIdem->id);
                    $idemId = (string) $existingIdem->id;
                } else {
                    $idemId = $this->idempotency->reserve($context, 'SaveCalendarSyncState', $idempotencyKey, $hash);
                }
            }

            $account = DB::table('integration_accounts')
                ->where('clinic_id', $clinicId)
                ->where('id', $accountId)
                ->first();
            if ($account === null) {
                throw BusinessError::notFound('Compte d\'intégration introuvable dans ce cabinet.');
            }
            if ((string) $account->provider !== 'GOOGLE') {
                throw BusinessError::validation(['integration_account_id' => ['Ce compte d\'intégration n\'est pas un compte Google.']]);
            }

            $resource = DB::table('scheduling_resources')
                ->where('clinic_id', $clinicId)
                ->where('id', $resourceId)
                ->first();
            if ($resource === null) {
                throw BusinessError::notFound('Ressource de l\'agenda introuvable dans ce cabinet.');
            }

            $stamp = SchedulingInput::stamp($context->now->utc());
            $existing = DB::table('calendar_sync_states')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->where('resource_id', $resourceId)
                ->first();

            if ($existing !== null) {
                $locked = $locks->calendarSyncState((string) $existing->id);
                assert($locked !== null);
                $stateId = (string) $locked->id;
                $version = (int) $locked->version + 1;
                $calendarChanged = (string) $locked->external_calendar_id !== $calendarId;

                $update = [
                    'external_calendar_id' => $calendarId,
                    'status' => $requestedStatus ?? ((string) $locked->status === 'NOT_CONFIGURED' ? 'READY' : (string) $locked->status),
                    'last_error_code' => null,
                    'version' => $version,
                    'updated_at' => $stamp,
                ];
                if ($calendarChanged) {
                    $update['sync_token_ciphertext'] = null;
                    $update['token_encryption_key_id'] = null;
                    $update['pending_page_token'] = null;
                }

                DB::table('calendar_sync_states')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $stateId)
                    ->update($update);
            } else {
                $stateId = Ulid::generate();
                DB::table('calendar_sync_states')->insert([
                    'id' => $stateId,
                    'clinic_id' => $clinicId,
                    'integration_account_id' => $accountId,
                    'resource_id' => $resourceId,
                    'external_calendar_id' => $calendarId,
                    'sync_token_ciphertext' => null,
                    'token_encryption_key_id' => null,
                    'pending_page_token' => null,
                    'push_channel_id' => null,
                    'push_resource_id' => null,
                    'push_expires_at' => null,
                    'last_full_sync_at' => null,
                    'last_incremental_sync_at' => null,
                    'status' => $requestedStatus ?? 'READY',
                    'last_error_code' => null,
                    'version' => 1,
                    'created_at' => $stamp,
                    'updated_at' => $stamp,
                ]);
            }

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'calendar_sync_state.saved',
                'calendar_sync_states',
                $stateId,
                null,
                [
                    'integration_account_id' => $accountId,
                    'resource_id' => $resourceId,
                    'external_calendar_id' => $calendarId,
                ],
                $context->correlationId,
            );

            $row = DB::table('calendar_sync_states')
                ->where('clinic_id', $clinicId)
                ->where('id', $stateId)
                ->first();
            assert($row !== null);
            $presented = self::presentState($row);

            if ($idemId !== null) {
                $this->idempotency->complete($context, $idemId, 'calendar_sync_states', $stateId, $presented);
            }

            return $presented;
        });
    }

    /**
     * Exécute la synchronisation Google Calendar pour une ressource ou tout le cabinet (appel HTTP/API).
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function syncFromHttp(
        User $actor,
        string $correlationId,
        ?string $idempotencyKey,
        array $payload,
        ?CarbonImmutable $now = null,
    ): array {
        $this->contracts->assertCommandPayload('schemas/requests/http.json#/$defs/CalendarSyncRunRequest', $payload);
        $context = CommandContext::direct($actor, $correlationId, $now);
        $resourceId = is_string($payload['resource_id'] ?? null) ? $payload['resource_id'] : null;
        $fullResync = (bool) ($payload['full_resync'] ?? false);

        if ($idempotencyKey !== null) {
            $hash = CanonicalJson::hash($payload);
            $existing = DB::table('idempotency_requests')
                ->where('clinic_id', $context->clinicId)
                ->where('namespace', $context->idempotencyNamespace)
                ->where('command_name', 'SyncGoogleCalendar')
                ->where('request_key', $idempotencyKey)
                ->first();
            if ($existing !== null) {
                if ((string) $existing->payload_hash !== $hash) {
                    throw BusinessError::idempotencyMismatch();
                }
                if ((string) $existing->status === 'COMMITTED' && is_string($existing->result_payload)) {
                    /** @var array<string, mixed> $decoded */
                    $decoded = json_decode($existing->result_payload, true, 512, JSON_THROW_ON_ERROR);

                    return $decoded;
                }
            }
        }

        return $this->runSync($context, $resourceId, $fullResync, $idempotencyKey, $payload);
    }

    /**
     * Déclenche une synchronisation incrémentale interne (depuis l'outbox ou un webhook Google).
     *
     * @return array<string, mixed>
     */
    public function syncAutomated(
        string $clinicId,
        string $jobName,
        string $correlationId,
        ?string $resourceId = null,
        bool $fullResync = false,
        ?CarbonImmutable $now = null,
    ): array {
        $context = CommandContext::job($clinicId, $jobName, $correlationId, $now);

        return $this->runSync($context, $resourceId, $fullResync, null, []);
    }

    /**
     * @param  array<string, mixed>  $rawPayload
     * @return array<string, mixed>
     */
    private function runSync(
        CommandContext $context,
        ?string $resourceId,
        bool $fullResync,
        ?string $idempotencyKey,
        array $rawPayload,
    ): array {
        $clinicId = $context->clinicId;
        $clinic = DB::table('clinics')->where('id', $clinicId)->first();
        if ($clinic === null) {
            throw BusinessError::notFound('Cabinet introuvable.');
        }

        $query = DB::table('calendar_sync_states')
            ->where('clinic_id', $clinicId)
            ->where('status', '<>', 'NOT_CONFIGURED')
            ->orderBy('resource_id')
            ->orderBy('id');

        if ($resourceId !== null) {
            $query->where('resource_id', $resourceId);
        }

        $states = $query->get()->all();
        if ($states === [] && $resourceId !== null) {
            throw BusinessError::notFound('Synchronisation Google Calendar introuvable pour cette ressource.');
        }

        $client = $this->clients->make();
        $nowUtc = $context->now->utc();
        $windowStart = $nowUtc->subDays(7);
        $windowEnd = $nowUtc->addDays(90);
        $timeMinIso = $windowStart->format('Y-m-d\TH:i:s.v\Z');
        $timeMaxIso = $windowEnd->format('Y-m-d\TH:i:s.v\Z');
        $windowStartStamp = SchedulingInput::stamp($windowStart);

        /** @var list<array<string, mixed>> $plans */
        $plans = [];

        foreach ($states as $state) {
            $account = DB::table('integration_accounts')
                ->where('clinic_id', $clinicId)
                ->where('id', $state->integration_account_id)
                ->first();
            if ($account === null) {
                continue;
            }

            if ((string) $account->status === 'DISABLED') {
                $plans[] = [
                    'state' => $state,
                    'failed' => true,
                    'error_code' => 'ACCOUNT_DISABLED',
                    'pushed' => [],
                    'deleted_links' => [],
                    'remote_events' => [],
                    'next_sync_token' => null,
                    'used_full_sync' => $fullResync,
                ];

                continue;
            }

            $accountInput = $this->accountPayload($account);
            $syncToken = null;
            if (! $fullResync && is_string($state->sync_token_ciphertext) && $state->sync_token_ciphertext !== '') {
                try {
                    $syncToken = $this->cipher->decrypt($state->sync_token_ciphertext);
                } catch (Throwable) {
                    $syncToken = null;
                }
            }

            $usedFullSync = $fullResync || $syncToken === null;
            $listResult = $client->listEvents(
                $accountInput,
                (string) $state->external_calendar_id,
                $syncToken,
                $syncToken === null ? $timeMinIso : null,
                $syncToken === null ? $timeMaxIso : null,
            );

            if (! $listResult['ok'] && ($listResult['sync_token_expired'] ?? false)) {
                $usedFullSync = true;
                $listResult = $client->listEvents(
                    $accountInput,
                    (string) $state->external_calendar_id,
                    null,
                    $timeMinIso,
                    $timeMaxIso,
                );
            }

            if (! $listResult['ok']) {
                $plans[] = [
                    'state' => $state,
                    'failed' => true,
                    'error_code' => $listResult['error_code'] ?? 'GOOGLE_SYNC_FAILED',
                    'pushed' => [],
                    'deleted_links' => [],
                    'remote_events' => [],
                    'next_sync_token' => null,
                    'used_full_sync' => $usedFullSync,
                ];

                continue;
            }

            // Lecture des rendez-vous locaux de la ressource et liens existants hors transaction.
            $existingApptLinks = DB::table('external_links')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $state->integration_account_id)
                ->where('local_entity_type', 'appointments')
                ->where('external_entity_type', 'GOOGLE_CALENDAR_EVENT')
                ->get()
                ->keyBy('local_entity_id');

            $appointments = DB::table('appointments as a')
                ->leftJoin('appointment_services as s', static function ($join): void {
                    $join->on('s.clinic_id', '=', 'a.clinic_id')->on('s.id', '=', 'a.service_id');
                })
                ->where('a.clinic_id', $clinicId)
                ->where('a.resource_id', $state->resource_id)
                ->where(static function ($q) use ($windowStartStamp, $existingApptLinks): void {
                    $q->where('a.ends_at', '>=', $windowStartStamp);
                    $linkedIds = $existingApptLinks->keys()->all();
                    if ($linkedIds !== []) {
                        $q->orWhereIn('a.id', $linkedIds);
                    }
                })
                ->select('a.*', 's.name as service_name')
                ->orderBy('a.starts_at')
                ->get()
                ->all();

            $pushed = [];
            $deletedLinks = [];

            foreach ($appointments as $appt) {
                $apptId = (string) $appt->id;
                $existingLink = $existingApptLinks->get($apptId);
                $status = (string) $appt->status;

                if (in_array($status, ['CANCELLED', 'NO_SHOW'], true)) {
                    if ($existingLink !== null) {
                        $del = $client->deleteEvent(
                            $accountInput,
                            (string) $state->external_calendar_id,
                            (string) $existingLink->external_entity_id,
                        );
                        if ($del['ok']) {
                            $deletedLinks[] = (string) $existingLink->id;
                        }
                    }

                    continue;
                }

                $needsPush = $fullResync
                    || $existingLink === null
                    || (int) $existingLink->local_version !== (int) $appt->version;

                if (! $needsPush) {
                    continue;
                }

                $sanitized = $this->sanitizeAppointmentEvent($appt, (string) $clinic->timezone);
                $upsert = $client->upsertEvent(
                    $accountInput,
                    (string) $state->external_calendar_id,
                    $sanitized,
                    $existingLink !== null ? (string) $existingLink->external_entity_id : null,
                );

                $pushed[] = [
                    'appointment_id' => $apptId,
                    'version' => (int) $appt->version,
                    'starts_at' => SchedulingInput::iso((string) $appt->starts_at),
                    'ends_at' => SchedulingInput::iso((string) $appt->ends_at),
                    'ok' => $upsert['ok'],
                    'external_event_id' => $upsert['external_event_id'],
                    'etag' => $upsert['etag'],
                ];
            }

            $plans[] = [
                'state' => $state,
                'failed' => false,
                'error_code' => null,
                'pushed' => $pushed,
                'deleted_links' => $deletedLinks,
                'remote_events' => $listResult['events'],
                'next_sync_token' => $listResult['next_sync_token'] ?? null,
                'used_full_sync' => $usedFullSync,
            ];
        }

        // Validation atomique en base sous verrous ordonnés (`Clinic` 10 -> `Idempotency` -> `CalendarSyncState` 37).
        return $this->transactions->run(function () use ($context, $clinicId, $plans, $idempotencyKey, $rawPayload): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $idemId = null;
            if ($idempotencyKey !== null) {
                $hash = CanonicalJson::hash($rawPayload);
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, 'SyncGoogleCalendar', $idempotencyKey);
                if ($existingIdem !== null) {
                    if ((string) $existingIdem->payload_hash !== $hash) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    if ((string) $existingIdem->status === 'COMMITTED' && is_string($existingIdem->result_payload)) {
                        /** @var array<string, mixed> $decoded */
                        $decoded = json_decode($existingIdem->result_payload, true, 512, JSON_THROW_ON_ERROR);

                        return $decoded;
                    }
                    $this->idempotency->restart($context, (string) $existingIdem->id);
                    $idemId = (string) $existingIdem->id;
                } else {
                    $idemId = $this->idempotency->reserve($context, 'SyncGoogleCalendar', $idempotencyKey, $hash);
                }
            }

            $stamp = SchedulingInput::stamp($context->now->utc());
            $pushedCount = 0;
            $pulledBlocksCount = 0;
            $conflictsCount = 0;
            $updatedStates = [];

            foreach ($plans as $plan) {
                /** @var stdClass $stateRow */
                $stateRow = $plan['state'];
                $lockedState = $locks->calendarSyncState((string) $stateRow->id);
                if ($lockedState === null) {
                    continue;
                }

                if ((bool) $plan['failed']) {
                    $version = (int) $lockedState->version + 1;
                    DB::table('calendar_sync_states')
                        ->where('clinic_id', $clinicId)
                        ->where('id', $lockedState->id)
                        ->update([
                            'status' => 'ERROR',
                            'last_error_code' => is_string($plan['error_code']) ? mb_substr($plan['error_code'], 0, 100) : 'GOOGLE_SYNC_FAILED',
                            'version' => $version,
                            'updated_at' => $stamp,
                        ]);

                    $fresh = DB::table('calendar_sync_states')->where('clinic_id', $clinicId)->where('id', $lockedState->id)->first();
                    if ($fresh !== null) {
                        $updatedStates[] = self::presentState($fresh);
                    }

                    continue;
                }

                $accountId = (string) $lockedState->integration_account_id;
                $resId = (string) $lockedState->resource_id;
                $stateConflicts = 0;

                // 1. Suppression des liens de rendez-vous annulés / no-show supprimés côté Google.
                if ($plan['deleted_links'] !== []) {
                    DB::table('external_links')
                        ->where('clinic_id', $clinicId)
                        ->whereIn('id', $plan['deleted_links'])
                        ->delete();
                }

                // 2. Sauvegarde des liens de rendez-vous poussés vers Google.
                foreach ($plan['pushed'] as $item) {
                    if ($item['ok'] && is_string($item['external_event_id'])) {
                        $pushedCount++;
                        $this->upsertExternalLink(
                            clinicId: $clinicId,
                            accountId: $accountId,
                            localType: 'appointments',
                            localId: (string) $item['appointment_id'],
                            externalType: 'GOOGLE_CALENDAR_EVENT',
                            externalId: mb_substr((string) $item['external_event_id'], 0, 180),
                            etag: is_string($item['etag']) ? $item['etag'] : null,
                            localVersion: (int) $item['version'],
                            status: 'SYNCED',
                            stamp: $stamp,
                        );
                    } else {
                        $stateConflicts++;
                    }
                }

                // Rendez-vous locaux actifs pour détection des chevauchements avec les événements Google.
                $activeAppointments = DB::table('appointments')
                    ->where('clinic_id', $clinicId)
                    ->where('resource_id', $resId)
                    ->whereIn('status', ['PENDING_CONFIRMATION', 'CONFIRMED', 'ARRIVED'])
                    ->get()
                    ->all();

                // 3. Traitement des événements distants Google.
                foreach ($plan['remote_events'] as $event) {
                    $extId = mb_substr((string) $event['external_event_id'], 0, 180);

                    if ($event['is_clinic_mirror'] ?? false) {
                        // Vérifie si un événement miroir a été modifié ou annulé côté Google en divergence avec le local.
                        $mirrorApptId = $event['appointment_id'] ?? null;
                        if (is_string($mirrorApptId)) {
                            $localAppt = collect($activeAppointments)->firstWhere('id', $mirrorApptId);
                            if ($localAppt !== null) {
                                $diverged = $event['status'] === 'cancelled'
                                    || ($event['starts_at'] !== null && SchedulingInput::iso((string) $localAppt->starts_at) !== $event['starts_at'])
                                    || ($event['ends_at'] !== null && SchedulingInput::iso((string) $localAppt->ends_at) !== $event['ends_at']);

                                if ($diverged) {
                                    $stateConflicts++;
                                    DB::table('external_links')
                                        ->where('clinic_id', $clinicId)
                                        ->where('integration_account_id', $accountId)
                                        ->where('local_entity_type', 'appointments')
                                        ->where('local_entity_id', $mirrorApptId)
                                        ->update(['status' => 'CONFLICT', 'updated_at' => $stamp]);
                                }
                            }
                        }

                        continue;
                    }

                    $existingBlockLink = DB::table('external_links')
                        ->where('clinic_id', $clinicId)
                        ->where('integration_account_id', $accountId)
                        ->where('external_entity_type', 'GOOGLE_CALENDAR_EVENT')
                        ->where('external_entity_id', $extId)
                        ->first();

                    if (($event['status'] ?? 'confirmed') === 'cancelled') {
                        if ($existingBlockLink !== null) {
                            DB::table('calendar_blocks')
                                ->where('clinic_id', $clinicId)
                                ->where('external_link_id', $existingBlockLink->id)
                                ->delete();
                            DB::table('external_links')
                                ->where('clinic_id', $clinicId)
                                ->where('id', $existingBlockLink->id)
                                ->delete();
                        }

                        continue;
                    }

                    $startsIso = $event['starts_at'] ?? null;
                    $endsIso = $event['ends_at'] ?? null;
                    if (! is_string($startsIso) || ! is_string($endsIso)) {
                        continue;
                    }
                    $blockStart = CarbonImmutable::parse($startsIso, 'UTC')->utc();
                    $blockEnd = CarbonImmutable::parse($endsIso, 'UTC')->utc();
                    if (! $blockEnd->greaterThan($blockStart)) {
                        continue;
                    }
                    $blockStartStamp = SchedulingInput::stamp($blockStart);
                    $blockEndStamp = SchedulingInput::stamp($blockEnd);

                    $overlappingApptIds = [];
                    foreach ($activeAppointments as $appt) {
                        $apptStart = CarbonImmutable::parse((string) $appt->starts_at, 'UTC');
                        $apptEnd = CarbonImmutable::parse((string) $appt->ends_at, 'UTC');
                        if ($apptStart->lt($blockEnd) && $apptEnd->gt($blockStart)) {
                            $overlappingApptIds[] = (string) $appt->id;
                        }
                    }

                    $hasConflict = $overlappingApptIds !== [];
                    if ($hasConflict) {
                        $stateConflicts++;
                        DB::table('external_links')
                            ->where('clinic_id', $clinicId)
                            ->where('integration_account_id', $accountId)
                            ->where('local_entity_type', 'appointments')
                            ->whereIn('local_entity_id', $overlappingApptIds)
                            ->update(['status' => 'CONFLICT', 'updated_at' => $stamp]);
                    }

                    $blockId = $existingBlockLink !== null ? (string) $existingBlockLink->local_entity_id : Ulid::generate();
                    $linkId = $this->upsertExternalLink(
                        clinicId: $clinicId,
                        accountId: $accountId,
                        localType: 'calendar_blocks',
                        localId: $blockId,
                        externalType: 'GOOGLE_CALENDAR_EVENT',
                        externalId: $extId,
                        etag: is_string($event['etag']) ? $event['etag'] : null,
                        localVersion: 1,
                        status: $hasConflict ? 'CONFLICT' : 'SYNCED',
                        stamp: $stamp,
                    );

                    $labelRaw = trim((string) ($event['summary'] ?? ''));
                    $label = $labelRaw !== '' ? mb_substr($labelRaw, 0, 180) : 'Indisponibilité Google';

                    $existingBlock = DB::table('calendar_blocks')
                        ->where('clinic_id', $clinicId)
                        ->where('id', $blockId)
                        ->first();

                    if ($existingBlock !== null) {
                        DB::table('calendar_blocks')
                            ->where('clinic_id', $clinicId)
                            ->where('id', $blockId)
                            ->update([
                                'resource_id' => $resId,
                                'starts_at' => $blockStartStamp,
                                'ends_at' => $blockEndStamp,
                                'label' => $label,
                                'external_link_id' => $linkId,
                                'updated_at' => $stamp,
                            ]);
                    } else {
                        DB::table('calendar_blocks')->insert([
                            'id' => $blockId,
                            'clinic_id' => $clinicId,
                            'resource_id' => $resId,
                            'starts_at' => $blockStartStamp,
                            'ends_at' => $blockEndStamp,
                            'origin' => 'GOOGLE',
                            'label' => $label,
                            'external_link_id' => $linkId,
                            'created_by' => null,
                            'created_at' => $stamp,
                            'updated_at' => $stamp,
                        ]);
                    }

                    $pulledBlocksCount++;
                }

                // Détection globale d'éventuels liens restés en CONFLICT sur ce compte/ressource.
                if ($stateConflicts === 0) {
                    $existingConflicts = DB::table('external_links as el')
                        ->join('calendar_blocks as cb', static function ($join): void {
                            $join->on('cb.clinic_id', '=', 'el.clinic_id')->on('cb.external_link_id', '=', 'el.id');
                        })
                        ->where('el.clinic_id', $clinicId)
                        ->where('el.integration_account_id', $accountId)
                        ->where('cb.resource_id', $resId)
                        ->where('el.status', 'CONFLICT')
                        ->count();
                    $stateConflicts = $existingConflicts;
                }

                $conflictsCount += $stateConflicts;

                $tokenUpdate = [];
                if (is_string($plan['next_sync_token']) && $plan['next_sync_token'] !== '') {
                    $encrypted = $this->cipher->encrypt($plan['next_sync_token']);
                    $tokenUpdate['sync_token_ciphertext'] = $encrypted['ciphertext'];
                    $tokenUpdate['token_encryption_key_id'] = $encrypted['key_id'];
                }

                $newStatus = $stateConflicts > 0 ? 'STALE' : 'READY';
                $newVersion = (int) $lockedState->version + 1;

                DB::table('calendar_sync_states')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $lockedState->id)
                    ->update($tokenUpdate + [
                        'status' => $newStatus,
                        'last_error_code' => $stateConflicts > 0 ? 'CALENDAR_CONFLICT_DETECTED' : null,
                        'last_full_sync_at' => (bool) $plan['used_full_sync'] ? $stamp : $lockedState->last_full_sync_at,
                        'last_incremental_sync_at' => $stamp,
                        'version' => $newVersion,
                        'updated_at' => $stamp,
                    ]);

                $freshState = DB::table('calendar_sync_states')
                    ->where('clinic_id', $clinicId)
                    ->where('id', $lockedState->id)
                    ->first();
                assert($freshState !== null);
                $updatedStates[] = self::presentState($freshState);
            }

            $result = [
                'synced_states' => count($updatedStates),
                'pushed_appointments' => $pushedCount,
                'pulled_blocks' => $pulledBlocksCount,
                'conflicts' => $conflictsCount,
                'states' => $updatedStates,
            ];

            $this->audit->recordFor(
                $clinicId,
                $context->actorId,
                $context->actorName,
                'calendar_sync.completed',
                'calendar_sync_states',
                null,
                null,
                [
                    'synced_states' => $result['synced_states'],
                    'pushed_appointments' => $pushedCount,
                    'pulled_blocks' => $pulledBlocksCount,
                    'conflicts' => $conflictsCount,
                ],
                $context->correlationId,
            );

            if ($idemId !== null) {
                $this->idempotency->complete($context, $idemId, 'calendar_sync_states', null, $result);
            }

            return $result;
        });
    }

    /**
     * Format contractuel `CalendarSyncState` sans jamais exposer `sync_token_ciphertext` ni `token_encryption_key_id`.
     *
     * @return array<string, mixed>
     */
    public static function presentState(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'integration_account_id' => (string) $row->integration_account_id,
            'resource_id' => (string) $row->resource_id,
            'external_calendar_id' => (string) $row->external_calendar_id,
            'status' => (string) $row->status,
            'last_full_sync_at' => is_string($row->last_full_sync_at) ? SchedulingInput::iso($row->last_full_sync_at) : null,
            'last_incremental_sync_at' => is_string($row->last_incremental_sync_at) ? SchedulingInput::iso($row->last_incremental_sync_at) : null,
            'last_error_code' => is_string($row->last_error_code) ? $row->last_error_code : null,
            'push_expires_at' => is_string($row->push_expires_at) ? SchedulingInput::iso($row->push_expires_at) : null,
            'version' => (int) $row->version,
            'updated_at' => SchedulingInput::iso((string) $row->updated_at),
        ];
    }

    /**
     * Charge utile strictement assainie envoyée à Google Calendar : aucune donnée clinique ni identité patient.
     *
     * @return array{appointment_id: string, reference: string, summary: string, starts_at: string, ends_at: string, timezone: string}
     */
    private function sanitizeAppointmentEvent(stdClass $appointment, string $timezone): array
    {
        $id = (string) $appointment->id;
        $ref = 'RDV-'.substr($id, -8);
        $serviceLabel = is_string($appointment->service_name ?? null) && trim($appointment->service_name) !== ''
            ? trim($appointment->service_name)
            : 'Rendez-vous';

        return [
            'appointment_id' => $id,
            'reference' => $ref,
            'summary' => mb_substr($serviceLabel.' · '.$ref, 0, 180),
            'starts_at' => SchedulingInput::iso((string) $appointment->starts_at),
            'ends_at' => SchedulingInput::iso((string) $appointment->ends_at),
            'timezone' => $timezone,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     external_account_id: string,
     *     status: string,
     *     credentials: array<string, mixed>|null,
     *     public_configuration: array<string, mixed>|null
     * }
     */
    private function accountPayload(stdClass $account): array
    {
        $publicConfig = null;
        if (is_string($account->public_configuration) && $account->public_configuration !== '') {
            $decoded = json_decode($account->public_configuration, true);
            if (is_array($decoded)) {
                $publicConfig = $decoded;
            }
        }

        $credentials = null;
        if (is_string($account->credentials_ciphertext) && $account->credentials_ciphertext !== '') {
            $decodedCreds = json_decode($account->credentials_ciphertext, true);
            if (is_array($decodedCreds)) {
                $credentials = $decodedCreds;
            } else {
                try {
                    $decrypted = $this->cipher->decrypt($account->credentials_ciphertext);
                    $parsed = json_decode($decrypted, true);
                    if (is_array($parsed)) {
                        $credentials = $parsed;
                    }
                } catch (Throwable) {
                    $credentials = null;
                }
            }
        }

        return [
            'id' => (string) $account->id,
            'external_account_id' => (string) $account->external_account_id,
            'status' => (string) $account->status,
            'credentials' => $credentials,
            'public_configuration' => $publicConfig,
        ];
    }

    private function upsertExternalLink(
        string $clinicId,
        string $accountId,
        string $localType,
        string $localId,
        string $externalType,
        string $externalId,
        ?string $etag,
        int $localVersion,
        string $status,
        string $stamp,
    ): string {
        $existing = DB::table('external_links')
            ->where('clinic_id', $clinicId)
            ->where('integration_account_id', $accountId)
            ->where('local_entity_type', $localType)
            ->where('local_entity_id', $localId)
            ->where('external_entity_type', $externalType)
            ->first();

        if ($existing === null) {
            $existing = DB::table('external_links')
                ->where('clinic_id', $clinicId)
                ->where('integration_account_id', $accountId)
                ->where('external_entity_type', $externalType)
                ->where('external_entity_id', $externalId)
                ->first();
        }

        if ($existing !== null) {
            DB::table('external_links')
                ->where('clinic_id', $clinicId)
                ->where('id', $existing->id)
                ->update([
                    'external_entity_id' => $externalId,
                    'etag' => $etag,
                    'local_version' => $localVersion,
                    'last_synced_at' => $stamp,
                    'status' => $status,
                    'updated_at' => $stamp,
                ]);

            return (string) $existing->id;
        }

        $linkId = Ulid::generate();
        DB::table('external_links')->insert([
            'id' => $linkId,
            'clinic_id' => $clinicId,
            'integration_account_id' => $accountId,
            'local_entity_type' => $localType,
            'local_entity_id' => $localId,
            'external_entity_type' => $externalType,
            'external_entity_id' => $externalId,
            'etag' => $etag,
            'local_version' => $localVersion,
            'last_synced_at' => $stamp,
            'status' => $status,
            'created_at' => $stamp,
            'updated_at' => $stamp,
        ]);

        return $linkId;
    }
}

<?php

declare(strict_types=1);

namespace App\Domain\Communication;

use App\Application\Effects\IdempotencyStore;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Communication\Rules\CommunicationRules;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Support\Integrations\Messaging\DestinationCipher;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Registre immuable (append-only) des consentements et oppositions (opt-in / opt-out) par cabinet,
 * sujet (patient ou prospect), canal, finalité et empreinte chiffrée de destination.
 * Un retrait (`REVOKED`) prend effet immédiatement pour les envois transactionnels et campagnes.
 */
final class ConsentLedger
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly DestinationCipher $cipher,
        private readonly IdempotencyStore $idempotency,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public function recordGrant(CommandContext $context, array $payload, ?string $idempotencyKey = null): stdClass
    {
        return $this->appendEvent($context, 'GRANTED', 'RecordConsent', $payload, $idempotencyKey);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function recordRevoke(CommandContext $context, array $payload, ?string $idempotencyKey = null): stdClass
    {
        return $this->appendEvent($context, 'REVOKED', 'RevokeConsent', $payload, $idempotencyKey);
    }

    /**
     * Révocation immédiate par webhook fournisseur (mot-clé STOP) pour toutes les finalités actives
     * associées à ce couple (cabinet, canal, destination).
     */
    public function revokeAllForDestination(
        CommandContext $context,
        string $channel,
        string $rawDestination,
        string $proof,
        string $policyVersion = 'webhook-stop-v1',
    ): int {
        $normalized = CommunicationRules::normalizeDestination($channel, $rawDestination);
        $hash = $this->cipher->hash($normalized);

        return $this->transactions->run(function () use ($context, $channel, $normalized, $hash, $proof, $policyVersion): int {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $pairs = DB::table('communication_consents')
                ->select(['patient_id', 'prospect_contact_id', 'purpose'])
                ->where('clinic_id', $context->clinicId)
                ->where('channel', $channel)
                ->where('destination_hash', $hash)
                ->distinct()
                ->get();

            if ($pairs->isEmpty()) {
                return 0;
            }

            // Tri strict par rang puis identifiant croissant pour respecter TransactionLocks.
            $prospectIds = [];
            $patientIds = [];
            foreach ($pairs as $pair) {
                if ($pair->prospect_contact_id !== null) {
                    $prospectIds[(string) $pair->prospect_contact_id] = true;
                }
                if ($pair->patient_id !== null) {
                    $patientIds[(string) $pair->patient_id] = true;
                }
            }

            $sortedProspects = array_keys($prospectIds);
            sort($sortedProspects, SORT_STRING);
            foreach ($sortedProspects as $prospectId) {
                $locks->prospectContact($prospectId);
            }

            $sortedPatients = array_keys($patientIds);
            sort($sortedPatients, SORT_STRING);
            foreach ($sortedPatients as $patientId) {
                $locks->patient($patientId);
            }

            $revokedCount = 0;
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            $actorId = $this->resolveRecorderId($context);
            $encrypted = $this->cipher->encrypt($normalized);

            $latestIdsToLock = [];
            $pendingRevocations = [];

            foreach ($pairs as $pair) {
                $patientId = $pair->patient_id !== null ? (string) $pair->patient_id : null;
                $prospectId = $pair->prospect_contact_id !== null ? (string) $pair->prospect_contact_id : null;
                $purpose = (string) $pair->purpose;

                $latest = $this->queryLatestForHash($context->clinicId, $patientId, $prospectId, $channel, $purpose, $hash);
                if ($latest === null || (string) $latest->status === 'REVOKED') {
                    continue;
                }

                $latestIdsToLock[(string) $latest->id] = true;
                $pendingRevocations[] = [
                    'patient_id' => $patientId,
                    'prospect_contact_id' => $prospectId,
                    'purpose' => $purpose,
                    'next_sequence' => ((int) $latest->event_sequence) + 1,
                ];
            }

            $lockIds = array_keys($latestIdsToLock);
            sort($lockIds, SORT_STRING);
            foreach ($lockIds as $consentId) {
                $locks->communicationConsent($consentId);
            }

            foreach ($pendingRevocations as $entry) {
                $id = Ulid::generate();
                DB::table('communication_consents')->insert([
                    'id' => $id,
                    'clinic_id' => $context->clinicId,
                    'patient_id' => $entry['patient_id'],
                    'prospect_contact_id' => $entry['prospect_contact_id'],
                    'channel' => $channel,
                    'purpose' => $entry['purpose'],
                    'destination_hash' => $encrypted['hash'],
                    'destination_ciphertext' => $encrypted['ciphertext'],
                    'encryption_key_id' => $encrypted['key_id'],
                    'status' => 'REVOKED',
                    'recorded_at' => $nowDb,
                    'recorded_by' => $actorId,
                    'proof' => $proof,
                    'policy_version' => $policyVersion,
                    'event_sequence' => $entry['next_sequence'],
                    'created_at' => $nowDb,
                    'updated_at' => $nowDb,
                ]);

                $this->audit->record(
                    $context->clinicId,
                    $context->user,
                    'communication.consent.revoked_stop',
                    'communication_consents',
                    $id,
                    $proof,
                    [
                        'channel' => $channel,
                        'purpose' => $entry['purpose'],
                        'status' => 'REVOKED',
                        'event_sequence' => $entry['next_sequence'],
                    ],
                    $context->actorName,
                );
                $revokedCount++;
            }

            return $revokedCount;
        });
    }

    public function latestConsent(
        string $clinicId,
        ?string $patientId,
        ?string $prospectContactId,
        string $channel,
        string $purpose,
        string $rawOrNormalizedDestination,
    ): ?stdClass {
        $normalized = CommunicationRules::normalizeDestination($channel, $rawOrNormalizedDestination);
        $hash = $this->cipher->hash($normalized);

        return $this->queryLatestForHash($clinicId, $patientId, $prospectContactId, $channel, $purpose, $hash);
    }

    /**
     * Vérifie qu'il existe un consentement actif (`GRANTED`) non révoqué pour (sujet, canal, finalité, destination).
     *
     * @return array{consent: stdClass, destination: string, destination_hash: string, destination_ciphertext: string, encryption_key_id: string}
     */
    public function requireActiveGrant(
        string $clinicId,
        ?string $patientId,
        ?string $prospectContactId,
        string $channel,
        string $purpose,
        ?string $explicitRawDestination = null,
    ): array {
        $this->assertXorSubject($patientId, $prospectContactId);

        if ($explicitRawDestination !== null && trim($explicitRawDestination) !== '') {
            $normalized = CommunicationRules::normalizeDestination($channel, $explicitRawDestination);
            $hash = $this->cipher->hash($normalized);
            $latest = $this->queryLatestForHash($clinicId, $patientId, $prospectContactId, $channel, $purpose, $hash);
            if ($latest === null || (string) $latest->status !== 'GRANTED') {
                throw new BusinessError(
                    'STATE_TRANSITION_REFUSED',
                    'Envoi refusé : aucun consentement actif (GRANTED) pour ce canal et cette finalité.',
                    409,
                    [],
                    null,
                    [],
                    ['current_status' => $latest !== null ? (string) $latest->status : 'MISSING'],
                );
            }

            return [
                'consent' => $latest,
                'destination' => $normalized,
                'destination_hash' => (string) $latest->destination_hash,
                'destination_ciphertext' => (string) $latest->destination_ciphertext,
                'encryption_key_id' => (string) $latest->encryption_key_id,
            ];
        }

        // Recherche des destinations actuelles du dossier (téléphone patient/prospect, ou e-mail prospect).
        $candidates = $this->subjectDestinationsForChannel($clinicId, $patientId, $prospectContactId, $channel);
        if ($candidates !== []) {
            foreach ($candidates as $normalized) {
                $hash = $this->cipher->hash($normalized);
                $latest = $this->queryLatestForHash($clinicId, $patientId, $prospectContactId, $channel, $purpose, $hash);
                if ($latest === null) {
                    continue;
                }
                if ((string) $latest->status !== 'GRANTED') {
                    throw new BusinessError(
                        'STATE_TRANSITION_REFUSED',
                        'Envoi refusé : le consentement pour cette destination a été révoqué.',
                        409,
                        [],
                        null,
                        [],
                        ['current_status' => 'REVOKED'],
                    );
                }

                return [
                    'consent' => $latest,
                    'destination' => $normalized,
                    'destination_hash' => (string) $latest->destination_hash,
                    'destination_ciphertext' => (string) $latest->destination_ciphertext,
                    'encryption_key_id' => (string) $latest->encryption_key_id,
                ];
            }

            // Si le contact dispose déjà d'une destination actuelle pour ce canal sans consentement actif,
            // ne jamais retomber sur un consentement enregistré pour un ancien numéro (AT34).
            throw new BusinessError(
                'STATE_TRANSITION_REFUSED',
                'Envoi refusé : aucun consentement actif enregistré pour les coordonnées actuelles sur ce canal.',
                409,
                [],
                null,
                [],
                ['current_status' => 'MISSING'],
            );
        }

        // Uniquement si le dossier n'expose aucune coordonnée directe pour ce canal (ex. EMAIL sur patient_records),
        // on évalue les destinations enregistrées dans le registre de consentements.
        $rows = $this->subjectQuery($clinicId, $patientId, $prospectContactId)
            ->where('channel', $channel)
            ->where('purpose', $purpose)
            ->orderByDesc('event_sequence')
            ->orderByDesc('id')
            ->get();

        $latestByHash = [];
        foreach ($rows as $row) {
            $h = (string) $row->destination_hash;
            if (! isset($latestByHash[$h])) {
                $latestByHash[$h] = $row;
            }
        }

        $sawRevoked = false;
        foreach ($latestByHash as $latest) {
            if ((string) $latest->status === 'GRANTED') {
                return [
                    'consent' => $latest,
                    'destination' => $this->cipher->decrypt((string) $latest->destination_ciphertext),
                    'destination_hash' => (string) $latest->destination_hash,
                    'destination_ciphertext' => (string) $latest->destination_ciphertext,
                    'encryption_key_id' => (string) $latest->encryption_key_id,
                ];
            }
            $sawRevoked = true;
        }

        throw new BusinessError(
            'STATE_TRANSITION_REFUSED',
            $sawRevoked
                ? 'Envoi refusé : consentement révoqué pour ce sujet sur ce canal.'
                : 'Envoi refusé : aucun consentement actif enregistré pour ce sujet sur ce canal et cette finalité.',
            409,
            [],
            null,
            [],
            ['current_status' => $sawRevoked ? 'REVOKED' : 'MISSING'],
        );
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array{items: list<stdClass>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function list(string $clinicId, array $filters = []): array
    {
        $perPage = 25;
        $page = isset($filters['page']) && is_int($filters['page']) ? max(1, $filters['page']) : 1;

        $query = DB::table('communication_consents')
            ->where('clinic_id', $clinicId);

        if (is_string($filters['patient_id'] ?? null) && $filters['patient_id'] !== '') {
            $query->where('patient_id', $filters['patient_id']);
        }
        if (is_string($filters['prospect_contact_id'] ?? null) && $filters['prospect_contact_id'] !== '') {
            $query->where('prospect_contact_id', $filters['prospect_contact_id']);
        }
        if (is_string($filters['channel'] ?? null) && $filters['channel'] !== '') {
            $query->where('channel', $filters['channel']);
        }
        if (is_string($filters['purpose'] ?? null) && $filters['purpose'] !== '') {
            $query->where('purpose', $filters['purpose']);
        }
        if (is_string($filters['status'] ?? null) && $filters['status'] !== '') {
            $query->where('status', $filters['status']);
        }

        $total = (int) (clone $query)->count();
        $lastPage = max(1, intdiv($total + $perPage - 1, $perPage));
        $rows = $query
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->forPage($page, $perPage)
            ->get()
            ->all();

        foreach ($rows as $row) {
            $row->destination_masked = $this->cipher->maskCiphertext((string) $row->channel, (string) $row->destination_ciphertext);
        }

        return [
            'items' => array_values($rows),
            'meta' => [
                'current_page' => $page,
                'last_page' => $lastPage,
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    /**
     * Événement de consentement par son identifiant, destination masquée : ce que la route rend après une écriture (le
     * résultat rejoué par le chemin central ne porte que la référence, jamais la destination chiffrée).
     */
    public function getEvent(string $clinicId, string $eventId): stdClass
    {
        $row = DB::table('communication_consents')
            ->where('clinic_id', $clinicId)
            ->where('id', $eventId)
            ->first();
        if (! $row instanceof stdClass) {
            throw BusinessError::notFound();
        }

        return $this->maskConsentRow($row);
    }

    public function maskConsentRow(stdClass $row): stdClass
    {
        if (! isset($row->destination_masked)) {
            $row->destination_masked = $this->cipher->maskCiphertext((string) $row->channel, (string) $row->destination_ciphertext);
        }

        return $row;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function appendEvent(
        CommandContext $context,
        string $status,
        string $commandName,
        array $payload,
        ?string $idempotencyKey,
    ): stdClass {
        $patientId = is_string($payload['patient_id'] ?? null) && $payload['patient_id'] !== '' ? $payload['patient_id'] : null;
        $prospectId = is_string($payload['prospect_contact_id'] ?? null) && $payload['prospect_contact_id'] !== '' ? $payload['prospect_contact_id'] : null;
        $this->assertXorSubject($patientId, $prospectId);

        $channel = (string) ($payload['channel'] ?? '');
        $purpose = (string) ($payload['purpose'] ?? '');
        if (! in_array($channel, CommunicationRules::CONSENT_CHANNELS, true)) {
            throw BusinessError::validation(['channel' => ['Canal de consentement invalide.']]);
        }
        if (! in_array($purpose, CommunicationRules::CONSENT_PURPOSES, true)) {
            throw BusinessError::validation(['purpose' => ['Finalité de consentement invalide.']]);
        }

        $normalizedDestination = CommunicationRules::normalizeDestination($channel, (string) ($payload['destination'] ?? ''));
        $proof = trim((string) ($payload['proof'] ?? ''));
        if (mb_strlen($proof) < 2) {
            throw BusinessError::validation(['proof' => ['La preuve du consentement ou de la révocation est obligatoire.']]);
        }
        $policyVersion = trim((string) ($payload['policy_version'] ?? 'v1'));
        if ($policyVersion === '') {
            $policyVersion = 'v1';
        }

        $encrypted = $this->cipher->encrypt($normalizedDestination);
        $fingerprint = hash('sha256', (string) json_encode([
            'status' => $status,
            'patient_id' => $patientId,
            'prospect_contact_id' => $prospectId,
            'channel' => $channel,
            'purpose' => $purpose,
            'destination_hash' => $encrypted['hash'],
            'proof' => $proof,
            'policy_version' => $policyVersion,
        ], JSON_THROW_ON_ERROR));

        $cleanIdempotencyKey = $idempotencyKey !== null ? strtoupper(trim($idempotencyKey)) : null;

        return $this->transactions->joinOrRun(function () use (
            $context,
            $status,
            $commandName,
            $patientId,
            $prospectId,
            $channel,
            $purpose,
            $encrypted,
            $proof,
            $policyVersion,
            $fingerprint,
            $cleanIdempotencyKey,
        ): stdClass {
            $locks = new TransactionLocks($context->clinicId);
            $locks->clinic();

            $reservation = null;
            if ($cleanIdempotencyKey !== null) {
                $existingIdem = $locks->idempotency($context->idempotencyNamespace, $commandName, $cleanIdempotencyKey);
                if ($existingIdem !== null && $existingIdem->status === 'COMMITTED') {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $existingRow = DB::table('communication_consents')
                        ->where('clinic_id', $context->clinicId)
                        ->where('id', (string) $existingIdem->result_id)
                        ->first();
                    if ($existingRow instanceof stdClass) {
                        return $this->maskConsentRow($existingRow);
                    }
                }
                if ($existingIdem !== null) {
                    if (! hash_equals((string) $existingIdem->payload_hash, $fingerprint)) {
                        throw BusinessError::idempotencyMismatch();
                    }
                    $reservation = (string) $existingIdem->id;
                    $this->idempotency->restart($context, $reservation);
                } else {
                    $reservation = $this->idempotency->reserve($context, $commandName, $cleanIdempotencyKey, $fingerprint);
                }
            }

            if ($prospectId !== null) {
                if ($locks->prospectContact($prospectId) === null) {
                    throw BusinessError::notFound();
                }
            } elseif ($patientId !== null) {
                if ($locks->patient($patientId) === null) {
                    throw BusinessError::notFound();
                }
            }

            $latest = $this->queryLatestForHash($context->clinicId, $patientId, $prospectId, $channel, $purpose, $encrypted['hash']);
            if ($latest !== null) {
                $locks->communicationConsent((string) $latest->id);
            }
            $nextSequence = $latest !== null ? ((int) $latest->event_sequence) + 1 : 1;

            $id = Ulid::generate();
            $nowDb = $context->now->format('Y-m-d H:i:s.u');
            $recorderId = $this->resolveRecorderId($context);

            DB::table('communication_consents')->insert([
                'id' => $id,
                'clinic_id' => $context->clinicId,
                'patient_id' => $patientId,
                'prospect_contact_id' => $prospectId,
                'channel' => $channel,
                'purpose' => $purpose,
                'destination_hash' => $encrypted['hash'],
                'destination_ciphertext' => $encrypted['ciphertext'],
                'encryption_key_id' => $encrypted['key_id'],
                'status' => $status,
                'recorded_at' => $nowDb,
                'recorded_by' => $recorderId,
                'proof' => $proof,
                'policy_version' => $policyVersion,
                'event_sequence' => $nextSequence,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);

            $this->audit->record(
                $context->clinicId,
                $context->user,
                $status === 'GRANTED' ? 'communication.consent.granted' : 'communication.consent.revoked',
                'communication_consents',
                $id,
                $proof,
                [
                    'channel' => $channel,
                    'purpose' => $purpose,
                    'status' => $status,
                    'event_sequence' => $nextSequence,
                    'policy_version' => $policyVersion,
                ],
                $context->actorName,
            );

            if ($reservation !== null) {
                $this->idempotency->complete($context, $reservation, 'communication_consents', $id, ['id' => $id]);
            }

            $created = DB::table('communication_consents')
                ->where('clinic_id', $context->clinicId)
                ->where('id', $id)
                ->first();
            if (! $created instanceof stdClass) {
                throw BusinessError::notFound();
            }

            return $this->maskConsentRow($created);
        });
    }

    private function assertXorSubject(?string $patientId, ?string $prospectId): void
    {
        $count = ($patientId !== null ? 1 : 0) + ($prospectId !== null ? 1 : 0);
        if ($count !== 1) {
            throw BusinessError::validation([
                'patient_id' => ['Indiquez exactement un sujet : patient_id ou prospect_contact_id.'],
            ]);
        }
    }

    private function queryLatestForHash(
        string $clinicId,
        ?string $patientId,
        ?string $prospectContactId,
        string $channel,
        string $purpose,
        string $destinationHash,
    ): ?stdClass {
        return $this->subjectQuery($clinicId, $patientId, $prospectContactId)
            ->where('channel', $channel)
            ->where('purpose', $purpose)
            ->where('destination_hash', $destinationHash)
            ->orderByDesc('event_sequence')
            ->first();
    }

    private function subjectQuery(string $clinicId, ?string $patientId, ?string $prospectContactId): Builder
    {
        $query = DB::table('communication_consents')->where('clinic_id', $clinicId);
        if ($patientId !== null) {
            $query->where('patient_id', $patientId)->whereNull('prospect_contact_id');
        } else {
            $query->where('prospect_contact_id', $prospectContactId)->whereNull('patient_id');
        }

        return $query;
    }

    /**
     * @return list<string>
     */
    private function subjectDestinationsForChannel(
        string $clinicId,
        ?string $patientId,
        ?string $prospectContactId,
        string $channel,
    ): array {
        $rawCandidates = [];
        if ($patientId !== null && $channel !== 'EMAIL') {
            $patient = DB::table('patient_records')
                ->where('clinic_id', $clinicId)
                ->where('id', $patientId)
                ->first(['phone_primary_normalized', 'phone_primary', 'phone_secondary_normalized', 'phone_secondary']);
            if ($patient instanceof stdClass) {
                foreach (['phone_primary_normalized', 'phone_primary', 'phone_secondary_normalized', 'phone_secondary'] as $col) {
                    $val = $patient->{$col} ?? null;
                    if (is_string($val) && trim($val) !== '') {
                        $rawCandidates[] = $val;
                    }
                }
            }
        } elseif ($prospectContactId !== null) {
            $prospect = DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('id', $prospectContactId)
                ->first(['phone_normalized', 'phone', 'email']);
            if ($prospect instanceof stdClass) {
                if ($channel === 'EMAIL') {
                    if (is_string($prospect->email ?? null) && trim($prospect->email) !== '') {
                        $rawCandidates[] = $prospect->email;
                    }
                } else {
                    foreach (['phone_normalized', 'phone'] as $col) {
                        $val = $prospect->{$col} ?? null;
                        if (is_string($val) && trim($val) !== '') {
                            $rawCandidates[] = $val;
                        }
                    }
                }
            }
        }

        $normalized = [];
        $seen = [];
        foreach ($rawCandidates as $raw) {
            try {
                $norm = CommunicationRules::normalizeDestination($channel, $raw);
                if (! isset($seen[$norm])) {
                    $seen[$norm] = true;
                    $normalized[] = $norm;
                }
            } catch (BusinessError) {
                // Ignore un numéro hérité malformé.
            }
        }

        return $normalized;
    }

    private function resolveRecorderId(CommandContext $context): string
    {
        if ($context->actorId !== null && $context->actorId !== '') {
            return $context->actorId;
        }

        $fallback = DB::table('users')
            ->where('clinic_id', $context->clinicId)
            ->orderBy('id')
            ->value('id');
        if (is_string($fallback) && $fallback !== '') {
            return $fallback;
        }

        throw BusinessError::forbidden('Aucun compte acteur disponible pour enregistrer le consentement.');
    }
}

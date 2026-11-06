<?php

namespace App\Offline;

use App\Application\Command;
use App\Application\CommandBus;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\AuditWriter;
use App\Application\Effects\SyncOrderViolation;
use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\SyncReferences;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Application ORDONNÉE de l'inbox d'un poste (O05 ; contrat 23, « Push, ACK et résolution ») : à partir du préfixe
 * finalisé (`enrolled_devices.last_accepted_sequence`), chaque commande reçue est appliquée par le MÊME chemin central
 * que la route directe (`CommandBus`, source SYNC, clé d'idempotence = `command_id`), chacune dans SA transaction.
 *
 *  - appliquée : l'ACK `ACCEPTED` et le préfixe avancent dans la transaction de l'effet (`SyncAcknowledgements`) ;
 *  - module de la commande fermé par le déploiement (M01, `SyncCommandModules`) : conflit durable `MODULE_NOT_ENABLED`,
 *    rien n'est appliqué, la commande reste dans l'inbox et se rejoue (ACCEPT_LOCAL) une fois le module ouvert ;
 *  - pièce liée absente : `WAITING_DEPENDENCY` (dépendances conservées), reprise au prochain envoi, dans l'ordre ;
 *  - refus métier ou d'autorisation historique : conflit durable `OPEN` (instantanés chiffrés, aucun écrasement) et
 *    `CONFLICT_REQUIRES_REVIEW` ; seule une décision de la gérante (`ResolveConflict`) le finalise ;
 *  - serveur occupé, ou commande déjà prise par un envoi concurrent du même poste : arrêt sans conflit ni ACK fictif.
 *
 * L'application s'arrête au PREMIER non finalisé : les commandes reçues ensuite restent `RECEIVED` et ne sautent
 * jamais la séquence. Un rejet décidé (`REJECTED`) finalise le rang et laisse reprendre N+1 (préfixe finalisé ≠ « tout
 * payé »). Aucun effet externe ici : les écritures passent par `TransactionRunner` et le chemin central.
 */
final class SyncDrain
{
    /** Garde-fou d'un appel : la suite continue au prochain envoi ou à la prochaine résolution. */
    public const MAX_PER_CALL = 500;

    private const FINAL = ['ACCEPTED', 'REJECTED'];

    public function __construct(
        private readonly CommandBus $bus,
        private readonly TransactionRunner $transactions,
        private readonly AuditWriter $audit,
    ) {}

    public function drain(string $clinicId, string $deviceId, string $correlationId): void
    {
        for ($step = 0; $step < self::MAX_PER_CALL; $step++) {
            $device = DB::table('enrolled_devices')->where('clinic_id', $clinicId)->where('id', $deviceId)->first();
            if ($device === null) {
                return;
            }
            $command = DB::table('sync_commands')
                ->where('clinic_id', $clinicId)
                ->where('device_id', $deviceId)
                ->where('device_sequence', ((int) $device->last_accepted_sequence) + 1)
                ->first();
            if ($command === null) {
                return;
            }
            $status = DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('command_id', $command->id)->value('status');
            $status = is_string($status) ? $status : 'RECEIVED';

            if (in_array($status, self::FINAL, true)) {
                // Rang déjà finalisé (rejet décidé) : le préfixe le rattrape, puis la suite reprend.
                if (! $this->advancePrefix($clinicId, $deviceId)) {
                    return;
                }

                continue;
            }
            if ($status === 'CONFLICT_REQUIRES_REVIEW') {
                return;
            }
            if (! $this->apply($command, $correlationId)) {
                return;
            }
        }
    }

    /**
     * Ancien poste REMPLACÉ qui réapparaît (O07 ; fiche : « Ancien poste réapparu passe en revue ») : chacune de ses
     * commandes reçues et non finalisées, dans l'ordre du journal, ouvre un conflit durable `DEVICE_REPLACED`
     * (instantanés chiffrés, aucun effet métier). Seule la gérante décide (`ResolveSyncConflict`) : rejouer
     * (ACCEPT_LOCAL, jugée alors par le chemin central, numéros d'une plage close refusés) ou écarter.
     *
     * @param  list<string>  $commandIds
     */
    public function holdForReview(string $clinicId, string $deviceId, array $commandIds, string $correlationId): void
    {
        if ($commandIds === []) {
            return;
        }
        $commands = DB::table('sync_commands')->where('clinic_id', $clinicId)->where('device_id', $deviceId)
            ->whereIn('id', $commandIds)->orderBy('device_sequence')->get();
        foreach ($commands as $command) {
            $status = DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('command_id', $command->id)->value('status');
            if (in_array($status, [...self::FINAL, 'CONFLICT_REQUIRES_REVIEW'], true)) {
                continue;
            }
            $opened = SyncPayloads::openCommand((string) $command->payload_ciphertext);
            $this->conflict(
                $command,
                new BusinessError('DEVICE_REPLACED', 'Commande d\'un poste remplacé, reçue après son remplacement : décision de la gérante requise.', 409),
                $opened['payload'],
                $correlationId,
            );
        }
    }

    /**
     * Avance le préfixe finalisé sur les rangs consécutifs déjà ACCEPTED ou REJECTED. Vrai si au moins un rang a avancé.
     */
    public function advancePrefix(string $clinicId, string $deviceId): bool
    {
        return $this->transactions->run(function () use ($clinicId, $deviceId): bool {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $device = $locks->device($deviceId);
            if ($device === null) {
                return false;
            }

            return self::advanceUnderLock($clinicId, $deviceId, $device, CarbonImmutable::now('UTC'));
        });
    }

    /**
     * Même avance, sous le verrou exclusif du cabinet déjà tenu par l'appelant (résolution d'un conflit).
     */
    public static function advanceUnderLock(string $clinicId, string $deviceId, stdClass $device, CarbonImmutable $now): bool
    {
        $sequence = (int) $device->last_accepted_sequence;
        $hash = $device->last_accepted_hash === null ? null : (string) $device->last_accepted_hash;
        $moved = false;
        while (true) {
            $next = DB::table('sync_commands')->where('clinic_id', $clinicId)->where('device_id', $deviceId)->where('device_sequence', $sequence + 1)->first();
            if ($next === null) {
                break;
            }
            $status = DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('command_id', $next->id)->value('status');
            if (! in_array($status, self::FINAL, true)) {
                break;
            }
            $sequence++;
            $hash = (string) $next->event_hash;
            $moved = true;
        }
        if ($moved) {
            $stamp = $now->utc()->format('Y-m-d H:i:s.u');
            DB::table('enrolled_devices')->where('clinic_id', $clinicId)->where('id', $deviceId)->update([
                'last_accepted_sequence' => $sequence,
                'last_accepted_hash' => $hash,
                'last_sync_at' => $stamp,
                'updated_at' => $stamp,
            ]);
        }

        return $moved;
    }

    /**
     * Vrai si le dernier conflit de la commande a été résolu ACCEPT_LOCAL (revue de la gérante, motif conservé).
     */
    public static function reviewApproved(string $clinicId, string $commandId): bool
    {
        $last = DB::table('sync_conflicts')
            ->where('clinic_id', $clinicId)
            ->where('command_id', $commandId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first();
        if ($last === null || (string) $last->status !== 'RESOLVED' || ! is_string($last->resolution)) {
            return false;
        }
        $resolution = json_decode($last->resolution, true);

        return is_array($resolution) && ($resolution['decision'] ?? null) === 'ACCEPT_LOCAL';
    }

    /**
     * Vrai si la commande est appliquée (ACK ACCEPTED dans la transaction de l'effet) ; faux si l'application s'arrête.
     */
    private function apply(stdClass $command, string $correlationId): bool
    {
        $clinicId = (string) $command->clinic_id;
        $opened = SyncPayloads::openCommand((string) $command->payload_ciphertext);
        $payload = $opened['payload'];

        // Module fermé par le déploiement (M01) : même refus que la route directe, mais durable et visible. Jugé AVANT
        // les dépendances et tout effet ; la commande reste dans l'inbox et se rejoue une fois le module ouvert.
        if (! SyncCommandModules::isOpen((string) $command->command_name)) {
            $this->conflict($command, new BusinessError('MODULE_NOT_ENABLED', SyncCommandModules::closedMessage((string) $command->command_name), 409), $payload, $correlationId);

            return false;
        }

        $dependencies = SyncDependencies::check($clinicId, (string) $command->command_name, (string) $command->entity_type, (string) $command->entity_id, $payload);
        if ($dependencies['rejected'] !== []) {
            $this->conflict($command, new BusinessError('DEPENDENCY_REJECTED', 'Une pièce dont dépend cette commande a été rejetée après revue : décision de la gérante requise.', 409), $payload, $correlationId);

            return false;
        }
        if ($dependencies['missing'] !== []) {
            $this->waiting($command, $dependencies['missing']);

            return false;
        }

        $grant = DB::table('offline_grants')->where('clinic_id', $clinicId)->where('id', $command->grant_id)->first();
        $actorName = DB::table('users')->where('clinic_id', $clinicId)->where('id', $command->actor_id)->value('display_name');
        if ($grant === null || ! is_string($actorName)) {
            $this->conflict($command, new BusinessError('GRANT_EXPIRED_OR_REVOKED', 'Autorisation ou auteur de la commande inconnus de ce cabinet.', 403), $payload, $correlationId);

            return false;
        }

        $context = CommandContext::sync(
            $clinicId,
            (string) $command->device_id,
            (string) $command->actor_id,
            $actorName,
            DeviceDirectory::grantSnapshot($grant),
            $correlationId,
            self::instant($command->occurred_at_local),
            self::instant($command->last_server_time),
            self::instant($command->received_at),
            references: new SyncReferences(
                commandId: (string) $command->id,
                deviceSequence: (int) $command->device_sequence,
                eventHash: (string) $command->event_hash,
                previousEventHash: $command->previous_event_hash === null ? null : (string) $command->previous_event_hash,
                numberAllocationId: $command->number_allocation_id === null ? null : (string) $command->number_allocation_id,
                stockAllocationIds: $opened['stock_allocation_ids'],
                reviewApproved: self::reviewApproved($clinicId, (string) $command->id),
            ),
        );
        $expected = $command->expected_version === null ? null : (int) $command->expected_version;

        try {
            $this->bus->dispatch(new Command((string) $command->command_name, $payload, (string) $command->entity_id, $expected), $context, (string) $command->id);
        } catch (SyncOrderViolation) {
            // Un envoi concurrent du même poste l'a précédée : rien n'a été écrit, la reprise suit l'ordre.
            return false;
        } catch (BusinessError $refusal) {
            if ($refusal->errorCode === 'SERVER_BUSY') {
                return false;
            }
            $this->conflict($command, $refusal, $payload, $correlationId);

            return false;
        }

        return true;
    }

    /**
     * @param  list<array{entity_type: string, entity_id: string}>  $dependencies
     */
    private function waiting(stdClass $command, array $dependencies): void
    {
        $clinicId = (string) $command->clinic_id;
        $deviceId = (string) $command->device_id;
        $this->transactions->run(function () use ($clinicId, $deviceId, $command, $dependencies): void {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $locks->device($deviceId);
            $result = DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('command_id', $command->id)->first();
            if ($result === null || in_array((string) $result->status, [...self::FINAL, 'CONFLICT_REQUIRES_REVIEW'], true)) {
                return;
            }
            $references = [];
            foreach ($dependencies as $dependency) {
                $key = $dependency['entity_type'];
                for ($rank = 2; isset($references[$key]); $rank++) {
                    $key = $dependency['entity_type'].':'.$rank;
                }
                $references[$key] = $dependency['entity_id'];
            }
            $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
            DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('id', $result->id)->update([
                'status' => 'WAITING_DEPENDENCY',
                'result_references' => json_encode((object) $references, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'error_code' => null,
                'processed_at' => $now,
                'attempt_count' => ((int) $result->attempt_count) + 1,
                'updated_at' => $now,
            ]);
        });
    }

    /**
     * Conflit durable : la commande d'origine et son contexte (instantané local) et l'état central avec le refus
     * (instantané central) sont conservés CHIFFRÉS ; rien du central n'est écrasé ; l'audit trace l'ouverture.
     *
     * @param  array<string, mixed>  $payload
     */
    private function conflict(stdClass $command, BusinessError $refusal, array $payload, string $correlationId): void
    {
        $clinicId = (string) $command->clinic_id;
        $deviceId = (string) $command->device_id;
        $this->transactions->run(function () use ($clinicId, $deviceId, $command, $refusal, $payload, $correlationId): void {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $locks->device($deviceId);
            $result = DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('command_id', $command->id)->first();
            if ($result === null || in_array((string) $result->status, [...self::FINAL, 'CONFLICT_REQUIRES_REVIEW'], true)) {
                return;
            }
            if (DB::table('sync_conflicts')->where('clinic_id', $clinicId)->where('command_id', $command->id)->where('status', 'OPEN')->exists()) {
                return;
            }

            $at = CarbonImmutable::now('UTC');
            $now = $at->format('Y-m-d H:i:s.u');
            $conflictId = Ulid::generate();
            $code = mb_substr($refusal->errorCode, 0, 100);
            DB::table('sync_conflicts')->insert([
                'id' => $conflictId,
                'clinic_id' => $clinicId,
                'command_id' => (string) $command->id,
                'conflict_type' => $code,
                'local_snapshot_ciphertext' => SyncPayloads::sealSnapshot([
                    'command' => [
                        'command_id' => (string) $command->id,
                        'command_name' => (string) $command->command_name,
                        'device_id' => $deviceId,
                        'device_sequence' => (string) $command->device_sequence,
                        'actor_id' => (string) $command->actor_id,
                        'grant_id' => (string) $command->grant_id,
                        'occurred_at_local' => SignedCommands::format(self::instant($command->occurred_at_local)),
                        'entity_type' => (string) $command->entity_type,
                        'entity_id' => (string) $command->entity_id,
                        'expected_version' => $command->expected_version === null ? null : (int) $command->expected_version,
                        'number_allocation_id' => $command->number_allocation_id,
                    ],
                    'payload' => $payload,
                ]),
                'central_snapshot_ciphertext' => SyncPayloads::sealSnapshot([
                    'error' => [
                        'code' => $refusal->errorCode,
                        'message' => mb_substr($refusal->getMessage(), 0, 1000),
                        'fields' => $refusal->fields,
                        'details' => $refusal->details,
                    ],
                    'entity' => PullProjections::snapshot($clinicId, (string) $command->entity_type, (string) $command->entity_id),
                ]),
                'encryption_key_id' => SyncPayloads::keyId(),
                'status' => 'OPEN',
                'resolution' => null,
                'resolved_by' => null,
                'resolved_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('sync_command_results')->where('clinic_id', $clinicId)->where('id', $result->id)->update([
                'status' => 'CONFLICT_REQUIRES_REVIEW',
                'error_code' => $code,
                'processed_at' => $now,
                'attempt_count' => ((int) $result->attempt_count) + 1,
                'updated_at' => $now,
            ]);
            $this->audit->write(CommandContext::job($clinicId, 'synchronisation', $correlationId, $at), [
                new AuditEntry('sync.conflict_opened', 'sync_conflicts', $conflictId, null, [
                    'command_id' => (string) $command->id,
                    'command_name' => (string) $command->command_name,
                    'device_id' => $deviceId,
                    'device_sequence' => (string) $command->device_sequence,
                    'conflict_type' => $code,
                ]),
            ]);
        });
    }

    private static function instant(mixed $stored): CarbonImmutable
    {
        return CarbonImmutable::parse((string) $stored, 'UTC');
    }
}

<?php

namespace App\Domain\Operations;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\Ulid;
use App\Models\User;
use App\Support\Integrations\IntegrationCrypto;
use App\Support\Integrations\IntegrationHttpClient;
use App\Support\Integrations\IntegrationMode;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use JsonException;
use stdClass;
use Throwable;

/**
 * Gestion CRUD et sonde des comptes d'intégration clinique.
 * Applique le verrouillage hiérarchique TransactionLocks::integrationAccount,
 * le verrouillage optimiste (version), le chiffrement secretbox des identifiants
 * et la journalisation d'audit sans jamais exposer aucun secret.
 */
final class IntegrationAccounts
{
    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly IntegrationCrypto $crypto,
        private readonly IntegrationMode $mode,
        private readonly IntegrationHttpClient $httpClient,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @return list<stdClass>
     */
    public function list(string $clinicId): array
    {
        /** @var list<stdClass> $rows */
        $rows = DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->orderBy('provider')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->all();

        return $rows;
    }

    public function find(string $clinicId, string $accountId): ?stdClass
    {
        return DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->where('id', $accountId)
            ->first();
    }

    public function require(string $clinicId, string $accountId): stdClass
    {
        $row = $this->find($clinicId, $accountId);
        if ($row === null) {
            throw BusinessError::notFound('Compte d’intégration introuvable.');
        }

        return $row;
    }

    public function findActiveForProvider(
        string $clinicId,
        string $provider,
        ?string $externalAccountId = null,
    ): ?stdClass {
        if ($this->mode->isDisabled()) {
            return null;
        }

        $normalizedProvider = strtoupper(trim($provider));
        $query = DB::table('integration_accounts')
            ->where('clinic_id', $clinicId)
            ->where('provider', $normalizedProvider)
            ->whereIn('status', IntegrationMode::OPERATIONAL_STATUSES);

        if ($externalAccountId !== null && trim($externalAccountId) !== '') {
            $query->where('external_account_id', trim($externalAccountId));
        }

        return $query
            ->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END")
            ->orderBy('id')
            ->first();
    }

    /**
     * @param  list<string>  $providers
     * @return list<stdClass>
     */
    public function findOperationalForProviders(?string $clinicId, array $providers): array
    {
        if ($providers === []) {
            return [];
        }

        $query = DB::table('integration_accounts')
            ->whereIn('provider', $providers)
            ->whereIn('status', IntegrationMode::OPERATIONAL_STATUSES);

        if ($clinicId !== null && $clinicId !== '') {
            $query->where('clinic_id', $clinicId);
        }

        /** @var list<stdClass> $rows */
        $rows = $query
            ->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END")
            ->orderBy('id')
            ->get()
            ->all();

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $input
     */
    public function create(string $clinicId, User $actor, array $input): stdClass
    {
        $this->assertAllowedKeys($input, [
            'provider',
            'external_account_id',
            'display_name',
            'status',
            'credentials',
            'public_configuration',
        ]);

        $provider = $this->validateEnum(
            $input['provider'] ?? null,
            IntegrationMode::ALL_PROVIDERS,
            'provider',
        );
        $externalAccountId = $this->validateNonEmptyString(
            $input['external_account_id'] ?? null,
            'external_account_id',
            191,
        );
        $displayName = $this->validateNonEmptyString(
            $input['display_name'] ?? null,
            'display_name',
            191,
        );
        $status = $this->validateEnum(
            $input['status'] ?? null,
            ['DISABLED', 'TEST', 'ACTIVE', 'ERROR'],
            'status',
        );
        $credentials = $this->validateOptionalObject($input['credentials'] ?? null, 'credentials');
        $publicConfiguration = $this->validateOptionalObject(
            $input['public_configuration'] ?? null,
            'public_configuration',
        );

        $encrypted = $credentials !== null ? $this->crypto->encryptJson($credentials) : null;
        $publicConfigJson = $this->encodeOptionalJsonObject($publicConfiguration);
        $actorId = $this->resolveActorIdForClinic($clinicId, $actor);

        /** @var stdClass */
        return $this->transactions->joinOrRun(function () use (
            $clinicId,
            $actor,
            $actorId,
            $provider,
            $externalAccountId,
            $displayName,
            $status,
            $encrypted,
            $publicConfigJson,
        ): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $duplicate = DB::table('integration_accounts')
                ->where('clinic_id', $clinicId)
                ->where('provider', $provider)
                ->where('external_account_id', $externalAccountId)
                ->exists();

            if ($duplicate) {
                throw BusinessError::validation([
                    'external_account_id' => ['Un compte d’intégration existe déjà pour ce fournisseur et cet identifiant externe.'],
                ]);
            }

            $id = Ulid::generate();
            $now = $this->nowUtcDb();

            DB::table('integration_accounts')->insert([
                'id' => $id,
                'clinic_id' => $clinicId,
                'provider' => $provider,
                'external_account_id' => $externalAccountId,
                'display_name' => $displayName,
                'credentials_ciphertext' => $encrypted['ciphertext'] ?? null,
                'encryption_key_id' => $encrypted['key_id'] ?? null,
                'token_expires_at' => null,
                'status' => $status,
                'public_configuration' => $publicConfigJson,
                'configured_by' => $actorId,
                'version' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $this->audit->record(
                $clinicId,
                $actor,
                'INTEGRATION_ACCOUNT_CREATED',
                'integration_account',
                $id,
                sanitizedDiff: [
                    'provider' => $provider,
                    'external_account_id' => $externalAccountId,
                    'display_name' => $displayName,
                    'status' => $status,
                    'has_credentials' => $encrypted !== null,
                    'encryption_key_id' => $encrypted['key_id'] ?? null,
                ],
            );

            return $this->require($clinicId, $id);
        });
    }

    /**
     * @param  array<string, mixed>  $input
     */
    public function update(string $clinicId, User $actor, string $accountId, array $input): stdClass
    {
        $this->assertAllowedKeys($input, [
            'expected_version',
            'display_name',
            'status',
            'credentials',
            'public_configuration',
        ]);

        $expectedVersion = $this->validatePositiveInt($input['expected_version'] ?? null, 'expected_version');

        $hasDisplayName = array_key_exists('display_name', $input);
        $hasStatus = array_key_exists('status', $input);
        $hasCredentials = array_key_exists('credentials', $input);
        $hasPublicConfig = array_key_exists('public_configuration', $input);

        $displayName = $hasDisplayName
            ? $this->validateNonEmptyString($input['display_name'], 'display_name', 191)
            : null;
        $status = $hasStatus
            ? $this->validateEnum($input['status'], ['DISABLED', 'TEST', 'ACTIVE', 'ERROR'], 'status')
            : null;
        $credentials = $hasCredentials
            ? $this->validateOptionalObject($input['credentials'], 'credentials')
            : null;
        $publicConfig = $hasPublicConfig
            ? $this->validateOptionalObject($input['public_configuration'], 'public_configuration')
            : null;

        $encrypted = null;
        if ($hasCredentials && $credentials !== null) {
            $encrypted = $this->crypto->encryptJson($credentials);
        }

        $actorId = $this->resolveActorIdForClinic($clinicId, $actor);

        /** @var stdClass */
        return $this->transactions->joinOrRun(function () use (
            $clinicId,
            $actor,
            $actorId,
            $accountId,
            $expectedVersion,
            $hasDisplayName,
            $displayName,
            $hasStatus,
            $status,
            $hasCredentials,
            $encrypted,
            $hasPublicConfig,
            $publicConfig,
        ): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $current = $locks->integrationAccount($accountId);

            if ($current === null) {
                throw BusinessError::notFound('Compte d’intégration introuvable.');
            }

            if ((int) $current->version !== $expectedVersion) {
                throw BusinessError::versionConflict();
            }

            $updates = [
                'configured_by' => $actorId,
                'version' => (int) $current->version + 1,
                'updated_at' => $this->nowUtcDb(),
            ];
            $diff = [];

            if ($hasDisplayName && $displayName !== null) {
                $updates['display_name'] = $displayName;
                $diff['display_name'] = ['from' => $current->display_name, 'to' => $displayName];
            }

            if ($hasStatus && $status !== null) {
                $updates['status'] = $status;
                $diff['status'] = ['from' => $current->status, 'to' => $status];
            }

            if ($hasCredentials) {
                $updates['credentials_ciphertext'] = $encrypted['ciphertext'] ?? null;
                $updates['encryption_key_id'] = $encrypted['key_id'] ?? null;
                $diff['credentials_rotated'] = true;
                $diff['has_credentials'] = $encrypted !== null;
                $diff['encryption_key_id'] = $encrypted['key_id'] ?? null;
            }

            if ($hasPublicConfig) {
                $updates['public_configuration'] = $this->encodeOptionalJsonObject($publicConfig);
                $diff['public_configuration_updated'] = true;
            }

            DB::table('integration_accounts')
                ->where('clinic_id', $clinicId)
                ->where('id', $accountId)
                ->update($updates);

            $this->audit->record(
                $clinicId,
                $actor,
                'INTEGRATION_ACCOUNT_UPDATED',
                'integration_account',
                $accountId,
                sanitizedDiff: $diff,
            );

            return $this->require($clinicId, $accountId);
        });
    }

    /**
     * @return array{
     *     account_id: string,
     *     provider: string,
     *     reachable: bool,
     *     mode: string,
     *     status: string,
     *     checked_at: string,
     *     detail: ?string
     * }
     */
    public function testConnection(string $clinicId, User $actor, string $accountId): array
    {
        $this->mode->assertEnabled();
        $account = $this->require($clinicId, $accountId);

        $credentials = [];
        $decryptError = null;
        if (is_string($account->credentials_ciphertext) && $account->credentials_ciphertext !== '') {
            try {
                $credentials = $this->crypto->decryptJson($account->credentials_ciphertext);
            } catch (Throwable $exception) {
                $decryptError = 'Impossible de déchiffrer les identifiants du compte : '.$exception->getMessage();
            }
        }

        $publicConfig = $this->decodePublicConfiguration($account->public_configuration ?? null);
        $modeValue = $this->mode->isLive() ? IntegrationMode::MODE_LIVE : IntegrationMode::MODE_FAKE;

        if ($decryptError !== null) {
            $probe = ['reachable' => false, 'detail' => $decryptError];
        } else {
            $probe = $this->httpClient->probeProvider(
                (string) $account->provider,
                (string) $account->status,
                $credentials,
                $publicConfig,
            );
        }

        $checkedAt = CarbonImmutable::now('UTC')->format('Y-m-d\TH:i:s.v\Z');

        $this->transactions->run(function () use ($clinicId, $actor, $account, $modeValue, $probe): void {
            $this->audit->record(
                $clinicId,
                $actor,
                'INTEGRATION_ACCOUNT_TESTED',
                'integration_account',
                (string) $account->id,
                sanitizedDiff: [
                    'provider' => (string) $account->provider,
                    'mode' => $modeValue,
                    'reachable' => $probe['reachable'],
                ],
            );
        });

        return [
            'account_id' => (string) $account->id,
            'provider' => (string) $account->provider,
            'reachable' => $probe['reachable'],
            'mode' => $modeValue,
            'status' => (string) $account->status,
            'checked_at' => $checkedAt,
            'detail' => $probe['detail'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function decryptCredentials(stdClass $accountRow): array
    {
        $ciphertext = $accountRow->credentials_ciphertext ?? null;
        if (! is_string($ciphertext) || $ciphertext === '') {
            return [];
        }

        return $this->crypto->decryptJson($ciphertext);
    }

    /**
     * @param  array<string, mixed>  $input
     * @param  list<string>  $allowed
     */
    private function assertAllowedKeys(array $input, array $allowed): void
    {
        $unexpected = array_diff(array_keys($input), $allowed);
        if ($unexpected !== []) {
            $fields = [];
            foreach ($unexpected as $key) {
                $fields[(string) $key] = ['Propriété non autorisée.'];
            }

            throw BusinessError::validation($fields);
        }
    }

    /**
     * @param  list<string>  $allowed
     */
    private function validateEnum(mixed $value, array $allowed, string $field): string
    {
        if (! is_string($value)) {
            throw BusinessError::validation([$field => ['Valeur invalide.']]);
        }

        $normalized = strtoupper(trim($value));
        if (! in_array($normalized, $allowed, true)) {
            throw BusinessError::validation([$field => ['Valeur hors référentiel autorisé.']]);
        }

        return $normalized;
    }

    private function validateNonEmptyString(mixed $value, string $field, int $maxLength): string
    {
        if (! is_string($value)) {
            throw BusinessError::validation([$field => ['Chaîne requise.']]);
        }

        $trimmed = trim($value);
        if ($trimmed === '' || mb_strlen($trimmed, 'UTF-8') > $maxLength) {
            throw BusinessError::validation([$field => ['Longueur invalide.']]);
        }

        return $trimmed;
    }

    private function validatePositiveInt(mixed $value, string $field): int
    {
        if (! is_int($value) || $value < 1) {
            throw BusinessError::validation([$field => ['Entier positif requis.']]);
        }

        return $value;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function validateOptionalObject(mixed $value, string $field): ?array
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof stdClass) {
            /** @var array<string, mixed> $cast */
            $cast = (array) $value;

            return $cast;
        }

        if (! is_array($value) || ($value !== [] && array_is_list($value))) {
            throw BusinessError::validation([$field => ['Objet JSON attendu.']]);
        }

        /** @var array<string, mixed> $value */
        return $value;
    }

    /**
     * @param  array<string, mixed>|null  $object
     */
    private function encodeOptionalJsonObject(?array $object): ?string
    {
        if ($object === null) {
            return null;
        }

        try {
            return json_encode($object === [] ? (object) [] : $object, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        } catch (JsonException $exception) {
            throw BusinessError::validation(['public_configuration' => ['Objet JSON invalide.']]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function decodePublicConfiguration(mixed $raw): array
    {
        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }

        if (! is_array($decoded)) {
            return [];
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    private function resolveActorIdForClinic(string $clinicId, User $actor): string
    {
        $existsInClinic = DB::table('users')
            ->where('clinic_id', $clinicId)
            ->where('id', $actor->id)
            ->exists();

        if (! $existsInClinic) {
            throw BusinessError::notFound('Utilisateur rattaché introuvable pour cette clinique.');
        }

        return (string) $actor->id;
    }

    private function nowUtcDb(): string
    {
        return CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
    }
}

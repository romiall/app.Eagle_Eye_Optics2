<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Prospects administratifs (L2D03) : création, recherche, mise à jour avec verrou optimiste et rattachement
 * explicite à un dossier patient du même cabinet (jamais de fusion automatique, jamais de fuite clinique).
 */
final class ProspectContacts
{
    public const PER_PAGE = 25;

    /** @var list<string> */
    public const ORIGINS = ['CRM', 'WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'MANUAL'];

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @return array{rows: list<stdClass>, page: LengthAwarePaginator<int, stdClass>}
     */
    public function page(string $clinicId, mixed $query = null, mixed $page = null): array
    {
        $pageNumber = self::parsePage($page);

        $builder = DB::table('prospect_contacts')->where('clinic_id', $clinicId);

        if ($query !== null && $query !== '') {
            if (! is_string($query) || ! mb_check_encoding($query, 'UTF-8')) {
                throw BusinessError::validation(['query' => ['La recherche est invalide.']]);
            }
            $trimmed = Text::trim($query);
            if ($trimmed !== '') {
                if (mb_strlen($trimmed, 'UTF-8') > 100) {
                    throw BusinessError::validation(['query' => ['La recherche dépasse 100 caractères.']]);
                }
                $like = '%'.self::escapeLike(mb_strtolower($trimmed, 'UTF-8')).'%';
                $digits = (string) preg_replace('/[^0-9]/', '', $trimmed);

                $builder->where(static function ($group) use ($like, $digits): void {
                    $group->whereRaw('LOWER(name) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(email, \'\')) LIKE ?', [$like]);
                    if ($digits !== '') {
                        $group->orWhere('phone_normalized', 'like', '%'.self::escapeLike($digits).'%');
                    }
                });
            }
        }

        $paginator = $builder
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);

        /** @var list<stdClass> $rows */
        $rows = array_values($paginator->items());

        return ['rows' => $rows, 'page' => $paginator];
    }

    public function find(string $clinicId, string $prospectId): ?stdClass
    {
        if (! Ulid::isValid($prospectId)) {
            return null;
        }

        return DB::table('prospect_contacts')
            ->where('clinic_id', $clinicId)
            ->where('id', $prospectId)
            ->first();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function create(string $clinicId, ?User $actor, array $payload): stdClass
    {
        $errors = [];
        $name = self::requiredText($payload['name'] ?? null, 180, 'name', $errors);
        $phoneRaw = array_key_exists('phone', $payload) ? $payload['phone'] : null;
        [$phone, $phoneNormalized] = self::optionalPhone($phoneRaw, $errors);
        $email = self::optionalEmail($payload['email'] ?? null, $errors);
        $origin = self::requiredOrigin($payload['origin'] ?? null, $errors);
        $notes = self::optionalText($payload['administrative_notes'] ?? null, 4000, 'administrative_notes', $errors);

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert($name !== null && $origin !== null);

        $id = Ulid::generate();
        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->joinOrRun(function () use (
            $clinicId,
            $actor,
            $id,
            $name,
            $phone,
            $phoneNormalized,
            $email,
            $origin,
            $notes,
            $now,
        ): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            DB::table('prospect_contacts')->insert([
                'id' => $id,
                'clinic_id' => $clinicId,
                'name' => $name,
                'phone' => $phone,
                'phone_normalized' => $phoneNormalized,
                'email' => $email,
                'patient_id' => null,
                'origin' => $origin,
                'administrative_notes' => $notes,
                'created_by' => $actor?->getKey(),
                'version' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $this->audit->record($clinicId, $actor, 'prospect.created', 'prospect_contacts', $id, null, [
                'origin' => $origin,
            ]);

            $row = DB::table('prospect_contacts')->where('clinic_id', $clinicId)->where('id', $id)->first();
            assert($row instanceof stdClass);

            return $row;
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function update(string $clinicId, ?User $actor, string $prospectId, array $payload): stdClass
    {
        if (! Ulid::isValid($prospectId)) {
            throw BusinessError::notFound();
        }

        $errors = [];
        $expectedVersion = $payload['expected_version'] ?? null;
        if (! is_int($expectedVersion) || $expectedVersion < 1) {
            $errors['expected_version'][] = 'La version attendue (entier >= 1) est obligatoire.';
        }

        $hasName = array_key_exists('name', $payload);
        $name = $hasName ? self::requiredText($payload['name'], 180, 'name', $errors) : null;

        $hasPhone = array_key_exists('phone', $payload);
        [$phone, $phoneNormalized] = $hasPhone ? self::optionalPhone($payload['phone'], $errors) : [null, null];

        $hasEmail = array_key_exists('email', $payload);
        $email = $hasEmail ? self::optionalEmail($payload['email'], $errors) : null;

        $hasNotes = array_key_exists('administrative_notes', $payload);
        $notes = $hasNotes ? self::optionalText($payload['administrative_notes'], 4000, 'administrative_notes', $errors) : null;

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert(is_int($expectedVersion));

        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->joinOrRun(function () use (
            $clinicId,
            $actor,
            $prospectId,
            $expectedVersion,
            $hasName,
            $name,
            $hasPhone,
            $phone,
            $phoneNormalized,
            $hasEmail,
            $email,
            $hasNotes,
            $notes,
            $now,
        ): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $row = $locks->prospectContact($prospectId);
            if ($row === null) {
                throw BusinessError::notFound();
            }
            if ((int) $row->version !== $expectedVersion) {
                throw BusinessError::versionConflict();
            }

            $updates = [
                'version' => (int) $row->version + 1,
                'updated_at' => $now,
            ];
            if ($hasName && $name !== null) {
                $updates['name'] = $name;
            }
            if ($hasPhone) {
                $updates['phone'] = $phone;
                $updates['phone_normalized'] = $phoneNormalized;
            }
            if ($hasEmail) {
                $updates['email'] = $email;
            }
            if ($hasNotes) {
                $updates['administrative_notes'] = $notes;
            }

            DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('id', $prospectId)
                ->update($updates);

            $this->audit->record($clinicId, $actor, 'prospect.updated', 'prospect_contacts', $prospectId, null, [
                'fields' => array_values(array_diff(array_keys($updates), ['version', 'updated_at'])),
            ]);

            $updated = DB::table('prospect_contacts')->where('clinic_id', $clinicId)->where('id', $prospectId)->first();
            assert($updated instanceof stdClass);

            return $updated;
        });
    }

    /**
     * Rattachement explicite d'un prospect à un dossier patient du même cabinet (jamais automatique,
     * jamais de copie clinique vers le prospect ou le CRM).
     */
    public function linkToPatient(string $clinicId, ?User $actor, string $prospectId, string $patientId): stdClass
    {
        if (! Ulid::isValid($prospectId)) {
            throw BusinessError::notFound();
        }
        if (! Ulid::isValid($patientId)) {
            throw BusinessError::validation(['patient_id' => ['Identifiant patient invalide (ULID attendu).']]);
        }

        $now = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->joinOrRun(function () use ($clinicId, $actor, $prospectId, $patientId, $now): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $prospect = $locks->prospectContact($prospectId);
            if ($prospect === null) {
                throw BusinessError::notFound();
            }

            $patient = $locks->patient($patientId);
            if ($patient === null) {
                throw BusinessError::notFound('Dossier patient introuvable dans ce cabinet.');
            }
            if ($patient->archived_at !== null || $patient->merged_into_patient_id !== null) {
                throw BusinessError::stateRefused(
                    'Ce dossier patient est archivé ou fusionné : sélectionnez le dossier actif.',
                    'INACTIVE_PATIENT',
                );
            }

            if ($prospect->patient_id !== null) {
                if ((string) $prospect->patient_id === $patientId) {
                    return $prospect;
                }

                throw BusinessError::stateRefused(
                    'Ce prospect est déjà rattaché à un autre dossier patient.',
                    'ALREADY_LINKED',
                );
            }

            DB::table('prospect_contacts')
                ->where('clinic_id', $clinicId)
                ->where('id', $prospectId)
                ->update([
                    'patient_id' => $patientId,
                    'version' => (int) $prospect->version + 1,
                    'updated_at' => $now,
                ]);

            $this->audit->record($clinicId, $actor, 'prospect.linked_patient', 'prospect_contacts', $prospectId, null, [
                'patient_id' => $patientId,
            ]);

            $updated = DB::table('prospect_contacts')->where('clinic_id', $clinicId)->where('id', $prospectId)->first();
            assert($updated instanceof stdClass);

            return $updated;
        });
    }

    public static function parsePage(mixed $page): int
    {
        if ($page === null || $page === '') {
            return 1;
        }
        if ((! is_string($page) && ! is_int($page)) || filter_var($page, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100000]]) === false) {
            throw BusinessError::validation(['page' => ['La page doit être un entier positif.']]);
        }

        return (int) $page;
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function requiredText(mixed $value, int $maxLength, string $field, array &$errors): ?string
    {
        if (! is_string($value)) {
            $errors[$field][] = 'Ce champ est obligatoire.';

            return null;
        }
        try {
            $trimmed = Text::optional($value, $maxLength, $field);
        } catch (RuleViolation $violation) {
            $errors[$field][] = $violation->getMessage();

            return null;
        }
        if ($trimmed === null) {
            $errors[$field][] = 'Ce champ est obligatoire.';

            return null;
        }

        return $trimmed;
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function optionalText(mixed $value, int $maxLength, string $field, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            $errors[$field][] = 'Une chaîne de caractères est attendue.';

            return null;
        }
        try {
            return Text::optional($value, $maxLength, $field);
        } catch (RuleViolation $violation) {
            $errors[$field][] = $violation->getMessage();

            return null;
        }
    }

    /**
     * @param  array<string, list<string>>  $errors
     * @return array{0: ?string, 1: ?string}
     */
    private static function optionalPhone(mixed $value, array &$errors): array
    {
        if ($value === null) {
            return [null, null];
        }
        if (! is_string($value)) {
            $errors['phone'][] = 'Numéro de téléphone invalide.';

            return [null, null];
        }
        try {
            $raw = Text::optional($value, 32, 'phone');
            if ($raw === null) {
                return [null, null];
            }
            $normalized = Text::phone($raw, 'phone');

            return [$raw, $normalized];
        } catch (RuleViolation $violation) {
            $errors['phone'][] = $violation->getMessage();

            return [null, null];
        }
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function optionalEmail(mixed $value, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            $errors['email'][] = 'Adresse électronique invalide.';

            return null;
        }
        try {
            $trimmed = Text::optional($value, 254, 'email');
        } catch (RuleViolation $violation) {
            $errors['email'][] = $violation->getMessage();

            return null;
        }
        if ($trimmed !== null && filter_var($trimmed, FILTER_VALIDATE_EMAIL) === false) {
            $errors['email'][] = 'Adresse électronique invalide.';

            return null;
        }

        return $trimmed;
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function requiredOrigin(mixed $value, array &$errors): ?string
    {
        if (! is_string($value) || ! in_array($value, self::ORIGINS, true)) {
            $errors['origin'][] = 'L\'origine doit valoir CRM, WEBSITE, WHATSAPP, MESSENGER, INSTAGRAM ou MANUAL.';

            return null;
        }

        return $value;
    }

    private static function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}

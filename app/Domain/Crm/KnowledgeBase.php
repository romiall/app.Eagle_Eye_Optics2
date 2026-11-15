<?php

namespace App\Domain\Crm;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Access\EffectivePermissions;
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
 * Base de connaissances gouvernée (L2D04) : brouillons, révisions, approbation gérante (`approved_by` /
 * `approved_at`) et publication unique par fiche grâce à la colonne générée `active_entry_key`
 * (contrainte SQL unique `(clinic_id, active_entry_key)` — jamais renseignée dans les requêtes SQL).
 */
final class KnowledgeBase
{
    public const PER_PAGE = 25;

    /** @var list<string> */
    public const CATEGORIES = ['HOURS', 'LOCATION', 'PRICING', 'INSURANCE', 'SERVICES', 'LENSES', 'PRODUCTS', 'OTHER'];

    public function __construct(
        private readonly TransactionRunner $transactions,
        private readonly AuditRecorder $audit,
        private readonly EffectivePermissions $permissions,
    ) {}

    /**
     * @return array{
     *     entries: list<array{entry: stdClass, published_version: ?stdClass, versions: list<stdClass>}>,
     *     page: LengthAwarePaginator<int, stdClass>,
     * }
     */
    public function page(string $clinicId, mixed $category = null, mixed $page = null): array
    {
        $pageNumber = ProspectContacts::parsePage($page);

        $builder = DB::table('knowledge_entries')->where('clinic_id', $clinicId);
        if ($category !== null && $category !== '') {
            if (! is_string($category) || ! in_array($category, self::CATEGORIES, true)) {
                throw BusinessError::validation(['category' => ['Catégorie de fiche invalide.']]);
            }
            $builder->where('category', $category);
        }

        $paginator = $builder
            ->orderBy('category')
            ->orderBy('code')
            ->orderBy('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $pageNumber);

        /** @var list<stdClass> $entryRows */
        $entryRows = array_values($paginator->items());

        return [
            'entries' => $this->hydrateEntries($clinicId, $entryRows),
            'page' => $paginator,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{entry: stdClass, published_version: ?stdClass, versions: list<stdClass>}
     */
    public function createEntry(string $clinicId, User $actor, array $payload): array
    {
        $errors = [];
        $code = self::requiredText($payload['code'] ?? null, 100, 'code', $errors);
        $title = self::requiredText($payload['title'] ?? null, 180, 'title', $errors);
        $category = $payload['category'] ?? null;
        if (! is_string($category) || ! in_array($category, self::CATEGORIES, true)) {
            $errors['category'][] = 'Catégorie invalide.';
        }
        $content = self::requiredText($payload['content'] ?? null, 10000, 'content', $errors);
        $language = self::language($payload['language'] ?? 'fr', $errors);

        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert($code !== null && $title !== null && is_string($category) && $content !== null);

        $entryId = Ulid::generate();
        $versionId = Ulid::generate();
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->run(function () use (
            $clinicId,
            $actor,
            $entryId,
            $versionId,
            $code,
            $title,
            $category,
            $content,
            $language,
            $nowSql,
        ): array {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $duplicate = DB::table('knowledge_entries')
                ->where('clinic_id', $clinicId)
                ->where('code', $code)
                ->exists();
            if ($duplicate) {
                throw new BusinessError('KNOWLEDGE_CODE_EXISTS', 'Une fiche de connaissance utilise déjà ce code dans ce cabinet.', 409);
            }

            DB::table('knowledge_entries')->insert([
                'id' => $entryId,
                'clinic_id' => $clinicId,
                'code' => $code,
                'title' => $title,
                'category' => $category,
                'active' => true,
                'version' => 1,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            // NOTE SQL : ne jamais mentionner `active_entry_key` (colonne générée MySQL).
            DB::table('knowledge_entry_versions')->insert([
                'id' => $versionId,
                'clinic_id' => $clinicId,
                'entry_id' => $entryId,
                'revision_no' => 1,
                'content' => $content,
                'language' => $language,
                'authored_by' => (string) $actor->getKey(),
                'approved_by' => null,
                'approved_at' => null,
                'published_at' => null,
                'retired_at' => null,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            $this->audit->record($clinicId, $actor, 'knowledge.entry_created', 'knowledge_entries', $entryId, null, [
                'code' => $code,
                'category' => $category,
                'version_id' => $versionId,
            ]);

            $entry = DB::table('knowledge_entries')->where('clinic_id', $clinicId)->where('id', $entryId)->first();
            $version = DB::table('knowledge_entry_versions')->where('clinic_id', $clinicId)->where('id', $versionId)->first();
            assert($entry instanceof stdClass && $version instanceof stdClass);

            return [
                'entry' => $entry,
                'published_version' => null,
                'versions' => [$version],
            ];
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function addVersion(string $clinicId, User $actor, string $entryId, array $payload): stdClass
    {
        if (! Ulid::isValid($entryId)) {
            throw BusinessError::notFound();
        }

        $errors = [];
        $content = self::requiredText($payload['content'] ?? null, 10000, 'content', $errors);
        $language = self::language($payload['language'] ?? 'fr', $errors);
        if ($errors !== []) {
            throw BusinessError::validation($errors);
        }
        assert($content !== null);

        $versionId = Ulid::generate();
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->run(function () use ($clinicId, $actor, $entryId, $versionId, $content, $language, $nowSql): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();
            $entry = $locks->knowledgeEntry($entryId);
            if ($entry === null) {
                throw BusinessError::notFound();
            }

            $maxRevision = (int) (DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('entry_id', $entryId)
                ->max('revision_no') ?? 0);
            $nextRevision = $maxRevision + 1;

            DB::table('knowledge_entry_versions')->insert([
                'id' => $versionId,
                'clinic_id' => $clinicId,
                'entry_id' => $entryId,
                'revision_no' => $nextRevision,
                'content' => $content,
                'language' => $language,
                'authored_by' => (string) $actor->getKey(),
                'approved_by' => null,
                'approved_at' => null,
                'published_at' => null,
                'retired_at' => null,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);

            DB::table('knowledge_entries')
                ->where('clinic_id', $clinicId)
                ->where('id', $entryId)
                ->update([
                    'version' => (int) $entry->version + 1,
                    'updated_at' => $nowSql,
                ]);

            $this->audit->record($clinicId, $actor, 'knowledge.version_created', 'knowledge_entry_versions', $versionId, null, [
                'entry_id' => $entryId,
                'revision_no' => $nextRevision,
            ]);

            $version = DB::table('knowledge_entry_versions')->where('clinic_id', $clinicId)->where('id', $versionId)->first();
            assert($version instanceof stdClass);

            return $version;
        });
    }

    public function approveVersion(string $clinicId, User $actor, string $versionId, ?string $reason = null): stdClass
    {
        if (! Ulid::isValid($versionId)) {
            throw BusinessError::notFound();
        }
        if (! $this->permissions->has($actor, 'knowledge.manage')) {
            throw BusinessError::forbidden('Seule la gérante ou un compte détenteur de knowledge.manage peut approuver une révision.');
        }

        $cleanReason = self::cleanReason($reason);
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->run(function () use ($clinicId, $actor, $versionId, $cleanReason, $nowSql): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $target = DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->first();
            if ($target === null) {
                throw BusinessError::notFound();
            }

            $entry = $locks->knowledgeEntry((string) $target->entry_id);
            if ($entry === null) {
                throw BusinessError::notFound();
            }

            $version = DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->lockForUpdate()
                ->first();
            if ($version === null) {
                throw BusinessError::notFound();
            }

            if ($version->retired_at !== null) {
                throw BusinessError::stateRefused('Une révision retirée ne peut plus être approuvée.', 'RETIRED');
            }
            if ($version->approved_at !== null) {
                throw BusinessError::stateRefused('Cette révision est déjà approuvée.', 'APPROVED');
            }

            DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->update([
                    'approved_by' => (string) $actor->getKey(),
                    'approved_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);

            $this->audit->record($clinicId, $actor, 'knowledge.version_approved', 'knowledge_entry_versions', $versionId, $cleanReason, [
                'entry_id' => (string) $version->entry_id,
                'revision_no' => (int) $version->revision_no,
            ]);

            $updated = DB::table('knowledge_entry_versions')->where('clinic_id', $clinicId)->where('id', $versionId)->first();
            assert($updated instanceof stdClass);

            return $updated;
        });
    }

    /**
     * Publie une révision approuvée. Retire d'abord toute version déjà publiée de la même fiche afin que
     * la colonne générée `active_entry_key` ne conserve qu'une unique ligne active par `(clinic_id, entry_id)`.
     */
    public function publishVersion(string $clinicId, User $actor, string $versionId, ?string $reason = null): stdClass
    {
        if (! Ulid::isValid($versionId)) {
            throw BusinessError::notFound();
        }

        $cleanReason = self::cleanReason($reason);
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        return $this->transactions->run(function () use ($clinicId, $actor, $versionId, $cleanReason, $nowSql): stdClass {
            $locks = new TransactionLocks($clinicId);
            $locks->clinic();

            $target = DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->first();
            if ($target === null) {
                throw BusinessError::notFound();
            }

            $entryId = (string) $target->entry_id;
            $entry = $locks->knowledgeEntry($entryId);
            if ($entry === null) {
                throw BusinessError::notFound();
            }

            $version = DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->lockForUpdate()
                ->first();
            if ($version === null) {
                throw BusinessError::notFound();
            }

            if ($version->retired_at !== null) {
                throw BusinessError::stateRefused('Une révision retirée ne peut plus être publiée.', 'RETIRED');
            }
            if ($version->approved_by === null || $version->approved_at === null) {
                throw BusinessError::stateRefused('Une révision doit être approuvée avant sa publication.', 'DRAFT');
            }
            if ($version->published_at !== null) {
                throw BusinessError::stateRefused('Cette révision est déjà publiée.', 'PUBLISHED');
            }

            // Retirer en premier l'éventuelle version active : active_entry_key passe à NULL sur l'ancienne
            // avant que la nouvelle n'obtienne published_at (respect de la contrainte unique générée).
            DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('entry_id', $entryId)
                ->whereNotNull('published_at')
                ->whereNull('retired_at')
                ->update([
                    'retired_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);

            DB::table('knowledge_entry_versions')
                ->where('clinic_id', $clinicId)
                ->where('id', $versionId)
                ->update([
                    'published_at' => $nowSql,
                    'updated_at' => $nowSql,
                ]);

            DB::table('knowledge_entries')
                ->where('clinic_id', $clinicId)
                ->where('id', $entryId)
                ->update([
                    'version' => (int) $entry->version + 1,
                    'updated_at' => $nowSql,
                ]);

            $this->audit->record($clinicId, $actor, 'knowledge.version_published', 'knowledge_entry_versions', $versionId, $cleanReason, [
                'entry_id' => $entryId,
                'revision_no' => (int) $version->revision_no,
            ]);

            $updated = DB::table('knowledge_entry_versions')->where('clinic_id', $clinicId)->where('id', $versionId)->first();
            assert($updated instanceof stdClass);

            return $updated;
        });
    }

    /**
     * @param  list<stdClass>  $entries
     * @return list<array{entry: stdClass, published_version: ?stdClass, versions: list<stdClass>}>
     */
    private function hydrateEntries(string $clinicId, array $entries): array
    {
        if ($entries === []) {
            return [];
        }

        $ids = array_map(static fn (stdClass $entry): string => (string) $entry->id, $entries);
        $versionRows = DB::table('knowledge_entry_versions')
            ->where('clinic_id', $clinicId)
            ->whereIn('entry_id', $ids)
            ->orderByDesc('revision_no')
            ->orderByDesc('id')
            ->get();

        $byEntry = [];
        foreach ($versionRows as $ver) {
            $byEntry[(string) $ver->entry_id][] = $ver;
        }

        $out = [];
        foreach ($entries as $entry) {
            $versions = $byEntry[(string) $entry->id] ?? [];
            $published = null;
            foreach ($versions as $ver) {
                if ($ver->published_at !== null && $ver->retired_at === null) {
                    $published = $ver;
                    break;
                }
            }
            $out[] = [
                'entry' => $entry,
                'published_version' => $published,
                'versions' => $versions,
            ];
        }

        return $out;
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
    private static function language(mixed $value, array &$errors): string
    {
        if ($value === null) {
            return 'fr';
        }
        if (! is_string($value)) {
            $errors['language'][] = 'Code langue invalide.';

            return 'fr';
        }
        try {
            return Text::optional($value, 10, 'language') ?? 'fr';
        } catch (RuleViolation $violation) {
            $errors['language'][] = $violation->getMessage();

            return 'fr';
        }
    }

    private static function cleanReason(?string $reason): ?string
    {
        if ($reason === null) {
            return null;
        }
        try {
            return Text::optional($reason, 1000, 'reason');
        } catch (RuleViolation $violation) {
            throw BusinessError::validation(['reason' => [$violation->getMessage()]]);
        }
    }
}

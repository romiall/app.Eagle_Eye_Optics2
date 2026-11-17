<?php

namespace App\Support\Exports;

use App\Domain\Access\EffectivePermissions;
use App\Domain\Billing\Reports\ReportPeriod;
use App\Domain\Operations\ExportPlan;
use App\Domain\Shared\DayWindow;
use App\Models\Clinic;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use stdClass;
use ZipArchive;

/**
 * Production de l'archive d'un export contrôlé (X02 / L1D09) : un fichier CSV par table (séparateur « ; »,
 * UTF-8 avec BOM, lisible par un tableur), filtrage par période et portée de profil sans escalade, le dictionnaire
 * des colonnes tiré du catalogue du schéma, un manifeste complet (lignes, mode de filtrage, exclusions et SHA-256)
 * et, pour la seule remise complète, les pièces privées.
 */
final class ExportBuilder
{
    private const DELIMITER = ';';

    public function __construct(private readonly EffectivePermissions $permissions) {}

    /**
     * @return array{relative_path: string, sha256: string, size: int, tables: int, manifest: array<string, mixed>}
     */
    public function build(stdClass $request): array
    {
        $catalog = $this->catalog();
        $clinicId = (string) $request->clinic_id;
        $type = (string) $request->export_type;
        $clinic = Clinic::query()->find($clinicId);
        $timezone = $clinic !== null && $clinic->timezone !== '' ? (string) $clinic->timezone : 'Africa/Douala';
        $clinicName = $clinic !== null ? (string) $clinic->name : 'Cabinet';
        $currency = $clinic !== null ? (string) $clinic->currency : 'XAF';

        /** @var array{from?: string|null, to?: string|null, scope_role?: string|null}|null $decodedFilters */
        $decodedFilters = $request->filters === null ? null : json_decode((string) $request->filters, true);
        $requester = User::query()->where('clinic_id', $clinicId)->find((string) $request->requested_by);
        $requesterName = $requester !== null ? (string) $requester->display_name : 'Compte';
        $actorPermissions = $requester !== null ? $this->permissions->for($requester) : [];
        $scopeRole = is_array($decodedFilters) && is_string($decodedFilters['scope_role'] ?? null)
            ? $decodedFilters['scope_role']
            : null;
        $effectiveScope = $scopeRole !== null
            ? array_values(array_intersect($actorPermissions, ExportPlan::rolePermissions($scopeRole)))
            : $actorPermissions;
        sort($effectiveScope);

        $periodWindow = null;
        if (is_array($decodedFilters) && (($decodedFilters['from'] ?? null) !== null || ($decodedFilters['to'] ?? null) !== null)) {
            $nowPeriod = ReportPeriod::resolve(
                $timezone,
                CarbonImmutable::now('UTC'),
                $decodedFilters['from'] ?? null,
                $decodedFilters['to'] ?? null,
            );
            $periodWindow = [
                'from' => $nowPeriod->from->toString(),
                'to' => $nowPeriod->to->toString(),
                'start' => DayWindow::utc($nowPeriod->from, $timezone)[0],
                'end' => DayWindow::utc($nowPeriod->to, $timezone)[1],
            ];
        }

        $plannedTables = ExportPlan::tables($type, array_keys(array_filter($catalog, static fn (array $table): bool => $table['clinic'])));
        ['included' => $tables, 'excluded' => $excludedTables] = ExportPlan::tablePartition($plannedTables, $effectiveScope);

        $relative = 'exports/'.$clinicId.'/'.$request->id.'.zip';
        $absolute = storage_path('app/private/'.$relative);
        if (! is_dir(dirname($absolute)) && ! mkdir(dirname($absolute), 0700, true) && ! is_dir(dirname($absolute))) {
            throw new RuntimeException('Dossier des exports impossible à créer.');
        }

        $zip = new ZipArchive;
        if ($zip->open($absolute, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Archive impossible à créer.');
        }

        $recordFilters = $this->recordFilters($clinicId, $type, $request->patient_id === null ? null : (string) $request->patient_id);
        $manifestTables = [];
        foreach ($tables as $table) {
            $columns = ExportPlan::exportedColumnsFor($table, $catalog[$table]['columns'], $effectiveScope);
            [$csv, $rows, $filterMode, $dateColumn] = $this->tableCsv($clinicId, $table, $columns, $type, $recordFilters, $periodWindow);
            $name = 'donnees/'.$table.'.csv';
            $zip->addFromString($name, $csv);
            $manifestTables[] = [
                'table' => $table,
                'file' => $name,
                'rows' => $rows,
                'sha256' => hash('sha256', $csv),
                'filter_mode' => $filterMode,
                'date_column' => $dateColumn,
            ];
        }

        $dictionary = $this->dictionary($catalog, $tables);
        $zip->addFromString('dictionnaire.csv', $dictionary);

        $files = 0;
        if (ExportPlan::includesFiles($type) && in_array('audit.read', $effectiveScope, true)) {
            foreach (DB::table('stored_files')->where('clinic_id', $clinicId)->whereNull('archived_at')->orderBy('id')->get(['id', 'private_path']) as $file) {
                $path = storage_path('app/private/'.$file->private_path);
                if (is_file($path)) {
                    $zip->addFile($path, 'pieces/'.$file->id.'.'.pathinfo((string) $file->private_path, PATHINFO_EXTENSION));
                    $files++;
                }
            }
        }

        $now = CarbonImmutable::now('UTC');
        $manifest = [
            'export_id' => (string) $request->id,
            'export_type' => $type,
            'patient_id' => $request->patient_id === null ? null : (string) $request->patient_id,
            'clinic_id' => $clinicId,
            'clinic_name' => $clinicName,
            'requested_by' => (string) $request->requested_by,
            'requested_by_name' => $requesterName,
            'generated_at' => $now->format('Y-m-d\TH:i:s.v\Z'),
            'expires_at' => $now->addHours(ExportPlan::RETENTION_HOURS)->format('Y-m-d\TH:i:s.v\Z'),
            'archive_status' => 'READY',
            'filters' => $decodedFilters,
            'scope_permissions' => $effectiveScope,
            'checksum_algorithm' => 'SHA-256',
            'archive_sha256' => null,
            'provenance' => [
                'source' => 'eeo.export_builder.v1',
                'timezone' => $timezone,
                'currency' => $currency,
                'manifest_preserved' => true,
                'note' => 'Export du serveur : les opérations non synchronisées d\'un poste hors ligne en sont exclues ; le manifeste reste conservé au journal d\'audit après expiration 48 h du fichier ZIP.',
            ],
            'excluded_tables' => $excludedTables,
            'tables' => $manifestTables,
            'files' => $files,
            'dictionary' => ['file' => 'dictionnaire.csv', 'sha256' => hash('sha256', $dictionary)],
        ];
        $zip->addFromString('manifeste.json', (string) json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $zip->addFromString('LISEZMOI.txt', $this->readme($type));
        if ($zip->close() !== true) {
            throw new RuntimeException('Archive impossible à finaliser.');
        }

        $hash = hash_file('sha256', $absolute);
        if ($hash === false) {
            throw new RuntimeException('Empreinte de l\'archive impossible à calculer.');
        }
        $manifest['archive_sha256'] = $hash;
        unset($manifest['files'], $manifest['dictionary']);

        return ['relative_path' => $relative, 'sha256' => $hash, 'size' => (int) filesize($absolute), 'tables' => count($tables), 'manifest' => $manifest];
    }

    /**
     * Tables et colonnes du catalogue du schéma (même source que le MLD et le dictionnaire de données).
     *
     * @return array<string, array{clinic: bool, description: string, columns: list<string>, meta: list<array<string, mixed>>}>
     */
    private function catalog(): array
    {
        $raw = file_get_contents(base_path('database/schema_catalog.json'));
        /** @var array{tables: list<array{name: string, description?: string, columns: list<array<string, mixed>>}>} $decoded */
        $decoded = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
        $catalog = [];
        foreach ($decoded['tables'] as $table) {
            $names = array_map(static fn (array $column): string => (string) $column['name'], $table['columns']);
            $catalog[$table['name']] = [
                'clinic' => in_array('clinic_id', $names, true),
                'description' => (string) ($table['description'] ?? ''),
                'columns' => $names,
                'meta' => $table['columns'],
            ];
        }

        return $catalog;
    }

    /**
     * Identifiants du dossier d'un patient : consultations, rubriques d'antécédents et prescriptions (les autres
     * rubriques s'y rattachent).
     *
     * @return array{patient: list<string>, consultation: list<string>, history: list<string>, prescription: list<string>}|null
     */
    private function recordFilters(string $clinicId, string $type, ?string $patientId): ?array
    {
        if ($type !== 'PATIENT_RECORD' || $patientId === null) {
            return null;
        }
        $consultations = $this->idsOf(DB::table('consultations')->where('clinic_id', $clinicId)->where('patient_id', $patientId));

        return [
            'patient' => [$patientId],
            'consultation' => $consultations,
            'history' => $consultations === [] ? [] : $this->idsOf(DB::table('consultation_histories')->where('clinic_id', $clinicId)->whereIn('consultation_id', $consultations)),
            'prescription' => $this->idsOf(DB::table('optical_prescriptions')->where('clinic_id', $clinicId)->where('patient_id', $patientId)),
        ];
    }

    /**
     * @return list<string>
     */
    private function idsOf(Builder $query): array
    {
        return array_values(array_map('strval', $query->pluck('id')->all()));
    }

    /**
     * @param  list<string>  $columns
     * @param  array{patient: list<string>, consultation: list<string>, history: list<string>, prescription: list<string>}|null  $filters
     * @param  array{from: string, to: string, start: string, end: string}|null  $periodWindow
     * @return array{0: string, 1: int, 2: string, 3: string|null}
     */
    private function tableCsv(string $clinicId, string $table, array $columns, string $type, ?array $filters, ?array $periodWindow): array
    {
        $stream = fopen('php://temp', 'w+');
        if ($stream === false) {
            throw new RuntimeException('Flux temporaire impossible à ouvrir.');
        }
        fwrite($stream, "\u{FEFF}");
        fputcsv($stream, $columns, self::DELIMITER, '"', '');

        $query = DB::table($table)->where('clinic_id', $clinicId)->select($columns);
        $filterMode = 'SNAPSHOT_MASTER';
        $dateColumn = null;

        if ($type === 'PATIENT_RECORD') {
            $filterMode = 'PATIENT_SCOPED';
            $filter = ExportPlan::recordFilter($table);
            $ids = $filter === null || $filters === null ? [] : $filters[$filter['source']];
            if ($filter === null || $ids === []) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn($filter['column'], $ids);
                $dateColumn = $filter['column'];
            }
        } elseif ($periodWindow !== null) {
            $rule = ExportPlan::periodRuleFor($table);
            if ($rule !== null) {
                $filterMode = 'PERIOD_FILTERED';
                $dateColumn = $rule['column'];
                if ($rule['kind'] === 'timestamp') {
                    $query->where($rule['column'], '>=', $periodWindow['start'])->where($rule['column'], '<', $periodWindow['end']);
                } elseif ($rule['kind'] === 'civil_date') {
                    $query->where($rule['column'], '>=', $periodWindow['from'])->where($rule['column'], '<=', $periodWindow['to']);
                } elseif ($rule['kind'] === 'parent' && isset($rule['parent'])) {
                    $parentTable = $rule['parent'];
                    $parentRule = ExportPlan::periodRuleFor($parentTable);
                    if ($parentRule !== null && $parentRule['kind'] === 'timestamp') {
                        $dateColumn = $parentTable.'.'.$parentRule['column'];
                        $query->whereIn($rule['column'], static function (Builder $sub) use ($clinicId, $parentTable, $parentRule, $periodWindow): void {
                            $sub->select('id')
                                ->from($parentTable)
                                ->where('clinic_id', $clinicId)
                                ->where($parentRule['column'], '>=', $periodWindow['start'])
                                ->where($parentRule['column'], '<', $periodWindow['end']);
                        });
                    }
                }
            }
        }
        if (in_array('id', $columns, true)) {
            $query->orderBy('id');
        }

        $rows = 0;
        foreach ($query->cursor() as $row) {
            $values = [];
            foreach ($columns as $column) {
                $value = $row->{$column} ?? null;
                $values[] = $value === null ? '' : (is_bool($value) ? ($value ? '1' : '0') : (string) $value);
            }
            fputcsv($stream, $values, self::DELIMITER, '"', '');
            $rows++;
        }
        rewind($stream);
        $csv = (string) stream_get_contents($stream);
        fclose($stream);

        return [$csv, $rows, $filterMode, $dateColumn];
    }

    /**
     * @param  array<string, array{clinic: bool, description: string, columns: list<string>, meta: list<array<string, mixed>>}>  $catalog
     * @param  list<string>  $tables
     */
    private function dictionary(array $catalog, array $tables): string
    {
        $stream = fopen('php://temp', 'w+');
        if ($stream === false) {
            throw new RuntimeException('Flux temporaire impossible à ouvrir.');
        }
        fwrite($stream, "\u{FEFF}");
        fputcsv($stream, ['table', 'description_table', 'colonne', 'type', 'obligatoire', 'description'], self::DELIMITER, '"', '');
        foreach ($tables as $table) {
            $exported = ExportPlan::exportedColumns($table, $catalog[$table]['columns']);
            foreach ($catalog[$table]['meta'] as $column) {
                if (! in_array((string) $column['name'], $exported, true)) {
                    continue;
                }
                fputcsv($stream, [
                    $table,
                    $catalog[$table]['description'],
                    (string) $column['name'],
                    (string) ($column['type'] ?? ''),
                    ($column['nullable'] ?? true) ? 'non' : 'oui',
                    (string) ($column['description'] ?? ''),
                ], self::DELIMITER, '"', '');
            }
        }
        rewind($stream);
        $csv = (string) stream_get_contents($stream);
        fclose($stream);

        return $csv;
    }

    private function readme(string $type): string
    {
        return implode("\r\n", [
            'Export Eagle’s Eye Optics Medical ('.$type.')',
            '',
            'donnees/ : un fichier CSV par table (séparateur point-virgule, UTF-8), à ouvrir dans un tableur.',
            'dictionnaire.csv : le sens et le type de chaque colonne.',
            'manifeste.json : le nombre de lignes et l’empreinte SHA-256 de chaque fichier (contrôle d’intégrité).',
            ExportPlan::includesFiles($type) ? 'pieces/ : les originaux PDF et justificatifs conservés par le cabinet.' : '',
            '',
            'Données personnelles et de santé : à conserver de façon sécurisée, à ne pas transmettre sans autorisation.',
            'Les saisies encore en attente sur un poste hors ligne ne figurent pas dans cet export.',
            '',
        ]);
    }
}

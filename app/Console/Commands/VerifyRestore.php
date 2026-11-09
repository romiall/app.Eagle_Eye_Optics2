<?php

namespace App\Console\Commands;

use App\Domain\Access\AuditRecorder;
use App\Domain\Access\ClinicContext;
use App\Domain\Operations\RestoreVerifier;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Exercice de restauration (X03 ; AT27) : vérifie une base RESTAURÉE dans une base JETABLE (nom terminé par
 * « _restore », « _rest » (hébergeur qui limite le nom d'une base) ou « _test », jamais la base de l'application), avec les fichiers privés restaurés, puis mesure la
 * perte contre la base vivante (derniers reçus, factures, paiements, audit) et, sur demande, consigne l'exercice dans
 * `restore_tests` de la base de l'application, avec la sauvegarde restaurée (`backup_runs`) et la personne qui l'a mené.
 *
 *   php artisan eeo:restore:verify eeo_restore --files=/chemin/restaure/private --started-at=2026-10-23T10:00:00Z
 *   php artisan eeo:restore:verify eeo_restore --files=… --backup-run=<id> --tested-by=<identifiant> --record
 *
 * Base jetable à utilisateur propre (hébergeur qui donne UN utilisateur par base, comme Hostinger : celui de l'application
 * n'a aucun droit sur elle) : ses identifiants viennent de l'ENVIRONNEMENT du shell (EEO_RESTORE_DB_USERNAME et
 * EEO_RESTORE_DB_PASSWORD, configuration `eeo.restore`), jamais d'un argument.
 *
 * Sortie non nulle si un contrôle échoue. Les plages de numéros et quotas encore ouverts sur des postes sont une
 * ALERTE : ces postes se synchronisent avant toute réouverture des ventes (runbook docs/runbooks/server-restore.md).
 */
final class VerifyRestore extends Command
{
    protected $signature = 'eeo:restore:verify
        {database : Base jetable restaurée (nom terminé par _restore, _rest ou _test)}
        {--files= : Dossier des fichiers privés restaurés (storage/app/private de la sauvegarde)}
        {--started-at= : Début de la restauration, instant ISO 8601 (durée constatée)}
        {--backup-run= : Identifiant de la sauvegarde restaurée (backup_runs), pour consigner l\'exercice}
        {--tested-by= : Identifiant de connexion de la personne qui mène l\'exercice}
        {--record : Consigne l\'exercice dans restore_tests de la base de l\'application}
        {--json : Rapport au format JSON}';

    protected $description = 'Vérifie une base restaurée sur une base jetable et mesure la perte (X03)';

    private const CONNECTION = 'eeo_restore';

    public function handle(ClinicContext $clinics, AuditRecorder $audit): int
    {
        $database = $this->stringArgument('database');
        $default = (string) config('database.default');
        $live = (string) config('database.connections.'.$default.'.database');
        if ($database === $live) {
            $this->error('Refus : la base cible est la base de l\'application ('.$live.'). Utilisez une base jetable restaurée.');

            return self::INVALID;
        }
        if (preg_match('/^[A-Za-z0-9_]+_(restore|rest|test)$/', $database) !== 1) {
            $this->error('Refus : le nom de la base jetable doit se terminer par _restore, _rest ou _test (reçu '.$database.').');

            return self::INVALID;
        }

        $startedAt = $this->instantOption('started-at');
        if ($startedAt === false) {
            return self::INVALID;
        }
        $digest = $this->fileDigest();
        if ($digest === false) {
            return self::INVALID;
        }

        $restore = (array) config('eeo.restore');
        $own = (string) ($restore['db_username'] ?? '') !== ''
            ? ['username' => (string) $restore['db_username'], 'password' => (string) ($restore['db_password'] ?? '')]
            : [];
        config(['database.connections.'.self::CONNECTION => array_merge(
            (array) config('database.connections.'.$default),
            ['database' => $database],
            $own,
        )]);
        DB::purge(self::CONNECTION);

        try {
            $report = (new RestoreVerifier(DB::connection(self::CONNECTION)))->verify($digest);
            $liveFacts = (new RestoreVerifier(DB::connection()))->facts();
        } catch (Throwable $error) {
            $this->error('Vérification impossible : '.$error->getMessage());

            return self::FAILURE;
        } finally {
            DB::purge(self::CONNECTION);
        }

        $completedAt = CarbonImmutable::now('UTC');
        $measures = [
            'restore_minutes' => $startedAt === null ? null : intdiv(max(0, $completedAt->getTimestamp() - $startedAt->getTimestamp()), 60),
            'receipts_missing' => max(0, (int) $liveFacts['receipts'] - (int) $report['facts']['receipts']),
            'invoices_missing' => max(0, (int) $liveFacts['invoices_issued'] - (int) $report['facts']['invoices_issued']),
            'last_receipt_restored' => $report['facts']['last_receipt_number'],
            'last_receipt_live' => $liveFacts['last_receipt_number'],
            'loss_window' => [
                'from' => $report['facts']['last_audit_at'],
                'to' => $liveFacts['last_audit_at'],
            ],
        ];

        if ($this->option('json')) {
            $this->line((string) json_encode(['report' => $report, 'live' => $liveFacts, 'measures' => $measures], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            $this->render($report, $measures);
        }

        if ($this->option('record')) {
            $recorded = $this->record($clinics, $audit, $report, $liveFacts, $measures, $startedAt ?? $completedAt, $completedAt);
            if ($recorded !== self::SUCCESS) {
                return $recorded;
            }
        }

        return $report['status'] === RestoreVerifier::FAIL ? self::FAILURE : self::SUCCESS;
    }

    /**
     * @param  array{status: string, checks: list<array{code: string, label: string, status: string, count: int, details: list<string>}>, facts: array<string, mixed>}  $report
     * @param  array<string, mixed>  $measures
     */
    private function render(array $report, array $measures): void
    {
        foreach ($report['checks'] as $check) {
            $this->line(sprintf('[%s] %s (%d)', $check['status'], $check['label'], $check['count']));
            foreach ($check['details'] as $detail) {
                $this->line('       '.$detail);
            }
        }
        $this->newLine();
        $this->line('Dernier reçu restauré : '.($report['facts']['last_receipt_number'] ?? 'aucun').' ('.($report['facts']['last_receipt_at'] ?? '—').')');
        $this->line('Dernier reçu de la base vivante : '.($measures['last_receipt_live'] ?? 'aucun'));
        $this->line('Reçus absents de la sauvegarde : '.$measures['receipts_missing'].' ; factures émises absentes : '.$measures['invoices_missing']);
        if ($measures['restore_minutes'] !== null) {
            $this->line('Durée constatée depuis le début de la restauration : '.$measures['restore_minutes'].' min');
        }
        $this->newLine();
        $this->line('Résultat : '.$report['status']);
    }

    /**
     * @param  array{status: string, checks: list<array{code: string, label: string, status: string, count: int, details: list<string>}>, facts: array<string, mixed>}  $report
     * @param  array<string, mixed>  $liveFacts
     * @param  array<string, mixed>  $measures
     */
    private function record(ClinicContext $clinics, AuditRecorder $audit, array $report, array $liveFacts, array $measures, CarbonImmutable $startedAt, CarbonImmutable $completedAt): int
    {
        $clinicId = $clinics->configuredClinicId();
        $backupRun = $this->stringOption('backup-run') ?? '';
        $login = $this->stringOption('tested-by') ?? '';
        $backup = DB::table('backup_runs')->where('clinic_id', $clinicId)->where('id', $backupRun)->first();
        if ($backup === null || $backup->status !== 'SUCCEEDED') {
            $this->error('Consignation impossible : --backup-run doit désigner une sauvegarde réussie de backup_runs.');

            return self::INVALID;
        }
        $tester = DB::table('users')->where('clinic_id', $clinicId)->where('login', $login)->first(['id', 'display_name']);
        if ($tester === null) {
            $this->error('Consignation impossible : --tested-by doit être l\'identifiant de connexion d\'un compte du cabinet.');

            return self::INVALID;
        }

        $id = Ulid::generate();
        $status = $report['status'] === RestoreVerifier::FAIL ? 'FAILED' : 'PASSED';
        $checks = [
            'status' => $report['status'],
            'checks' => array_map(static fn (array $check): array => [
                'code' => $check['code'],
                'status' => $check['status'],
                'count' => $check['count'],
            ], $report['checks']),
            'restored' => $report['facts'],
            'live' => $liveFacts,
            'measures' => $measures,
        ];
        DB::table('restore_tests')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'backup_run_id' => $backupRun,
            'started_at' => $startedAt->format('Y-m-d H:i:s.u'),
            'completed_at' => $completedAt->format('Y-m-d H:i:s.u'),
            'status' => $status,
            'tested_by' => $tester->id,
            'checks' => json_encode($checks, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'observations' => sprintf(
                'Base jetable %s ; %d reçu(s) et %d facture(s) émise(s) absents de la sauvegarde.',
                $this->stringArgument('database'),
                (int) $measures['receipts_missing'],
                (int) $measures['invoices_missing'],
            ),
            'created_at' => $completedAt->format('Y-m-d H:i:s.u'),
            'updated_at' => $completedAt->format('Y-m-d H:i:s.u'),
        ]);
        $audit->recordFor($clinicId, (string) $tester->id, (string) $tester->display_name, 'restore.tested', 'restore_tests', $id, null, [
            'status' => $status,
            'backup_run_id' => $backupRun,
        ], 'console:'.Ulid::generate());
        $this->info('Exercice consigné dans restore_tests : '.$id.' ('.$status.').');

        return self::SUCCESS;
    }

    /** Valeur d'une option texte : une chaîne, ou null quand elle est absente. */
    private function stringOption(string $name): ?string
    {
        $value = $this->option($name);

        return is_string($value) ? $value : null;
    }

    /** Valeur d'un argument texte (chaîne vide si l'argument n'est pas une chaîne). */
    private function stringArgument(string $name): string
    {
        $value = $this->argument($name);

        return is_string($value) ? $value : '';
    }

    private function instantOption(string $name): CarbonImmutable|false|null
    {
        $value = $this->stringOption($name);
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            $this->error('--'.$name.' doit être un instant ISO 8601 (par exemple 2026-10-23T10:00:00Z).');

            return false;
        }
    }

    /**
     * Empreinte d'un fichier privé restauré, lu sous le dossier fourni (jamais au-dessus) ; null s'il manque.
     *
     * @return (Closure(string): (string|null))|false|null
     */
    private function fileDigest(): Closure|false|null
    {
        $option = $this->stringOption('files');
        if ($option === null || $option === '') {
            return null;
        }
        $root = realpath($option);
        if ($root === false || ! is_dir($root)) {
            $this->error('--files doit désigner le dossier des fichiers privés restaurés.');

            return false;
        }

        return static function (string $relative) use ($root): ?string {
            if (str_contains($relative, '..') || str_starts_with($relative, '/') || str_starts_with($relative, '\\')) {
                return null;
            }
            $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
            if (! is_file($path)) {
                return null;
            }
            $digest = hash_file('sha256', $path);

            return $digest === false ? null : $digest;
        };
    }
}

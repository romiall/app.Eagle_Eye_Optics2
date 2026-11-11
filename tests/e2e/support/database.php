<?php

/**
 * Actions sur la base de test des parcours e2e (G2), appelées par `tests/e2e/support/database.ts` avec APP_ENV=e2e : la
 * base est celle de `.env.e2e`.
 *
 *   php database.php integrity                   diagnostics d'intégrité (fichier 25 : « diagnostics SQL sans anomalie sur dataset »)
 *   php database.php blocking-devices            postes qui feraient refuser la préparation d'une autre caisse (lecture seule)
 *   php database.php retire-device CODE [CODE…]  sort des postes de test restés actifs d'un parcours échoué
 *
 * `integrity` lance les contrôles de la restauration vérifiée (`RestoreVerifier` : tables du catalogue, diagnostics de
 * `database/05_integrity_checks.sql`, séquences, numéros des pièces émises, empreintes de l'audit, fichiers privés avec
 * leur empreinte, postes à synchroniser) EN LECTURE SEULE et écrit le rapport en JSON sur la sortie standard.
 *
 * `blocking-devices` (lecture seule) liste les postes dont la préparation de ressources financières ferait refuser celle
 * d'un AUTRE poste (FINANCIAL_DEVICE_ELSEWHERE) : même condition que
 * `App\Offline\PrepareResources::assertSingleFinancialDevice` (poste actif, révoqué ou perdu qui détient une propriété de
 * facture, un quota de stock ou une plage d'une série financière encore ouverts), même liste de séries.
 *
 * `retire-device` ne sert qu'à NE PAS propager l'échec d'un parcours aux suivants ni à sa propre reprise : une seule caisse
 * hors ligne principale à la fois, donc un poste de test dont le parcours est tombé avant de rendre ses ressources ferait
 * échouer tous les parcours suivants. Il passe CES postes (codes explicites) à l'état REPLACED, qui n'est plus une caisse
 * principale. Seul `enrolled_devices.status` change (ni version, ni audit, ni plage : un poste de test sorti n'est pas une
 * action du cabinet) ; ses ressources restent ouvertes, ce que le contrôle OFFLINE_RECONCILIATION de `integrity` signale
 * en alerte, jamais en échec. Idempotent : un poste déjà REPLACED ou inconnu n'est pas touché.
 *
 * Refus (code 2) si la base n'est pas une base de test locale `eeo_*_test` : ce programme ne se lance jamais sur la base de
 * production.
 */

use App\Domain\Operations\RestoreVerifier;
use App\Offline\PrepareResources;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$connection = (string) config('database.default');
$database = (string) config('database.connections.'.$connection.'.database');
$host = (string) config('database.connections.'.$connection.'.host');
if (preg_match('/^eeo_[a-z0-9_]*_test\z/', $database) !== 1 || ! in_array($host, ['127.0.0.1', 'localhost', '::1', 'mysql'], true)) {
    fwrite(STDERR, 'Refus : la base '.$database.' sur '.$host.' n\'est pas une base de test locale eeo_*_test.'.PHP_EOL);
    exit(2);
}

$action = $argv[1] ?? '';

if ($action === 'integrity') {
    $root = storage_path('app/private');
    $digest = static function (string $relative) use ($root): ?string {
        if (str_contains($relative, '..') || str_starts_with($relative, '/') || str_starts_with($relative, '\\')) {
            return null;
        }
        $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
        $hash = is_file($path) ? hash_file('sha256', $path) : false;

        return $hash === false ? null : $hash;
    };

    $report = (new RestoreVerifier(DB::connection()))->verify($digest);
    $report['database'] = $database;
    $report['audit_events'] = DB::table('audit_events')->count();

    echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit(0);
}

if ($action === 'blocking-devices') {
    $devices = DB::table('enrolled_devices as d')
        ->whereIn('d.status', ['ACTIVE', 'REVOKED', 'LOST'])
        ->where(static function (Builder $query): void {
            $query->whereExists(static function (Builder $sub): void {
                $sub->select(DB::raw(1))->from('invoice_write_owners as o')
                    ->whereColumn('o.clinic_id', 'd.clinic_id')
                    ->whereColumn('o.device_id', 'd.id')
                    ->whereIn('o.status', ['ACTIVE', 'CLOSING']);
            })->orWhereExists(static function (Builder $sub): void {
                $sub->select(DB::raw(1))->from('device_stock_allocations as q')
                    ->whereColumn('q.clinic_id', 'd.clinic_id')
                    ->whereColumn('q.device_id', 'd.id')
                    ->whereIn('q.status', ['ACTIVE', 'CLOSING']);
            })->orWhereExists(static function (Builder $sub): void {
                $sub->select(DB::raw(1))->from('document_number_allocations as a')
                    ->whereColumn('a.clinic_id', 'd.clinic_id')
                    ->whereColumn('a.device_id', 'd.id')
                    ->whereIn('a.status', ['ACTIVE', 'CLOSING'])
                    ->whereIn('a.document_type', PrepareResources::FINANCIAL_SERIES);
            });
        })
        ->orderBy('d.device_code')
        ->get(['d.device_code', 'd.status']);

    $blocking = [];
    foreach ($devices as $device) {
        $blocking[] = ['device_code' => (string) $device->device_code, 'status' => (string) $device->status];
    }

    echo json_encode(['blocking' => $blocking], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit(0);
}

if ($action === 'retire-device') {
    $codes = array_slice($argv, 2);
    $invalid = $codes === [] || array_filter($codes, static fn (string $code): bool => preg_match('/^[A-Z0-9-]{3,40}\z/', $code) !== 1) !== [];
    if ($invalid) {
        fwrite(STDERR, 'Code de poste attendu (majuscules, chiffres et tirets).'.PHP_EOL);
        exit(2);
    }
    $retired = DB::table('enrolled_devices')
        ->whereIn('device_code', $codes)
        ->whereIn('status', ['ACTIVE', 'REVOKED', 'LOST'])
        ->update(['status' => 'REPLACED']);

    echo json_encode(['retired' => $retired], JSON_THROW_ON_ERROR);
    exit(0);
}

fwrite(STDERR, 'Action inconnue : integrity, blocking-devices ou retire-device CODE.'.PHP_EOL);
exit(2);

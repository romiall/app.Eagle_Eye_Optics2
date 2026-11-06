<?php

/**
 * Actions sur la base de test des parcours e2e (G2), appelées par `tests/e2e/support/database.ts` avec APP_ENV=e2e : la
 * base est celle de `.env.e2e`.
 *
 *   php database.php integrity            diagnostics d'intégrité (fichier 25 : « diagnostics SQL sans anomalie sur dataset »)
 *   php database.php retire-device CODE   sort un poste de test resté actif d'un parcours échoué
 *
 * `integrity` lance les contrôles de la restauration vérifiée (`RestoreVerifier` : tables du catalogue, diagnostics de
 * `database/05_integrity_checks.sql`, séquences, numéros des pièces émises, empreintes de l'audit, fichiers privés avec
 * leur empreinte, postes à synchroniser) EN LECTURE SEULE et écrit le rapport en JSON sur la sortie standard.
 *
 * `retire-device` ne sert qu'à NE PAS propager l'échec d'un parcours aux suivants : une seule caisse hors ligne principale
 * à la fois (FINANCIAL_DEVICE_ELSEWHERE), donc un poste de test dont le parcours est tombé avant de rendre ses ressources
 * ferait échouer tous les parcours suivants. Il passe CE poste (code explicite) à l'état REPLACED, qui n'est plus une caisse
 * principale. Il n'est jamais appelé quand le parcours a réussi.
 *
 * Refus (code 2) si la base n'est pas une base de test locale `eeo_*_test` : ce programme ne se lance jamais sur la base de
 * production.
 */

use App\Domain\Operations\RestoreVerifier;
use Illuminate\Contracts\Console\Kernel;
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

if ($action === 'retire-device') {
    $code = $argv[2] ?? '';
    if (preg_match('/^[A-Z0-9-]{3,40}\z/', $code) !== 1) {
        fwrite(STDERR, 'Code de poste attendu (majuscules, chiffres et tirets).'.PHP_EOL);
        exit(2);
    }
    $retired = DB::table('enrolled_devices')
        ->where('device_code', $code)
        ->whereIn('status', ['ACTIVE', 'REVOKED', 'LOST'])
        ->update(['status' => 'REPLACED']);

    echo json_encode(['retired' => $retired], JSON_THROW_ON_ERROR);
    exit(0);
}

fwrite(STDERR, 'Action inconnue : integrity ou retire-device CODE.'.PHP_EOL);
exit(2);

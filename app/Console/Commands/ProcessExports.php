<?php

namespace App\Console\Commands;

use App\Application\TransactionRunner;
use App\Domain\Access\AuditRecorder;
use App\Domain\Operations\ExportPlan;
use App\Domain\Shared\Ulid;
use App\Support\Exports\ExportBuilder;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Tâche planifiée des exports contrôlés (X02), lancée par le cron de l'hébergement (`schedule:run` chaque minute) :
 *
 * 1. une archive prête dont le délai est passé devient EXPIRÉE : son fichier est supprimé, ses métadonnées restent ;
 * 2. les exports DEMANDÉS sont produits un par un (le plus ancien d'abord) : PROCESSING, archive privée, fichier
 *    rattaché (`stored_files`), PRÊT pour 48 h ; un échec devient FAILED avec un code, jamais un message qui
 *    contiendrait des données.
 *
 * Un export pris par une autre exécution (statut changé entre-temps) n'est jamais produit deux fois.
 */
final class ProcessExports extends Command
{
    protected $signature = 'eeo:exports:process {--limit=3 : Exports produits au plus par exécution}';

    protected $description = 'Produit les exports demandés et expire les archives dont le délai est passé (X02)';

    public function handle(ExportBuilder $builder, AuditRecorder $audit, TransactionRunner $transactions): int
    {
        $now = CarbonImmutable::now('UTC');
        $stamp = $now->format('Y-m-d H:i:s.u');

        $expired = $this->expire($now, $stamp);
        $produced = 0;
        $failed = 0;
        $limit = max(1, (int) $this->option('limit'));

        $pending = DB::table('export_requests')->where('status', 'REQUESTED')->orderBy('created_at')->orderBy('id')->limit($limit)->get();
        foreach ($pending as $request) {
            $taken = DB::table('export_requests')->where('id', $request->id)->where('status', 'REQUESTED')
                ->update(['status' => 'PROCESSING', 'updated_at' => $stamp]);
            if ($taken !== 1) {
                continue;
            }
            try {
                $archive = $builder->build($request);
                $fileId = Ulid::generate();
                $done = CarbonImmutable::now('UTC');
                $transactions->run(function () use ($request, $archive, $fileId, $done): void {
                    DB::table('stored_files')->insert([
                        'id' => $fileId,
                        'clinic_id' => $request->clinic_id,
                        'private_path' => $archive['relative_path'],
                        'mime_type' => 'application/zip',
                        'size_bytes' => $archive['size'],
                        'sha256' => $archive['sha256'],
                        'classification' => $this->classification((string) $request->export_type),
                        'encryption_key_id' => null,
                        'uploaded_by' => $request->requested_by,
                        'archived_at' => null,
                        'created_at' => $done->format('Y-m-d H:i:s.u'),
                        'updated_at' => $done->format('Y-m-d H:i:s.u'),
                    ]);
                    DB::table('export_requests')->where('id', $request->id)->update([
                        'status' => 'READY',
                        'file_id' => $fileId,
                        'completed_at' => $done->format('Y-m-d H:i:s.u'),
                        'expires_at' => $done->addHours(ExportPlan::RETENTION_HOURS)->format('Y-m-d H:i:s.u'),
                        'error_code' => null,
                        'updated_at' => $done->format('Y-m-d H:i:s.u'),
                    ]);
                });
                $audit->record((string) $request->clinic_id, null, 'export.ready', 'export_requests', (string) $request->id,
                    null, [
                        'export_type' => (string) $request->export_type,
                        'tables' => $archive['tables'],
                        'sha256' => $archive['sha256'],
                        'manifest' => $archive['manifest'],
                    ],
                    'Tâche planifiée des exports');
                $produced++;
            } catch (Throwable $error) {
                report($error);
                DB::table('export_requests')->where('id', $request->id)->update([
                    'status' => 'FAILED',
                    'error_code' => 'EXPORT_FAILED',
                    'updated_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u'),
                ]);
                $audit->record((string) $request->clinic_id, null, 'export.failed', 'export_requests', (string) $request->id,
                    null, ['export_type' => (string) $request->export_type], 'Tâche planifiée des exports');
                $failed++;
            }
        }

        $this->info("Exports produits : {$produced} ; en échec : {$failed} ; expirés : {$expired}.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function expire(CarbonImmutable $now, string $stamp): int
    {
        $count = 0;
        $ready = DB::table('export_requests')->where('status', 'READY')->where('expires_at', '<=', $now->format('Y-m-d H:i:s.u'))->get();
        foreach ($ready as $request) {
            $path = DB::table('stored_files')->where('clinic_id', $request->clinic_id)->where('id', $request->file_id)->value('private_path');
            if (is_string($path) && is_file(storage_path('app/private/'.$path))) {
                @unlink(storage_path('app/private/'.$path));
            }
            DB::table('stored_files')->where('clinic_id', $request->clinic_id)->where('id', $request->file_id)
                ->update(['archived_at' => $stamp, 'updated_at' => $stamp]);
            DB::table('export_requests')->where('id', $request->id)->update(['status' => 'EXPIRED', 'updated_at' => $stamp]);
            $count++;
        }

        return $count;
    }

    private function classification(string $type): string
    {
        return match ($type) {
            'PATIENT_RECORD', 'FULL_HANDOVER' => 'MEDICAL',
            'FINANCE' => 'FINANCIAL',
            default => 'INTERNAL',
        };
    }
}

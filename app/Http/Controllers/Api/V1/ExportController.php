<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Access\AuditRecorder;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Exports contrôlés (X02), module `settings` : demande (réauthentification récente, commande `RequestExport`), liste,
 * état et téléchargement privé de l'archive pendant 48 h. Un compte qui détient export.global voit tous les exports
 * du cabinet ; un autre seulement les siens (un dossier de patient demandé avec clinical.export). Téléchargement
 * tracé (`export.downloaded`), jamais d'URL publique, sans cache.
 */
final class ExportController extends CommandController
{
    public function store(Request $request): JsonResponse
    {
        /** @var array<string, mixed> $payload */
        $payload = $request->json()->all();
        $result = $this->dispatchCommand($request, new Command('RequestExport', $payload, null, null));

        return new JsonResponse(['data' => self::present($this->find($this->actor($request), (string) $result->resultId))], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $query = DB::table('export_requests')->where('clinic_id', $actor->clinic_id);
        if (! $actor->can('export.global')) {
            $query->where('requested_by', $actor->id);
        }
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')->limit(50)->get();

        return new JsonResponse(['data' => array_map(self::present(...), $rows->all())]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return new JsonResponse(['data' => self::present($this->find($this->actor($request), $id))]);
    }

    public function download(Request $request, AuditRecorder $audit, string $id): BinaryFileResponse
    {
        $actor = $this->actor($request);
        $export = $this->find($actor, $id);
        if ($export->status === 'EXPIRED' || ($export->expires_at !== null && CarbonImmutable::parse((string) $export->expires_at, 'UTC')->isPast())) {
            throw BusinessError::stateRefused('Cette archive a expiré : demandez un nouvel export.', 'EXPIRED');
        }
        if ($export->status !== 'READY' || $export->file_id === null) {
            throw BusinessError::stateRefused('L\'archive n\'est pas encore prête.', (string) $export->status);
        }
        $file = DB::table('stored_files')->where('clinic_id', $actor->clinic_id)->where('id', $export->file_id)->first();
        $path = $file === null ? null : storage_path('app/private/'.$file->private_path);
        if ($path === null || ! is_file($path) || hash_file('sha256', $path) !== (string) $file->sha256) {
            throw BusinessError::notFound('L\'archive est introuvable ou altérée : elle n\'est pas servie.');
        }
        $audit->record((string) $actor->clinic_id, $actor, 'export.downloaded', 'export_requests', (string) $export->id);

        $name = 'export-'.strtolower(str_replace('_', '-', (string) $export->export_type)).'-'
            .CarbonImmutable::parse((string) $export->completed_at, 'UTC')->format('Ymd').'.zip';

        return response()->download($path, $name, [
            'Content-Type' => 'application/zip',
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function manifest(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $export = $this->find($actor, $id);
        $event = DB::table('audit_events')
            ->where('clinic_id', $actor->clinic_id)
            ->where('target_type', 'export_requests')
            ->where('target_id', $id)
            ->where('action', 'export.ready')
            ->orderByDesc('recorded_at')
            ->first(['sanitized_diff']);

        if ($event === null || $event->sanitized_diff === null) {
            throw new BusinessError('STATE_TRANSITION_REFUSED', 'Le manifeste n\'est pas encore disponible pour cet export.', 409, details: [
                'current_status' => (string) $export->status,
            ]);
        }

        /** @var array<string, mixed> $diff */
        $diff = json_decode((string) $event->sanitized_diff, true, 512, JSON_THROW_ON_ERROR);
        $manifest = $diff['manifest'] ?? null;
        if (! is_array($manifest)) {
            throw new BusinessError('STATE_TRANSITION_REFUSED', 'Le manifeste conservé est indisponible pour cet export.', 409, details: [
                'current_status' => (string) $export->status,
            ]);
        }

        $manifest['archive_status'] = (string) $export->status;

        return new JsonResponse(['data' => $manifest]);
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(stdClass $row): array
    {
        $instant = static fn (mixed $value): ?string => $value === null ? null
            : CarbonImmutable::parse((string) $value, 'UTC')->format('Y-m-d\TH:i:s.v\Z');

        return [
            'id' => (string) $row->id,
            'export_type' => (string) $row->export_type,
            'patient_id' => $row->patient_id === null ? null : (string) $row->patient_id,
            'filters' => $row->filters === null ? null : json_decode((string) $row->filters, true),
            'status' => (string) $row->status,
            'requested_by' => (string) $row->requested_by,
            'completed_at' => $instant($row->completed_at),
            'expires_at' => $instant($row->expires_at),
            'error_code' => $row->error_code === null ? null : (string) $row->error_code,
        ];
    }

    /** Export du cabinet visible par ce compte (le sien, ou tout export avec export.global) ; sinon introuvable. */
    private function find(User $actor, string $id): stdClass
    {
        $row = DB::table('export_requests')->where('clinic_id', $actor->clinic_id)->where('id', $id)->first();
        if ($row === null || (! $actor->can('export.global') && (string) $row->requested_by !== (string) $actor->id)) {
            throw BusinessError::notFound();
        }

        return $row;
    }

    private function actor(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return $user;
    }
}

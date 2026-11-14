<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Command;
use App\Domain\Access\AuditRecorder;
use App\Domain\Documents\DocumentFiles;
use App\Domain\Documents\DocumentPolicy;
use App\Domain\Shared\BusinessError;
use App\Http\Controllers\CommandController;
use App\Models\User;
use App\Support\Files\PrivateFiles;
use App\Support\Modules;
use Carbon\CarbonImmutable;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Originaux PDF des documents générés (D01), stockage PRIVÉ, jamais d'URL publique :
 *
 *   POST /api/v1/documents/{id}/content   corps application/pdf (en-tête facultatif X-Content-Sha256) : le serveur
 *                                         contrôle la Policy de la famille, la signature PDF, la taille et
 *                                         l'empreinte, écrit le fichier puis la commande StoreDocumentContent le
 *                                         rattache (PENDING → READY) ; un READY ne se remplace jamais ;
 *   GET  /api/v1/documents/{id}/download  l'original conservé, application/pdf, sans cache ; un document clinique
 *                                         téléchargé est tracé (document.downloaded).
 *
 * Module : pièce financière avec « sales » ouvert, document clinique avec « consultations » ; sinon 404, comme un
 * document d'un autre cabinet.
 */
final class DocumentController extends CommandController
{
    public function content(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $document = $this->document($actor, $id);
        if (! DocumentPolicy::mayStore($actor, (string) $document->document_type)) {
            throw BusinessError::forbidden('Ce compte ne peut pas déposer ce type de document.');
        }

        $bytes = (string) $request->getContent();
        $announced = $request->header('X-Content-Sha256');
        $checked = DocumentFiles::inspect($bytes, is_string($announced) && $announced !== '' ? $announced : null);
        $path = DocumentFiles::pathFor((string) $actor->clinic_id, (string) $document->id, $checked['sha256']);
        PrivateFiles::write($path, $bytes);

        $this->dispatchCommand($request, new Command('StoreDocumentContent', [
            'document_id' => (string) $document->id,
            'sha256' => $checked['sha256'],
            'size_bytes' => $checked['size'],
            'private_path' => $path,
        ], (string) $document->id, null));

        return new JsonResponse(['data' => self::present($this->document($actor, $id))]);
    }

    public function download(Request $request, AuditRecorder $audit, string $id): Response
    {
        $actor = $this->actor($request);
        $document = $this->document($actor, $id);
        $type = (string) $document->document_type;
        if (! DocumentPolicy::mayDownload($actor, $type)) {
            throw BusinessError::forbidden('Ce compte ne peut pas ouvrir ce type de document.');
        }
        if ($document->status !== 'READY' || $document->file_id === null) {
            throw BusinessError::notFound('L\'original de ce document n\'est pas encore conservé sur le serveur.');
        }
        $path = DB::table('stored_files')->where('clinic_id', $actor->clinic_id)->where('id', $document->file_id)->value('private_path');
        $bytes = is_string($path) ? PrivateFiles::read($path) : null;
        if ($bytes === null || hash('sha256', $bytes) !== (string) $document->sha256) {
            throw BusinessError::notFound('L\'original conservé est introuvable ou altéré : il n\'est pas servi.');
        }
        if (DocumentPolicy::isClinical($type)) {
            $audit->record((string) $actor->clinic_id, $actor, 'document.downloaded', 'generated_documents', (string) $document->id);
        }

        $day = CarbonImmutable::now('UTC')->format('Ymd');

        return new Response($bytes, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="document-'.strtolower(str_replace('_', '-', $type)).'-'.$day.'.pdf"',
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(stdClass $document): array
    {
        return [
            'id' => (string) $document->id,
            'document_type' => (string) $document->document_type,
            'source_key' => (string) $document->source_key,
            'revision_no' => (int) $document->revision_no,
            'template_version' => (string) $document->template_version,
            'status' => (string) $document->status,
            'sha256' => $document->sha256 === null ? null : (string) $document->sha256,
            'generated_at' => $document->generated_at === null ? null
                : CarbonImmutable::parse((string) $document->generated_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
            'failure_code' => $document->failure_code === null ? null : (string) $document->failure_code,
        ];
    }

    private function document(User $actor, string $id): stdClass
    {
        $document = DB::table('generated_documents')->where('clinic_id', $actor->clinic_id)->where('id', $id)->first();
        if ($document === null) {
            throw BusinessError::notFound();
        }
        $type = (string) $document->document_type;
        $module = match (true) {
            DocumentPolicy::isClinical($type) => 'consultations',
            DocumentPolicy::isWorkshop($type) => 'workshop',
            default => 'sales',
        };
        if (! Modules::isEnabled($module)) {
            throw BusinessError::notFound();
        }

        return $document;
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

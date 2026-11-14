<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Sert la coquille SPA et les deux fichiers PWA qui doivent etre a la racine du site.
 * Aucune logique métier ici.
 */
class SpaController extends Controller
{
    /**
     * Motif des chemins servis par la coquille (sans la barre initiale).
     * Exclut api, build, storage (y compris le segment seul) et les chemins se terminant par une extension.
     */
    public const SHELL_PATH_PATTERN = '(?!(?:api|public|build|storage)(?:/|$))(?!.*\.[A-Za-z0-9]{1,10}$).*';

    public function shell(): Response
    {
        return response()
            ->view('spa')
            // La coquille est identique pour tous ; aucun cookie ni donnee de session n'y figure.
            ->header('Cache-Control', 'no-cache, must-revalidate');
    }

    /**
     * Le service worker est généré par Vite dans public/build ; il est servi à /sw.js pour couvrir
     * toute l'origine. Revalidation obligatoire pour que les mises à jour soient détectées.
     */
    public function serviceWorker(): BinaryFileResponse
    {
        return $this->buildFile('sw.js', 'text/javascript; charset=utf-8', [
            'Service-Worker-Allowed' => '/',
            'Cache-Control' => 'no-cache, must-revalidate',
        ]);
    }

    public function manifest(): BinaryFileResponse
    {
        return $this->buildFile('manifest.webmanifest', 'application/manifest+json; charset=utf-8', [
            'Cache-Control' => 'no-cache, must-revalidate',
        ]);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function buildFile(string $name, string $contentType, array $headers): BinaryFileResponse
    {
        $path = public_path('build/'.$name);

        abort_unless(is_file($path), 404);

        return response()->file($path, ['Content-Type' => $contentType] + $headers);
    }
}

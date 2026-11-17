<?php

use App\Http\Controllers\SpaController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Coquille SPA et fichiers PWA
|--------------------------------------------------------------------------
|
| Une seule origine HTTPS : Laravel sert la SPA construite par Vite (public/build) et le
| service worker a la racine, pour que sa portee couvre toute l'application.
*/

Route::get('/sw.js', [SpaController::class, 'serviceWorker'])->name('pwa.service-worker');
Route::get('/manifest.webmanifest', [SpaController::class, 'manifest'])->name('pwa.manifest');

/*
| Repli SPA pour les URL de navigation du routeur Vue. Exclusions, qui repondent 404 :
|   - api et sous-chemins : JSON 404, jamais la coquille ;
|   - public et sous-chemins : routes publiques (/public/v1), jamais la coquille ;
|   - build et storage : ressources statiques absentes ;
|   - tout chemin dont le dernier segment ressemble a un fichier (extension).
*/
Route::get('/{path?}', [SpaController::class, 'shell'])
    ->where('path', SpaController::SHELL_PATH_PATTERN)
    ->name('spa.shell');

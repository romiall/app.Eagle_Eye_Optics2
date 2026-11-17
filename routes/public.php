<?php

use App\Http\Controllers\PublicBookingController;
use App\Http\Controllers\PublicWebhookController;
use App\Http\Controllers\ShowroomController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Routes publiques (/public/v1)
|--------------------------------------------------------------------------
|
| Préfixe `public` et groupe middleware `api` appliqués par bootstrap/app.php.
| Sans session Sanctum ni cookie du cabinet ; aucune donnée clinique exposée.
*/

Route::prefix('v1')->group(function (): void {
    // Portail de prise de rendez-vous en ligne (L2D02) : prestations publiques, créneaux calculés et demandes.
    Route::get('services', [PublicBookingController::class, 'services'])
        ->name('public.services.index');
    Route::get('slots', [PublicBookingController::class, 'slots'])
        ->name('public.slots.index');
    Route::post('booking-requests', [PublicBookingController::class, 'store'])
        ->middleware('throttle:eeo-public-booking')
        ->name('public.booking-requests.store');

    // Showroom et contenus publics (L3D02) : fiches PUBLIÉES et contenus APPROUVÉS seulement, sans compte ; module
    // « communication » fermé = 404. Lecture seule, limitée par adresse et mise en cache brièvement.
    Route::middleware(['module:communication', 'throttle:eeo-public-read'])->group(function (): void {
        Route::get('showroom', [ShowroomController::class, 'index'])
            ->name('public.showroom.index');
        Route::get('showroom/{slug}', [ShowroomController::class, 'show'])
            ->where('slug', '[a-z0-9-]+')
            ->name('public.showroom.show');
        Route::get('contents', [ShowroomController::class, 'contents'])
            ->name('public.contents.index');
        Route::get('media/{id}', [ShowroomController::class, 'media'])
            ->whereUlid('id')
            ->name('public.media.show');
    });

    // Webhooks entrants vérifiés par signature cryptographique ou jeton secret (L2D09).
    Route::get('webhooks/meta', [PublicWebhookController::class, 'verifyMeta'])
        ->name('public.webhooks.meta.verify');
    Route::post('webhooks/{provider}', [PublicWebhookController::class, 'ingest'])
        ->middleware('throttle:eeo-public-webhook')
        ->name('public.webhooks.ingest');
});

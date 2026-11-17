<?php

use App\Domain\Shared\BusinessError;
use App\Http\Controllers\HealthController;
use App\Http\Errors\ApiErrorRenderer;
use App\Http\Middleware\AssignCorrelationId;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Middleware\RequireAnyPermission;
use App\Http\Middleware\RequireEnabledModule;
use App\Http\Middleware\RequireRecentReauthentication;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        // Pas de `health: '/up'` : la vue par défaut de Laravel charge un script et des fontes de CDN
        // tiers sur l'origine de l'application. La sonde maison est déclarée ci-dessous.
        apiPrefix: 'api',
        then: function (): void {
            // Sonde de santé : sans vue, sans session ni cookie (hors du groupe `web`). Déclarée avant
            // le repli SPA, qui accepterait sinon « /up » comme URL du routeur Vue.
            Route::get('/up', HealthController::class)->name('health');

            // Routes publiques (/public/v1) : JSON uniquement, sans session ni cookie du cabinet.
            Route::prefix('public')->group(base_path('routes/public.php'));

            // Coquille SPA : volontairement hors du groupe `web` (ni session, ni cookie) afin que
            // la réponse soit identique pour tous et précachable par le service worker.
            // Déclarée en dernier : c'est la route de repli, jamais appliquée à /api ni /public.
            Route::group([], base_path('routes/spa.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // La sonde reste joignable en mode maintenance, comme le `health:` de Laravel qu'elle remplace.
        $middleware->preventRequestsDuringMaintenance(except: ['up']);

        // Session SPA Sanctum (cookie du seul domaine applicatif + CSRF), sans jeton d'API personnel.
        $middleware->statefulApi();

        // Aucune page de connexion côté serveur : la connexion est un écran de la SPA. Sans session, un
        // appel /api reçoit 401 AUTH_REQUIRED dans l'enveloppe, même sans en-tête Accept JSON, au lieu
        // d'une redirection vers une route « login » inexistante (erreur 500).
        $middleware->redirectGuestsTo(null);

        // En-têtes de protection sur toutes les réponses : CSP d'origine unique, API no-store (fichier 09).
        $middleware->append(SecurityHeaders::class);

        // Identifiant de corrélation dès l'entrée : journaux, audit et réponses d'erreur (fichier 08).
        $middleware->prepend(AssignCorrelationId::class);

        $middleware->alias([
            'active' => EnsureUserIsActive::class,
            'any-permission' => RequireAnyPermission::class,
            'module' => RequireEnabledModule::class,
            'reauthenticated' => RequireRecentReauthentication::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Un refus métier (droit, validation, conflit) est une réponse attendue, pas une erreur : il n'est
        // pas journalisé avec sa pile d'appels, qui pourrait porter des arguments (identifiant, saisies).
        $exceptions->dontReport([BusinessError::class]);

        // Toute erreur sous /api est du JSON, quel que soit l'en-tête Accept (jamais la coquille SPA),
        // dans l'enveloppe du fichier 08 : error.code, error.message, error.fields, correlation_id.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api', 'api/*', 'public', 'public/*') || $request->expectsJson(),
        );
        $exceptions->render(
            fn (Throwable $exception, Request $request) => $request->is('api', 'api/*', 'public', 'public/*')
                ? ApiErrorRenderer::render($exception, $request)
                : null,
        );
    })->create();

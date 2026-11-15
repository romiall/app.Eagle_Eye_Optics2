<?php

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
|
| Application privée servie par une seule origine (fichiers 05 et 23) : la SPA, l'API et le service
| worker partagent l'origine du sous-domaine. Aucune origine tierce n'appelle `/api` : aucun en-tête CORS.
|
| Décision L3 (docs/implementation/public-contract.md) : seul `/public/v1/*` (showroom, contenus, services,
| créneaux, demande de réservation) peut être appelé depuis le site existant du cabinet, et SEULEMENT depuis les
| origines listées dans `EEO_PUBLIC_ALLOWED_ORIGINS` (vide par défaut : aucune). Jamais de cookie : la demande
| est anonyme, `supports_credentials` reste faux. Les webhooks (`/public/v1/webhooks/*`) ne sont pas appelés
| par un navigateur : aucun CORS.
*/

$origins = array_values(array_filter(array_map('trim', explode(',', (string) env('EEO_PUBLIC_ALLOWED_ORIGINS', '')))));

return [

    'paths' => $origins === [] ? [] : [
        'public/v1/showroom', 'public/v1/showroom/*', 'public/v1/contents', 'public/v1/media/*',
        'public/v1/services', 'public/v1/slots', 'public/v1/booking-requests',
    ],

    'allowed_methods' => ['GET', 'POST', 'OPTIONS'],

    'allowed_origins' => $origins,

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Accept', 'Content-Type', 'Idempotency-Key'],

    'exposed_headers' => [],

    'max_age' => 600,

    'supports_credentials' => false,

];

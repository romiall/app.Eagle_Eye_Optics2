<?php

/*
|--------------------------------------------------------------------------
| Commandes console et planification
|--------------------------------------------------------------------------
|
| Aucune commande de démonstration. Les commandes applicatives sont des classes de
| app/Console/Commands. Planification : une seule entrée cron sur l'hébergement,
| « * * * * * php artisan schedule:run » (docs/implementation/deploiement.md).
*/

use Illuminate\Support\Facades\Schedule;

// Exports contrôlés (X02) : production des archives demandées et expiration après 48 h.
Schedule::command('eeo:exports:process')->everyMinute()->withoutOverlapping();

// Alertes de seuil bas et de péremption (L1D03) : évaluation périodique dédupliquée sans spam.
Schedule::command('eeo:stock:evaluate-alerts')->everyFiveMinutes()->withoutOverlapping();

// Boîte d'envoi externe (L2D01) : traitement borné avec backoff exponentiel et idempotence.
Schedule::command('eeo:integrations:outbox')->everyMinute()->withoutOverlapping();

// Réconciliation périodique des intégrations (L2D09) : webhooks vérifiés, tentatives et agendas.
Schedule::command('eeo:integrations:reconcile')->everyFiveMinutes()->withoutOverlapping();

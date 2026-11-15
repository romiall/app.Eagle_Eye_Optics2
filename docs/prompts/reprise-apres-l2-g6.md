# Prompt de reprise après la session « L1+G5 et L2+G6 » (2026-11-15)

À coller dans une NOUVELLE discussion Claude Code ouverte sur le dossier local du projet (`c:\xampp\htdocs\Socle_Eagle_Eye_Optics_2026-10-14`, poste Windows).

```text
Tu reprends, sur ma machine locale (Claude Code, poste Windows), le développement de l'application Eagle's Eye Optics Medical sur la branche `claude/l1-stock-complet`. Réponds en français. Lis d'abord `CLAUDE.md`, puis va droit aux fichiers cités ci-dessous sans relire tout le dépôt.

CONTEXTE ET MISSION
Une autre session agentique a implémenté les lots L1 (`L1D01` à `L1D09` + gate `G5`) et L2 (`L2D01` à `L2D10` + gate `G6`) sur la branche `claude/l1-stock-complet`, avant de s'arrêter proprement par épuisement de quota.
Ta mission, dans cet ordre strict :
1. Vérifier méticuleusement la conformité du travail L1+G5 et L2+G6 déjà committé sur `claude/l1-stock-complet` par rapport aux spécifications (`specifications/10-automatisations-et-integrations.md`, `specifications/14-recette-et-scenarios.md`, `specifications/20-modele-relationnel.md`, `specifications/24-taches-developpement.md`, `specifications/25-validation-et-bascule.md`) et aux règles d'architecture de `CLAUDE.md`.
2. Corriger tous les écarts ou erreurs constatés (à commencer par le point `MutationRoutesTest` identifié ci-dessous) et faire passer `bash tools/dev/phase-check.sh --with-e2e` à 100 % au vert.
3. Enchaîner avec le dernier lot restant du projet : **L3 (`L3D01` à `L3D05`) + gate `G7`**, puis lancer la validation finale complète `bash tools/dev/tester-projet.sh --ici --garder-mysql`.

ÉTAT EXACT DE LA BRANCHE `claude/l1-stock-complet` AU 2026-11-15
1. Lot L1 + Gate G5 :
   - Livrables `L1D01` (Fournisseurs & réceptions), `L1D02` (Inventaires & écarts), `L1D03` (Alertes stock & péremptions), `L1D04` (Atelier optique), `L1D05` (Mouvements de caisse & dépenses), `L1D06` (Rapprochements par canal), `L1D07` (Devis versionnés & conversion), `L1D08` (Dédoublonnage & fusion patients), `L1D09` (Rapports de gestion multi-domaines) et `docs/evidence/G5.md` committés et vérifiés.
2. Lot L2 + Gate G6 (`L2D01` à `L2D10`) :
   - Contrat OpenAPI (`contracts/tools/build_openapi.py`, `contracts/openapi.yaml` : 195 opérations `IMPLEMENTED`), ressources JSON (`contracts/schemas/resources/communication.json`, `public.json`) et types TS (`resources/frontend/domain/contracts/generated.ts`) générés et synchronisés.
   - Backend L2 sous `app/Support/Integrations/*`, `app/Domain/Operations/{IntegrationAccounts,IntegrationHealth,OutboxProcessor,WebhookInboxService,IntegrationReconciler}.php`, `app/Domain/Scheduling/{PublicBooking,CalendarOutboxConsumer,CalendarWebhookConsumer}.php`, `app/Domain/Crm/{ProspectContacts,CrmMirror,CrmOutboxConsumer,CrmWebhookConsumer,KnowledgeBase,LimitedAssistant,AssistantTools,HumanHandoff}.php`, `app/Domain/Communication/{ConsentLedger,MessageTemplates,ReminderPolicies,SendTransactionalMessage,AudienceSegments,Campaigns,CommunicationOutboxConsumer,MessagingWebhookConsumer,Rules/CommunicationRules}.php`.
   - Routes câblées dans `routes/api.php`, `routes/public.php`, `routes/console.php` (`eeo:integrations:outbox`, `eeo:integrations:reconcile`) et `app/Providers/AppServiceProvider.php`.
   - Frontend L2 livré et câblé dans `resources/frontend/app/router.ts`, `navigation.ts` (module `communication` avec `delivered: true`), `pages/manager/Integrations.vue` et `pages/communication/{CommunicationHomePage,PublicBookingsAdminPage,Knowledge,CrmLinks,Handoffs,Consents,Campaigns,OutboxAndWebhooks}.vue`, fiches d'aide `resources/frontend/domain/help/content/pages-communication.ts`, `pages.ts` et `profiles.ts`.
   - Tests L2 :
     - PHPUnit L2 (`tests/Feature/Integrations/*`, `tests/Feature/Communication/*`, `tests/Feature/Crm/*`, `tests/Feature/Scheduling/GoogleCalendarAndPublicBookingTest.php`) : **26 tests, 737 assertions, 0 échec**.
     - Vitest : **176 fichiers (3 461 tests)** tous verts (`communication-pages.test.ts` 14/14, `content-guards.test.ts` 138/138, `profiles.test.ts` corrigé et vert, `no-float.test.ts` 2/2, `openapi.test.ts` 6/6).
     - Playwright E2E : `tests/e2e/l2-integrations.spec.ts` (**2/2 passés** sur build de production Vite), `help.spec.ts` (15/15), `shell.spec.ts` (9/9), `smoke.spec.ts` (9/9).
   - Documentation G6/L2D10 rédigée : `docs/runbooks/integration-incidents.md`, `docs/evidence/integrations.md`, `docs/evidence/G6.md`.

ÉCARTS IDENTIFIÉS À CORRIGER EN PRIORITÉ PAR CLAUDE CODE (AVANT DE CLÔTURER G6)
1. **`tests/Feature/Application/MutationRoutesTest.php` (1 seul échec restant sur les 2 648 tests PHPUnit)** :
   - Lors du passage de `phase-check.sh`, `MutationRoutesTest::test_chaque_route_de_mutation_de_l_api_est_classee` a signalé les 35 routes de mutation L2 (`POST|PATCH api/v1/integrations/...`, `api/v1/crm/...`, `api/v1/communication/...`, `api/v1/public-bookings/...`) car leurs contrôleurs (`IntegrationController`, `WebhookAdminController`, `GoogleCalendarController`, `CrmController`, `KnowledgeController`, `AssistantHandoffController`, `CommunicationController`, `CampaignController`, `PublicBookingController`) héritent de `Controller` et appellent leurs services de domaine (`TransactionRunner`) directement au lieu de passer par `CommandController::dispatchCommand` (ou d'être classés dans `MutationRoutesTest` avec passage par `CommandBusProbe`).
   - Vérifie la règle F07 (`docs/implementation/command-bus.md` et `MutationRoutesTest.php`) et aligne proprement ces routes/contrôleurs pour que `MutationRoutesTest` passe sans affaiblir le garde architectural (`CentralPathGuardTest`).
2. **Mise à jour de `docs/implementation/task-status.json` et `docs/implementation/progress.md`** :
   - Passe `L2D01` à `L2D10` et `G6` au statut `IN_REVIEW` dans `docs/implementation/task-status.json` (sans jamais modifier `specifications/developpement/backlog.json` — vérifie avec `python specifications/developpement/verifier_plan.py`).
   - Consigne le bilan factuel L1+G5 et L2+G6 dans `docs/implementation/progress.md`.
3. **Audit de conformité L1 & L2** :
   - Vérifie l'absence totale des mots interdits (`payé`, `payée`, `soldé`, `soldée`, `acquitté`, `acquittée`, `gratuit`, `offert`), l'isolation clinique sur toutes les sorties externes, et lance `bash tools/dev/phase-check.sh --with-e2e`.

SUITE DU DÉVELOPPEMENT À RÉALISER ENSUITE : LOT L3 (`L3D01` à `L3D05`) + GATE `G7`
Une fois L2+G6 validé et committé :
- **L3D01 (`existing-site.md`, `public-contract.md`)** : audit du site vitrine existant et contrat de raccordement public (`routes/public.php`, `contracts/schemas/resources/public.json`).
- **L3D02 (`catalog_publications`, `catalog_media`, `public_contents`)** : publication gouvernée du showroom optique (articles avec `public_visibility = true`, sans prix d'achat ni stock détaillé, médias approuvés avec note de droits, contenus publics limités avec approbation gérante `PUBLISHED`), endpoints publics (`GET /public/showroom`, `GET /public/contents`) et écran d'administration manager (`Publications.vue`) + fiche d'aide.
- **L3D03 (`public_booking_requests` raccordé au showroom + anti-abus)** : rattachement facultatif `catalog_publication_id` sur la demande publique de rendez-vous, page publique de réservation/showroom Vue (`resources/frontend/pages/public/`), durcissement anti-abus (honeypot / rate-limit / validation), et test Playwright `tests/e2e/public-booking.spec.ts` (scénarios AT30, AT31, AT32).
- **L3D04 (`docs/implementation/domain-email.md`, `docs/evidence/domain-checks.md`)** : configuration SPF / DKIM / DMARC, vérifications de domaine et délivrabilité sans envoi réel non sollicité.
- **L3D05 (`docs/user-guide/`, `docs/evidence/handover.md`, `docs/evidence/delivery-final.md`)** : guides utilisateurs par rôle (accueil, professionnel, caisse, gérante), manuel de remise et transfert de propriété.
- **G7 (`docs/evidence/G7.md`, `docs/evidence/requirements-final.json`)** : clôture de la recette globale (AT01–AT45, IT01–IT22, exigences EE), mise à jour de `task-status.json` et `progress.md`, `python specifications/developpement/verifier_plan.py`, puis exécution complète de `bash tools/dev/tester-projet.sh --ici --garder-mysql`.

ENVIRONNEMENT WINDOWS LOCAL (RAPPEL)
- MySQL 8.4 de test sur le port `3316` (`powershell -ExecutionPolicy Bypass -File tools/dev/mysql-windows.ps1 -Action status` ou `start`).
- Variables à exporter dans chaque commande :
  `EEO_TEST_DB_PORT=3316 EEO_REQUIRE_MYSQL=1 EEO_TEST_REUSE_SCHEMA=1 OPENSSL_CONF='C:\php84\extras\ssl\openssl.cnf' PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:\Users\SMART\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'`
- Sur ce poste Windows avec PHP 8.4 CLI, utiliser `php -d opcache.enable=1 -d opcache.enable_cli=1 -d opcache.jit=disable` si OPcache JIT provoque un crash CLI.
- Ne jamais pousser sur un dépôt distant sans demande explicite.
```

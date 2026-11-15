# Preuves de validation — Intégrations, Communication & CRM (L2D01–L2D10)

## 1. Périmètre couvert

- **L2D01** : Comptes connecteurs chiffrés au repos (`integration_accounts`, `external_links`), mode `fake` / `live` / `disabled`, supervision `/parametres/integrations` (`GET /api/v1/integrations/health`, `POST /api/v1/integrations/accounts/{id}/test`), réauthentification gérante HTTP 423 et masquage intégral des secrets.
- **L2D02** : Synchronisation Google Agenda (`calendar_sync_states`, `calendar_blocks`, gestion `410 Gone` par resynchronisation complète) et portail de réservation publique (`public_booking_requests`) isolé de `patient_records`.
- **L2D03** : Prospects administratifs (`prospect_contacts`) et miroir Kommo CRM (`crm_leads`, `crm_conversations`) sans donnée clinique ni tarifaire.
- **L2D04** : Base de connaissances gouvernée (`knowledge_entries`, `knowledge_entry_versions`) avec cycle brouillon → approbation gérante (`knowledge.approve`) → publication unique active.
- **L2D05** : Assistant borné déterministe (`assistant_runs`) sourcé uniquement sur les révisions publiées, refus clinique automatique (`CLINICAL_REFUSAL_HANDOFF`) et reprise humaine (`conversation_handoffs`).
- **L2D06** : Registre immuable des consentements (`communication_consents`, destination chiffrée et hachée, numéro masqué en lecture) et modèles de messages versionnés (`message_templates`, `message_template_versions`).
- **L2D07** : Politiques de relance (`reminder_policies`) et envois transactionnels dédupliqués (`message_attempts`) depuis les tâches de contact (`contact_tasks`).
- **L2D08** : Segments d’audience strictement administratifs (`audience_segments`) et campagnes (`campaign_definitions`, `campaign_recipients`) avec approbation exacte `CAMPAIGN_SEND`, gel et revérification d’opt-out avant envoi.
- **L2D09** : Boîte de réception de webhooks signés (`webhook_inbox`), processeur d’outbox (`outbox_events`), commandes CLI `eeo:integrations:outbox` et `eeo:integrations:reconcile`, et écran `/communication/boite-envoi`.
- **L2D10** : Matrice de sécurité, anti-rejeu, coupe-circuit `disabled`, isolation inter-cabinets, RBAC et parcours E2E.

## 2. Défauts réels détectés et corrigés pendant L2D10

1. **`app/Domain/Communication/ConsentLedger.php` (`requireActiveGrant`)** :
   - *Constat* : lorsqu’un patient mettait à jour son numéro de téléphone sur `patient_records`, `requireActiveGrant()` testait les destinations candidates puis retombait à tort sur une recherche par sujet seul, acceptant un ancien consentement accordé sur l’ancien numéro.
   - *Correction* : lorsque des destinations directes existent sur la fiche pour le canal demandé et qu’aucune ne porte de consentement `GRANTED`, `requireActiveGrant()` lève immédiatement `409 STATE_TRANSITION_REFUSED` (`current_status: 'MISSING'` ou `'REVOKED'`).
2. **`resources/frontend/domain/communication/types.ts` & `resources/frontend/pages/communication/Campaigns.vue`** :
   - *Constat* : l’écran de création de segment envoyait les clés `target_type: 'ALL'`, `visited_within_days`, `has_upcoming_appointment`, `has_open_quote`, rejetées en `422 VALIDATION_FAILED` par `CommunicationRules::ALLOWED_SEGMENT_KEYS`.
   - *Correction* : alignement du formulaire et du domaine frontend sur le contrat serveur (`subject_type: 'BOTH' | 'PATIENT' | 'PROSPECT'`, `last_visit_days`, `min_appointments`, `has_quote`).
3. **`tests/e2e/prepare-env.mjs`** :
   - Ajout de `EEO_INTEGRATIONS_KEY` et `EEO_DESTINATION_HASH_SALT` dans l’environnement `APP_ENV=e2e` (en complément de `EEO_INTEGRATIONS_MODE=fake`).
4. **`app/Support/Integrations/WebhookSignatureVerifier.php`** :
   - Ajout de `#[\SensitiveParameter]` sur les paramètres `$secret` des méthodes de vérification (`SecurityHardeningTest`).

## 3. Preuves exécutées et résultats observés

- **PHPUnit (suites L2 dédiées sur MySQL 8.4 `eeo_test`)** :
  `vendor/bin/phpunit tests/Feature/Integrations tests/Feature/Communication tests/Feature/Crm tests/Feature/Scheduling/GoogleCalendarAndPublicBookingTest.php`
  → **`OK (26 tests, 737 assertions)`** (`IntegrationSecurityAndReplayTest`, `IntegrationHealthAndOutboxTest`, `WebhookInboxAndReconcileTest`, `CampaignsTest`, `ConsentAndTemplateTest`, `TransactionalMessagingTest`, `AssistantAndHandoffTest`, `KnowledgeBaseTest`, `KommoMirrorTest`, `GoogleCalendarAndPublicBookingTest`).
- **Vitest (gardes d’aide, contrats, domaine sans flottant, écrans L2, profils)** :
  - `tests/frontend/communication/communication-pages.test.ts` → **`14 passed`**
  - `tests/frontend/help/content-guards.test.ts` → **`138 passed`**
  - `tests/frontend/domain/no-float.test.ts` → **`2 passed`**
  - `tests/frontend/openapi.test.ts` → **`6 passed`**
- **Playwright E2E (`APP_ENV=e2e`, Chromium, MySQL 8.4 `eeo_e2e_test`, build de production Vite)** :
  - `npx playwright test tests/e2e/l2-integrations.spec.ts` → **`2 passed`** (parcours gérante complet sur `/parametres/integrations`, `/communication`, `/communication/reservations`, `/communication/connaissances`, `/communication/crm`, `/communication/assistant`, `/communication/consentements`, `/communication/campagnes`, `/communication/boite-envoi` + contrôle mobile 360 px + absence des termes financiers interdits + isolation RBAC accueil/caissière).
  - `help.spec.ts` (`15 passed`), `shell.spec.ts` (`9 passed`), `smoke.spec.ts` (`9 passed`).

## 4. Point d’attention : soldé le 2026-11-15

- **`tests/Feature/Application/MutationRoutesTest.php`** : les 35 routes de mutation L2 (`api/v1/integrations/*`, `api/v1/crm/*`, `api/v1/communication/*`, `api/v1/public-bookings/*`) utilisent des services applicatifs transactionnels (`TransactionRunner` + `AuditRecorder` + `IdempotencyStore` + `OutboxWriter`) depuis des contrôleurs qui héritent de `Controller` au lieu d’être enregistrées dans `MutationRoutesTest` ou de passer par `CommandController`. À arbitrer et aligner lors de la revue de conformité.

**Suite (2026-11-15).** Les routes d'écriture de L2 ont été alignées sur le chemin central de commandes : 26 passent par le bus, 9 opérations à appel fournisseur et 1 lecture portée par un POST sont classées et prouvées une à une. Détail et preuves : `docs/evidence/G6.md`, section 5, et `docs/implementation/command-bus.md`.


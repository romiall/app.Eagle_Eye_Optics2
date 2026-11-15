# Procédure d’exploitation et reprise sur incident des intégrations (L2 / G6)

Ce document décrit les gestes d’exploitation, de diagnostic et de reprise sans perte pour les connecteurs externes L2 (Google Agenda, Kommo CRM, Meta WhatsApp / Messenger / Instagram, SMS et SMTP), la boîte d’envoi transactionnelle (`outbox_events`), la réception webhook signée (`webhook_inbox`) et l’assistant borné.

## 1. Principes de sûreté et coupe-circuit

- **Aucune suppression destructrice** : les tables `outbox_events`, `webhook_inbox`, `communication_consents`, `message_attempts` et `audit_events` conservent leur historique.
- **Coupe-circuit global (`EEO_INTEGRATIONS_MODE`)** :
  - `fake` : exécution locale déterministe (tests, recette et E2E sans appel réseau).
  - `live` : appels HTTP réels via `app/Support/Integrations/*` après configuration chiffrée du compte dans `/parametres/integrations`.
  - `disabled` : coupe tout appel externe et toute acceptation webhook entrante (`HTTP 503 DEPENDENCY_UNAVAILABLE` sur `/public/webhooks/{provider}`, lots outbox laissés en `PENDING` / `skipped` sans perte de messages).
- **Coupe-circuit par compte connecteur** : dans `/parametres/integrations`, basculer le compte concerné au statut `DISABLED` ou `ERROR` (opération sensible soumise au contrôle `integration.manage` et à réauthentification gérante HTTP 423) suspend immédiatement l’émetteur sans toucher aux files internes ni aux données cliniques.
- **Isolation clinique stricte** : aucun diagnostic, acuité visuelle, réfraction, ordonnance ou note clinique ne transite vers Google Agenda, Kommo CRM, les campagnes ou les charges `outbox_events`.
- **Aucune fuite de secret** : les identifiants sont chiffrés au repos (`EEO_INTEGRATIONS_KEY`) et les destinations sont chiffrées / hachées (`EEO_DESTINATION_HASH_SALT`), jamais renvoyées en clair en lecture API ou dans l’interface.

## 2. Supervision et outils disponibles

| Usage | Écran / Endpoint | Commande CLI |
| --- | --- | --- |
| Santé globale et comptes | `/parametres/integrations` (`GET /api/v1/integrations/health`) | — |
| Boîte d’envoi & webhooks | `/communication/boite-envoi` (`GET /api/v1/integrations/outbox`, `GET /api/v1/integrations/webhooks`) | — |
| Traitement d’un lot outbox | Bouton « Traiter un lot outbox » (`POST /api/v1/integrations/outbox/process`) | `php artisan eeo:integrations:outbox --clinic=<ULID> --limit=50` |
| Rattrapage global (outbox + webhooks + tentatives + agendas) | Bouton « Lancer le rattrapage global » (`POST /api/v1/integrations/reconcile`) | `php artisan eeo:integrations:reconcile --clinic=<ULID> --limit=50` |
| Synchronisation Google Agenda | `/communication/reservations` (`POST /api/v1/integrations/google-calendar/sync`) | Incluse dans `eeo:integrations:reconcile` |
| Synchronisation Kommo CRM | `/communication/crm` (`POST /api/v1/crm/kommo/sync`) | — |

## 3. Scénarios d’incident et reprise manuelle

### A. Expiration de jeton de synchronisation Google Agenda (`410 Gone` / `STALE` / `ERROR`)

1. Vérifier dans `/parametres/integrations` la présence et la connectivité du compte connecteur `GOOGLE` (bouton « Tester la connexion »). Si les jetons OAuth sont révoqués, mettre à jour les identifiants dans `/parametres/integrations`.
2. Ouvrir `/communication/reservations`, sélectionner la ressource concernée et cocher **Resynchronisation complète**, puis cliquer sur **Synchroniser Google Agenda** (ou appeler l’équivalent API avec `full_resync: true`).
3. Vérifier que `calendar_sync_states.status` revient à `READY` (« Synchronisé ») et que les créneaux bloqués externes (`calendar_blocks`) sont à jour dans l’agenda.

### B. Webhooks entrants rejetés, signatures invalides ou rejeu (`webhook_inbox`)

1. Consulter `/communication/boite-envoi` (section Journal des webhooks entrants).
2. **`REJECTED` pour signature ou mode désactivé** :
   - Contrôler que `EEO_INTEGRATIONS_MODE` n’est pas à `disabled`.
   - Vérifier la concordance du secret webhook chiffré sur le compte `integration_accounts` concerné (`KOMMO`, `META_*`, `SMS`, `GOOGLE`), puis rejouer la notification côté fournisseur ou via un événement signé valide.
3. **`PENDING` ou `FAILED` sur un webhook déjà vérifié** :
   - Déclencher **Lancer le rattrapage global** dans `/communication/boite-envoi` (ou `php artisan eeo:integrations:reconcile --clinic=<ULID> --limit=50`) pour retraiter la file de façon idempotente.
   - En cas de doublon exact (`provider_event_key` ou `payload_hash` déjà enregistré), `webhook_inbox` ignore la réexécution sans créer de doublon métier.

### C. Accumulation ou échec sur la boîte d’envoi (`outbox_events`)

1. Filtrer `/communication/boite-envoi` par statut `PENDING` puis `FAILED` et relever `last_error_code`.
2. Corriger la cause racine (connecteur en `ERROR`, clé de chiffrement manquante entraînant `DEPENDENCY_UNAVAILABLE`, quota ou indisponibilité réseau temporaire).
3. Relancer un lot borné depuis l’interface (**Traiter un lot outbox**, 1 à 200 événements) ou en CLI :
   - Tous types : `php artisan eeo:integrations:outbox --clinic=<ULID> --limit=50`
   - Filtré par type : `php artisan eeo:integrations:outbox --clinic=<ULID> --limit=50 --event-type=AppointmentConfirmed`
4. Si une tâche `FAILED` dépasse le nombre maximal de tentatives automatique après panne réseau prolongée, corriger le connecteur puis inspecter les `message_attempts` correspondants dans `/communication/consentements` avant toute relance ciblée.

### D. Révocation d’opt-in (opt-out) ou arrêt d’une campagne en cours

1. **Opt-out patient/prospect** : dans `/communication/consentements`, enregistrer immédiatement l’opt-out (« Révoquer immédiatement (opt-out) ») sur la destination exacte (numéro ou courriel), le canal et la finalité. L’historique `communication_consents` ajoute un événement `REVOKED` sans modifier le passé ; tout nouvel envoi transactionnel est refusé (`409 STATE_TRANSITION_REFUSED`) et toute campagne gèle/exclut la cible à la réévaluation pré-envoi.
2. **Pause d’urgence d’une campagne** : dans `/communication/campagnes`, ouvrir le pilotage de la campagne concernée, saisir un motif administratif explicite et cliquer sur **Suspendre** (`PAUSE`). Les destinataires non encore soumis cessent immédiatement d’être exécutés.

### E. Dérive d’assistant borné / demande à caractère clinique

1. L’assistant refuse automatiquement les requêtes cliniques (`CLINICAL_REFUSAL_HANDOFF`) et place la conversation en `HUMAN_TAKEOVER`.
2. Pour forcer un basculement manuel ou reprendre une conversation, utiliser `/communication/assistant` (**Basculer vers un conseiller humain** avec motif administratif, puis **Rendre la main à l’assistant** uniquement une fois l’échange clos).
3. Toute mise à jour d’horaires, d’adresse ou de procédure publique doit passer par une nouvelle révision approuvée et publiée dans `/communication/connaissances` — jamais par édition directe des réponses d’assistant.

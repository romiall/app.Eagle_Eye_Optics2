# Chemin central de commandes (F07)

F07 construit le chemin que **toute mutation critique** emprunte, quelle que soit son origine : route directe d'un compte connecté, commande rejouée depuis un poste (synchronisation) ou tâche planifiée. Une seule transaction MySQL porte, dans cet ordre : les droits, les verrous, l'idempotence, les faits de l'action, l'audit, l'outbox et le journal des changements. Contrat : fichier 23, « Chemin transactionnel central » ; fiche 24, F07 ; scénarios AT11, AT12, AT13, AT19, AT38 ; exigences EE017, EE024, EE045.

Ce document décrit ce qui est réellement implémenté et prouvé. Les actions métier (paiement, facture, consultation…) arrivent avec leurs tâches (P01, B02–B08, C01–C04…) et se branchent sur ce chemin sans le modifier : elles reçoivent notamment l'identifiant de leur ligne d'idempotence, que leurs faits portent (`payments.idempotency_id`, `refunds`, `deliveries`, `stock_movements`… NOT NULL).

## Flux d'une commande

```text
Controller / sync / job
  └─ CommandBus::dispatch(Command, CommandContext, clé d'idempotence)
       1. commande connue du registre ; clé d'idempotence valide (obligatoire si la commande l'exige)
       2. charge validée contre le schéma de contracts/ (Opis, JSON Schema 2020-12)      → 422 VALIDATION_FAILED
       3. pré-contrôle des droits, sans verrou (refus rapide, source admise)              → 403 ACTION_FORBIDDEN
       ── TransactionRunner : UNE transaction, rejouée en entier sur interblocage ──
       4. verrou exclusif du cabinet                                         (rang 10)
       5. appareil, si commande de poste                                     (rang 20)
       6. ligne d'idempotence                                                (rang 30)
            • déjà COMMITTED, même empreinte  → résultat durable rendu, AUCUN effet rejoué
            • déjà COMMITTED, autre empreinte → 409 IDEMPOTENCY_PAYLOAD_MISMATCH
              (empreinte = intention + source, auteur, poste et grant : un autre profil du poste = conflit)
       7. droits RELUS en base sous le verrou (compte actif, permission effective) ou contexte historique du grant
       8. réservation de la clé (statut RECEIVED, dans la même transaction)
       9. action (reçoit l'identifiant de la ligne d'idempotence) : autres verrous dans l'ordre du contrat 23,
          recalcul, écriture des faits
      10. audit → outbox → journal des changements → résultat idempotent COMMITTED
       ── COMMIT ──
      11. réponse (jamais avant le commit)
```

Un refus métier (`BusinessError`) ou toute exception **annule tout**, y compris la réservation de la clé : il n'est jamais COMMITTED, et la même intention peut être renvoyée quand l'état a changé. Une intention modifiée prend une nouvelle clé ; les tentatives de transport gardent l'ancienne.

## Ordre unique des verrous (L0)

`LockRank` fixe l'ordre, `TransactionLocks` le fait respecter : demander un verrou de rang inférieur à un verrou déjà tenu, ou des verrous d'un même rang par clés décroissantes, lève `LockOrderViolation` **avant toute requête**. Redemander un verrou déjà tenu est permis. Les identifiants d'un même rang sont triés par la classe, pas par l'appelant. Le verrou **partagé** du cabinet ne devient jamais exclusif (refus, même sans autre verrou) : une mutation prend l'exclusif d'emblée.

| Rang | Verrou | Table et clé |
| --- | --- | --- |
| 10 | cabinet | `clinics.id` (exclusif ; partagé pour les lecteurs du pull) |
| 15 | compte | `users` du cabinet (décision F05 : cabinet → compte) |
| 20 | appareil | `enrolled_devices` |
| 30 | idempotence | `idempotency_requests` (cabinet, espace de noms, commande, clé) |
| 40 | séquences de numéros | `document_sequences` par (type, année) croissants |
| 45 | dossier patient | `patient_records` (P01 : version lue sous verrou avant modification) |
| 46 | visite | `visits` (P03) |
| 47 | consultation | `consultations` (C01) |
| 50 | propriété de facture | `invoice_write_owners` par facture |
| 60 | facture | `invoices` |
| 70 | session de caisse | `cash_sessions` |
| 80 / 81 / 82 | positions, lots, quotas de stock | `stock_positions`, `stock_lots`, `device_stock_allocations`, identifiants triés |
| 90 | approbation | `approvals` |

Deux transactions qui prennent leurs lignes dans cet ordre ne s'attendent pas en cycle sur ces lignes. Les verrous d'intervalle d'InnoDB (insertion d'une clé absente dans `idempotency_requests`, par exemple) peuvent encore produire un interblocage entre deux **cabinets** différents : il est rejoué en entier par `TransactionRunner` (au plus trois tentatives), comme tout interblocage. Avec un seul cabinet, toutes les mutations sont déjà sérialisées par son verrou. Toutes les lectures sont filtrées par `clinic_id`.

## Idempotence

| Élément | Règle |
| --- | --- |
| Clé | En-tête `Idempotency-Key` (8 à 128 caractères parmi lettres, chiffres, `.`, `_`, `:`, `-`) ; pour un poste, l'identifiant de la commande. **Insensible à la casse**, comme la collation de la colonne : ramenée en majuscules avant tout usage (un ULID l'est déjà) |
| Espace de noms | `user:<compte>` pour la route directe, `device:<poste>` pour la synchronisation, `job:<tâche>` ; une clé n'est jamais partagée entre comptes |
| Empreinte | SHA-256 du JSON canonique de l'intention (nom, agrégat, version attendue, charge) **et de son origine** (source, auteur, poste, grant). Clés triées par octets (ordre total), sensible à toute différence de valeur, `null` différent de `0`. Le même identifiant de commande présenté par un autre profil du poste, ou sous un autre grant, est un conflit (fichier 19 : « même ID, autre hash ») |
| Reprise d'une ligne non committée | Ligne RECEIVED ou FAILED (jamais produite aujourd'hui, la réservation étant annulée avec la transaction) : reprise seulement pour la même empreinte, sinon conflit ; l'empreinte n'est jamais réécrite |
| Rejeu (réponse perdue) | Même clé, même empreinte : le résultat stocké est rendu, l'action n'est pas rejouée (AT11, AT38). MySQL normalise l'ordre des clés du JSON stocké : même contenu, ordre éventuellement différent |
| Conflit | Même clé, autre empreinte : `409 IDEMPOTENCY_PAYLOAD_MISMATCH`, effet d'origine intact (AT11) |
| Droits au rejeu | Route directe : droits actuels relus (un compte désactivé depuis ne relit rien). Poste : pas de réévaluation, son autorisation historique a été jugée au commit ; une révocation ultérieure ne fait pas perdre son ACK |
| Sans clé | Admis pour les opérations qui ne l'exigent pas (comptes, cabinet) : aucune ligne d'idempotence |

## Autorisation

| Source | Moment | Règle |
| --- | --- | --- |
| DIRECT | avant tout verrou | permission effective du compte (refus rapide) |
| DIRECT | sous le verrou du cabinet | compte relu en base : actif, permission effective. Une désactivation survenue pendant l'attente du verrou est prise en compte |
| SYNC | sous le verrou | **contexte historique** du grant (`offline_grants`) évalué à l'instant déclaré par le poste, voir ci-dessous |
| JOB | — | identité de service ; la commande doit admettre la source JOB. L'audit enregistre « Système (<tâche>) » |

Contexte historique d'une commande de poste (`HistoricalAuthorization`, fonction pure et **déterministe**, tolérance `eeo.offline.max_clock_skew_seconds` = 300 s). L'heure serveur de référence est `receivedAt`, la **première réception** de la commande, conservée par l'inbox de synchronisation (O05), jamais l'heure courante : la même commande jugée de nouveau reçoit le même verdict, et un renvoi plus tard ne transforme pas une revue en acceptation.

1. grant d'un autre appareil ou d'un autre auteur, ou permission absente du `permissions_snapshot` → **refus** (`GRANT_EXPIRED_OR_REVOKED`, 403) ;
2. instant du poste antérieur à la dernière heure serveur qu'il connaissait (antidatage), postérieur à la première réception par le serveur, ou antérieur à l'émission du grant → **revue** (`AUTHORIZATION_REVIEW_REQUIRED`, 409) ;
3. instant postérieur à la validité du grant → refus ;
4. grant révoqué : poste qui avait resynchronisé après la révocation → refus ; action antérieure à la révocation → **accordée** (une révocation d'aujourd'hui ne détruit pas une pièce d'hier) ; action autour de la révocation sans que le poste ait pu la connaître → revue.

Ces règles d'horloge posent la structure ; **O02** (préparation du poste, « horloge suspecte ») les confirmera. Le bus rend le verdict ; **O05** le rend durable : une commande en revue est conservée avec son résultat `CONFLICT_REQUIRES_REVIEW` (originaux compris) et n'est plus rejugée automatiquement. Aucune route de synchronisation n'existe avant O05.

## Effets écrits au commit

| Effet | Table | Règle |
| --- | --- | --- |
| Audit | `audit_events` (append-only, triggers) | Auteur et corrélation du **contexte**, jamais de la charge. Aucun secret dans le diff. Décision sur la chaîne `previous_hash` : **non tenue** (voir « Décisions ») |
| Événement | `outbox_events` (PENDING) | Seuls les 13 événements du contrat F06 ; charge validée contre `contracts/events/<type>.v<version>.json` (charge minimale, aucune donnée clinique). Un événement hors contrat est un défaut de programmation |
| Changement à diffuser | `sync_change_log` (append-only) | Écrit **uniquement** sous le verrou exclusif du cabinet (`LogicException` sinon) |
| Résultat idempotent | `idempotency_requests` (COMMITTED) | Objet JSON de la réponse |

Aucun effet externe n'a lieu dans la transaction : un test d'architecture interdit à `app/Application` **et à tout `app/Domain`** (actions, règles, services appelés sous verrou) les façades et classes de messagerie, réseau, fichiers, processus et files (`Http`, `Mail`, `Notification`, `Storage`, `File`, `Process`, Guzzle…), les fonctions PHP de réseau, de fichier et de processus (`file_put_contents`, `fopen`, `curl_*`, `exec`…), `event()`, `dispatch()`, `->notify()` et les services résolus par leur nom (`app('mailer')`) ; il se contrôle lui-même sur des exemples de chaque forme. Aucun fichier hors de `TransactionRunner` et de l'outillage de schéma n'ouvre, ne valide ni n'annule une transaction (API Laravel, PDO brut, `START TRANSACTION`/`COMMIT` écrits à la main), et aucun contrôleur n'écrit en base. Les envois passent par l'outbox, lue par un worker **après** le commit.

Toute route d'API qui modifie des données est classée et prouvée à l'exécution (`MutationRoutesTest`) : contrôleur `CommandController`, façade d'administration F05 dont la requête réelle atteint le chemin central (sonde du bus), ou opération de session listée (connexion, déconnexion, réauthentification, mot de passe personnel). Une nouvelle route non classée fait échouer le test.

## Publication du pull ordonnée sous le verrou du cabinet

`sync_change_log.change_sequence` est un AUTO_INCREMENT attribué à l'**insertion**, non au commit. Toute mutation centrale tient le verrou exclusif de la ligne du cabinet de son premier verrou jusqu'au commit, et n'écrit ses changements que dans cette fenêtre : pour un cabinet, l'ordre des numéros est l'ordre des commits.

`ChangeFeed::page()` lit une page sous le verrou **partagé** de la même ligne : il attend la fin de toute mutation en cours, puis voit tous les changements committés du cabinet. Un numéro manquant ne peut être qu'un trou d'AUTO_INCREMENT (transaction annulée), jamais un changement à venir ; un MAX global observé n'est jamais utilisé. La page porte une **borne supérieure** : le numéro du dernier changement balayé, retenu ou non par le filtre de compartiments, pour que le curseur avance aussi sur des entrées masquées. Le curseur opaque signé et la validation côté client après commit local de la page sont ceux de la tâche **O05**.

## Interblocage et attente de verrou

| Cas | Comportement |
| --- | --- |
| Interblocage (1213) | Transaction **rejouée en entier** (verrous, lectures, écritures), au plus 3 tentatives, attente croissante et décalée de 10 à 40 ms puis 20 à 80 ms |
| Tentatives épuisées | `503 SERVER_BUSY` + `Retry-After: 2`, aucune modification ; le client renvoie la même demande avec la même clé |
| Attente de verrou dépassée (1205) | Pas de relance interne (trois attentes de plusieurs secondes dépasseraient le délai de la requête) : `503 SERVER_BUSY` |
| Délai de verrou | `innodb_lock_wait_timeout` de la session fixé à `eeo.transactions.lock_wait_timeout_seconds` (10 s par défaut, variable `EEO_LOCK_WAIT_TIMEOUT`) |
| Transaction imbriquée | `run()` la refuse hors des tests (`LogicException`) : une relance sur interblocage ne rejouerait que le point de sauvegarde. Un service du domaine appelé À LA FOIS par une action du bus et par une tâche utilise `joinOrRun()` : dans une unité de travail déjà ouverte par l'exécuteur il s'y joint (l'interblocage remonte à l'unité extérieure, qui rejoue TOUT), sans elle il se comporte comme `run()` |

## Ajouter une commande (liste de contrôle)

1. Le schéma de la charge existe dans `contracts/commands/<Commande>.v1.json` (F06), avec sa permission et sa route directe.
2. Une action `CommandHandler` : `permissions()` (celles du contrat) et `handle(Command, CommandContext, TransactionLocks, ?string $idempotencyId)` qui prend ses verrous par `TransactionLocks` **dans l'ordre**, recalcule (règles pures de F08, `docs/implementation/rules.md`), écrit ses faits — avec `$idempotencyId` pour les tables qui l'exigent — et rend un `CommandOutcome` (réponse, audit, événements, changements). Aucune transaction, aucun appel externe.
3. Un `CommandDefinition` (nom, action, sources admises, schéma, `idempotencyRequired = true`), déclaré par le module dans le registre (voir `AccessCommands`). `CentralPathGuardTest` vérifie qu'il correspond au contrat F06.
4. Le contrôleur hérite de `CommandController` et n'a que le rôle de la ligne suivante : `$this->dispatchCommand($request, new Command(...))`. C'est une classe abstraite et non un trait, pour que l'analyse statique vérifie ce chemin avant même le premier contrôleur métier.
5. Tests : calcul et refus, idempotence (rejeu, contenu différent), retour arrière à chaque point (`Checkpoint`), concurrence réelle entre deux connexions, fermeture et reprise pour une commande disponible hors-ligne (fiche 23).

## Mutations de comptes et du cabinet (F05) sur le chemin central

`CreateStaffMember`, `UpdateStaffMember`, `SetStaffPermissionOverride`, `ResetStaffPassword` et `UpdateClinicSettings` conservent leur signature (contrôleurs, scénarios de concurrence et tests de F05 inchangés) mais ne sont plus que des **façades** : validation de la saisie et hachage du mot de passe hors transaction, puis `CommandBus::dispatch`. Leurs règles vivent dans `app/Domain/Access/Handlers/` et s'exécutent sous le verrou du cabinet. Ce sont des opérations en ligne seulement : pas de schéma dans `contracts/commands/`, pas de clé d'idempotence imposée (la version attendue et l'unicité de `login` et `email` en tiennent lieu ; le contrat F06 les déclare `x-idempotency: none`).

La connexion, le changement de son propre mot de passe, la mise en service, la procédure de secours et les comptes de démonstration gardent leur logique (verrou partagé du cabinet, audit d'échec sans auteur, saisie console) mais ouvrent leur transaction par `TransactionRunner`, comme tout le reste.

## La couche L2 sur le chemin central (2026-11-15)

**Constat.** Les écritures de la couche L2 (intégrations, CRM, base de connaissances, communication, réservations
publiques) avaient été écrites avec leur propre mécanique : chaque service prenait lui-même le verrou du cabinet, réservait
et rejouait la clé d'idempotence et écrivait son audit, derrière des contrôleurs qui ne passaient pas par
`CommandController`. C'était un SECOND chemin, que F07 interdit, et `MutationRoutesTest` l'a relevé (36 routes hors du bus).

**Décision.** Chaque route d'écriture de DONNÉES passe par le bus, une commande par intention (22 noms, 11 actions) :

| Famille | Commandes | Droit (l'un suffit) |
| --- | --- | --- |
| Compte d'intégration | `SaveIntegrationAccount` | `integration.manage` (+ réauthentification récente, middleware) |
| Google Agenda, réservations publiques | `SaveCalendarSyncState`, `ConfirmPublicBooking`, `RejectPublicBooking` | `integration.manage` ; `agenda.write` |
| CRM | `SaveProspectContact`, `LinkProspectPatient`, `HandoffConversation`, `ResumeConversationBot` | `communication.manage` ou `agenda.write` ; `communication.manage` ou `patient.read` ; `communication.manage` |
| Base de connaissances | `SaveKnowledgeEntry`, `CreateKnowledgeVersion`, `ApproveKnowledgeVersion`, `PublishKnowledgeVersion` | `communication.manage` (l'approbation exige en plus `knowledge.manage`, jugé par le service) |
| Communication | `RecordConsent`, `RevokeConsent`, `SaveMessageTemplate`, `CreateMessageTemplateVersion`, `ApproveMessageTemplateVersion`, `SaveReminderPolicy`, `SaveAudienceSegment`, `SaveCampaign`, `FreezeCampaign`, `PauseCampaign` | `communication.manage` |

- **Une action = `ServiceCommandHandler`** (`app/Application/`) : elle valide le corps contre la requête HTTP du contrat, appelle le
  service du domaine EXISTANT sans clé d'idempotence (c'est le bus qui rejoue une réponse perdue) et rend `['id' => …]`.
  Jamais une ligne entière : une ligne peut porter un secret ou une destination chiffrée, que la ligne d'idempotence
  conserverait. Le contrôleur relit l'agrégat pour répondre. Les services gardent leur audit.
- **Routes inchangées** : mêmes adresses, mêmes corps, mêmes réponses. Ce qui change : la clé `Idempotency-Key` (8 à 128 caractères,
  l'écran l'envoie déjà partout) est jugée par le bus, le droit est relu sous le verrou du cabinet, et la clé d'une
  même intention avec un autre contenu est `409 IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **`TransactionRunner::joinOrRun()`** : les services L2 sont aussi appelés par des tâches (consommateurs d'outbox, webhooks) :
  dans une action du bus ils se joignent à sa transaction, hors du bus ils ouvrent la leur.
- **Preuve** : `MutationRoutesTest` (aucune route d'écriture non classée), `L2CommandsOnBusTest` (registre, verrou du cabinet,
  rejeu, contenu différent, clé manquante, droit refusé), `CentralPathGuardTest` (inchangé : aucune transaction hors de l'exécuteur,
  aucun effet externe dans le domaine, tout gestionnaire enregistré).

### Opérations à appel fournisseur

Neuf routes ne sont PAS des commandes, parce qu'aucune action du bus ne peut appeler Google, Kommo ou la messagerie (« aucun
effet externe dans la transaction ») : sonde de connexion d'un compte, traitement de l'outbox, rattrapage des événements,
synchronisation Google, synchronisation des leads Kommo, tour de l'assistant, envoi d'un message, rattrapage d'une
tentative, exécution d'une campagne. Chacune s'exécute en DEUX transactions (`TransactionRunner`) autour de l'appel. Celles qui envoient ou que l'on rejoue (envoi d'un message, rattrapage d'une tentative, exécution d'une campagne, synchronisation Google, tour de l'assistant) tiennent leur PROPRE idempotence (clé obligatoire, même table `idempotency_requests`) et ne renvoient jamais à l'aveugle un message dont le résultat est inconnu ni ne dupliquent un tour ou un handoff ; l'écran conserve la même clé d'idempotence sur reprise réseau. La synchronisation des leads, le traitement de l'outbox et le rattrapage sont sûrs à répéter (clé externe ou événement déjà traité). Elles sont nommées une à une dans `MutationRoutesTest::PROVIDER_OPERATION_ROUTES` (jamais une famille de routes) ; `OperationRoutesGuardTest` prouve qu'elles exigent un compte et un droit, qu'aucun appel au fournisseur ou au moteur externe (`LimitedAssistant`) n'est écrit dans la fonction d'une transaction, et que le garde reconnaît un appel mal placé. L'aperçu d'une campagne (`campaigns/{id}/preview`) est une LECTURE portée par un POST : `CampaignsTest` prouve qu'il n'émet aucune instruction d'écriture.

### Entrées publiques sans compte

Le dépôt d'une demande de réservation par un visiteur (`POST /public/v1/booking-requests`) et les webhooks entrants ne sont pas
des commandes PAR NATURE : aucun compte, donc aucun acteur ni droit à relire. Ils se protègent par leur limite de débit, leur
clé d'idempotence propre, la vérification de signature (webhooks) et le verrou du cabinet que le service prend lui-même.
`MutationRoutesTest` ne les voit pas (préfixe `public/`) : cette limite est documentée ici, pas masquée.

## Consultation de l'audit

`GET /api/v1/audit-events` (permission `audit.read`, gérante seulement) : lecture seule, limitée au cabinet, du plus récent au plus ancien, 50 événements par page, filtres `target_type`, `target_id`, `from`, `to` (instants UTC à la milliseconde), `page`. Réponse conforme à `AuditEventPage` (F06).

## Décisions et limites

| Sujet | Décision |
| --- | --- |
| Chaîne de hash de l'audit | **Non tenue.** Elle exigerait de sérialiser toute écriture d'audit sous un verrou exclusif, or des événements s'écrivent hors du chemin central (échecs de connexion, sous verrou partagé) : une chaîne incomplète donnerait de fausses alertes, et le fichier 09 rappelle qu'elle ne protège pas d'un administrateur qui possède toutes les clés. Protection retenue : `event_hash` par ligne, triggers UPDATE et DELETE, export quotidien hors serveur (X02) |
| Sérialisation | Le verrou du cabinet sérialise **toutes** les mutations centrales d'un cabinet (choix simple du contrat 23). Débit non mesuré à ce stade : à mesurer avec les cibles du fichier 05 avant toute optimisation, sans retirer les invariants |
| Règles d'horloge des postes | Posées ici, à confirmer en O02 |
| Réponse rejouée | Rendue depuis une colonne JSON MySQL : contenu identique, ordre des clés éventuellement normalisé |
| Curseur du pull | Borne supérieure et ordre de publication prouvés ; curseur opaque signé = O05 |
| Objet vide de la charge | La requête est décodée en tableaux PHP, qui confondent `{}` et `[]` : le validateur relit un tableau **vide** comme l'objet vide là où le schéma attend un objet, puis revalide ; une liste non vide n'est jamais transformée, et la relecture ne rend jamais valide une charge invalide. L'empreinte ne distingue pas ces deux formes : le schéma, appliqué avant elle, fixe le type de chaque champ |
| Revue d'autorisation | Verdict déterministe (référence `receivedAt`) ; sa conservation durable et sa résolution humaine appartiennent à O05 |
| Environnement | Preuve sur MySQL 8.4.9 ; à rejouer sur la version de l'hébergeur (Q01) |

## Revue contradictoire et traitement (2026-10-15)

Un vérificateur indépendant et adverse (lecture seule, base jetable `eeo_review_test`, sondes hors du dépôt) a conclu `pass=false` sur les commits `1b0600d` et `599ef06` : chemin direct solide (AT11, AT12, AT38, droits relus sous verrou, publication ordonnée), mais quatre constats majeurs. Tous sont traités ; chaque correction a son test, qui échoue sans elle.

| Constat | Gravité | Traitement | Preuve |
| --- | --- | --- | --- |
| Rejeu d'une commande de poste lié ni à l'auteur ni au grant : l'accueil, sans `payment.collect`, recevait le résultat de la caisse en présentant son identifiant de commande | Majeur, reproduit | `Command::fingerprint()` : empreinte = intention + source, auteur, poste, grant ; autre profil ou autre grant → `IDEMPOTENCY_PAYLOAD_MISMATCH`, aucun effet | `CommandBusTest::test_le_rejeu_d_une_commande_de_poste_est_lie_a_son_auteur_et_a_son_grant`, `CommandHashTest` |
| Revue non durable : le jugement d'horloge suivait l'heure courante, un renvoi plus tard acceptait la commande | Majeur, reproduit | Référence = `receivedAt` (première réception, conservée par l'inbox O05), obligatoire dans `CommandContext::sync` ; conservation du résultat de revue = O05, documenté | `HistoricalAuthorizationTest::test_une_revue_reste_une_revue_quand_la_commande_est_jugee_de_nouveau_plus_tard` |
| Les faits ne pouvaient pas porter leur `idempotency_id` (NOT NULL) : B04 aurait dû modifier le bus | Majeur, déduit | `CommandHandler::handle(…, ?string $idempotencyId)` : identifiant de la ligne réservée, jamais null quand la clé est obligatoire | `CommandBusTest::test_l_action_recoit_l_identifiant_de_sa_ligne_d_idempotence` |
| « Aucun effet externe » et « toujours par ce chemin » non prouvés : garde limitée à `app/Application`, motifs incomplets, test de conformité au catalogue sans objet | Majeur, reproduit | Garde étendue à `app/Domain`, motifs complétés (fichiers, processus, Guzzle, conteneur, `notify`), contrôle de transaction (PDO, SQL écrit à la main), contrôleurs sans écriture, auto-contrôle des motifs ; preuve d'exécution par route (`MutationRoutesTest`). Le test du catalogue F06 vaudra pour la première commande du catalogue (P01) | `CentralPathGuardTest`, `MutationRoutesTest` |
| Clé comparée sans la casse (collation) | Mineur, reproduit | Insensibilité assumée et rendue explicite : clé ramenée en majuscules avant tout usage | `CommandBusTest::test_la_cle_d_idempotence_est_insensible_a_la_casse_et_conservee_en_majuscules` |
| Tri des clés de l'empreinte non transitif ; `{}` confondu avec `[]` | Mineur, reproduit | Tri `SORT_STRING` (ordre total) ; `stdClass` vide conservé ; limite des tableaux PHP documentée | `CommandHashTest` (six ordres, une empreinte) |
| `{}` changé en `[]` à la validation | Mineur, reproduit | Relecture guidée par le schéma (voir « Décisions ») | `ContractValidatorTest` |
| Montée du verrou partagé en exclusif ; comptes verrouillés hors de `TransactionLocks` | Mineur, reproduit | Montée refusée ; rang 15 « compte » et `TransactionLocks::account()` dans les trois gestionnaires de comptes | `TransactionLocksTest` |
| « Ne peuvent pas s'interbloquer » faux entre cabinets (verrous d'intervalle) | Mineur, reproduit | Texte corrigé ; l'interblocage est rejoué par `TransactionRunner` | Ce document, section « Ordre unique des verrous » |
| Mutations non détectées : filtre `clinic_id` de `byId()` et `idempotency()`, tolérance autour d'une révocation | Mineur, déduit | Tests d'isolation entre cabinets et de bornes de tolérance | `TransactionLocksTest::test_un_compte_ou_une_cle_d_un_autre_cabinet_reste_invisible`, `HistoricalAuthorizationTest::test_la_tolerance_d_horloge_s_applique_avant_la_revocation` |
| Retours arrière « à chaque point » par points de sauvegarde dans `CommandBusTest` ; interblocage rejoué prouvé sur `TransactionRunner` seul | Mineur, déduit | Portée exacte écrite dans « Preuves » ; le retour arrière réel et le processus tué avant le commit restent prouvés entre vraies connexions | Ce document, `CommandBusConcurrencyTest` |
| `IdempotencyStore::restart` réécrivait l'empreinte ; borne `to` de l'audit à la milliseconde pleine | Mineur, déduit | Reprise refusée pour une autre empreinte, empreinte jamais réécrite ; borne `to` incluse jusqu'à la fin de sa milliseconde | `AuditEventsRouteTest::test_la_borne_to_inclut_toute_la_milliseconde_affichee` |

## Preuves

| Test | Prouve |
| --- | --- |
| `tests/Unit/Application/HistoricalAuthorizationTest.php` | Contexte historique : 15 cas (accordé, refusé, revue, tolérance, révocation postérieure, verdict inchangé au nouveau jugement, tolérance avant révocation) |
| `tests/Unit/Application/TransactionRunnerTest.php` | 3 tentatives, attentes bornées, `SERVER_BUSY`, aucune relance d'un refus métier |
| `tests/Unit/Application/CommandHashTest.php` | Empreinte stable, sensible aux valeurs, `null` ≠ 0, tri des clés total, objet vide, empreinte liée à l'auteur, au poste et au grant |
| `tests/Feature/Application/TransactionLocksTest.php` | Ordre des 13 rangs, refus avant toute requête, verrou partagé jamais monté en exclusif, rang du compte, isolation des cabinets (séquences, comptes, clés d'idempotence) |
| `tests/Feature/Application/CommandBusTest.php` | Effets écrits ensemble, rejeu, conflit, refus sans effet, retour arrière à chaque point (dans la transaction de test, donc par point de sauvegarde), droits, sources, poste, rejeu lié à l'auteur et au grant, identifiant d'idempotence transmis à l'action, clé insensible à la casse, version attendue (AT19), audit non modifiable (AT13) |
| `tests/Feature/Application/CommandHttpTest.php` | AT11 et AT38 au niveau de l'API : en-tête, rejeu identique, 409, 422, 401, 403, 503 + `Retry-After` |
| `tests/Feature/Application/ChangeFeedTest.php` | Pages bornées, borne qui avance sur les entrées filtrées, isolation des cabinets |
| `tests/Feature/Application/AuditEventsRouteTest.php` | Route d'audit conforme au contrat, droits, filtres (borne `to` à la milliseconde), pagination |
| `tests/Feature/Application/ContractValidatorTest.php` | Objet vide attendu par le schéma accepté, liste non vide jamais relue, charge invalide toujours refusée |
| `tests/Feature/Application/CentralPathGuardTest.php` | Aucun contrôle de transaction hors de l'exécuteur, aucun effet externe dans `app/Application` et `app/Domain` (motifs auto-contrôlés), aucun contrôleur qui écrit en base, commandes enregistrées conformes au contrat F06 |
| `tests/Feature/Application/MutationRoutesTest.php` | Toute route d'API de mutation classée ; chaque façade d'administration atteint réellement le chemin central |
| `tests/Concurrency/CommandBusConcurrencyTest.php` | Entre **vraies connexions MySQL** : AT12 (deux règlements de 40 000 sur 50 000), double clic, conflit de contenu, publication du pull qui attend la mutation en cours, ordre des numéros = ordre des commits, interblocage InnoDB réel rejoué par `TransactionRunner`, refus sans attendre le verrou, droit retiré pendant l'attente, retour arrière réel, processus tué avant le commit |

Lancement : voir [testing.md](testing.md) (poste Windows : moteur MySQL local sans Docker, réutilisation du schéma).

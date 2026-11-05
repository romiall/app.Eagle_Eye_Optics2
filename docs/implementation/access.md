# Identité, droits et session du personnel (F05)

Ce document décrit ce qui est implémenté et testé pour l'accès du personnel. Les exigences viennent des fichiers 09 (sécurité) et 23 (identité et droits). Les écrans viendront avec F09. Le coffre local et les grants hors-ligne relèvent de O01 et O02.

Deux revues indépendantes du commit 343a448 (attaque et conformité, sur MySQL 8.4.9 et base jetable) ont produit des constats, corrigés ensuite avec des tests de non-régression. Leur liste et leur traitement figurent en fin de document.

## Comptes, profils et permissions

| Élément | Règle appliquée |
| --- | --- |
| Compte | Table `users` du catalogue : id ULID, `login` (minuscules, `[a-z0-9._-]`, unique par cabinet), `display_name`, `password_hash` (bcrypt), `active`, `version`. Un compte n'est jamais supprimé : il est désactivé. Pas de `remember_token` ni de « rester connecté ». |
| Affectation de masse | Seuls `display_name` et `email` sont affectables en masse. `clinic_id`, `password_hash`, `active` et `version` ne sont écrits que par les actions du domaine Accès (test `ConfigurationContractTest`). |
| Profils | Les quatre profils des sources (`MANAGER`, `RECEPTION`, `CLINICIAN`, `CASHIER`), dans `user_roles`. Une révocation est datée et la ligne conservée ; une ré-attribution réactive la ligne, et l'historique complet reste dans l'audit. |
| Permissions | Les 49 codes seedés (`permissions`, `role_permissions`) font autorité. Aucun paquet de rôles ni référentiel parallèle. |
| Permissions effectives | Règle pure `App\Domain\Access\PermissionResolver` : compte désactivé = aucune permission ; profils attribués et non révoqués ; dérogations nominatives non expirées (`user_permissions`), où un refus l'emporte sur le profil et une autorisation s'ajoute. Recalculées à chaque requête : désactivation, révocation et dérogation s'appliquent immédiatement. |
| Contrôle | Chaque code est une capacité Gate (`can:users.manage`, `$user->can('payment.collect')`). Les Policies de ressource (patients, pièces, PDF) s'appuieront sur ces codes et sur le filtre de cabinet. |
| Cabinet | Décidé côté serveur : `EEO_CLINIC_ID`, sinon l'unique cabinet de la base, sinon refus 503 `CLINIC_NOT_CONFIGURED`. Le navigateur ne choisit jamais un `clinic_id`. Toutes les requêtes filtrent le cabinet du compte connecté : un identifiant d'un autre cabinet répond 404. |
| Gestion des comptes | Réservée au profil Gérante (`users.manage`, fichier 09). Ce droit ne s'attribue ni ne se retire par dérogation (seul CLEAR d'une ligne existante est admis). Personne ne modifie ses propres profils. |

## Session SPA (Sanctum)

- **Session par cookie du seul sous-domaine**, jamais de jeton permanent dans la PWA. `SANCTUM_STATEFUL_DOMAINS` doit contenir exactement l'origine de l'application (par exemple `app.eagleeyeoptic.com`). Sans session, la connexion est refusée explicitement (400 `SESSION_REQUIRED`) au lieu de « réussir » sans effet. Les jetons d'accès personnels Sanctum sont désactivés : un en-tête `Authorization: Bearer` est ignoré (401, jamais 500).
- **Cookie** `Secure`, `HttpOnly` et `SameSite=Lax`. Durée d'inactivité de 30 minutes (`SESSION_LIFETIME`). Sessions en base (`fw_sessions`, user_id ULID).
- **CSRF** : la SPA appelle `GET /api/sanctum/csrf-cookie`, puis envoie `X-XSRF-TOKEN` sur chaque écriture. Laravel 13 accepte aussi une écriture marquée `Sec-Fetch-Site: same-origin` (Fetch Metadata, en-tête qu'une page ne peut pas forger). Une écriture intersite, ou sans Fetch Metadata et sans jeton, reçoit 419 `SESSION_CONTEXT_EXPIRED` (preuve e2e). Une origine tierce n'obtient jamais de session.
- **Connexion** :
  - recherche dans le seul cabinet configuré ; un identifiant hors du format des comptes est refusé sans recherche, pour que la collation de la colonne (accents, caractères invisibles ignorés) ne fournisse pas de variantes illimitées d'un même compte ;
  - réponse identique pour un identifiant inconnu, un mot de passe faux ou un compte désactivé, avec une seule vérification de hash dans tous les cas (hash factice constant, conservé dans le cache applicatif) ;
  - limites : 5 essais par minute pour un identifiant depuis une adresse, 10 par dix minutes pour un identifiant toutes adresses confondues, 20 connexions par minute par adresse. Le compteur est incrémenté avant la vérification : des requêtes parallèles ne dépassent pas la limite. Au-delà, 429 `RATE_LIMITED` ;
  - l'identifiant de session est renouvelé à la connexion (preuve : `test_la_connexion_et_la_deconnexion_renouvellent_la_session_et_le_jeton_csrf`).
- **Déconnexion** : la session serveur est détruite, un nouvel identifiant anonyme est émis (non attribué au compte) et le jeton CSRF renouvelé. Le verrouillage du coffre local sans perte des pièces relève de O01.
- **Statut relu à chaque requête** (`EnsureUserIsActive`) : un compte désactivé perd sa session même si son cookie existe encore. La désactivation et la réinitialisation suppriment aussi toutes les lignes `fw_sessions` du compte.
- **Changement de son mot de passe** : la session courante reste ouverte (son empreinte de mot de passe est mise à jour), les autres sessions du compte sont fermées. La route partage la limite de la réauthentification (5 par minute, même compte) et chaque échec est journalisé.
- **Réauthentification** (`POST /api/v1/auth/reauthenticate`) : elle est valable 15 minutes (`EEO_REAUTHENTICATION_TTL`) pour la gestion des comptes, les paramètres du cabinet et, plus tard, les approbations et exports globaux. Sans elle, 423 `REAUTHENTICATION_REQUIRED`. Une nouvelle connexion l'annule.
  - **Une seule garde pour toutes les écritures sensibles** (B06) : le middleware `reauthenticated` (`RequireRecentReauthentication`), qui lit l'instant de confirmation rangé dans la session du compte connecté (clé `eeo.reauthenticated_at`). Il protège les comptes et le cabinet (F05), les règles fiscales et le stock initial (B01, I00), la décision d'une approbation (`POST approvals/{id}/decision`) et les corrections des pièces (`POST payments/{id}/reversals`, `POST invoices/{id}/credit-notes`, `POST invoices/{id}/refunds`, B07, B08). Aucune route ne réimplémente sa propre vérification ; `x-reauthentication` du contrat OpenAPI est vérifié contre ce middleware (`OpenApiRoutesTest`).
  - Liée à la session : la connexion régénère la session et oublie la confirmation, la déconnexion détruit la session ; la limite de 5 essais par minute et par compte (`EEO_RATE_REAUTHENTICATE`, relevée seulement pour les parcours e2e) et l'audit (`auth.reauthenticated`, `auth.reauthentication_failed`, sans secret) sont ceux de F05.
  - Côté écran : sur 423, `PasswordConfirmDialog` confirme le mot de passe du compte connecté puis l'écran reprend la MÊME commande avec la même clé d'idempotence (`useMutation().retry()`) ; `ReauthDialog` reste la reconnexion d'une session EXPIRÉE (401/419). Le 423 du middleware précède l'idempotence : rien n'est enregistré avant la confirmation.
- **Approbations exactes** (B06) : demande par tout compte qui a `approval.request`, décision par la gérante (`approval.decide` ET la permission que l'approbation remplace), jamais par la demandeuse, après réauthentification ; consommation unique et liée au contenu exact dans la transaction de l'opération. Détail : [billing.md](billing.md), « Approbations exactes (B06) ».

## Routes de F05 (`/api/v1`)

| Route | Accès | Notes |
| --- | --- | --- |
| `POST auth/login` | Public, session SPA | Corps `{login, password}` ; réponse : compte, profils, permissions, cabinet (nom, fuseau, monnaie) |
| `POST auth/logout`, `GET auth/me` | Connecté | `me` est toujours `no-store` |
| `POST auth/reauthenticate` | Connecté | 5 essais par minute et par compte (compteur partagé avec `auth/password`) |
| `POST auth/password` | Connecté | `{current_password, password, password_confirmation}` ; version incrémentée ; limite partagée |
| `GET clinic/settings` | `users.manage` | Paramètres administratifs complets (contrat 23 : Policy gérante). Les autres profils reçoivent le nom, le fuseau et la monnaie dans `auth/me`. |
| `PATCH clinic/settings` | `users.manage` + réauthentification | Le fuseau, la monnaie et `production_documents_enabled` sont interdits par l'API (422) ; `document_settings` est un objet JSON |
| `GET clinic/document-identity` | l'un des droits d'un document (`invoice.read`, `invoice.create`, `invoice.issue`, `payment.collect`, `cash.own_session`, `cash.manage`, `credit_note.issue`, `refund.execute`, `finance.global.read`, `clinical.read`, `clinical.export`) | Identité imprimable du cabinet (nom, coordonnées, identifiant fiscal, mentions, réglages des documents, documents de test ou non) ; sans `id` ni autre paramètre administratif. Ajoutée en phase 1 : sans elle, une ordonnance imprimée par le professionnel n'aurait aucune coordonnée. Ne dépend d'aucun module ; l'accueil (aucun document) reçoit 403 |
| `GET staff`, `GET staff/{id}` | `users.manage` | Paginé (50) ; filtré par cabinet |
| `POST staff` | `users.manage` + réauthentification | `{login, display_name, email?, password, roles[]}` |
| `PATCH staff/{id}` | `users.manage` + réauthentification | `{expected_version, display_name?, email?, active?, roles?, reason?}` ; motif obligatoire pour désactiver ou retirer un profil |
| `POST staff/{id}/permissions` | `users.manage` + réauthentification | `{expected_version, permission_code, effect: ALLOW/DENY/CLEAR, reason, expires_at?}` ; `expires_at` est un instant UTC `AAAA-MM-JJTHH:MM:SS.mmmZ`, jamais une date civile convertie à minuit UTC ; la version du compte est incrémentée |
| `POST staff/{id}/password` | `users.manage` + réauthentification | Réinitialisation par la gérante : `{expected_version, password, password_confirmation, reason}` ; ferme les sessions du compte ; refusée pour un compte gérante |

Garde-fous métier :
- le cabinet garde toujours une gérante active disposant effectivement de `users.manage` (409 `LAST_MANAGER_REQUIRED`, défense en profondeur : l'auteur est lui-même une gérante active distincte de la cible) ;
- une gérante ne se désactive pas elle-même, ne s'applique pas de dérogation et ne modifie pas ses propres profils (409 `SELF_DEACTIVATION_FORBIDDEN`, `SELF_OVERRIDE_FORBIDDEN`, `SELF_ROLE_CHANGE_FORBIDDEN`) ;
- elle ne réinitialise pas son propre mot de passe par cette route (409 `SELF_RESET_FORBIDDEN`), ni celui d'une autre gérante (409 `MANAGER_RESET_REQUIRES_CONSOLE` : sinon elle pourrait se connecter sous son nom) ;
- une version obsolète est refusée (409 `VERSION_CONFLICT`) ;
- une création ou une modification concurrente du même identifiant ou courriel répond 422, jamais 500.

**Verrous** (contrat 23, ordre cabinet → compte) : toute mutation de compte prend d'abord le verrou exclusif de la ligne du cabinet, puis relit l'auteur sous ce verrou (compte actif, profil Gérante, `users.manage` effectif) : une gérante désactivée ou rétrogradée pendant que sa requête attend ne peut plus agir. La connexion et le changement de mot de passe prennent d'abord le verrou partagé du cabinet, puis la ligne du compte : aucun ordre inverse, donc aucun interblocage avec l'administration. Chaque transaction est relancée au plus trois fois sur interblocage, sans effet partiel. Les calculs bcrypt sont faits hors transaction.

## Enveloppe d'erreur (fichier 08)

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "fields": { "login": ["…"] } }, "correlation_id": "01J…" }
```

Les codes en usage sont : `AUTH_REQUIRED` 401, `SESSION_CONTEXT_EXPIRED` 419, `ACTION_FORBIDDEN` 403, `RESOURCE_NOT_FOUND` 404, `VERSION_CONFLICT` 409, `VALIDATION_FAILED` 422, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, auxquels s'ajoutent les codes propres à F05 ci-dessus (`REAUTHENTICATION_REQUIRED`, `SESSION_REQUIRED`, `CLINIC_NOT_CONFIGURED`, `LAST_MANAGER_REQUIRED`, `MANAGER_RESET_REQUIRES_CONSOLE`, `SELF_*`), tous déclarés dans `contracts/schemas/error.json` (F06). L'identifiant de corrélation est repris de `X-Correlation-Id` s'il est sûr, sinon généré. Il figure dans la réponse, dans l'en-tête, dans les journaux et dans l'audit. Les messages de validation sont en français (`lang/fr/validation.php`).

**Journaux** : un refus métier (`BusinessError`) n'est pas journalisé avec sa pile d'appels. Les paramètres secrets portent `#[\SensitiveParameter]`, ce qu'un test vérifie pour toute l'application, et les valeurs liées n'apparaissent jamais dans le message d'une erreur SQL (`mask_bindings_in_exception_messages`). La check-list d'hébergement exige en plus `zend.exception_ignore_args=On`.

## Mots de passe et procédure de secours

- Au moins 12 caractères, avec lettres et chiffres, au plus 72 octets (limite de bcrypt), et différent de l'identifiant.
- Aucune vérification par un service externe, donc aucun appel réseau.
- **Aucun mot de passe universel ni par défaut** dans l'application : test `test_aucun_mot_de_passe_universel_n_ouvre_un_compte`.
- La réinitialisation d'un compte non gérante est faite par une gérante, le mot de passe étant transmis en personne. Il n'y a pas de réinitialisation par e-mail, faute de fournisseur actif avant L2/L3 ; la table `fw_password_reset_tokens` n'est donc pas créée.
- **Procédure de secours d'une gérante**, sur le serveur seulement : `php artisan eeo:staff:recover-manager <identifiant> --reason="…"`.
  - Nouveau mot de passe saisi masqué ou lu sur l'entrée standard (`--password-stdin`) ; motif obligatoire ; confirmation explicite.
  - Elle rétablit un compte qui est ou a été gérante : mot de passe, compte actif, profil Gérante, suppression des dérogations `users.manage`, fermeture de toutes ses sessions.
  - Événement d'audit `staff.recovered_by_console` sans auteur authentifié.
  - Elle ne promeut jamais un autre compte (`RECOVERY_TARGET_NOT_MANAGER`).
- Le catalogue n'a pas de colonne pour forcer un changement à la première connexion : la procédure est organisationnelle, et le compte change son mot de passe par `POST auth/password`.

## Mise en service et démonstration

- `php artisan eeo:setup-clinic` crée le cabinet, puis la première gérante, puis son profil MANAGER (`assigned_by` = ce compte désormais existant).
  - Il ne s'exécute qu'une fois (`CLINIC_ALREADY_SET_UP` ensuite). Deux mises en service simultanées sont sérialisées par la ligne de référence du profil Gérante, quel que soit le niveau d'isolation (preuve en `READ COMMITTED`).
  - Le mot de passe est saisi deux fois de façon masquée, ou lu sur l'entrée standard (`--password-stdin`), jamais en argument.
  - Sur un hébergement sans SSH, la procédure locale sécurisée est à définir avec H01 (contrat 23).
- `php artisan eeo:demo:accounts [--output=fichier] [--reset-passwords]` crée quatre comptes fictifs (`demo.gerante`, `demo.accueil`, `demo.professionnel`, `demo.caisse`).
  - Environnements admis : `local`, `testing`, `e2e`, `demo` (liste fermée, jamais en production).
  - Uniquement dans le cabinet « CABINET DE DÉMONSTRATION — DONNÉES FICTIVES », créé si la base est vide. Refusée dès qu'un autre cabinet ou un compte non fictif existe.
  - Mots de passe aléatoires, affichés une seule fois ou écrits dans un fichier créé exclusivement en mode 0600 ; un lien symbolique n'est jamais suivi.
  - `--reset-passwords` ne réactive jamais un compte désactivé et ferme les sessions des comptes régénérés.
  - Les e2e l'utilisent via `tests/e2e/prepare-env.mjs`.

## Audit

Actions journalisées dans `audit_events`, append-only :
- `auth.login`, `auth.login_failed`, `auth.login_refused_inactive` ;
- `auth.logout`, `auth.reauthenticated`, `auth.reauthentication_failed`, `auth.password_changed`, `auth.password_change_failed` ;
- `staff.created`, `staff.updated`, `staff.deactivated`, `staff.permission_override`, `staff.password_reset`, `staff.recovered_by_console` ;
- `clinic.setup`, `clinic.settings_updated`.

Chaque événement porte le nom à la date, l'instant UTC, la cible, le motif, la corrélation, un diff nettoyé et le SHA-256 du contenu. Un événement authentifié porte son auteur. Un échec de connexion n'a pas d'auteur (« Tentative de connexion non authentifiée ») : le compte visé est la cible, et l'identifiant tenté n'est conservé que sous forme d'empreinte HMAC à clé serveur, inattaquable par dictionnaire. Les diffs donnent les valeurs avant et après pour les paramètres du cabinet, et l'état précédent d'une dérogation remplacée ou supprimée. Les mots de passe et hashes sont refusés dans un diff.

La chaîne `previous_hash` (facultative, fichier 09) n'est pas tenue : décision prise en F07, avec ses raisons, dans [command-bus.md](command-bus.md) (« Décisions et limites »).

## Preuves

- `tests/Unit/Access/PermissionResolverTest.php` : 7 cas.
- `tests/Feature/Access/AuthenticationTest.php` :
  - connexion, échecs identiques, 429, autre cabinet, cabinet non configuré, 401 ;
  - déconnexion, réauthentification et son expiration, mot de passe, absence de mot de passe universel, connexion sans session ;
  - renouvellement de la session et du jeton CSRF à la connexion et à la déconnexion, en pilote `database`.
- `tests/Feature/Access/StaffManagementTest.php` :
  - quatre profils et leurs permissions, refus des non-gérantes ;
  - création, validations, version, désactivation qui coupe les sessions ;
  - profils et dérogations immédiats et expirés, réinitialisation, isolement du cabinet ;
  - paramètres réservés à la gérante, avec audit avant/après.
- `tests/Feature/Access/SecurityHardeningTest.php` : non-régression des constats des revues :
  - refus métier non journalisé, mot de passe absent des piles d'appels, paramètres secrets marqués, valeurs SQL masquées ;
  - `users.manage` non délégable, propres profils, gérante protégée, motif et version obligatoires, invariant effectif ;
  - auteur relu sous verrou, filtre de cabinet de l'action ;
  - limite et audit du changement de mot de passe, session courante conservée, autres sessions fermées ;
  - un seul calcul de hash, création concurrente en 422, Bearer en 401 ;
  - variantes d'identifiant, limite par compte, audit sans auteur, audit dans la transaction ;
  - `document_settings` objet, expiration en instant UTC avec message français.
- `tests/Feature/Access/SetupAndDemoCommandsTest.php` :
  - mise en service unique, mots de passe faibles ou différents ;
  - comptes de démonstration aléatoires, refusés en production, hors des environnements admis, avec un cabinet réel ou un compte non fictif ;
  - jamais de réactivation, lien symbolique refusé ;
  - procédure de secours : rétablissement, refus pour un compte jamais gérante, motif et confirmation exigés.
- `tests/Concurrency/AccessLockOrderTest.php` : entrelacements contrôlés, chaque action dans un **processus PHP séparé** (connexion MySQL distincte), sur base jetable, derrière une barrière de verrou :
  - la connexion et le changement de mot de passe attendent le cabinet sans tenir la ligne du compte ;
  - deux gérantes qui se désactivent mutuellement en laissent une active ;
  - deux mises en service simultanées en `READ COMMITTED` ne créent qu'un cabinet.

  Chacune des trois corrections retirée tour à tour fait échouer son test (vérifié).
- `tests/e2e/auth-session.spec.ts`, sur l'application construite avec MySQL :
  - session réelle avec CSRF, `me` `no-store` et cookie HttpOnly ;
  - 419 sans Fetch Metadata ni jeton, et en intersite ;
  - origine tierce sans session ;
  - 403 pour la caisse, 200 pour la gérante ;
  - `/api` authentifiée jamais servie hors ligne par le service worker.

## Constats des revues et traitement

| Constat (revue) | Traitement |
| --- | --- |
| Mot de passe dans `laravel.log` via la pile d'un refus (attaque B1) | `dontReport(BusinessError)`, `#[\SensitiveParameter]` vérifié par test, check-list hébergeur |
| Dérogation `users.manage` → prise de contrôle (attaque M1) | Droit non délégable, propres profils interdits, reset de gérante par console seulement |
| Cabinet sans gérante gestionnaire (attaque M2, conformité 10) | Invariant sur la permission effective, auteur relu sous verrou, procédure de secours |
| `auth/password` sans limite ni audit (attaque M3, conformité M2) | Limite partagée avec la réauthentification, audit des échecs |
| Énumération par le temps de réponse (attaque M4) | Hash factice constant en cache ; test : une seule vérification |
| Course de création → 500 et hash dans le journal (attaque M5, conformité 1) | 422 sur violation d'unicité, valeurs SQL masquées |
| `Bearer` → 500 (attaque M6, conformité M3) | Jetons personnels désactivés ; 401 |
| Démonstration dans un cabinet réel (attaque M7, conformité 15) | Environnements admis, cabinet fictif seulement, pas de réactivation, fichier exclusif |
| Variantes d'identifiant, compteur après vérification (attaque m1, conformité 5) | Refus hors format sans recherche, compteur atomique avant vérification, limite par compte |
| Audit d'échec : auteur = victime, SHA-256 non salé (attaque m2, conformité 6) | Sans auteur, HMAC à clé |
| Session courante fermée au changement de mot de passe (attaque m3, conformité 7) | Empreinte de session mise à jour ; test |
| `document_settings` liste ou `{}` → 500 (attaque m4, conformité 2) | Objet exigé, `{}` conservé |
| Fichier de démonstration suivant les liens (attaque m5) | Création exclusive puis renommage |
| Droits de l'auteur non revérifiés sous verrou (attaque m6, conformité 8) | `StaffAdministration::authorizeLocked` (profil Gérante et permission relus) sous le verrou du cabinet, désormais pris par le chemin central F07 qui relit aussi le compte actif ; tests direct et à processus séparés |
| Interblocage connexion / administration (conformité M1) | Verrou partagé du cabinet d'abord, relances bornées ; test à processus séparés |
| Pas de reset contrôlé pour la gérante (conformité M4) | `eeo:staff:recover-manager` |
| Mutations survivantes (conformité M5) | Tests ajoutés : verrou du cabinet, régénération de session, invalidation à la déconnexion, autres sessions, motifs, auto-reset, audit transactionnel, filtre de cabinet |
| Message `validation.after` (conformité 3) | Traductions ajoutées ; test sans clé brute |
| Expiration à minuit UTC (conformité 4) | Instant UTC exigé |
| Double mise en service en READ COMMITTED (conformité 9) | Sentinelle sur la ligne de référence du profil Gérante |
| Audit sans valeurs utiles (conformité 12) | Avant/après des paramètres, état précédent des dérogations |
| Pas de version attendue sur dérogation et reset (conformité 13) | `expected_version` exigé, version du compte incrémentée |
| `GET clinic/settings` ouvert à tous (conformité 14) | Réservé à `users.manage` |
| Session anonyme attribuée au compte après déconnexion (trouvé en écrivant le test de déconnexion) | Oubli de l'utilisateur du garde Sanctum à la déconnexion ; test |

## Écarts déclarés et décisions à prendre

| Sujet | État |
| --- | --- |
| Matrice 09 et référentiel seedé (qui fait autorité, contrat 23) | Écarts constatés : la caisse n'a ni `credit_note.issue` ni `refund.execute`, alors que 09 prévoit l'exécution d'un avoir ou remboursement « après approbation explicite » ; elle n'a pas `exam_fee.collect`, couvert seulement si `payment.collect` en est un sur-ensemble ; le professionnel a `visit.register` et `agenda.write` général, là où 09 prévoit « RDV de suivi et lecture agenda ». Cohérent avec Q07 (matrice par défaut restrictive) ; à trancher, sans modifier le seed hors du générateur canonique. B06–B08 sont codés avec le seed actuel : la caisse DEMANDE l'approbation, la gérante exécute (directement ou en reprenant l'approbation) ; une dérogation nominative (`credit_note.issue`, `refund.execute`, `payment.reverse`) ouvre l'exécution par la caisse, toujours avec l'approbation exacte. |
| `app/Policies/` (fichier attendu par la fiche F05) | Aucune Policy de ressource n'est nécessaire à F05 : les routes du personnel sont protégées par les codes de permission (Gate) et une recherche filtrée par cabinet. Les Policies de ressource arrivent avec leurs ressources (patients, pièces, documents : F07, B-, D01/D02). |
| MFA de la gérante | Colonnes `mfa_*` présentes ; recommandé par le fichier 09 « dès L0 », obligatoire avant un accès d'administration distant. Aucune tâche du backlog ne le porte : décision à inscrire (registre 15 et section 6 du fichier 25). |
| Réinitialisation par e-mail | Prévue par le fichier 09 (« par email ou gérante ») ; aucun fournisseur actif avant L2/L3. La gérante réinitialise les comptes, et la procédure de secours couvre la gérante. |

## Reste à faire hors F05 (selon le graphe)

| Sujet | Tâche |
| --- | --- |
| ~~Clés d'idempotence et chemin central des mutations de comptes~~ | **Fait en F07** : les cinq mutations de comptes et du cabinet passent par le chemin central ([command-bus.md](command-bus.md)) ; leur idempotence tient à la version attendue et à l'unicité de `login` et `email` (contrat F06 : `x-idempotency: none`) |
| Verrouillage du coffre local à la déconnexion ou à la désactivation, droits locaux bornés | O01, O02 |
| Refus des PDF au mauvais rôle | D01 et D02 (Policies de documents) |
| Écrans, garde de navigation et avertissement d'inactivité | F09 et F10 |
| `trustProxies` (adresse IP réelle pour la limitation et l'audit derrière un proxy) | Avec l'audit de l'hébergeur (Q01) |

## Écrans (F09, phase 1 : module « settings »)

Codés en phase 1, **non exécutés** à la date d'écriture (vérification de fin de phase) :

| Écran | Adresse | Droit | Ce qu'il fait |
| --- | --- | --- | --- |
| Paramètres | `/parametres` | `users.manage` ou `approval.decide` | Cartes « Personnel » et « Cabinet et documents » (gérante) ; « Autorisations » apparaît si l'écran B06 existe (route `approbations`). Rappelle que les modules ouverts appartiennent au déploiement |
| Personnel | `/parametres/personnel` | `users.manage` | Liste (50 par page), profils, état ; « Créer un compte » |
| Créer un compte | `/parametres/personnel/nouveau` | `users.manage` | Nom, identifiant (normalisé en minuscules, même motif que le serveur), courriel, profils, mot de passe initial saisi ou **généré** (aléa du navigateur, 16 caractères sans caractère ambigu). Un mot de passe généré est montré UNE fois après la création, pour être transmis en personne, puis oublié ; jamais dans l'adresse ni le stockage du navigateur |
| Compte | `/parametres/personnel/:id` | `users.manage` | Droits effectifs (calculés par le serveur) ; modification (motif exigé pour désactiver ou retirer un profil) ; dérogation ALLOW/DENY/CLEAR motivée, échéance = fin d'un jour civil du cabinet (jamais minuit UTC), `users.manage` jamais proposé ; réinitialisation du mot de passe (motif, confirmation), jamais pour une gérante ni pour soi. La gérante ne se modifie ni profils ni activation et ne se déroge pas (l'écran ne le propose pas et le dit) |
| Cabinet et documents | `/parametres/cabinet` | `users.manage` | Nom, adresse, téléphone, courriel, identifiant fiscal, mentions, lignes d'en-tête et de pied (6 au plus, 200 caractères), conditions de règlement ; les autres clés de `document_settings` sont conservées. Fuseau, monnaie et documents officiels en lecture seule |
| Changer mon mot de passe | `/mon-compte/mot-de-passe` | tout compte connecté | `POST auth/password` avec le mot de passe actuel ; aucun module |

Toutes les écritures passent par `pages/settings/useAdminWrite.ts` : 423 `REAUTHENTICATION_REQUIRED` ouvre
`PasswordConfirmDialog` (mot de passe de la gérante, `POST auth/reauthenticate`) puis rejoue la MÊME écriture ;
409 (version, garde-fous `LAST_MANAGER_REQUIRED`, `SELF_*`) est dit avec la saisie conservée ; une absence de
réponse est « issue inconnue », jamais un succès supposé. Ces routes n'ont pas de clé d'idempotence (F06) : la
version attendue protège les modifications, l'unicité de l'identifiant protège la création.

Tests écrits : `tests/frontend/settings/{staff-pages,clinic-and-account}.test.ts`, `tests/frontend/domain/staff.test.ts`
(référentiel des droits relu dans le SQL, règles de mot de passe et d'identifiant, échéance au fuseau du cabinet),
`tests/Feature/Access/ClinicDocumentIdentityTest.php`.

## Postes préparés pour le hors-ligne (O02, codé le 2026-10-23, non exécuté)

Module `offline` (fermé par défaut), gérante seulement (`offline.enroll`), réauthentification récente pour toute
écriture (423 sinon), clé d'idempotence obligatoire. Commandes du chemin central EN LIGNE seulement : `EnrollDevice`,
`IssueOfflineGrant`, `RevokeDevice`, `RevokeOfflineGrant`.

| Route | Effet |
| --- | --- |
| `POST /api/v1/devices/enroll` | Enrôle un poste : clé publique ES256 et preuve de possession signée par sa clé privée (cabinet, code, fraîcheur 10 min) ; seule la clé publique est conservée |
| `GET /api/v1/devices`, `GET /api/v1/devices/{id}` | Postes du cabinet (clé publique, statut, responsable, grants actifs) |
| `POST /api/v1/devices/{id}/grants` | Grant signé d'un profil : permissions effectives, compartiments, règles et empreinte du catalogue figés, 72 h par défaut ; un nouveau grant du même profil révoque les précédents |
| `GET /api/v1/devices/{id}/grants` | Grants du poste (ACTIVE, EXPIRED, REVOKED) avec leur jeton |
| `POST /api/v1/devices/{id}/revoke` | Poste REVOKED ou LOST (motif) et tous ses grants révoqués ; connu du poste à sa prochaine connexion |
| `POST /api/v1/offline-grants/{id}/revoke` | Révoque un grant (motif) |
| `GET /api/v1/offline/signing-keys` | Clés PUBLIQUES du serveur à épingler (courante puis retirées) |

Clé privée de signature du serveur : fichier PEM privé créé par `php artisan eeo:offline:signing-key` (`--rotate`,
`--show`), hors de la racine web, hors du dépôt et de MySQL ; elle entre dans la sauvegarde des clés. Sans elle,
l'émission d'un grant répond 409 et rien n'est écrit. Audit : `device.enrolled`, `offline_grant.issued`,
`device.revoked`, `offline_grant.revoked` (jamais de secret ni de donnée patient). Détails et coffre local :
`vault.md`, section « Implémentation (O01, O02) ».

## Qui supprime un brouillon d'examen (2026-10-30, chantier « CRUD des écrans », tranche 1)

Commande `DeleteConsultationDraft` (en ligne seulement ; détail : `clinical.md`, « Modifier et supprimer un examen »).
**Aucune permission nouvelle ni élargie** : le référentiel reste de 49 codes, rien n'est ajouté au semis, aucun droit de
profil ne change.

| Compte | Brouillon qu'il a démarré | Brouillon d'un autre professionnel | Examen en cours ou terminé |
| --- | --- | --- | --- |
| Professionnel (`clinical.write`, `clinical.read`) | Supprime | 403 `ACTION_FORBIDDEN` | 409 `STATE_TRANSITION_REFUSED` |
| Gérante (`clinical.write`, `clinical.read`, `approval.decide`) | Supprime | Supprime | 409 |
| Accueil, caisse (aucun `clinical.*`) | 403 | 403 | 403 |
| Compte dont une dérogation retire `clinical.write` ou `clinical.read` | 403 | 403 | 403 |

L'auteur est `consultations.clinician_id` (le compte qui a démarré l'examen). La gérante est reconnue au code
`approval.decide`, comme partout où elle « modifie le brouillon d'un autre compte » (`ActorRights::manager`) : un
profil qui reçoit ce code par dérogation a donc aussi ce pouvoir sur les brouillons d'examen. L'écran ne montre le
bouton que dans ces cas (`domain/clinical/draftDeletion.ts`, testé par `draft-deletion.test.ts`) ; le serveur refait le
contrôle à chaque commande (`DeleteConsultationDraftTest` : auteur, gérante, autre professionnel, accueil, caisse,
dérogation). Un poste hors ligne ne détient pas cette commande : un grant ne la porte pas, la source `SYNC` est refusée.

## Qui supprime ou annule un brouillon (chantier « CRUD des écrans », tranche 3a)

**Aucune permission nouvelle ni élargie** (référentiel inchangé : 49 codes). Chaque règle reprend celle de la modification
de la même pièce ; le serveur la refait à chaque commande (403 hors droit, 409 hors état) et l'écran ne montre le bouton que
dans ces cas (`domain/clinical/draftDeletion.ts`, `draft-deletion.test.ts`).

| Geste | Commande | Qui | Quand |
| --- | --- | --- | --- |
| Supprimer un brouillon de prescription | `DeletePrescriptionDraft` | `clinical.write` et `clinical.read` (professionnel, gérante) ; aucun auteur n'est conservé sur un brouillon | brouillon seulement, jamais utilisé |
| Supprimer un brouillon de devis | `DeleteQuoteDraft` | `invoice.create`, ET le créateur du brouillon OU la gérante (`approval.decide`) | brouillon jamais émis seulement |
| Annuler un contrôle recommandé | `CancelFollowUp` | `follow_up.write` et `clinical.read` (professionnel, gérante), motif obligatoire | contrôle `ACTIVE` seulement |

Accueil : aucun de ces gestes (pas de `clinical.write`, ni `invoice.create`, ni `follow_up.write`). Caisse : seulement le
brouillon de devis dont elle est la créatrice. Les trois commandes sont en ligne seulement : un grant de poste ne les porte
pas et la source `SYNC` est refusée. Tests : `DeletePrescriptionDraftTest`, `DeleteQuoteDraftTest`, `FollowUpsTest`.

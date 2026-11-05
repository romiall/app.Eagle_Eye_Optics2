# Tests, contrôles de qualité et base MySQL isolée (F03)

Ce document explique comment lancer chaque suite en local et en CI, comment la base de test est protégée, et les limites de l'environnement. Il couvre le socle F03 et les contrôles de schéma de F04 ; les tests de règles métier et de contrats arrivent avec les tâches suivantes (voir « Ce qui n'existe pas encore »).

## Vue d'ensemble

| Suite | Commande | Prérequis | Ce qu'elle prouve |
| --- | --- | --- | --- |
| PHP, règles pures | `composer run test:unit` | PHP seulement | Garde de base de données (refus en production, nom sans `_test`, hôte distant, pilote) |
| PHP, application + MySQL | `composer run test:mysql` | MySQL 8.4 isolé (`eeo_test`) | Coquille SPA et `/api` JSON 404, URL d'assets de la coquille indépendantes du schéma, de l'hôte, de `X-Forwarded-*` et d'`ASSET_URL`, sonde `/up` (JSON minimal sans ressource tierce, 500 sans fuite, joignable en maintenance), configuration `fw_*`/UTC/XAF, `.env.example` sans secret, écouteur et commande de remise à zéro, `migrate:rollback` refusé hors base isolée avec table de sonde intacte sur MySQL réel, connexion MySQL réelle |
| PHP, concurrence | `composer run test:concurrency` | MySQL 8.4 isolé | Deux sessions MySQL distinctes et barrière contrôlée (base des tests de verrous) |
| PHP, tout | `composer run test` (ou `php artisan test`) | MySQL 8.4 isolé | Les trois suites |
| Style et analyse statique PHP | `composer run lint` | `composer install` | Pint sans modification (`lint:style`), puis PHPStan niveau 8 + Larastan (`analyse`). `composer run lint:fix` corrige le style |
| Analyse statique PHP | `composer run analyse` | `composer install` | PHPStan + Larastan seuls, configuration verrouillée `phpstan.neon` (voir « Analyse statique PHP ») |
| TypeScript | `npm run typecheck` | `npm ci` | `vue-tsc`, mode strict, `noUncheckedIndexedAccess` |
| ESLint | `npm run lint` | `npm ci` | Règles TypeScript/Vue, aucune API Node dans le frontend, aucun accès Dexie hors de `offline/` |
| Prettier | `npm run format:check` | `npm ci` | Format du code frontend |
| Vitest | `npm test` | `npm ci` | Amorçage Vue, configuration PWA (jamais d'API en cache ni de repli SPA sur `/api`), outillage Dexie/fake-indexeddb |
| Build | `npm run build` | `npm ci` | Assets statiques, manifeste et service worker dans `public/build/` |
| E2E | `npm run test:e2e` (build + tests) ou `npm run test:e2e:run` | Build, Chromium, `openssl` | Application construite dans un vrai navigateur : titre français, service worker actif, rechargement serveur arrêté, `/api` jamais remplacé par la coquille, aucune requête hors de l'origine (coquille, service worker et sonde `/up`), et origine HTTPS derrière un proxy qui termine TLS (pas de contenu mixte, service worker actif) |
| Tout enchaîner | `tools/dev/check-all.sh [--strict] [--with-e2e]` | Dépendances installées | Pint, Larastan, PHPUnit, types, ESLint, Prettier, Vitest, build (+ e2e) |
| Vérification de fin de phase | `tools/dev/phase-check.sh [--with-e2e] [--only a,b]` | MySQL de test joignable (obligatoire) | Mêmes contrôles plus `--check` des contrats, **sans s'arrêter au premier échec** : un journal par étape (`storage/framework/testing/phase-check/`) et un tableau final ; Vitest en une seule file |

Un test MySQL dont la base est injoignable est **ignoré avec un message explicite** (pas d'échec silencieux) sauf si `EEO_REQUIRE_MYSQL=1` : alors c'est un échec. La CI et `check-all.sh --strict` positionnent cette variable.

## Mise en route locale

```text
composer install
npm ci
tools/dev/mysql-up.sh            # conteneur MySQL 8.4.9 + base eeo_test + utilisateur eeo_test
tools/dev/check-all.sh --strict
```

Sous Windows, lancer les scripts depuis WSL ou Git Bash.

### Base MySQL de test (Docker)

`tools/dev/mysql-up.sh` démarre ou réutilise le conteneur `eeo-mysql` (image `mysql:8.4.9`, repli sur `mirror.gcr.io/library/mysql:8.4.9` si Docker Hub limite le débit), publié seulement sur `127.0.0.1:3306`. Il crée la base `eeo_test` et l'utilisateur `eeo_test`, limité à `eeo_test` et aux bases jetables `eeo_*_test`. Il active `log_bin_trust_function_creators` : avec le journal binaire actif (réglage par défaut de MySQL 8.4), un utilisateur sans `SUPER` ne peut pas créer de triggers, or les guards d'historique (F04) en sont. **Ce prérequis est aussi à contrôler chez l'hébergeur (Q01).** `SET GLOBAL` est perdu au redémarrage du serveur : relancer `mysql-up.sh` après tout redémarrage.

- Aucun mot de passe n'est écrit dans le dépôt. `EEO_MYSQL_ROOT_PASSWORD` donne le mot de passe root du conteneur ; à défaut, le script utilise le mot de passe jetable explicite `eeo-dev-root-jetable`, qui ne protège qu'un conteneur local lié à `127.0.0.1`. Un conteneur déjà créé avec un autre mot de passe exige `EEO_MYSQL_ROOT_PASSWORD=<ce mot de passe>`.
- Variables lues par les tests, avec des défauts fictifs de développement : `EEO_TEST_DB_HOST` (`127.0.0.1`), `EEO_TEST_DB_PORT` (`3306`), `EEO_TEST_DB_DATABASE` (`eeo_test`), `EEO_TEST_DB_USERNAME` (`eeo_test`), `EEO_TEST_DB_PASSWORD` (`eeo_test_password`, mot de passe fictif).
- `tests/bootstrap.php` impose ces valeurs **avant** le démarrage de Laravel : un `.env` de développement ne peut jamais rediriger PHPUnit vers une autre base (Dotenv ne remplace pas une variable déjà présente).

**Docker à relancer.** Dans l'environnement de développement cloud, le démon Docker ne survit pas aux redémarrages de session :

```text
(dockerd >/tmp/dockerd.log 2>&1 &)
docker start eeo-mysql
tools/dev/mysql-up.sh            # ou, en une seule commande : EEO_START_DOCKERD=1 tools/dev/mysql-up.sh
```

### Poste Windows sans Docker

Un MySQL Community 8.4 installé sur le poste suffit. `tools/dev/mysql-windows.ps1` est l'équivalent de `mysql-up.sh` :

```text
powershell -ExecutionPolicy Bypass -File tools\dev\mysql-windows.ps1            # démarre / prépare (port 3316)
powershell -ExecutionPolicy Bypass -File tools\dev\mysql-windows.ps1 -Action status
powershell -ExecutionPolicy Bypass -File tools\dev\mysql-windows.ps1 -Action stop
export EEO_TEST_DB_PORT=3316        # Git Bash ; le script rappelle cette ligne
tools/dev/check-all.sh --strict
```

- **Moteur dédié.** Il a son répertoire de données (`%LOCALAPPDATA%\eeo-mysql-test` ou `-Root`), son port, son journal ; aucune instance MySQL existante n'est utilisée ni modifiée. Le compte `root` du moteur n'a pas de mot de passe et n'écoute que `127.0.0.1`.
- **Durabilité relâchée, pour les tests seulement** (`innodb_flush_log_at_trx_commit=0`, `sync_binlog=0`, pas de double écriture) : sur un disque lent, chaque DDL de la baseline coûte plusieurs `fsync`. Ne jamais appliquer ces réglages à une base qui garde des données réelles.
- **Migration de la baseline.** Les 464 clés étrangères sont ajoutées sans vérification des lignes existantes **seulement quand toutes les tables sont vides** (installation neuve), ce qui permet à MySQL de les ajouter sur place plutôt que par recopie de la table (mesuré : 0,04 à 0,1 s contre 0,6 à 1,3 s par clé sur ce poste). Si une table contient des lignes, la vérification reste active. Le schéma obtenu est identique (tests d'équivalence de F04).
- **Réutiliser le schéma migré** : `EEO_TEST_REUSE_SCHEMA=1` évite le `migrate:fresh` de chaque processus PHPUnit quand la base isolée contient déjà exactement les migrations du dépôt (jamais en CI). Une migration existante modifiée sans changer de nom n'est pas détectée : relancer sans la variable. Exemple de boucle locale : `EEO_TEST_DB_PORT=3316 EEO_TEST_REUSE_SCHEMA=1 vendor/bin/phpunit tests/Feature/Application`.
- **Délai de Composer.** `composer run test` interrompt PHPUnit après 300 s ; sur un disque lent, la suite complète les dépasse. Lancer `COMPOSER_PROCESS_TIMEOUT=0 composer run test` ou `vendor/bin/phpunit` directement.
- **Fins de ligne.** Git for Windows convertit en CRLF à l'extraction (`core.autocrlf=true`). `.gitattributes` force LF pour le code et la configuration de l'application (`*.php`, `*.ts`, `*.vue`, `*.py`…) : sans cela, Pint (`line_ending`) et les générateurs `--check` échouent sans défaut de code.
- **Tests dépendant de POSIX** : le mode `0600` du fichier des comptes de démonstration et le refus d'un lien symbolique ne se vérifient que sous Linux (CI) ; sous Windows, la première assertion est omise et le second test est ignoré avec un message explicite.
- **Chromium des tests e2e** : renseigner `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (par exemple le chemin de Microsoft Edge) ; `openssl` est fourni par Git for Windows.

## Garde de base de données

Objectif (contrats 23 et 25) : détruire une base de production ou de développement est impossible par erreur ou par mauvaise configuration.

La garde `App\Support\Testing\IsolatedDatabaseGuard` n'autorise une opération destructive que si **les quatre conditions** sont réunies :

1. `APP_ENV` vaut exactement `testing` ;
2. le nom de base correspond à `^[a-z0-9][a-z0-9_]*_test$` ;
3. tous les hôtes de la connexion (lecture et écriture comprises) sont locaux : `127.0.0.1`, `localhost`, `::1` ou `mysql` (service de CI), ou connexion par socket Unix ;
4. le pilote est MySQL (SQLite ne vaut jamais « base isolée »).

Elle est appliquée à trois endroits :

| Point d'application | Effet |
| --- | --- |
| Écouteur `CommandStarting` (`BlockDestructiveDatabaseCommands`) | `migrate:fresh`, `migrate:refresh`, `migrate:reset`, `migrate:rollback` et `db:wipe` lèvent `DestructiveDatabaseOperationRefused` **avant** toute connexion, sauf base de test isolée, y compris sous `APP_ENV=testing` avec une base mal ciblée. Il vise la connexion de `--database` si elle est donnée. Le nom testé est celui de la commande résolue par Symfony : une abréviation (`migrate:rollb`, `mi:rollback`) n'y échappe pas. Le fournisseur de services relaie explicitement les événements Symfony, car Laravel ne le fait pas lorsque `APP_ENV=testing` ; l'appel est direct (pas de `method_exists`) pour qu'une mise à jour de Laravel qui retirerait cette méthode fasse échouer la console au lieu de désactiver la garde en silence |
| `php artisan eeo:test-db:reset [--database=] [--migrate]` | Vide (tables, vues, triggers) une base isolée, puis rejoue éventuellement les migrations. Refuse toute autre base (code de sortie 1). C'est la **seule** procédure de remise à zéro prévue |
| `Tests\TestCase::setUp()` | Aucun test d'application ne démarre si l'environnement n'est pas `testing` ou si la connexion par défaut n'est pas isolée. Défense en profondeur, indépendante de l'écouteur : elle échoue avant tout accès à la base, y compris pour `RefreshDatabase` |

### Commandes couvertes et limites

| Commande | Gardée | Raison |
| --- | --- | --- |
| `migrate:fresh`, `migrate:refresh`, `migrate:reset` | oui | Suppriment ou rejouent toutes les tables |
| `migrate:rollback` | oui | Exécute les `down()` du dernier lot : avant correction, `APP_ENV=production php artisan migrate:rollback --force` supprimait des tables sans aucun refus |
| `db:wipe` | oui | Supprime tables, vues et types |
| `migrate`, `migrate:install`, `migrate:status`, `db:seed`, `db:show`, `db:table`, `db:monitor` | non | Additives ou en lecture seule ; la discipline « migration additive » (contrats 23) se contrôle en revue |
| `db` | non (limite) | Ouvre le client SQL interactif : une session humaine peut tout faire |
| `schema:dump --prune`, `model:prune`, `queue:flush`, `queue:clear`, `cache:clear` | non (limite) | Ne détruisent pas le schéma métier ; les tables `fw_*` sont techniques |

Le test `test_chaque_commande_migrate_et_db_est_classee_explicitement` parcourt les commandes `migrate:*` et `db:*` réellement enregistrées par Laravel : une commande nouvelle apportée par une mise à jour du framework fait échouer la suite tant qu'elle n'est pas classée (c'est ainsi que `migrate:rollback` était passé entre les mailles). `test_la_liste_des_commandes_bloquees_est_exactement_celle_documentee` fige la liste.

Limites à connaître : l'écouteur protège les invocations de commande de premier niveau (`php artisan …`, `Artisan::call(…)`), pas une commande appelée par une autre commande (`$this->call(…)`), ni du SQL écrit à la main, ni le client `php artisan db`. En production, aucune commande `migrate:fresh/refresh/reset/rollback` n'a sa place dans un runbook ; une correction passe par une migration additive.

**Contrat tenu en F04 (fichier 23).** La garde de commande ne suffit pas : elle ne couvre pas un `down()` appelé autrement que par ces commandes (code applicatif, outil externe). Les méthodes `down()` des quatre migrations de baseline **refusent** toujours (`BaselineStateRefused`, aucun `dropIfExists` d'une table métier) ; celle des tables techniques `fw_*` n'agit qu'en base de test isolée. Les tables techniques étant migrées en premier, un `migrate:rollback` autorisé en base de test bute immédiatement sur la baseline sans rien supprimer. Preuves : `tests/Feature/Schema/BaselineMigrationsTest.php` (`down()` de chaque étape, `migrate:rollback` refusé, schéma intact). La remise à zéro d'une base de test passe par `eeo:test-db:reset`, qui utilise `db:wipe` et n'appelle jamais `down()`.

Réinitialiser la base de test depuis un terminal (la configuration doit viser la base isolée) :

```text
APP_ENV=testing DB_DATABASE=eeo_test DB_USERNAME=eeo_test DB_PASSWORD=<mot de passe fictif de test> \
  php artisan eeo:test-db:reset --migrate
```

Preuves exécutées (voir `progress.md`) : un vrai processus `php artisan migrate:fresh` est refusé en `production`, en `local` et en `testing` avec la base `eagle_eye_optics` ; il est accepté sur `eeo_test`. Même preuve pour `migrate:rollback`, y compris sous abréviation, et sur MySQL réel : une migration de sonde crée une table, `APP_ENV=production php artisan migrate:rollback --force` est refusé (code de sortie 1) et la table survit ; la même commande sous `APP_ENV=testing` sur la base jetable `eeo_rollback_probe_test` supprime bien la table (contrôle négatif qui donne son sens au test de survie). Le retrait de `migrate:rollback` de la liste fait échouer 11 tests (contrôle par mutation).

## Analyse statique PHP (PHPStan + Larastan)

- Paquet : `larastan/larastan` en `require-dev`, verrouillé dans `composer.lock` (Larastan 3.13.0, PHPStan 2.3.1, `iamcal/sql-parser` 0.7). Il est absent de `composer install --no-dev` : ni la production ni le job e2e ne le chargent.
- Configuration verrouillée : `phpstan.neon`, niveau 8, chemins `app`, `bootstrap`, `config`, `routes`, `database/factories`, `database/seeders` ; `bootstrap/cache` (fichiers générés) exclu. **Aucune erreur ignorée, aucune baseline** : un constat se corrige dans le code. Le niveau 8 vérifie nullables et unions ; les niveaux 9 et 10 (`mixed` strict) imposeraient des conversions partout où le code lit configuration, requêtes ou lignes SQL ; ils restent possibles par une tâche dédiée.
- Commandes : `composer run analyse` (analyse seule) ; `composer run lint` enchaîne Pint (`lint:style`) puis l'analyse, comme l'exige le fichier 25. En CI, ce sont deux étapes distinctes du job `php` (diagnostic lisible), juste après `composer install`.
- Larastan démarre l'application (conteneur, configuration) pour résoudre les types : aucune base de données ni `.env` n'est nécessaire (vérifié sur une copie sans `.env` ni cache).
- Constats traités à l'introduction (4 sous Larastan) : test `=== null` mort sur `CommandStarting::$command` (typé `string`, jamais nul) ; `method_exists()` toujours vrai remplacé par un appel direct (voir la garde) ; deux `env()` de type `bool|string` normalisés par un cast explicite dans `config/filesystems.php` et `config/sanctum.php`. Le même code reste sans constat sous PHPStan seul (sans Larastan, niveau 8) grâce à la conversion explicite de `app()->environment()` en chaîne aux deux appels de la garde et à l'annotation du noyau console concret dans `AppServiceProvider` ; la configuration du projet est celle de Larastan. Un contrôle négatif (fichier fautif injecté dans une copie) fait bien échouer `composer run lint` avec le code 1.

**Poste dont le réseau refuse l'API GitHub (bac à sable cloud).** `phpstan/phpstan` n'a **pas** de « source » git dans `composer.lock` : seule existe l'archive `https://api.github.com/repos/phpstan/phpstan/zipball/<commit>`. Quand cette API répond HTTP 403, `composer install` échoue avec « Could not authenticate against github.com » alors que tout le reste s'installe par clonage git. Ce n'est ni une impossibilité d'installer Larastan ni un problème de la CI GitHub. Procédure vérifiée depuis un `vendor/` absent (111 paquets installés, `composer run lint` vert) :

```text
tools/dev/seed-composer-cache.sh        # reconstruit l'archive au commit exact du verrou, la dépose dans le cache de Composer
composer install --prefer-source        # le reste s'installe par clonage git
```

Le script récupère le commit du verrou depuis le dépôt git public (échec si le commit diffère), en tire l'archive avec `git archive` et la place sous la clé de cache de Composer 2.x (sha1 de l'URL dist). Il est inutile, mais inoffensif, sur une CI ou un poste ordinaires où l'API GitHub répond.

## Tests PHP

- `phpunit.xml` : suites `Unit`, `Feature`, `Concurrency`, `APP_ENV=testing` imposé, cache et sessions en mémoire, file `sync`, courrier `array`, intégrations `fake`, aucun fournisseur réel.
- `tests/Support/RequiresIsolatedMysql.php` : trait des tests qui ont besoin du vrai MySQL. Il **échoue** si la connexion n'est pas isolée, **ignore** (ou échoue avec `EEO_REQUIRE_MYSQL=1`) si MySQL est injoignable.
- Les tests de concurrence ouvrent deux connexions MySQL réellement distinctes et les entrelacent avec une barrière contrôlée (verrou nommé). Les tests de verrous et de files de F07/O03 s'appuieront sur ce modèle.
- SQLite ne remplace pas MySQL pour InnoDB, contraintes, triggers et verrous : il n'est utilisé que comme base volatile pour prouver qu'un refus de commande n'atteint aucune base.
- `MigrateRollbackGuardTest` : vrais processus `php artisan` sur une base jetable `eeo_rollback_probe_test` (créée puis supprimée par le test, uniquement possible parce que son nom se termine par `_test`) avec la migration de sonde `tests/fixtures/migrations/` : `migrate:rollback` en `production` ou abrégé est refusé et la table survit ; sous `testing` il s'exécute et la supprime (contrôle négatif).
- `HealthProbeTest` : `GET /up` répond `{"status":"ok"}` en JSON, `Cache-Control: no-store`, sans cookie, sans `http`/`<script`/`<html` dans le corps, hors du groupe `web` ; une exception de diagnostic donne un 500 `{"status":"error"}` journalisé sans divulguer son message ; la sonde reste joignable en mode maintenance. `SpaShellTest` vérifie aussi qu'aucune vue Blade du dépôt ne charge de script, fonte ou style tiers.
- `SpaShellOriginTest` : la coquille ne dépend ni du schéma ni de l'hôte de la requête. Il utilise le vrai Vite de Laravel (jamais `withoutVite()`) avec un manifeste de build déposé dans un répertoire public jetable (`Tests\Support\UsesTemporaryPublicDirectory` ; la CI PHP ne construit pas le frontend). Dix formes de requête (HTTPS direct, `X-Forwarded-Proto: https` avec proxy non approuvé puis approuvé, `Host` arbitraire en HTTP et en HTTPS, `X-Forwarded-Host` arbitraire avec proxy non approuvé puis approuvé, `X-Forwarded-Prefix` arbitraire avec proxy approuvé, `ASSET_URL` vers un CDN, URL profonde du routeur Vue) : les quatre assets (script, feuille de style, morceau importé et son CSS) sont toujours des chemins `/build/assets/…`, aucune `src`/`href` n'est absolue ni relative au protocole, aucun nom d'hôte de la requête n'apparaît et le corps est identique à la référence. Contrôle par mutation : sans `Vite::createAssetPathsUsing`, les 12 tests de la classe échouent (URL en `http://…`, `https://evil.test/…`, `http://localhost/evil/…`).
- Pas de mesure de couverture PHP : `pcov` et `xdebug` sont absents de l'environnement.

## Tests frontend

- `vitest.config.ts` : environnement jsdom, `tests/frontend/**/*.test.ts`, `fake-indexeddb` chargé dans `tests/frontend/setup.ts`. Configuration distincte de `vite.config.ts` (ni Laravel, ni Tailwind, ni PWA).
- `tests/frontend/pwa-config.test.ts` teste la même configuration PWA que celle du build (`resources/frontend/app/pwa.config.ts`).
- `fake-indexeddb` sert aux tests unitaires du moteur local ; la preuve de persistance après fermeture du navigateur (G1) exige un vrai navigateur avec profil persistant.
- Formulaires : `tests/frontend/components/fields.test.ts` et `choice-fields.test.ts` fixent l'ordre étiquette, saisie, erreur, aide (et les `aria-describedby`), `tests/frontend/shell/form-styles.test.ts` lit `resources/frontend/styles/base.css` (focus hors couche, `--field-label-offset`, décalage des boutons à côté d'un champ, contraste forcé), `tests/frontend/shell/palette.test.ts` les paires de couleurs. Le CSS ne se mesure pas en jsdom : l'alignement est mesuré dans le navigateur par `tests/e2e/forms-layout.spec.ts` (voir plus bas).

## Tests e2e (Playwright, Chromium)

- Prérequis : `npm run build` (le script `npm run test:e2e` le fait) et un Chromium.
- Résolution du navigateur par `playwright.config.ts` : variable `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, sinon Chromium préinstallé de `/opt/pw-browsers`, sinon navigateur géré par Playwright. **Ne jamais lancer `playwright install` sur le poste de développement cloud** ; l'installation n'est autorisée qu'en CI.
- Serveur : `node tests/e2e/prepare-env.mjs` génère `.env.e2e` (ignoré par git, `APP_ENV=e2e`, clé d'application aléatoire, base `eeo_test`, intégrations `fake`), puis `php artisan serve` sur `127.0.0.1:8123`. Les ports des serveurs que les tests démarrent eux-mêmes sont déclarés dans `tests/e2e/support/ports.ts` (dérivés du port principal) : 8124 pour le test de coupure, 8125 et 8126 pour le test d'origine HTTPS.
- **Coupure réelle du serveur.** Le mode « hors ligne » de Playwright ne s'applique pas aux requêtes émises par le service worker : un test fondé dessus passerait à tort. Le test arrête donc vraiment le processus PHP (et vérifie que le port refuse les connexions) puis recharge la page : la coquille vient du précache, `/api` n'est jamais remplacé par la coquille. Une régression de la liste de refus du service worker fait échouer ce test (vérifié par mutation).
- **Une seule origine.** Trois tests écoutent `context.on('request')` (requêtes de la page *et* du service worker) et exigent qu'aucune requête n'atteigne une autre origine : la sonde `/up` (avant correction, la vue par défaut de Laravel appelait `cdn.jsdelivr.net` et `fonts.bunny.net`), la sonde sous service worker actif (elle ne doit jamais être remplacée par la coquille) et la coquille avec son service worker. Un quatrième test contrôle le corps et les en-têtes de la sonde (`application/json`, `no-store`).
- **Origine HTTPS derrière un proxy qui termine TLS.** `https-origin.spec.ts` démarre un serveur PHP en HTTP simple (`APP_URL=https://cabinet.eeo-e2e.test:8126`, comme en production) et, devant lui, un proxy inverse Node qui termine TLS (`tests/e2e/support/tls-proxy.ts` : en-tête `Host` conservé, `X-Forwarded-Proto: https`, comme nginx, un répartiteur de charge ou un CDN). Le certificat est auto-signé, valable un jour, généré à chaque exécution par la commande `openssl` (présente sur les runners GitHub) et jamais versionné : une clé privée, même factice, dans un dépôt public serait signalée par les analyseurs de secrets. Chromium charge `https://cabinet.eeo-e2e.test:8126/` : la coquille doit s'afficher, la console rester vide (aucun « Mixed Content »), le service worker être actif avec la portée de l'origine HTTPS, aucune requête sortir en `http:` ni vers une autre origine, et une URL profonde du routeur charger ses assets. Trois réglages du navigateur, limités à ce fichier (`test.use({ launchOptions })` en tête de fichier, car Playwright l'interdit dans un `describe`) :
  - `--host-resolver-rules=MAP cabinet.eeo-e2e.test 127.0.0.1` : un nom de domaine est indispensable, car Chromium exempte `127.0.0.1` et `localhost` des règles de contenu mixte (une coquille cassée y paraîtrait saine, comme dans tous les autres tests e2e). Le TLD `.test` est réservé et n'est jamais résolu sur Internet ;
  - `--no-proxy-server` : le bac à sable de développement cloud impose un proxy sortant par variable d'environnement (`https_proxy`), que Chromium utiliserait pour ce nom d'hôte (`net::ERR_CONNECTION_RESET`) ;
  - `--ignore-certificate-errors` : l'option `ignoreHTTPSErrors` de Playwright ne suffit pas, Chromium refuse alors d'enregistrer le service worker (« An unknown error occurred when fetching the script »).
  Contrôle par mutation : sans `Vite::createAssetPathsUsing`, les 4 tests échouent (`#app` vide, aucun `h1`, service worker jamais enregistré, console « Mixed Content: … requested an insecure script 'http://cabinet.example.test:8443/build/assets/main-….js'. This request has been blocked »). Les autres tests e2e restent en `http://127.0.0.1` et ne peuvent pas détecter ce défaut.
- **Mise en page des formulaires.** `forms-layout.spec.ts` mesure dans le navigateur (`boundingBox`) qu'un bouton posé à côté d'un champ reste aligné sur la saisie à 768, 1024 et 1280 px (liste des patients, caisse du jour, suivis, agenda, « Aujourd'hui », exports), que la rangée est empilée sous 640 px (caisse du jour à 360 px) et que les icônes et le chevron ont leur remplissage. Il tourne deux fois : avec les polices du poste, puis avec une POLICE LARGE (Verdana imposée à la page, `bypassCSP`) : la CI Linux retombe sur une police bien plus large que Windows (DejaVu Sans), une étiquette qui tient sur une ligne en local passe sur deux lignes en CI et décale la saisie du bouton aligné sur elle.
- Ces tests e2e sont des preuves de fumée du socle. Le parcours G1 (patient, facture, deux paiements, PDF, reprise après fermeture complète du navigateur, ACK rejoué) reste à écrire avec les tâches O01 et suivantes.

## Intégration continue

`.github/workflows/quality.yml` (permissions `contents: read`, aucun secret) :

| Job | Contenu |
| --- | --- |
| `php` | PHP 8.3, service `mysql:8.4` avec base `eeo_test`, `composer install`, préparation des droits des bases de test, Pint (`lint:style`), analyse statique PHPStan niveau 8 + Larastan (`analyse`), `test:unit`, `test:mysql`, `test:concurrency`, `composer audit` ; `EEO_REQUIRE_MYSQL=1` |
| `frontend` | Node 22, `npm ci`, `typecheck`, `lint`, `format:check`, `test`, `build`, `npm audit --omit=dev` |
| `e2e` | PHP + Node, build, Chromium installé et mis en cache (installation autorisée en CI uniquement), tests Playwright (le test d'origine HTTPS utilise `openssl`, présent sur `ubuntu-24.04`) ; traces conservées 7 jours en cas d'échec seulement |

Les mots de passe visibles dans le workflow sont des valeurs fictives d'un service éphémère du runner. Les journaux ne contiennent que des identifiants techniques et des données fictives. **Le workflow n'a pas encore été exécuté sur GitHub** : il l'a été sous forme de commandes équivalentes en local ; sa première exécution réelle est à constater après le premier push.

## Ce qui n'existe pas encore (fichier 25)

Ces commandes seront créées par les tâches propriétaires ; elles ne sont pas disponibles et ne doivent pas être annoncées comme réussies : `composer run test:contracts` (F06), `npm run test:domain` (vecteurs communs PHP/TS, F08), tests de concurrence métier (F07/O03). L'analyse statique PHP est en place (voir « Analyse statique PHP »). `php artisan eagle:verify-schema` existe depuis F04 (voir « Schéma : équivalence de la baseline »).

## Schéma : équivalence de la baseline (F04)

Détails dans `docs/implementation/schema.md`. Contrôles disponibles :

| Commande | Effet | Code de sortie |
| --- | --- | --- |
| `python3 database/tools/build_migrations.py --check` | Les instructions de `database/baseline/statements.json` redonnent octet pour octet les scripts SQL validés et le catalogue a l'empreinte du backlog | 0 si cohérent, 1 sinon |
| `php artisan eagle:verify-schema [--json=…]` | Base courante comparée à `database/baseline/metadata.json` (117 tables, colonnes, index, CHECK, FK, vues, guards, référentiels), tables techniques inventoriées à part ; lecture seule | 0 sans écart, 1 au moindre écart |
| `tools/dev/schema-parity.sh [--output=…] [--write-baseline] [--keep]` | Preuve complète sur bases jetables `eeo_*_test` : import client mysql du SQL livré contre migrations, 41 assertions SQL sur la base migrée, adoption acceptée/refusée, double exécution et retour arrière refusés ; écrit `docs/evidence/schema-parity.json` par défaut | 0 si les 22 contrôles passent |
| `composer run test:unit` / `test:mysql` | `tests/Unit/Schema` (instructions, comparateur, catalogue ↔ métadonnées) et `tests/Feature/Schema` (migrations réelles, guards, adoption, refus ; environ 1 min 30) | PHPUnit |

En CI, le job `php` exécute les trois premiers contrôles sur le service `mysql:8.4.9` et publie le rapport d'équivalence en artefact. Après une exécution locale de `specifications/developpement/verifier_plan.py`, restaurer son rapport (`git checkout -- specifications/developpement/validation-plan.json`) : le script le réécrit avec des fins de ligne différentes alors que le corpus de spécification ne doit pas changer.

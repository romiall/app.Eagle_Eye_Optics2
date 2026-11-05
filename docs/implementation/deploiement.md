# Déploiement sur l'hébergement (Hostinger, accès SSH)

Procédure de mise en ligne et de mise à jour de l'application sur l'hébergement web Hostinger (**`https://app-eagleseye.com`**).
L'application a été **installée et vérifiée en production sur Hostinger le 2026-10-27** (PHP 8.3.36, LiteSpeed,
MariaDB 11.8.9, base `u720123645_eagleseye`, 117 tables métier, 464 clés étrangères, 484 contraintes CHECK, 10 vues,
88 triggers, sauvegarde chiffrée active, `eeo:preflight` 0 point bloquant et `smoke.sh` 100 % réussi).

## 0. Mise à jour rapide depuis ce poste Windows (pour Claude / l'exploitant)

Sur le poste local du demandeur, **l'accès SSH sans mot de passe est déjà configuré** dans `~/.ssh/config` :

- Alias SSH : `eagleseye` (ou `scei`)
- Hôte : `145.79.20.169` · Port : `65002` · Utilisateur : `u720123645`
- Clé privée locale : `~/.ssh/scei_hostinger_deploy`
- Arborescence sur le serveur :
  - `~/eeo` → lien symbolique vers la version active `~/eeo-releases/eeo-AAAAMMJJTHHMMZ-<commit>`
  - `~/eeo/.env` → configuration de production en place (copiée automatiquement lors d'une mise à jour)
  - `~/.eeo-backup.key` → clé de chiffrement des sauvegardes (`0600`)
  - `~/eeo-backups/` → sauvegardes chiffrées quotidiennes et pré-déploiement
  - `~/domains/app-eagleseye.com/public_html` → lien symbolique vers `~/eeo/public`

Pour déployer **toute nouvelle modification validée (commit propre)** en une seule commande :

- Depuis **PowerShell** :

```powershell
.\tools\deploy\deploy-hostinger.ps1
```

- Depuis **Git Bash** (ou PowerShell après rechargement du profil) :

```bash
bash tools/deploy/deploy-hostinger.sh
```

Ce script exécute automatiquement :
1. `bash tools/deploy/build-release.sh` (build Vite PWA + `composer install --no-dev` + archive `.tar.gz` et `.sha256` dans `release/`) ;
2. sauvegarde chiffrée préalable sur le serveur (`tools/deploy/backup.sh`) ;
3. envoi par `scp` vers `eagleseye:~/`, contrôle `sha256sum -c`, extraction dans `~/eeo-releases/<nom>`, copie de `~/eeo/.env` ;
4. `php artisan eeo:preflight`, `php artisan migrate --force`, `php artisan config:cache`, `route:cache`, `view:cache` ;
5. bascule atomique du lien `~/eeo` et contrôle HTTP de `https://app-eagleseye.com/up`.

> Aucun mot de passe ni fichier `.env` ne doit jamais être écrit dans le dépôt Git public.

---

## Vue d'ensemble

| Étape | Où | Durée indicative |
| --- | --- | --- |
| 1. Diagnostic de l'hébergement | Serveur (SSH) | 5 minutes |
| 2. Construire l'archive | Poste de développement | 5 minutes |
| 3. Envoyer et installer l'archive | Serveur (SSH) | 10 minutes |
| 4. Configurer, installer la base, créer la gérante | Serveur (SSH) | 10 minutes |
| 5. Ouvrir le site, contrôle de fumée | Poste | 5 minutes |
| 6. Mise en service progressive des modules (phase 1) | Serveur (SSH) puis gérante | 1 minute par module |
| 7. Sauvegarde quotidienne et exercice de restauration | Serveur (SSH, cron) | 15 minutes |

## 1. Diagnostic de l'hébergement (avant tout)

1. Dans le panneau Hostinger : créer le sous-domaine (par exemple `app.eagleeyeoptic.com`), activer **HTTPS**,
   choisir **PHP 8.3 ou 8.4**, créer une **base MySQL** et son utilisateur (noter nom, utilisateur, mot de passe, hôte).
2. Envoyer un petit paquet de test, ou l'archive complète (étape 3), puis sur le serveur :

```bash
cd ~/eeo            # dossier de l'application (voir l'étape 3)
php -v
php artisan eeo:preflight
```

Attention : la version de PHP **en ligne de commande (SSH)** peut différer de celle du site web choisie dans le
panneau. `php -v` doit afficher 8.3 ou plus ; sinon, utiliser le binaire de la bonne version indiqué par l'hébergeur
(par exemple `php8.3`) pour **toutes** les commandes `artisan` de cette procédure, et corriger la version du site.

`eeo:preflight` vérifie PHP, les extensions, les réglages, les droits d'écriture et surtout les **droits MySQL réels** :
il crée puis supprime des objets temporaires (table avec CHECK, clé étrangère, colonne générée, vue, **trigger**) sans
toucher aux tables de l'application. Sortie : `OK`, `ALERTE` (à lire, ne bloque pas) ou `BLOQUANT` ; code de sortie
1 s'il y a un point bloquant. `php artisan eeo:preflight --json` donne le rapport à conserver (il répond à la grille
`hosting-audit.md`).

### Si le diagnostic bloque

| Message | Cause probable | Action |
| --- | --- | --- |
| `Serveur de base … MariaDB n'est pas déclarée compatible` | L'offre fournit MariaDB | Demander à Hostinger une base **MySQL 8** (autre offre ou base distante MySQL 8.4), ou décider d'une recette complète sur MariaDB (travail à planifier) |
| `Droit TRIGGER … log_bin_trust_function_creators` | Journal binaire actif sans SUPER | Demander l'activation de `log_bin_trust_function_creators=1` ou le droit SUPER pour l'installation |
| `Droit TRIGGER` autre | Droit `TRIGGER` non accordé à l'utilisateur de la base | Accorder `ALL PRIVILEGES` sur la base à l'utilisateur de l'application |
| `Contraintes CHECK appliquées` | Serveur qui ignore les CHECK (MySQL avant 8.0.16) | Changer de serveur de base |
| `PHP … 8.3 au minimum` | Version de PHP trop basse | Choisir PHP 8.3 ou 8.4 dans le panneau |
| `Extensions PHP requises … manquantes` | Extension désactivée | L'activer dans le panneau (au minimum `intl`, `pdo_mysql`, `mbstring`, `xml`, `openssl`) |
| `Racine web … contient` | La racine du site n'est pas `public/` | Voir l'étape 3 |

Les alertes (`expose_php`, OPcache, taille d'envoi) se règlent dans le panneau (PHP, Options) ou un fichier
`.user.ini`.

Garder le **JIT d'OPcache désactivé** (`opcache.jit=disable` ou `opcache.jit_buffer_size=0`, valeur par défaut de PHP) :
en développement, avec le JIT actif, les chemins du hors-ligne (autorisations des postes, synchronisation) ont produit
une erreur de type impossible (PHP 8.3.6) et une erreur de segmentation du serveur (CI). Le cache d'opcodes OPcache,
lui, reste recommandé.

## 2. Construire l'archive (poste de développement)

La livraison ne contient ni code de test, ni spécifications, ni dépendances de développement, ni `.env`.

```bash
git status                          # l'arbre de travail doit être propre (tout validé)
bash tools/deploy/build-release.sh  # npm run build + composer install --no-dev ; 5 minutes sur ce poste
```

Résultat dans `release/` : `eeo-AAAAMMJJTHHMMZ-<commit>.tar.gz` et son empreinte `.sha256`. Elle contient `vendor/`
(donc Composer n'est pas exigé sur le serveur) et `public/build/`.

## 3. Envoyer et installer l'archive (SSH)

Depuis le poste (adapter l'utilisateur, l'hôte et le port donnés par Hostinger) :

```bash
scp -P <port> release/eeo-*.tar.gz release/eeo-*.sha256 <utilisateur>@<hôte>:~/
```

Sur le serveur :

```bash
cd ~
sha256sum -c eeo-*.sha256                       # doit afficher « OK »
mkdir -p ~/eeo-releases/<nom-de-l-archive>
tar -xzf eeo-*.tar.gz -C ~/eeo-releases/<nom-de-l-archive>
ln -sfn ~/eeo-releases/<nom-de-l-archive> ~/eeo   # « eeo » pointe vers la version en service
```

**Racine web.** Le site doit être servi depuis `~/eeo/public` et **rien d'autre** : ni `.env`, ni `vendor/`, ni
`storage/` ne doivent être accessibles par HTTP. Sur Hostinger :

- si le panneau permet de choisir le **dossier racine du sous-domaine**, le pointer sur `~/eeo/public` ;
- sinon, remplacer le dossier du sous-domaine (`public_html` du sous-domaine) par un **lien symbolique** vers
  `~/eeo/public` (`ln -sfn ~/eeo/public <dossier du sous-domaine>`), si l'offre l'autorise ;
- à défaut : demander au support la procédure pour un projet Laravel. **Ne jamais** copier `public/` à côté du code en
  laissant le reste dans la racine web.

Droits d'écriture pour le serveur web :

```bash
cd ~/eeo
chmod -R u+rwX storage bootstrap/cache
```

## 4. Configurer, installer la base, créer la gérante

```bash
cd ~/eeo
cp .env.example .env
nano .env      # ou vi : renseigner les valeurs ci-dessous
php artisan key:generate --force
```

Valeurs à renseigner dans `.env` (aucune valeur d'exemple ne doit rester) :

| Variable | Valeur |
| --- | --- |
| `APP_ENV` | `production` |
| `APP_DEBUG` | `false` |
| `APP_URL` | `https://app.eagleeyeoptic.com` (le vrai sous-domaine, en HTTPS) |
| `SANCTUM_STATEFUL_DOMAINS` | exactement l'hôte : `app.eagleeyeoptic.com` |
| `SESSION_SECURE_COOKIE` | `true` |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | ceux du panneau Hostinger |
| `PRODUCTION_DOCUMENTS_ENABLED` | `false` (documents marqués TEST tant que mentions légales, logo et fiscalité ne sont pas validés) |
| `EEO_ENABLED_MODULES` | vide au départ ; voir l'étape 6 |
| `EEO_EXAM_FEE_CONTROL` | `off` au départ (paiement de l'examen non contrôlé, dit à l'écran) ; voir l'étape 6 |
| `EEO_EXAM_FEE_ITEM_REFERENCE` | vide tant que l'article « frais d'examen » n'existe pas au catalogue |
| `EEO_BACKUP_DIR`, `EEO_BACKUP_KEEP_DAYS` | dossier des sauvegardes HORS racine web (vide : `~/eeo-backups`) et durée de conservation ; voir l'étape 7 |
| `EEO_BACKUP_KEY_FILE` | clé de chiffrement des sauvegardes (fichier hors de l'application, 0600, copie hors serveur chez la responsable) ; sans elle, sauvegarde en clair consignée `NOT_ENCRYPTED` dans `backup_runs` ; voir l'étape 7 et `docs/runbooks/server-restore.md` |

Puis :

```bash
chmod 600 .env
php artisan eeo:preflight                 # doit conclure « Aucun point bloquant »
php artisan migrate --force               # crée les tables, les vues et les triggers (≈ 40 s à 3 minutes)
php artisan eagle:verify-schema           # « Schéma équivalent à la baseline : aucun écart »
php artisan eeo:setup-clinic --clinic-name "EAGLE'S EYE OPTICS MEDICAL" --manager-name "<Nom de la gérante>" --login <identifiant>
                                          # demande le mot de passe (12 caractères minimum) ; aucun mot de passe par défaut
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

`eeo:setup-clinic` se lance **une seule fois**. Le mot de passe de la gérante est choisi à ce moment et conservé
hors du serveur. Le cabinet est ensuite identifié par la base (si plusieurs cabinets existaient un jour, renseigner
`EEO_CLINIC_ID`).

Paramétrage de la phase 1 (à faire **avant** d'ouvrir le module concerné, étape 6) :

```bash
php artisan eeo:sales:bootstrap           # caisse principale et emplacement de stock (idempotent) : avant « sales »
php artisan eeo:clinical:scales --code=<CODE> --label="<Libellé>"
                                          # échelle d'acuité RÉELLE choisie par la cliente : avant « consultations »
                                          # (répéter pour chaque échelle ; jamais --demo, refusé en production)
```

Aucune commande de démonstration (`eeo:demo:accounts`, `eeo:demo:sales`, `eeo:clinical:scales --demo`) ne s'exécute
en production : elles le refusent et le disent. Aucun prix, taxe, échelle ni identité n'est fourni par l'application :
tout est saisi par la gérante ou choisi par la cliente.

## 5. Ouvrir le site et contrôle de fumée

Depuis le poste (jamais depuis un site tiers) :

```bash
EEO_SMOKE_PASSWORD='<mot de passe de la gérante>' bash tools/deploy/smoke.sh https://app.eagleeyeoptic.com <identifiant>
```

Le contrôle est **en lecture seule**. Il vérifie : `/up`, l'API (404 JSON), les fichiers du build, le service worker,
que `.env`, `.git`, `composer.json`, `artisan` et les journaux **ne sont pas servis**, la connexion réelle, la lecture
du compte, la recherche de patients, la file du jour, puis les lectures des modules de la phase 1 (examens, échelles
d'acuité, factures, caisse, stock, personnel, identité des documents) : « module fermé » (404) ou « droit absent
pour ce compte » (403) sont des informations, pas des échecs. Il doit se terminer par
« Contrôle de fumée réussi. ». Puis ouvrir `https://app.eagleeyeoptic.com` dans un navigateur : écran de connexion,
connexion avec la gérante, accueil.

## 6. Mise en service progressive des modules (phase 1)

Un module livré reste invisible (écran **et** API) tant qu'il n'est pas ouvert. Pour ouvrir des fonctions :

```bash
cd ~/eeo
nano .env             # EEO_ENABLED_MODULES=settings,patients,today
php artisan config:cache
php artisan eeo:preflight   # signale un code inconnu, une caisse ou une échelle manquante, un contrôle d'examen incohérent
```

| Code | Fonction ouverte | État dans cette version (EN LIGNE seulement) |
| --- | --- | --- |
| `settings` | Paramètres : personnel (comptes, profils, dérogations, mots de passe), identité du cabinet imprimée sur les documents | Livré |
| `patients` | Fiches patient, recherche, ressemblances, activité du patient | Livré |
| `today` | Arrivée du patient, file du jour | Livré |
| `consultations` | Examens : motif, antécédents, acuités, réfraction, centrage, médicaments, conclusion ; terminer, corriger, révisions ; prescriptions optiques ; liste des examens ; impression locale (PDF) | Livré |
| `sales` | Caisse (ouverture, clôture), factures (brouillon, émission), encaissements et reçus, catalogue et taxes (gérante), PDF facture et reçu | Livré |
| `stock` | Disponibilités et stock initial | Livré (le reste du stock : lots suivants) |
| `reports` | Statistiques du cabinet (activité, ventes selon les droits ; export contrôlé) | Livré |
| `agenda` | Rendez-vous, plages d'ouverture, patients à rappeler et suivis | Livré (hors de la première liste conseillée : à ouvrir après formation) |
| `offline` | Préparation d'un poste pour le travail sans Internet | **À laisser FERMÉ en production** : preuve G1/G2 à produire d'abord |
| `workshop`, `communication` | — | Pas encore : les ouvrir n'affiche rien |

Liste conseillée pour la première mise en ligne : `EEO_ENABLED_MODULES=settings,patients,today,consultations,sales,stock,reports`
(sans `agenda` ni `offline`). Ordre conseillé, un module à la fois, après une courte formation :

1. `settings,patients,today` : la gérante se connecte, renseigne **Paramètres → Cabinet et documents** (nom,
   adresse, téléphone, identifiant fiscal, mentions : rien n'est proposé ni inventé), puis crée les comptes dans
   **Paramètres → Personnel**. Chaque mot de passe initial se transmet **en personne** ; la personne le change à sa
   première connexion (**Accueil → Changer mon mot de passe**).
2. `consultations`, après `eeo:clinical:scales` (échelle réelle).
3. `sales`, après `eeo:sales:bootstrap` ; la gérante saisit ensuite catalogue, prix et taxes (réauthentification
   demandée). Les documents restent marqués **TEST** tant que `production_documents_enabled` n'est pas activé par
   la procédure de bascule (mentions légales, logo et régime fiscal validés).
4. `stock`, quand la gérante saisit le stock d'ouverture.

**Contrôle du paiement de l'examen** : laisser `EEO_EXAM_FEE_CONTROL=off` au départ (les écrans disent « Paiement de
l'examen non contrôlé »). Pour l'activer (`billed`), il faut le module `sales` ouvert ET l'article « frais d'examen »
au catalogue (`EEO_EXAM_FEE_ITEM_REFERENCE`) : sinon `eeo:preflight` le déclare BLOQUANT, car aucun examen ne
pourrait plus démarrer.

Retour en arrière : retirer le code de la liste et relancer `php artisan config:cache`. Aucune donnée n'est touchée.

## 7. Sauvegarde quotidienne et exercice de restauration (obligatoire avant d'ouvrir `patients`)

La sauvegarde livrée dans l'archive (`tools/deploy/backup.sh`) copie la base (structure, données, vues, triggers),
les fichiers produits par l'application (`storage/app`) et le `.env` (clé `APP_KEY`), dans un dossier daté, hors de
la racine web, avec ses empreintes ; les sauvegardes plus anciennes que `EEO_BACKUP_KEEP_DAYS` jours sont supprimées.
`eeo:preflight` dit si `mysqldump` est disponible ; sinon, s'appuyer sur les sauvegardes du panneau Hostinger.

0. **Clé de chiffrement**, une fois : `openssl rand -base64 48 > ~/.eeo-backup.key && chmod 600 ~/.eeo-backup.key`,
   puis `EEO_BACKUP_KEY_FILE=/home/<compte>/.eeo-backup.key` dans le `.env`. Copier ce fichier HORS du serveur chez la
   responsable (coffre ou clé USB chiffrée) : sans lui, aucune sauvegarde chiffrée ne se relit. Base, fichiers et
   `.env` sont alors chiffrés (`*.enc`) ; chaque sauvegarde est consignée dans `backup_runs` (identifiant de la clé,
   jamais la clé). Sans clé, la sauvegarde est faite en clair et consignée en échec `NOT_ENCRYPTED`.
1. Essai à la main : `bash ~/eeo/tools/deploy/backup.sh ~/eeo` (dernière ligne : « Sauvegarde terminée »).
2. Tâche planifiée (panneau Hostinger, **Avancé → Tâches Cron**), chaque nuit, par exemple à 2 h 30 :

   ```
   30 2 * * * bash $HOME/eeo/tools/deploy/backup.sh $HOME/eeo >> $HOME/eeo-backups/backup.log 2>&1
   ```

3. **Copie hors du serveur**, au moins chaque semaine, depuis le poste de la gérante ou de l'exploitant :
   `scp -r -P <port> <utilisateur>@<hôte>:~/eeo-backups/eeo-backup-<date> <dossier sûr>`. Le dossier contient le
   `.env` (mot de passe de la base, clé de l'application) et des données de santé : le garder chiffré (disque ou
   coffre), jamais par courriel ni messagerie.
4. **Exercice de restauration** avant la mise en service, puis chaque mois : créer dans le panneau une base vide dont
   le nom finit par `_restore`, puis

   ```bash
   bash ~/eeo/tools/deploy/restore-check.sh ~/eeo-backups/eeo-backup-<date> <base>_restore ~/eeo
   ```

   Le script refuse la base de l'application, vérifie les empreintes, déchiffre, restaure, compare le schéma à la
   baseline (`eagle:verify-schema`), puis lance `php artisan eeo:restore:verify` : diagnostics d'intégrité, séquences
   jamais remises à zéro, pièces numérotées, empreintes d'audit, fichiers privés restaurés, postes à synchroniser,
   reçus perdus par rapport à la base vivante et durée constatée. Consigner l'exercice dans `restore_tests`
   (`eeo:restore:verify <base>_restore --files=… --backup-run=<id> --tested-by=<identifiant> --record`), noter le
   résultat dans `docs/evidence/restore-rehearsal.md`, puis supprimer la base jetable. Procédure complète en cas de
   perte du serveur : `docs/runbooks/server-restore.md`.

## 8. Tâches planifiées (cron unique)

Une seule entrée cron suffit ; Laravel lance lui-même les tâches dues (aujourd'hui : production et expiration des
exports, `eeo:exports:process`). Dans le panneau Hostinger (« Tâches cron ») ou par `crontab -e` :

```bash
* * * * * cd /home/<compte>/<dossier-de-l-application> && php artisan schedule:run >> /dev/null 2>&1
```

Sans ce cron, un export demandé reste « demandé » : rien n'est perdu, il est produit dès que le cron tourne.

## Mise à jour vers une nouvelle version

```bash
# Poste : construire la nouvelle archive (étape 2) et l'envoyer (étape 3).
# Serveur : sauvegarde d'abord
bash ~/eeo/tools/deploy/backup.sh ~/eeo
cd ~ && mkdir -p ~/eeo-releases/<nouvelle-archive> && tar -xzf eeo-<nouvelle>.tar.gz -C ~/eeo-releases/<nouvelle-archive>
cp ~/eeo/.env ~/eeo-releases/<nouvelle-archive>/.env
cd ~/eeo-releases/<nouvelle-archive> && chmod -R u+rwX storage bootstrap/cache
php artisan eeo:preflight
php artisan down                         # facultatif : maintenance de quelques minutes
php artisan migrate --force && php artisan eagle:verify-schema
php artisan config:cache && php artisan route:cache && php artisan view:cache
ln -sfn ~/eeo-releases/<nouvelle-archive> ~/eeo
php artisan up
```

Retour à la version précédente : `ln -sfn ~/eeo-releases/<ancienne-archive> ~/eeo`. Les migrations ne sont pas
destructives ; ne jamais restaurer une ancienne base sans sauvegarde récente (voir ci-dessous).

## Sauvegardes (obligatoire avant la mise en service)

Voir l'étape 7 : sauvegarde quotidienne par `tools/deploy/backup.sh` (cron), copie hors serveur, exercice de
restauration par `tools/deploy/restore-check.sh`. En complément, activer les sauvegardes automatiques du panneau
Hostinger. Avant chaque mise à jour : une sauvegarde à la main.

## Limites de cette version

- **Rien ne fonctionne hors ligne** : le mode hors ligne (coffre local, numéros pré-alloués, synchronisation) arrive
  dans la phase suivante. Une coupure d'Internet interrompt le travail ; aucun écran ne dit « enregistré sur ce
  poste ».
- Les documents PDF (reçus, factures, ordonnances, fiche de consultation) sont produits **sur le poste** et ouverts
  dans la visionneuse du navigateur pour l'impression ; ils restent marqués **TEST** tant que les mentions légales,
  le logo et le régime fiscal ne sont pas validés (procédure de bascule).
- Le contrôle « examen payé ou dérogation » est **désactivé par défaut** (`EEO_EXAM_FEE_CONTROL=off`) : l'écran dit
  « Paiement de l'examen non contrôlé ».
- Atelier et communication : pas encore livrés. Le module `offline` reste fermé tant que la preuve hors ligne n'est pas faite.
- Les icônes de l'application sont provisoires.
- La seule tâche planifiée est la sauvegarde (étape 7).
- Sécurité : HTTPS obligatoire, mot de passe de la gérante fort et conservé hors serveur, `.env` en `chmod 600`,
  racine web = `public/` seul, sauvegardes hors racine web et copie chiffrée hors serveur.

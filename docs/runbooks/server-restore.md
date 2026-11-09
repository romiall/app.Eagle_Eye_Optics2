# Restaurer le serveur et réconcilier avant de rouvrir (X03)

Procédure d'exploitation, pour l'exploitant et la gérante. Sources : fichier 09 (« Sauvegardes et incident »),
fichier 19 (hors-ligne), fichier 25 (bascule, retour arrière) ; scénarios AT27 et AT44. Outils :
`tools/deploy/backup.sh`, `tools/deploy/restore-check.sh`, `php artisan eeo:restore:verify`,
`php artisan eeo:backup:record`.

Objectifs proposés par le fichier 09, à confirmer selon l'offre d'hébergement : RTO 4 h ; RPO ≤ 1 h pour les
données financières si l'offre permet des sauvegardes incrémentales, sinon jusqu'à 24 h (sauvegarde quotidienne de
`backup.sh`), à documenter dans la décision d'hébergement. Les valeurs réellement constatées sont notées dans
`docs/evidence/restore-rehearsal.md`.

## Ce que contient une sauvegarde

Dossier daté `eeo-backup-AAAAMMJJTHHMMSSZ` (0700, hors racine web) : `database.sql.gz.enc` (base complète, vues et
triggers, sans clause DEFINER), `storage-app.tar.gz.enc` (fichiers privés : PDF originaux, justificatifs, exports),
`env.backup.enc` (clé `APP_KEY` et secrets), `RELEASE.json`, `SHA256SUMS`. Chiffrement AES-256 (openssl, PBKDF2) avec
la clé `EEO_BACKUP_KEY_FILE`, dont une copie est gardée HORS du serveur par la responsable. Chaque partie est consignée
dans `backup_runs` (empreinte, taille, identifiant de clé). Une sauvegarde sans clé est consignée `NOT_ENCRYPTED` :
elle n'est pas conforme et ne sert pas de preuve.

Une sauvegarde serveur ne contient JAMAIS les pièces encore locales d'un poste hors-ligne (reçus, factures, patients
créés sans réseau et non encore acquittés) : elles se récupèrent par la synchronisation du poste (étape 5).

## 1. Arrêter les écritures

1. Mettre l'application en maintenance (`php artisan down`) : plus aucune vente ni paiement sur le serveur.
2. Prévenir l'accueil et la caisse : les postes préparés continuent HORS LIGNE sur leurs plages de numéros, sans
   rien effacer ; personne ne vide le navigateur, ne réinstalle ni ne « réinitialise » un poste.
3. En cas de compromission : bloquer les accès concernés, préserver les journaux (`storage/logs`), révoquer les
   secrets exposés (fichier 09).

## 2. Choisir l'état fiable

Prendre la sauvegarde la plus récente RÉUSSIE et chiffrée (`backup_runs`, statut `SUCCEEDED`, ou le dossier daté le
plus récent avec `SHA256SUMS` valide). Noter l'heure de fin de cette sauvegarde : c'est la borne de la perte.

## 3. Restaurer d'abord sur une base jetable

```bash
bash ~/eeo/tools/deploy/restore-check.sh ~/eeo-backups/eeo-backup-<date> <base>_restore ~/eeo
```

**Nom et utilisateur de la base jetable (Hostinger).** Le nom se termine par `_restore`, `_rest` ou `_test`. Hostinger limite le nom d'une base à 14 caractères après le préfixe du compte (`u…_`) et crée UN utilisateur par base : prendre un nom court (`eagle_restore`, 13 caractères, ou `eagleseye_rest`, 14) ; l'utilisateur de l'application n'a alors aucun droit sur la base jetable. Lancer dans un terminal (le mot de passe de l'utilisateur de la base jetable est demandé à l'invite, sans s'afficher ; il n'est jamais passé en argument ni lu par l'agent) :

```bash
ssh -t eagleseye 'EEO_RESTORE_DB_USERNAME=<utilisateur de la base jetable> bash ~/eeo/tools/deploy/restore-check.sh ~/eeo-backups/eeo-backup-<date> <base jetable> ~/eeo'
```

Avec un utilisateur propre, le script retire les `DEFINER` du dump (les déclencheurs et les vues sont recréés au nom de cet utilisateur : sans cela le serveur refuse le chargement, erreur 1227). Supprimer ensuite la base jetable ET son utilisateur dans le panneau : elle contient une copie des données de production.

Le script refuse la base de l'application, vérifie les empreintes, déchiffre, restaure, compare le schéma
(`eagle:verify-schema`, MySQL 8 seulement : sur MariaDB le script compte les tables, vues et déclencheurs restaurés et les rapproche de la baseline) et lance `eeo:restore:verify`. Lire chaque ligne :

| Contrôle | Attendu | Si non |
| --- | --- | --- |
| `SCHEMA_TABLES` | les 117 tables | sauvegarde incomplète : prendre la précédente |
| `INTEGRITY` | aucune ligne aux diagnostics `database/05_integrity_checks.sql` | ne pas rouvrir ; analyser le code de diagnostic |
| `SEQUENCES` | chaque séquence ≥ plus haut numéro consommé et ≥ fin de chaque plage de poste | ne JAMAIS rouvrir : un numéro serait redonné |
| `NUMBERED_DOCUMENTS` | chaque pièce émise liée à la consommation de son numéro | ne pas rouvrir |
| `AUDIT_HASHES` | chaque empreinte d'audit recalculée à l'identique | altération ou sauvegarde corrompue : prendre la précédente |
| `STORED_FILES` | chaque fichier privé présent avec son empreinte | récupérer les fichiers manquants (copie hors serveur) |
| `OFFLINE_RECONCILIATION` | alerte attendue si des postes travaillent hors ligne | étape 5 obligatoire avant réouverture |

La commande affiche aussi le dernier reçu restauré et, si la base vivante répond encore, le nombre de reçus et de
factures émises absents de la sauvegarde.

## 4. Remettre la base

Seulement si l'étape 3 ne montre aucun échec :

1. Importer la sauvegarde dans la base de l'application (panneau de l'hébergeur ou `mysql`), puis restaurer
   `storage/app` depuis `storage-app.tar.gz.enc` et le `.env` depuis `env.backup.enc` si le serveur est neuf (même
   `APP_KEY`, sinon les secrets chiffrés ne se relisent plus).
2. `php artisan eagle:verify-schema` puis `php artisan eeo:restore:verify` n'est PAS relancé sur la base de
   l'application (il le refuse) : refaire l'étape 3 sur une seconde base jetable si un doute subsiste.
3. Ne jamais remettre une séquence de numéros à une valeur inférieure, ne jamais renuméroter une pièce.

## 5. Réconcilier les postes AVANT de rouvrir les ventes

Pour chaque poste listé par `OFFLINE_RECONCILIATION` (plages de numéros ouvertes, quotas de stock, commandes non
conclues) :

1. Reconnecter le poste ; il pousse ses commandes locales (patients, factures, paiements, reçus) avec leurs numéros
   déjà attribués : le serveur les accepte et rend l'ACK, sans nouveau numéro (un reçu n'est jamais renuméroté).
2. Vérifier sur le poste qu'aucune commande ne reste en attente, et au serveur que la dernière pièce du poste est
   connue (le « dernier numéro connu du serveur » de la plage a avancé).
3. Les pièces créées EN LIGNE après la sauvegarde et avant la panne sont perdues du serveur : les retrouver par les
   PDF imprimés ou conservés sur les postes et les ressaisir comme pièces de reprise contrôlées, jamais en
   réutilisant un numéro (à décider avec la gérante, motif et audit).
4. Un poste perdu ou inaccessible : ne pas réattribuer sa plage ; suivre le fichier 19 (suspension, revue gérante).

## 6. Rouvrir et consigner

1. `php artisan up`. Vérifier une vente de test fictive seulement si la gérante l'autorise (sinon une simple
   consultation de la file du jour et de la caisse).
2. Consigner l'exercice ou l'incident :

   ```bash
   php artisan eeo:restore:verify <base>_restore --files=<dossier private restauré> \
     --started-at=<début ISO> --backup-run=<id backup_runs> --tested-by=<identifiant> --record
   ```

   La ligne `restore_tests` garde les contrôles, les faits restaurés et vivants, la durée et la perte constatées ;
   l'audit garde `restore.tested`. Compléter `docs/evidence/restore-rehearsal.md` (RTO, RPO, écarts).
3. Supprimer la base jetable et le dossier temporaire des fichiers.

## Retour arrière d'une mise à jour (rappel du fichier 25)

Après de nouvelles ventes, restaurer une ancienne base ferait perdre des faits : le retour arrière normal remet une
version de l'application compatible avec le schéma et GARDE la base. Une restauration de base ne se fait que par
cette procédure, écritures fermées et postes réconciliés.

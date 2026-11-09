# Exercice de restauration serveur (X03 ; AT27)

**État : exercice sur l'hébergement EXÉCUTÉ le 2026-11-09 (Hostinger, MariaDB 11.8.9) : résultat PASS.** Les valeurs du tableau « Exercice » sont CONSTATÉES sur l'hébergement (répétition locale du 2026-10-24 et tentatives du même jour, qui ont corrigé quatre défauts d'outil, plus bas). La ligne `restore_tests` n'a pas été consignée (`--record` écrirait dans la base de production, le demandeur ne l'a pas demandé). À refaire chaque mois. Procédure : `docs/runbooks/server-restore.md`.

**Deuxième tentative du 2026-11-09 (après le déploiement `3f15ac4`) : la restauration est FAITE, la vérification du schéma échoue sur MariaDB.** Sur l'hébergement, avec la base jetable `u720123645_eagleseye_rest` et son utilisateur propre, les empreintes de la sauvegarde `eeo-backup-20261109T150350Z` sont bonnes, le mot de passe est saisi à l'invite, la base est chargée (134 objets : 124 tables et 10 vues, déclencheurs compris : le filtre sur les propriétaires fonctionne) puis `eagle:verify-schema` échoue (erreur 1054, colonne `srs_id` inconnue) : cet outil ne lit que MySQL 8 et Hostinger est sous MariaDB 11.8.9. Le script rapproche désormais les objets restaurés de la baseline sur MariaDB. La base jetable n'est plus vide : la vider avant de rejouer.

**Première tentative du 2026-11-09 (13 h 53 UTC) : NON aboutie, trois défauts d'outil trouvés et corrigés.** Sur l'hébergement, les quatre empreintes de la sauvegarde `eeo-backup-20261108T210531Z` sont bonnes, puis le serveur refuse à l'utilisateur de l'application l'accès à la base jetable (erreur 1044). Causes : (1) Hostinger limite le nom d'une base à 14 caractères après le préfixe du compte, donc `<base>_restore` (`u720123645_eagleseye_restore`) ne peut pas être créé, et la garde du nom n'acceptait que `_restore` et `_test` ; `_rest` est désormais accepté ; (2) Hostinger crée un utilisateur par base : celui de l'application n'a aucun droit sur la base jetable et `eeo:restore:verify` ignorait `EEO_RESTORE_DB_USERNAME`, pourtant documenté par le script ; la commande lit maintenant les identifiants de la base jetable dans l'environnement du shell ; (3) découvert en préparant la reprise, par un essai local sur MySQL 8.4.9 : les 88 déclencheurs et les 10 vues du dump ont pour DEFINER l'utilisateur de l'application, que le serveur refuse à un autre utilisateur sans SUPER (erreur 1227, 6 tables restaurées sur 124) ; `restore-check.sh` retire les DEFINER du dump quand la base jetable a son propre utilisateur (essai : 124 tables, 10 vues, 88 déclencheurs restaurés). Aucune donnée n'a été restaurée ni modifiée sur l'hébergement.

**Reprise** : après le déploiement de la correction, lancer l'exercice dans un terminal, le mot de passe de l'utilisateur de la base jetable étant saisi à l'invite par la personne qui mène l'exercice (commande dans `docs/runbooks/server-restore.md`, section 3) ; sauvegarde à restaurer : la plus récente. Rien n'est consigné dans `restore_tests` sans l'accord du demandeur ; la base jetable ET son utilisateur se suppriment ensuite dans le panneau.

Le code est prêt : sauvegarde chiffrée et journal `backup_runs` (`tools/deploy/backup.sh`, `eeo:backup:record`),
restauration sur base jetable et contrôles (`tools/deploy/restore-check.sh`, `eeo:restore:verify`), tests
`tests/Feature/Operations/RestoreVerifierTest.php` (base MySQL isolée de test, données fictives).

## Répétition locale du 2026-10-24 (poste de développement, données fictives)

Ce n'est PAS l'exercice sur l'hébergement : il reste à faire sur Hostinger (tableau « Exercice » ci-dessous, à compléter).
Elle a validé la chaîne de scripts sur l'archive de livraison réellement construite (`tools/deploy/build-release.sh`,
commit `43f1057`), MySQL 8.4.9, Git Bash sous Windows (`openssl` natif : chemins relatifs dans le `.env` de la répétition).

| Élément | Constaté |
| --- | --- |
| Base source | base de test e2e : 3 fiches patient, 4 factures, 4 paiements, 4 reçus fictifs |
| Sauvegarde | `backup.sh` avec clé (`openssl rand -base64 48`) : `database.sql.gz.enc`, `storage-app.tar.gz.enc`, `env.backup.enc`, `SHA256SUMS` ; `backup_runs` : `SERVER_DATABASE` et `SERVER_FILES` `SUCCEEDED` |
| Restauration | `restore-check.sh` dans une base jetable `eeo_rehearsal_restore` : empreintes OK, schéma équivalent à la baseline (117 tables, 464 clés étrangères, 484 CHECK, 10 vues, 88 guards) |
| `eeo:restore:verify` | 7 contrôles `PASS` : catalogue (117 tables), diagnostics d'intégrité, séquences, pièces numérotées, 48 empreintes d'audit, fichiers privés, postes à synchroniser |
| Dernier reçu | `TEST-REC-2026-000004` restauré = dernier reçu de la base vivante ; 0 reçu et 0 facture émise absents |
| Durée | moins d'une minute (volume fictif minime : sans valeur pour le RTO réel) |

Défaut trouvé et corrigé grâce à cette répétition : l'archive retirait `database/schema_catalog.json` et
`database/05_integrity_checks.sql`, lus à l'exécution par `eeo:restore:verify` et par le dictionnaire des exports.
`build-release.sh` les conserve désormais et refuse d'emballer une archive qui en manque.

Non couvert par cette répétition : Linux/Hostinger (versions de `mysqldump`, `openssl`, droits de la base), `--record`
dans `restore_tests`, copie hors serveur.

## Exercice

| Élément | Valeur constatée |
| --- | --- |
| Date et personne (`--tested-by`) | 2026-11-09 ; mot de passe de la base jetable saisi à l'invite par le demandeur dans son terminal ; `--tested-by` non renseigné (pas de `--record`) |
| Sauvegarde restaurée (`backup_runs.id`, fin) | `eeo-backup-20261109T150350Z`, prise par le déploiement de `3f15ac4` (`backup_runs` SERVER_DATABASE `01M70DCJX5D4B5YRHG482NQQB2`, terminée à 15:03:52Z) |
| Clé de chiffrement utilisée (identifiant) et sa copie hors serveur vérifiée | clé du serveur `~/.eeo-backup.key` (déchiffrement réussi) ; copie hors serveur NON vérifiée |
| Base jetable | `u720123645_eagleseye_rest`, vide au départ, avec son utilisateur propre (un utilisateur par base chez Hostinger) ; script `restore-check.sh` du commit `4c27f26`, copié dans le dossier personnel du serveur (hors release) ; copie temporaire du script retirée du serveur ; base et utilisateur supprimés dans le panneau par le demandeur le 2026-11-09 (copie des données de production ; suppression déclarée, non vérifiable depuis le serveur) |
| Ligne `restore_tests` | non consignée (`--record` non demandé : il écrirait une ligne dans la base de production) |
| Durée de restauration constatée (RTO) | chargement de la base : 3 s ; durée constatée par `eeo:restore:verify` : moins d'une minute (0 min), sur un volume minimal (1 cabinet, 1 fiche patient, 2 visites, 2 consultations, 35 événements d'audit, aucune facture ni aucun reçu) : sans valeur pour le RTO réel (objectif proposé : 4 h) |
| Perte constatée (RPO) : reçus / factures émises absents, fenêtre | 0 reçu et 0 facture émise absents de la sauvegarde (la base de production n'en contient aucun) ; fenêtre non applicable. L'objectif proposé (≤ 24 h avec sauvegarde quotidienne) n'est PAS garanti : aucune sauvegarde planifiée n'existe, les huit sauvegardes les plus récentes datent toutes d'un déploiement |
| Dernier reçu retrouvé | aucun : la production ne contient encore aucun reçu |

## Contrôles

| Contrôle | Résultat | Écart et décision |
| --- | --- | --- |
| SCHEMA_TABLES | PASS (117 tables du catalogue) | Comparaison complète à la baseline (`eagle:verify-schema`) impossible sur MariaDB : 124 tables, 10 vues et 88 déclencheurs restaurés, comme la baseline |
| INTEGRITY | PASS (aucune ligne aux diagnostics) | |
| SEQUENCES | PASS | |
| NUMBERED_DOCUMENTS | PASS (aucune pièce numérotée à lier) | pièces numérotées non exercées sur cette base : prouvées par PHPUnit et la répétition locale |
| AUDIT_HASHES | PASS (35 empreintes recalculées à l'identique) | |
| STORED_FILES | PASS (aucun fichier privé à retrouver) | |
| OFFLINE_RECONCILIATION | PASS (aucun poste à synchroniser) | |

## Écarts connus avant l'exercice

- Sauvegarde quotidienne seulement : un RPO d'une heure exige des sauvegardes incrémentales ou binlogs, à vérifier
  sur l'offre (décision d'hébergement, fichier 09).
- La copie hors serveur reste manuelle (`scp`, étape 7 de `docs/implementation/deploiement.md`).
- La restauration d'un poste hors-ligne (export chiffré local, AT44) relève d'O07, non couverte ici.
- **Constatés à l'exercice du 2026-11-09** : aucune sauvegarde planifiée n'existe (à créer dans le panneau de l'hébergeur : tâche cron quotidienne de `tools/deploy/backup.sh`) ; copie hors serveur non vérifiée ; `eagle:verify-schema` inutilisable sur MariaDB ; volume de la base trop faible pour un RTO réel ; production sans pièce financière.

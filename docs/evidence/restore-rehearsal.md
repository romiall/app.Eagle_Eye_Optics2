# Exercice de restauration serveur (X03 ; AT27)

**État : exercice sur l'hébergement NON EXÉCUTÉ** (répétition locale faite le 2026-10-24, voir ci-dessous). Ce document est le modèle de preuve à compléter lors de l'exercice sur l'hébergement cible
(Hostinger, accès SSH), puis chaque mois. Aucune valeur ci-dessous n'est constatée tant qu'une ligne `restore_tests`
de statut `PASSED` ne la justifie pas. Procédure : `docs/runbooks/server-restore.md`.

**Tentative du 2026-11-09 (13 h 53 UTC) : NON aboutie, trois défauts d'outil trouvés et corrigés.** Sur l'hébergement, les quatre empreintes de la sauvegarde `eeo-backup-20261108T210531Z` sont bonnes, puis le serveur refuse à l'utilisateur de l'application l'accès à la base jetable (erreur 1044). Causes : (1) Hostinger limite le nom d'une base à 14 caractères après le préfixe du compte, donc `<base>_restore` (`u720123645_eagleseye_restore`) ne peut pas être créé, et la garde du nom n'acceptait que `_restore` et `_test` ; `_rest` est désormais accepté ; (2) Hostinger crée un utilisateur par base : celui de l'application n'a aucun droit sur la base jetable et `eeo:restore:verify` ignorait `EEO_RESTORE_DB_USERNAME`, pourtant documenté par le script ; la commande lit maintenant les identifiants de la base jetable dans l'environnement du shell ; (3) découvert en préparant la reprise, par un essai local sur MySQL 8.4.9 : les 88 déclencheurs et les 10 vues du dump ont pour DEFINER l'utilisateur de l'application, que le serveur refuse à un autre utilisateur sans SUPER (erreur 1227, 6 tables restaurées sur 124) ; `restore-check.sh` retire les DEFINER du dump quand la base jetable a son propre utilisateur (essai : 124 tables, 10 vues, 88 déclencheurs restaurés). Aucune donnée n'a été restaurée ni modifiée sur l'hébergement.

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
| Date et personne (`--tested-by`) | à compléter |
| Sauvegarde restaurée (`backup_runs.id`, fin) | à compléter |
| Clé de chiffrement utilisée (identifiant) et sa copie hors serveur vérifiée | à compléter |
| Base jetable | `<court>_restore` ou `<court>_rest` (14 caractères au plus après le préfixe sur Hostinger) |
| Ligne `restore_tests` | à compléter |
| Durée de restauration constatée (RTO) | à compléter (objectif proposé : 4 h) |
| Perte constatée (RPO) : reçus / factures émises absents, fenêtre | à compléter (objectif proposé : ≤ 24 h avec sauvegarde quotidienne) |
| Dernier reçu retrouvé | à compléter |

## Contrôles

| Contrôle | Résultat | Écart et décision |
| --- | --- | --- |
| SCHEMA_TABLES | à compléter | |
| INTEGRITY | à compléter | |
| SEQUENCES | à compléter | |
| NUMBERED_DOCUMENTS | à compléter | |
| AUDIT_HASHES | à compléter | |
| STORED_FILES | à compléter | |
| OFFLINE_RECONCILIATION | à compléter | |

## Écarts connus avant l'exercice

- Sauvegarde quotidienne seulement : un RPO d'une heure exige des sauvegardes incrémentales ou binlogs, à vérifier
  sur l'offre (décision d'hébergement, fichier 09).
- La copie hors serveur reste manuelle (`scp`, étape 7 de `docs/implementation/deploiement.md`).
- La restauration d'un poste hors-ligne (export chiffré local, AT44) relève d'O07, non couverte ici.

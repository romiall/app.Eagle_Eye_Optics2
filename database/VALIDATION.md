# Validation de la base complète

Validation exécutée le **14 octobre 2026** sur **MySQL Community Server 8.4.9**, avec une base de test isolée. Les fichiers importés sont `01_schema.sql`, `02_reference_data.sql`, `03_reporting_views.sql` et `04_history_guards.sql`, dans cet ordre. L’import complet termine sans erreur SQL.

Le moteur temporaire utilise uniquement le transport Windows par mémoire partagée, avec le réseau désactivé (`skip-networking`, port 0). Son répertoire de données, ses logs et ses fichiers temporaires sont dans l’espace de travail de validation. Aucun service Windows, paramètre global ou base existante n’a été modifié. Le moteur a été arrêté avec `mysqladmin` après chaque vérification.

Le livrable unique [eagle_eye_optics_complet.sql](eagle_eye_optics_complet.sql) a également été importé séparément dans une base vide, puis vérifié par l’audit metadata : import réussi, mêmes 117 tables, 464 FK, 484 CHECK, 88 triggers et 10 vues. Son empreinte est incluse dans le rapport. Les fichiers de données temporaires de cette dernière vérification ont ensuite été supprimés ; les preuves portables restent dans ce dossier.

Après la dernière vérification, le répertoire de données et les fichiers temporaires de ce moteur jetable ont été supprimés. Les logs et le rapport ont été conservés ; aucun processus MySQL de validation ne reste actif.

## Résultats

| Vérification | Résultat |
| --- | --- |
| Tables de l’application entière | 117 créées |
| Clés étrangères | 464 créées |
| Contraintes CHECK | 484, toutes appliquées par MySQL |
| Déclencheurs de conservation de l’historique | 88 créés |
| Vues de reporting | 10 créées et résolues |
| Référentiels | 4 rôles, 49 permissions, 76 termes cliniques |
| Moteurs et encodages des tables | InnoDB et utf8mb4 |
| Relations entre cabinets | Toutes les FK entre deux tables portant `clinic_id` incluent ce champ |
| Nombres approximatifs | Aucun FLOAT ou DOUBLE |
| Suppression en cascade | Aucune FK avec DELETE CASCADE |
| Scénarios SQL | 41 assertions réussies, aucune échouée |
| Diagnostics de cohérence | 25 requêtes de `05_integrity_checks.sql` résolues, zéro anomalie sur la base de référence sans données métier |

Les scénarios contrôlent notamment :

- Le rejet d’un patient appartenant à un autre cabinet et d’une consultation rattachée au mauvais patient du même cabinet.
- L’arrondi exact d’une demi-unité de FCFA, les totaux de ligne et le rejet des montants négatifs ou des reprises papier sans solde renseigné.
- L’immuabilité d’une facture émise, de ses lignes, des paiements confirmés, reçus et livraisons confirmées.
- L’unicité des numéros consommés, clés d’idempotence, reçus par paiement et sessions de caisse actives.
- Le solde d’une facture avec deux paiements, deux avoirs, une contre-écriture et un remboursement ; les vues doivent conserver les totaux sans multiplication des lignes par les jointures.
- La distinction entre chiffre d’affaires, encaissements et caisse.
- Le propriétaire financier unique d’une facture, la séquence unique d’un poste, l’appartenance d’une autorisation au bon poste et la conservation du contenu original des commandes reçues.
- Une commande produisant plusieurs mouvements de stock, une réserve sous quota local, le rejet d’un autre lot, une livraison et le recomptage du stock après consolidation sans soustraction double.

Les données synthétiques portent la mention TEST. Elles sont insérées dans une transaction puis annulées par `ROLLBACK`. Après les tests : zéro cabinet, patient ou demande d’idempotence synthétique ; zéro procédure de test restante. Les référentiels installés par `02_reference_data.sql` restent présents.

## Reproduire les tests

Utiliser une **base de développement ou de test initialement vide**, jamais la base de production. Importer les fichiers `01` à `04`, puis exécuter dans le client MySQL, avec cette base sélectionnée :

```sql
SOURCE database/tests/mysql_metadata_tests.sql;
SOURCE database/tests/mysql_smoke_tests.sql;
```

Ces chemins sont relatifs au dossier du projet ; adapter le chemin de lecture si le client est lancé ailleurs. Le compte de test doit pouvoir créer et supprimer les procédures temporaires employées par les assertions. Les procédures sont supprimées à la fin d’une exécution réussie. Un arrêt prématuré peut nécessiter de recréer la base de test vide avant de rejouer les fichiers.

Les messages attendus sont `metadata_checks_passed`, 41 lignes `PASS ...`, puis `smoke_checks_passed_and_fixtures_rolled_back`. Une erreur MySQL ou un `SIGNAL` signifie que la validation a échoué ; ne pas masquer ces erreurs avec une option de poursuite forcée.

## Limites de cette validation

Cette preuve couvre l’import et les garanties effectivement exprimées par les contraintes, déclencheurs et vues de la base. Elle ne valide pas encore le code PHP, les autorisations par rôle, les signatures cryptographiques, les transitions métier agrégées, la concurrence entre transactions, le coffre IndexedDB, les impressions ou le parcours PWA sans réseau. Ces contrôles restent exigés par les spécifications et les scénarios de recette applicative. Les plafonds cumulés entre lignes, la consommation des approbations et l’allocation sans chevauchement de plages doivent être vérifiés dans les commandes transactionnelles prévues au socle.

La présence de 117 tables définit immédiatement le modèle de toute l’application. Elle ne signifie pas que toutes les interfaces et intégrations doivent être livrées dans le premier lot.

Les empreintes SHA-256 des fichiers vérifiés, les 41 intitulés de tests, les compteurs et les limites sont conservés dans [validation_report.json](validation_report.json). Le relevé d’exécution portable est dans [tests/validation_execution.log](tests/validation_execution.log). Les diagnostics ont été compilés et exécutés sur la base de référence sans données métier ; leur capacité à détecter chaque incohérence future devra aussi être testée sur les cas applicatifs concernés.

## Amendement du 2026-11-06 (gate G2)

`05_integrity_checks.sql`, diagnostic I01 (total et lignes d’une facture émise) : limité aux factures `NATIVE`. Les diagnostics d’origine n’avaient été résolus que sur une base de référence VIDE ; le gate G2 les a joués sur les données de tous les parcours e2e et I01 signalait à tort la pièce d’une reprise de créance papier (`origin = LEGACY_BALANCE`), qui n’a par construction aucune ligne d’article (la reprise a son propre diagnostic, I08). Sans cet amendement, `eeo:restore:verify` aurait échoué sur une base saine après la première reprise. Seule l’empreinte de `05_integrity_checks.sql` change dans `validation_report.json` ; celles des scripts de schéma, de référentiels, de vues et de garde-fous sont inchangées. Preuves : `LegacyBalancesTest::test_une_creance_reprise_n_est_pas_une_anomalie_des_diagnostics_d_integrite` et `tests/e2e/zz-diagnostics-sql.spec.ts` (`docs/evidence/G2.md`).

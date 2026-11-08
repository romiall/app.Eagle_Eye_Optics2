# Journal d'exécution — Eagle's Eye Optics Medical

Initialisé le 2026-10-14 depuis `specifications/developpement/JOURNAL.md`. Le backlog canonique (`specifications/developpement/backlog.json`) n'est jamais modifié ni régénéré ; les statuts de travail sont dans `docs/implementation/task-status.json`.

## État courant

- Branche : `claude/docs-fumee-authentifiee` (coupée de `main` = `19cff99`, tête de `main` au second déploiement du 2026-11-08 ; elle porte le journal du contrôle de fumée et de ce déploiement) ; `claude/journal-deploiement` et `claude/docs-etat-production` sont fusionnées dans `main` par avance rapide (CI verte de chaque arbre) ; toute nouvelle branche part de `origin/main`. `main` contient la pile, O06 et O05, R01 et G2, P04, U01 et G3 ; leurs branches `claude/…` sont SANS OBJET. Fusion dans `main` : accord permanent du demandeur depuis le 2026-11-07 (règle dans `CLAUDE.md`). Dépôt public : données fictives uniquement ; développement sur un poste local depuis le 2026-10-15, une seule session à la fois dans ce dossier.
- Lot et gate visés : L0 ; **G0 acquis** (voir `docs/evidence/G0.md`) ; **G1 DONE** (prouvé le 2026-10-28, arbitré par le demandeur le 2026-10-30 : `docs/evidence/G1.md`) ; **G2 prouvé le 2026-11-06, IN_REVIEW** (`docs/evidence/G2.md`) ; **P04 faite le 2026-11-07, IN_REVIEW** (`docs/runbooks/profile-flow.md`) ; **U01 faite en partie le 2026-11-07, IN_REVIEW PARTIEL, fusionnée dans `main`** (`docs/evidence/usability.md`) ; **G3 faite le 2026-11-07, IN_REVIEW, fusionnée dans `main`** (`docs/evidence/G3.md`, registre `docs/evidence/acceptance-L0.json` : 35 scénarios sur 39 prouvés, 4 bloqués) ; prochain : G4, après l'arbitrage de G3.
- Tâche courante (2026-11-07) : **G3** « Exécuter toute la recette L0 et figer le candidat » faite (section « G3 » ci-dessous), CI verte, fusionnée dans `main`, en attente de l'arbitrage du demandeur ; la suivante est **G4** (bascule réelle : hébergement réel compatible, paramètres réels, comptes et postes prêts, utilisateurs formés, créances, stock et numéros rapprochés, décision de bascule du responsable), dont presque tout dépend de la cliente, de l'hébergement et du demandeur. O06, O05, R01, G2, P04, U01 et G3 sont fusionnées dans `main`. Historique : lot 2 vérifié le 2026-10-24 (run 40044078785, commit `cb7a008`), H01 EN LIGNE le 2026-10-27 (`docs/implementation/deploiement.md`).
- Dernière preuve acquise : CI verte de `main` au candidat de G3 (run 42374428715 sur `d98f48c` : PHP, Frontend, E2E) ; CI verte de `claude/g3-recette-l0` (runs 42377902220 sur `08d8fa7` et 42378819511 sur `ceba7a8`) ; CI verte de la fusion (run 42409519554 sur `a4e2e49`) et de `main` (run 42410446296) ; production déployée sur `a4e2e49` le 2026-11-08, contrôle de fumée authentifié passé (section « Déploiement en production du 2026-11-08 ») ; CI verte du journal et de la correction de la page Agenda un dimanche (run 42470892796 sur `d2e3d93`), CI verte de `main` sur `19cff99` (run 42477359716), puis `19cff99` déployé en production le même jour (section « Second déploiement du 2026-11-08 »). La validation SQL d'origine (`database/VALIDATION.md`, amendée le 2026-11-06 pour le diagnostic I01) et G0 restent **distincts d'une recette applicative**.
- Statut et preuves de chaque tâche : `docs/implementation/task-status.json` (la liste n’est plus recopiée ici).
- Blocages externes : Q01–Q04/Q14 (production seulement) ; développement fictif possible.
- Prochaine action concrète : l'arbitrage de G3 par le demandeur (décisions 1 et 2 : consultation et livraison hors ligne ; accord 3 : exercice de restauration sur l'hébergement ; demande 4 : personnes et matériel ; 5 : déploiement, FAIT le 2026-11-08, avec les paquets Symfony corrigés), puis G4 et les lots L1 restants (ordre du demandeur du 2026-11-05) ; le contrôle de fumée authentifié est à relancer par le demandeur sur la release `19cff99` (la correction de la page Agenda y est en production).

## Déploiement en production du 2026-11-08 (`main` = `a4e2e49`)

- **Demande** : le demandeur a répondu « Oui, déployer » à la question « Déployer main en production maintenant ? » (2026-11-08). C'est la demande de CE déploiement : le suivant se redemande.
- **Release** : `eeo-20261108T0854Z-a4e2e49` (commit `a4e2e49` = `main`, CI verte, run 42410446296), construite sur ce poste depuis un arbre propre identique à `origin/main` par `bash tools/deploy/deploy-hostinger.sh` (archive de 6,1 Mo, empreinte SHA-256 `838e63bfcc85…` vérifiée sur le serveur). Elle remplace `eeo-20261030T1916Z-bbd83c4`, qui reste sur le serveur : un retour arrière est possible en rebasculant le lien `~/eeo` (aucune migration n'a été appliquée).
- **Contenu livré** (46 commits depuis `bbd83c4`) : le bandeau de mise à jour (O06), la synchronisation (O05 : code dormant, module `offline` toujours FERMÉ), l'écran de finance du cabinet (R01), le diagnostic de restauration I01 amendé (G2), la correction du déverrouillage après la préparation d'un poste (P04), la marge de défilement du téléphone (U01) et le verrou Symfony 7.4.23. La recette G3 n'ajoute aucun code d'application. Aucune migration ni changement de configuration depuis la release précédente.
- **Sur le serveur** : sauvegarde préalable `eeo-backup-20261108T090615Z` (base et fichiers, 80 Ko ; la copie hors serveur, rappelée par le script, reste à faire) ; `eeo:preflight` **sans point bloquant** et trois alertes (extension PHP `sodium` absente, nécessaire aux lots suivants ; `expose_php` activé ; documents officiels activés alors que mentions légales, logo et régime fiscal restent à valider) ; `migrate` : rien à migrer ; caches de configuration, de routes et de vues créés ; bascule du lien `~/eeo`.
- **Vérifié en ligne sans identifiant** (13 contrôles HTTP verts, plus des relevés par SSH) : `/up` ; identité du build `{"id":"a4e2e49"}` ; API inconnue en 404 JSON ; `/api/v1/auth/me` en 401 sans connexion ; page d'accueil, script `main-BTRVNRnJ.js` (même nom que la construction locale) et service worker servis, le service worker précharge ce script ; `/.env`, `/.git/config`, `/composer.json`, `/artisan`, le journal et `RELEASE.json` non servis ; route de finance R01 enregistrée (401 `AUTH_REQUIRED` sans session, `route:list` par SSH) ; `.env` en mode 600 ; modules ouverts `settings, patients, today, consultations, sales, stock, reports` (`offline` fermé) ; `symfony/http-foundation`, `http-kernel` et `routing` en **v7.4.23** (`symfony/yaml`, dépendance de développement, n'est pas installé en production) ; aucune erreur dans le journal de la release.
- **Contrôle de fumée authentifié (fait le 2026-11-08 par le demandeur)** : `tools/deploy/smoke.sh` demande le mot de passe de l'application pour le compte de la gérante, que l'agent n'a pas et ne saisit pas (l'accès SSH, lui, se fait par clé). Le demandeur l'a lancé depuis son poste : un premier essai avec l'identifiant d'exemple `gerante` a passé les 15 contrôles sans identifiant puis été refusé à la connexion (422 : le serveur répond de la même façon pour un identifiant inconnu, un mot de passe faux ou un compte désactivé) ; un second essai avec l'identifiant réel **passe** (déclaration du demandeur, sortie non transmise). Le script se connecte, relit le compte, lit patients, file du jour, examens, échelles d'acuité, factures, caisse, stock, personnel et identité des documents (aucune écriture, aucune donnée créée), puis se déconnecte. La commande à donner n'a pas de mot de passe : `bash tools/deploy/smoke.sh https://app-eagleseye.com <identifiant>` (le script le demande à l'invite). Ce que prouvent la CI et la recette G3 vaut pour le même code ; ce contrôle ajoute la connexion et les lectures sur la base de production.
- **Navigateurs** : la première livraison contenant O06 n'est vue que par l'ancien bandeau discret : cliquer sur « Installer la nouvelle version » (repli : fermer tous les onglets de l'application puis la rouvrir) ; le pied de page de chaque écran doit alors afficher `a4e2e49`.
- **CI du journal rouge le dimanche** : la CI de `claude/journal-deploiement` sur `59c73bf` (documents seulement, run [42466264952](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42466264952)) a échoué sur deux parcours e2e liés à la date, la CI tournant à la date réelle (dimanche 2026-11-08). (1) `finance.spec.ts` : le libellé d'un seul jour s'ouvre par le nom du jour (« Période : dimanche 8 novembre 2026 ») et le test refusait l'initiale « d » pour exclure « du … au … » ; défaut du TEST, reproduit sur le poste un dimanche, corrigé par `(?!du )`. (2) `agenda.spec.ts` : DÉFAUT DE LA PAGE AGENDA, trouvé grâce au diagnostic de l'écran ajouté au test (run [42468174594](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42468174594) : « Aucun rendez-vous ce jour-là » pour le lundi 9 novembre alors que le rendez-vous venait d'être confirmé) et au journal du serveur de test (une seule lecture de l'agenda au lieu de deux : le clic sur « Afficher » était perdu). Cause : le titre et les cartes suivaient la saisie du champ « Jour » ; à la sortie du champ « Agenda du dimanche 8 novembre 2026 » devenait « Agenda du lundi 9 novembre 2026 », plus court d'une ligne en police large (Verdana, voisine de la police de la CI, 1280 px) : le bouton « Afficher » montait de 36 px entre l'appui et le relâchement du clic et le clic était perdu ; l'écran affichait de plus « Aucun rendez-vous ce jour-là » pour un jour pas encore lu. Reproduit sur le poste avec la police large, puis corrigé : le titre et les cartes suivent la période LUE (`applied`, mise à jour par « Afficher », les flèches, « Aujourd'hui » et « Jour / Semaine »), jamais la saisie ; le bouton ne bouge plus et le clic déclenche la lecture. Gardé par un test Vitest (`agenda-pages.test.ts`, qui échoue sur l'ancienne page) et par la position du bouton dans `agenda.spec.ts`, rendu rejouable (un patient par essai). CI verte de ce correctif un dimanche (run [42470892796](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42470892796) sur `d2e3d93`), puis `main` avancé sur `d2e3d93` par avance rapide (accord permanent de fusion). **Ce correctif touche le code de l'application : il n'était PAS dans la release `a4e2e49` ; il est en production depuis le second déploiement du 2026-11-08 (release `19cff99`, section suivante).**

## Second déploiement du 2026-11-08 : correctif de la page Agenda (`main` = `19cff99`)

- **Demande** : le demandeur a répondu « Oui, déployer » à la question « Déployer le correctif de la page Agenda en production maintenant ? », en y ajoutant « règle [le] correctif de la page Agenda » (lu comme : livrer ce correctif). C'est la demande de CE déploiement : le suivant se redemande.
- **Release** : `eeo-20261108T1441Z-19cff99` (commit `19cff99` = `main`, CI verte, run [42477359716](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42477359716) ; l'arbre de `d2e3d93` plus deux fichiers de documentation), construite sur ce poste depuis un arbre propre identique à `origin/main` par `bash tools/deploy/deploy-hostinger.sh` (archive de 6,1 Mo, empreinte SHA-256 `c8676df8d301…` vérifiée sur le serveur). Elle remplace `eeo-20261108T0854Z-a4e2e49`, qui reste sur le serveur : un retour arrière est possible en rebasculant le lien `~/eeo` (aucune migration).
- **Contenu livré** : la page Agenda dont le titre et les cartes suivent la période LUE et non la saisie du champ « Jour » (`AgendaPage.vue` ; voir la puce « CI du journal rouge le dimanche » ci-dessus). Aucun autre code d'application, aucune migration, aucun changement de configuration.
- **Sur le serveur** : sauvegarde préalable `eeo-backup-20261108T210531Z` ; `eeo:preflight` sans point bloquant et les trois mêmes alertes que le matin (extension `sodium` absente, `expose_php` activé, documents officiels à valider) ; `migrate` : rien à migrer ; caches de configuration, de routes et de vues recréés ; bascule du lien `~/eeo` ; `/up` répond. Les horodatages de la release (construction, 14 h 41 UTC) et de la sauvegarde (envoi, 21 h 05 UTC) sont séparés de plusieurs heures ; l'horloge du poste et celle du serveur concordent à deux secondes près.
- **Vérifié en ligne sans identifiant** : `/up` ; identité du build `{"id":"19cff99"}` ; API inconnue en 404 JSON ; `/api/v1/auth/me` en 401 ; page d'accueil, script `main-B3g1LwOO.js` et service worker servis (le service worker précharge ce script) ; **l'empreinte SHA-256 du script servi est identique à celle du script construit sur le poste** ; l'ancien `main-BTRVNRnJ.js` n'est plus servi (404, attendu) ; `/.env`, `/.git/config`, `/composer.json`, `/artisan`, le journal et `RELEASE.json` non servis ; en-têtes de sécurité en place ; par SSH en lecture seule : lien `~/eeo` et `RELEASE.json` sur `19cff99`, `.env` en mode 600, modules ouverts `settings, patients, today, consultations, sales, stock, reports` (`offline` fermé), `symfony/http-foundation`, `http-kernel` et `routing` en v7.4.23, aucun journal d'erreur dans la release.
- **Non fait** : le contrôle de fumée authentifié n'a pas été relancé sur cette release (il avait passé le matin sur `a4e2e49`) ; à relancer par le demandeur : `bash tools/deploy/smoke.sh https://app-eagleseye.com <identifiant>` (mot de passe demandé à l'invite). La copie hors serveur de la sauvegarde, rappelée par le script, reste à faire.
- **Navigateurs** : cliquer sur « Installer la nouvelle version » dans le bandeau (repli : fermer tous les onglets de l'application puis la rouvrir) ; le pied de page de chaque écran doit alors afficher `19cff99`.
- **Outil corrigé** : l'indication de fin de `deploy-hostinger.sh` proposait `EEO_SMOKE_PASSWORD='<mot-de-passe>' … gerante`, soit un mot de passe sur la ligne de commande et un identifiant d'exemple (`gerante`) qui n'est pas celui de la production (le premier essai du demandeur avec lui a été refusé en 422). Elle donne maintenant `bash tools/deploy/smoke.sh <adresse> <identifiant de la gérante>` (mot de passe demandé à l'invite) ; le lancement automatique du contrôle exige `EEO_SMOKE_LOGIN` en plus de `EEO_SMOKE_PASSWORD` ; `deploiement.md` (étape 5) dit la même chose.

## Fusion de la pile dans `main` et début d’O06 (2026-11-05)

- **Fusion** : à la demande du demandeur (« fusion puis L0 : O06, O05, R01, puis les portes G2, U01, G3, G4 ; L1, L2 et L3 »), `main` contient désormais toute la pile de chantiers (parcours hors ligne O05, reprise d’un poste O07, preuve G1, déverrouillage public hors ligne, lecture locale des écrans, facture sur le poste, formulaires, aide intégrée, annuaire du poste, CRUD des écrans) : commit de fusion `70ef9c2`, par la branche `claude/fusion-pile`. CI verte avant la fusion (run 42037277616 sur `f6c84e4`). Le run précédent (42033512917 sur `1ac6c18`) avait échoué sur l’audit Composer de la CI (sept avis de sécurité du 2026-11-04 sur symfony/http-foundation, http-kernel, routing et yaml) : correctif de verrou seul, 7.4.23 (`f6c84e4`). La PR n°1 s’est marquée fusionnée ; la n°2 est à fermer par le demandeur ; les branches empilées sont sans objet. Le run sur `main` (42091511738, `70ef9c2`) est vert (Frontend, PHP, E2E).
- **Production inchangée** : https://app-eagleseye.com exécute la release `eeo-20261030T1916Z-bbd83c4` (antérieure à la fusion) ; le module `offline` y reste fermé ; les quatre paquets Symfony y sont encore en 7.4.21 (le verrou du dépôt est en 7.4.23). Rien n’est déployé sans demande du demandeur.
- **Début d’O06** : branche `claude/o06-mises-a-jour`, coupée de `origin/main` (`70ef9c2`). Point de départ : le code existait déjà en partie (règles `offline/update/updateGate.ts` et `updateCheck.ts`, registre additif `offline/migrations/registry.ts`, bannière `UpdatePrompt.vue`, configuration `pwa.config.ts`, tests Vitest `update.test.ts`, `migrations.test.ts`, `pwa-config.test.ts`), mais aucun critère de sortie n’était prouvé dans un vrai navigateur et la tâche restait NOT_STARTED. Le détail du travail et des preuves s’ajoute ci-dessous au fil du chantier.
- **Expérience du demandeur à corriger** : le 2026-10-30 il n’a pas vu des corrections livrées en ligne, parce que son navigateur affichait l’ancienne version et que la bannière de mise à jour (en haut de page, sans rappel) n’a été ni comprise ni cliquée. Sans jamais imposer la mise à jour (règle O06), le chantier la rend impossible à manquer et compréhensible.

## R01 — Afficher soldes, caisse et finance avec fraîcheur (2026-11-06)

Troisième tâche de l'ordre du demandeur (O06, O05, R01, puis G2, U01, G3, G4 ; L1, L2, L3), coupée de `origin/main`
(`2c29218`) : elle dépend d'O05 (fraîcheur des postes). Le code en ligne se limitait à la caisse du jour d'un jour civil ; le
contrat (fichier 08) prévoyait `FinancialDashboard`, `GET /reports/financial?from&to`, sans l'implémenter. Détail,
définitions, fraîcheur et écarts : `docs/implementation/billing.md`, « Finance du cabinet sur une période (R01) ».
**Statut : IN_REVIEW, pas DONE.**

- **Serveur** : `ReportPeriod` (jours civils du cabinet, 366 jours au plus, 422 sinon), `FinancialReports` (chiffre d'affaires =
  factures émises − avoirs émis ; encaissements = paiements − contre-écritures − remboursements à leur date effective ;
  créances et crédits à rembourser de toutes périodes ; reprises papier à part ; sessions clôturées et corrections après
  clôture ; ventes par auteur de l'émission, encaissements par auteur du paiement ; fraîcheur par poste de caisse), route
  `GET /api/v1/reports/financial` réservée à `finance.global.read` (gérante), module `sales`. Chaque agrégat vient d'une vue qui
  somme chaque registre indépendamment avant toute jointure : pas de fanout paiement/avoir. Contrat : le schéma prévu (totaux
  plats) est remplacé par `operations.json#/$defs/FinancialReport` ; `FinancialDashboard` est implémentée (150 opérations).
- **Écran** : `pages/reports/Financial.vue` (`/ventes/finance`), période par préréglages ou intervalle, fraîcheur dite EN
  PREMIER, quatre lectures séparées, « Par personne » ; entrées dans « Ventes et caisse » (gérante) et la caisse du jour ;
  fiche d'aide intégrée `finance`. Relu à 1280 et 360 px sur captures.
- **Postes hors ligne** (O05) : un poste dont des commandes reçues attendent rend les totaux incomplets (`WAITING`) ; un poste
  muet depuis plus de 24 h avant la fin de la période, ou jamais synchronisé, les rend possiblement incomplets (`SILENT`) ;
  les totaux ne contiennent jamais une opération restée sur un poste. Un fait de poste n'est compté qu'une fois, même après un
  renvoi de lot.
- **Tests ajoutés** : PHPUnit `FinancialReportTest` (AT24, AT26, auteurs, aucune multiplication, dates effectives et bornes du
  jour à Douala, caisse clôturée, droits, cabinet, module, période) et `FinancialReportFreshnessTest` (vrais postes ES256) ;
  Vitest `financial-report.test.ts` (règles et écran), `entry-points.test.ts` ; Playwright `finance.spec.ts`. Contrôle par
  mutation : si l'état d'attente d'un poste est ignoré, le test de fraîcheur échoue.
- **Écarts déclarés** : seuil de silence de 24 h à confirmer avec la gérante ; `last_sync_at` = dernière pièce acceptée, non
  dernier contact (un poste inactif peut sembler muet) ; écran dans `sales` et non `reports` ; lecture en ligne seulement (le
  tableau de bord local de la caisse reste celui des projections du poste, A1) ; ni export, ni PDF, ni graphique, ni âge des
  créances, ni valeur du stock (L1).
- **Vérification** (2026-11-06, poste Windows, `tools/dev/phase-check.sh` sans Playwright) : contrats à jour, Pint, PHPStan sans
  erreur, PHPUnit complet (2 511 tests, 78 757 assertions, 1 ignoré : liens symboliques non permis sur ce poste, vérifié en CI
  Linux), vue-tsc, ESLint, Prettier, Vitest complet (163 fichiers, 3 315 tests dont 20 ignorés : le compte de routes de
  `bootstrap.test.ts` est passé de 51 à 52), build. Navigateur réel (Edge) : `finance.spec.ts` et les parcours voisins
  `billing`, `help`, `shell` et `forms-layout` (39 parcours) verts ; le reste de la suite Playwright est laissé à la CI.
- **CI** : verte le 2026-11-06, run [42206507325](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42206507325) sur `6ed4db0` (branche `claude/r01-finance`) : PHP (Pint, Larastan, PHPUnit, schéma), Frontend (types, lint, Vitest, build) et E2E Playwright (Chromium, MySQL 8.4.9), les trois jobs réussis. Fusionnée dans `main` le 2026-11-07 (section « Fusion de R01 et de G2 »).

## G2 — Valider sécurité financière, stock et reprise (2026-11-06)

Porte suivante de l'ordre du demandeur (O06, O05, R01, puis G2, U01, G3, G4 ; L1, L2, L3), coupée de `origin/main` (`2c29218`). **G2 est une preuve : seuls des tests, des aides de test et des documents sont ajoutés, avec UN amendement du diagnostic SQL I01** (voir « Trouvaille » ci-dessous). Détail, matrice des scénarios AT08–AT17 et AT38–AT45, les huit étapes du fichier 25 et les écarts : `docs/evidence/G2.md`. **Statut : IN_REVIEW, pas DONE** (le demandeur arbitre DONE, comme pour G1).

- **Trois preuves ajoutées dans le navigateur réel** (Edge, serveur de test, base `eeo_e2e_test`) : (1) `financial-safety.spec.ts`, conflit : une modification de fiche faite sur le poste PUIS une autre au central, le serveur refuse la pièce périmée (`VERSION_CONFLICT`), la file du poste attend derrière le conflit (ni la seconde fiche, ni la facture, ni l'encaissement du poste ne sont appliqués), la gérante décide « Garder l'état du serveur » avec motif et mot de passe, la file reprend UNE fois et dans l'ordre (numéros de facture et de reçu de la plage du poste, identiques à ceux affichés sans réseau), le central n'est jamais écrasé ; (2) même fichier, deux onglets et caissier central : le caissier du central n'a ni formulaire ni droit (409 `WRITE_OWNER_REQUIRED`), le second onglet reprend la main (une seule session de coffre écrit, D11) et le premier est refusé net, une panne simulée au milieu d'un commit local n'écrit rien (journal et entités identiques à l'octet) et ne consomme aucun numéro, un seul encaissement soldé exactement avec le premier numéro de reçu de la plage, deux fiches aux deux premiers numéros de la plage ; (3) `zz-diagnostics-sql.spec.ts`, dernier fichier de la suite : les contrôles de la restauration vérifiée (117 tables, 25 diagnostics SQL, séquences, numéros des pièces, empreintes d'audit, fichiers privés) sur la base de tous les parcours, sans aucune ligne.
- **Trouvaille du gate** : la première exécution complète en CI (run 42305849480) a relevé `I01_INVOICE_TOTAL : 1 ligne(s)` sur le dataset des parcours : la pièce d'une reprise de créance papier (X01), facture émise d'origine `LEGACY_BALANCE` SANS ligne d'article par construction, que le diagnostic I01 de `database/05_integrity_checks.sql` signalait à tort (les diagnostics d'origine n'avaient été résolus que sur une base vide). Sans correction, `eeo:restore:verify` aurait annoncé un échec sur une base saine dès la première reprise. I01 ne vise plus que les factures `NATIVE` (la reprise a son diagnostic I08) ; amendement daté dans `database/VALIDATION.md`, empreinte mise à jour dans `database/validation_report.json` (`verifier_plan.py` : PASS) ; test de non-régression `LegacyBalancesTest::test_une_creance_reprise_n_est_pas_une_anomalie_des_diagnostics_d_integrite` (avec témoin, et contrôlé par mutation) ; le parcours `zz-diagnostics-sql.spec.ts` rapporte maintenant tous les contrôles qui ne sont pas à zéro d'un coup.
- **Aides de test** : `receiveDirectory` et `openFromSearch` déplacées dans `tests/e2e/support/device.ts` ; `tests/e2e/support/database.{php,ts}` (diagnostics en lecture seule, refus de toute base qui n'est pas `eeo_*_test` locale ; `retireDevice` : sort un poste de test resté actif d'un parcours tombé, pour ne pas faire échouer les suivants par « une seule caisse hors ligne principale »).
- **Constats** (déclarés dans la preuve, aucun n'est corrigé ici) : l'onglet périmé reste affiché ouvert jusqu'au prochain contrôle de session (15 s, onglet visible) et refuse l'écriture sans en dire la cause ; la remise d'une facture détenue par un poste est refusée au central (409) et n'est pas une commande de poste : AT40 de bout en bout (livrer hors ligne sur quota) n'est pas jouable ; la page d'une facture du serveur ne se lit pas sans réseau (constat de G1) ; AT43 et les décisions `ACCEPT_LOCAL`, `REJECT`, `CORRECT` restent prouvés hors navigateur.
- **Contrôle par mutation** : sans la relecture de la session persistée dans la transaction d'écriture (`assertSession`, `vault.ts`), le premier onglet enregistre un encaissement de 60 000 alors qu'il n'a plus la main : le parcours échoue à l'étape (a). Mutation retirée, application reconstruite.
- **Vérification** (2026-11-06, poste Windows, Edge 156, PHP 8.4.21, Node 24.15.0) : types (vue-tsc), ESLint, Prettier et Pint sans erreur ; Playwright : `financial-safety.spec.ts` (2 parcours), `offline-directory.spec.ts` (aides déplacées) et `zz-diagnostics-sql.spec.ts` verts sur le build propre ; la suite complète est jugée par la CI.
- **CI** : verte le 2026-11-07, run [42308938196](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42308938196) sur `f3bdc5a` : PHP, Frontend et E2E (98 parcours en 4,9 min, diagnostics SQL compris). Le premier envoi (run [42305849480](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42305849480) sur `f104bf7`) avait un seul rouge, le parcours de diagnostics, qui a révélé le faux positif de I01. Fusionnée dans `main` le 2026-11-07 avec R01 (conflits de documentation résolus à la main, en gardant les deux ; section « Fusion de R01 et de G2 »).

## P04 — Vérifier parcours entre profils et postes préparés (2026-11-07)

Tâche suivant G2 dans l'ordre du demandeur (O06, O05, R01, puis G2, U01, G3, G4 ; L1, L2, L3) : prérequis d'U01 et de G3, coupée de
`origin/main` (`398a18a`). Détail, garanties, incidents et preuves : `docs/runbooks/profile-flow.md` et `docs/implementation/vault.md`
(« Implémentation (P04) »). **Statut : IN_REVIEW, pas DONE.**

- **Parcours en navigateur réel** (`tests/e2e/profile-flow.spec.ts`) : un poste préparé, la gérante et trois profils locaux (accueil,
  caisse, professionnel) avec des secrets distincts. Réseau coupé, l'accueil crée la fiche, la caisse la retrouve (même identifiant, même
  numéro de dossier), prépare, émet et encaisse la facture (numéros de la plage du poste), le professionnel la retrouve sans droit ni
  clé des pièces financières. Compartiments lus aussi dans IndexedDB brute (enveloppes de clés) ; aucun texte de la facture ni du patient
  en clair ; le travail du jour n'ajoute aucune ligne clinique. Réseau revenu : le professionnel n'envoie que la fiche, la caisse envoie facture et encaissement
  ensuite, une seule fois, aux numéros affichés sans réseau ; reprise complète acceptée.
- **Trouvé et corrigé** : (1) un coffre créé dans la session du navigateur n'était pas « détecté » ; après « Se déconnecter » de la
  gérante, le déverrouillage répondait « Déverrouillage impossible sur ce poste » jusqu'au rechargement (premier jour réel du poste) :
  `services/vault.ts` marque désormais le coffre existant à sa préparation et à sa relecture, tests contrôlés par mutation ;
  (2) l'en-tête nomme le profil à ouvrir (« 3 pièces de la caisse : à envoyer à l'ouverture d'un profil de caisse ou de la gérante »,
  `offline/profile-switch/waiting.ts`) ; (3) `offline-sync.spec.ts` rend ses ressources de poste (sinon `profile-flow.spec.ts` échouait
  dans la suite complète).
- **Écarts déclarés** : consultation hors ligne non disponible (visite, examen et prescription restent en ligne : AT36 « créer
  patient/consultation » sans réseau n'est pas jouable pour la consultation, à arbitrer avant G3) ; parcours multiposte non activé
  (Q02 non acquise) ; préflight de fin de journée non outillé ; une session serveur par profil pour envoyer ; aucun guide dans l'aide
  intégrée tant que le module `offline` est fermé en production.
- **Vérification** (2026-11-07, poste Windows, Edge 156, PHP 8.4.21, Node 24.15.0) : types (vue-tsc), ESLint et Prettier sur tout le
  dépôt, Vitest complet (164 fichiers, 3 324 tests, 20 ignorés), build ; Playwright : `profile-flow`, `financial-safety`, `first-slice`,
  `offline-directory`, `offline-sync` et `zz-diagnostics-sql` verts ; la suite complète est jugée par la CI. Aucun code PHP modifié.
- **CI** : verte le 2026-11-07, run [42352094998](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42352094998) sur `3223d94` : PHP, Frontend et E2E (101 parcours, dont `profile-flow.spec.ts`). Le premier envoi (run [42350855485](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42350855485) sur `07bdd92`) avait un seul rouge, le parcours de P04 : sur la base complète des parcours la préparation du poste dépose 15 coquilles cliniques SANS contenu (limite déclarée de `PullProjections`), et mon assertion « zéro ligne clinique sur le poste » reposait sur ma base presque vide. Elle compare maintenant AVANT et APRÈS la journée des trois profils (aucune ligne clinique ajoutée), et le parcours a été rejoué sur une base peuplée par `consultation.spec.ts`. Fusionnée dans `main` le 2026-11-07 (section « Fusion de P04 »).

## Fusion de P04 dans `main` (2026-11-07)

- **Accord** : le demandeur a répondu « Oui, fusionner » à la question « Fusionner P04 dans main ? » (2026-11-07). C'est l'accord de CETTE
  fusion, pas une permission permanente : le redemander à chaque chantier.
- **Fusion** : sans passer par l'interface des PR, par un commit de fusion sur la branche `claude/fusion-p04` (la branche de P04 est
  linéaire sur `main` : aucun conflit, l'arbre fusionné est celui de sa pointe `ec3361b`, dont la CI était verte, run 42352729863). La
  branche intermédiaire est poussée pour que la CI juge le dernier arbre (fusion et ce journal) AVANT que `main` ne bouge.
- **Production inchangée** : https://app-eagleseye.com exécute la release `eeo-20261030T1916Z-bbd83c4` ; le module `offline` y reste fermé ;
  les quatre paquets Symfony y sont encore en 7.4.21 (verrou du dépôt : 7.4.23). Un prochain déploiement apporterait, en plus du bandeau de
  mise à jour d'O06 et de l'écran de finance (R01), la correction du déverrouillage après la préparation d'un poste (P04) : dire alors au
  demandeur de cliquer sur « Installer la nouvelle version ». Rien n'est déployé sans demande du demandeur.

## G3 — Exécuter toute la recette L0 et figer le candidat (2026-11-07)

- **Branche** : `claude/g3-recette-l0`, coupée de `origin/main` (`d98f48c`, le candidat), **fusionnée dans `main`** le 2026-11-07 par le commit de fusion `1166dc7` (branche de fusion `claude/fusion-g3`, accord permanent du demandeur) : elle est SANS OBJET. **IN_REVIEW, pas DONE** : preuve et décisions dans `docs/evidence/G3.md`.
- **Ajouté** : `docs/evidence/acceptance-L0.json` (registre du fichier 25 : un enregistrement par scénario, identité du build, CI, 22 IT) ;
  `docs/evidence/G3.md` ; `tests/frontend/evidence/acceptance-register.test.ts` (8 contrôles, joués par la CI : les 39 scénarios, les énoncés du
  fichier 14 mot pour mot, aucun PASS sans test automatisé, chaque BLOCKED motivé, chaque test cité existant dans son fichier, totaux, identité du
  build ; vérifié par 4 mutations). Cinq commentaires de test citaient un mauvais scénario (acuités, réfraction et centrage : AT10 à AT12 au lieu
  d'AT18 ; remise : AT23 au lieu d'AT15 à AT17 ; parcours de consultation) : corrigés. Aucun code d'application ni migration modifié.
- **Résultat** : **35 scénarios sur 39 prouvés**, **4 bloqués** (AT27 : durée et perte constatées sur l'hébergement, exercice non fait ; AT29 : retours
  d'opératrices réelles ; AT36 : consultation hors ligne, décision ; AT40 : livraison hors ligne, décision), 0 échec ; **20 IT critiques sur 20
  prouvés** (IT20 et IT21 : L2) ; aucun défaut bloquant connu ouvert.
- **Revue** : `composer audit --locked` et `npm audit --omit=dev` propres sur le candidat ; **la production exécute encore Symfony 7.4.21 : sept avis
  du 2026-11-04 la concernent, le prochain déploiement les ferme** (à la demande du demandeur : FAIT le 2026-11-08, voir « Déploiement en production du 2026-11-08 ») ; 20 tests de rendu « golden » des documents ignorés
  faute de revue visuelle initiale ; aucune impression physique.
- **CI** : verte le 2026-11-07, run [42377902220](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42377902220) sur `08d8fa7` : PHP (7 min), Frontend (3 min) et E2E Playwright (9 min), dont le test du registre ; le commit de journal `ceba7a8` est vert à son tour, run [42378819511](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42378819511). Fusion dans `main` : faite sous l'accord permanent du demandeur (2026-11-07, « il faut fusionner dorénavant chaque fois quand c'est nécessaire »), par la branche de fusion `claude/fusion-g3` (CI verte, run [42409519554](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42409519554) sur `a4e2e49`) ; `main` avancé en avance rapide de `d98f48c` à `a4e2e49`, CI de `main` verte (run [42410446296](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42410446296)).

## U01 — Corriger l'usage et les impressions sur appareils ciblés (2026-11-07)

- **Branche** : `claude/u01-usage`, coupée de `origin/main` (`babacc5`). **IN_REVIEW, PARTIEL** : tout ce qui s'automatise dans un vrai navigateur est
  prouvé ; l'impression réelle, les appareils et navigateurs convenus et le chronométrage par une personne manquent (preuve et protocole :
  `docs/evidence/usability.md`).
- **Ajouté** : `tests/e2e/usability.spec.ts` (10 tests, Edge 156 réel, base partagée, aucun poste préparé donc rien à rendre) :
  AT29 chronométré (patiente à nom composé accentué, facture de 55 000, émission, acompte de 20 000, reçu, SANS ressaisie ; l'impayé retrouvé par la
  gérante sur 360 px ; 10 clics, 8 champs et 110 touches pour les quatre étapes ; durées de machine de 22 s à 57 s selon la charge du poste ; les
  spécifications ne donnent aucun objectif chiffré, il n'en est pas inventé) ; une facture de 1 500 000 FCFA ; un TÉMOIN qui prouve que le contrôle de
  mise en page sait échouer ; le balayage de 23 écrans à 360, 683 (zoom 200 %), 768 et 1366 px (aucun défilement horizontal, commandes d'au moins
  44 px, montants entiers : 0 défaut sur 401 à 424 commandes et 64 montants par taille) ; le clavier seul (lien « Aller au contenu », ordre de
  tabulation, fenêtre d'émission modale, encaissement) ; le focus non masqué.
- **Défaut trouvé et corrigé** : sur téléphone, 8 arrêts de tabulation sur 52 passaient SOUS la barre de raccourcis fixée en bas (liste « Sexe »,
  zones de texte, « Ouvrir la caisse », « Encaisser le reste », lien du pied de page). `resources/frontend/styles/base.css` pose
  `scroll-padding-bottom: 6rem` sous 768 px ; après : 0 sur 52 à 360 px et à 683 px.
- **Écarts déclarés** (liste complète dans la preuve) : impression réelle (A4 et ticket 80 mm) non faite ; navigateurs et appareils convenus non
  définis, non essayés (Edge seul, sans émulation tactile) ; zoom 200 % approché par une fenêtre de 683 px ; chronométrage de machine et non de
  personne ; écrans internes de l'éditeur de consultation, poste hors ligne et fortes volumétries non balayés.
- **Vérification** : types, ESLint, Prettier, Vitest (164 fichiers, 3 324 tests ; 3 expirations de 5 s sur le poste saturé au premier passage, aucune
  avec 30 s) ; e2e voisins du correctif (`forms-layout`, `help`, `patients`, `shell`) : 35 réussis sur 38, les 3 expirations de 60 s (poste saturé)
  se rejouent avec succès. PHP non rejoué : aucun fichier PHP modifié.
- **CI** : verte le 2026-11-07, run [42368931797](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/42368931797) sur `c103fd2` (9 min 10 s) : PHP (5 min 23 s), Frontend (3 min 10 s) et E2E Playwright (9 min 8 s, dont `usability.spec.ts`), lue sur la page publique du run (l'API publique de GitHub était à sa limite horaire). Fusionnée dans `main` le 2026-11-07 avec `claude/ci-verrou-nomme` (correctif du test de verrou nommé, CI verte, run 42356363421 sur
  `dbd61c5`) : section « Fusion d'U01 ».

## Fusion d'U01 et du correctif de verrou nommé dans `main` (2026-11-07)

- **Accord** : le demandeur a répondu « Oui, fusionner » à la question « Fusionner U01 et le correctif du verrou nommé dans main ? » (2026-11-07).
  C'est l'accord de CETTE fusion, pas une permission permanente : le redemander à chaque chantier.
- **Fusion** : sans passer par l'interface des PR, par deux commits de fusion sur la branche `claude/fusion-u01`, coupée de `origin/main` (`babacc5`) :
  d'abord `claude/ci-verrou-nomme` (`dbd61c5`, CI verte, run 42356363421), puis `claude/u01-usage` (`78f9dc4`, CI verte, run 42368931797 sur
  `c103fd2`). Aucun conflit ; contrôle : le diff de l'arbre fusionné contre chaque branche ne montre que les fichiers de l'AUTRE (2 fichiers contre
  U01, 8 contre le correctif). La branche de fusion est poussée pour que la CI juge le dernier arbre (fusions et ce journal) AVANT que `main` ne bouge.
- **Production inchangée** : https://app-eagleseye.com exécute la release `eeo-20261030T1916Z-bbd83c4` ; le module `offline` y reste fermé ; les quatre
  paquets Symfony y sont encore en 7.4.21 (verrou du dépôt : 7.4.23). Un prochain déploiement apporterait, en plus du bandeau de mise à jour d'O06, de
  l'écran de finance (R01) et de la correction du déverrouillage après la préparation d'un poste (P04), la marge de défilement du téléphone (U01) : dire
  alors au demandeur de cliquer sur « Installer la nouvelle version ». Rien n'est déployé sans demande du demandeur.

## Fusion de R01 et de G2 dans `main` (2026-11-07)

- **Accord** : le demandeur a répondu « Oui, fusionner » à la question « Fusionner R01 puis G2 dans main ? » (2026-11-07). C'est l'accord de CES deux fusions, pas une permission permanente : le redemander à chaque chantier.
- **Fusion** : sans passer par l'interface des PR, par deux commits de fusion successifs sur la branche `claude/fusion-r01-g2` (R01 d'abord, sans conflit ; puis G2, dont seuls `CLAUDE.md` et `progress.md` entraient en conflit, documentation résolue à la main en gardant les deux chantiers ; `task-status.json`, `billing.md`, `testing.md` et le code fusionnent seuls). La branche intermédiaire est poussée pour que la CI juge l'arbre fusionné AVANT que `main` ne bouge : CI verte (run 42345411555 sur `398a18a`, 100 parcours E2E), puis `main` avancé en avance rapide et sa propre CI verte (run 42346031403 : PHP, Frontend, E2E).
- **Production inchangée** : https://app-eagleseye.com exécute la release `eeo-20261030T1916Z-bbd83c4` ; le module `offline` y reste fermé ; les quatre paquets Symfony y sont encore en 7.4.21 (verrou du dépôt : 7.4.23). Un prochain déploiement apporterait, en plus du bandeau de mise à jour d'O06, l'écran de finance du cabinet (R01) et la correction du diagnostic de restauration (G2) : dire alors au demandeur de cliquer sur « Installer la nouvelle version ». Rien n'est déployé sans demande du demandeur.

## Fusion d'O06 et d'O05 dans `main` (2026-11-06)

- **Accord** : le demandeur a répondu « Oui, fusionner » à la question « Fusionner O06 puis O05 dans main ? » (2026-11-06). C'est l'accord de CES deux fusions, pas une permission permanente : le redemander à chaque chantier.
- **Fusion** : sans passer par l'interface des PR, par deux commits de fusion successifs. O06 d'abord (sa branche est linéaire sur `main` : l'arbre fusionné est celui de sa pointe `0bbe981`), puis O05 dans ce résultat : seuls `CLAUDE.md` et `progress.md` entraient en conflit (documentation), résolus à la main en gardant les deux chantiers ; code, tests, `task-status.json`, `vault.md` et `modules.md` fusionnent sans conflit. La branche intermédiaire `claude/fusion-o06-o05` est poussée pour que la CI juge l'arbre fusionné AVANT que `main` ne bouge : CI verte (run 42179659661 sur `2c29218`), puis `main` avancé en avance rapide et sa propre CI verte (run 42181567935 : Frontend, PHP, E2E). Pour annuler un chantier d'un bloc : `git revert -m 1 <commit de fusion>` (`git log --first-parent main`).
- **Production inchangée** : release `eeo-20261030T1916Z-bbd83c4` ; le module `offline` y reste fermé ; les quatre paquets Symfony y sont encore en 7.4.21 (verrou du dépôt : 7.4.23). Un prochain déploiement apporterait le bandeau de mise à jour d'O06 : dire alors au demandeur de cliquer sur « Installer la nouvelle version » (la première livraison n'est vue que par l'ancien bandeau discret).

## O06 — Sécuriser mises à jour PWA et schéma local (2026-11-05)

Première tâche du lot L0 restant, demandée par le demandeur le 2026-11-05 (ordre : O06, O05, R01, puis G2, U01, G3, G4 ; L1, L2, L3). Branche `claude/o06-mises-a-jour`, coupée de `origin/main` (`70ef9c2`).
**Statut : IN_REVIEW, pas DONE** (écarts déclarés ci-dessous). Détail technique : `vault.md` (« Implémentation (O06) »), `shell.md` (« Mise à jour de l’application »), `build.md`, `testing.md`.

- **Audit** : le code existait en partie (règles du contrôle du poste, registre de schéma additif, configuration PWA, bandeau discret) ; aucun critère de sortie n’était prouvé dans un navigateur, ni la montée de schéma sur une base réelle, ni la conservation des versions publiées. Tableau d’audit dans `vault.md`.
- **Expérience du demandeur corrigée** (2026-10-30 : corrections livrées non vues, bandeau ni compris ni cliqué), sans jamais imposer la mise à jour : bandeau collé en haut de CHAQUE écran, non masquable, qui dit « Vous utilisez encore l’ancienne version » puis ce que l’installation fait et ne fait pas ; blocage ou confirmation lisibles (cause en rouge sans dérouler les détails) ; pied de page « Version de l’application : build <identifiant>, construite le <date> à l’heure du cabinet » sur chaque écran, avec « Vérifier les mises à jour » ; recherche automatique au retour sur la fenêtre, toutes les 15 minutes et sur demande ; autre onglet qui installe, installation sans prise de contrôle et rechargement refusé traités ; cinq questions dans l’aide intégrée. Livraison : `build-release.sh` fixe `EEO_BUILD_AT`, `deploy-hostinger.sh` affiche le build en ligne et rappelle de cliquer sur « Installer la nouvelle version », `smoke.sh` vérifie `/build/build-info.json`.
- **Preuves** (poste Windows) : Vitest 161 fichiers et 3300 tests (vérification transversale ; la garde `footer-selectors.test.ts` ajoute 1 fichier et 3 tests, rejoués seuls) (nouveaux : `tests/frontend/update/` — identité du build, règles de recherche, service avec doubles, bandeau et pied de page ; chaque palier N-1 → N du registre ; garde de compatibilité des releases publiées) ; `vue-tsc`, ESLint, Prettier, build verts ; Playwright `tests/e2e/app-update.spec.ts` (2 parcours : vrai service worker sur un profil persistant, deux versions de l’application derrière un proxy Node, serveur coupé réellement ; puis base IndexedDB réelle en N-1 avec coupure au milieu de la migration) ; `shell.spec.ts`, `help.spec.ts`, `smoke.spec.ts` et `auth-session.spec.ts` rejoués ; contrôle par mutation : `/storage` retiré de la liste de refus du service worker → le parcours échoue (`/storage/…` rend la coquille). Captures du bandeau à 1280 et 360 px relues. CI verte, run 42109630044 sur `77a8e20` (Frontend, PHP et E2E Playwright), lue par l’API publique de GitHub.
- **Incident de CI et leçon (2026-11-05)** : le premier push (run 42104333845 sur `851faf6`) a fait échouer 8 parcours Playwright : le bouton du pied de page, alors nommé « Rechercher une nouvelle version », rendait ambigus (violation du mode strict) les sélecteurs `getByRole('button', { name: 'Rechercher' })` de `patients`, `forms-layout`, `offline-directory` et `offline-start` ; l'échec de `offline-directory` laissait la caisse hors ligne principale réservée et faisait échouer `offline-invoice` et `offline-sync` à sa suite. Frontend et PHP étaient verts, les parcours voisins joués en local (`shell`, `help`, `smoke`, `auth-session`) aussi : ceux qui comptaient n'avaient pas été rejoués. Le bouton s'appelle désormais « Vérifier les mises à jour » (aucun sélecteur ne le contient), une garde Vitest (`footer-selectors.test.ts`) lit le vrai libellé et refuse toute collision, la leçon est dans `CLAUDE.md` (« Pièges connus »), et `patients`, `forms-layout` et les parcours hors ligne ont été rejoués en local avant le nouveau push.
- **Pour le demandeur, à chaque livraison** : cliquer sur « Installer la nouvelle version » dans le bandeau, puis lire le pied de page pour vérifier le build affiché. La PREMIÈRE livraison de cette version n’est vue que par l’ancien bandeau discret (le navigateur affiche encore l’ancienne application) : le lui montrer une fois.
- **Écarts déclarés** : (1) toutes les commandes sont en version « 1 » : le chemin « une commande de version plus ancienne que celle du serveur » n’a pas de cas réel à rejouer, la garde est mécanique (aucune version publiée ne peut être retirée) ; (2) la « version précédente » du parcours e2e est dérivée du même code (autres noms de fichiers et autre identité de build) ; (3) un onglet resté sur l’ancien code, non contrôlé par le service worker, qui rouvre une base plus récente, n’a pas de message dédié (la base n’est jamais purgée) ; (4) la suite Playwright complète n’a pas été rejouée sur ce poste (trois heures et plus sur poste chargé) : les parcours voisins l’ont été et la CI fait foi ; (5) avec le module `offline` fermé (production), le contrôle du poste rend « libre » : il ne protège des pièces locales qu’à l’ouverture du module ; (6) un service worker en attente s’active aussi quand tous les onglets sont fermés (plateforme).

## O05 — push, pull, ACK et conflits durables : clos par la preuve (2026-11-06)

Deuxième tâche de l'ordre du demandeur (O06, O05, R01, puis G2, U01, G3, G4 ; L1, L2, L3). Branche `claude/o05-synchronisation`,
coupée du commit `eff3c60` (voir « État courant »). Le code existait depuis le 2026-10-23 et le statut restait IN_PROGRESS ;
cette passe l'a confronté, critère par critère, à la fiche 24 (travaux, sorties, validations nommées) et aux scénarios
AT38, AT39, AT42 et AT45, puis a comblé ce qui manquait. Table complète critère → test, décisions et écarts :
`docs/implementation/vault.md`, « Clôture par la preuve (O05) ».

- **Code** : une seule pièce manquait, le défaut ouvert de M01 (« refus des commandes d'un module fermé reçues d'un poste ») :
  `app/Offline/SyncCommandModules.php` (module propriétaire des 26 commandes acceptant la source SYNC) et la porte dans
  `SyncDrain::apply` ; code d'erreur `MODULE_NOT_ENABLED` ajouté à `contracts/schemas/error.json` et aux types générés.
  Module fermé : la commande reste dans l'inbox, conflit durable visible de la gérante, séquence du poste intacte, rejeu
  (`ACCEPT_LOCAL`) une fois le module ouvert (`modules.md`).
- **Tests ajoutés** (les autres étaient déjà là et ont été recoupés) : `SyncCommandModulesTest` (garde du registre) ;
  `SyncPushTest` : module fermé de bout en bout, modification périmée d'une fiche (AT42 : le central n'est pas écrasé,
  deux propositions conservées), homonyme créé hors ligne (deux identités, aucune fusion) ; `SyncPullTest` : commits
  entrelacés entre deux pages ; `SyncConcurrencyTest` : processus RÉELLEMENT tué pendant l'application (aucun effet
  partiel, le renvoi applique une fois) ; `sync.test.ts` : écriture de page interrompue (le curseur n'avance pas). Le
  harnais de concurrence passe aux processus enfants `EEO_ENABLED_MODULES` (un enfant ne partage pas la configuration
  modifiée en mémoire par le test). Contrôle par mutation : sans la porte, le test du module fermé échoue (la facture est
  appliquée).
- **Écarts déclarés** : AT42 pour les consultations (les examens hors ligne ne sont pas ouverts), pas de signalement de
  doublon APRÈS synchronisation, pull non filtré par module, pas de parcours Playwright du conflit, AT45 porté par O06
  (`app-update.spec.ts`), dettes de la revue A1 laissées (`vault.md`, écarts 1 à 7).
- **Vérification** (2026-11-06, poste Windows, `tools/dev/phase-check.sh` sans Playwright) : contrats à jour, Pint,
  PHPStan sans erreur, PHPUnit complet (2 499 tests, 78 501 assertions, 1 ignoré : création de liens symboliques non
  permise sur ce poste, vérifiée en CI Linux), vue-tsc, ESLint, Vitest complet (3 249 tests, 20 ignorés), build. Prettier a
  signalé le nouveau test de `sync.test.ts` : reformaté, puis `format:check` vert sur tout le dépôt. Navigateur réel
  (Edge) : les trois parcours de synchronisation, `first-slice.spec.ts` (G1, ACK perdu puis rejoué), `offline-start.spec.ts`
  et `offline-sync.spec.ts`, sont verts ; le reste de la suite Playwright est laissé à la CI.
- **CI** : verte sur le commit de code et de documentation `2a64cb3` (run 42176284838 : Frontend, PHP et E2E). Le module
  `offline` reste FERMÉ en production ; rien n'est déployé. Fusionnée dans `main` le 2026-11-06 avec O06 (section « Fusion d'O06 et d'O05 »).

## Présentation des formulaires (2026-10-28)

Chantier demandé par le demandeur (« champs mal alignés, formulaire qui n'inspire pas grand-chose »), indépendant du hors-ligne : branche `claude/formulaires-presentation` partie de `origin/main`, travaillée d'abord dans un worktree séparé pour ne pas marcher sur la session du chantier de déverrouillage. À la demande du demandeur (2026-10-29, qui ne veut pas de worktree supplémentaire), la branche a été fusionnée EN LOCAL dans `claude/facture-hors-ligne` du dossier principal (commit de fusion `213d913`, sans conflit, rien poussé) et le worktree supprimé ; la branche reste sur `origin`. Aucune logique métier, aucun libellé et aucune validation ne change.

- **Cause du désalignement** : l'aide d'un champ était placée entre l'étiquette et la saisie (`FieldShell`) ; dans une rangée à deux colonnes, la saisie d'un champ avec aide descendait sous celle de son voisin. Correction à la racine, donc pour tous les formulaires : étiquette, saisie, puis erreur et aide sous la saisie ; `form-grid` aligné en haut ; les boutons posés à côté d'un champ (recherche, filtres) restent alignés sur la saisie (`toolbar`, `field-action`, variable `--field-label-offset`). Écrans réalignés : liste des patients, catalogue, caisse du jour (empilée sous 640 px), agenda, statistiques, suivis, Aujourd'hui (navigation du jour sur sa propre ligne ; date et « Actualiser la file » empilées jusqu'à 1024 px), exports (empilés jusqu'à 1024 px), nouveau rendez-vous, case « Ressource active ». La CI Linux, aux polices plus larges que Windows, a fait échouer à 768 px deux des nouveaux tests de mise en page (étiquette de la colonne de la date et « Contenu de l'export » sur deux lignes) : ces deux rangées sont empilées jusqu'à 1024 px, et la mesure se refait en local avec une police large (Verdana imposée à la page, CSP contournée) avant de pousser. Incident de CI (run 40812949605) : le serveur PHP de test a fait un « Segmentation fault (core dumped) » à `POST /api/v1/consultations/{id}/complete`, puis 52 tests ont reçu « connexion refusée » ; les runs précédents de la branche passaient cette étape et rien n'avait changé côté serveur. La branche partait d'avant le correctif `fee510e` de la chaîne hors ligne (`tests/e2e/support/php.ts` coupe le JIT d'OPcache du serveur de test : voir « erreur de segmentation » plus bas dans ce journal) : c'est très probablement le même plantage, que l'arbre fusionné couvre désormais, donc aucune piste à tenter ; la preuve sera la CI de la pile qui contient la fusion.
- **Présentation** : étiquettes de 14 px demi-gras, marque « (obligatoire) » discrète, focus propre aux champs (contour à l'encre, halo doré ; contour rouge de 3 px décalé et liseré blanc pour un champ invalide), état invalide plus net (fond `danger-soft`), liste déroulante à chevron, icône du téléphone, unité « FCFA » dans le champ de montant, légendes de carte à filet doré dans le formulaire patient (segment doré remplacé par `CanvasText` en contraste forcé). Bug annexe : `CheckboxGroup` et `YesNoField` annulaient l'espacement de leur parent (`m-0`).
- **Audit contradictoire (2026-10-29)** : 80 gabarits Vue, 8 lots de captures (dont les parcours de vente et les étapes de consultation) et le diff, relus par 19 agents indépendants, puis chaque constat attaqué par deux sceptiques (par défaut : réfuté). 49 constats bruts, 38 distincts, 23 confirmés, tous traités : unité « FCFA » rognant les montants à 768 px (`DraftLineCard`, devis) ; caisse du jour non empilée sous 640 px ; case « Ressource active » en `self-end` ; barre « Aujourd'hui » dont le décalage suivait le bouton à la ligne ; exports sur tablette ; remplissage `px-3.5` trop large pour le tableau optique à 768 px (retour à `px-3`) ; erreur désormais contre sa saisie, avant l'aide ; focus d'un champ invalide ; étiquettes de champs fichier et légende de la mention d'absence de correction restées à l'ancien style ; contraste forcé du filet de légende ; tests et docs resserrés (jetons exacts, `muted` sur `danger-soft`, garde des blocs `@media`, nouveau `tests/e2e/forms-layout.spec.ts`). Découverte annexe, sans lien avec le chantier : `tests/e2e/agenda.spec.ts` dépendait de l'heure (le jour par défaut est aujourd'hui, dont les créneaux s'affichent avant l'ouverture du cabinet : le test cochait un créneau d'aujourd'hui, la trace le montre) ; il saisit maintenant le jour AVANT la prestation et la ressource.
- **Preuves** : captures avant/après (Edge, 1280 et 360 px), `vue-tsc`, ESLint, Prettier, Vitest (`fields.test.ts`, `choice-fields.test.ts`, `form-styles.test.ts`, `palette.test.ts`), Playwright (`patients.spec.ts` et `forms-layout.spec.ts` : alignement mesuré dans le navigateur à 360, 768, 1024 et 1280 px). CI : verte sur le dernier commit de la branche (runs lisibles par l'API publique : /repos/romiall/app.Eagle_Eye_Optics2/actions/runs?branch=claude/formulaires-presentation). Détail : `docs/implementation/shell.md` ; prompt de reprise : `docs/prompts/reprise-apres-formulaires.md`.
- **Fusion et vérification (2026-10-29)** : sur l'arbre fusionné `213d913` (aucune CI : rien n'est poussé), `composer audit --locked`, `vue-tsc`, ESLint et Prettier passent ; Vitest : 136 fichiers et 2 514 tests (trois fichiers dont le worker n'avait pas démarré sur le poste saturé, relancés seuls : verts) ; Playwright : 73 parcours, 71 verts en 3,3 h sur un poste saturé, les deux autres (`forms-layout.spec.ts` : délai de 60 s ; `legacy-balances.spec.ts` : la page de caisse n'affichait rien en 20 s) verts à la relance sur un poste calme. Revue contradictoire de la fusion (6 relecteurs, 2 sceptiques par constat, lecture seule) : un seul constat, documentaire (la piste « couper le JIT » ci-dessus), corrigé ; aucune collision de classes, de tests ni de composants. Écran de déverrouillage et création de patient sur le poste vérifiés à l'écran à 1280, 768 et 360 px (captures dans le dossier de notes des sessions). Écarts relevés, du côté hors ligne et hors de ce chantier : à 360 px, poste déverrouillé, l'en-tête déborde de 26 px (rangée « Aide, Verrouiller le poste, Se déconnecter » de `App.vue`, sans retour à la ligne) ; dans `DevicePreparationPage.vue`, l'étiquette « Numéros de dossiers patients » passe sur deux lignes à 768 px et décale sa saisie de celles de ses voisines (`sm:grid-cols-3`) ; l'introduction de `PatientCreatePage.vue` dit que le numéro de dossier est attribué par le serveur alors que le poste hors ligne le tire de sa plage.

## Chantier « CRUD des écrans », tranche 1 : modifier et supprimer un examen (2026-10-30)

Demande du demandeur : « préparer les CRUD pour la plupart des opérations… on supprime une consultation quand elle est
encore en brouillon, uniquement en brouillon pour l'instant », après avoir créé en production un examen de test resté en
brouillon que rien ne permettait de retirer (aucune donnée de production n'a été touchée : c'est la fonction livrée qui
le lui permettra). Branche `claude/crud-ecrans`, coupée de `origin/claude/facture-hors-ligne` (`2f659dc`, ce que la
production exécute) ; avec l'accord du demandeur le dossier principal a été basculé sur cette branche (aucun worktree) ; la
branche locale `claude/facture-hors-ligne` et son `wip(clinic)` (non vérifié, jamais poussé) restent intacts. Détail
technique : `clinical.md`, « Modifier et supprimer un examen » ; droits : `access.md`, « Qui supprime un brouillon d'examen ».

- **Fonction** : commande `DeleteConsultationDraft` (chemin central, en ligne seulement, `POST /consultations/{id}/delete`) ;
  brouillon seulement (aucune rubrique enregistrée), par son professionnel ou la gérante ; défait la visite (retour à
  l'état d'avant, l'examen peut être redémarré) et les prescriptions brouillon ; refuse en 409 tout examen en cours ou
  terminé, une prescription validée ou utilisée, un contrôle recommandé, une version périmée ; audit `consultation.deleted`
  sans contenu clinique ; pierre tombale `ARCHIVED` au journal des changements. Écrans : « Modifier » et « Supprimer » sur
  chaque carte de la liste, « Supprimer le brouillon » dans l'éditeur, `?corriger=1` pour ouvrir un examen terminé en
  correction. Aide intégrée mise à jour. Aucune permission nouvelle, aucune table ni migration.
- **Question laissée au demandeur** : étendre la suppression aux examens « En cours » (des rubriques saisies, non validées) ?
  Recommandation : non pour l'instant (il a dit « uniquement en brouillon »).
- **Preuves (poste Windows, avant CI)** : PHPUnit `DeleteConsultationDraftTest` (22 cas) et 2 cas billed ;
  sous-ensemble de 1 704 tests (clinique, contrats, chemin central, patients, accès, HTTP, unitaires) verts ; Vitest 153
  fichiers, 3 202 tests ; `vue-tsc`, ESLint, Prettier, PHPStan, Pint, contrats `--check`, build verts ; Playwright
  `consultation-suppression.spec.ts` sur la vraie application (suppression, redémarrage, refus d'un examen en cours et d'un
  examen terminé par le serveur, correction depuis « Modifier ») ; captures 1366 et 360 px.

## Chantier « CRUD des écrans », tranches 2 et 3a : inventaire, brouillons et annulation (2026-10-30)

Branche `claude/crud-ecrans-suite`, empilée sur `claude/crud-ecrans`. La tranche 1 a été mise en ligne le 2026-10-30 à la demande
du demandeur (release `eeo-20261030T1628Z-6d1b2bb`, CI verte run 41079465699). Tranches 2 et 3a : CI verte (run 41106310621 sur `2f195fb`, puis run 41110470924 sur `bbd83c4`) ; PHPUnit complet 2 491 OK ; mises en ligne le 2026-10-30 à la demande du demandeur (release `eeo-20261030T1916Z-bbd83c4`, aucune migration, sauvegarde préalable de la base ; contrôles anonymes : `/up`, les trois routes nouvelles répondent 401 sans session, assets de `/build/` identiques).

- **Tranche 2** : `docs/implementation/crud.md`, matrice entité par entité (créer, lire, modifier, supprimer ou équivalent),
  ce qui existe côté serveur et écran, règle de suppression retenue et justifiée par les sources, décisions proposées pour la
  tranche 3. Constat : la plupart des gestes existent déjà (annuler une visite, abandonner un brouillon de facture, annuler
  ou déplacer un rendez-vous, désactiver un article, un compte, une ressource) ; il manquait la suppression d'un brouillon de
  prescription et de devis, l'annulation d'un contrôle recommandé et l'archivage d'un patient.
- **Tranche 3a** : trois commandes en ligne seulement, par le chemin central, sans permission nouvelle ni migration :
  `DeletePrescriptionDraft` (brouillon jamais utilisé, jeton `expected_updated_at`, la validée reste), `DeleteQuoteDraft`
  (brouillon jamais émis, créateur ou gérante, version attendue, lignes supprimées avec lui), `CancelFollowUp` (contrôle
  `ACTIF`, motif obligatoire, rappels clos, le contrôle reste lisible). Tous : 409 hors état, 403 hors droit, audit sans contenu
  clinique, pierre tombale `ARCHIVED`, rejeu idempotent. Écrans : « Supprimer le brouillon » (prescription d'une consultation,
  ordonnances externes, devis), « Annuler le contrôle » (panneau de la consultation, patients à revoir). Aide intégrée à jour.
  Détail : `clinical.md`, `billing.md`, `agenda.md`, `access.md`.
- **3b écartée (2026-10-30)** : le demandeur répond « Non, fusion seule » à l'archivage du patient (`ArchivePatient`, `RestorePatient`), proposé avec sa
  recommandation (gérante, motif, réversible, garde-fous de la fusion). Rien n'est écrit : la fusion des doublons (`MergePatients`) reste le seul moyen de retirer une fiche, qui n'est jamais supprimée.
- **Leçon d'outillage** : un MySQL de test arrêté fait SAUTER les tests PHPUnit (« Skipped ») au lieu d'échouer quand
  `EEO_REQUIRE_MYSQL` n'est pas posé : toujours lire la ligne « Skipped » du résumé, ou poser `EEO_REQUIRE_MYSQL=1`. Une nouvelle route se déclare aussi dans la matrice de `BillingRoutesGateTest` (ventes) : rejouer la suite PHPUnit COMPLÈTE avant de pousser (le premier run CI de la 3a était rouge pour cette ligne manquante, corrigée par `2f195fb`).

## Priorité du demandeur (2026-10-22), réestimation et écarts de planning

**Décision du demandeur (message du 2026-10-22).** La cliente a payé la moitié de la création et
attend une version de base sous deux jours. Le développement du plan complet continue (tout ce qui
est spécifié sera réalisé), mais l'effort va d'abord aux fonctions essentielles : fiche patient,
dossier de consultation par étapes avec remplissage automatique de l'identité, prescription et
impression ; puis facture, acompte et reçu. L'intégration à l'interface est **progressive** : un module
terminé n'est visible de la cliente que lorsque le demandeur l'active. Ce qui est lancé (F10) est
terminé d'abord.

**Réestimation (consigne « réestimer à J2/J4 », non consignée plus tôt).** Au 2026-10-22 (J9 depuis le
2026-10-14) : 10 tâches sur 79 terminées (13 %), 10 sur 52 pour L0 (19 %), F10 en revue. Les
fondations sont posées (117 tables, accès, chemin central de commandes, règles de calcul jumelles,
coquille et services de lecture et d'écriture) mais **aucun écran métier n'existe** : le jalon interne
J4 (patients → facture → acompte → reçu sur données fictives) n'est pas atteint, et la livraison L0
complète sous 14 jours n'est pas tenable. Causes : le socle (schéma complet, contrats, règles
jumelles), les revues contradictoires systématiques (chaque tâche a coûté une à plusieurs
corrections majeures), deux jours sans session, et l'ordre du graphe qui place le moteur hors-ligne
(O01–O05, quatre tâches lourdes) avant tout écran patient.

**Écarts de planning (à confirmer avec le demandeur).**

| Écart | Motif | Conséquence | Rétablissement |
| --- | --- | --- | --- |
| Écrans de base (P01, P02, consultation, prescription) construits **avant** O01–O04, en ligne d'abord, via les services F10 (`useMutation`, `useRead`) où le moteur du poste se branchera sans réécrire les écrans | Priorité du demandeur ; le graphe place O04 avant P01 | Le premier jalon fonctionne **avec Internet seulement** : ne pas l'annoncer comme hors-ligne (fichier 19) ; le hors-ligne reste une exigence L0 obligatoire | O01 à O05 immédiatement après les écrans de base ; G1 inchangé |
| Contrôle « examen payé ou dérogation » (P03) **inactif** dans le premier jalon clinique | Il dépend de B04 (encaissement) et B06 (approbations), pas encore réalisés | Une consultation peut démarrer sans règlement : à dire à la cliente, à lever avec B04 et B06 | Activation du contrôle avec B04/B06 ; test AT05 AT06 |
| Rangs de verrou 45 à 47 (patient, visite, consultation) ajoutés à l'ordre du contrat 23 | Parent avant enfant avant facture, pour les écritures cliniques | `specifications/23` (ligne 116) n'est pas modifié : l'ordre complet est dans `LockRank` et `command-bus.md` | À reporter dans le fichier 23 à la prochaine mise à jour de la spécification |
| Interrupteur de mise en service des modules (hors backlog) | Exposition progressive voulue par le demandeur | Petite tâche ajoutée (M01), contrôlée par la configuration serveur du demandeur, jamais par la gérante | Documentée ; se retire sans effet sur le reste |
| Confirmation du mot de passe (`reauthenticate`) repoussée à B06 | Aucun écran de base ne l'exige | Le 423 n'a pas de remède dans l'interface avant B06 | B06 |
| Tâche de rotation des clés du coffre absente du backlog ; périmètre `scope` des frais d'examen ; `cash.own_session` ; `vaultId` dans l'AAD (écart avec le contrat 23) | Relevés à la conception d'O01 (`vault.md`) | À arbitrer avant O01 | Section « Écarts de planning et décisions à confirmer » de `vault.md` |

Les trois derniers gates (G2, G3, G4) et le déploiement (H01) ne sont pas avancés par ce choix :
la recette L0 reste la définition de « livré ». Le premier jalon est une **démonstration de base**,
pas une recette de L0.

## M01 — Mise en service progressive des modules (hors backlog)

| Champ | Valeur |
| --- | --- |
| Statut | DONE — CI à constater sur le commit |
| Objectif | Un module terminé reste invisible de la cliente (écran et API) tant que le demandeur ne l'ouvre pas (message du 2026-10-22) |
| Fichiers | `app/Support/Modules.php`, `app/Http/Middleware/RequireEnabledModule.php` (alias `module`), `config/eeo.php` (`enabled_modules`), `StaffMemberPresenter` (`clinic.enabled_modules` dans `/auth/me`), contrat `ClinicSummary`, `resources/frontend/app/{navigation,router,session,App.vue}`, `pages/HomePage.vue`, `.env.example` (`EEO_ENABLED_MODULES`), `docs/implementation/modules.md` |
| Tests exécutés | PHPUnit : `ModulesTest`, `ModuleGateTest`, `EnvExampleTest`, `ConfigurationContractTest`, contrats (175 tests) ; Pint, PHPStan niveau 8. Vitest : navigation (filtrage et cohérence avec le serveur), `module-gate.test.ts` (menu, actions, route introuvable) |
| Décision nouvelle | Liste du déploiement (pas un paramètre du cabinet) ; route fermée = 404 `RESOURCE_NOT_FOUND` ; valeur inconnue ignorée ; défaut vide = rien d'exposé |
| Défauts ouverts | ~~Refus des commandes d'un module fermé reçues d'un poste (O05)~~ : fait le 2026-11-06 (`SyncCommandModules`, conflit durable `MODULE_NOT_ENABLED` ; voir `modules.md` et la section « O05 ») |

## P01, P02, P03 — patients et file du jour (premier jalon en ligne)

| Champ | Valeur |
| --- | --- |
| Statut | IN_REVIEW pour P01 et P02 (serveur et écrans en ligne livrés, revue adverse du serveur traitée) ; IN_PROGRESS pour P03 (arrivée et file du jour livrées ; démarrage de l'examen, annulation et contrôle de paiement restent à faire). **Rien n'est utilisable hors ligne** : les sorties « même identifiant après synchronisation » et « patient hors ligne après redémarrage » (AT36, AT42) restent à prouver avec O01 à O05. |
| Objectif | Retrouver un patient, créer sa fiche avec un numéro central `EE-AAAA-NNNN`, signaler une ressemblance sans fusion, modifier avec version, enregistrer une arrivée et lire la file du jour (EE001, EE002, EE018, EE019 ; AT03, AT04, AT05 en partie) |
| Fichiers | Serveur : `app/Domain/Patients/**`, `app/Domain/Shared/{DocumentNumbers,DayWindow}.php`, `app/Http/Controllers/Api/V1/{Patient,Visit}Controller.php`, `app/Http/Resources/{Patient,Visit}Presenter.php`, `app/Http/Middleware/RequireAnyPermission.php`, `LockRank` 45 à 47, contrat (`directSchema`, `Visit` enrichie, contact du responsable borné). Écrans : `resources/frontend/pages/{patients,today}/**`, `domain/patients/**`, `app/services/{patients,visits}.ts`. Détail : `docs/implementation/patients.md` |
| Tests exécutés | PHPUnit sur MySQL 8.4.9 : suite complète 900 tests avant P03 ; patients, visites, contrats, bus et verrous 360 tests après la revue (dont 5 processus réels en concurrence). Vitest 1027 (38 fichiers). Playwright sous Edge, vraie application et vraie base : parcours patient (5 scénarios), file du jour (3), coquille, fumée, session. Pint, PHPStan 8, vue-tsc, ESLint, Prettier propres |
| Décision nouvelle | Premier jalon **sans contrôle du paiement de l'examen** : `AWAITING_EXAM_FEE` et `READY_FOR_EXAM` jamais écrits, marqueur « Paiement de l'examen non contrôlé » ; rangs de verrou 45 patient, 46 visite, 47 consultation (écart au contrat 23, ordre complet au docblock de `LockRank`) ; le bus valide le corps de la route directe contre son `DirectRequest` ; `POST`/`PATCH /patients` exigent aussi `patient.read` ; contact du responsable limité à nom, lien, téléphone ; routes patient sous `module:patients`, visites sous `module:today` |
| Revue | Vérificateur indépendant et adverse (quatre angles : numérotation, identité, sécurité, contrats ; 46 agents) : aucun défaut bloquant ; 5 majeurs (recherche par téléphone aveugle entre numéro national et international, champs d'import historique non validés, écriture contournant un retrait de lecture, contact du responsable non borné) et 29 mineurs |
| Traitement | Majeurs traités avec test ; mineurs peu coûteux traités (identifiant non ULID, texte mal encodé, bornes de page et de longueur, caractères de contrôle, clé de recherche trop longue, séquence en retard, limite de débit, parité du schéma direct). **Reportés** (docs/implementation/patients.md) : ligatures et noms collés dans la recherche, plafond de 15 chiffres du téléphone, horloge du numéro avant l'attente du verrou, unicité des identifiants entre cabinets |
| CI | Verte : [run 39762595087](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/39762595087) sur `0993d01` (PHP, Frontend, Playwright). Deux causes de rouge trouvées et corrigées en route : horloge de test figée après la création des comptes (profils « futurs » après 09 h 30 UTC, 403) et garde de transaction qui ignorait le diagnostic d'hébergement |
| Reprise | CI, puis C01 (démarrage de l'examen et rubriques narratives) ; hors-ligne O01 à O05 ensuite |

## Kit de déploiement (hors backlog, avant H01)

| Champ | Valeur |
| --- | --- |
| Statut | LIVRÉ en répétition locale ; **non exécuté sur Hostinger** (offre, PHP, MySQL ou MariaDB, droits, racine web inconnus) |
| Objectif | Mettre en ligne rapidement les premières fonctions (patients, arrivée, file du jour) sur l'hébergement SSH annoncé par le demandeur (2026-10-22), sans attendre H01 |
| Fichiers | `php artisan eeo:preflight` (`app/Console/Commands/PreflightCheck.php`, `app/Support/Deployment/*`), `tools/deploy/build-release.sh` (archive `.tar.gz` + SHA-256), `tools/deploy/smoke.sh` (contrôle de fumée en lecture seule), `docs/implementation/deploiement.md` |
| Preuves | Répétition : archive extraite dans un dossier neuf, base MySQL 8.4 vierge, diagnostic production sans point bloquant, `migrate --force` 40 s, `eeo:setup-clinic`, `eagle:verify-schema` sans écart, serveur démarré, contrôle de fumée complet (connexion, `enabled_modules`, recherche, file du jour, aucun fichier de configuration servi) ; mauvais mot de passe détecté. 16 tests du diagnostic (verdicts MariaDB/MySQL, production non sécurisée, droits réels dont le trigger, objets temporaires supprimés, identifiants jamais affichés) |
| Risque principal | Hostinger peut fournir **MariaDB** ou refuser les **triggers** (88) : le diagnostic le dit avant toute installation ; sinon base MySQL 8 à obtenir (écart à consigner au fichier 15) |
| Reprise | Exécuter le diagnostic sur le serveur, consigner le rapport (`--json`) dans `hosting-audit.md`, dérouler `deploiement.md` |

## Phase 1 — fonctions de base codées en parallèle, vérification en fin de phase (2026-10-22)

**Consigne du demandeur (2026-10-22).** Ne plus vérifier fichier par fichier : coder toute la phase
jusqu'au bout, puis UNE vérification transversale (tests complets, build, e2e), corrections, une
seconde passe si nécessaire. La phase 1 couvre ce que la cliente attend en premier : dossier patient
(identité remplie automatiquement, recherche, doublons, activité), arrivées et file du jour,
consultation complète, ordonnances et documents imprimables, facture, encaissement et reçu,
paramètres du cabinet et déploiement. Le hors-ligne (O01–O07) est la phase suivante. Tant que la
vérification de fin de phase n'a pas eu lieu, tout ce qui suit est **codé, non exécuté** : aucune
tâche n'est DONE.

| Chantier | Tâches | État au 2026-10-22 | Documentation |
| --- | --- | --- | --- |
| Clinique | C01 (corrections de revue), C02, C03, C04 | Codé, non exécuté (la première tranche C01 était vérifiée au commit `c0c8918`) | `clinical.md` |
| Documents PDF locaux | D01, D02, impression clinique | Vérifié en local et en CI (run 40044078785) | `documents.md` |
| Facturation serveur | B01, B02, I00, B03, B05, B04 | Vérifié en local et en CI (run 40044078785) | `billing.md` |
| Écrans de vente, caisse, stock | B02–B05, I00 (écrans) | Vérifié en local et en CI (run 40044078785) | `billing.md` (Écrans) |
| Activité du patient | R02 (partie activité) | Vérifié en local et en CI (run 40044078785) | `patients.md` |
| Réauthentification, approbations, contrôle examen, avoirs, remboursements | B06, P03 (contrôle), B07, B08 (serveur) | Vérifié (phase 1, CI run 39879707020) | `billing.md`, `access.md` |
| Paramètres, personnel, accueil, liste des consultations, déploiement | F05 (écrans), H01, X02/X03 minimal | Vérifié (phase 1, CI run 39879707020) | `access.md`, `deploiement.md` |
| Compléments ventes et rapport de caisse du jour | B02–B05 (écarts), R01 minimal | Vérifié (phase 1, CI run 39879707020) | `billing.md` |

**Hypothèses prises pour avancer (à faire confirmer par la cliente, fichier 15 non modifié).**
Empreinte des révisions cliniques = SHA-256 de JCS (G8) ; une consultation incomplète (motif ou
conclusion absents) se termine avec une justification ; tolérance de l'écart pupillaire total = 0,
pas de 0,25 signalé sans être imposé ; échelles d'acuité de DÉMONSTRATION non validées (G11/Q06) ;
une seule série de prescription par consultation ; contrôle du paiement de l'examen désactivé par
défaut (`EEO_EXAM_FEE_CONTROL=off`) ; préfixes de numéros de test (TEST-FAC, TEST-REC, TEST-AV,
TEST-RMB) ; plafond de remise 0 sans `catalog.manage` ; polices PDF standard (pas de police
embarquée) ; identifiants de modèles `<type>.v<n>` (`invoice.v1`, `optical_prescription.v1`).

**Questions ouvertes pour le demandeur.** La caisse voit toutes les pièces du patient dans
l'activité (la matrice 09 la limite à la facture sélectionnée) ; motif obligatoire d'une date
d'examen rétrospective ; `MEDICATION_ORDER`, `REFERRAL_LETTER` et `CASH_SESSION_REPORT` absents de
`generated_documents.document_type` (générés localement seulement).

**Vérification de fin de phase (faite le 2026-10-23).** Première passe : contrats, Pint, Prettier et
build verts ; PHPStan 43 erreurs, PHPUnit bloqué par une erreur fatale de test puis 32 échecs sur 2096,
vue-tsc 24, ESLint 4, Vitest 13 échecs sur 2289. Corrections réparties par domaine (deux agents) :
32 des 34 échecs PHPUnit venaient des tests (heure de clôture future, ordre des clés JSON, session de
test héritée, matrice de routes incomplète, décisions remplacées), PHPStan corrigé dans le code ; côté
écrans, vrais défauts corrigés (espaces perdus à l'affichage, message de décision effacé, refus du mot
de passe actuel masqué, calcul flottant). Seconde passe avec Playwright : tout vert sauf 9 parcours
sur 47 ; un vrai défaut corrigé (l'encaissement concluait « Caisse non ouverte » avant la réponse du
serveur), les autres venaient des tests. Résultat final local : **tout vert, Playwright 47/47** ; CI GitHub verte : [run 39879707020](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/39879707020) sur `19d2bda`.
Tâches passées en IN_REVIEW (jamais DONE : le hors-ligne reste à prouver). Restent hors de cette
phase : écrans d'avoir et de remboursement (B07, B08), hors-ligne (O01–O07), statistiques DP,
annulation d'une visite, exécution réelle sur Hostinger.

**Plan de vérification de fin de phase (tel que prévu).** Régénération des contrats en LF et contrôle `--check` ;
PHPUnit complet sur MySQL 8.4.9 (Feature, Unit, Concurrency) ; Pint, PHPStan ; Vitest complet ;
vue-tsc, ESLint, Prettier ; build ; Playwright complet (patients, file du jour, consultation,
documents, facturation) ; rendu des PDF de démonstration (golden) relu ; corrections, puis seconde
passe si nécessaire ; commit, push et CI.

## G1 — Tranche urgente persistante et rejouable (2026-10-28)

Chantier de la branche `claude/preuve-g1` (empilée sur `claude/reprise-poste` tant que les PR #1 et #2 du dépôt de
travail ne sont pas fusionnées). Preuve détaillée, écarts et limites : `docs/evidence/G1.md`.

- **Code** : la page de la facture lit les encaissements enregistrés sur le poste (coffre ouvert), les affiche « en
  attente de synchronisation » et les compte dans le reste à encaisser ; version du grand livre attendue alignée sur le
  journal local (second encaissement possible) ; numéro du reçu affiché hors ligne et PDF du reçu produit sur le poste.
- **Test** : `tests/e2e/first-slice.spec.ts` (profil persistant `tests/e2e/support/profile.ts`, route d'envoi à trois
  modes cut, ack-lost, open) ; règles pures `tests/frontend/billing/local-payments.test.ts`.
- **Vérification locale (2026-10-28)** : vue-tsc, ESLint, Prettier verts ; Vitest 133 fichiers, 2511 tests ; Playwright
  `first-slice.spec.ts` vert (2,7 min) ; non-régression : voir ci-dessous.
- **Non-régression locale** : Playwright billing (3), deliveries, legacy-balances et quotes verts ; offline-sync et device-recovery verts lancés seuls et dans l'ordre de la CI après first-slice (la restitution des ressources du poste en fin de parcours est nécessaire : une seule caisse hors ligne détient les numéros financiers). Un enchaînement local de device-recovery a échoué une fois sur « Conflits à revoir : 1 » (course entre la reprise automatique et le clic de synchronisation, repassé seul) : à surveiller en CI.
- **CI de la branche** : [run 40688709991](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/40688709991) sur `dd41316` : verte (PHP, Frontend, E2E : 62 parcours réussis en 2,7 min, `first-slice.spec.ts` compris, aucune exclusion). Le run 40688437248 sur `d660b98` a été annulé par le push suivant (`cancel-in-progress`), sans résultat. `device-recovery.spec.ts` est passé dans ce run ; son intermittence locale reste à surveiller.
- **État des PR (2026-10-28)** : #1 (O05, `claude/parcours-hors-ligne` vers `main`) et #2 (O07, vers `claude/parcours-hors-ligne`)
  toujours ouvertes, sans conflit, CI verte sur leurs têtes (runs 40247535133 et 40286960787). `claude/preuve-g1` est en
  avance sur `main` des commits de #1, de #2 et de G1, et en retard d'un seul (`966b5a8`, les originaux de la cliente : cinq fichiers binaires,
  aucun recoupement avec le code). Ordre de fusion, à faire par le demandeur : #1 en « Create a merge commit », base de #2
  changée vers `main`, puis #2, puis la PR de `claude/preuve-g1` vers `main`.
- **À faire ensuite** : arbitrer les écarts 1 et 2 pour passer G1 à DONE (facture créée hors ligne par
  les écrans, déverrouillage public hors ligne) ; O06 puis G2.

## Écarts de G1 : (a2) déverrouillage public du poste (2026-10-28)

Chantier de la branche `claude/deverrouillage-hors-ligne` (empilée sur `claude/preuve-g1`, elle-même sur `claude/reprise-poste`).
Lève l'écart 2 de G1 : le démarrage du navigateur SANS réseau (AT36 à la lettre). Détail : `docs/implementation/vault.md`,
« Implémentation (D14, D27) » ; preuve : `docs/evidence/G1.md`.

- **Code** : détection du coffre au démarrage sans le créer (`vaultDatabaseExists`) ; route publique `/deverrouiller` avant la
  connexion quand un coffre existe et qu'aucune identité n'est connue ; statut de session `local` (profil du coffre, droits
  signés de son grant, résumé du cabinet retenu) ; écrans `offlineCapable` seulement (accueil, aide, nouveau patient, « Poste ») ;
  « Verrouiller le poste » et déconnexion qui verrouille d'abord ; coquille démontée coffre verrouillé ; inactivité (30 min),
  horloge et autre onglet surveillés ; divergence de compte signalée (aucune commande écrite au nom d'un autre compte).
- **Tests** : `tests/frontend/shell/local-identity.test.ts` (11), `tests/frontend/offline/clinic-summary.test.ts` (6), décompte
  des routes de `bootstrap.test.ts` ; `tests/e2e/offline-start.spec.ts` : serveur RÉELLEMENT arrêté (Playwright n'applique pas
  « hors ligne » aux requêtes du service worker), profil persistant, trois fermetures complètes ; `first-slice.spec.ts` entre
  désormais par `/connexion`.
- **Vérification locale (2026-10-28)** : vue-tsc, ESLint, Prettier, Vitest complet et build verts ; `offline-start.spec.ts` vert (2,6 min). Playwright complet (`phase-check`) : 58 réussis sur 63 ; les échecs viennent de `device-recovery.spec.ts` (course connue de l'échange, aggravée par un serveur de test lent ; MÊME échec sur le code d'avant ce chantier, vérifié) et de ses effets en cascade (poste non libéré : first-slice, offline-start, offline-sync ne peuvent plus réserver leurs numéros), plus un plantage du processus Playwright sous Windows (code 0xC0000409) sur `auth-session.spec.ts`. Relancés : `auth-session`, `first-slice`, `offline-start` et `offline-sync` verts ; `device-recovery` vert seul après durcissement du test (il attend la fin de l'échange d'ouverture avant la coupure) ; un échec isolé à l'enrôlement, sous lenteur du serveur, n'est pas revenu à la relance.
- **CI de la branche** : [run 40739327255](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/40739327255) sur `6773678` : PHP et Frontend verts ; E2E 62 réussis sur 63, `offline-start.spec.ts` compris ; seul `legacy-balances.spec.ts` échoue (1ʳᵉ tentative : « Justificatif conservé sur le serveur » jamais affiché après le dépôt du scan ; la relance échoue ensuite à la création du patient, déjà créé à la 1ʳᵉ tentative). Spec verte en local dans la même suite et verte sur les six runs précédents de la pile (aucun lien visible avec ce chantier : pas de coffre dans ce parcours). Cause probable : le test rechoisissait le scan sans attendre la fin de la confirmation du mot de passe (le dépôt pouvait partir avec l'ancienne session) ; il attend désormais la fermeture de la boîte et un échec dit les réponses du dépôt. Run 40740587950 sur `c8f3554` : même échec. [Run 40743665486](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/40743665486) sur `d314567` : **vert** (PHP, Frontend, E2E 63 parcours dont `offline-start.spec.ts` et `legacy-balances.spec.ts`), avec un seul parcours instable relancé avec succès : `settings.spec.ts` (création d'un compte, « Compte créé sur le serveur » non affiché à la 1ʳᵉ tentative, après la confirmation du mot de passe) ; aucun lien trouvé avec ce chantier, à surveiller aux runs suivants. Run 40745241271 sur `54fd0a0` (documentation seulement) : `legacy-balances.spec.ts` échoue de nouveau (la boîte « Confirmer votre mot de passe » reste affichée après « Confirmer et reprendre ») ; diagnostics ajoutés à ce test (`5707f31` : réponses de la réauthentification et du dépôt) ; [run 40748097450](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/40748097450) sur `5707f31` : **vert** (PHP, Frontend, E2E). L'instabilité de `legacy-balances.spec.ts` (confirmation du mot de passe) reste non expliquée : si elle revient, lire les appels consignés par le test.
- **Contexte** : pendant ce chantier, le demandeur a mis l'application en ligne sur Hostinger (H01, commits de déploiement sur
  `claude/preuve-g1`) ; le module `offline` y reste fermé : le code de ce chantier est dormant en production (aucun coffre,
  aucun changement de comportement).
- **À faire ensuite** : écart 1 de G1 (lecture locale des écrans patient, liste, recherche, catalogue et facture ; création de
  facture sans réseau) ; O06 puis G2 (issue `vault-locked`, deux onglets, horloge truquée, aide intégrée du hors-ligne).

## Écarts de G1 : (a1) lecture locale des écrans, tranche 1 : fiches patient (2026-10-28)

Chantier de la branche `claude/lecture-locale-ecrans` (empilée sur `claude/deverrouillage-hors-ligne`). Première tranche de l'écart 1
de G1 : la fiche d'un patient, la recherche et la modification d'une fiche répondent depuis le coffre quand le serveur ne répond
pas. Détail : `docs/implementation/vault.md`, « Implémentation (A1) » ; preuve : `docs/evidence/G1.md`.

- **Code** : rejeu des faits administratifs du journal local en fiches (`domain/patients/local.ts`, `app/services/localPatients.ts`) ;
  `getPatient` et `searchPatients` (option `includeLocal`) lisent le poste quand le serveur ne répond pas, et la proposition du poste
  pas encore consolidée prime sur le serveur ; écrans `offlineCapable` : liste et recherche, fiche, modification ; en session locale,
  la fiche ne propose ni arrivée, ni facture, ni fusion, ni export, ni onglets du serveur ; « Ouvrir la fiche » après un
  enregistrement sur le poste ; note « Données de ce poste seulement » sous les résultats de recherche locaux.
- **Tests** : `tests/frontend/patients/local-patients.test.ts` (rejeu, recherche, pagination), `tests/frontend/services/patients-local.test.ts`
  (lectures, priorité du poste, erreurs du serveur jamais remplacées), `create-page.test.ts` (lien « Ouvrir la fiche ») ;
  `tests/e2e/offline-start.spec.ts` étendu : fiche ouverte, modifiée (profession) et retrouvée par la recherche SERVEUR ARRÊTÉ,
  relue après une fermeture complète, puis profession connue du serveur après la synchronisation.
- **Correctifs de la vérification** : le nom d'une fiche locale ne devient jamais vide ; la garde « aucun flottant » du domaine
  refusait la pagination (division entière `intDiv` désormais) ; la recherche locale emploie la clé de recherche du serveur
  (`searchKey` : minuscules, sans accents ni ponctuation) ; le test de l'écran fermé en session locale vise la liste des factures.
- **À faire ensuite** (tranches 2 et 3 de l'écart 1) : lecture locale de la facture (rejeu de `CreateInvoiceDraft`, `UpdateDraft`,
  `IssueInvoice`), catalogue figé et règles de vente locaux, éditeur de facture et émission sur le poste, puis un parcours e2e de
  facture créée serveur arrêté.

## Écarts de G1 : (a1) lecture locale des écrans, tranches 2 et 3 : facture sur le poste (2026-10-29)

Chantier de la branche `claude/facture-hors-ligne-seule` (base : les formulaires fusionnés, `claude/formulaires-presentation`, plus la
facture sur le poste ; extraite de `claude/facture-hors-ligne`, branche partagée avec l'aide intégrée en cours, pour être vérifiée
par la CI sans elle). Lève l'écart 1 de G1 : AT37 à la lettre, une facture
créée, émise et encaissée SANS réseau. Détail : `docs/implementation/vault.md`, « Implémentation (A1, tranches 2 et 3) » ; preuve :
`docs/evidence/G1.md`.

- **Code** : catalogue figé lu dans le coffre (`domain/billing/localCatalog.ts`) ; rejeu des faits financiers en factures
  (`domain/billing/localInvoices.ts`, `app/services/localInvoices.ts`) ; `getInvoice` et `searchCatalog` (option `includeLocal`)
  répondent depuis le poste ; l'éditeur de facture gère `saved-local` (brouillon, modification, émission : numéro de la plage du poste) ;
  écrans `offlineCapable` : nouvelle facture et facture ; « Créer une facture » depuis la fiche en session locale ; la fiche d'une
  facture du poste remplace les panneaux du serveur par une note.
- **Tests** : `tests/frontend/billing/local-invoices.test.ts`, `local-catalog.test.ts`, `tests/frontend/services/billing-local.test.ts`,
  quatre cas ajoutés à `invoice-draft.test.ts` ; `tests/e2e/offline-invoice.spec.ts` : patient et facture de 80 000 créés puis émis
  serveur arrêté, acompte de 30 000 et solde de 50 000, deux reçus, PDF de la facture et d'un reçu, aucune requête hors de l'origine,
  fermeture complète (tout est retrouvé), puis synchronisation sans renumérotation.
- **Découverte annexe** : l'audit Composer de la CI échouait sur toutes les branches depuis l'avis symfony/mime du 2026-10-28 (CVE-2026-45070) ;
  le correctif (mise à jour de `symfony/mime`, 7.4.22) vient de la session « formulaires » et a été reporté sur `claude/lecture-locale-ecrans`.
- **CI de la branche de vérification** `claude/facture-hors-ligne-seule` (formulaires fusionnés et facture sur le poste, sans l'aide
  intégrée en cours) : [run 40958516757](https://github.com/romiall/app.Eagle_Eye_Optics2/actions/runs/40958516757) sur `fb09518` :
  **vert** (PHP, Frontend, E2E : 74 parcours dont `offline-invoice.spec.ts`, AT37 à la lettre). La branche partagée
  `claude/facture-hors-ligne` (même contenu plus l'aide intégrée en cours de rédaction par l'autre session) reste rouge tant que
  cette aide n'est pas terminée (tests de contenu) ; elle doit recevoir les correctifs de la branche de vérification par fusion.
- **Incidents de parcours (causes et correctifs)** : (1) un serveur Vite de développement lancé dans le dossier (`public/hot`) faisait
  charger la page depuis lui, sans service worker : garde dans `AppServiceProvider` (environnements `e2e` et `demo`) ; (2) un serveur de
  test resté actif sur le port dédié après un délai dépassé faussait l'essai suivant : arrêt manuel, et l'attente du service worker est
  bornée à 60 s ; (3) la limite de 5 confirmations de mot de passe par minute et par compte (429) faisait échouer `offline-start` quand il
  suivait `offline-invoice`, puis `offline-sync` en cascade (poste non libéré) : `EEO_RATE_REAUTHENTICATE` (5 par défaut, relevée pour les
  e2e), très probablement aussi la cause de l'instabilité de `legacy-balances.spec.ts` (boîte de confirmation restée affichée) ; (4) deux
  assertions de parcours à corriger (note du catalogue en double dans l'annonce vocale, lien « Créer une facture » désormais offert).
- **Démonstration locale** : `node tools/dev/demo-local.mjs` (base dédiée `eeo_demo_test`, comptes fictifs à mots de passe aléatoires dans
  `storage/framework/testing/demo-accounts.json`, jamais touchés par les e2e).

## Réponses de la cliente (2026-10-28)

- **Horaires d'ouverture** (à saisir par la gérante dans les paramètres de l'agenda) : lundi, mardi, mercredi 8 h 30 à
  17 h ; jeudi 10 h 30 à 17 h ; vendredi 8 h 30 à 17 h ; samedi 8 h 30 à 13 h, ainsi que les jours fériés (lecture : même
  plage que le samedi, à confirmer). Dimanche non précisé (supposé fermé, à confirmer). L'application n'a pas de
  calendrier des jours fériés : des exceptions datées sont à saisir avant d'ouvrir le module `agenda`.
- **Carnets papier** : aucune référence ni numéro à reprendre, les séries de pièces démarrent de zéro ; aucune créance
  papier à reprendre à ce stade (à reconfirmer : pas de dette en cours à reporter). La reprise des créances (X01) reste
  livrée mais inutilisée au lancement.
- **Références administratives** : le demandeur a transmis l'immatriculation au RCCM (photo) et l'avis d'imposition de
  la DGI. Dépôt public : ces valeurs ne sont PAS recopiées ici ; la gérante les saisit dans Paramètres, Cabinet et
  documents, à la mise en ligne. Restent à confirmer avec la cliente : dénomination légale exacte (celle de l'avis
  diffère du nom commercial de l'application), capital, objet de l'activité, adresse précise, téléphone, e-mail, régime
  fiscal à valider avec le comptable avant de configurer une taxe, préfixes des séries. Les documents restent marqués
  TEST (`PRODUCTION_DOCUMENTS_ENABLED=false`) tant que ces points ne sont pas validés.

## Lot 2 — codé en parallèle, vérification en fin de lot (2026-10-23)

Même règle que la phase 1 : chaque chantier est codé jusqu'au bout sans exécution, puis une vérification
transversale unique. Consigne du demandeur du 2026-10-23 : la session principale ne reste jamais inactive ;
toute aide destinée à la cliente est intégrée à l'interface (jamais un document Markdown).

| Chantier | Tâches | État |
| --- | --- | --- |
| Corrections financières à l'écran, autorisation depuis la facture, annulation d'une visite | B07, B08 (écrans), P03 | Vérifié en local et en CI (run 40044078785) |
| Coffre chiffré et enrôlement des postes | O01, O02 | Vérifié (PHPUnit, Vitest) ; module `offline` fermé |
| Statistiques du dossier patient | R02 | Vérifié en local et en CI (`reports.md`) |
| Aide intégrée par profil | hors backlog (consigne du demandeur) | Vérifié en local et en CI (run 40044078785) |
| Ordonnances externes à l'écran | C04 (A13) | Vérifié en local et en CI (run 40044078785) |
| Agenda interne et suivis | S01, S02 | Vérifié en local et en CI (agenda jour/semaine, configuration, arrivée depuis un rendez-vous, patients à rappeler, aucun envoi externe) |
| Remises au patient et retours, sorties exceptionnelles | I01, I02 | Vérifié en local et en CI (run 40044078785) |
| Plages, quotas, commit local et journal du poste | O03, O04 | Codé, non exécuté (corrige aussi l'ordre des verrous d'O02) |
| Identité visuelle professionnelle et logo de la marque | hors backlog (demande du demandeur) | Codé, non exécuté (charte, icônes SVG, en-tête mobile) |
| Import contrôlé du catalogue et stock d'ouverture par fichier | X01 (partie catalogue et stock) | Vérifié en local et en CI (run 40044078785) |
| Créances papier | X01 (partie créances) | Vérifié en local et en CI (série `LEGACY_BALANCE`, justificatif scanné, hors chiffre d'affaires) |
| Originaux PDF conservés sur le serveur, logo sur les documents | D01 | Vérifié en local et en CI (run 40044078785) |
| Push, pull, ACK et conflits | O05 | Serveur vérifié (PHPUnit) ; parcours e2e `offline-sync.spec.ts` réactivé et vert en local le 2026-10-25 (section « Parcours hors-ligne réactivé ») ; module `offline` fermé |
| Exports contrôlés | X02 | Vérifié en local et en CI (`operations.md`, tâche planifiée `eeo:exports:process`) |
| Sauvegardes chiffrées, restauration vérifiée et réconciliation | X03 | Vérifié ; répétition locale PASS (`docs/evidence/restore-rehearsal.md`) ; exercice réel sur l'hébergement à faire |
| Seconde passe visuelle des écrans (hors ventes, caisse, stock, hors-ligne) | hors backlog (demande du demandeur) | Faite ; vérifiée par vue-tsc, ESLint, Vitest et Playwright |
| Fusion manuelle de deux fiches patient et comparaison de deux examens | L1D08 | Vérifié en local et en CI (liens vers la comparaison à ajouter après la mise en ligne) |
| Devis versionnés et conversion en facture | L1D07 | Vérifié en local et en CI |
| Remises au patient et retours, sorties exceptionnelles | I01, I02 (fin) | Vérifié en local et en CI |
| Dépenses, mouvements de caisse, catégories et revue d'écart | L1D05 | Vérifié en local et en CI (`billing.md`) |
| Fournisseurs et réceptions, inventaires, seuils et péremption | L1D01, L1D02, L1D03 | Code mis de côté hors du dépôt (2026-10-23) ; à reprendre après la mise en ligne |

## Vérification de fin de lot 2 (2026-10-24)

Une seule vérification transversale (`tools/dev/phase-check.sh --with-e2e`), puis une seconde passe ciblée. Résultat final :
PHPUnit 2432 tests (1 ignoré : liens symboliques sous Windows), PHPStan, Pint, vue-tsc, ESLint, Prettier, Vitest 2496 tests,
build, Playwright (Edge en local, Chromium en CI). **CI verte : [run 40044078785](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/40044078785) sur `cb7a008`** (PHP, Frontend, E2E).

Défauts réels trouvés et corrigés par cette vérification (jamais vus avant, code écrit sans exécution) :
- sources hors ligne ou serveur sans auteur : garde commune `AuthoredSource` sur six actions (au lieu d'erreurs SQL ou de verrous) ;
- export du dossier d'un patient : requête sur une colonne inexistante (`consultation_history_terms.consultation_id`) ;
- révocation d'un poste : motif d'audit passé sous forme de tableau ;
- `useMutation` : `structuredClone` refusait les tableaux réactifs de Vue (import du catalogue muet) ;
- boîtes de confirmation du mot de passe : identifiant en double sur une page qui en porte deux (champ sans libellé) ;
- `Dexie` : un client plus ancien pouvait ouvrir et écrire dans un coffre plus récent (`VAULT_FORMAT_TOO_NEW`) ;
- `ContactTaskCard` : la route de tentative de contact partait sans identifiant ;
- archive de livraison : `database/schema_catalog.json` et `database/05_integrity_checks.sql` retirés alors que l'application les lit
  (exports, `eeo:restore:verify`) ; `build-release.sh` les garde et refuse une archive qui en manque.

Écarts connus, tous hors de la mise en ligne L0 :
- ~~`tests/e2e/offline-sync.spec.ts` est en `test.fixme`~~ : réactivé le 2026-10-25 (voir « Parcours hors-ligne réactivé ») ; preuve G1/G2 à produire ensuite ;
- O06 (mises à jour PWA) : code partiel, non terminé ; O07 (export et reprise d'un poste) prouvé en local le 2026-10-26 (section « Reprise d'un poste ») ; module `offline` fermé ;
- L1D01–L1D03 (chaîne stock L1) mis de côté hors du dépôt ; L1D06 abandonné pour l'instant ;
- tests e2e : les changements de compte quittent la page avant d'effacer les cookies (une requête en vol recréait la session) ;
- poste Windows : `OPENSSL_CONF` à exporter pour les clés EC P-256 (sans effet en CI Linux).

Archive de livraison : `tools/deploy/build-release.sh` (commit `43f1057`, 5,9 Mo). Répétition locale de sauvegarde chiffrée et de
restauration : PASS (`docs/evidence/restore-rehearsal.md`). L'exercice réel reste à faire sur Hostinger.

Règle de mise en service : le module `offline` ne s'ouvre pas en production avant O05 vérifié (sans lui, une
commande enregistrée sur un poste n'atteint jamais le serveur).

Logo : le demandeur a fourni le logo vectoriel de la marque (« logo EEOM », Illustrator) ; la marque complète
(aigle et nom) et l'aigle seul en sont extraits sans le cadre ni les coordonnées
(`resources/frontend/assets/brand/`), icônes de l'application régénérées depuis l'aigle. Dépendance ajoutée
par O02 : `firebase/php-jwt` ^7 (signature des grants, exigée par le fichier 23).

## Parcours hors-ligne réactivé (2026-10-25)

`tests/e2e/offline-sync.spec.ts` (O05) n'est plus en `test.fixme` : **CI verte, run 40246904670** sur `fee510e` (PHP,
Frontend, E2E) ; il passe aussi en local (Chromium, 13,7 s) de bout en
bout : préparation du poste, encaissement mobile money et création d'un patient réseau coupé, fermeture de la page,
retour du réseau, synchronisation, ACK ; un seul paiement et un seul patient sur le serveur, numéros dans les plages du
poste, seconde synchronisation sans effet. Le coffre s'ouvrait bien : quatre défauts arrêtaient le parcours.

- Test : la ligne « Coffre ouvert : … » commence par une espace dans le gabarit, l'ancre `^` du sélecteur ne la
  trouvait jamais (d'où les « 20 s ») ; la décision d'ouvrir le coffre après sa création était prise avant la fin de
  la création.
- Test : les lectures de contrôle par `context.request` n'envoyaient ni `Origin` ni `Referer` : Sanctum ne reconnaissait
  pas la session.
- Application (`PaymentForm.vue`) : un encaissement enregistré sur le poste restait « saisie non enregistrée » ; la
  confirmation de sortie bloquait toute navigation après un encaissement hors ligne.
- Application (`PatientCreatePage.vue`) : sans connexion, la boîte « Vérification des doublons impossible » disait que
  « le serveur n'a pas répondu comme attendu » ; elle dit maintenant que le serveur n'est pas joignable (pas de
  connexion) et invite à vérifier la liste au retour du réseau. Test Vitest ajouté pour les deux messages.
- Outillage : `tests/e2e/support/chromium.ts` trouve aussi le Chromium préinstallé sous `chrome-linux64/`.
- Outillage : premier passage en CI rouge (run 40246100245) : erreur de segmentation du serveur PHP sur
  `GET /api/v1/sync/pull`, puis connexion refusée pour tous les tests suivants. Cause : le JIT d'OPcache, actif par défaut
  sur la CI (setup-php). Reproduit en local avec `opcache.jit=1235` (TypeError « CarbonImmutable attendu, CarbonImmutable
  reçu » dans `PrepareGrant`) ; `tests/e2e/support/php.ts` coupe le JIT du serveur de test, le parcours repasse. Consigne
  ajoutée à `deploiement.md` : JIT désactivé sur l'hébergement.

Écart constaté, non corrigé ici : après un encaissement enregistré sur le poste, la page de la facture affiche encore
« Aucun encaissement » et le reste dû du serveur (seul le message d'état dit l'enregistrement local). Ce n'est pas faux
(le serveur n'a rien reçu) mais l'affichage des pièces en attente sur la facture reste à faire. Module `offline`
toujours fermé en production : ce parcours vert ne remplace pas la preuve G1 sur l'hébergement.

## Reprise d'un poste sur un poste neuf (O07, 2026-10-26)

Le code d'export chiffré et de reprise existait (client `offline/recovery/`, écran « Préparer ce poste » étapes 6 et 7,
serveur `ReplaceDevice`, `recovered-push`, `ReconcileReplacement`) mais n'avait aucune preuve. Ajouté :

- `tests/e2e/device-recovery.spec.ts` (vraie application, deux contextes de navigateur) : poste A préparé, facture
  attribuée, encaissement réseau coupé, export (le fichier ne contient pas la référence en clair) ; poste B préparé sans
  numéros, import avec la clé de récupération de A, déclaration, transmission, clôture ; un seul paiement, reçu dans la
  plage de A, A n'est plus `ACTIVE`, B réserve des plages disjointes ; A réapparaît, crée un patient hors ligne : le
  serveur refuse, « Conflits à revoir : 1 », le patient n'existe pas ; B rechargé affiche « ancien poste clôturé ».
- `tests/frontend/offline/recovery.test.ts` (Vitest, 4 tests) : rien en clair, refus (mauvaise clé, illisible, autre
  version, altéré, même poste), rangement idempotent sans aucun droit recopié, transmission telle quelle puis rien.
- `tests/Feature/Offline/DeviceReplacementTest.php` (MySQL, 4 tests) : reprise et clôture (numéros restants `UNUSED`),
  clôture prématurée `SYNC_INCOMPLETE`, refus (avant remplacement, soi-même, inconnu, second remplacement, rôle caisse),
  poste réapparu en revue et pull refusé.
- `tests/e2e/support/device.ts` : préparation de poste, facture attribuée, encaissement hors ligne et lectures de
  contrôle partagés avec `offline-sync.spec.ts`.
- Runbook d'exploitation : `docs/runbooks/local-recovery.md`.

Corrections et écarts :

- Application : un refus du serveur à la synchronisation (poste remplacé, autorisation retirée) s'affichait comme
  « échange impossible pour le moment », comme une simple coupure. `app/services/syncFailure.ts` distingue maintenant
  coupure, autorisation expirée et refus (avec le motif du serveur) ; tests Vitest ajoutés.
- Test : `prepare-env.mjs` règle `EEO_MAX_CLOCK_SKEW=2` pour le serveur e2e. Avec la tolérance de production (300 s),
  une action du poste réapparu faite quelques secondes après la révocation est, à juste titre, mise en revue et non
  refusée nettement ; le test resterait sinon 5 minutes à attendre. La valeur de production n'est pas changée.
- Test : `setInputFiles` avec un chemin contenant « ’ » échouait ; le fichier est passé par un tampon mémoire.

Module `offline` toujours fermé en production ; O07 reste à confirmer par la gate G2.

## Environnement de développement (cloud)

PHP 8.3.6 (sans bcmath/gmp/pcov), Composer 2.8.12, Node 22.22.0, npm 10.9.4, Chromium Playwright dans `/opt/pw-browsers`. MySQL 8.4.9 par Docker (`mirror.gcr.io/library/mysql:8.4.9`, conteneur `eeo-mysql`, base isolée `eeo_test`). Reprise après redémarrage du conteneur de session : relancer `dockerd`, puis le conteneur MySQL. Détails : `startup.md`.

### Poste local Windows (depuis le 2026-10-15)

Windows 11, PHP 8.4.21 (bcmath présent, sans pcov), Composer 2.9.8, Node 24.15.0, npm 11.12.1, Python 3.14.6, MySQL Community 8.4.9 sans Docker par `tools/dev/mysql-windows.ps1` (port 3316, base isolée `eeo_test`), scripts lancés depuis Git Bash. La CI GitHub reste la référence des versions épinglées (PHP 8.3, Node 22, `mysql:8.4.9`) : un résultat local sous PHP 8.4 et Node 24 ne la remplace pas. Une suite Vitest lancée en même temps que PHPStan et PHPUnit a dépassé ses délais (3 erreurs de temporisation, aucun test en échec) ; seule, elle passe : ne pas paralléliser les contrôles lourds sur ce poste. Le 2026-10-15, le poste était saturé par d'autres sessions (une douzaine de processus Node) : requêtes Laravel de 1 à 7 s, e2e en dépassement de délai, workers Vitest non démarrés pendant Playwright. Les serveurs e2e chargent désormais OPcache pour le seul processus `php -S` (`tests/e2e/support/php.ts`, sans toucher au `php.ini`), sont préchauffés (`tests/e2e/global-setup.ts`) et les délais sont de 60 s par test et 20 s par attente.

## Registre des tâches

### F01 — Confirmer la baseline et les contraintes de lancement

| Champ | Valeur |
| --- | --- |
| Statut | DONE |
| Objectif | Architecture 23 retenue, aucun VPS ni donnée réelle, environnement local identifié |
| Fichiers | `docs/implementation/startup.md`, `hosting-audit.md`, `progress.md`, `task-status.json` |
| Tests exécutés | Audit des versions (php -v, extensions, composer, node, docker, mysql @@version = 8.4.9) le 2026-10-14 ; accès Packagist/npm vérifiés |
| Défauts ouverts | Audit de l'hébergeur impossible sans accès (Q01) ; PHP 8.3 au lieu de 8.4 ; bcmath/gmp absents |
| Décision nouvelle | Aucune modification d'architecture ; MySQL via Docker faute de téléchargement direct (limite réseau, consignée) |
| Reprise | Démarrer F02 |

### F02 — Créer le dépôt applicatif et verrouiller les dépendances

| Champ | Valeur |
| --- | --- |
| Statut | IN_REVIEW |
| Objectif | Laravel 13 intégré à la racine sans écraser les sources ; SPA Vue 3/TypeScript strict/Tailwind 4/PWA construite en fichiers statiques ; dépendances verrouillées ; aucun serveur Node en production |
| Fichiers | `composer.json`, `composer.lock`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `.env.example`, `config/eeo.php`, `config/{session,cache,queue,auth,database,sanctum,filesystems}.php`, `bootstrap/app.php`, `routes/{api,spa,console}.php`, `app/Http/Controllers/{SpaController,HealthController}.php`, `app/Providers/AppServiceProvider.php`, `app/Models/User.php`, `resources/frontend/**`, `resources/views/spa.blade.php`, `public/icons/**`, `docs/implementation/build.md` |
| Versions verrouillées | Laravel 13.36.0, Sanctum 4.3.3, brick/math 1.0.0 (pur PHP), PHPUnit 12.5.39, Pint 1.32.1, Larastan 3.13.0, PHPStan 2.3.1 ; Vue 3.5.44, Vue Router 5.4.0, TypeScript 6.0.3, Vite 8.3.4, Tailwind 4.3.3, vite-plugin-pwa 2.0.0, Dexie 4.4.6, jsPDF 4.2.1, Vitest 5.0.4, Playwright 1.64.0, ESLint 10.12.0 |
| Tests exécutés | Voir F03 (mêmes exécutions) ; copie propre du dépôt (fichiers suivis seulement) : `composer install --no-dev --optimize-autoloader`, `npm ci`, `npm run build` réussis, assets identiques à ceux du dépôt de travail (mêmes empreintes) ; puis `composer install`, PHPUnit 96 tests (1 ignoré : pas de `.git`), Vitest, e2e réussis ; e2e aussi réussis avec `vendor/` de production ; `npm audit` et `composer audit` : aucune vulnérabilité |
| Défauts ouverts | CSP absente (le défaut D2 de la vérification, hors de ce lot, reste à planifier avec les en-têtes de sécurité) ; aucun `trustProxies` ni `TrustHosts` (adresse IP du client pour l'audit, URL générées depuis la requête : à décider avec l'audit de l'hébergeur, Q01) ; icônes provisoires (logo réel : Q03) ; avertissements EBADENGINE informatifs (Node 22.22.0 local, dépendances transitives de développement demandant 22.22.2) ; `glob@11.1.0` déprécié, transitif de `workbox-build` (développement seulement) ; `README.md` racine dit encore « le code applicatif reste à développer » (fichier non modifié) |
| Décision nouvelle | La coquille SPA est servie hors du groupe `web` (pas de session ni de cookie, précachable) ; le service worker et le manifeste sont servis à la racine par des routes Laravel ; la route CSRF de Sanctum est déplacée sous `/api/sanctum/csrf-cookie` ; `.gitignore` : les contenus de `storage/` sont ignorés par les `.gitignore` de chaque sous-dossier (suivis) afin que l'arborescence existe après un clone ; scripts Composer `test*` appellent PHPUnit directement (`artisan test` émet des avertissements sans `.env`) ; **la sonde `/up` est une route maison** (`HealthController`, JSON `{"status":"ok"}`, sans vue ni session) car le `health:` de Laravel rend une vue qui charge un script CDN et des fontes tierces sur l'origine de l'application ; analyse statique PHPStan niveau 8 + Larastan verrouillée (`phpstan.neon`, `composer run analyse`) ; **les assets de la coquille sont des chemins depuis la racine du site** (`Vite::createAssetPathsUsing`), indépendants du schéma, de l'hôte, de `X-Forwarded-*` et d'`ASSET_URL` : la coquille fonctionne derrière un proxy ou un CDN qui termine TLS sans `trustProxies` ; aucun écart d'architecture |
| Reprise | Re-vérification adverse de la sonde `/up`, de l'analyse statique et de la coquille derrière un proxy TLS, puis DONE ; poursuivre par F04 |

### F03 — Installer les contrôles CI et MySQL isolé

| Champ | Valeur |
| --- | --- |
| Statut | IN_REVIEW |
| Objectif | Contrôles de qualité PHP/TS/build, base MySQL de test isolée, garde contre toute destruction hors base de test, e2e sans fournisseur réel |
| Fichiers | `phpunit.xml`, `tests/bootstrap.php`, `tests/TestCase.php`, `tests/Support/RequiresIsolatedMysql.php`, `tests/{Unit,Feature,Concurrency,frontend,e2e}/**` (dont `tests/e2e/support/{browser,chromium,ports,tls-proxy}.ts`), `app/Support/Testing/**`, `app/Console/Commands/ResetTestDatabase.php`, `vitest.config.ts`, `playwright.config.ts`, `phpstan.neon`, `.github/workflows/quality.yml`, `tools/dev/mysql-up.sh`, `tools/dev/check-all.sh`, `tools/dev/seed-composer-cache.sh`, `tests/Feature/Database/MigrateRollbackGuardTest.php`, `tests/fixtures/migrations/**`, `docs/implementation/testing.md` |
| Tests exécutés | `tools/dev/check-all.sh --strict --with-e2e` (2026-10-14, MySQL 8.4.9 Docker, après corrections) : Pint réussi ; PHPStan niveau 8 + Larastan **0 erreur** ; PHPUnit **132 tests, 671 assertions, 0 échec** (Unit 28, Feature 101, Concurrency 3) ; `vue-tsc` strict sans erreur ; ESLint sans erreur ; Prettier conforme ; Vitest **30 tests** (3 fichiers) ; `vite build` réussi ; Playwright **13 tests** (Chromium local, `/opt/pw-browsers`). Preuves de la garde sur de vrais processus `php artisan` : `migrate:fresh` et `migrate:rollback` refusés en `production`, en `local` et en `testing` sur la base `eagle_eye_optics` (sans connexion à la base) ; `eeo:test-db:reset --migrate` et `migrate:fresh` acceptés sur `eeo_test`. Contrôles par mutation : désactiver l'écouteur ou le relais d'événements fait échouer 10 à 11 tests ; retirer `migrate:rollback` de la liste fait échouer 11 tests ; remettre le `health:` de Laravel fait échouer 6 tests PHP et le test e2e « aucune requête hors origine » ; retirer `/api` de la liste de refus du service worker fait échouer le test e2e de coupure ; retirer `Vite::createAssetPathsUsing` fait échouer les 12 tests de `SpaShellOriginTest` et les 4 tests e2e d'origine HTTPS |
| Défauts ouverts | `quality.yml` non exécuté sur GitHub (commandes équivalentes exécutées localement) : à constater après le premier push ; le mode hors ligne de Playwright ne couvre pas les requêtes du service worker, d'où l'arrêt réel du serveur dans le test e2e ; le parcours G1 n'existe pas encore ; CREATE TRIGGER exige `log_bin_trust_function_creators=1` ou `SUPER` quand le journal binaire est actif : prérequis à vérifier chez l'hébergeur (Q01) ; pas de couverture PHP (pcov/xdebug absents) ; les `down()` des migrations de F04 doivent refuser sur les tables métier (la garde de commande ne suffit pas) ; niveau PHPStan 8 (les niveaux 9 et 10 restent possibles) |
| Décision nouvelle | La garde est fermée par défaut (`APP_ENV=testing`, base `*_test`, hôte local, MySQL), couvre `migrate:fresh/refresh/reset/rollback` et `db:wipe`, et un test classe toute commande `migrate:*`/`db:*` enregistrée par Laravel ; Laravel ne relaie pas `CommandStarting` quand `APP_ENV=testing` : le fournisseur de services le relaie explicitement ; l'écouteur ne couvre pas les sous-commandes (`$this->call`) ni le SQL manuel (documenté) ; utilisateur de test `eeo_test` limité à `eeo_test` et `eeo_*_test` (mot de passe fictif) ; l'étape d'analyse statique du job `php` est ajoutée à `quality.yml` ; `tools/dev/seed-composer-cache.sh` rend `composer install` reproductible dans un bac à sable dont le réseau refuse l'API GitHub ; aucun écart d'architecture |
| Reprise | Re-vérification adverse des corrections, constater la première exécution GitHub Actions, puis passer F03 à DONE ; poursuivre par F04 |

## Corrections après vérification adverse (2026-10-14)

Trois défauts majeurs relevés par des vérificateurs indépendants (lentilles conformité à la spécification et frontend e2e) sur le point d'étape F02/F03. Chaque défaut a été reproduit **avant** correction, puis la commande qui échouait a été rejouée.

| Défaut | Correction | Preuve |
| --- | --- | --- |
| `migrate:rollback --force` exécutait `down()` et supprimait une table en `APP_ENV=production` sur une base sans `_test` (garde incomplète ; F03 : « destruction de base impossible avec configuration production ») | `migrate:rollback` ajouté à `BlockDestructiveDatabaseCommands::BLOCKED_COMMANDS` ; test qui classe explicitement toute commande `migrate:*`/`db:*` ; message de refus mis à jour ; `testing.md` liste commandes couvertes et limites ; contrat F04 : `down()` refusant sur tables métier | Avant : table `probe_metier` supprimée, code 0. Après : « Opération destructive refusée », code 1, table intacte, y compris `migrate:rollb`, `mi:rollback`, `--step=1`, en `local` et en `testing` sur une base non isolée. `MigrateRollbackGuardTest` (MySQL réel) ; mutation : 11 tests échouent sans le correctif |
| Aucune analyse statique PHP (spec 05 et 25 : `composer run lint` = format **et** analyse) ; la justification « Larastan non installable ici » était inexacte | `larastan/larastan` (3.13.0, PHPStan 2.3.1) en `require-dev` et verrouillé ; `phpstan.neon` niveau 8 ; scripts `analyse`, `lint:style` et `lint` (style puis analyse) ; étape dans `quality.yml` ; 4 constats Larastan corrigés dans le code (test `=== null` mort, `method_exists` toujours vrai, deux `env()` de type union booléen ou chaîne), code aussi sans constat sous PHPStan seul ; `tools/dev/seed-composer-cache.sh` pour le bac à sable | `composer run lint` : Pint réussi, PHPStan « No errors », code 0, y compris sur une copie sans `.env` reconstruite de zéro (`vendor/` absent, 111 paquets) ; contrôle négatif : un fichier fautif fait échouer `lint` (code 1) ; `composer audit` sans alerte |
| `/up` (vue par défaut du `health:` de Laravel) chargeait `cdn.jsdelivr.net` (script Tailwind non épinglé) et `fonts.bunny.net` sur l'origine de la SPA, du service worker et du futur coffre local | Route maison `GET /up` (`HealthController`) : JSON `{"status":"ok"}`, `Cache-Control: no-store`, 500 `{"status":"error"}` sans message d'exception, hors du groupe `web`, exemptée de la maintenance ; `health:` retiré ; test statique des vues Blade | Avant : requêtes `https://fonts.bunny.net/css?family=figtree…` et `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`. Après : aucune requête hors origine (Playwright, y compris service worker actif), `curl` 200 JSON sans « http », routes en cache (`route:cache`) conformes ; mutation : 6 tests PHP et l'e2e échouent avec l'ancien `health:` |

Points laissés ouverts (hors de ce lot) : CSP et en-têtes de sécurité (D2) ; niveau PHPStan 9/10 ; `quality.yml` toujours jamais exécuté sur GitHub.

## Seconde vérification adverse (2026-10-14) : coquille derrière un proxy TLS

Un vérificateur indépendant (lentille frontend e2e) a conclu `pass=false` sur un défaut majeur. Il a été reproduit **avant** correction, puis les commandes qui échouaient ont été rejouées.

| Défaut | Correction | Preuve |
| --- | --- | --- |
| Coquille vide (page blanche, service worker jamais enregistré) derrière un proxy ou un CDN qui termine TLS : `@vite` écrivait des URL d'assets **absolues** déduites du schéma et de l'hôte de la requête (`http://…/build/assets/main-….js`), bloquées par Chromium comme contenu mixte ; `APP_URL=https://…` (consigne de `build.md`) n'y changeait rien ; un en-tête `Host` arbitraire faisait pointer les assets vers cet hôte. Aucun test ni document ne couvrait le cas : tous les e2e tournent en `http://127.0.0.1`, que Chromium exempte des règles de contenu mixte (fichier 23 : « une seule origine HTTPS ») | `Vite::createAssetPathsUsing` dans `AppServiceProvider` : les assets sont des chemins depuis la racine (`/build/assets/…`), indépendants du schéma, de l'hôte, de `X-Forwarded-*`, de `trustProxies` et d'`ASSET_URL` (volontairement sans effet). Tests : `SpaShellOriginTest` (12 tests PHP, vrai Vite, manifeste jetable) et `tests/e2e/https-origin.spec.ts` (4 tests : serveur PHP en HTTP, proxy TLS Node avec certificat `openssl` jetable, Chromium sur `https://cabinet.eeo-e2e.test`) ; supports e2e factorisés (`tests/e2e/support/{browser,chromium,ports,tls-proxy}.ts`) ; `build.md` (rôle d'`APP_URL`, `ASSET_URL`, `trustProxies`, vérification de déploiement), `testing.md`, commentaire de `.env.example`. Pas de `trustProxies(at: '*')` : tout client pourrait falsifier `X-Forwarded-*` (adresse IP d'audit, hôte) | Avant : `curl -H 'X-Forwarded-Proto: https' /` → `src="http://127.0.0.1:8765/build/assets/main-BsVnD6L-.js"` ; `-H 'Host: evil.test'` → `http://evil.test/build/…` ; Chromium sur `https://cabinet.example.test:8443` (proxy TLS Node, `APP_URL` HTTPS) : `#app` de 0 caractère, 0 `h1`, `getRegistration()` nul, console « Mixed Content : … requested an insecure script … This request has been blocked ». Après : mêmes commandes → `/build/assets/main-BsVnD6L-.js`, y compris avec `Host` et `X-Forwarded-Host` arbitraires et sous `config:cache` + `route:cache` + `view:cache` en `APP_ENV=production` ; Chromium : `#app` de 987 caractères, 1 `h1`, service worker enregistré, console vide. Mutation : sans l'appel, les 12 tests PHP et les 4 tests e2e échouent. `check-all.sh --strict --with-e2e` : PHPUnit 132 tests / 671 assertions, Vitest 30, Playwright 13, Pint, PHPStan niveau 8, vue-tsc, ESLint, Prettier et build sans erreur |

Points laissés ouverts (hors de ce lot) : réglages dépendant de l'hébergeur (Q01) — `trustProxies` (adresse IP d'audit, URL générées depuis la requête) et éventuel `TrustHosts` ; le workflow GitHub Actions n'a toujours jamais été exécuté (le test d'origine HTTPS exige `openssl`, présent sur `ubuntu-24.04`).

## Durcissement après la troisième vérification (2026-10-14)

Les quatre vérificateurs indépendants concluent `pass=true` (reproductibilité, hygiène du dépôt public, conformité aux spécifications, frontend e2e) ; la CI GitHub Actions a tourné pour la première fois sur le point d'étape `9144e25` (run 38551182773 : jobs PHP, frontend et e2e réussis). Défauts mineurs restants corrigés tout de suite lorsqu'ils touchent la sécurité ou la confidentialité (fichier 09, « Protection de l'application ») :

| Défaut mineur relevé | Correction | Preuve |
| --- | --- | --- |
| Garde de base : `$` acceptait un nom avec saut de ligne final (`prod_test\n`) | Motif terminé par `\z` | 2 cas ajoutés à `IsolatedDatabaseGuardTest` |
| En-têtes de sécurité absents (CSP, iframe, nosniff), `X-Powered-By` visible | Middleware `SecurityHeaders` global : CSP d'origine unique sans `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, COOP, `X-Robots-Tag: noindex` ; CSP omise seulement quand le serveur Vite de développement est actif | `SecurityHeadersTest` ; e2e Playwright (13) sans erreur de console sous CSP |
| Réponses `/api` sans `Cache-Control: no-store` | `no-store, private` sur `/api` | `SecurityHeadersTest` |
| CORS par défaut du framework (`*` sur `/api`) | `config/cors.php` : aucun chemin CORS (application mono-origine) | Préflight d'une origine tierce sans `Access-Control-Allow-Origin` |
| `.gitignore` sans certificats, dumps ni sauvegardes | Règles ajoutées (`*.crt`, `*.p12`, `*.dump`, `*.sql.gz`, `/backups/`…) ; les scripts SQL du socle restent suivis | `git check-ignore` |
| `vueCompilerOptions.strictTemplates` absent ; `build.md` contradictoire sur `APP_URL` ; README racine obsolète | Activé ; texte corrigé ; README pointe vers ce journal | `vue-tsc` sans erreur |

`tools/dev/check-all.sh --strict --with-e2e` après durcissement : Pint, PHPStan niveau 8 (0 erreur), PHPUnit **138 tests / 714 assertions**, vue-tsc, ESLint, Prettier, Vitest 30, build, Playwright 13 ; `verifier_plan.py` : PASS, empreintes SQL validées inchangées.

Restent ouverts (non bloquants pour F02/F03, reportés) : `trustProxies`/`TrustHosts` selon l'hébergeur (Q01) ; affectation de masse de `User` (`clinic_id`, `password_hash`) à fermer en F05 ; preuve e2e « /api jamais en cache » avec une vraie route `/api` 200 (première route en F05) ; profil de configuration « recette » à documenter avec H01 ; `composer run test:contracts` et `npm run test:domain` (fichier 25) arrivent avec F06 et F08 ; avertissements EBADENGINE (Node 22.22.0 local).

### F04 — Traduire le schéma complet et prouver son équivalence

| Champ | Valeur |
| --- | --- |
| Statut | DONE |
| Objectif | 117 tables métier, 464 FK, 484 CHECK, 88 guards et 10 vues équivalents à la baseline ; 4 rôles, 49 permissions, 76 termes ; colonnes générées, charset, défauts et référentiels préservés ; SQL livré et migrations jamais exécutés deux fois |
| Fichiers | `database/tools/build_migrations.py`, `database/baseline/statements.json`, `database/baseline/metadata.json`, `database/migrations/2026_10_14_00000{0..4}_*.php`, `app/Support/Schema/*`, `app/Console/Commands/{VerifySchema,AdoptBaseline,SnapshotSchema}.php`, `tools/dev/schema-parity.sh`, `tools/dev/schema_parity_report.py`, `tests/Unit/Schema/*`, `tests/Feature/Schema/*`, `tests/Support/ScratchMysqlDatabases.php`, `docs/implementation/schema.md`, `docs/evidence/schema-parity.json`, `.github/workflows/quality.yml` |
| Contrats / tables | Toutes les tables du catalogue (baseline SHA-256 `73bd5dc4…2046e2761eb` = backlog) ; tables techniques `migrations`, `fw_sessions` (user_id ULID ASCII), `fw_cache`, `fw_cache_locks`, `fw_jobs`, `fw_job_batches`, `fw_failed_jobs` ; `fw_password_reset_tokens` non créée (pas de réinitialisation par e-mail à ce stade) |
| Tests exécutés | (1) `build_migrations.py --check` : les instructions redonnent octet pour octet `01_schema.sql`, `02_reference_data.sql`, `03_reporting_views.sql`, `04_history_guards.sql` et le fichier complet (CRLF ramenés à LF). (2) `tools/dev/schema-parity.sh` au commit `3fe6e93`, arbre propre, MySQL 8.4.9 : **22/22** — photographies import SQL / migrations identiques (0 écart, 0 avertissement de session), 41 assertions `mysql_smoke_tests.sql` et `mysql_metadata_tests.sql` passées sur la base **migrée**, adoption d'une base importée acceptée puis refusée une seconde fois, adoption refusée sans écriture pour un trigger supprimé, un CHECK supprimé et un référentiel modifié, `migrate` refusé sur base déjà importée avec renvoi à `eeo:schema:adopt`, second `migrate` sans effet, `migrate:rollback` refusé en production. (3) PHPUnit `tests/Unit/Schema` + `tests/Feature/Schema` : 32 tests (IT01 : perte d'une colonne générée, d'une FK, d'un CHECK ou d'un trigger détectée ; guard append-only réellement actif ; `down()` des 4 étapes refusant ; cohérence catalogue ↔ métadonnées colonne par colonne). (4) `check-all.sh --strict --with-e2e` : PHPUnit 170 / 20 560 assertions, PHPStan niveau 8 sans erreur, Vitest 30, Playwright 13 |
| Défauts ouverts | Preuve sur MySQL 8.4.9 uniquement : à rejouer sur la version réelle de l'hébergeur (Q01) ; `log_bin_trust_function_creators=1` ou SUPER requis pour créer les triggers quand le journal binaire est actif (Q01, `hosting-audit.md` point 8) ; `migrate --pretend` n'affiche pas les instructions de baseline (envoyées par PDO, voir `BaselineInstaller::execute`) |
| Décision nouvelle | Nom contractuel `php artisan eagle:verify-schema` (fichier 25), alias `eeo:schema:verify` ; attributs de session des triggers/vues (sql_mode, jeux de caractères) signalés comme avertissements et non comme écarts, car ils dépendent du client d'import (fichier complet ou scripts séparés) sans changer le corps des gardes ; tables techniques migrées **avant** la baseline pour qu'un retour arrière bute immédiatement sur le refus ; CI épinglée sur `mysql:8.4.9` (l'image flottante `mysql:8.4` a servi 8.4.11) |
| Reprise | G0 puis F05 |

### G0 — Valider installation et modèle de toute l'application

| Champ | Valeur |
| --- | --- |
| Statut | DONE |
| Preuve | `docs/evidence/G0.md` : équivalence relue (22/22), installation neuve reproductible depuis un clone frais du dépôt distant en mode production, application servie (sonde, coquille, API 404 JSON no-store, fichiers sensibles non exposés), CI GitHub verte, `.env.example` sans secret, aucune activation financière réelle |
| Manques pour la production | Q01–Q04, Q14 (et Q05–Q13, Q15 pour les lots concernés) : voir `G0.md` |
| Reprise | F05 |

### F05 — Adapter identité, permissions et bootstrap gérante

| Champ | Valeur |
| --- | --- |
| Statut | DONE — corrections des revues au commit `ef7d5f6` ; CI GitHub verte sur `3912158` (run 38588658627 : Pint, PHPStan, PHPUnit Unit/Feature/Concurrency sur `mysql:8.4.9`, équivalence du schéma, e2e Playwright), qui contient ces corrections ; le run 38588208603 de `ef7d5f6` a passé toutes ses étapes avant d'être annulé par la poussée suivante |
| Objectif | Quatre profils démontrables ; URL/API/PDF refusés au mauvais rôle ; session invalidée sans perte des pièces |
| Fichiers | `app/Domain/Access/*` (résolveur pur, permissions effectives, cabinet configuré, audit, profils, sessions, `StaffAdministration`, actions dont `RecoverManagerAccount`), `app/Domain/Shared/{Ulid,BusinessError}.php`, `app/Http/Errors/ApiErrorRenderer.php`, `app/Http/Middleware/{AssignCorrelationId,EnsureUserIsActive,RequireRecentReauthentication}.php`, `app/Http/Controllers/Api/V1/{AuthController,StaffController,ClinicSettingsController}.php`, `app/Models/{User,Clinic}.php`, `app/Console/Commands/{SetupClinic,CreateDemoAccounts,RecoverManager}.php`, `lang/fr/validation.php`, `routes/api.php`, `config/database.php`, `docs/implementation/access.md` |
| Contrats / tables | `clinics`, `users`, `user_roles`, `user_permissions`, `roles`, `permissions`, `role_permissions`, `audit_events`, `fw_sessions` ; routes `/api/v1/auth/*`, `/staff*`, `/clinic/settings` ; enveloppe d'erreur du fichier 08 avec `correlation_id` ; codes déclarés dans `contracts/schemas/error.json` (test `ErrorCodeCatalogTest`) |
| Revues | Deux revues indépendantes du commit `343a448` sur base jetable MySQL 8.4.9 : **attaque** (1 bloquant sous condition, 7 majeurs, 6 mineurs, tous reproduits sauf deux déduits du code) et **conformité aux spécifications** (0 bloquant, 5 majeurs dont un interblocage prouvé, 15 mineurs, 9 mutations survivantes sur 27). Tous les constats sont traités ou déclarés comme écarts : tableau « Constats des revues et traitement » de `access.md`. Un défaut supplémentaire a été trouvé en écrivant le test de déconnexion (session anonyme attribuée au compte déconnecté) et corrigé. |
| Tests exécutés | `check-all.sh --strict --with-e2e` (2026-10-14, MySQL 8.4.9) : PHPUnit **283 tests / 21 596 assertions**, dont `tests/Feature/Access` (62 : connexion, échecs indiscernables, limites par adresse et par compte, variantes d'identifiant, autre cabinet, 401/403/404/409/422/423, régénération de session et invalidation à la déconnexion en pilote `database`, désactivation qui coupe les sessions, `users.manage` non délégable, propres profils, reset de gérante refusé, auteur relu sous verrou, audit transactionnel et sans auteur pour un échec, mot de passe absent des piles d'appels, valeurs SQL masquées, Bearer 401, procédure de secours, démonstration restreinte) et `tests/Concurrency/AccessLockOrderTest.php` (4 entrelacements à **processus PHP séparés** : ordre des verrous de la connexion et du changement de mot de passe, désactivation mutuelle de deux gérantes, double mise en service en READ COMMITTED) ; chacune des trois corrections de concurrence retirée tour à tour fait échouer son test, de même que l'oubli de l'utilisateur à la déconnexion ; Pint et PHPStan niveau 8 sans erreur ; Vitest 70 ; Playwright **18** dont `auth-session.spec.ts` |
| Défauts ouverts | Hors F05 par dépendance : verrouillage du coffre local (O01), refus PDF par rôle (D01/D02), écrans et garde de navigation (F09), idempotence des mutations de comptes (F07) ; `trustProxies` selon l'hébergeur (Q01). Écarts déclarés dans `access.md` : matrice 09 / référentiel seedé (caisse sans `credit_note.issue`, `refund.execute`, `exam_fee.collect` ; professionnel avec `visit.register` et `agenda.write`) à trancher avant B06–B08 ; `app/Policies/` sans Policy de ressource à ce stade ; MFA de la gérante sans tâche dans le backlog (décision à inscrire au registre 15 et au fichier 25 §6) ; pas de réinitialisation par e-mail avant L2/L3 |
| Décision nouvelle | CSRF : Laravel 13 accepte les écritures `Sec-Fetch-Site: same-origin` (Fetch Metadata), sinon exige `X-XSRF-TOKEN` — conservé, prouvé en e2e ; connexion refusée sans session SPA (400 `SESSION_REQUIRED`) ; jetons d'accès personnels Sanctum désactivés ; `users.manage` jamais délégable par dérogation, propres profils non modifiables, reset d'une gérante uniquement par la procédure de secours console `eeo:staff:recover-manager` (journalisée, motif obligatoire, ne promeut jamais un autre compte) ; ordre des verrous cabinet → compte pour toutes les actions d'accès (verrou partagé pour la connexion et le changement de mot de passe), relance bornée à trois tentatives sur interblocage, hash bcrypt hors transaction ; mise en service sérialisée par la ligne de référence du profil Gérante ; `expected_version` exigé sur dérogation et reset (version du compte incrémentée) ; `expires_at` en instant UTC à la milliseconde ; `GET /clinic/settings` réservé à la gérante ; audit d'échec de connexion sans auteur avec HMAC à clé ; chaîne `previous_hash` de l'audit non tenue (facultative, décision F07) |
| Correction ultérieure | 2026-10-15, trouvée pendant les e2e de F09 : sans session et sans en-tête `Accept: application/json`, une route `/api` protégée répondait 500 (redirection vers une route `login` inexistante) au lieu de 401 `AUTH_REQUIRED`. Corrigé par `redirectGuestsTo(null)` dans `bootstrap/app.php` ; test `test_sans_session_ni_en_tete_accept_json_l_api_repond_401_et_jamais_500` (trois routes) |
| Reprise | F06 |

### F06 — Matérialiser les contrats et versions

| Champ | Valeur |
| --- | --- |
| Statut | DONE — CI GitHub verte sur le commit final `8614fd5` (run 38592637925, 2026-10-14) |
| Objectif | Contrats versionnés validables ; identifiants de tous les effets définis avant commit local ; aucun endpoint métier nécessaire laissé implicitement à inventer (EE042, EE045, EE046) |
| Fichiers | `contracts/openapi.yaml`, `contracts/commands/` (26 commandes, `index.json`, `dispatch.json`), `contracts/events/` (enveloppe et 13 événements), `contracts/compatibility.json`, `contracts/schemas/` (common, enums, error, clinical-steps, compatibility, resources, requests), `contracts/sync/`, `contracts/snapshots/`, `contracts/fixtures/` (150), `contracts/vocabulary.json`, `contracts/tools/` (5 générateurs Python `--check`, `generate-types.mjs`), `resources/frontend/domain/contracts/generated.ts`, `docs/implementation/contracts.md` |
| Contrats / tables | Commandes alignées sur `patient_records`, `visits`, `consultations`, `optical_prescriptions`, `invoices`, `cash_sessions`, `deliveries`, `physical_returns`, `stock_movements`, `follow_up_plans`, `appointments`, `contact_tasks`, `approvals` ; cœur signé aligné sur `sync_commands` ; événements sur `outbox_events` ; snapshots sur les colonnes JSON `snapshot` |
| Tests exécutés | `check-all.sh --strict --with-e2e` (2026-10-14, MySQL 8.4.9) : PHPUnit **403 tests / 23 950 assertions**, dont la suite Contracts (156 : 150 fixtures Opis, compatibilité, codes d'erreur, cohérence commandes/catalogue, routes Laravel = opérations IMPLEMENTED avec permission et réauthentification identiques au middleware) et `tests/Feature/Contracts` (réponses réelles des routes F05 validées contre leurs schémas) ; les six générateurs `--check` à jour ; Vitest **192** (Ajv strict sur les mêmes 150 fixtures, mêmes verdicts ; OpenAPI valide selon le schéma officiel OAS 3.1 avec contrôles négatifs, références résolues, commandes/routes/permissions/backlog cohérents ; types générés utilisés sur les fixtures) ; TypeScript strict, ESLint, Prettier, build ; Playwright 18. Contrôles par mutation : version attendue sans colonne réelle et réintroduction d'un défaut détectées par les tests de cohérence |
| Défauts ouverts | Vecteurs de calcul (F08) et de signature JCS/JWS (O02) à fournir par leurs tâches ; formats de coffre (O01) et modèles de documents (D01/D02) à déclarer dans `compatibility.json` à leur livraison ; les corps et réponses des opérations PLANNED sont des contrats fixés que leur tâche implémente et peut préciser par une nouvelle version, jamais en contredisant les invariants |
| Décision nouvelle | `ReserveStock` n'est pas une commande ni une route (I00 : service interne d'`IssueInvoice`/`ConfirmDelivery`) ; `RegisterStockMovement` limité à la casse et à l'ajustement (stock initial par `POST /stock/opening`) ; numéro rendu null dans une requête directe (numéro central) ; nature `state` de `expected_version` pour les tables sans colonne version (`optical_prescriptions`, `cash_sessions`, `approvals`) ; `schema_version` en chaîne et `last_server_time` obligatoire (colonnes de `sync_commands`) ; prescription brouillon modifiable en ligne avec `expected_updated_at`, correction hors-ligne = nouvelle version (à confirmer en C04) ; routes ajoutées pour B01 (catalogue, règles fiscales), X01 (imports), R02 (statistiques cliniques) et la consultation de l'audit (rattachée à F07) ; `GET /clinic/settings` réservé à la gérante |
| Reprise | F07 |

### F07 — Construire le chemin central de commandes

| Champ | Valeur |
| --- | --- |
| Statut | DONE — constats de la revue contradictoire traités au commit `9347d7f` (tableau de `command-bus.md`) ; CI GitHub verte : [run 38716810524](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/38716810524) sur `78d9cb2` (qui contient `9347d7f`) et [run 38719061673](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/38719061673) sur `2a83599` (constatées le 2026-10-15) |
| Objectif | Toute mutation critique passe par une seule transaction : droits, verrous ordonnés, idempotence, faits, audit, outbox, journal des changements ; aucun effet externe dans la transaction ; publication du pull ordonnée sous le verrou du cabinet |
| Fichiers | `app/Application/**` (CommandBus, TransactionRunner, Authorization, Effects, Locking, Publication), `app/Domain/Shared/{CommandContext,CommandSource,GrantSnapshot,CanonicalJson}.php`, `app/Domain/Access/{AccessCommands.php,Handlers/**}`, `app/Http/Controllers/CommandController.php`, `app/Http/Controllers/Api/V1/AuditEventController.php`, `app/Providers/CommandServiceProvider.php`, `tests/{Unit,Feature}/Application/**`, `tests/Concurrency/CommandBusConcurrencyTest.php`, `tools/dev/mysql-windows.ps1`, `docs/implementation/command-bus.md` |
| Historique | Écrit par une session locale interrompue par sa limite d'usage le 2026-10-15 : sauvegardé tel quel au commit `1b0600d` (CI en échec sur PHPStan : trait sans utilisateur, `trait.unused`), corrigé au commit `599ef06` (classe `CommandController`, portabilité Windows des scénarios à processus séparés), CI verte (run 38702410317) |
| Tests exécutés | Poste local, MySQL 8.4.9 isolé : PHPUnit complet 506 tests / 24 548 assertions (5 échecs de portabilité Windows corrigés au commit `599ef06` puis rejoués : Concurrency 17/17, fixtures 151, EnvExample 3) ; Pint, PHPStan niveau 8 ; Vitest 192 ; Playwright 18/18 sous Edge après le correctif `ddcf1f8` (arrêt réel des serveurs e2e sous Windows). Après traitement de la revue : PHPUnit complet sur schéma migré de zéro **775 tests / 40 308 assertions, 0 échec** (1 ignoré : lien symbolique, vérifié en CI Linux), dont Application 79, Access 62, Concurrency 17 ; Pint, PHPStan niveau 8 sans erreur ; Vitest 436 ; générateurs `--check` à jour |
| Revue | Vérificateur indépendant et adverse (lecture seule, base `eeo_review_test`) : chemin direct solide (AT11, AT12, AT38, droits relus sous verrou, publication ordonnée), mais **pass=false** : (1) rejeu d'une commande de poste lié ni à l'auteur ni au grant, (2) verdict de revue d'autorisation non déterministe (horloge serveur mouvante), (3) identifiant d'idempotence inaccessible aux actions alors que `payments`, `refunds`, `deliveries`… l'exigent, (4) garde « aucun effet externe » limitée à `app/Application` et motifs incomplets ; mineurs : casse de la clé, tri des clés de l'empreinte, objet vide changé en liste à la validation, montée de verrou partagé en exclusif, interblocage entre cabinets, mutations non détectées, deux défauts de code mort et de borne |
| Traitement | Empreinte de rejeu liée à la source, à l'auteur, au poste et au grant ; verdict d'autorisation historique déterministe (`receivedAt`, conservation durable de la revue = O05) ; `idempotencyId` transmis aux actions ; garde d'effets externes étendue à `app/Domain`, contrôle de transaction, contrôleurs sans écriture, preuve d'exécution par route (`MutationRoutesTest`) ; clé insensible à la casse explicite ; tri total des clés de l'empreinte ; objet vide relu par le validateur ; verrou partagé jamais monté en exclusif, rang 15 « compte » ; tests d'isolation entre cabinets et de tolérance ; borne `to` de l'audit |
| Décision nouvelle | `CommandHandler::handle()` reçoit l'identifiant de sa ligne d'idempotence ; `CommandContext::sync()` exige `receivedAt` (première réception conservée par l'inbox O05) ; rang de verrou « compte » entre cabinet et appareil (décision F05 rendue explicite) ; clé d'idempotence ramenée en majuscules |
| Reprise | F08, puis F09 |

### F08 — Établir règles pures et vecteurs PHP/TypeScript

| Champ | Valeur |
| --- | --- |
| Statut | DONE — constats de la revue contradictoire traités (`6aeab1c`, `2a83599`) ; CI GitHub verte : [run 38719061673](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/38719061673) sur `2a83599` (constatée le 2026-10-15). L'échec du run précédent sur `183a5cb` venait des types non régénérés, corrigés par `6aeab1c` |
| Objectif | Aucun flottant monétaire ; résultats identiques en PHP et en TypeScript sur tous les vecteurs, refus compris ; fin de mois, année, fuseau, zéro et vide distingués ; bornes SQL et version de règles fixées |
| Fichiers | `app/Domain/Shared/{RuleViolation,RulesVersion}.php`, `app/Domain/Shared/ValueObjects/*`, `app/Domain/{Billing,Inventory,Scheduling}/Rules/*`, `resources/frontend/domain/{errors,rulesVersion}.ts`, `resources/frontend/domain/{values,billing,inventory,scheduling}/*`, `contracts/vectors/*.json` (9 fichiers, 242 cas), `contracts/schemas/rule-vectors.json`, `tests/Unit/Rules/*`, `tests/Feature/Rules/MysqlRuleParityTest.php`, `tests/Support/Rules/RuleVectorOperations.php`, `tests/frontend/domain/*`, script `npm run test:domain`, `docs/implementation/rules.md` |
| Contrats / tables | Bornes et expressions de `invoice_lines` (ck_03, ck_04), `invoices`, `payments`, `payment_reversals`, `credit_notes`, `refunds`, `stock_*`, `device_stock_allocations`, `follow_up_plans`, `patient_records.name_search` et `phone_*_normalized` ; vues `vw_invoice_balances`, `vw_stock_position_balances` ; `rules_version` `2026-10-14.1` |
| Tests exécutés | Poste local, MySQL 8.4.9 : `RuleVectorsTest` 243 (242 cas + format), `npm run test:domain` 243, mêmes verdicts ; `MysqlRuleParityTest` 3 tests / 80 assertions (arrondi = `ROUND` et CHECK, dates = `DATE_ADD`, décimaux = forme MySQL) ; `SqlBoundsTest` 3 ; gardes sans flottant PHP et TypeScript ; PHPUnit Unit 332 et Contracts 157 ; Vitest 436 ; Pint, PHPStan niveau 8, vue-tsc, ESLint, Prettier. Attendus des vecteurs recoupés par une troisième implémentation Python (`Decimal` ROUND_HALF_UP, `datetime`) avant écriture |
| Défauts ouverts | Méthode de ventilation de la taxe comprise à valider (Q03) ; lot expirant le jour même délivrable (à confirmer avec le cabinet) ; mesures `DECIMAL(4,2)` et `(8,4)` avec C02 ; recette complète des scénarios couverts au niveau du calcul (AT08, AT10, AT12, AT14, AT22, AT26, AT40) par leurs tâches |
| Décision nouvelle | Saisie des montants stricte (groupes de trois exacts) ; blancs de bord en liste fermée commune aux deux moteurs ; clé de recherche NFD sans marques ni ponctuation ; téléphone normalisé sans indicatif déduit ; quarantaine refusée en `STOCK_UNAVAILABLE`, expiration en `LOT_EXPIRED` ; âge d'un 29 février compté au 1er mars ; formes canoniques des décimaux = forme rendue par MySQL |
| Revue | Vérificateur indépendant et adverse (différentiel PHP/Node sur 2 × 91 032 entrées et 1 112 064 points de code, oracle Python, MySQL 8.4.9) : calculs justes et identiques, mais **pass=false** : types générés non mis à jour (CI rouge), dates TypeScript sans garde d'entier, `LOT_EXPIRED` en 409 et valeurs actualisées perdues à la traduction en réponse ; mineurs : `$` PCRE, fuseaux avant 1919, versions Unicode, bornes de quantité, mutants survivants, tri FEFO. Tous traités : tableau de `rules.md` |
| Traitement | Types régénérés (`6aeab1c`) ; gardes d'entier TypeScript ; statuts du fichier 08 et `error.details` (contrat `schemas/error.json`, rendu de l'API) ; ancrage `\z` ; instants bornés à 1970 ; caractères de format retirés de la clé, `name_search` toujours recalculé par le serveur ; quantités de confiance bornées ; 20 vecteurs ajoutés (262) ; générateur versionné `contracts/tools/build_vectors.py --check` (CI, `check-all.sh`) ; gardes sans flottant sur l'arbre syntaxique TypeScript et `/=` en PHP ; arrondi demi supérieur unique `divideRoundHalfUp` ; FEFO par points de code |
| Reprise | F09 |

### F09 — Construire shell responsive et composants réutilisés

| Champ | Valeur |
| --- | --- |
| Statut | DONE — constats de la revue contradictoire traités au commit `7de8e2b` (tableau de `shell.md`) ; CI GitHub verte : [run 38782531589](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/38782531589) sur `7de8e2b` (PHP, Frontend, Playwright Linux **27/27**), après [run 38776166494](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/38776166494) sur `1c39c52` (27/27) |
| Objectif | Coquille accessible et agréable ; aucun menu de module futur présenté comme livré ; composants utilisables dans les écrans patient et caisse (AT28, AT29, EE044) |
| Fichiers | `resources/frontend/styles/{tokens,base}.css`, `resources/frontend/app/{App.vue,router.ts,bootstrap.ts,navigation.ts,session.ts,api.ts,network.ts,unsavedChanges.ts}`, `resources/frontend/pages/{Login,Home,Forbidden,NotFound}Page.vue`, `resources/frontend/components/{ui,form,feedback,clinical,finance}/`, `resources/views/spa.blade.php` (titre, `theme-color`), `resources/frontend/app/pwa.config.ts` (couleurs du manifeste), `tests/frontend/{bootstrap.test.ts,shell/,components/}`, `tests/e2e/shell.spec.ts`, `docs/implementation/shell.md` |
| Tests exécutés | Poste local : Vitest **601** (130 nouveaux : navigation recoupée avec `backlog.json` et le référentiel des permissions, coquille, connexion, palette WCAG calculée depuis `tokens.css`, gardes statiques, champs, retours, tableau optique, sélection au clavier, récapitulatif financier, garde de saisie) ; vue-tsc, ESLint, Prettier ; PHPUnit `AuthenticationTest` 14 tests / 160 assertions ; Pint, PHPStan. Playwright sous Edge sur un poste saturé : run complet 22/27, puis run ciblé 11/15 ; chaque échec restant est un dépassement de délai (traces : requêtes Laravel de 1 à 7 s ; localisateur vérifié présent sur la vraie page), aucun échec d'assertion sur la coquille. La CI Linux est la preuve de référence |
| Défauts ouverts | Essais sur téléphones Android et iPhone réels, impression A4 et mesures d'usage (U01, G3) ; AT29 à vérifier avec les écrans P01–B04 et D01 ; recherche rapide (P02) et état de synchronisation (F10, O04, O05) ; e2e locaux non concluants sous forte charge |
| Décision nouvelle | Catalogue de navigation déclaratif (`delivered`, `deliveredBy`, permissions) ; actions d'accueil du dossier distinctes des modules ; titre écrit en casse normale et affiché en capitales ; statut de session `unverified` (serveur muet ou en erreur), relu au retour du réseau et toutes les 30 s ; écran protégé fermé tant que les droits ne sont pas vérifiés ; déconnexion affichée seulement après confirmation du serveur ; champs lus aussi à Entrée ; clavier texte pour les dioptries (pavé décimal de l'iPhone sans « - ») ; état désactivé en teintes pleines (≥ 4,5:1), jamais d'opacité ; cellules d'axe et d'acuité fournies par fente (règles de C02 et C04) ; couleurs du manifeste PWA alignées sur la palette |
| Revue | Vérificateur indépendant et adverse (lecture seule, sondes et mutations sur copie) : **pass=false** — (1) page d'erreur HTML d'un hébergeur non traitée (session « inconnue », connexion sans message), (2) garde de saisie contournée par un changement de paramètre de route, (3) date impossible au pavé numérique de l'iPhone, (4) option active hors de la partie visible ; 14 mineurs (résultats périmés choisissables, résumé non réannoncé, état réseau figé, déconnexion avant la garde, contrastes non listés, menu « Plus » rogné, débordement de montants, valeur valide gardée après refus, résultats partiels impossibles, focus de la boîte pendant la commande, accueil d'un module sans action, gardes statiques contournables, affirmations inexactes de `shell.md`, option OPcache sans effet) ; 5 mutations survivantes |
| Traitement | Tous les constats traités, chacun avec son test (tableau de `shell.md`) : réponse non JSON = `ApiError`, `onBeforeRouteUpdate`, date en 8 chiffres, `scrollIntoView`, résultats vidés à la nouvelle saisie, résumé refocalisé, sonde `/up` 30 s / 60 s, écran quitté avant la déconnexion, 3 associations de couleurs ajoutées, liste « Plus » bornée, montants qui passent à la ligne, valeur du parent remise à null sur refus, résultats `{ options, notice }`, focus gardé et `pendingLabel`, accueil qui renvoie au menu, gardes statiques élargies, documentation corrigée. Vitest **621** ; les 5 mutations survivantes et 2 nouvelles sont tuées (mutation appliquée, test visé lancé, fichier restauré à l’identique) ; vue-tsc, ESLint, Prettier |
| Correction associée | F05 : 401 au lieu de 500 sans en-tête Accept (ligne « Correction ultérieure » de F05) |
| Reprise | F10, puis O01 |

### F10 — Définir lectures locales et états de synchronisation

| Champ | Valeur |
| --- | --- |
| Statut | DONE — livré au commit `bf4e165` (CI verte, run 38787924175) ; première revue contradictoire `pass=false` traitée au commit `36e380b` (CI verte, run 26) ; seconde revue `pass=false` (14 majeurs, 26 mineurs) : majeurs de base traités au commit `8892e22` (session, compte, solde, lectures vides, accessibilité), reste reporté avec sa tâche destinataire (tableau de `local-reads.md`) ; CI GitHub verte : [run 39702365074](https://github.com/romiall/app.Eagle_Eye_Optics/actions/runs/39702365074) sur `85717e4` (PHP, Frontend, Playwright) |
| Objectif | Aucune écriture Dexie directe depuis un écran ; aucun total local + serveur compté deux fois ; états d'enregistrement et de synchronisation distincts du réseau (AT29, AT42, AT45 ; EE023, EE042, EE044) |
| Fichiers | `resources/frontend/offline/projections/{syncStates,merge,ledger}.ts`, `resources/frontend/app/services/{commandIndex,mutations,useMutation,reads,sync,projections}.ts`, `resources/frontend/components/SyncStatus.vue`, `resources/frontend/components/feedback/{SyncBadge,FreshnessNote}.vue`, `resources/frontend/components/session/ReauthDialog.vue`, `resources/frontend/domain/values/ulid.ts`, `resources/frontend/app/{session,api,network}.ts`, `resources/frontend/app/App.vue` (sonde, revalidation au retour sur l'onglet), `eslint.config.js`, `tests/frontend/support/contracts.ts`, `docs/implementation/local-reads.md` |
| Contrats / tables | `contracts/sync/ack.json` (états), `contracts/commands/index.json` (routes directes, versions attendues, lues par le client sans copie), `common.json#/$defs/Ulid` ; règle F08 `LedgerBalance` (jumelle de `vw_invoice_balances`) |
| Tests exécutés | Poste local : Vitest **853** (29 fichiers : +26 pour la seconde revue, dont le cycle de vie de la session). Livraison initiale : fusion par identifiant, solde sans double comptage, répartiteur, `useMutation`, lectures, composants d'état, ULID, règle d'architecture. Après la revue : fusion des entités modifiables (AT42), grand livre avec faits dépendants en revue et encaissement bloqué, **corps de chacune des 26 commandes validé contre son `DirectRequest`** (Ajv, fixtures du contrat), classement des réponses (423, 429 avec `Retry-After`, 5xx, pages d'hébergeur, corps coupé, 419 renouvelé), clé d'idempotence conservée après succès et renouvelée par `reset()`, identifiants d'effets, garde de compte et relecture de session, états de lecture (vide sans données complètes → hors ligne, défaut du chargeur), `SyncStatus` (autres profils, PDF à déposer, bouton en cours), reconnexion du même compte ; règle d'architecture éprouvée sur 40 cas dont imports dynamiques, relatifs et `indexedDB`, puis lancée sur le code réel ; vue-tsc, ESLint, Prettier. 13 mutations ciblées (dont les 6 survivantes de la revue) font échouer au moins un test |
| Défauts ouverts | `LocalCommandEngine` réel, coffre et journal du poste (O01, O04) ; push, pull et ACK (O05) ; PDF (D01) ; recette AT42 et AT45 avec ces tâches ; écrans qui emploieront les services (P01–P03, B02–B08, C01–C04) |
| Décision nouvelle | Commandes d'un poste préparé toujours enregistrées dans son journal, même en ligne (autorité temporaire de ses écritures) ; routes directes lues dans le contrat F06 ; fait en conflit ni compté ni oublié (montré « en litige ») ; « soldée » seulement avec des données distantes complètes ; reconnexion sur place limitée au même compte ; clés d'idempotence et identifiants d'effets en ULID générés sur le poste ; `app/services` seul accès des écrans au moteur local |
| Revue | Vérificateur indépendant et adverse (lecture seule, sondes et mutations sur copie) : **pass=false**, 6 majeurs — (1) la fusion par identifiant affichait « Consolidé » et masquait une modification du poste en attente ou en conflit (AT42), (2) le corps des routes directes ne respectait pas `DirectRequest` pour 16 commandes sur 26 (`expected_version` absent ou non nul, numéro non nul), (3) la contre-écriture d'un paiement en litige et le remboursement d'un avoir en litige restaient comptés et faussaient le reste dû, (4) un paiement en litige n'empêchait pas un nouvel encaissement, (5) `useRead` annonçait « aucun résultat » sans avoir consulté le serveur, (6) `useMutation` renouvelait la clé d'idempotence après un succès. Mineurs : classement des réponses (423, 429, 504, HTML), délai absent, corps coupé, erreurs hors `ApiError`, message « renvoyé sans doublon » trop affirmatif, `useRead` bloqué en chargement, `settled` sur la foi du poste seul, `SyncStatus` (Synchronisé malgré un échec, autres profils, PDF à déposer, bouton), règle ESLint contournable (imports dynamiques, sous-chemins, `indexedDB`, `offline/db*` seulement), `handles(nom)` au lieu de la propriété de la pièce, reconnexion sans comparaison de compte, documentation inexacte, tests sans validation du corps |
| Traitement | Tous les constats traités, chacun avec son test (tableau de `local-reads.md`) : `mergeFacts` / `mergeVersioned` (une proposition du poste non finalisée n'est jamais masquée, version du serveur gardée), `parentId` et revue en chaîne dans `projectLedger`, `collectionBlocked` / `assertCollectable` / `confirmedLedgerVersion`, `directBody` conforme au contrat, issues `reauthentication-required`, `retryable` (`Retry-After`), `uncertain`, `local-failed`, `account-changed`, délai de 30 s, 419 renouvelé une fois, clé gardée après succès, `effectId`, `MutationBusyError`, `lastAccount` et garde de compte, vide « certain » seulement avec données complètes, `failure`, `SyncStatus` complet, règle ESLint à quatre blocs, `LocalCommandEngine.handles(requête)` |
| Seconde revue | Vérificateur indépendant et adverse sur `36e380b` (finance, transport, vérité de l'interface, architecture et tests) : **pass=false**, 14 majeurs, 26 mineurs, 14 constats réfutés — « soldée » avec un crédit à rembourser, compte épinglé au premier envoi, session dégradée par une panne réseau au retour sur l'onglet, expulsion de la saisie, accueil accusant un manque de droits, boîte de reconnexion inaccessible, vide « certain » sans lecture serveur, confirmation du mot de passe (423) sans remède |
| Traitement de la seconde revue | Traités avec test : `settled` / `creditDue`, compte épinglé à l'ouverture du formulaire, état `expired` et reconnexion sur place, `revalidateSession` (seul un 401/419 change une session ouverte), aucune navigation forcée, `ReadOutcome.live`, focus et erreurs de la boîte, double soumission, intention figée, époque de session, message « rien n'a été envoyé » ; 14 mutations ciblées tuées (une survivante tuée par un test ajouté). **Reportés avec motif et tâche** : confirmation du mot de passe (B06), contrôle serveur de l'acteur attendu (avant G1), 3 routes de `CreatePrescription` (C04), cohérence type/origine des faits financiers (B07), `SyncStatus`/fuseau/accords (O04, O05), règle ESLint (O01), `LocalCommandEngine` (O04), délais d'`api.ts` (D01) |
| Reprise | M01, puis P01, P02, consultation et prescription selon la priorité du demandeur ; O01 à O05 ensuite |

## Écarts de G1 : (a2) annuaire du poste : fiches du serveur lues, modifiées et facturées sans réseau (2026-10-30)

Chantier de la branche `claude/annuaire-poste` (empilée sur `claude/facture-hors-ligne`). Lève la limite « les patients du serveur ne
se lisent pas hors ligne » d'A1 : les fiches que le pull a scellées dans le coffre (`pulled_administrative`) sont lues par les écrans.
Détail : `docs/implementation/vault.md`, « Implémentation (A2) » ; preuve : `docs/evidence/G1.md`.

- **Code** : `Vault.listEntities(type, préfixe)` ; `pulledRecords` et `lastPullAt` (façade du coffre et service `vault`) ; `patientOfPulled`
  et `foldLocalPatients(faits, annuaire)` (`domain/patients/local.ts`) ; `localPatients(portée)` avec annuaire gardé en mémoire
  (`app/services/localPatients.ts`, oublié au verrouillage par `whenVaultLocks`) ; `searchPatients` ouvre l'annuaire serveur injoignable
  seulement ; `getPatient` et l'identité des factures du poste lisent les fiches voulues seulement ; `LocalFact.expectedVersion`.
- **Tests** : 14 cas ajoutés à `tests/frontend/patients/local-patients.test.ts` (rejeu par-dessus la fiche du serveur, modification déjà
  reprise par le pull, fiche créée ici puis reçue, lecture défensive), `tests/frontend/services/local-patients-directory.test.ts`
  (portées, repère, oubli au verrouillage), `patients-local.test.ts` (portée demandée par l'écran, fiche fusionnée jamais proposée),
  `sync.test.ts` (liste par type, identifiants, dernier pull) ; `tests/e2e/offline-directory.spec.ts` : fiche créée EN LIGNE, reçue par le
  pull, puis serveur arrêté : recherche, fiche, modification, facture émise avec l'identité du patient, fermeture complète, synchronisation
  (le serveur connaît la profession et la facture de CE patient, même numéro).
- **Incident de parcours** : un serveur d'aperçu d'une autre session occupait le port dérivé (8130) : les ports e2e se décalent avec
  `EEO_E2E_PORT`.
- **Limites** : couverture de l'annuaire non affichée, factures du serveur (résumés seulement), déchiffrement sans worker ; voir vault.md.
- **Arbitrage** : le demandeur a passé G1 à DONE le 2026-10-30 (écarts 1 et 2 levés ; CI verte : run 41039143341 sur `0ea7668`).
- **À faire ensuite** : afficher la fraîcheur et la couverture de l'annuaire ; « Factures de ce patient » (résumés du pull) ; O06 (mises à jour
  PWA) puis G2.

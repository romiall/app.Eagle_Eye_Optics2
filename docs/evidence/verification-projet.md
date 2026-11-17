# Vérification unique du projet (`tools/dev/tester-projet.sh`)

**État : DERNIÈRE VÉRIFICATION sur `claude/l1-stock-complet` le 2026-11-16 (`340736a`) : verdict `PARTIEL` (aucun échec — 18 étapes exécutables sur 18 réussies en 1 h 37 min ; seule `ci` est `IGNORE` car la branche n’est pas poussée). Précédent jalon sur `main` : verdict `STABLE` le 2026-11-10 (`edad1ed`, 19 étapes sur 19, 1 h 28 min).** Consigne du demandeur (2026-11-10) : un seul script qui rejoue, d'un coup, tous les contrôles qui ont validé les modules et les chantiers livrés ; tant que la branche n’est pas poussée à la demande explicite du demandeur, `ci` reste naturellement `IGNORE`.

Rejouer : `bash tools/dev/tester-projet.sh` (le verdict est la dernière ligne ; `--rapide` sans les parcours navigateur, `--ci` pour un verdict immédiat, `--seulement a,b` pour rejouer une ou deux étapes, `--liste` pour les connaître). Détail du fonctionnement et des limites : `docs/implementation/testing.md`, section « Vérification unique du projet ».

## Ce que le script rejoue (dans une copie propre du commit)

- **Copie propre** : le commit est cloné sans ses fichiers non suivis ni ceux d'une autre session ; `vendor` et `node_modules` sont gardés d'après l'empreinte des verrous (aucune réinstallation inutile). Bases dédiées `eeo_verif_test` et `eeo_verif_e2e_test`, jamais celle de production ni celles d'une autre session.
- **Cohérence du socle** : les six générateurs de contrats et les types TypeScript à jour, les migrations identiques aux scripts SQL de la baseline, le schéma livré équivalent aux migrations (adoption d'une base importée, refus de chaque base divergente, tests de métadonnées et de fumée SQL).
- **Qualité du code** : Pint, PHPStan, `vue-tsc`, ESLint, Prettier, construction de la PWA.
- **Suites de tests** : PHPUnit (MySQL réel pour les verrous et la concurrence), Vitest (règles TypeScript, registre de recette L0 compris), Playwright (111 parcours : coupure et reprise, caisse hors ligne, parcours entre profils, conflits, sécurité financière, usage à quatre tailles d'écran).
- **Sécurité des dépendances et outils** : avis Composer et npm (production), syntaxe de tous les scripts shell et Node suivis par git.
- **En ligne** : contrôle anonyme de `https://app-eagleseye.com` (`tools/deploy/smoke.sh <url> --anonyme`) et comparaison du build servi avec le commit testé : le code déployé doit être celui du commit.
- **CI** : lecture de la CI GitHub du commit (API publique).

## Dernier passage complet — L1+G5, L2+G6, L3+G7 (commit `340736a`, 2026-11-16)

Exécuté via `bash tools/dev/tester-projet.sh --ici --garder-mysql` sur `claude/l1-stock-complet` (`340736a0f70fae1dad0894598947431df647c512`, durée totale `1h37m`) :

- `preparation`, `installation`, `mysql` : OK (dossier courant propre `340736a`, dépendances à jour, bases `eeo_verif_test` et `eeo_verif_e2e_test` sur MySQL 8.4.9 port `3316`) ;
- `contrats`, `baseline`, `schema` : OK en 2 min 06 s cumulés (6 générateurs et types TypeScript à jour, migrations identiques aux scripts SQL, schéma livré = migrations dans `build/schema-parity.json`) ;
- `pint`, `phpstan`, `vue-tsc`, `eslint`, `prettier`, `build` : OK (build Vite + PWA en 10,38 s) ;
- `phpunit` : OK en 22 min 35 s (`Tests: 2700`, `Assertions: 83980`, `Skipped: 1` sous Windows uniquement pour création de lien symbolique dans `SetupAndDemoCommandsTest::test_le_fichier_de_sortie_ne_suit_pas_un_lien_symbolique`, vérifié en CI Linux) ;
- `vitest` : OK en 30 min 35 s (`Test Files 184 passed (184)`, `Tests 3527 passed | 2 skipped (3529)`) ;
- `avis` : OK en 33 s (aucun avis bloquant sur `composer audit --locked --abandoned=report` ni `npm audit --omit=dev --audit-level=high`) ;
- `scripts` : OK en 3 s (`14` scripts shell et Node de syntaxe valide) ;
- `e2e` : OK en 34 min 00 s (`121 passed (33.8m)` sous Edge Windows, `0` échec, `0` flaky) ;
- `en-ligne` : OK en 22 s (la production exécute `3f15ac4` ; `312` fichiers du commit testé restent non déployés, conformément à la consigne de ne pas pousser ni déployer sans demande) ;
- `ci` : `IGNORE` en 2 s (`Aucune exécution de la CI pour ce commit (non poussé ?).` → verdict global `PARTIEL`).

## Résultat du passage de preuve antérieur sur `main` (commit `edad1ed`, 2026-11-10)

- preparation, installation, mysql : OK (copie propre, verrous à jour, deux bases prêtes) ;
- contrats, baseline, schema : OK (6 générateurs, migrations identiques aux scripts SQL, schéma livré = migrations) ;
- pint, phpstan, vue-tsc, eslint, prettier, build : OK ;
- phpunit : OK en 15 min 21 s ; vitest : OK, 166 fichiers, 3 356 tests passés, 1 ignoré ;
- e2e : OK, 111 parcours passés en 47 min 30 s ;
- avis : aucun avis bloquant (Composer, npm de production) ; scripts : 14 scripts shell et Node de syntaxe valide ;
- en-ligne : la production exécute le build `3f15ac4` et son code est strictement celui du commit testé ;
- ci : CI verte du commit (Qualité, run 42833431138).

## Historique des passages (ce que le script a trouvé, et ce qui a été corrigé)

- **Premier passage (`c15de99`, 2 h 07, INSTABLE)** : tout vert sauf deux étapes. (1) `schema` : le script clonait la copie propre sous `%LOCALAPPDATA%` ; l'application Claude de bureau est un paquet MSIX qui y redirige les écritures, et un Python lancé par l'alias du Store ne retrouvait pas les fichiers. Corrigé : la copie vit sous le dossier de l'utilisateur (`%USERPROFILE%\eeo-verification`), jamais sous `%LOCALAPPDATA%`. (2) `e2e` : 9 parcours en échec après une coupure ponctuelle du poste (voir « Incident non expliqué » plus bas) ; les 9 fichiers rejoués seuls passent (9 sur 9), puis la suite entière passe (111 sur 111).
- **Deuxième passage (`aab8c4c`, INSTABLE)** : `e2e` OK en rejouant les parcours ; `ci` OK (run 42827594352) ; `schema` en échec sur « Adoption refusée pour chaque base divergente » : défaut de portabilité de `tools/dev/schema_parity_report.py` (le chemin transmis par le script shell est POSIX, illisible pour un Python Windows, donc le refus n'était pas reconnu). Corrigé en relisant ces sorties par leur nom ; aucun effet sur Linux ni sur la CI.
- **Troisième passage (`edad1ed`, STABLE)** : validation du schéma seul (OK), puis exécution complète : 19 étapes sur 19 (sur `edad1ed`, les deux corrections touchaient l'outil de vérification et son rapport d'équivalence du schéma ; la CI GitHub PHP 8.3, Node 22, MySQL 8.4.9, Chromium est restée verte sur les deux commits poussés).
- **Reprise L1+L2+L3 (`3ee79f3`, `5882b62`, `7eb66c0`, `340736a`, 2026-11-15/16)** :
  - `3ee79f3` (INSTABLE) : défauts relevés dans la matrice `BillingRoutesGateTest`, `tests/frontend/bootstrap.test.ts`, `laravel/framework` remonté en `13.42.0`, et expiration ponctuelle sur `en-ligne`.
  - `5882b62` (INSTABLE) : `avis` en erreur réseau transitoire (`curl error 28` / `npm registry` hors délai le 2026-11-15 soir) et `e2e` en échec (`6 failed`, `2 flaky`) : race entre `quietSync()` automatique et `Synchroniser maintenant` dans `first-slice.spec.ts` en mode `ack-lost` bloquant l’unique caisse hors ligne et faisant chuter les 5 parcours hors ligne suivants en cascade, plus violation strict-mode dans `l2-integrations.spec.ts`.
  - `7eb66c0` (INSTABLE) : `syncDeviceNow()` sérialisé après `quietSync()` (`deviceSync.ts` + `device-sync.test.ts`), nettoyage `retireDevice` ajouté en `finally` (`first-slice`, `offline-sync`, `device-recovery`), compléments `get_public_catalog` / idempotence `/assistant-turn` / tuiles stock d’accueil intégrés : 17/18 étapes exécutables OK et `120/121` Playwright passés (`0` flaky), seul `https-origin.spec.ts:116` en échec après plantage du worker Windows (`3221226505`) ayant laissé un serveur PHP détaché actif sur le port de reprise.
  - `340736a` (PARTIEL — 0 échec) : `startLaravelServer` non détaché sous Windows et allocation de ports libres dans `https-origin.spec.ts` (`laravel-server.ts`, `tls-proxy.ts`, `https-origin.spec.ts`) ; toutes les étapes exécutables passent (`18/18`, dont `121/121` Playwright sans reprise), seule `ci` reste `IGNORE` tant que la branche n’est pas poussée.

## Incident non expliqué (à connaître, pas à cacher)

- Au premier passage, `device-recovery.spec.ts` (« export chiffré et reprise d'un poste sur un poste neuf ») a échoué sur « Serveur injoignable » pendant une trentaine de secondes sans qu'aucune requête n'apparaisse dans le journal du serveur de test (poste local chargé : un écart de la machine, pas un trou de temporisation dans le test). Les parcours qui préparent un poste restent liés à l'unique « caisse hors ligne principale » : un échec en laisse la réservation et les 8 parcours hors ligne suivants échouent en cascade. Rejoués seuls puis dans la suite complète, ils passent. Cause non reproduite : aucune modification du code, pas de reprise automatique ajoutée. Si la cascade se reproduit, rejouer `bash tools/dev/tester-projet.sh --seulement e2e` avant tout diagnostic.

## Limites déclarées

- **Le contrôle de fumée authentifié reste celui du demandeur** : `bash tools/deploy/smoke.sh https://app-eagleseye.com <identifiant>` demande le mot de passe de la gérante à l'invite ; l'agent ne le connaît pas et ne le saisit pas. Le script ne fait que le contrôle anonyme.
- **Hors périmètre d'un script** : l'impression réelle et les appareils du cabinet (U01), les deux opératrices du scénario AT29 (G3), la sauvegarde planifiée sur l'hébergement (mise de côté le 2026-11-10).
- **Plateforme** : le poste Windows du demandeur joue Edge, PHP 8.4 et Node 24 ; la CI (PHP 8.3, Node 22, Chromium, MySQL 8.4.9) reste l'arbitre des versions. Le verdict ne vaut que pour le commit nommé sur sa dernière ligne.
- **API GitHub** : 60 appels par heure et par adresse, partagés avec les autres sessions ; au-delà, l'étape `ci` est ignorée (verdict `PARTIEL`, avec l'heure de remise à zéro) ; `GITHUB_TOKEN`, facultatif, lève la limite.
- **Durée** : 1 à 3 h selon la charge du poste, dont presque tout pour Playwright ; une autre session qui sature le poste allonge les délais (voir la consigne « poste saturé »).

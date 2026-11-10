# Vérification unique du projet (`tools/dev/tester-projet.sh`)

**État : PREUVE FAITE le 2026-11-10 : verdict STABLE, 19 étapes sur 19, 1 h 28 min, sur le commit `edad1ed` (branche `claude/verification-projet`).** Consigne du demandeur (2026-11-10) : un seul script qui rejoue, d'un coup, tous les contrôles qui ont validé les modules et les chantiers livrés ; s'il passe, le projet est stable, on pousse et on n'y revient plus. Lire les fichiers un à un et rejouer des commandes à la main coûtait des jetons sans rien prouver de plus : le script est désormais l'unique façon de vérifier l'ensemble.

Rejouer : `bash tools/dev/tester-projet.sh` (le verdict est la dernière ligne ; `--rapide` sans les parcours navigateur, `--ci` pour un verdict immédiat, `--seulement a,b` pour rejouer une ou deux étapes, `--liste` pour les connaître). Détail du fonctionnement et des limites : `docs/implementation/testing.md`, section « Vérification unique du projet ».

## Ce que le script rejoue (dans une copie propre du commit)

- **Copie propre** : le commit est cloné sans ses fichiers non suivis ni ceux d'une autre session ; `vendor` et `node_modules` sont gardés d'après l'empreinte des verrous (aucune réinstallation inutile). Bases dédiées `eeo_verif_test` et `eeo_verif_e2e_test`, jamais celle de production ni celles d'une autre session.
- **Cohérence du socle** : les six générateurs de contrats et les types TypeScript à jour, les migrations identiques aux scripts SQL de la baseline, le schéma livré équivalent aux migrations (adoption d'une base importée, refus de chaque base divergente, tests de métadonnées et de fumée SQL).
- **Qualité du code** : Pint, PHPStan, `vue-tsc`, ESLint, Prettier, construction de la PWA.
- **Suites de tests** : PHPUnit (MySQL réel pour les verrous et la concurrence), Vitest (règles TypeScript, registre de recette L0 compris), Playwright (111 parcours : coupure et reprise, caisse hors ligne, parcours entre profils, conflits, sécurité financière, usage à quatre tailles d'écran).
- **Sécurité des dépendances et outils** : avis Composer et npm (production), syntaxe de tous les scripts shell et Node suivis par git.
- **En ligne** : contrôle anonyme de `https://app-eagleseye.com` (`tools/deploy/smoke.sh <url> --anonyme`) et comparaison du build servi avec le commit testé : le code déployé doit être celui du commit.
- **CI** : lecture de la CI GitHub du commit (API publique).

## Résultat du passage de preuve (commit `edad1ed`, 2026-11-10)

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
- **Troisième passage (`edad1ed`, STABLE)** : validation du schéma seul (OK), puis exécution complète : 19 étapes sur 19.
- Aucun défaut de l'application n'a été trouvé : les deux corrections touchent l'outil de vérification et son rapport d'équivalence du schéma. La CI GitHub (PHP 8.3, Node 22, MySQL 8.4.9, Chromium) reste verte sur les deux commits poussés.

## Incident non expliqué (à connaître, pas à cacher)

- Au premier passage, `device-recovery.spec.ts` (« export chiffré et reprise d'un poste sur un poste neuf ») a échoué sur « Serveur injoignable » pendant une trentaine de secondes sans qu'aucune requête n'apparaisse dans le journal du serveur de test (poste local chargé : un écart de la machine, pas un trou de temporisation dans le test). Les parcours qui préparent un poste restent liés à l'unique « caisse hors ligne principale » : un échec en laisse la réservation et les 8 parcours hors ligne suivants échouent en cascade. Rejoués seuls puis dans la suite complète, ils passent. Cause non reproduite : aucune modification du code, pas de reprise automatique ajoutée. Si la cascade se reproduit, rejouer `bash tools/dev/tester-projet.sh --seulement e2e` avant tout diagnostic.

## Limites déclarées

- **Le contrôle de fumée authentifié reste celui du demandeur** : `bash tools/deploy/smoke.sh https://app-eagleseye.com <identifiant>` demande le mot de passe de la gérante à l'invite ; l'agent ne le connaît pas et ne le saisit pas. Le script ne fait que le contrôle anonyme.
- **Hors périmètre d'un script** : l'impression réelle et les appareils du cabinet (U01), les deux opératrices du scénario AT29 (G3), la sauvegarde planifiée sur l'hébergement (mise de côté le 2026-11-10).
- **Plateforme** : le poste Windows du demandeur joue Edge, PHP 8.4 et Node 24 ; la CI (PHP 8.3, Node 22, Chromium, MySQL 8.4.9) reste l'arbitre des versions. Le verdict ne vaut que pour le commit nommé sur sa dernière ligne.
- **API GitHub** : 60 appels par heure et par adresse, partagés avec les autres sessions ; au-delà, l'étape `ci` est ignorée (verdict `PARTIEL`, avec l'heure de remise à zéro) ; `GITHUB_TOKEN`, facultatif, lève la limite.
- **Durée** : 1 à 3 h selon la charge du poste, dont presque tout pour Playwright ; une autre session qui sature le poste allonge les délais (voir la consigne « poste saturé »).

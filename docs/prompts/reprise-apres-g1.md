# Prompt de reprise après la session G1 (2026-10-28) — OBSOLÈTE, remplacé par `reprise-apres-g1-ci-verte.md`

À coller dans une NOUVELLE discussion Claude Code ouverte sur le dossier local du projet (poste Windows).

```text
Tu reprends, sur ma machine locale (Claude Code, poste Windows), le développement de l'application Eagle's Eye Optics Medical (cabinet d'optique : patients, consultations, ventes, caisse, stock). Réponds en français. Lis d'abord CLAUDE.md, puis va droit aux fichiers cités ci-dessous : ne relis pas le dépôt.

ÉTAT AU 2026-10-28
- Dépôt de travail : https://github.com/romiall/app.Eagle_Eye_Optics2 (public ; ex-…Optics1, l'ancienne adresse redirige). Remotes : `origin` = ce dépôt ; `ancien` = l'ancien dépôt (ne rien y pousser).
- PR #1 (`claude/parcours-hors-ligne` vers `main`, O05) et PR #2 (`claude/reprise-poste` vers `claude/parcours-hors-ligne`, O07) : ouvertes, CI verte, NON fusionnées à ce jour.
- Chantier G1 : branche `claude/preuve-g1` (empilée sur `claude/reprise-poste`), commits `457a8a6` (code), `d660b98` (test e2e) et un commit de documentation. CI : run 40688437248 en cours à la rédaction. PR vers `main` à ouvrir à la main (gh n'est pas installé) : https://github.com/romiall/app.Eagle_Eye_Optics2/pull/new/claude/preuve-g1
- G1 est prouvé en local sur la tranche de base (acompte 30 000 puis solde 50 000 sans réseau, PDF locaux, fermeture complète, ACK perdu rejoué). Preuves et écarts déclarés : docs/evidence/G1.md ; journal : docs/implementation/progress.md (section G1) ; statut IN_REVIEW dans docs/implementation/task-status.json.
- Mise en ligne Hostinger (H01) : jamais exécutée, archive et procédure prêtes (docs/implementation/deploiement.md). Moi seul agis sur le serveur : je lance `php artisan eeo:preflight` en SSH et je te transmets le résultat. Garder le JIT d'OPcache désactivé.
- Informations de la cliente reçues (docs/implementation/progress.md, « Réponses de la cliente ») : horaires, carnets à zéro, références administratives. Ces dernières sont hors dépôt (fichiers ignorés par git à la racine du dossier) : ne jamais les committer ni les recopier.

À FAIRE EN PREMIER, DANS L'ORDRE
1. `git status`, `git fetch --all --prune`, puis l'état des PR et le run CI de `claude/preuve-g1` par l'API publique (/repos/romiall/app.Eagle_Eye_Optics2/actions/runs?branch=claude/preuve-g1 ; les annotations des jobs en échec se lisent sans compte).
   - CI verte : consigne le numéro de run dans docs/evidence/G1.md (section « Statut CI »), task-status.json (G1) et progress.md.
   - CI rouge : corrige d'après les annotations. Piste connue : device-recovery.spec.ts est intermittent (« Conflits à revoir : 1 », course entre la reprise automatique et le clic de synchronisation) ; il passe seul.
2. Si les PR #1 et #2 sont fusionnées, rattache `claude/preuve-g1` à `main` (rebase ou fusion) après mon accord. Sinon rappelle-moi de les fusionner : #1 avec « Create a merge commit », puis changer la base de #2 vers `main`, puis fusionner #2.
3. Demande-moi d'arbitrer le passage de G1 à DONE (écarts 1 et 2 de G1.md : facture encore émise en ligne puis attribuée au poste ; pas d'écran public de déverrouillage hors ligne).

PROCHAIN CHANTIER
- Si je te donne le résultat du preflight Hostinger : commence par H01 (corrections, test de fumée, restauration réelle).
- Sinon propose-moi, avec une estimation de coût : (a) lever les écarts de G1 (lecture locale des écrans patient et facture hors ligne, voir « Reste à faire après O05 » dans docs/implementation/vault.md ; écran public de déverrouillage D14 et D27), ou (b) O06 (mises à jour PWA et schéma local) puis G2, U01, G3, G4.

RÈGLES
- Données fictives seulement (dépôt public) ; aucun secret ni .env versionné ; originaux Word et PDF jamais modifiés ; tests SQL sur une base eeo_*_test uniquement ; ne jamais lancer `playwright install` ; module `offline` fermé en production jusqu'à G2 ; ne jamais inventer prix, taxes, identité légale ni séries de numéros.
- Une branche `claude/…` par chantier, poussée sur `origin`, une PR vers `main`, CI verte avant de me rendre la main. Demande-moi avant toute action irréversible : fusion de PR, `git push --force`, suppression de branche, action sur le serveur Hostinger.
- Économie de jetons : code une phase entière, puis UNE vérification transversale (bash tools/dev/phase-check.sh --with-e2e, ou les suites séparées) ; ne relis pas tout le dépôt ; si la session devient longue, arrête-toi et rédige un nouveau prompt de reprise dans docs/prompts/.
- Poste Windows (CLAUDE.md, « Travail en local sous Windows ») : MySQL de test par `powershell -ExecutionPolicy Bypass -File tools/dev/mysql-windows.ps1 -Action start` ; chaque appel Bash repart sans variables, donc exporter dans la même commande EEO_TEST_DB_PORT=3316, OPENSSL_CONF='C:\php84\extras\ssl\openssl.cnf' et PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' ; écris les scripts de patch avec l'outil d'écriture de fichiers (les heredocs bash écrasent les barres obliques inverses) ; si les originaux Word et PDF disparaissent après un changement de branche, restaure-les avec `git restore --source=<branche qui les suit> --worktree -- ':(glob)*.docx' ':(glob)*.pdf'`.

À LA FIN
PR ouverte vers `main`, CI verte, puis un résumé court en français (ce qui est prouvé, ce qui reste, ce dont tu as besoin de moi) et un nouveau prompt de reprise enregistré dans docs/prompts/.
```

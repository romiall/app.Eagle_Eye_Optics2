#!/usr/bin/env bash
# Vérification UNIQUE de tout le projet : une commande, un verdict (STABLE, PARTIEL ou INSTABLE).
#
# Rejoue, dans une copie propre du commit testé, TOUS les contrôles qui ont validé les modules livrés : contrats générés,
# baseline et équivalence du schéma SQL, style et analyse PHP, PHPUnit (Unit, Feature, Concurrency, Contracts) sur MySQL
# réel, types, lint, Prettier, Vitest, build, avis de sécurité, syntaxe des scripts, Playwright (tous les parcours),
# puis l'hébergement en ligne (lecture seule, sans identifiant) et la CI GitHub du même commit. Rien n'est relu ni
# relancé à la main : un journal par étape, un résultat par ligne, un extrait seulement pour ce qui échoue.
#
#   bash tools/dev/tester-projet.sh                  TOUT sur le dernier commit (HEAD), en copie propre (1 à 3 h)
#   bash tools/dev/tester-projet.sh --rapide         tout sauf Playwright (quelques dizaines de minutes)
#   bash tools/dev/tester-projet.sh --ci             verdict en une minute : hébergement en ligne + CI GitHub du commit
#   bash tools/dev/tester-projet.sh --seulement a,b  certaines étapes (noms : --liste) ; la préparation suit toute seule
#   bash tools/dev/tester-projet.sh --e2e a,b        Playwright limité à tests/e2e/a.spec.ts, b.spec.ts…
#   bash tools/dev/tester-projet.sh --commit REF     une autre référence git (branche, étiquette, empreinte)
#   bash tools/dev/tester-projet.sh --ici            dans ce dossier, sans copie (arbre propre exigé)
#   bash tools/dev/tester-projet.sh --liste          liste les étapes
#   bash tools/dev/tester-projet.sh --nettoyer       supprime la copie de vérification et s'arrête
#   (--garder-mysql : ne pas arrêter le moteur de test que ce script a démarré)
#
# COPIE PROPRE. Le commit est cloné dans %USERPROFILE%\eeo-verification (Linux : ~/.cache/eeo-verification ;
# EEO_VERIF_DIR pour la changer) : les fichiers non validés du dossier de travail, d'une autre session par exemple, ne
# faussent rien et ne sont pas modifiés. Les dépendances y sont installées d'après les verrous (comme la CI) et gardées
# d'une fois sur l'autre. Bases eeo_verif_test et eeo_verif_e2e_test, port Playwright libre : ni la base ni le serveur
# d'une autre session ne sont touchés. Sous Windows, le moteur MySQL de test (port 3316) est démarré au besoin.
#
# EN LIGNE. Lecture seule et anonyme (tools/deploy/smoke.sh --anonyme) ; le contrôle authentifié (mot de passe de la
# gérante) reste à lancer par le demandeur : l'agent ne connaît ni ne saisit ce mot de passe.
#
# Journaux : storage/framework/testing/verification/<horodatage>/<étape>.log (ignorés par git) ; résumé : dernier.md.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
SRC="$(pwd)"
T0=$SECONDS

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
}

STEPS=(preparation installation mysql contrats baseline schema pint phpstan phpunit vue-tsc eslint prettier vitest build avis scripts e2e en-ligne ci)

describe() {
  case "$1" in
    preparation) echo "copie propre du commit testé" ;;
    installation) echo "composer install et npm ci d'après les verrous (gardés d'une fois sur l'autre)" ;;
    mysql) echo "moteur MySQL de test et bases isolées eeo_*_test" ;;
    contrats) echo "contrats générés à jour (énumérations, commandes, événements, ressources, OpenAPI, vecteurs, types)" ;;
    baseline) echo "migrations identiques aux scripts SQL validés" ;;
    schema) echo "équivalence du schéma SQL livré et des migrations (F04, assertions SQL)" ;;
    pint) echo "style PHP (Pint)" ;;
    phpstan) echo "analyse statique PHP (PHPStan niveau 8 + Larastan)" ;;
    phpunit) echo "PHPUnit : Unit, Feature (MySQL réel), Concurrency, Contracts" ;;
    vue-tsc) echo "TypeScript strict (vue-tsc)" ;;
    eslint) echo "ESLint et règles d'architecture" ;;
    prettier) echo "Prettier" ;;
    vitest) echo "Vitest : règles, domaine, hors ligne, aide, contrats, registre de recette" ;;
    build) echo "build Vite, PWA et service worker" ;;
    avis) echo "avis de sécurité Composer et npm" ;;
    scripts) echo "syntaxe des scripts shell et Node versionnés" ;;
    e2e) echo "Playwright : tous les parcours navigateur (patients, ventes, caisse, stock, agenda, hors ligne, mises à jour…)" ;;
    en-ligne) echo "hébergement en ligne sans identifiant (santé, API isolée, fichiers privés, build) et version déployée" ;;
    ci) echo "CI GitHub du même commit" ;;
  esac
}

# --- Options ------------------------------------------------------------------------------------------------------
RAPIDE=0
ICI=0
REF="HEAD"
ONLY=""
E2E_FILES=""
CLEAN=0
LIST=0
KEEP_MYSQL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rapide) RAPIDE=1 ;;
    --ci) ONLY="en-ligne,ci" ;;
    --ici) ICI=1 ;;
    --commit) shift; REF="${1:-}" ;;
    --seulement) shift; ONLY="${1:-}" ;;
    --e2e) shift; E2E_FILES="${1:-}" ;;
    --liste) LIST=1 ;;
    --nettoyer) CLEAN=1 ;;
    --garder-mysql) KEEP_MYSQL=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

if ((LIST)); then
  for n in "${STEPS[@]}"; do printf '  %-13s %s\n' "$n" "$(describe "$n")"; done
  exit 0
fi

if [[ -n "$ONLY" ]]; then
  IFS=',' read -ra requested <<<"$ONLY"
  for n in "${requested[@]}"; do
    [[ " ${STEPS[*]} " == *" $n "* ]] || { echo "Étape inconnue : $n (voir --liste)" >&2; exit 2; }
  done
fi

# --- Poste --------------------------------------------------------------------------------------------------------
IS_WINDOWS=0
case "$(uname -s 2>/dev/null)" in MINGW* | MSYS* | CYGWIN*) IS_WINDOWS=1 ;; esac
# Windows : jamais sous %LOCALAPPDATA% : l'application Claude de bureau (paquet MSIX) y virtualise les écritures, et un
# Python lancé par l'alias du Store n'y retrouve pas les fichiers (échec constaté le 2026-11-10, schema_parity_report.py).
if ((IS_WINDOWS)); then BASE_DIR="$HOME"; else BASE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}"; fi
WORK="${EEO_VERIF_DIR:-$BASE_DIR/eeo-verification}"
LOCK="$BASE_DIR/eeo-verification.lock"

if ((CLEAN)); then
  rm -rf "$WORK" && echo "Copie de vérification supprimée : $WORK"
  exit 0
fi

if ! SHA="$(git -C "$SRC" rev-parse --verify --quiet "${REF}^{commit}")"; then
  echo "Référence introuvable : ${REF:-(vide)}" >&2
  exit 2
fi
SHORT="$(git -C "$SRC" rev-parse --short "$SHA")"
BRANCH="$(git -C "$SRC" branch --show-current 2>/dev/null)"
[[ "$REF" == "HEAD" ]] || BRANCH="$REF"
DIRTY="$(git -C "$SRC" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if ((ICI)); then
  WORK="$SRC"
  if ((DIRTY > 0)); then
    echo "--ici exige un arbre propre : $DIRTY fichier(s) modifié(s) ou non suivi(s). Valider d'abord, ou retirer --ici (copie propre)." >&2
    exit 2
  fi
fi

# --- Étapes à jouer -----------------------------------------------------------------------------------------------
selected() { # nom : l'étape est-elle demandée ?
  if [[ -n "$ONLY" ]]; then
    [[ ",$ONLY," == *",$1,"* ]]
    return
  fi
  if ((RAPIDE)) && [[ "$1" == "e2e" ]]; then return 1; fi
  return 0
}
any_selected() { local n; for n in "$@"; do selected "$n" && return 0; done; return 1; }

need_work=0
need_install=0
need_mysql=0
any_selected contrats baseline schema pint phpstan phpunit vue-tsc eslint prettier vitest build avis scripts e2e && need_work=1
any_selected contrats schema pint phpstan phpunit vue-tsc eslint prettier vitest build avis e2e && need_install=1
any_selected schema phpunit e2e && need_mysql=1

# --- Environnement ------------------------------------------------------------------------------------------------
export EEO_REQUIRE_MYSQL=1 COMPOSER_NO_INTERACTION=1 NO_COLOR=1 FORCE_COLOR=0
export EEO_TEST_DB_DATABASE="${EEO_VERIF_DB:-eeo_verif_test}"
export EEO_E2E_DB_DATABASE="${EEO_VERIF_E2E_DB:-eeo_verif_e2e_test}"
if ((IS_WINDOWS)); then
  export EEO_TEST_DB_PORT="${EEO_TEST_DB_PORT:-3316}"
  [[ -f /c/php84/extras/ssl/openssl.cnf ]] && export OPENSSL_CONF='C:\php84\extras\ssl\openssl.cnf'
  if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]]; then
    for edge in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
      if [[ -f "$edge" ]]; then
        PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(cygpath -w "$edge")"
        export PLAYWRIGHT_CHROMIUM_EXECUTABLE
        break
      fi
    done
  fi
  [[ -d "/c/Program Files/MySQL/MySQL Server 8.4/bin" ]] && PATH="$PATH:/c/Program Files/MySQL/MySQL Server 8.4/bin"
fi
PY=python3
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import sys' >/dev/null 2>&1; then PY=python; fi

LOGS="$SRC/storage/framework/testing/verification/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOGS" "$BASE_DIR"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Une vérification est déjà en cours ($LOCK). Si ce n'est pas le cas : rmdir \"$LOCK\"" >&2
  exit 2
fi

MYSQL_STARTED=0
MYSQL_OK=0
stop_mysql_if_ours() {
  ((MYSQL_STARTED && !KEEP_MYSQL && IS_WINDOWS)) || return 0
  local others
  others="$(php "$LOGS/outil-bases.php" autres 2>/dev/null)"
  if [[ "${others:-1}" == "0" ]]; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$WORK/tools/dev/mysql-windows.ps1")" -Action stop >/dev/null 2>&1
    echo "Moteur MySQL de test arrêté (il avait été démarré par ce script)."
  else
    echo "Moteur MySQL de test laissé démarré : d'autres connexions l'utilisent."
  fi
  MYSQL_STARTED=0
}
cleanup() {
  stop_mysql_if_ours
  rmdir "$LOCK" 2>/dev/null
  return 0
}
trap cleanup EXIT

# --- Aides --------------------------------------------------------------------------------------------------------
fmt() { # secondes -> 1h02m, 3m05s, 12s
  local s="$1"
  if ((s >= 3600)); then
    printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60))
  elif ((s >= 60)); then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

clean_log() { tr -d '\r' <"$1"; }

digest() { # nom, journal, état : le détail court d'une ligne de résultat
  local name="$1" log="$2" status="$3" line
  line="$(clean_log "$log" | grep -E '^RESUME: ' | tail -n 1 | sed 's/^RESUME: //')"
  if [[ -n "$line" ]]; then
    printf '%s' "$line"
    return 0
  fi
  if [[ "$status" == "IGNORE" ]]; then
    clean_log "$log" | grep -v '^$' | tail -n 1
    return 0
  fi
  case "$name" in
    phpunit) clean_log "$log" | grep -E '^(OK|Tests:)' | tail -n 1 ;;
    vitest) { clean_log "$log" | grep -E '^ +Test Files' | tail -n 1; clean_log "$log" | grep -E '^ +Tests ' | tail -n 1; } | sed 's/^ *//' | paste -sd' ' - ;;
    e2e) clean_log "$log" | grep -E '^ +[0-9]+ (passed|failed|flaky|skipped|did not run)' | sed 's/^ *//' | paste -sd' ' - ;;
    build) clean_log "$log" | grep -E 'built in' | tail -n 1 | sed 's/^[^a-z]*//' ;;
    *) : ;;
  esac
}

failure_extract() { # nom, journal : l'extrait court de ce qui a échoué
  local name="$1" log="$2" out=""
  case "$name" in
    phpunit) out="$({ clean_log "$log" | grep -E '^[0-9]+\) ' | head -n 15; clean_log "$log" | grep -E '^(Tests:|FAILURES!|ERRORS!)' | tail -n 2; } 2>/dev/null)" ;;
    vitest) out="$(clean_log "$log" | grep -E '^ *(FAIL|×) ' | sort -u | head -n 15)" ;;
    e2e) out="$(clean_log "$log" | awk '/^ +[0-9]+ (failed|flaky)/ { p = 1 } /^ +[0-9]+ (passed|skipped|did not run)/ { p = 0 } p' | head -n 25)" ;;
    vue-tsc) out="$(clean_log "$log" | grep -E 'error TS' | head -n 10)" ;;
  esac
  [[ -n "$out" ]] || out="$(clean_log "$log" | grep -v '^$' | tail -n 12)"
  printf '%s\n' "$out"
}

declare -a RES_NAME=() RES_STATUS=() RES_TIME=() RES_DETAIL=()
LAST_STATUS=""

run_step() { # nom : joue l'étape, journalise, n'interrompt jamais la suite
  local name="$1" fn start rc status dur detail log
  fn="step_${name//-/_}"
  log="$LOGS/$name.log"
  start=$SECONDS
  printf '%-13s ' "$name"
  "$fn" >"$log" 2>&1
  rc=$?
  case $rc in
    0) status="OK" ;;
    77) status="IGNORE" ;;
    *) status="ECHEC" ;;
  esac
  dur="$(fmt $((SECONDS - start)))"
  detail="$(digest "$name" "$log" "$status")"
  LAST_STATUS="$status"
  RES_NAME+=("$name")
  RES_STATUS+=("$status")
  RES_TIME+=("$dur")
  RES_DETAIL+=("$detail")
  printf '%-7s %8s  %s\n' "$status" "$dur" "$detail"
  if [[ "$status" == "ECHEC" ]]; then
    failure_extract "$name" "$log" | sed 's/^/      /'
    echo "      journal complet : $log"
  fi
}

write_db_tool() {
  cat >"$LOGS/outil-bases.php" <<'PHP'
<?php
// Outil de tools/dev/tester-projet.sh : crée les bases de test isolées (eeo_*_test) ou compte les autres connexions.
$mode = $argv[1] ?? 'creer';
$host = getenv('EEO_TEST_DB_HOST') ?: '127.0.0.1';
$port = getenv('EEO_TEST_DB_PORT') ?: '3306';
$user = getenv('EEO_TEST_DB_USERNAME') ?: 'eeo_test';
$pass = getenv('EEO_TEST_DB_PASSWORD') ?: 'eeo_test_password';
try {
    $pdo = new PDO("mysql:host=$host;port=$port", $user, $pass, [
        PDO::ATTR_TIMEOUT => 5,
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    if ($mode === 'autres') {
        echo (int) $pdo->query('SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID()')->fetchColumn();
        exit(0);
    }
    foreach (array_slice($argv, 2) as $base) {
        if (! preg_match('/^eeo_[a-z0-9_]*_test$/', $base)) {
            throw new RuntimeException("Nom de base refusé (eeo_*_test seulement) : $base");
        }
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$base` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
        echo "Base de test prête : $base\n";
    }
    echo 'MySQL ', $pdo->query('SELECT VERSION()')->fetchColumn(), " joignable sur $host:$port\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
PHP
}

free_ports() { # un bloc de 20 ports libres consécutifs : le premier est celui du serveur Playwright
  node - <<'JS'
const net = require("net");
const free = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
(async () => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const base = 20000 + Math.floor(Math.random() * 20000);
    let ok = true;
    for (let offset = 0; offset < 20 && ok; offset++) ok = await free(base + offset);
    if (ok) {
      console.log(base);
      return;
    }
  }
  process.exit(1);
})();
JS
}

# --- Étapes (code de sortie : 0 réussi, 77 ignoré avec la raison en dernière ligne, autre = échec) -----------------
step_preparation() {
  if ((ICI)); then
    echo "RESUME: dossier courant testé tel quel ($SHORT, arbre propre)"
    return 0
  fi
  if [[ ! -d "$WORK/.git" ]]; then
    mkdir -p "$(dirname "$WORK")" || return 1
    git clone --quiet --local --no-checkout "$SRC" "$WORK" || return 1
  fi
  git -C "$WORK" fetch --quiet "$SRC" '+refs/*:refs/src/*' '+HEAD:refs/src/HEAD' || return 1
  git -C "$WORK" -c advice.detachedHead=false checkout --quiet --force --detach "$SHA" || return 1
  # Sous Git Bash (MSYS), un argument qui commence par « / » est converti en chemin Windows : sans MSYS_NO_PATHCONV, « -e /vendor »
  # ne protégeait RIEN et vendor/ et node_modules/ étaient effacés à chaque passage, donc réinstallés (604 paquets npm, 116 Composer :
  # 6 à 11 min perdues par passage, constaté le 2026-11-10). La conversion n'est coupée que pour CETTE commande, lancée DANS le dossier
  # (pas de « -C /c/... », qui a besoin d'elle : git.exe ne comprend pas un chemin POSIX). Sans effet sous Linux.
  (cd "$WORK" && MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' git clean -fdxq -e /vendor -e /node_modules) || return 1
  echo "RESUME: copie propre de $SHORT ($WORK)"
}

step_installation() {
  cd "$WORK" || return 1
  if ((ICI)); then
    [[ -d vendor && -d node_modules ]] || { echo "vendor/ ou node_modules/ absent : composer install, npm ci."; return 1; }
    echo "RESUME: dépendances du dossier courant"
    return 0
  fi
  local lock_c lock_n
  lock_c="$(sha256sum composer.lock | cut -d' ' -f1)"
  lock_n="$(sha256sum package-lock.json | cut -d' ' -f1)"
  if [[ -f vendor/.verif-lock && "$(cat vendor/.verif-lock)" == "$lock_c" ]]; then
    echo "Composer : vendor/ déjà installé pour ce verrou."
  else
    composer install --no-interaction --no-progress --no-ansi --prefer-dist || return 1
    printf '%s' "$lock_c" >vendor/.verif-lock
  fi
  if [[ -f node_modules/.verif-lock && "$(cat node_modules/.verif-lock)" == "$lock_n" ]]; then
    echo "npm : node_modules/ déjà installé pour ce verrou."
  else
    npm ci --no-audit --no-fund || return 1
    printf '%s' "$lock_n" >node_modules/.verif-lock
  fi
  echo "RESUME: composer et npm à jour d'après les verrous"
}

step_mysql() {
  cd "$WORK" || return 1
  if ((IS_WINDOWS)); then
    local ps
    ps="$(cygpath -w "$WORK/tools/dev/mysql-windows.ps1")"
    if powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps" -Action status; then
      echo "Moteur de test déjà démarré : réutilisé."
    else
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps" -Action start || return 1
      MYSQL_STARTED=1
    fi
  fi
  php "$LOGS/outil-bases.php" creer "$EEO_TEST_DB_DATABASE" "$EEO_E2E_DB_DATABASE" || return 1
  MYSQL_OK=1
  echo "RESUME: bases $EEO_TEST_DB_DATABASE et $EEO_E2E_DB_DATABASE prêtes"
}

step_contrats() {
  cd "$WORK" || return 1
  local failed=0 generator
  for generator in build_enums build_commands build_events build_resources build_openapi build_vectors; do
    echo "--- $generator"
    "$PY" "contracts/tools/${generator}.py" --check || failed=1
  done
  echo "--- types TypeScript"
  node contracts/tools/generate-types.mjs --check || failed=1
  ((failed == 0)) && echo "RESUME: 6 générateurs et types TypeScript à jour"
  return "$failed"
}

step_baseline() {
  cd "$WORK" || return 1
  "$PY" database/tools/build_migrations.py --check || return 1
  echo "RESUME: migrations identiques aux scripts SQL"
}

step_schema() {
  cd "$WORK" || return 1
  ((MYSQL_OK)) || { echo "MySQL de test indisponible (étape mysql)."; return 77; }
  mkdir -p build
  bash tools/dev/schema-parity.sh --output=build/schema-parity.json || return 1
  echo "RESUME: schéma livré = migrations (rapport build/schema-parity.json)"
}

step_pint() {
  cd "$WORK" || return 1
  vendor/bin/pint --test
}

step_phpstan() {
  cd "$WORK" || return 1
  vendor/bin/phpstan analyse --memory-limit=1G --no-progress
}

step_phpunit() {
  cd "$WORK" || return 1
  ((MYSQL_OK)) || { echo "MySQL de test indisponible (étape mysql)."; return 77; }
  php vendor/bin/phpunit --no-progress
}

step_vue_tsc() {
  cd "$WORK" || return 1
  npm run typecheck
}

step_eslint() {
  cd "$WORK" || return 1
  npm run lint
}

step_prettier() {
  cd "$WORK" || return 1
  npm run format:check
}

step_vitest() {
  cd "$WORK" || return 1
  # Une seule file : le poste local manque de mémoire quand Vitest ouvre un environnement jsdom par cœur.
  npx vitest run --no-file-parallelism
}

step_build() {
  cd "$WORK" || return 1
  npm run build
}

step_avis() {
  cd "$WORK" || return 1
  if ! curl -sS -o /dev/null --max-time 15 https://repo.packagist.org/packages.json; then
    echo "Réseau indisponible : avis de sécurité non consultés."
    return 77
  fi
  local failed=0
  echo "--- composer audit"
  composer audit --locked --abandoned=report --no-ansi || failed=1
  echo "--- npm audit"
  npm audit --omit=dev --audit-level=high || failed=1
  ((failed == 0)) && echo "RESUME: aucun avis bloquant (Composer, npm de production)"
  return "$failed"
}

step_scripts() {
  cd "$WORK" || return 1
  local file count=0 bad=0
  while IFS= read -r file; do
    count=$((count + 1))
    bash -n "$file" || { echo "Syntaxe invalide : $file"; bad=1; }
  done < <(git ls-files '*.sh')
  while IFS= read -r file; do
    count=$((count + 1))
    node --check "$file" || { echo "Syntaxe invalide : $file"; bad=1; }
  done < <(git ls-files '*.mjs')
  ((bad == 0)) && echo "RESUME: $count script(s) shell et Node de syntaxe valide"
  return "$bad"
}

step_e2e() {
  cd "$WORK" || return 1
  ((MYSQL_OK)) || { echo "MySQL de test indisponible (étape mysql)."; return 77; }
  if ((IS_WINDOWS)) && [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]]; then
    echo "Edge introuvable : définir PLAYWRIGHT_CHROMIUM_EXECUTABLE (jamais « playwright install »)."
    return 1
  fi
  [[ -f public/build/build-info.json ]] || npm run build || return 1
  EEO_E2E_PORT="${EEO_E2E_PORT:-$(free_ports)}"
  export EEO_E2E_PORT
  echo "Serveur de test sur le port $EEO_E2E_PORT, base $EEO_E2E_DB_DATABASE"
  local args=() part
  if [[ -n "$E2E_FILES" ]]; then
    IFS=',' read -ra requested <<<"$E2E_FILES"
    for part in "${requested[@]}"; do args+=("tests/e2e/${part%.spec.ts}.spec.ts"); done
  fi
  # Une reprise comme la CI (retries: 1) : un parcours qui ne réussit qu'au second essai est signalé « flaky ».
  # --max-failures borne la durée d'une régression en cascade (la caisse hors ligne principale reste réservée après un échec).
  npx playwright test --retries=1 --max-failures=30 --reporter=list ${args[@]+"${args[@]}"}
  local rc=$?
  if ((rc != 0)) && [[ -f storage/logs/e2e-php-server.log ]]; then
    echo "--- fin du journal du serveur de test"
    tail -n 20 storage/logs/e2e-php-server.log
  fi
  return "$rc"
}

step_en_ligne() {
  cd "$SRC" || return 1
  local url="${EEO_PROD_URL:-https://app-eagleseye.com}" info id changed
  if ! curl -sS -o /dev/null --max-time 20 "$url/up"; then
    echo "Hébergement injoignable depuis ce poste : contrôle non fait."
    return 77
  fi
  bash tools/deploy/smoke.sh "$url" --anonyme || return 1
  info="$(curl -sS --max-time 20 "$url/build/build-info.json")" || return 1
  id="$(printf '%s' "$info" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).id')" || return 1
  if git cat-file -e "${id}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$id" "$SHA" 2>/dev/null; then
    changed="$(git diff --name-only "$id" "$SHA" -- app bootstrap config contracts database public resources routes lang artisan composer.json composer.lock package.json package-lock.json vite.config.ts | wc -l | tr -d ' ')"
    if [[ "$changed" == "0" ]]; then
      echo "RESUME: en ligne $id ; le code déployé est strictement celui du commit testé"
    else
      git diff --name-only "$id" "$SHA" -- app bootstrap config contracts database public resources routes lang artisan composer.json composer.lock package.json package-lock.json vite.config.ts | head -n 10
      echo "RESUME: en ligne $id ; $changed fichier(s) de code du commit testé ne sont pas encore déployés"
    fi
  else
    echo "RESUME: en ligne $id (version non reconnue dans l'historique de ce commit)"
  fi
}

step_ci() {
  cd "$SRC" || return 1
  local remote slug
  remote="$(git remote get-url origin 2>/dev/null)" || { echo "Pas de remote origin."; return 77; }
  remote="${remote%.git}"
  slug="${remote#*github.com[:/]}"
  # API publique : 60 appels par heure et par adresse (partagés avec les autres sessions) ; GITHUB_TOKEN, facultatif, lève la limite.
  local auth=()
  [[ -n "${GITHUB_TOKEN:-${GH_TOKEN:-}}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN:-}}")
  curl -sS --max-time 25 ${auth[@]+"${auth[@]}"} -D "$LOGS/ci.headers" "https://api.github.com/repos/${slug}/actions/runs?head_sha=${SHA}&per_page=10" -o "$LOGS/ci.json" || {
    echo "API GitHub injoignable."
    return 77
  }
  node - "$LOGS/ci.json" "$SHA" "$LOGS/ci.headers" <<'JS'
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (data.message) {
  let quand = "";
  try {
    const trouve = /^x-ratelimit-reset:\s*(\d+)/im.exec(fs.readFileSync(process.argv[4], "utf8"));
    if (trouve) {
      const heure = new Date(Number(trouve[1]) * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      quand = " ; remise à zéro à " + heure + " (relancer alors --ci)";
    }
  } catch (erreur) {
    quand = "";
  }
  console.log("API GitHub : " + String(data.message).split(".")[0] + quand);
  process.exit(77);
}
const runs = (data.workflow_runs || []).filter((run) => run.head_sha === process.argv[3]);
if (runs.length === 0) {
  console.log("Aucune exécution de la CI pour ce commit (non poussé ?).");
  process.exit(77);
}
runs.sort((a, b) => b.id - a.id);
const run = runs[0];
if (run.status !== "completed") {
  console.log("CI en cours : " + run.html_url);
  process.exit(77);
}
if (run.conclusion === "success") {
  console.log("RESUME: CI verte (" + run.name + ", run " + run.id + ")");
  process.exit(0);
}
console.log("RESUME: CI " + run.conclusion + " : " + run.html_url);
process.exit(1);
JS
}

# --- Déroulement --------------------------------------------------------------------------------------------------
printf 'Vérification du projet — commit %s (%s) — %s\n' "$SHORT" "${BRANCH:-détaché}" "$(date '+%Y-%m-%d %H:%M')"
if ((!ICI)); then
  echo "Copie propre : $WORK"
  ((DIRTY > 0)) && echo "Note : $DIRTY fichier(s) non validé(s) de ce dossier ne sont PAS testés (seul le commit l'est)."
fi
echo "Journaux : $LOGS"
if selected e2e; then echo "Playwright joue tous les parcours : compter 1 à 3 h (--rapide pour s'en passer, --ci pour un verdict immédiat)."; fi
echo

write_db_tool
ABORT=0
for name in "${STEPS[@]}"; do
  ((ABORT)) && break
  case "$name" in
    preparation) ((need_work)) || continue ;;
    installation) ((need_install)) || continue ;;
    mysql) ((need_mysql)) || continue ;;
    *) selected "$name" || continue ;;
  esac
  run_step "$name"
  if [[ "$LAST_STATUS" == "ECHEC" && ("$name" == "preparation" || "$name" == "installation") ]]; then ABORT=1; fi
done

# --- Verdict ------------------------------------------------------------------------------------------------------
stop_mysql_if_ours
declare -a FAILS=() SKIPS=() NOTRUN=()
ran=" ${RES_NAME[*]-} "
for i in "${!RES_NAME[@]}"; do
  case "${RES_STATUS[$i]}" in
    ECHEC) FAILS+=("${RES_NAME[$i]}") ;;
    IGNORE) SKIPS+=("${RES_NAME[$i]}") ;;
  esac
done
for n in "${STEPS[@]}"; do
  case "$n" in preparation | installation | mysql) continue ;; esac
  [[ "$ran" == *" $n "* ]] || NOTRUN+=("$n")
done

TOTAL="$(fmt $((SECONDS - T0)))"
RC=0
if ((${#FAILS[@]} > 0)); then
  VERDICT="INSTABLE"
  RC=1
  REASON="en échec : ${FAILS[*]}"
elif ((${#SKIPS[@]} + ${#NOTRUN[@]} > 0)); then
  VERDICT="PARTIEL"
  REASON="aucun échec, mais non vérifié : ${SKIPS[*]-} ${NOTRUN[*]-}"
else
  VERDICT="STABLE"
  REASON="${#RES_NAME[@]} étape(s) sur ${#RES_NAME[@]} réussies"
fi

{
  echo "# Vérification du projet (tools/dev/tester-projet.sh)"
  echo
  echo "- Date : $(date '+%Y-%m-%d %H:%M')"
  echo "- Commit testé : $SHA (${BRANCH:-détaché})"
  echo "- Verdict : $VERDICT ($REASON)"
  echo "- Durée totale : $TOTAL"
  echo
  echo "## Étapes"
  echo
  for i in "${!RES_NAME[@]}"; do
    echo "- ${RES_NAME[$i]} : ${RES_STATUS[$i]} en ${RES_TIME[$i]}${RES_DETAIL[$i]:+ — ${RES_DETAIL[$i]}}"
  done
  if ((${#NOTRUN[@]} > 0)); then
    echo
    echo "Étapes non demandées : ${NOTRUN[*]}"
  fi
} >"$LOGS/resume.md"
cp "$LOGS/resume.md" "$SRC/storage/framework/testing/verification/dernier.md"

echo
echo "Résumé : $LOGS/resume.md (copie : storage/framework/testing/verification/dernier.md)"
if selected en-ligne && [[ "$ran" == *" en-ligne "* ]]; then
  echo "Contrôle authentifié (mot de passe de la gérante, à saisir par le demandeur) : bash tools/deploy/smoke.sh https://app-eagleseye.com <identifiant>"
fi
echo "VERDICT : $VERDICT — $REASON — $TOTAL — commit $SHORT"
exit "$RC"

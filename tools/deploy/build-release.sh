#!/usr/bin/env bash
# Construit l'archive de livraison de l'application, prête à copier sur l'hébergement (SSH).
#
#   tools/deploy/build-release.sh                 archive du commit courant dans release/
#   tools/deploy/build-release.sh --allow-dirty   accepte un arbre de travail modifié (déconseillé)
#   tools/deploy/build-release.sh --skip-build    réutilise public/build/ existant (sinon : npm run build)
#
# Contenu : les fichiers SUIVIS par git du commit courant (code, migrations, vues), moins tout ce qui sert au
# développement (tests, outils, spécifications, documentation, configuration de contrôle), plus vendor/
# installé SANS les dépendances de développement et public/build/ (frontend construit). Ni .env, ni
# node_modules, ni donnée. Une archive .tar.gz, son empreinte SHA-256 et RELEASE.json (commit, date).
#
# Prérequis sur ce poste : git, composer, php, node/npm (sauf --skip-build), tar. Rien de tout cela n'est
# nécessaire sur le serveur : il reçoit l'archive prête.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ROOT="$(pwd)"

ALLOW_DIRTY=0
SKIP_BUILD=0
for argument in "$@"; do
  case "$argument" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : ${argument}" >&2; exit 2 ;;
  esac
done

command -v git >/dev/null || { echo "git est requis." >&2; exit 2; }
command -v composer >/dev/null || { echo "composer est requis." >&2; exit 2; }
command -v tar >/dev/null || { echo "tar est requis." >&2; exit 2; }

if [[ "$ALLOW_DIRTY" == "0" && -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Des fichiers suivis sont modifiés : validez-les (commit) avant de construire une archive de livraison," >&2
  echo "ou utilisez --allow-dirty (les modifications non validées ne sont PAS dans l'archive)." >&2
  exit 1
fi

COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
NAME="eeo-${STAMP}-${SHORT}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "$SKIP_BUILD" == "0" ]]; then
  [[ -d node_modules ]] || { echo "node_modules/ absent : lancer « npm ci »." >&2; exit 2; }
  # L'identifiant (le commit) et la date de construction s'affichent en bas de chaque écran de l'application (O06).
  EEO_BUILD_ID="$SHORT" EEO_BUILD_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run build >/dev/null
fi
[[ -f public/build/manifest.json ]] || { echo "public/build/manifest.json absent : le frontend n'est pas construit." >&2; exit 2; }

echo "Extraction des fichiers du commit ${SHORT}…"
mkdir -p "$WORK/app"
git archive "$COMMIT" | tar -x -C "$WORK/app"

# Hors livraison : développement, contrôle, documentation (voir docs/implementation/build.md).
(
  cd "$WORK/app"
  # Seuls les scripts d'exploitation du serveur restent de tools/ : sauvegarde et exercice de restauration.
  find tools -type f ! -path 'tools/deploy/backup.sh' ! -path 'tools/deploy/restore-check.sh' -delete
  find tools -depth -type d -empty -delete
  rm -rf tests specifications docs .github .spec-work database/tools database/tests \
    resources/frontend contracts/tools contracts/fixtures contracts/vectors
  rm -f package.json package-lock.json vite.config.ts tsconfig.json tsconfig.*.json eslint.config.js \
    vitest.config.ts playwright.config.ts phpstan.neon phpunit.xml pint.json .prettierrc* .prettierignore \
    .editorconfig .npmrc CLAUDE.md README.md *.zip *.docx *.pdf
  # Scripts SQL d'origine et rapports : l'installation passe par les migrations et database/baseline/.
  # schema_catalog.json (dictionnaire des exports, ExportBuilder) et 05_integrity_checks.sql (contrôles de
  # restauration, RestoreVerifier) restent : l'application les lit à l'exécution.
  find database -maxdepth 1 -type f \( -name '*.sql' -o -name '*.md' -o -name '*.json' \) \
    ! -name 'schema_catalog.json' ! -name '05_integrity_checks.sql' -delete
)

echo "Frontend construit…"
mkdir -p "$WORK/app/public"
rm -rf "$WORK/app/public/build"
cp -R public/build "$WORK/app/public/build"

echo "Dépendances PHP sans développement…"
(
  cd "$WORK/app"
  composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist --no-progress >/dev/null
  rm -f auth.json
)

# Arborescence de stockage vide (droits d'écriture à donner au serveur web).
mkdir -p "$WORK/app/storage/framework/cache" "$WORK/app/storage/framework/sessions" \
  "$WORK/app/storage/framework/views" "$WORK/app/storage/logs" "$WORK/app/bootstrap/cache"
rm -f "$WORK/app/bootstrap/cache/"*.php

cat > "$WORK/app/RELEASE.json" <<EOF
{
  "name": "${NAME}",
  "commit": "${COMMIT}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "php_minimum": "8.3",
  "database": "MySQL 8.4 (InnoDB, utf8mb4)"
}
EOF

# Aucun secret ni fichier de configuration locale dans l'archive.
for forbidden in .env .env.e2e auth.json; do
  if [[ -e "$WORK/app/$forbidden" ]]; then echo "Fichier interdit dans l'archive : $forbidden" >&2; exit 1; fi
done
[[ -f "$WORK/app/.env.example" ]] || { echo ".env.example absent de l'archive." >&2; exit 1; }
[[ -f "$WORK/app/vendor/autoload.php" ]] || { echo "vendor/autoload.php absent de l'archive." >&2; exit 1; }
if [[ -d "$WORK/app/vendor/phpunit" ]]; then echo "Une dépendance de développement (phpunit) est dans l'archive." >&2; exit 1; fi
# Fichiers lus à l'exécution par l'application (un oubli ne se voit qu'en production : exports, restauration).
for runtime in database/schema_catalog.json database/05_integrity_checks.sql database/baseline/metadata.json database/baseline/statements.json; do
  [[ -f "$WORK/app/$runtime" ]] || { echo "Fichier d'exécution absent de l'archive : $runtime" >&2; exit 1; }
done
for script in tools/deploy/backup.sh tools/deploy/restore-check.sh; do
  [[ -f "$WORK/app/$script" ]] || { echo "Script d'exploitation absent de l'archive : $script" >&2; exit 1; }
done
if [[ -n "$(find "$WORK/app/tools" -type f ! -name 'backup.sh' ! -name 'restore-check.sh' -print -quit)" ]]; then
  echo "Un outil de développement est resté dans l'archive (tools/)." >&2; exit 1
fi

mkdir -p "$ROOT/release"
ARCHIVE="$ROOT/release/${NAME}.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK/app" .
(cd "$ROOT/release" && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256")

echo
echo "Archive : release/${NAME}.tar.gz ($(du -h "$ARCHIVE" | cut -f1))"
echo "Empreinte : $(cut -d' ' -f1 "$ROOT/release/${NAME}.tar.gz.sha256")"
echo "Suite : docs/implementation/deploiement.md"

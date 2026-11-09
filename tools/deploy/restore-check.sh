#!/usr/bin/env bash
# Exercice de restauration (X03) : restaure une sauvegarde de tools/deploy/backup.sh dans une base MySQL JETABLE,
# déchiffre au besoin (clé EEO_BACKUP_KEY_FILE), vérifie le schéma, puis lance « php artisan eeo:restore:verify » :
# diagnostics d'intégrité, séquences jamais remises à zéro, pièces numérotées, empreintes d'audit, fichiers privés
# restaurés, postes à synchroniser avant réouverture, perte mesurée contre la base vivante, durée constatée. La base
# de production n'est jamais touchée : le script refuse une base cible égale à DB_DATABASE du .env, ou dont le nom ne
# se termine pas par « _restore », « _rest » ou « _test ». Pour consigner l'exercice dans restore_tests, relancer ensuite
# eeo:restore:verify avec --backup-run, --tested-by et --record (docs/runbooks/server-restore.md).
#
#   bash tools/deploy/restore-check.sh <dossier eeo-backup-…> <base jetable> [dossier de l'application]
#
# La base jetable est créée VIDE au préalable (panneau de l'hébergeur), accessible avec les identifiants du .env
# ou, si l'hébergeur donne un utilisateur par base (Hostinger), avec EEO_RESTORE_DB_USERNAME : le mot de passe est
# alors demandé à l'invite (lancer avec ssh -t) et n'apparaît jamais sur la ligne de commande. À faire avant la mise
# en service, puis régulièrement : une sauvegarde jamais restaurée n'est pas une sauvegarde.
set -euo pipefail
umask 077

BACKUP="${1:-}"
TARGET_DB="${2:-}"
APP="${3:-$HOME/eeo}"
APP="${APP%/}"
if [[ -z "$BACKUP" || -z "$TARGET_DB" ]]; then
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi
ENV_FILE="${APP}/.env"
[[ -f "$ENV_FILE" ]] || { echo "Fichier ${ENV_FILE} introuvable." >&2; exit 2; }
DUMP="${BACKUP}/database.sql.gz"; [[ -f "${DUMP}.enc" ]] && DUMP="${DUMP}.enc"
[[ -f "$DUMP" ]] || { echo "${BACKUP}/database.sql.gz(.enc) introuvable." >&2; exit 2; }
command -v mysql >/dev/null || { echo "Le client mysql est introuvable." >&2; exit 2; }

env_value() {
  local line value
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

KEY_FILE="${EEO_BACKUP_KEY_FILE:-$(env_value EEO_BACKUP_KEY_FILE)}"; KEY_FILE="${KEY_FILE/#\~/$HOME}"
if [[ "$DUMP" == *.enc ]]; then
  command -v openssl >/dev/null || { echo "openssl est introuvable : déchiffrement impossible." >&2; exit 2; }
  [[ -n "$KEY_FILE" && -r "$KEY_FILE" ]] || { echo "Sauvegarde chiffrée : indiquez la clé (EEO_BACKUP_KEY_FILE)." >&2; exit 2; }
fi
# Lecture d'une partie de la sauvegarde sur la sortie standard, déchiffrée si elle l'est.
read_part() {
  if [[ "$1" == *.enc ]]; then
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -pass "file:${KEY_FILE}"
  else
    cat "$1"
  fi
}

PRODUCTION_DB="$(env_value DB_DATABASE)"
if [[ "$TARGET_DB" == "$PRODUCTION_DB" ]]; then
  echo "Refus : la base cible est la base de l'application (${PRODUCTION_DB}). Utilisez une base jetable." >&2
  exit 2
fi
if [[ ! "$TARGET_DB" =~ ^[A-Za-z0-9_]+_(restore|rest|test)$ ]]; then
  echo "Refus : le nom de la base jetable doit se terminer par _restore, _rest ou _test (reçu ${TARGET_DB})." >&2
  exit 2
fi

case "${EEO_RESTORE_SCHEMA_CHECK:-auto}" in
  auto | baseline | counts) ;;
  *) echo "EEO_RESTORE_SCHEMA_CHECK doit valoir auto, baseline ou counts." >&2; exit 2 ;;
esac
echo "Empreintes de la sauvegarde…"
(cd "$BACKUP" && sha256sum -c SHA256SUMS)

DB_HOST="$(env_value DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(env_value DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
# Utilisateur propre à la base jetable (un utilisateur par base chez Hostinger) : son mot de passe est demandé à
# l'invite, sans s'afficher, et n'est jamais passé en argument.
RESTORE_USER="${EEO_RESTORE_DB_USERNAME:-}"
RESTORE_PASSWORD="${EEO_RESTORE_DB_PASSWORD:-}"
if [[ -n "$RESTORE_USER" && -z "$RESTORE_PASSWORD" ]]; then
  [[ -t 0 ]] || { echo "EEO_RESTORE_DB_USERNAME est défini sans mot de passe : lancer dans un terminal (ssh -t) pour le saisir." >&2; exit 2; }
  read -r -s -p "Mot de passe de ${RESTORE_USER} (utilisateur de la base jetable) : " RESTORE_PASSWORD
  echo
fi
DB_USERNAME="${RESTORE_USER:-$(env_value DB_USERNAME)}"
DB_PASSWORD="${RESTORE_PASSWORD:-$(env_value DB_PASSWORD)}"
# Début de la mesure de durée : APRÈS la saisie du mot de passe (le temps de frappe n'entre pas dans la durée constatée).
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SECONDS=0

OPTIONS="$(mktemp)"
FILES_DIR="$(mktemp -d)"
trap 'rm -f "$OPTIONS"; rm -rf "$FILES_DIR"' EXIT
chmod 600 "$OPTIONS"
chmod 700 "$FILES_DIR"
{
  echo '[client]'
  echo "host=${DB_HOST}"
  echo "port=${DB_PORT}"
  echo "user=${DB_USERNAME}"
  escaped="${DB_PASSWORD//\\/\\\\}"
  printf 'password="%s"\n' "${escaped//\"/\\\"}"
} > "$OPTIONS"

existing="$(mysql --defaults-extra-file="$OPTIONS" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${TARGET_DB}'")"
if [[ "$existing" != "0" ]]; then
  echo "Refus : la base ${TARGET_DB} n'est pas vide (${existing} tables). Videz-la ou créez-en une neuve." >&2
  exit 2
fi

echo "Restauration dans ${TARGET_DB}…"
# Utilisateur propre à la base jetable : les déclencheurs et les vues du dump ont pour DEFINER l'utilisateur de l'application, que le
# serveur refuse à un autre utilisateur sans SUPER (erreur 1227 : 6 tables restaurées sur 124 à l'essai local du 2026-11-09). Ils sont
# recréés au nom de l'utilisateur de la base jetable. Sans utilisateur propre (même utilisateur que l'application), le dump passe tel quel.
strip_definers() {
  if [[ -n "$RESTORE_USER" ]]; then
    sed -E "s/DEFINER[[:space:]]*=[[:space:]]*(\`[^\`]+\`|'[^']+'|[A-Za-z0-9_]+)@(\`[^\`]+\`|'[^']+'|[A-Za-z0-9_.%-]+)//g"
  else
    cat
  fi
}
read_part "$DUMP" | gzip -dc | strip_definers | mysql --defaults-extra-file="$OPTIONS" --default-character-set=utf8mb4 "$TARGET_DB"
echo "  base chargée : ${SECONDS} s depuis le début de la mesure"

ARCHIVE="${BACKUP}/storage-app.tar.gz"; [[ -f "${ARCHIVE}.enc" ]] && ARCHIVE="${ARCHIVE}.enc"
if [[ -f "$ARCHIVE" ]]; then
  echo "Fichiers privés restaurés dans un dossier temporaire…"
  read_part "$ARCHIVE" | tar -xzf - -C "$FILES_DIR"
fi

# Comparaison à la baseline : `eagle:verify-schema` lit des colonnes d'information_schema propres à MySQL 8 (srs_id, is_visible, expression) et
# échoue sur MariaDB (Hostinger : erreur 1054, constatée le 2026-11-09). Sur MariaDB, on compte les objets restaurés et on les rapproche de la baseline
# (les 117 tables métier sont contrôlées par eeo:restore:verify, SCHEMA_TABLES). EEO_RESTORE_SCHEMA_CHECK : auto (défaut), baseline ou counts.
SERVER_VERSION="$(mysql --defaults-extra-file="$OPTIONS" -N -B -e 'SELECT VERSION()')"
case "${EEO_RESTORE_SCHEMA_CHECK:-auto}" in
  baseline) SCHEMA_MODE=baseline ;;
  counts) SCHEMA_MODE=counts ;;
  auto) if [[ "$SERVER_VERSION" == *MariaDB* ]]; then SCHEMA_MODE=counts; else SCHEMA_MODE=baseline; fi ;;
  *) echo "EEO_RESTORE_SCHEMA_CHECK doit valoir auto, baseline ou counts." >&2; exit 2 ;;
esac
if [[ "$SCHEMA_MODE" == "baseline" ]]; then
  echo "Vérification du schéma (baseline complète)…"
  # Configuration relue sans le cache de production, base cible substituée : la base de l'application n'est pas lue.
  (cd "$APP" && APP_CONFIG_CACHE="$(mktemp -u)" DB_DATABASE="$TARGET_DB" DB_USERNAME="$DB_USERNAME" DB_PASSWORD="$DB_PASSWORD" \
    php artisan eagle:verify-schema)
else
  echo "Vérification du schéma : comparaison à la baseline MySQL 8 non faite sur ${SERVER_VERSION} ; objets restaurés rapprochés de la baseline :"
  EXPECTED="$(cd "$APP" && "${EEO_PHP_BIN:-php}" -r '$s = json_decode(file_get_contents("database/baseline/metadata.json"), true)["snapshot"]; echo count($s["tables"]), " ", count($s["views"]), " ", count($s["triggers"]);' 2>/dev/null || true)"
  read -r EXPECTED_TABLES EXPECTED_VIEWS EXPECTED_TRIGGERS <<< "${EXPECTED:-? ? ?}"
  FOUND="$(mysql --defaults-extra-file="$OPTIONS" -N -B -e "SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${TARGET_DB}' AND table_type = 'BASE TABLE'), (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = '${TARGET_DB}'), (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = '${TARGET_DB}')")"
  read -r FOUND_TABLES FOUND_VIEWS FOUND_TRIGGERS <<< "$FOUND"
  printf '  %-14s %-9s %s\n' "objets" "restaurés" "baseline"
  printf '  %-14s %-9s %s\n' "tables" "$FOUND_TABLES" "${EXPECTED_TABLES} métier + les tables techniques du framework"
  printf '  %-14s %-9s %s\n' "vues" "$FOUND_VIEWS" "$EXPECTED_VIEWS"
  printf '  %-14s %-9s %s\n' "déclencheurs" "$FOUND_TRIGGERS" "$EXPECTED_TRIGGERS"
  if [[ "$EXPECTED_VIEWS" != "?" && ( "$FOUND_VIEWS" != "$EXPECTED_VIEWS" || "$FOUND_TRIGGERS" != "$EXPECTED_TRIGGERS" ) ]]; then
    echo "  ÉCART : vues ou déclencheurs différents de la baseline." >&2
  fi
fi

echo "Comptes de quelques tables restaurées :"
for table in clinics users patient_records visits consultations invoices payments receipts audit_events; do
  count="$(mysql --defaults-extra-file="$OPTIONS" -N -B -e "SELECT COUNT(*) FROM \`${TARGET_DB}\`.\`${table}\`" 2>/dev/null || echo '?')"
  printf '  %-18s %s\n' "$table" "$count"
done

echo
echo "Contrôles de la base restaurée (eeo:restore:verify)…"
VERIFY_FILES=()
[[ -d "${FILES_DIR}/app/private" ]] && VERIFY_FILES=(--files="${FILES_DIR}/app/private")
status=0
# Cache de configuration contourné : les identifiants de la base jetable se lisent dans l'environnement, au lancement.
(cd "$APP" && APP_CONFIG_CACHE="$(mktemp -u)" EEO_RESTORE_DB_USERNAME="$RESTORE_USER" EEO_RESTORE_DB_PASSWORD="$RESTORE_PASSWORD" \
  "${EEO_PHP_BIN:-php}" artisan eeo:restore:verify "$TARGET_DB" ${VERIFY_FILES[@]+"${VERIFY_FILES[@]}"} --started-at="$STARTED_AT") || status=$?

echo
if [[ "$status" -eq 0 ]]; then
  echo "Restauration vérifiée dans ${TARGET_DB}. Consignez l'exercice (--record), puis supprimez cette base jetable."
else
  echo "Des contrôles ont échoué (voir ci-dessus) : ne vous fiez pas à cette sauvegarde avant d'avoir compris l'écart." >&2
  exit "$status"
fi

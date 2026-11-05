#!/usr/bin/env bash
# Déploie ou met à jour l'application sur l'hébergement Hostinger (https://app-eagleseye.com).
#
#   bash tools/deploy/deploy-hostinger.sh                 construit l'archive du commit courant et la met en ligne
#   bash tools/deploy/deploy-hostinger.sh --skip-build    réutilise public/build/ existant
#   bash tools/deploy/deploy-hostinger.sh --allow-dirty   accepte un arbre de travail modifié (déconseillé)
#
# Prérequis sur le poste local :
# - Accès SSH sans mot de passe déjà configuré dans ~/.ssh/config (alias « eagleseye » ou « scei » :
#   hôte 145.79.20.169, port 65002, utilisateur u720123645, clé ~/.ssh/scei_hostinger_deploy).
# - Sur le serveur : ~/eeo/.env est déjà en place (copié automatiquement vers la nouvelle release).
#   Aucun secret ni mot de passe ne figure dans ce script ni dans le dépôt.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ROOT="$(pwd)"

SSH_TARGET="${EEO_SSH_TARGET:-eagleseye}"
APP_URL="${EEO_DEPLOY_URL:-https://app-eagleseye.com}"
DOMAIN_PUBLIC_HTML="~/domains/app-eagleseye.com/public_html"

echo "==> 1/5 Construction de l'archive de livraison…"
BUILD_OUT="$(bash tools/deploy/build-release.sh "$@")"
echo "$BUILD_OUT"
ARCHIVE_REL="$(echo "$BUILD_OUT" | sed -n 's/^Archive : \(release\/eeo-[^ ]*\.tar\.gz\).*/\1/p' | tail -n 1)"

if [[ -z "$ARCHIVE_REL" || ! -f "$ROOT/$ARCHIVE_REL" ]]; then
  echo "Impossible de déterminer l'archive construite." >&2
  exit 1
fi

ARCHIVE_FILE="$(basename "$ARCHIVE_REL")"
RELEASE_NAME="${ARCHIVE_FILE%.tar.gz}"
SHA_REL="${ARCHIVE_REL}.sha256"

echo "==> 2/5 Envoi de ${ARCHIVE_FILE} vers ${SSH_TARGET}…"
scp -o BatchMode=yes "$ROOT/$ARCHIVE_REL" "$ROOT/$SHA_REL" "${SSH_TARGET}:~/"

echo "==> 3/5 Sauvegarde préalable et installation de ${RELEASE_NAME} sur le serveur…"
ssh -o BatchMode=yes "$SSH_TARGET" "tr -d '\r' | bash -s -- '$RELEASE_NAME'" <<'REMOTE_SCRIPT'
set -euo pipefail
RELEASE_NAME="$1"
ARCHIVE_FILE="${RELEASE_NAME}.tar.gz"
SHA_FILE="${ARCHIVE_FILE}.sha256"

if [[ -d "$HOME/eeo" && -f "$HOME/eeo/.env" && -f "$HOME/eeo/tools/deploy/backup.sh" ]]; then
  bash "$HOME/eeo/tools/deploy/backup.sh" "$HOME/eeo"
fi

cd "$HOME"
sha256sum -c "$SHA_FILE"
mkdir -p "$HOME/eeo-releases/$RELEASE_NAME"
tar -xzf "$ARCHIVE_FILE" -C "$HOME/eeo-releases/$RELEASE_NAME"
rm -f "$HOME/$ARCHIVE_FILE" "$HOME/$SHA_FILE"

if [[ ! -f "$HOME/eeo/.env" ]]; then
  echo "Erreur : ~/eeo/.env introuvable sur le serveur." >&2
  exit 1
fi

cp "$HOME/eeo/.env" "$HOME/eeo-releases/$RELEASE_NAME/.env"
chmod 600 "$HOME/eeo-releases/$RELEASE_NAME/.env"
chmod -R u+rwX "$HOME/eeo-releases/$RELEASE_NAME/storage" "$HOME/eeo-releases/$RELEASE_NAME/bootstrap/cache"

cd "$HOME/eeo-releases/$RELEASE_NAME"
php artisan eeo:preflight
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache

ln -sfn "$HOME/eeo-releases/$RELEASE_NAME" "$HOME/eeo"
if [[ ! -L "$HOME/domains/app-eagleseye.com/public_html" ]]; then
  rm -rf "$HOME/domains/app-eagleseye.com/public_html"
  ln -sfn "$HOME/eeo/public" "$HOME/domains/app-eagleseye.com/public_html"
fi

echo "Release active : $(readlink -f "$HOME/eeo")"
REMOTE_SCRIPT

echo "==> 4/5 Vérification HTTP de ${APP_URL}/up…"
UP_BODY="$(curl -fsS "${APP_URL}/up")"
if [[ "$UP_BODY" != *'"status":"ok"'* ]]; then
  echo "Réponse inattendue de ${APP_URL}/up : ${UP_BODY}" >&2
  exit 1
fi
echo "  OK      ${APP_URL}/up -> ${UP_BODY}"

if [[ -n "${EEO_SMOKE_PASSWORD:-}" ]]; then
  echo "==> 5/5 Contrôle de fumée complet (smoke.sh)…"
  bash tools/deploy/smoke.sh "$APP_URL" "${EEO_SMOKE_LOGIN:-gerante}"
else
  echo "==> 5/5 Déploiement terminé (${RELEASE_NAME} en ligne sur ${APP_URL})."
  echo "    Pour le contrôle de fumée authentifié : EEO_SMOKE_PASSWORD='<mot-de-passe>' bash tools/deploy/smoke.sh ${APP_URL} gerante"
fi

#!/usr/bin/env bash
# Contrôle de fumée d'une installation, en lecture seule par défaut : à lancer depuis un poste après la mise en
# service (ou sur le serveur). Il vérifie le site, le contrôle de santé, l'isolation de l'API, le build du
# frontend, puis une connexion réelle et des lectures.
#
#   EEO_SMOKE_PASSWORD='…' tools/deploy/smoke.sh https://app.exemple.cm gerante.login
#   tools/deploy/smoke.sh https://app.exemple.cm gerante.login        (le mot de passe est demandé)
#   tools/deploy/smoke.sh http://127.0.0.1:8000 gerante.login --insecure-local   (essai local sans HTTPS)
#
# Le mot de passe n'est jamais passé en argument de ligne de commande. Aucune donnée n'est créée.
set -euo pipefail

BASE="${1:-}"
LOGIN="${2:-}"
LOCAL=0
[[ "${3:-}" == "--insecure-local" ]] && LOCAL=1
if [[ -z "$BASE" || -z "$LOGIN" ]]; then
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi
BASE="${BASE%/}"
if [[ "$LOCAL" == "0" && "$BASE" != https://* ]]; then
  echo "L'adresse doit commencer par https:// (HTTPS est obligatoire en production)." >&2
  exit 2
fi
if [[ -z "${EEO_SMOKE_PASSWORD:-}" ]]; then
  read -r -s -p "Mot de passe de ${LOGIN} : " EEO_SMOKE_PASSWORD
  echo
fi

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
FAILURES=0

check() { # libellé, condition (0 = réussi), détail
  if [[ "$2" == "0" ]]; then echo "  OK      $1"; else echo "  ÉCHEC   $1 $3"; FAILURES=$((FAILURES + 1)); fi
}

http_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }

echo "Contrôle de ${BASE}"

code="$(http_code "${BASE}/up")"
check "GET /up répond 200" "$([[ "$code" == "200" ]] && echo 0 || echo 1)" "(reçu ${code})"

body="$(curl -sS --max-time 30 "${BASE}/up")"
check "/up rend {\"status\":\"ok\"}" "$([[ "$body" == '{"status":"ok"}' ]] && echo 0 || echo 1)" "(reçu ${body})"

code="$(http_code -H 'Accept: application/json' "${BASE}/api/v1/inconnu")"
check "API inconnue : 404 JSON, jamais la page HTML" "$([[ "$code" == "404" ]] && echo 0 || echo 1)" "(reçu ${code})"

home="$(curl -sS --max-time 30 "${BASE}/")"
assets="$(printf '%s' "$home" | grep -Eo '(src|href)="[^"]*/build/[^"]*"' || true)"
bad="$(printf '%s' "$assets" | grep -Ev '="/build/' || true)"
check "La page d'accueil référence des fichiers /build/ locaux" "$([[ -n "$assets" && -z "$bad" ]] && echo 0 || echo 1)" "(vérifier le build et APP_URL)"

first_asset="$(printf '%s' "$assets" | grep -Eo '/build/assets/[^"]*\.js' | head -n 1 || true)"
if [[ -n "$first_asset" ]]; then
  code="$(http_code "${BASE}${first_asset}")"
  check "Le script de l'application est servi (${first_asset})" "$([[ "$code" == "200" ]] && echo 0 || echo 1)" "(reçu ${code})"
fi

code="$(http_code "${BASE}/sw.js")"
check "Le service worker /sw.js est servi" "$([[ "$code" == "200" ]] && echo 0 || echo 1)" "(reçu ${code})"

code="$(http_code "${BASE}/build/build-info.json")"
check "L'identité du build /build/build-info.json est servie" "$([[ "$code" == "200" ]] && echo 0 || echo 1)" "(reçu ${code})"

# Les fichiers de configuration ne doivent jamais être servis. La coquille de l'application répond 200 à une
# adresse inconnue : on contrôle donc le CONTENU (signature du fichier), pas seulement le code de réponse.
check_not_served() { # chemin, expression de signature
  local page
  page="$(curl -sS --max-time 30 "${BASE}$1" || true)"
  if printf '%s' "$page" | grep -Eq "$2"; then
    check "$1 n'est pas servi" 1 "(contenu exposé : la racine web doit être le dossier public/)"
  else
    check "$1 n'est pas servi" 0 ""
  fi
}
check_not_served /.env 'APP_KEY|DB_PASSWORD|APP_ENV='
check_not_served /.git/config '\[core\]|\[remote '
check_not_served /composer.json '"require"'
check_not_served /artisan '<\?php|Illuminate'
check_not_served /storage/logs/laravel.log 'Stack trace|production\.(ERROR|WARNING)'
check_not_served /RELEASE.json '"commit"'

code="$(http_code -H 'Accept: application/json' "${BASE}/api/v1/auth/me")"
check "Sans connexion, /api/v1/auth/me répond 401" "$([[ "$code" == "401" ]] && echo 0 || echo 1)" "(reçu ${code})"

# Connexion réelle (cookie de session + jeton CSRF), comme l'application.
curl -sS --max-time 30 -c "$JAR" -o /dev/null "${BASE}/api/sanctum/csrf-cookie"
xsrf="$(grep -E 'XSRF-TOKEN' "$JAR" | awk '{print $7}' | head -n 1 | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))' 2>/dev/null || true)"
if [[ -z "$xsrf" ]]; then
  xsrf="$(grep -E 'XSRF-TOKEN' "$JAR" | awk '{print $7}' | head -n 1 | sed 's/%3D/=/g; s/%2B/+/g; s/%2F/\//g')"
fi
check "Le jeton CSRF est émis" "$([[ -n "$xsrf" ]] && echo 0 || echo 1)" "(vérifier SESSION_*, SANCTUM_STATEFUL_DOMAINS)"

payload="$(printf '{"login":"%s","password":"%s"}' "$LOGIN" "$EEO_SMOKE_PASSWORD")"
login_code="$(curl -sS --max-time 30 -b "$JAR" -c "$JAR" -o /dev/null -w '%{http_code}' \
  -H 'Accept: application/json' -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: ${xsrf}" \
  -H "Origin: ${BASE}" -H "Referer: ${BASE}/" --data "$payload" "${BASE}/api/v1/auth/login")"
check "Connexion de ${LOGIN}" "$([[ "$login_code" == "200" ]] && echo 0 || echo 1)" "(reçu ${login_code} : identifiants, SANCTUM_STATEFUL_DOMAINS et cookie Secure)"

if [[ "$login_code" == "200" ]]; then
  me="$(curl -sS --max-time 30 -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}/api/v1/auth/me")"
  check "Le compte connecté est relu (/auth/me)" "$([[ "$me" == *'"permissions"'* ]] && echo 0 || echo 1)" ""
  modules="$(printf '%s' "$me" | grep -Eo '"enabled_modules":\[[^]]*\]' || true)"
  echo "  info    modules ouverts : ${modules:-aucun champ}"

  code="$(http_code -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}/api/v1/patients?query=zz")"
  case "$code" in
    200) check "Recherche de patients (module ouvert)" 0 "" ;;
    404) echo "  info    module « patients » fermé (404) : normal tant qu'il n'est pas ouvert" ;;
    *) check "Recherche de patients" 1 "(reçu ${code})" ;;
  esac

  code="$(http_code -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}/api/v1/visits")"
  case "$code" in
    200) check "File du jour (module ouvert)" 0 "" ;;
    404) echo "  info    module « today » fermé (404) : normal tant qu'il n'est pas ouvert" ;;
    *) check "File du jour" 1 "(reçu ${code})" ;;
  esac

  # Lectures des modules de la phase 1 (aucune écriture) : 200 module ouvert, 404 module fermé, 403 droit absent
  # pour ce compte (normal pour un compte qui n'est pas gérante).
  read_check() { # libellé, chemin, module
    local status
    status="$(http_code -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}$2")"
    case "$status" in
      200) check "$1 (module ouvert)" 0 "" ;;
      404) echo "  info    module « $3 » fermé (404) : normal tant qu'il n'est pas ouvert" ;;
      403) echo "  info    $1 : ce compte n'a pas le droit de lecture (403)" ;;
      *) check "$1" 1 "(reçu ${status})" ;;
    esac
  }
  read_check "Liste des examens" "/api/v1/consultations" consultations
  read_check "Échelles d'acuité" "/api/v1/visual-acuity-scales" consultations
  read_check "Factures" "/api/v1/invoices" sales
  read_check "Caisse principale" "/api/v1/cash-registers" sales
  read_check "Disponibilités du stock" "/api/v1/stock/availability" stock

  code="$(http_code -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}/api/v1/staff")"
  case "$code" in
    200) check "Personnel du cabinet (gérante)" 0 "" ;;
    403) echo "  info    personnel : réservé à la gérante (403 pour ce compte)" ;;
    *) check "Personnel du cabinet" 1 "(reçu ${code})" ;;
  esac
  code="$(http_code -b "$JAR" -H 'Accept: application/json' -H "Referer: ${BASE}/" "${BASE}/api/v1/clinic/document-identity")"
  case "$code" in
    200) check "Identité du cabinet pour les documents" 0 "" ;;
    403) echo "  info    identité des documents : ce compte ne produit aucun document (403)" ;;
    *) check "Identité du cabinet pour les documents" 1 "(reçu ${code})" ;;
  esac

  curl -sS --max-time 30 -b "$JAR" -c "$JAR" -o /dev/null -H 'Accept: application/json' -H "X-XSRF-TOKEN: ${xsrf}" \
    -H "Origin: ${BASE}" -H "Referer: ${BASE}/" -X POST "${BASE}/api/v1/auth/logout" || true
fi

echo
if [[ "$FAILURES" == "0" ]]; then echo "Contrôle de fumée réussi."; else echo "${FAILURES} contrôle(s) en échec."; exit 1; fi

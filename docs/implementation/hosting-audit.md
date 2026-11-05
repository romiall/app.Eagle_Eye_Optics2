# Audit d'hébergement (Q01) — vérifié sur Hostinger (`app-eagleseye.com`)

Statut : **RÉALISÉ et VALIDÉ en production le 2026-10-27** sur `https://app-eagleseye.com` (`php artisan eeo:preflight` : 0 point bloquant, `tools/deploy/smoke.sh` : 100 % réussi).

## Outil de diagnostic

Les points 2, 3, 6, 7, 8 et 13 à 18 ont été vérifiés **sur le serveur** par `php artisan eeo:preflight` : version de PHP, extensions, réglages, droits d'écriture, version et droits de base réels (création d'une table avec CHECK, d'une clé étrangère, d'une colonne générée, d'une vue et d'un **trigger exécuté**). Procédure complète et script de déploiement en 1 commande (`bash tools/deploy/deploy-hostinger.sh`) : `deploiement.md`.

## Relevé du serveur de production (`app-eagleseye.com`)

| # | Point | Exigence du projet | Réponse constatée sur Hostinger (2026-10-27) |
| --- | --- | --- | --- |
| 1 | Offre / fournisseur / formule | Web simple, **pas de VPS** (D05) | Hostinger mutualisé (LiteSpeed, hPanel), sans VPS |
| 2 | Version PHP | 8.3 minimum (Laravel 13) ; 8.4 cible | PHP 8.3.36 (cli et web, 64 bits, OPcache actif) ; `/opt/alt/php84` également présent |
| 3 | Extensions PHP | pdo_mysql, mbstring, openssl, sodium, intl, zip, fileinfo, tokenizer, xml, curl, ctype | 16/16 extensions requises présentes (`curl`, `zip` présentes ; `sodium` en alerte non bloquante) |
| 4 | Accès SSH / CLI | Sinon : installation par procédure locale sécurisée (23) | Actif : `145.79.20.169`, port `65002`, compte `u720123645` (alias SSH `eagleseye` / `scei` sur le poste local) |
| 5 | Composer sur le serveur | Sinon : déployer `vendor/` construit en CI | Non requis : `vendor/` construit par `build-release.sh` dans l'archive |
| 6 | Base de données | MySQL 8.4 visé ; InnoDB, utf8mb4, `utf8mb4_0900_ai_ci`, CHECK, triggers | `11.8.9-MariaDB-log`, InnoDB par défaut, support natif de `utf8mb4_0900_ai_ci`, CHECK, colonnes générées et 88 triggers (`PreflightChecks` et `BaselineInstaller` adaptés pour MariaDB ≥ 11.4) |
| 7 | Droits base | CREATE, ALTER, INDEX, REFERENCES, CREATE VIEW, **TRIGGER**, DROP (migrations) ; pas de SUPER requis | Tous accordés et vérifiés par `eeo:preflight` (117 tables, 464 FK, 484 CHECK, 10 vues, 88 triggers créés et testés) |
| 8 | `log_bin_trust_function_creators` / binlog | Peut bloquer la création des 88 triggers sans SUPER | `log_bin` inactif sur l'instance : création et exécution des 88 triggers autorisées sans SUPER |
| 9 | Domaine HTTPS | Certificat valide | `https://app-eagleseye.com` actif en HTTPS (HTTP/3, TLS valide) |
| 10 | Cron | Au moins une exécution par minute ou 5 min | Panneau Hostinger (Avancé → Tâches Cron) |
| 11 | Workers / queue | Pas de démon permanent : queue base de données traitée par cron court | Queue `database` (`fw_jobs`) traitée par `schedule:run` |
| 12 | Dossier racine web | Possibilité de pointer sur `public/` ; stockage privé hors racine | Lien symbolique `~/domains/app-eagleseye.com/public_html -> ~/eeo/public` ; code dans `~/eeo-releases/` hors racine web |
| 13 | Limites : mémoire, durée d'exécution, taille upload/POST (≥ 2 Mio push, PDF) | Voir 23 (limites push/PDF) | `memory_limit=2048M`, `post_max_size=2048M`, `upload_max_filesize=2048M`, `max_execution_time` illimité en CLI, `max_allowed_packet=1024M` |
| 14 | Sauvegardes de l'hébergeur et RPO | A11 : 1 h cible, quotidien minimum | `mysqldump` disponible ; `tools/deploy/backup.sh` chiffré (`~/.eeo-backup.key`) fonctionnel vers `~/eeo-backups/` |
| 15 | Stockage distant de sauvegarde, restauration, support (Q14) | Avant production | Sauvegardes chiffrées dans `~/eeo-backups/` à rapatrier par `scp` hors serveur |
| 16 | Fuseau / locale | Africa/Douala ; instants UTC en base | `Africa/Douala` (cabinet), `UTC` (application et session SQL) |
| 17 | HTTPS et en-têtes (CSP, service worker scope) | PWA exige contexte sécurisé | Vérifiés en direct : CSP stricte, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `/sw.js` servi à la racine |
| 18 | Réglages `php.ini` de production | `zend.exception_ignore_args=On`, `display_errors=Off`, `expose_php=Off`, `session.use_strict_mode=1` | `display_errors=Off`, `zend.exception_ignore_args=On`, `SESSION_SECURE_COOKIE=true` |

## Règle de décision

Si l'offre est incompatible, proposer une **offre web simple compatible** (D05 interdit le VPS par défaut) et consigner l'écart au journal et au fichier 15. Un hébergement non vérifié bloque G4 et la mise en production ; il ne bloque ni le développement ni G0–G3 sur données fictives.

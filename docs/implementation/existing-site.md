# Site existant du cabinet et raccordement (L3D01, Q12, EE039, EE040)

Ce document répond à la fiche L3D01 (« Auditer le site existant et fixer son raccordement ») du fichier 24 : inventorier ce qui est connu du site public actuel, choisir le raccordement MINIMAL (sans refaire un site fonctionnel inutilement) et isoler sessions, secrets et API privée de l'API publique. Le contrat des routes publiques est dans `docs/implementation/public-contract.md`.

**Règle de ce chantier : aucune modification du site existant, du DNS, du domaine ou de la messagerie n'a été faite ni ne sera faite par le développement.** Le site, le domaine et les comptes appartiennent au client ; l'application propose un raccordement qui fonctionne SANS toucher à ce que l'on ne connaît pas. La question Q12 du fichier 15 (« Site actuel, technologie, accès, showroom existant ou à compléter ») est donc RÉSOLUE par la définition de l'API publique et de la séparation du domaine privé, qui est la condition de sortie posée par le fichier 15, et NON par un audit du site existant, impossible sans accès (ce qui reste à connaître est listé en section 3 et ne bloque rien).

## 1. Ce que l'on sait, et d'où cela vient

| Fait | Source | Ce que cela change |
| --- | --- | --- |
| Le domaine du cabinet est celui de la proposition commerciale ; aucun DNS n'a été modifié par le travail de spécification. | Fichier 12 (« Sous-domaine et environnements ») | Aucune modification de zone dans ce lot : le contrôle `php artisan eeo:domain:check` ne fait que lire (L3D04). |
| Les adresses `direction@eagleeyeoptic.com` et `contact@eagleeyeoptic.com` sont à configurer « sur l'infrastructure existante si disponible ». | Fichier 02, site public | Ces comptes appartiennent au client ; voir `docs/runbooks/domain-email.md`. |
| L'application métier est un sous-domaine du site existant (décision D04) et le site existant garde ses propres sessions : aucun cookie partagé au domaine parent. | Fichiers 05 et 09, décision D04 | Le raccordement ne passe jamais par une session, un cookie ni une base commune. |
| L'application de production est en ligne sur `https://app-eagleseye.com` (hébergement mutualisé, sans VPS), audit d'hébergement validé le 2026-10-27. | `docs/implementation/hosting-audit.md` | Le nom de production n'est pas celui que le fichier 12 proposait (`app.eagleeyeoptic.com`, « à confirmer ») : écart consigné, voir section 6. |
| Le showroom publie des références et médias APPROUVÉS ; prix d'achat, stock détaillé, identités et historique médical ne sont jamais publics ; le bouton « Essayer ce modèle » garde la référence sur la demande de rendez-vous. | Fichier 06, section 10 | Contrat de l'API publique, section 2 de `public-contract.md`. |

## 2. Raccordement retenu : minimal, sans rien changer au site existant

Trois raccordements ont été comparés. Le premier est retenu parce qu'il fonctionne quelle que soit la technologie du site existant (qui n'est pas connue) et n'exige aucun accès à celui-ci.

| Option | Principe | Décision |
| --- | --- | --- |
| **A. Liens sortants** | Le site existant ajoute, quand le client le décide, des liens ou boutons vers `https://<application>/showroom` et `https://<application>/rendez-vous` (et `?fiche=<adresse>` depuis une fiche). Les pages publiques sont servies par l'application elle-même, avec sa charte, sans cookie de back-office. | **Retenue.** Aucun accès au site existant, aucune dépendance à son CMS. |
| **B. Lecture de l'API publique** | Si le site existant permet d'insérer du script, il lit `/public/v1/showroom`, `/public/v1/contents`, `/public/v1/services`, `/public/v1/slots` et dépose `POST /public/v1/booking-requests` depuis son origine. Les origines autorisées sont celles de `EEO_PUBLIC_ALLOWED_ORIGINS` (liste vide par défaut : aucune). | **Prête, fermée par défaut.** S'ouvre en renseignant la variable avec l'origine exacte du site, sans changement de code. |
| **C. Incorporation (iframe), session ou base partagées, domaine parent commun** | Une page de l'application dans un cadre du site existant, ou un cookie / une base commune. | **Écartée** : l'application interdit tout cadre (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), et le fichier 05 interdit toute session ou base partagée. |

Conséquence pratique : la mise en service du site public ne dépend ni du CMS du cabinet ni d'un accès à son hébergement. Le client (ou son webmestre) ajoute deux liens quand il veut.

## 3. Ce qui reste à connaître, et ce que cela ne bloque pas

Rien de ce qui suit n'est supposé ni inventé. Chaque ligne se renseigne quand le client le souhaite ; aucune ne bloque le développement, la recette ni la mise en ligne de l'application (décision du demandeur du 2026-11-10 : seules les informations indispensables à l'avancement sont réclamées).

| À connaître | Pourquoi | Effet tant que c'est inconnu |
| --- | --- | --- |
| Technologie et hébergeur du site existant, qui l'administre, accès (panneau, FTP, compte d'administration). | Choisir B plutôt que A, et savoir qui ajoute les liens. | Option A, par un lien que le client place lui-même. |
| Charte du site existant (couleurs, polices, logo). | Rapprocher les pages publiques de l'application de la charte du site. | Les pages publiques gardent la charte de l'application (celle du logo, déjà sur toutes les pièces du cabinet). |
| Références déjà présentées sur le site existant. | Éviter un doublon avec les fiches du showroom. | Le showroom de l'application démarre vide : la gérante y publie fiche par fiche (`/communication/site`). |
| Domaine exact du site public et de la messagerie. | Renseigner `EEO_PUBLIC_ALLOWED_ORIGINS` et lancer `eeo:domain:check`. | CORS fermé, contrôle du domaine fait sur le nom de production. |
| Confirmation du nom de production (`app-eagleseye.com` ou `app.eagleeyeoptic.com`). | Cohérence des liens, du certificat et des adresses de courrier. | Liens vers le nom de production actuel. |

## 4. Isolement des sessions, des secrets et des API

| Élément | Application privée (`/api/*`) | API publique (`/public/v1/*`) |
| --- | --- | --- |
| Authentification | Session Sanctum du seul domaine applicatif, cookie `HttpOnly`, CSRF sur les mutations. | Aucune : pas de compte, pas de cookie, pas de jeton. Les webhooks entrants se vérifient par signature. |
| CORS | Aucun en-tête : une seule origine. | Seulement les origines de `EEO_PUBLIC_ALLOWED_ORIGINS` ; `supports_credentials` reste faux (`config/cors.php`). |
| Mise en cache | `Cache-Control: no-store, private` sur toute réponse. | Lectures du showroom : `public, max-age=300` (réglable, 0 = `no-store`) ; dépôt de demande : jamais. |
| Limites de débit | Par compte et par adresse selon la route. | Par adresse : 120 lectures par minute, 20 demandes de rendez-vous par minute. |
| Données | Tout le dossier métier, selon les permissions. | Liste blanche de champs (voir `public-contract.md`) : jamais de coût d'achat, de stock, de référence interne, d'identifiant de patient ni de donnée clinique. |
| Secrets | `.env` hors racine web, clés d'intégration chiffrées, clé de sauvegarde distincte. | Aucun secret n'est lu ou rendu par ces routes. |
| Moteurs de recherche | `X-Robots-Tag: noindex, nofollow` et `robots.txt` en `Disallow: /`. | Idem (voir section 5). |

Un écran d'administration seul peut publier : le droit `site.publish` (gérante), avec confirmation récente du mot de passe pour publier, retirer ou archiver. Un module « communication » fermé répond 404 sur toute route du showroom.

## 5. Choix à connaître : l'application n'est pas indexée

`public/robots.txt` interdit tout et chaque réponse porte `X-Robots-Tag: noindex, nofollow` (`SecurityHeaders`). C'est voulu pour l'application PRIVÉE ; il en résulte que les pages publiques de l'application (`/showroom`, `/rendez-vous`) ne sont pas non plus référencées par les moteurs de recherche. Le référencement naturel reste donc porté par le site existant du cabinet (option A : ses liens ; option B : ses pages qui affichent le showroom). Ouvrir l'indexation de `/showroom` serait un changement d'`SecurityHeaders` et de `robots.txt` à décider avec le client ; il n'est pas fait.

## 6. Écarts et décisions à consigner

- **Nom de production** : `app-eagleseye.com` est en service ; le fichier 12 proposait `app.eagleeyeoptic.com`. Aucun changement tant que le client ne l'a pas décidé (aucun DNS modifié, aucun achat de nom).
- **Pas de modification du site existant** : la fiche demande « Q12 résolu avant modification réelle » ; aucune modification réelle n'est prévue, l'option A n'en demande aucune.
- **Pas d'identité de patient côté public** : la demande de rendez-vous ne crée ni dossier clinique ni patient ; un numéro de téléphone connu du cabinet donne la MÊME réponse qu'un numéro inconnu (AT35).

## 7. Revue « origine, cookies, API publiques » (validation de la fiche)

| Point revu | Preuve |
| --- | --- |
| Les routes publiques ne reçoivent ni n'émettent de cookie de session, ne demandent pas de CSRF et ne lisent pas l'identité de l'appelant. | `routes/public.php` (aucun groupe `web` ni `api` : voir `bootstrap/app.php`), `tests/Feature/PublicSite/PublicSiteTest.php`. |
| Le public ne lit qu'une liste blanche de champs, jamais le coût ni le stock. | `PublicSiteTest::test_le_public_ne_lit_qu_une_liste_blanche_de_champs_jamais_le_cout_ni_le_stock` et `tests/e2e/public-booking.spec.ts` (clés de la réponse comparées une à une). |
| Un brouillon, une fiche retirée ou un article devenu invisible disparaissent du site. | `PublicSiteTest` (brouillon, retrait, article retiré du catalogue public). |
| Un robot qui remplit le champ caché est refusé sans rien enregistrer ; deux demandes sur le même créneau ne passent pas toutes les deux. | `tests/Feature/PublicSite/PublicBookingShowroomTest.php`, `tests/e2e/public-booking.spec.ts`. |
| Un téléphone connu du cabinet ne change rien à la réponse (aucune énumération). | `tests/Feature/Scheduling/GoogleCalendarAndPublicBookingTest.php`, `tests/e2e/public-booking.spec.ts`. |
| Aucun cadre ni CORS n'ouvre l'application privée. | `SecurityHeaders` (CSP `frame-ancestors 'none'`), `config/cors.php` (chemins `/public/v1/*` seulement, et seulement si des origines sont déclarées). |

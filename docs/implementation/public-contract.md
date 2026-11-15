# Contrat de l'API publique du site (L3D01, L3D02, L3D03, EE039)

Routes SANS compte, sous `/public/v1`, appelées par les pages publiques de l'application (`/showroom`, `/showroom/<adresse>`, `/rendez-vous`) et, si le client l'ouvre, par son site existant (option B de `docs/implementation/existing-site.md`). Les schémas font foi dans `contracts/` (identifiants d'opération entre parenthèses) ; ce document en donne les règles.

## 1. Principes

- **Aucune authentification, aucun cookie, aucun CSRF** : ces routes sont déclarées hors des groupes `web` et `api` (`bootstrap/app.php`).
- **Liste blanche** : seules sont rendues les valeurs listées ci-dessous. Jamais de coût d'achat, de stock, de référence interne, d'identifiant de patient ni de donnée clinique.
- **Seul ce que la gérante a PUBLIÉ sort** : une fiche (`PUBLISHED`, article actif et visible au public), un contenu (révision publiée), une image (approuvée, d'une fiche publiée). Toute autre ressource répond 404, sans dire pourquoi.
- **Module « communication » fermé = 404** sur le showroom et les contenus (mise en service progressive).
- **Versionnement par le chemin** : `/public/v1`. Des champs peuvent être AJOUTÉS à une réponse sans changer de version ; retirer ou renommer un champ exige `/public/v2`.
- **Erreurs** : enveloppe habituelle `{ "error": { "code", "message", "fields" }, "correlation_id" }` ; 404 sans corps révélateur, 422 avec les champs en cause, 429 avec `Retry-After`.

## 2. Showroom et contenus (lecture)

Limite : 120 requêtes par minute et par adresse IP (`EEO_RATE_PUBLIC_READ`). Cache public de 300 secondes (`EEO_PUBLIC_CACHE_SECONDS`, 0 = jamais).

| Route | Rôle | Réponse |
| --- | --- | --- |
| `GET /public/v1/showroom?style=&brand=&page=` (`ListShowroom`) | Références publiées, filtrables par style et marque, 25 par page. | `data[]` : `slug`, `title`, `description`, `style`, `brand`, `price`, `currency` (`XAF`), `media[]` (`url`, `alt`) ; `meta` (pagination) ; `facets` (`styles[]`, `brands[]` pour construire les filtres). |
| `GET /public/v1/showroom/{slug}` (`GetShowroomItem`) | Une référence. | `data` : mêmes champs. 404 si elle n'est pas publiée. |
| `GET /public/v1/contents` (`ListPublicSiteContents`) | Contenus approuvés : accueil, expertises, horaires, localisation, WhatsApp, réseaux sociaux, contact. | `data[]` : `code`, `title`, `content`, `whatsapp_url` (`https://wa.me/<numéro>` pour WHATSAPP, sinon null). |
| `GET /public/v1/media/{id}` (`GetPublicMedia`) | Octets d'une image approuvée (`media[].url`). | Image (JPEG, PNG ou WebP) avec son vrai type ; 404 si la fiche n'est plus publiée. |

Règles de champs : `price` n'est rendu que si la gérante a choisi de montrer le prix de cette fiche (sinon `null`) ; `brand` et `style` viennent de la fiche ; `description` est du texte seul. Chaque image a un texte alternatif et une note de droits obligatoires (la note de droits n'est jamais rendue). Le texte d'un contenu n'est jamais du HTML.

## 3. Prise de rendez-vous (lecture et dépôt)

| Route | Rôle | Règles |
| --- | --- | --- |
| `GET /public/v1/services` (`ListPublicServices`) | Prestations OUVERTES à la réservation en ligne. | `id`, `name`, `duration_minutes` seulement. La gérante ouvre une prestation dans `Configuration de l'agenda` (case « Ouverte à la réservation en ligne »), fermée par défaut ; une prestation désactivée disparaît. |
| `GET /public/v1/slots?service_id=&from=&to=` (`ListPublicSlots`) | Créneaux libres d'une prestation. | Fenêtre de 14 jours au plus (`to` après `from`) ; créneaux administratifs : `service_id`, `resource_id`, `starts_at`, `ends_at`, sans nom de professionnel ni de patient. |
| `POST /public/v1/booking-requests` (`RequestPublicBooking`) | Dépose une DEMANDE. | En-tête `Idempotency-Key` obligatoire (1 à 100 caractères). 20 demandes par minute et par adresse. 201 avec le reçu (`public_reference`, `status`, `service_id`, `requested_starts_at`, `requested_ends_at`). |

Corps de la demande : `service_id`, `starts_at`, `name`, `phone`, `consent` (obligatoirement `true`), et facultativement `resource_id`, `email`, `publication_slug` (la référence du showroom qui a donné envie de venir : ignorée si elle n'est pas publiée), `website`.

Garanties :

- **Une demande n'est pas un rendez-vous.** Le reçu dit `PENDING` (en attente) ; la gérante confirme ou refuse (`/communication/reservations`), sous verrou, après avoir revérifié le créneau. L'application n'envoie aucun message au visiteur : la page lui dit de ne rien tenir pour confirmé tant que le cabinet ne l'a pas fait.
- **Idempotence** : rejouer la MÊME demande avec la MÊME clé rend le même reçu sans créer de doublon ; la même clé avec un autre contenu est refusée (409).
- **Un seul créneau, une seule demande** : deux demandes pour le même créneau ne passent pas toutes les deux (409 `SLOT_UNAVAILABLE` pour la seconde).
- **Aucune énumération** : un téléphone déjà connu du cabinet donne exactement la même réponse qu'un téléphone inconnu ; la demande ne crée ni ne modifie de fiche patient (elle crée un contact « prospect » administratif).
- **Piège à robots** : le champ `website` n'est jamais rempli par une personne ; une demande qui le remplit est refusée (422 générique) sans rien enregistrer.
- **Minimum administratif** : nom, téléphone, e-mail facultatif, consentement ; aucune donnée de santé n'est demandée, et la page publique le dit.

## 4. CORS (option B seulement)

Vide par défaut : aucune origine tierce. Pour ouvrir le site existant, renseigner `EEO_PUBLIC_ALLOWED_ORIGINS` avec les origines EXACTES, séparées par des virgules (`https://www.exemple.test`). Seuls les chemins `/public/v1/showroom`, `/showroom/*`, `/contents`, `/media/*`, `/services`, `/slots` et `/booking-requests` reçoivent des en-têtes CORS ; méthodes `GET`, `POST`, `OPTIONS` ; en-têtes autorisés `Accept`, `Content-Type`, `Idempotency-Key` ; jamais de cookie (`supports_credentials` faux).

## 5. Ce que le contrat n'est pas

- Ce n'est pas l'API privée (`/api/v1`), qui exige une session et n'est jamais ouverte à un site tiers.
- Les webhooks entrants (`/public/v1/webhooks/*`) ne sont pas appelés par un navigateur ; ils se vérifient par signature et n'ont aucun CORS (voir `docs/runbooks/integration-incidents.md`).
- Aucune route publique n'écrit un fait financier, une ordonnance ou une consultation.

## 6. Preuves

`tests/Feature/PublicSite/PublicSiteTest.php`, `tests/Feature/PublicSite/PublicBookingShowroomTest.php`, `tests/Feature/Scheduling/GoogleCalendarAndPublicBookingTest.php`, `tests/Feature/Scheduling/AgendaConfigurationTest.php` (ouverture d'une prestation), `tests/frontend/site/public-pages.test.ts`, `tests/frontend/site/booking-rules.test.ts` et le parcours `tests/e2e/public-booking.spec.ts`.

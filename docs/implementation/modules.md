# Mise en service progressive des modules (M01)

Décision du demandeur (2026-10-22) : un module terminé n'est visible de la cliente que lorsque le
demandeur l'ouvre. M01 n'est pas une tâche du backlog (qui n'est ni modifié ni régénéré) : c'est un
interrupteur de déploiement, consigné dans `progress.md` (« Écarts de planning »).

## Principe

| Niveau | Rôle | Où |
| --- | --- | --- |
| `delivered` (code) | L'écran existe et ses tests passent | `resources/frontend/app/navigation.ts` |
| `EEO_ENABLED_MODULES` (déploiement) | L'exploitant l'ouvre aux utilisateurs | `.env` du serveur, `config/eeo.php` |
| Permissions | Le compte a le droit de s'en servir | rôles et `permissions` (F05) |

Un module n'apparaît (menu, actions d'accueil, route) que s'il est livré, ouvert **et** autorisé. La
liste appartient au déploiement : la gérante ne peut ni la lire pour la modifier ni la changer
depuis les paramètres du cabinet.

## Codes

`today`, `patients`, `consultations`, `agenda`, `sales`, `stock`, `workshop`, `communication`,
`reports`, `settings`, `offline` : les identifiants des modules de la navigation (fichier 04), dans cet ordre
(`offline` : préparation des postes pour le hors-ligne, O01 et O02, sans entrée de menu).
`app/Support/Modules.php` en est la liste côté serveur ; un test compare les deux listes. Une valeur
inconnue est ignorée : une faute de frappe laisse un module caché, jamais ouvert.

```
EEO_ENABLED_MODULES=patients,consultations
```

Vide (valeur par défaut) : aucun module métier n'est exposé. Les routes d'accès existantes
(connexion, comptes, journal, paramètres du cabinet) ne dépendent pas de cette liste.

## Serveur

- `GET /api/v1/auth/me` rend `data.clinic.enabled_modules` (liste ordonnée des modules ouverts).
- Middleware `module:<code>` (`RequireEnabledModule`) sur les routes d'un module : tant qu'il est
  fermé, la route répond **404 `RESOURCE_NOT_FOUND`**, comme si elle n'existait pas. À poser sur
  chaque route de module (par exemple `Route::middleware('module:patients')`).
- **Commandes reçues d'un poste (O05, fait le 2026-11-06)** : un poste n'a pas de route, donc pas de
  `module:<code>`. `SyncDrain` consulte `app/Offline/SyncCommandModules.php` (module propriétaire de chacune des 26
  commandes qui acceptent la source SYNC, d'après le groupe de routes de la même commande en ligne) AVANT toute
  dépendance et tout effet. Module fermé : la commande n'est jamais appliquée ; elle reste dans l'inbox du serveur (aucune
  perte) et ouvre un conflit durable `MODULE_NOT_ENABLED` (409, `CONFLICT_REQUIRES_REVIEW`, motif lisible qui nomme le
  module). La séquence du poste ne saute pas : les commandes suivantes attendent derrière. Une fois le module ouvert, la
  gérante rejoue la commande (`ACCEPT_LOCAL`, motif obligatoire) ; décidée alors que le module est encore fermé, la
  commande rouvre un conflit, jamais un succès fictif ; `REJECT` l'écarte. Une nouvelle commande de poste sans module
  déclaré fait échouer `tests/Unit/Offline/SyncCommandModulesTest.php`. Limite connue : le pull (`GET /sync/pull`) n'est
  pas filtré par module (il publie les changements des compartiments du grant) ; un module jamais ouvert n'a produit
  aucune donnée à publier.

## Interface

- `session.enabledModules` (lu dans `/auth/me`) alimente `visibleModules` et `visibleHomeActions`.
- Une route déclare `meta.module` : fermée, la page répond « page introuvable » (la même que
  l'URL inconnue). Sans session connectée, aucun module n'est ouvert.
- Une action d'accueil dépend du module de son champ `module` (à défaut, de son identifiant).

## Procédure d'ouverture d'un module

1. La tâche qui livre l'écran passe `delivered` à `true`, ajoute sa route avec `meta.module` et ses
   routes serveur avec `module:<code>`, et ses tests.
2. Le demandeur ajoute le code à `EEO_ENABLED_MODULES` sur le serveur (ou, en développement, dans
   `.env`) et recharge la configuration (`php artisan config:clear` si elle est en cache).
3. Retour arrière : retirer le code ; aucune donnée n'est touchée.

## Tests

`tests/Unit/Support/ModulesTest.php`, `tests/Feature/Http/ModuleGateTest.php`,
`tests/frontend/shell/navigation.test.ts` (filtrage et cohérence avec `Modules.php`),
`tests/frontend/shell/module-gate.test.ts` (menu, actions d'accueil, route introuvable) ; commandes d'un poste :
`tests/Unit/Offline/SyncCommandModulesTest.php` et `tests/Feature/Offline/SyncPushTest.php`
(`test_une_commande_d_un_module_ferme_est_conservee_en_conflit_puis_se_rejoue_une_fois_le_module_ouvert`).

## État de la phase 1 (codé, vérification de fin de phase à faire)

| Code | Écrans livrés (`delivered: true`) | Serveur |
| --- | --- | --- |
| `today` | File du jour, arrivée | `module:today` |
| `patients` | Patients, fiche, activité | `module:patients` |
| `consultations` | Liste des examens (`/consultations`), consultation, révisions, prescriptions | `module:consultations` (dont `GET /consultations`) |
| `sales` | Ventes et caisse, factures, catalogue, taxes, aperçu des documents | `module:sales` |
| `stock` | Stock (disponibilités, stock initial) — entrée de menu non livrée (I01) | `module:stock` |
| `settings` | Paramètres (personnel, cabinet et documents) | aucune route de module : les routes de comptes et du cabinet (F05) restent ouvertes à la gérante même module fermé ; seul l'écran dépend de `settings` |
| `offline` | « Préparer ce poste » (`/parametres/poste`) : coffre chiffré du poste, enrôlement, profils et grants signés (O01, O02), numéros réservés (O03), journal du poste (O04) et synchronisation (O05, push, pull, conflits : `/parametres/conflits-synchronisation`). Codé, non vérifié : à n'ouvrir en production qu'après G1 | `module:offline` (`/devices…`, `/offline-grants…`, `/offline/signing-keys`, `/sync/…`) |

L'accueil affiche, sous les actions du dossier patient (fichier 04), des **raccourcis de travail** par activité
(`WORK_SHORTCUTS` de `navigation.ts` : accueil des patients, examens, caisse et ventes, administration), soumis aux
mêmes règles (livré, ouvert, autorisé). `eeo:preflight` signale un code inconnu dans `EEO_ENABLED_MODULES`, le module
`settings` fermé alors que d'autres sont ouverts, une caisse ou une échelle d'acuité manquante pour un module ouvert,
et un contrôle du paiement de l'examen incohérent (bloquant).

Ordre d'ouverture conseillé et prérequis : `deploiement.md`, étape 6.

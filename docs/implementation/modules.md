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

## État des modules livrés (code et déploiement, mis à jour le 2026-11-18)

Les 11 codes définis dans `app/Support/Modules.php` et `resources/frontend/app/navigation.ts` sont tous ouverts sur la production (`https://app-eagleseye.com` via `EEO_ENABLED_MODULES`) :

| Code | Écrans livrés (`router.ts`) | Entrée menu / accès UI | Serveur |
| --- | --- | --- | --- |
| `today` | File du jour (`/aujourdhui`), Enregistrer une arrivée (`/aujourdhui/arrivee`) | `APP_MODULES` (`delivered: true`) | `module:today` |
| `patients` | Patients, Nouveau patient, Fiche patient (avec accès directs multi-modules), Activité, Fusion doublons | `APP_MODULES` (`delivered: true`) | `module:patients` |
| `consultations` | Consultations (`/consultations`), Examen clinique en 6 étapes, Historique des révisions, Ordonnances (`/patients/:id/prescriptions`, `/consultations/:id/prescriptions`), Comparaison optique | `APP_MODULES` (`delivered: true`) | `module:consultations` |
| `agenda` | Agenda (`/agenda` : vues **Jour**, **Semaine**, **Mois** calendrier + ajout 1 clic), Nouveau rendez-vous (`/agenda/nouveau`), Configuration, Patients à rappeler (`/suivis`) | `APP_MODULES` (`delivered: true`) | `module:agenda` |
| `sales` | Ventes et caisse (`/ventes`), Devis, Factures & corrections, Encaissements, Caisse, Caisse du jour, Finance du cabinet, Rapprochements par canal, Catalogue & Import CSV, Règles fiscales, Aperçu des documents | `APP_MODULES` (`delivered: true`) | `module:sales` |
| `stock` | Stock (`/stock`), Casse ou ajustement, Fournisseurs, Réceptions fournisseur, Inventaires, Alertes et seuils (`/stock/alertes`), Historique des mouvements (`/stock/historique`) | `APP_MODULES` (`delivered: true`) | `module:stock` |
| `workshop` | Atelier optique (`/atelier`, commande labo `/atelier/nouveau`, détail & bon labo anonymisé `/atelier/:id`) | `APP_MODULES` (`delivered: true`) + carte `Ventes` + liens depuis Facture/Ordonnance/Patient | `module:workshop` |
| `communication` | Hub Communication (`/communication`), Site public (`/communication/site` + `/showroom` + `/rendez-vous`), Réservations publiques & Google Agenda, CRM Kommo, Base de connaissances, Assistant & reprises humaines, Consentements, Campagnes, Boîte d’envoi & webhooks | `APP_MODULES` (`delivered: true`) | `module:communication` |
| `reports` | Statistiques (`/rapports/statistiques`), Rapports de gestion (`/rapports/gestion`) | `HOME_ACTIONS` (`Statistiques`, `delivered: true`) et liens dans `Paramètres` / `Rapprochements` (`APP_MODULES` garde `delivered: false` pour ne pas surcharger le menu principal) | `module:reports` |
| `settings` | Paramètres (`/parametres`), Personnel, Cabinet et documents, Approbations, Exports contrôlés, Intégrations et connecteurs (`/parametres/integrations`) | `APP_MODULES` (`delivered: true`) ; routes `/auth` & `/settings` accessibles à la gérante | `module:settings` |
| `offline` | Préparer ce poste (`/parametres/poste`), Conflits de synchronisation (`/parametres/conflits-synchronisation`) | Ouvert depuis `Paramètres` lorsque `offline` est actif (`APP_MODULES` sans entrée dédiée ; fiches en `maturity: 'validation'`) | `module:offline` (`/devices…`, `/offline-grants…`, `/offline/signing-keys`, `/sync/…`) |

L'accueil affiche, sous les actions du dossier patient (`HOME_ACTIONS`), des **raccourcis de travail** par activité (`WORK_SHORTCUTS` de `navigation.ts` : accueil des patients, examens, caisse et ventes, administration), soumis aux mêmes règles (livré, ouvert, autorisé). `eeo:preflight` signale un code inconnu dans `EEO_ENABLED_MODULES`, le module `settings` fermé alors que d'autres sont ouverts, une caisse ou une échelle d'acuité manquante pour un module ouvert, et un contrôle du paiement de l'examen incohérent (bloquant).

Ordre d'ouverture conseillé et prérequis : `deploiement.md`, étape 6.

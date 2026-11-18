# Guides destinés au cabinet (`https://app-eagleseye.com`)

L’application embarque une **aide interactive intégrée** directement dans l’interface (bouton « Aide » présent en haut de chaque écran et rubrique complète `/aide`), complétée ici par un **manuel d’exploitation détaillé et imprimable** destiné à l’équipe du cabinet **Eagle's Eye Optics Medical** :

- **Manuel complet du cabinet (de A à Z)** : [`manuel-exploitation-cabinet.md`](./manuel-exploitation-cabinet.md) — présentation des rôles, circuit patient complet (workflow relié entre modules), fiche pratique de chaque module, explication concrète de l’atelier optique, dictionnaire des termes affichés à l’écran, routines de gestion et dépannage sans jargon technique.
- **Aide en ligne intégrée (`/aide`)** : testée automatiquement avec le code (`tests/frontend/help/`) pour garantir que chaque libellé cité correspond exactement aux écrans déployés.

---

## 1. État réel de la solution en ligne (`https://app-eagleseye.com`)

Tous les modules métier configurés sur la plateforme sont **ouverts et exploitables** :

- **Accueil & File du jour** (`today`) : accueil des patients, arrivée libre ou sur rendez-vous.
- **Patients** (`patients`) : fiches, doublons, dossier relié à l’activité clinique, financière et atelier.
- **Consultations & Ordonnances** (`consultations`) : examens en 6 étapes, acuité, réfraction, révisions, ordonnances.
- **Agenda & Rappels** (`agenda`) : vues **Jour**, **Semaine** et **Mois (calendrier avec ajout en un clic)**, patients à rappeler, configuration des plages.
- **Ventes, Devis, Factures & Caisse** (`sales`) : devis versionnés, factures, encaissements, caisse et rapprochements, catalogue et fiscalité, documents officiels sans filigrane de test.
- **Stock & Achats** (`stock`) : disponibilités par emplacement, alertes et seuils, mouvements, fournisseurs, réceptions, inventaires.
- **Atelier optique** (`workshop`) : suivi de fabrication/montage des lunettes entre le cabinet et le laboratoire/monteur, avec bon laboratoire anonymisé.
- **Communication & Site public** (`communication`) : showroom et prise de rendez-vous publique (`/showroom`, `/rendez-vous`), demandes publiques, base de connaissances, consentements, campagnes, boîte d’envoi et connecteurs.
- **Statistiques & Rapports de gestion** (`reports`) : tableaux d’activité, statistiques cliniques, exports comptables et rapports multi-domaines.
- **Paramètres** (`settings`) : comptes du personnel, mentions du cabinet, approbations, exports, connecteurs externes.
- **Préparation hors ligne** (`offline`) : accessible dans les paramètres techniques pour préparer et contrôler un poste, tout en restant en phase de validation avant usage autonome sans Internet.

---

## 2. Où lire quoi dans l’application (`/aide`)

Le bouton « Aide » de l’en-tête ouvre la fiche exacte de l’écran où vous vous trouvez ; l’écran « Aide » (`/aide`) donne le reste, filtré selon vos droits et les modules ouverts :

| Besoin | Où dans l’application | Contenu |
| --- | --- | --- |
| Découvrir l’outil | `/aide` → **Démarrer** | Bienvenue, connexion, repères, quatre profils, principes et journée type. |
| Travailler selon son poste | `/aide` → **Guides par profil** | Un guide dédié pour Accueil, Professionnel de santé, Caissière et Gérante. |
| Réaliser une action de bout en bout | `/aide` → **Parcours pas à pas** | Accueil patient, rendez-vous, examen, ordonnance, suivi, vente, devis, remise, correction, caisse, stock, gestion. |
| Comprendre un mot ou une règle | `/aide` → **Notions et règles** / **Glossaire** | Patient, examen, documents, facture, encaissement, stock, approbations, optique et gestion. |
| Résoudre un blocage | `/aide` → **Dépannage** | Messages exacts, questions fréquentes et limites de la version. |
| Paramétrer ou former l’équipe | `/aide` → **Mise en service** (Gérante) | Préparation, configuration, répétition générale et exploitation. |
| Comprendre un écran précis | Bouton **« Aide »** de l’écran ou **« Référence des écrans »** | Objectif, boutons disponibles, pas à pas, règles, suites et dépannage. |

L’aide du **site public** (`/showroom` et `/rendez-vous`) n’a pas besoin de documentation séparée : ces pages sont lisibles directement par le visiteur sans compte, et pilotées depuis « Site public : showroom et contenus ».

---

## 3. Formation et prise en main

| Volet | Support disponible | Remarque d’exploitation |
| --- | --- | --- |
| Prise en main métier (Accueil, Professionnel, Caissière, Gérante) | [`manuel-exploitation-cabinet.md`](./manuel-exploitation-cabinet.md) + guides par profil de `/aide` | À dérouler directement avec l’équipe sur des données fictives de répétition. |
| Exploitation technique (sauvegarde, restauration, domaine, incidents) | `docs/runbooks/` (`server-restore.md`, `domain-email.md`, `local-recovery.md`, `profile-flow.md`, `integration-incidents.md`, `handover.md`) | Support livré pour le responsable technique. |
| Enregistrement vidéo smartphone / ordinateur | Scénarios alignés sur `/aide` et le manuel d’exploitation | **À enregistrer avec l’équipe du cabinet** sur un environnement de test (jamais avec des données patients réelles). |

Règle constante pendant les démonstrations et formations : utiliser uniquement le vocabulaire de l’application (« émise », « encaissé », « reste à encaisser », « sans frais » — jamais « payé », « soldé », « acquitté » ou « gratuit ») et ne jamais montrer de véritables dossiers patients en vidéo.

---

## 4. Points d’attention avant l’utilisation quotidienne

- **Connexion Internet** : l’application s’utilise normalement avec une connexion Internet active. La préparation hors ligne existe côté Paramètres mais reste en phase de validation avant utilisation coupée du réseau.
- **Documents officiels** : le mode production des documents est activé sur `https://app-eagleseye.com` (devis, ordonnances, factures et reçus s’impriment avec les mentions officielles d’Eagle's Eye Optics Medical). L’impression s’effectue sur l’imprimante du cabinet via le navigateur.
- **Connecteurs externes (SMS, WhatsApp, Kommo, Google Agenda)** : les écrans de Communication sont ouverts ; l’envoi réel vers les téléphones des patients et la synchronisation externe ne deviennent actifs qu’une fois vos comptes fournisseurs et clés renseignés dans **Paramètres → Intégrations et connecteurs**.
- **Sauvegardes** : une sauvegarde chiffrée est déclenchée lors des mises en ligne et peut être lancée à la demande côté serveur (`tools/deploy/backup.sh`).

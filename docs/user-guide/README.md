# Guides destinés à la cliente (L3D05, EE043, EE044)

**Les guides de la cliente ne sont pas des fichiers : ils vivent DANS l'application** (règle du projet, `CLAUDE.md`). Ce dossier est l'index de la remise : il dit où se trouve chaque guide, ce que couvre la formation et ce qui reste à faire avec les personnes. Un guide Markdown à côté de l'application se périmerait à la première évolution ; l'aide intégrée, elle, est testée avec le code (un libellé cité qui n'existe plus dans l'application fait échouer les tests : `tests/frontend/help/`).

## 1. Où lire quoi, dans l'application

Le bouton « Aide » de l'en-tête ouvre l'aide de l'écran où l'on se trouve ; l'écran « Aide » (menu) donne le reste. Chaque personne ne voit que les écrans de ses droits et des modules ouverts.

| Besoin | Où | Contenu |
| --- | --- | --- |
| Je découvre l'application | Aide, partie « Démarrer » | Bienvenue, se connecter, se repérer, les profils, les principes, une journée type. |
| Je fais mon travail de tous les jours | Aide, partie « Guides par profil » | Un guide par profil : accueil, professionnel de santé, caisse, gérante. |
| Je veux faire une chose précise de bout en bout | Aide, partie « Parcours pas à pas » | Accueillir un patient, prendre un rendez-vous, mener un examen, rédiger une ordonnance, suivre un patient, vendre, faire un devis, remettre un article, corriger une pièce, tenir la caisse, gérer le stock, piloter le cabinet. |
| Je ne comprends pas un mot ou une règle | Aide, parties « Notions et règles » et « Glossaire » | Patient, visite et examen, documents, sécurité, modules, facture, encaissement, caisse, stock, autorisations ; vocabulaire de l'optique et de la gestion. |
| Quelque chose ne marche pas | Aide, partie « Dépannage » | Messages, questions fréquentes, limites connues. |
| Je mets l'application en service | Aide, partie « Mise en service » | Avant l'installation, première configuration, répétition générale, exploitation. |
| Je suis sur un écran précis | Bouton « Aide » de l'écran, et « Référence des écrans » dans l'écran « Aide » | « Vous êtes ici », ce que l'on peut faire, pas à pas, règles, suites, problèmes fréquents. |

L'aide du **site public** (showroom et prise de rendez-vous) n'existe pas : le visiteur n'a pas de compte ; ces pages se lisent d'elles-mêmes. La gérante prépare ce qu'elles montrent depuis l'écran « Site public : showroom et contenus » (aide de l'écran incluse).

## 2. Formation

La fiche L3D05 demande de « former profils, exploitation et vidéo smartphone ». Le développement livre le SUPPORT ; la formation elle-même est une séance avec des personnes, à planifier avec la cliente.

| Livrable de formation | Support dans le dépôt | État |
| --- | --- | --- |
| Formation métier par profil (accueil, professionnel, caisse, gérante) | Guides par profil et parcours de l'aide intégrée ; répétition générale décrite dans « Mise en service ». | Support livré ; séances à planifier avec la cliente. |
| Formation exploitation (sauvegarde, restauration, export, mise à jour, domaine) | `docs/runbooks/` (`server-restore.md`, `domain-email.md`, `local-recovery.md`, `profile-flow.md`, `integration-incidents.md`), `docs/implementation/deploiement.md`, `docs/runbooks/handover.md`. | Support livré ; exercice de sortie à faire avec le responsable désigné par la cliente. |
| Vidéo de formation sur smartphone et ordinateur (proposition commerciale, module 5) | Le scénario de la vidéo suit les parcours de l'aide intégrée ; l'enregistrement se fait SUR l'application de recette, avec des données fictives, jamais sur la production. | **Non réalisée** : exige la cliente et l'équipe à l'écran. Écart consigné dans `docs/evidence/delivery-final.md`. |

Règles de toute séance ou vidéo : données fictives seulement (pas de patient réel à l'écran), vocabulaire de l'application (« encaissé », « reste à encaisser », « émise » ; jamais « payé », « soldé », « acquitté », « gratuit »), et aucune promesse d'une fonction fermée ou simulée (travail sans connexion, envoi de messages, connecteurs externes).

## 3. Ce que la cliente doit savoir avant de s'en servir

Ces limites sont dites dans l'application (partie « Dépannage », limites connues) et reprises dans `docs/evidence/G7.md` :

- L'application fonctionne avec une connexion Internet ; le travail sans connexion existe mais n'est pas ouvert tant que sa preuve sur le matériel du cabinet n'est pas faite.
- Aucun message (SMS, WhatsApp, courrier) n'est envoyé aux patients : les canaux sont simulés tant que les comptes des fournisseurs ne sont pas fournis.
- Les impressions réelles (imprimante du cabinet) et le parcours sur les appareils du cabinet restent à constater avec la cliente.
- Les sauvegardes automatiques et la copie hors serveur sont mises de côté (décision du 2026-11-10) : une sauvegarde chiffrée se déclenche à chaque mise en ligne, et à la demande par `tools/deploy/backup.sh`.

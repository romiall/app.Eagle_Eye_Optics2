# Remise de l'application et exercice de sortie du prestataire (L3D05, EE041, EE043)

Procédure de remise au client : ce qui est remis, où le trouver, et comment le responsable désigné par la cliente PROUVE qu'il peut tout reconstruire, restaurer et exporter SANS le prestataire. Ce document ne modifie ni prix, ni échéances, ni conditions : il les cite telles que les sources les donnent (section 5).

## 1. Ce qui est remis

| Livrable | Où | Comment le vérifier |
| --- | --- | --- |
| **Code source** | Dépôt Git `romiall/app.Eagle_Eye_Optics2`, branche `main` (et étiquette de remise posée au moment de la signature). | `git clone`, puis l'exercice de la section 3. |
| **Builds** | Archive de release produite par `bash tools/deploy/build-release.sh` (code PHP, `public/build` de la PWA, migrations, `database/schema_catalog.json` et `05_integrity_checks.sql`, sans `.env`, sans secret, sans donnée de test). | Le script vérifie le contenu de l'archive ; la mise en ligne l'utilise telle quelle (`docs/implementation/deploiement.md`). |
| **Dictionnaire de données et modèle** | `database/` : MCD, MLD, dictionnaire, SQL complet (`eagle_eye_optics_complet.sql`), contrôles d'intégrité, rapport de validation MySQL ; `contracts/` : contrats JSON Schema, OpenAPI et vecteurs de règles. | `bash tools/dev/tester-projet.sh` (étapes `contrats`, `baseline`, `schema`). |
| **Exports** | Écran « Exports » de la gérante : `PATIENTS`, `FINANCE`, `STOCK` et `FULL_HANDOVER`, avec manifeste ; archives chiffrées au repos, téléchargement privé de 48 heures. | `docs/implementation/operations.md`, section Exports ; exercice de la section 3, étape 4. |
| **Sauvegardes et restauration** | `tools/deploy/backup.sh` (base et fichiers privés chiffrés, clé à part), `restore-check.sh`, `docs/runbooks/server-restore.md`. | `docs/evidence/restore-rehearsal.md` (exercice du 2026-11-09). |
| **Documentation** | Guides de la cliente : aide intégrée à l'application (`docs/user-guide/README.md`). Exploitation : `docs/runbooks/`, `docs/implementation/`. | Les tests de l'aide (`tests/frontend/help/`) vérifient que chaque libellé cité existe. |
| **Preuves de recette** | `docs/evidence/` : G0 à G7, registre de recette (`acceptance-L0.json`), registre des exigences (`requirements-final.json`), `verification-projet.md`. | `tests/frontend/evidence/` garde l'exactitude des registres. |
| **Accès** | Aucun accès du prestataire n'est conservé à la fin de la mission : registre des accès dans `docs/runbooks/domain-email.md` (section 7). | Section 4 ci-dessous. |

**Propriété.** Les sources de la proposition commerciale (§6) prévoient la propriété des données, du domaine et des contenus après règlement intégral ; elles ne décrivent pas la propriété du code source, et ce dossier ne la déduit pas (fichier 00). La remise du dépôt suppose donc l'accord écrit du client et du prestataire sur ce point : **question ouverte, à trancher avant la signature du procès-verbal**.

## 2. Qui fait quoi

- **Responsable désigné par la cliente** : exécute l'exercice de la section 3 (ou le fait exécuter par le prestataire de son choix), conserve les clés et les accès, signe le procès-verbal.
- **Prestataire** : prépare la remise, assiste l'exercice, retire ses accès (section 4). Il n'agit sur la production que sur demande écrite de la cliente.

## 3. Exercice de sortie du prestataire

À rejouer par le responsable, sur un poste ou un environnement de test, avec ses propres secrets. Chaque étape a sa preuve ; aucune ne touche la production.

| # | Étape | Preuve attendue |
| --- | --- | --- |
| 1 | Cloner le dépôt à la révision de remise ; `composer install`, `npm ci`. | Installation sans erreur ; les versions sont celles des fichiers de verrou. |
| 2 | Lancer `bash tools/dev/tester-projet.sh --rapide` (puis, si le temps le permet, sans `--rapide`). | Dernière ligne « VERDICT : STABLE ». Le journal par étape est conservé. |
| 3 | Construire l'archive : `bash tools/deploy/build-release.sh`. | Archive produite, vérification de son contenu réussie, aucun `.env` ni secret dedans. |
| 4 | Se connecter au serveur de test du responsable, demander un export `FULL_HANDOVER` (gérante, mot de passe confirmé), le télécharger, lire son manifeste. | Archive reçue, manifeste lisible, périmètre conforme. |
| 5 | Restaurer une sauvegarde chiffrée sur une base JETABLE avec la clé du client : `tools/deploy/restore-check.sh` (`docs/runbooks/server-restore.md`). | Sept contrôles réussis (catalogue des tables, intégrité, séquences, pièces numérotées, empreintes d'audit, fichiers privés, postes à synchroniser). La base jetable est supprimée ensuite. |
| 6 | Déployer l'archive sur l'environnement de test du responsable : `eeo:preflight`, migrations, sonde `/up`, `tools/deploy/smoke.sh`. | Aucun point bloquant ; contrôle de fumée réussi. |
| 7 | Contrôler le domaine : `php artisan eeo:domain:check --host=<nom>`. | Aucun point bloquant (`docs/runbooks/domain-email.md`). |
| 8 | Retirer les accès du prestataire (section 4) et vérifier qu'ils sont fermés. | Registre des accès à jour, connexion de test refusée. |

**État de l'exercice.** Le prestataire a rejoué les étapes 2 (`docs/evidence/verification-projet.md`), 3, 5 (`docs/evidence/restore-rehearsal.md`, 2026-11-09), 6 et 7 (`docs/evidence/domain-checks.md`). **Aucune n'a été rejouée par un responsable de la cliente** : l'exercice de sortie reste à faire avec lui (voir `docs/evidence/delivery-final.md`).

## 4. Accès à retirer ou à remplacer en fin de mission

| Accès | Action | Par qui |
| --- | --- | --- |
| Clé SSH de déploiement (hébergeur) | Retirer la clé publique du prestataire du serveur ; en poser une propre au client. | Client |
| Panneau d'hébergement, zone DNS, boîtes de courrier | Aucun accès n'a été donné au prestataire ; si un accès temporaire est donné, le noter et le retirer. | Client |
| Mot de passe de la gérante, comptes de l'application | Changés par la gérante (« Changer mon mot de passe » sur l'accueil). | Gérante |
| Clé de sauvegarde (`~/.eeo-backup.key`) | Générer une nouvelle clé, ré-exécuter une sauvegarde, détruire l'ancienne copie du prestataire. | Client |
| Clés d'intégration (`EEO_INTEGRATIONS_KEY`) et comptes des fournisseurs | À créer au nom du client le jour où un canal est ouvert ; jamais ceux du prestataire. | Client |
| Dépôt Git | Transfert ou copie au nom du client, selon l'accord de la section 1. | Client et prestataire |

## 5. Garantie, support, limites et jalons commerciaux (cités, non modifiés)

Les éléments suivants viennent de la proposition commerciale et des fichiers 00, 12 et 15 ; **aucun n'est modifié par ce dossier**.

- **Garantie technique** : 3 mois après la recette finale (PC §6). Elle ne fournit pas un engagement d'intervention chiffré (fichier 12) ; les délais de support et la personne désignée sont à confirmer (question Q14).
- **Cadre financier de la proposition** : création et intégration 400 000 FCFA ; licences annuelles CRM et IA 324 000 FCFA ; total 724 000 FCFA ; échéances de création 50 / 30 / 20 % (PC §§4 et 6). Ces chiffres sont ceux de la proposition, pas des tarifs de fournisseurs vérifiés. L'échéance de 30 % exige aussi, selon PC, un agent d'IA WhatsApp opérationnel en fin de premier mois : **le rapprochement des jalons techniques et contractuels est à faire confirmer** (question Q15). Le dossier technique ne déclenche aucune échéance.
- **Limites à la remise** (détail dans `docs/evidence/G7.md`) : canaux sortants simulés tant que les comptes des fournisseurs ne sont pas fournis ; travail sans connexion non ouvert au cabinet ; impression réelle et appareils du cabinet à constater ; sauvegardes automatiques et copie hors serveur mises de côté ; formation et vidéo à faire avec les personnes.
- **Support après la remise** : tout changement de la production se fait sur demande écrite de la cliente (mise en ligne par `tools/deploy/deploy-hostinger.sh`, précédée d'une sauvegarde chiffrée) ; aucun accès permanent du prestataire.

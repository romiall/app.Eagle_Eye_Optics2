# Remise finale : livrables, état et procès-verbal (L3D05, G7)

Procédure : `docs/runbooks/handover.md`. Bilan des exigences et des scénarios : `docs/evidence/G7.md`. Ce document identifie chaque livrable, dit où il se trouve et ce que la cliente doit recevoir ou faire, puis propose le procès-verbal de remise. **Le procès-verbal n'est PAS signé** : la signature, la formation et l'exercice de sortie exigent la cliente.

## 1. Livrables identifiés

| Livrable | Où le trouver | État côté prestataire | Reçu par la cliente |
| --- | --- | --- | --- |
| Application en production (`https://app-eagleseye.com`) | Hébergement mutualisé du client ; release et mises à jour : `docs/implementation/deploiement.md` | En ligne ; la dernière livraison du code, vérifiée et déployée à la demande de la cliente, est tracée dans `docs/implementation/progress.md` ; les lots récents (L1 à L3) ne sont pas encore en production | ☐ |
| Code source | Dépôt Git `romiall/app.Eagle_Eye_Optics2` | Complet, CI de référence ; transfert après accord écrit sur la propriété (`handover.md`, section 1) | ☐ |
| Archive de livraison (build) | `bash tools/deploy/build-release.sh` | Produite et vérifiée à chaque mise en ligne | ☐ |
| Modèle et dictionnaire de données | `database/` (MCD, MLD, dictionnaire, SQL complet, rapport de validation) | Complet : 117 tables, équivalence migrations et SQL contrôlée | ☐ |
| Contrats d'interface | `contracts/` (JSON Schema, OpenAPI, vecteurs de règles) | Générés et contrôlés | ☐ |
| Exports et manifeste | Écran « Exports » ; `docs/implementation/operations.md` | Réalisés (`FULL_HANDOVER`) | ☐ |
| Sauvegarde et restauration | `tools/deploy/backup.sh`, `restore-check.sh`, `docs/runbooks/server-restore.md`, `docs/evidence/restore-rehearsal.md` | Exercice de restauration réussi le 2026-11-09 (AT27) | ☐ |
| Guides de la cliente | Aide intégrée à l'application (`docs/user-guide/README.md`) | Livrés, testés avec le code | ☐ |
| Guides d'exploitation | `docs/runbooks/` (restauration, domaine et courrier, reprise d'un poste, parcours entre profils, incidents d'intégration, remise) | Livrés | ☐ |
| Preuves de recette | `docs/evidence/` (G0 à G7, `acceptance-L0.json`, `requirements-final.json`, `verification-projet.md`, `usability.md`, `domain-checks.md`) | Livrées | ☐ |
| Formation par profil et d'exploitation | Séances avec la cliente | **Non réalisées** (personnes) | ☐ |
| Vidéo de formation smartphone et ordinateur | À enregistrer sur l'application de recette | **Non réalisée** (personnes) | ☐ |
| Registre des accès | `docs/runbooks/domain-email.md`, section 7 | À tenir par la cliente | ☐ |

## 2. Écarts explicités

Chaque exigence a son statut et ses écarts dans `docs/evidence/requirements-final.json`. Les écarts qui concernent la remise :

1. Formation, vidéo et retours des opératrices : à faire avec les personnes (EE043, AT29).
2. Exercice de sortie rejoué par le responsable de la cliente (EE041).
3. Propriété du code source non décrite par les sources : accord écrit à obtenir (EE041).
4. Garantie, support et jalons commerciaux : cités sans modification ; délais de support (Q14) et rapprochement des jalons (Q15) à confirmer (EE043).
5. Canaux sortants et assistant : simulés tant que les comptes des fournisseurs ne sont pas fournis (EE031, EE032, EE035 à EE038).
6. Boîtes de courrier, délivrabilité et HSTS (EE040) ; raccordement au site existant par des liens (EE039).
7. Impression réelle et appareils du cabinet (EE014, EE042, EE044).

## 3. Procès-verbal de remise (modèle, NON SIGNÉ)

> **Procès-verbal de remise de l'application Eagle's Eye Optics Medical**
>
> **Date :** ____ / ____ / ________  **Lieu :** ______________________
>
> **Parties :** la cliente, représentée par ______________________ ; le prestataire, représenté par ______________________.
>
> **Version remise :** commit `____________________` (étiquette de remise `____________`), vérifiée par `tools/dev/tester-projet.sh` : verdict `____________` le ____ / ____ / ________.
>
> **Périmètre remis :** lots L0 à L3 tels que décrits par `docs/evidence/G7.md` (23 exigences DONE, 16 DONE_WITH_RESERVES, 7 PARTIAL sur 46 à la date de ce modèle ; à recompter au moment de la signature).
>
> **Réserves connues et acceptées** (cocher celles que la cliente accepte, barrer les autres et les reporter dans un avenant) :
> ☐ canaux sortants et assistant simulés ; ☐ formation et vidéo à planifier ; ☐ exercice de sortie à rejouer ; ☐ HSTS et boîtes de courrier ; ☐ impression réelle et appareils du cabinet ; ☐ module hors ligne fermé ; ☐ sauvegardes planifiées et copie hors serveur mises de côté ; ☐ autre : ______________________
>
> **Livrables reçus :** cocher le tableau de la section 1.
>
> **Accès :** registre des accès à jour (`domain-email.md`, section 7) ; accès du prestataire retirés le ____ / ____ / ________.
>
> **Garantie et support :** garantie technique de 3 mois après la recette finale (proposition commerciale §6), sans engagement d'intervention chiffré ; délais et personne de support : ______________________ (à confirmer, Q14).
>
> **Signatures :** la cliente : ______________________  le prestataire : ______________________

Ce modèle ne crée aucune obligation par lui-même et ne modifie ni prix, ni échéances, ni conditions de la proposition commerciale.

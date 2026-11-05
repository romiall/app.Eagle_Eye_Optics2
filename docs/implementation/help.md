# Aide intégrée et documentation d'utilisation

Règle du demandeur : tout guide destiné à la cliente vit **dans l'interface**, jamais dans un fichier Markdown. Ce document décrit comment cette aide est construite et comment la tenir à jour ; il s'adresse au développement, pas à la cliente.

## Deux niveaux, une même mise en forme

| Niveau | Où la personne le trouve | Contenu |
| --- | --- | --- |
| Aide d'ÉCRAN | Bouton « Aide » de l'en-tête : un panneau s'ouvre sur l'écran en cours | Une fiche par écran, toujours dans le même ordre |
| Documentation GLOBALE | Écran « Documentation » (`/aide`, lien « Toute la documentation » du panneau, raccourci de l'accueil) | Démarrer, parcours de bout en bout, guides par profil, notions, glossaire, dépannage, mise en service, et la « Référence des écrans » (les mêmes fiches que les panneaux) |

Une fiche d'écran n'est écrite qu'une fois : le panneau et la référence l'affichent avec le même composant. Le panneau reste fermé tant que la personne ne le demande pas : l'interface des écrans n'est pas chargée (aucun bandeau, aucune pastille, aucun stockage navigateur : les gardes du frontend interdisent `localStorage` et `sessionStorage`).

## Où est quoi

| Fichier | Rôle |
| --- | --- |
| `resources/frontend/domain/help/model.ts` | Types : `PageHelp`, `HandbookPart`, `HandbookTopic`, `HelpBlock`, `HelpRef` |
| `resources/frontend/domain/help/content/pages-*.ts` | Les fiches d'écran, une constante `PAGES_…` par fichier |
| `resources/frontend/domain/help/content/handbook-*.ts` | Les parties de la documentation globale |
| `resources/frontend/domain/help/pages.ts`, `handbook.ts` | Assemblage et recherche d'une fiche par nom de route |
| `resources/frontend/domain/help/rules.ts`, `search.ts`, `profiles.ts`, `loader.ts` | Règles d'affichage (droits, modules), recherche, profils du semis, chargement à la demande |
| `resources/frontend/components/help/` | `HelpLauncher.vue` (bouton « Aide » et panneau), `PageHelpView.vue` (la fiche), `HelpBlocks.vue`, `HelpText.vue`, `useHelpLinks.ts` (liens fermés, interdits ou « demande le serveur ») |
| `resources/frontend/pages/help/` | `HelpPage.vue` (écran « Aide et documentation ») et ses morceaux : `HelpHome.vue`, `HelpNavigation.vue`, `HelpNavLink.vue`, `HelpTopic.vue`, `documentation.ts` |
| `tests/frontend/help/`, `tests/e2e/help.spec.ts` | Gardes automatiques (voir plus bas) et parcours dans un navigateur |

Le contenu est chargé à la demande (import dynamique) : il n'alourdit pas le démarrage de l'application.

## La fiche d'écran (`PageHelp`)

Sept rubriques, toujours dans cet ordre ; une rubrique vide n'est pas affichée.

| Rubrique à l'écran | Champ | Contenu | Limite |
| --- | --- | --- | --- |
| Vous êtes ici | `purpose` | À quoi sert l'écran et quand on y vient | 1 à 2 phrases, 45 mots |
| Ce que vous pouvez faire ici | `actions` | Chaque bouton ou lien avec son libellé EXACT et son effet ; `anyPermission` quand l'action dépend d'un droit | 10 actions, 25 mots l'effet |
| Pas à pas | `tasks` | Les tâches principales, étape par étape, jusqu'au résultat | 1 à 3 tâches (jusqu'à 8 pour la fiche d'une facture), 8 étapes de 30 mots |
| Comment ça marche | `rules` | Les règles qui expliquent ce que l'écran fait (ce qui est définitif, ce qui est calculé, ce qui est refusé) | 6 règles |
| Ensuite | `next` | Où aller après : un écran (`route`) ou une rubrique de la documentation (`topic`) | 4 liens |
| À savoir | `tips` | Conseils, limites, différences selon le profil | 5 |
| Si ça ne marche pas | `problems` | Le message exact ou le constat, puis que faire | 5 |

`module` et `anyPermission` de la fiche reprennent `meta.module` et `meta.permissions` de la route (un test les compare) : le panneau d'un écran n'est jamais plus bavard que l'écran. Les actions et tâches qui portent `anyPermission` ne sont montrées qu'aux comptes qui ont l'un de ces droits.

Une fiche porte `maturity: 'validation'` quand l'écran est codé mais pas encore ouvert à la cliente (préparation d'un poste pour le travail sans Internet) : elle le dit en tête et ne promet rien.

Modèles de rédaction : les deux premières fiches de `content/pages-patients.ts` (« Patients » et « Nouveau patient »).

## La documentation globale

Sept parties, dont les identifiants de rubriques sont fixes (les fiches d'écran et les rubriques se renvoient les unes aux autres par ces identifiants : un test vérifie que chaque lien existe).

| Partie | Rubriques (`id`) |
| --- | --- |
| `demarrer` Démarrer | `bienvenue`, `se-connecter`, `se-reperer`, `profils`, `principes`, `journee-type` |
| `parcours` Parcours pas à pas | `parcours-accueillir`, `parcours-rendez-vous`, `parcours-examen`, `parcours-ordonnance`, `parcours-suivi`, `parcours-vente`, `parcours-devis`, `parcours-remise-article`, `parcours-correction`, `parcours-caisse`, `parcours-stock`, `parcours-gestion` |
| `guides-profils` Guides par profil | `guide-accueil`, `guide-professionnel`, `guide-caisse`, `guide-gerante` |
| `notions` Notions et règles | `notion-patient`, `notion-visite-examen`, `notion-examen-prescription`, `notion-documents`, `notion-securite`, `notion-modules`, `notion-facture`, `notion-encaissement`, `notion-caisse`, `notion-stock`, `notion-approbations` |
| `glossaire` Glossaire | `glossaire-optique`, `glossaire-gestion` |
| `depannage` Dépannage | `depannage-messages`, `depannage-questions`, `depannage-limites` |
| `mise-en-service` Mise en service | `avant-installation`, `premiere-configuration`, `repetition-generale`, `exploitation` |

La partie « Mise en service » est réservée aux comptes qui gèrent le personnel (`users.manage`) : c'est la préparation de la gérante et du prestataire avant l'ouverture chez la cliente.

## Guide de rédaction

À relire avant d'écrire ou de modifier un texte.

**Pour qui.** Le personnel du cabinet : gérante, accueil, professionnel, caissière. Elles ne sont pas informaticiennes, elles sont souvent pressées et ont le patient devant elles. Le texte doit se lire en trente secondes et se suivre sans formation.

**Voix.** Vouvoiement, présent, voix active, phrases de 25 mots au plus, un seul geste par étape. Dire ce que la personne fait (« Cliquez sur », « Saisissez », « Choisissez »), puis ce qu'elle obtient. Pas de « il suffit de », pas de « simplement ».

**Libellés.** Chaque bouton, lien, champ, onglet ou message de l'écran est recopié EXACTEMENT, entre guillemets français « … », avec la même casse, les mêmes accents et l'apostrophe typographique (’). Un test vérifie que chaque libellé cité existe dans l'application. Ne jamais utiliser « … » pour autre chose qu'un libellé ou un message d'écran.

**Vocabulaire financier.** Dire « encaissé », « reste à encaisser », « émise », jamais « payé », « soldé », « acquitté » ni « gratuit » (l'application ne l'affirme pas : un test l'interdit dans l'aide). Une facture émise ne se modifie plus ; une erreur se corrige par une pièce de correction. Un reçu n'est jamais renuméroté.

**Vocabulaire clinique.** « Non renseigné », « Non » et « Aucun connu » sont trois choses différentes. OD (œil droit) avant OG (œil gauche), OU (les deux yeux) seulement pour l'acuité. Aucun conseil médical, aucun diagnostic : l'application enregistre, elle ne décide pas.

**Honnêteté.** Ne décrire que ce que l'application fait aujourd'hui, vérifié dans le code. Ce qui est codé mais pas ouvert est marqué `validation`. Ce qui n'existe pas (travail sans Internet, envoi automatique de SMS ou de WhatsApp, atelier, exports comptables) n'est jamais présenté comme disponible : il figure, dit comme tel, dans « Ce que cette version ne fait pas encore ».

**Qui fait quoi.** Nommer le profil quand le geste change : « la gérante », « la caissière », « l'accueil », « le professionnel ». Une action réservée porte `anyPermission` pour que les autres comptes ne la voient pas.

**Pas de jargon.** Ni « API », ni « base de données », ni « jeton », ni « cache », ni « synchronisation » sans explication. Les termes d'optique (sphère, cylindre, axe, addition, écart pupillaire…) sont définis dans le glossaire et expliqués à leur première apparition dans la rubrique.

**Données d'exemple.** Fictives seulement : noms inventés, montants ronds (80 000 FCFA), numéros du type EE-2026-0001. Jamais de donnée réelle (dépôt public).

**Longueurs.** Voir le tableau de la fiche d'écran. Une rubrique de la documentation globale tient en deux écrans au plus ; au-delà, la couper en deux rubriques.

## Gardes automatiques (`tests/frontend/help/`)

- chaque route nommée de `router.ts` (hors écrans publics) a une fiche, et chaque fiche correspond à une route ;
- `module` et `anyPermission` d'une fiche égalent ceux de la route ; les droits cités existent dans `database/02_reference_data.sql` ; les profils du glossaire des droits (`profiles.ts`) égalent le semis des profils ;
- chaque libellé cité entre « … » existe dans le code de l'application (ou dans les données de référence) ; une exception se déclare dans `LABEL_EXCEPTIONS` avec sa raison ;
- chaque lien `route` mène à une route sans paramètre, chaque lien `topic` à une rubrique existante, chaque identifiant est unique ;
- aucun texte ne dit « payé », « soldé », « acquitté » ni « gratuit », ne promet le travail sans Internet ni l'envoi automatique de messages, et ne contient de marque de travail inachevé ;
- les limites de longueur et la présence des rubriques obligatoires (`purpose`, au moins une action ou une tâche).

## Ajouter ou modifier l'aide d'un écran

1. Livrer l'écran (route, composant, tests) comme d'habitude.
2. Ajouter sa fiche dans le fichier `content/pages-*.ts` de son domaine (même nom que la route). Sans fiche, le test de couverture échoue.
3. Vérifier chaque libellé sur l'écran réel ; copier-coller plutôt que retaper.
4. Si l'écran change un parcours, mettre à jour la rubrique `parcours-…` ou `notion-…` concernée.
5. Lancer `npx vitest run tests/frontend/help` puis la vérification de phase habituelle.

Un écran modifié sans mise à jour de sa fiche est un défaut de livraison : l'aide trompe plus qu'elle n'aide quand elle est périmée.

## Statut (2026-10-29)

- **Couverture** : 51 fiches d'écran (toutes les routes nommées, dont `connexion` et `deverrouiller`) et 43 rubriques en 7 parties. Les écrans du travail sans Internet (`parametres-poste`, `conflits-synchronisation`, `deverrouiller`) sont en `maturity: 'validation'` : l'aide ne promet rien.
- **Preuves** : gardes automatiques de `tests/frontend/help/` (libellés, routes, droits, liens, vocabulaire, promesses) et 18 parcours e2e (`help.spec.ts`, `manager-tools.spec.ts`, copie isolée du dépôt, 360 px compris) verts.
- **Limites connues** : les libellés, routes et droits sont contrôlés automatiquement ; les gestes et règles décrits (qui peut quoi, ordre des étapes) ont été écrits d'après le code et les documents, sans seconde relecture. À corriger au fil de l'eau si un écran réel les contredit (la fiche de l'écran se met à jour avec l'écran).
- **À faire plus tard** : feuille de style d'impression de la coquille (`App.vue`) pour imprimer une seule rubrique ; titre d'onglet de la route `aide` (« Aide ») aligné sur le titre de l'écran.

# Tâche U01 — Corriger l’usage et les impressions sur appareils ciblés

Date : 2026-11-07. Fiche 24 (U01) : parcours opérateur chronométré ; 360 px, tablette, 1366 px, clavier, zoom 200 % ; impression réelle et déverrouillage/reprise sur les navigateurs convenus. Sortie vérifiable : patient puis facture et reçu sans ressaisie ; caisse et tableaux lisibles ; défauts bloquants d’usage corrigés. Scénarios AT28, AT29, AT36, AT37 ; exigences EE043 et EE044.

**État : IN_REVIEW, PARTIEL — ni DONE, ni arbitrable sans le matériel du cabinet.** Ce qui s’automatise dans un vrai navigateur est prouvé plus bas : parcours opérateur chronométré (AT29), 23 écrans à quatre tailles (AT28), clavier, focus non masqué ; et un défaut d’usage trouvé par cette preuve est corrigé. Ce qui exige du matériel ou des personnes n’est PAS fait : impression sur l’imprimante réelle du cabinet (A4 et ticket 80 mm), navigateurs et appareils convenus avec la cliente (aucune liste n’a été fournie), chronométrage par une vraie personne de l’accueil. Les spécifications ne fixent AUCUN objectif chiffré d’usage (durée, nombre de clics) : les mesures ci-dessous sont une base de départ, pas un succès ou un échec. Le protocole à rejouer sur le matériel est en fin de document.

## Build et environnement

| Élément | Valeur |
| --- | --- |
| Branche | `claude/u01-usage`, coupée de `origin/main` (`babacc5`, qui contient O06, O05, R01, G2 et P04) |
| Poste de preuve | Windows 11 Enterprise (NT 10.0.26300), PHP 8.4.21, Node 24.15.0, Microsoft Edge 156 piloté par Playwright 1.64.0 (Chromium, souris et clavier, pas d’émulation tactile), MySQL 8.4.9 (`tools/dev/mysql-windows.ps1`, port 3316) |
| Charge du poste | Processeur saturé pendant TOUTES les mesures (97 à 100 % selon le système, par d’autres programmes du poste partagé : compilation TypeScript d’un autre projet, outils de l’utilisateur) ; le serveur de test traite une requête à la fois. 38 parcours voisins ont mis 24 minutes et trois ont dépassé leurs 60 s, voir « Vérification transversale » |
| Application | Construite (`npx vite build`), servie par `php -S` sur la base `eeo_e2e_test` remise à zéro par `prepare-env.mjs` ; modules ouverts pour l’e2e seulement |
| Test ajouté | `tests/e2e/usability.spec.ts` (10 tests, un seul fichier sérié : les balayages jugent les données des parcours précédents) |
| Correctif | `resources/frontend/styles/base.css` : marge de défilement en bas sous 768 px (voir « Défaut trouvé et corrigé ») |
| Données | Exclusivement fictives (compte de démonstration de la gérante, articles `DEMO-*`, patiente inventée) |

## Prérequis

| Tâche | Statut | Preuves |
| --- | --- | --- |
| P04 (parcours entre profils sur le poste principal) | IN_REVIEW | `docs/runbooks/profile-flow.md`, `tests/e2e/profile-flow.spec.ts` ; fusionnée dans `main` le 2026-11-07 |
| R01 (finance du cabinet sur une période) | IN_REVIEW | `tests/e2e/finance.spec.ts` ; fusionnée dans `main` le 2026-11-07 |
| R02 (statistiques de l’activité et des examens) | IN_REVIEW | écran `/rapports/statistiques`, balayé ci-dessous |
| S02 (contrôles recommandés et tâches de contact) | IN_REVIEW | écran `/suivis`, balayé ci-dessous |
| D02 (modèles cliniques et PDF) | IN_REVIEW | `tests/frontend/documents/layout.test.ts`, `charset.test.ts`, `tests/e2e/documents.spec.ts` |

## Ce que U01 a ajouté dans le navigateur réel

### Parcours 1 — Patient, facture et encaissement sans ressaisie ; l’impayé retrouvé sur téléphone (AT29)

`usability.spec.ts`, « AT29 : patient, facture et encaissement sans ressaisie, mesures ; la gérante retrouve l’impayé sur téléphone ». Chaque geste est compté par un « opérateur » de test (clics, champs remplis, touches frappées), chaque étape est chronométrée ; les lignes `MESURES-U01` de la sortie du test donnent les valeurs ci-dessous.

1. **Créer le patient** : nom composé et prénoms accentués (`NGOUMOU-TCHAMBA <numéro>`, « Marie-Claire Françoise »), sexe, date de naissance, téléphone, « Enregistrer le patient ».
2. **Préparer la facture depuis la fiche** : « Créer une facture » reprend l’identité (aucun champ nom, prénom, date de naissance ou téléphone n’existe sur l’éditeur de facture ; le nom et les prénoms accentués s’y lisent tels que saisis) ; deux articles du catalogue (monture 40 000, examen 15 000), « Total TTC : 55 000 FCFA », « Enregistrer le brouillon ».
3. **Émettre la facture** : bouton puis fenêtre de confirmation ; numéro `TEST-FAC-…`, « Reste à encaisser : 55 000 FCFA », identité figée avec accents exacts.
4. **Encaisser un acompte de 20 000** (mobile money, référence) : « Encaissement enregistré sur le serveur », « Reste à encaisser maintenant : 35 000 FCFA », reçu `TEST-REC-…`.
5. **Gérante, sur téléphone (360 × 740)** : liste des factures, filtre « Émises », la ligne de la patiente annonce « reste à encaisser : 35 000 FCFA » ; un clic ouvre la facture (« Total encaissé 20 000 FCFA », « Reste à encaisser : 35 000 FCFA ») sans saisir de numéro ; l’écran passe le contrôle de mise en page.

| Étape | Durée de machine | Clics | Champs | Touches |
| --- | --- | --- | --- | --- |
| Créer le patient | 20,1 s | 2 | 4 | 71 |
| Préparer la facture depuis la fiche | 15,5 s | 4 | 2 | 16 |
| Émettre la facture | 7,4 s | 2 | 0 | 0 |
| Encaisser un acompte de 20 000 et obtenir le reçu | 14,3 s | 2 | 2 | 23 |
| **Parcours opérateur (les quatre étapes)** | **57,3 s** | **10** | **8** | **110** |
| Gérante, téléphone : retrouver l’impayé (filtre, ligne, ouverture) | 13,7 s | 2 | 0 | 0 |

Lecture : les durées sont celles de la MACHINE (navigateur, serveur de test à une requête à la fois, MySQL) sur un poste partagé dont le processeur était saturé par d’autres programmes (processeur à 97–100 %) ; deux autres exécutions des mêmes quatre étapes ont donné 22 s (7 s, 8 s, 3 s, 5 s) puis 47 s : les MÊMES 10 clics, 8 champs et 110 touches, trois fois plus ou moins de temps selon la charge du poste. Elles ne mesurent PAS une personne : un chronométrage humain sur le matériel du cabinet reste à faire (protocole en fin de document). Le test n’impose qu’une borne de 60 s par étape contre une lenteur pathologique : aucun objectif d’usage n’est écrit dans les spécifications, il n’y en a donc pas à valider ni à inventer.

### Parcours 2 — Écrans lisibles sur téléphone, tablette, ordinateur et zoom 200 % (AT28)

`usability.spec.ts`, un test par taille : 360 × 740 (téléphone), 683 × 384 (zoom 200 % d’un écran 1366 × 768, émulé par la taille de la fenêtre CSS), 768 × 1024 (tablette), 1366 × 768. Chaque test se connecte comme la gérante et ouvre 23 écrans, puis attend que l’écran soit prêt (titre présent ET plus aucun « Chargement » dans le contenu) :

Accueil ; Aujourd’hui ; Enregistrer une arrivée ; Patients ; Nouveau patient ; fiche de la patiente du parcours 1 (nom composé, accents) ; Ventes et caisse ; Caisse ; Caisse du jour ; Finance du cabinet ; Factures ; Facture à préparer ; Facture émise avec reste à encaisser ; Facture de 1 500 000 FCFA (sept chiffres, créée, émise et encaissée en partie par un test dédié) ; Devis ; Catalogue ; Stock ; Consultations ; Suivis ; Agenda ; Statistiques ; Paramètres ; Poste.

Le contrôle de mise en page (`audit()` dans le test) juge chaque écran :

- aucun défilement horizontal de la page ;
- chaque commande visible (bouton, champ, liste, zone de texte, lien hors texte courant) mesure AU MOINS 44 px de haut, et reste entre les bords de l’écran (cases à cocher, boutons radio, liens au fil d’un texte et éléments cachés visuellement exemptés ; le lien « Aller au contenu » est contrôlé par le test clavier, quand il a le focus) ;
- chaque montant en FCFA est entièrement dans la fenêtre et n’est coupé par aucun conteneur qui masque son débordement.

| Taille | Écrans | Commandes contrôlées | Montants contrôlés | Écrans avec défaut |
| --- | --- | --- | --- | --- |
| Téléphone 360 px | 23 | 401 | 64 | 0 |
| Zoom 200 % d’un écran 1366 px (683 px) | 23 | 401 | 64 | 0 |
| Tablette 768 px | 23 | 424 | 64 | 0 |
| Ordinateur 1366 px | 23 | 424 | 64 | 0 |

**Le contrôle sait échouer.** Un test témoin donne au contrôle une page fabriquée avec un bouton de 30 px, une commande qui dépasse l’écran, une barre de 900 px, un montant qui dépasse et un montant coupé par un conteneur : les cinq sortes de défaut sont signalées, le bouton de 44 px et le lien caché ne le sont pas, et le contrôle compte exactement ce qu’il a examiné (3 commandes, 2 montants). Chaque balayage exige en plus que chaque écran montre des commandes et que les écrans d’argent (caisse du jour, finance, liste des factures, deux factures) montrent des montants : un balayage qui ne verrait rien échouerait.

**Relecture visuelle.** Les 92 captures d’une exécution du balayage (mêmes 23 écrans, une par écran et par taille, `EEO_USABILITY_SHOTS=<dossier>`, jamais versionnées, avant le correctif de marge de défilement qui ne change pas ces écrans) ont été produites ; les captures à 360 px de la facture de 1 500 000 FCFA, de la fiche de la patiente, de la caisse du jour, du stock, de la finance du cabinet et des statistiques ont été relues à l’œil : le nom composé passe sur trois lignes sans coupure, les montants à sept chiffres tiennent, les tableaux deviennent des cartes ou gardent leurs colonnes lisibles, les boutons sont pleine largeur.

### Parcours 3 — Clavier seul (AT28)

`usability.spec.ts`, « AT28 clavier : fiche patient, facture et émission sans souris ».

1. Premier arrêt de la touche Tab : le lien « Aller au contenu » apparaît entièrement dans la fenêtre ; Entrée place le curseur sur le contenu (`#contenu`), comme l’aide intégrée le promet.
2. Fiche patient : l’ordre de tabulation suit l’ordre de lecture (prénoms, sexe, date de naissance, téléphone, « Enregistrer le patient ») ; Entrée enregistre.
3. Facture : « Créer une facture » (Entrée), recherche d’un article dans la liste de choix (frappe, flèche bas, Entrée), « Enregistrer le brouillon » (Entrée), « Émettre la facture » (Entrée).
4. La fenêtre d’émission est modale : le focus y entre, huit tabulations ne le laissent jamais tomber sur la page derrière, Échap la referme SANS émettre (aucun numéro de facture).
5. Émission au clavier, « Encaisser le reste » (la saisie reçoit 15 000), choix du mode par la frappe de son nom, référence, Entrée : « Reste à encaisser maintenant : 0 FCFA ».

### Défaut trouvé et corrigé — le champ qui prend le focus se cachait derrière la barre du bas

`usability.spec.ts`, « AT28 clavier, … : le champ qui prend le focus n’est jamais caché derrière la barre du bas » (téléphone 360 px, puis zoom 200 %). Le test parcourt au clavier quatre écrans à formulaire (nouveau patient, facture à encaisser, stock, caisse) et, à chaque tabulation, interroge le point central de la partie visible de l’élément qui a le focus : s’il est recouvert par la barre de raccourcis fixée en bas du téléphone, il est caché (WCAG 2.2, critère 2.4.11).

- **Avant le correctif** : 8 arrêts sur 52 cachés à 360 px. La barre commence à 675 px dans une fenêtre de 740 px ; ces éléments se tenaient entre 696 et 740 px, donc ENTIÈREMENT sous la barre : liste « Sexe », un champ et une zone de texte du formulaire patient, la zone de texte du stock initial, « Ouvrir la caisse », « Encaisser le reste (1 000 000 FCFA) », et le lien « Vérifier les mises à jour » du pied de page (deux fois). Cause : le navigateur ne fait défiler que le strict nécessaire pour montrer un élément qui prend le focus et le laisse contre le bord de la fenêtre, derrière la barre. Le même défilement minimal s’applique au bouton « Suivant » d’un clavier tactile (non essayé sur un vrai téléphone).
- **Correctif** : `html { scroll-padding-bottom: 6rem }` sous 768 px, là où la barre existe (`resources/frontend/styles/base.css`, à côté de la règle déjà posée pour le bandeau de mise à jour). 96 px gardent le champ, son contour de focus et son aide au-dessus de la barre de 65 px, jusqu’au zoom 200 % (683 px de large, toujours sous le seuil de 768 px).
- **Après le correctif** : 0 arrêt caché sur 52, à 360 px comme à 683 px (zoom 200 %) ; avant, 8 sur 52 à 360 px.

Vérifié sur Chromium (Edge 156) seulement : Firefox et Safari n’ont pas été essayés (voir les écarts).

## Couverture existante, non rejouée par U01

- **A4 long, totaux non coupés, accents et signes exacts dans les PDF** (fin de l’AT28) : `tests/frontend/documents/layout.test.ts` (pagination des tableaux, bloc de totaux jamais seul sur une page, longue désignation qui passe à la ligne dans sa cellule, espace insécable de « 80 000 FCFA ») et `charset.test.ts` (français accentué, guillemets et apostrophe typographique conservés, caractères hors jeu remplacés ET signalés). `tests/e2e/documents.spec.ts` vérifie que le PDF se génère sur le poste, sans sortir de l’origine, et se télécharge en vrai PDF.
- **Coquille aux quatre largeurs (AT28 de F09)** : `shell.spec.ts` (aucun défilement horizontal, commandes d’au moins 44 px, premier arrêt du clavier « Aller au contenu », ordre de tabulation, texte de 16 px) ; U01 étend ce contrôle aux écrans d’exploitation.
- **Débordement à 360 px d’écrans précis** : `today.spec.ts`, `patients.spec.ts`, `agenda.spec.ts`, `consultation.spec.ts` (éditeur de consultation), `billing.spec.ts` ; **alignement des boutons et des champs, police large** : `forms-layout.spec.ts`.
- **AT36 et AT37 (poste préparé sans réseau, facture, acompte, solde, PDF)** : `offline-start.spec.ts`, `offline-invoice.spec.ts`, `offline-directory.spec.ts`, `profile-flow.spec.ts` et la preuve G1 (`docs/evidence/G1.md`), sur Chromium/Edge. Ils n’ont pas été rejoués sur d’autres navigateurs.

## Écarts déclarés (ce que U01 NE prouve PAS)

1. **Impression réelle non faite.** Aucune imprimante A4 ni de ticket 80 mm n’était disponible. Sont prouvés : le PDF généré (octets valides, pages A4, ticket continu) et sa mise en page (tests Vitest), l’aperçu à l’écran et le bouton « Imprimer » qui ouvre le PDF dans la visionneuse du navigateur d’où l’on imprime (Ctrl+P). Pas prouvés : marges et échelle réelles, découpe du ticket, rendu des polices de l’imprimante, comportement de la visionneuse de chaque navigateur, blocage des fenêtres surgissantes.
2. **Navigateurs et appareils convenus : non définis, non essayés.** Aucune liste n’a été fournie par la cliente. Seul Edge 156 (Chromium) a été piloté, avec des fenêtres de tailles données ; Firefox, Safari, Chrome d’un vrai téléphone ou d’une vraie tablette ne l’ont pas été. Les gestes tactiles (doigt, clavier à l’écran, bouton « Suivant ») ne sont pas simulés : la cible de 44 px est mesurée, pas touchée.
3. **Zoom 200 % approché.** Une fenêtre de 683 × 384 px imite le zoom 200 % d’un écran de 1366 × 768 ; le vrai zoom du navigateur change aussi le rendu du texte et la taille de police minimale.
4. **Chronométrage de machine, pas de personne.** Voir l’en-tête de ce document et le parcours 1. Aucun retour d’opératrice réelle n’existe encore : le seul défaut corrigé est celui que l’automatisation a trouvé. « Retours corrigés » (AT29) reste à compléter après la première semaine d’usage.
5. **Écrans non balayés.** Le balayage est celui de la gérante (qui voit tous les écrans), en ligne. Ne sont pas balayés : le menu et les écrans du poste hors ligne (accueil, patients), les écrans internes de l’éditeur de consultation (un contrôle de débordement existe dans `consultation.spec.ts`), les écrans à fortes volumétries (centaines de lignes), les fenêtres de dialogue autres que l’émission, le mode contraste forcé, les lecteurs d’écran.
6. **Aucune mesure de l’effort réel en cabinet** (interruptions, patients présents, lumière, reflets d’écran, gants) : hors de portée de l’automatisation.

## Protocole à rejouer sur le matériel du cabinet (à renseigner par le demandeur ; rien n’est inventé ici)

À faire sur chaque appareil et chaque navigateur convenus avec la cliente, sur un build identifié (pied de page de chaque écran : « build … »), avec les données fictives de démonstration, la gérante puis une personne de l’accueil et une personne de la caisse :

1. **Parcours AT29**, chronomètre en main, deux fois (la seconde pour la courbe d’apprentissage) : créer une patiente, préparer la facture (monture, examen), l’émettre, encaisser un acompte, imprimer le reçu ; puis, sur téléphone, retrouver l’impayé depuis le menu. Noter la durée, les hésitations et toute ressaisie.
2. **Impression** : facture A4 de plus d’une page, reçu A4, ticket 80 mm, prescription optique ; vérifier marges, totaux entiers, accents, signes, numéros ; noter l’imprimante (modèle, pilote), le navigateur et son réglage « Mise à l’échelle ».
3. **Poste préparé sans réseau** (AT36, AT37) : couper le réseau, fermer et rouvrir le navigateur, déverrouiller, créer une patiente, émettre et encaisser, imprimer, rétablir le réseau, envoyer ; sur chaque navigateur convenu.
4. **Écrans** : 360 px (vrai téléphone), tablette, 1366 px, zoom 200 % du navigateur ; clavier seul ; noter tout champ caché, tout texte coupé, tout bouton difficile à toucher.

| Appareil et système | Navigateur et version | Imprimante | AT29 (durée, retours) | Impression | AT36/AT37 | Écrans | Date et personne |
| --- | --- | --- | --- | --- | --- | --- | --- |
| à renseigner | à renseigner | à renseigner | à renseigner | à renseigner | à renseigner | à renseigner | à renseigner |

Fichier 25 : « Recette humaine + captures sur build identifié » ; G3 et G4 réclament l’imprimante réelle (« Ajouter imprimante réelle lors de D01/U01/G4 »). Cette preuve ne tient pas lieu de cette recette.

## Vérification transversale

| Contrôle | Résultat |
| --- | --- |
| Types (`npx vue-tsc --noEmit`) | sans erreur |
| ESLint (`npx eslint .`) | sans erreur ni avertissement |
| Vitest (`npx vitest run`) | 164 fichiers, 3 324 tests passés, 20 ignorés, avec des délais de 30 s ; avec les 5 s par défaut, un premier passage a vu 3 tests expirer (la suite a pris 333 s) sur le poste saturé, sans lien avec cette tâche (aucun fichier TypeScript de l’application n’est modifié) |
| e2e voisins du correctif de défilement (`forms-layout`, `help`, `patients`, `shell`) | 38 tests : 35 réussis ; 3 ont dépassé leurs 60 s (poste saturé) : les deux de `forms-layout` rejoués seuls réussissent, celui de `patients` (« lecture seule ») réussit rejoué sur une base remise à zéro (rejoué sur une base qui garde la fiche créée par le premier essai, il échoue sur la détection de ressemblance, comportement connu : un patient et un numéro par essai) |
| PHP (Pint, PHPStan, PHPUnit) | non rejoué : U01 ne modifie aucun fichier PHP |
| Prettier | appliqué au test, au CSS et aux documents modifiés |

## Contrôle par mutation

- Le test « focus non masqué » a ÉCHOUÉ sans le correctif (8 arrêts sur 52 cachés) puis réussi avec lui (0 sur 52 à 360 px et à 683 px) : la preuve est celle d’un avant et d’un après sur le même test.
- Le témoin du contrôle de mise en page prouve que `audit()` détecte ses cinq sortes de défaut et n’en signale pas à tort.

## CI

À lire sur la branche (ligne ajoutée à sa lecture).

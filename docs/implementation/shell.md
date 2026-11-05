# Coquille responsive et composants réutilisés (F09)

Tâche F09 du backlog (L0, prérequis F02 ; regroupement L0-14). Sorties attendues : coquille
accessible et agréable, **aucun menu de module futur présenté comme livré**, composants utilisables
dans les écrans patient et caisse. Validation : contrastes, focus, clavier et largeurs d'écran
(fichier 04, AT28, AT29, EE044).

## Fichiers

| Domaine | Fichiers |
| --- | --- |
| Palette et règles de base | `resources/frontend/styles/tokens.css`, `resources/frontend/styles/base.css`, importés par `resources/frontend/app/styles.css` |
| Coquille | `resources/frontend/app/App.vue`, `router.ts`, `bootstrap.ts`, `navigation.ts`, `session.ts`, `api.ts`, `network.ts`, `unsavedChanges.ts` |
| Écrans de la coquille | `resources/frontend/pages/{LoginPage,HomePage,ForbiddenPage,NotFoundPage}.vue` |
| Composants | `resources/frontend/components/ui/{AppButton,LinkButton,AppIcon}.vue`, `layout/{PageHeader,SectionCard,StatTile,StatusChip,EmptyState}.vue` (présentation des écrans, voir « Identité visuelle »), `form/{FieldShell,TextField,DecimalField,MoneyField,DateField,SelectField,ComboboxField}.vue`, `form/{classes,format}.ts`, `feedback/{ErrorSummary,ConfirmDialog,SaveStatus,StateMessage,NetworkStatus}.vue`, `clinical/OpticalTable.vue`, `finance/AmountSummary.vue` |
| Tests | `tests/frontend/bootstrap.test.ts`, `tests/frontend/shell/*.test.ts` (serveur simulé `server.ts`), `tests/frontend/components/*.test.ts`, `tests/e2e/shell.spec.ts`, `tests/e2e/support/accounts.ts` |

## Navigation : seulement ce qui est livré et autorisé

`navigation.ts` déclare les dix modules du fichier 04 (Aujourd'hui, Patients, Consultations, Agenda,
Ventes et caisse, Stock, Atelier, Communication, Rapports, Paramètres) et les six actions d'accueil
du modèle de dossier (Nouveau patient, Rechercher, Rendez-vous, Consultations du jour, Statistiques,
Paramètres). Chaque entrée porte :

- `permissions` : codes du référentiel seedé, l'un suffit. Le serveur revérifie chaque action ;
- `deliveredBy` : la tâche du backlog qui livre l'écran ;
- `delivered` : `false` pour toutes les entrées dans cette version.

Une entrée n'apparaît que si elle est livrée **et** autorisée. Sans aucune entrée visible, aucune
navigation n'est affichée et l'accueil le dit (« Aucun module métier livré pour l'instant »). Si des
écrans sont livrés mais qu'aucun n'est ouvert au compte, l'accueil dit « Aucune action ouverte à ce
compte » : il ne parle pas de livraison.

**Livrer un écran**, c'est passer son entrée à `delivered: true` dans la même modification que la
route, l'écran et ses tests, puis mettre à jour `navigation.test.ts`. Ce test vérifie que :

- chaque `deliveredBy` est une tâche de `backlog.json` ;
- chaque permission existe dans `database/02_reference_data.sql` ;
- l'ordre suit le fichier 04 ;
- aucune entrée n'est livrée aujourd'hui.

Les chemins des entrées non livrées sont indicatifs : la tâche qui livre l'écran fixe le sien.

Sur ordinateur (≥ 768 px), la barre latérale liste l'accueil puis les modules. Sur téléphone, la barre
du bas montre les raccourcis Aujourd'hui, Patients et Agenda, puis « Plus » pour les autres modules.
« Plus » est une liste dépliante native (`details`/`summary`, clavier et lecteurs d'écran natifs).
Elle se referme à l'ouverture d'un écran, ou avec Échap qui rend le focus à « Plus » ; sa liste est
bornée en hauteur et défile (téléphone en paysage, zoom 200 %). Une fois connecté, le titre de
l'en-tête est un lien vers l'accueil, sur toutes les largeurs. Tant qu'aucun écran n'est livré, la
navigation n'existe que dans les tests jsdom (catalogue fictif) : sa vérification dans un vrai
navigateur arrive avec le premier écran livré (P01, P02).

## Coquille

- **En-tête** : « Eagle’s Eye Optics Medical – Gestion des patients ». Le texte est écrit en casse
  normale et affiché en capitales par `uppercase`, pour qu'un lecteur d'écran le lise comme des mots.
  L'en-tête montre aussi l'état réseau, le compte connecté et « Se déconnecter ». La recherche rapide
  arrive avec la recherche de patients (P02) et l'état de synchronisation avec le journal du poste
  (F10, O04, O05) : ils ne sont pas simulés avant d'exister.
- **État réseau** (`NetworkStatus`) : « Hors ligne » quand le navigateur n'a plus de réseau. «
  Serveur injoignable » quand l'application n'a pas répondu : aucune réponse, ou une page d'erreur
  HTML de l'hébergeur ; une réponse JSON de l'application, même une erreur, prouve qu'elle répond.
  Sinon « En ligne ». La joignabilité est vérifiée par requête (`/up`, jamais par
  `navigator.onLine` seul) : toutes les 30 secondes tant que le serveur ne répond pas, toutes les 60
  secondes sinon, et au retour du réseau. Chaque état a un libellé et un symbole, et il est annoncé
  poliment. « En ligne » ne dit rien des pièces locales.
- **Session** (`session.ts`, session Sanctum du fichier 23) : `unknown`, `anonymous`,
  `authenticated` ou `unverified`. `unverified` veut dire que la session n'a pas pu être vérifiée :
  le serveur est muet ou répond par une erreur (5xx, maintenance). Ce n'est jamais pris pour une
  déconnexion. L'accueil dit lequel des deux cas se produit (« Serveur injoignable » ou « Session
  non vérifiée »). La coquille relit la session au retour du réseau, puis toutes les 30 secondes.
  `expired` : la session ouverte sur cet écran a reçu 401 ou 419 (saisies conservées, reconnexion sur place).
  `local` (vault.md D27) : aucune session du serveur n'est vérifiée et le profil du coffre de ce poste,
  déverrouillé par la personne sur l'écran public `/deverrouiller`, fait foi (droits de son grant signé,
  dernier résumé du cabinet connu) ; seuls les écrans marqués `offlineCapable` s'ouvrent, l'accueil dit
  pourquoi un autre reste fermé. Le serveur reprend la main dès qu'il répond avec une session ; son
  silence ou l'absence de session chez lui ne retire jamais le profil local.
- **Garde du routeur** : sans session, la connexion s'ouvre avec `suite` = le chemin demandé, sans
  ses paramètres de requête (aucun nom, téléphone ni filtre dans l'URL). Ce chemin peut contenir un
  identifiant opaque (ULID d'une facture), jamais une donnée personnelle ; après la connexion, seul
  un chemin interne est suivi. Une page protégée par des permissions ne
  s'ouvre que si la session est vérifiée : sinon l'accueil explique l'état. Une page dont le compte
  n'a pas la permission mène à « Accès refusé ». Pour un compte connecté, une adresse inconnue mène
  à « Page introuvable » ; sans session, à la connexion. Aucune URL métier non livrée n'ouvre
  d'écran vide.
- **Déconnexion** : l'écran en cours est d'abord quitté ; si sa garde de saisie est refusée, rien
  n'est fermé. Puis la connexion ne s'affiche qu'une fois la session fermée par le serveur. Sans
  réponse, ou sur une erreur, le compte reste affiché avec le message « Déconnexion impossible […]
  La session reste ouverte sur ce poste ». Sur un poste partagé, la personne suivante ne doit pas
  hériter d'une session que l'écran prétendrait fermée. Une session déjà expirée (401) est
  considérée fermée ; un jeton CSRF périmé (419) est renouvelé une fois.
- **Connexion** : vrais libellés, autocomplétion `username` et `current-password`, champs vides
  signalés sans appel au serveur. Un refus du serveur (422 sur `login`) s'affiche sous le champ et
  dans le résumé focalisé, et le mot de passe est à ressaisir. « Trop de tentatives » (429) et «
  Serveur injoignable » sont dits tels quels. Après la connexion, seul un chemin interne est suivi,
  jamais `//autre-origine`. Sur un navigateur qui a un coffre et sans identité connue, l'écran public
  `/deverrouiller` passe AVANT la connexion (vault.md, D14 et D27).
- **Accessibilité de la coquille** : lien « Aller au contenu » en premier arrêt du clavier. Après
  chaque navigation, sauf au premier affichage, le focus va au contenu principal pour que le lecteur
  d'écran annonce le nouvel écran. L'onglet prend le titre de l'écran (« Accueil – Eagle’s Eye
  Optics Medical »). Le défilement remonte en haut de l'écran. Le focus clavier est toujours visible
  (contour de 3 px doublé de blanc, règle commune `:focus-visible`) et aucun utilitaire ne peut le
  retirer ; seuls les champs de saisie ont leur propre contour, tout aussi visible (voir « Contrôles
  de saisie » ci-dessous).

## Composants pour les écrans patient et caisse

| Composant | Usage et garanties |
| --- | --- |
| `AppButton` | Libellé qui dit la conséquence ; cible ≥ 44 px ; pendant la commande : désactivé, `aria-busy`, libellé « … en cours » (l'idempotence reste la vraie protection) ; désactivé lisible (teintes pleines, jamais d'opacité) |
| `FieldShell` | Vrai `label` (`.field-label` : 14 px demi-gras, une ligne de 20 px), puis la saisie, puis l'erreur et l'aide **sous la saisie** : les saisies d'une rangée commencent à la même hauteur, avec ou sans aide (aide placée entre l'étiquette et la saisie avant le 2026-10-28, ce qui décalait le champ voisin), et l'erreur reste contre sa saisie même quand l'aide est longue. `CheckboxGroup`, `YesNoField` et `CheckboxField` suivent le même ordre. Reliées par `aria-describedby` (aide puis erreur : l'ordre de lecture ne change pas), `aria-invalid`, « (obligatoire) » écrit (13 px, rouge d'erreur), erreur avec symbole et texte ; l'étiquette passe à `gold-ink` quand le champ a le focus ; identifiant imposable (cible du résumé d'erreurs). Limite connue : une étiquette qui passe sur deux lignes décale la saisie de son voisin de rangée (aucun cas retenu par l'audit du 2026-10-29) |
| Contrôles de saisie (`controlClasses`, classe `field-control`) | Cible ≥ 44 px, texte de 16 px, remplissage horizontal de 12 px (`px-3`, celui des cellules étroites du tableau optique), bordure `field` (≥ 3:1), survol : bordure à l'encre ; focus : contour de 2 px à l'encre et halo doré décoratif, règle hors couche plus spécifique que le focus commun (le contour reste dessiné en contraste forcé) ; invalide : bordure, anneau et fond `danger-soft` en plus du message, et un focus qui reprend le dessin du focus commun en rouge (contour de 3 px décalé de 2 px, liseré blanc), car un contour posé sur la bande rouge du repos ne se verrait pas ; désactivé : teintes pleines lisibles |
| `TextField`, `SelectField` | Saisie conservée telle quelle ; `TextField` : `icon` facultatif (icône décorative au début du champ, par exemple le téléphone) ; `SelectField` : liste native avec option vide explicite (null), flèche remplacée par un chevron décoratif (`appearance-none`, `AppIcon`) |
| `DecimalField` | Mesures et quantités exactes par les règles F08 (virgule ou point) ; trop de décimales refusé, jamais arrondi ; vide = null, jamais 0 ; lu à la sortie du champ **et à Entrée** (avant l'envoi du formulaire) ; `commit()` exposé ; pavé décimal pour une valeur positive, clavier texte pour une dioptrie (le pavé décimal de l'iPhone n'a pas de « - ») |
| `MoneyField` | FCFA entiers (« 80 000 »), décimales et séparateurs ambigus refusés ; unité annoncée aux lecteurs d'écran (« FCFA » à droite, DANS le champ : la zone de saisie garde la largeur qu'avait le texte posé à côté, une colonne de 143 px laisse ≈ 69 px aux chiffres) ; affichage relu sans dérive |
| `DateField` | JJ/MM/AAAA, ISO ou 8 chiffres JJMMAAAA (pavé numérique de l'iPhone, sans « / ») ; date inexistante refusée ; jamais de date inventée |
| Saisie refusée (`DecimalField`, `MoneyField`, `DateField`) | Message sous le champ, saisie conservée pour correction, et valeur du parent remise à null : l'ancienne valeur valide ne part jamais à la place de ce que l'écran affiche ; le formulaire bloque l'envoi sur l'événement `invalid` ou le retour de `commit()` |
| `ComboboxField` | Choix avec recherche (catalogue, dossier) : motif combobox ARIA 1.2, recherche à partir de 2 caractères, ↓/↑ puis Entrée, Échap ferme ; rien n'est choisi à la place de l'utilisateur ; les résultats d'une saisie précédente disparaissent dès la nouvelle saisie et toute réponse obsolète est ignorée ; l'option active est ramenée dans la partie visible de la liste ; « Recherche indisponible » distinct de « Aucun résultat » ; résultats partiels avec avertissement (`{ options, notice }` : dossiers préparés sur ce poste quand la recherche serveur est indisponible). La source des résultats est fournie par l'écran (F10) |
| `ErrorSummary` | Résumé focalisé quand de nouvelles erreurs apparaissent ; chaque erreur mène à son champ ; `focus()` exposé pour un nouvel échec identique |
| `ConfirmDialog` | `<dialog>` modal natif (reste de la page inerte) ; focus initial sur l'action, ou sur « Annuler » pour une action risquée ; focus rendu au déclencheur ; Échap annule par le parent, sauf pendant la commande ; pendant la commande, focus gardé dans la boîte et libellé propre (`pendingLabel`) ; fermeture imposée par le navigateur signalée au parent, ou boîte rouverte pendant la commande |
| `SaveStatus` | « Enregistré sur ce poste à 10h42 » (heure du cabinet), « Synchronisé avec le serveur », « Échec de l'enregistrement : vos saisies restent affichées » ; il affiche l'état fourni, ne le déduit pas |
| `StateMessage` | États du fichier 04 : chargement, vide, succès, erreur, conflit, droits insuffisants, connexion indisponible ; rôle `alert` pour erreur et conflit ; symbole et titre, jamais la seule couleur |
| `OpticalTable` | OD toujours avant OG, OU seulement sur demande (acuité) ; libellé complet par champ (mesure, unité, œil) ; grille sur grand écran, blocs OD puis OG sur téléphone ; aucune recopie d'un œil à l'autre ; cellule dioptrie par défaut, autre nature (axe, acuité, hauteur) par la fente `cellule-<clé>` dont les règles appartiennent à C02/C04 |
| `AmountSummary` | Total, Versé, Reste (reste mis en évidence) en FCFA entiers ; aucun solde calculé par le composant (projection ou serveur) ; colonnes à la taille de leur contenu qui passent à la ligne, jamais de chevauchement ni de coupe (mise en page vérifiée par l'e2e de l'écran qui l'emploiera, B02–B04) |
| `useUnsavedChangesGuard` | Quitter un écran avec une saisie non enregistrée demande confirmation : navigation interne, même écran avec un autre paramètre (`/dossier/1` → `/dossier/2`), fermeture de l'onglet ; rien n'est conservé ailleurs |

Un composant ne lit ni n'écrit aucune table locale et n'appelle aucune API métier lui-même : les
écrans passent par les services de lecture et le répartiteur de mutations (F10). Les gardes
statiques interdisent `localStorage` et `sessionStorage` et toute ressource distante (fonte, style,
script, appel).

## Identité visuelle (charte du logo, 2026-10-23)

Le demandeur a fourni le logo de la marque (aigle, « EAGLE'S EYE OPTICS — SEE BEYOND ») : il remplace
la proposition de palette du fichier 04, faite « sans charte fournie ». Fichiers :

| Fichier | Usage |
| --- | --- |
| `resources/frontend/assets/brand/eeo-logo.svg` | Marque complète (préférée par le demandeur) : grande sur la connexion, réduite dans l'en-tête, dans le bandeau d'accueil. Importée par Vite (hachée, précachée : `globPatterns` inclut `svg`). |
| `resources/frontend/assets/brand/eeo-mark.svg` | Aigle seul (carré) : favicon (`public/icons/favicon.svg`) et icônes PWA (`icon-192`, `icon-512`, `icon-maskable-512`, aigle dans la zone de sécurité). |

Les deux SVG sont extraits du fichier vectoriel d'origine (Illustrator) : cadre et bandeau de
coordonnées (téléphone, adresse) **retirés du fichier**, pas seulement masqués. Le logo n'est jamais
recoloré. L'identité affichée du cabinet (nom, adresse, mentions) vient des paramètres, jamais du logo.

**Règles de mise en page.** Fond très légèrement chaud, surfaces blanches en cartes à bordure fine
(`rounded-xl border border-line bg-surface shadow-card`), ombres légères (`--shadow-card`,
`--shadow-raised`), coins `--radius-lg` / `--radius-xl`. Action principale à l'encre (boutons pleins
noirs), boutons secondaires blancs à bordure de champ. L'or est un ACCENT : filet doré en haut de
l'en-tête, court filet sous chaque titre d'écran (`#contenu h1`, couche `base`), repère de l'entrée de
navigation active (filet gauche + fond doré léger + gras), onglet actif, pastilles d'icônes, état
« vide » ou « chargement », bordure haute des dialogues, option choisie (puces Oui / Non et cases à
cocher en pastilles : fond doré léger et bordure dorée, en plus de la case). Icônes : SVG au trait
dessinés pour l'application (`components/ui/AppIcon.vue`, correspondances dans
`app/navigationIcons.ts`), décoratives (`aria-hidden`), jamais seules porteuses du sens. Messages
d'état : carte avec filet gauche de la couleur de l'état et symbole dans une pastille. Aucun texte,
libellé, rôle ni nom accessible n'a changé avec la charte.

### Briques de présentation des écrans (`components/layout/`)

Composants de présentation purs, communs à tous les écrans : aucun appel serveur, aucun droit
vérifié (l'écran ne leur passe que ce qui est ouvert au compte), aucune teinte hors des jetons. Un
écran qui les adopte garde **à l'identique** ses textes visibles, titres, `id`, rôles ARIA, noms
accessibles et `data-testid` (ciblés par `tests/e2e` et `tests/frontend`) ; il remplace son propre
balisage, il ne l'emballe pas (pas de deuxième région ou titre du même nom).

| Composant (`@/components/layout/…`) | Props | Fentes | Garanties |
| --- | --- | --- | --- |
| `PageHeader.vue` | `titleId` (obligatoire), `title`, `subtitle`, `icon`, `eyebrow`, `back` (`{ to, label }`, type `PageBackLink`) | `title` (contenu du `h1`), défaut (puces, précisions sous le sous-titre), `actions` | Vrai `h1` au texte fourni, `id` = `titleId` (cible de l'`aria-labelledby` de la section de l'écran), filet doré de `#contenu h1` ; pastille d'icône dorée décorative ; lien de retour de 44 px au-dessus du titre ; actions à droite dès 640 px, dessous et en pleine largeur sur téléphone (`<template v-if="…" #actions>` pour une action soumise à un droit) |
| `SectionCard.vue` | `title`, `titleId`, `description`, `icon`, `headingLevel` (`h2` par défaut, `h3`), `as` (`section`, `div`, `article`), `flat`, `flush` | défaut (corps), `actions` | Titrée **et** identifiée : `section` nommée par son titre ; sinon `div` ; `flat` : fond crème sans ombre (bloc secondaire, carte dans une carte) ; `flush` : corps sans marge pour un `data-table-wrap` collé aux bords. Pas de rognage (`overflow`) : les listes d'un `ComboboxField` restent visibles |
| `StatTile.vue` | `label`, `value` (`string`, `number` ou `null`), `unit`, `hint`, `unavailableText` (« Non disponible »), `tone` (`neutral`, `gold`, `success`, `warning`, `danger`), `icon`, `to`, `linkLabel` (« Voir le détail »), `standalone` | défaut (précision sous la valeur, non interactive si `to`) | Groupe `dt`/`dd` à placer dans `<dl class="stat-grid">` (ou son propre `<dl>` avec `standalone`) ; valeur affichée telle quelle en chiffres tabulaires (l'écran la met en forme : FCFA entiers, pour cent), jamais arrondie ni inventée ; `null` : « — » (masqué aux lecteurs d'écran) et l'explication écrite ; teinte = filet haut, pastille et couleur de la valeur, en plus du libellé ; avec `to`, toute la tuile est cliquable et le lien s'appelle « Voir le détail : <libellé> » |
| `StatusChip.vue` | `tone` (`neutral`, `info`, `success`, `warning`, `danger`, `gold`), `icon` (à la place du point), `as` (`span`, `p`, `li`, `div`) | défaut (libellé de l'état) | Fond léger de la teinte, point ou icône décoratifs, texte en encre (associations vérifiées) : le libellé porte le sens, jamais la couleur seule ; l'état est fourni par l'écran, la puce ne le déduit pas |
| `EmptyState.vue` | `title`, `icon` (`folder` par défaut), `titleAs` (`p`, `h2`, `h3`), `flat` | défaut (explication), `action` | Liste vide ou premier usage seulement : une lecture en échec ou impossible hors ligne reste un `StateMessage` (« Recherche serveur indisponible », jamais « aucun dossier ») ; aucun rôle ARIA (l'annonce reste celle de l'écran) |

Exemple :

```vue
<section aria-labelledby="titre-patients" class="page-stack">
  <PageHeader title-id="titre-patients" title="Patients" icon="patients">
    <template v-if="canCreate" #actions>
      <LinkButton to="/patients/nouveau" variant="primary">Nouveau patient</LinkButton>
    </template>
  </PageHeader>
  <dl class="stat-grid">
    <StatTile label="Visites" :value="report.visits" icon="today" tone="gold" />
    <StatTile label="Rendez-vous programmés" :value="null" unavailable-text="Non disponible dans cette version (agenda)" />
  </dl>
  <SectionCard title="Visites par motif" title-id="titre-motifs" flush>
    <div class="data-table-wrap">
      <table class="data-table">…<td class="num">12</td>…</table>
    </div>
  </SectionCard>
</section>
```

**Classes de mise en page** (`styles/base.css`, couche `components` : un utilitaire de l'écran les
complète ou les remplace) :

| Classe | Rôle |
| --- | --- |
| `page-stack` | Pile d'un écran : colonne espacée de 1,5 rem, 2 rem dès 640 px (à poser sur la `section` de l'écran) |
| `card` | Carte : surface blanche, bordure `line`, `rounded-xl`, ombre `card` (marge intérieure au choix de l'écran) |
| `card-link` | Avec `card`, sur un `RouterLink` : carte cliquable en colonne, bordure dorée et ombre `raised` au survol |
| `card-grid` | Grille de cartes : 1 colonne, 2 dès 640 px, 3 dès 1024 px |
| `stat-grid` | Grille de `StatTile` sur un `<dl>` : colonnes automatiques d'au moins 9,5 rem (deux par ligne dès 360 px) |
| `stat-grid-wide` | Avec `stat-grid` : colonnes d'au moins 14 rem (montants en FCFA, une par ligne sur téléphone) |
| `toolbar` | Barre de filtres ou de choix (jour, période) : empilée sur téléphone, en ligne dès 640 px ; champs alignés en haut, le bouton ou le lien enfant descend de `--field-label-offset` (hauteur de l'étiquette + écart) pour s'aligner sur la saisie, qu'un champ porte une aide ou non. Ce décalage suppose que le bouton partage sa ligne avec le champ : le conteneur d'un champ est souple (`sm:flex-1`, plafonné par `sm:max-w-*`, jamais une largeur fixe qui force le retour à la ligne) et un groupe de boutons sans champ à côté (« Aujourd'hui » : jour précédent, aujourd'hui, jour suivant) prend `w-full` pour rester seul sur sa ligne, sans décalage. Une rangée « champ + bouton » dont la colonne du champ devient étroite à côté du menu (de 640 à 1023 px : date de 224 px dans « Aujourd'hui », liste de 320 px des exports) reste empilée jusqu'à 1024 px (`flex-col lg:flex-row`, `lg:mt-(--field-label-offset)` sur le bouton) : une étiquette qui passe sur deux lignes décalerait la saisie du bouton aligné sur elle, ce que la CI Linux a montré (polices plus larges que celles de Windows) et que `tests/e2e/forms-layout.spec.ts` mesure à 768, 1024 et 1280 px |
| `field-action` | Bouton, case à cocher ou `div` d'une barre posé à côté d'un champ, que `.toolbar > :is(button, a)` n'atteint pas (recherche : patients, catalogue, caisse du jour ; case « Ressource active » de l'agenda) : même décalage `--field-label-offset` dès 640 px, avec `items-start` sur la rangée (jamais `items-end` ni `self-end` : l'erreur et l'aide sont sous la saisie). Le décalage n'existe qu'à partir de 640 px : la rangée doit être empilée en dessous (`flex-col sm:flex-row`), sinon le bouton resterait au niveau de l'étiquette |
| `field-label` | Étiquette d'un champ (`FieldShell`) : 0,875 rem demi-gras, hauteur et écart pris aux variables `--field-label-height` (1,25 rem) et `--field-label-gap` (0,375 rem) |
| `section-title` | Titre de section hors carte (`h2`) : 1,125 rem demi-gras, court filet doré vertical devant (décoratif) |
| `detail-list` | `<dl>` de paires `<div><dt/><dd/></div>` : libellé discret (`muted`, 0,875 rem), valeur en encre, 2 colonnes dès 640 px |
| `form-grid` | Champs d'un formulaire : 1 colonne, 2 dès 640 px (`col-span-full` pour un champ long), alignés en haut (`align-items: start`), écarts de 1,25 rem × 1,5 rem |
| `form-legend` | `legend` d'un `fieldset` dans une carte (Identité, Contact… du formulaire patient) : pastille d'icône dorée et titre de 1,125 rem sur un filet `line` portant un court segment doré (décoratif, remplacé par `CanvasText` en contraste forcé pour ne pas trouer le filet) ; la légende flotte sur toute la largeur, l'élément suivant (`form-grid`) passe dessous |
| `form-actions` | Boutons d'un formulaire sous un filet : pleine largeur et empilés sur téléphone, en ligne dès 640 px (ordre du DOM = ordre visuel) |
| `text-link` | Lien dans un texte : action à l'encre, souligné, soulignement doré et épaissi au survol |
| `data-table-wrap` | Cadre de carte d'un tableau, qui défile seul en largeur si besoin (jamais la page). Filet de sécurité : un tableau est conçu pour tenir à 360 px (colonnes courtes, blocs sur téléphone) |
| `data-table` | Tableau de données : en-tête sur `primary-soft` (texte encre, 0,875 rem), lignes séparées par `line`, survol crème, `tfoot` en gras sous un filet de 2 px ; `th`/`td` de classe `num` alignés à droite en chiffres tabulaires, sans retour à la ligne. Les `th scope="col"` / `scope="row"` et la `caption` restent à l'écran |
| `section-card-flush` | Posée par `SectionCard` (`flush`) : retire le cadre du `data-table-wrap` qu'elle contient |

**Icônes d'`AppIcon`** (trait 24 × 24, `currentColor`, décoratives ; un nom inconnu rend un point) :
navigation et accueil `home`, `today`, `patients`, `consultations`, `agenda`, `sales`, `stock`,
`workshop`, `communication`, `reports`, `settings`, `offline`, `user-plus`, `search`,
`calendar-plus`, `arrival`, `list`, `cash`, `file-plus`, `file`, `building`, `tag`, `key`, `help`,
`logout`, `more`, `shield`, `dot` ; personnes et coordonnées `user`, `users`, `id-card`, `phone`,
`smartphone`, `mail`, `map-pin` ; examens `eye`, `eye-off`, `glasses`, `stethoscope`, `clipboard` ;
temps `calendar`, `clock`, `history` ; ventes et documents `receipt`, `wallet`, `percent`, `chart`,
`printer`, `download`, `upload`, `folder`, `archive` ; actions `plus`, `minus`, `edit`, `trash`,
`filter`, `refresh`, `merge`, `send`, `external-link`, `lock`, `bell` ; directions `chevron-right`,
`chevron-left`, `chevron-down`, `chevron-up`, `arrow-left`, `arrow-right` ; états `check`,
`check-circle`, `x`, `x-circle`, `alert`, `info`, `cloud`, `cloud-off`. Correspondances des entrées
de navigation : `app/navigationIcons.ts`.

## Palette et contrastes

Jetons de `resources/frontend/styles/tokens.css` (charte du logo). Le manifeste PWA et la balise
`theme-color` prennent l'encre de la marque (`#231F20`) et le fond (`#F7F5F1`).
`tests/frontend/shell/palette.test.ts` calcule le contraste WCAG 2.2 de chaque association à partir
de `tokens.css` ; une teinte ajoutée sans association vérifiée fait échouer le test. Extrait :

| Association | Usage | Contraste |
| --- | --- | --- |
| `ink` (#231F20) sur `surface` | texte courant | 16,30:1 |
| `ink` sur `canvas` (#F7F5F1) | texte sur le fond | 14,97:1 |
| `muted` sur `surface` | aide, texte secondaire | 7,24:1 |
| `primary` (#2B2520) sur `surface` | liens, boutons secondaires | 15,13:1 |
| `primary` sur `primary-soft` | navigation active | 13,18:1 |
| `primary-contrast` sur `primary` | bouton principal | 15,13:1 |
| `primary-contrast` sur `danger` | action risquée | 6,57:1 |
| `gold-ink` (#6C5A16) sur `surface` | texte doré (titres de marque, badges) | 6,75:1 |
| `gold` (#8D7827) sur `surface` | filets, repères, icônes (≥ 3:1, jamais du petit texte) | 4,33:1 |
| `gold` sur `primary-soft` | repère de l'entrée active | 3,77:1 |
| `accent` sur `surface` | « En ligne », « Synchronisé » | 6,29:1 |
| `warning` sur `surface` | « Hors ligne » | 5,93:1 |
| `danger` sur `danger-soft` | titre du résumé d'erreurs | 5,99:1 |
| `disabled-ink` sur `disabled` | bouton ou champ désactivé | 6,35:1 |
| `field` sur `canvas` | bordure de champ (≥ 3:1) | 3,78:1 |
| `danger` sur `danger-soft` | bordure et contour de focus d'un champ invalide, sur son fond d'erreur (≥ 3:1) | 5,99:1 |
| `danger-strong` sur `danger-soft` | bordure d'un champ invalide survolé (≥ 3:1) | 7,90:1 |
| `muted` sur `danger-soft` | espace réservé, icône, chevron et unité d'un champ invalide (texte ≥ 4,5:1) | 6,59:1 |
| `primary` sur `canvas` | contour de focus (≥ 3:1) | 13,89:1 |

Le texte désactivé est tenu à 4,5:1 bien que WCAG l'exempte. Le texte courant fait 16 px et suit le
réglage du navigateur. La police est celle du système, sans aucune fonte distante.

## Largeurs d'écran, zoom et clavier (AT28)

`tests/e2e/shell.spec.ts` sert l'application construite, avec la vraie API et la base de test
isolée. Les comptes de démonstration sont fictifs. Le test vérifie :

- connexion par le formulaire, accueil sans module futur, déconnexion ;
- refus d'identifiants : erreur sous le champ, résumé focalisé, mot de passe vidé ;
- premier arrêt du clavier « Aller au contenu », contour visible de 3 px, contenu focalisé, ordre de
  tabulation sans piège ;
- 360 px, 683 px (1366 px à 200 % de zoom), tablette 768 px et ordinateur 1366 × 768 : aucun
  défilement horizontal, contrôles d'au moins 44 px, en-tête dans la largeur, texte de 16 px ;
- « Hors ligne » puis « En ligne » quand le réseau est coupé puis rétabli ;
- une URL métier non livrée (`/atelier`) mène à « Page introuvable » (le menu et l'accueil ne montrent que les
  modules livrés, ouverts par `EEO_ENABLED_MODULES` et autorisés : voir `modules.md`).

## Hors de F09

- Tests sur téléphones Android et iPhone réels, impression A4 en noir et blanc, mesures d'usage
  (création d'identité en moins d'une minute, etc.) : U01 et G3. Ce sont des objectifs de recette,
  pas des résultats acquis ici.
- AT29 (parcours patient → facture → reçu sans ressaisie) se vérifie quand les écrans existent (P01,
  P02, B02 à B04, D01). F09 fournit les composants et la coquille de ce parcours.
- Recherche rapide de l'en-tête (P02) ; état de synchronisation des pièces (F10, O04, O05) ;
  règles des cellules axe et acuité (C02). Le déverrouillage hors-ligne d'un profil préparé est livré
  (`/deverrouiller`, vault.md D14 et D27).

## Revue contradictoire (2026-10-15) et traitement

Revue indépendante et adverse des commits `1c39c52`, `0354212` et `5ff7363`, en lecture seule, avec
sondes et mutations sur une copie : **pass=false**, 4 majeurs et 14 mineurs. Elle a aussi relevé ce
qui tient : aucun module futur présenté comme livré, aucune redirection ouverte, déconnexion
honnête, relecture de session sans fuite, champs exacts, OD avant OG, contrastes exacts et correction
F05 sans effet de bord. Tous les constats sont traités ci-dessous, chacun avec son test.

| Constat | Gravité | Traitement |
| --- | --- | --- |
| Page d'erreur HTML d'un hébergeur (503, pare-feu, portail captif) : `SyntaxError`, session « inconnue » sans relecture, connexion sans message | Majeur | Réponse non JSON = `ApiError` `HTTP_ERROR`, serveur compté injoignable ; tests au démarrage (relecture rétablie) et à la connexion |
| Garde de saisie contournée par un changement de paramètre de route | Majeur | `onBeforeRouteUpdate` avec la même condition ; test `/dossier/1` → `/dossier/2` |
| Date impossible à saisir au pavé numérique de l'iPhone | Majeur | 8 chiffres JJMMAAAA mis en forme dans le champ (règle F08 inchangée, date ISO envoyée) ; test |
| Option active hors de la partie visible de la liste | Majeur | `scrollIntoView({ block: 'nearest' })` à chaque changement ; test |
| Résultats périmés choisissables pendant une recherche | Mineur | Résultats vidés dès la nouvelle saisie ; test |
| Résumé d'erreurs non réannoncé à l'identique | Mineur | La connexion refocalise le résumé à chaque échec ; test |
| État réseau figé (retour du serveur non vu, liaison perdue affichée « En ligne ») | Mineur | Sonde `/up` périodique (30 s / 60 s) et au retour du réseau ; deux tests |
| Session fermée avant la garde de saisie | Mineur | L'écran est quitté d'abord, la déconnexion s'arrête si la saisie est gardée ; test |
| Trois associations de couleurs employées mais non vérifiées | Mineur | Ajoutées au test de contraste ; commentaire de `tokens.css` corrigé |
| Menu « Plus » rogné en paysage ou à 200 % ; navigation jamais vue dans un vrai navigateur | Mineur | Liste bornée en hauteur et défilante ; e2e de la navigation avec le premier écran livré (P01, P02) |
| Grands montants qui débordent entre 640 et 767 px | Mineur | Colonnes à la taille du contenu qui passent à la ligne |
| Saisie refusée : le parent gardait l'ancienne valeur valide | Mineur | Valeur du parent remise à null, saisie conservée ; test |
| Pas de résultats locaux avec « Recherche serveur indisponible » | Mineur | Résultat `{ options, notice }` ; test |
| `ConfirmDialog` : focus hors de la boîte pendant la commande, libellé générique | Mineur | Focus gardé dans la boîte, `pendingLabel` ; tests (dont la réouverture) |
| Accueil : module livré sans action d'accueil annoncé « aucun module livré » | Mineur | Modules pris en compte, renvoi au menu ; test |
| Gardes statiques contournables | Mineur | Commentaires retirés avant analyse, accès indirects, URL sans protocole, `import()`, `sendBeacon`, `WebSocket` |
| Affirmations inexactes de ce document | Mineur | Corrigées (`suite`, focus de « Plus », lien de l'en-tête, réponses obsolètes) |
| `opcache.enable_cli` sans effet pour `php -S`, préchauffage sans délai | Mineur | Option retirée (le serveur intégré suit `opcache.enable`), délai de 30 s par requête de préchauffage |

Les cinq mutations qui survivaient (réponse obsolète, focus au premier affichage, paramètres de
requête dans `suite`, saisie refusée écrasée, boîte non rouverte), plus deux nouvelles (garde sans
`onBeforeRouteUpdate`, réponse HTML non protégée), font maintenant échouer au moins un test.

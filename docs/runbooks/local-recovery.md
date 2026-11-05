# Exporter un poste et le reprendre sur un poste neuf (O07)

Procédure d'exploitation, pour l'exploitant et la gérante. Sources : fichier 19 (« Export et reprise d'un poste »,
« Poste perdu ou remplacé »), fichier 09 (sauvegardes et incident), fichier 25 (gate G2) ; scénarios AT39 et AT44.
Code : `resources/frontend/offline/recovery/` (export, ouverture, rangement, transmission), écran « Préparer ce poste »
étapes 6 et 7 (`components/devices/DeviceRecoveryPanel.vue`), serveur `app/Offline/ReplaceDevice.php`,
`POST /api/v1/devices/{ancien}/recovered-push` (`PushCommands`), `app/Offline/ReconcileReplacement.php`. Preuves :
`tests/e2e/device-recovery.spec.ts`, `tests/frontend/offline/recovery.test.ts`,
`tests/Feature/Offline/DeviceReplacementTest.php`.

Le module `offline` reste FERMÉ en production tant que G1 et G2 ne sont pas prouvés : cette procédure ne s'applique
qu'une fois le module ouvert.

## Ce que contient un export

Un fichier JSON unique, chiffré (AES-GCM), qui ne s'ouvre qu'avec la clé de récupération de la gérante, affichée une seule fois à la
préparation du poste (étape 1) : le journal signé du poste (commandes, empreintes, signatures, rang
`device_sequence`), les PDF locaux et un manifeste (nombre de pièces, pièces non synchronisées, dernier rang). Il ne
contient ni la clé de signature du poste, ni le secret du coffre, ni aucune donnée lisible sans la clé. Il ne donne
AUCUN droit : les plages de numéros, quotas et factures attribuées de l'ancien poste ne sont jamais recopiés.

Le stockage du navigateur n'est pas une sauvegarde. L'export se fait à chaque clôture de caisse et lors d'une coupure
prolongée ; le fichier est rangé sur un support contrôlé (clé USB de la gérante, pas une messagerie).

## 1. Exporter (poste encore utilisable)

1. Sur le poste, « Paramètres › Préparer ce poste », déverrouiller le coffre (étape 2).
2. Étape 6 : « Exporter ce poste (fichier chiffré) ». Le message indique le nombre de pièces et combien ne sont pas
   encore synchronisées.
3. Ranger le fichier. Ne jamais l'ouvrir ni le modifier : toute altération est refusée à la reprise.

Si le poste est hors service sans export récent, les pièces non synchronisées après le dernier export sont perdues
pour la reprise : la gérante les ressaisit à partir des doubles papier, en ligne, avec un motif.

## 2. Préparer le poste neuf

1. En ligne, la gérante prépare le nouveau poste (étapes 1 à 3 : coffre, enrôlement, autorisation de son profil).
2. Ne PAS réserver de numéros (étape 4) avant la clôture de l'ancien poste : une seule caisse hors-ligne principale à
   la fois, et l'ancien poste les détient encore.

## 3. Reprendre (étape 7, sur le poste neuf)

1. Choisir le fichier d'export, saisir la clé de récupération, « Ouvrir l'export ». Refus possibles : clé incorrecte,
   fichier illisible, version non prise en charge, contenu altéré ; ou export du poste lui-même.
2. « Ranger l'export dans ce poste » : rien n'est encore envoyé ; recommencer ne duplique rien.
3. Saisir le motif (conservé au journal), puis dans l'ordre :
   - « 1. Déclarer le remplacement » (confirmation du mot de passe) : l'ancien poste passe `REPLACED`, ses
     autorisations hors-ligne sont révoquées et ses ressources passent en clôture ;
   - « 2. Transmettre les pièces de l'ancien poste » : les commandes partent TELLES QUELLES (même identifiant,
     empreinte, signature, numéros) au nom de l'ancien poste. Une pièce déjà reçue n'est pas recréée. Une action
     postérieure ou trop proche de la révocation passe en « Conflits de synchronisation » pour revue ;
   - « 3. Clôturer l'ancien poste » : refusée tant qu'une pièce manque (`SYNC_INCOMPLETE`) ; ensuite, les numéros
     non utilisés de l'ancien poste sont inscrits « non utilisés », jamais réattribués.
4. Réserver alors les numéros du poste neuf (étape 4) : nouvelles plages, disjointes des anciennes.

## 4. Si l'ancien poste réapparaît

Il ne peut plus rien publier : à sa synchronisation, l'écran affiche « Le serveur refuse l'échange : Ce poste est
déclaré perdu ou remplacé », ses pièces restent sur le poste et passent en conflit à revoir ; il ne reçoit plus de
données. Ne pas le réutiliser : la gérante revoit chaque pièce (ressaisie en ligne si elle est légitime), puis le
navigateur est vidé et le poste repréparé comme un poste neuf.

## 5. Contrôles après reprise

- Chaque encaissement repris existe une seule fois, avec son numéro de reçu d'origine (plage de l'ancien poste).
- L'ancien poste n'est plus `ACTIVE` ; ses numéros restants sont `UNUSED`.
- « Conflits de synchronisation » : chaque conflit est traité avant de rouvrir la caisse.
- Noter la date, le motif, le nombre de pièces reprises et les conflits dans le journal d'exploitation.

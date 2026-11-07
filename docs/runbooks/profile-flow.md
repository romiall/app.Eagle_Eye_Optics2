# Runbook — Parcours entre profils sur le poste principal (P04)

Pour l'exploitant et le développeur. Le guide destiné à la cliente ira dans l'aide intégrée de l'application quand le module
`offline` sera ouvert en production (il est FERMÉ aujourd'hui : rien de ce qui suit n'est visible du cabinet).

Source : fichier 19 (« Le flux L0 complet peut se faire sur le poste principal avec changement de profil et compartiments
autorisés »), fiche P04 du fichier 24, contrats 23 (journal commun, compartiments). Preuve : `tests/e2e/profile-flow.spec.ts`.

## Ce qui est garanti sur le poste principal préparé

| Profil | Compartiments (grant signé ET clés stockées) | Ce qu'il fait SANS réseau | Ce qu'il ne voit jamais |
| --- | --- | --- | --- |
| Accueil | administratif | crée et modifie un patient (numéro de dossier de la plage du poste) | factures, encaissements, données cliniques |
| Caisse | administratif et financier | retrouve la fiche, prépare, émet et encaisse une facture (numéros de facture et de reçu de la plage du poste) | données cliniques |
| Professionnel | administratif et clinique | retrouve la fiche | factures et encaissements : ni le droit, ni la clé (leur texte n'est pas lisible dans la base du poste) |
| Gérante | les quatre | prépare le poste, décide les conflits (en ligne) | — |

- Chaque personne ouvre SON profil avec SON secret local : il n'y a pas de code commun, et le secret n'est jamais conservé.
- Le journal du poste est COMMUN : une seule suite de rangs, chaînée et signée. Une pièce est scellée dans UN compartiment ; un
  profil ne lit que les compartiments dont il détient la clé.
- La même fiche garde le même identifiant et le même numéro de dossier d'un profil à l'autre ; la facture garde son numéro ; le
  reçu garde le sien. Rien n'est renuméroté à la synchronisation.
- Le poste ne reçoit des entités cliniques que SANS contenu (identifiant et version, `PullProjections`, limite déclarée du L0) :
  selon la base, la préparation en dépose des coquilles dans le compartiment clinique, et le travail de la journée n'y ajoute
  aucune ligne. La séparation clinique repose sur le droit et la clé, qui sont vérifiés (voir « Preuves »).

## Ne pas promettre

- **Consultation sans réseau** : visites, examens et prescriptions s'enregistrent EN LIGNE seulement (les commandes cliniques
  refusent la source SYNC, `docs/implementation/vault.md`). Hors ligne, le professionnel retrouve la fiche administrative ; il
  ne démarre pas d'examen.
- **Parcours réparti sur plusieurs postes déconnectés** (fiche créée à l'accueil d'un poste, encaissée sur un autre) : le
  transfert par QR ou par export entre deux postes n'est PAS activé (équipement et tests Q02 non acquis). Un seul poste
  principal par cabinet détient les numéros financiers.
- **Approbations distantes** : elles attendent la connexion ; la gérante présente décide depuis son profil préparé.

## Préparer le poste (gérante, en ligne)

1. Se connecter, ouvrir `Paramètres`, `Préparer ce poste`. Créer le coffre (clé de récupération à garder HORS du poste),
   l'ouvrir, enrôler le poste, réserver les numéros.
2. Pour chaque personne qui travaillera sur ce poste : « Préparer l'autorisation » (mot de passe de la gérante), puis
   « Ajouter le profil local » : la PERSONNE saisit son secret local, la gérante confirme le sien. Contrôler la ligne
   d'autorisation affichée :

   | Compte | Ligne attendue |
   | --- | --- |
   | Accueil | `… — ADMINISTRATIVE` |
   | Caisse | `… — ADMINISTRATIVE, FINANCIAL` |
   | Professionnel | `… — ADMINISTRATIVE, CLINICAL` |

3. Cliquer sur « Se déconnecter ». Le poste se verrouille et affiche « Déverrouiller ce poste » : c'est l'écran des équipes.
   (Avant P04, un coffre créé dans la session de la gérante n'était pas reconnu après sa déconnexion : le déverrouillage
   répondait « Déverrouillage impossible sur ce poste » jusqu'au rechargement de la page. Corrigé dans
   `resources/frontend/app/services/vault.ts`.)

## Changer de profil

1. « Verrouiller le poste » (en-tête) : le profil se referme, l'écran « Déverrouiller ce poste » s'ouvre sans rechargement.
   Les saisies en cours sont enregistrées avant le verrouillage (délai de 2 secondes).
2. Choisir son profil dans la liste, saisir son secret local, « Déverrouiller ». Après trop d'essais, le profil est bloqué
   jusqu'à l'heure indiquée.
3. Sans réseau, le profil local devient l'identité d'action, avec les droits signés de son grant. Seuls les écrans qui savent
   travailler sur le poste s'ouvrent : `Accueil` et `Patients` (la caisse prépare ses factures depuis la fiche).

## Envoyer les pièces au serveur

Le serveur demande une session : « Se connecter au serveur » (compte de la personne, mot de passe du serveur), puis
« Synchroniser » dans l'en-tête.

- Un profil n'envoie que les pièces qu'il sait lire. Le lot s'arrête à la première pièce d'un autre compartiment : les
  suivantes restent dans le journal, en ordre, et partent quand un profil qui détient la clé de leur compartiment s'ouvre.
- L'en-tête le dit, sans lire aucun contenu : **« 3 pièces de la caisse : à envoyer à l'ouverture d'un profil de caisse ou de
  la gérante »** (ou cliniques, de l'accueil, de la gérante). Rien n'est perdu ni appliqué à moitié : le serveur n'a, par
  exemple, ni facture ni encaissement tant que la caisse n'a pas synchronisé.
- « Se déconnecter » ferme le profil local ET la session du serveur ; le profil suivant se connecte à son tour.
- **Fin de journée** : ouvrir chaque profil qui a encore des pièces en attente (la caisse en premier) et synchroniser ; sinon
  exporter le poste (O07). Le contrat 23 exige, pour le préflight de fin de journée (pas encore outillé : à faire à la main),
  l'ouverture ou la reprise de tous les profils qui ont des pièces en attente. La reprise complète du poste (`ReleaseDevice`)
  n'est acceptée que si le serveur a reçu tout le journal.

## Incidents

| Constat | Cause | Geste |
| --- | --- | --- |
| « Profil ou secret incorrect » | secret erroné | ressaisir ; après plusieurs échecs, attendre l'heure indiquée |
| « Déverrouillage impossible sur ce poste » | page ouverte avant P04 sur un coffre créé dans la même session | recharger la page (corrigé depuis P04) |
| « Le coffre est ouvert au nom d'un autre compte que celui du serveur » | session du serveur d'une autre personne | « Verrouiller le poste », puis ouvrir le bon profil |
| « N pièces de la caisse : à envoyer… » qui ne diminue pas | seul un profil sans la clé financière est ouvert | ouvrir le profil de caisse (ou la gérante), se connecter, synchroniser |
| « Échec de l'enregistrement sur ce poste : rien n'est enregistré » dans un 2e onglet | un seul onglet détient la session du coffre (le dernier déverrouillé) | travailler dans un seul onglet ; rouvrir le profil dans l'onglet voulu |
| Secret local oublié | — | la gérante le réinitialise avec la clé de récupération du poste |

## Preuves

| Exigence | Preuve |
| --- | --- |
| Parcours accueil, caisse, professionnel sur un poste, sans réseau | `tests/e2e/profile-flow.spec.ts` (navigateur réel, trois profils, secrets distincts) |
| Compartiments séparés, accordés ET stockés | même parcours : lignes d'autorisation et enveloppes de clés lues dans IndexedDB brute (`readProfileCompartments`) |
| Pas de fuite financière ni clinique | même parcours : le professionnel n'a ni lien ni accès à la facture, aucun texte de la facture ni du patient en clair dans la base, le travail du jour n'ajoute aucune ligne clinique |
| Pas de duplication d'identifiant au changement de profil | même parcours : même identifiant et même numéro de dossier pour les trois profils, une seule fiche, une seule facture, un seul encaissement sur le serveur, numéros inchangés |
| Attente de synchronisation d'un autre compartiment | même parcours : le professionnel n'envoie que la fiche ; la caisse envoie facture et encaissement ensuite ; reprise complète acceptée |
| Message par compartiment | `tests/frontend/offline/profile-switch.test.ts`, `tests/frontend/components/sync.test.ts` |
| Coffre créé dans la session, déverrouillé après déconnexion | `tests/frontend/shell/local-identity.test.ts` (contrôlé par mutation) et le parcours |

# Recette et scénarios de validation

Ce plan définit les preuves attendues pendant le développement. Il n’affirme pas que l’application a été développée ou testée dans ce travail de spécification. Utiliser données fictives, puis catalogue/modèles approuvés pour la bascule.

## Jeu de données

Cabinet test XAF/Africa/Douala ; une gérante, accueil, professionnel et caissière. Deux patients aux noms voisins, deux patients partageant un téléphone, un patient sans naissance avec motif, un mineur. Catalogue fictif : examen 5 000, monture 30 000 stock 1, paire de verres 50 000 fabrication, collyre 4 000 avec lot valide et lot expiré. Taxes en configuration de démonstration explicitement non contractuelle. Facture d’équipement de référence 80 000.

Préparer deux contextes de navigateurs/postes et deux onglets du même poste. Tests SQL de concurrence sur MySQL cible ; tests PWA Playwright avec coupure réseau et fermeture/reprise du contexte persistant. Les valeurs financières PHP et TypeScript passent les mêmes vecteurs de référence.

## Scénarios L0

| ID | Exécution | Résultat attendu |
| --- | --- | --- |
| AT01 | Créer comptes, se connecter, désactiver un compte, tester URL directe | Comptes distincts, session serveur invalidée ; droits locaux bornés et révocation différée signalée |
| AT02 | Accueil/caisse ouvrent API clinique/financière globale/PDF par identifiant | Refus serveur et coffre local inaccessible au mauvais rôle ; aucune donnée divulguée |
| AT03 | Créer simultanément deux patients, puis rechercher nom accentué/téléphone/dossier | Deux numéros uniques ; recherches cohérentes ; pas de perte d’identité |
| AT04 | Créer homonyme, téléphone partagé, naissance absente/future | Doublon signalé sans fusion ; téléphone partagé permis ; naissance absente justifiée, future refusée |
| AT05 | Visite examen non payée, paiement confirmé de frais, puis démarrage | Examen bloqué avant règlement, admis après preuve liée à cette visite |
| AT06 | Contrôle gratuit avec dérogation ; achat direct sans examen | Dérogation auteur/motif visible ; achat sans consultation fictive |
| AT07 | Recherche catalogue dès deux caractères et tentative remise par caisse | Prix catalogue proposé ; remise non autorisée bloquée, demande gérante possible |
| AT08 | Émettre facture, modifier prix catalogue/identité ensuite | Numéro/snapshot figés ; PDF d’origine et lignes inchangés |
| AT09 | Émissions concurrentes et passage nouvelle année | Numéros uniques, plages locales exclues de séquence centrale, aucun numéro réutilisé |
| AT10 | Facture 80 000, acompte 30 000, solde 50 000 plusieurs jours après | Deux reçus distincts, même facture, restes 50 000 puis 0 ; impayé disparaît sans nouvelle vente |
| AT11 | Double clic/retry du même paiement, puis même clé avec montant changé | Un paiement/reçu ; ACK identique ; changement de contenu refusé |
| AT12 | Deux règlements concurrents 40 000 sur dette 50 000 | Un seul 40 000 accepté ; second conflit ; propriétaire local empêche autre poste d’écrire |
| AT13 | Tenter supprimer paiement ; corriger paiement enregistré à tort | Suppression interdite ; contre-écriture autorisée/motivée, original conservé ; audit intact |
| AT14 | Avoir partiel puis total et remboursement réel | Solde conforme formule ; avoir plafonné ; remboursement limité au crédit, numéroté et autorisé |
| AT15 | Deux ventes du dernier article, réserve puis remise | Une seule capacité de vente ; réserve distincte du physique ; une seule sortie à remise |
| AT16 | Livrer avec impayé, sans facture, puis casse hors vente | Sans facture refusé ; impayé nécessite gérante ; casse exige motif/approbation |
| AT17 | Lot périmé, livraison partielle, avoir sans retour, puis retour physique | Péremption bloquée ; quantités cumulées correctes ; avoir ne rentre pas le stock ; retour accepté le rentre une fois |
| AT18 | Saisir consultation avec toutes rubriques DP, OD/OG/OU et champs Autre | Douze acuités distinctes, mesures séparées, sélections exclusives cohérentes, zéro différent du vide |
| AT19 | Modifier même consultation depuis deux postes, finaliser puis corriger | Conflit conservé, pas dernier écrit gagnant ; anciennes révisions lisibles et auteur/motif présents |
| AT20 | Prescription + deux médicaments + orientation urgente, exporter | Tous champs/valeurs/units visibles ; posologie non inventée ; urgence badge clinique seulement |
| AT21 | Nouvelle visite même patient, comparer et réimprimer précédente prescription | Historique non écrasé ; version ancienne inchangée ; échelles incompatibles signalées |
| AT22 | Contrôle 3 mois depuis fin de mois ; collyre depuis début/fin choisi | Date civile cohérente ; origine affichée ; pas de choix médical automatique |
| AT23 | Programmer/déplacer/annuler RDV et traiter une relance | Anciennes tâches invalidées ; pas de doublon source/échéance ; tentatives conservées |
| AT24 | Facture ancienne réglée aujourd’hui, avoir aujourd’hui, nouvelle vente | CA distinct d’encaissements ; dettes de toutes périodes visibles gérante seulement |
| AT25 | Stats patients/consultations/sexes/âges/motifs, caisse et comptage | Définitions connues, inconnus conservés ; écart caisse motivé ; pas de double comptage corrections |
| AT26 | Reprendre papier 80 000 déjà payé 30 000 puis encaisser 20 000 | Créance REP 50 000, CA initial 0, encaissé initial 0 ; après paiement dette 30 000 et encaissé 20 000 |
| AT27 | Export, backup serveur, restaurer sur environnement isolé | Pièces/historique/hash/séquences/soldes récupérés ; durée et RPO constatés |
| AT28 | Parcours 360 px, tablette, clavier, zoom 200 %, A4 long | Contrôles lisibles/accessibles, pas de coupe de totaux, accents et signes exacts |
| AT29 | Opérateur crée patient puis facture/reçu, gérante trouve un impayé sur téléphone | Aucun champ identity ressaisi entre modules ; objectifs d’usage mesurés et retours corrigés |

## Scénarios des lots suivants

| ID | Lot | Exécution et résultat attendu |
| --- | --- | --- |
| AT30 | L1 | Réception/inventaire/écart/seuil/coût manquant : mouvements justifiés, alertes uniques, valeur inconnue explicite |
| AT31 | L1 | Atelier commande→reçu→montage→contrôle→prêt→livré : événements/bon labo/prescription versionnée corrects |
| AT32 | L2 | Google créé/modifié/supprimé/token 410/push expiré : reprise complète externe et aucun dossier interne effacé |
| AT33 | L2 | Deux demandes omnicanales même créneau et blocage Google simultané : exclusion interne, conflit externe détecté et humain alerté |
| AT34 | L2 | Consentement/opt-out/template/fenêtre service/retry inconnu : règles respectées, pas de double envoi aveugle ni donnée clinique exposée |
| AT35 | L2/L3 | Assistant demande humain, prix non validé, diagnostic sollicité, booking site : transfert avec résumé, bot suspendu, aucune écriture financière ou ordonnance IA |

## Scénarios hors-ligne obligatoires L0

| ID | Exécution | Résultat attendu |
| --- | --- | --- |
| AT36 | Préparer poste, couper réseau, fermer/rouvrir navigateur, créer patient | Shell disponible, coffre déverrouillable, dossiers persistants, numéro local final |
| AT37 | Sans réseau : facture 80 000, acompte 30 000/reçu, solde 50 000/reçu, PDF/impression | Pièces réelles commitées localement, numéros pré-alloués, restes exacts et PDF disponible sans CDN |
| AT38 | Couper après envoi sync avant réception ACK ; reconnecter/rejouer plusieurs fois | Une seule facture et chaque paiement une seule fois, aucun renumérotage ; commandes gardées avant ACK |
| AT39 | Même solde ouvert sur autre poste ; essayer encaissement hors-ligne et transfert | Poste non propriétaire bloque ; transfert exige reprise/fermeture préalable ; aucune libération à simple expiration |
| AT40 | Stock 5, quota A3 ; A réserve1 offline (remise en ligne), B utilise disponible central ; sync | A2/B2 disponibles, central physique5/quotaA3 dont 1 réservé après sync, pas de double réserve ni stock négatif |
| AT41 | Deux onglets consomment numéro/paiement, puis panne locale au milieu | Transaction tout ou rien, numéros uniques, au plus un paiement par clé ; pas de pièce annoncée avant commit |
| AT42 | Patient modifié sur deux postes ; créer homonyme offline | Propositions conservées, décision explicite, aucun écrasement ou fusion automatique |
| AT43 | Plage épuisée/autorisation expirée/date arrière/rôle non autorisé | Blocage expliqué des nouvelles opérations sensibles, pièces existantes conservées et exportables |
| AT44 | Export chiffré local, simuler perte du poste, restaurer neuf puis sync | Mêmes pièces/IDs, pas de nouveau reçu pour reprendre un reçu ancien ; récupération testée |
| AT45 | Mise à jour PWA avec pièces pendantes, profil verrouillé et dashboard distant | Aucune purge ; version ancienne reprise ; pas de plaintext visible ; totaux distants marqués incomplets |

Pour AT36–45, enregistrer navigateur/version, système, quotas, mode de persistance, captures et montants avant/après sync. Aucun succès dans un seul navigateur de développement ne valide tous les appareils du cabinet. Amendement D10 (9 novembre 2026) : en L0 le hors-ligne couvre l’enregistrement des patients et la facturation ; AT36, AT40 et AT42 ne visent donc ni la consultation ni la remise hors-ligne (fichier 15).

## Critères de mise en service

L0 : AT01–29 et AT36–45 réussis, aucune anomalie critique de données/droits/montants/numéros/stock/hors-ligne ; catalogue, taxes/mentions et séries validés ; compte gérante et profils installés ; backups/restaurations serveur et locale testés ; utilisateurs formés et registre de bascule disponible. Les intégrations L2 ne sont pas prétendues actives.

Une anomalie bloque la mise en service si elle peut perdre une pièce, dupliquer paiement/numéro, exposer données, altérer historique, produire un total erroné ou supprimer un événement pendant sync. Les écarts visuels mineurs sont suivis, sans accepter facture illisible ou bouton critique inaccessible.

Compte rendu : scénario, build, environnement, attendu/observé, preuve, verdict, défaut et correction. Le PV de recette identifie le lot et les limites, notamment caisse offline unique et fraîcheur du dashboard distant. Tester les règles avec la gérante, sans inventer une approbation commerciale.

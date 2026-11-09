# Décisions hypothèses et informations à obtenir

Ce registre rend les choix explicites pour Claude. Il ne faut pas transformer une recommandation technique en exigence déjà acceptée du client. Les demandes d’information n’empêchent pas le développement sur données fictives ; certaines sont indispensables avant production.

## Décisions acquises dans ce chat

| ID | Décision | Autorité |
| --- | --- | --- |
| D01 | PC, CDC et DP sont références ; Gemini seulement contexte | U |
| D02 | Priorité patients, factures/impression et paiements sous deux semaines | U |
| D03 | Socle complet pour coder avec Claude, interface française épurée et responsive | U + CDC/DP |
| D04 | Application métier au sous-domaine du site existant | U |
| D05 | Hébergement web simple ; aucun VPS | Réponse U du 14 octobre 2026 |
| D06 | Enregistrement et facturation hors-ligne dès première livraison | Réponse U du 14 octobre 2026 |
| D07 | Conserver Kommo/Google dans périmètre global, pas de remplacement déduit de Gemini | PC + consigne U sur les sources |
| D08 | Définir immédiatement toute l’application, générer MCD, MLD et SQL complets ; priorité urgente seulement dans planification | Précision U du 14 octobre 2026 |
| D09 | Rédiger un plan détaillé d’exécution pour Claude, cohérent avec le socle entier et évitant les décisions répétées pendant codage | Demande U du 14 octobre 2026 |
| D10 | Le hors-ligne de L0 couvre l’enregistrement des patients et la facturation (précise D06) ; la consultation et la remise de stock restent en ligne en L0, à rouvrir dans un lot ultérieur si le cabinet en a besoin ; AT36, AT40 et AT42 amendés | Réponse U du 9 novembre 2026 (« Oui, amender ») |

## Choix de conception proposés

| ID | Proposition | Statut / conséquence |
| --- | --- | --- |
| A01 | Laravel/PHP/MySQL + Vue 3/TS/Tailwind PWA/Dexie | Choix prestataire pour répondre à D05/D06 ; compatibilité offre à auditer |
| A02 | XAF, Africa/Douala, cabinet unique | Déduit de PC localisation/monnaie ; paramètres configurables |
| A03 | `app.eagleeyeoptic.com` | Nom proposé, pas DNS déjà créé |
| A04 | Une caisse financière offline principale L0 | Limitation opérationnelle explicite ; besoin multi-caisses à vérifier avant extension |
| A05 | Numéros en plages disjointes, propriétaire de facture et quotas stock | Règles nécessaires à D06 avec plusieurs postes ; voir 19 |
| A06 | Autorisations offline 72 h, préflight quotidien, coffre chiffré | Proposition à calibrer à la durée réelle des pannes et aux appareils |
| A07 | Livraison à crédit validée gérante | Réconciliation de PC/CDC, contrôle renforcé proposé |
| A08 | Prix TTC, montants entiers FCFA, taxes à configurer | Convention technique ; régime fiscal non fourni |
| A09 | Champs identité inconnus justifiés plutôt que dates inventées | Choix ergonomique ; ne supprime pas les champs demandés |
| A10 | Tableau comparatif clinique L0, graphiques ultérieurs | Priorité au modèle de dossier utilisable |
| A11 | RPO serveur 1 h cible si offre le permet ; quotidien minimum PC | Ne couvre pas pièces locales non sync ; backup local obligatoire |
| A12 | Délai global 8 semaines, ordre modifié ; J14 cible conditionnelle | Nouvelle priorité U, pas avenant commercial automatique |
| A13 | Transcription d’une ordonnance externe identifiée pour achat direct/fabrication sans examen local fictif | Précision de conception à confirmer avec cabinet ; provenance et professionnel validant conservés |
| A14 | Migrations fidèles, tables techniques distinctes, User adapté et session Sanctum SPA selon 23 | Décisions d’ingénierie proposées pour exécuter A01 ; pas de modification du modèle métier |
| A15 | ledger_version dérivé des faits financiers, distinct de invoices.version figé à émission | Nécessaire pour respecter guards et concurrence sans modifier une facture émise ; contrat 23 |
| A16 | Préfixe sync finalisé vérifié distingue ACCEPTED métier et REJECTED après revue, originaux conservés | Précision 23 pour reprendre après conflit sans bloquer indéfiniment le journal ; tests IT11/IT12 requis |
| A17 | Une clé ES256/journal par appareil, grants individuels et compartiments par droits ; sync profil ouvert L0 | Alignement avec enrolled_devices et confidentialité ; aucune clé publique de profil supplémentaire supposée |
| A18 | Verrou de publication clinic tenu avant change log jusqu’au commit pour L0 | Choix simple assurant curseur sans perte ; sérialise mutations du cabinet, performances à mesurer avant optimisation |

## Informations à recueillir

| ID | Information manquante | Quand nécessaire | Travail possible en attendant |
| --- | --- | --- | --- |
| Q01 | Fournisseur/offre/version PHP/MySQL, cron, accès, quotas | Audit J1, avant déploiement | Développement local stack recommandée |
| Q02 | Postes/navigateurs/imprimantes, nombre de caisses, durée/fréquence pannes | Prototype J2 et validation L0 | Une caisse PC Chrome/Edge préparée comme scénario de référence |
| Q03 | Mentions cabinet, logo, identifiants professionnels/fiscaux, régime taxe, séries papier | Avant pièces officielles | PDFs marqués test et règles configurables |
| Q04 | Catalogue réel, unités paire/unité, prix, frais examen, stock/lots | Avant ventes réelles | Catalogue fictif limité aux tests |
| Q05 | Anciennes dettes, dernier carnet/numéro, commandes en cours | Avant bascule | Procédure REP et outil de reprise |
| Q06 | Échelles acuité, convention cylindre, pas/bornes, tolérance DP | Avant utilisation clinique | Valeurs libres préservées et validations non médicales |
| Q07 | Qui encaisse examen à l’accueil ? Qui autorise remise/refund hors-ligne ? | Avant attribution des droits | Matrice par défaut restrictive, gérante explicite |
| Q08 | Jours ouvrés, durées RDV, professionnels, localisation GPS | Avant agenda réel | Ressource test, horaires PC 08h30–17h00 |
| Q09 | Base de calcul 10–14 jours collyre : début/fin/consultation | Avant automatiser contrôle correspondant | Saisie manuelle professionnelle de date |
| Q10 | Offre Kommo, comptes Meta, numéro, autorisations, templates et FAQ | Avant L2 | Adaptateurs simulés et modèles de données |
| Q11 | Fournisseur SMS et budgets/messages, consentements et conservation | Avant envois | Notifications internes et aucun envoi externe |
| Q12 | Site actuel/technologie/accès, showroom existant ou à compléter | Avant L3 | API publique et séparation du domaine privé définies |
| Q13 | Attentes comptable/exports, dépenses, rapprochement et valorisation | L1 | CA/encaissements/impayés clairement distingués |
| Q14 | Storage backup distant, récupération locale, personne support et délai d’intervention | Avant production | Runbooks et exercices sur environnement de test |
| Q15 | Jalons commerciaux 50/30/20 %, ajout des précisions CDC/DP | Avant engagement des jalons | Lots techniques sans modification de prix |

Q01/Q02/Q03/Q04/Q14 peuvent bloquer une mise en production fiable, pas la création du socle ou un prototype. Si l’offre PHP est incompatible, proposer une offre web simple compatible : D05 interdit de considérer un VPS comme solution par défaut.

## Traçabilité des évolutions

Nouvelle décision : date, auteur, source, motif, exigence/ticket affecté et impacts sur coût/date. Modifier les fichiers concernés ensemble, pas seulement le prompt Claude. Aucun changement implicite du hors-ligne, de la confidentialité ou des pièces financières pour tenir une date.

### Évolutions enregistrées

| Date | Auteur | Source | Motif | Exigences et tickets touchés | Impact coût et date |
| --- | --- | --- | --- | --- | --- |
| 2026-11-09 | Demandeur (décision), agent de développement (rédaction) | Réponse « Oui, amender » à la question « Pour L0, le hors ligne reste-t-il limité aux patients et à la facturation ? », posée après la recette G3 (`docs/evidence/G3.md`, décisions 1 et 2) | D06 ne promet le hors-ligne que pour l’enregistrement et la facturation ; la consultation et la remise de stock ne sont pas des commandes de poste (O05) | D10 ; EE013, EE042 ; AT36, AT40, AT42 (fichier 14) ; fichier 19 ; G3 | Aucun coût ni délai ajouté : rien n’est construit ; la consultation et la remise hors-ligne restent à planifier si le cabinet les demande |

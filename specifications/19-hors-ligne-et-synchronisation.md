# Hors-ligne et synchronisation dès la première livraison

Cette exigence a été confirmée par U. Elle est obligatoire pour L0 sur hébergement web simple. Ce fichier précise les chemins locaux des mêmes règles que les fichiers 03, 07 et 08. Le hors-ligne n’est ni un cache de page ni une file de requêtes HTTP sans contrôle.

## Périmètre concret

Après préparation en ligne, le personnel autorisé peut créer/rechercher les patients chargés sur son poste, enregistrer de nouveaux patients, saisir les champs DP, créer une facture, encaisser un acompte ou solde autorisé, émettre un reçu et imprimer/exporter les PDF sans Internet. Les enregistrements survivent à la fermeture du navigateur et au redémarrage normal. Les communications externes, rapports globaux à jour et Google attendent le réseau.

L0 utilise **un poste principal de caisse hors-ligne**, avec les autres postes dédiés à l’accueil et à la clinique selon leurs droits. Cela fournit la facturation sans réseau sans construire une caisse répartie à écritures concurrentes sur les mêmes factures. Plusieurs caisses hors-ligne sont une extension possible seulement avec partition des factures, numéros et droits de stock définis ici ; jamais une copie complète librement modifiable de chaque solde.

Le poste principal est proposé sur PC Chrome/Edge stable, disque et session utilisateur protégés, imprimante locale fonctionnelle. Les autres écrans sont responsive Android/iPhone ; un téléphone n’est autorisé à émettre financièrement hors-ligne qu’après passage des tests de stockage, fermeture/reprise et impression/export sur ce navigateur réel. Le choix exact des appareils reste une information de préparation, pas un besoin de VPS.

## Préparation du poste

1. Connexion initiale en HTTPS, enrôlement par la gérante et attribution d’un `device_id`.
2. Installation/préchargement des ressources PWA, fontes/logo/templates et version des règles métier.
3. Génération d’une clé ES256 du poste, enregistrement de sa clé publique et délivrance d’autorisations serveur signées par profil : cabinet, utilisateur, rôle, appareil, version de règles, validité et opérations admises. Une clé/journal par appareil, grants individuels et compartiments de données selon droits ; précisions d’implémentation au fichier 23.
4. Coffre par profil : clé de chiffrement AES-GCM, protégée par secret local utilisateur ; les profils n’ont pas accès aux données d’un autre rôle. Ne pas conserver le mot de passe serveur ni un bearer token utilisable indéfiniment.
5. Téléchargement du catalogue/paramètres, annuaire administratif nécessaire, dossiers de travail autorisés, factures anciennes affectées à cette caisse, droits de stock et plages de numéros.
6. Demande de stockage persistant quand supportée, mesure espace disponible, test d’écriture/relecture et test avec le réseau coupé. Vérifier le mode privé/incognito interdit pour ce poste.

Autorisation hors-ligne proposée de 72 h après dernière préparation, configurable selon l’usage et la politique de sécurité. Les ressources (numéros, factures et stock) restent réservées même après cette expiration : elles ne sont jamais réallouées automatiquement, car des opérations locales pourraient encore attendre la synchronisation. Préparer suffisamment de numéros pour la durée prévue ; l’expiration/épuisement doit être annoncé avant de bloquer une nouvelle émission.

Après expiration, verrouiller les nouvelles opérations sensibles jusqu’au renouvellement ; conserver et exporter les opérations déjà émises. Une révocation serveur ne peut pas être instantanément connue d’un poste déconnecté. À la reconnexion, examiner les événements dans leur contexte d’autorisation et conserver les pièces en litige ; ne pas les supprimer sous prétexte que le compte est désormais désactivé.

## Architecture locale

Service worker : met en cache seulement shell/version d’application, JS/CSS, fontes et ressources publiques nécessaires. Pas de cache générique des réponses API patients. IndexedDB/Dexie : coffre des entités autorisées, snapshots de pièces, PDF, journal d’événements, commandes en attente, paramètres et ressources allouées.

Données personnelles et médicales chiffrées au repos par profil. Index sensibles non laissés en clair ; pour L0, un annuaire administratif borné peut être déchiffré en mémoire lors de la session et recherché localement. Les patients non préparés sont recherchables sur serveur quand le réseau revient. Le stockage local contient le minimum opérationnel, pas toute la base clinique téléchargée indistinctement.

Le backend PHP reste l’autorité centrale de consolidation et d’intégration. Le poste est l’autorité temporaire exclusive pour ses écritures financières autorisées. Client et serveur utilisent les mêmes règles/version et vecteurs JSON. Le serveur vérifie catalogue/tarif/taxe préparés dans le grant : une modification centrale ultérieure ne change pas rétroactivement le prix autorisé pendant sa validité. Une pièce signée doit toujours être recalculée et contrôlée.

## Numéros de dossier facture reçu et avoir

Le serveur alloue sous verrou des plages disjointes `(cabinet,type,année,début,fin,device_id,grant_id)` avant la coupure. Exemple : FAC 000001–000300 caisse A, FAC 000301–000600 éventuelle caisse B. Une allocation serveur en ligne utilise des nombres hors de toutes les plages réservées. Aucun `MAX+1` local et aucune renumérotation après synchronisation.

Le poste consomme le prochain numéro dans la transaction locale qui émet la pièce ; compteur, document et commande sont atomiques. Patient hors-ligne reçoit ULID local et numéro de dossier dans sa plage ; l’identifiant reste identique à la synchronisation. Une plage est clôturée explicitement après reprise complète ; numéros inutilisés marqués non utilisés et conservés, jamais recyclés sans procédure validée.

Année calculée selon fuseau cabinet. Préparer les plages de nouvelle année avant franchissement ; en l’absence de plage valide, bloquer émission et utiliser procédure de secours reconnue, sans modifier arbitrairement la date. Les règles de série et trous sont à valider avec la gérante/comptable avant production.

## Un seul rédacteur financier par facture

Une facture créée localement appartient au poste qui l’émet. Une facture existante/une créance papier doit être affectée à ce poste pendant une synchronisation en ligne avant encaissement hors-ligne. `invoice_write_owners` conserve poste, epoch et droit actif, sans expiration qui libère automatiquement.

Tant que le droit local est actif, une autre caisse ou API ne peut enregistrer paiement/avoir/remboursement/modification de cette facture. Le poste propriétaire utilise le journal local aussi lorsqu’il a Internet ; il ne maintient pas deux chemins indépendants de paiement qui se concurrencent. La gérante peut lire l’état consolidé et demander un transfert, mais ne force pas une nouvelle écriture distante sur un solde peut-être déjà réglé localement.

Transfert : synchroniser toutes les commandes du propriétaire, vérifier dernier compteur/hash et absence de pièces en attente, fermer son droit local, puis réattribuer un epoch supérieur à la nouvelle caisse. Si ancien poste perdu/non accessible, suspendre la facture, reconstruire depuis pièces et sauvegarde, obtenir décision documentée ; ne pas réaffecter silencieusement une créance dont le solde réel est inconnu.

La création d’un nouvel impayé ou son règlement sur la caisse préparée fonctionne sans réseau. Si un patient revient sur un autre poste pendant une coupure, l’interface indique « Encaissement disponible sur la caisse A » et oriente vers celle-ci. C’est la règle L0 qui évite le double encaissement hors-ligne.

## Droits de stock pré-alloués

Le serveur transfère à la caisse hors-ligne un quota réservé par article/emplacement/lot, appelé `device_stock_allocations`. Ces unités sont retirées du disponible global pour les autres caisses, tout en restant dans le stock physique théorique du cabinet jusqu’à remise. Par défaut L0 affecte le stock vendable concerné à la caisse principale.

Disponible central = physique − réservations centrales − quotas locaux encore non consommés/rapatriés. Disponible local = quota alloué − sorties locales − réservations locales actives. Une réservation locale puis une remise locale ne consomment pas deux fois le quota. Une réservation synchronisée sous quota reste rattachée à ce quota, exclue des réservations centrales libres ; ne pas la soustraire deux fois. Une sortie synchronisée diminue physique et quota résiduel dans la même transaction.

Exemple : physique 5, quota A 3 → disponible central 2, local 3. A remet 1 hors-ligne → disponible local 2 ; après sync physique central 4, quota A 2, disponible central 2. Pas de survente par le poste B. Une sortie/annulation serveur ne peut toucher des unités sous quota local sans transfert/restitution confirmée. **L0 (D10, 9 novembre 2026) : la remise reste en ligne** ; l’exemple ci-dessus vaut pour le lot qui ouvrira la remise hors-ligne. En L0, A réserve 1 hors-ligne : disponible local 2 ; après sync physique central 5, quota A 3 dont 1 réservé, disponible central 2.

Un lot expire aussi hors-ligne et reste bloqué à la date locale ; contrôles d’horloge du poste et alerte de date incohérente. Une réception/adjustement hors-ligne exige gérante autorisée présente et affecte uniquement les ressources de ce poste ; les fonctions fournisseurs avancées peuvent attendre L1. Aucun droit de stock disponible n’autorise une remise sans facture ou mouvement justifié.

## Commande atomique et impression

Commande locale : vérifier profil/autorisation, droit de facture, version, numéros, stock et approbation ; calculer le résultat ; préparer chiffrement/signature hors transaction IndexedDB si les API asynchrones risquent de fermer la transaction ; ouvrir transaction et revérifier versions/compteurs ; écrire ensemble entités, séquences, écritures, audit et outbox locale. Conflit local → recommencer calcul, sans pièce déjà affichée comme émise.

Après commit local, le paiement est un fait enregistré sur ce poste et le reçu possède son numéro définitif. Générer PDF à partir du snapshot, garder fonts/templates locales, imprimer/exporter. Échec de PDF ou d’imprimante → reprendre génération/impression de cette pièce, pas un second encaissement. L’interface distingue « émis localement » et « consolidé sur le serveur » ; la pièce ne change pas de numéro après reprise.

Au démarrage d’examen hors-ligne, vérifier la pièce locale de frais ou une dérogation gérante signée. Un paiement seulement connu d’une autre caisse déconnectée n’est pas deviné. Le flux L0 complet peut se faire sur le poste principal avec changement de profil et compartiments autorisés. Les approbations distantes attendent la connexion ; une gérante présente autorise via son profil préparé, sans PIN commun.

Deux postes coupés d’Internet ne voient pas automatiquement leurs nouvelles fiches. Pour transférer un patient créé à l’accueil vers la caisse, proposer un paquet administratif signé (ULID/numéro/identité minimale, sans données médicales), en QR à scanner ou export/import local contrôlé. Il garde le même ID et la référence de création ; ne pas recréer la fiche. Pour prouver les frais à un autre poste clinique, le reçu peut porter un QR signé avec visite/prestation/montant/solde/date et origine vérifiable à partir des clés préparées ; alternativement dérogation gérante. Pas de sync LAN ou de scanner supposés disponibles sans vérification Q02. L0 garantit au minimum le parcours complet sur le poste principal préparé ; transfert multiposte doit être testé avant promesse d’un parcours réparti sans réseau.

## Protocole de synchronisation

| Endpoint | Fonction |
| --- | --- |
| `POST /api/v1/devices/enroll` | Enrôlement, clés et droits gérante |
| `POST /api/v1/devices/{id}/prepare` | Autorisations, plages, droits financiers/stock et catalogue versionné |
| `POST /api/v1/sync/push` | Lot ordonné de commandes immuables |
| `GET /api/v1/sync/pull?cursor=...` | Changements autorisés depuis curseur opaque, pagination |
| `POST /api/v1/devices/{id}/release` | Clôture après vérification et restitution des droits |
| `POST /api/v1/documents/{id}/content` | Upload privé du PDF correspondant au snapshot/hash |

Enveloppe locale : `command_id` ULID, `device_id`, `actor_id`, `grant_id`, `device_sequence`, `previous_event_hash`, `event_hash`, `signature`, `schema_version`, `rules_version`, `occurred_at_local`, `last_server_time`, `entity_id`, `expected_version`, `number_allocation_id?`, `stock_allocation_ids?`, `payload`. Les valeurs décimales sont des chaînes ; la sérialisation à signer est canonique et identique PHP/TS, testée avec Unicode et clés ordonnées.

Employer les primitives Web Crypto et une bibliothèque serveur standard pour signature/JWS ; fixer algorithme ES256 et formats de signature dans le contrat implémenté, avec vecteurs de test, sans inventer un algorithme. Les enveloppes sensibles sont chiffrées dans le coffre ; si envoi après verrouillage du profil souhaité, conserver une enveloppe chiffrée pour le serveur avec chiffrement hybride standard. Sinon synchroniser à l’ouverture du profil et l’annoncer ; ne pas conserver plaintext médical pour faciliter le background sync.

Le serveur traite dans l’ordre du poste, persiste inbox/idempotence, vérifie signature, autorisation, allocation, liens et invariants, puis applique chaque commande en transaction avec audit/outbox. Commande déjà acceptée avec même hash → ACK existant. Même ID avec autre hash → conflit d’intégrité. Parent manquant → `WAITING_DEPENDENCY`, pas création de doublon. Un événement financier incohérent est placé en litige avec original intact, jamais perdu.

ACK par commande : `ACCEPTED`, `ALREADY_ACCEPTED`, `WAITING_DEPENDENCY`, `CONFLICT_REQUIRES_REVIEW` ou `REJECTED` décidé après revue, référence des pièces et version centrale. En cas de timeout, rejouer les mêmes IDs. Le client ne retire une commande de la file active qu’après ACK final durable ; les pièces/commandes originales restent archivées selon politique locale. Un REJECTED finalise la revue sans créer un fait financier accepté. Le fichier 23 définit le préfixe finalisé vérifié et la reprise de N+1 après conflit N ; aucun saut automatique d’un conflit non résolu. Curseur pull n’avance qu’après application complète et transactionnelle d’une page, avec ordre de publication central défini en 23.

Le client synchronise quand ouvert, à reconnexion détectée, à l’ouverture du profil et sur bouton. Tester la connexion réelle par requête, pas seulement `navigator.onLine`. Background Sync est une optimisation facultative, pas une garantie sur iPhone. Aucun envoi réel externe avant ACK central de la source.

## Conflits non financiers

Patient créé deux fois pendant coupure : conserver deux identités, signaler le doublon probable, fusionner seulement après revue gérante et préserver numéros/références de pièces. Une facture émise conserve son snapshot même après rattachement d’un dossier fusionné.

Identité/consultation modifiée sur plusieurs postes : ne jamais appliquer dernier écrit gagne sur clinique. Garder version de base et propositions locales en conflit ; professionnel compare et choisit/crée une correction versionnée. Les consultations distinctes du même patient peuvent se synchroniser indépendamment. **L0 (D10) : la consultation n’est pas une commande de poste** ; ce principe vaut pour le lot qui l’ouvrira hors-ligne, la fiche patient restant couverte dès L0.

RDV pris hors-ligne : affiché « créneau à confirmer », car les autres calendriers sont inconnus. La recommandation de contrôle et sa date sont sauvegardées, mais la confirmation globale attend validation serveur/Google. Une réservation conflictuelle revient en proposition avec options, sans faux message de confirmation.

## Conservation et incidents locaux

Le navigateur peut perdre son stockage par suppression, panne disque ou politique de stockage ; persistance demandée n’est pas sauvegarde. Export chiffré des commandes/PDF à clôture et coupure prolongée, sur support contrôlé ; clé de récupération scellée gérante. Restaurer mêmes IDs/numéros des pièces déjà émises, sans émettre de copies comme de nouveaux reçus. Un remplacement matériel est enrôlé avec un nouveau device_id et de nouvelles plages pour les émissions futures après réconciliation de l’ancien poste. Aucune reprise des numéros non consommés d’une machine potentiellement encore active ; clôturer ses droits et traiter toute réapparition en revue.

Ne jamais effacer cache/coffre, désinstaller la PWA ou migrer son schéma en détruisant la base tant que des pièces attendent. Mise à jour SW proposée après sync/export ; conserver code/templates de la version émettrice jusqu’à reprise. Deux onglets partagent les verrous locaux/versions ; une mise à jour ne peut modifier les règles d’une émission déjà commitée.

Détecter saut arrière d’horloge par rapport à la dernière heure serveur/dernier événement et bloquer les opérations datées suspectes. Une horloge navigateur et un poste déconnecté ne fournissent pas une preuve absolue de temps ni une révocation immédiate ; préserver les deux dates local/serveur et tracer la réconciliation. Signature du poste détecte corruption et identifie la provenance ; elle ne transforme pas un navigateur compromis en matériel inviolable.

Dashboard distant gérante : afficher dernière sync de chaque caisse et avertissement « Totaux incomplets : poste A non synchronisé depuis ... ». Les opérations hors-ligne ne peuvent pas être visibles à distance avant transmission. Le dashboard local caisse inclut ses pièces non synchronisées sans les compter une deuxième fois après ACK.

## Gate L0

Les [contrats d’ingénierie 23](23-contrats-ingenierie.md) précisent le journal commun au poste, JCS/JWS, transactions/CAS, sync par profil ouvert, versions et recovery. Les [gates 25](25-validation-et-bascule.md) et tâches O01–O07 décrivent les preuves d’implémentation.

Avant production : scénario complet sans réseau après redémarrage, nouveau patient → facture → acompte/reçu → solde/reçu → impression → reconnexion ; reprise après timeout ; double onglet ; ancienne créance affectée ; réserve dernier article ; autorisations ; export/restauration locale ; mise à jour avec commandes pendantes. Le fichier 14 fournit les critères. Sans ces preuves, la fonctionnalité hors-ligne ne peut pas être annoncée comme livrée.

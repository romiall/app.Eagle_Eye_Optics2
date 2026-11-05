# Coffre local chiffré et compartiments (O01)

Tâche O01 du backlog (L0, risque **HIGH** ; prérequis F05 et F09 ; regroupement L0-15). Sorties
attendues : la fermeture et la reprise retrouvent le coffre ; un mauvais profil ne déchiffre ni
l'index sensible ni un PDF ; le verrouillage masque la mémoire et l'écran et préserve le chiffré.
Validation : inspection d'IndexedDB et du cache, tests de déchiffrement refusé. Scénarios AT02, AT36,
AT45 ; exigences EE016, EE042. Références : fichier 19 (« Préparation du poste », « Conservation et
incidents locaux »), fichier 23 (« Compartiments », « Tables locales », « Chiffrement »), fichier 09.

**Statut : conception version 2 ; implémentation O01, O02, O03 et O04 CODÉE le 2026-10-23, NON EXÉCUTÉE** (vérification
de fin de phase à venir ; voir « Implémentation (O01, O02) » en fin de fichier). La version 1 a été relue par trois angles
(cryptographie, exploitation hors ligne, compartiments et conformité) puis chaque constat important
a été soumis à un sceptique : 73 constats retenus (4 bloquants, 42 majeurs, 27 mineurs). Cette version
tranche chacun : adopté (D), renvoyé à une tâche précise (R) ou écarté (E), avec sa raison (section
« Registre des décisions »). La section « Implémentation » s'ajoutera à la livraison.

## Périmètre

O01 livre, sans écran métier :

1. les primitives cryptographiques et leur auto-test (AES-GCM avec AAD, PBKDF2, HKDF, enveloppes) ;
2. la hiérarchie de clés : une clé aléatoire par compartiment, enveloppée par profil et par la clé de
   récupération ; un emplacement réservé à la clé de signature du poste (O02) ;
3. le coffre Dexie (tables, durabilité stricte, versions) et ses opérations : création, profils,
   déverrouillage limité en tentatives, verrouillage, changement de secret, récupération, retrait ;
4. l'écriture et la lecture chiffrées d'entités, de documents et de brouillons, par compartiment ;
5. la session du coffre : autorité persistée, plusieurs onglets, inactivité, verrouillage à la
   déconnexion ;
6. l'annuaire administratif cherché en mémoire ;
7. le classement des permissions et des commandes par compartiment (contrat partagé) ;
8. l'intégration à l'application : route de déverrouillage, écran de verrouillage qui remplace la
   coquille, état dans l'en-tête, identité d'action ;
9. l'état du stockage (persistance, quota, aller-retour) pour O02 ;
10. la preuve en navigateur réel (IndexedDB brut, disque, cache).

Hors O01 : enrôlement et grants signés (O02), plages de numéros (O03), journal, commit local et
attestations de frais d'examen signées (O04), synchronisation (O05), mise à jour du schéma et de la
PWA (O06), export et restauration (O07). **Rotation des clés de compartiment : non planifiée** (voir
« Écarts de planning »).

## Registre des décisions

Adoptées (D), renvoyées (R) ou écartées (E). Le numéro sert de référence dans le code et les tests.

| N° | Décision | Constat à l'origine |
| --- | --- | --- |
| D1 | **Clés de session non extractables, KEK jamais conservée.** Au déverrouillage : dérivation de la KEK, `unwrapKey` non extractable de chaque compartiment, KEK abandonnée. Toute opération qui ré-enveloppe (ajout de profil, changement de secret, réémission, remplacement de la récupération) **ressaisit un secret** (profil acteur ou clé de récupération), re-dérive la KEK, déballe en extractable dans une portée fermée, enveloppe pour la cible, ne laisse aucune référence. `wrapKey` refuse une clé non extractable : « extractable le temps de l'envelopper » était faux | Bloquant ×3 |
| D2 | **Trois phases pour toute opération sur les clés.** A : tout `crypto.subtle` (dérivation, enveloppes, IV), hors transaction. B : vérification en mémoire (déballage de chaque enveloppe candidate, aller-retour d'un vecteur de test) ; échec = rien d'écrit. C : une seule transaction `rw` qui compare une époque (CAS) et n'écrit que des lignes déjà prêtes. Un test échoue si `crypto.subtle` est appelé pendant `Dexie.currentTransaction`. Les modules `crypto/` et `keys/` n'importent pas la base ; `vault/store` n'importe pas `crypto.subtle` (ESLint) | Majeurs |
| D3 | **AAD** `["eeo-vault-v1", but, cabinet, coffre, …]` : tableau JSON de chaînes non vides, nombres en décimal sans zéro initial, but obligatoire (`entity`, `document`, `draft`, `envelope`, `kcv`), octets figés par des vecteurs. **`vaultId`** (ULID aléatoire créé avec le coffre, immuable) remplace `device_id` : le poste n'est connu qu'après l'enrôlement (O02 dépend d'O01) et un poste de remplacement (O07) reçoit un nouveau `device_id`. `deviceId` est consigné une fois dans `vault_meta` (`bindDevice`) et figure dans le journal signé. Écart assumé avec la ligne « appareil » du fichier 23, à consigner en décision | Majeurs |
| D4 | **`keyId`** (entier par compartiment, 1 au départ) dans l'AAD, les enveloppes et les lignes dès la version 1 : une rotation ultérieure n'impose pas de migrer le format | Majeur |
| D5 | **Une seule KEK par profil** : `profiles.kdf = {salt (16 octets), iterations, normalization: 'NFKC'}` et `kekVersion`, lus et bornés ([600 000 ; 5 000 000] en production, `KDF_PARAMS_REJECTED` sans calcul sinon) ; un **témoin de validation de la KEK** (`kcv`, AES-GCM d'une constante) distingue mauvais secret et enveloppe corrompue | Majeurs |
| D6 | **Politique PBKDF2 injectée à la construction** (minimum, maximum, cible de calibration). La production la fixe en dur dans `offline/api` ; les tests passent 1 000 itérations. Un test Playwright lit les itérations dans l'IndexedDB réelle et exige ≥ 600 000 | Mineurs |
| D7 | **Pas de compteur de chiffrements ni de plafond 2^31** (code mort et ligne chaude). Nonce de 96 bits aléatoires généré **dans** `seal()`, `tagLength` 128 explicite. La borne NIST SP 800-38D (2^32 par clé) est documentée ; une rotation (R-rotation) la rend inatteignable | Majeurs / mineurs |
| D8 | **Secret local** : normalisé NFKC avant PBKDF2 (vecteur de test NFC/NFD), sans rognage (espaces de tête ou de fin refusés), au moins 14 caractères, ne contenant pas le login, refus des motifs triviaux (`SECRET_TOO_WEAK`). L'application propose un secret généré : 4 mots prononçables de 5 lettres (consonne-voyelle ×2 puis consonne, tirage uniforme sans biais), environ 68 bits. Pas de bibliothèque d'estimation d'entropie (poids de la PWA) ni de liste de mots tierce (licence). Le champ n'est pas mémorisé par le navigateur | Majeur |
| D9 | **Clé de récupération** : 32 octets aléatoires + 2 octets de contrôle, Crockford base32 en 11 groupes de 5 caractères ; dérivation HKDF-SHA256 (sel = `vaultId`, info `eeo-vault-v1/recovery/kek` et `…/recovery/verifier`). Création **en deux phases** : préparation en mémoire, affichage, ressaisie complète, puis seulement l'écriture. `verifyRecoveryKey` (non destructif) et `replaceRecoveryKey` | Majeurs |
| D10 | **Tentatives** : `reserveAttempt` (transaction courte) **avant** la dérivation, résolution après ; 0 s jusqu'à 4 échecs, puis `min(900 s, 30 s × 2^(n−5))` ; même chemin de calcul (dérivation factice) pour un profil inconnu ; message uniforme `AUTH_FAILED`. L'horloge est celle du navigateur (limite déclarée) | Majeurs / mineurs |
| D11 | **Session du coffre persistée** (`vault_meta.session`) avec époque et comparaison en transaction (`assertSession`) ; `BroadcastChannel` n'est qu'un accélérateur. Chaque onglet se déverrouille lui-même (aucun partage de clés). Un autre profil qui se déverrouille termine la session du premier | Majeurs |
| D12 | **Verrouillage** : l'intention est immédiate (époque + état « en verrouillage »), les opérations en vol rejettent `VAULT_LOCKED` à leur résolution, des crochets `onBeforeLock` (délai de 2 s) enregistrent les brouillons, puis références aux clés et à l'annuaire supprimées. Promesse honnête : le coffre devient inaccessible à l'application et à l'interface ; **la mémoire physique n'est pas effacée** | Majeurs |
| D13 | **Inactivité** : horodatage d'activité persisté (écriture au plus toutes les 15 s) ; chaque onglet verrouille quand `maintenant − dernière activité ≥ 30 min` (avertissement à 28 min) ; un recul d'horloge verrouille (`CLOCK`) | Majeur |
| D14 | **La coquille métier est démontée** quand le coffre est verrouillé (pas un simple recouvrement) ; seul l'écran de déverrouillage reste ; titre de l'onglet et URL d'objet révoqués ; aucun document ouvert hors de `openDocument` | Majeur |
| D15 | **Déconnexion** : le verrouillage local passe en premier, synchrone, sans réseau ; la déconnexion du serveur suit au mieux (reprise marquée). Une session serveur expirée (401, 419) ou non vérifiable ne verrouille pas | Majeur |
| D16 | **Compartiments fondés sur une fonction totale** des 49 permissions (`ADMIN`, `CLINICAL`, `FINANCIAL`, `MANAGER`, `NONE`), dans un contrat partagé `contracts/compartments.json` (permissions, commandes, visibilités). Un profil sans compartiment est refusé (`PROFILE_WITHOUT_COMPARTMENT`) ; le témoin KCV rend le déverrouillage indépendant des enveloppes | Majeurs |
| D17 | **`exam_fee.collect` ne donne pas `FINANCIAL`** : la clé financière ouvrirait toutes les ventes à l'accueil, contre la ligne « finance seulement caisse/gérante » du fichier 09. Les pièces de frais d'examen relèvent d'`ADMINISTRATIVE` (lisibles par le professionnel qui vérifie le paiement avant la consultation). Leur discrimination (champ `scope` des factures, attestation signée) est **à contractualiser avant B02 et P03** (R-examen). Conséquence documentée : `cash.own_session` donne la clé financière entière | Bloquant / majeurs |
| D18 | **Chaque commande est scellée entière dans un seul compartiment**, fonction pure de `command_name`, détenu par tous les rôles porteurs de sa permission. Registre des 26 commandes dans `contracts/compartments.json`, test d'exhaustivité contre `contracts/commands/index.json` ; le coffre refuse un couple (type, compartiment) incohérent (`COMPARTMENT_MISMATCH`) et un type inconnu (`ENTITY_TYPE_UNREGISTERED`) avant tout appel de chiffrement | Majeurs |
| D19 | **`key_envelopes` générique** : emplacement `ADMINISTRATIVE`, `CLINICAL`, `FINANCIAL`, `MANAGER` ou `DEVICE_SIGNING`, format `raw` ou `pkcs8`. La paire ES256 du poste est générée par O02 extractable, sa clé publique JWK est conservée en clair, la privée est enveloppée pour chaque profil habilité à signer et rechargée non extractable (`['sign']`). Elle n'entre pas dans la récupération (pas de clone actif des droits). Tout profil signataire peut signer au nom d'un autre profil du même poste : limite déclarée | Majeurs |
| D20 | **Durabilité** : `chromeTransactionDurability: 'strict'` ; le rapport de stockage dit si la durabilité est stricte. Firefox et Safari restent relâchés : prescription matérielle (onduleur ou portable sur batterie) au runbook | Bloquant (ops) |
| D21 | **Version de format** `vault_meta.format = {formatVersion, minWriterVersion}` ; un client trop ancien ou une base trop récente refuse d'écrire (`VAULT_FORMAT_TOO_NEW`) ; `versionchange` ferme la base ; registre ordonné des versions de schéma, ajouts seulement ; `vault_formats` déclaré dans `contracts/compatibility.json` | Majeur |
| D22 | **Brouillons** : table `encrypted_drafts` par profil, `putDraft` / `getDraft` / `deleteDraft` / `listDrafts`, crochet `onBeforeLock`. Les écrans s'y branchent (P01, C01…) | Majeur |
| D23 | **Journal de sécurité local** `vault_events` (append-only, sans secret ni donnée patient) pour création, profils, secrets, récupération, retraits, verrouillages par échecs. Il remontera par O05 | Mineur |
| D24 | **Module d'état du stockage** (`storageHealth`) avec port injectable : persistance demandée, quota, aller-retour d'écriture, soupçon de mode privé (heuristique, jamais une preuve), durabilité. O01 le livre, O02 l'appelle à l'enrôlement | Majeur |
| D25 | **Auto-test Web Crypto** au premier démarrage, à la création et à la préparation : `wrapKey` avec AAD doit réussir avec le bon AAD et échouer avec un autre ; sinon `WEBCRYPTO_SELFTEST_FAILED` et coffre refusé | Mineur |
| D26 | **Façade `@/offline/api`** : seule importable depuis `app/` avec les projections (règle ESLint étendue) ; elle n'expose ni table ni `CryptoKey`. Erreurs typées `VaultError` à code stable. `seal` / `open` purs et `assertSession(tx)` fournis à O04 | Majeurs |
| D27 | **Intégration application** : état du coffre (`unknown`, `absent`, `locked`, `unlocked`, `damaged`), route publique de déverrouillage avant la connexion, identité d'action unique (profil du coffre hors ligne, compte du serveur en ligne, divergence signalée), `useMutation` et `ReauthDialog` rattachés à cette identité, issue `vault-locked` du répartiteur | Majeurs |
| D28 | **Preuves navigateur** : bundle de test séparé injecté (jamais dans le build de production, test d'architecture), IndexedDB brut parcouru dans la page, disque du profil Chromium scanné dans quatre encodages avec un témoin de détectabilité, redémarrage complet par contexte persistant, Cache Storage vide d'API | Majeurs |
| D29 | **Tests Vitest en environnement Node** (`// @vitest-environment node`), `fake-indexeddb`, horloge, canal, verrous Web Locks, contexte sécurisé et politique PBKDF2 injectés ; un test réel à 600 000 itérations | Majeurs / mineurs |
| R-rotation | Rotation d'une clé de compartiment : **aucune fiche du backlog ne la porte** (O06 et O07 non plus). Décision de planning à prendre avant G2 | Majeur |
| R-export | Export brut, manifeste, ouverture d'une archive et restauration : O07. O01 impose seulement des contraintes (fonctions de `keys/` pures, `vaultId` et `keyId` conservés, aucune clé en clair) | Majeur |
| R-examen | Attestation de frais d'examen signée (JWS de la clé du poste), champ `scope` des factures, variante d'AT02 : B02, B04, O04, P03 | Bloquant / majeur |
| R-approbations | Compartiment des approbations selon `action_code` (B06) ; O01 classe provisoirement `RequestApproval` et `DecideApproval` en `ADMINISTRATIVE` | Majeur |
| E1 | Partage de `CryptoKey` entre onglets par `postMessage` : écarté (chaque onglet se déverrouille ; surface d'attaque et complexité) | Majeur |
| E2 | Compteur d'activité diffusé et copie dans `localStorage` : écarté ; remplacé par D13 | Majeur |
| E3 | `rawExport` / `openLegacy` / `importFrom` dans O01 : écarté (R-export) | Majeur |
| E4 | Argon2id, zxcvbn et liste de mots tierce : écartés (CSP sans WebAssembly, poids, licence) | Mineurs |
| E5 | Clé d'index HMAC pour masquer les identifiants liés : écartée en L0 ; `keyId` permet de l'ajouter | Mineur |
| E6 | Worker dédié pour l'annuaire : écarté en L0 (chargement par lots avec cession du fil, borne de 20 000 fiches, couverture dans le résultat) | Mineur |

## Modèle de menace

| Menace | Réponse | Limite |
| --- | --- | --- |
| Poste volé ou disque lu hors ligne | Données personnelles et médicales chiffrées au repos (AES-256-GCM) ; clés enveloppées par un secret local dérivé par PBKDF2-HMAC-SHA256 calibré (≥ 600 000) | Un secret faible tombe à une attaque hors ligne ; la limite de tentatives de l'interface ne protège pas contre elle |
| Mauvais profil sur le même poste | Une clé par compartiment ; un profil n'a que les enveloppes de ses compartiments | Un profil qui a connu une clé la garde (voir « Limites ») |
| Écriture dans IndexedDB par un tiers | AAD lié au cabinet, au coffre, au compartiment, à la génération de clé, au type, à l'identifiant et à la version : une ligne déplacée ne se déchiffre pas | Le retour à une ancienne version cohérente de la même ligne n'est pas détecté localement : la chaîne du journal signé (O04, O05) le détecte à la synchronisation |
| Script injecté pendant que le coffre est ouvert | Clés non extractables, CSP stricte (F03), verrouillage à l'inactivité | Une page compromise peut **utiliser** les clés tant que le coffre est ouvert : non extractable empêche leur copie, pas leur emploi |
| Service worker et cache | Aucune réponse de l'API en cache | — |
| Perte du secret d'un profil | Clé de récupération de la gérante, hors du poste | Sans elle ni la gérante, les données du profil sont perdues |

## Compartiments

Quatre compartiments (fichier 23) : `ADMINISTRATIVE`, `CLINICAL`, `FINANCIAL`, `MANAGER`. Un
compartiment protège la **confidentialité** ; le droit d'écrire se vérifie dans le moteur de
commandes (O04) contre le grant. Une entité appartient à un seul compartiment.

### Permissions

`contracts/compartments.json` classe **chacune des 49 permissions** du référentiel
(`database/02_reference_data.sql`) dans une classe fermée ; une permission non classée ou en trop
fait échouer le test. `compartmentsOf(permissions)` en déduit l'ensemble des compartiments.

| Classe | Compartiment gagné | Permissions |
| --- | --- | --- |
| `ADMIN` | `ADMINISTRATIVE` | `patient.read`, `patient.create`, `patient.update`, `patient.merge`, `visit.register`, `agenda.read`, `agenda.write`, `follow_up.write`, `catalog.read`, `stock.read`, `approval.request`, `statistics.activity`, `exam_fee.collect` |
| `CLINICAL` | `CLINICAL` | `clinical.read`, `clinical.write`, `clinical.complete`, `clinical.amend`, `clinical.export`, `statistics.clinical` |
| `FINANCIAL` | `FINANCIAL` | `invoice.read`, `invoice.create`, `invoice.issue`, `payment.collect`, `payment.reverse`, `credit_note.issue`, `refund.execute`, `delivery.confirm`, `cash.own_session`, `cash.manage` |
| `MANAGER` | `MANAGER` | `approval.decide`, `finance.global.read`, `finance.reconcile`, `catalog.manage`, `catalog.purchase_cost.read`, `stock.receive`, `stock.adjust`, `stock.inventory`, `stock.valuation.read`, `users.manage`, `audit.read`, `export.global`, `backup.manage`, `offline.enroll` |
| `NONE` | aucun (traitements du serveur) | `workshop.manage`, `communication.manage`, `conversation.takeover`, `knowledge.manage`, `site.publish`, `integration.manage` |

Résultat avec les rôles du référentiel : accueil → `ADMINISTRATIVE` ; professionnel →
`ADMINISTRATIVE` + `CLINICAL` ; caisse → `ADMINISTRATIVE` + `FINANCIAL` ; gérante → les quatre. Un
compte avec plusieurs rôles ou des dérogations reçoit l'union. `exam_fee.collect` seul donne
`ADMINISTRATIVE` (D17). Un compte sans aucune permission donnant un compartiment est refusé.

### Commandes (D18)

Chaque commande signée est scellée entière dans **un** compartiment, fonction pure de
`command_name` :

| Compartiment | Commandes |
| --- | --- |
| `ADMINISTRATIVE` (7) | `CreatePatient`, `UpdatePatient`, `RegisterVisit`, `CreateAppointment`, `RecordContactAttempt`, `RequestApproval`, `DecideApproval` |
| `CLINICAL` (7) | `StartConsultation`, `SaveClinicalStep`, `CompleteConsultation`, `AmendConsultation`, `CreatePrescription`, `ValidatePrescription`, `CreateFollowUp` |
| `FINANCIAL` (11) | `CreateInvoiceDraft`, `UpdateDraft`, `IssueInvoice`, `RegisterPayment`, `ReversePayment`, `IssueCreditNote`, `RefundCredit`, `OpenCashSession`, `CloseCashSession`, `ConfirmDelivery`, `RegisterPhysicalReturn` |
| `MANAGER` (1) | `RegisterStockMovement` (porte `unit_cost`) |

Tests : exhaustivité contre `contracts/commands/index.json` ; pour chaque commande et chaque rôle du
référentiel porteur de sa permission, le compartiment de la commande appartient aux compartiments du
rôle (`RegisterStockMovement` n'est accordée qu'à qui a `catalog.purchase_cost.read`). Conséquence
pour O05 : une commande scellée dans un compartiment que le profil synchronisant n'a pas bloque, par
l'ordre `device_sequence`, les commandes suivantes jusqu'à l'ouverture du profil porteur ; le tableau
de bord nomme le compartiment en attente (fichier 23).

## Hiérarchie de clés

```text
secret local ──NFKC──PBKDF2-HMAC-SHA256(sel, itérations)──► KEK du profil (AES-GCM 256)
                                                              │ wrapKey AES-GCM + AAD « envelope »
clé de récupération (256 bits, hors poste) ──HKDF-SHA256──► KEK de récupération
                                                              │ wrapKey AES-GCM + AAD « envelope »
                              clé de compartiment (AES-GCM 256, aléatoire, par compartiment et keyId)
                              clé de signature du poste (ECDSA P-256, pkcs8, emplacement DEVICE_SIGNING)
                                                              │ AES-GCM, nonce 96 bits, AAD
                              entités, documents et brouillons du compartiment
```

- **Session** : ne contient que les clés de compartiment **non extractables** (`unwrapKey` avec
  `extractable: false`) et la clé de signature non extractable (`['sign']`). Ni KEK, ni secret, ni
  clé de récupération, ni clé extractable (D1).
- **Portée de ré-enveloppement** : `withExtractableKeys(opération)` déballe en extractable, enveloppe
  pour la cible, puis libère ; aucune référence dans un module, un état réactif ou une fermeture.
- **Création** : clés générées extractables, enveloppées sous la KEK du profil et sous la KEK de
  récupération, vérifiées par `unwrapKey` non extractable, objets extractables abandonnés.
- **Auto-test** (D25) et **bornes** (D5, D6) s'appliquent avant toute dérivation.

## Tables locales (Dexie)

Version 1 du schéma, base `eeo-device`. Les index ne portent que des identifiants opaques et des
classifications ; aucun nom, téléphone ni contenu clinique n'y figure.

| Table | Clé et index | Contenu |
| --- | --- | --- |
| `vault_meta` | `key` | `format`, `identity` (`vaultId`, `clinicId`, `deviceId` ou null, création), `keys` (`keyId` courant par compartiment), `recovery` (vérificateur, `ackedAt`, génération), `session` (autorité), `activity`, `storage`, `logoutPending` |
| `profiles` | `id`, `userId` | Identifiant, utilisateur, login, nom affiché, état, `kdf`, `kekVersion`, `kcv`, tentatives et déblocage, dates. Les permissions et compartiments du profil sont scellés (`profile_access`, `ADMINISTRATIVE`) : jamais une autorisation lue en clair |
| `key_envelopes` | `id`, `[profileId+slot]` | Propriétaire (profil ou `RECOVERY`), emplacement, `keyId`, format, nonce, clé enveloppée, `kekVersion` |
| `encrypted_entities` | `id`, `[compartment+type]` | Compartiment, type, version, `keyId`, nonce, texte chiffré |
| `encrypted_documents` | `id`, `[compartment+kind]`, `entityId` | Compartiment, genre, identifiant opaque de la pièce, version, `keyId`, nonce, texte chiffré |
| `encrypted_drafts` | `id`, `[profileId+compartment]` | Brouillon d'un profil : compartiment, version, `keyId`, nonce, texte chiffré, date |
| `vault_events` | `++seq` | Événement de sécurité : type, instant, profil, détail non sensible |

Les tables du journal, des allocations et des curseurs arrivent avec O03 à O05 en versions suivantes
du schéma (ajouts seulement). Une migration ne détruit jamais la base tant que des pièces attendent.

## Opérations

| Opération | Autorité exigée | Effet |
| --- | --- | --- |
| `prepareVault` puis `commitVault` | Secret choisi par la gérante ; ressaisie de la clé de récupération | Crée le coffre dans une transaction ; refuse si un coffre existe (`VAULT_ALREADY_EXISTS`, verrou Web Locks) |
| `unlock(profil, secret)` | Secret du profil | Session ; tentatives limitées (D10) |
| `lock(raison)` | Aucune | D12 |
| `addProfile(acteur, profil, secretDuTitulaire)` | Secret de l'acteur ressaisi | Le titulaire saisit lui-même son secret sur place (aucun secret initial connu de la gérante) |
| `reissueProfile(acteur, profil, permissions, secretDuTitulaire)` | Secret de l'acteur ressaisi | Change les compartiments d'un profil existant ; si les compartiments diminuent : `rotationRequired` |
| `changeSecret(profil, actuel, nouveau)` | Secret actuel | Nouvelle KEK ; anciennes enveloppes remplacées dans la même transaction après vérification |
| `resetSecretWithRecovery(clé, profil, nouveau)` | Clé de récupération | Ré-enveloppe sous un nouveau secret ; remet les tentatives à zéro |
| `removeProfile(acteur, profil)` | Secret de l'acteur ressaisi | Supprime les enveloppes, garde l'identité (état `REMOVED`) ; refuse la dernière gérante déterminée dans la transaction ; `rotationRequired` |
| `verifyRecoveryKey(saisie)` / `replaceRecoveryKey(acteur)` | — / secret ressaisi | D9 |
| `putEntity` / `getEntity` / `listEntities`, `putDocument` / `getDocument`, `putDraft`… | Session active | Compartiment vérifié avant tout chiffrement ; version monotone |
| `seal` / `open` / `assertSession(tx)` | Session active | Primitives pures pour O04 (écrire des lignes scellées et le journal dans **une** transaction) |

Phase B de toute opération sur les clés : vérifier en mémoire que chaque enveloppe candidate s'ouvre
avec la KEK candidate avant la transaction. Une erreur typée `VaultError` (code stable, aucun secret
dans le message) : `INSECURE_CONTEXT`, `WEBCRYPTO_SELFTEST_FAILED`, `VAULT_ABSENT`,
`VAULT_ALREADY_EXISTS`, `VAULT_DAMAGED`, `VAULT_FORMAT_TOO_NEW`, `VAULT_LOCKED`,
`VAULT_SESSION_STALE`, `AUTH_FAILED`, `AUTH_THROTTLED` (`retryAt`), `KDF_PARAMS_REJECTED`,
`SECRET_TOO_WEAK`, `STEP_UP_FAILED`, `COMPARTMENT_NOT_AVAILABLE`, `COMPARTMENT_MISMATCH`,
`ENTITY_TYPE_UNREGISTERED`, `PROFILE_WITHOUT_COMPARTMENT`, `PROFILE_EXISTS`, `PROFILE_NOT_FOUND`,
`LAST_MANAGER_REQUIRED`, `ROW_DECRYPT_FAILED` (`table`, `id`), `ENVELOPE_CORRUPT` (`profileId`,
`slot`), `RECOVERY_KEY_INVALID`, `VERSION_NOT_NEWER`, `STORAGE_NOT_DURABLE`.

## Session, onglets, inactivité

- **Autorité** : `vault_meta.session = {sessionId, profileId, startedAt, endedAt, endReason,
  lastActivityAt}`. Un déverrouillage du même profil rejoint la session ouverte ; un autre profil
  la termine (`SUPERSEDED`). `assertSession(tx)` relit la ligne dans la transaction d'écriture :
  session terminée ou différente = `VAULT_SESSION_STALE`.
- **Diffusion** : `BroadcastChannel` (`lock`, `profile-removed`, `secret-changed`,
  `compartments-reduced`, `directory-changed`) accélère la propagation ; sans lui, le prochain
  `assertSession`, le retour de focus et la prochaine vérification d'activité suffisent.
- **Inactivité** (D13), **déconnexion** (D15), **verrouillage** (D12, D14).
- **Brouillons** (D22) : les écrans enregistrent un brouillon chiffré au plus toutes les 5 s quand le
  formulaire est modifié ; le crochet `onBeforeLock` (2 s) force un dernier enregistrement ; la
  reprise propose le brouillon après déverrouillage du même profil seulement.

## Intégration à l'application

- `app/services/vault.ts` : `VaultPort` (types), état réactif, `useVault()`, injection depuis la
  racine de composition ; la façade `@/offline/api` fournit l'implémentation.
- **Démarrage hors ligne (AT36)** :

| Coffre | Serveur | Comportement |
| --- | --- | --- |
| absent | quelconque | Flux actuel (connexion au serveur) |
| verrouillé | quelconque | Route publique `/deverrouiller` **avant** `/connexion` ; profils listés (login et nom) |
| déverrouillé | injoignable ou session non vérifiée | Permissions du profil local ; les routes marquées `offlineCapable` restent ouvertes |
| déverrouillé | session ouverte | Permissions du serveur ; divergence de compte signalée |
| endommagé / trop récent | quelconque | Écran d'état explicite, aucune écriture |

- **Identité d'action unique** (`app/actor.ts`) : calculée à partir du coffre et du serveur ;
  `can()`, `useMutation`, `ReauthDialog` et la garde du routeur la lisent. Une commande n'est jamais
  rejouée au nom d'un autre compte.
- **Répartiteur** : issue `vault-locked` (saisie conservée, reprise avec la même clé après
  déverrouillage) ; un coffre verrouillé ne fait jamais retomber une commande de poste sur la route
  directe.
- **Écran de verrouillage** (`LockScreen`) : remplace la coquille (`v-if`), titre de l'onglet
  réinitialisé, focus sur le champ de secret, délai restant annoncé après des échecs. `VaultStatus`
  dans l'en-tête : « Coffre verrouillé » / « Coffre déverrouillé : nom ».

## Stockage et PWA

`storageHealth` (D24) : persistance, quota, aller-retour, soupçon de mode privé, durabilité. Le
service worker ne met en cache que la coquille, les assets et les icônes (F03). Preuve en navigateur
réel (D28) : aucun cache du navigateur ne contient `/api/`, et ni IndexedDB ni le disque du profil ne
contiennent de texte clair.

## Tests

- **Vitest (Node)** : vecteurs d'AAD et d'enveloppes figés ; sélection d'octets (ligne déplacée,
  version rejouée, compartiment ou `keyId` changé) ; hiérarchie de clés (aucune KEK ni clé extractable
  en session, détecté par espionnage de `crypto.subtle`) ; trois phases et absence d'appel crypto dans
  une transaction ; création atomique ; mauvais secret, profil inconnu, tentatives et délai ;
  témoin KCV contre enveloppe corrompue ; mauvais profil devant chaque compartiment (entité,
  document, annuaire, brouillon) ; verrouillage (époque, opérations en vol, chiffré identique octet
  pour octet) ; plusieurs onglets (deux instances, canal factice) ; inactivité (horloge injectée) ;
  changement de secret, récupération (clé saisie en minuscules, avec I/L/O) ; retrait de la dernière
  gérante ; format trop récent ; classement des 49 permissions et des 26 commandes ; clé de signature
  (aller-retour ECDSA) ; recherche en mémoire.
- **Playwright** (`tests/e2e/vault.spec.ts`) : persistance après fermeture complète du navigateur ;
  itérations réelles ≥ 600 000 et temps de déverrouillage ; IndexedDB brut sans texte clair
  (témoin de détectabilité) ; disque du profil sans texte clair ; mauvais profil ; verrouillage ;
  Cache Storage sans API ; contexte sécurisé.
- **Mutations** ciblées sur les décisions D1 à D18 avant la revue.

## Interfaces pour les tâches suivantes

| Tâche | Reçoit d'O01 |
| --- | --- |
| O02 | `createVault` indépendant du serveur puis `bindDevice(deviceId)` ; emplacement `DEVICE_SIGNING` (`attachSigningKey`) ; `storageHealth` ; `compartmentsOf` pour émettre et vérifier `OfflineGrant.compartments` |
| O04 | `seal` / `open` purs, `assertSession(tx)`, `writeSealed(tx, lignes)`, registre de versions de schéma, registre type → compartiment |
| O05 | Un profil ouvert synchronise ce qu'il peut déchiffrer ; compartiment en attente nommé ; événements de sécurité à remonter |
| O06 | `format` / `minWriterVersion`, `versionchange` géré, ajouts seulement |
| O07 | `keys/` pur et sans état de session, `vaultId` et `keyId` stables, enveloppes `RECOVERY`, clé de récupération vérifiable ; l'export, le manifeste et la restauration restent à écrire |

## Limites déclarées

- **Rotation des clés** : retirer un profil ou réduire ses compartiments supprime ses enveloppes
  locales mais **ne révoque pas** une clé qu'il a déjà connue ; `changeSecret` ne révoque rien contre
  qui détient une copie antérieure du disque. `rotationRequired` signale le besoin à la gérante ; la
  rotation n'est pas planifiée (voir « Écarts de planning »).
- **Navigateur compromis** : une page compromise utilise les clés tant que le coffre est ouvert.
- **Mémoire** : `lock()` supprime les références aux clés et à l'annuaire ; l'effacement physique de
  la mémoire n'est pas garanti par JavaScript.
- **Secret faible** : longueur minimale et coût de dérivation retardent une attaque hors ligne, ne
  l'empêchent pas. Argon2id est exclu (CSP sans WebAssembly).
- **Métadonnées en clair** : nombre de lignes par type, dates, noms et logins des profils, tailles des
  textes chiffrés, identifiants opaques. Acceptées en L0.
- **Rejeu** d'une ancienne version entière d'une ligne : non détecté par le chiffrement seul.
- **Écriture** : qui détient une clé de compartiment peut écrire n'importe quelle entité de ce
  compartiment (AES-GCM n'authentifie pas l'auteur) ; la séparation des écritures vient des commandes
  signées et du serveur. La clé de signature du poste est commune à ses profils signataires.
- **Horloge** : délais de tentatives et inactivité s'appuient sur l'horloge du navigateur.
- **Durabilité** : Firefox et Safari ne garantissent pas le vidage disque à chaque transaction.
- **Compartiments plus gros que les permissions** : `cash.own_session` donne toute la clé
  financière ; une dérogation sur une permission `MANAGER` donne toute la clé `MANAGER`. Le
  formulaire de droits (U01) devra l'afficher à l'attribution.

## Écarts de planning et décisions à confirmer

1. **Rotation des clés de compartiment** : absente du backlog. Proposition : sous-tâche d'O07 ou
   tâche dédiée avant G2 (nouvelle clé, `keyId + 1`, rechiffrement par lots reprenables, enveloppes
   re-émises, anciennes supprimées). À décider.
2. **Frais d'examen** : décision D17 à confirmer avec le cabinet, avec le champ `scope` des factures
   (migration additive, contrats `CreateInvoiceDraft` et `UpdateDraft`, règles de refus) avant B02.
3. **`cash.own_session` pour l'accueil** : si l'accueil doit encaisser des espèces, il reçoit la clé
   financière entière. Pour L0, hypothèse : l'accueil n'encaisse pas d'espèces.
4. **Écart de format** : `vaultId` à la place de `device_id` dans l'AAD (D3), à consigner au registre
   des décisions.

## Implémentation (O01, O02) — codée le 2026-10-23, non exécutée

Rien n'a été exécuté (consigne du demandeur : vérification transversale en fin de phase). Les tests existent comme
fichiers ; la passe de vérification les lancera.

### Fichiers

| Partie | Fichiers |
| --- | --- |
| Primitives (D3 à D9, D25) | `resources/frontend/offline/crypto/{bytes,aad,aead,kdf,secrets,selftest}.ts` |
| JCS et JWS ES256 (O02) | `resources/frontend/offline/signing/{jcs,jws}.ts` ; serveur `app/Offline/{Jcs,CompactJws}.php` ; vecteurs communs `contracts/vectors/signatures/{jcs,grant-es256}.json` (clé de TEST jetable) |
| Compartiments (D16 à D18) | contrat partagé `contracts/compartments.json` ; `resources/frontend/offline/compartments.ts` ; `app/Offline/Compartments.php` |
| Coffre (D1, D2, D10 à D13, D19 à D23) | `resources/frontend/offline/vault/{db,errors,vault}.ts` (base `eeo-device`, version 1 coffre, version 2 `grants`) |
| PDF chiffrés | `resources/frontend/offline/vault/documentStore.ts` (`VaultDocumentStore`, port `DocumentStore` inchangé) |
| Stockage (D24) | `resources/frontend/offline/vault/storageHealth.ts` |
| Enrôlement et grants (O02) | poste : `resources/frontend/offline/enrollment/enrollment.ts` ; serveur : `app/Offline/{EnrollDevice,PrepareGrant,RevokeDevice,RevokeOfflineGrant,DeviceProof,GrantClaims,ServerSigningKey,DeviceDirectory,OfflineCommands}.php`, `DeviceController`, `DevicePresenter`, commande `eeo:offline:signing-key` |
| Façade (D26) | `resources/frontend/offline/api.ts` (seul import admis depuis `app/`, règle ESLint étendue) |
| Application | `app/services/{vault,devices}.ts`, écran `pages/settings/DevicePreparationPage.vue` (`/parametres/poste`, module `offline`, `offline.enroll`) |
| Tests écrits | `tests/frontend/offline/{crypto,signatures,vault}.test.ts` ; `tests/Unit/Offline/{JcsAndJwsTest,CompartmentsTest}.php` ; `tests/Feature/Offline/DevicesTest.php` |

### Ce qui fonctionne (codé)

- Création du coffre en deux phases avec clé de récupération ressaisie ; profils (le titulaire saisit son secret,
  la gérante ressaisit le sien) ; déverrouillage avec tentatives limitées ; verrouillage ; inactivité et recul
  d'horloge ; session persistée et canal entre onglets ; changement de secret ; récupération ; retrait refusé pour
  la dernière gérante ; entités, PDF et brouillons scellés par compartiment ; journal de sécurité local.
- Clé ES256 du poste générée dans le coffre, enveloppée par profil (jamais pour la récupération) ; preuve de
  possession à l'enrôlement ; `device_id` lié au coffre ; clés publiques du serveur épinglées.
- Grants : charge JCS signée en JWS ES256 par une clé du serveur conservée dans un fichier PEM privé
  (`EEO_OFFLINE_SIGNING_KEY_PATH`, rotation qui garde les clés publiques retirées). Le poste vérifie signature, `kid`
  épinglé, en-tête exact, charge canonique, cabinet, poste et compte AVANT d'ouvrir un compartiment : grant altéré
  = refus (`GRANT_INVALID`) ; compartiments ouverts = enveloppes ∩ grant ; grant expiré ou absent = lecture seule ;
  horloge antérieure à l'émission ou à la dernière heure du serveur = `clock-suspect`.
- Serveur : enrôlement, émission (un nouveau grant du même profil révoque les précédents), révocation d'un poste
  (REVOKED ou LOST, tous ses grants) et d'un grant, lectures ; module `offline` fermé par défaut, réauthentification.

### Écarts et décisions à confirmer

1. Les permissions et compartiments d'un profil ne sont pas scellés dans `profile_access` : l'autorité vient des
   enveloppes détenues (contrainte cryptographique) et du grant signé (autorité du serveur). Écart à D16/« Tables
   locales », plus simple et sans perte de sécurité.
2. `kid` d'un poste = empreinte RFC 7638 de sa clé publique (le contrat planifié disait un ULID).
3. Catalogue figé : l'empreinte `CatalogSnapshot` est signée dans le grant ; le snapshot lui-même sera conservé en
   fichier privé avec la préparation complète (`PrepareDevice`, O03).
4. Validité des grants : 72 h par défaut, plafond 168 h (fichier 19, à confirmer avec la politique du cabinet).
5. Bibliothèque JWS serveur ajoutée : `firebase/php-jwt` ^7 (signature JWA R||S et conversions DER par la
   bibliothèque, exigence du fichier 23).
6. Non fait dans cette passe : annuaire administratif en mémoire, preuves Playwright du coffre
   (`tests/e2e/vault.spec.ts`), rotation des clés de compartiment (R-rotation, non planifiée). L'écran de
   verrouillage qui remplace la coquille, la route publique de déverrouillage avant la connexion et l'identité
   d'action (D14, D27) sont faits le 2026-10-28 : voir « Implémentation (D14, D27) » plus bas.

### Pour O03 à O05

`Vault.signJws` (signature des commandes du journal), `assertSession` en transaction, registre des types
(`ENTITY_COMPARTMENTS`), `grants()` et `SessionInfo.authority` pour refuser une émission sans grant valide ; côté
serveur `GrantSnapshot::fromRow` lit les grants émis ici, et `DeviceProof`/`CompactJws` vérifieront les signatures
des commandes poussées.

## Implémentation (O03, O04) — codée le 2026-10-23, non exécutée

Rien n'a été exécuté (consigne du demandeur) ; les tests existent comme fichiers.

### O03 — plages, propriétaires et quotas (serveur et poste)

| Partie | Fichiers |
| --- | --- |
| Préparation (`PrepareDevice`, `POST /devices/{id}/prepare`, réauthentification) | `app/Offline/PrepareResources.php` |
| Clôture après reprise complète (`ReleaseDevice`, `POST /devices/{id}/release`) | `app/Offline/ReleaseResources.php` |
| Lecture (`GET /devices/{id}/preparation`) et format des numéros | `app/Offline/{DeviceResources,NumberFormats}.php`, `DeviceController::{prepare,preparation,release}` |
| Catalogue figé remis au poste | `CatalogSnapshot::content()` (même tableau que l'empreinte signée dans le grant ; jamais de coût d'achat) |
| Poste | `resources/frontend/offline/allocations/allocations.ts` (`storePreparation`, `nextNumber`, `localAvailableUnits`…), `app/services/{devices,vault}.ts` (`prepareThisDeviceResources`, `refreshThisDevicePreparation`) |
| Tests écrits | `tests/Feature/Offline/{PrepareResources,ReleaseResources}Test.php`, `tests/Concurrency/OfflineAllocationConcurrencyTest.php` (base `eeo_conc_offline_test`), `tests/Support/OfflineResourceFixtures.php`, `tests/frontend/offline/allocations.test.ts` |

- **Plages** prises sous le verrou de chaque séquence (rang 40) : début = plus haut numéro connu (séquence centrale,
  numéros consommés, plages déjà réservées) + 1 ; la séquence centrale monte à la fin de la plage, donc un numéro central
  est toujours hors de toute plage. Séries L0 : patient, facture, reçu, avoir, remboursement ; année du fuseau du
  cabinet, en cours ou suivante (préparation avant le franchissement), jamais passée ; taille ≤ `eeo.offline.range_max_size`.
- **Grant** : chaque ressource est rattachée au grant ACTIF d'un profil préparé qui détient la permission de la
  consommer (patient : `patient.create` ; facture : `invoice.issue` ; reçu et propriété : `payment.collect` ; avoir :
  `credit_note.issue` ; remboursement : `refund.execute` ; quota : `invoice.issue`). Un profil sans grant actif : 422.
- **Propriété** d'une facture ÉMISE : une ligne `invoice_write_owners` ACTIVE, époque supérieure aux précédentes ; tant
  qu'elle est active, la route directe refuse paiement, avoir et remboursement (`writeOwnerRequired`).
- **Quotas** : `offline_allocated` des positions et lots augmente (disponible central baisse, physique inchangé).
- **Une seule caisse hors-ligne principale** (`eeo.offline.single_financial_device`, vrai par défaut) : 409
  `FINANCIAL_DEVICE_ELSEWHERE` tant qu'un autre poste détient une ressource financière ; un second poste peut recevoir
  une plage de dossiers patients (accueil).
- **Clôture** : refus 409 `SYNC_INCOMPLETE` si la séquence et l'empreinte annoncées ne sont pas le préfixe finalisé du
  serveur (`enrolled_devices.last_accepted_*`) ou si une commande reçue n'est pas finalisée ; poste perdu ou remplacé :
  409 (procédure documentée). Sinon : numéros inutilisés inscrits `UNUSED` (jamais recyclés), reliquats de quota rendus,
  propriétés closes (`final_device_sequence`). Une expiration de grant ne libère jamais rien.
- **Poste** : la préparation est fusionnée en une transaction ; un curseur local ne recule jamais ; ce que le serveur ne
  rend plus passe CLOSED (jamais supprimé) ; les réserves et sorties locales d'un quota sont conservées.

### O04 — commit local et journal commun du poste

| Partie | Fichiers |
| --- | --- |
| Moteur local | `resources/frontend/offline/LocalCommandBus.ts` |
| Cœur, empreinte, contrat des commandes | `resources/frontend/offline/command-journal/core.ts` (lit `contracts/commands/index.json`) |
| Journal pour O05 (file, signé, ACK) | `resources/frontend/offline/command-journal/journal.ts` |
| Verrou entre onglets (accélérateur) | `resources/frontend/offline/locks/deviceLock.ts` (Web Locks, absent = sans) |
| Primitives du coffre | `Vault::{commandContext,sessionGrant,sealEntityRow,sealCommandPayload,openCommandPayload,commitLocal,localTables,writeAllocations}` ; but d'AAD `command` |
| Base locale version 3 | `allocations`, `command_journal` (index uniques `deviceSequence`, `idempotencyKey`), `command_status`, `aggregate_heads` |
| Lectures fusionnées F10 | `resources/frontend/offline/projections/localRecords.ts` (`localFacts`, `localHeads` avec l'état de leur commande) |
| Application | `app/services/localEngine.ts` (`deviceLocalEngine`, fourni sous `LOCAL_ENGINE_KEY` par `app/bootstrap.ts`) |
| Tests écrits | `tests/frontend/offline/local-command-bus.test.ts`, `tests/frontend/offline/support/preparedDevice.ts`, `tests/frontend/services/local-engine.test.ts` |

- **Trois phases** (contrat 23) : lectures (tête, ressources, projection), calcul et Web Crypto HORS transaction (numéro
  au curseur, réserves sous quota, cœur JCS, `event_hash`, JWS ES256 du poste, charge scellée, projection et fait
  scellés), puis UNE transaction qui revérifie session, idempotence, tête du journal, version de la projection, curseur
  de plage et quotas, et écrit tout ou rien. Un CAS obsolète recalcule (trois tentatives, puis `LOCAL_COMMIT_CONTENDED`).
- **Journal commun** append-only, ordonné par `deviceSequence`, chaîné par `previous_event_hash` ; métadonnées de routage
  en clair, charge scellée dans le compartiment de la commande. État `LOCAL` → `SENT` → ACK (O05) ; seul un ACK FINAL
  (ACCEPTED, REJECTED) sort une commande de la file active, sans jamais la supprimer ; un ACK final n'est jamais rétrogradé.
- **Idempotence locale** : une clé déjà committée rend la commande existante (même intention, empreinte JCS de la
  charge avant numérotation) ; une autre charge sous la même clé : `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **Propriété** : une commande financière sur une facture exige qu'elle soit créée sur ce poste ou attribuée (O03) ;
  sinon `WRITE_OWNER_REQUIRED` et le répartiteur garde la route directe. L'émission locale importe sa propriété (époque
  1) dans la même transaction et réserve sous quota les articles STOCKÉS du brouillon (catalogue figé).
- **Versions** : la projection locale garde un compteur par nature (entité, brouillon, grand livre, état) ; une facture
  créée ici : brouillon 1 puis +1, figé à l'émission ; grand livre 1 à l'émission puis +1 par fait.
- **Répartiteur** : `deviceLocalEngine.handles` est faux tant que le module `offline` est fermé, le coffre fermé ou le
  grant invalide : le comportement en ligne actuel est inchangé. « Enregistré sur ce poste » (`saved-local`) n'est rendu
  qu'après le commit réel.

### Écarts et décisions à confirmer (O03, O04)

1. **Ordre des verrous des commandes O02** : `EnrollDevice`, `IssueOfflineGrant`, `RevokeDevice`, `RevokeOfflineGrant`
   verrouillaient le compte (15) ou le poste (20) APRÈS l'idempotence (30), ce que `TransactionLocks` refuse
   (`LockOrderViolation`) : ces lignes sont désormais lues sous le verrou exclusif du cabinet, qui sérialise déjà ces
   écritures (`DeviceDirectory::underClinicLock`). Même règle pour `PrepareDevice` et `ReleaseDevice`.
2. **Ressources du poste en clair** dans `allocations` (identifiants opaques, bornes de numéros, quantités, factures) :
   le commit atomique compare et avance le curseur dans la transaction, sans Web Crypto ; aucune donnée personnelle. Le
   catalogue figé est, lui, scellé (`catalog_snapshot`, administratif). À confirmer (la fiche demandait « stockage
   chiffré »).
3. **`kid` du JWS des commandes** = empreinte RFC 7638 de la clé du poste (décision O02) ; `contracts/sync/signed-command.json`
   aligné par O05 (motif base64url de 43 caractères).
4. **Grant des préparations** : `PrepareDevice` exige des grants déjà émis (`IssueOfflineGrant`) et rend les grants
   actifs ; il n'en émet pas lui-même.
5. **Version du grand livre locale** : `ledger_version` = 1 après l'émission puis +1 par fait, déduit de
   `InvoiceLedger` ; à recouper avec la projection serveur en vérification.
6. **Module `offline` en production** : la synchronisation existe depuis O05 (codée, non exécutée) ; ne pas ouvrir le
   module en production avant la vérification de fin de lot et la preuve G1.
7. **Pas d'écran** de préparation des ressources ni de tableau du journal dans cette passe (services prêts :
   `prepareThisDeviceResources`, `refreshThisDevicePreparation`, `journal()` de la façade).

### Reste à faire

O06 (mise à jour PWA et schéma local), O07 (export et restauration du poste), G1 (preuve de la tranche urgente),
écran de verrouillage et route publique de déverrouillage (D14, D27), identité d'action unique. Voir aussi « Reste à
faire après O05 » ci-dessous.

## Implémentation (O05) — push, pull, ACK et conflits durables — codée le 2026-10-23, non exécutée

Rien n'a été exécuté (consigne du demandeur) : ni PHPUnit, ni Vitest, ni Playwright, ni vue-tsc, ni ESLint. Les
générateurs de contrats ont été lancés (`build_resources.py`, `build_openapi.py`, `contracts:types`).

| Partie | Fichiers |
| --- | --- |
| Routes (module `offline`) | `routes/api.php` : `POST /sync/push`, `GET /sync/pull?device_id&cursor`, `GET /sync/conflicts` (`approval.decide`), `POST /sync/conflicts/{id}/resolution` (`approval.decide`, réauthentification) ; `app/Http/Controllers/Api/V1/SyncController.php` |
| Vérification d'origine | `app/Offline/{SignedCommands,VerifiedCommand}.php` (JCS, ES256, kid RFC 7638) |
| Inbox et application ordonnée | `app/Offline/{PushCommands,SyncDrain,SyncDependencies,SyncPayloads,SyncAcks}.php` |
| ACK dans la transaction de l'effet | `app/Application/Effects/{SyncAcknowledgements,SyncOrderViolation}.php`, crochet dans `CommandBus::execute` |
| Références du cœur signé | `app/Domain/Shared/SyncReferences.php`, `CommandContext::sync(..., references:)`, `CommandContext::pieceInstant()` |
| Numéros pré-alloués | `app/Domain/Shared/DeviceNumbers.php` ; `NumberUsages::record(..., allocation, poste)` |
| Actions ouvertes à la source SYNC | `CreatePatient`, `CreateInvoiceDraft`, `UpdateDraft`, `IssueInvoice` (numéro du poste, propriété importée, réserves sous quota), `RegisterPayment` (reçu du poste, facture détenue par CE poste), `OpenCashSession` ; `UpdatePatient` l'était déjà |
| Pull | `app/Offline/{PullChanges,PullCursor,PullProjections}.php`, projection DANS la transaction de `ChangeFeed::page(..., $project)` |
| Conflits | `app/Offline/{ResolveConflict,ConflictDirectory}.php` (`ResolveSyncConflict`, en ligne, gérante) |
| Contrats | `contracts/sync/signed-command.json` (kid = empreinte), `push-response.json`, `schemas/error.json` (codes), `ConflictResolutionRequest` (+ `expected_version`), `Conflict` enrichi, opérations `implemented` |
| Poste | `resources/frontend/offline/sync/{transport,push,pull,engine,applicable}.ts`, `CommandJournal::{fromSequence,statuses}`, base locale v4 (`pull_cursors`), `Vault::{syncStatus,noteSyncStatus}`, façade `sync()` |
| Application | `app/services/{syncTransport,deviceSync,syncConflicts}.ts`, `SYNC_STATE_KEY` fourni (`bootstrap.ts`), échanges automatiques (`main.ts`), échange après chaque commit local (`localEngine.ts`) |
| Écrans | `pages/settings/DevicePreparationPage.vue` (4. numéros réservés, relire les ressources ; 5. synchronisation, pièces à revoir), `pages/manager/SyncConflicts.vue` (`/parametres/conflits-synchronisation`), carte des Paramètres ; `PaymentForm.vue` (« Encaissement enregistré sur ce poste »), `InvoiceDetails.vue` (encaissement possible sur le poste propriétaire) |
| Tests écrits | `tests/Feature/Offline/{SyncPushTest,SyncPullTest}.php`, `tests/Unit/Offline/SignedCommandsTest.php`, `tests/Concurrency/SyncConcurrencyTest.php` (+ scénario `sync-push`), `tests/Support/SyncFixtures.php`, `tests/frontend/offline/sync.test.ts`, `tests/e2e/offline-sync.spec.ts` (module `offline` et clé de test ajoutés à `prepare-env.mjs`) |

- **Vérification avant tout stockage** : `event_hash` recalculé sur le JCS du cœur REÇU (objets JSON conservés, un
  objet vide reste `{}`), JWS ES256 de la clé enrôlée (`alg` imposé, `none` refusé, `kid` = empreinte RFC 7638),
  charge signée exacte, cabinet et poste du lot, commande du journal ; lot contigu et chaîné, ancré sur le rang
  précédent déjà reçu. Sinon 422 `SYNC_INTEGRITY_FAILED` (rang absent : 409 `SYNC_SEQUENCE_GAP`, même `command_id`
  autre empreinte : 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`) et RIEN n'est stocké.
- **Inbox immuable** : `sync_commands` (charge et quotas rechiffrés par le serveur, `Crypt`/`APP_KEY`, clé
  `eeo.offline.sync_key_id`), résultat `RECEIVED`, heure de PREMIÈRE réception conservée.
- **Application** : rang par rang à partir du préfixe finalisé, chacun dans SA transaction, par le chemin central
  (source SYNC, clé d'idempotence = `command_id`, autorisation historique du grant). L'ACK `ACCEPTED` et le préfixe
  `last_accepted_*` sont écrits DANS la transaction de l'effet : un crash après commit et avant la réponse rend
  `ALREADY_ACCEPTED` au renvoi, jamais un second fait. Arrêt au premier non finalisé (les suivants restent `RECEIVED`,
  sans ACK dans la réponse).
- **Pièce liée absente** : `WAITING_DEPENDENCY` avec les dépendances (dossier, visite, consultation, facture,
  rendez-vous, session de caisse) ; dépendance qu'une commande REJETÉE devait créer : conflit `DEPENDENCY_REJECTED`.
- **Conflit durable** : `sync_conflicts` OPEN, instantanés chiffrés (commande d'origine ; refus et état central),
  `CONFLICT_REQUIRES_REVIEW`, audit `sync.conflict_opened`. Décision de la gérante : ACCEPT_LOCAL (rejouée, seul un
  verdict « en revue » de l'autorisation historique est levé), KEEP_CENTRAL / REJECT / CORRECT (REJECTED, le préfixe
  avance, N+1 reprend aussitôt) ; audit `sync.conflict_resolved` ; jamais de réécriture du cœur, de l'empreinte ni de
  la signature.
- **Pull** : grant ACTIF du compte sur ce poste ; compartiments = grant ∩ droits actuels (jamais CLINICAL sans droit
  clinique), PUBLIC pour tous ; curseur signé (HMAC dérivé d'`APP_KEY`) lié au poste, au compte et aux compartiments,
  qui avance sur les entrées filtrées ; un compartiment ouvert depuis relance la lecture depuis le début.
- **Poste** : push depuis la plus ancienne non finalisée, arrêt à la première commande d'un autre profil, « envoyée »
  AVANT l'envoi, ACK enregistrés sans jamais rétrograder un final ni rien supprimer ; renvoi depuis le rang demandé
  après `SYNC_SEQUENCE_GAP` ; pull page par page, page et curseur dans UNE transaction ; tête locale recalée sur le
  serveur seulement si toutes ses commandes sont finalisées. États : « Enregistré sur ce poste » ≠ « Consolidé sur le
  serveur » (ACK final seulement).

### Décisions à confirmer (O05)

1. **`kid` des commandes** aligné sur l'empreinte RFC 7638 de la clé du poste (décision O02) : le contrat
   `signed-command.json` déclarait un ULID.
2. **Commandes enregistrables sur le poste** limitées à celles que le serveur sait appliquer depuis un poste
   (`offline/sync/applicable.ts`) : patient (création, modification), brouillon, émission, encaissement, ouverture de
   caisse. Visite (domaine de l'agenda), consultation, prescriptions, clôture de caisse, avoir, remboursement,
   contre-écriture, remise, retour, stock, rendez-vous et approbations restent EN LIGNE (refus `ACTION_FORBIDDEN`
   inchangé côté serveur pour un poste).
3. **Date des pièces de poste** : facture, reçu et ouverture de caisse sont datés de l'instant où le poste a agi
   (`occurred_at_local`, jugé plausible par l'autorisation historique) ; le contrôle de rétroactivité d'un
   encaissement se réfère à cet instant.
4. **Quotas déclarés hors colonnes** : `stock_allocation_ids` (absent de `sync_commands`) est conservé dans
   l'enveloppe chiffrée de la charge pour reconstituer le cœur.
5. **Compte qui pousse** : préparé sur ce poste (un grant de ce poste lui a été émis) ou gérante (`offline.enroll`) ;
   chaque commande reste jugée par SON grant. Poste perdu ou remplacé : 403.
6. **Commandes en attente derrière un non finalisé** : sans ACK dans la réponse (le contrat d'ACK n'a pas
   `RECEIVED`) ; le poste les garde « envoyées » et les renvoie.
7. **Projections du pull** : patient, visite, facture et solde, paiement, reçu, avoir, remboursement, session de caisse,
   catalogue (sans coût d'achat) et taxes ; les entités CLINIQUES et les autres agrégats sont publiés sans contenu
   (identifiant et version) : le poste relit leur contenu en ligne.
8. **Reçu imprimé dont l'encaissement est rejeté** : son numéro de plage n'est pas inscrit comme consommé ; il le
   sera `UNUSED` à la clôture de la plage. À trancher avec le cabinet (inscription « annulé » plutôt).
9. **Codes d'erreur ajoutés** au contrat : `SYNC_INTEGRITY_FAILED`, `SYNC_SEQUENCE_GAP`, `NUMBER_RANGE_INVALID`,
   `DEPENDENCY_REJECTED`, `PAYLOAD_TOO_LARGE`, et `SYNC_INCOMPLETE`, `FINANCIAL_DEVICE_ELSEWHERE` (émis par O03 mais
   absents du catalogue).

### Reste à faire après O05

O06 (mise à jour PWA et schéma local), G2 (risques financiers, concurrence, reprise complète). O07 et G1 (tranche
de base) sont prouvés en local ; le numéro de reçu hors ligne (G1) et l'écran public de déverrouillage (D14, D27) sont
faits. Plus : dépôt des PDF locaux après l'ACK de leur pièce (D01, compteurs `documentsToUpload` à zéro tant qu'il
n'est pas branché), lecture des projections du pull par les écrans hors ligne (fiche patient, liste, recherche,
catalogue, création et lecture d'une facture : `offlineCapable` n'est posé que sur les écrans qui savent travailler
sur le poste), `GET /devices/{id}/health`, réserves sous quota testées de bout en bout, ouverture du module `offline`
en production seulement après G2.

## Implémentation (D14, D27) — déverrouillage public et session locale — 2026-10-28

Lève l'écart 2 de G1 (démarrage SANS réseau, AT36 à la lettre). Preuve en navigateur réel : `tests/e2e/offline-start.spec.ts`
(profil persistant, serveur RÉELLEMENT arrêté puisque Playwright n'applique pas « hors ligne » aux requêtes du service
worker). Règles : `tests/frontend/shell/local-identity.test.ts`, `tests/frontend/offline/clinic-summary.test.ts`.

### Comportement

| Coffre de ce navigateur | Session du serveur | Ce que fait l'application |
| --- | --- | --- |
| absent (aucune base `eeo-device`) | quelconque | Flux d'avant (connexion au serveur) ; IndexedDB n'est même pas ouverte |
| verrouillé, endommagé ou trop récent | aucune identité (inconnue, anonyme, non vérifiée) | Route publique `/deverrouiller` AVANT `/connexion` : profils listés (identifiant et nom), secret local ; coffre illisible : écran d'état explicite, aucune écriture |
| verrouillé | ouverte ou expirée | Rien n'est imposé : le serveur est l'identité ; le coffre se déverrouille depuis « Poste » ou `/deverrouiller` |
| déverrouillé par la personne | aucune ou injoignable | Session **locale** (`session.status === 'local'`) : profil du coffre, droits SIGNÉS de son grant, seuls les écrans `offlineCapable` s'ouvrent |
| déverrouillé | ouverte, même compte | Droits du serveur ; le coffre reste ouvert à côté |
| déverrouillé | ouverte, AUTRE compte | Droits du serveur ; divergence signalée dans l'en-tête ; aucune commande n'est écrite sur le poste (`localCommandsOrNull()` rend null) |

### Décisions d'application

- **Détection sans création** : `vaultDatabaseExists()` (façade) interroge `indexedDB.databases()` au démarrage, avant la garde
  du routeur. Un navigateur qui ne sait pas lister ses bases suit le flux d'avant (module ouvert par le serveur). Sans
  coffre, rien ne change : aucune ouverture d'IndexedDB, le module `offline` fermé en production reste sans effet.
- **Identité d'action unique (D27)** : réalisée dans `session.ts` (statut `local`) et `app/services/localIdentity.ts`, sans
  module `actor.ts` séparé : `can()`, `useMutation`, `ReauthDialog` et la garde lisent déjà `session.account`, qui porte
  le compte du serveur OU, faute de serveur, celui du coffre. Le serveur reprend la main dès qu'il répond avec une session ;
  son silence ou l'absence de session chez lui ne retire jamais le profil local (`readSession`).
- **Compte local** (`localAccountOfSession`) : identité et permissions viennent du grant signé de la session du coffre
  (`GrantSummary.permissions`, jamais d'une saisie) ; sans grant valide, aucun droit (le profil s'ouvre mais ne peut rien
  faire, l'accueil l'explique). Le résumé du cabinet (nom, fuseau, monnaie, modules) est celui de la dernière session
  du serveur, retenu dans `vault_meta.clinic_summary` (non secret, écrit même coffre verrouillé, forme contrôlée à la
  lecture : une valeur altérée est ignorée). `offline` figure toujours dans les modules d'une session locale.
- **Écrans** : la méta `offlineCapable` marque les écrans qui savent travailler sur le poste (accueil, aide, accès refusé,
  introuvable, « Poste », et les écrans patient de la section « Implémentation (A1) »). Les autres restent fermés en session locale : l'accueil dit « « X » demande le
  serveur ». Les droits du grant s'appliquent comme en ligne (`acces-refuse`).
- **Coquille démontée (D14)** : sans identité et avec un coffre à ouvrir, `RouterView` n'est plus rendu (menu, compte,
  déconnexion et contenu disparaissent), seul l'écran de déverrouillage subsiste ; les erreurs du coffre sont traduites
  (secret vidé après chaque essai, message uniforme, heure de la prochaine tentative après des échecs répétés).
- **Verrouillage (D12, D15)** : « Verrouiller le poste » (en-tête) ferme le coffre sans quitter le serveur ; « Se
  déconnecter » verrouille d'abord, sans réseau, puis ferme la session du serveur s'il y en a une (en session locale, il
  n'y en a pas : le poste se verrouille et s'arrête là).
- **Inactivité (D13)** : `installVaultWatch()` prolonge la session du coffre à chaque activité (écriture limitée à 15 s par le
  coffre) et contrôle toutes les 15 s, au retour du focus et de l'onglet : 30 minutes sans activité, horloge reculée ou
  session terminée par un autre onglet verrouillent ici aussi.
- **Envoi des pièces** : la synchronisation passe par la session du serveur (Sanctum). En session locale, l'en-tête offre
  « Se connecter au serveur » dès que le réseau est là ; le poste envoie ensuite (« Synchroniser » ou échange
  automatique). Un échec d'envoi sans session ne retire rien du journal.

### Limites déclarées

1. **Lecture locale des écrans** : seuls les écrans listés ci-dessus s'ouvrent hors serveur. La fiche patient, la recherche et
   la modification d'une fiche du poste, le choix d'un article du catalogue figé, la création, l'émission et la lecture d'une
   facture du poste sont faits (A1, plus bas) ; la liste des factures et les autres écrans de vente relisent encore le serveur.
2. **Identité du cabinet des PDF** : après un redémarrage sans serveur, `currentDocumentClinic` retombe sur le nom du cabinet
   retenu (les autres mentions restent « à renseigner » sur un document de test). Les pièces financières émises gardent leur
   identité figée. Les mentions complètes hors ligne se retiennent avec les écrans locaux.
3. **Inactivité** : la logique (30 minutes, horloge reculée) est celle du coffre, éprouvée par `vault.test.ts` ; le parcours
   en navigateur n'attend pas 30 minutes (aucune horloge truquée), à rejouer en G2.
4. **Plusieurs profils sur un même poste** : l'écran liste tous les profils actifs ; la bascule d'un profil à l'autre
   (verrouiller puis déverrouiller) est couverte par le coffre, pas par un parcours dédié (G2, P04).
5. **Aide intégrée** : les sections « À savoir » et « Pas encore disponible » disent encore que le travail sans Internet
   n'est pas livré (module `offline` fermé) ; une section dédiée s'ajoutera à l'ouverture du module, après G2.
6. **Issue `vault-locked` du répartiteur** (D27) : non ajoutée. Coffre verrouillé, la propriété des factures du poste n'est
   pas lisible, donc une commande qui retomberait sur la route directe n'est pas distinguée d'une autre ; le serveur,
   lui, refuse tout encaissement direct d'une facture détenue par un poste (`WRITE_OWNER_REQUIRED`) : aucune double
   écriture. Un message plus précis (« déverrouillez le poste ») est à ajouter avec G2.
7. **Pièce enregistrée pendant un échange** (observé, pas introduit ici) : un seul échange à la fois (`SyncEngine.syncNow`
   rejoint l'échange en cours). Une pièce créée pendant un échange lent n'en fait pas partie et ne part qu'à l'échange
   suivant (au plus 60 s, ou un nouveau clic) : le clic « Synchroniser » ne relance pas un second échange. C'est la cause de
   l'intermittence de `device-recovery.spec.ts` (« Conflits à revoir : 1 ») sur un serveur de test lent, confirmée par la
   trace (envoi de 4 s) et par le même échec sur le code d'avant ce chantier ; le test attend désormais la fin de
   l'échange d'ouverture avant de couper le réseau. À traiter avec G2 (concurrence).

## Implémentation (A1) — lecture locale des fiches patient — 2026-10-28

Première tranche de l'écart 1 de G1 (lecture locale des écrans patient et facture) : la fiche d'un patient, la recherche et la
modification d'une fiche répondent depuis le coffre quand le serveur ne répond pas. Preuve en navigateur réel :
`tests/e2e/offline-start.spec.ts` (serveur RÉELLEMENT arrêté, deux fermetures complètes). Règles pures :
`tests/frontend/patients/local-patients.test.ts` ; lectures : `tests/frontend/services/patients-local.test.ts` ; écran de
création : `tests/frontend/patients/create-page.test.ts`.

### Comportement

- **Source** : les fiches de CE poste sont reconstruites par REJEU des faits ADMINISTRATIFS du journal local
  (`domain/patients/local.ts`, `app/services/localPatients.ts`, `localAdministrativeFacts`) : `CreatePatient` pose la fiche
  (numéro de dossier de la plage du poste), chaque `UpdatePatient` y applique ses champs (champ vidé : null ; le nom ne devient
  jamais vide). Un fait ne change jamais : rejouer tous les faits donne la même fiche à chaque lecture, alors que la projection
  de tête du journal ne garde que la dernière charge d'une modification. La version affichée vaut « 1 + nombre de
  modifications », comme le compteur d'entité du journal (la modification suivante attend donc la bonne version).
- **Priorité** (F10, AT42) : une proposition du poste ni consolidée ni rejetée (`local`, `pending`, `waiting_dependency`,
  `conflict`) PRIME sur le serveur, qui ne la connaît pas encore. Consolidée (`acknowledged`), le serveur fait foi quand il
  répond, et la copie du poste répond quand il ne répond pas. Une erreur du serveur (404, 403…) n'est jamais remplacée par la
  copie du poste.
- **Fraîcheur** : une lecture du poste porte `serverAsOf` null et `live` faux. La fiche et la liste disent « Données de ce poste
  seulement : le serveur n'a pas été consulté » ; un résultat vide n'est jamais « Aucun résultat » (« Recherche serveur
  indisponible »), car il ne dit rien de la clinique entière.
- **Recherche** : `searchPatients(query, page, { includeLocal: true })`, demandé par l'écran « Patients » seulement. Serveur
  injoignable : les fiches du poste qui correspondent (nom et prénoms sans casse, accents ni ordre des mots ; téléphone par ses
  chiffres ; numéro de dossier ; 25 par page, triées par nom). Serveur joint : les fiches du poste pas encore consolidées
  s'ajoutent en tête de la première page. La détection des doublons à la création n'utilise jamais le poste : sans le serveur,
  elle dit « Vérification des doublons impossible » et demande une confirmation.
- **Écrans** (`offlineCapable`) : liste et recherche, fiche, modification. En session locale, la fiche ne montre que l'onglet
  « Identité » et l'action « Modifier » ; arrivée, facture, fusion, export, activité et prescriptions (serveur) ne sont pas
  offerts (aucun lien vers un écran fermé). Après un enregistrement sur le poste, « Ouvrir la fiche » remplace « Annuler » à
  côté du statut « Enregistré sur ce poste ».

### Limites déclarées

1. **Fiches du poste seulement** : levé par A2 (section « Implémentation (A2) » plus bas) : les fiches du SERVEUR reçues par le
   pull se lisent aussi et servent de base aux modifications faites sur le poste. Une fiche du serveur que ce poste n'a jamais
   reçue reste introuvable sans le serveur.
2. **Pas de doublons hors ligne** : la ressemblance se cherche sur le serveur seulement (voulu : « aucune fiche proche » sans le
   serveur serait une absence affirmée à tort).
3. **Recherche approchée** : jumelle simplifiée de celle du serveur (mêmes règles de casse, d'accents et de chiffres), sans
   classement de pertinence ; l'ordre est alphabétique.
4. **Facture** : levé par les tranches 2 et 3 (section suivante).

## Implémentation (A1, tranches 2 et 3) — facture créée, émise et lue sur le poste — 2026-10-29

Lève l'écart 1 de G1 : AT37 à la lettre (« Sans réseau : facture 80 000, acompte 30 000/reçu, solde 50 000/reçu, PDF/impression »).
Preuve en navigateur réel : `tests/e2e/offline-invoice.spec.ts` (profil persistant, serveur RÉELLEMENT arrêté, deux fermetures
complètes, synchronisation à la fin). Règles pures : `tests/frontend/billing/local-invoices.test.ts` et `local-catalog.test.ts` ;
lectures : `tests/frontend/services/billing-local.test.ts` ; éditeur : `tests/frontend/billing/invoice-draft.test.ts`.

### Comportement

- **Catalogue figé** (`domain/billing/localCatalog.ts`, `app/services/localCatalog.ts`, `catalogSnapshot()` de la façade du coffre) :
  le contenu remis à la préparation du poste (articles, règles fiscales, jamais de coût d'achat) est lu dans l'entité scellée
  `catalog_snapshot`. `searchCatalog(query, page, { includeLocal: true })` (choix d'un article de facture seulement) répond avec lui quand
  le serveur ne répond pas : articles ACTIFS, mots cherchés dans la référence et le nom (casse, accents, ponctuation et ordre
  ignorés), 25 par page ; la liste dit « Catalogue de ce poste (serveur non consulté) ». Une règle fiscale n'est appliquée que si
  elle est active, avec un taux ET validée par la gérante (comme `TaxRegime::applicable`) : sinon `NO_TAX_CONFIGURED` et aucune taxe
  ventilée, jamais zéro.
- **Factures du poste** (`domain/billing/localInvoices.ts`, `app/services/localInvoices.ts`) : rejeu des faits FINANCIERS du journal
  local. `CreateInvoiceDraft` pose le brouillon, chaque `UpdateDraft` remplace ses lignes (version du brouillon +1), `IssueInvoice`
  l'émet avec le numéro de la plage du poste (jamais renuméroté). La facture rendue a la forme de celle du serveur (`Invoice`) :
  lignes figées d'après le catalogue figé (référence, catégorie, unité ; ligne libre : `OTHER` et `UNIT`), montants des MÊMES règles
  pures que le serveur (`computeLineAmounts`), identité du patient, en-tête du cabinet et règles fiscales relus à chaque affichage d'après l'état COURANT du poste (le serveur
  fige les siens à la synchronisation : avant, rien n'est figé côté poste),
  version du grand livre 1 à l'émission (comme le compteur du journal). Les encaissements s'y ajoutent comme pour une facture du
  serveur (`localPayments`).
- **Priorité** (F10, AT42) : `getInvoice` rend la copie du poste tant que sa dernière commande de brouillon ou d'émission n'est ni
  consolidée ni rejetée ; consolidée, le serveur fait foi quand il répond et la copie répond quand il ne répond pas. Une erreur du
  serveur n'est jamais remplacée. La fraîcheur dit « Données de ce poste seulement ».
- **Éditeur** : `saved-local` (poste préparé, coffre ouvert, serveur ou non) est géré pour `CreateInvoiceDraft`, `UpdateDraft` et
  `IssueInvoice` : « Brouillon de facture enregistré sur ce poste, en attente de synchronisation », « Facture émise sur ce poste :
  numéro … » (jamais « sur le serveur »), la facture est relue dans le coffre. Si elle ne peut pas y être reconstruite, la pièce reste au
  journal et le message dit de ne pas la refaire. L'abandon d'un brouillon (serveur seulement) n'est pas offert pour une facture
  du poste ; la fiche d'une facture du poste remplace les panneaux « remises, avoirs, corrections » (serveur) par une note.
- **Écrans** (`offlineCapable`) : nouvelle facture et facture ; la fiche du patient propose « Créer une facture » en session locale ;
  la recherche du patient de la nouvelle facture répond avec les fiches du poste. En session locale, « Retour aux factures » n'est
  pas offert (la liste des factures demande le serveur).

### Limites déclarées

1. **Patients du serveur** : levé par A2 (section « Implémentation (A2) » plus bas) quand la fiche a été reçue par le pull. Pour un
   patient du serveur que ce poste n'a jamais reçu, une facture émise sur le poste n'est pas relisible hors ligne : la pièce reste au
   journal et part à la synchronisation.
2. **Articles stockés** : leur émission sur le poste exige un quota de stock du poste (AT40, G2) ; sans quota, la commande n'est pas
   prise sur le poste. Le parcours e2e emploie des articles non stockés (examen, verres sur mesure).
3. **En-tête du cabinet** : nom, fuseau, monnaie et « document de test » seulement (limite 2 du déverrouillage public) ; le libellé d'une
   règle fiscale est son code (le libellé n'est pas dans le catalogue figé).
4. **Règles de vente du compte** (plafond de remise, modes de règlement) : lues sur le serveur ; sans lui, l'écran garde ses textes
   génériques et le serveur tranche à la synchronisation (prix ou remise au-delà des droits).
5. **Serveur seulement** : liste des factures, abandon d'un brouillon, avoirs, remboursements, contre-écritures, remise au patient.
6. **Catalogue figé, serveur vivant** : le serveur revalide les brouillons contre son catalogue ACTUEL (prix, taxes, article actif), pas
   contre celui du poste ; un prix, une taxe ou un article modifié depuis la préparation peut faire refuser la pièce à la
   synchronisation (elle passe alors en revue). Aucun plafond de remise ni autorité de prix n'est contrôlé sur le poste.
7. **Espèces hors ligne** : la session de caisse se lit sur le serveur seulement ; sans lui, seuls les modes qui n'en demandent pas
   (mobile money, virement…) s'encaissent.
8. **Pas de liste des factures du poste** : une facture se rouvre depuis son adresse ou l'historique du navigateur ; une liste « Factures
   de ce poste » sur la fiche du patient est à faire.
9. **État de synchronisation** : seul celui des encaissements s'affiche ; une facture rejetée ou en conflit n'a pas encore d'écran dédié
   (elle redevient « introuvable » sur le serveur).
10. **Facture déjà consolidée lue en repli** (serveur injoignable après l'ACK) : ses encaissements acquittés sont repris du journal ; la
    mention « en attente de synchronisation » peut rester affichée à tort.
11. **Patient du serveur, émission** : si la fiche n'a pas été reçue par le pull (A2), la facture émise sur le poste n'est pas
    relisible ici ; l'éditeur le dit, se verrouille (aucune seconde émission) et la pièce part à la synchronisation.

## Implémentation (A2) — annuaire du poste : fiches du serveur lues, modifiées et facturées sur le poste — 2026-10-30

Lève la limite « les patients du serveur ne se lisent pas hors ligne » d'A1. Preuve en navigateur réel :
`tests/e2e/offline-directory.spec.ts` (fiche créée en ligne, reçue par le pull, serveur RÉELLEMENT arrêté, deux fermetures complètes, synchronisation à la fin ; vert en local le 2026-10-30 sur Edge). Règles pures : `tests/frontend/patients/local-patients.test.ts` ; lectures :
`tests/frontend/services/local-patients-directory.test.ts` et `patients-local.test.ts` ; coffre : `tests/frontend/offline/sync.test.ts`.

### Comportement

- **Source** : les projections que le pull a scellées dans `pulled_administrative` (`patient_records/<id>`, même représentation que l'API
  en ligne). La façade du coffre les liste par type sans déchiffrer le reste (`pulledRecords`, avec ou sans identifiants) et dit jusqu'où
  l'annuaire est à jour (`lastPullAt`) ; un compartiment fermé pour la session rend une liste vide. Une projection vide (entité disparue),
  d'une autre forme ou dont l'identité ne correspond pas à sa clé est écartée (`patientOfPulled`), jamais corrigée.
- **Rejeu** (`foldLocalPatients(faits, annuaire)`) : une fiche du serveur que le poste n'a pas touchée est lue telle que reçue, état
  `acknowledged` ; une modification faite ici s'applique par-dessus (version = version attendue + 1, comme le compteur d'entité du
  journal), sauf si le serveur l'a refusée (elle ne change rien) ou si le pull l'a déjà REPRISE (acquittée, et fiche du serveur à la
  version qu'elle a produite : la rejouer défairait un changement plus récent du serveur sur les mêmes champs).
  `LocalFact.expectedVersion` (nouveau, absent des faits d'avant A2 : ils comptent alors +1 et ne sont jamais tenus pour repris) porte la
  version attendue. Une fiche créée ici puis reçue du serveur : non consolidée, la proposition du poste prime (AT42) ; consolidée, la
  plus récente des deux fait foi.
- **Portée de la lecture** (`localPatients(portée)`) : sans portée, les seuls faits du journal (serveur joint : les fiches non
  consolidées s'ajoutent en tête de la première page) ; `ids` : ces fiches du serveur seulement (fiche lue, identité des factures du
  poste : une lecture chacune) ; `directory` : l'annuaire entier, demandé seulement serveur injoignable (recherche). L'annuaire entier
  est gardé en mémoire le temps de la session et du dernier pull (repère « session + dernier pull »), relu dès que le repère change et
  oublié à chaque verrouillage du coffre (D12 ; la mémoire physique n'est pas effacée, comme pour les clés).
- **Recherche** : serveur injoignable, elle porte sur les fiches du poste ET celles de l'annuaire, avec les règles du serveur (nom et
  prénoms sans casse, accents ni ordre ; chiffres du téléphone ; numéro de dossier) ; une fiche fusionnée dans une autre n'est jamais
  proposée, une fiche archivée l'est. Serveur joint : l'annuaire n'est jamais ouvert (aucun coût en ligne).
- **Facture** : l'identité du patient d'une facture du poste est lue par les identifiants de ses brouillons (annuaire et fiches créées
  ici) : une facture émise sur le poste pour un patient du serveur se relit avec son identité, sans écran verrouillé.

### Limites déclarées

1. **Couverture** : l'annuaire est ce que les échanges de synchronisation ont déjà reçu (un échange : 20 pages de 100 changements). Un
   poste neuf sur un cabinet au journal long peut demander plusieurs échanges ; l'écran ne dit pas encore si l'annuaire est complet :
   un résultat vide n'affirme jamais l'absence.
2. **Fraîcheur** : l'annuaire date du dernier pull (`lastPullAt`, non affiché). Une fiche modifiée depuis sur un autre poste n'y est pas.
3. **Compartiment** : le compartiment administratif doit être ouvert pour la session ; sinon la lecture est vide.
4. **Factures du serveur** : le pull ne publie qu'un RÉSUMÉ de chaque facture (numéro, statut, total, reste dû ; ni lignes ni
   encaissements). Une facture du serveur ne se relit donc pas hors ligne ; une liste « Factures du patient » faite de ces résumés est
   possible, non faite.
5. **Pas de worker** (E6) : l'annuaire est déchiffré sur le fil principal, une fois par pull et par session ; non mesuré jusqu'à la borne
   visée de 20 000 fiches.
6. **Doublons** : la détection de ressemblance à la création exige toujours le serveur.
7. **Intégrité** : une ligne altérée de l'annuaire fait échouer toute la lecture (la recherche hors ligne est alors vide) : rien n'est
   montré à moitié.

# Consultation clinique (C01 à C04)

Fonctions cliniques **en ligne**, **sans contrôle du paiement de l'examen** (B04 et B06 ne sont pas branchés
sur la consultation) : démarrer l'examen d'une visite, enregistrer les **sept rubriques** du dossier par étape
(motif et lunettes, antécédents, acuités, réfraction, centrage, médicaments, conclusion et orientation),
**terminer** l'examen (révision 1 figée), le **corriger** par une révision motivée, relire et comparer les
révisions, rédiger puis **valider** une prescription optique (brouillon, versions, ordonnance externe).

Rien ici n'est utilisable sans Internet : toute commande d'un poste hors-ligne (source `SYNC` ou tâche) est
refusée explicitement (`403 ACTION_FORBIDDEN`) tant que la synchronisation clinique (coffre, compartiments,
O01 à O05) n'existe pas. L'écran ne dit jamais « enregistré sur ce poste » : une étape est dite enregistrée
après la réponse du serveur seulement.

> **État : codé, non exécuté.** Les tests PHPUnit, Vitest et Playwright de C01 à C04 sont écrits mais n'ont pas
> été lancés dans cette passe (vérification transversale à la fin de la phase).

## Routes (module `consultations`, ouvert par l'exploitant)

| Méthode et route | Permissions (toutes exigées) | Réponse |
| --- | --- | --- |
| `GET /api/v1/visual-acuity-scales` | `clinical.read` | 200 `VisualAcuityScaleList` (échelles du cabinet, actives d'abord) |
| `POST /api/v1/visits/{id}/consultations` | `clinical.write`, `clinical.read` | 201 `ConsultationResponse` (`StartConsultation`) |
| `GET /api/v1/consultations/{id}` | `clinical.read` · débit limité | 200 `ConsultationResponse` |
| `PATCH /api/v1/consultations/{id}/steps/{step}` | `clinical.write`, `clinical.read` | 200 `ConsultationResponse` (`SaveClinicalStep`) |
| `POST /api/v1/consultations/{id}/complete` | `clinical.complete`, `clinical.read` | 200 `ConsultationResponse` (`CompleteConsultation`) |
| `POST /api/v1/consultations/{id}/amendments` | `clinical.amend`, `clinical.read` | 201 `ConsultationResponse` (`AmendConsultation`) |
| `POST /api/v1/consultations/{id}/delete` | `clinical.write`, `clinical.read` (+ auteur ou `approval.decide`) | 200 `DeleteConsultationDraftResponse` (`DeleteConsultationDraft`, brouillon seulement, en ligne seulement) |
| `GET /api/v1/consultations/{id}/revisions/{revision_no}` | `clinical.read` · débit limité | 200 `ClinicalRevisionResponse` (snapshot figé) |
| `GET /api/v1/consultations/{id}/prescriptions` | `clinical.read` · débit limité | 200 `PrescriptionList` (plus récente d'abord) |
| `POST /api/v1/consultations/{id}/prescriptions` | `clinical.write`, `clinical.read` | 201 `PrescriptionResponse` (`CreatePrescription`, origine interne) |
| `POST /api/v1/prescriptions/external` | `clinical.write`, `clinical.read` | 201 `PrescriptionResponse` (`CreatePrescription`, ordonnance externe) |
| `GET /api/v1/prescriptions/{id}` | `clinical.read` · débit limité | 200 `PrescriptionResponse` |
| `PATCH /api/v1/prescriptions/{id}` | `clinical.write`, `clinical.read` | 200 `PrescriptionResponse` (`UpdatePrescriptionDraft`, en ligne seulement) |
| `POST /api/v1/prescriptions/{id}/delete` | `clinical.write`, `clinical.read` | 200 `DeletePrescriptionDraftResponse` (`DeletePrescriptionDraft`, brouillon jamais utilisé seulement, en ligne seulement) |
| `POST /api/v1/prescriptions/{id}/revisions` | `clinical.amend`, `clinical.read` | 201 `PrescriptionResponse` (`CreatePrescription`, nouvelle version) |
| `POST /api/v1/prescriptions/{id}/validate` | `clinical.complete`, `clinical.read` | 200 `PrescriptionResponse` (`ValidatePrescription`) |

Toutes les écritures passent par le chemin central (`Idempotency-Key` obligatoire, idempotence, verrous,
audit, journal des changements) ; route directe, synchronisation future et tâche appellent la même action.

- **Module fermé** : 404 avant toute vérification de droit (même pour la gérante).
- **Droits** : gérante et professionnel seulement. Accueil et caisse n'ont aucune permission `clinical.*` :
  403 sur toutes ces routes, **y compris pour une ressource existante** (le refus ne dit pas si elle existe). Un
  identifiant d'un autre cabinet répond 404.
- **Chaque écriture exige aussi `clinical.read`** : sa réponse rend le dossier (ou la prescription) courant ; une
  dérogation qui retire la lecture ne se contourne pas par l'écriture.
- **Identifiants du chemin et du corps** : ils doivent coïncider (422), jamais l'un pour l'autre :
  `visit_id`, `consultation_id`, `step.step`, `supersedes_id` (nouvelle version), `prescription_id` (validation).
- **Limite de débit des lectures** : limiteur `eeo-consultation-read`, **par compte**, 60 lectures par minute par
  défaut (`EEO_RATE_CONSULTATION_READ`, `config('eeo.rate_limits.consultation_read')`), commun aux lectures d'une
  consultation, d'une révision et des prescriptions ; au-delà : 429 `RATE_LIMITED`.

## Corrections de C01 (revue)

| Constat | Correction |
| --- | --- |
| Une écriture sans effet (ou le rejeu d'une clé) rendait tout le dossier sans trace de lecture | Toute réponse qui rend le dossier est une **lecture tracée** (`ClinicalReadAudit`), démarrage, enregistrement, finalisation et correction compris ; même règle d'intervalle (au plus un événement par compte et par cible toutes les 10 minutes). |
| Lecture en plusieurs requêtes autocommit : état mélangé possible pendant une écriture | `ConsultationReader::view` relit l'ensemble tant que la version relue en fin de lecture diffère de celle du début (3 tentatives), puis 503 `SERVER_BUSY` (à renvoyer à l'identique) plutôt qu'un état qui n'a jamais existé. Aucune transaction hors du chemin central. |
| Aucune limite de débit sur la lecture d'un dossier | Limiteur par compte (ci-dessus). |
| L'audit `consultation.step_saved` portait un nombre de lignes (`rows`) | Il ne porte plus que `{step, version}`. |
| Un code de référentiel désactivé bloquait toute sauvegarde de la rubrique qui le contenait | Une ligne **déjà enregistrée** (même identifiant, même code) reste ré-enregistrable ; une ligne nouvelle ou dont le code change porte un code actif (`TermList`, paramètre `$existing`). |
| « Précisez le texte de « Autre » » s'ajoutait au message d'un texte invalide | Le message de consigne n'est donné que si le texte manque vraiment. |
| Message « Type de valeur invalide » en double d'un message de longueur | Le validateur de contrat ne garde que le message de limite. |
| Un identifiant de consultation déjà pris dans un autre cabinet donnait une erreur SQL | 422 `consultation_id` (contrôle global). |
| L'en-tête patient dépendait du module Patients et de `patient.read` | `Consultation.patient` : identité administrative de base (dossier, nom, prénoms, sexe, naissance) rendue avec `clinical.read`. |
| Textes de la visite (consultation masquée) | Docblock et message corrigés ; le statut administratif `IN_CONSULTATION` reste visible de tous. |

Points relevés **documentés, non corrigés** (décision à prendre, voir « Points ouverts ») : normalisation des
blancs internes d'un texte (le middleware `TrimStrings` ne retire que les bords), élément d'antécédents vide
admis, motif d'une date rétrospective facultatif.

## Rubriques mesurées (C02)

Même mécanique que les rubriques narratives : **remplacement complet**, comparaison **par identifiant de ligne**
(suppressions, puis mises à jour, puis insertions : deux lignes peuvent échanger leur clé d'unicité), toutes les
erreurs rendues ensemble avant la première écriture (422, clés `step.data.…`), enregistrement sans effet =
version inchangée, ni audit ni changement. Un identifiant de ligne déjà pris ailleurs → 422 par champ.

**Mesures** (`Rules/Measures`, jumeau TypeScript `domain/clinical/fields`) : chaînes décimales exactes
(contrat `Diopter`, `DECIMAL(6,2)`, au plus 4 chiffres entiers, 2 décimales) ; une valeur à 3 décimales est
**refusée**, jamais arrondie ; un flottant JSON est refusé ; zéro est une valeur distincte de null (non mesuré) ;
axe = entier 0 à 180 ; le cylindre positif n'est **jamais transposé**. Plages cliniques : aucune n'est inventée
(Q06) ; le pas usuel de 0,25 est seulement **signalé** à l'écran, jamais imposé.

| Rubrique | Règles |
| --- | --- |
| `VISUAL_ACUITY` | Une ligne = une valeur **mesurée** (case vide = pas de ligne). Préliminaire : loin ou près, sans ou avec correction ; après correction : distance `UNSPECIFIED`, `WITH` seulement. Une ligne par (contexte, distance, correction, œil). Valeur lue conservée **telle que saisie** (1 à 100 caractères : « 10/10 », « P2 », « CLD », « 0 »). Échelle **active** du cabinet ; une échelle désactivée depuis reste valable pour la ligne qui l'utilise déjà. `normalized_value` n'est **jamais calculée ni acceptée** (aucune conversion validée, Q06) : une valeur déjà enregistrée hors chemin est conservée telle quelle. |
| `REFRACTION` | Autoréfracteur, objective, subjective **distincts**, une ligne par (stade, œil OD/OG) ; une ligne porte au moins une mesure ; l'addition n'existe que pour la subjective ; observations libres ; amétropies choisies dans le référentiel `AMETROPIA` (jamais déduites des chiffres). Un cylindre non nul sans axe est admis pour une **mesure** (exigé pour valider une prescription). |
| `CENTERING` | Une ligne par consultation. Écarts strictement positifs ; le total et les monoculaires sont saisis séparément, **aucun n'est fabriqué** à partir de l'autre (l'écran propose la somme OD + OG, la personne la reporte si elle veut). Si total, OD et OG sont saisis et que OD + OG ≠ total au-delà de la tolérance : **justification obligatoire**. Tolérance : **hypothèse 0** (`CenteringStep::TOLERANCE_UNITS`, Q06). Une justification sans écart est refusée. Sans valeur : pas de ligne, `centering_id` null (G6) ; dès qu'une valeur est saisie, l'identifiant (ULID) vient du poste et doit être celui de la ligne existante. |

**Échelles d'acuité** (`visual_acuity_scales`, Q06 et décision G11 ouvertes) : aucune n'est validée par la
cliente. Commande d'exploitation `php artisan eeo:clinical:scales` :

- `--demo` : trois échelles de **DÉMONSTRATION** fictives (`DEMO_DIXIEMES`, `DEMO_SNELLEN_6`, `DEMO_PRES`), libellées
  « DÉMONSTRATION », en environnements `local`, `testing`, `e2e`, `demo` seulement (refus en production) ;
- `--code=… --label=… [--description=…]` : l'échelle **réelle** choisie par le cabinet, dans tout environnement ;
- `--clinic=…` si la base a plusieurs cabinets. Idempotente (un code présent n'est ni dupliqué ni modifié), audit
  `clinical.acuity_scale_created`. `tests/e2e/prepare-env.mjs` crée les échelles de démonstration.

## Médicaments (C04, rubrique `MEDICATIONS`)

Septième rubrique ajoutée au contrat (`StepName`, `AllSteps`, `AmendConsultation` jusqu'à 7 rubriques) entre
le centrage et la conclusion. Saisie libre **contrôlée** (aucune base de médicaments fournie ni inventée) :
nom (1 à 180) et forme (collyre, pommade, comprimé, autre + précision) obligatoires ; dosage, posologie,
fréquence, durée en texte, instructions facultatifs et **conservés tels que saisis** (rien n'est déduit ni
complété) ; durée structurée = nombre entier > 0 **et** unité (jour, semaine, mois), les deux ou aucun ; 20 lignes
au plus. L'**ordre compte** (position = rang dans la liste, jamais saisie) : changer l'ordre est un changement réel.
`catalog_item_id` facultatif, doit exister dans le catalogue du cabinet. Prescrire **ne crée ni vente ni
mouvement de stock** (seule `medication_orders` est écrite).

## Finalisation et correction (C03)

### `CompleteConsultation`

- Consultation `IN_PROGRESS` (brouillon sans rubrique ou déjà terminée : 409 `STATE_TRANSITION_REFUSED`) ; version
  attendue = `consultations.version` (409 `VERSION_CONFLICT`) ; visite `IN_CONSULTATION`.
- Fichier 02 : « exiger motif ou plaintes, conclusion ou justification d'absence, résolution des erreurs ; ne pas
  exiger des mesures non réalisées ». Lecture retenue : si le motif/les plaintes **ou** la conclusion manquent,
  `finalization_missing_data_reason` est obligatoire (≤ 4000). Les rubriques mesurées vides ne sont **jamais**
  exigées ni transformées en « aucun ».
- L'état enregistré des sept rubriques est **revalidé** par les règles de l'enregistrement (un état écrit hors
  chemin et devenu invalide bloque : erreurs sous `steps.<RUBRIQUE>.…`).
- `snapshot_sha256` = SHA-256 de JCS(steps) **que le poste a lues** ; le serveur le **recalcule** sur les tables
  vivantes sous verrou et refuse un écart (422) : on ne fige jamais autre chose que ce qui a été relu.
- Une transaction : révision 1 (`clinical_revisions`, snapshot complet, motif « Finalisation de la consultation »,
  auteur, `sha256`), consultation `COMPLETED` (`completed_at`, `current_revision` 1, version + 1), visite
  `COMPLETED` avec `closed_at`. Aucun contrôle de paiement.
- Effets : audit `consultation.completed` `{revision_no, revision_id, sha256}` ; événement `ConsultationCompleted`
  (références seulement) ; journal des changements (visite, consultation, révision). Verrous : cabinet →
  idempotence → visite (46) → consultation (47).

### `AmendConsultation`

- Consultation `COMPLETED` (sinon 409 : une consultation en cours se modifie directement) ; version attendue ;
  `revision_no` = révision courante + 1 et `previous_revision_id` = la révision courante (422 sinon) ;
  identifiant de révision neuf.
- **Motif obligatoire** (3 à 1000 caractères, schéma `Reason`) : conservé avec la révision (lisible avec
  `clinical.read`), **jamais recopié dans l'audit** (il peut contenir une donnée clinique).
- Chaque rubrique envoyée remplace la rubrique actuelle (mêmes règles, erreurs `steps.<n>.data.…`), une fois au
  plus ; une correction qui ne change rien est refusée (422 `steps`).
- `snapshot_sha256` = SHA-256 de JCS(`steps` de la requête), recalculé par le serveur (intégrité de ce qui est reçu).
- Le snapshot de la révision N est construit **après** les écritures, dans la même transaction (état résultant,
  `previous_revision_id`, `amendment_reason`). Les révisions antérieures ne changent jamais (triggers de la base).
- Audit `consultation.amended` `{revision_no, revision_id, previous_revision_id, steps (noms), sha256}`. La visite
  n'est pas touchée. Verrous : cabinet → idempotence → consultation.

### Empreintes (hypothèse « G8 »)

`clinical_revisions.sha256` = SHA-256 hexadécimal minuscule de **JCS(snapshot)**, calculé par le serveur seul
(`RevisionHash`, sous-ensemble de JCS : objets à clés ASCII triées, listes, chaînes, **entiers** seulement, booléens,
null ; un flottant lève une exception). Jumeau TypeScript `domain/clinical/snapshot.ts` (Web Crypto). Vecteurs
communs `contracts/vectors/clinical/snapshot-hash.json` (recoupés par une implémentation Python indépendante),
rejoués par PHPUnit et Vitest. La décision « G8 » des notes de pilotage n'est pas inscrite au registre 15 : à
confirmer (point ouvert).

### Lecture des révisions et comparaison

`GET …/revisions/{n}` rend la révision **telle qu'enregistrée** (snapshot compris), trace `consultation.revision_viewed`
(cible la révision, sans contenu). L'écran « Révisions de la consultation » compare deux révisions fait par fait :
changement dit **en texte et par un symbole** (« ≠ Modifié », « + Ajouté », « − Retiré », « = Identique ») ; une
valeur absente est « Non renseigné » ou « Non mesuré », jamais « aucun » ; une acuité est toujours rendue avec son
échelle et deux échelles différentes sont déclarées **non comparables** (aucune conversion).

## Prescription optique (C04)

| État | Règles |
| --- | --- |
| Création (`CreatePrescription`) | Brouillon `DRAFT`. **Interne** : consultation du cabinet et du patient indiqué ; **une seule série par consultation** (une seconde première version → 409, la suite passe par une nouvelle version). **Externe** (A13) : prescripteur et date d'origine obligatoires (pas dans le futur, jour du cabinet), fichier facultatif qui doit exister, **aucune consultation** (aucun examen fictif). **Nouvelle version** : la précédente est `VALIDATED` et la plus récente de sa série ; même série, patient, origine et consultation ; numéro suivant. Identifiants (prescription, série, yeux, traitements) neufs : sinon 422 par champ. |
| Contenu (`OpticalPrescriptionRules::normalize`) | Deux yeux exactement (OD, OG) ; mesures exactes (comme C02), cylindre positif non transposé, hauteur de montage > 0 ; « aucune correction » contradictoire avec une valeur ; usage, type de verre, traitements dans leurs référentiels (`OPTICAL_USAGE`, `LENS_TYPE`, `LENS_TREATMENT`), « Autre » avec précision ; indice dans la liste du fichier 02 (1.50 à 1.74) ou « autre » avec précision ; DP : mêmes règles que le centrage (justification d'un écart, jamais de DP fabriquée). Un brouillon peut être **incomplet**. Un code désactivé reste valable s'il est déjà enregistré sur ce brouillon. |
| Modification d'un brouillon (`UpdatePrescriptionDraft`) | **En ligne seulement** (hors catalogue F06 : hors-ligne, une correction est une nouvelle version). Jeton `expected_updated_at` (la table n'a pas de colonne `version`, que le contrat 23 interdit d'inventer) : écart → 409 `VERSION_CONFLICT` avec `details.current_updated_at`. `changes` ne contient que des champs de contenu ; yeux et traitements fournis **remplacent** les actuels ; contenu résultant revalidé en entier ; sans effet : rien n'est écrit. Audit `prescription.updated` : noms des champs, jamais leurs valeurs. `expected_version: null` est toléré au corps (ajouté par le répartiteur du poste). |
| Validation (`ValidatePrescription`) | Brouillon seulement (sinon 409) ; pour chaque œil, des valeurs saisies **ou** « aucune correction » ; un cylindre non nul exige un axe. La version devient **immuable** (triggers : ni la ligne ni ses enfants). Dans la même transaction, un document est **préparé** : `generated_documents` `OPTICAL_PRESCRIPTION`, statut `PENDING`, `source_key` `optical_prescription:<id>`, `revision_no` = numéro de version, `template_version` `optical_prescription.v1` (convention `<type>.v<n>` du registre des modèles ; la mention « test » vient du cabinet, jamais du nom). **Aucun fichier n'est écrit ici** : la génération suit le commit et appartient au moteur de documents (D01, D02). Rien n'est dit « imprimé ». Aucune vente, ligne de facture ni mouvement de stock. Audit `prescription.validated`, événement `PrescriptionValidated`. |
| Lecture | Une prescription ; la liste des versions d'une consultation (plus récente d'abord). Traces `prescription.viewed` et `consultation.prescriptions_viewed`, sans contenu, au plus une par intervalle. |

**Écran « Prescription optique »** (`/consultations/{id}/prescriptions`) : brouillon marqué « BROUILLON » ; copie
de la réfraction **explicite** (choisir le stade, confirmer ; l'œil sans mesure n'est pas touché, la prescription
s'édite ensuite sans modifier l'examen) ; report explicite des écarts du centrage ; « Valider » exige un brouillon
enregistré sans modification en attente ; nouvelle version d'une version validée (lignes neuves) ; conflit de
brouillon : saisie conservée et champs modifiés ailleurs montrés. **La transcription d'une ordonnance externe n'a
pas d'écran** (aucune route de liste par patient) : serveur et domaine seulement.

**Impression (branchée sur le moteur de documents, D02)** : l'ancien `domain/clinical/printModels.ts` (doublon
du moteur) est **supprimé** ; une seule source de vérité, les adaptateurs `documents/data/clinicalAdapters.ts`
lisant les ressources générées (`Prescription`, `Consultation`, `ClinicalRevisionDetail`), appelés par le service
`app/services/clinicalDocuments.ts` (détail : `documents.md`, « Documents cliniques branchés sur les écrans »).

- **Examen terminé** (`ConsultationDocuments.vue`, sous « Examen terminé », jamais pendant une correction ni pour un
  examen en cours) : « Aperçu de la fiche de consultation » (`clinical.export`), « Aperçu de l'ordonnance de
  médicaments » (rubrique Médicaments renseignée), « Aperçu de la lettre d'orientation » (orientation « oui ») ;
  chaque document est construit de la **révision figée relue** au moment de la demande (`GET …/revisions/{n}`),
  auteur et numéro de révision imprimés. Aucune lecture avant le clic.
- **Prescription optique** (écran « Prescription optique ») : « Aperçu de la prescription (version N) » pour la
  dernière version **validée** seulement ; un brouillon n'a aucune impression. Nom imprimé : compte connecté s'il a
  validé, sinon nom figé d'une révision enregistrée par le même professionnel, sinon refus (jamais deviné).
- Document de TEST tant que `production_documents_enabled` est faux ; identité légale, signature et cachet : non
  inventés. Conservation : port `DocumentStore` volatil ; la ligne `generated_documents` reste `PENDING` (aucune
  route de dépôt). Ordonnance et lettre : sans `document_type` serveur, générées localement.
- L'écran de lecture d'une prescription (`PrescriptionView.vue`) affiche `prescriptionScreenModel` : mêmes valeurs
  et mêmes mises en forme que le PDF.

## Écran de consultation (frontend)

`/consultations/{id}` : sept étapes (liste numérotée, « Étape N sur 7 »), en-tête patient lu dans la consultation,
« Suivant » enregistre avant d'avancer, conflit de version rebasé valeur par valeur (rubriques mesurées comprises).
Acuités : grille loin/près × sans/avec correction × OD/OG/OU puis après correction, **une échelle par groupe**
choisie explicitement (suggestions de saisie des échelles de démonstration, saisie libre conservée), alerte si
aucune échelle n'est configurée ou lisible. Réfraction : trois tableaux, indications non bloquantes (pas de 0,25,
cylindre sans axe). Centrage : somme OD + OG proposée, justification demandée en cas d'écart. Médicaments : lignes
ajoutées, retirées, déplacées. « Terminer l'examen » (compte `clinical.complete`, examen en cours, rien de non
enregistré) : confirmation avec la liste des rubriques non renseignées et la justification si besoin. Examen
terminé : lecture seule, liens « Révisions et comparaison » et « Prescription optique », « Corriger l'examen »
(`clinical.amend`) : motif obligatoire, les rubriques modifiées partent en une révision. Rien n'est conservé dans
le navigateur.

## Décisions, hypothèses, points ouverts

| Point | Décision / état |
| --- | --- |
| Contrôle du paiement de l'examen | Inchangé pour la consultation : finalisation sans contrôle ; AT05/AT06 non prouvés par C01–C04. |
| Échelles d'acuité (Q06, G11) | Démonstration seulement, libellées comme telles ; échelles réelles par `eeo:clinical:scales --code`. Aucune conversion (`normalized_value` jamais calculée). |
| Tolérance DP total / OD + OG (Q06) | Hypothèse : 0 (toute différence se justifie). Pas de 0,25 : signalé, non imposé. Plages cliniques : non inventées. |
| Empreintes (« G8 ») | JCS + SHA-256 ; `snapshot_sha256` de la finalisation = rubriques lues, de la correction = rubriques envoyées ; `sha256` de la révision = snapshot. À inscrire au registre 15. |
| Règle de finalisation | Justification exigée si motif/plaintes **ou** conclusion manquent ; à confirmer avec la cliente. |
| Motif d'une correction | Dans la révision, jamais dans l'audit. |
| Prescription : une série par consultation | Unicité (consultation, version) du MLD ; les corrections sont des versions de la même série. |
| Brouillon de prescription | Modifiable en ligne seulement, jeton `updated_at` (milliseconde). |
| Document de prescription | Ligne `generated_documents` `PENDING` écrite par la validation, `template_version` `optical_prescription.v1` ; PDF généré sur le poste (D02), aucune route ne la passe à `READY`. |
| Nom du professionnel d'une prescription | `Prescription.validated_by_name` (2026-10-22) : nom d'affichage du compte validateur, lu dans le cabinet à chaque lecture. Ce n'est PAS un nom figé (aucune colonne au schéma) : le PDF original, lui, est figé à sa génération. L'impression n'est refusée que si aucun nom n'est disponible. |
| Ordonnance externe | Serveur et domaine prêts ; pas d'écran (nécessite une liste par patient, P02). |
| Motif d'une date rétrospective, blancs internes, élément d'antécédents vide | Documentés, non tranchés (à confirmer avec la cliente). |
| Poste hors-ligne | Toutes les commandes cliniques refusées (403) hors route directe jusqu'à O01–O05. |

## Tests (écrits, non exécutés dans cette passe)

PHPUnit (MySQL réel) — `tests/Feature/Clinical/` : `StartConsultationTest`, `SaveClinicalStepTest`,
`SaveAnamnesisStepTest`, `SaveHistoriesStepTest`, `SaveConclusionStepTest`, `GetConsultationTest` (traces des
écritures, échec de l'audit = échec de la lecture, débit), `ConsultationReaderSnapshotTest` (relecture,
503), `SaveVisualAcuityStepTest`, `SaveRefractionStepTest`, `SaveCenteringStepTest`, `SaveMedicationsStepTest`,
`VisualAcuityScalesTest` (route et commande), `CompleteConsultationTest`, `AmendConsultationTest`,
`GetRevisionTest`, `CreatePrescriptionTest`, `UpdatePrescriptionDraftTest`, `ValidatePrescriptionTest`,
`GetPrescriptionTest` (droits, cabinets, module, rejeu, retour arrière à chaque point du chemin, ordre des
verrous, sources hors-ligne, confidentialité des effets de bord, triggers d'immuabilité) ; règles pures
`tests/Unit/Clinical/` : `NarrativeRulesTest`, `MeasurementRulesTest` (vecteurs), `RevisionHashTest` (vecteurs),
`PrescriptionRulesTest`. Vitest — `tests/frontend/domain/clinical-{snapshot,measures,medications,compare,prescriptions}.test.ts`,
`tests/frontend/consultations/consultation-{page,steps,errors,finish,measures,history}.test.ts`,
`prescriptions-page.test.ts`, `consultation-documents.test.ts` (impression : état, droits, révision figée, nom de
fichier), `tests/frontend/services/consultations.test.ts`. Playwright —
`tests/e2e/consultation.spec.ts` (sept étapes, rechargement, finalisation, révision, 360 px). Contrats : fixtures
`save-clinical-step.{visual-acuity,medications}.valid` et trois `.invalid`, snapshot de révision avec
`MEDICATIONS`. Piège de test : figer l'horloge **avant** de créer les comptes (`tests/Support/ClinicalFixtures.php`) ;
le jeton d'un brouillon de prescription est à la milliseconde : avancer l'horloge entre deux modifications.

## Liste des examens (phase 1, ajoutée avec l'accueil par profil)

`GET /api/v1/consultations` (`ListConsultations`, module `consultations`, `clinical.read`, même limite de débit par
compte que les lectures de dossier) : 50 examens par page, du plus récent au plus ancien (date effective), filtres
`date` (jour civil du cabinet, jamais minuit UTC), `status` et `mine=true`. Chaque élément porte l'identité
administrative de base du patient, l'état, les dates, la révision et le professionnel (`ConsultationSummary`) :
AUCUNE valeur clinique et aucune trace de lecture (le dossier s'ouvre par `GET /consultations/{id}`, tracé).
Code : `app/Domain/Clinical/ConsultationDirectory.php`, `ConsultationListController`, `ConsultationSummaryPresenter`.
Écran : `pages/consultations/ConsultationListPage.vue` (jour du cabinet par défaut ; préréglages `?jour=tous`,
`?etat=IN_PROGRESS`, `?mes=1` pour les raccourcis de l'accueil). Tests écrits :
`tests/Feature/Clinical/ListConsultationsTest.php`, `tests/frontend/consultations/consultation-list.test.ts`.

Identité du cabinet sur les documents cliniques : `GET /api/v1/clinic/document-identity` (lisible avec
`clinical.read`) et `clinicFromIdentity()` de `documents/data/clinic.ts` remplacent `clinicFromSummary()` (nom seul)
pour une ordonnance ou une fiche de consultation ; le branchement dans `app/services/clinicalDocuments.ts` reste à
faire par le chantier de l'impression clinique.

## Ordonnances externes à l'écran (2026-10-23)

Le serveur acceptait déjà `POST /prescriptions/external` (A13, `CreatePrescription` d'origine `EXTERNAL`,
prescripteur et date d'origine obligatoires, aucune consultation) mais aucun écran ne permettait de la saisir.

- Lecture : `GET /api/v1/patients/{id}/prescriptions` (`GetPatientPrescriptions`, module `consultations`,
  `clinical.read`, même limiteur que les lectures de dossier) : toutes les versions des prescriptions du
  patient, internes et externes, de la plus récente à la plus ancienne ; patient d'un autre cabinet = 404 ;
  lecture tracée une fois par 10 minutes (`patient.prescriptions_viewed`, cible `patient_records`).
- Écran : onglet « Prescriptions » du dossier patient (visible seulement avec `clinical.read` et le module
  ouvert), `pages/patients/{PatientPrescriptionsPage,ExternalPrescriptions}.vue`. Même éditeur et mêmes règles
  que la prescription d'une consultation : `usePrescriptionEditor` accepte une source
  `{ kind: 'external', patientId }` (création par `/prescriptions/external`, nouvelle version par
  `/prescriptions/{id}/revisions`, brouillon par `PATCH`, validation inchangée) ; rien à recopier de la
  réfraction ; pas d'impression proposée (l'original papier existe).
- Tests écrits : `tests/Feature/Clinical/PatientPrescriptionsTest.php`, `tests/e2e/external-prescription.spec.ts`.

## Nouvelle consultation et saisie rapide (2026-10-30)

Demande de la cliente après la démonstration : aucun bouton pour lancer un examen hors de la file du jour, et un écran
d'examen éloigné de son carnet et du ticket de l'autoréfracteur. Aucune commande, aucun contrat ni aucune table ne
change : tout passe par `StartConsultation`, `RegisterVisit` et `SaveClinicalStep` existants.

- **Entrées** : action d'accueil `new-consultation` (« Nouvelle consultation », `clinical.write`, module `consultations`,
  adresse `/consultations?nouvelle=1`), raccourci `start-exam` (même libellé, groupe « Examens ») et bouton du
  même nom en tête de la liste des examens. L'adresse `?nouvelle=1` ouvre la boîte et se retire à sa fermeture.
- **Boîte** (`StartConsultationDialog.vue`, montée à la demande ; contenu `StartConsultationPanel.vue`) : « Dans la
  file du jour » liste les visites d'examen ou de suivi en attente (arrivé, en attente du paiement, prêt) avec
  `ExamAction` (mêmes règles et mêmes refus que la file : `EXAM_PAYMENT_REQUIRED` est dit tel quel). « Un autre
  patient » cherche par nom, téléphone ou dossier (`patient.read`) : une visite d'examen déjà ouverte aujourd'hui est
  reprise telle quelle ; sinon, avec `visit.register`, « Enregistrer l'arrivée et démarrer l'examen » envoie
  `RegisterVisit` (motif `EXAM`) puis `StartConsultation` (`StartExamButton autostart`) : deux commandes, deux clés,
  jamais un succès supposé ; si le démarrage échoue l'arrivée reste enregistrée et le bouton propose de réessayer.
  File du jour illisible ou tronquée, fiche archivée ou fusionnée : aucune arrivée n'est enregistrée.
- **Écart pupillaire du ticket** : saisi sous le tableau « Autoréfracteur » (étape « Réfraction »), c'est le champ
  `pdTotal` du centrage (même identifiant de contrôle, un seul champ). `useConsultationEditor.run` valide d'abord le
  centrage, envoie la réfraction puis le centrage (deux `SaveClinicalStep`, version rebasée entre les deux) quand SEUL
  `pdTotal` a changé (`pdOnlyDirty`) ; toute autre saisie du centrage reste à enregistrer depuis son étape.
  « Corriger l'examen » l'inclut comme n'importe quelle rubrique modifiée.
- **Acuité** : le choix de l'échelle de chaque groupe est une rangée de boutons radio (un par échelle active), plus
  de menu déroulant. Le serveur exige toujours `scale_id` : quand le cabinet n'a qu'UNE échelle active elle s'applique
  d'office et son choix n'est plus proposé ; avec plusieurs, le choix reste explicite (aucune échelle devinée) et une
  valeur nouvelle prend l'échelle déjà choisie pour le groupe. `QuickChoices` propose sous chaque tableau les valeurs
  usuelles de la FAMILLE de l'échelle (`acuityFamily`, reconnue au code ou au libellé, accents et casse ignorés :
  `DIXIEME`, `DECIMAL` ou `X/10` ; `SNELLEN` ; `PARINAUD` ou `PRES`), puis « CLD » et « VLMB » du carnet pour les
  dixièmes. Elles servent donc aussi aux échelles RÉELLES, par exemple
  `eeo:clinical:scales --code DIXIEMES --label "Dixièmes (X/10)"` puis `--code PARINAUD --label "Vision de près
  (Parinaud)"` ; une échelle d'une autre famille garde la saisie libre. Un bouton remplit la dernière case touchée,
  sinon la première case vide (sans correction OD, OG, puis avec correction). Aides à la saisie seulement : aucune
  conversion, aucune valeur appliquée seule, aucune échelle validée cliniquement (Q06 reste ouverte).
- **Motif** : boutons de symptômes courants qui complètent le texte libre (`symptoms`), sans doublon ni écrasement.
- **En-tête** : la profession du dossier administratif s'ajoute à la ligne de la date quand elle est connue
  (`ConsultationHeaderPatient` du contrat `Consultation.patient`, lue par `ConsultationReader::patient` ; la liste des
  examens, `ConsultationSummary`, ne la porte pas). Le snapshot d'une révision n'en retient pas la profession : son
  empreinte ne change pas.
- **Prescription optique** : un bloc de l'examen en cours mène à l'écran de prescription (le serveur n'exige pas que
  l'examen soit terminé ; la copie de la réfraction reste un geste explicite). Terminé, le lien reste dans « Examen
  terminé ».
- **Caisse** : « Transmettre à la caisse » (examen terminé ; patient et visite passés à `facture-nouvelle`) pour qui a
  `invoice.create` ou `exam_fee.collect`, module `sales` ouvert ; les autres comptes (le professionnel) lisent où la
  caisse crée la facture (« Créer une facture » de la file du jour). Un reçu naît de l'encaissement d'une facture : il
  n'y a pas de « reçu direct » depuis l'examen.
- **Inchangé, volontairement** : antécédents (Traumatisme, Chirurgie, Glaucome, Cataracte, Diabète, Hypertension… déjà
  en cases à cocher avec « Aucun connu » exclusif) et « Porte actuellement des lunettes » avec sa durée (étapes 1 et 2)
  ; les sept étapes sont conservées (les rubriques restent celles du contrat et du dossier).
- **Tests** : `tests/frontend/consultations/start-consultation.test.ts`, ajouts de `consultation-measures.test.ts` et
  `consultation-page.test.ts`, `tests/frontend/domain/acuity-scales.test.ts`,
  `tests/frontend/shell/{navigation,home-shortcuts}.test.ts`, `tests/Feature/Clinical/GetConsultationTest.php`,
  `tests/e2e/consultation-nouvelle.spec.ts` (vraie application) et `shell.spec.ts`.

## Modifier et supprimer un examen (2026-10-30, chantier « CRUD des écrans », tranche 1)

Demande du cabinet, après avoir créé un examen de test resté en brouillon que rien ne permettait de retirer : « on
supprime une consultation quand elle est encore en brouillon, uniquement en brouillon pour l'instant ». Première tranche
du chantier qui généralise modifier / supprimer (ou archiver, annuler) aux autres écrans ; l'inventaire entité par entité
est celui des tranches suivantes.

- **États** (`consultations.status`) : `DRAFT` (démarré, AUCUNE rubrique enregistrée : l'écran dit « Brouillon »),
  `IN_PROGRESS` (au moins une rubrique, « En cours »), `COMPLETED` (révision 1 figée, « Terminé »). Seul `DRAFT` se
  supprime : un brouillon ne porte aucune valeur clinique (seulement visite, patient, professionnel, date). Un examen
  en cours se poursuit ; un examen terminé se corrige par `AmendConsultation` (nouvelle révision motivée, les précédentes
  restent lisibles), jamais par une suppression ni un écrasement. Étendre la suppression aux examens « en cours » est un
  choix du cabinet (il détruirait des rubriques saisies, non validées) : non fait.
- **Commande** `DeleteConsultationDraft` (`DeleteConsultationDraftHandler`, route `POST /consultations/{id}/delete`,
  corps `schemas/requests/http.json#/$defs/DeleteConsultationDraftRequest` = `consultation_id` + `expected_version`,
  réponse `DeleteConsultationDraftResponse`). EN LIGNE seulement, comme le démarrage d'un examen (hors catalogue F06,
  comme `UpdatePrescriptionDraft` et `CancelVisit`) : une source de poste ou de tâche est refusée (403
  `ACTION_FORBIDDEN`). Verrous : cabinet, idempotence, visite (46), consultation (47). Pas de route `DELETE` : le projet
  n'en a aucune, toute écriture est un `POST`/`PATCH` avec version attendue et `Idempotency-Key`.
- **Qui** : `clinical.write` (et `clinical.read`, comme toute écriture clinique) ET le professionnel qui a démarré
  l'examen (`consultations.clinician_id`) OU la gérante (`approval.decide`, même notion que « modifier le brouillon d'un
  autre compte » de la facturation, `ActorRights::manager`). Aucune permission nouvelle (le référentiel reste de 49
  codes) : l'auteur, la gérante, rien d'autre. Un autre professionnel : 403 `ACTION_FORBIDDEN`. Accueil et caisse : 403
  (aucun `clinical.*`).
- **Refus** (aucun effet) : examen introuvable, déjà supprimé ou d'un autre cabinet : 404 ; examen en cours ou terminé :
  409 `STATE_TRANSITION_REFUSED` avec `details.current_status` ; version périmée : 409 `VERSION_CONFLICT` avec
  `details.current_version` ; visite qui n'est plus « en consultation », rubrique ou révision déjà enregistrée, contrôle
  recommandé programmé, prescription VALIDÉE ou déjà utilisée par une ligne de facture, une commande d'atelier ou un
  document : 409 `STATE_TRANSITION_REFUSED`. Rien n'est supprimé en cascade au-delà de ce qui est du brouillon.
- **Ce que la suppression défait**, dans la même transaction : l'examen ; ses prescriptions BROUILLON avec leurs yeux et
  traitements (les déclencheurs de la base n'interdisent que les prescriptions validées) ; la visite revient à son état
  d'avant (`ARRIVED` quand le paiement de l'examen n'est pas contrôlé, valeur par défaut ; avec `EEO_EXAM_FEE_CONTROL=billed`
  : `READY_FOR_EXAM` si une facture de frais est réglée, `AWAITING_EXAM_FEE` sinon, et la dispense de la gérante consommée
  par l'examen supprimé est retirée de la visite : l'approbation reste `CONSUMED`, une nouvelle dispense est nécessaire).
  La file du jour reste cohérente et l'examen peut être redémarré (une seule consultation par visite). Les factures de la
  visite (brouillon ou émise) ne sont PAS touchées : aucune clé ne les relie à la consultation.
- **Traces** : audit `consultation.deleted` (qui, quand, quelle consultation ; `sanitized_diff` : visite, patient,
  professionnel, statut et version avant, nombre de prescriptions brouillon supprimées, statut de visite rétabli ; aucune
  valeur clinique), append-only. Journal des changements : la visite `UPDATED`, la consultation `ARCHIVED` (pierre
  tombale à `version + 1` : « jamais de suppression, une entité retirée est archivée »). Hors ligne : les consultations
  sont publiées au pull sans contenu (`PullProjections`, limite L0) et ne se démarrent pas sur un poste : aucune
  projection ni commande locale n'est à défaire, le contrat du pull ne change pas.
- **Contrat** : `ConsultationSummary` (liste) porte désormais `version` (la version attendue par la suppression) ; aucune
  autre ressource ne change. Générés par `contracts/tools/build_resources.py` et `build_openapi.py`, puis
  `npm run contracts:types`, relus par `--check`.
- **Écrans** : liste des examens — chaque carte offre « Modifier » (ouvre l'examen ; un examen terminé s'ouvre en
  correction avec `?corriger=1`, nouvelle révision motivée, avec `clinical.amend`) et « Supprimer » (brouillon seulement,
  pour l'auteur ou la gérante) ; une seule boîte `DeleteConsultationDialog` pour toute la liste, message du résultat
  (`StateMessage`). Éditeur — « Supprimer le brouillon » en tête de page pour un brouillon (puis retour à la liste avec le
  message, via `flash.ts` en mémoire) ; un examen en cours ou terminé ne l'offre jamais (terminé : « Corriger l'examen »).
  Les règles d'affichage sont dans `domain/clinical/draftDeletion.ts` ; le serveur refait tous les contrôles.
- **Tests** : `tests/Feature/Clinical/DeleteConsultationDraftTest.php` (22 cas : règles, auteur et gérante, refus, audit,
  pierre tombale, rejeu, isolation) et deux cas de `BilledExamFeeControlTest`, `tests/frontend/domain/draft-deletion.test.ts`,
  `tests/frontend/consultations/consultation-delete.test.ts`, `tests/e2e/consultation-suppression.spec.ts` (vraie
  application : suppression, redémarrage, refus d'un examen en cours et d'un examen terminé, captures 1366 et 360 px).
  Jeu de contrats : `contracts/fixtures/resources/consultation-summary-page.*.json` portent `version`.
- **Aide intégrée** : `domain/help/content/pages-consultations.ts` (écrans « Consultations » et « Consultation »).


## Supprimer un brouillon de prescription (chantier « CRUD des écrans », tranche 3a)

Commande `DeletePrescriptionDraft` (`DeletePrescriptionDraftHandler`, `POST /prescriptions/{id}/delete`, corps
`DeletePrescriptionDraftRequest` = `prescription_id` + `expected_updated_at` + `expected_version: null`, réponse
`DeletePrescriptionDraftResponse`). EN LIGNE seulement, comme la modification d'un brouillon (hors catalogue F06 :
la source `SYNC` ou une tâche est refusée, 403 `ACTION_FORBIDDEN`).

- **Quoi** : un BROUILLON jamais utilisé. Une prescription VALIDÉE est immuable (déclencheurs de la base) et se corrige par
  une nouvelle version : 409 `STATE_TRANSITION_REFUSED` avec `details.current_status`. Une prescription désignée par une
  ligne de facture, une commande d'atelier ou un document : 409. Un brouillon qui est la version N+1 d'une validée se
  supprime sans toucher à la validée (elle redevient la dernière version, une autre N+1 peut être créée).
- **Qui** : `clinical.write` et `clinical.read`, comme la modification (un brouillon de prescription ne conserve aucun
  auteur : celui qui peut le modifier peut le supprimer). Accueil et caisse : 403.
- **Jeton** : `expected_updated_at`, lu avec le brouillon (la table n'a pas de colonne `version`) ; un écart : 409
  `VERSION_CONFLICT` avec `details.current_updated_at`.
- **Effets** : les yeux et traitements du brouillon disparaissent avec lui ; le fichier d'une ordonnance externe éventuelle
  reste dans `stored_files`. Audit `prescription.deleted` (série, version, origine, consultation, `supersedes_id` : aucune
  valeur clinique) ; journal des changements : pierre tombale `ARCHIVED` (`entity_version` = numéro de version). Verrous :
  cabinet, idempotence, dossier patient (45), consultation (47) quand la prescription est interne.
- **Écrans** : « Supprimer le brouillon » dans la barre d'actions du brouillon enregistré, sur l'écran de prescription d'une
  consultation (`PrescriptionsScreen.vue`) et sur les ordonnances externes du patient (`ExternalPrescriptions.vue`) ;
  boîte `DeletePrescriptionDraftDialog.vue` ; l'édition se ferme, la liste est relue, un message dit le résultat. Règle
  d'affichage : `canDeletePrescriptionDraft` (`domain/clinical/draftDeletion.ts`).
- **Tests** : `tests/Feature/Clinical/DeletePrescriptionDraftTest.php`, `tests/frontend/consultations/prescription-delete.test.ts`,
  `tests/frontend/domain/draft-deletion.test.ts`, `tests/e2e/external-prescription.spec.ts` (nouvelle version puis suppression
  de son brouillon, la validée reste). Aide intégrée : fiches « Prescription optique » et « Ordonnances externes ».

# Documents PDF locaux (D01, D02)

Tâches D01 (« Générer et conserver les PDFs financiers hors-ligne ») et D02 (« Compléter templates et
validation visuelle des documents »), lot L0. Références : fichier 11 (documents et impression), 19 (hors-ligne),
03 (finance), 04 (interface), 15 (hypothèses), 23 (documents, snapshots, templates).

**Statut : codé, non exécuté.** Aucun test, aucune vérification de types, aucun linter ni build n'ont été lancés
pendant l'écriture (consigne du demandeur : coder d'abord, vérifier à la fin). Les tests existent comme fichiers
et sont à exécuter lors de la passe de vérification finale (section « Vérification finale »).

## Ce qui est livré

| Brique | Fichiers | Rôle |
| --- | --- | --- |
| Moteur | `resources/frontend/documents/engine/` | Mise en page A4, A5 et ticket 80 mm, pagination, tableaux, montants XAF, dates au fuseau du cabinet, rendu jsPDF, aperçu |
| Données | `documents/data/` | Types d'entrée alignés sur les snapshots du serveur, libellés du référentiel, adaptateurs |
| Modèles | `documents/templates/` | Un modèle par type, fonctions pures `build<Type>(données, options) => DocumentModel`, registre versionné |
| Conservation | `documents/store/` | Port `DocumentStore`, version mémoire, crochet vers le coffre |
| Sortie | `documents/output/` | Nom de fichier, ouverture, téléchargement, impression |
| Démonstration | `documents/demo/` | 19 documents fictifs (aperçu, tests, rendu « golden ») |
| Écran | `app/services/documents.ts`, `components/documents/DocumentPreview.vue`, `pages/documents/DocumentPreviewPage.vue`, route `/documents/apercu` | Aperçu, ouverture, téléchargement, impression |
| Tests | `tests/frontend/documents/` (19 fichiers de test dont `golden/`), `tests/e2e/documents.spec.ts` | Voir plus bas |

Types de documents (`DocumentKind`) : facture, devis (préparatoire, L1), reçu de paiement (acompte ou règlement du
solde), avoir, reçu de remboursement, état de compte, relevé / clôture de caisse, prescription optique, ordonnance
de médicaments, lettre d'orientation, fiche de consultation / dossier clinique.

## Décisions

1. **Rendu en deux temps.** Un modèle (`DocumentModel`, contenu sans position) est mis en page en un *plan de
   dessin* (`LayoutPlan`, pages et opérations en mm) par `layoutDocument(model, measurer)`, fonction pure. Le même
   plan alimente le PDF (`pdf.ts`) **et** l'aperçu à l'écran (SVG dans le composant) : ce qu'on voit est ce qui
   s'imprime. Seule la mesure du texte dépend de la police (interface `TextMeasurer`) ; les tests de mise en page
   utilisent une mesure déterministe sans jsPDF.
2. **Polices standard du format PDF** (Helvetica, WinAnsi), pas de police embarquée : aucun téléchargement n'est
   possible ici et aucune police libre n'est disponible hors ligne. Écart assumé avec « fonte française embarquée »
   (fichier 11), détaillé dans `documents/fonts/README.md` avec la marche à suivre. Les caractères hors WinAnsi
   (lettres de langues locales, symboles) sont remplacés **et signalés** (`warnings`), jamais supprimés en silence.
3. **Mesure exacte de Helvetica** (`engine/metrics.ts`) : la table de largeurs de jsPDF est arrondie au centième
   et donne une largeur par défaut à l'espace insécable, à « œ », « × », « € »…, ce qui fausserait l'alignement des
   montants. Les largeurs AFM de l'ASCII et de ces caractères sont corrigées ; le reste vient de jsPDF. Pas de
   crénage (le dessin n'en applique pas). Le texte est toujours dessiné à gauche, avec une abscisse calculée par
   la mise en page (jamais `align` de jsPDF).
4. **Reproductibilité.** Date de création du PDF = instant de la pièce (UTC) ; identifiant de fichier dérivé du
   contenu du modèle ; compression déterministe. Même modèle, mêmes octets, même SHA-256 : une réimpression rend la
   même pièce, et une régénération depuis le même snapshot et la même version de modèle retrouve l'empreinte de
   l'original (ou révèle l'écart). Un modèle publié ne change donc jamais de rendu : on **ajoute** une version.
5. **Versionnement des modèles.** `templates/registry.ts` : `TEMPLATE_VERSION = 'TEST-1'` (valeur déjà employée par
   les fixtures de snapshots du serveur). `buildDocument(kind, data)` choisit le modèle par `data.templateVersion` et
   refuse une version inconnue (`template.unknown_version`). Quand les mentions réelles seront validées : nouvelle
   version (par exemple `1`), ancienne conservée, `contracts/compatibility.json` complété (contrat 23).
   **Convention retenue : `<type>.v<n>`**, type = `document_type` en minuscules (`invoice.v1`, `receipt.v1`, puis
   `credit_note.v1`…). Documents cliniques (`CLINICAL_TEMPLATE_VERSIONS`) : `optical_prescription.v1` (écrit par le
   serveur à la validation, `ValidatePrescriptionHandler::TEMPLATE_VERSION`, au lieu de l'ancien
   `optical-prescription.demo.v1`), `clinical_record.v1`, `medication_order.v1`, `referral_letter.v1`. La mention
   « démonstration / test » n'est JAMAIS dans le nom : elle vient du cabinet (`clinic.test_document`, ou
   `!production_documents_enabled` pour un document clinique), comme pour les pièces financières.
   `contracts/compatibility.json` déclare 12 modèles (`TEST-1` pour les 8 types connus du serveur, `invoice.v1`,
   `receipt.v1`, `optical_prescription.v1`, `clinical_record.v1`) ; `registry.test.ts` vérifie l'égalité avec le
   registre et relit la constante PHP.
   Côté finances, `app/Domain/Billing/Documents/PendingDocuments.php` écrit `invoice.v1`, `receipt.v1` (même
   convention) alors que les fixtures de `contracts/fixtures/snapshots/` disent encore `TEST-1` : le registre
   accepte les deux (mêmes modèles). Tout autre nom que le serveur écrira (avoir, remboursement…) s'ajoute dans
   `SERVER_VERSIONS` (`templates/registry.ts`) et dans `compatibility.json`.
   Les clés de source du serveur (`invoice:<id>`, `receipt:<id>`, révision 1) sont reprises telles quelles par
   `DocumentKey`.
6. **Document de test tant que les mentions manquent.** Cabinet de la configuration (`DocumentClinic`) : si
   `testDocument` (`clinic.test_document`, faux seulement quand `production_documents_enabled`), bandeau « DOCUMENT
   DE TEST », filigrane « DONNÉES DE TEST », emplacements « à renseigner » (adresse, contact, identifiant fiscal,
   logo, mentions, numéro professionnel). Sinon les lignes absentes sont omises et signalées dans
   `model.warnings`. Aucune identité, aucun taux, aucune mention n'est écrit en dur dans un modèle.
7. **Pièces financières.** Le modèle refuse (`DocumentDataError`, code stable, sans donnée personnelle) une pièce
   incohérente : total ≠ somme des lignes, reçu dont le cumul ne suit pas le versement ou dont la nature
   (acompte / règlement du solde) contredit le reste, avoir dont le montant ≠ somme des lignes, solde d'état de
   compte ≠ total − avoirs − encaissé + remboursé, espèces attendues ≠ mouvements, brouillon portant un numéro,
   facture émise sans numéro, montant décimal ou négatif. Un écart ligne / calcul (quantité × prix − remise) est un
   **avertissement** (jamais caché). Aucune pièce ne dit « payé », « soldé », « acquitté », « gratuit » : « Acompte »
   et « Règlement du solde » viennent du calcul du serveur ; l'état de paiement à l'émission d'une facture n'est
   imprimé qu'avec ses numéros de reçu.
8. **Séparation des mondes.** Aucun antécédent, symptôme, réfraction sur une pièce financière ; aucun montant sur
   un document clinique ; le niveau d'urgence d'orientation n'apparaît que sur les documents cliniques
   (tests sur les 19 documents de démonstration).
9. **Prescription.** Zéro visible (« 0,00 »), valeur absente = tiret (« — ») jamais zéro, signe explicite
   (« +2,00 », « -1,25 »), axe en degrés, unités visibles (dioptries, mm), OD puis OG. Une prescription **validée**
   est refusée si un œil n'a ni valeurs ni « absence de correction », si « absence » contredit des valeurs, ou si
   un cylindre non nul n'a pas d'axe (fichier 02) ; un brouillon l'accepte avec avertissement. Aucun texte médical
   n'est produit. Le nom imprimé n'est pas une signature électronique certifiée (mention + cadre de signature).
10. **Droits.** `documents/access.ts` : permissions du référentiel par type (une suffit). Un document clinique
    demande `clinical.read` (prescription, ordonnance, lettre) ou `clinical.export` (dossier PDF) ; un reçu ne
    donne jamais accès à une prescription ni au dossier. `renderDocument` (service) refuse (`DocumentAccessError`)
    avant tout rendu ; l'écran d'aperçu ne propose que les documents permis. Compartiment du coffre :
    `documentCompartment(kind)` (FINANCIAL ou CLINICAL).
11. **Aucun réseau.** Test d'architecture (`no-network.test.ts`) : ni `fetch`, ni `XMLHttpRequest`, ni client HTTP
    de l'application, ni adresse distante, ni stockage navigateur, ni dépendance autre que jsPDF. jsPDF n'est
    importé que par `engine/pdf.ts`, lui-même chargé à la demande (`await import`) par le service : le moteur de
    rendu ne pèse pas sur le premier chargement, et il est précaché par le service worker (hors ligne).

## Impression, téléchargement et politique de sécurité (CSP)

`SecurityHeaders` envoie `default-src 'self'; object-src blob:` : un PDF n'est pas intégré dans un `<iframe>` de la
page (cadres limités à l'origine) ; `object-src blob:` (strict nécessaire, décidé en phase 1) laisse la visionneuse PDF
du navigateur s'afficher dans le document `blob:` ouvert dans un nouvel onglet, qui hérite de la CSP. Donc :

- **Ouvrir le PDF** : `window.open(blob:…)` dans un nouvel onglet (visionneuse du navigateur) ; l'URL d'objet est
  aléatoire (aucune donnée dans l'adresse) et libérée après 10 minutes. Navigateur qui bloque la fenêtre :
  téléchargement automatique, la pièce n'est jamais perdue.
- **Imprimer** : ouvre la visionneuse, d'où l'on imprime (Ctrl+P) ; l'écran le dit. Aucune impression silencieuse.
- **Télécharger** : lien `download`, nom sans donnée sensible (`facture-TEST-FAC-000001.pdf`,
  `prescription-optique-20261014.pdf`, jamais un nom de patient ni un numéro de dossier).

**Point à vérifier en navigateur réel** (vérification de fin de phase) : la visionneuse PDF de Chromium affiche le
`blob:` ouvert depuis la page avec `object-src blob:` (avant ce réglage, `object-src 'none'` l'aurait laissée vide).
Si elle restait vide malgré tout, le téléchargement reste le chemin garanti ; aucune autre source n'est ouverte.

## Données d'entrée et écarts avec les contrats du serveur

Les modèles lisent `documents/data/financial.ts` et `clinical.ts` (camelCase). Les adaptateurs
`receiptFromSnapshot`, `creditNoteFromSnapshot`, `refundFromSnapshot`, `invoiceFromResource`,
`statementRowsFromInvoices`, `prescriptionFromResource`, `prescriptionSummaryFromResource`,
`consultationEntryFromResource` et `clinicalPatientFromFields` sont les seuls à connaître la forme du serveur
(`ReceiptSnapshot`, `CreditNoteSnapshot`, `RefundSnapshot`, `Invoice`, `Prescription`, `Consultation` de
`domain/contracts/generated.ts`).

- **Facture** : la ressource `Invoice` porte désormais `patient_snapshot`, `clinic_snapshot`, `tax_snapshot`
  (null pour un brouillon, ajout de l'agent « facturation serveur »). Une facture émise est **toujours** produite de
  ses snapshots figés (ceux de l'appelant sont ignorés) ; un brouillon reçoit cabinet et patient courants. Tant que
  `generated.ts` n'est pas régénéré, l'adaptateur lit ces champs par intersection de types (`Invoice &
  FrozenSnapshots`).
- **Pas de snapshot « facture complète »** côté serveur (contrairement au reçu, à l'avoir et au remboursement) :
  les lignes viennent de la ressource, les trois snapshots de leurs colonnes.
- **Quantités** : le serveur renvoie `"1"` ou `"1.000"` ; les deux s'impriment « 1 ».
- **Types propres au poste** sans `generated_documents.document_type` : `MEDICATION_ORDER`, `REFERRAL_LETTER`,
  `CASH_SESSION_REPORT`. Décision à prendre (énumération serveur, ou rattachement au dossier clinique /
  à la session de caisse). Types serveur sans modèle ici : `WORKSHOP` (bon laboratoire, L1D04) et `LEGACY_BALANCE`.
- **`document_settings`** (JSON libre côté serveur) : clés lues par `readDocumentSettings` : `header_lines`,
  `footer_lines` (listes de textes, 6 × 200 caractères au plus) et `payment_terms` (texte, 1000 caractères). Les
  autres clés sont ignorées. À aligner avec la saisie des paramètres du cabinet.
- **Libellés** : unités et termes optiques = `database/02_reference_data.sql` (test d'égalité). Libellés des modes de
  règlement (« Mobile money MTN », « Orange Money », « Virement »…) : **propositions** d'affichage, absentes du
  référentiel.
- **Échelles d'acuité** : `visual_acuity_scales` n'est pas dans le référentiel du poste ; `defaultClinicalLabels().scale`
  rend null (« échelle non précisée ») ; l'écran de consultation passe les échelles lues sur le serveur
  (`clinicalLabelsWithScales`), sans conversion entre elles.

### Documents cliniques branchés sur les écrans (C04 + D02)

**Une seule source de vérité.** Les types d'entrée (`data/clinical.ts`) ne sont produits que par
`data/clinicalAdapters.ts`, qui lit EXACTEMENT les ressources générées : `Prescription`, `Consultation` (avec
`patient` et ses sept rubriques, dont `MEDICATIONS`) et la révision figée `ClinicalRevisionDetail`. L'ancien module
`domain/clinical/printModels.ts` (second « modèle d'impression » écrit par C04, en doublon) est **supprimé** ;
l'écran de lecture d'une prescription affiche `prescriptionScreenModel` (même adaptateur, mêmes libellés, mêmes
fonctions `formatDiopter` / `formatAxis` / `formatMillimeters` que le PDF). Les libellés imprimés viennent du
domaine clinique : termes (`domain/clinical/terms`, dont `OPTICAL_USAGE_LABELS`… désormais dérivés), stades de
réfraction, formes de médicament, unités de durée, urgences (`domain/clinical/labels`), corrections d'acuité
(`domain/clinical/acuity`) ; seuls contexte et distance d'acuité restent propres au document. Ajouts aux types :
`PrescriptionBody.pdInconsistencyReason` (imprimée « Justification de l'écart de DP »), `ConsultationEntryData`
`refractionObservations`, `ametropias`, `medications` (la fiche imprime le traitement, fichier 11).

| Document | Source | Proposé quand | Droit (`access.ts`) | Conservation (port `DocumentStore`, volatil) |
| --- | --- | --- | --- | --- |
| Fiche de consultation (`CLINICAL_RECORD`) | révision courante relue (`GET …/revisions/{n}`) + prescriptions VALIDÉES de la consultation | examen `COMPLETED`, hors correction | `clinical.export` | non : export daté (date et auteur de l'export imprimés) |
| Ordonnance (`MEDICATION_ORDER`) | rubrique `MEDICATIONS` de la révision relue | idem, et au moins un médicament | `clinical.read` | clé `medication_order:<revision_id>`, n° de révision, identifiant local stable |
| Lettre d'orientation (`REFERRAL_LETTER`) | conclusion de la révision relue | idem, et `referral = true` | `clinical.read` | clé `referral_letter:<revision_id>` |
| Prescription optique (`OPTICAL_PRESCRIPTION`) | ressource `Prescription` VALIDÉE (la plus récente) | écran « Prescription optique », lecture | `clinical.read` | clé du serveur `optical_prescription:<id>`, n° de version, `document_id` (= `generated_documents.id`) |

- Service : `app/services/clinicalDocuments.ts` (`consultationPrintables`, `consultationDocument`,
  `prescriptionDocument`, `printablePrescription`, `prescriptionScreenModel`). Droits vérifiés **avant** toute
  lecture, puis par `renderDocument`. Rien n'est jamais construit depuis la saisie affichée ni une copie
  ancienne : une révision lue qui ne correspond pas à l'examen affiché est refusée.
- Écrans : `pages/consultations/ConsultationDocuments.vue` (examen terminé), `ClinicalPrintActions.vue` (boutons
  d'aperçu, état, `DocumentPreview`), `useClinicalPrint.ts` (états, messages d'échec sans donnée). Aucune lecture
  avant le clic ; aucune route ajoutée (aucune donnée dans l'adresse) ; noms de fichier
  `ordonnance-AAAAMMJJ.pdf`, `lettre-orientation-…`, `dossier-clinique-…`, `prescription-optique-…`.
- **Brouillons** : le fichier 11 permet une prescription brouillon marquée BROUILLON (le moteur le sait faire) ;
  l'écran ne la propose PAS (« ne pas remettre au patient »), ni une consultation en cours. Si une nouvelle
  version est en cours de rédaction, la version validée précédente reste imprimable depuis la lecture de
  l'écran ; seule l'édition du brouillon masque le bouton.
- **Cabinet** : `currentDocumentClinic()` (`app/services/clinicIdentity.ts`, 2026-10-22) lit
  `GET /clinic/document-identity` (adresse, contacts, identifiant fiscal, mentions, en-tête et pied saisis par
  la gérante, lisible par tout profil qui produit un document) ; si la lecture échoue, seul le nom du cabinet
  de la session (`clinicFromSummary`) est repris, jamais un champ inventé. Document de TEST tant que
  `production_documents_enabled` est faux. Les pièces financières émises gardent l'identité figée de leur
  snapshot ; le relevé de caisse et les documents cliniques utilisent l'identité courante.
- **Nom du professionnel** : la révision porte le nom figé de son auteur (fiche, ordonnance, lettre). La
  prescription porte `validated_by` et `validated_by_name` : nom du compte connecté s'il l'a validée, sinon nom rendu par le serveur, sinon nom figé d'une
  révision de la consultation enregistrée par la même personne ; sinon **refus** explicite (« imprimez-la depuis
  son compte »). Écart à traiter côté serveur (voir plus bas).
- **Patient** : nom, prénoms, dossier figés dans la révision ; sexe et naissance (non figés) pris dans
  `Consultation.patient` seulement si c'est le même patient.

Usage typique d'un écran :

```ts
const model = buildDocument('OPTICAL_PRESCRIPTION', data)          // pur, peut lever DocumentDataError
const rendered = await renderDocument(model)                          // PDF local, droits vérifiés
// <DocumentPreview :document="rendered" heading="Prescription optique" />
const meta = await keepOriginal(rendered, { key, documentId, entityId }) // après le commit local
```

## Conservation : le port et le coffre

`DocumentStore` (`store/port.ts`) : `declare` (pièce en préparation), `put` (original, idempotent), `fail`,
`get` (empreinte vérifiée), `getMeta`, `list`, `markUploaded`, `remove`, `usage` (quota). Règles : l'original n'est
**jamais remplacé** (même clé + mêmes octets = rien ne change ; octets différents = `DOCUMENT_CONFLICT`) ; une pièce
non déposée sur le serveur ne se supprime pas ; le quota refuse sans évincer ; aucune métadonnée ne porte de nom,
de montant ou de contenu clinique.

Correspondance avec `vault.md` (O01) : compartiment = `documentCompartment(kind)` ; genre = `documentType` ;
identifiant = `documentId` (ULID de `generated_documents.id`, fourni par la commande locale) ; version =
`revisionNo`. Le coffre fournira `VaultDocumentStore` (sous `offline/`, tâches O01 à O05) et l'installera avec
`installDocumentStore(store, { persistent: true })`. **Tant que ce n'est pas fait, le magasin par défaut est en
mémoire** et `isDocumentStorePersistent()` rend faux : un écran ne doit jamais dire « enregistré sur ce poste ».
Rappel des états à afficher : `pending` (« PDF en préparation »), `ready`, `failed` (« PDF à régénérer »).

Parcours attendu des tâches suivantes (B04, O04, O05) : commit local de `IssueInvoice` / `RegisterPayment` +
`declare` → génération (`buildDocument` + `renderDocument`) → `put` → après ACK de la source, dépôt serveur
(`POST /documents/{id}/content`, côté serveur `StoreDocumentContent`, **non codé ici**) → `markUploaded`. Un échec
de génération ou d'impression → `fail` puis nouvelle génération avec les **mêmes** identifiants : jamais un
nouvel encaissement.

## Aperçu et accessibilité

Route `/documents/apercu` (« Aperçu des documents », données fictives), `meta.module = 'sales'` (module existant le
plus proche ; aucun nouveau code dans `Modules.php`), permissions = union de celles des documents. Les droits par
document sont revérifiés. Aucune entrée de menu (B02 n'est pas livrée). Le composant `DocumentPreview` est
réutilisable par les écrans réels (reçu après encaissement, prescription).

Accessibilité : région nommée par document, images (`role="img"`) nommées « Page k sur N », alternative textuelle
repliable par page (texte reconstitué du plan), boutons natifs de 44 px, annonces `role="status"` polies, aucune
information par la seule couleur (trait épais pour « test », pointillé pour « avertissement »), défilement
horizontal limité à la page dessinée (360 px), texte inséré comme texte (pas de `v-html`).

## Tests (écrits, non exécutés)

Vitest (`tests/frontend/documents/`) : `charset`, `format`, `layout` (découpe, pagination, en-tête répété, totaux,
lignes trop hautes, filigrane, ticket), `templates-financial`, `templates-credits`, `templates-clinical`, `adapters`
(fixtures de `contracts/fixtures`), `registry` (dont égalité avec `contracts/compatibility.json`), `store`, `pdf`
(**vrai jsPDF** : octets, reproductibilité, métadonnées, métriques, les 19 documents sans avertissement ni
débordement), `demo-documents` (mots interdits, séparation des mondes, montants à espaces insécables),
`access` (rôles du référentiel), `output`, `no-network`, `reference-labels` (égalité avec le SQL),
`preview-component`, `preview-page`, `service`, `golden/render-demo` (+ `golden/README.md`),
`clinical-print` (adaptateurs de la révision figée, une seule source de libellés, noms de fichier),
`clinical-service` (documents proposés selon état et droits, droits avant lecture, révision relue, conservation,
nom du professionnel jamais deviné, réimpression) ; écrans : `tests/frontend/consultations/consultation-documents.test.ts`.
Playwright : `tests/e2e/consultation.spec.ts` (« imprimer l'ordonnance et la prescription d'une consultation
terminée » : examen réel, finalisation, aperçu, téléchargement d'un vrai PDF au nom sans donnée, 360 px).
Playwright : `tests/e2e/documents.spec.ts` (génération sous la vraie CSP, téléchargement, réseau coupé, droits,
360 px).

Fichiers partagés touchés (modifications ciblées) : `app/router.ts` (route `documents-apercu`),
`tests/frontend/bootstrap.test.ts` (nombre de routes : 14 = 11 + C03 + C04 + D02),
`tests/e2e/prepare-env.mjs` (module `sales` ouvert en e2e), `contracts/compatibility.json` (`document_templates`).

## Vérification finale (à lancer)

1. `npm run typecheck` puis `npm run lint` puis `npx prettier --write resources/frontend/documents ...` (le code
   suit le style du dépôt mais n'a pas été passé au formateur) ; `npm run contracts:types` si l'agent facturation
   n'a pas régénéré `generated.ts`.
2. `npx vitest run tests/frontend/documents tests/frontend/architecture.test.ts tests/frontend/bootstrap.test.ts
   tests/frontend/contracts.test.ts` ; si un test de mise en page échoue, lire d'abord la section « Risques ».
3. Revue visuelle : `EEO_DOCUMENT_GOLDEN=render npx vitest run tests/frontend/documents/golden`, ouvrir
   `test-results/documents/index.html`, imprimer en A4 noir et blanc (liste de contrôle dans `golden/README.md`),
   puis `EEO_DOCUMENT_GOLDEN=update` pour figer les références. Fait le 2026-11-09 pour les 19 documents (revue de l'agent sur les pages rendues, résultat dans `golden/README.md`) ; l'impression réelle reste à faire.
4. `npm run build` : contrôler la taille du paquet jsPDF et les morceaux `canvg`, `html2canvas`, `dompurify`
   (dépendances optionnelles de jsPDF importées dynamiquement ; inutiles ici, ils seront précachés). Si le poids est
   gênant, un alias vers un module vide dans `vite.config.ts` les écarte.
5. `npm run test:e2e:run -- documents` (contrôle de la CSP et de l'ouverture de `blob:` en vrai Chromium).

## Risques à regarder en premier

- Mise en page écrite à l'aveugle : coupures de lignes aux limites (`wrap`), `keepLastRows` + totaux, découpe de
  ligne trop haute, saut de page des groupes (`snapshot` / `restore`). Les tests de `layout.test.ts` bornent ces
  cas avec une mesure déterministe.
- Types : `tsconfig` strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), union de tuples de
  `generated.ts` appelée avec `.map` (adaptateurs cliniques), `Invoice & FrozenSnapshots`.
- jsPDF : `setFileId`, `setCreationDate` (format `D:AAAAMMJJhhmmss+00'00'`), `floatPrecision`, `addPage([w, h])`,
  `getStringUnitWidth(…, { doKerning: false })` ont été lus dans la source mais jamais exécutés dans ce moteur.
- Les assertions de textes joints par « | » (`Libellé | valeur`) supposent qu'un libellé et sa valeur tiennent sur
  une ligne : un libellé trop long pour sa colonne se replie et ferait échouer l'assertion (corriger le gabarit, pas
  le test).

## Non codé / reste à faire

- Conservation chiffrée réelle (`VaultDocumentStore`), dépôt serveur du PDF (`StoreDocumentContent`, téléchargement
  soumis à Policy) : O01 à O05, B04. **Aucune route** ne marque une ligne `generated_documents` comme générée ou
  déposée (`READY`, `file_id`, `sha256`, `generated_at`) : la ligne `PENDING` écrite par la validation d'une
  prescription le reste ; rien n'est inventé côté poste.
- Écarts du schéma (non modifié sans décision) : `MEDICATION_ORDER` et `REFERRAL_LETTER` n'ont pas de
  `document_type` serveur : générés localement, sans ligne `generated_documents`. Le nom du professionnel qui a
  validé une prescription est rendu par le serveur (`validated_by_name`, 2026-10-22) : nom d'affichage
  courant du compte, pas un nom figé (le schéma n'a pas de colonne pour cela) ; le PDF original reste figé.
- Export de l'historique clinique (sélection `HISTORY`, plusieurs révisions) : modèle prêt, aucun écran ;
  lettre d'orientation avec destinataire et mesures choisies : aucun champ de saisie (le document imprime
  « Confrère ophtalmologiste » et aucune mesure).
- Attestation de solde / facture acquittée complémentaire (fichier 11), bon laboratoire (L1D04), QR signé du reçu
  (fichier 19, clés de poste O02), logo réel du cabinet (aucun fichier fourni), mentions légales et fiscales réelles
  (Q03), validation du format ticket sur l'imprimante réelle (Q02).
- Étiquettes : le fichier 11 n'en prévoit pas, aucun gabarit n'est livré.
- Impression intégrée sans visionneuse (voir CSP) ; impression silencieuse non prévue.
- Polices Unicode embarquées (voir `fonts/README.md`).

## Conservation des originaux sur le serveur (D01, 2026-10-23)

- `POST /api/v1/documents/{id}/content` (`StoreDocumentContent`, corps `application/pdf`, en-tête facultatif
  `X-Content-Sha256`) : le contrôleur vérifie la Policy de la famille (`App\Domain\Documents\DocumentPolicy` :
  pièce financière avec `invoice.issue` ou `payment.collect`, document clinique avec `clinical.complete`), le
  module de la famille (`sales` ou `consultations`, 404 sinon), la signature « %PDF- », la taille
  (`EEO_DOCUMENT_MAX_BYTES`, 5 Mo) et l'empreinte ; il écrit le fichier sur le disque PRIVÉ `local`
  (`documents/<cabinet>/<document>-<empreinte>.pdf`, adressé par le contenu, aucune donnée personnelle), puis la
  commande centrale rattache le fichier (`stored_files`, classement FINANCIAL ou MEDICAL) et passe le document
  de PENDING (ou FAILED) à READY. Un READY ne se remplace jamais : même contenu = reconnu sans écriture, autre
  contenu = 409. Audit `document.stored` sans contenu.
- `GET /api/v1/documents/{id}/download` : l'original READY (empreinte revérifiée), `application/pdf`, sans cache,
  nom `document-<type>-<AAAAMMJJ>.pdf` ; pièce financière avec `invoice.read`, document clinique avec
  `clinical.export` (téléchargement tracé `document.downloaded`).
- Poste : `depositOriginal` (`app/services/documents.ts`) part en arrière-plan dès que l'original est conservé
  dans le magasin du poste (reçu, facture, avoir, remboursement, ordonnance validée), clé d'idempotence liée au
  document et au contenu, `markUploaded` après confirmation ; sans réponse, rien n'est conclu (redépôt à la
  prochaine impression). Un fichier écrit mais non rattaché (commande refusée) reste orphelin, sans métadonnées.
- Reste : réimpression depuis l'original du serveur quand le magasin du poste l'a perdu (le PDF est aujourd'hui
  régénéré, identique par construction), purge des fichiers orphelins, chiffrement au repos (`encryption_key_id`).
- Tests écrits : `tests/Feature/Documents/DocumentContentTest.php`, `tests/frontend/documents/deposit-original.test.ts`.

## Logo de la marque sur les documents (2026-10-23)

Le logo complet de la marque (aigle et « EAGLE’S EYE OPTICS — SEE BEYOND »), tiré du logo vectoriel fourni par le
demandeur sans le cadre ni les coordonnées de l'original, est rendu en PNG pour l'en-tête des PDF
(`resources/frontend/assets/brand/eeo-logo-document.png`, 301 × 330 px, fond blanc pour l'impression en noir et
blanc, environ 20 × 22 mm à l'impression). `app/services/brandLogo.ts` le lit une fois par session (fichier haché
et précaché par le service worker : il s'imprime hors ligne) et le passe aux documents cliniques
(`currentDocumentClinic`), au relevé de caisse et aux pièces financières (adaptateurs `*FromSnapshot`,
`invoiceFromResource`). S'il ne se lit pas, le document s'imprime sans logo. Les coordonnées du cabinet restent
celles des paramètres de la gérante, jamais celles du logo d'origine.


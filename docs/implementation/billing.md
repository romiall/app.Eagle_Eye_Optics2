# Ventes, caisse et stock côté serveur (B01, B02, I00, B03, B05, B04)

État : **codé, non exécuté**. Aucun test PHPUnit, Vitest ou Playwright n'a été lancé pour ces tâches ; les tests
listés en fin de document sont écrits et restent à exécuter à la vérification finale. Ce document décrit le cœur
serveur EN LIGNE de la facturation (premier jalon) : aucun écran, aucun moteur PDF, aucune commande de poste
hors-ligne. Toutes les données de démonstration et de test sont fictives ; aucun prix, taux de taxe, préfixe de
numérotation ni identité légale réels n'est fixé ici (Q03, Q04, Q05 du fichier 15).

Sources : fichiers 03 (finance, stock), 08 (API), 09 (droits), 11 (impressions), 19 (hors-ligne), 21 (invariants),
23 (contrats d'ingénierie), 24 (fiches B01–B05, I00). Ordre suivi : B01 → B02 → I00 → B03 → B05 → B04.

## Routes et commandes

Toutes les routes sont derrière leur module (`module:sales` ou `module:stock`), **fermé par défaut** : tant que
`EEO_ENABLED_MODULES` ne contient pas le code, chaque route répond 404. Toute écriture passe par le chemin central
(`CommandBus` → `TransactionRunner` → action), avec en-tête `Idempotency-Key` obligatoire. Les permissions des
routes sont celles du contrat (`x-permission`, vérifiées par `tests/Contracts/OpenApiRoutesTest.php`).

| Route | Commande (action) | Permission (route) | Réauth. | Tâche |
| --- | --- | --- | --- | --- |
| `GET /api/v1/catalog` | lecture (`CatalogSearch`) | `catalog.read` | | B01 |
| `POST /api/v1/catalog/items` | `CreateCatalogItem` | `catalog.manage` | | B01 |
| `PATCH /api/v1/catalog/items/{id}` | `UpdateCatalogItem` | `catalog.manage` | | B01 |
| `GET /api/v1/tax-rules` | lecture | `catalog.manage` | | B01 |
| `POST /api/v1/tax-rules` | `CreateTaxRule` | `catalog.manage` | oui | B01 |
| `PATCH /api/v1/tax-rules/{id}` | `UpdateTaxRule` | `catalog.manage` | oui | B01 |
| `GET /api/v1/invoices`, `GET /api/v1/invoices/{id}` | lecture (`InvoiceReader`) | `invoice.read` | | B02–B04 |
| `POST /api/v1/invoices` | `CreateInvoiceDraft` | `invoice.create` ou `exam_fee.collect` | | B02 |
| `PATCH /api/v1/invoices/{id}` | `UpdateDraft` | `invoice.create` ou `exam_fee.collect` | | B02 |
| `POST /api/v1/invoices/{id}/issue` | `IssueInvoice` | `invoice.issue` ou `exam_fee.collect` | | B03 |
| `POST /api/v1/invoices/{id}/payments` | `RegisterPayment` | `payment.collect` ou `exam_fee.collect` | | B04 |
| `GET /api/v1/receipts/{id}` | lecture | `invoice.read` | | B04 |
| `GET /api/v1/cash-registers` | lecture | `cash.own_session` | | B05 |
| `GET /api/v1/cash-sessions/current` | lecture (session ouverte du compte, ou `null`) | `cash.own_session` | | B05 |
| `POST /api/v1/cash-sessions` | `OpenCashSession` | `cash.own_session` | | B05 |
| `POST /api/v1/cash-sessions/{id}/close` | `CloseCashSession` | `cash.own_session` (autre caissière : `cash.manage`) | | B05 |
| `GET /api/v1/stock/availability` | lecture (`StockAvailabilityReader`) | `stock.read` | | I00 |
| `POST /api/v1/stock/opening` | `RegisterOpeningStock` | `stock.adjust` (+ gérante : `approval.decide`) | oui | I00 |
| `POST /api/v1/payments/{id}/reversals` | `ReversePayment` | `payment.reverse` | oui | B07 |
| `POST /api/v1/invoices/{id}/credit-notes` | `IssueCreditNote` | `credit_note.issue` | oui | B07 |
| `POST /api/v1/invoices/{id}/refunds` | `RefundCredit` | `refund.execute` | oui | B08 |
| `GET /api/v1/approvals`, `GET /api/v1/approvals/{id}` | lecture (`ApprovalReader`) | `approval.request` ou `approval.decide` | | B06 |
| `POST /api/v1/approvals` | `RequestApproval` | `approval.request` | | B06 |
| `POST /api/v1/approvals/{id}/decision` | `DecideApproval` | `approval.decide` | oui | B06 |

Les quatre routes d'approbation sont dans le module **`settings`** (gestion gérante, fichier 04 ; écran
`/parametres/approbations`) : fermé, elles répondent 404, et seules les exécutions directes de la gérante restent
possibles. Les trois corrections sont dans le module `sales`.

Noms de routes Laravel : `api.catalog.*`, `api.tax-rules.*`, `api.invoices.*`, `api.receipts.show`,
`api.cash-registers.index`, `api.cash-sessions.*`, `api.stock.*`. La réserve de stock n'a **pas** de route : c'est un
service interne de l'émission (I00).

Commandes de console (exploitant) :

| Commande | Rôle |
| --- | --- |
| `php artisan eeo:sales:bootstrap` | Crée la caisse principale `CAISSE-PRINCIPALE` et l'emplacement `PRINCIPAL` du cabinet servi, une fois, de façon idempotente ; ne crée ni prix, ni taxe, ni catalogue, ni stock. Refuse de recréer en silence une caisse désactivée. |
| `php artisan eeo:demo:sales` | Jeu FICTIF (taxe `TEST_TAXE_FICTIVE`, articles `DEMO-EXAMEN`, `DEMO-MONTURE`, `DEMO-VERRES`, `DEMO-COLLYRE`, stock initial) par le chemin central au nom de `demo.gerante` ; environnements `local`, `testing`, `e2e`, `demo` et cabinet « DONNÉES FICTIVES » seulement, jamais en production. Relançable sans doublon. |

## Code par domaine

| Domaine | Fichiers |
| --- | --- |
| Catalogue, taxes (B01) | `app/Domain/Billing/Catalog/` (`CatalogSearch`, `CatalogLookups`, `CatalogSnapshot`, `TaxRegime`, `Rules/CatalogItemInput`, `Rules/TaxRuleInput`, `Handlers/*`) ; `CatalogController`, `TaxRuleController`, `CatalogPresenter` |
| Brouillon (B02) | `InvoiceDrafts`, `Rules/DraftLine`, `Rules/DraftLines`, `Rules/DraftPolicy`, `Rules/DiscountPolicy`, `Rules/FieldErrors`, `Handlers/CreateInvoiceDraftHandler`, `Handlers/UpdateDraftHandler` |
| Émission (B03) | `Handlers/IssueInvoiceHandler`, `Numbering/BillingNumbers`, `Numbering/NumberUsages`, `Snapshots/InvoiceSnapshots`, `Documents/PendingDocuments`, `InvoiceLedger` |
| Encaissement (B04) | `Handlers/RegisterPaymentHandler`, `Rules/PaymentRules`, `Rules/Settlement`, `ExamFeeScope`, `ExamFeeWaiver`, `BilledExamFeeControl`, `ReceiptController` |
| Caisse (B05) | `app/Domain/Cash/` (`CashSessions`, `Rules/CashClosing`, `Handlers/*`), `CashSessionController`, `CashPresenter`, `Billing/Setup/SalesBootstrap` |
| Stock (I00) | `app/Domain/Inventory/` (`ReservationService`, `Rules/ReservationPlanner`, `StockAvailabilityReader`, `Handlers/RegisterOpeningStockHandler`), `StockController`, `StockPresenter`, `app/Domain/Shared/DirectApproval` |
| Commun | `BillingErrors`, `Guards/ActorRights`, `Guards/CentralOnly`, `BillingCommands`, `CashCommands`, `InventoryCommands`, `DocumentNumbers::allocateCentral` (instant et rendu injectables) |

Chaque action est une fonction de domaine unique (`handle(Command, CommandContext, TransactionLocks, ?idempotence)`) :
la route directe l'appelle aujourd'hui ; la synchronisation (O03–O05) et les tâches l'appelleront demain sans
dupliquer la logique. Les règles pures (`*/Rules`) n'utilisent ni base, ni flottant, ni `sprintf`.

## Contrats des ressources (pour D01 et les écrans)

Schémas : `contracts/schemas/resources/billing.json` et `stock.json` ; types TypeScript dans
`resources/frontend/domain/contracts/generated.ts` (`npm run contracts:types`).

- **`Invoice`** (`InvoiceResponse`) : `status` ∈ `DRAFT`, `ISSUED`, `ABANDONED` ; **aucun statut « payé »**.
  `draft_version` = `invoices.version`, figée à l'émission ; `ledger_version` = projection financière (1 à
  l'émission, +1 par paiement confirmé, contre-écriture, avoir, remboursement), `null` pour un brouillon.
  `balance` (`InvoiceBalance`) : `total_gross`, `paid_net`, `credited`, `refunded`, `balance_due`, `credit_available`,
  `settlement` ∈ `NOT_ISSUED`, `UNPAID`, `PARTIALLY_PAID`, `SETTLED`, `IN_CREDIT`. `SETTLED` dit « solde nul », pas
  « payé par le client » : un écran qui écrit « payé » s'appuie sur `paid_net` et les reçus. `patient_snapshot`,
  `clinic_snapshot`, `tax_snapshot` sont `null` pour un brouillon et figés pour une facture émise
  (`contracts/snapshots/invoice-*.json`) : ce sont eux, jamais l'identité ni les prix actuels, qui s'impriment.
  `clinic_snapshot.test_document` est vrai tant que les DEUX interrupteurs (cabinet `production_documents_enabled`
  ET `PRODUCTION_DOCUMENTS_ENABLED`) ne sont pas levés. `document` = `{document_id, document_status}` du PDF de la
  facture (`PENDING` dès l'émission), `write_owner` = poste qui détient la facture (sinon `null`).
- **`PaymentResult`** (`PaymentResultResponse`, réponse 201 de l'encaissement, rejouée telle quelle par la même clé) :
  `payment_id`, `receipt_id`, `receipt_number` (définitif, jamais renuméroté), `amount`, `method`, `effective_at`
  (date de l'encaissement), `recorded_at` (instant du serveur), `ledger_version`, `balance`, `receipt_document`.
- **`Receipt`** (`ReceiptResponse`) : `number`, `issued_at`, `issued_by`, `snapshot` (`contracts/snapshots/receipt.json` :
  facture, patient figé, paiement, `paid_net_before`, `paid_net_after`, `balance_after`, `kind` ∈ `DEPOSIT`,
  `BALANCE_SETTLEMENT` CALCULÉ, caissière, cabinet, `template_version`) et `document`. Le reçu est la source de son PDF.
- **`CashSession`** : `collected_cash`, `refunded_cash`, `theoretical_cash` sont des projections recalculées à chaque
  lecture ; `expected_amount`, `counted_amount`, `variance`, `variance_reason` ne sont renseignés qu'à la clôture
  (photographie figée). `CurrentCashSessionResponse.data` vaut `null` sans session ouverte.
- **`StockAvailability`** : `on_hand`, `reserved`, `offline_allocated`, `central_available` en chaînes décimales
  exactes, lots par expiration la plus proche ; aucun coût d'achat ni valorisation.

## Convention des modèles de documents

Décision du coordinateur : l'identifiant d'un modèle de document suit le motif **`<type>.v<n>`**, écrit dans
`generated_documents.template_version` et dans le `template_version` des snapshots. Valeurs actuelles :
`invoice.v1` (facture) et `receipt.v1` (reçu), déjà acceptées par le registre du moteur PDF
(`resources/frontend/documents/templates/registry.ts`). Le même motif servira pour l'avoir (`credit_note.v1`), le
remboursement (`refund.v1`), le devis (`quote.v1`) et le relevé de caisse (`cash_session_report.v1`) quand ces pièces
seront émises. Une nouvelle mise en page ou de nouvelles mentions donnent `v2` ; un document déjà généré n'est jamais
régénéré sous une autre version (la réimpression rouvre l'original).

Le serveur ne produit aucun PDF : l'émission et l'encaissement déclarent seulement, dans leur transaction, la ligne
`generated_documents` `PENDING` (`PendingDocuments`), complétée après le commit par le moteur de documents (D01). Un
document `PENDING` n'autorise jamais à répéter l'opération : la pièce et son numéro existent déjà.

Écart relevé par le moteur, non corrigé ici (pas de modification du schéma) : les types `MEDICATION_ORDER`,
`REFERRAL_LETTER` et `CASH_SESSION_REPORT` n'existent pas dans `generated_documents.document_type`
(`INVOICE`, `RECEIPT`, `CREDIT_NOTE`, `REFUND`, `OPTICAL_PRESCRIPTION`, `CLINICAL_RECORD`, `WORKSHOP`,
`ACCOUNT_STATEMENT`, `LEGACY_BALANCE`, `QUOTE`). À trancher dans `database/tools/model_definition.py` avant de
déclarer ces documents côté serveur.

## Règles appliquées

**Calcul partagé.** Brut de ligne, remise, net et taxe comprise ventilée viennent de `LineAmounts` (mêmes vecteurs que
le client) ; le serveur recalcule toujours et refuse un total transmis différent (`expected_total` dans `details`).

**Droits sur une ligne (B02).** Le prix du catalogue s'impose à qui n'a pas l'autorité de prix (`catalog.manage`) ;
une ligne libre (sans article) et une remise sont réservées à la gérante, sauf plafond configuré
(`EEO_DISCOUNT_CAP_PERCENT`, **0 par défaut**). Un refus de droit répond `APPROVAL_REQUIRED_OR_EXPIRED` (l'approbation
exacte viendra avec B06). Le profil « frais d'examen » (`exam_fee.collect` sans la permission générale) ne crée,
n'émet et n'encaisse que des factures dont toutes les lignes sont l'article désigné par
`EEO_EXAM_FEE_ITEM_REFERENCE` ; non configuré, il ne peut rien facturer.

**Numérotation (B03, B04).** Format proposé `<préfixe>-AAAA-NNNNNN`, série par cabinet, par type et par année civile
**au fuseau du cabinet**. Préfixes `TEST-FAC`, `TEST-REC`, `TEST-AV`, `TEST-RMB` tant que les séries papier ne sont pas
choisies (Q03, Q05) : tout numéro émis est visiblement un numéro de test. Le numéro est pris sous le verrou du cabinet
puis de la série, enregistré dans `document_number_usages` dans la même transaction que la pièce : un échec plus loin
(stock, montant, version) annule aussi le numéro, donc **aucun trou**, jamais de `MAX + 1`.

**Émission (B03).** Ordre imposé par les triggers : lignes recalculées et figées, réserves, usage du numéro, document
`PENDING`, puis UNE mise à jour `DRAFT` → `ISSUED` avec les snapshots. Ensuite la facture et ses lignes ne se
modifient plus (`Finalized record is immutable`, `Issued or finalized parent: child is immutable`). Refus :
`STATE_TRANSITION_REFUSED` (déjà émise), `VERSION_CONFLICT` (brouillon modifié), `WRITE_OWNER_REQUIRED` (un poste
détient la facture), 422 pour une ligne absente, un dossier fusionné, un `issued_at` dans le futur, un champ que la
route directe ne laisse pas au client (`number`, `write_owner_id`, `reservations`) ou, pour un document de production,
une ligne sans règle fiscale validée. Aucune taxe n'est inventée : sans règle active ET validée, le régime figé est
`NO_TAX_CONFIGURED`.

**Encaissement (B04).** Paiement écrit `CONFIRMED`, puis son reçu numéroté (jamais de reçu sans paiement confirmé,
jamais de paiement sans reçu), puis le document `PENDING` ; la facture émise n'est jamais mise à jour. Ordre des
refus : poste propriétaire, facture non émise, **montant au-delà du reste dû** (`PAYMENT_EXCEEDS_BALANCE` avec
`amount_due` et `current_version` : AT12, le second règlement de 40 000 sur 50 000 apprend qu'il reste 10 000), version
périmée (`VERSION_CONFLICT` avec `current_version` et `amount_due`). Espèces : session ouverte de l'auteur, antérieure
à l'encaissement ; autres modes : aucune session. Référence obligatoire pour `MTN_MOMO`, `ORANGE_MONEY`,
`BANK_TRANSFER` (paramétrable). Un encaissement daté d'un jour civil antérieur exige un motif, conservé dans l'audit.
L'encaissement est un fait constaté par un opérateur : aucune vérification d'opérateur télécom en L0. À l'écran,
tant que la session de caisse du compte n'est pas lue (lecture en cours ou sans réponse exploitable), rien n'est
conclu : « Lecture de la session de caisse… » ou « Session de caisse non vérifiée » (avec relecture), jamais « Caisse
non ouverte », et aucun encaissement en espèces n'est envoyé.

**Caisse (B05).** Une session ouverte par caisse ET par caissière ; fond ≥ 0 ; dates du serveur. À la clôture,
l'attendu est recalculé sous verrou (fond + espèces encaissées − contre-écritures − remboursements espèces +
mouvements) : s'il a changé depuis l'affichage, `VERSION_CONFLICT` avec le nouvel `expected_amount`. L'écart non nul
exige un motif. Une session close est figée par le schéma ; la gérante (`cash.manage`) clôture celle d'une autre.

**Stock (I00).** Réserve centrale à l'émission : positions par identifiant, lots par expiration la plus proche (FEFO),
péremption jugée à la date LOCALE de l'émission (un lot du jour reste vendable), lot en quarantaine jamais réservé.
`reserved` augmente, le physique ne bouge pas (seule la remise sortira l'article). Toutes les lignes sont planifiées
avant la première écriture : pas de réserve partielle, `STOCK_UNAVAILABLE` (409, `available`) ou `LOT_EXPIRED` (422)
désigne la ligne. Idempotente par ligne ; `releaseForInvoice` rend le disponible ; `reserveUnderQuota` (O05) reste dans
le quota du poste et n'est jamais soustraite deux fois du central. Stock initial : un mouvement `OPENING` par ligne,
positions et lots créés dans la même transaction, approbation directe de la gérante (`DirectApproval`, écrite
consommée, liée au contenu exact) ; coût inconnu conservé `null`, jamais 0 ; un seul stock initial par article et
emplacement.

## Verrous

Ordre du contrat 23 (`LockRank`, inchangé) : cabinet (10), idempotence (30), séquences (40), dossier patient (45),
visite (46), propriété de facture (50), facture (60), session de caisse (70), positions (80), lots (81), quotas (82),
approbation (90). Le chemin central prend toujours le cabinet puis la clé d'idempotence (30) ; ensuite, brouillon : 45, 46, 60. Émission : 40, 45, 50, 60, 80, 81. Encaissement : 40, 50, 60, 70. Caisse : 70. Stock initial : 80
(positions déjà existantes). Aucun rang n'a été ajouté ni déplacé.

## Hors-ligne et chemin central

Premier jalon EN LIGNE : `CentralOnly` refuse toute source autre que la route directe (synchronisation, tâche) pour le
brouillon, l'émission, l'encaissement et la caisse, avec un message explicite (« hors-ligne ») ; le catalogue, les
règles fiscales et le stock initial ne sont déclarés que pour la route directe. Les
plages de numéros des postes (O03), les commandes signées et les quotas (O04, O05) brancheront les mêmes actions ; le
service de réserve expose déjà `reserveUnderQuota`. Rien de ce qui est décrit ici n'est « hors-ligne ».

## Activer le contrôle du paiement de l'examen

`EEO_EXAM_FEE_CONTROL=off` (défaut) garde `UncontrolledExamFee` : le démarrage d'une consultation reste « non
contrôlé » et le dit dans l'audit, sans aucun changement du jalon clinique. `EEO_EXAM_FEE_CONTROL=billed` (avec
`EEO_EXAM_FEE_ITEM_REFERENCE` = référence de l'article des frais d'examen) branche `BilledExamFeeControl` ; toute autre
valeur reste inactive (échec fermé). Une fois actif :

- `StartConsultation` répond 422 `EXAM_PAYMENT_REQUIRED` tant que la facture de frais d'examen de CETTE visite (même
  patient, émise, contenant l'article configuré) n'est pas réglée : reste dû nul ET part non créditée de la facture
  entièrement couverte par l'encaissé net conservé (paiements − contre-écritures − remboursements ;
  `BilledExamFeeControl::settledByMoney`, B07/B08). Le paiement d'une monture, d'une autre visite ou d'un autre patient
  ne prouve rien ; un paiement partiel, contre-passé, ou une facture créditée puis remboursée non plus.
- La preuve retenue est consignée sur la visite (`visits.exam_invoice_id`) ; l'audit `consultation.started` porte
  `PAID` ou `WAIVED`.
- Dérogation : approbation `APPROVED`, décidée, non expirée, non consommée, `action_code = exam_fee.collect`,
  `target_type = visits`, `target_id` = la visite, `payload_hash = ExamFeeWaiver::payloadHash(visite, patient)` ;
  consommée dans la transaction du démarrage (`visits.exam_waiver_approval_id`). Invalide : 422
  `APPROVAL_REQUIRED_OR_EXPIRED`. Demande et décision : B06 (section « Approbations exactes » ci-dessous).
- File du jour et statuts de la visite : section « Contrôle du paiement de l'examen dans la file du jour (P03) »
  ci-dessous (fait).

## Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `EEO_ENABLED_MODULES` | vide | Ajouter `sales`, `stock` pour ouvrir les routes |
| `EEO_EXAM_FEE_CONTROL` | `off` | `billed` active le contrôle réel du paiement de l'examen |
| `EEO_EXAM_FEE_ITEM_REFERENCE` | vide | Référence catalogue de l'article des frais d'examen (Q04) |
| `EEO_DISCOUNT_CAP_PERCENT` | `0` | Plafond de remise sans autorité de prix |
| `EEO_PAYMENT_REFERENCE_REQUIRED` | `MTN_MOMO,ORANGE_MONEY,BANK_TRANSFER` | Modes dont la référence est obligatoire |
| `EEO_NUMBER_WIDTH`, `EEO_NUMBER_PREFIX_*` | `6`, `TEST-FAC`, `TEST-REC`, `TEST-AV`, `TEST-RMB` | Format des numéros (à valider, Q03/Q05) |
| `EEO_APPROVAL_TTL_MINUTES` | `60` | Validité d'une approbation accordée (1 à 1440 min ; proposition, Q07) |

## Hypothèses et points ouverts

- Aucune commande d'abandon de brouillon (`ABANDONED`) n'est codée ; `releaseForInvoice` est prêt pour elle.
- Le seuil d'un encaissement « rétroactif » est le jour civil du cabinet (aucune tolérance donnée par les sources).
- Les versions de modèle `invoice.v1` / `receipt.v1` suivent la convention ci-dessus ; les mentions légales restent
  celles du document TEST.
- Le changement de stock (`stock_positions`) est publié dans le journal des changements par le stock initial, pas
  encore par la réserve à l'émission (la facture l'est) : à compléter avec le pull du stock (O05).
- L'empreinte du catalogue (`CatalogSnapshot`) relit le catalogue actif à chaque émission : acceptable pour un petit
  catalogue, à indexer si le catalogue grossit.

## Tests écrits (non exécutés)

Unitaires (`tests/Unit/Billing/`) : `DraftLinesTest`, `DiscountPolicyTest`, `SettlementTest`, `PaymentRulesTest`,
`CashClosingTest`, `BillingNumbersTest`, `ReservationPlannerTest`, `CatalogRulesTest`.

Fonctionnels sur MySQL (`tests/Feature/Billing/`) : `CatalogTest`, `TaxRulesTest`, `InvoiceDraftTest`,
`IssueInvoiceTest`, `RegisterPaymentTest`, `InvoiceReadTest`, `CashSessionTest`, `ImmutabilityGuardsTest`,
`ReservationServiceTest`, `OpeningStockTest`, `StockAvailabilityTest`, `BilledExamFeeControlTest`,
`BillingRoutesGateTest`, `SalesCommandsTest` (fixtures : `tests/Support/BillingFixtures.php`).

Concurrence entre connexions MySQL réelles (`tests/Concurrency/BillingConcurrencyTest.php`, base jetable
`eeo_conc_billing_test`, outils `tests/Concurrency/Support/ScenarioHarness.php`) : AT12 (40 000 + 40 000 sur 50 000),
double clic de même clé, deux encaissements de même version, encaissement espèces contre clôture, double émission,
cinq émissions consécutives, dernière unité de stock, deux ouvertures de session sur la même caisse.

## Approbations exactes (B06)

État : **codé, non exécuté**. Fichiers : `app/Domain/Access/Approvals/` (`ApprovalKind`, `ApprovalSubject`,
`ExactApprovals`, `ApprovalTargets`, `ApprovalReader`, `ApprovalCommands`), `app/Domain/Access/Handlers/`
(`RequestApprovalHandler`, `DecideApprovalHandler`), `ApprovalController`, `ApprovalPresenter`. Les fichiers attendus
par la fiche (`app/Domain/Access/RequestApproval.php`, `DecideApproval.php`) suivent la convention du code
(`Handlers/*Handler.php`), comme pour les autres commandes.

**Une approbation = une opération précise.** Natures (`ApprovalKind`) : chacune fixe le code d'action (la permission
qu'elle remplace) et la cible.

| Nature | `action_code` | Cible | Contenu exact lié par l'empreinte | Consommée par |
| --- | --- | --- | --- | --- |
| `EXAM_FEE_WAIVER` | `exam_fee.collect` | `visits` | visite, patient (= `ExamFeeWaiver::payloadHash`) | `StartConsultation` |
| `DRAFT_LINE_RIGHTS` | `catalog.manage` | `invoices` | facture, patient, TOUTES les lignes (position, article, désignation, quantité, prix, remise, prescription ; sans identifiant de ligne) | `CreateInvoiceDraft`, `UpdateDraft` |
| `PAYMENT_REVERSAL` | `payment.reverse` | `payments` | facture, paiement, montant | `ReversePayment` |
| `CREDIT_NOTE` | `credit_note.issue` | `invoices` | facture, montant, lignes (ligne d'origine, quantité, montant) triées | `IssueCreditNote` |
| `REFUND` | `refund.execute` | `invoices` | facture, avoir, montant, mode | `RefundCredit` |

Le stock initial reste une exécution directe de la gérante (`DirectApproval`) : le fichier 09 ne prévoit pas de demande
pour lui (« Ajuster stock : caissière, demande seulement » vise les sorties hors vente, `RegisterStockMovement`, non
codé).

**Demande** (`POST /approvals`, `approval.request`) : la charge porte le CONTENU exact (`subject`), jamais l'empreinte
ni la cible : le serveur en dérive `action_code`, `target_type`, `target_id` et `payload_hash = SHA-256(JSON canonique)`
(contrat `RequestApproval` modifié en conséquence : `payload_hash`, `action_code`, `target_type`, `target_id` retirés,
`subject` ajouté, fixtures mises à jour). La cible est vérifiée et verrouillée (`ApprovalTargets` : visite d'examen non
démarrée et frais non encore encaissés, contrôle actif ; brouillon du même patient ou identifiant libre ; paiement
confirmé et montant ≤ part non contre-passée ; facture émise et montants ≤ créditable / crédit). Motif obligatoire
(3 à 1000 caractères) ; échéance proposée facultative, dans le futur. Une demande identique en attente ou accordée :
409 `STATE_TRANSITION_REFUSED`. Le contenu est conservé dans l'audit `approval.requested` (aucune colonne ne le porte) et
relu par l'écran de la gérante **après revérification contre l'empreinte** (`ApprovalSubject::verified` ; null sinon).

**Décision** (`POST /approvals/{id}/decision`, `approval.decide` + réauthentification récente) : seulement une demande
en attente et non échue (409 avec le statut effectif) ; jamais par la personne qui l'a demandée (403 : la gérante qui
veut agir exécute directement) ; la gérante doit aussi détenir `action_code` (403 : prix, examen, correction, avoir et
remboursement restent des droits distincts) ; refus motivé obligatoire (422), motif rendu à la demandeuse. Accord :
échéance = la plus proche de celle proposée et de « décision + `EEO_APPROVAL_TTL_MINUTES` » (60 par défaut). Audit
`approval.decided`. Une dispense accordée passe la visite `READY_FOR_EXAM`.

**Consommation** (`ExactApprovals`), dans la transaction de l'opération, au rang de verrou « approbation » (90, le
dernier) : statut `APPROVED`, décidée, non échue à l'instant du serveur, non consommée, même action, même cible, même
empreinte → `CONSUMED`. Un refus plus loin dans la commande annule aussi la consommation (l'approbation reste
utilisable) ; un succès la brûle. Trois modes :

- **désignée** (`approval_id` de la commande) : contre-écriture, avoir, remboursement ; un identifiant inconnu dont
  l'auteur est la gérante (`approval.decide` ET `action_code`) devient une **exécution directe** : autorisation écrite
  décidée et consommée sous CET identifiant (`DirectApproval::record(..., $id)`), liée à la même empreinte ;
- **désignée facultative** (`exam_waiver_approval_id` de `StartConsultation`) ;
- **implicite**, par le contenu exact : la dispense d'examen quand aucune n'est désignée, et les droits d'un brouillon
  (seulement les approbations demandées par l'auteur du brouillon). `InvoiceDrafts::validated()` reçoit pour cela un
  rappel facultatif appelé seulement en cas de dépassement de droits ; sans approbation : 422
  `APPROVAL_REQUIRED_OR_EXPIRED` comme avant. L'audit du brouillon porte `rights_approval_id`.

Le statut `EXPIRED` n'est jamais écrit (aucune tâche planifiée) : `effective_status` le calcule à la lecture, et une
approbation échue ne redevient jamais valable. Lecture : la gérante voit toutes les demandes du cabinet, un autre compte
seulement les siennes (404 sinon) ; filtre `status` sur le statut effectif ; résumé de cible (patient, numéro de
facture, heure de visite, paiement visé). Approbations hors-ligne (« profil gérante présent sans PIN commun ») : non
codées, elles attendent le coffre et la synchronisation (O01 à O05) ; les deux commandes refusent toute source autre que
la route directe.

**Écrans.** `pages/manager/Approvals.vue` (`/parametres/approbations`, nom `approbations`, module `settings`,
`approval.decide` ou `approval.request` ; le lien « Approbations » de `SettingsHomePage` y mène pour la gérante) et
`pages/manager/ApprovalCard.vue` : « En attente » / « Toutes », contenu exact vérifié, Accorder / Refuser (motif
obligatoire pour un refus) ; 423 → `PasswordConfirmDialog` puis `mutation.retry()` (même clé, même charge). Composant
réutilisable `components/approvals/ApprovalRequestDialog.vue` (contenu exact fourni par l'écran appelant, motif saisi,
`RequestApproval` par le répartiteur, une clé par boîte) ; règles `domain/approvals/approvals.ts` (constructeurs de
contenu `examFeeWaiverSubject`, `draftLineRightsSubject`, `paymentReversalSubject`, `creditNoteSubject`,
`refundSubject`) ; lectures `app/services/approvals.ts`.

**À brancher par l'écran du brouillon** (fichiers de l'agent des écrans de vente, non modifiés ici) : sur un refus
`APPROVAL_REQUIRED_OR_EXPIRED` d'un brouillon, proposer « Demander une autorisation » avec
`ApprovalRequestDialog` et `draftLineRightsSubject(invoice_id, patient_id, lignes envoyées)` ; une fois l'approbation
accordée, renvoyer EXACTEMENT les mêmes lignes (même brouillon, même caissière) : le serveur la retrouve et la consomme.
De même pour les corrections (B07, B08) quand leurs écrans existeront : le contenu de la demande est celui de la
commande, et l'`approval_id` accordé est repris dans la commande.

## Contrôle du paiement de l'examen dans la file du jour (P03)

État : **codé, non exécuté**. Contrôle inactif (`EEO_EXAM_FEE_CONTROL=off`, défaut) : **rien ne change** (statut
`ARRIVED`, marqueur `NOT_CONTROLLED`, textes « non contrôlé » ; `exam_fee_receipt_number` vaut null ; `/auth/me` rend
`clinic.exam_fee_control = OFF`).

Contrôle actif (`billed`) :

- `RegisterVisit` écrit `AWAITING_EXAM_FEE` pour un examen ou un suivi (`VisitStatus::initial`), `ARRIVED` pour un achat
  ou un retrait.
- `ExamFeeVisits::refresh` écrit `READY_FOR_EXAM` / `AWAITING_EXAM_FEE` (et `exam_invoice_id`) dans la transaction des
  événements qui le changent : encaissement, contre-écriture, avoir et remboursement de la facture de la visite
  (`RegisterPayment`, `ReversePayment`, `IssueCreditNote`, `RefundCredit`), décision d'une dispense
  (`DecideApproval`). Verrou de la visite au rang 46, avant la propriété de facture (lecture sans verrou de
  `invoices.visit_id`, immuable après émission). Contrôle inactif : aucun verrou de plus, ordre inchangé.
- `StartConsultation` accepte aussi, contrôle actif seulement, une visite `AWAITING_EXAM_FEE` (le contrôle tranche et
  répond 422 `EXAM_PAYMENT_REQUIRED` tant que rien ne prouve le règlement ; contrôle inactif : 409 comme avant) et
  transmet ses verrous au contrôle, qui consomme la dispense au rang 90 ; sans dispense désignée, celle accordée pour
  CETTE visite est retrouvée par son contenu exact.
- File du jour (`VisitController` → `BilledExamFeeControl::queueMarker`) : `exam_fee_control` ∈ `UNPAID`,
  `WAIVER_REQUESTED`, `PAID` (avec `exam_fee_receipt_number`, numéro du dernier reçu de la facture réglée), `WAIVED`,
  `NOT_APPLICABLE` ; le statut affiché `AWAITING_EXAM_FEE` / `READY_FOR_EXAM` est recalculé à la lecture (une dispense
  échue ne laisse jamais « Prêt pour l'examen »). Calcul par visite (quelques requêtes chacune) : à mesurer sur une file
  réelle.
- Écran (`pages/today/**`) : `ExamFeeMarker` (« Frais d'examen à encaisser », « Dispense … demandée : en attente de la
  gérante », « Frais d'examen encaissés : reçu n° … », « Dispense approuvée par la gérante ») ; `ExamFeeWaiverAction`
  propose « Demander une dispense des frais d'examen » à qui a `approval.request`, module `settings` ouvert, pour une
  visite `UNPAID` encore avant l'examen ; l'arrivée explique la règle selon `clinic.exam_fee_control`
  (`examFeeControlledOnScreen`). « Démarrer l'examen » n'est proposé que pour `ARRIVED` / `READY_FOR_EXAM` ; un refus
  `EXAM_PAYMENT_REQUIRED` est dit tel quel. Jamais « payé » ni « gratuit ».

## Contre-écriture et avoir (B07)

État : **codé, non exécuté** ; écrans et lectures : section « Corrections à l'écran et lectures des pièces liées ».

`ReversePaymentHandler` (`POST /payments/{id}/reversals`, `payment.reverse`, réauthentification) : ligne
`payment_reversals` append-only liée au paiement, motif obligatoire (erreur comptable), cumul ≤ paiement
(`LedgerBalance::assertReversal`, 422 `details.reversible`), refus si l'encaissé net deviendrait inférieur aux
remboursements versés, version attendue = `ledger_version`, approbation exacte ou exécution directe. Le paiement, son
reçu (numéro jamais renuméroté) et la facture restent tels qu'émis ; ce n'est pas une sortie d'argent. Espèces : la
session du paiement est verrouillée (70) ; une session close n'est jamais réécrite (correction montrée à part, audit
`cash_session_closed`). Audit `payment.reversed`.

`IssueCreditNoteHandler` (`POST /invoices/{id}/credit-notes`, `credit_note.issue`, réauthentification) : facture émise,
lignes de CETTE facture une fois chacune, cumul des avoirs émis ≤ ligne en montant et en quantité indiquée
(`CreditNoteRules::assertLine`, 422 `details.creditable` / `creditable_quantity`), somme des lignes = `amount_gross` ≤
part non créditée (`assertCreditNote`). Taxe de chaque ligne : part proportionnelle de la taxe FIGÉE de la ligne
d'origine (arrondi demi supérieur), la part qui solde la ligne reçoit le reste exact (`CreditNoteRules::includedTax`) ;
aucune taxe inventée. Ordre imposé par les triggers : avoir `DRAFT`, lignes, usage du numéro `TEST-AV-AAAA-NNNNNN`,
document `PENDING` (`credit_note.v1`), puis `ISSUED` avec le snapshot (`contracts/snapshots/credit-note.json` : régime
fiscal de la facture, patient figé). Événement `CreditNoteIssued`. Réduction de la créance seulement : ni la facture, ni
ses lignes, ni ses reçus, ni le stock ne changent ; au-delà du reste dû, la facture passe `IN_CREDIT` (crédit à
rembourser, jamais une dette négative cachée). Distinction des trois corrections : erreur d'encaissement →
contre-écriture ; réduction de la vente → avoir ; retour physique → `RegisterPhysicalReturn` (non codé, S-).

## Remboursement d'un crédit (B08)

État : **codé, non exécuté** ; écrans et lectures : section « Corrections à l'écran et lectures des pièces liées ».

`RefundCreditHandler` (`POST /invoices/{id}/refunds`, `refund.execute`, réauthentification) : lié à un avoir émis de la
facture ; montant ≤ crédit à rembourser de la facture (`assertRefund`, 422 `details.refundable_credit`) ET ≤ part de
l'avoir non encore remboursée ; version attendue = `ledger_version` (409 avec `refundable_credit`). Espèces : session
OUVERTE de l'auteur, antérieure au remboursement (clôturée : 409 ; la clôture compte la sortie dans l'attendu) ; autres
modes : aucune session, référence obligatoire comme pour l'encaissement. Date effective du jour (ni future, ni d'un jour
antérieur : le contrat n'a pas de motif de saisie rétroactive). Pièce : usage du numéro `TEST-RMB-AAAA-NNNNNN`,
remboursement avec son snapshot (`contracts/snapshots/refund.json`, bénéficiaire = identité figée de la facture),
document `PENDING` (`refund.v1`). Facture, avoir et reçus jamais modifiés ; une clé ne rembourse qu'une fois ; deux
remboursements concurrents sont sérialisés (le second : `VERSION_CONFLICT`). Audit `refund.executed`.

**Points ouverts B06–B08.** (1) Le seed ne donne à la caisse ni `payment.reverse`, ni `credit_note.issue`, ni
`refund.execute` (écart avec la matrice 09 « exécution après approbation explicite », déjà déclaré dans `access.md`) :
avec le seed actuel, la caisse DEMANDE et la gérante exécute (directement, ou en reprenant l'approbation) ; une
dérogation nominative ouvre l'exécution par la caisse après approbation. (2) Un avoir ne libère pas la réserve de stock
des quantités créditées non remises : la remise (S01) devra plafonner par « quantité facturée non créditée ».
(3) Lectures `GET /credit-notes/{id}` et `GET /refunds/{id}` et PDF de ces pièces : ajoutés (section « Corrections
à l'écran… ») ; le document serveur reste `PENDING` tant que le dépôt du PDF n'existe pas.
(4) Durée de validité des approbations (60 min) et qui autorise hors-ligne (Q07) : à confirmer avec la gérante.

**Tests écrits (non exécutés).** `tests/Feature/Access/ApprovalsTest.php`, `tests/Feature/Billing/ExamFeeQueueTest.php`,
`ReversePaymentTest.php`, `CreditNoteTest.php`, `RefundCreditTest.php`, `DraftRightsApprovalTest.php` (fixtures
`tests/Support/ApprovalFixtures.php`) ; unitaires `tests/Unit/Access/ApprovalSubjectTest.php`,
`tests/Unit/Billing/CreditNoteRulesTest.php` ; concurrence `tests/Concurrency/CorrectionsConcurrencyTest.php` (base
jetable `eeo_conc_corrections_test` : deux avoirs, deux remboursements, remboursement espèces contre clôture, une
approbation pour deux exécutions, deux décisions) ; Vitest `tests/frontend/approvals/approval-rules.test.ts`,
`approvals-page.test.ts`, `tests/frontend/visits/exam-fee-control.test.ts` (les tests « non contrôlé » existants sont
inchangés). `BilledExamFeeControlTest` (B04) reste valable : la dispense désignée garde son comportement.

## Écrans (frontend, EN LIGNE)

État : **codé, non exécuté** (ni Vitest, ni vue-tsc, ni ESLint, ni Playwright lancés). Premier jalon EN LIGNE : chaque
écran n'écrit que par la route directe et ne dit « enregistré » qu'après la réponse du serveur ; rien n'est dit
« hors-ligne » ni « enregistré sur ce poste ». Aucun écran ne dit « payé », « soldé », « acquitté » ni « gratuit » :
« Total encaissé » (`paid_net`) et « Reste à encaisser » (`balance_due`) viennent de la projection du serveur.

| Route (nom) | Écran | Permissions (une suffit) | Module |
| --- | --- | --- | --- |
| `/ventes` (`ventes`) | `pages/sales/SalesHomePage.vue` : entrées selon les droits | `invoice.read`, `payment.collect`, `cash.own_session`, `exam_fee.collect` | `sales` |
| `/ventes/caisse` (`caisse`) | `pages/cash/CashSessionPage.vue` : session, ouverture (fond), clôture (compté, écart, motif) | `cash.own_session` | `sales` |
| `/ventes/factures` (`factures`) | `pages/sales/InvoiceListPage.vue` : filtres état, patient (`?patient=`), date | `invoice.read` | `sales` |
| `/ventes/factures/nouvelle` (`facture-nouvelle`) | `InvoiceCreatePage.vue` + `InvoiceEditor.vue` (`?patient=`, `&visite=`) | `invoice.create`, `exam_fee.collect` | `sales` |
| `/ventes/factures/:id` (`facture`) | `InvoicePage.vue` : brouillon (`InvoiceEditor`) ou émise (`InvoiceDetails`, `PaymentForm`, `ReceiptPanel`) | `invoice.read` | `sales` |
| `/ventes/catalogue` (`catalogue`) | `CatalogPage.vue` + `CatalogItemForm.vue` | `catalog.manage` | `sales` |
| `/ventes/taxes` (`taxes`) | `TaxRulesPage.vue` | `catalog.manage` | `sales` |
| `/stock` (`stock`) | `pages/stock/StockPage.vue` : disponibilités, stock initial | `stock.read` (saisie : `stock.adjust`) | `stock` |

Navigation : l'entrée « Ventes et caisse » (`navigation.ts`, `sales`, B02) est livrée ; « Stock » (I01) ne l'est pas
(l'écran `/stock` est atteint depuis `/ventes`). Bouton « Créer une facture » sur la fiche patient
(`PatientViewPage.vue`) et par visite dans la file du jour (`VisitQueue.vue`, jamais pour une visite annulée), avec
`invoice.create` ou `exam_fee.collect` ET le module `sales` ouvert ; patient et visite passent en identifiants ULID
opaques (même règle que `?patient=` de l'arrivée).

Code : domaine `domain/billing/{draft,issueInvoice,payment,cash,catalog}.ts`, `domain/inventory/opening.ts` ; services
`app/services/billing.ts` (lectures), `app/services/salesDocuments.ts` (PDF), `app/services/reauth.ts`
(`POST /auth/reauthenticate`) ; composants `components/billing/BalanceSummary.vue`, `components/form/CheckboxField.vue`,
`components/session/PasswordConfirmDialog.vue` ; pages `pages/sales/*`, `pages/cash/CashSessionPage.vue`,
`pages/stock/StockPage.vue`.

Décisions :

1. **Mêmes calculs que le serveur.** Brut, remise, net et total du brouillon viennent de `computeLineAmounts` /
   `invoiceTotal` (jumeaux de `LineAmounts.php`) par `draftTotals` ; `tests/frontend/billing/draft-totals.test.ts`
   rejoue `contracts/vectors/invoice.json` par les fonctions de l'écran. La taxe comprise n'est pas recalculée à
   l'écran (la règle d'un article n'est lisible que par la gérante) : le total TTC n'en dépend pas, la ventilation
   affichée est celle des lignes enregistrées ou figées.
2. **Droits affichés, serveur juge.** Sans `catalog.manage`, le prix du catalogue est en lecture seule et la
   désignation d'un article n'est pas modifiable ; une ligne hors catalogue n'est proposée qu'à la gérante. Le plafond
   de remise n'est pas exposé par `/auth/me` : l'écran dit « réservée à la gérante, plafond du serveur, 0 % par
   défaut » et rattache le refus `APPROVAL_REQUIRED_OR_EXPIRED` (`lines.N.discount_gross`) à sa ligne.
3. **Idempotence.** Un `useMutation` par formulaire ; identifiants des effets (`invoice_id`, `number_usage_id`,
   `document_id`, `payment_id`, `receipt_id`, `receipt_number_usage_id`, `receipt_document_id`, `cash_session_id`,
   `movement_id`/`lot_id`) et instants (`issued_at`, `effective_at`, `counted_at`) fixés pour l'intention. Double clic :
   bouton désactivé et envoi dédoublonné. Issue non confirmée (réseau, 5xx, page d'hébergeur) : champs de
   l'encaissement verrouillés, « Réessayer » rejoue la même clé et la même charge ; « Relire la facture » constate le
   paiement de la tentative s'il figure dans la facture (sans renvoi). Identifiants déjà pris (422 sur
   `payment_id`, `number_usage_id`…) : « peut-être déjà enregistré », relecture, jamais de second envoi automatique.
   Après un reçu, « Nouvel encaissement » recrée le formulaire (nouvelle clé, nouveaux identifiants).
4. **Conflits.** Brouillon (409) : saisie conservée, « Relire le brouillon » puis « Garder ma saisie » (version
   actuelle, nouvel envoi) ou « Reprendre la version actuelle ». Encaissement (409 `VERSION_CONFLICT` ou
   `PAYMENT_EXCEEDS_BALANCE`) : reste dû du serveur dit, facture relue, saisie gardée. Clôture (409, nouvel attendu) :
   ancien et nouvel attendus dits, compté conservé. Article, règle fiscale (409) : saisie conservée, version actuelle
   relue.
5. **Émission.** Boîte de confirmation (« La facture émise ne pourra plus être modifiée ») ; numéro affiché seulement
   depuis la réponse. `catalog_snapshot_sha256` = SHA-256 (Web Crypto) des lignes affichées et de la version du
   brouillon (`displayedLinesFingerprint`), consigné par le serveur dans l'audit à côté de sa propre empreinte ;
   `total_gross` = total affiché (le serveur refuse l'écart avec `expected_total`, dit à l'écran). `STOCK_UNAVAILABLE`
   et `LOT_EXPIRED` sont rattachés à la ligne, avec la quantité disponible.
6. **PDF.** `salesDocuments.ts` construit facture (`invoiceFromResource`, version `invoice.v1`, snapshots figés) et
   reçu (`receiptFromSnapshot`, version du snapshot) par le moteur D01, sur le poste. Première génération conservée
   comme original (`keepOriginal`, clés `INVOICE|invoice:<id>|1` et `RECEIPT|receipt:<id>|1`) ; une réimpression rend
   la même pièce (rendu déterministe) ou rouvre l'original conservé. **Pas de mention « Duplicata »** : le fichier 11
   la réserve au modèle validé qui la prévoit, et les modèles actuels sont de TEST. Magasin volatil : l'écran dit que
   le PDF n'est pas conservé après la fermeture du navigateur ; l'état serveur du document reste `PENDING` (dépôt du
   PDF non codé).
7. **Réauthentification.** `ReauthDialog` sert à la session EXPIRÉE (reconnexion) ; une écriture sensible (règle
   fiscale, stock initial) reçoit 423 et ouvre `PasswordConfirmDialog` (`POST /auth/reauthenticate`), puis la même
   commande repart avec la même clé (le 423 du middleware précède l'idempotence : rien n'est enregistré).
8. **Répartiteur.** `mutations.ts` (modification ciblée) : commandes en ligne `CreateCatalogItem`, `UpdateCatalogItem`,
   `CreateTaxRule`, `UpdateTaxRule`, `RegisterOpeningStock` par `route`, avec `route.expectedVersion` = `entity`
   (version de l'entité obligatoire) ou `omitted` (corps sans `expected_version` : `OpeningStockRequest` n'a pas ce
   champ et le serveur valide la charge contre ce schéma).
9. **Contrôle du paiement de l'examen.** Rien n'est changé : la file du jour garde « Paiement de l'examen non
   contrôlé » (`exam_fee_control`) ; aucun écran ne suggère un contrôle actif.

Écarts relevés par les écrans : **comblés** par les compléments ci-dessous (filtre de date serveur, identité du
patient dans la liste, emplacements de stock, sessions de toutes les caisses, règles de vente du compte, nom de
l'émetteur, abandon de brouillon). Reste ouvert : l'encaissement rétroactif à l'écran (`retroactive_reason` toujours
null : l'encaissement est daté de sa saisie).

Tests écrits (non exécutés) : Vitest `tests/frontend/billing/` — `draft-totals.test.ts` (vecteurs communs, lignes,
charges, émission), `payment-rules.test.ts` (encaissement, caisse, catalogue = référentiel SQL, règles fiscales, stock
initial), `cash-page.test.ts`, `invoice-draft.test.ts` (patient présélectionné, visite, remise refusée, 409, émission,
stock insuffisant, gérante), `invoice-payment.test.ts` (acompte puis solde, deux reçus, double clic, réponse perdue,
relecture qui constate, AT12, espèces sans caisse, session de caisse en lecture ou illisible, référence, droits,
serveur muet), `entry-points.test.ts` (routes,
navigation, boutons « Créer une facture », services, routes versionnées, 423 puis reprise, catalogue) et
`support.ts`. Fichiers partagés : `tests/frontend/bootstrap.test.ts` (23 routes),
`tests/frontend/shell/navigation.test.ts` (`sales:B02` livré). Playwright `tests/e2e/billing.spec.ts` (caisse,
facture depuis la fiche, émission, deux encaissements, deux reçus, rechargement, 360 px) ; `tests/e2e/prepare-env.mjs`
ouvre `sales,stock` et lance `eeo:demo:sales`.

À regarder en vérification finale : `npm run typecheck` (gabarits avec `$event as …`, références de fonction dans
`v-for`, union de `ReadOutcome` dans `InvoiceDetails`), `npm run lint` et prettier (non passés), `npx vitest run
tests/frontend/billing tests/frontend/bootstrap.test.ts tests/frontend/shell tests/frontend/visits
tests/frontend/patients tests/frontend/services` (boutons ajoutés à la fiche et à la file du jour), attente de Web
Crypto (`vi.waitFor`) dans les tests d'émission, puis `npm run test:e2e:run -- billing` (le jeu `eeo:demo:sales` doit
réussir dans la base e2e).

## Compléments pour un usage réel (ventes, caisse, stock, caisse du jour)

État : **codé, non exécuté** (aucun test PHPUnit, Vitest ni Playwright lancé ; générateurs de contrats et
`npm run contracts:types` exécutés). EN LIGNE seulement.

| Route | Rôle | Permission (route) | Tâche |
| --- | --- | --- | --- |
| `GET /api/v1/invoices?issued_on=AAAA-MM-JJ` | filtre SERVEUR par jour civil d'émission (fuseau du cabinet, seules les factures émises) ; chaque ligne porte `patient` {id, record_number, last_name, first_names} | `invoice.read` | B02 |
| `POST /api/v1/invoices/{id}/abandon` | `AbandonInvoiceDraft` (en ligne seulement, `schemas/requests/http.json#/$defs/AbandonInvoiceDraftRequest`) | `invoice.create` ou `exam_fee.collect` | B02 |
| `GET /api/v1/sales/settings` | règles de vente du compte : `price_authority`, `discount_cap_percent` effectif, `payment_methods`, `payment_reference_required`, `exam_fee_item_reference` | `invoice.read`, `invoice.create`, `payment.collect` ou `exam_fee.collect` | B04 |
| `GET /api/v1/cash-sessions?state=open\|closed` | sessions de toutes les caisses (ouvertes d'abord), noms actuels de la caissière et de qui a clôturé | `cash.manage` | B05 |
| `GET /api/v1/cash-sessions/{id}/report` | relevé d'une session (tiroir, mouvements, encaissements, autres modes de la caissière pendant la session) ; une autre caissière : 403 sans `cash.manage` | `cash.own_session` | B05 |
| `GET /api/v1/reports/cash-day?date=AAAA-MM-JJ` | caisse du jour : portée `CLINIC` (`finance.global.read`) ou `OWN` (caissière : ses encaissements et ses sessions, `issued`/`credited`/`outstanding` à null) | `finance.global.read` ou `cash.own_session` | R01 |
| `GET /api/v1/stock/locations` | emplacements actifs du cabinet | `stock.read` | I00 |

Ressources ajoutées : `Invoice.issued_by_name` et `InvoicePayment.received_by`/`received_by_name` (noms ACTUELS
des comptes, jamais figés dans la pièce : le reçu garde le nom figé de son snapshot), `InvoiceSummary.patient`,
`CashSessionEntry`, `CashSessionPage`, `CashSessionReport`, `CashDayReport`, `SalesSettings`, `StockLocation`
(`schemas/resources/{billing,stock}.json`) ; fixtures valides et invalides dans `contracts/fixtures/resources/`.

Code serveur : `Billing/Reports/{ReportDay,CashDayReport}`, `Billing/Handlers/AbandonInvoiceDraftHandler` (déclaré
dans `BillingCommands`, source directe seulement), `Cash/{CashSessionDirectory,CashSessionReport}`,
`Inventory/StockLocations`, `Http/Controllers/Api/V1/{CashDayReportController,SalesSettingsController}`, méthodes
ajoutées à `InvoiceController::abandon`, `CashSessionController::{index,report}`, `StockController::locations`,
`CashPresenter::{entry,report,day}`, `StockPresenter::location`, `InvoiceReader` (jointure patient, filtre
`issued_on`, noms) et `InvoicePresenter`.

Décisions :

1. **Abandon** (fichier 03 : « Une facture brouillon peut être abandonnée ») : version de brouillon attendue
   (409 sinon), créateur ou gérante (403), facture émise ou déjà abandonnée 409 `STATE_TRANSITION_REFUSED`, facture
   détenue par un poste 409 `WRITE_OWNER_REQUIRED`. Aucun numéro, aucune réserve, aucun document : rien à annuler ;
   les lignes restent en base. Motif FACULTATIF (aucune source n'en exige), conservé dans l'audit
   `invoice.draft_abandoned` (aucune colonne ne le porte). Verrous : propriété (50) puis facture (60).
2. **Jour civil** : `issued_on` et la caisse du jour sont comptés au fuseau du cabinet (`ReportDay`, fenêtre UTC
   début inclus, fin exclue) ; une date illisible est refusée en 422 sur son champ, jamais remplacée par
   aujourd'hui. Les encaissements comptent pour leur `effective_at` (date d'encaissement), les contre-écritures pour
   leur `recorded_at` (vue `vw_collection_events`).
3. **Portée de la caisse du jour** (fichier 09 : la caissière ne lit que « sa propre session ») : `OWN` = événements
   dont elle est l'auteur + contre-écritures et remboursements rattachés à SES sessions du jour ; ni ventes émises,
   ni créances. Le reste à encaisser de la gérante est celui de l'INSTANT de la lecture (`vw_invoice_balances`).
4. **Relevé de session (PDF)** produit sur le poste par le modèle `CASH_SESSION_REPORT` (`TEST-1`) :
   `domain/billing/cashReport.ts` (encaissés espèces NETS des contre-écritures, attendu figé d'une session close,
   projection sinon) ; pas d'original conservé (ce n'est pas une pièce numérotée). En-tête : nom du cabinet de la
   session (`clinicFromSummary`). Une session close dont l'attendu figé ne correspond plus aux faits (contre-écriture
   postérieure) est refusée par le modèle : l'écran dit « Relevé non produit ».
5. **Règles de vente à l'écran** (`pages/sales/useSalesSettings.ts`) : plafond de remise effectif dit à côté de
   chaque remise (`discountRule(priceAuthority, cap)`), modes à référence obligatoire lus du serveur
   (`referenceRequired(method, list)`, `validatePayment(..., { referenceRequiredMethods })`) ; lecture qui échoue →
   textes et valeurs par défaut, rien n'est bloqué (le serveur reste juge).
6. **Écrans** : liste des factures filtrée par le serveur (jour, état y compris « abandonnés », patient) avec le
   patient de chaque ligne ; « Abandonner le brouillon » (confirmation, motif facultatif) dans `InvoiceEditor` ;
   stock initial sur les emplacements lus (`GET /stock/locations`, aucun deviné) ; caisse : `CashSessionsManager`
   (gérante : toutes les sessions, relevé, clôture de la session d'une autre caissière) et `SessionReportButton`
   (relevé provisoire de sa session, relevé de clôture) ; nouvelle page `pages/cash/CashDayPage.vue`
   (`/ventes/caisse-du-jour`, nom `caisse-du-jour`, `finance.global.read` ou `cash.own_session`, module `sales`),
   entrée dans `SalesHomePage`. Le nom de l'émetteur part dans le PDF de la facture (`issuedByName`).

Hypothèses et points ouverts : le nom de l'émetteur n'est pas figé dans la facture (une v2 du snapshot le ferait) ;
la liste des factures reste ouverte à toute personne `invoice.read` (la caissière voit toutes les factures, alors que
le fichier 09 la limite à « la facture sélectionnée » : à trancher avec la cliente) ; la caisse du jour ne connaît que
le central (aucun poste hors-ligne n'existe encore) ; `GET /reports/financial` (période, gérante) reste PLANNED.

Tests écrits (non exécutés) : PHPUnit `tests/Feature/Billing/{InvoiceListFiltersTest,AbandonInvoiceDraftTest,
CashSessionDirectoryTest,CashDayReportTest,SalesSettingsAndLocationsTest}.php` (droits des quatre profils, cabinet,
module fermé, jour civil Douala 23 h 30 UTC, contrats) ; Vitest `tests/frontend/billing/{sales-gaps,cash-day}.test.ts`
et mises à jour de `support.ts` (`issued_by_name`), `invoice-payment.test.ts` (`received_by*`), `draft-totals.test.ts`,
`entry-points.test.ts` (route `caisse-du-jour`), `cash-page.test.ts` (liste et clôture par la gérante) ; Playwright
`tests/e2e/billing.spec.ts` (filtre du jour, caisse du jour, abandon).

## Corrections à l'écran et lectures des pièces liées (B07, B08, EN LIGNE)

État : **codé, non exécuté** (2026-10-23, FORK A). Complète B07 et B08 côté écran et ajoute les lectures que le moteur
de documents attendait (point ouvert (3) de B06–B08).

**Lectures serveur.**

| Route | Rôle | Droit |
| --- | --- | --- |
| `GET /api/v1/invoices/{id}` | rend aussi `reversals` (contre-écritures : paiement, montant, motif, instant, auteur et son nom ACTUEL), et pour chaque avoir `reason` et `refunded_amount` (part déjà remboursée), pour chaque remboursement `credit_note_id` | `invoice.read` |
| `GET /api/v1/credit-notes/{id}` | avoir (`CreditNote`) : lignes d'origine créditées, part déjà remboursée, snapshot figé (`credit-note.json`, source du PDF), état du document, nom ACTUEL de l'émetteur | `invoice.read` |
| `GET /api/v1/refunds/{id}` | remboursement (`Refund`) : avoir lié, mode, référence, session, snapshot figé (`refund.json`, source du PDF), état du document, nom ACTUEL de l'auteur | `invoice.read` |

Les nouveaux champs de `Invoice` (`reversals`, `credit_notes[].reason`, `credit_notes[].refunded_amount`,
`refunds[].credit_note_id`) sont **facultatifs dans le contrat** (les fixtures et types antérieurs restent valides) ;
le serveur les rend toujours. Code : `InvoiceReader::{detail,creditNote,refund}`, `InvoicePresenter::{creditNote,refund}`,
`CorrectionDocumentController` (lecture seule ; les écritures restent dans `CorrectionController`). Fixtures
`contracts/fixtures/resources/{credit-note,refund}.valid.json`. Opérations `GetCreditNote`, `GetRefund` (IMPLEMENTED).

**Écrans** (`pages/sales/CorrectionsPanel.vue`, monté dans la fiche d'une facture émise) :

- liste des contre-écritures (motif, auteur), des avoirs (part déjà remboursée, « PDF de l'avoir ») et des
  remboursements (« PDF du remboursement ») ; PDF produits sur le poste depuis les snapshots figés
  (`salesDocuments.{creditNoteDocument,refundDocument}`, modèles `credit_note.v1`, `refund.v1` enregistrés comme alias
  dans le registre et `contracts/compatibility.json`) ;
- « Contre-passer le paiement … » (`ReversalForm.vue`) : au plus la part encore contre-passable, motif obligatoire ;
  « Émettre un avoir » (`CreditNoteForm.vue`) : montant par ligne d'origine (et quantité facultative), au plus la ligne
  et la part créditable de la facture ; « Rembourser » (`RefundForm.vue`) : au plus la part de l'avoir non remboursée ET
  le crédit disponible, espèces avec session de caisse ouverte, référence pour mobile money et virement ;
- règles pures `domain/billing/corrections.ts` (montants entiers, aucun calcul flottant) ; envoi commun
  `pages/sales/useCorrection.ts` : 423 → `PasswordConfirmDialog` puis reprise avec la MÊME clé ; `approval_id` neuf
  au départ (exécution directe par la gérante, qui détient la permission et `approval.decide`) ; sur
  `APPROVAL_REQUIRED_OR_EXPIRED`, « Demander l'autorisation » (`ApprovalRequestDialog`, contenu exact de la commande)
  et l'opération se renvoie sous l'identifiant de la demande après l'accord ;
- un compte SANS la permission de l'opération (la caisse avec le seed actuel) voit le même formulaire en mode
  « demande seulement » : le bouton devient « Demander l'autorisation », rien n'est exécuté ; la gérante exécute
  ensuite (directement). Un remboursement demandé n'exige pas de session de caisse : c'est l'exécution qui l'exige.

**Autorisation depuis le brouillon** (`InvoiceEditor.vue`) : sur un refus `APPROVAL_REQUIRED_OR_EXPIRED` d'un
enregistrement, l'écran propose « Demander une autorisation » avec `draftLineRightsSubject(facture, patient, lignes
envoyées)` ; une fois accordée, réenregistrer le brouillon SANS modifier les lignes (même charge, même clé) : le serveur
retrouve l'autorisation par son contenu et la consomme.

**Points ouverts.** Une approbation accordée à la caisse n'est pas reprise par la gérante depuis l'écran (elle exécute
directement : la demande reste visible dans « Approbations » ; reprise de l'identifiant à ajouter si la cliente la
veut) ; pas de liste des avoirs du cabinet (seulement par facture) ; dépôt du PDF sur le serveur (`PENDING` reste) avec
le coffre (O01–O05).

**Tests écrits (non exécutés).** PHPUnit `tests/Feature/Billing/CorrectionReadsTest.php` (contre-écriture, avoir et
remboursement réels par les routes, lectures, contrats, droits, cabinet, module) et matrice
`BillingRoutesGateTest` complétée ; Vitest `tests/frontend/billing/{corrections,corrections-panel}.test.ts`,
`tests/frontend/documents/registry.test.ts` (14 modèles déclarés) ; Playwright `tests/e2e/billing.spec.ts`
(contre-écriture, avoir puis remboursement par la gérante, rechargement, reçu d'origine intact).

## Import contrôlé du catalogue (X01, 2026-10-23)

- Écran : « Importer le catalogue » (`/ventes/catalogue/import`, lien « Importer un fichier CSV » du catalogue),
  `pages/manager/Imports.vue`. Modèle téléchargeable (en-têtes français, deux lignes d'EXEMPLE à remplacer),
  fichier lu SUR LE POSTE (`domain/billing/catalogImport.ts` : séparateur `;`, `,` ou tabulation détecté,
  guillemets RFC 4180, BOM UTF-8, en-têtes sans casse ni accents, catégorie et unité par nom ou code, oui/non,
  montants FCFA entiers « 50 000 », taxe par le CODE d'une règle fiscale du cabinet), 500 lignes au plus.
- Serveur : `POST /api/v1/imports/catalog` (module `sales`, `catalog.manage`, réauthentification récente, 423 sinon).
  `dry_run = true` : rapport (`ImportReport`) sans aucune écriture ni commande ; `false` : commande centrale
  `ImportCatalog` (en ligne seulement) qui revérifie tout sous le verrou du cabinet et crée TOUTES les lignes dans
  une transaction, ou AUCUNE (422, champs `rows.<index>.<champ>`, message préfixé par la ligne du fichier) ;
  même clé d'idempotence = même import rejoué. Règles : exactement celles d'un article saisi à l'écran
  (`CatalogItemInput`) ; référence unique dans le fichier et absente du catalogue, comparée comme la base
  (casse et accents ignorés, ponctuation conservée). Audit `catalog.item_created` par article (origine import,
  ligne du fichier, jamais le coût d'achat) et changement publié.
- Tests écrits : `tests/Feature/Billing/CatalogImportTest.php`, `tests/frontend/billing/catalog-import.test.ts`.
- Stock d'ouverture par fichier : sur l'écran « Stock », « Remplir depuis un fichier CSV » remplit le
  formulaire de stock initial existant (`domain/inventory/openingImport.ts` : reference, quantite, emplacement par
  code ou nom, lot, peremption, cout_unitaire ; modèle téléchargeable) ; rien n'est envoyé par la lecture, la
  gérante relit et enregistre par le circuit habituel (`RegisterOpeningStock`, motif, approbation directe,
  réauthentification). À la moindre erreur du fichier, le formulaire n'est pas modifié.
- Créances papier : voir la section suivante.

## Reprise des créances papier (X01, 2026-10-23, codé, non exécuté)

Une vente du carnet papier dont il reste un dû est reprise comme une pièce ÉMISE d'origine `LEGACY_BALANCE` dont le
total est le SEUL reste dû : la vente d'origine et l'acompte déjà versé restent dans le carnet. Ni chiffre
d'affaires du jour, ni encaissement ou reçu pour l'ancien acompte, ni ligne d'article, ni mouvement de stock. Le
reste dû s'encaisse ensuite depuis la pièce par `RegisterPayment` (un reçu par encaissement). EN LIGNE seulement.

- Justificatif : `POST /api/v1/legacy-balances/evidence` (module `sales`, `finance.global.read`, réauthentification,
  corps BRUT `application/pdf`, `image/jpeg` ou `image/png`, `X-Content-Sha256` facultatif, clé d'idempotence).
  Le type est reconnu aux premiers octets (`DocumentFiles::inspectEvidence` : `%PDF-`, `FF D8 FF`, signature PNG ;
  un GIF annoncé JPEG est refusé), taille bornée par `eeo.documents.max_bytes` (5 Mo), fichier vide refusé.
  Rangé sur le disque privé à une adresse dérivée de l'empreinte (`evidence/{cabinet}/{sha256}.{ext}`, même scan =
  même fichier), ligne `stored_files` classée `FINANCIAL` par la commande centrale `StoreLegacyEvidence` (audit
  `legacy_balance.evidence_stored`, sans le contenu). Réponse `LegacyEvidenceResponse` (201).
- Reprise : `POST /api/v1/imports/legacy-balances` (mêmes droits et middleware), corps `LegacyBalanceImportRequest`
  (`dry_run`, `evidence_file_id`, 1 à 500 `rows` : `line`, `patient_id` OU `patient_record_number`,
  `paper_reference`, `original_total`, `already_paid`, `original_invoice_on` facultative). La saisie d'une seule
  créance est un lot d'une ligne. `dry_run = true` : rapport `ImportReport` sans écriture (contrôleur, sans
  commande) ; `false` : commande `ImportLegacyBalances` (en ligne seulement) qui revérifie tout sous le verrou du
  cabinet et crée TOUTES les pièces dans une transaction, ou AUCUNE (422, champs `rows.<index>.<champ>`, message
  préfixé par la ligne du fichier, aucun numéro consommé). Même clé = même reprise rejouée.
- Règles (`LegacyBalances/LegacyBalanceImport::check`, jumelles `LegacyBalance::openingBalance` /
  `legacyOpeningBalance`) : patient existant du cabinet et non fusionné ; montants FCFA entiers, total positif,
  déjà réglé ≤ total, reste dû > 0 (une pièce papier entièrement réglée n'est pas reprise) ; date de pièce
  facultative et jamais dans le futur (fuseau du cabinet) ; référence papier de 1 à 100 caractères, unique dans le
  fichier et jamais déjà reprise, comparée sans casse ni accents (ponctuation conservée) ; justificatif obligatoire,
  `FINANCIAL`, non archivé, du cabinet.
- Écriture : numéros alloués d'abord (série `LEGACY_BALANCE`, préfixe `EEO_NUMBER_PREFIX_LEGACY_BALANCE`, `TEST-REP`
  en développement, distincte des factures du jour, sans trou), puis verrous des patients (rang 45) ; par ligne :
  usage de numéro, facture `ISSUED` (instantanés patient, cabinet et taxe `NO_TAX_CONFIGURED`, `legacy_reference`,
  `legacy_opening_balance` = total), ligne `legacy_balance_imports` (total d'origine, déjà réglé, reste dû,
  justificatif et son empreinte, validée par la gérante), audit `legacy_balance.imported`, changement publié
  (`invoices`, compartiment financier). Aucun événement sortant (pas de consommateur « vente »).
- Caisse du jour : `CashDayReport` ne compte plus que les pièces `NATIVE` dans « factures émises » ;
  `vw_revenue_events` ne voyait déjà que `NATIVE`. Le reste dû repris figure dans `vw_invoice_balances`.
- Fichiers privés : l'écriture et la lecture du disque privé sont passées de `DocumentFiles` (domaine) à
  `App\Support\Files\PrivateFiles` (aucun effet externe dans `app/Domain`, garde `CentralPathGuardTest`) ;
  `DocumentController` l'utilise aussi.
- Écran : section « Créances papier » en bas de « Importer le catalogue » (`pages/manager/LegacyBalances.vue`,
  visible avec `finance.global.read`) : 1. scan déposé ; 2. « Une créance » (patient par la recherche, référence,
  total, déjà réglé, date facultative, « Reste dû repris : 50 000 FCFA ») ou « Un fichier CSV »
  (`domain/billing/legacyImport.ts` : `reference_papier`, `dossier`, `total_origine`, `deja_paye` vide = 0,
  `date_piece`, modèle téléchargeable aux lignes FICTIVES) ; 3. « Vérifier sur le serveur » puis « Reprendre »
  (clé stable par intention, mot de passe redemandé au besoin, même clé renvoyée), liens « Ouvrir la pièce N et
  encaisser le reste dû ». Aide intégrée : rubrique « Créances du carnet papier ».
- Tests écrits (non exécutés) : `tests/Feature/Billing/LegacyBalancesTest.php`,
  `tests/Concurrency/LegacyBalancesConcurrencyTest.php` (deux reprises simultanées de la même référence),
  `tests/frontend/billing/legacy-import.test.ts`, `tests/e2e/legacy-balances.spec.ts` ; fixtures
  `contracts/fixtures/resources/legacy-*.json`.
- Hypothèses à confirmer avec la cliente : colonnes du carnet (référence, numéro de dossier, total, déjà réglé,
  date) ; un seul scan par lot (une page de carnet peut couvrir plusieurs créances) ; patient retrouvé par son
  numéro de dossier (les patients du carnet doivent être enregistrés d'abord) ; droit `finance.global.read` pour
  reprendre ; préfixe définitif de la série ; pas de PDF de la pièce de reprise elle-même.
- Reste : affecter une créance reprise à la caisse hors-ligne avant de l'encaisser hors-ligne (O03/O05).

## Remise au patient (I01, 2026-10-23, codé, non exécuté)

Remise partielle ou totale d'une facture ÉMISE, EN LIGNE (`ConfirmDelivery`, commande du catalogue F06 ; la source
d'un poste reste refusée par `CentralOnly` jusqu'au jugement des quotas, O05). Code :
`app/Domain/Inventory/Handlers/ConfirmDeliveryHandler.php`, `ReservationService::consumeForDelivery`,
`Rules/DeliveryRules.php`, `DeliveryReader.php`, `app/Http/Controllers/Api/V1/DeliveryController.php`.

- Routes (module `sales`) : `GET /api/v1/invoices/{id}/deliveries` (`invoice.read`, ressource
  `InvoiceDeliveriesResponse` : par ligne facturé, remis, retourné, reste à remettre, réserve ouverte, remettable ;
  remises confirmées avec lot et nom ACTUEL de qui a remis ; retours ; reste dû à l'instant) et
  `POST /api/v1/invoices/{id}/deliveries` (`delivery.confirm` : caisse et gérante seedées ; `expected_version` null ;
  clé d'idempotence ; réponse `DeliveryResponse` 201, rejouée telle quelle par la même clé).
- Règles : chaque ligne vise une ligne de CETTE facture portant un article du catalogue (une ligne libre ne se remet
  pas) ; cumul des remises confirmées ≤ quantité facturée (422, `details.remaining`) ; quantité entière pour un
  article vendu à l'unité ; heure de remise du jour (ni future au-delà de la dérive admise, ni d'un jour antérieur,
  jamais avant l'émission). Article `STOCKED` : la quantité est prise sur les réserves ACTIVES de la ligne posées à
  l'émission (FEFO, lots sans date ensuite ; jamais au-delà de la part ouverte : 409 `STOCK_UNAVAILABLE`,
  `details.available`) ; une réserve désignée (`reservation_id`, `stock_lot_id`, `stock_position_id`) restreint le
  choix. Une ligne couverte par deux lots donne deux lignes de remise (la première garde l'identifiant de la commande,
  les suivantes un identifiant serveur). Article `NONE` ou `MADE_TO_ORDER` : ligne de remise sans réserve, lot ni
  mouvement (un identifiant de réserve ou de mouvement fourni est refusé).
- Stock (`consumeForDelivery`, positions 80, lots 81, quotas 82, tout contrôlé avant la première écriture) : réserve
  CENTRALE → `on_hand` et `reserved` de la position et du lot baissent (le disponible central ne bouge pas) ; réserve
  SOUS QUOTA d'un poste (quota ACTIVE/CLOSING) → `on_hand` et `offline_allocated` baissent, `consumed_quantity` du
  quota monte (cohérent avec `ReleaseResources` qui rend `alloué − consommé − restitué`) ; réserve d'un quota CLOS →
  sortie sur le disponible central contrôlé. Lot vendable et non expiré au jour LOCAL de la remise
  (`LotRules::assertDeliverable`, 422 `LOT_EXPIRED`, `details.expires_on`) ; un lot qui expire le jour même reste
  remis ce jour-là. Réserve `CONSUMED` quand consommé + libéré = réservé. Un mouvement `SALE_DELIVERY` négatif par
  ligne de remise (`delivery_line_id`, coût unitaire du lot s'il est connu, sinon null).
- Facture avec un reste dû (> 0 à l'instant) : approbation exacte dans `credit_delivery_approval_id`, nature
  `CREDIT_DELIVERY` (action `delivery.confirm`, cible `invoices` ; contenu : facture, reste dû, quantités remises par
  ligne d'origine, additionnées et triées), consommée une fois (rang 90, après le stock), ou exécution directe de la
  gérante sous cet identifiant ; sinon 422 `APPROVAL_REQUIRED_OR_EXPIRED` (`details.amount_due`). Un encaissement
  entre la demande et la remise change le reste dû, donc l'empreinte : nouvelle demande. Facture sans reste dû : aucun
  identifiant n'est consommé (celui fourni est ignoré, la remise porte `null`).
- Écritures dans l'ordre des triggers : remise `DRAFT`, lignes, mouvements, puis UNE mise à jour → `CONFIRMED`
  (heure, auteur, approbation, instantané patient `delivery-patient.json` relu dans `patient_records`). La facture,
  son solde et ses reçus ne changent pas. Audit `delivery.confirmed` (lignes, mouvements, remise complète ou non,
  reste dû, mode d'approbation, modes de stock), événement `DeliveryConfirmed`, changements publiés `deliveries`
  (créé) et `stock_positions` (versions écrites), compartiment financier.
- Verrous : cabinet, idempotence, propriété de facture (50 : facture détenue par un poste → 409
  `WRITE_OWNER_REQUIRED`, la remise se fait sur ce poste), facture (60), positions (80), lots (81), quotas (82),
  approbation (90). Deux postes qui remettent le dernier article d'une même vente sont sérialisés : le second reçoit
  le reste actualisé (422, `remaining` 0).
- Écran : fiche facture émise, section « Remise au patient » (`pages/sales/DeliveriesPanel.vue`,
  `DeliveryForm.vue`) : reste à remettre par ligne, « Remettre au patient » (quantité proposée = le reste, une ligne
  laissée vide n'est pas remise), « Confirmer la remise », historique « Remises enregistrées » (date, qui, lot),
  refus du serveur affichés sur la ligne ; facture avec un reste à encaisser : avertissement « Remise avant règlement
  complet », la caisse DEMANDE l'autorisation (« Demander l'autorisation de remise », `creditDeliverySubject`), la
  gérante exécute directement. Section absente quand la lecture répond 404. Règles d'écran :
  `domain/inventory/delivery.ts` ; lecture : `app/services/deliveries.ts` ; envoi : `pages/stock/useStockCommand.ts`.
  Aide intégrée : rubrique « Remettre les articles au patient ».

## Retours physiques, casse et ajustements (I02, 2026-10-23, codé, non exécuté)

- Retour : `POST /api/v1/deliveries/{id}/physical-returns` (module `stock`, `stock.adjust` — gérante seedée —,
  réauthentification ; `RegisterPhysicalReturnHandler`). La ligne de remise doit appartenir à la remise de l'adresse
  (contrôleur) et être confirmée ; cumul des retours ≤ quantité remise (422, `details.returnable`) ; `approved_by` =
  l'auteur (contrôle et acceptation par la personne qui enregistre) ; motif obligatoire ; heure ni future ni avant la
  remise. Destination : seul un article `SELLABLE` accepté (`accepted_for_restock`) écrit un mouvement
  `PATIENT_RETURN` positif dans la position et le lot d'origine et remonte leur `on_hand` (jamais dans un lot expiré
  ou en quarantaine au jour local, ni pour un article sans stock) ; sinon le retour est tracé sans mouvement
  (`stock_movement_id` doit alors être null). AUCUN avoir n'est créé ; un avoir ÉMIS de la même facture peut être
  relié (`credit_note_id`). Verrous : facture de la remise (60), position (80), lot (81). Audit
  `stock.physical_return_registered` (`credit_note_created: false`), changements `physical_returns` et
  `stock_positions`.
- Casse et ajustement : `POST /api/v1/stock/movements` (module `stock`, `stock.adjust`, réauthentification ;
  `RegisterStockMovementHandler`). `BREAKAGE` négatif, `ADJUSTMENT` signé non nul ; article `STOCKED` ; lot
  obligatoire dès que la position a des lots (position et lot bougent ensemble) ; quantité entière pour un article
  vendu à l'unité ; un retrait ≤ disponible central (physique − réserves − quotas : 409 `STOCK_UNAVAILABLE`,
  `details.available`) — la marchandise réservée pour une vente ou confiée à un poste ne se retire jamais
  (`StockCounters`). Approbation exacte obligatoire (`approval_id`), nature `STOCK_MOVEMENT` (action
  `stock.adjust`, cible `stock_positions` ; contenu : position, article, lot, `movement_kind`, quantité signée
  canonique), ou exécution directe de la gérante. Le stock initial (`stock.adjust`/`stock_movements`) reste hors du
  registre des demandes (`ApprovalKind::fromStored` rend null). Motif obligatoire, coût unitaire connu ou null.
  Audit `stock.movement_registered`, changement `stock_positions`.
- Écrans : « Enregistrer un retour » sur chaque ligne remise de la section « Remise au patient »
  (`pages/sales/PhysicalReturnForm.vue` : quantité, état constaté, « Remettre en stock vendable », avoir à relier,
  motif ; mot de passe redemandé au besoin) ; « Stock » → « Casse ou ajustement » (`/stock/mouvement`,
  `pages/stock/MovementForm.vue` : article, emplacement, lot, nature, sens, quantité au plus le disponible affiché,
  motif ; la gérante exécute, un autre compte autorisé demande l'autorisation). Aide intégrée : rubrique « Retours,
  casse et ajustements de stock ».

## Contrats, tests et points ouverts (I01, I02)

- Contrats : `build_commands.py` (sujets `CreditDeliverySubject`, `StockMovementSubject`), `build_resources.py`
  (`InvoiceDeliveries`, natures d'approbation), `build_openapi.py` (`ListInvoiceDeliveries`, `ConfirmDelivery`,
  `RegisterPhysicalReturn`, `RegisterStockMovement` implémentées), régénérés et remis en LF ; fixtures
  `request-approval.credit-delivery*.json`, `request-approval.stock-movement*.json`, `invoice-deliveries.*.json`.
- Tests écrits (non exécutés) : `tests/Feature/Billing/DeliveryTest.php`, `PhysicalReturnTest.php`,
  `StockMovementTest.php`, `tests/Unit/Billing/DeliveryRulesTest.php`, `tests/Concurrency/DeliveryConcurrencyTest.php`
  (dernier article remis par deux postes, rejeu simultané), `tests/frontend/domain/delivery-rules.test.ts`,
  `tests/frontend/billing/deliveries-panel.test.ts`, `tests/e2e/deliveries.spec.ts` (facture émise → remise
  partielle → remise du reste → retour) ; aide `tests/Support/DeliveryFixtures.php`.
- À trancher à la vérification de fin de lot : nombre de routes attendu par `tests/frontend/bootstrap.test.ts`
  (route `stock-movement` ajoutée) ; entrée « Stock » de la navigation toujours `delivered: false` (I01) ; remise sous
  quota d'un poste à brancher sur la synchronisation (O05 : ConfirmDelivery depuis un poste, réserves désignées par le
  poste).
- Hypothèses à confirmer avec la cliente : remise d'une facture avec un reste à encaisser seulement sur autorisation
  de la gérante (fichier 03) ; un lot expiré après l'émission bloque la remise (changer de lot = avoir puis nouvelle
  vente, pas d'échange de lot à l'écran) ; un avoir émis ne libère pas la réserve ni n'interdit la remise (la
  cohérence avoir/remise reste une décision humaine) ; retour accepté seulement par un compte `stock.adjust`.

## Devis versionnés et conversion en facture (L1D07, 2026-10-23, codé, non exécuté)

Module `sales`, EN LIGNE seulement (commandes du bus central, sources `Direct`, corps validés par
`schemas/requests/http.json`). Un devis n'est ni une créance, ni un encaissement, ni une réserve de stock : il
n'entre pas dans la caisse du jour ni dans les rapports (`CashDayReport` ne lit que les factures émises et les
encaissements). Code : `app/Domain/Billing/{Quotes,QuoteReader}.php`, `app/Domain/Billing/Quotes/Handlers/*`,
`app/Http/Controllers/Api/V1/QuoteController.php`, `app/Http/Resources/QuotePresenter.php` ; écrans
`pages/sales/{Quotes,QuoteCreatePage,QuotePage,QuoteEditor,QuoteRevisions,QuoteConvertPanel}.vue`, domaine
`domain/billing/quote.ts`, lectures `app/services/quotes.ts`, PDF `documents/quotes/fromRevision.ts` (modèle
`templates/financial/quote.ts`, version serveur `quote.v1`).

| Route | Commande | Droit | Effet |
|---|---|---|---|
| `GET /quotes`, `GET /quotes/{id}` | — | `invoice.read` | liste (filtres état, dont EXPIRED calculé, et patient), détail avec révisions figées et provenance |
| `POST /quotes` | `CreateQuoteDraft` | `invoice.create` | brouillon : patient OU prospect (`prospect_contacts`, origine MANUAL, nom et téléphone) |
| `PATCH /quotes/{id}` | `UpdateQuoteDraft` | `invoice.create` | lignes et validité d'un brouillon ; créateur ou gérante |
| `POST /quotes/{id}/delete` | `DeleteQuoteDraft` | `invoice.create` | supprime un brouillon JAMAIS ÉMIS et ses lignes (chantier « CRUD des écrans », tranche 3a) ; créateur ou gérante ; version attendue ; devis émis, accepté, refusé, expiré ou converti : 409 (il se révise) ; audit `quote.draft_deleted`, pierre tombale `ARCHIVED` ; aucun numéro consommé |
| `POST /quotes/{id}/issue` | `IssueQuote` | `invoice.create` | numéro série `QUOTE` (`TEST-DEV-AAAA-NNNNNN`), révision 1 immuable, document PENDING |
| `POST /quotes/{id}/revisions` | `ReviseQuote` | `invoice.create` | révision N+1 avec motif, numéro inchangé, anciennes révisions et documents intacts |
| `POST /quotes/{id}/decision` | `RecordQuoteDecision` | `invoice.create` | ACCEPTED (émis et valable) ou DECLINED ; aucune facture, aucun paiement |
| `POST /quotes/{id}/conversions` | `ConvertQuote` | `invoice.create` | BROUILLON de facture (`invoices.quote_id`) depuis une révision choisie |

Décisions :

- Aucune permission « devis » n'existe au référentiel : les écritures exigent `invoice.create`, les lectures
  `invoice.read` (gérante et caisse avec le seed). Le profil restreint `exam_fee.collect` n'établit pas de devis.
- Les lignes passent par `DraftLines` (mêmes règles qu'un brouillon de facture) avec les droits de l'auteur ; un
  dépassement est refusé en 422 `APPROVAL_REQUIRED_OR_EXPIRED` (pas de demande d'approbation sur un devis : la
  gérante l'établit elle-même). À l'émission et à la conversion, les lignes sont recalculées en `DraftPolicy::trusted()`
  (écrites sous les droits de leur auteur, comme l'émission d'une facture).
- Révision 1 : motif enregistré « Émission du devis » (colonne obligatoire). Les révisions sont dans `quote_revisions`
  (immuable, garde du schéma) ; `quote_lines` porte les lignes ACTUELLES. Chaque révision a son document
  (`generated_documents`, `quote_id`, `revision_no`, source `quote:<id>`) : réimpression identique d'une ancienne
  révision depuis son snapshot.
- Validité obligatoire à l'émission et à la révision, au plus tôt le jour du cabinet. L'expiration n'est jamais écrite :
  `effective_status` vaut EXPIRED à la lecture ; un devis expiré ne s'accepte ni ne se convertit, une révision le ravive.
- Conversion : `prices_confirmed` = true obligatoire (contrat) et `price_basis` explicite (`QUOTE` : prix et remises de
  la révision ; `CATALOG` : prix actuel sans remise, une ligne hors catalogue garde le prix du devis) ; l'écran montre
  l'écart ligne par ligne (prix actuels relus par la recherche du catalogue) et l'audit consigne le nombre d'écarts.
  Même clé d'idempotence : même réponse ; autre clé sur un devis converti : 409 avec `details.invoice_id` ; un
  brouillon issu du devis puis abandonné rouvre la conversion. Pour un prospect, `patient_id` désigne le dossier qui
  reçoit la facture et le prospect le rejoint (`prospect_contacts.patient_id`).
- Verrous : séquence (40), dossier patient (45), devis (55, rang ajouté à `LockRank`), facture (60).
- Préfixe `EEO_NUMBER_PREFIX_QUOTE` (défaut `TEST-DEV`) à choisir avec la gérante (Q03).

À confirmer par la cliente : usage réel des devis en L1 (« activé si retenu »), mentions légales du devis, durée de
validité habituelle (aucune n'est proposée par défaut), préfixe définitif, base de prix par défaut à la conversion.

Reste : abandon d'un brouillon de devis (aucun statut ABANDONED au schéma), aperçu PDF d'un brouillon, envoi du devis
au client (L2, messages réels interdits en développement), lien « Établir un devis » depuis la fiche patient.

Tests écrits (non exécutés) : `tests/Feature/Billing/QuotesTest.php`, matrice des droits dans
`BillingRoutesGateTest`, `tests/Unit/Billing/BillingNumbersTest.php` (série QUOTE), `tests/frontend/billing/quote.test.ts`,
`tests/e2e/quotes.spec.ts`, fixtures `contracts/fixtures/resources/{quote,convert-quote}.*.json`.

## Dépenses, mouvements de caisse et revue d'écart (L1D05)

Code : `app/Domain/Cash/CashMovements.php`, `Handlers/{RecordCashMovement,SaveExpenseCategory,ReviewCashVariance}Handler.php`,
`app/Http/Controllers/Api/V1/CashMovementController.php`, approbation `CASH_MOVEMENT` (`ApprovalKind`, `ApprovalSubject`,
`ApprovalTargets`) ; écrans `pages/cash/{Expenses,ExpenseCategories,VarianceReview}.vue`, règles `domain/cash/movements.ts`.
État : codé le 2026-10-23, non exécuté (vérification de fin de lot). Tests écrits : `tests/Feature/Billing/CashMovementsTest.php`,
`tests/frontend/domain/cash-movements.test.ts`.

- Natures : dépense catégorisée, retrait (versement, coffre), dépôt, correction de l'ouverture (correction historique,
  signe libre, PAS une sortie réelle). Montant signé : entrée positive, sortie négative ; jamais un paiement (ni facture,
  ni reçu, ni chiffre d'affaires) ; il entre dans les espèces théoriques (`CashClosing::theoretical`).
- Session OUVERTE seulement : une session clôturée est figée (409 `CLOSED`, trigger `tr_cash_movements_insert_session`) ;
  une sortie ne dépasse jamais les espèces théoriques (422, `details.available`).
- Autorisation : caissière dans sa session avec l'approbation exacte de la gérante (session, nature, montant signé,
  catégorie), consommée une fois ; gérante en exécution directe (approbation écrite décidée et consommée). Mouvement
  immuable, audité (`cash.movement_recorded`).
- Catégories : créées par la gérante, code unique figé, désactivation sans suppression ; aucune préconfigurée.
- Revue d'écart : la gérante accepte ou conteste (note obligatoire) l'écart d'une session clôturée, une fois, mot de
  passe confirmé ; fait d'audit `cash.variance_reviewed`, la clôture n'est pas réécrite.

| Point | Décision / état |
| --- | --- |
| Mouvement depuis la caisse hors-ligne | Refusé (en ligne seulement) jusqu'à O05 vérifié. |
| Justificatif scanné d'une dépense | Référence texte seulement (`reference`) : aucune colonne de fichier dans `cash_movements`. |
| Export de gestion des dépenses | L1D09. |
| À confirmer avec la cliente | Liste des catégories ; plafond éventuel d'une dépense sans approbation ; qui peut enregistrer un dépôt. |

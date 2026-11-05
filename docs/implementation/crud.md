# Modifier, supprimer, archiver : inventaire entité par entité (chantier « CRUD des écrans »)

Demande du cabinet (2026-10-30) : « préparer les CRUD pour la plupart des opérations… partout où c'est pertinent », à
partir d'un examen de test resté en brouillon que rien ne permettait de supprimer. Ce document est l'inventaire de
l'existant (serveur et écrans), la règle retenue pour chaque entité et ce que les tranches suivantes ajoutent. Il ne
décrit que ce qui existe dans le code au 2026-10-30 ; il se relit à partir de `routes/api.php`, des actions de
`app/Domain/**/Handlers`, des états du schéma (`database/01_schema.sql`) et des écrans de `resources/frontend/pages`.

## Principe

« Supprimer » n'a de sens que pour un **brouillon jamais utilisé**. Partout ailleurs le bon geste est **archiver**,
**désactiver**, **annuler** (avec motif) ou **corriger par une pièce contraire**. C'est ce que disent les sources et les
invariants : `specifications/03` (« une facture brouillon peut être abandonnée, une facture émise est corrigée par avoir »,
« conserver le paiement et sa contre-écriture »), `specifications/21` (« triggers du script 04 : modifications et
suppressions de snapshots et pièces finalisés refusées »), `specifications/02` (« terminer fige une version ; une correction
exige motif, auteur et nouvelle version »), `docs/implementation/access.md` (« un compte n'est jamais supprimé : il est
désactivé »). Aucune tranche ne supprime ni ne modifie une pièce financière émise, un encaissement, un reçu, un avoir, un
remboursement, une approbation, le journal d'audit, un mouvement de stock, une séance de caisse close, un patient, un
examen terminé ou une version validée de prescription.

Toute action passe par le chemin central de commandes (clé d'idempotence, verrous, audit, journal des changements) ; la
règle est appliquée par le **serveur** (409 `STATE_TRANSITION_REFUSED` hors état admis, 403 hors droit, 409
`VERSION_CONFLICT` si la pièce a changé) ; l'écran ne fait que montrer ou cacher le bouton. Aucune permission n'est créée
ou élargie sans être écrite dans `access.md` et testée côté serveur ET côté écran. Un « supprimer » est une vraie
suppression de ligne seulement quand rien ne la référence (clés étrangères, pièces, documents) ; il laisse toujours une
trace d'audit sans contenu et une pierre tombale `ARCHIVED` au journal des changements.

Légende : ✔ existe (serveur et écran) · S serveur seulement · ✘ interdit par un invariant · ➕ à ajouter dans ce chantier ·
— sans objet.

## Matrice

| Entité (table) | Créer | Lire | Modifier | Supprimer ou équivalent | Règle retenue | Tranche |
| --- | --- | --- | --- | --- | --- | --- |
| Patients (`patient_records`) | ✔ `CreatePatient` | ✔ recherche, fiche, activité | ✔ `UpdatePatient` (`patient.update` : gérante, accueil ; version attendue ; avant/après dans l'audit) | ✘ supprimer · ✔ fusionner (`MergePatients`, `patient.merge`, gérante) · ✘ archiver : écarté par le demandeur le 2026-10-30, « fusion seule » (`archived_at` est lue par la fusion, la recherche, l'arrivée et l'examen, mais aucune commande ne l'écrit, et aucune ne sera ajoutée) | Identité durable : jamais supprimée ni archivée. Un doublon se retire par la fusion, jamais autrement (garde-fous : visite ouverte, examen en cours, brouillon de facture, rendez-vous à venir) | — |
| Visites, file du jour (`visits`) | ✔ `RegisterVisit` | ✔ file, activité | — (le statut suit les événements) | ✘ supprimer · ✔ annuler avant l'examen (`CancelVisit`, motif) · ✔ retour à l'état d'avant quand l'examen brouillon est supprimé | Une arrivée est un fait : elle s'annule, elle ne disparaît pas | 1 |
| Consultations (`consultations`) | ✔ `StartConsultation` | ✔ liste, dossier | ✔ `SaveClinicalStep` (brouillon, en cours) · ✔ `AmendConsultation` (terminé : nouvelle révision) · ✔ bouton « Modifier » | ✔ **brouillon seulement** : `DeleteConsultationDraft` · ✘ en cours · ✘ terminé | Un brouillon (aucune rubrique) n'a aucune valeur clinique ; dès qu'une rubrique est enregistrée l'examen se poursuit, une fois terminé il se corrige par révision | 1 |
| Prescriptions optiques (`optical_prescriptions`, yeux, traitements) | ✔ brouillon interne, ordonnance externe, nouvelle version | ✔ | ✔ `UpdatePrescriptionDraft` (brouillon) | ✔ brouillon : `DeletePrescriptionDraft` (tranche 3a) · ✘ validée (immuable, déclencheurs SQL) | Une validée se corrige par une nouvelle version (`supersedes_id`). Un brouillon jamais utilisé (ni ligne de facture, ni commande d'atelier, ni document) se supprime ; un brouillon qui est la version suivante d'une validée se supprime aussi (la validée reste) | 3a |
| Devis (`quotes`, `quote_lines`, `quote_revisions`) | ✔ `CreateQuoteDraft` | ✔ | ✔ `UpdateQuoteDraft` (brouillon ; créateur ou gérante) · ✔ `ReviseQuote` (émis) · ✔ décision · ✔ conversion en brouillon de facture | ✔ brouillon jamais émis : `DeleteQuoteDraft` (tranche 3a) · ✘ émis (révision, refus, expiration) | Le statut n'a pas de valeur « abandonné » : un brouillon sans numéro ni révision se supprime, par son créateur ou la gérante (même droit que la modification) ; un devis émis se révise | 3a |
| Factures (`invoices`, lignes) | ✔ `CreateInvoiceDraft` | ✔ | ✔ `UpdateDraft` (brouillon ; créateur ou gérante) | ✔ brouillon : abandon (`AbandonInvoiceDraft`, statut `ABANDONED`, lignes conservées, aucun numéro) · ✘ émise | Une facture émise ne change jamais : avoir, contre-écriture, remboursement (lignes suivantes) | — |
| Encaissements, reçus (`payments`, `receipts`) | ✔ `RegisterPayment` | ✔ | ✘ | ✘ supprimer · ✔ contre-écriture (`ReversePayment`) | Un reçu n'est jamais renuméroté ni supprimé ; l'erreur se corrige par une contre-écriture liée au paiement | — |
| Avoirs (`credit_notes`) | ✔ `IssueCreditNote` | ✔ | ✘ | ✘ | Correction d'une facture émise ; jamais modifié | — |
| Remboursements (`refunds`) | ✔ `RefundCredit` | ✔ | ✘ | ✘ | Limité au crédit à rembourser ; jamais modifié | — |
| Approbations (`approvals`) | ✔ `RequestApproval` | ✔ | ✔ décision (`DecideApproval`) | ✘ (expirée ou consommée, une seule fois) | Trace de contrôle de la gérante : append-only | — |
| Caisse (`cash_sessions`, `cash_movements`, `expense_categories`) | ✔ ouvrir, mouvement, catégorie | ✔ | ✔ catégories (renommer, désactiver : écran ✔) | ✘ séance close, mouvement · ✔ revue d'écart (`ReviewCashVariance`) | Séance close figée ; correction = mouvement contraire ou revue de la gérante | — |
| Catalogue (`catalog_items`, `tax_rules`) | ✔ `CreateCatalogItem`, `CreateTaxRule`, import | ✔ | ✔ `UpdateCatalogItem` (écran « Modifier »), `UpdateTaxRule` | ✘ supprimer · ✔ désactiver (« Article actif ») | Les lignes de facture gardent désignation, prix et taxe figés : un article utilisé ne disparaît pas ; désactivé, il n'est plus proposé | — |
| Stock (`stock_movements`, livraisons, retours) | ✔ réception, ajustement, stock initial, remise, retour | ✔ | ✘ | ✘ (déclencheurs SQL) · ✔ ajustement validé | Le stock se corrige par un mouvement, jamais par une réécriture | — |
| Rendez-vous (`appointments`) | ✔ `CreateAppointment` | ✔ | ✔ déplacer (`RescheduleAppointment`) · ✔ absent | ✘ supprimer · ✔ annuler (motif obligatoire) | Un rendez-vous annulé reste lisible, son créneau se libère, ses rappels sont clos | — |
| Suivis (`follow_up_plans`, `contact_tasks`) | ✔ `CreateFollowUp` | ✔ | — (un contrôle se remplace : on l'annule, puis on en programme un autre) | ✔ annuler un contrôle actif (`CancelFollowUp`, statut `CANCELLED` avec motif, tranche 3a ; `CLOSED` n'est écrit par aucune commande) | Un contrôle ne se supprime pas ; il s'annule avec motif, ses tâches de rappel ouvertes sont closes. Un contrôle déjà programmé en rendez-vous s'annule d'abord par le rendez-vous | 3a |
| Tâches de contact (`contact_tasks`) | ✔ créées avec le suivi | ✔ | ✔ tentatives (`RecordContactAttempt`) | ✘ | Journal des tentatives : append-only | — |
| Agenda, configuration (ressources, prestations, horaires, fermetures) | ✔ | ✔ | ✔ (désactivation ✔) | ✘ fermeture (exception immuable : une erreur se corrige par l'exception inverse) | Configuration : désactiver plutôt que supprimer | — |
| Utilisateurs (`users`) | ✔ `CreateStaffMember` | ✔ | ✔ `UpdateStaffMember` (nom, courriel, profils, activation) | ✘ supprimer · ✔ désactiver (sessions fermées) | « Un compte n'est jamais supprimé : il est désactivé » (`access.md`) ; le cabinet garde une gérante active | — |
| Profils, dérogations (`user_roles`, `user_permissions`) | ✔ | ✔ | ✔ | ✘ (révocation datée, ligne conservée) | Historique des droits complet dans l'audit | — |
| Paramètres du cabinet (`clinics`) | — | ✔ | ✔ `UpdateClinicSettings` (gérante) | — | Modifiable par la gérante, audité | — |
| Documents générés (`generated_documents`) | ✔ à la validation ou l'émission | ✔ aperçu, téléchargement | ✘ (contenu écrit une fois) | ✘ (déclencheurs SQL) | Un document figé n'est jamais recalculé ; une correction produit un nouveau document | — |
| Exports (`export_requests`) | ✔ `RequestExport` | ✔ liste, téléchargement | ✘ | ✘ | Demande tracée ; archive produite par la tâche planifiée | — |

Hors inventaire : le module `offline` (postes, grants, journal local : fermé en production), l'import des soldes
d'ouverture (opération unique de la gérante, preuve conservée) et les tables techniques (idempotence, audit, outbox,
journal des changements), qui sont append-only.

## Déjà en place, à garder visible

Ces gestes existent et ne demandent aucun travail : annuler une visite, abandonner un brouillon de facture, annuler,
déplacer ou marquer absent un rendez-vous, désactiver un article, une catégorie de dépenses, une ressource ou une
prestation, désactiver un compte. Le chantier ne les modifie pas ; leur aide intégrée est déjà à jour.

## Tranches

1. **Consultations** (livrée, en ligne le 2026-10-30) : `clinical.md`, « Modifier et supprimer un examen ».
2. **Cet inventaire.**
3. **Implémentation** : 3a, brouillons (faite) : `DeletePrescriptionDraft`, `DeleteQuoteDraft`, `CancelFollowUp`, avec leurs
   écrans, leur aide intégrée et leurs tests ; 3b, archivage du patient (`ArchivePatient`, `RestorePatient`), écarté par
   le demandeur le 2026-10-30 (« fusion seule » : rien à écrire). Chaque commande suit le modèle de la tranche 1 : chemin central, version attendue, audit sans contenu
   clinique, refus explicite (409/403) dans tous les autres cas, contrat généré, aide intégrée, tests PHPUnit, Vitest et
   Playwright.

### Décisions retenues pour la tranche 3 (à confirmer par le demandeur)

- **Brouillon de prescription** : droit de la modification d'un brouillon (`clinical.write` et `clinical.read`), en ligne
  seulement. Aucun auteur n'est conservé sur un brouillon : toute personne qui peut le modifier peut le supprimer.
- **Brouillon de devis** : son créateur ou la gérante, comme la modification (`UpdateQuoteDraft`).
- **Annulation d'un contrôle recommandé** : `follow_up.write` et `clinical.read`, motif obligatoire (information d'accueil,
  3 à 1 000 caractères comme l'annulation d'un rendez-vous).
- **Archivage d'un patient** : ÉCARTÉ par le demandeur le 2026-10-30 (« Non, fusion seule »). Proposition refusée : la gérante (`patient.merge`, « après revue » : aucune permission nouvelle), motif obligatoire,
  réversible, mêmes garde-fous que la fusion. Rien n'est écrit : un doublon se retire par la fusion (`MergePatients`).

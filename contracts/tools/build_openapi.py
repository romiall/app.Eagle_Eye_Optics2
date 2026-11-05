"""Contrat OpenAPI 3.1 de l'API privée et des routes publiques (F06).

Source unique de contracts/openapi.yaml : routes du fichier 08, compléments du contrat 23, protocole du
fichier 19, routes F05 implémentées et routes nécessaires aux tâches du backlog (catalogue, imports,
statistiques, audit). Chaque opération porte :
  - x-permission : code(s) de permission seedé(s) exigé(s) (l'un suffit), vérifiés côté serveur ;
  - x-reauthentication : réauthentification récente exigée ;
  - x-idempotency : required (en-tête Idempotency-Key) ou none ;
  - x-offline-command : commande du journal local équivalente (contracts/commands/index.json) ;
  - x-read-scope : rubriques renvoyées selon le profil ;
  - x-implementation-status : IMPLEMENTED (code et tests présents) ou PLANNED ;
  - x-backlog-task : tâche du fichier 24 qui implémente l'opération.
Les corps de requête et de réponse sont des $ref vers les JSON Schema de contracts/ (une seule définition,
validée en PHP et en TypeScript).

Le YAML est écrit par un émetteur minimal et déterministe (chaînes entre guillemets JSON, valides en
YAML 1.2), sans dépendance : la CI vérifie le fichier par --check.

  python3 contracts/tools/build_openapi.py          # écrit contracts/openapi.yaml
  python3 contracts/tools/build_openapi.py --check  # échoue si le fichier est absent ou périmé (CI)
"""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'contracts' / 'openapi.yaml'
COMMANDS = json.loads((ROOT / 'contracts' / 'commands' / 'index.json').read_text(encoding='utf-8'))['const']

ACCESS = './schemas/resources/access.json#/$defs/'
PATIENTS = './schemas/resources/patients.json#/$defs/'
CLINICAL = './schemas/resources/clinical.json#/$defs/'
BILLING = './schemas/resources/billing.json#/$defs/'
STOCK = './schemas/resources/stock.json#/$defs/'
SCHEDULING = './schemas/resources/scheduling.json#/$defs/'
OPERATIONS = './schemas/resources/operations.json#/$defs/'
PUBLIC = './schemas/resources/public.json#/$defs/'
REQUESTS = './schemas/requests/http.json#/$defs/'


def command_body(name):
    return './commands/' + name + '.v1.json#/$defs/DirectRequest'


def op(method, path, operation_id, summary, tag, *, permission=None, reauth=False, idempotent=None, command=None,
       request=None, request_type='application/json', response=None, status=200, read_scope=None, implemented=False,
       task=None, params=(), errors=(), security='session', description=None):
    return {
        'method': method, 'path': path, 'operation_id': operation_id, 'summary': summary, 'tag': tag,
        'permission': permission, 'reauth': reauth,
        'idempotent': idempotent if idempotent is not None else (method in ('post', 'patch') and security == 'session'),
        'command': command, 'request': request if request is not None else (command_body(command) if command else None),
        'request_type': request_type, 'response': response, 'status': status, 'read_scope': read_scope,
        'implemented': implemented, 'task': task, 'params': params, 'errors': errors, 'security': security,
        'description': description,
    }


ID = ('path', 'id', 'Identifiant ULID de la ressource.')
PAGE = ('query', 'page', 'Page (pagination, 1 par défaut).')

OPERATIONS_TABLE = [
    # --- Session (F05, implémenté) -------------------------------------------------------------------
    op('get', '/sanctum/csrf-cookie', 'GetCsrfCookie', 'Initialiser la session et le jeton CSRF (cookie XSRF-TOKEN)', 'Session',
       status=204, implemented=True, task='F05', security='none', idempotent=False,
       description='Route de Sanctum : pose le cookie de session du sous-domaine et XSRF-TOKEN, renvoyé ensuite dans X-XSRF-TOKEN.'),
    op('post', '/v1/auth/login', 'Login', 'Se connecter dans le cabinet configuré', 'Session',
       request=REQUESTS + 'LoginRequest', response=ACCESS + 'MeResponse', implemented=True, task='F05', security='csrf',
       idempotent=False, errors=(400, 422, 429, 503),
       description='Réponse identique pour tout échec (422) ; limites par adresse et par identifiant (429) ; session régénérée.'),
    op('post', '/v1/auth/logout', 'Logout', 'Se déconnecter (session détruite, jeton CSRF renouvelé)', 'Session',
       status=204, implemented=True, task='F05', idempotent=False),
    op('get', '/v1/auth/me', 'GetMe', 'Compte connecté, profils, permissions effectives et cabinet', 'Session',
       response=ACCESS + 'MeResponse', implemented=True, task='F05'),
    op('post', '/v1/auth/reauthenticate', 'Reauthenticate', 'Confirmer son mot de passe pour une opération sensible', 'Session',
       request=REQUESTS + 'ReauthenticateRequest', response=ACCESS + 'ReauthenticationResponse', implemented=True, task='F05',
       idempotent=False, errors=(422, 429)),
    op('post', '/v1/auth/password', 'ChangeOwnPassword', 'Changer son mot de passe (session courante conservée)', 'Session',
       request=REQUESTS + 'ChangePasswordRequest', status=204, implemented=True, task='F05', idempotent=False, errors=(409, 422, 429)),

    # --- Cabinet et comptes (F05, implémenté) --------------------------------------------------------
    op('get', '/v1/clinic/settings', 'GetClinicSettings', 'Paramètres administratifs du cabinet', 'Cabinet et comptes',
       permission=['users.manage'], response=ACCESS + 'ClinicSettingsResponse', implemented=True, task='F05'),
    op('patch', '/v1/clinic/settings', 'UpdateClinicSettings', 'Modifier les paramètres administratifs du cabinet', 'Cabinet et comptes',
       permission=['users.manage'], reauth=True, idempotent=False, request=REQUESTS + 'UpdateClinicSettingsRequest',
       response=ACCESS + 'ClinicSettingsResponse', implemented=True, task='F05', errors=(422,),
       description='Idempotence par clé reportée au chemin central F07 ; fuseau, monnaie et production_documents_enabled refusés.'),
    op('get', '/v1/clinic/document-identity', 'GetClinicDocumentIdentity', 'Identité du cabinet imprimée sur les documents', 'Cabinet et comptes',
       permission=['invoice.read', 'invoice.create', 'invoice.issue', 'payment.collect', 'cash.own_session', 'cash.manage',
                   'credit_note.issue', 'refund.execute', 'finance.global.read', 'clinical.read', 'clinical.export'],
       response=ACCESS + 'ClinicDocumentIdentityResponse', implemented=True, task='D02',
       description='En-tête et pied des documents (nom, coordonnées, identifiant fiscal, mentions professionnelles, réglages des documents, documents de test ou non) : lisible par tout profil qui produit un document (l\'un des droits suffit), pas seulement par la gérante. Ne dépend d\'aucun module. Les paramètres administratifs complets restent sur /clinic/settings (gérante).'),
    op('get', '/v1/staff', 'ListStaff', 'Comptes du personnel du cabinet', 'Cabinet et comptes',
       permission=['users.manage'], response=ACCESS + 'StaffMemberPage', implemented=True, task='F05', params=(PAGE,)),
    op('post', '/v1/staff', 'CreateStaffMember', 'Créer un compte nominatif', 'Cabinet et comptes',
       permission=['users.manage'], reauth=True, idempotent=False, request=REQUESTS + 'CreateStaffRequest',
       response=ACCESS + 'StaffMemberResponse', status=201, implemented=True, task='F05', errors=(422,)),
    op('get', '/v1/staff/{id}', 'GetStaffMember', 'Compte du personnel', 'Cabinet et comptes',
       permission=['users.manage'], response=ACCESS + 'StaffMemberResponse', implemented=True, task='F05', params=(ID,)),
    op('patch', '/v1/staff/{id}', 'UpdateStaffMember', 'Modifier nom, courriel, profils ou activation', 'Cabinet et comptes',
       permission=['users.manage'], reauth=True, idempotent=False, request=REQUESTS + 'UpdateStaffRequest',
       response=ACCESS + 'StaffMemberResponse', implemented=True, task='F05', params=(ID,), errors=(409, 422)),
    op('post', '/v1/staff/{id}/permissions', 'SetStaffPermissionOverride', 'Dérogation nominative datée et motivée', 'Cabinet et comptes',
       permission=['users.manage'], reauth=True, idempotent=False, request=REQUESTS + 'PermissionOverrideRequest',
       response=ACCESS + 'StaffMemberResponse', implemented=True, task='F05', params=(ID,), errors=(409, 422)),
    op('post', '/v1/staff/{id}/password', 'ResetStaffPassword', 'Réinitialiser le mot de passe d\'un compte (hors gérante)', 'Cabinet et comptes',
       permission=['users.manage'], reauth=True, idempotent=False, request=REQUESTS + 'ResetPasswordRequest', status=204,
       implemented=True, task='F05', params=(ID,), errors=(409, 422)),

    # --- Patients et visites -------------------------------------------------------------------------
    op('get', '/v1/patients', 'SearchPatients', 'Rechercher des patients (identité administrative)', 'Patients',
       permission=['patient.read'], response=PATIENTS + 'PatientPage', implemented=True, task='P02', errors=(404, 422, 429),
       params=(('query', 'query', 'Nom, numéro de dossier ou téléphone (recherche normalisée, 2 caractères au moins).'), PAGE)),
    op('post', '/v1/patients', 'CreatePatient', 'Créer un patient (numéro central)', 'Patients',
       permission=['patient.create', 'patient.read'], command='CreatePatient', response=PATIENTS + 'PatientResponse', status=201,
       implemented=True, task='P01', errors=(404, 409, 422),
       description='Rend la fiche créée : exige aussi patient.read. Module patients fermé : 404.'),
    op('get', '/v1/patients/{id}', 'GetPatient', 'Dossier administratif', 'Patients',
       permission=['patient.read'], response=PATIENTS + 'PatientResponse', implemented=True, task='P01', params=(ID,), errors=(404,)),
    op('patch', '/v1/patients/{id}', 'UpdatePatient', 'Modifier l\'identité (version attendue)', 'Patients',
       permission=['patient.update', 'patient.read'], command='UpdatePatient', response=PATIENTS + 'PatientResponse', implemented=True,
       task='P01', params=(ID,), errors=(404, 409, 422),
       description='Rend la fiche modifiée : exige aussi patient.read.'),
    op('get', '/v1/patients/{id}/history', 'GetPatientHistory', 'Historique du patient filtré par profil', 'Patients',
       permission=['patient.read'], response=PATIENTS + 'PatientHistoryResponse', task='P02', params=(ID,),
       read_scope={'ADMINISTRATIVE': 'visits', 'CLINICAL': 'consultations (clinical.read)', 'FINANCIAL': 'invoices (invoice.read)'}),
    op('get', '/v1/patients/{id}/activity', 'GetPatientActivity', 'Activité du patient (visites, examens, ordonnances, pièces)', 'Patients',
       permission=['patient.read'], response=PATIENTS + 'PatientActivity', implemented=True, task='R02', errors=(404, 422),
       params=(ID, ('query', 'section', 'Filtre facultatif : VISITS, EXAMS, PRESCRIPTIONS ou FINANCIAL (section visible du compte, 403 sinon).'), PAGE),
       read_scope={'ADMINISTRATIVE': 'VISITS (patient.read)', 'CLINICAL': 'EXAMS, PRESCRIPTIONS (clinical.read, module consultations)',
                   'FINANCIAL': 'FINANCIAL (invoice.read, module sales)'},
       description='Module patients. Lecture seule, du plus récent au plus ancien, 25 éléments par page. Une section non autorisée est absente : ni ses éléments, ni son compte (meta.sections), ni sa mention. Aucune valeur clinique : identifiants, dates, états, numéros. Pièces : factures émises (solde projeté, jamais « payé » stocké), reçus, avoirs émis, remboursements ; brouillons et pièces abandonnées exclus. screen_path : adresse de l\'écran qui ouvre l\'élément, seulement si le compte peut l\'ouvrir.'),
    op('get', '/v1/patients/{id}/merge-preview', 'PreviewPatientMerge', "Aperçu de la fusion d'une fiche dans une autre", 'Patients',
       permission=['patient.merge', 'patient.read'], response=PATIENTS + 'PatientMergePreviewResponse', implemented=True, task='L1D08',
       params=(ID, ('query', 'into', 'Identifiant de la fiche conservée.')), errors=(404, 422),
       description="Module patients. {id} est la fiche ABSORBÉE. Lecture seule : identités côte à côte, éléments rattachés (comptes filtrés par les droits du compte), garde-fous (visite ou examen en cours, brouillon de facture, rendez-vous à venir, fiche déjà fusionnée, fiche conservée archivée ou fusionnée). Jamais de fusion automatique."),
    op('post', '/v1/patients/{id}/merge', 'MergePatients', "Fusionner une fiche dans une autre (gérante, après revue)", 'Patients',
       permission=['patient.merge'], reauth=True, request=REQUESTS + 'MergePatientsRequest', response=PATIENTS + 'PatientMergeResponse',
       status=201, implemented=True, task='L1D08', params=(ID,), errors=(404, 409, 422, 423),
       description="Module patients, en ligne seulement, mot de passe confirmé récemment (423 sinon). {id} est la fiche absorbée (identique à source_patient_id, 422 sinon) ; version attendue = sa version (409 VERSION_CONFLICT). Un garde-fou de l'aperçu : 409 STATE_TRANSITION_REFUSED avec details.current_status. Aucune réécriture de l'historique : visites, consultations, prescriptions et pièces gardent leur fiche d'origine et leurs snapshots ; la fiche absorbée est marquée fusionnée (merged_into_patient_id), disparaît de la recherche et refuse toute nouvelle arrivée, facture ou rendez-vous ; l'activité de la fiche conservée inclut celle des fiches absorbées. Fusion immuable (patient_merges) et auditée (patient.merged)."),
    op('post', '/v1/visits', 'RegisterVisit', 'Enregistrer une arrivée', 'Patients',
       permission=['visit.register'], command='RegisterVisit', response=PATIENTS + 'VisitResponse', status=201, implemented=True,
       task='P03', errors=(409, 422)),
    op('get', '/v1/visits', 'ListVisits', 'Visites d\'une journée', 'Patients',
       permission=['visit.register', 'agenda.read'], response=PATIENTS + 'VisitPage', implemented=True, task='P03', errors=(422,),
       description="Lecture ouverte à qui détient l’une OU l’autre des permissions listées (middleware any-permission).",
       params=(('query', 'date', 'Date civile AAAA-MM-JJ (fuseau du cabinet).'), PAGE)),
    op('post', '/v1/visits/{id}/cancel', 'CancelVisit', 'Annuler une visite avant l\'examen', 'Patients',
       permission=['visit.register'], request=REQUESTS + 'CancelVisitRequest', response=PATIENTS + 'VisitResponse',
       implemented=True, task='P03', params=(ID,), errors=(404, 409, 422),
       description='Module today, en ligne seulement. Version attendue = version de la visite (409 VERSION_CONFLICT avec current_version). Seulement avant l\'examen (ARRIVED, AWAITING_EXAM_FEE, READY_FOR_EXAM) ; examen démarré, visite close ou déjà annulée, ou facture non abandonnée liée à la visite : 409 STATE_TRANSITION_REFUSED avec details.current_status. Motif obligatoire (3 à 500 caractères), conservé dans l\'audit. La visite reste dans la file, marquée annulée ; rien n\'est supprimé. L\'identifiant du corps doit être celui de l\'adresse.'),

    # --- Clinique ------------------------------------------------------------------------------------
    op('post', '/v1/visits/{id}/consultations', 'StartConsultation', 'Démarrer l\'examen', 'Clinique',
       permission=['clinical.write', 'clinical.read'], command='StartConsultation', response=CLINICAL + 'ConsultationResponse', status=201,
       implemented=True, task='P03', params=(ID,), errors=(404, 409, 422),
       description='Rend la consultation (relue, même au rejeu de la clé), donc exige aussi clinical.read. Module consultations. Paiement de l\'examen : contrôle inactif par défaut (EEO_EXAM_FEE_CONTROL=off : NOT_CONTROLLED dans l\'audit, exam_invoice_id et exam_waiver_approval_id refusés en 422 s\'ils sont fournis) ; contrôle actif (billed) : la facture de frais de CETTE visite réglée, ou la dispense exacte de la gérante (désignée, ou retrouvée par son contenu exact quand exam_waiver_approval_id est null) consommée dans la transaction, sinon 422 EXAM_PAYMENT_REQUIRED ; dispense désignée invalide, échue ou déjà utilisée : 422 APPROVAL_REQUIRED_OR_EXPIRED. Visite EXAM ou FOLLOW_UP au statut ARRIVED ou READY_FOR_EXAM (contrôle actif : aussi AWAITING_EXAM_FEE, qui reçoit alors 422 EXAM_PAYMENT_REQUIRED tant que rien ne prouve le règlement), une seule consultation par visite (409 STATE_TRANSITION_REFUSED sinon). L\'identifiant de la visite du chemin doit être celui du corps (422).'),
    op('get', '/v1/consultations', 'ListConsultations', 'Examens du cabinet (liste sans valeur clinique)', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'ConsultationSummaryPage', implemented=True, task='C01', errors=(404, 422, 429),
       params=(('query', 'date', 'Jour civil AAAA-MM-JJ (fuseau du cabinet) de la date effective ; absent : tous les jours.'),
               ('query', 'status', 'DRAFT, IN_PROGRESS ou COMPLETED.'),
               ('query', 'mine', 'true : seulement les examens du professionnel connecté.'), PAGE),
       description='Module consultations. 50 examens par page, du plus récent au plus ancien (date effective). Patient (identité administrative de base), état, dates, révision et professionnel : aucune valeur clinique, aucune lecture tracée (le dossier s\'ouvre par GET /consultations/{id}, tracé). Même limite de débit par compte que les lectures de dossier (429 RATE_LIMITED).'),
    op('get', '/v1/consultations/{id}', 'GetConsultation', 'Consultation complète', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'ConsultationResponse', implemented=True, task='C01', params=(ID,), errors=(404, 429),
       description='Module consultations. Relit les tables vivantes au format AllSteps (sept rubriques) dans un instantané cohérent ; une rubrique sans saisie est rendue vide. patient : identité administrative de base. La lecture est tracée dans l\'audit (consultation.viewed), sans contenu, au plus une fois par compte et par consultation toutes les 10 minutes ; il en va de même des réponses des écritures (elles rendent le dossier). Débit limité par compte (429 RATE_LIMITED).'),
    op('patch', '/v1/consultations/{id}/steps/{step}', 'SaveClinicalStep', 'Saisir une rubrique du dossier', 'Clinique',
       permission=['clinical.write', 'clinical.read'], command='SaveClinicalStep', response=CLINICAL + 'ConsultationResponse', implemented=True, task='C01',
       params=(ID, ('path', 'step', 'Rubrique : ANAMNESIS, HISTORIES, VISUAL_ACUITY, REFRACTION, CENTERING, MEDICATIONS, CONCLUSION.')), errors=(404, 409, 422),
       description='Rend la consultation, donc exige aussi clinical.read. Module consultations. Remplacement complet de la rubrique, version attendue (409 VERSION_CONFLICT). Les sept rubriques sont ouvertes (C01, C02, C04). Consultation terminée : 409 STATE_TRANSITION_REFUSED (la correction passe par AmendConsultation). Les identifiants du chemin (consultation, rubrique) doivent être ceux du corps (422).'),
    op('post', '/v1/consultations/{id}/complete', 'CompleteConsultation', 'Finaliser (révision 1 immuable)', 'Clinique',
       permission=['clinical.complete', 'clinical.read'], command='CompleteConsultation', response=CLINICAL + 'ConsultationResponse', implemented=True, task='C03', params=(ID,), errors=(404, 409, 422),
       description='Rend la consultation, donc exige aussi clinical.read. Module consultations. Snapshot complet et révision 1 dans la même transaction ; la visite passe à COMPLETED. snapshot_sha256 : SHA-256 de JCS(steps) tel que relu par le poste, que le serveur recalcule ; l\'empreinte de la révision (clinical_revisions.sha256) est celle de JCS(snapshot), calculée par le serveur. Consultation déjà terminée ou brouillon : 409 STATE_TRANSITION_REFUSED.'),
    op('post', '/v1/consultations/{id}/amendments', 'AmendConsultation', 'Corriger avec motif (nouvelle révision)', 'Clinique',
       permission=['clinical.amend', 'clinical.read'], command='AmendConsultation', response=CLINICAL + 'ConsultationResponse', status=201, implemented=True, task='C03', params=(ID,), errors=(404, 409, 422),
       description='Rend la consultation, donc exige aussi clinical.read. Module consultations. Nouvelle révision immuable (motif, auteur), révisions antérieures intactes ; chaque rubrique envoyée remplace la rubrique actuelle. snapshot_sha256 : SHA-256 de JCS(steps) de la requête, recalculé par le serveur.'),
    op('post', '/v1/consultations/{id}/delete', 'DeleteConsultationDraft', 'Supprimer un examen resté brouillon', 'Clinique',
       permission=['clinical.write', 'clinical.read'], request=REQUESTS + 'DeleteConsultationDraftRequest', response=CLINICAL + 'DeleteConsultationDraftResponse',
       implemented=True, task='C01', params=(ID,), errors=(403, 404, 409, 422),
       description='Module consultations, en ligne seulement. Brouillon uniquement (aucune rubrique enregistrée) : examen en cours ou terminé, rubrique, révision ou contrôle recommandé rattaché, prescription validée ou déjà utilisée (facture, atelier, document) : 409 STATE_TRANSITION_REFUSED avec details.current_status ; un examen terminé se corrige par AmendConsultation, jamais par une suppression. Le professionnel qui a démarré l\'examen ou la gérante (approval.decide) seulement : 403 pour un autre professionnel. Version attendue = version de la consultation (409 VERSION_CONFLICT avec current_version). Supprime aussi les prescriptions brouillon de l\'examen ; la visite revient à son état d\'avant l\'examen (ARRIVED, ou READY_FOR_EXAM / AWAITING_EXAM_FEE quand le paiement de l\'examen est contrôlé) ; les factures de la visite ne sont pas touchées. Audité (consultation.deleted : qui, quand, quelle consultation), sans contenu clinique ; publié au journal des changements comme ARCHIVED. Consultation déjà supprimée ou d\'un autre cabinet : 404. L\'identifiant du corps doit être celui de l\'adresse (422). Le rejeu de la même clé rend la réponse d\'origine.'),
    op('get', '/v1/consultations/{id}/revisions/{revision_no}', 'GetClinicalRevision', 'Révision figée d\'une consultation', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'ClinicalRevisionResponse', implemented=True, task='C03',
       params=(ID, ('path', 'revision_no', 'Numéro de la révision (entier ≥ 1).')), errors=(404, 429),
       description='Snapshot complet immuable tel qu\'enregistré. Module consultations. Lecture tracée (consultation.revision_viewed), sans contenu, au plus une fois par compte et par révision toutes les 10 minutes.'),
    op('get', '/v1/consultations/{id}/prescriptions', 'ListConsultationPrescriptions', 'Prescriptions optiques de la consultation (toutes versions)', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'PrescriptionList', implemented=True, task='C04', params=(ID,), errors=(404,),
       description='Module consultations. Toutes les versions, de la plus récente à la plus ancienne.'),
    op('post', '/v1/consultations/{id}/prescriptions', 'CreatePrescription', 'Prescription interne de la consultation', 'Clinique',
       permission=['clinical.write', 'clinical.read'], command='CreatePrescription', response=CLINICAL + 'PrescriptionResponse', status=201, implemented=True, task='C04', params=(ID,), errors=(404, 409, 422),
       description='Crée une prescription BROUILLON (version 1 d\'une nouvelle série). Module consultations. Rend la prescription : exige aussi clinical.read. Une consultation n\'a qu\'une série de prescriptions : les versions suivantes passent par /prescriptions/{id}/revisions. Rien n\'est recopié depuis la réfraction sans choix explicite du professionnel (l\'écran envoie les valeurs choisies).'),
    op('get', '/v1/patients/{id}/prescriptions', 'GetPatientPrescriptions', "Prescriptions optiques d'un patient", 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'PrescriptionList', implemented=True, task='C04', params=(ID,), errors=(404,),
       description='Module consultations. Toutes les versions des prescriptions du patient, internes et ordonnances externes transcrites (sans consultation), de la plus récente à la plus ancienne ; lecture tracée une fois par 10 minutes (patient.prescriptions_viewed).'),
    op('post', '/v1/prescriptions/external', 'CreateExternalPrescription', 'Transcrire une ordonnance externe identifiée (A13)', 'Clinique',
       permission=['clinical.write', 'clinical.read'], command='CreatePrescription', response=CLINICAL + 'PrescriptionResponse', status=201, implemented=True, task='C04', errors=(404, 409, 422),
       description='Même commande que la prescription interne, origin = EXTERNAL (prescripteur et date d\'origine obligatoires, aucune consultation fictive). Module consultations.'),
    op('get', '/v1/prescriptions/{id}', 'GetPrescription', 'Prescription versionnée', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'PrescriptionResponse', implemented=True, task='C04', params=(ID,), errors=(404,),
       description='Module consultations.'),
    op('patch', '/v1/prescriptions/{id}', 'UpdatePrescriptionDraft', 'Modifier une prescription encore brouillon (en ligne)', 'Clinique',
       permission=['clinical.write', 'clinical.read'], request=REQUESTS + 'UpdatePrescriptionDraftRequest', response=CLINICAL + 'PrescriptionResponse',
       implemented=True, task='C04', params=(ID,), errors=(404, 409, 422),
       description='Brouillon seulement (une prescription validée est immuable : 409 STATE_TRANSITION_REFUSED) ; jeton de concurrence expected_updated_at (409 VERSION_CONFLICT). Module consultations.'),
    op('post', '/v1/prescriptions/{id}/delete', 'DeletePrescriptionDraft', 'Supprimer une prescription encore brouillon (en ligne)', 'Clinique',
       permission=['clinical.write', 'clinical.read'], request=REQUESTS + 'DeletePrescriptionDraftRequest', response=CLINICAL + 'DeletePrescriptionDraftResponse',
       implemented=True, task='C04', params=(ID,), errors=(404, 409, 422),
       description='Module consultations, en ligne seulement ; même droit que la modification d\'un brouillon (aucun auteur n\'est conservé sur un brouillon). Brouillon seulement : une prescription validée est immuable (409 STATE_TRANSITION_REFUSED, elle se corrige par une nouvelle version), de même qu\'une prescription déjà utilisée par une ligne de facture, une commande d\'atelier ou un document. Jeton de concurrence expected_updated_at (409 VERSION_CONFLICT avec details.current_updated_at) ; expected_version vaut null. Les yeux et traitements du brouillon disparaissent avec lui. Audité (prescription.deleted : série, version, origine, consultation ; jamais une valeur clinique) ; publié au journal des changements comme ARCHIVED. Déjà supprimée ou d\'un autre cabinet : 404. L\'identifiant du corps doit être celui de l\'adresse (422).'),
    op('post', '/v1/prescriptions/{id}/revisions', 'RevisePrescription', 'Nouvelle version d\'une prescription (supersedes_id)', 'Clinique',
       permission=['clinical.amend', 'clinical.read'], command='CreatePrescription', response=CLINICAL + 'PrescriptionResponse', status=201, implemented=True, task='C04', params=(ID,), errors=(404, 409, 422),
       description='Nouvelle version BROUILLON de la dernière version validée de la série (supersedes_id = {id}). Module consultations.'),
    op('post', '/v1/prescriptions/{id}/validate', 'ValidatePrescription', 'Valider la prescription (version immuable)', 'Clinique',
       permission=['clinical.complete', 'clinical.read'], command='ValidatePrescription', response=CLINICAL + 'PrescriptionResponse', implemented=True, task='C04', params=(ID,), errors=(404, 409, 422),
       description='Validation explicite : version immuable et document PDF préparé (generated_documents PENDING, génération par le moteur de documents). Aucune vente ni mouvement de stock n\'est créé. Module consultations.'),
    op('get', '/v1/visual-acuity-scales', 'ListVisualAcuityScales', 'Échelles d\'acuité du cabinet', 'Clinique',
       permission=['clinical.read'], response=CLINICAL + 'VisualAcuityScaleList', implemented=True, task='C02',
       description='Échelles configurées par le cabinet (module consultations). Aucune conversion entre échelles n\'est fournie ni présumée. Tant que la cliente n\'a pas validé ses échelles (G11, Q06), seules des échelles de DÉMONSTRATION fictives existent.'),

    # --- Catalogue -----------------------------------------------------------------------------------
    op('get', '/v1/catalog', 'SearchCatalog', 'Rechercher le catalogue (prix de vente)', 'Catalogue',
       permission=['catalog.read'], response=BILLING + 'CatalogPage', implemented=True, task='B01', errors=(404, 422),
       params=(('query', 'query', 'Référence, nom, marque ou modèle (2 caractères au moins). Sans texte : les articles actifs.'),
               ('query', 'include_inactive', 'true pour inclure les articles désactivés (réservé à qui détient catalog.manage).'), PAGE),
       read_scope={'FINANCIAL': 'sale_price', 'MANAGER': 'purchase_cost (catalog.purchase_cost.read)'},
       description='Module sales. 25 articles par page, ordre du nom puis de la référence. purchase_cost est ABSENT de la réponse (jamais null) sans catalog.purchase_cost.read. Articles stockés, services et sur mesure sont distincts (stock_mode) ; une unité « paire » n\'est jamais convertie en deux unités.'),
    op('post', '/v1/catalog/items', 'CreateCatalogItem', 'Créer un article', 'Catalogue',
       permission=['catalog.manage'], request=REQUESTS + 'CatalogItemRequest', response=BILLING + 'CatalogItemResponse', status=201, implemented=True, task='B01', errors=(404, 409, 422),
       description='Module sales, gérante. Référence unique par cabinet. Aucun prix réel n\'est fourni par l\'application : seules des données fictives existent en développement. L\'audit garde le prix de vente, jamais le coût d\'achat.'),
    op('patch', '/v1/catalog/items/{id}', 'UpdateCatalogItem', 'Modifier un article (version attendue)', 'Catalogue',
       permission=['catalog.manage'], request=REQUESTS + 'CatalogItemRequest', response=BILLING + 'CatalogItemResponse', implemented=True, task='B01', params=(ID,), errors=(404, 409, 422),
       description='Les champs de la requête remplacent ceux de l\'article ; version attendue = catalog_items.version (409 VERSION_CONFLICT avec current_version). Un changement de prix ne touche jamais une facture émise. Une demande sans effet ne change pas la version.'),
    op('get', '/v1/tax-rules', 'ListTaxRules', 'Règles fiscales saisies par la gérante', 'Catalogue',
       permission=['catalog.manage'], response=BILLING + 'TaxRuleList', implemented=True, task='B01', errors=(404,),
       description='Module sales. Aucune règle n\'est préconfigurée ; une règle n\'est appliquée aux documents que si elle est active et validée.'),
    op('post', '/v1/tax-rules', 'CreateTaxRule', 'Saisir une règle fiscale (aucune taxe préconfigurée)', 'Catalogue',
       permission=['catalog.manage'], reauth=True, request=REQUESTS + 'TaxRuleRequest', response=BILLING + 'TaxRuleResponse', status=201, implemented=True, task='B01', errors=(404, 409, 422),
       description='Module sales, gérante réauthentifiée. Une règle active exige un taux et sa validation (validate = true).'),
    op('patch', '/v1/tax-rules/{id}', 'UpdateTaxRule', 'Modifier ou valider une règle fiscale', 'Catalogue',
       permission=['catalog.manage'], reauth=True, request=REQUESTS + 'TaxRuleRequest', response=BILLING + 'TaxRuleResponse', implemented=True, task='B01', params=(ID,), errors=(404, 409, 422),
       description='Version attendue = tax_rules.version. Changer le taux retire la validation : une règle active doit être revalidée dans la même demande.'),

    # --- Ventes --------------------------------------------------------------------------------------
    op('post', '/v1/invoices', 'CreateInvoiceDraft', 'Créer un brouillon de facture', 'Ventes',
       permission=['invoice.create', 'exam_fee.collect'], command='CreateInvoiceDraft', response=BILLING + 'InvoiceResponse', status=201, implemented=True, task='B02', errors=(404, 409, 422),
       description='Module sales. exam_fee.collect limite le brouillon à la prestation d\'examen fixe (fichier 09). Prix = prix du catalogue, remise plafonnée par le droit de l\'auteur : ce qui le dépasse est refusé en 422 APPROVAL_REQUIRED_OR_EXPIRED champ par champ (lines.N.unit_price_gross, lines.N.discount_gross, lines.N.catalog_item_id). Le brouillon n\'a aucun effet sur le stock. Corps direct : expected_version null et présent.'),
    op('get', '/v1/invoices', 'ListInvoices', 'Factures par statut, patient ou jour d\'émission', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'InvoicePage', implemented=True, task='B02', errors=(404, 422),
       params=(('query', 'status', 'DRAFT, ISSUED ou ABANDONED.'), ('query', 'patient_id', 'Filtre patient.'),
               ('query', 'issued_on', 'Jour civil d\'émission AAAA-MM-JJ au fuseau du cabinet (seules les factures émises ce jour-là).'), PAGE),
       description='Module sales. 25 factures par page, les plus récentes d\'abord, avec leur reste dû et leur ledger_version projetés, et l\'identité de base du patient (numéro de dossier, nom, prénoms). issued_on illisible : 422.'),
    op('get', '/v1/invoices/{id}', 'GetInvoice', 'Facture, lignes, encaissements et solde projeté', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'InvoiceResponse', implemented=True, task='B02', params=(ID,), errors=(404,),
       description='Module sales. Les snapshots (patient, cabinet, taxe) d\'une facture émise sont ceux figés à l\'émission : c\'est d\'eux, jamais de l\'identité ni des prix actuels, que le document est produit.'),
    op('patch', '/v1/invoices/{id}', 'UpdateDraft', 'Modifier le brouillon (version brouillon)', 'Ventes',
       permission=['invoice.create', 'exam_fee.collect'], command='UpdateDraft', response=BILLING + 'InvoiceResponse', implemented=True, task='B02', params=(ID,), errors=(404, 409, 422),
       description='Module sales. Version attendue = draft_version (409 VERSION_CONFLICT avec current_version : l\'écran conserve la saisie). La liste de lignes remplace la précédente. Créateur ou gérante seulement. Facture émise ou abandonnée : 409 STATE_TRANSITION_REFUSED. L\'identifiant du corps doit être celui de l\'adresse.'),
    op('post', '/v1/invoices/{id}/issue', 'IssueInvoice', 'Émettre (numéro, snapshots, réserves, en transaction)', 'Ventes',
       permission=['invoice.issue', 'exam_fee.collect'], command='IssueInvoice', response=BILLING + 'InvoiceResponse', implemented=True, task='B03', params=(ID,), errors=(404, 409, 422),
       description='Module sales. Émission immuable : numéro central, snapshots, réserve du stock des articles stockés et document PENDING dans une transaction ; toute erreur annule tout, numéro compris. Par la route directe : write_owner_id null, reservations vide (le serveur choisit positions et lots), total_gross recalculé et vérifié (422 sinon), issued_at plausible (la date de la pièce est celle du serveur). Stock insuffisant : 409 STOCK_UNAVAILABLE (details.available) ; lot expiré : 422 LOT_EXPIRED. Facture détenue par un poste : 409 WRITE_OWNER_REQUIRED.'),
    op('post', '/v1/invoices/{id}/payments', 'RegisterPayment', 'Encaisser (reçu numéroté au commit)', 'Ventes',
       permission=['payment.collect', 'exam_fee.collect'], command='RegisterPayment', response=BILLING + 'PaymentResultResponse', status=201,
       implemented=True, task='B04', params=(ID,), errors=(404, 409, 422),
       description='Module sales. Montant ≤ solde verrouillé (409 PAYMENT_EXCEEDS_BALANCE avec details.amount_due et current_version) ; version attendue = ledger_version (409 VERSION_CONFLICT avec current_version et amount_due). Un reçu numéroté unique par encaissement, créé après le paiement confirmé dans la même transaction ; le PDF suit (document_status PENDING n\'autorise jamais à répéter l\'encaissement). Espèces : session de caisse ouverte de l\'auteur ; autres modes : aucune session ; référence obligatoire pour mobile money et virement. Un jour civil antérieur exige retroactive_reason. Un rejeu de la même clé rend la réponse d\'origine.'),
    op('post', '/v1/invoices/{id}/abandon', 'AbandonInvoiceDraft', 'Abandonner un brouillon de facture', 'Ventes',
       permission=['invoice.create', 'exam_fee.collect'], request=REQUESTS + 'AbandonInvoiceDraftRequest', response=BILLING + 'InvoiceResponse',
       implemented=True, task='B02', params=(ID,), errors=(403, 404, 409, 422),
       description='Module sales, en ligne seulement. Version attendue = draft_version (409 VERSION_CONFLICT). Créateur du brouillon ou gérante (403 sinon). Facture émise ou déjà abandonnée : 409 STATE_TRANSITION_REFUSED (une facture émise se corrige par avoir). Aucun numéro, aucune réserve de stock, aucun document à annuler ; les lignes restent en base. Motif facultatif, conservé dans l\'audit. L\'identifiant du corps doit être celui de l\'adresse.'),
    # Devis versionnés (L1D07) : ni créance, ni encaissement, ni réserve de stock ; conversion explicite en BROUILLON de facture.
    op('get', '/v1/quotes', 'ListQuotes', 'Devis par état ou patient', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'QuotePage', implemented=True, task='L1D07', errors=(404, 422),
       params=(('query', 'status', "DRAFT, ISSUED, ACCEPTED, DECLINED, EXPIRED ou CONVERTED (EXPIRED : émis ou accepté dont la validité est passée au jour du cabinet ; ISSUED et ACCEPTED : encore valables)."),
               ('query', 'patient_id', 'Filtre patient.'), PAGE),
       description='Module sales. 25 devis par page, les plus récents d\'abord, avec le destinataire (identité de base) et la dernière révision.'),
    op('post', '/v1/quotes', 'CreateQuoteDraft', 'Créer un brouillon de devis', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'CreateQuoteDraftRequest', response=BILLING + 'QuoteResponse', status=201,
       implemented=True, task='L1D07', errors=(404, 409, 422),
       description='Module sales, en ligne seulement. Un patient OU un prospect (nom, téléphone). Lignes soumises aux droits de l\'auteur comme un brouillon de facture : dépassement refusé en 422 APPROVAL_REQUIRED_OR_EXPIRED. Aucun numéro, aucun effet sur le stock. Corps : expected_version null et présent.'),
    op('get', '/v1/quotes/{id}', 'GetQuote', 'Devis, lignes actuelles, révisions figées et provenance', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'QuoteResponse', implemented=True, task='L1D07', params=(ID,), errors=(404,),
       description='Module sales. Chaque révision rend son snapshot figé (source de son document) et l\'état de son document.'),
    op('patch', '/v1/quotes/{id}', 'UpdateQuoteDraft', 'Modifier le brouillon de devis (version attendue)', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'UpdateQuoteDraftRequest', response=BILLING + 'QuoteResponse',
       implemented=True, task='L1D07', params=(ID,), errors=(403, 404, 409, 422),
       description='Module sales, en ligne seulement. Créateur ou gérante (403 sinon). Devis émis : 409 STATE_TRANSITION_REFUSED (il se corrige par une révision).'),
    op('post', '/v1/quotes/{id}/delete', 'DeleteQuoteDraft', 'Supprimer un brouillon de devis jamais émis', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'DeleteQuoteDraftRequest', response=BILLING + 'DeleteQuoteDraftResponse',
       implemented=True, task='L1D07', params=(ID,), errors=(403, 404, 409, 422),
       description='Module sales, en ligne seulement. Créateur ou gérante (403 sinon), comme la modification du brouillon. Brouillon seulement : un devis émis, accepté, refusé, expiré ou converti ne se supprime pas (409 STATE_TRANSITION_REFUSED ; il se révise). Version attendue = version du brouillon (409 VERSION_CONFLICT avec current_version). Supprime aussi les lignes du brouillon ; aucun numéro, aucune réserve de stock, aucune créance à défaire. Audité (quote.draft_deleted : version, nombre de lignes, total) ; publié au journal des changements comme ARCHIVED. Déjà supprimé ou d\'un autre cabinet : 404. L\'identifiant du corps doit être celui de l\'adresse (422).'),
    op('post', '/v1/quotes/{id}/issue', 'IssueQuote', 'Émettre le devis (numéro QUOTE, révision 1 figée)', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'IssueQuoteRequest', response=BILLING + 'QuoteResponse',
       implemented=True, task='L1D07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, en ligne seulement. Numéro de la série QUOTE sans trou, révision 1 IMMUABLE et document PENDING dans la même transaction. Validité obligatoire, au plus tôt aujourd\'hui. Ni créance, ni réserve de stock, ni chiffre d\'affaires.'),
    op('post', '/v1/quotes/{id}/revisions', 'ReviseQuote', 'Réviser un devis émis (nouvelle révision figée)', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'ReviseQuoteRequest', response=BILLING + 'QuoteResponse', status=201,
       implemented=True, task='L1D07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, en ligne seulement. Devis émis, accepté ou refusé (même expiré) : révision N+1 avec motif, numéro inchangé, révisions antérieures et leurs documents intacts. Brouillon ou devis converti : 409 STATE_TRANSITION_REFUSED.'),
    op('post', '/v1/quotes/{id}/decision', 'RecordQuoteDecision', 'Enregistrer la réponse du client (accepté, refusé)', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'QuoteDecisionRequest', response=BILLING + 'QuoteResponse',
       implemented=True, task='L1D07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, en ligne seulement. ACCEPTED : devis émis et encore valable (expiré : 409 avec current_status EXPIRED). DECLINED : devis émis ou accepté. Une acceptation ne crée ni facture ni paiement.'),
    op('post', '/v1/quotes/{id}/conversions', 'ConvertQuote', 'Convertir une révision en brouillon de facture', 'Ventes',
       permission=['invoice.create'], request=REQUESTS + 'ConvertQuoteRequest', response=BILLING + 'InvoiceResponse', status=201,
       implemented=True, task='L1D07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, en ligne seulement. Rend le BROUILLON de facture créé (quote_id = ce devis) : ni numéro, ni créance, ni réserve, ni paiement. Prix confirmés explicitement (price_basis QUOTE ou CATALOG, prices_confirmed vrai). Devis déjà converti : 409 STATE_TRANSITION_REFUSED avec details.invoice_id (le brouillon existant) ; la même clé d\'idempotence rejoue la même réponse. Brouillon, refusé ou expiré : 409.'),
    op('get', '/v1/sales/settings', 'GetSalesSettings', 'Règles de vente du compte connecté (affichage)', 'Ventes',
       permission=['invoice.read', 'invoice.create', 'payment.collect', 'exam_fee.collect'], response=BILLING + 'SalesSettingsResponse',
       implemented=True, task='B04', errors=(404,),
       description='Module sales. Autorité de prix, plafond de remise effectif de CE compte, modes de règlement et modes à référence obligatoire, référence de l\'article des frais d\'examen. Le serveur reste seul juge à chaque commande.'),
    op('get', '/v1/receipts/{id}', 'GetReceipt', 'Reçu d\'un encaissement (pièce immuable, snapshot figé)', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'ReceiptResponse', implemented=True, task='B04', params=(ID,), errors=(404,),
       description='Module sales. Le snapshot du reçu (receipt.json) est la source de son document ; la nature (DEPOSIT ou BALANCE_SETTLEMENT) est calculée, jamais saisie.'),
    op('post', '/v1/payments/{id}/reversals', 'ReversePayment', 'Contre-écriture d\'une erreur comptable', 'Ventes',
       permission=['payment.reverse'], reauth=True, command='ReversePayment', response=BILLING + 'ReversalResultResponse', status=201,
       implemented=True, task='B07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, réauthentification récente. L\'identifiant de l\'adresse est le paiement (payment_id du corps), l\'agrégat sa facture (invoice_id) ; version attendue = ledger_version (409 VERSION_CONFLICT). Le paiement, son reçu et son numéro restent tels qu\'émis : la contre-écriture est une pièce liée, motivée (erreur comptable), cumul ≤ paiement (422, details.reversible), jamais une sortie d\'argent ; refusée si l\'encaissé net deviendrait inférieur aux remboursements versés. Approbation exacte (facture, paiement, montant) consommée une fois, ou exécution directe de la gérante (approval_id inconnu, autorisation écrite consommée sous cet identifiant) ; sinon 422 APPROVAL_REQUIRED_OR_EXPIRED. Paiement en espèces : la session est verrouillée, une session close n\'est jamais réécrite. Facture détenue par un poste : 409 WRITE_OWNER_REQUIRED.'),
    op('post', '/v1/invoices/{id}/credit-notes', 'IssueCreditNote', 'Émettre un avoir lié aux lignes d\'origine', 'Ventes',
       permission=['credit_note.issue'], reauth=True, command='IssueCreditNote', response=BILLING + 'CreditNoteResultResponse', status=201,
       implemented=True, task='B07', params=(ID,), errors=(404, 409, 422),
       description='Module sales, réauthentification récente. Facture émise ; version attendue = ledger_version (409 VERSION_CONFLICT). Lignes d\'origine de CETTE facture, une fois chacune ; cumul des avoirs émis ≤ ligne (montant et quantité indiquée, 422 details.creditable) ; somme des lignes = amount_gross ≤ part non créditée de la facture. Numéro central TEST-AV-AAAA-NNNNNN (number null dans la requête), snapshot figé (régime fiscal de la facture, aucune taxe inventée), document PENDING (credit_note.v1). Ni la facture, ni ses reçus, ni le stock ne changent ; un avoir au-delà du reste dû fait apparaître un crédit à rembourser (IN_CREDIT). Approbation exacte (facture, montant, lignes) ou exécution directe de la gérante ; sinon 422 APPROVAL_REQUIRED_OR_EXPIRED.'),
    op('post', '/v1/invoices/{id}/refunds', 'RefundCredit', 'Rembourser un crédit disponible', 'Ventes',
       permission=['refund.execute'], reauth=True, command='RefundCredit', response=BILLING + 'RefundResultResponse', status=201,
       implemented=True, task='B08', params=(ID,), errors=(404, 409, 422),
       description='Module sales, réauthentification récente. Sortie d\'argent liée à un avoir émis de la facture : montant ≤ crédit à rembourser de la facture (422 details.refundable_credit) et ≤ part de l\'avoir non encore remboursée ; version attendue = ledger_version (409 VERSION_CONFLICT avec refundable_credit). Espèces : session de caisse ouverte de l\'auteur (clôturée : 409) ; autres modes : aucune session, référence obligatoire pour mobile money et virement. Date effective du jour (ni future, ni d\'un jour antérieur). Numéro central TEST-RMB-AAAA-NNNNNN, snapshot figé (bénéficiaire = identité figée de la facture), document PENDING (refund.v1). Approbation exacte (facture, avoir, montant, mode) ou exécution directe de la gérante ; sinon 422 APPROVAL_REQUIRED_OR_EXPIRED. Un rejeu de la même clé rend la réponse d\'origine, jamais un second remboursement.'),
    op('get', '/v1/credit-notes/{id}', 'GetCreditNote', 'Avoir (pièce liée, snapshot figé)', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'CreditNoteResponse', implemented=True, task='B07', params=(ID,), errors=(404,),
       description='Module sales. Lignes d\'origine créditées, part déjà remboursée, snapshot figé (credit-note.json) : source du document de l\'avoir, produit sur le poste. Un avoir d\'un autre cabinet : 404.'),
    op('get', '/v1/refunds/{id}', 'GetRefund', 'Remboursement (pièce liée à un avoir, snapshot figé)', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'RefundResponse', implemented=True, task='B08', params=(ID,), errors=(404,),
       description='Module sales. Snapshot figé (refund.json, bénéficiaire = identité figée de la facture) : source du document du remboursement, produit sur le poste. Un remboursement d\'un autre cabinet : 404.'),
    op('get', '/v1/approvals', 'ListApprovals', 'Demandes d\'approbation (gérante : toutes ; autre compte : les siennes)', 'Approbations',
       permission=['approval.request', 'approval.decide'], response=BILLING + 'ApprovalPage', implemented=True, task='B06', errors=(404, 422),
       params=(('query', 'status', 'Statut effectif : REQUESTED, APPROVED, REFUSED, EXPIRED ou CONSUMED (toutes sans filtre).'), PAGE),
       description='Module settings. 25 par page, les plus récentes d\'abord. Un compte sans approval.decide ne voit que ses propres demandes. subject : contenu exact revérifié contre payload_hash.'),
    op('post', '/v1/approvals', 'RequestApproval', 'Demander une autorisation liée au contenu exact', 'Approbations',
       permission=['approval.request'], command='RequestApproval', response=BILLING + 'ApprovalResponse', status=201, implemented=True,
       task='B06', errors=(404, 409, 422),
       description='Module settings. Le corps porte le contenu exact (subject) ; le serveur en dérive action_code, target_type, target_id et payload_hash. Cible vérifiée dans le cabinet et opération encore possible (422 sur subject.*, 409 STATE_TRANSITION_REFUSED sinon : visite déjà démarrée, frais déjà encaissés, facture non émise…) ; une demande identique en attente ou accordée : 409. Motif obligatoire ; échéance proposée facultative.'),
    op('get', '/v1/approvals/{id}', 'GetApproval', 'Demande d\'approbation', 'Approbations',
       permission=['approval.request', 'approval.decide'], response=BILLING + 'ApprovalResponse', implemented=True, task='B06', params=(ID,), errors=(404,),
       description='Module settings. Une demande d\'un autre compte répond 404 à qui ne détient pas approval.decide.'),
    op('post', '/v1/approvals/{id}/decision', 'DecideApproval', 'Décider une autorisation (gérante réauthentifiée)', 'Approbations',
       permission=['approval.decide'], reauth=True, command='DecideApproval', response=BILLING + 'ApprovalResponse', implemented=True,
       task='B06', params=(ID,), errors=(403, 404, 409, 422),
       description='Module settings, réauthentification récente (423 sinon). Seulement une demande en attente et non échue (409 STATE_TRANSITION_REFUSED, details.current_status) ; jamais par la personne qui l\'a demandée (403) ; la gérante doit détenir aussi la permission que l\'approbation remplace (403). Accord : échéance = la plus proche de celle proposée et de la décision + EEO_APPROVAL_TTL_MINUTES ; refus : motif obligatoire (422). Une dispense d\'examen accordée passe la visite READY_FOR_EXAM.'),

    # --- Caisse --------------------------------------------------------------------------------------
    op('get', '/v1/cash-registers', 'ListCashRegisters', 'Caisses actives du cabinet (caisse principale)', 'Caisse',
       permission=['cash.own_session'], response=BILLING + 'CashRegisterList', implemented=True, task='B05', errors=(404,),
       description='Module sales. Une seule caisse principale au premier jalon (créée par eeo:sales:bootstrap) : aucune route n\'en crée une autre.'),
    op('get', '/v1/cash-sessions/current', 'GetCurrentCashSession', 'Session de caisse ouverte du compte', 'Caisse',
       permission=['cash.own_session'], response=BILLING + 'CurrentCashSessionResponse', implemented=True, task='B05', errors=(404,),
       description='Module sales. data vaut null quand le compte n\'a aucune session ouverte. collected_cash, refunded_cash et theoretical_cash sont des projections recalculées à chaque lecture.'),
    op('post', '/v1/cash-sessions', 'OpenCashSession', 'Ouvrir une session de caisse', 'Caisse',
       permission=['cash.own_session'], command='OpenCashSession', response=BILLING + 'CashSessionResponse', status=201, implemented=True, task='B05', errors=(404, 409, 422),
       description='Module sales. Une session ouverte par caisse et par caissière (409 STATE_TRANSITION_REFUSED, details.current_status OPEN). La caissière est le compte connecté.'),
    op('post', '/v1/cash-sessions/{id}/close', 'CloseCashSession', 'Clôturer (attendu recalculé, écart motivé)', 'Caisse',
       permission=['cash.own_session'], command='CloseCashSession', response=BILLING + 'CashSessionResponse', implemented=True, task='B05', params=(ID,), errors=(404, 409, 422),
       description='Module sales. L\'attendu est recalculé par le serveur : si expected_amount a changé depuis l\'affichage, 409 VERSION_CONFLICT avec details.expected_amount. Un écart non nul exige variance_reason (422). Session close immuable. Une caissière clôture sa session ; la gérante (cash.manage) clôture celle d\'une autre.'),
    op('get', '/v1/cash-sessions', 'ListCashSessions', 'Sessions de caisse du cabinet (gérante)', 'Caisse',
       permission=['cash.manage'], response=BILLING + 'CashSessionPage', implemented=True, task='B05', errors=(404, 422),
       params=(('query', 'state', 'open (ouvertes) ou closed (clôturées) ; sans filtre : ouvertes d\'abord.'), PAGE),
       description='Module sales. Toutes les caisses et caissières, 25 par page, avec les noms ACTUELS de la caissière et de qui a clôturé ; totaux projetés.'),
    op('get', '/v1/cash-sessions/{id}/report', 'GetCashSessionReport', 'Relevé d\'une session de caisse', 'Caisse',
       permission=['cash.own_session'], response=BILLING + 'CashSessionReportResponse', implemented=True, task='B05', params=(ID,), errors=(403, 404),
       description='Module sales. Sa propre session ; la session d\'une autre caissière seulement avec cash.manage (403 sinon). Tiroir espèces, mouvements, encaissements de la session et autres modes de la même caissière pendant la session ; relevé PROVISOIRE tant que la session est ouverte. Source du PDF du relevé, produit sur le poste.'),
    op('get', '/v1/cash-sessions/{id}/movements', 'ListCashMovements', 'Mouvements hors vente d\'une session', 'Caisse',
       permission=['cash.own_session'], response=BILLING + 'CashSessionMovementsResponse', implemented=True, task='L1D05', params=(ID,), errors=(403, 404),
       description="Module sales. Sa propre session ; celle d'une autre caissière seulement avec cash.manage (403 sinon). Mouvements du plus ancien au plus récent, et revue de l'écart si la gérante l'a faite."),
    op('post', '/v1/cash-sessions/{id}/movements', 'RecordCashMovement', 'Dépense, dépôt, retrait ou correction d\'ouverture', 'Caisse',
       permission=['cash.own_session'], request=REQUESTS + 'RecordCashMovementRequest', response=BILLING + 'CashMovementResponse', status=201,
       implemented=True, task='L1D05', params=(ID,), errors=(403, 404, 409, 422),
       description="Module sales, en ligne seulement. Session ouverte (clôturée : 409 STATE_TRANSITION_REFUSED, current_status CLOSED). Une caissière dans SA session avec l'approbation exacte CASH_MOVEMENT de la gérante (422 APPROVAL_REQUIRED_OR_EXPIRED sinon) ; la gérante l'exécute directement. Une sortie ne dépasse jamais les espèces théoriques du tiroir (422, details.available). Jamais un paiement : ni facture, ni reçu, ni chiffre d'affaires."),
    op('post', '/v1/cash-sessions/{id}/variance-review', 'ReviewCashVariance', 'Revue de l\'écart d\'une session clôturée (gérante)', 'Caisse',
       permission=['cash.manage'], reauth=True, request=REQUESTS + 'CashVarianceReviewRequest', response=BILLING + 'CashVarianceReviewResponse', status=201,
       implemented=True, task='L1D05', params=(ID,), errors=(404, 409, 422, 423),
       description="Module sales. Session clôturée avec un écart non nul, revue une seule fois (409 sinon, current_status OPEN, NO_VARIANCE ou REVIEWED). Contestation : note obligatoire. Fait d'audit (cash.variance_reviewed) : la session figée n'est pas réécrite."),
    op('get', '/v1/expense-categories', 'ListExpenseCategories', 'Catégories de dépenses', 'Caisse',
       permission=['cash.own_session'], response=BILLING + 'ExpenseCategoryList', implemented=True, task='L1D05',
       description='Module sales. Actives seulement sans cash.manage ; toutes (actives d\'abord) pour la gérante.'),
    op('post', '/v1/expense-categories', 'SaveExpenseCategory', 'Créer ou modifier une catégorie de dépenses (gérante)', 'Caisse',
       permission=['cash.manage'], request=REQUESTS + 'ExpenseCategoryRequest', response=BILLING + 'ExpenseCategoryResponse',
       implemented=True, task='L1D05', errors=(422,),
       description='Module sales. Code unique dans le cabinet, figé après la création ; une catégorie se désactive, jamais ne se supprime.'),
    op('get', '/v1/reports/cash-day', 'GetCashDayReport', 'Caisse du jour', 'Caisse',
       permission=['finance.global.read', 'cash.own_session'], response=BILLING + 'CashDayReportResponse', implemented=True, task='R01', errors=(404, 422),
       params=(('query', 'date', 'Jour civil AAAA-MM-JJ au fuseau du cabinet (aujourd\'hui par défaut).'),),
       read_scope={'MANAGER': 'CLINIC (finance.global.read) : tout le cabinet, factures et avoirs émis, reste à encaisser',
                   'CASHIER': 'OWN (cash.own_session) : ses encaissements et ses sessions seulement'},
       description='Module sales. Encaissements nets par mode (vw_collection_events) du jour civil du cabinet et sessions du jour. Lecture EN LIGNE, complète à son instant (generated_at) ; jamais un statut « payé ».'),

    # --- Stock ---------------------------------------------------------------------------------------
    op('get', '/v1/stock/availability', 'GetStockAvailability', 'Disponibilités (physique, réservé, quotas locaux)', 'Stock',
       permission=['stock.read'], response=STOCK + 'StockAvailabilityPage', implemented=True, task='I00', errors=(404, 422),
       params=(('query', 'item_id', 'Filtre article.'), ('query', 'location_id', 'Filtre emplacement.'), PAGE),
       description='Module stock. Disponible central = physique − réservations centrales − quotas locaux non consommés ; aucun coût ni valeur de stock.'),
    op('get', '/v1/stock/locations', 'ListStockLocations', 'Emplacements de stock actifs', 'Stock',
       permission=['stock.read'], response=STOCK + 'StockLocationList', implemented=True, task='I00', errors=(404,),
       description='Module stock. Emplacements actifs du cabinet (PRINCIPAL créé par eeo:sales:bootstrap) ; aucune route n\'en crée au premier jalon.'),
    op('post', '/v1/stock/opening', 'RegisterOpeningStock', 'Stock initial validé', 'Stock',
       permission=['stock.adjust'], reauth=True, request=REQUESTS + 'OpeningStockRequest', response=STOCK + 'OpeningStockResponse', status=201, implemented=True, task='I00', errors=(404, 409, 422),
       description='Module stock, gérante réauthentifiée. Un mouvement OPENING par ligne, positions et lots créés au besoin ; le stock initial d\'un article dans un emplacement ne s\'enregistre qu\'une fois. approval_id doit être null (la gérante accorde l\'autorisation en exécutant elle-même ; les approbations à distance attendent B06). Corps sans expected_version.'),
    op('post', '/v1/stock/movements', 'RegisterStockMovement', 'Mouvement hors vente motivé et approuvé', 'Stock',
       permission=['stock.adjust'], reauth=True, command='RegisterStockMovement', response=STOCK + 'StockMovementResponse', status=201,
       implemented=True, task='I02', errors=(404, 409, 422),
       description="Module stock, réauthentification récente. Casse (BREAKAGE, quantité négative) ou ajustement (ADJUSTMENT, quantité signée non nulle) d'un article géré en stock ; lot obligatoire dès que la position a des lots ; quantité entière pour un article vendu à l'unité. Un retrait ne dépasse jamais le disponible central (physique − réserves − quotas des postes : 409 STOCK_UNAVAILABLE, details.available). Approbation exacte (position, article, lot, nature, quantité signée) consommée une fois, ou exécution directe de la gérante sous cet approval_id ; sinon 422 APPROVAL_REQUIRED_OR_EXPIRED. Motif obligatoire, coût unitaire connu ou null. Corps avec expected_version null."),
    op('get', '/v1/invoices/{id}/deliveries', 'ListInvoiceDeliveries', 'Reste à remettre, remises et retours d\'une facture', 'Ventes',
       permission=['invoice.read'], response=BILLING + 'InvoiceDeliveriesResponse', implemented=True, task='I01', params=(ID,), errors=(404,),
       description="Module sales. Par ligne : quantité facturée, remise, retournée, reste à remettre, réserve ouverte et remettable maintenant ; historique des remises confirmées (lot, nom ACTUEL de qui a remis) et des retours physiques ; reste dû à l'instant (null pour un brouillon). Projection recalculée à chaque lecture ; aucun coût d'achat. Une facture d'un autre cabinet : 404."),
    op('post', '/v1/invoices/{id}/deliveries', 'ConfirmDelivery', 'Confirmer une remise liée à la vente', 'Ventes',
       permission=['delivery.confirm'], command='ConfirmDelivery', response=BILLING + 'DeliveryResponse', status=201,
       implemented=True, task='I01', params=(ID,), errors=(404, 409, 422),
       description="Module sales. Facture émise (409 STATE_TRANSITION_REFUSED sinon) ; remise partielle ou totale : cumul des remises de chaque ligne ≤ quantité facturée (422, details.remaining). Article en stock : prise sur les réserves ouvertes de la ligne posées à l'émission (409 STOCK_UNAVAILABLE, details.available), lot vendable non expiré au jour local (422 LOT_EXPIRED) ; un mouvement SALE_DELIVERY négatif par ligne de remise, physique et réserve baissent ensemble (rien n'est soustrait deux fois) ; une réserve sur deux lots donne deux lignes de remise. Positions, lots, réserves et mouvement : null par la route directe (le serveur choisit, FEFO) ou désignés. Article sans stock : ligne sans réserve ni mouvement. Facture non soldée : approbation exacte (facture, reste dû, lignes) ou exécution directe de la gérante dans credit_delivery_approval_id ; sinon 422 APPROVAL_REQUIRED_OR_EXPIRED (details.amount_due). Heure de remise du jour (ni future, ni d'un jour antérieur). Facture détenue par un poste : 409 WRITE_OWNER_REQUIRED. Corps avec expected_version null ; un rejeu de la même clé rend la réponse d'origine, jamais une seconde sortie."),
    op('post', '/v1/deliveries/{id}/physical-returns', 'RegisterPhysicalReturn', 'Enregistrer un retour physique inspecté', 'Stock',
       permission=['stock.adjust'], reauth=True, command='RegisterPhysicalReturn', response=STOCK + 'PhysicalReturnResponse', status=201,
       implemented=True, task='I02', params=(ID,), errors=(404, 409, 422),
       description="Module stock, réauthentification récente. Ligne de remise de CETTE remise (adresse), cumul des retours ≤ quantité remise (422, details.returnable). approved_by = l'auteur (contrôle et acceptation par la personne qui enregistre). Seul un article SELLABLE accepté pour la remise en stock écrit un mouvement PATIENT_RETURN positif dans la position et le lot d'origine (jamais un lot expiré ou en quarantaine) ; sinon le retour est tracé sans mouvement. Aucun avoir n'est créé ; un avoir émis de la même facture peut être relié (credit_note_id). Corps avec expected_version null."),

    # --- Agenda et suivi -----------------------------------------------------------------------------
    op('get', '/v1/agenda/configuration', 'GetAgendaConfiguration', 'Configuration de l\'agenda', 'Agenda et suivi',
       permission=['agenda.read'], response=SCHEDULING + 'AgendaConfigurationResponse', implemented=True, task='S01',
       description='Module agenda. Ressources (avec leurs créneaux hebdomadaires), prestations et exceptions des 90 prochains jours.'),
    op('post', '/v1/agenda/resources', 'CreateSchedulingResource', 'Créer une ressource de l\'agenda', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'SchedulingResourceRequest', response=SCHEDULING + 'SchedulingResourceResponse',
       status=201, implemented=True, task='S01', errors=(409, 422),
       description='Gérante (faute de droit dédié au référentiel, la configuration suit users.manage). En ligne seulement.'),
    op('patch', '/v1/agenda/resources/{id}', 'UpdateSchedulingResource', 'Modifier une ressource de l\'agenda', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'SchedulingResourceRequest', response=SCHEDULING + 'SchedulingResourceResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('post', '/v1/agenda/resources/{id}/opening-hours', 'ReplaceOpeningHours', 'Remplacer les créneaux hebdomadaires d\'une ressource', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'OpeningHoursRequest', response=SCHEDULING + 'SchedulingResourceResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('post', '/v1/agenda/resources/{id}/exceptions', 'AddResourceException', 'Ajouter une fermeture ou une ouverture exceptionnelle', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'ResourceExceptionRequest', response=SCHEDULING + 'ResourceExceptionResponse',
       status=201, implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('post', '/v1/agenda/services', 'CreateAppointmentService', 'Créer une prestation réservable', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'AppointmentServiceRequest', response=SCHEDULING + 'AppointmentServiceResponse',
       status=201, implemented=True, task='S01', errors=(409, 422)),
    op('patch', '/v1/agenda/services/{id}', 'UpdateAppointmentService', 'Modifier une prestation réservable', 'Agenda et suivi',
       permission=['users.manage'], request=REQUESTS + 'AppointmentServiceRequest', response=SCHEDULING + 'AppointmentServiceResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('get', '/v1/agenda/slots', 'ListAvailableSlots', 'Créneaux libres d\'un jour', 'Agenda et suivi',
       permission=['agenda.read'], response=SCHEDULING + 'AvailableSlotsResponse', implemented=True, task='S01', errors=(422,),
       params=(('query', 'date', 'Date civile AAAA-MM-JJ (fuseau du cabinet).'), ('query', 'resource_id', 'Ressource.'),
               ('query', 'service_id', 'Prestation (durée).'))),
    op('post', '/v1/follow-ups', 'CreateFollowUp', 'Programmer un contrôle recommandé', 'Agenda et suivi',
       permission=['follow_up.write'], command='CreateFollowUp', response=SCHEDULING + 'FollowUpPlanResponse', status=201,
       implemented=True, task='S02', errors=(409, 422),
       description='Depuis une consultation (clinical.read exigé aussi : le motif est clinique). Date calculée depuis l\'origine choisie, ou saisie avec motif ; aucune décision médicale automatique. Crée la tâche de rappel interne si le rappel est activé.'),
    op('get', '/v1/follow-ups', 'ListFollowUps', 'Patients à revoir', 'Agenda et suivi',
       permission=['agenda.read'], response=SCHEDULING + 'FollowUpPlanList', implemented=True, task='S02', errors=(422,),
       params=(('query', 'from', 'Date civile de début (date recommandée).'), ('query', 'to', 'Date civile de fin.'),
               ('query', 'consultation_id', 'Contrôles d\'une consultation (au lieu d\'une période).')),
       description='Motif, notes et motif de date manuelle à null sans clinical.read.'),
    op('post', '/v1/follow-ups/{id}/cancel', 'CancelFollowUp', 'Annuler un contrôle recommandé encore actif', 'Agenda et suivi',
       permission=['follow_up.write'], request=REQUESTS + 'CancelFollowUpRequest', response=SCHEDULING + 'FollowUpPlanResponse',
       implemented=True, task='S02', params=(ID,), errors=(403, 404, 409, 422),
       description='En ligne seulement ; clinical.read exigé aussi (le motif du contrôle est clinique : 403 sinon). Motif obligatoire (3 à 1 000 caractères), conservé dans l\'audit. Version attendue = version du contrôle (409 VERSION_CONFLICT avec current_version). Seulement tant que le contrôle est ACTIVE : programmé par un rendez-vous (SCHEDULED : annuler d\'abord le rendez-vous), déjà annulé ou clos : 409 STATE_TRANSITION_REFUSED avec details.current_status. Rien n\'est supprimé : statut CANCELLED, les tâches de rappel ouvertes sont closes, le contrôle disparaît de la liste des patients à revoir mais reste lisible dans sa consultation. Rend le contrôle relu.'),
    op('post', '/v1/appointments', 'CreateAppointment', 'Créer un rendez-vous interne', 'Agenda et suivi',
       permission=['agenda.write'], command='CreateAppointment', response=SCHEDULING + 'AppointmentResponse', status=201,
       implemented=True, task='S01', errors=(409, 422),
       description='Créneau revérifié SOUS verrou (horaires, exceptions, indisponibilités, autres rendez-vous) : un créneau concurrent est refusé (409 SLOT_UNAVAILABLE). En ligne : confirmé à la réponse du serveur seulement.'),
    op('get', '/v1/appointments', 'ListAppointments', 'Rendez-vous d\'une période', 'Agenda et suivi',
       permission=['agenda.read'], response=SCHEDULING + 'AppointmentList', implemented=True, task='S01', errors=(422,),
       params=(('query', 'from', 'Date civile de début (fuseau du cabinet).'), ('query', 'to', 'Date civile de fin (31 jours au plus).'),
               ('query', 'resource_id', 'Filtre facultatif par ressource.'), ('query', 'patient_id', 'Filtre facultatif par patient.'))),
    op('post', '/v1/appointments/{id}/reschedule', 'RescheduleAppointment', 'Déplacer un rendez-vous (réservation concurrente contrôlée)', 'Agenda et suivi',
       permission=['agenda.write'], request=REQUESTS + 'RescheduleAppointmentRequest', response=SCHEDULING + 'AppointmentResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422),
       description='En ligne seulement : les autres calendriers sont inconnus hors-ligne (fichier 19). Les rappels internes sont recalculés, la programmation précédente reste dans l\'audit.'),
    op('post', '/v1/appointments/{id}/cancel', 'CancelAppointment', 'Annuler un rendez-vous', 'Agenda et suivi',
       permission=['agenda.write'], request=REQUESTS + 'CancelAppointmentRequest', response=SCHEDULING + 'AppointmentResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('post', '/v1/appointments/{id}/no-show', 'MarkAppointmentNoShow', 'Constater l\'absence à un rendez-vous', 'Agenda et suivi',
       permission=['agenda.write'], request=REQUESTS + 'MarkAppointmentNoShowRequest', response=SCHEDULING + 'AppointmentResponse',
       implemented=True, task='S01', params=(ID,), errors=(409, 422)),
    op('get', '/v1/contact-tasks', 'ListContactTasks', 'Tâches de contact du jour', 'Agenda et suivi',
       permission=['agenda.read'], response=SCHEDULING + 'ContactTaskList', implemented=True, task='S02', errors=(422,),
       params=(('query', 'due_date', 'Date civile AAAA-MM-JJ (aujourd\'hui par défaut).'),)),
    op('post', '/v1/contact-tasks/{id}/attempts', 'RecordContactAttempt', 'Historiser une tentative de contact', 'Agenda et suivi',
       permission=['agenda.write'], command='RecordContactAttempt', response=SCHEDULING + 'ContactAttemptResultResponse', status=201,
       implemented=True, task='S02', params=(ID,), errors=(409, 422)),

    # --- Rapports ------------------------------------------------------------------------------------
    op('get', '/v1/reports/activity', 'GetActivityReport', 'Activité administrative', 'Rapports',
       permission=['statistics.activity'], response=SCHEDULING + 'ActivityReportResponse', task='R02', implemented=True, errors=(422,),
       description='Module reports. Période de jours civils du cabinet (AAAA-MM-JJ, bornes incluses, 366 jours au plus).',
       params=(('query', 'from', 'Date civile de début.'), ('query', 'to', 'Date civile de fin.'))),
    op('get', '/v1/reports/clinical', 'GetClinicalReport', 'Statistiques cliniques agrégées', 'Rapports',
       permission=['statistics.clinical'], response=SCHEDULING + 'ClinicalReportResponse', task='R02', implemented=True, errors=(422,),
       description='Module reports. Période de jours civils du cabinet (AAAA-MM-JJ, bornes incluses, 366 jours au plus).',
       params=(('query', 'from', 'Date civile de début.'), ('query', 'to', 'Date civile de fin.'))),
    op('get', '/v1/reports/financial', 'FinancialDashboard', 'Chiffre d\'affaires et encaissements (gérante)', 'Rapports',
       permission=['finance.global.read'], response=OPERATIONS + 'FinancialReportResponse', task='R01',
       params=(('query', 'from', 'Date civile de début.'), ('query', 'to', 'Date civile de fin.'))),
    op('get', '/v1/audit-events', 'ListAuditEvents', 'Consulter le journal d\'audit', 'Rapports',
       permission=['audit.read'], response=OPERATIONS + 'AuditEventPage', implemented=True, task='F07', errors=(422,),
       params=(('query', 'target_type', 'Type de cible.'), ('query', 'target_id', 'Identifiant de la cible.'), ('query', 'from', 'Instant UTC de début.'),
               ('query', 'to', 'Instant UTC de fin.'), PAGE)),

    # --- Documents -----------------------------------------------------------------------------------
    op('get', '/v1/documents/{id}/download', 'GetDocument', 'Télécharger un document privé', 'Documents',
       permission=['invoice.read', 'clinical.export'], response=None, implemented=True, task='D01', params=(ID,), errors=(403, 404),
       description='Policy du document : pièce financière avec invoice.read, document clinique avec clinical.export ; stockage privé, jamais d\'URL publique. Réponse application/pdf.'),
    op('post', '/v1/documents/{id}/content', 'StoreDocumentContent', 'Déposer le PDF correspondant au snapshot', 'Documents',
       permission=['invoice.issue', 'payment.collect', 'clinical.complete'], request='binary-pdf', request_type='application/pdf',
       response=OPERATIONS + 'GeneratedDocumentResponse', implemented=True, task='D01', params=(ID,), errors=(403, 404, 409, 422),
       description='Le serveur vérifie Policy, source, version de template, type et SHA-256 des octets, calcule le chemin privé ; un READY n\'est plus modifié, un dépôt identique retrouve le fichier.'),

    # --- Postes et synchronisation --------------------------------------------------------------------
    op('post', '/v1/devices/enroll', 'EnrollDevice', 'Enrôler un poste (clé publique ES256)', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'EnrollDeviceRequest', response=OPERATIONS + 'EnrolledDeviceResponse', status=201,
       implemented=True, task='O02', errors=(409, 422),
       description='Module offline, en ligne seulement. Clé publique ES256 et preuve de possession vérifiée (signature, empreinte, cabinet, code, fraîcheur 10 min). '
                   'Code de poste ou clé déjà enrôlés, responsable inactif, preuve refusée : 422 par champ. Aucun droit hors-ligne accordé ici.'),
    op('get', '/v1/devices', 'ListDevices', 'Postes enrôlés du cabinet', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'EnrolledDeviceList', implemented=True, task='O02',
       description='Module offline. Postes du cabinet, du plus récent au plus ancien ; clé publique, statut, responsable, grants actifs.'),
    op('get', '/v1/devices/{id}', 'GetDevice', 'Poste enrôlé', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'EnrolledDeviceResponse', implemented=True, task='O02', params=(ID,), errors=(404,)),
    op('get', '/v1/devices/{id}/grants', 'ListDeviceGrants', 'Grants signés du poste', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'OfflineGrantList', implemented=True, task='O02', params=(ID,), errors=(404,),
       description='Module offline. Du plus récent au plus ancien ; state ACTIVE, EXPIRED ou REVOKED calculé à la lecture ; jeton signé inclus.'),
    op('post', '/v1/devices/{id}/grants', 'IssueOfflineGrant', 'Émettre le grant signé d\'un profil sur ce poste', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'IssueOfflineGrantRequest', response=OPERATIONS + 'OfflineGrantResponse', status=201,
       implemented=True, task='O02', params=(ID,), errors=(404, 409, 422),
       description='Module offline, en ligne seulement. Fige permissions effectives, compartiments, règles et empreinte du catalogue ; JWS ES256 de la clé '
                   'du serveur. Un nouveau grant du même profil sur ce poste révoque les précédents encore actifs. Poste inactif ou clé du serveur absente : 409.'),
    op('post', '/v1/devices/{id}/revoke', 'RevokeDevice', 'Révoquer un poste et ses grants', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'RevokeDeviceRequest', response=OPERATIONS + 'EnrolledDeviceResponse',
       implemented=True, task='O02', params=(ID,), errors=(404, 409, 422),
       description='Module offline. REVOKED ou LOST avec motif ; tous les grants actifs du poste sont révoqués ; connue du poste à sa prochaine connexion.'),
    op('post', '/v1/offline-grants/{id}/revoke', 'RevokeOfflineGrant', 'Révoquer un grant', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'RevokeOfflineGrantRequest', response=OPERATIONS + 'OfflineGrantResponse',
       implemented=True, task='O02', params=(ID,), errors=(404, 409, 422)),
    op('get', '/v1/offline/signing-keys', 'GetOfflineSigningKeys', 'Clés publiques qui signent les grants', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'SigningKeySetResponse', implemented=True, task='O02', errors=(409,),
       description='Module offline. Clé courante puis clés retirées (rotation), jamais de donnée privée ; 409 SIGNING_KEY_MISSING tant que la clé n\'est pas installée.'),
    op('post', '/v1/devices/{id}/prepare', 'PrepareDevice', 'Préparer le poste : plages, quotas, factures, catalogue', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'PrepareDeviceRequest', response=OPERATIONS + 'PreparationResponse', implemented=True,
       task='O03', params=(ID,), errors=(404, 409, 422),
       description='Module offline, en ligne seulement, sous verrous (séquences, propriété de facture, positions et lots). Plages disjointes prises après le plus '
                   'haut numéro connu (la séquence centrale monte à leur fin), propriété d\'écriture des factures émises, quotas retirés du disponible central. '
                   'Une seule caisse hors-ligne principale : 409 FINANCIAL_DEVICE_ELSEWHERE. Rend la préparation complète du poste.'),
    op('get', '/v1/devices/{id}/preparation', 'GetDevicePreparation', 'Préparation actuelle du poste', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'PreparationResponse', implemented=True, task='O03', params=(ID,), errors=(404,),
       description='Module offline. Grants actifs, plages et quotas ACTIFS, factures attribuées, catalogue figé, préfixe finalisé du journal.'),
    op('post', '/v1/devices/{id}/release', 'ReleaseDevice', 'Clôturer les droits du poste après reprise complète', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'ReleaseDeviceRequest', response=OPERATIONS + 'ReleaseResponse', implemented=True,
       task='O03', params=(ID,), errors=(404, 409, 422),
       description='Module offline. Refus 409 SYNC_INCOMPLETE si la séquence/empreinte annoncées ne sont pas le préfixe finalisé du serveur ou si une commande '
                   'reçue n\'est pas finalisée ; poste perdu : 409. Numéros inutilisés inscrits UNUSED (jamais recyclés), reliquats de quota rendus au central.'),
    op('get', '/v1/devices/{id}/health', 'GetDeviceHealth', 'Santé du poste (dernière synchronisation, conflits, plages)', 'Postes et synchronisation',
       permission=['offline.enroll'], response=OPERATIONS + 'DeviceHealthResponse', task='O05', params=(ID,)),
    op('post', '/v1/devices/{id}/replace', 'ReplaceDevice', 'Remplacer un poste par un poste neuf (sans cloner ses droits)', 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'ReplaceDeviceRequest', response=OPERATIONS + 'ReplacementResponse',
       implemented=True, task='O07', params=(ID,), errors=(404, 409, 422, 423),
       description="Module offline. L'ancien poste passe REPLACED (replaced_by_device_id), tous ses grants actifs sont révoqués, ses plages, quotas et propriétés de facture actifs passent CLOSING. Le poste de remplacement doit être enrôlé, actif et distinct (422). Déjà remplacé : 409."),
    op('post', '/v1/devices/{id}/recovered-push', 'PushRecoveredCommands', "Reprendre le journal exporté d'un poste remplacé", 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request='./sync/push-request.json', response='./sync/push-response.json', implemented=True,
       task='O07', params=(ID,), idempotent=False, errors=(403, 404, 409, 413, 422, 423),
       description="Module offline, gérante. Mêmes vérifications que POST /sync/push (empreinte JCS, JWS ES256 de la clé enrôlée de l'ANCIEN poste, lot contigu et chaîné) ; device_id du lot = {id} (422) ; poste non remplacé : 409. Les commandes sont appliquées normalement avec leurs identifiants et numéros d'origine (jamais renumérotés) ; le rejeu rend ALREADY_ACCEPTED."),
    op('post', '/v1/devices/{id}/reconcile-replacement', 'ReconcileReplacement', "Clôturer les ressources d'un poste remplacé après reprise", 'Postes et synchronisation',
       permission=['offline.enroll'], reauth=True, request=REQUESTS + 'ReconcileReplacementRequest', response=OPERATIONS + 'ReleaseResponse',
       implemented=True, task='O07', params=(ID,), errors=(404, 409, 422, 423),
       description="Module offline. Poste REPLACED seulement (409 sinon) ; séquence et empreinte du manifeste égales au préfixe finalisé, aucune commande reçue au-delà (409 SYNC_INCOMPLETE). Propriétés CLOSED, reliquats de quota rendus, plages CLOSED avec numéros inutilisés UNUSED (jamais recyclés)."),
    op('get', '/v1/sync/compatibility', 'GetSyncCompatibility', 'Versions reprises par la release du serveur', 'Postes et synchronisation',
       response=OPERATIONS + 'CompatibilityResponse', implemented=True, task='O06',
       description="Module offline, tout compte connecté. Déclaration contracts/compatibility.json : le poste compare ses commandes en attente (schéma, règles, format du coffre, schéma local) avant d'accepter une mise à jour."),
    op('post', '/v1/sync/push', 'PushCommands', 'Transmettre un lot ordonné de commandes signées', 'Postes et synchronisation',
       request='./sync/push-request.json', response='./sync/push-response.json', implemented=True, task='O05', idempotent=False, errors=(403, 404, 409, 413, 422),
       description='Module offline. Session d\'un compte préparé sur ce poste (grant de ce poste) ou de la gérante (offline.enroll) ; poste perdu ou remplacé : 403. '
                   'Chaque commande est vérifiée avant stockage (event_hash = SHA-256 du JCS du cœur, JWS ES256 de la clé enrôlée, kid = empreinte RFC 7638, '
                   'lot contigu et chaîné) : sinon 422 SYNC_INTEGRITY_FAILED et rien n\'est stocké ; même command_id avec une autre empreinte : 409 '
                   'IDEMPOTENCY_PAYLOAD_MISMATCH ; rang précédent jamais reçu : 409 SYNC_SEQUENCE_GAP (details.expected_sequence) ; lot trop gros : 413 '
                   'PAYLOAD_TOO_LARGE. Chaque commande est ensuite appliquée dans l\'ordre, dans sa transaction, par le chemin central (source SYNC, '
                   'autorisation historique de son grant, numéro de sa plage jamais renuméroté) ; l\'application s\'arrête au premier non finalisé. '
                   'ACK par commande ; timeout = rejouer les mêmes identifiants (ALREADY_ACCEPTED, aucun second fait).'),
    op('get', '/v1/sync/pull', 'PullChanges', 'Changements autorisés depuis un curseur opaque signé', 'Postes et synchronisation',
       response='./sync/pull-page.json', implemented=True, task='O05', errors=(403, 404, 422),
       params=(('query', 'device_id', 'Poste préparé qui lit (ULID, obligatoire).'),
               ('query', 'cursor', 'Curseur opaque signé de la page précédente (absent au premier appel).')),
       description='Module offline. Grant ACTIF du compte sur ce poste exigé (403 GRANT_EXPIRED_OR_REVOKED). Compartiments lus = ceux du grant ∩ ceux des droits '
                   'actuels (jamais CLINICAL sans droit clinique) ; PUBLIC pour tous. Pages ordonnées par publication sous verrou du cabinet, au plus 100 ; '
                   'le curseur avance aussi sur les entrées filtrées et lie poste, compte et compartiments (422 si altéré ou d\'un autre poste ; '
                   'reprise depuis le début si les compartiments ont changé). Le client n\'avance le curseur qu\'après commit local de toute la page.'),
    op('get', '/v1/sync/conflicts', 'ListSyncConflicts', 'Conflits de synchronisation à revoir', 'Postes et synchronisation',
       permission=['approval.decide'], response=OPERATIONS + 'ConflictPage', implemented=True, task='O05',
       params=(('query', 'status', 'OPEN ou RESOLVED (tous sans filtre ; les ouverts d\'abord).'), PAGE),
       description='Module offline. Commande d\'origine (nom, poste, rang, auteur), code et motif du refus, décision et son motif ; jamais la charge (instantanés chiffrés).'),
    op('post', '/v1/sync/conflicts/{id}/resolution', 'ResolveSyncConflict', 'Résoudre un conflit (décision motivée, jamais anonyme)', 'Postes et synchronisation',
       permission=['approval.decide'], reauth=True, request=REQUESTS + 'ConflictResolutionRequest', response=OPERATIONS + 'ConflictResponse', implemented=True,
       task='O05', params=(ID,), errors=(404, 409, 422),
       description='Module offline, en ligne seulement. ACCEPT_LOCAL : appliquer la commande telle quelle après revue (rejouée par le chemin central ; seul un '
                   'verdict « en revue » de l\'autorisation historique est levé, tout autre refus rouvre un conflit). KEEP_CENTRAL, REJECT : commande finalisée '
                   'REJECTED, le préfixe du poste avance. CORRECT : REJECTED avec la commande correctrice (nouvel identifiant). Jamais de réécriture du cœur, '
                   'de l\'empreinte ni de la signature ; conflit déjà résolu : 409.'),

    # --- Restitution et imports -----------------------------------------------------------------------
    op('post', '/v1/exports', 'RequestExport', 'Demander un export privé', 'Restitution',
       permission=['export.global', 'clinical.export'], reauth=True, request=REQUESTS + 'CreateExportRequest',
       response=OPERATIONS + 'ExportRequestResponse', status=201, implemented=True, task='X02', errors=(403, 422),
       description="Module settings. clinical.export suffit pour l'export du dossier d'un patient (PATIENT_RECORD) ; les autres types exigent export.global. L'archive est produite par la tâche planifiée (eeo:exports:process), jamais dans la requête."),
    op('get', '/v1/exports', 'ListExports', 'Exports du cabinet', 'Restitution',
       permission=['export.global', 'clinical.export'], response=OPERATIONS + 'ExportRequestList', implemented=True, task='X02',
       description="Module settings. Les 50 plus récents ; export.global voit tous les exports du cabinet, un autre compte seulement les siens."),
    op('get', '/v1/exports/{id}', 'GetExport', "État d'un export", 'Restitution',
       permission=['export.global', 'clinical.export'], response=OPERATIONS + 'ExportRequestResponse', implemented=True, task='X02', params=(ID,), errors=(404,)),
    op('get', '/v1/exports/{id}/download', 'DownloadExport', 'Télécharger un export prêt (privé, expirant)', 'Restitution',
       permission=['export.global', 'clinical.export'], response=None, implemented=True, task='X02', params=(ID,), errors=(404, 409),
       description="Archive ZIP privée (CSV par table, dictionnaire, manifeste) pendant 48 h ; expirée ou pas encore prête : 409 STATE_TRANSITION_REFUSED avec details.current_status ; téléchargement tracé."),
    op('post', '/v1/imports/catalog', 'ImportCatalog', 'Importer le catalogue (aperçu puis import contrôlé)', 'Restitution',
       permission=['catalog.manage'], reauth=True, request=REQUESTS + 'CatalogImportRequest',
       response=BILLING + 'ImportReportResponse', implemented=True, task='X01', errors=(422, 423),
       description="Module sales. Le fichier CSV est lu sur le poste ; le serveur revérifie chaque ligne. dry_run = true : rapport sans écriture ni commande ; false : commande ImportCatalog, toutes les lignes ou aucune (422 ligne par ligne)."),
    op('post', '/v1/legacy-balances/evidence', 'StoreLegacyEvidence', "Déposer le justificatif scanné d'une créance papier", 'Restitution',
       permission=['finance.global.read'], reauth=True, request='binary-evidence', request_type='application/octet-stream',
       response=BILLING + 'LegacyEvidenceResponse', status=201, implemented=True, task='X01', errors=(422,),
       description='Module sales, gérante. Corps brut PDF, JPEG ou PNG (type reconnu aux premiers octets, jamais au seul en-tête), taille bornée (EEO_DOCUMENT_MAX_BYTES), en-tête facultatif X-Content-Sha256 vérifié ; stockage privé adressé par le contenu (le même scan = le même fichier).'),
    op('post', '/v1/imports/legacy-balances', 'ImportLegacyBalances', 'Importer les créances papier (factures LEGACY_BALANCE)', 'Restitution',
       permission=['finance.global.read'], reauth=True, request=REQUESTS + 'LegacyBalanceImportRequest',
       response=BILLING + 'ImportReportResponse', implemented=True, task='X01', errors=(422,),
       description='Chaque créance devient une pièce d\'origine LEGACY_BALANCE (référence papier, solde d\'ouverture) ; aucun encaissement ancien n\'apparaît comme reçu aujourd\'hui.'),

    # --- Réservation publique (L2) --------------------------------------------------------------------
    op('get', '/public/v1/services', 'ListPublicServices', 'Prestations réservables', 'Réservation publique (L2)',
       response=PUBLIC + 'PublicServiceList', task='L2D02', security='none', idempotent=False),
    op('get', '/public/v1/slots', 'ListPublicSlots', 'Créneaux administratifs disponibles', 'Réservation publique (L2)',
       response=PUBLIC + 'PublicSlotList', task='L2D02', security='none', idempotent=False,
       params=(('query', 'service_id', 'Prestation.'), ('query', 'from', 'Instant UTC de début.'), ('query', 'to', 'Instant UTC de fin.'))),
    op('post', '/public/v1/booking-requests', 'RequestPublicBooking', 'Demander un rendez-vous (consentement, anti-abus)', 'Réservation publique (L2)',
       request=REQUESTS + 'BookingRequest', response=PUBLIC + 'BookingReceiptResponse', status=201, task='L2D02', security='none', idempotent=True,
       errors=(409, 422, 429), description='Aucun jeton de back-office ; référence publique distincte ; pas de déduction indiquant qu\'un téléphone possède un dossier.'),
]

ERRORS = {
    400: ('BadRequest', 'Requête refusée (par exemple SESSION_REQUIRED : origine non reconnue).'),
    401: ('Unauthorized', 'AUTH_REQUIRED : reconnexion, saisies conservées.'),
    403: ('Forbidden', 'ACTION_FORBIDDEN : droit insuffisant, sans divulguer la cible.'),
    404: ('NotFound', 'RESOURCE_NOT_FOUND : inexistante ou inaccessible (autre cabinet).'),
    409: ('Conflict', 'VERSION_CONFLICT, STATE_TRANSITION_REFUSED, PAYMENT_EXCEEDS_BALANCE, STOCK_UNAVAILABLE, IDEMPOTENCY_PAYLOAD_MISMATCH, SLOT_UNAVAILABLE ou garde-fou métier.'),
    410: ('Gone', 'Ressource expirée (export).'),
    413: ('PayloadTooLarge', 'Taille au-delà des limites du contrat 23.'),
    419: ('SessionExpired', 'SESSION_CONTEXT_EXPIRED : renouveler session/CSRF et rejouer la même commande idempotente.'),
    422: ('ValidationFailed', 'VALIDATION_FAILED, EXAM_PAYMENT_REQUIRED, APPROVAL_REQUIRED_OR_EXPIRED, LOT_EXPIRED…'),
    423: ('ReauthenticationRequired', 'REAUTHENTICATION_REQUIRED : confirmer le mot de passe.'),
    429: ('RateLimited', 'RATE_LIMITED : attendre (en-tête Retry-After), sans rejouer un paiement sans clé.'),
    503: ('Unavailable', 'CLINIC_NOT_CONFIGURED ou DEPENDENCY_UNAVAILABLE.'),
}


def build_operation(spec):
    operation = {
        'operationId': spec['operation_id'],
        'summary': spec['summary'],
        'tags': [spec['tag']],
    }
    if spec['description']:
        operation['description'] = spec['description']
    if spec['security'] == 'none':
        operation['security'] = []
    elif spec['security'] == 'csrf':
        operation['security'] = [{'xsrfToken': []}]
    elif spec['method'] == 'get':
        operation['security'] = [{'sessionCookie': []}]
    else:
        operation['security'] = [{'sessionCookie': [], 'xsrfToken': []}]

    parameters = []
    if spec['idempotent']:
        parameters.append({'$ref': '#/components/parameters/IdempotencyKey'})
    for location, name, description in spec['params']:
        parameter = {'name': name, 'in': location, 'required': location == 'path', 'description': description}
        if name == 'id':
            parameter['schema'] = {'$ref': './schemas/common.json#/$defs/Ulid'}
        elif name in ('page',):
            parameter['schema'] = {'type': 'integer', 'minimum': 1}
        else:
            parameter['schema'] = {'type': 'string'}
        parameters.append(parameter)
    if parameters:
        operation['parameters'] = parameters

    if spec['request'] == 'binary-pdf':
        operation['requestBody'] = {'required': True, 'content': {'application/pdf': {'schema': {'type': 'string', 'contentMediaType': 'application/pdf'}}}}
    elif spec['request'] == 'binary-evidence':
        operation['requestBody'] = {'required': True, 'content': {mime: {'schema': {'type': 'string', 'contentMediaType': mime}}
                                                                  for mime in ('application/pdf', 'image/jpeg', 'image/png')}}
    elif spec['request'] == 'multipart-csv':
        operation['requestBody'] = {'required': True, 'content': {'multipart/form-data': {'schema': {
            'type': 'object', 'required': ['file', 'dry_run'],
            'properties': {'file': {'type': 'string', 'contentMediaType': 'text/csv'}, 'dry_run': {'type': 'boolean'}}}}}}
    elif spec['request']:
        operation['requestBody'] = {'required': True, 'content': {spec['request_type']: {'schema': {'$ref': spec['request']}}}}

    responses = {}
    status = str(spec['status'])
    if spec['response']:
        responses[status] = {'description': 'Succès.', 'content': {'application/json': {'schema': {'$ref': spec['response']}}}}
    elif spec['operation_id'] in ('GetDocument', 'DownloadExport'):
        responses['200'] = {'description': 'Fichier privé.', 'content': {'application/octet-stream': {'schema': {'type': 'string', 'contentMediaType': 'application/octet-stream'}}}}
    else:
        responses[status] = {'description': 'Succès, sans contenu.'}
    codes = set(spec['errors'])
    if spec['security'] != 'none':
        codes |= {401, 403, 419} if spec['operation_id'] != 'Login' else {419}
    if spec['reauth']:
        codes.add(423)
    if spec['security'] == 'none' and spec['operation_id'] == 'GetCsrfCookie':
        codes = set()
    for code in sorted(codes):
        responses[str(code)] = {'$ref': '#/components/responses/' + ERRORS[code][0]}
    operation['responses'] = responses

    if spec['permission']:
        operation['x-permission'] = spec['permission']
    operation['x-reauthentication'] = spec['reauth']
    operation['x-idempotency'] = 'required' if spec['idempotent'] else 'none'
    if spec['command']:
        operation['x-offline-command'] = spec['command']
    if spec['read_scope']:
        operation['x-read-scope'] = spec['read_scope']
    operation['x-implementation-status'] = 'IMPLEMENTED' if spec['implemented'] else 'PLANNED'
    operation['x-backlog-task'] = spec['task']
    return operation


def build():
    paths = {}
    for spec in OPERATIONS_TABLE:
        path_item = paths.setdefault(spec['path'], {})
        if spec['path'].startswith('/public/'):
            path_item.setdefault('servers', [{'url': '/', 'description': 'Routes publiques hors /api (fichier 08, L2).'}])
        if spec['method'] in path_item:
            raise SystemExit('ECHEC : opération en double ' + spec['method'] + ' ' + spec['path'])
        path_item[spec['method']] = build_operation(spec)

    for name, entry in COMMANDS.items():
        method, route = entry['direct_route'].split(' ', 1)
        operation = paths.get('/v1' + route, {}).get(method.lower())
        if operation is None or operation.get('x-offline-command') != name:
            raise SystemExit('ECHEC : la route directe ' + entry['direct_route'] + ' de ' + name + ' manque dans la table OpenAPI')

    components = {
        'securitySchemes': {
            'sessionCookie': {'type': 'apiKey', 'in': 'cookie', 'name': 'eagles-eye-optics-medical-session',
                              'description': 'Session Sanctum du seul sous-domaine applicatif (cookie Secure, HttpOnly, SameSite=Lax). Le nom suit SESSION_COOKIE.'},
            'xsrfToken': {'type': 'apiKey', 'in': 'header', 'name': 'X-XSRF-TOKEN',
                          'description': 'Jeton CSRF lu dans le cookie XSRF-TOKEN ; une écriture marquée Sec-Fetch-Site: same-origin est aussi acceptée (Fetch Metadata).'},
        },
        'parameters': {
            'IdempotencyKey': {'name': 'Idempotency-Key', 'in': 'header', 'required': True,
                               'description': 'ULID de l\'intention : même clé et même contenu = résultat durable existant ; même clé et contenu différent = 409 IDEMPOTENCY_PAYLOAD_MISMATCH ; une nouvelle intention reçoit une nouvelle clé.',
                               'schema': {'$ref': './schemas/common.json#/$defs/Ulid'}},
        },
        'responses': {
            name: {'description': description, 'content': {'application/json': {'schema': {'$ref': './schemas/error.json'}}}}
            for name, description in ERRORS.values()
        },
    }
    tags = []
    for spec in OPERATIONS_TABLE:
        if spec['tag'] not in tags:
            tags.append(spec['tag'])
    return {
        'openapi': '3.1.0',
        'info': {
            'title': 'Eagle\'s Eye Optics Medical — API privée',
            'version': '0.1.0-l0',
            'description': ('Contrat des routes du fichier 08, des compléments du contrat 23 et du protocole du fichier 19. '
                            'Corps et réponses : JSON Schema 2020-12 de contracts/, identiques en PHP et en TypeScript. '
                            'Timestamps UTC à la milliseconde, dates civiles AAAA-MM-JJ, montants entiers XAF, quantités et mesures en chaînes exactes. '
                            'x-implementation-status indique ce qui est réellement implémenté. Généré par contracts/tools/build_openapi.py : ne pas modifier à la main.'),
        },
        'jsonSchemaDialect': 'https://json-schema.org/draft/2020-12/schema',
        'servers': [{'url': '/api', 'description': 'API privée de l\'application, origine unique HTTPS du sous-domaine.'}],
        'tags': [{'name': tag} for tag in tags],
        'paths': paths,
        'components': components,
    }


# --------------------------------------------------------------------------------------------------
# Émetteur YAML minimal et déterministe
# --------------------------------------------------------------------------------------------------

PLAIN_KEY = re.compile(r'^[A-Za-z_$/][A-Za-z0-9_.$/{}-]*$')
RESERVED = {'true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n', '~'}


def key(name):
    name = str(name)
    if PLAIN_KEY.match(name) and name.lower() not in RESERVED:
        return name
    return json.dumps(name, ensure_ascii=False)


def scalar(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if value == {}:
        return '{}'
    if value == []:
        return '[]'
    raise TypeError(type(value))


def emit(value, indent=0):
    pad = '  ' * indent
    lines = []
    if isinstance(value, dict):
        for name, item in value.items():
            if isinstance(item, (dict, list)) and item:
                lines.append(pad + key(name) + ':')
                lines.extend(emit(item, indent + 1))
            else:
                lines.append(pad + key(name) + ': ' + scalar(item))
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)) and item:
                inner = emit(item, indent + 1)
                lines.append(pad + '- ' + inner[0].lstrip())
                lines.extend(inner[1:])
            else:
                lines.append(pad + '- ' + scalar(item))
    else:
        lines.append(pad + scalar(value))
    return lines


def main():
    document = build()
    text = '# Généré par contracts/tools/build_openapi.py : ne pas modifier à la main.\n' + '\n'.join(emit(document)) + '\n'
    if '--check' in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding='utf-8') != text:
            print('ECHEC : contracts/openapi.yaml périmé : relancer contracts/tools/build_openapi.py', file=sys.stderr)
            sys.exit(1)
        print('OpenAPI à jour : ' + str(len(OPERATIONS_TABLE)) + ' opérations.')
        return
    OUT.write_text(text, encoding='utf-8')
    print(str(len(OPERATIONS_TABLE)) + ' opérations écrites dans contracts/openapi.yaml')


if __name__ == '__main__':
    main()

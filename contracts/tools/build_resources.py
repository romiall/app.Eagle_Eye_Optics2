"""Ressources de réponse, requêtes HTTP sans commande hors-ligne et snapshots de pièces (F06).

Source unique des DTO de l'API (fichiers 08, 19, 23) et des contenus figés écrits dans les colonnes JSON
`snapshot` du catalogue (fichier 11 : un document est généré à partir de son snapshot, jamais recalculé
sur l'identité ou les prix récents). Produit :
  - contracts/schemas/resources/<groupe>.json : objets renvoyés par l'API et leurs enveloppes
    {data: …} / {data: […], meta: Pagination} ;
  - contracts/schemas/requests/<groupe>.json : corps des routes en ligne qui ne sont pas des commandes du
    journal local (session, comptes, préparation du poste, exports…) ; les routes qui appellent une
    commande utilisent contracts/commands/<Commande>.v1.json#/$defs/DirectRequest ;
  - contracts/snapshots/<pièce>.json : snapshots de facture, reçu, avoir, remboursement, remise et
    révision clinique.

Conventions : montants en entiers XAF, quantités et mesures en chaînes exactes, instants UTC à la
milliseconde, dates civiles AAAA-MM-JJ ; une valeur calculée par le serveur (solde, disponible,
ledger_version) est une projection, jamais une colonne inventée ; une rubrique non autorisée pour le
profil est absente de la réponse (annotation x-read-scope dans l'OpenAPI).

  python3 contracts/tools/build_resources.py          # écrit les fichiers
  python3 contracts/tools/build_resources.py --check  # échoue si un fichier est absent ou périmé (CI)
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / 'contracts'
BASE = 'https://eeo.invalid/contracts/'
GENERATED = ' Généré par contracts/tools/build_resources.py : ne pas modifier à la main.'


class Refs:
    """Préfixes de $ref relatifs au fichier produit."""

    def __init__(self, depth):
        up = '../' * depth
        self.common = up + 'schemas/common.json#/$defs/' if depth else 'common.json#/$defs/'
        self.enums = up + 'schemas/enums.json#/$defs/' if depth else 'enums.json#/$defs/'
        self.steps = up + 'schemas/clinical-steps.json#/$defs/' if depth else 'clinical-steps.json#/$defs/'


R = Refs(2)        # contracts/schemas/resources/*.json et contracts/schemas/requests/*.json
S = Refs(1)        # contracts/snapshots/*.json
CURRENT = R


def ref(name):
    return {'$ref': CURRENT.common + name}


def enum(column):
    return {'$ref': CURRENT.enums + column}


def step(name):
    return {'$ref': CURRENT.steps + name}


def local(name):
    return {'$ref': '#/$defs/' + name}


def nullable(schema):
    return {'anyOf': [schema, {'type': 'null'}]}


def text(max_length=None, min_length=1):
    schema = {'type': 'string', 'minLength': min_length}
    if max_length:
        schema['maxLength'] = max_length
    return schema


def n_text(max_length=None):
    return nullable(text(max_length, 0))


def boolean():
    return {'type': 'boolean'}


def integer(minimum=None, maximum=None):
    schema = {'type': 'integer'}
    if minimum is not None:
        schema['minimum'] = minimum
    if maximum is not None:
        schema['maximum'] = maximum
    return schema


def array(items, min_items=0, max_items=None):
    schema = {'type': 'array', 'minItems': min_items, 'items': items}
    if max_items is not None:
        schema['maxItems'] = max_items
    return schema


def obj(properties, optional=(), description=None):
    """Objet strict : propriétés requises sauf celles de `optional` (rubriques soumises aux droits, champs
    facultatifs d'une requête)."""
    schema = {'type': 'object', 'additionalProperties': False,
              'required': [name for name in properties if name not in optional], 'properties': properties}
    if description:
        schema = {'description': description, **schema}
    return schema


def data(name):
    return obj({'data': local(name)})


def page(name):
    return obj({'data': array(local(name)), 'meta': ref('Pagination')})


def role():
    """Profils seedés par la baseline (table roles) : référentiel canonique, pas une énumération inventée."""
    return {'type': 'string', 'enum': ['CASHIER', 'CLINICIAN', 'MANAGER', 'RECEPTION']}


def ulid():
    return ref('Ulid')


def n_ulid():
    return ref('NullableUlid')


def instant():
    return ref('Instant')


def n_instant():
    return ref('NullableInstant')


def money():
    return ref('MoneyXaf')


def signed_money():
    return ref('SignedMoneyXaf')


def quantity():
    return ref('Quantity')


def decimal():
    return {'type': 'string', 'pattern': '^-?(0|[1-9][0-9]{0,8})(\\.[0-9]{1,3})?$', 'description': 'DECIMAL(12,3) en chaîne exacte, zéro admis.'}


def export_filters():
    return obj({'from': ref('NullableCivilDate'), 'to': ref('NullableCivilDate'), 'scope_role': nullable(role())},
               optional=('from', 'to', 'scope_role'),
               description="Filtres facultatifs d'un export contrôlé (période civile inclusive et profil de portée qui restreint sans jamais élargir les droits).")


def schema_file(path, title, description, defs):
    return path, {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': BASE + path,
        'title': title,
        'description': description + GENERATED,
        '$defs': defs,
    }


# --------------------------------------------------------------------------------------------------
# Ressources de réponse
# --------------------------------------------------------------------------------------------------

def access_resources():
    staff = {'id': ulid(), 'login': text(64), 'display_name': text(180), 'email': nullable({'type': 'string', 'maxLength': 254}),
             'active': boolean(), 'version': ref('Version'), 'roles': array(role(), 0, 4)}
    defs = {
        'StaffMemberSummary': obj(dict(staff), description='Compte dans une liste : sans les permissions effectives.'),
        'StaffMember': obj({**staff, 'permissions': array(ref('PermissionCode'))},
                           description='Compte du personnel : profils actifs et permissions effectives (jamais de hash ni de secret MFA).'),
        'ClinicSummary': obj({'id': ulid(), 'name': text(180), 'timezone': text(64), 'currency': ref('Currency'),
                              'production_documents_enabled': boolean(),
                              'enabled_modules': array(text(40)),
                              'exam_fee_control': {'type': 'string', 'enum': ['OFF', 'BILLED']}},
                             optional=('exam_fee_control',),
                             description='enabled_modules : modules ouverts par l\'exploitant (EEO_ENABLED_MODULES), codes de la navigation ; vide = aucun module métier exposé. exam_fee_control : OFF (défaut, le paiement de l\'examen n\'est contrôlé nulle part) ou BILLED (EEO_EXAM_FEE_CONTROL=billed : facture de frais réglée ou dispense de la gérante exigée au démarrage de l\'examen) ; absent pour un serveur plus ancien, lu comme OFF.'),
        'Me': obj({**staff, 'permissions': array(ref('PermissionCode')), 'clinic': local('ClinicSummary')},
                  description='Compte connecté : profils, permissions effectives, cabinet (nom, fuseau, monnaie).'),
        'ClinicSettings': obj({'id': ulid(), 'name': text(180), 'timezone': text(64), 'currency': ref('Currency'),
                               'address': n_text(2000), 'phone': nullable({'type': 'string', 'maxLength': 32}),
                               'email': nullable({'type': 'string', 'maxLength': 254}), 'tax_identifier': n_text(100),
                               'professional_mentions': n_text(4000), 'document_settings': nullable({'type': 'object'}),
                               'production_documents_enabled': boolean()},
                              description='Paramètres administratifs du cabinet (gérante).'),
        'ClinicDocumentIdentity': obj({'name': text(180), 'timezone': text(64), 'currency': ref('Currency'),
                                       'address': n_text(2000), 'phone': nullable({'type': 'string', 'maxLength': 32}),
                                       'email': nullable({'type': 'string', 'maxLength': 254}), 'tax_identifier': n_text(100),
                                       'professional_mentions': n_text(4000), 'document_settings': nullable({'type': 'object'}),
                                       'production_documents_enabled': boolean()},
                                      description='Identité du cabinet imprimée sur les documents (en-tête, pied) : lisible par tout profil qui produit un document. production_documents_enabled faux : documents de TEST marqués comme tels.'),
        'ClinicDocumentIdentityResponse': data('ClinicDocumentIdentity'),
        'Reauthentication': obj({'reauthenticated_until': instant()}),
        'StaffMemberResponse': data('StaffMember'),
        'StaffMemberPage': page('StaffMemberSummary'),
        'MeResponse': data('Me'),
        'ClinicSettingsResponse': data('ClinicSettings'),
        'ReauthenticationResponse': data('Reauthentication'),
    }
    return schema_file('schemas/resources/access.json', 'Ressources : session, comptes et cabinet', 'Réponses des routes F05 (implémentées).', defs)


def patient_resources():
    identity = {
        'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180),
        'sex': enum('patient_records.sex'), 'birth_date': ref('NullableCivilDate'),
        'phone_primary': nullable(ref('Phone')), 'archived': boolean(),
        'merged_into_patient_id': n_ulid(), 'version': ref('Version'),
    }
    defs = {
        'PatientSummary': obj(dict(identity), description='Résultat de recherche : identité administrative minimale (tous profils autorisés).'),
        'Patient': obj({**identity,
                        'birth_date_missing_reason': n_text(255), 'phone_secondary': nullable(ref('Phone')),
                        'phone_missing_reason': n_text(255), 'address': n_text(), 'profession': n_text(180),
                        'guardian_contact': nullable({'type': 'object'}), 'legacy_record': boolean(),
                        'first_known_visit_on': ref('NullableCivilDate'), 'first_visit_certified': boolean(),
                        'legacy_record_number': n_text(64), 'created_at': instant(), 'updated_at': instant(),
                        'merged_records': array(obj({'patient_id': ulid(), 'record_number': text(64), 'merged_at': instant()}))},
                       optional=('merged_records',),
                       description='Dossier administratif (identité durable) ; jamais de donnée clinique. merged_records (lecture '
                                   'GET /patients/{id} seulement) : fiches fusionnées dans celle-ci (L1D08), de la plus ancienne '
                                   'fusion à la plus récente.'),
        'PatientHistory': obj({
            'patient_id': ulid(),
            'visits': array(obj({'id': ulid(), 'reason': enum('visits.reason'), 'occurred_at': instant(), 'status': enum('visits.status')})),
            'consultations': array(obj({'id': ulid(), 'visit_id': ulid(), 'effective_at': instant(), 'status': enum('consultations.status'),
                                        'current_revision': integer(0), 'clinician_id': ulid()})),
            'invoices': array(obj({'id': ulid(), 'number': n_text(64), 'status': enum('invoices.status'), 'issued_at': n_instant(),
                                   'total_gross': money(), 'balance_due': signed_money()})),
        }, optional=('consultations', 'invoices'),
            description='Historique : visites pour tout profil autorisé ; consultations seulement avec clinical.read ; pièces seulement avec invoice.read.'),
        'PatientResponse': data('Patient'),
        'PatientPage': page('PatientSummary'),
        'PatientHistoryResponse': data('PatientHistory'),
        'Visit': obj({'id': ulid(), 'patient_id': ulid(), 'reason': enum('visits.reason'), 'occurred_at': instant(),
                      'status': enum('visits.status'), 'appointment_id': n_ulid(), 'exam_invoice_id': n_ulid(),
                      'exam_waiver_approval_id': n_ulid(), 'arrival_at': n_instant(), 'closed_at': n_instant(),
                      'administrative_note': n_text(), 'version': ref('Version'),
                      'patient': local('VisitPatient'),
                      'exam_fee_control': {'type': 'string', 'enum': ['NOT_CONTROLLED', 'NOT_APPLICABLE', 'UNPAID', 'WAIVER_REQUESTED', 'PAID', 'WAIVED']},
                      'exam_fee_receipt_number': n_text(64),
                      'consultation_id': n_ulid(), 'consultation_status': nullable(enum('consultations.status'))},
                     optional=('exam_fee_receipt_number',),
                     description="Visite : l’identité de base du patient accompagne la visite (file du jour). exam_fee_control, contrôle inactif (EEO_EXAM_FEE_CONTROL=off, défaut) : NOT_CONTROLLED pour un motif d’examen ou de suivi, NOT_APPLICABLE pour un achat ou un retrait ; contrôle actif (billed) : UNPAID (frais d’examen à encaisser), WAIVER_REQUESTED (dispense demandée, en attente de la gérante), PAID (facture de frais de CETTE visite réglée ; exam_fee_receipt_number = numéro de son dernier reçu), WAIVED (dispense accordée ou consommée), NOT_APPLICABLE. Jamais « payé » ni « gratuit » sans pièce : PAID s’appuie sur des reçus réels. Contrôle actif, le statut AWAITING_EXAM_FEE / READY_FOR_EXAM est celui du contrôle à l’instant (une dispense échue ramène « en attente »). consultation_id et consultation_status : la consultation de la visite, rendus SEULEMENT à un compte qui détient clinical.read (null sinon, y compris quand la consultation existe) ; null aussi quand l’examen n’est pas démarré."),
        'VisitPatient': obj({'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180),
                             'sex': enum('patient_records.sex'), 'birth_date': ref('NullableCivilDate')},
                            description="Identité administrative de base du patient d’une visite."),
        'VisitResponse': data('Visit'),
        'VisitPage': page('Visit'),
        'PatientMergeIdentity': obj({**identity, 'legacy_record_number': n_text(64), 'created_at': instant()},
                                    description="Identité administrative comparée avant une fusion (L1D08) : jamais de donnée clinique."),
        'PatientMergePreview': obj({
            'source': local('PatientMergeIdentity'), 'survivor': local('PatientMergeIdentity'),
            'linked': obj({'visits': integer(0), 'appointments_upcoming': integer(0),
                           'consultations': nullable(integer(0)), 'prescriptions': nullable(integer(0)),
                           'invoices': nullable(integer(0))}),
            'blockers': array(obj({'code': {'type': 'string', 'enum': ['SOURCE_ALREADY_MERGED', 'SURVIVOR_MERGED', 'SURVIVOR_ARCHIVED', 'VISIT_IN_PROGRESS', 'CONSULTATION_IN_PROGRESS', 'INVOICE_DRAFT', 'APPOINTMENT_UPCOMING']},
                                   'message': text(300)})),
            'can_merge': boolean(),
        }, description="Aperçu d'une fusion : les deux identités côte à côte, ce qui est rattaché à la fiche absorbée (visites "
                       "pour tout compte autorisé ; consultations et prescriptions seulement avec clinical.read, pièces émises "
                       "seulement avec invoice.read, null sinon) et les garde-fous qui empêchent la fusion."),
        'PatientMergePreviewResponse': data('PatientMergePreview'),
        'PatientMerge': obj({'id': ulid(), 'source_patient_id': ulid(), 'survivor_patient_id': ulid(), 'approved_by': ulid(),
                             'merged_at': instant(), 'reason': text(1000), 'source_version': ref('Version')},
                            description="Fusion enregistrée (patient_merges, immuable) : la fiche absorbée garde son identifiant, son numéro "
                                        "et son historique ; elle pointe vers la fiche conservée."),
        'PatientMergeResponse': data('PatientMerge'),
        **patient_activity_resources(),
    }
    return schema_file('schemas/resources/patients.json', 'Ressources : patients et visites', 'Identité administrative, historique filtré par profil, visites.', defs)


def patient_activity_resources():
    """Activité d'un patient (onglet « Activité » de la fiche, GET /patients/{id}/activity) : liste chronologique,
    une variante par type d'élément (discriminant `type`). Identifiants, dates, états, numéros et montants
    seulement : aucune propriété ne peut porter une valeur clinique (objets stricts)."""
    section = {'type': 'string', 'enum': ['VISITS', 'EXAMS', 'PRESCRIPTIONS', 'FINANCIAL']}
    screen_path = nullable({'type': 'string', 'pattern': '^/[A-Za-z0-9/_-]{1,199}$'})

    def item(type_code, properties, description):
        return obj({'type': {'const': type_code}, 'id': ulid(), 'occurred_at': instant(), 'screen_path': screen_path, **properties},
                   description=description)

    kinds = ['Visit', 'Consultation', 'Prescription', 'MedicationOrder', 'Invoice', 'Receipt', 'CreditNote', 'Refund']
    return {
        'PatientActivityVisit': item('VISIT', {'reason': enum('visits.reason'), 'status': enum('visits.status')},
                                     'Visite (section VISITS, patient.read) : motif et statut administratifs ; occurred_at = heure de la visite.'),
        'PatientActivityConsultation': item('CONSULTATION', {'status': enum('consultations.status'), 'clinician_name': text(180)},
                                            'Examen (section EXAMS, clinical.read) : date effective, état et professionnel ; aucun contenu clinique.'),
        'PatientActivityPrescription': item('PRESCRIPTION', {'origin': enum('optical_prescriptions.origin'), 'status': enum('optical_prescriptions.status'),
                                                             'version_no': integer(1), 'consultation_id': n_ulid(),
                                                             'external_prescribed_on': ref('NullableCivilDate')},
                                            'Prescription optique, une entrée par version (section PRESCRIPTIONS, clinical.read) : origine, état et numéro de version ; occurred_at = validation, sinon création. Aucune valeur de correction.'),
        'PatientActivityMedicationOrder': item('MEDICATION_ORDER', {'consultation_id': ulid(), 'consultation_status': enum('consultations.status')},
                                               'Ordonnance de médicaments d\'une consultation (section PRESCRIPTIONS, clinical.read) : id = consultation_id (ni table ni numéro propres) ; aucun nom de médicament.'),
        'PatientActivityInvoice': item('INVOICE', {'number': text(64), 'origin': enum('invoices.origin'), 'total_gross': money(), 'paid_net': money(),
                                                   'balance_due': signed_money(), 'credit_available': money(),
                                                   'settlement': {'type': 'string', 'enum': ['UNPAID', 'PARTIALLY_PAID', 'SETTLED', 'IN_CREDIT']}},
                                       'Facture émise (section FINANCIAL, invoice.read) : solde projeté par vw_invoice_balances, jamais un statut payé stocké ; SETTLED = solde nul (encaissements ou avoirs).'),
        'PatientActivityReceipt': item('RECEIPT', {'number': text(64), 'amount': ref('PositiveMoneyXaf'), 'method': enum('payments.method'),
                                                   'reversed_amount': money(), 'invoice_id': ulid(), 'invoice_number': n_text(64)},
                                       'Reçu d\'un encaissement confirmé (section FINANCIAL, invoice.read) : reversed_amount = contre-écritures du paiement ; le reçu reste, immuable.'),
        'PatientActivityCreditNote': item('CREDIT_NOTE', {'number': text(64), 'amount_gross': ref('PositiveMoneyXaf'), 'invoice_id': ulid(),
                                                          'invoice_number': n_text(64)},
                                          'Avoir émis (section FINANCIAL, invoice.read).'),
        'PatientActivityRefund': item('REFUND', {'number': text(64), 'amount': ref('PositiveMoneyXaf'), 'method': enum('refunds.method'),
                                                 'invoice_id': ulid(), 'invoice_number': n_text(64)},
                                      'Remboursement exécuté (section FINANCIAL, invoice.read).'),
        'PatientActivityItem': {'description': 'Élément de l\'activité, distingué par type.',
                                'oneOf': [local('PatientActivity' + kind) for kind in kinds]},
        'PatientActivitySection': obj({'section': section, 'total': integer(0)}),
        'PatientActivityMeta': obj({'current_page': integer(1), 'last_page': integer(1), 'per_page': {'type': 'integer', 'enum': [25]},
                                    'total': integer(0), 'section': nullable(section),
                                    'sections': array(local('PatientActivitySection'))},
                                   description='Pagination (25 par page) ; section = filtre appliqué (null : toutes les sections visibles) ; sections = sections VISIBLES du compte et leur nombre d\'éléments, aucune autre.'),
        'PatientActivity': obj({'data': array(local('PatientActivityItem'), 0, 25), 'meta': local('PatientActivityMeta')},
                               description='Activité du patient, du plus récent au plus ancien. Visites pour patient.read ; examens et ordonnances seulement avec clinical.read (module consultations) ; pièces financières seulement avec invoice.read (module sales). Brouillons et pièces abandonnées exclus.'),
    }


def clinical_resources():
    revision = obj({'id': ulid(), 'revision_no': integer(1), 'recorded_at': instant(), 'author_id': ulid(), 'reason': text(),
                    'previous_revision_id': n_ulid(), 'sha256': ref('Sha256Hex')})
    eye = obj({'id': ulid(), 'eye': enum('optical_prescription_eyes.eye'), 'no_correction': boolean(),
               'sphere': ref('NullableDiopter'), 'cylinder': ref('NullableDiopter'), 'axis': nullable(integer(0, 180)),
               'addition': ref('NullableDiopter'), 'fitting_height': ref('NullableDiopter')})
    term = obj({'id': ulid(), 'term_code': ref('Code'), 'other_text': n_text()})
    defs = {
        'ClinicalRevision': revision,
        'ClinicalRevisionDetail': obj({'id': ulid(), 'revision_no': integer(1), 'recorded_at': instant(), 'author_id': ulid(), 'reason': text(),
                                       'previous_revision_id': n_ulid(), 'sha256': ref('Sha256Hex'),
                                       'snapshot': {'$ref': '../../snapshots/clinical-revision.json'}},
                                      description='Révision figée avec son snapshot complet (clinical.read) : immuable, lue telle qu’enregistrée ; sha256 = SHA-256 de JCS(snapshot).'),
        'ClinicalRevisionResponse': data('ClinicalRevisionDetail'),
        'ConsultationPatient': obj({'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180),
                                    'sex': enum('patient_records.sex'), 'birth_date': ref('NullableCivilDate')},
                                   description='Identité administrative de base du patient de la consultation, pour l’en-tête de l’écran (comme Visit.patient).'),
        'ConsultationHeaderPatient': obj({'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180),
                                          'sex': enum('patient_records.sex'), 'birth_date': ref('NullableCivilDate'), 'profession': n_text(180)},
                                         description='Identité administrative de base du patient de la consultation ouverte, avec sa profession (donnée du dossier administratif que le cabinet note dans son carnet), pour l’en-tête de l’écran. La liste des examens (ConsultationSummary) ne porte pas la profession.'),
        'Consultation': obj({'id': ulid(), 'visit_id': ulid(), 'patient_id': ulid(), 'clinician_id': ulid(), 'effective_at': instant(),
                             'date_change_reason': n_text(), 'status': enum('consultations.status'), 'current_revision': integer(0),
                             'completed_at': n_instant(), 'finalization_missing_data_reason': n_text(), 'version': ref('Version'),
                             'patient': local('ConsultationHeaderPatient'), 'steps': step('AllSteps'), 'revisions': array(revision)},
                            description='Consultation complète : professionnel et gérante seulement (clinical.read). patient : identité administrative de base et profession, pour l’en-tête (sans dépendre du module Patients).'),
        'ConsultationSummary': obj({'id': ulid(), 'visit_id': ulid(), 'patient_id': ulid(), 'status': enum('consultations.status'),
                                    'effective_at': instant(), 'completed_at': n_instant(), 'current_revision': integer(0), 'version': integer(1),
                                    'patient': local('ConsultationPatient'),
                                    'clinician': obj({'id': ulid(), 'display_name': text(180)})},
                                   description='Examen dans la liste du cabinet : patient (identité administrative de base), état, dates, révision, version (attendue par la suppression d\'un brouillon) et professionnel. Aucune valeur clinique.'),
        'ConsultationSummaryPage': page('ConsultationSummary'),
        'VisualAcuityScale': obj({'id': ulid(), 'code': text(32), 'label': text(180), 'description': n_text(), 'active': boolean()},
                                 description='Échelle d’acuité configurée par le cabinet (visual_acuity_scales). Aucune conversion entre échelles n’est fournie ni présumée.'),
        'VisualAcuityScaleList': obj({'data': array(local('VisualAcuityScale'))}),
        'Prescription': obj({'id': ulid(), 'series_id': ulid(), 'version_no': integer(1), 'supersedes_id': n_ulid(), 'patient_id': ulid(),
                             'origin': enum('optical_prescriptions.origin'), 'consultation_id': n_ulid(),
                             'external_prescriber': n_text(180), 'external_prescribed_on': ref('NullableCivilDate'), 'external_file_id': n_ulid(),
                             'status': enum('optical_prescriptions.status'), 'usage_code': nullable(ref('Code')), 'usage_other': n_text(),
                             'lens_type_code': nullable(ref('Code')), 'lens_type_other': n_text(),
                             'lens_index': nullable({'type': 'string', 'pattern': '^[0-9]\\.[0-9]{1,2}$'}), 'lens_index_other': n_text(),
                             'pd_total': ref('NullableDiopter'), 'pd_od': ref('NullableDiopter'), 'pd_og': ref('NullableDiopter'),
                             'pd_inconsistency_reason': n_text(), 'notes': n_text(), 'eyes': array(eye, 2, 2), 'treatments': array(term),
                             'validated_at': n_instant(), 'validated_by': n_ulid(), 'validated_by_name': n_text(180),
                             'document_id': n_ulid(), 'updated_at': instant()},
                            description='Prescription versionnée ; updated_at sert de jeton de concurrence pour PATCH d\'un brouillon (optical_prescriptions n\'a pas de colonne version).'),
        'ConsultationResponse': data('Consultation'),
        'ConsultationDeletion': obj({'consultation_id': ulid(), 'visit_id': ulid(), 'visit_status': enum('visits.status'), 'visit_version': integer(1)},
                                    description="Résultat de la suppression d'un examen resté brouillon : la consultation n'existe plus ; la visite est remise dans son état d'avant l'examen (ARRIVED, ou READY_FOR_EXAM / AWAITING_EXAM_FEE quand le paiement de l'examen est contrôlé) avec sa nouvelle version."),
        'DeleteConsultationDraftResponse': data('ConsultationDeletion'),
        'PrescriptionDeletion': obj({'prescription_id': ulid(), 'patient_id': ulid(), 'consultation_id': n_ulid(), 'version_no': integer(1)},
                                    description="Résultat de la suppression d'un brouillon de prescription : la prescription n'existe plus (version_no : celle qu'elle portait ; la dernière version validée de sa série redevient la plus récente)."),
        'DeletePrescriptionDraftResponse': data('PrescriptionDeletion'),
        'PrescriptionResponse': data('Prescription'),
        'PrescriptionList': obj({'data': array(local('Prescription'))},
                                description='Toutes les versions des prescriptions de la consultation, de la plus récente à la plus ancienne.'),
    }
    return schema_file('schemas/resources/clinical.json', 'Ressources : consultations et prescriptions', 'Données cliniques réservées aux profils autorisés (fichier 09).', defs)


def billing_resources():
    line = obj({'id': ulid(), 'position': integer(1), 'catalog_item_id': n_ulid(), 'reference_snapshot': n_text(64),
                'description_snapshot': text(500), 'category_snapshot': ref('Code'), 'unit_snapshot': ref('Code'),
                'quantity': quantity(), 'unit_price_gross': money(), 'discount_gross': money(), 'line_total_gross': money(),
                'tax_code_snapshot': text(40), 'tax_rate_snapshot': nullable(ref('Rate')), 'tax_amount': nullable(money()),
                'prescription_id': n_ulid()})
    balance = obj({'total_gross': money(), 'paid_net': money(), 'credited': money(), 'refunded': money(),
                   'balance_due': signed_money(), 'credit_available': money(),
                   'settlement': {'type': 'string', 'enum': ['NOT_ISSUED', 'UNPAID', 'PARTIALLY_PAID', 'SETTLED', 'IN_CREDIT']}},
                  description='Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.')
    payment = obj({'id': ulid(), 'amount': ref('PositiveMoneyXaf'), 'method': enum('payments.method'), 'reference': n_text(180),
                   'effective_at': instant(), 'confirmed_at': n_instant(), 'status': enum('payments.status'),
                   'receipt_id': n_ulid(), 'receipt_number': n_text(64), 'reversed_amount': money(),
                   'received_by': ulid(), 'received_by_name': n_text(180)},
                  description='Encaissement d\'une facture ; received_by_name est le nom ACTUEL du compte qui a encaissé (le reçu garde le nom figé dans son snapshot).')
    document_state = obj({'document_id': ulid(), 'document_status': enum('generated_documents.status')},
                         description='État central du PDF : PENDING n\'autorise jamais à répéter l\'opération (fichier 08).')
    defs = {
        'CatalogItem': obj({'id': ulid(), 'reference': text(64), 'category_code': ref('Code'), 'name': text(180), 'brand': n_text(120),
                            'model': n_text(120), 'unit_code': ref('Code'), 'quantity_integer_only': boolean(), 'sale_price': money(),
                            'purchase_cost': nullable(money()), 'tax_rule_id': n_ulid(), 'stock_mode': enum('catalog_items.stock_mode'),
                            'requires_expiry': boolean(), 'low_stock_threshold': nullable(quantity()),
                            'expiry_alert_days': nullable(integer(0, 3650)), 'active': boolean(), 'public_visibility': boolean(),
                            'version': ref('Version')},
                           optional=('purchase_cost',),
                           description='Article : prix de vente pour les profils autorisés ; purchase_cost présent seulement pour la gérante (fichier 08). Mêmes champs que la requête CatalogItemRequest, pour pré-remplir la modification.'),
        'CatalogPage': page('CatalogItem'),
        'CatalogItemResponse': data('CatalogItem'),
        'TaxRule': obj({'id': ulid(), 'code': text(40), 'label': text(180), 'rate_percent': nullable(ref('Rate')), 'active': boolean(),
                        'validated_by': n_ulid(), 'validated_at': n_instant(), 'legal_note': n_text(), 'version': ref('Version')},
                       description='Règle fiscale saisie par la gérante ; jamais inventée : sans validation (validated_at), elle n\'est pas appliquée aux documents de production.'),
        'TaxRuleResponse': data('TaxRule'),
        'TaxRuleList': obj({'data': array(local('TaxRule'))}),
        'ImportReport': obj({'dry_run': boolean(), 'rows': integer(0), 'accepted': integer(0),
                             'rejected': array(obj({'line': integer(1), 'field': n_text(64), 'message': text()})),
                             'created_ids': array(ulid())},
                            description='Rapport d\'import contrôlé (X01) : aperçu sans écriture (dry_run) puis import ; une ligne refusée n\'est jamais importée partiellement.'),
        'ImportReportResponse': data('ImportReport'),
        'LegacyEvidence': obj({'file_id': ulid(), 'sha256': ref('Sha256Hex'),
                               'mime_type': {'type': 'string', 'enum': ['application/pdf', 'image/jpeg', 'image/png']},
                               'size_bytes': integer(1)},
                              description="Justificatif scanné d'une créance papier (X01), conservé dans le stockage privé du cabinet "
                                          "(classement FINANCIAL) ; aucune adresse publique."),
        'LegacyEvidenceResponse': data('LegacyEvidence'),
        'StatementEvidence': obj({'file_id': ulid(), 'sha256': ref('Sha256Hex'),
                                  'mime_type': {'type': 'string', 'enum': ['application/pdf', 'image/jpeg', 'image/png']},
                                  'size_bytes': integer(1)},
                                 description="Relevé numérisé (MoMo, banque, bordereau) d'un rapprochement de paiement (L1D06), conservé dans le stockage privé (classement FINANCIAL)."),
        'StatementEvidenceResponse': data('StatementEvidence'),
        'PaymentReconciliationLine': obj({'id': ulid(), 'payment_id': n_ulid(), 'refund_id': n_ulid(),
                                          'external_reference': n_text(180), 'statement_amount': signed_money(),
                                          'expected_item_amount': nullable(signed_money()),
                                          'status': enum('payment_reconciliation_lines.status'), 'note': n_text(1000),
                                          'kind': nullable({'type': 'string', 'enum': ['PAYMENT', 'REFUND']}),
                                          'piece_number': n_text(100), 'effective_at': n_instant(),
                                          'payment_reference': n_text(180)},
                                         description='Ligne de rapprochement d\'un canal de paiement : pointée sur un paiement ou un remboursement distinct (jamais les deux), ou écriture du relevé sans pièce interne (frais, rejet, écart).'),
        'PaymentReconciliation': obj({'id': ulid(), 'method': enum('payment_reconciliations.method'),
                                      'period_starts_at': instant(), 'period_ends_at': instant(),
                                      'status': enum('payment_reconciliations.status'),
                                      'expected_amount': signed_money(), 'current_expected_amount': signed_money(),
                                      'statement_amount': nullable(signed_money()), 'variance_amount': nullable(signed_money()),
                                      'matched_lines_amount': signed_money(),
                                      'disputed_lines_count': integer(0), 'unmatched_lines_count': integer(0),
                                      'statement_file': nullable(local('StatementEvidence')),
                                      'variance_reason': n_text(2000),
                                      'validated_by': n_ulid(), 'validated_by_name': n_text(180), 'validated_at': n_instant(),
                                      'lines': array(local('PaymentReconciliationLine')),
                                      'created_at': instant(), 'updated_at': instant()},
                                     description='Rapprochement de canal de paiement (L1D06 : Mobile Money, banque, chèque, espèces) : attendus calculés par le serveur ; un règlement ne se rapproche jamais dans deux rapprochements ; écart motivé à la validation ; immuable une fois VALIDATED.'),
        'PaymentReconciliationSummary': obj({'id': ulid(), 'method': enum('payment_reconciliations.method'),
                                             'period_starts_at': instant(), 'period_ends_at': instant(),
                                             'status': enum('payment_reconciliations.status'),
                                             'expected_amount': signed_money(), 'statement_amount': nullable(signed_money()),
                                             'variance_amount': nullable(signed_money()),
                                             'statement_file': nullable(local('StatementEvidence')),
                                             'variance_reason': n_text(2000),
                                             'validated_by': n_ulid(), 'validated_by_name': n_text(180), 'validated_at': n_instant(),
                                             'lines_count': integer(0), 'disputed_lines_count': integer(0), 'unmatched_lines_count': integer(0),
                                             'created_at': instant(), 'updated_at': instant()},
                                            description='En-tête d\'un rapprochement de canal sans ses lignes (liste).'),
        'PaymentReconciliationResponse': data('PaymentReconciliation'),
        'PaymentReconciliationPage': page('PaymentReconciliationSummary'),
        'PaymentReconciliationCandidate': obj({'kind': {'type': 'string', 'enum': ['PAYMENT', 'REFUND']},
                                               'payment_id': n_ulid(), 'refund_id': n_ulid(),
                                               'method': enum('payment_reconciliations.method'),
                                               'amount': signed_money(), 'gross_amount': ref('PositiveMoneyXaf'),
                                               'reversed_amount': money(), 'effective_at': instant(),
                                               'reference': n_text(180), 'invoice_id': ulid(),
                                               'invoice_number': n_text(64), 'piece_number': n_text(64),
                                               'patient_name': n_text(300)},
                                              description='Mouvement du grand livre (encaissement net de contre-écritures ou remboursement) du canal et de la période qui n\'est rattaché à aucun autre rapprochement.'),
        'PaymentReconciliationCandidates': obj({'method': enum('payment_reconciliations.method'),
                                                'period_starts_at': instant(), 'period_ends_at': instant(),
                                                'expected_amount': signed_money(),
                                                'candidates': array(local('PaymentReconciliationCandidate')),
                                                'freshness': obj({'complete': boolean(), 'silence_hours': integer(1),
                                                                  'devices': array(obj({'device_id': ulid(), 'name': text(180),
                                                                                        'last_sync_at': n_instant(),
                                                                                        'commands_pending': integer(0),
                                                                                        'commands_in_conflict': integer(0),
                                                                                        'state': {'type': 'string', 'enum': ['UP_TO_DATE', 'WAITING', 'SILENT']}}))})},
                                               description='Attendu serveur et mouvements éligibles au pointage pour un canal et une période, accompagnés de la fraîcheur des postes hors ligne.'),
        'PaymentReconciliationCandidatesResponse': data('PaymentReconciliationCandidates'),
        'InvoiceLine': line,
        'InvoiceBalance': balance,
        'InvoicePayment': payment,
        'DocumentState': document_state,
        'Invoice': obj({'id': ulid(), 'patient_id': ulid(), 'visit_id': n_ulid(), 'quote_id': n_ulid(), 'number': n_text(64), 'status': enum('invoices.status'),
                        'issued_at': n_instant(), 'issued_by': n_ulid(), 'issued_by_name': n_text(180),
                        'due_date': ref('NullableCivilDate'), 'currency': ref('Currency'),
                        'total_gross': money(), 'origin': enum('invoices.origin'), 'legacy_reference': n_text(100),
                        'draft_version': ref('Version'), 'ledger_version': nullable(ref('Version')), 'balance': balance,
                        'lines': array(line), 'payments': array(payment),
                        # Contre-écritures (B07) : facultatives dans le contrat pour les lectures antérieures, toujours
                        # rendues par le serveur.
                        'reversals': array(obj({'id': ulid(), 'payment_id': ulid(), 'amount': ref('PositiveMoneyXaf'),
                                                'reason': text(), 'recorded_at': instant(), 'recorded_by': ulid(),
                                                'recorded_by_name': n_text(180)})),
                        'credit_notes': array(obj({'id': ulid(), 'number': n_text(64), 'status': enum('credit_notes.status'),
                                                   'amount_gross': money(), 'issued_at': n_instant(), 'reason': text(),
                                                   'refunded_amount': money()},
                                                  optional=('reason', 'refunded_amount'))),
                        'refunds': array(obj({'id': ulid(), 'number': text(64), 'amount': ref('PositiveMoneyXaf'),
                                              'method': enum('refunds.method'), 'effective_at': instant(),
                                              'credit_note_id': ulid()},
                                             optional=('credit_note_id',))),
                        'write_owner': nullable(obj({'device_id': ulid(), 'epoch': integer(1), 'status': enum('invoice_write_owners.status')})),
                        'document': nullable(document_state),
                        'patient_snapshot': nullable({'$ref': '../../snapshots/invoice-patient.json'}),
                        'clinic_snapshot': nullable({'$ref': '../../snapshots/invoice-clinic.json'}),
                        'tax_snapshot': nullable({'$ref': '../../snapshots/invoice-tax.json'})},
                       optional=('reversals', 'quote_id'),
                       description='Facture : draft_version (version du brouillon, figée à l\'émission) et ledger_version (projection après émission, null pour un brouillon) nommées distinctement (fichier 08). patient_snapshot, clinic_snapshot et tax_snapshot sont les contenus FIGÉS à l\'émission (null pour un brouillon) : le document d\'une facture émise est produit d\'eux, jamais de l\'identité ni des prix actuels (fichier 11). Un document dont clinic_snapshot.test_document vaut true est un document TEST.')
        | {'allOf': [
            {'if': {'properties': {'status': {'const': 'DRAFT'}}, 'required': ['status']},
             'then': {'properties': {'number': {'type': 'null'}, 'issued_at': {'type': 'null'}, 'ledger_version': {'type': 'null'},
                                     'patient_snapshot': {'type': 'null'}, 'clinic_snapshot': {'type': 'null'}, 'tax_snapshot': {'type': 'null'}}}},
            {'if': {'properties': {'status': {'const': 'ISSUED'}}, 'required': ['status']},
             'then': {'properties': {'number': text(64), 'issued_at': instant(), 'issued_by': ulid(), 'ledger_version': ref('Version'),
                                     'patient_snapshot': {'$ref': '../../snapshots/invoice-patient.json'},
                                     'clinic_snapshot': {'$ref': '../../snapshots/invoice-clinic.json'},
                                     'tax_snapshot': {'$ref': '../../snapshots/invoice-tax.json'}}}},
        ]},
        'InvoiceSummary': obj({'id': ulid(), 'patient_id': ulid(),
                               'patient': nullable(obj({'id': ulid(), 'record_number': text(64), 'last_name': text(120),
                                                        'first_names': n_text(180)})),
                               'number': n_text(64), 'status': enum('invoices.status'), 'issued_at': n_instant(),
                               'total_gross': money(), 'balance_due': signed_money(), 'draft_version': ref('Version'),
                               'ledger_version': nullable(ref('Version'))},
                              description='Ligne de la liste des factures : identité de BASE du patient (dossier courant, jamais clinique), reste dû projeté.'),
        'InvoiceResponse': data('Invoice'),
        # Devis versionnés (L1D07) : ni créance, ni encaissement, ni réserve ; chaque révision émise est figée.
        'QuoteRecipient': obj({'kind': {'type': 'string', 'enum': ['PATIENT', 'PROSPECT']}, 'patient_id': n_ulid(),
                               'prospect_contact_id': n_ulid(), 'record_number': n_text(64), 'last_name': text(180),
                               'first_names': n_text(180), 'phone': n_text(32)},
                              description="Destinataire d'un devis : patient (dossier, nom, prénoms ; aucun téléphone) OU prospect "
                                          "(nom, téléphone). Figé à l'émission et à chaque révision ; jamais une donnée clinique."),
        'QuoteLine': obj({'id': ulid(), 'position': integer(1), 'catalog_item_id': n_ulid(), 'description_snapshot': text(500),
                          'unit_code': ref('Code'), 'quantity': quantity(), 'unit_price_gross': money(), 'discount_gross': money(),
                          'line_total_gross': money()},
                         description='Ligne ACTUELLE du devis (brouillon ou dernière révision) ; les révisions antérieures sont dans leur snapshot.'),
        'QuoteRevision': obj({'id': ulid(), 'revision_no': integer(1), 'recorded_at': instant(), 'authored_by': ulid(),
                              'authored_by_name': n_text(180), 'reason': text(),
                              'snapshot': {'$ref': '../../snapshots/quote-revision.json'}, 'document': nullable(document_state)},
                             description="Révision figée (immuable) : snapshot complet, source de son document, réimprimable à l'identique ; "
                                         "authored_by_name est le nom ACTUEL de l'auteur (le snapshot garde le nom figé)."),
        'Quote': obj({'id': ulid(), 'number': n_text(64), 'status': enum('quotes.status'), 'effective_status': enum('quotes.status'),
                      'valid_until': ref('NullableCivilDate'), 'total_gross': money(), 'recipient': local('QuoteRecipient'),
                      'issued_at': n_instant(), 'created_by': ulid(), 'created_by_name': n_text(180), 'version': ref('Version'),
                      'current_revision': integer(0), 'lines': array(local('QuoteLine')), 'revisions': array(local('QuoteRevision')),
                      'invoices': array(obj({'id': ulid(), 'number': n_text(64), 'status': enum('invoices.status')})),
                      'created_at': instant(), 'updated_at': instant()},
                     description="Devis (L1D07) : effective_status = statut à l'instant (EXPIRED pour un devis émis ou accepté dont la validité "
                                 "est passée, jamais écrit) ; revisions de la plus récente à la plus ancienne ; invoices = brouillons ou "
                                 "factures nés de sa conversion (provenance). Un devis ne compte ni dans le chiffre d'affaires ni dans l'encaissé.")
        | {'allOf': [
            {'if': {'properties': {'status': {'const': 'DRAFT'}}, 'required': ['status']},
             'then': {'properties': {'number': {'type': 'null'}, 'issued_at': {'type': 'null'}, 'current_revision': {'const': 0}}}},
        ]},
        'QuoteSummary': obj({'id': ulid(), 'number': n_text(64), 'status': enum('quotes.status'), 'effective_status': enum('quotes.status'),
                             'valid_until': ref('NullableCivilDate'), 'total_gross': money(), 'recipient': local('QuoteRecipient'),
                             'issued_at': n_instant(), 'current_revision': integer(0), 'version': ref('Version'), 'created_at': instant()},
                            description='Ligne de la liste des devis : destinataire (identité de base), statut à l\'instant, dernière révision.'),
        'QuoteResponse': data('Quote'),
        'QuoteDeletion': obj({'quote_id': ulid(), 'lines': integer(0)},
                             description="Résultat de la suppression d'un brouillon de devis jamais émis : le devis et ses lignes n'existent plus."),
        'DeleteQuoteDraftResponse': data('QuoteDeletion'),
        'QuotePage': page('QuoteSummary'),
        'InvoicePage': page('InvoiceSummary'),
        'PaymentResult': obj({'payment_id': ulid(), 'receipt_id': ulid(), 'receipt_number': text(64), 'invoice_id': ulid(),
                              'amount': ref('PositiveMoneyXaf'), 'currency': ref('Currency'), 'method': enum('payments.method'),
                              'effective_at': instant(), 'recorded_at': instant(), 'ledger_version': ref('Version'),
                              'balance': balance, 'receipt_document': document_state},
                             description='Réponse confirmée d\'encaissement (fichier 08) : références paiement/reçu, montant, solde recalculé, état du PDF.'),
        'ReversalResult': obj({'reversal_id': ulid(), 'payment_id': ulid(), 'invoice_id': ulid(), 'amount': ref('PositiveMoneyXaf'),
                               'recorded_at': instant(), 'ledger_version': ref('Version'), 'balance': balance}),
        'CreditNoteResult': obj({'credit_note_id': ulid(), 'number': text(64), 'invoice_id': ulid(), 'amount_gross': ref('PositiveMoneyXaf'),
                                 'issued_at': instant(), 'ledger_version': ref('Version'), 'balance': balance, 'document': document_state}),
        'RefundResult': obj({'refund_id': ulid(), 'number': text(64), 'invoice_id': ulid(), 'credit_note_id': ulid(),
                             'amount': ref('PositiveMoneyXaf'), 'method': enum('refunds.method'), 'effective_at': instant(),
                             'ledger_version': ref('Version'), 'balance': balance, 'document': document_state}),
        'PaymentResultResponse': data('PaymentResult'),
        'ReversalResultResponse': data('ReversalResult'),
        'CreditNoteResultResponse': data('CreditNoteResult'),
        'RefundResultResponse': data('RefundResult'),
        'CreditNote': obj({'id': ulid(), 'invoice_id': ulid(), 'number': n_text(64), 'status': enum('credit_notes.status'),
                           'amount_gross': ref('PositiveMoneyXaf'), 'reason': text(), 'approval_id': ulid(),
                           'issued_at': n_instant(), 'issued_by': n_ulid(), 'issued_by_name': n_text(180),
                           'refunded_amount': money(),
                           'lines': array(obj({'id': ulid(), 'invoice_line_id': ulid(), 'description_snapshot': n_text(500),
                                               'quantity': nullable(quantity()), 'amount_gross': ref('PositiveMoneyXaf'),
                                               'tax_amount': nullable(money()), 'reason': n_text()})),
                           'snapshot': nullable({'$ref': '../../snapshots/credit-note.json'}),
                           'document': nullable(document_state)},
                          description='Avoir (B07) : pièce liée à la facture, lignes d\'origine créditées, part déjà remboursée (refunded_amount), snapshot figé à l\'émission (source de son document, produit sur le poste) ; issued_by_name est le nom ACTUEL de l\'émetteur. Un avoir ne se modifie ni ne se supprime.'),
        'CreditNoteResponse': data('CreditNote'),
        'Refund': obj({'id': ulid(), 'invoice_id': ulid(), 'credit_note_id': ulid(), 'number': text(64),
                       'amount': ref('PositiveMoneyXaf'), 'method': enum('refunds.method'), 'reference': n_text(180),
                       'approval_id': ulid(), 'effective_at': instant(), 'cash_session_id': n_ulid(),
                       'created_by': ulid(), 'created_by_name': n_text(180),
                       'snapshot': {'$ref': '../../snapshots/refund.json'}, 'document': nullable(document_state)},
                      description='Remboursement d\'un crédit (B08) : sortie d\'argent liée à un avoir, snapshot figé (bénéficiaire = identité figée de la facture, source de son document) ; created_by_name est le nom ACTUEL de l\'auteur. Un remboursement ne se modifie ni ne se supprime.'),
        'RefundResponse': data('Refund'),
        'Approval': obj({'id': ulid(),
                         'kind': nullable({'type': 'string', 'enum': ['EXAM_FEE_WAIVER', 'DRAFT_LINE_RIGHTS', 'PAYMENT_REVERSAL', 'CREDIT_NOTE', 'REFUND',
                                                                      'CREDIT_DELIVERY', 'STOCK_MOVEMENT', 'CASH_MOVEMENT', 'CAMPAIGN_SEND']}),
                         'action_code': ref('PermissionCode'), 'target_type': text(64), 'target_id': ulid(),
                         'payload_hash': ref('Sha256Hex'),
                         'subject': nullable({'$ref': '../../commands/RequestApproval.v1.json#/$defs/ApprovalSubject'}),
                         'reason': text(), 'status': enum('approvals.status'),
                         'effective_status': enum('approvals.status'),
                         'requested_by': ulid(), 'requested_by_name': text(180), 'requested_at': instant(),
                         'decided_by': n_ulid(), 'decided_by_name': n_text(180), 'decided_at': n_instant(), 'decision_reason': n_text(4000),
                         'expires_at': n_instant(), 'consumed_at': n_instant(),
                         'target': local('ApprovalTarget')},
                        description='Approbation exacte (B06) : nature, cible et empreinte du contenu ; subject = contenu exact relu dans l\'audit de la demande et REVÉRIFIÉ contre payload_hash (null s\'il ne la reproduit pas, ou pour une exécution directe de la gérante) ; effective_status = statut à l\'instant (une demande ou un accord échus sont EXPIRED, jamais écrit) ; noms à la date de la demande et de la décision ; motif de la décision. Aucune donnée clinique.'),
        'ApprovalTarget': obj({'patient': nullable(obj({'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180)})),
                               'invoice_number': n_text(64), 'visit_occurred_at': n_instant(),
                               'payment': nullable(obj({'amount': ref('PositiveMoneyXaf'), 'method': enum('payments.method'), 'effective_at': instant()}))},
                              description='Résumé de la cible pour décider : identité administrative du patient, numéro de facture (null pour un brouillon), heure de la visite, paiement visé.'),
        'ApprovalResponse': data('Approval'),
        'ApprovalPage': page('Approval'),
        'CashRegister': obj({'id': ulid(), 'code': text(40), 'name': text(180), 'active': boolean()},
                            description='Caisse physique (cash_registers). Une seule caisse principale au premier jalon.'),
        'CashRegisterList': obj({'data': array(local('CashRegister'))}),
        'Receipt': obj({'id': ulid(), 'payment_id': ulid(), 'invoice_id': ulid(), 'number': text(64), 'issued_at': instant(),
                        'issued_by': ulid(), 'snapshot': {'$ref': '../../snapshots/receipt.json'}, 'document': nullable(document_state)},
                       description='Reçu d\'un encaissement : pièce immuable, numéro définitif jamais renuméroté, snapshot figé (source de son document ; fichier 11). Un reçu ne se modifie ni ne se supprime.'),
        'ReceiptResponse': data('Receipt'),
        'CashSession': obj({'id': ulid(), 'cash_register_id': ulid(), 'cashier_id': ulid(), 'opened_at': instant(), 'opening_amount': money(),
                            'closed_at': n_instant(), 'counted_amount': nullable(money()), 'expected_amount': nullable(money()),
                            'variance': nullable(signed_money()), 'variance_reason': n_text(), 'closed_by': n_ulid(),
                            'collected_cash': money(), 'refunded_cash': money(), 'theoretical_cash': signed_money()},
                           description='Session de caisse ; collected_cash, refunded_cash et theoretical_cash (ouverture + espèces encaissées − contre-écritures − remboursements espèces + mouvements autorisés) sont des projections recalculées à chaque lecture. expected_amount, counted_amount et variance ne sont renseignés qu\'à la clôture : photographie figée.'),
        'CashSessionResponse': data('CashSession'),
        'CurrentCashSessionResponse': obj({'data': nullable(local('CashSession'))}),
        'Delivery': obj({'id': ulid(), 'invoice_id': ulid(), 'status': enum('deliveries.status'), 'delivered_at': n_instant(),
                         'delivered_by': n_ulid(), 'credit_delivery_approval_id': n_ulid(),
                         'lines': array(obj({'id': ulid(), 'invoice_line_id': ulid(), 'item_id': ulid(), 'quantity': quantity(),
                                             'stock_position_id': n_ulid(), 'stock_lot_id': n_ulid(), 'reservation_id': n_ulid()}), 1)}),
        'DeliveryResponse': data('Delivery'),
        'InvoiceDeliveries': obj({'invoice_id': ulid(), 'invoice_number': n_text(64), 'invoice_status': enum('invoices.status'),
                                  'amount_due': nullable(money()),
                                  'lines': array(obj({'invoice_line_id': ulid(), 'position': integer(1), 'item_id': n_ulid(), 'description': text(500, 0),
                                                      'stock_mode': nullable(enum('catalog_items.stock_mode')), 'quantity_integer_only': boolean(),
                                                      'quantity': quantity(), 'delivered': decimal(), 'returned': decimal(), 'remaining': decimal(),
                                                      'reserved_open': decimal(), 'deliverable': boolean()})),
                                  'deliveries': array(obj({'id': ulid(), 'status': enum('deliveries.status'), 'delivered_at': instant(), 'delivered_by': ulid(),
                                                           'delivered_by_name': n_text(180), 'credit_delivery_approval_id': n_ulid(),
                                                           'lines': array(obj({'id': ulid(), 'invoice_line_id': ulid(), 'item_id': ulid(), 'description': text(500, 0),
                                                                               'quantity': quantity(), 'returned': decimal(), 'returnable': decimal(),
                                                                               'stock_position_id': n_ulid(), 'stock_lot_id': n_ulid(),
                                                                               'batch_number': n_text(80), 'expires_on': ref('NullableCivilDate')}))})),
                                  'returns': array(obj({'id': ulid(), 'delivery_line_id': ulid(), 'item_id': ulid(), 'quantity': quantity(),
                                                        'condition_code': enum('physical_returns.condition_code'), 'accepted_for_restock': boolean(),
                                                        'occurred_at': instant(), 'stock_movement_id': n_ulid(), 'credit_note_id': n_ulid()}))},
                                 description='Remises d\'une facture (I01, I02) : par ligne, quantité facturée, remise, retournée, reste à remettre, réserve ouverte et remettable maintenant ; remises confirmées (lot, nom ACTUEL de qui a remis) et retours physiques ; reste dû à l\'instant (null pour un brouillon : une facture non soldée se remet avec l\'approbation de la gérante). Projection recalculée à chaque lecture, aucun coût d\'achat.'),
        'InvoiceDeliveriesResponse': data('InvoiceDeliveries'),
    }
    # Caisse et rapport du jour (B05, R01 minimal) : sessions avec leurs libellés, relevé d'une session, caisse du jour,
    # règles de vente du compte. Montants en entiers FCFA, projections recalculées à chaque lecture.
    method_total = obj({'method': enum('payments.method'), 'count': integer(0), 'amount': signed_money()})
    defs.update({
        'CashSessionEntry': obj({**defs['CashSession']['properties'], 'cashier_name': n_text(180), 'closed_by_name': n_text(180),
                                 'register_code': n_text(40), 'register_name': n_text(180)},
                                description='Session de caisse et ses libellés : noms ACTUELS de la caissière et de qui a clôturé, caisse.'),
        'CashSessionPage': page('CashSessionEntry'),
        'CashSessionReport': obj({'session': local('CashSessionEntry'), 'cash_received': money(), 'cash_reversed': money(),
                                  'cash_refunded': money(), 'movements_in': money(), 'movements_out': money(),
                                  'movements': array(obj({'id': ulid(), 'kind': enum('cash_movements.kind'), 'signed_amount': signed_money(),
                                                          'reason': text(), 'occurred_at': instant()})),
                                  'payments': array(obj({'payment_id': ulid(), 'invoice_id': ulid(), 'invoice_number': n_text(64),
                                                         'receipt_id': n_ulid(), 'receipt_number': n_text(64), 'method': enum('payments.method'),
                                                         'amount': ref('PositiveMoneyXaf'), 'reversed_amount': money(), 'effective_at': instant()})),
                                  'other_methods': array(method_total),
                                  'generated_at': instant()},
                                 description='Relevé d\'une session : tiroir espèces (encaissés, contre-écritures, remboursés, mouvements), encaissements de la session et, hors tiroir, les autres modes encaissés par la même caissière pendant la session. Session ouverte : relevé provisoire. Source du PDF produit sur le poste.'),
        'CashSessionReportResponse': data('CashSessionReport'),
        'ExpenseCategory': obj({'id': ulid(), 'code': text(40, 2), 'name': text(180, 2), 'active': boolean()},
                               description="Catégorie de dépenses du cabinet (L1D05) : pas un plan comptable réglementaire ; aucune n'est préconfigurée."),
        'ExpenseCategoryResponse': data('ExpenseCategory'),
        'ExpenseCategoryList': obj({'data': array(local('ExpenseCategory'))}),
        'CashMovement': obj({'id': ulid(), 'cash_session_id': ulid(), 'kind': enum('cash_movements.kind'), 'signed_amount': signed_money(),
                             'reason': text(), 'reference': n_text(180), 'occurred_at': instant(),
                             'expense_category': nullable(obj({'id': ulid(), 'code': text(40), 'name': text(180)})),
                             'created_by': ulid(), 'created_by_name': n_text(180), 'approval_id': ulid(),
                             'approval_mode': {'type': 'string', 'enum': ['APPROVED', 'DIRECT']}},
                            description="Mouvement d'espèces hors vente (L1D05) : dépense catégorisée, dépôt, retrait ou correction de l'ouverture ; jamais un paiement (ni facture, ni reçu). approval_mode : demande accordée par la gérante, ou exécution directe de la gérante. Immuable."),
        'CashMovementResponse': data('CashMovement'),
        'CashVarianceReview': obj({'decision': {'type': 'string', 'enum': ['ACCEPTED', 'DISPUTED']}, 'note': n_text(1000),
                                   'reviewed_by': n_ulid(), 'reviewed_by_name': text(180), 'reviewed_at': instant()},
                                  description="Revue de l'écart d'une session clôturée par la gérante : fait d'audit, la session figée n'est pas réécrite."),
        'CashVarianceReviewResponse': data('CashVarianceReview'),
        'CashSessionMovements': obj({'cash_session_id': ulid(), 'closed': boolean(), 'movements': array(local('CashMovement')),
                                     'variance_review': nullable(local('CashVarianceReview'))}),
        'CashSessionMovementsResponse': data('CashSessionMovements'),
        'CashDayReport': obj({'date': ref('CivilDate'), 'scope': {'type': 'string', 'enum': ['CLINIC', 'OWN']},
                              'collections': array(obj({'method': enum('payments.method'), 'payments_count': integer(0),
                                                        'payments_amount': money(), 'reversals_amount': money(), 'refunds_amount': money(),
                                                        'net_amount': signed_money()})),
                              'net_total': signed_money(), 'sessions': array(local('CashSessionEntry')),
                              'issued': nullable(obj({'count': integer(0), 'total_gross': money()})),
                              'credited': nullable(obj({'count': integer(0), 'amount_gross': money()})),
                              'outstanding': nullable(obj({'invoices_count': integer(0), 'amount_due': money(), 'refundable_credit': money()})),
                              'generated_at': instant()},
                             description='Caisse du jour (jour civil du cabinet) : encaissements nets par mode (encaissés − contre-écritures − remboursements), sessions du jour. Portée CLINIC (finance.global.read) : tout le cabinet, factures et avoirs émis du jour, reste à encaisser des factures ouvertes à l\'instant de la lecture. Portée OWN (caissière) : ses encaissements et ses sessions seulement ; issued, credited et outstanding à null.'),
        'CashDayReportResponse': data('CashDayReport'),
        'SalesSettings': obj({'price_authority': boolean(), 'discount_cap_percent': ref('Rate'),
                              'payment_methods': array(enum('payments.method'), 1),
                              'payment_reference_required': array(enum('payments.method')),
                              'exam_fee_item_reference': n_text(64)},
                             description='Règles de vente du compte connecté, pour l\'affichage : le serveur reste seul juge à chaque commande.'),
        'SalesSettingsResponse': data('SalesSettings'),
    })
    return schema_file('schemas/resources/billing.json', 'Ressources : catalogue, ventes, approbations, caisse et remises',
                       'Pièces financières immuables, projections de solde, réponses des opérations financières.', defs)


def stock_resources():
    lot = obj({'lot_id': ulid(), 'batch_number': text(80), 'expires_on': ref('NullableCivilDate'), 'status': enum('stock_lots.status'),
               'on_hand': decimal(), 'reserved': decimal(), 'offline_allocated': decimal()})
    receipt_summary = {'id': ulid(), 'supplier_id': ulid(), 'supplier_name': text(180), 'location_id': ulid(), 'location_name': text(180),
                       'supplier_reference': text(100), 'received_at': instant(), 'status': enum('goods_receipts.status'),
                       'validated_at': n_instant(), 'notes': n_text(2000), 'line_count': integer(0, 200),
                       'known_cost_total': money(), 'unknown_cost_lines': integer(0, 200)}
    count_summary = {'id': ulid(), 'reference': text(64), 'location_id': ulid(), 'location_name': text(180), 'snapshot_at': instant(),
                     'status': enum('inventory_counts.status'), 'validated_at': n_instant(), 'line_count': integer(0, 100000),
                     'counted_lines': integer(0, 100000), 'variance_lines': integer(0, 100000),
                     'variance_value_known': nullable(signed_money()), 'unknown_cost_lines': nullable(integer(0, 100000))}
    defs = {
        'StockAvailability': obj({'item_id': ulid(), 'location_id': ulid(), 'stock_position_id': ulid(), 'on_hand': decimal(),
                                  'reserved': decimal(), 'offline_allocated': decimal(), 'central_available': decimal(),
                                  'lots': array(lot)},
                                 description='Disponible central = physique − réservations centrales − quotas locaux non consommés (fichier 19).'),
        'StockAvailabilityPage': page('StockAvailability'),
        'StockMovementHistoryEntry': obj({'id': ulid(), 'kind': enum('stock_movements.kind'), 'signed_quantity': decimal(), 'occurred_at': instant(),
                              'reason': text(2000), 'location_name': text(180),
                              'lot': nullable(obj({'lot_id': ulid(), 'batch_number': text(80), 'expires_on': ref('NullableCivilDate')})),
                              'actor_name': nullable(text(180)), 'unit_cost': nullable(money())},
                             description='Mouvement physique append-only d\'un article (cahier des charges §6) : quantité signée, motif, lot, auteur. Le coût unitaire n\'est rendu qu\'avec stock.valuation.read.'),
        'StockMovementHistoryPage': page('StockMovementHistoryEntry'),
        'StockLocation': obj({'id': ulid(), 'code': text(40), 'name': text(180), 'active': boolean()},
                             description='Emplacement de stock (rayon, atelier, réserve) ; PRINCIPAL créé par eeo:sales:bootstrap.'),
        'StockLocationList': obj({'data': array(local('StockLocation'))}),
        'StockMovement': obj({'id': ulid(), 'item_id': ulid(), 'position_id': ulid(), 'lot_id': n_ulid(), 'kind': enum('stock_movements.kind'),
                              'signed_quantity': decimal(), 'occurred_at': instant(), 'reason': text(), 'approval_id': n_ulid()}),
        'StockMovementResponse': data('StockMovement'),
        'OpeningStockResult': obj({'movements': array(local('StockMovement'), 1)}),
        'OpeningStockResponse': data('OpeningStockResult'),
        'PhysicalReturn': obj({'id': ulid(), 'delivery_line_id': ulid(), 'item_id': ulid(), 'quantity': quantity(),
                               'condition_code': enum('physical_returns.condition_code'), 'accepted_for_restock': boolean(),
                               'occurred_at': instant(), 'stock_movement_id': n_ulid(), 'credit_note_id': n_ulid()}),
        'PhysicalReturnResponse': data('PhysicalReturn'),
        'Supplier': obj({'id': ulid(), 'name': text(180), 'reference': text(64), 'phone': n_text(32), 'email': n_text(254),
                         'address': n_text(2000), 'is_optical_lab': boolean(), 'active': boolean()},
                        description='Fournisseur ou laboratoire (L1D01) : coordonnées d\'une entreprise ; il se désactive, il ne se supprime jamais.'),
        'SupplierResponse': data('Supplier'),
        'SupplierList': obj({'data': array(local('Supplier'))}),
        'GoodsReceiptSummary': obj(receipt_summary,
                                   description='Réception fournisseur sans ses lignes (liste) : valeur au coût connu arrondie au FCFA par ligne, lignes sans coût comptées à part (jamais valorisées à zéro).'),
        'GoodsReceiptPage': page('GoodsReceiptSummary'),
        'GoodsReceipt': obj({**receipt_summary, 'lines': array(local('GoodsReceiptLine'))},
                            description='Réception fournisseur (L1D01) : brouillon sans lot, ou validée (lots, coûts confirmés, un mouvement RECEIPT par ligne). Une réception validée est définitive.'),
        'GoodsReceiptLine': obj({'position': integer(1, 200), 'item_id': ulid(), 'item_reference': text(64), 'item_name': text(180),
                                 'quantity': decimal(), 'unit_cost': nullable(money()),
                                 'lot': nullable(obj({'lot_id': ulid(), 'batch_number': text(80), 'expires_on': ref('NullableCivilDate')}))},
                                description='Ligne de réception : coût unitaire connu ou null (inconnu, jamais zéro) ; lot renseigné à la validation.'),
        'GoodsReceiptResponse': data('GoodsReceipt'),
        'DeleteGoodsReceiptDraftResult': obj({'receipt_id': ulid(), 'deleted': boolean()}),
        'DeleteGoodsReceiptDraftResponse': data('DeleteGoodsReceiptDraftResult'),
        'InventoryCountLine': obj({'line_id': ulid(), 'item_id': ulid(), 'item_reference': text(64), 'item_name': text(180),
                                   'lot': nullable(obj({'lot_id': ulid(), 'batch_number': text(80), 'expires_on': ref('NullableCivilDate')})),
                                   'theoretical_quantity': decimal(), 'counted_quantity': nullable(decimal()), 'variance_quantity': nullable(decimal()),
                                   'variance_reason': n_text(1000), 'adjustment_quantity': nullable(decimal()),
                                   'unit_cost': nullable(money()), 'variance_value': nullable(signed_money())},
                                  description='Ligne d\'inventaire : théorique figé à l\'ouverture, quantité comptée, écart brut, ajustement écrit à la validation ; coût et valeur seulement avec stock.valuation.read (null ailleurs, et null quand le coût est inconnu).'),
        'InventoryCountSummary': obj(count_summary,
                                     description='Inventaire sans ses lignes (liste) : périmètre = un emplacement, figé à snapshot_at ; valeur des écarts au coût connu, lignes à coût inconnu comptées à part.'),
        'InventoryCountPage': page('InventoryCountSummary'),
        'InventoryCount': obj({**count_summary, 'lines': array(local('InventoryCountLine'))},
                              description='Inventaire (L1D02) : le comptage ne change jamais le stock ; la validation écrit un mouvement ADJUSTMENT signé par écart non nul, approuvé par la gérante.'),
        'InventoryCountResponse': data('InventoryCount'),
        'StockAlert': obj({'id': ulid(), 'kind': enum('stock_alerts.kind'), 'status': enum('stock_alerts.status'),
                           'item_id': ulid(), 'item_reference': text(64), 'item_name': text(180),
                           'location_id': ulid(), 'location_code': text(40), 'location_name': text(180),
                           'lot_id': n_ulid(), 'batch_number': n_text(80),
                           'detected_at': instant(), 'due_on': ref('NullableCivilDate'), 'resolved_at': n_instant(),
                           'acknowledged_by': n_ulid(), 'acknowledged_by_name': n_text(180),
                           'on_hand': nullable(decimal()), 'reserved': nullable(decimal()),
                           'offline_allocated': nullable(decimal()), 'central_available': nullable(decimal()),
                           'low_stock_threshold': nullable(decimal()), 'expiry_alert_days': nullable(integer(0, 3650)),
                           'expired': boolean()},
                          description='Alerte de stock bas ou de péremption proche/expirée (L1D03), dédupliquée et accompagnée des projections physiques, réservées et quotas des postes.'),
        'StockAlertPage': page('StockAlert'),
        'StockAlertResponse': data('StockAlert'),
        'StockAlertEvaluationSummary': obj({'opened': integer(0, 100000), 'reopened': integer(0, 100000),
                                            'resolved': integer(0, 100000), 'unchanged': integer(0, 100000),
                                            'open_count': integer(0, 100000), 'acknowledged_count': integer(0, 100000)},
                                           description='Résumé d\'une évaluation des alertes de stock : ouvertures, réouvertures, résolutions automatiques et total actif.'),
        'StockAlertEvaluationResponse': data('StockAlertEvaluationSummary'),
    }
    return schema_file('schemas/resources/stock.json', 'Ressources : stock', 'Disponibilités, mouvements, stock initial, retours physiques, fournisseurs, réceptions, inventaires et alertes.', defs)


def workshop_resources():
    lens_index = nullable({'type': 'string', 'pattern': '^(0|[1-9][0-9]?)(\\.[0-9]{1,2})?$'})
    document_state = obj({'document_id': ulid(), 'document_status': enum('generated_documents.status')},
                         description='État central du PDF (generated_documents) : document_id et statut (PENDING, READY, FAILED).')
    summary_fields = {
        'id': ulid(),
        'reference': text(64),
        'lab_reference': n_text(100),
        'status': enum('workshop_orders.status'),
        'is_overdue': boolean(),
        'ordered_at': instant(),
        'expected_at': n_instant(),
        'received_at': n_instant(),
        'ready_revision': integer(0),
        'quantity': quantity(),
        'supplier_id': ulid(),
        'supplier_name': text(180),
        'patient': local('WorkshopPatient'),
        'invoice_line_id': ulid(),
        'invoice_id': ulid(),
        'invoice_number': text(64),
        'invoice_line_description': text(500, 0),
        'prescription_id': ulid(),
        'prescription_version_no': integer(1),
        'frame_item_id': n_ulid(),
        'frame_reference': n_text(100),
        'version': ref('Version'),
        'document': nullable(document_state),
    }
    defs = {
        'WorkshopPatient': obj(
            {'id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180)},
            description="Identité administrative de base du patient dans l'application atelier (jamais imprimée sur le bon laboratoire anonymisé).",
        ),
        'WorkshopOrderEye': obj({
            'id': ulid(),
            'eye': enum('workshop_order_eyes.eye'),
            'sphere': ref('NullableDiopter'),
            'cylinder': ref('NullableDiopter'),
            'axis': nullable(integer(0, 180)),
            'addition': ref('NullableDiopter'),
            'pd': ref('NullableDiopter'),
            'fitting_height': ref('NullableDiopter'),
            'lens_type': text(100),
            'lens_index': lens_index,
            'treatments_snapshot': array(text(180)),
            'frame_reference_snapshot': n_text(100),
        }),
        'WorkshopEvent': obj({
            'id': ulid(),
            'sequence_no': integer(1),
            'event_type': enum('workshop_events.event_type'),
            'previous_status': nullable(enum('workshop_orders.status')),
            'new_status': nullable(enum('workshop_orders.status')),
            'quality_result': enum('workshop_events.quality_result'),
            'observations': n_text(),
            'occurred_at': instant(),
            'actor_id': ulid(),
            'actor_name': n_text(180),
            'delivery_line_id': n_ulid(),
        }),
        'WorkshopDeliveryCandidate': obj({
            'delivery_id': ulid(),
            'delivery_line_id': ulid(),
            'delivered_at': instant(),
            'quantity': quantity(),
            'item_name': text(500, 0),
            'batch_number': n_text(80),
        }),
        'WorkshopOrderSummary': obj(summary_fields, description='Commande atelier sans détail des yeux ni journal (liste et recherche).'),
        'WorkshopOrder': obj(
            {
                **summary_fields,
                'notes': n_text(),
                'created_by': ulid(),
                'created_by_name': n_text(180),
                'patient_id': ulid(),
                'prescription': obj({
                    'id': ulid(),
                    'series_id': ulid(),
                    'version_no': integer(1),
                    'origin': enum('optical_prescriptions.origin'),
                    'validated_at': instant(),
                    'usage_code': n_text(40),
                    'lens_type_code': n_text(40),
                    'lens_index': lens_index,
                    'pd_total': ref('NullableDiopter'),
                    'pd_od': ref('NullableDiopter'),
                    'pd_og': ref('NullableDiopter'),
                }),
                'supplier': obj({'id': ulid(), 'name': text(180), 'reference': text(64), 'phone': n_text(32), 'email': n_text(254)}),
                'frame': nullable(obj({'id': ulid(), 'reference': text(64), 'name': text(180), 'brand': n_text(120), 'model': n_text(120)})),
                'eyes': array(local('WorkshopOrderEye'), 1, 2),
                'events': array(local('WorkshopEvent'), 1),
                'eligible_delivery_lines': array(local('WorkshopDeliveryCandidate')),
                'snapshot': {'$ref': '../../snapshots/workshop-order.json'},
            },
            description='Commande atelier complète (L1D04) : spécifications OD/OG figées, journal append-only, liaisons remise, snapshot anonymisé du bon laboratoire.',
        ),
        'WorkshopOrderPage': page('WorkshopOrderSummary'),
        'WorkshopOrderResponse': data('WorkshopOrder'),
        'WorkshopEligibleInvoiceLine': obj({
            'invoice_line_id': ulid(),
            'invoice_id': ulid(),
            'invoice_number': text(64),
            'issued_at': instant(),
            'description': text(500, 0),
            'item_id': n_ulid(),
            'item_reference': n_text(64),
            'category_code': n_text(40),
            'quantity': quantity(),
            'ordered_quantity': decimal(),
            'remaining_quantity': decimal(),
            'linked_prescription_id': n_ulid(),
            'patient': local('WorkshopPatient'),
        }),
        'WorkshopEligiblePrescription': obj({
            'id': ulid(),
            'patient_id': ulid(),
            'series_id': ulid(),
            'version_no': integer(1),
            'origin': enum('optical_prescriptions.origin'),
            'validated_at': instant(),
            'usage_code': n_text(40),
            'usage_other': n_text(500),
            'lens_type_code': n_text(40),
            'lens_type_other': n_text(500),
            'lens_index': lens_index,
            'pd_total': ref('NullableDiopter'),
            'pd_od': ref('NullableDiopter'),
            'pd_og': ref('NullableDiopter'),
            'treatments': array(obj({'term_code': ref('Code'), 'other_text': n_text(500)})),
            'eyes': array(obj({
                'eye': enum('optical_prescription_eyes.eye'),
                'no_correction': boolean(),
                'sphere': ref('NullableDiopter'),
                'cylinder': ref('NullableDiopter'),
                'axis': nullable(integer(0, 180)),
                'addition': ref('NullableDiopter'),
                'fitting_height': ref('NullableDiopter'),
            }), 1, 2),
        }),
        'WorkshopEligibleSupplier': obj({'id': ulid(), 'name': text(180), 'reference': text(64), 'phone': n_text(32), 'email': n_text(254)}),
        'WorkshopEligibleFrame': obj({'id': ulid(), 'reference': text(64), 'name': text(180), 'brand': n_text(120), 'model': n_text(120)}),
        'WorkshopEligibleLines': obj({
            'lines': array(local('WorkshopEligibleInvoiceLine')),
            'prescriptions': array(local('WorkshopEligiblePrescription')),
            'suppliers': array(local('WorkshopEligibleSupplier')),
            'frames': array(local('WorkshopEligibleFrame')),
        }, description="Éléments disponibles pour créer une commande atelier (L1D04) : lignes facturées avec reliquat > 0, prescriptions validées correspondantes, laboratoires optiques actifs et montures actives. Aucun montant ni antécédent."),
        'WorkshopEligibleLinesResponse': data('WorkshopEligibleLines'),
    }
    return schema_file('schemas/resources/workshop.json', 'Ressources : atelier optique', 'Commandes laboratoire, suivi montage/contrôle qualité et préparation bon laboratoire (L1D04).', defs)


def scheduling_resources():
    defs = {
        'SchedulingPatient': obj({'id': ulid(), 'record_number': text(32), 'last_name': text(180), 'first_names': n_text(180)},
                                 description='Identité administrative minimale du patient d\'un rendez-vous, d\'un suivi ou d\'une tâche.'),
        'OpeningHour': obj({'id': ulid(), 'weekday': integer(1, 7), 'opens_at': ref('LocalTime'), 'closes_at': ref('LocalTime'),
                            'valid_from': ref('NullableCivilDate'), 'valid_to': ref('NullableCivilDate')},
                           description='Créneau hebdomadaire d\'une ressource (1 = lundi … 7 = dimanche), heure locale du cabinet.'),
        'SchedulingResource': obj({'id': ulid(), 'name': text(180), 'professional_user_id': n_ulid(), 'professional_name': n_text(180),
                                   'active': boolean(), 'slot_duration_minutes': integer(1, 1440), 'version': ref('Version'),
                                   'opening_hours': array(local('OpeningHour'))},
                                  description='Professionnel ou salle réservable ; aucun horaire n\'est inventé : sans créneau hebdomadaire, aucun rendez-vous n\'est proposé.'),
        'SchedulingResourceResponse': data('SchedulingResource'),
        'AppointmentService': obj({'id': ulid(), 'name': text(180), 'duration_minutes': integer(1, 1440), 'active': boolean(),
                                   'version': ref('Version')}),
        'AppointmentServiceResponse': data('AppointmentService'),
        'ResourceException': obj({'id': ulid(), 'resource_id': ulid(), 'starts_at': instant(), 'ends_at': instant(),
                                  'is_available': boolean(), 'reason': text(4000)},
                                 description='Fermeture (is_available = false) ou ouverture exceptionnelle datée d\'une ressource.'),
        'ResourceExceptionResponse': data('ResourceException'),
        'AgendaConfiguration': obj({'resources': array(local('SchedulingResource')), 'services': array(local('AppointmentService')),
                                    'exceptions': array(local('ResourceException'))},
                                   description='Configuration de l\'agenda (S01) : ressources, prestations, exceptions à venir (90 jours).'),
        'AgendaConfigurationResponse': data('AgendaConfiguration'),
        'AvailableSlots': obj({'date': ref('CivilDate'), 'resource_id': ulid(), 'service_id': ulid(), 'duration_minutes': integer(1, 1440),
                               'slots': array(obj({'starts_at': instant(), 'ends_at': instant()}))},
                              description='Créneaux libres d\'un jour civil du cabinet pour une ressource et une prestation, lus SOUS l\'état du serveur au moment de la lecture : la réservation revérifie sous verrou.'),
        'AvailableSlotsResponse': data('AvailableSlots'),
        'FollowUpPlan': obj({'id': ulid(), 'consultation_id': ulid(), 'patient_id': ulid(), 'patient': local('SchedulingPatient'),
                             'reason': nullable(enum('follow_up_plans.reason')), 'anchor_kind': enum('follow_up_plans.anchor_kind'),
                             'anchor_date': ref('CivilDate'), 'interval_value': nullable(integer(1)),
                             'interval_unit': nullable(enum('follow_up_plans.interval_unit')),
                             'recommended_date': ref('CivilDate'), 'date_origin': enum('follow_up_plans.date_origin'),
                             'manual_reason': n_text(), 'reminder_enabled': boolean(),
                             'preferred_channel': enum('follow_up_plans.preferred_channel'),
                             'advance_value': nullable(integer(0)), 'advance_unit': nullable(enum('follow_up_plans.advance_unit')),
                             'reminder_date': ref('NullableCivilDate'), 'notes': n_text(),
                             'status': enum('follow_up_plans.status'), 'appointment_id': n_ulid(), 'version': ref('Version')},
                            description='Contrôle recommandé (S02), jamais une réservation implicite. reason, manual_reason et notes valent null '
                                        'pour un compte sans clinical.read (cloisonnement clinique) ; la date et l\'identité restent lisibles par l\'agenda.'),
        'FollowUpPlanResponse': data('FollowUpPlan'),
        'FollowUpPlanList': obj({'data': array(local('FollowUpPlan'))}),
        'Appointment': obj({'id': ulid(), 'patient_id': n_ulid(), 'patient': nullable(local('SchedulingPatient')),
                            'prospect_contact_id': n_ulid(), 'follow_up_id': n_ulid(),
                            'resource_id': ulid(), 'resource_name': text(180), 'service_id': ulid(), 'service_name': text(180),
                            'starts_at': instant(), 'ends_at': instant(),
                            'status': enum('appointments.status'), 'source': enum('appointments.source'),
                            'administrative_reason': n_text(), 'cancel_reason': n_text(), 'visit_id': n_ulid(), 'version': ref('Version')},
                           description='Rendez-vous ; un rendez-vous pris hors-ligne reste PENDING_CONFIRMATION jusqu\'à validation serveur. '
                                       'visit_id : arrivée enregistrée pour ce rendez-vous, s\'il y en a une.'),
        'AppointmentResponse': data('Appointment'),
        'AppointmentList': obj({'data': array(local('Appointment'))},
                               description='Rendez-vous d\'une période de jours civils du cabinet (31 jours au plus), du plus tôt au plus tard.'),
        'ContactAttempt': obj({'id': ulid(), 'occurred_at': instant(), 'result': enum('contact_attempts.result'),
                               'actor_name': n_text(180), 'administrative_note': n_text()}),
        'ContactTask': obj({'id': ulid(), 'patient_id': n_ulid(), 'patient': nullable(local('SchedulingPatient')),
                            'prospect_contact_id': n_ulid(), 'follow_up_id': n_ulid(),
                            'appointment_id': n_ulid(), 'invoice_id': n_ulid(),
                            'source_type': {'type': 'string', 'enum': ['FOLLOW_UP', 'APPOINTMENT', 'INVOICE', 'WORKSHOP_ORDER']},
                            'source_date': ref('NullableCivilDate'), 'source_starts_at': n_instant(),
                            'due_at': instant(), 'channel': enum('contact_tasks.channel'),
                            'status': enum('contact_tasks.status'), 'next_attempt_at': n_instant(), 'assigned_to': n_ulid(),
                            'administrative_notes': n_text(), 'attempts': array(local('ContactAttempt')), 'version': ref('Version')},
                           description='Tâche de contact INTERNE (L0 : aucun envoi SMS/WhatsApp réel ; le canal est la préférence du patient). '
                                       'Unique par source et échéance (dedupe_key) : jamais deux relances pour le même événement.'),
        'ContactTaskPage': page('ContactTask'),
        'ContactTaskList': obj({'data': array(local('ContactTask'))},
                               description='Tâches de contact d\'un jour civil du cabinet (échéance ou nouvelle tentative ce jour-là, ou en retard et encore ouvertes).'),
        'ContactAttemptResult': obj({'attempt_id': ulid(), 'task': local('ContactTask')}),
        'ContactAttemptResultResponse': data('ContactAttemptResult'),
        'ActivityReport': obj({'from': ref('CivilDate'), 'to': ref('CivilDate'), 'timezone': text(64),
                               'visits': integer(0),
                               'visits_by_reason': array(obj({'reason': enum('visits.reason'), 'count': integer(0)})),
                               'patients': integer(0), 'new_patients': integer(0), 'returning_patients': integer(0),
                               'sex': array(obj({'sex': enum('patient_records.sex'), 'count': integer(0)})),
                               'age_bands': array(obj({'min_age': integer(0), 'max_age': nullable(integer(0)), 'count': integer(0)})),
                               'age_unknown': integer(0),
                               'appointments': nullable(integer(0)), 'follow_ups_due': nullable(integer(0))},
                              # appointments : rendez-vous non annulés commençant dans la période (S01) ; follow_ups_due :
                              # patients distincts dont un contrôle recommandé non annulé tombe dans la période (S02) ; null si
                              # le module agenda est fermé.
                              description="Activité administrative (R02, statistics.activity) sur une période de jours civils du cabinet : "
                                          "visites non annulées, patients distincts, nouveaux (première visite connue au cabinet dans la "
                                          "période, reprise historique comprise) et anciens, sexe et tranches d'âge des patients de la "
                                          "période (âge au dernier jour de la période). Comptages seulement, aucune donnée clinique ni "
                                          "financière. appointments et follow_ups_due valent null tant que l'agenda (S01, S02) n'est pas livré."),
        'ActivityReportResponse': data('ActivityReport'),
        'ClinicalReport': obj({'from': ref('CivilDate'), 'to': ref('CivilDate'), 'timezone': text(64),
                               'consultations': integer(0), 'consultations_completed': integer(0),
                               'complaints': array(obj({'term_code': ref('Code'), 'count': integer(0)})),
                               'consultations_without_complaint': integer(0),
                               'prescriptions_validated': integer(0), 'medication_orders': integer(0),
                               'referrals': integer(0),
                               'referrals_by_urgency': array(obj({'urgency': nullable(enum('consultations.referral_urgency')), 'count': integer(0)})),
                               'referral_unknown': integer(0),
                               'ametropias': array(obj({'term_code': ref('Code'), 'count': integer(0)}))},
                              description="Statistiques cliniques agrégées (R02, statistics.clinical) des consultations dont la date "
                                          "effective tombe dans la période : nombre de consultations, par motif (une consultation compte "
                                          "une fois par motif), prescriptions optiques validées, ordonnances de médicaments, orientations "
                                          "par niveau d'urgence, amétropies. Comptages seulement, aucun patient identifiable, aucune "
                                          "agrégation de mesures (jamais d'acuités d'échelles différentes)."),
        'ClinicalReportResponse': data('ClinicalReport'),
    }
    return schema_file('schemas/resources/scheduling.json', 'Ressources : suivi, agenda et tâches de contact', 'Agenda interne, contrôles recommandés et relances (L0 sans envoi externe).', defs)


def operations_resources():
    jwk = obj({'kty': {'const': 'EC'}, 'crv': {'const': 'P-256'}, 'x': text(43, 43), 'y': text(43, 43)},
              description='Clé publique ES256 du poste (JWK, jamais de composante privée « d »).')
    grant = obj({'grant_id': ulid(), 'device_id': ulid(), 'user_id': ulid(), 'user_name': n_text(180),
                 'permissions_snapshot': array(ref('PermissionCode')),
                 'compartments': array({'type': 'string', 'enum': ['ADMINISTRATIVE', 'CLINICAL', 'FINANCIAL', 'MANAGER']}),
                 'rules_version': text(64), 'catalog_version': text(64), 'issued_at': instant(), 'valid_until': instant(),
                 'revoked_at': n_instant(), 'state': {'type': 'string', 'enum': ['ACTIVE', 'EXPIRED', 'REVOKED']},
                 'signed_payload': ref('CompactJws')},
                description='Grant hors-ligne SIGNÉ (O02) : JWS compact ES256, en-tête {alg, kid, typ=eeo-offline-grant+jws} et charge JCS '
                            '{catalog_sha256, catalog_version, clinic_id, compartments, device_id, grant_id, issued_at, permissions, rules_version, '
                            'user_id, v=1, valid_until}. Immuable : une révocation s\'ajoute (revoked_at), state est calculé à la lecture.')
    thumbprint = {'type': 'string', 'pattern': '^[A-Za-z0-9_-]{43}$'}
    allocation = obj({'allocation_id': ulid(), 'grant_id': ulid(), 'document_type': enum('document_number_allocations.document_type'),
                      'document_year': integer(2000, 9999), 'range_start': ref('Counter'), 'range_end': ref('Counter'),
                      'last_consumed_value': nullable(ref('Counter')), 'status': enum('document_number_allocations.status'),
                      'prefix': text(32), 'width': integer(1, 12)},
                     description='Plage de numéros pré-allouée à ce poste (O03), disjointe de toute autre et de la séquence centrale ; '
                                 'le poste rend le numéro consommé <prefix>-AAAA-<valeur complétée à gauche sur width chiffres>, comme le serveur.')
    quota = obj({'allocation_id': ulid(), 'item_id': ulid(), 'stock_position_id': ulid(), 'stock_lot_id': n_ulid(), 'allocated_quantity': quantity(),
                 'consumed_quantity': decimal(), 'returned_quantity': decimal(), 'status': enum('device_stock_allocations.status')},
                description='Quota de stock du poste (O03) : retiré du disponible central, jamais du physique ; disponible local = alloué − consommé − rendu − réservé localement.')
    catalog_item = obj({'id': ulid(), 'reference': text(64), 'category_code': text(40), 'name': text(180), 'unit_code': text(40),
                        'quantity_integer_only': boolean(), 'sale_price': money(), 'tax_rule_id': n_ulid(), 'stock_mode': text(40),
                        'requires_expiry': boolean(), 'active': boolean(), 'version': integer(1)})
    catalog_tax = obj({'id': ulid(), 'code': text(40), 'rate_percent': nullable({'type': 'string', 'pattern': '^(0|[1-9][0-9]{0,2})(\\.[0-9]{1,4})?$'}),
                       'active': boolean(), 'validated_at': nullable({'type': 'string'}), 'version': integer(1)})
    defs = {
        'PublicJwk': jwk,
        'EnrolledDevice': obj({'device_id': ulid(), 'device_code': text(64), 'name': text(180), 'kid': thumbprint,
                               'public_key_jwk': local('PublicJwk'), 'status': enum('enrolled_devices.status'),
                               'enrolled_at': instant(), 'responsible_user_id': ulid(), 'responsible_name': n_text(180),
                               'app_version': text(64), 'last_sync_at': n_instant(), 'active_grants': integer(0)},
                              description='Poste enrôlé (O02) : clé PUBLIQUE ES256 seulement ; kid = empreinte RFC 7638 de cette clé.'),
        'EnrolledDeviceResponse': data('EnrolledDevice'),
        'EnrolledDeviceList': obj({'data': array(local('EnrolledDevice'))}),
        'OfflineGrant': grant,
        'OfflineGrantResponse': data('OfflineGrant'),
        'OfflineGrantList': obj({'data': array(local('OfflineGrant'))}),
        'SigningKeySet': obj({'algorithm': {'const': 'ES256'}, 'grant_type': {'const': 'eeo-offline-grant+jws'},
                              'keys': array(obj({'kid': thumbprint, 'status': {'type': 'string', 'enum': ['CURRENT', 'RETIRED']},
                                                 'jwk': local('PublicJwk')}), 1)},
                             description='Clés PUBLIQUES du serveur qui signent les grants (courante puis retirées), à épingler par le poste.'),
        'SigningKeySetResponse': data('SigningKeySet'),
        'NumberAllocation': allocation,
        'StockQuota': quota,
        'Preparation': obj({'device_id': ulid(), 'grants': array(grant), 'number_allocations': array(allocation),
                            'stock_allocations': array(quota),
                            'write_owners': array(obj({'owner_id': ulid(), 'invoice_id': ulid(), 'epoch': integer(1)})),
                            'catalog': obj({'catalog_version': text(64), 'snapshot_sha256': ref('Sha256Hex'),
                                            'snapshot': obj({'items': array(catalog_item), 'tax_rules': array(catalog_tax)})}),
                            'rules_version': text(64), 'server_time': instant(), 'last_accepted_sequence': ref('Counter'),
                            'last_accepted_hash': ref('NullableSha256Hex')},
                           description='Préparation du poste (fichier 19, O03) : grants actifs par profil, plages de numéros ACTIVES et leur format, quotas, '
                                       'factures dont le poste est propriétaire, catalogue figé (contenu dont l\'empreinte JCS est signée dans le grant ; '
                                       'jamais de coût d\'achat), heure du serveur et préfixe finalisé du journal du poste.'),
        'PreparationResponse': data('Preparation'),
        'Release': obj({'device_id': ulid(), 'closed_number_allocations': array(ulid()), 'returned_stock_allocations': array(ulid()),
                        'closed_write_owners': array(ulid()), 'released_at': instant()}),
        'ReleaseResponse': data('Release'),
        'Replacement': obj({'device_id': ulid(), 'replacement_device_id': ulid(), 'status': {'const': 'REPLACED'},
                            'revoked_grants': integer(0), 'closing_number_allocations': array(ulid()),
                            'closing_stock_allocations': array(ulid()), 'closing_write_owners': array(ulid()),
                            'replaced_at': instant()},
                           description="Remplacement d'un poste (O07) : ancien poste REPLACED, ses grants révoqués (aucun droit transféré), ses plages, quotas et propriétés passés CLOSING jusqu'à la reprise de son journal exporté."),
        'ReplacementResponse': data('Replacement'),
        'CompatibilityResponse': obj({'data': {'$ref': '../compatibility.json'}},
                                     description="Déclaration de compatibilité de la release du serveur (O06), telle que publiée dans contracts/compatibility.json."),
        'DeviceHealth': obj({'device_id': ulid(), 'status': enum('enrolled_devices.status'), 'last_sync_at': n_instant(),
                             'last_accepted_sequence': ref('Counter'), 'last_accepted_hash': ref('NullableSha256Hex'),
                             'pending_conflicts': integer(0), 'app_version': text(64), 'grants_valid_until': n_instant(),
                             'number_ranges_low': array(ulid())}),
        'DeviceHealthResponse': data('DeviceHealth'),
        'Conflict': obj({'id': ulid(), 'command_id': ulid(), 'conflict_type': text(100), 'status': enum('sync_conflicts.status'),
                         'device_id': ulid(), 'created_at': instant(), 'resolution': n_text(), 'resolved_by': n_ulid(),
                         'resolved_at': n_instant(), 'command_name': text(100), 'device_sequence': ref('Counter'), 'device_name': text(180),
                         'actor_name': text(180), 'reason': n_text(1000),
                         'decision': nullable({'type': 'string', 'enum': ['ACCEPT_LOCAL', 'KEEP_CENTRAL', 'REJECT', 'CORRECT']}),
                         'resolved_by_name': n_text(180)},
                        description='Conflit de synchronisation : les instantanés chiffrés restent côté serveur ; seuls les profils autorisés les déchiffrent.'),
        'ConflictPage': page('Conflict'),
        'ConflictResponse': data('Conflict'),
        'GeneratedDocument': obj({'id': ulid(), 'document_type': enum('generated_documents.document_type'), 'source_key': text(100),
                                  'revision_no': integer(1), 'template_version': text(64), 'status': enum('generated_documents.status'),
                                  'sha256': ref('NullableSha256Hex'), 'generated_at': n_instant(), 'failure_code': n_text(100)}),
        'GeneratedDocumentResponse': data('GeneratedDocument'),
        'ExportFilters': export_filters(),
        'ExportRequest': obj({'id': ulid(), 'export_type': enum('export_requests.export_type'), 'patient_id': n_ulid(),
                              'filters': nullable(local('ExportFilters')), 'status': enum('export_requests.status'), 'requested_by': ulid(),
                              'completed_at': n_instant(), 'expires_at': n_instant(), 'error_code': n_text(100)}),
        'ExportRequestResponse': data('ExportRequest'),
        'ExportRequestList': obj({'data': array(local('ExportRequest'))}),
        'ExportManifest': obj({'export_id': ulid(), 'export_type': enum('export_requests.export_type'), 'patient_id': n_ulid(),
                               'clinic_id': ulid(), 'clinic_name': text(180), 'requested_by': ulid(),
                               'requested_by_name': text(180), 'generated_at': instant(), 'expires_at': n_instant(),
                               'archive_status': enum('export_requests.status'), 'filters': nullable(local('ExportFilters')),
                               'scope_permissions': array(text(64)),
                               'checksum_algorithm': {'type': 'string', 'enum': ['SHA-256']},
                               'archive_sha256': ref('NullableSha256Hex'),
                               'provenance': obj({'source': text(120), 'timezone': text(64), 'currency': ref('Currency'),
                                                  'manifest_preserved': boolean(), 'note': text(400)}),
                               'excluded_tables': array(obj({'table': text(64),
                                                             'reason': {'type': 'string', 'enum': ['PERMISSION_MISSING', 'NOT_IN_SCOPE']}})),
                               'tables': array(obj({'table': text(64), 'file': text(120), 'rows': integer(0),
                                                    'sha256': ref('Sha256Hex'),
                                                    'filter_mode': {'type': 'string', 'enum': ['PERIOD_FILTERED', 'PATIENT_SCOPED', 'SNAPSHOT_MASTER']},
                                                    'date_column': n_text(64)}))},
                              description="Manifeste permanent d'un export privé (conservé dans le journal d'audit même après expiration 48 h de l'archive ZIP)."),
        'ExportManifestResponse': data('ExportManifest'),
        'FinancialReport': obj({'period': obj({'from': ref('CivilDate'), 'to': ref('CivilDate')}),
                                'revenue': obj({'issued': obj({'count': integer(0), 'total_gross': money()}),
                                                'credited': obj({'count': integer(0), 'amount_gross': money()}),
                                                'net': signed_money(),
                                                'by_author': array(obj({'user_id': n_ulid(), 'display_name': nullable(text(180)),
                                                                        'issued_count': integer(0), 'issued_gross': money(),
                                                                        'credited_count': integer(0), 'credited_gross': money(),
                                                                        'net': signed_money()}))}),
                                'collections': obj({'by_method': array(obj({'method': enum('payments.method'), 'payments_count': integer(0),
                                                                            'payments_amount': money(), 'reversals_amount': money(),
                                                                            'refunds_amount': money(), 'net_amount': signed_money()})),
                                                    'net_total': signed_money(),
                                                    'corrections': obj({'reversals': obj({'count': integer(0), 'amount': money()}),
                                                                        'refunds': obj({'count': integer(0), 'amount': money()})}),
                                                    'on_legacy': obj({'payments_count': integer(0), 'net_amount': signed_money()}),
                                                    'by_author': array(obj({'user_id': n_ulid(), 'display_name': nullable(text(180)),
                                                                            'payments_count': integer(0), 'payments_amount': money(),
                                                                            'reversals_amount': money(), 'refunds_amount': money(),
                                                                            'net_amount': signed_money()}))}),
                                'receivables': obj({'invoices_count': integer(0), 'amount_due': money(),
                                                    'of_which_legacy': obj({'invoices_count': integer(0), 'amount_due': money()}),
                                                    'refundable_credit': obj({'invoices_count': integer(0), 'amount': money()})}),
                                'legacy_imported': obj({'count': integer(0), 'opening_balance': money()}),
                                'cash_sessions': obj({'closed_count': integer(0), 'expected_total': signed_money(),
                                                      'counted_total': signed_money(), 'variance_total': signed_money(),
                                                      'post_closure_reversals': money(), 'open_count': integer(0)}),
                                'freshness': obj({'complete': boolean(), 'silence_hours': integer(1),
                                                  'devices': array(obj({'device_id': ulid(), 'name': text(180), 'last_sync_at': n_instant(),
                                                                        'commands_pending': integer(0), 'commands_in_conflict': integer(0),
                                                                        'state': {'type': 'string', 'enum': ['UP_TO_DATE', 'WAITING', 'SILENT']}}))}),
                                'generated_at': instant()},
                               description="Finance du cabinet sur une période de jours civils (gérante, finance.global.read). Le chiffre d'affaires (factures émises − avoirs émis, reprises papier exclues) et les encaissements (paiements − contre-écritures − remboursements, à leur date effective) sont des indicateurs DISTINCTS ; les créances (restes dus de toutes périodes, dont la part des reprises papier) et les crédits à rembourser sont lus à l'instant de la lecture et restent à part. Vente par auteur de l'émission, encaissement par auteur du paiement. freshness : un état par poste de caisse hors ligne actif (UP_TO_DATE, WAITING : commandes reçues en attente ou en conflit, SILENT : rien reçu depuis plus de silence_hours) ; les totaux ne contiennent jamais une opération restée sur un poste."),
        'FinancialReportResponse': data('FinancialReport'),
        'AccountingExportReport': obj({'period': obj({'from': ref('CivilDate'), 'to': ref('CivilDate')}),
                                       'currency': ref('Currency'),
                                       'freshness': obj({'complete': boolean(), 'silence_hours': integer(1),
                                                         'devices': array(obj({'device_id': ulid(), 'name': text(180), 'last_sync_at': n_instant(),
                                                                               'commands_pending': integer(0), 'commands_in_conflict': integer(0),
                                                                               'state': {'type': 'string', 'enum': ['UP_TO_DATE', 'WAITING', 'SILENT']}}))}),
                                       'revenue': obj({'invoices_count': integer(0), 'invoiced_gross': money(),
                                                       'credit_notes_count': integer(0), 'credited_gross': money(),
                                                       'net_revenue': signed_money(), 'legacy_excluded_note': text(300)}),
                                       'collections': obj({'by_method': array(obj({'method': enum('payments.method'), 'payments_count': integer(0),
                                                                                   'payments_amount': money(), 'reversals_amount': money(),
                                                                                   'refunds_amount': money(), 'net_amount': signed_money()})),
                                                           'net_total': signed_money(),
                                                           'on_legacy': obj({'payments_count': integer(0), 'net_amount': signed_money()})}),
                                       'expenses': obj({'total_amount': money(), 'movements_count': integer(0),
                                                        'by_category': array(obj({'category_id': n_ulid(), 'code': n_text(40), 'name': text(180),
                                                                                  'movements_count': integer(0), 'amount': money()})),
                                                        'other_cash_movements': obj({'deposits': money(), 'withdrawals': money(),
                                                                                     'opening_adjustments': signed_money()})}),
                                       'reconciliations': obj({'validated_count': integer(0), 'draft_count': integer(0),
                                                               'by_method': array(obj({'method': enum('payment_reconciliations.method'),
                                                                                       'validated_count': integer(0),
                                                                                       'expected_total': signed_money(),
                                                                                       'statement_total': signed_money(),
                                                                                       'variance_total': signed_money(),
                                                                                       'disputed_lines': integer(0)})),
                                                               'items': array(obj({'id': ulid(), 'method': enum('payment_reconciliations.method'),
                                                                                   'period_starts_at': instant(), 'period_ends_at': instant(),
                                                                                   'status': enum('payment_reconciliations.status'),
                                                                                   'expected_amount': signed_money(),
                                                                                   'statement_amount': nullable(signed_money()),
                                                                                   'variance_amount': nullable(signed_money()),
                                                                                   'validated_at': n_instant()}))}),
                                       'receivables_at_read': obj({'invoices_count': integer(0), 'amount_due': money(),
                                                                   'of_which_legacy': obj({'invoices_count': integer(0), 'amount_due': money()}),
                                                                   'refundable_credit': obj({'invoices_count': integer(0), 'amount': money()})}),
                                       'stock_valuation_at_read': nullable(obj({'known_cost_value': money(),
                                                                                'unknown_cost_positions': integer(0),
                                                                                'total_positions': integer(0)})),
                                       'lines': array(obj({'section': {'type': 'string',
                                                                       'enum': ['REVENUE_INVOICE', 'REVENUE_CREDIT_NOTE', 'COLLECTION_PAYMENT',
                                                                                'COLLECTION_REVERSAL', 'COLLECTION_REFUND', 'EXPENSE',
                                                                                'OTHER_CASH_MOVEMENT', 'RECONCILIATION']},
                                                           'occurred_at': instant(), 'reference': n_text(100), 'channel': n_text(64),
                                                           'category_or_label': text(300), 'signed_amount': signed_money(),
                                                           'excluded_from_ca': boolean(),
                                                           'reconciliation_status': nullable(enum('payment_reconciliations.status'))})),
                                       'generated_at': instant()},
                                      description="Restitution comptable Q13 (L1D06, gérante, finance.global.read) : sépare strictement chiffre d'affaires (factures − avoirs, hors reprises papier), encaissements nets par mode, dépenses de caisse par catégorie, rapprochements par canal, impayés à l'instant de la lecture et valorisation au coût connu. Jamais de double compte avec les devis ni les reprises papier."),
        'AccountingExportReportResponse': data('AccountingExportReport'),
        'ManagementComparisonCount': obj({'current': integer(0), 'previous': integer(0), 'delta': integer(),
                                          'delta_pct_bps': nullable(integer())}),
        'ManagementComparisonMoney': obj({'current': signed_money(), 'previous': signed_money(), 'delta': signed_money(),
                                          'delta_pct_bps': nullable(integer())}),
        'ManagementReport': obj({
            'period': obj({'from': ref('CivilDate'), 'to': ref('CivilDate'), 'days': integer(1, 366)}),
            'previous_period': obj({'from': ref('CivilDate'), 'to': ref('CivilDate'), 'days': integer(1, 366)}),
            'timezone': text(64),
            'currency': ref('Currency'),
            'freshness': obj({'complete': boolean(), 'silence_hours': integer(1),
                              'devices': array(obj({'device_id': ulid(), 'name': text(180), 'last_sync_at': n_instant(),
                                                    'commands_pending': integer(0), 'commands_in_conflict': integer(0),
                                                    'state': {'type': 'string', 'enum': ['UP_TO_DATE', 'WAITING', 'SILENT']}}))}),
            'excluded_sections': array(obj({
                'section': {'type': 'string', 'enum': ['FINANCE', 'STOCK', 'STOCK_VALUATION', 'WORKSHOP', 'PATIENTS', 'CLINICAL']},
                'reason': {'type': 'string', 'enum': ['PERMISSION_MISSING', 'MODULE_DISABLED']},
                'detail': text(300),
            })),
            'finance': nullable(obj({
                'net_revenue': local('ManagementComparisonMoney'),
                'invoiced_gross': local('ManagementComparisonMoney'),
                'credited_gross': local('ManagementComparisonMoney'),
                'net_collections': local('ManagementComparisonMoney'),
                'expenses_total': local('ManagementComparisonMoney'),
                'quotes_pipeline': obj({'issued_count': integer(0), 'issued_amount': money(),
                                        'accepted_count': integer(0), 'converted_count': integer(0),
                                        'excluded_from_revenue_note': text(300)}),
                'receivables_at_read': obj({'invoices_count': integer(0), 'amount_due': money(),
                                            'of_which_legacy_count': integer(0), 'of_which_legacy_amount': money(),
                                            'refundable_credit_amount': money()}),
                'collections_by_method': array(obj({'method': enum('payments.method'), 'payments_amount': money(),
                                                    'reversals_amount': money(), 'refunds_amount': money(),
                                                    'net_amount': signed_money()})),
                'reconciliations_period': obj({'validated_count': integer(0), 'draft_count': integer(0),
                                               'disputed_lines': integer(0), 'variance_total': signed_money()}),
                'cash_sessions': obj({'closed_count': integer(0), 'open_count': integer(0),
                                      'variance_total': signed_money(), 'post_closure_reversals': money()}),
            })),
            'stock': nullable(obj({
                'valuation_at_read': nullable(obj({'known_cost_value': money(), 'unknown_cost_positions': integer(0),
                                                   'unknown_cost_lots': integer(0), 'total_positions': integer(0)})),
                'valuation_hidden_reason': n_text(64),
                'positions_count': integer(0),
                'low_stock_items_count': integer(0),
                'open_alerts': obj({'total': integer(0), 'low_stock': integer(0), 'expiring': integer(0),
                                    'expired': integer(0), 'without_due_date': integer(0)}),
                'movements_in_period': obj({'receipts_validated_count': integer(0), 'adjustments_count': integer(0),
                                            'deliveries_confirmed_count': integer(0), 'physical_returns_count': integer(0),
                                            'open_inventories_count': integer(0), 'validated_inventories_count': integer(0)}),
                'by_location': array(obj({'location_id': ulid(), 'code': text(40), 'name': text(180),
                                          'positions_count': integer(0), 'quantity_on_hand': quantity(),
                                          'unknown_cost_positions': integer(0)})),
                'by_category': array(obj({'category_code': text(64), 'category_name': text(180),
                                          'items_count': integer(0), 'quantity_on_hand': quantity(),
                                          'unknown_cost_positions': integer(0), 'known_cost_value': nullable(money())})),
            })),
            'workshop': nullable(obj({
                'created_count': local('ManagementComparisonCount'),
                'delivered_or_ready_count': local('ManagementComparisonCount'),
                'open_total': integer(0),
                'overdue_open_count': integer(0),
                'unknown_expected_date_count': integer(0),
                'orders_without_frame_item_count': integer(0),
                'reworks_in_period': integer(0),
                'failed_qc_in_period': integer(0),
                'by_status': array(obj({'status': enum('workshop_orders.status'), 'count': integer(0), 'overdue_count': integer(0)})),
            })),
            'patients': nullable(obj({
                'visits_count': local('ManagementComparisonCount'),
                'distinct_patients': local('ManagementComparisonCount'),
                'new_patients': local('ManagementComparisonCount'),
                'returning_patients': local('ManagementComparisonCount'),
                'visits_by_reason': array(obj({'reason': enum('visits.reason'), 'count': integer(0)})),
                'incomplete_identity': obj({'total_active_patients': integer(0), 'birth_date_unknown': integer(0),
                                            'sex_unknown': integer(0), 'phone_unknown': integer(0), 'address_unknown': integer(0)}),
            })),
            'clinical': nullable(obj({
                'consultations_completed': local('ManagementComparisonCount'),
                'optical_prescriptions_issued': local('ManagementComparisonCount'),
                'prescriptions_rate_bps': integer(0, 10000),
                'medication_orders_count': integer(0),
                'referrals_count': integer(0),
                'incomplete_clinical_data': obj({'without_complaint': integer(0), 'without_acuity': integer(0),
                                                 'without_refraction': integer(0), 'without_ametropia': integer(0),
                                                 'referral_unknown': integer(0)}),
                'by_ametropia': array(obj({'code': text(64), 'count': integer(0)})),
            })),
            'unknowns': array(obj({
                'domain': {'type': 'string', 'enum': ['FINANCE', 'STOCK', 'WORKSHOP', 'PATIENTS', 'CLINICAL', 'SYNC']},
                'code': text(80),
                'label': text(180),
                'count': integer(0),
                'note': text(300),
            })),
            'definitions': array(obj({
                'code': text(80),
                'domain': text(40),
                'label': text(180),
                'formula': text(300),
                'denominator': text(200),
                'exclusion_note': text(300),
            })),
            'provenance': obj({
                'source': text(120),
                'period_timezone': text(64),
                'previous_period_rule': text(200),
                'dataset_sha256': ref('Sha256Hex'),
            }),
            'generated_at': instant(),
        }, description="Tableaux de gestion multi-domaines L1D09 filtrés par profil et modules actifs, comparés à la période précédente équivalente, sans double compte et avec inconnus explicites."),
        'ManagementReportResponse': data('ManagementReport'),
        'AuditEvent': obj({'id': ulid(), 'actor_id': n_ulid(), 'actor_name_snapshot': text(180), 'action': text(100),
                           'target_type': text(64), 'target_id': n_ulid(), 'recorded_at': instant(), 'correlation_id': text(100),
                           'reason': n_text(), 'sanitized_diff': nullable({'type': 'object'}), 'event_hash': ref('Sha256Hex')},
                          description='Événement du journal append-only (lecture gérante, audit.read) ; aucun secret dans le diff.'),
        'AuditEventPage': page('AuditEvent'),
    }
    return schema_file('schemas/resources/operations.json', 'Ressources : postes, synchronisation, documents, exports et rapports',
                       'Enrôlement et préparation des postes, santé, conflits, documents générés, exports privés, rapport financier.', defs)


def public_resources():
    defs = {
        'PublicService': obj({'id': ulid(), 'name': text(180), 'duration_minutes': integer(1)}),
        'PublicServiceList': obj({'data': array(local('PublicService'))}),
        'PublicSlot': obj({'service_id': ulid(), 'resource_id': ulid(), 'starts_at': instant(), 'ends_at': instant()}),
        'PublicSlotList': obj({'data': array(local('PublicSlot'))}),
        'BookingReceipt': obj({'public_reference': text(100), 'status': enum('public_booking_requests.status'),
                               'service_id': ulid(), 'requested_starts_at': instant(), 'requested_ends_at': instant()},
                              description='Référence publique distincte des identifiants internes ; ne révèle jamais l\'existence d\'un dossier.'),
        'BookingReceiptResponse': data('BookingReceipt'),
    }
    return schema_file('schemas/resources/public.json', 'Ressources : réservation publique (L2)', 'Prestations réservables et créneaux administratifs, sans dossier ni nom de patient (fichier 08).', defs)


def communication_resources():
    defs = {
        'IntegrationAccount': obj({
            'id': ulid(),
            'provider': enum('integration_accounts.provider'),
            'external_account_id': text(180),
            'display_name': text(180),
            'status': enum('integration_accounts.status'),
            'has_credentials': boolean(),
            'encryption_key_id': n_text(100),
            'token_expires_at': n_instant(),
            'public_configuration': nullable({'type': 'object'}),
            'version': ref('Version'),
            'updated_at': instant(),
        }, description='Compte connecteur externe (secrets chiffrés jamais retournés en lecture).'),
        'IntegrationAccountList': obj({'data': array(local('IntegrationAccount'))}),
        'IntegrationAccountResponse': data('IntegrationAccount'),
        'IntegrationHealth': obj({
            'mode': {'type': 'string', 'enum': ['fake', 'live', 'disabled']},
            'credentials_configured': boolean(),
            'accounts_total': integer(0),
            'accounts_active': integer(0),
            'accounts_error': integer(0),
            'outbox_pending': integer(0),
            'outbox_failed': integer(0),
            'webhook_pending': integer(0),
            'webhook_failed': integer(0),
            'calendar_stale': integer(0),
            'accounts': array(local('IntegrationAccount')),
        }),
        'IntegrationHealthResponse': data('IntegrationHealth'),
        'IntegrationConnectionTest': obj({
            'account_id': ulid(),
            'provider': enum('integration_accounts.provider'),
            'reachable': boolean(),
            'mode': {'type': 'string', 'enum': ['fake', 'live']},
            'status': enum('integration_accounts.status'),
            'checked_at': instant(),
            'detail': n_text(500),
        }),
        'IntegrationConnectionTestResponse': data('IntegrationConnectionTest'),
        'OutboxEvent': obj({
            'id': ulid(),
            'event_type': text(100),
            'event_version': integer(1),
            'source_type': text(64),
            'source_id': ulid(),
            'source_version': ref('Version'),
            'status': enum('outbox_events.status'),
            'attempt_count': integer(0),
            'next_attempt_at': n_instant(),
            'processed_at': n_instant(),
            'last_error_code': n_text(100),
            'correlation_id': text(100),
            'created_at': instant(),
        }),
        'OutboxEventPage': page('OutboxEvent'),
        'OutboxBatchResult': obj({
            'processed': integer(0),
            'failed': integer(0),
            'skipped': integer(0),
            'events': array(local('OutboxEvent')),
        }),
        'OutboxBatchResultResponse': data('OutboxBatchResult'),
        'CalendarSyncState': obj({
            'id': ulid(),
            'integration_account_id': ulid(),
            'resource_id': ulid(),
            'external_calendar_id': text(255),
            'status': enum('calendar_sync_states.status'),
            'last_full_sync_at': n_instant(),
            'last_incremental_sync_at': n_instant(),
            'last_error_code': n_text(100),
            'push_expires_at': n_instant(),
            'version': ref('Version'),
            'updated_at': instant(),
        }),
        'CalendarSyncStateList': obj({'data': array(local('CalendarSyncState'))}),
        'CalendarSyncStateResponse': data('CalendarSyncState'),
        'CalendarSyncRunResult': obj({
            'synced_states': integer(0),
            'pushed_appointments': integer(0),
            'pulled_blocks': integer(0),
            'conflicts': integer(0),
            'states': array(local('CalendarSyncState')),
        }),
        'CalendarSyncRunResultResponse': data('CalendarSyncRunResult'),
        'PublicBookingAdminItem': obj({
            'id': ulid(),
            'public_reference': text(100),
            'status': enum('public_booking_requests.status'),
            'service_id': ulid(),
            'service_name': n_text(180),
            'resource_id': n_ulid(),
            'prospect_contact_id': ulid(),
            'prospect_name': n_text(180),
            'prospect_phone': n_text(32),
            'requested_starts_at': instant(),
            'requested_ends_at': instant(),
            'appointment_id': n_ulid(),
            'consent_recorded_at': instant(),
            'created_at': instant(),
        }),
        'PublicBookingAdminPage': page('PublicBookingAdminItem'),
        'PublicBookingAdminResponse': data('PublicBookingAdminItem'),
        'ProspectContact': obj({
            'id': ulid(),
            'name': text(180),
            'phone': n_text(32),
            'email': n_text(254),
            'patient_id': n_ulid(),
            'origin': enum('prospect_contacts.origin'),
            'administrative_notes': n_text(4000),
            'version': ref('Version'),
            'created_at': instant(),
            'updated_at': instant(),
        }),
        'ProspectContactPage': page('ProspectContact'),
        'ProspectContactResponse': data('ProspectContact'),
        'CrmLead': obj({
            'id': ulid(),
            'prospect_contact_id': ulid(),
            'prospect_name': n_text(180),
            'integration_account_id': ulid(),
            'external_lead_id': text(180),
            'pipeline_id': n_text(100),
            'pipeline_stage': n_text(100),
            'product_interest': n_text(2000),
            'budget_min': nullable(money()),
            'budget_max': nullable(money()),
            'acquisition_source': n_text(100),
            'assigned_to': n_ulid(),
            'status': enum('crm_leads.status'),
            'last_synced_at': n_instant(),
            'updated_at': instant(),
        }),
        'CrmLeadPage': page('CrmLead'),
        'CrmLeadResponse': data('CrmLead'),
        'CrmLeadSyncResult': obj({
            'synced': integer(0),
            'created': integer(0),
            'updated': integer(0),
            'conflicts': integer(0),
        }),
        'CrmLeadSyncResultResponse': data('CrmLeadSyncResult'),
        'CrmConversation': obj({
            'id': ulid(),
            'crm_lead_id': n_ulid(),
            'integration_account_id': ulid(),
            'external_conversation_id': text(180),
            'channel': enum('crm_conversations.channel'),
            'status': enum('crm_conversations.status'),
            'human_owner_id': n_ulid(),
            'takeover_at': n_instant(),
            'takeover_reason': n_text(2000),
            'administrative_summary': n_text(4000),
            'bot_resumed_at': n_instant(),
            'last_activity_at': instant(),
            'version': ref('Version'),
        }),
        'CrmConversationPage': page('CrmConversation'),
        'CrmConversationResponse': data('CrmConversation'),
        'KnowledgeEntryVersion': obj({
            'id': ulid(),
            'entry_id': ulid(),
            'revision_no': integer(1),
            'content': text(10000),
            'language': text(10),
            'authored_by': ulid(),
            'approved_by': n_ulid(),
            'approved_at': n_instant(),
            'published_at': n_instant(),
            'retired_at': n_instant(),
            'is_published': boolean(),
            'created_at': instant(),
        }),
        'KnowledgeEntry': obj({
            'id': ulid(),
            'code': text(100),
            'title': text(180),
            'category': enum('knowledge_entries.category'),
            'active': boolean(),
            'version': ref('Version'),
            'published_version': nullable(local('KnowledgeEntryVersion')),
            'versions': array(local('KnowledgeEntryVersion')),
        }),
        'KnowledgeEntryPage': page('KnowledgeEntry'),
        'KnowledgeEntryResponse': data('KnowledgeEntry'),
        'KnowledgeEntryVersionResponse': data('KnowledgeEntryVersion'),
        'ConversationHandoff': obj({
            'id': ulid(),
            'conversation_id': ulid(),
            'event_type': enum('conversation_handoffs.event_type'),
            'actor_id': n_ulid(),
            'reason': n_text(2000),
            'administrative_summary': n_text(4000),
            'occurred_at': instant(),
        }),
        'ConversationHandoffList': obj({'data': array(local('ConversationHandoff'))}),
        'AssistantRun': obj({
            'id': ulid(),
            'conversation_id': ulid(),
            'engine_name': text(100),
            'model_name': text(100),
            'rules_version': text(64),
            'started_at': instant(),
            'completed_at': n_instant(),
            'status': enum('assistant_runs.status'),
            'input_tokens': nullable(integer(0)),
            'output_tokens': nullable(integer(0)),
            'knowledge_version_ids': array(ulid()),
            'sanitized_tool_results': array({'type': 'object'}),
            'error_code': n_text(100),
        }),
        'AssistantRunList': obj({'data': array(local('AssistantRun'))}),
        'AssistantTurnResult': obj({
            'run': local('AssistantRun'),
            'reply': text(4000),
            'handoff_triggered': boolean(),
            'clinical_refusal': boolean(),
            'conversation_status': enum('crm_conversations.status'),
            'knowledge_citations': array(text(100)),
            'booking_reference': n_text(100),
        }),
        'AssistantTurnResultResponse': data('AssistantTurnResult'),
        'CommunicationConsent': obj({
            'id': ulid(),
            'patient_id': n_ulid(),
            'prospect_contact_id': n_ulid(),
            'channel': enum('communication_consents.channel'),
            'purpose': enum('communication_consents.purpose'),
            'status': enum('communication_consents.status'),
            'destination_masked': text(64),
            'recorded_at': instant(),
            'recorded_by': n_ulid(),
            'proof': n_text(2000),
            'policy_version': text(64),
            'event_sequence': integer(1),
        }),
        'CommunicationConsentPage': page('CommunicationConsent'),
        'CommunicationConsentResponse': data('CommunicationConsent'),
        'MessageTemplateVersion': obj({
            'id': ulid(),
            'template_id': ulid(),
            'integration_account_id': n_ulid(),
            'revision_no': integer(1),
            'provider_template_id': n_text(180),
            'language': text(10),
            'body': text(5000),
            'allowed_variables': array(text(64)),
            'provider_approval_status': enum('message_template_versions.provider_approval_status'),
            'approved_by': n_ulid(),
            'approved_at': n_instant(),
            'created_at': instant(),
        }),
        'MessageTemplate': obj({
            'id': ulid(),
            'code': text(100),
            'channel': enum('message_templates.channel'),
            'purpose': enum('message_templates.purpose'),
            'active': boolean(),
            'version': ref('Version'),
            'versions': array(local('MessageTemplateVersion')),
        }),
        'MessageTemplateList': obj({'data': array(local('MessageTemplate'))}),
        'MessageTemplateResponse': data('MessageTemplate'),
        'MessageTemplateVersionResponse': data('MessageTemplateVersion'),
        'ReminderPolicy': obj({
            'id': ulid(),
            'code': text(64),
            'label': text(180),
            'purpose': enum('reminder_policies.purpose'),
            'channel': enum('reminder_policies.channel'),
            'offset_unit': enum('reminder_policies.offset_unit'),
            'offset_value': integer(-3650, 3650),
            'local_send_time': n_text(8),
            'active': boolean(),
            'version': ref('Version'),
        }),
        'ReminderPolicyList': obj({'data': array(local('ReminderPolicy'))}),
        'ReminderPolicyResponse': data('ReminderPolicy'),
        'MessageAttempt': obj({
            'id': ulid(),
            'task_id': n_ulid(),
            'campaign_recipient_id': n_ulid(),
            'integration_account_id': ulid(),
            'template_version_id': n_ulid(),
            'consent_event_id': n_ulid(),
            'dedupe_key': text(180),
            'provider_message_id': n_text(180),
            'attempt_no': integer(1),
            'status': enum('message_attempts.status'),
            'submitted_at': n_instant(),
            'delivered_at': n_instant(),
            'read_at': n_instant(),
            'error_code': n_text(100),
            'created_at': instant(),
        }),
        'MessageAttemptPage': page('MessageAttempt'),
        'MessageAttemptResponse': data('MessageAttempt'),
        'AudienceSegment': obj({
            'id': ulid(),
            'name': text(180),
            'criteria': {'type': 'object'},
            'criteria_schema_version': text(64),
            'created_by': ulid(),
            'version': ref('Version'),
            'updated_at': instant(),
        }),
        'AudienceSegmentList': obj({'data': array(local('AudienceSegment'))}),
        'AudienceSegmentResponse': data('AudienceSegment'),
        'CampaignRecipient': obj({
            'id': ulid(),
            'campaign_id': ulid(),
            'patient_id': n_ulid(),
            'prospect_contact_id': n_ulid(),
            'destination_masked': text(64),
            'consent_event_id': n_ulid(),
            'status': enum('campaign_recipients.status'),
            'exclusion_reason': n_text(500),
            'consent_checked_at': n_instant(),
        }),
        'CampaignRecipientPage': page('CampaignRecipient'),
        'CampaignDefinition': obj({
            'id': ulid(),
            'name': text(180),
            'segment_id': ulid(),
            'template_version_id': ulid(),
            'approval_id': n_ulid(),
            'scheduled_at': n_instant(),
            'status': enum('campaign_definitions.status'),
            'created_by': ulid(),
            'target_frozen_at': n_instant(),
            'eligible_count': integer(0),
            'excluded_count': integer(0),
            'delivered_count': integer(0),
            'failed_count': integer(0),
            'created_at': instant(),
            'updated_at': instant(),
        }),
        'CampaignPage': page('CampaignDefinition'),
        'CampaignResponse': data('CampaignDefinition'),
        'CampaignPreview': obj({
            'campaign_id': ulid(),
            'total_candidates': integer(0),
            'eligible_count': integer(0),
            'excluded_count': integer(0),
            'sample': array(local('CampaignRecipient')),
        }),
        'CampaignPreviewResponse': data('CampaignPreview'),
        'WebhookInboxItem': obj({
            'id': ulid(),
            'integration_account_id': n_ulid(),
            'provider_event_key': text(180),
            'payload_hash': ref('Sha256Hex'),
            'received_at': instant(),
            'status': enum('webhook_inbox.status'),
            'verified_at': n_instant(),
            'processed_at': n_instant(),
            'attempt_count': integer(0),
            'last_error_code': n_text(100),
        }),
        'WebhookInboxPage': page('WebhookInboxItem'),
        'WebhookIngestResult': obj({
            'accepted': boolean(),
            'duplicate': boolean(),
            'inbox_id': n_ulid(),
            'status': enum('webhook_inbox.status'),
        }),
        'WebhookIngestResultResponse': data('WebhookIngestResult'),
        'IntegrationReconcileResult': obj({
            'outbox_processed': integer(0),
            'webhooks_processed': integer(0),
            'attempts_reconciled': integer(0),
            'calendar_synced': integer(0),
        }),
        'IntegrationReconcileResultResponse': data('IntegrationReconcileResult'),
    }
    return schema_file('schemas/resources/communication.json',
                       'Ressources : intégrations externes, CRM, base de connaissances, assistant, consentements et campagnes (L2)',
                       'Connecteurs chiffrés, outbox, agenda Google, prospects Kommo, KB publiée, handoff humain, opt-in/opt-out et campagnes approuvées sans donnée clinique.', defs)


# --------------------------------------------------------------------------------------------------
# Requêtes HTTP des routes sans commande hors-ligne
# --------------------------------------------------------------------------------------------------

def quote_line_input():
    return obj({'line_id': ulid(), 'position': integer(1, 999), 'catalog_item_id': n_ulid(), 'description': text(500),
                'quantity': quantity(), 'unit_price_gross': money(), 'discount_gross': money()},
               description='Ligne de devis : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise). Aucune prescription.')


def requests():
    counted_quantity = {'type': 'string', 'description': 'Quantité comptée DECIMAL(12,3), zéro admis (rien trouvé).', 'pattern': '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$'}
    password = text(200)
    defs = {
        'LoginRequest': obj({'login': text(180), 'password': password}),
        'ReauthenticateRequest': obj({'password': password}),
        'ChangePasswordRequest': obj({'current_password': password, 'password': password, 'password_confirmation': password}),
        'CreateStaffRequest': obj({'login': text(64), 'display_name': text(180, 2), 'email': nullable({'type': 'string', 'maxLength': 254}),
                                   'password': password, 'roles': array(role(), 1, 4)}, optional=('email',)),
        'UpdateStaffRequest': obj({'expected_version': ref('Version'), 'display_name': text(180, 2),
                                   'email': nullable({'type': 'string', 'maxLength': 254}), 'active': boolean(),
                                   'roles': array(role(), 1, 4), 'reason': n_text(1000)},
                                  optional=('display_name', 'email', 'active', 'roles', 'reason')),
        'PermissionOverrideRequest': obj({'expected_version': ref('Version'), 'permission_code': ref('PermissionCode'),
                                          'effect': {'type': 'string', 'enum': ['ALLOW', 'DENY', 'CLEAR']}, 'reason': text(1000, 3),
                                          'expires_at': n_instant()}, optional=('expires_at',)),
        'ResetPasswordRequest': obj({'expected_version': ref('Version'), 'password': password, 'password_confirmation': password,
                                     'reason': text(1000, 3)}),
        'UpdateClinicSettingsRequest': obj({'name': text(180, 2), 'address': n_text(2000), 'phone': n_text(32),
                                            'email': nullable({'type': 'string', 'maxLength': 254}), 'tax_identifier': n_text(100),
                                            'professional_mentions': n_text(4000), 'document_settings': nullable({'type': 'object'})},
                                           optional=('name', 'address', 'phone', 'email', 'tax_identifier', 'professional_mentions', 'document_settings'),
                                           description='Fuseau, monnaie et production_documents_enabled sont refusés (422).'),
        'UpdatePrescriptionDraftRequest': obj({'expected_updated_at': instant(), 'changes': {'type': 'object', 'minProperties': 1}},
                                              description='Modification d\'une prescription encore DRAFT, en ligne seulement ; jeton de concurrence updated_at. Hors-ligne, une correction est une nouvelle version (CreatePrescription avec supersedes_id).'),
        'RescheduleAppointmentRequest': obj({'expected_version': ref('Version'), 'starts_at': instant(), 'ends_at': instant(),
                                             'resource_id': ulid()}, optional=('resource_id',)),
        'CancelAppointmentRequest': obj({'expected_version': ref('Version'), 'reason': text(1000, 3)}),
        'MarkAppointmentNoShowRequest': obj({'expected_version': ref('Version')},
                                            description='Absence constatée après l\'heure du rendez-vous (statut NO_SHOW), jamais avant.'),
        'SchedulingResourceRequest': obj({'expected_version': nullable(ref('Version')), 'resource_id': ulid(), 'name': text(180, 2),
                                          'professional_user_id': n_ulid(), 'slot_duration_minutes': integer(5, 480), 'active': boolean()},
                                         description='Création (expected_version null) ou modification d\'une ressource de l\'agenda (gérante).'),
        'OpeningHoursRequest': obj({'expected_version': ref('Version'), 'hours': array(obj({'id': ulid(), 'weekday': integer(1, 7),
                                                                                             'opens_at': ref('LocalTime'),
                                                                                             'closes_at': ref('LocalTime')}), 0, 50)},
                                   description='Remplace les créneaux hebdomadaires d\'une ressource (version de la ressource attendue).'),
        'ResourceExceptionRequest': obj({'expected_version': {'type': 'null'}, 'exception_id': ulid(), 'starts_at': instant(), 'ends_at': instant(), 'is_available': boolean(),
                                         'reason': text(1000, 3)},
                                        description='Fermeture ou ouverture exceptionnelle datée, motif obligatoire.'),
        'AppointmentServiceRequest': obj({'expected_version': nullable(ref('Version')), 'service_id': ulid(), 'name': text(180, 2),
                                          'duration_minutes': integer(5, 480), 'active': boolean()},
                                         description='Création (expected_version null) ou modification d\'une prestation réservable (gérante).'),
        'CatalogItemRequest': obj({'expected_version': nullable(ref('Version')), 'reference': text(64), 'category_code': ref('Code'),
                                   'name': text(180), 'brand': n_text(120), 'model': n_text(120), 'unit_code': ref('Code'),
                                   'quantity_integer_only': boolean(), 'sale_price': money(), 'purchase_cost': nullable(money()),
                                   'tax_rule_id': n_ulid(), 'stock_mode': enum('catalog_items.stock_mode'), 'requires_expiry': boolean(),
                                   'low_stock_threshold': nullable(quantity()), 'expiry_alert_days': nullable(integer(0, 3650)),
                                   'active': boolean(), 'public_visibility': boolean()},
                                  description='Création (expected_version null) ou modification d\'un article par la gérante (catalog.manage). Les prix réels sont fournis par le cabinet : seules des données fictives sont utilisées en développement.'),
        'CatalogImportRequest': obj({'dry_run': boolean(),
                                     'rows': array(obj({'line': integer(2), 'reference': nullable(text(64)), 'category_code': nullable(ref('Code')),
                                                        'name': nullable(text(180)), 'brand': n_text(120), 'model': n_text(120),
                                                        'unit_code': nullable(ref('Code')), 'quantity_integer_only': boolean(),
                                                        'sale_price': nullable(money()), 'purchase_cost': nullable(money()), 'tax_rule_id': n_ulid(),
                                                        'stock_mode': nullable(enum('catalog_items.stock_mode')), 'requires_expiry': boolean(),
                                                        'low_stock_threshold': nullable(quantity()), 'expiry_alert_days': nullable(integer(0, 3650)),
                                                        'active': boolean(), 'public_visibility': boolean()}), 1, 500)},
                                    description="Import contrôlé du catalogue (X01) : lignes du fichier CSV lues sur le poste (numéro de ligne du fichier), "
                                                "revérifiées par le serveur avec les règles d'un article saisi à l'écran. dry_run = true : aperçu sans "
                                                "aucune écriture ; false : toutes les lignes sont créées dans une seule transaction, ou aucune."),
        'StoreDocumentContentCommand': obj({'document_id': ulid(), 'sha256': ref('Sha256Hex'), 'size_bytes': integer(1),
                                            'private_path': {'type': 'string', 'pattern': '^documents/[0-9A-HJKMNP-TV-Z]{26}/[0-9A-HJKMNP-TV-Z]{26}-[0-9a-f]{16}\\.pdf$'}},
                                           description="Charge INTERNE de la commande StoreDocumentContent, construite par le serveur après contrôle des "
                                                       "octets PDF reçus (POST /documents/{id}/content, corps application/pdf) : jamais envoyée par un poste."),
        'LegacyBalanceImportRequest': obj({'dry_run': boolean(), 'evidence_file_id': n_ulid(),
                                           'rows': array(obj({'line': integer(2), 'patient_id': n_ulid(), 'patient_record_number': n_text(32),
                                                              'paper_reference': n_text(100), 'original_total': nullable(money()),
                                                              'already_paid': nullable(money()), 'original_invoice_on': ref('NullableCivilDate')}),
                                                         1, 500)},
                                          description="Reprise des créances papier (X01) : une créance (saisie) ou un fichier CSV lu sur le poste. "
                                                      "Le patient est désigné par sa fiche (patient_id) OU son numéro de dossier ; dry_run = true : "
                                                      "aperçu sans écriture ; false : toutes les créances reprises dans une transaction, ou aucune "
                                                      "(justificatif scanné evidence_file_id obligatoire)."),
        'StoreLegacyEvidenceCommand': obj({'sha256': ref('Sha256Hex'), 'size_bytes': integer(1),
                                           'mime_type': {'type': 'string', 'enum': ['application/pdf', 'image/jpeg', 'image/png']},
                                           'private_path': {'type': 'string', 'pattern': '^evidence/[0-9A-HJKMNP-TV-Z]{26}/[0-9a-f]{64}[.](?:pdf|jpg|png)$'}},
                                          description="Charge INTERNE de la commande StoreLegacyEvidence, construite par le serveur après contrôle des "
                                                      "octets reçus (POST /legacy-balances/evidence) : jamais envoyée par un poste."),
        'StoreStatementEvidenceCommand': obj({'sha256': ref('Sha256Hex'), 'size_bytes': integer(1),
                                              'mime_type': {'type': 'string', 'enum': ['application/pdf', 'image/jpeg', 'image/png']},
                                              'private_path': {'type': 'string', 'pattern': '^evidence/[0-9A-HJKMNP-TV-Z]{26}/[0-9a-f]{64}[.](?:pdf|jpg|png)$'}},
                                             description="Charge INTERNE de la commande StoreStatementEvidence, construite par le serveur après contrôle des "
                                                         "octets reçus (POST /payment-reconciliations/statement-file) : jamais envoyée par un poste."),
        'SavePaymentReconciliationRequest': obj({'expected_version': {'type': 'null'}, 'reconciliation_id': ulid(),
                                                 'method': enum('payment_reconciliations.method'),
                                                 'period_starts_at': instant(), 'period_ends_at': instant(),
                                                 'statement_amount': nullable(signed_money()), 'statement_file_id': n_ulid(),
                                                 'variance_reason': n_text(2000),
                                                 'lines': array(obj({'line_id': ulid(), 'payment_id': n_ulid(), 'refund_id': n_ulid(),
                                                                     'external_reference': n_text(180), 'statement_amount': signed_money(),
                                                                     'status': enum('payment_reconciliation_lines.status'),
                                                                     'note': n_text(1000)},
                                                                    optional=('note',)), 0, 500)},
                                                description="Création ou modification complète d'un brouillon de rapprochement par canal (L1D06) : un règlement ou remboursement ne peut être pointé qu'une seule fois ; expected_amount recalculé côté serveur."),
        'ValidatePaymentReconciliationRequest': obj({'expected_version': {'type': 'null'}, 'reconciliation_id': ulid(),
                                                     'statement_amount': signed_money(), 'statement_file_id': n_ulid(),
                                                     'variance_reason': n_text(2000)},
                                                    description="Validation réauthentifiée d'un rapprochement (L1D06) : fige attendu serveur, montant du relevé, écart motivé si non nul et lignes ; refuse 409 si déjà validé ou si une ligne chevauche un autre rapprochement."),
        'TaxRuleRequest': obj({'expected_version': nullable(ref('Version')), 'code': text(40), 'label': text(180),
                               'rate_percent': nullable(ref('Rate')), 'active': boolean(), 'validate': boolean(), 'legal_note': n_text()},
                              description='Règle fiscale saisie par la gérante ; validate = true enregistre la validation (réauthentification). Aucune taxe n\'est préconfigurée.'),
        'CreateQuoteDraftRequest': obj({'expected_version': {'type': 'null'}, 'quote_id': ulid(), 'patient_id': n_ulid(),
                                        'prospect': nullable(obj({'name': text(180), 'phone': n_text(32)})),
                                        'valid_until': ref('NullableCivilDate'), 'lines': array(quote_line_input(), 0, 200)},
                                       description="Brouillon de devis (L1D07) : un patient (patient_id) OU un prospect saisi (nom, téléphone), jamais "
                                                   "les deux ; validité facultative (au plus tôt aujourd'hui) ; lignes soumises aux droits de l'auteur."),
        'UpdateQuoteDraftRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid(), 'valid_until': ref('NullableCivilDate'),
                                        'lines': array(quote_line_input(), 0, 200)},
                                       description='Modification d\'un brouillon de devis (remplacement complet des lignes) : créateur ou gérante.'),
        'IssueQuoteRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid(), 'total_gross': money()},
                                 description="Émission : numéro de la série QUOTE, révision 1 figée ; total_gross est vérifié par le serveur (422 "
                                             "avec details.expected_total sinon) ; validité obligatoire."),
        'ReviseQuoteRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid(), 'reason': text(1000, 3),
                                   'valid_until': ref('CivilDate'), 'lines': array(quote_line_input(), 1, 200), 'total_gross': money()},
                                  description='Révision d\'un devis émis, accepté ou refusé : nouvelle révision figée avec motif ; les précédentes restent intactes.'),
        'QuoteDecisionRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid(),
                                     'decision': {'type': 'string', 'enum': ['ACCEPTED', 'DECLINED']}, 'reason': n_text(1000)},
                                    description='Réponse du client : ACCEPTED (devis émis encore valable) ou DECLINED ; aucune facture ni paiement.'),
        'ConvertQuoteRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid(), 'revision_no': integer(1),
                                    'invoice_id': ulid(), 'patient_id': n_ulid(),
                                    'price_basis': {'type': 'string', 'enum': ['QUOTE', 'CATALOG']},
                                    'prices_confirmed': {'const': True}},
                                   description="Conversion d'une révision choisie en BROUILLON de facture (invoices.quote_id) : prix confirmés "
                                               "explicitement (QUOTE : prix et remises de la révision ; CATALOG : prix actuel du catalogue, sans "
                                               "remise) ; patient_id obligatoire pour un prospect. Ni émission, ni paiement, ni réserve."),
        'AbandonInvoiceDraftRequest': obj({'expected_version': ref('Version'), 'invoice_id': ulid(), 'reason': n_text(1000)},
                                          description='Abandon d\'un brouillon de facture (fichier 03) : version de brouillon attendue, motif facultatif (conservé dans l\'audit). Aucun numéro, aucune réserve, aucun document à annuler.'),
        'MergePatientsRequest': obj({'expected_version': ref('Version'), 'source_patient_id': ulid(), 'survivor_patient_id': ulid(),
                                     'reason': text(1000, 5)},
                                    description="Fusion manuelle de deux fiches d'un même patient (L1D08), par la gérante après revue : "
                                                "version attendue de la fiche ABSORBÉE, motif obligatoire (5 à 1000 caractères)."),
        'RecordCashMovementRequest': obj({'expected_version': {'type': 'null'}, 'movement_id': ulid(), 'cash_session_id': ulid(),
                                          'movement_kind': enum('cash_movements.kind'),
                                          'signed_amount': {'type': 'integer', 'minimum': -1000000000000, 'maximum': 1000000000000, 'not': {'const': 0}},
                                          'expense_category_id': n_ulid(), 'reason': text(500, 3), 'reference': n_text(180), 'approval_id': ulid()},
                                         description="Mouvement d'espèces hors vente d'une session OUVERTE (L1D05) : entrée positive, sortie négative ; catégorie obligatoire pour une dépense et seulement pour elle ; approval_id = approbation exacte CASH_MOVEMENT accordée, ou identifiant neuf pour l'exécution directe de la gérante."),
        'ExpenseCategoryRequest': obj({'expected_version': {'type': 'null'}, 'category_id': ulid(), 'code': n_text(40), 'name': text(180, 2), 'active': boolean()},
                                      description='Création (identifiant neuf, code obligatoire) ou modification (nom, activation ; le code ne change pas) d\'une catégorie de dépenses par la gérante.'),
        'CashVarianceReviewRequest': obj({'expected_version': {'type': 'null'}, 'cash_session_id': ulid(),
                                          'decision': {'type': 'string', 'enum': ['ACCEPTED', 'DISPUTED']}, 'note': n_text(1000)},
                                         description="Revue par la gérante de l'écart d'une session clôturée : acceptée ou contestée (note obligatoire), une seule fois."),
        'DeletePrescriptionDraftRequest': obj({'expected_version': {'type': 'null'}, 'prescription_id': ulid(), 'expected_updated_at': instant()},
                                              description="Suppression d'un brouillon de prescription : jeton de concurrence expected_updated_at lu avec la prescription (elle n'a pas de colonne version, expected_version vaut null). Refusée (409) si la prescription est validée ou déjà utilisée par une facture, une commande d'atelier ou un document."),
        'DeleteQuoteDraftRequest': obj({'expected_version': ref('Version'), 'quote_id': ulid()},
                                       description="Suppression d'un brouillon de devis jamais émis : version du brouillon attendue. Refusée (409) pour un devis émis, accepté, refusé, expiré ou converti ; son créateur ou la gérante seulement."),
        'CancelFollowUpRequest': obj({'expected_version': ref('Version'), 'follow_up_plan_id': ulid(), 'reason': text(1000, 3)},
                                     description="Annulation d'un contrôle recommandé encore actif : version du contrôle attendue, motif obligatoire (3 à 1 000 caractères, conservé dans l'audit). Refusée (409) si un rendez-vous le programme, s'il est déjà annulé ou clos."),
        'DeleteConsultationDraftRequest': obj({'expected_version': ref('Version'), 'consultation_id': ulid()},
                                              description="Suppression d'un examen resté brouillon (aucune rubrique enregistrée) : version de la consultation attendue. Refusée (409) si l'examen est en cours ou terminé, ou si une prescription validée, un contrôle recommandé ou une rubrique clinique y est rattaché."),
        'CancelVisitRequest': obj({'expected_version': ref('Version'), 'visit_id': ulid(), 'reason': text(500, 3)},
                                  description='Annulation d\'une visite avant l\'examen (P03) : version de la visite attendue, motif obligatoire (information d\'accueil seulement, conservé dans l\'audit). Refusée si l\'examen a démarré ou si une facture non abandonnée est liée à la visite.'),
        'OpeningStockRequest': obj({'counted_at': instant(), 'reason': text(1000, 3), 'approval_id': n_ulid(),
                                    'lines': array(obj({'movement_id': ulid(), 'item_id': ulid(), 'location_id': ulid(),
                                                        'lot': nullable(obj({'lot_id': ulid(), 'batch_number': text(80),
                                                                             'expires_on': ref('NullableCivilDate')})),
                                                        'quantity': quantity(), 'unit_cost': nullable(money())}), 1, 500)},
                                   description='Stock initial validé (I00) : un mouvement OPENING par ligne, lots créés au besoin ; gérante.'),
        'SupplierRequest': obj({'expected_version': {'type': 'null'}, 'name': text(180, 2), 'reference': text(64), 'phone': n_text(32), 'email': n_text(254), 'address': n_text(2000),
                                'is_optical_lab': boolean(), 'active': boolean()},
                               optional=('phone', 'email', 'address', 'is_optical_lab', 'active'),
                               description='Fournisseur ou laboratoire (L1D01), création ou modification complète ; code unique par cabinet, désactivation par `active` faux. Droit stock.receive.'),
        'GoodsReceiptDraftRequest': obj({'expected_version': {'type': 'null'}, 'supplier_id': ulid(), 'location_id': ulid(), 'supplier_reference': text(100), 'received_at': instant(),
                                         'notes': n_text(2000),
                                         'lines': array(obj({'item_id': ulid(), 'quantity': quantity(), 'unit_cost': nullable(money())}), 1, 200)},
                                        optional=('notes',),
                                        description='Brouillon de réception (L1D01), création ou remplacement complet : aucun lot ni stock avant la validation ; coût unitaire connu ou null (inconnu).'),
        'ValidateGoodsReceiptRequest': obj({'expected_version': {'type': 'null'}, 'lines': array(obj({'position': integer(1, 200),
                                                                'lot': nullable(obj({'batch_number': text(80), 'expires_on': ref('NullableCivilDate')})),
                                                                'unit_cost': nullable(money())}), 1, 200)},
                                           description='Validation d\'une réception (L1D01) : CHAQUE ligne du brouillon confirme son lot (obligatoire pour un article périssable ou déjà suivi par lots) et son coût final (null = inconnu).'),
        'OpenInventoryCountRequest': obj({'expected_version': {'type': 'null'}, 'location_id': ulid(), 'reference': text(64)},
                                         description='Ouverture d\'un inventaire (L1D02) : un emplacement, théorique figé à l\'instant d\'ouverture ; un seul inventaire actif par emplacement. Droit stock.inventory.'),
        'RecordInventoryCountsRequest': obj({'expected_version': {'type': 'null'},
                                             'lines': array(obj({'line_id': ulid(), 'counted_quantity': nullable(counted_quantity), 'variance_reason': n_text(1000)},
                                                                optional=('variance_reason',)), 1, 500)},
                                            description='Quantités comptées d\'un inventaire ouvert : zéro admis, null efface le comptage ; le motif de l\'écart est facultatif ici, obligatoire à la validation pour tout écart non nul. Aucun stock n\'est modifié.'),
        'InventoryCountActionRequest': obj({'expected_version': {'type': 'null'}},
                                           description='Terminer le comptage (toutes les lignes comptées) ou rouvrir un inventaire compté (corps réduit à expected_version null).'),
        'AbandonInventoryCountRequest': obj({'expected_version': {'type': 'null'}, 'reason': n_text(1000)}, optional=('reason',),
                                            description='Abandon d\'un inventaire ouvert ou compté, sans effet sur le stock ; motif facultatif conservé dans l\'audit.'),
        'ValidateInventoryCountRequest': obj({'expected_version': {'type': 'null'}, 'reason': text(1000, 3)},
                                             description='Validation par la gérante réauthentifiée : motif de l\'approbation (3 à 1 000 caractères) ; chaque écart non nul doit déjà porter son motif.'),
        'DeleteGoodsReceiptDraftRequest': obj({'expected_version': {'type': 'null'}}, description='Suppression d\'un brouillon de réception jamais validé (corps vide).'),
        'EvaluateStockAlertsRequest': obj({'expected_version': {'type': 'null'}}, description='Évaluation des seuils bas et péremptions du stock (corps réduit à expected_version null).'),
        'StockAlertActionRequest': obj({'expected_version': {'type': 'null'}}, description='Accuser réception ou résoudre une alerte de stock (corps réduit à expected_version null).'),
        'CreateWorkshopOrderRequest': obj(
            {
                'expected_version': {'type': 'null'},
                'invoice_line_id': ulid(),
                'prescription_id': ulid(),
                'supplier_id': ulid(),
                'frame_item_id': n_ulid(),
                'lab_reference': n_text(100),
                'expected_at': n_instant(),
                'quantity': quantity(),
                'lens_type': n_text(100),
                'frame_reference_snapshot': n_text(100),
                'pd_od': ref('NullableDiopter'),
                'pd_og': ref('NullableDiopter'),
                'fitting_height_od': ref('NullableDiopter'),
                'fitting_height_og': ref('NullableDiopter'),
                'notes': n_text(),
            },
            optional=(
                'frame_item_id',
                'lab_reference',
                'expected_at',
                'lens_type',
                'frame_reference_snapshot',
                'pd_od',
                'pd_og',
                'fitting_height_od',
                'fitting_height_og',
                'notes',
            ),
            description="Création en ligne d'une commande atelier (L1D04) à partir d'une ligne de facture émise et d'une prescription optique validée.",
        ),
        'AdvanceWorkshopOrderRequest': obj(
            {
                'expected_version': ref('Version'),
                'workshop_order_id': ulid(),
                'event_type': enum('workshop_events.event_type'),
                'new_status': nullable(enum('workshop_orders.status')),
                'quality_result': nullable(enum('workshop_events.quality_result')),
                'observations': n_text(),
                'lab_reference': n_text(100),
                'expected_at': n_instant(),
                'notes': n_text(),
                'delivery_line_id': n_ulid(),
            },
            optional=('new_status', 'quality_result', 'observations', 'lab_reference', 'expected_at', 'notes', 'delivery_line_id'),
            description="Transition, contrôle qualité, reprise, ajustement ou annulation d'une commande atelier (L1D04, version optimiste).",
        ),
        'EnrollDeviceRequest': obj({'expected_version': {'type': 'null'}, 'device_code': text(64), 'name': text(180),
                                    'public_key_jwk': {'$ref': '../resources/operations.json#/$defs/PublicJwk'},
                                    'responsible_user_id': ulid(), 'app_version': text(64), 'proof': ref('CompactJws')},
                                   description='Enrôlement (O02) : clé publique ES256 du poste et preuve de possession (JWS compact ES256 signé par la '
                                               'clé PRIVÉE du poste, typ eeo-device-proof+jws, kid = empreinte RFC 7638, charge JCS {clinic_id, device_code, '
                                               'issued_at, jwk_thumbprint, purpose=enroll, v=1}, fraîche de 10 minutes).'),
        'IssueOfflineGrantRequest': obj({'expected_version': {'type': 'null'}, 'user_id': ulid(), 'valid_hours': nullable(integer(1, 168))},
                                        optional=('valid_hours',),
                                        description='Grant signé d\'un profil sur ce poste (O02) : permissions effectives figées, catalogue et règles ; '
                                                    'durée par défaut eeo.offline.grant_hours (72 h).'),
        'RevokeDeviceRequest': obj({'expected_version': {'type': 'null'}, 'status': {'type': 'string', 'enum': ['REVOKED', 'LOST']}, 'reason': text(1000, 3)},
                                   description='Révocation d\'un poste (retiré ou perdu) et de tous ses grants actifs ; connue du poste à sa prochaine connexion.'),
        'RevokeOfflineGrantRequest': obj({'expected_version': {'type': 'null'}, 'reason': text(1000, 3)}),
        'PrepareDeviceRequest': obj({'expected_version': {'type': 'null'}, 'profiles': array(ulid(), 1, 10),
                                     'number_ranges': array(obj({'document_type': enum('document_number_allocations.document_type'),
                                                                 'quantity': integer(1, 5000),
                                                                 'document_year': nullable(integer(2000, 9999))},
                                                                optional=('document_year',)), 0, 10),
                                     'stock_quotas': array(obj({'stock_position_id': ulid(), 'stock_lot_id': n_ulid(), 'quantity': quantity()}), 0, 200),
                                     'invoice_ids': array(ulid(), 0, 500), 'known_catalog_version': n_text(64)},
                                    optional=('number_ranges', 'stock_quotas', 'invoice_ids', 'known_catalog_version'),
                                    description='Préparation en ligne (gérante, O03) : profils préparés (grant actif exigé), plages demandées (année en cours par '
                                                'défaut, ou la suivante avant le franchissement), quotas et factures émises à attribuer à ce poste.'),
        'ReleaseDeviceRequest': obj({'expected_version': {'type': 'null'}, 'last_device_sequence': ref('Counter'),
                                     'last_event_hash': ref('NullableSha256Hex'), 'reason': text(1000, 3)},
                                    description='Clôture après reprise complète (O03) : séquence et empreinte égales au préfixe finalisé du serveur, sinon 409.'),
        'ReplaceDeviceRequest': obj({'expected_version': {'type': 'null'}, 'replacement_device_id': ulid(), 'reason': text(1000, 3)},
                                    description="Remplacement d'un poste par un poste NEUF déjà enrôlé et actif (O07) ; aucun droit de l'ancien poste n'est cloné."),
        'ReconcileReplacementRequest': obj({'expected_version': {'type': 'null'}, 'last_device_sequence': ref('Counter'),
                                            'last_event_hash': ref('NullableSha256Hex'), 'reason': text(1000, 3)},
                                           description="Réconciliation d'un poste remplacé (O07) : séquence et empreinte du manifeste de l'export, égales au préfixe finalisé du serveur, sinon 409 SYNC_INCOMPLETE."),
        'ConflictResolutionRequest': obj({'expected_version': {'type': 'null'},
                                          'decision': {'type': 'string', 'enum': ['ACCEPT_LOCAL', 'KEEP_CENTRAL', 'REJECT', 'CORRECT']},
                                          'reason': text(1000, 3), 'correction_command_id': n_ulid()},
                                         description='Résolution autorisée et motivée ; ne réécrit jamais core/hash/signature ; une correction a sa propre command_id (contrat 23).'),
        'CreateExportRequest': obj({'export_type': enum('export_requests.export_type'), 'patient_id': n_ulid(), 'filters': nullable(export_filters())},
                                   optional=('patient_id', 'filters')),
        'BookingRequest': obj({'service_id': ulid(), 'resource_id': n_ulid(), 'starts_at': instant(), 'name': text(180), 'phone': ref('Phone'),
                               'email': nullable({'type': 'string', 'maxLength': 254}), 'consent': {'const': True}},
                              optional=('email', 'resource_id'), description='Réservation publique (L2) : consentement explicite exigé, anti-abus et idempotence.'),
        'SaveIntegrationAccountRequest': obj({
            'provider': enum('integration_accounts.provider'),
            'external_account_id': text(180),
            'display_name': text(180),
            'status': enum('integration_accounts.status'),
            'credentials': nullable({'type': 'object'}),
            'public_configuration': nullable({'type': 'object'}),
        }, optional=('credentials', 'public_configuration')),
        'UpdateIntegrationAccountRequest': obj({
            'expected_version': ref('Version'),
            'display_name': text(180),
            'status': enum('integration_accounts.status'),
            'credentials': nullable({'type': 'object'}),
            'public_configuration': nullable({'type': 'object'}),
        }, optional=('display_name', 'status', 'credentials', 'public_configuration')),
        'ProcessOutboxRequest': obj({'limit': integer(1, 200), 'event_types': array(text(100))}, optional=('limit', 'event_types')),
        'SaveCalendarSyncStateRequest': obj({
            'integration_account_id': ulid(),
            'resource_id': ulid(),
            'external_calendar_id': text(255),
            'status': enum('calendar_sync_states.status'),
        }, optional=('status',)),
        'CalendarSyncRunRequest': obj({'resource_id': n_ulid(), 'full_resync': boolean()}, optional=('resource_id', 'full_resync')),
        'DecidePublicBookingRequest': obj({'resource_id': n_ulid(), 'reason': n_text(1000)}, optional=('resource_id', 'reason')),
        'SaveProspectContactRequest': obj({
            'name': text(180),
            'phone': nullable(ref('Phone')),
            'email': nullable({'type': 'string', 'maxLength': 254}),
            'origin': enum('prospect_contacts.origin'),
            'administrative_notes': n_text(4000),
        }, optional=('phone', 'email', 'administrative_notes')),
        'UpdateProspectContactRequest': obj({
            'expected_version': ref('Version'),
            'name': text(180),
            'phone': nullable(ref('Phone')),
            'email': nullable({'type': 'string', 'maxLength': 254}),
            'administrative_notes': n_text(4000),
        }, optional=('name', 'phone', 'email', 'administrative_notes')),
        'LinkProspectPatientRequest': obj({'patient_id': ulid()}),
        'SyncCrmLeadsRequest': obj({'integration_account_id': n_ulid(), 'limit': integer(1, 200)}, optional=('integration_account_id', 'limit')),
        'SaveKnowledgeEntryRequest': obj({
            'code': text(100),
            'title': text(180),
            'category': enum('knowledge_entries.category'),
            'content': text(10000),
            'language': text(10),
        }, optional=('language',)),
        'CreateKnowledgeVersionRequest': obj({'content': text(10000), 'language': text(10)}, optional=('language',)),
        'KnowledgeActionRequest': obj({'reason': n_text(1000)}, optional=('reason',)),
        'AssistantTurnRequest': obj({
            'message': text(2000),
            'service_id': n_ulid(),
            'preferred_starts_at': n_instant(),
        }, optional=('service_id', 'preferred_starts_at')),
        'ConversationHandoffRequest': obj({
            'reason': text(2000, 3),
            'administrative_summary': n_text(4000),
            'assign_to_self': boolean(),
        }, optional=('administrative_summary', 'assign_to_self')),
        'RecordConsentRequest': obj({
            'patient_id': n_ulid(),
            'prospect_contact_id': n_ulid(),
            'channel': enum('communication_consents.channel'),
            'purpose': enum('communication_consents.purpose'),
            'destination': text(254),
            'proof': text(2000, 2),
            'policy_version': text(64),
        }, optional=('patient_id', 'prospect_contact_id', 'policy_version')),
        'RevokeConsentRequest': obj({
            'patient_id': n_ulid(),
            'prospect_contact_id': n_ulid(),
            'channel': enum('communication_consents.channel'),
            'purpose': enum('communication_consents.purpose'),
            'destination': text(254),
            'proof': text(2000, 2),
            'policy_version': text(64),
        }, optional=('patient_id', 'prospect_contact_id', 'policy_version')),
        'SaveMessageTemplateRequest': obj({
            'code': text(100),
            'channel': enum('message_templates.channel'),
            'purpose': enum('message_templates.purpose'),
        }),
        'CreateMessageTemplateVersionRequest': obj({
            'integration_account_id': n_ulid(),
            'provider_template_id': n_text(180),
            'language': text(10),
            'body': text(5000),
            'allowed_variables': array(text(64)),
        }, optional=('integration_account_id', 'provider_template_id', 'language', 'allowed_variables')),
        'SaveReminderPolicyRequest': obj({
            'code': text(64),
            'label': text(180),
            'purpose': enum('reminder_policies.purpose'),
            'channel': enum('reminder_policies.channel'),
            'offset_unit': enum('reminder_policies.offset_unit'),
            'offset_value': integer(-3650, 3650),
            'local_send_time': n_text(8),
            'active': boolean(),
        }, optional=('local_send_time', 'active')),
        'UpdateReminderPolicyRequest': obj({
            'expected_version': ref('Version'),
            'label': text(180),
            'channel': enum('reminder_policies.channel'),
            'offset_unit': enum('reminder_policies.offset_unit'),
            'offset_value': integer(-3650, 3650),
            'local_send_time': n_text(8),
            'active': boolean(),
        }, optional=('label', 'channel', 'offset_unit', 'offset_value', 'local_send_time', 'active')),
        'SendTaskMessageRequest': obj({
            'template_version_id': n_ulid(),
            'channel': nullable(enum('communication_consents.channel')),
        }, optional=('template_version_id', 'channel')),
        'SaveAudienceSegmentRequest': obj({'name': text(180), 'criteria': {'type': 'object'}}),
        'UpdateAudienceSegmentRequest': obj({'expected_version': ref('Version'), 'name': text(180), 'criteria': {'type': 'object'}},
                                            optional=('name', 'criteria')),
        'SaveCampaignRequest': obj({
            'name': text(180),
            'segment_id': ulid(),
            'template_version_id': ulid(),
            'scheduled_at': n_instant(),
        }, optional=('scheduled_at',)),
        'FreezeCampaignRequest': obj({'approval_id': n_ulid()}, optional=('approval_id',)),
        'PauseCampaignRequest': obj({'reason': n_text(1000)}, optional=('reason',)),
        'ReconcileIntegrationsRequest': obj({'limit': integer(1, 200)}, optional=('limit',)),
    }
    # Commandes du chemin central validées par le bus : il ajoute `expected_version` (null ici) au corps direct.
    for name in ('CatalogImportRequest', 'StoreDocumentContentCommand', 'LegacyBalanceImportRequest',
                 'StoreLegacyEvidenceCommand', 'StoreStatementEvidenceCommand', 'CreateExportRequest'):
        defs[name]['properties'] = {'expected_version': {'type': 'null'}, **defs[name]['properties']}
    return schema_file('schemas/requests/http.json', 'Requêtes HTTP des routes sans commande hors-ligne',
                       'Corps des routes en ligne ; les routes qui exécutent une commande du journal local utilisent contracts/commands/<Commande>.v1.json#/$defs/DirectRequest.', defs)


# --------------------------------------------------------------------------------------------------
# Snapshots des pièces
# --------------------------------------------------------------------------------------------------

def snapshots():
    global CURRENT
    CURRENT = S
    patient = obj({'patient_id': ulid(), 'record_number': text(64), 'last_name': text(120), 'first_names': n_text(180)})
    clinic = obj({'clinic_id': ulid(), 'name': text(180), 'address': n_text(2000), 'phone': n_text(32), 'email': n_text(254),
                  'tax_identifier': n_text(100), 'professional_mentions': n_text(4000), 'document_settings': nullable({'type': 'object'}),
                  'currency': ref('Currency'), 'timezone': text(64), 'test_document': boolean()},
                 description='En-tête du cabinet au moment de l\'émission ; test_document = true tant que production_documents_enabled est faux (document TEST clairement marqué, fichier 23).')
    tax = obj({'regime': {'type': 'string', 'enum': ['NO_TAX_CONFIGURED', 'VALIDATED_RULES']},
               'rules': array(obj({'tax_rule_id': ulid(), 'code': text(40), 'label': text(180), 'rate_percent': nullable(ref('Rate')),
                                   'validated_at': n_instant(), 'legal_note': n_text()}))},
              description='Régime fiscal figé : aucune taxe inventée ; sans règle validée, NO_TAX_CONFIGURED et liste vide.')
    invoice_ref = obj({'invoice_id': ulid(), 'number': text(64), 'issued_at': instant(), 'total_gross': money()})
    actor = obj({'user_id': ulid(), 'display_name': text(180)})
    files = []

    def snap(name, title, description, schema):
        files.append((name, {
            '$schema': 'https://json-schema.org/draft/2020-12/schema',
            '$id': BASE + 'snapshots/' + name,
            'title': title,
            'description': description + GENERATED,
            **schema,
        }))

    snap('invoice-patient.json', 'Snapshot patient d\'une facture (invoices.patient_snapshot)', 'Identité facturée minimale et référence dossier (fichier 11).', patient)
    snap('invoice-clinic.json', 'Snapshot cabinet d\'une facture (invoices.clinic_snapshot)', 'Mentions du cabinet figées à l\'émission.', clinic)
    snap('invoice-tax.json', 'Snapshot fiscal d\'une facture (invoices.tax_snapshot)', 'Règles fiscales validées appliquées, ou absence de régime configuré.', tax)
    snap('receipt.json', 'Snapshot d\'un reçu (receipts.snapshot)',
         'Contenu du reçu (fichier 11) : numéro, dates effective et d\'émission, facture, patient, versement, cumul encaissé net, reste, utilisateur ; nature calculée, jamais saisie.',
         obj({'receipt_id': ulid(), 'receipt_number': text(64), 'issued_at': instant(), 'effective_at': instant(), 'invoice': invoice_ref,
              'patient': patient, 'payment': obj({'payment_id': ulid(), 'amount': ref('PositiveMoneyXaf'), 'currency': ref('Currency'),
                                                  'method': enum('payments.method'), 'reference': n_text(180)}),
              'paid_net_before': money(), 'paid_net_after': money(), 'balance_after': signed_money(),
              'kind': {'type': 'string', 'enum': ['DEPOSIT', 'BALANCE_SETTLEMENT'],
                       'description': 'Calculée : BALANCE_SETTLEMENT si le reste après ce paiement est nul, sinon DEPOSIT (un encaissement ne dépasse jamais le solde).'},
              'cashier': actor, 'clinic': clinic, 'template_version': text(64)}))
    snap('credit-note.json', 'Snapshot d\'un avoir (credit_notes.snapshot)',
         'Avoir (fichier 11) : facture source, lignes et montants corrigés, motif, taxes selon régime, auteur et autorisation, date.',
         obj({'credit_note_id': ulid(), 'number': text(64), 'issued_at': instant(), 'invoice': invoice_ref, 'patient': patient,
              'lines': array(obj({'invoice_line_id': ulid(), 'description': text(500), 'quantity': nullable(quantity()),
                                  'amount_gross': ref('PositiveMoneyXaf'), 'tax_amount': nullable(money())}), 1),
              'amount_gross': ref('PositiveMoneyXaf'), 'reason': text(), 'issued_by': actor, 'approval_id': ulid(), 'tax': tax,
              'clinic': clinic, 'template_version': text(64)}))
    snap('refund.json', 'Snapshot d\'un remboursement (refunds.snapshot)',
         'Reçu de remboursement (fichier 11) : numéro, avoir et facture, montant, mode, référence, bénéficiaire vérifié.',
         obj({'refund_id': ulid(), 'number': text(64), 'effective_at': instant(), 'credit_note': obj({'credit_note_id': ulid(), 'number': text(64)}),
              'invoice': invoice_ref, 'beneficiary': patient, 'amount': ref('PositiveMoneyXaf'), 'currency': ref('Currency'),
              'method': enum('refunds.method'), 'reference': n_text(180), 'created_by': actor, 'clinic': clinic, 'template_version': text(64)}))
    snap('quote-revision.json', 'Snapshot d\'une révision de devis (quote_revisions.snapshot)',
         'Devis figé à l\'émission ou à la révision (L1D07) : numéro, révision, validité, destinataire, lignes et taxe comprise, cabinet, '
         'auteur, motif ; source de son document, réimprimable à l\'identique. Ni créance, ni paiement.',
         obj({'quote_id': ulid(), 'number': text(64), 'revision_no': integer(1), 'recorded_at': instant(), 'issued_at': instant(),
              'valid_until': ref('NullableCivilDate'),
              'recipient': obj({'kind': {'type': 'string', 'enum': ['PATIENT', 'PROSPECT']}, 'patient_id': n_ulid(),
                                'prospect_contact_id': n_ulid(), 'record_number': n_text(64), 'last_name': text(180),
                                'first_names': n_text(180), 'phone': n_text(32)}),
              'lines': array(obj({'line_id': ulid(), 'position': integer(1), 'catalog_item_id': n_ulid(), 'reference': n_text(64),
                                  'description': text(500), 'unit_code': ref('Code'), 'quantity': quantity(),
                                  'unit_price_gross': money(), 'discount_gross': money(), 'line_total_gross': money(),
                                  'tax_code': text(40), 'tax_rate_percent': nullable(ref('Rate')), 'tax_amount': nullable(money())}), 1),
              'total_gross': money(), 'currency': ref('Currency'), 'tax': tax, 'clinic': clinic, 'authored_by': actor,
              'reason': text(), 'template_version': text(64)}))
    snap('delivery-patient.json', 'Snapshot patient d\'une remise (deliveries.patient_snapshot)', 'Identité minimale du bénéficiaire de la remise.', patient)
    snap('clinical-revision.json', 'Snapshot d\'une révision clinique (clinical_revisions.snapshot)',
         'Consultation figée à la finalisation ou à la correction : toutes les rubriques, auteur, motif ; clinical_revisions.sha256 = SHA-256 de JCS(snapshot). Jamais dans une outbox de communication.',
         obj({'consultation_id': ulid(), 'revision_no': integer(1), 'recorded_at': instant(), 'author': actor, 'patient': patient,
              'visit_id': ulid(), 'effective_at': instant(), 'steps': step('AllSteps'), 'finalization_missing_data_reason': n_text(),
              'previous_revision_id': n_ulid(), 'amendment_reason': n_text()}))
    lens_index_snap = nullable({'type': 'string', 'pattern': '^(0|[1-9][0-9]?)(\\.[0-9]{1,2})?$'})
    snap('workshop-order.json', 'Snapshot d\'une commande atelier (workshop_orders.snapshot)',
         'Bon laboratoire figé à la création (L1D04) : code dossier patient uniquement (jamais nom, téléphone, antécédents ni prix), prescription versionnée, verres OD/OG, DP/hauteur et laboratoire.',
         obj({'schema': integer(1, 1), 'workshop_order_id': ulid(), 'reference': text(64), 'lab_reference': n_text(100),
              'ordered_at': instant(), 'expected_at': n_instant(), 'quantity': quantity(), 'notes': n_text(),
              'clinic': clinic,
              'patient': obj({'patient_id': ulid(), 'record_number': text(64)}),
              'supplier': obj({'supplier_id': ulid(), 'name': text(180), 'reference': text(64), 'phone': n_text(32), 'email': n_text(254)}),
              'frame': nullable(obj({'frame_item_id': ulid(), 'reference': text(64), 'name': text(180), 'brand': n_text(120), 'model': n_text(120)})),
              'invoice_line': obj({'invoice_id': ulid(), 'invoice_number': text(64), 'invoice_line_id': ulid(), 'description': text(500, 0)}),
              'prescription': obj({'prescription_id': ulid(), 'series_id': ulid(), 'version_no': integer(1),
                                   'origin': enum('optical_prescriptions.origin'), 'validated_at': instant(),
                                   'external_prescriber': n_text(180), 'external_prescribed_on': ref('NullableCivilDate'),
                                   'usage_code': n_text(40), 'usage_label': n_text(180), 'lens_type_code': n_text(40),
                                   'lens_type_label': text(100), 'lens_index': lens_index_snap, 'lens_index_label': n_text(180),
                                   'pd_total': ref('NullableDiopter'), 'pd_od': ref('NullableDiopter'), 'pd_og': ref('NullableDiopter'),
                                   'pd_inconsistency_reason': n_text(1000), 'notes': n_text(),
                                   'treatments': array(text(180)),
                                   'eyes': array(obj({'eye': enum('workshop_order_eyes.eye'), 'sphere': ref('NullableDiopter'),
                                                      'cylinder': ref('NullableDiopter'), 'axis': nullable(integer(0, 180)),
                                                      'addition': ref('NullableDiopter'), 'pd': ref('NullableDiopter'),
                                                      'fitting_height': ref('NullableDiopter'), 'lens_type': text(100),
                                                      'lens_index': lens_index_snap, 'treatments_snapshot': array(text(180)),
                                                      'frame_reference_snapshot': n_text(100)}), 1, 2)}),
              'created_by': actor, 'template_version': text(64)}))
    CURRENT = R
    return files


def build():
    global CURRENT
    files = {}
    for builder in (access_resources, patient_resources, clinical_resources, billing_resources, stock_resources,
                    workshop_resources, scheduling_resources, operations_resources, public_resources, communication_resources, requests):
        CURRENT = R
        path, schema = builder()
        files[path] = schema
    for name, schema in snapshots():
        files['snapshots/' + name] = schema
    return files


def main():
    files = build()
    check = '--check' in sys.argv
    stale = []
    for relative, schema in files.items():
        path = CONTRACTS / relative
        text_value = json.dumps(schema, ensure_ascii=False, indent=2) + '\n'
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != text_value:
                stale.append(relative)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text_value, encoding='utf-8')
    if check:
        produced = {CONTRACTS / relative for relative in files}
        extra = sorted(str(p.relative_to(CONTRACTS)) for directory in ('schemas/resources', 'schemas/requests', 'snapshots')
                       for p in (CONTRACTS / directory).glob('*.json') if p not in produced)
        if stale or extra:
            print('ECHEC : ressources périmées ' + str(stale) + ' ou en trop ' + str(extra) + ' : relancer contracts/tools/build_resources.py', file=sys.stderr)
            sys.exit(1)
        print('Ressources, requêtes et snapshots à jour : ' + str(len(files)) + ' fichiers.')
        return
    print(str(len(files)) + ' fichiers de ressources, requêtes et snapshots écrits.')


if __name__ == '__main__':
    main()

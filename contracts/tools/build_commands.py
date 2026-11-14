"""Charges des commandes du journal local et des requêtes directes équivalentes (F06).

Source unique des 26 commandes jouables hors-ligne (fichiers 08, 19, 23) : chaque commande produit
contracts/commands/<Nom>.v1.json avec
  - la charge synchronisée (racine du schéma : objet strict, toutes les clés présentes, null explicite),
  - `$defs/DirectRequest` : la même charge plus `expected_version` pour la route HTTP directe
    (fichier 08 : version attendue dans le corps, clé d'idempotence en en-tête),
et contracts/commands/index.json (entité, champ entity_id, permission, nature de la version attendue,
route directe, numéro consommé), contracts/commands/dispatch.json (cohérence du cœur signé :
command_name → charge, schema_version, entity_type, expected_version, plage de numéros) et
contracts/schemas/clinical-steps.json (rubriques du dossier, partagées avec les réponses et le snapshot
de révision clinique).

Règles de contrat :
  - les identifiants de TOUS les effets (lignes, reçus, documents, usages de numéro, réserves, révisions)
    sont fournis par le poste avant le commit local, et repris tels quels par le serveur ;
  - montants en entiers XAF bornés, quantités et mesures en chaînes décimales exactes ;
  - valeurs admises reprises du catalogue (schemas/enums.json), jamais recopiées ;
  - le serveur recalcule toujours (totaux, soldes, disponibilités) : une valeur calculée transmise par le
    poste est une valeur à vérifier, jamais une autorité.

  python3 contracts/tools/build_commands.py          # écrit les fichiers
  python3 contracts/tools/build_commands.py --check  # échoue si un fichier est absent ou périmé (CI)
"""
from pathlib import Path
import copy
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'contracts' / 'commands'
BASE = 'https://eeo.invalid/contracts/commands/'

C = '../schemas/common.json#/$defs/'
E = '../schemas/enums.json#/$defs/'
STEPS = '../schemas/clinical-steps.json#/$defs/'


def ref(name):
    return {'$ref': C + name}


def enum(column):
    return {'$ref': E + column}


def nullable(schema):
    return {'anyOf': [schema, {'type': 'null'}]}


def text(max_length=None, min_length=1):
    schema = {'type': 'string', 'minLength': min_length}
    if max_length:
        schema['maxLength'] = max_length
    return schema


def boolean():
    return {'type': 'boolean'}


def integer(minimum=None, maximum=None):
    schema = {'type': 'integer'}
    if minimum is not None:
        schema['minimum'] = minimum
    if maximum is not None:
        schema['maximum'] = maximum
    return schema


def obj(properties, extra=None):
    """Objet strict : toutes les propriétés sont requises (null explicite pour l'optionnel)."""
    schema = {'type': 'object', 'additionalProperties': False, 'required': list(properties), 'properties': properties}
    if extra:
        schema.update(extra)
    return schema


def array(items, min_items=0, max_items=200, unique=False):
    schema = {'type': 'array', 'minItems': min_items, 'maxItems': max_items, 'items': items}
    if unique:
        schema['uniqueItems'] = True
    return schema


def require_when_null(field, reason_field):
    """CHECK de la baseline : si `field` est null, `reason_field` doit être renseigné."""
    return {
        'if': {'properties': {field: {'type': 'null'}}, 'required': [field]},
        'then': {'properties': {reason_field: {'type': 'string', 'minLength': 1}}},
    }


def require_when_const(field, value, required_field, schema=None):
    return {
        'if': {'properties': {field: {'const': value}}, 'required': [field]},
        'then': {'properties': {required_field: schema or {'type': 'string', 'minLength': 1}}},
    }


ULID = ref('Ulid')
N_ULID = ref('NullableUlid')
INSTANT = ref('Instant')
MONEY = ref('MoneyXaf')
POSITIVE_MONEY = ref('PositiveMoneyXaf')
QUANTITY = ref('Quantity')
REASON = ref('Reason')
N_TEXT = nullable({'type': 'string', 'maxLength': 4000})
N_DIOPTER = ref('NullableDiopter')
N_DATE = ref('NullableCivilDate')
AXIS = nullable(integer(0, 180))
TERM = obj({'id': ULID, 'term_code': ref('Code'), 'other_text': N_TEXT})
NON_ZERO_SIGNED_QUANTITY = {'allOf': [ref('SignedQuantity'), {'not': {'type': 'string', 'pattern': '^-?0(\\.0{1,3})?$'}}]}

INVOICE_LINE = obj({
    'line_id': ULID,
    'position': integer(1, 999),
    'catalog_item_id': N_ULID,
    'description': text(500),
    'quantity': QUANTITY,
    'unit_price_gross': MONEY,
    'discount_gross': MONEY,
    'prescription_id': N_ULID,
}, {'description': 'Ligne de brouillon : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise).'})

# Réserve écrite par IssueInvoice (I00 : même service transactionnel pour l'émission et la remise ;
# aucune route de réservation séparée).
RESERVATION = obj({
    'reservation_id': ULID,
    'invoice_line_id': ULID,
    'item_id': ULID,
    'stock_position_id': ULID,
    'stock_lot_id': N_ULID,
    'device_allocation_id': nullable(ULID),
    'quantity': QUANTITY,
}, {'description': 'Réserve créée à l\'émission (I00) : une réserve sous quota local reste incluse dans le quota, jamais soustraite deux fois.'})

CLINICAL_STEPS = {
    'ANAMNESIS': obj({
        'symptoms': N_TEXT,
        'wears_glasses': nullable(boolean()),
        'glasses_duration': N_TEXT,
        'previous_correction_available': nullable(boolean()),
        'complaints': array(TERM, max_items=50),
    }),
    'HISTORIES': obj({
        'histories': array(obj({
            'id': ULID,
            'history_group': enum('consultation_histories.history_group'),
            'known_none': boolean(),
            'comments': N_TEXT,
            'terms': array(TERM, max_items=50),
        }), max_items=3),
    }),
    'VISUAL_ACUITY': obj({
        'acuities': array(obj({
            'id': ULID,
            'context': enum('visual_acuities.context'),
            'distance': enum('visual_acuities.distance'),
            'correction': enum('visual_acuities.correction'),
            'eye': enum('visual_acuities.eye'),
            'scale_id': ULID,
            'raw_value': text(100),
            'normalized_value': nullable({'type': 'string', 'pattern': '^-?[0-9]{1,4}(\\.[0-9]{1,4})?$'}),
        }), max_items=48),
    }),
    'REFRACTION': obj({
        'measurements': array(obj({
            'id': ULID,
            'stage': enum('refraction_measurements.stage'),
            'eye': enum('refraction_measurements.eye'),
            'sphere': N_DIOPTER,
            'cylinder': N_DIOPTER,
            'axis': AXIS,
            'addition': N_DIOPTER,
        }), max_items=6),
        'refraction_observations': N_TEXT,
        'ametropias': array(TERM, max_items=20),
    }),
    'CENTERING': obj({
        'centering_id': N_ULID,
        'pd_total': N_DIOPTER,
        'pd_od': N_DIOPTER,
        'pd_og': N_DIOPTER,
        'inconsistency_reason': N_TEXT,
    }),
    # Médicaments prescrits (DP §9) : lignes ordonnées (la position est celle de la liste), saisie libre contrôlée,
    # aucune posologie déduite. Rubrique de la consultation, donc figée par la finalisation et corrigée par révision.
    'MEDICATIONS': obj({
        'orders': array(obj({
            'id': ULID,
            'catalog_item_id': N_ULID,
            'name': text(180),
            'form': enum('medication_orders.form'),
            'form_other': nullable(text(100)),
            'strength': nullable(text(100)),
            'dosage': N_TEXT,
            'frequency': nullable(text(180)),
            'duration_text': nullable(text(180)),
            'duration_value': nullable(integer(1, 4294967295)),
            'duration_unit': nullable(enum('medication_orders.duration_unit')),
            'instructions': N_TEXT,
        }), max_items=20),
    }),
    'CONCLUSION': obj({
        'conclusion': N_TEXT,
        'referral': nullable(boolean()),
        'referral_urgency': nullable(enum('consultations.referral_urgency')),
        'referral_reasons': array(TERM, max_items=20),
    }),
}


STEP_DEFS = {'ANAMNESIS': 'Anamnesis', 'HISTORIES': 'Histories', 'VISUAL_ACUITY': 'VisualAcuity', 'REFRACTION': 'Refraction',
             'CENTERING': 'Centering', 'MEDICATIONS': 'Medications', 'CONCLUSION': 'Conclusion'}


def clinical_steps_schema():
    """Données des rubriques du dossier (modèle DP), partagées par les commandes, les réponses et le snapshot
    de révision clinique (contracts/schemas/clinical-steps.json)."""
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': 'https://eeo.invalid/contracts/schemas/clinical-steps.json',
        'title': 'Rubriques cliniques du dossier (modèle DP)',
        'description': 'Valeurs non mesurées à null (jamais zéro par défaut), mesures en chaînes décimales exactes, termes du référentiel clinical_terms. Généré par contracts/tools/build_commands.py : ne pas modifier à la main.',
        '$defs': {
            **{STEP_DEFS[name]: copy.deepcopy(schema) for name, schema in CLINICAL_STEPS.items()},
            'StepName': {'type': 'string', 'enum': list(CLINICAL_STEPS)},
            'AllSteps': obj({name: {'$ref': '#/$defs/' + STEP_DEFS[name]} for name in CLINICAL_STEPS}),
        },
    }


def clinical_step():
    return {
        'type': 'object',
        'additionalProperties': False,
        'required': ['step', 'data'],
        'properties': {'step': {'$ref': STEPS + 'StepName'}, 'data': {'type': 'object'}},
        'allOf': [
            {'if': {'properties': {'step': {'const': name}}, 'required': ['step']}, 'then': {'properties': {'data': {'$ref': STEPS + STEP_DEFS[name]}}}}
            for name in CLINICAL_STEPS
        ],
    }


PATIENT_FIELDS = {
    'last_name': text(120),
    'first_names': nullable(text(180)),
    'sex': enum('patient_records.sex'),
    'birth_date': N_DATE,
    'birth_date_missing_reason': nullable(text(255)),
    'phone_primary': nullable(ref('Phone')),
    'phone_secondary': nullable(ref('Phone')),
    'phone_missing_reason': nullable(text(255)),
    'address': N_TEXT,
    'profession': nullable(text(180)),
    'guardian_contact': nullable({'type': 'object', 'additionalProperties': False, 'maxProperties': 3,
                                  'properties': {'name': text(180), 'relationship': text(80), 'phone': text(32)},
                                  'description': 'Contact du responsable d’un mineur (extension facultative) : nom, lien, téléphone ; rien d’autre.'}),
}

def kind(value):
    return {'type': 'string', 'const': value}


# Contenu EXACT d'une opération soumise à approbation (B06) : le serveur en dérive le code d'action, la cible et
# l'empreinte (payload_hash = SHA-256 du JSON canonique), et recalcule le même contenu depuis la commande approuvée au
# moment de la consommer. Identifiants et montants seulement ; aucun texte de motif, aucune donnée clinique.
APPROVAL_SUBJECTS = {
    'ExamFeeWaiverSubject': obj({'kind': kind('EXAM_FEE_WAIVER'), 'visit_id': ULID, 'patient_id': ULID},
        {'description': 'Dispense des frais d\'examen d\'UNE visite de CE patient (action exam_fee.collect, cible visits).'}),
    'DraftLineRightsSubject': obj({'kind': kind('DRAFT_LINE_RIGHTS'), 'invoice_id': ULID, 'patient_id': ULID,
        'lines': array(obj({'position': integer(1, 999), 'catalog_item_id': N_ULID, 'description': text(500), 'quantity': QUANTITY,
                            'unit_price_gross': MONEY, 'discount_gross': MONEY, 'prescription_id': N_ULID}), min_items=1, max_items=200)},
        {'description': 'Prix hors catalogue, ligne libre ou remise au-delà du plafond : TOUTES les lignes du brouillon telles qu\'elles seront enregistrées, sans leurs identifiants (action catalog.manage, cible invoices ; le brouillon peut ne pas encore exister).'}),
    'PaymentReversalSubject': obj({'kind': kind('PAYMENT_REVERSAL'), 'invoice_id': ULID, 'payment_id': ULID, 'amount': POSITIVE_MONEY},
        {'description': 'Contre-écriture d\'un paiement (action payment.reverse, cible payments).'}),
    'CreditNoteSubject': obj({'kind': kind('CREDIT_NOTE'), 'invoice_id': ULID, 'amount_gross': POSITIVE_MONEY,
        'lines': array(obj({'invoice_line_id': ULID, 'quantity': nullable(QUANTITY), 'amount_gross': POSITIVE_MONEY}), min_items=1, max_items=200)},
        {'description': 'Avoir lié aux lignes d\'origine (action credit_note.issue, cible invoices).'}),
    'RefundSubject': obj({'kind': kind('REFUND'), 'invoice_id': ULID, 'credit_note_id': ULID, 'amount': POSITIVE_MONEY, 'method': enum('refunds.method')},
        {'description': 'Remboursement d\'un crédit (action refund.execute, cible invoices).'}),
    'CreditDeliverySubject': obj({'kind': kind('CREDIT_DELIVERY'), 'invoice_id': ULID, 'amount_due': POSITIVE_MONEY,
        'lines': array(obj({'invoice_line_id': ULID, 'quantity': QUANTITY}), min_items=1, max_items=200)},
        {'description': 'Remise au patient d\'une facture non soldée : reste dû à l\'instant de la demande et quantités remises par ligne d\'origine (une entrée par ligne, cumul de la remise) ; un encaissement intervenu entre-temps exige une nouvelle demande (action delivery.confirm, cible invoices).'}),
    'StockMovementSubject': obj({'kind': kind('STOCK_MOVEMENT'), 'position_id': ULID, 'item_id': ULID, 'lot_id': N_ULID,
        'movement_kind': {'type': 'string', 'enum': ['BREAKAGE', 'ADJUSTMENT']}, 'signed_quantity': NON_ZERO_SIGNED_QUANTITY},
        {'description': 'Casse ou ajustement de stock : position, article, lot, nature et quantité signée exactes (action stock.adjust, cible stock_positions).'}),
    'CashMovementSubject': obj({'kind': kind('CASH_MOVEMENT'), 'cash_session_id': ULID,
        'movement_kind': {'type': 'string', 'enum': ['DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'OPENING_CORRECTION']},
        'signed_amount': {'type': 'integer', 'minimum': -1000000000000, 'maximum': 1000000000000, 'not': {'const': 0}},
        'expense_category_id': N_ULID},
        {'description': 'Mouvement d\'espèces hors vente d\'une session ouverte : nature, montant signé (entrée positive, sortie négative) et catégorie de la dépense exacts (action cash.manage, cible cash_sessions).'}),
    'CampaignSendSubject': obj({'kind': kind('CAMPAIGN_SEND'), 'campaign_id': ULID, 'segment_id': ULID,
        'template_version_id': ULID, 'eligible_count': integer(1, 1000000)},
        {'description': 'Gel et envoi d\'une campagne de communication vers un segment avec version de modèle approuvée et effectif exact (action communication.manage, cible campaign_definitions).'}),
}

APPROVAL_SUBJECT = {'description': 'Contenu exact de l\'opération à approuver ; la nature (kind) fixe l\'action, la cible et les champs.',
                    'oneOf': [{'$ref': '#/$defs/' + name} for name in APPROVAL_SUBJECTS]}

# Définitions supplémentaires d'un fichier de commande (référencées par la charge et par les ressources).
EXTRA_DEFS = {
    'RequestApproval': {'ApprovalSubject': APPROVAL_SUBJECT, **APPROVAL_SUBJECTS},
}

# nom : (entité, permission, version attendue, route directe, description, propriétés, règles supplémentaires)
COMMANDS = {
    'CreatePatient': ('patient_records', 'patient.create', 'none', 'POST /patients',
        'Identité durable : numéro de dossier pris dans la plage du poste (ou numéro central en ligne), téléphone non unique, naissance absente justifiée.',
        {'patient_id': ULID, 'record_number_usage_id': ULID, 'record_number': text(64), **PATIENT_FIELDS,
         'legacy_record': boolean(), 'first_known_visit_on': N_DATE, 'first_visit_certified': boolean(), 'legacy_record_number': nullable(text(64))},
        [require_when_null('birth_date', 'birth_date_missing_reason'), require_when_null('phone_primary', 'phone_missing_reason')]),
    'UpdatePatient': ('patient_records', 'patient.update', 'entity', 'PATCH /patients/{id}',
        'Modification d\'identité avec version attendue ; jamais de dernier écrit gagnant (conflit conservé).',
        {'patient_id': ULID, 'changes': {'type': 'object', 'additionalProperties': False, 'minProperties': 1, 'properties': PATIENT_FIELDS}},
        []),
    'RegisterVisit': ('visits', 'visit.register', 'none', 'POST /visits',
        'Arrivée du patient ; un achat direct sans examen est admis.',
        {'visit_id': ULID, 'patient_id': ULID, 'reason': enum('visits.reason'), 'occurred_at': INSTANT, 'appointment_id': N_ULID, 'administrative_note': N_TEXT},
        []),
    'StartConsultation': ('consultations', 'clinical.write', 'none', 'POST /visits/{id}/consultations',
        'Démarrage d\'examen. La pièce de frais de CETTE visite et la dispense exacte de la gérante sont facultatives au contrat : '
        'contrôle inactif (EEO_EXAM_FEE_CONTROL=off, défaut), le serveur ne contrôle aucune preuve et le dit (NOT_CONTROLLED) ; '
        'contrôle actif (billed), c\'est le serveur, non le schéma, qui exige la facture de frais réglée ou la dispense accordée '
        '(retrouvée par son contenu exact quand exam_waiver_approval_id est null).',
        {'consultation_id': ULID, 'visit_id': ULID, 'patient_id': ULID, 'effective_at': INSTANT, 'date_change_reason': N_TEXT,
         'exam_invoice_id': N_ULID, 'exam_waiver_approval_id': N_ULID},
        []),
    'SaveClinicalStep': ('consultations', 'clinical.write', 'entity', 'PATCH /consultations/{id}/steps/{step}',
        'Saisie d\'une rubrique DP ; valeurs non mesurées conservées à null ; lignes identifiées par le poste.',
        {'consultation_id': ULID, 'step': clinical_step()},
        []),
    'CompleteConsultation': ('consultations', 'clinical.complete', 'entity', 'POST /consultations/{id}/complete',
        'Finalisation : snapshot complet et révision 1 dans la même transaction ; empreinte recalculée par le serveur.',
        {'consultation_id': ULID, 'revision_id': ULID, 'revision_no': integer(1, 1), 'snapshot_sha256': ref('Sha256Hex'), 'finalization_missing_data_reason': N_TEXT},
        []),
    'AmendConsultation': ('consultations', 'clinical.amend', 'entity', 'POST /consultations/{id}/amendments',
        'Correction motivée : nouvelle révision immuable, révisions antérieures intactes.',
        {'consultation_id': ULID, 'revision_id': ULID, 'revision_no': integer(2), 'previous_revision_id': ULID, 'reason': REASON,
         'steps': array(clinical_step(), min_items=1, max_items=7), 'snapshot_sha256': ref('Sha256Hex')},
        []),
    'CreatePrescription': ('optical_prescriptions', 'clinical.write', 'none', 'POST /consultations/{id}/prescriptions',
        'Prescription interne (consultation) ou transcription d\'une ordonnance externe identifiée (A13) ; aucune prescription produite automatiquement.',
        {'prescription_id': ULID, 'series_id': ULID, 'version_no': integer(1), 'supersedes_id': N_ULID, 'patient_id': ULID,
         'origin': enum('optical_prescriptions.origin'), 'consultation_id': N_ULID,
         'external_prescriber': nullable(text(180)), 'external_prescribed_on': N_DATE, 'external_file_id': N_ULID,
         'usage_code': nullable(ref('Code')), 'usage_other': N_TEXT, 'lens_type_code': nullable(ref('Code')), 'lens_type_other': N_TEXT,
         'lens_index': nullable({'type': 'string', 'pattern': '^[0-9]\\.[0-9]{1,2}$'}), 'lens_index_other': N_TEXT,
         'pd_total': N_DIOPTER, 'pd_od': N_DIOPTER, 'pd_og': N_DIOPTER, 'pd_inconsistency_reason': N_TEXT, 'notes': N_TEXT,
         'eyes': array(obj({'id': ULID, 'eye': enum('optical_prescription_eyes.eye'), 'no_correction': boolean(),
                            'sphere': N_DIOPTER, 'cylinder': N_DIOPTER, 'axis': AXIS, 'addition': N_DIOPTER, 'fitting_height': N_DIOPTER}),
                       min_items=2, max_items=2),
         'treatments': array(TERM, max_items=20)},
        [require_when_const('origin', 'INTERNAL', 'consultation_id', ULID),
         require_when_const('origin', 'EXTERNAL', 'external_prescriber'),
         require_when_const('origin', 'EXTERNAL', 'external_prescribed_on', ref('CivilDate'))]),
    'ValidatePrescription': ('optical_prescriptions', 'clinical.complete', 'state', 'POST /prescriptions/{id}/validate',
        'Validation explicite par le professionnel : version immuable, document PDF préparé (PENDING).',
        {'prescription_id': ULID, 'document_id': ULID},
        []),
    'CreateInvoiceDraft': ('invoices', 'invoice.create', 'none', 'POST /invoices',
        'Brouillon de facture : lignes identifiées par le poste ; prix et remises soumis aux droits.',
        {'invoice_id': ULID, 'patient_id': ULID, 'visit_id': N_ULID, 'due_date': N_DATE, 'lines': array(INVOICE_LINE, min_items=0, max_items=200)},
        []),
    'UpdateDraft': ('invoices', 'invoice.create', 'draft', 'PATCH /invoices/{id}',
        'Modification du brouillon (version brouillon attendue) : la liste de lignes remplace la précédente.',
        {'invoice_id': ULID, 'visit_id': N_ULID, 'due_date': N_DATE, 'lines': array(INVOICE_LINE, min_items=0, max_items=200)},
        []),
    'IssueInvoice': ('invoices', 'invoice.issue', 'draft', 'POST /invoices/{id}/issue',
        'Émission : numéro de la plage du poste, snapshots, réserves de stock (I00) et propriété locale dans la même transaction ; la facture émise n\'est plus jamais modifiée.',
        {'invoice_id': ULID, 'number_usage_id': ULID, 'number': text(64), 'issued_at': INSTANT, 'total_gross': MONEY,
         'write_owner_id': N_ULID, 'catalog_snapshot_sha256': ref('Sha256Hex'), 'reservations': array(RESERVATION, max_items=200),
         'document_id': ULID},
        []),
    'RegisterPayment': ('invoices', 'payment.collect', 'ledger', 'POST /invoices/{id}/payments',
        'Encaissement : montant ≤ solde verrouillé, paiement confirmé puis reçu numéroté unique dans la même transaction ; le PDF suit le commit (document PENDING).',
        {'invoice_id': ULID, 'payment_id': ULID, 'receipt_id': ULID, 'receipt_number_usage_id': ULID, 'receipt_number': text(64),
         'amount': POSITIVE_MONEY, 'currency': ref('Currency'), 'method': enum('payments.method'), 'reference': nullable(text(180)),
         'effective_at': INSTANT, 'cash_session_id': N_ULID, 'retroactive_reason': N_TEXT, 'receipt_document_id': ULID},
        [require_when_const('method', 'CASH', 'cash_session_id', ULID)]),
    'ReversePayment': ('invoices', 'payment.reverse', 'ledger', 'POST /payments/{id}/reversals',
        'Contre-écriture d\'une erreur comptable : cumul ≤ original, approbation gérante exacte, original conservé.',
        {'invoice_id': ULID, 'payment_id': ULID, 'reversal_id': ULID, 'amount': POSITIVE_MONEY, 'reason': REASON, 'approval_id': ULID},
        []),
    'IssueCreditNote': ('invoices', 'credit_note.issue', 'ledger', 'POST /invoices/{id}/credit-notes',
        'Avoir lié aux lignes d\'origine : cumuls ≤ lignes, approbation consommée une fois ; enfants écrits avant l\'émission.',
        {'invoice_id': ULID, 'credit_note_id': ULID, 'number_usage_id': ULID, 'number': text(64), 'amount_gross': POSITIVE_MONEY,
         'reason': REASON, 'approval_id': ULID, 'document_id': ULID,
         'lines': array(obj({'credit_note_line_id': ULID, 'invoice_line_id': ULID, 'quantity': nullable(QUANTITY),
                             'amount_gross': POSITIVE_MONEY, 'reason': N_TEXT}), min_items=1, max_items=200)},
        []),
    'RefundCredit': ('invoices', 'refund.execute', 'ledger', 'POST /invoices/{id}/refunds',
        'Remboursement d\'un crédit disponible : pièce numérotée, approbation exacte, session de caisse si espèces.',
        {'invoice_id': ULID, 'refund_id': ULID, 'credit_note_id': ULID, 'number_usage_id': ULID, 'number': text(64),
         'amount': POSITIVE_MONEY, 'method': enum('refunds.method'), 'reference': nullable(text(180)), 'approval_id': ULID,
         'effective_at': INSTANT, 'cash_session_id': N_ULID, 'document_id': ULID},
        [require_when_const('method', 'CASH', 'cash_session_id', ULID)]),
    'OpenCashSession': ('cash_sessions', 'cash.own_session', 'none', 'POST /cash-sessions',
        'Ouverture de session : une seule session ouverte par caisse et par caissière.',
        {'cash_session_id': ULID, 'cash_register_id': ULID, 'opening_amount': MONEY, 'opened_at': INSTANT},
        []),
    'CloseCashSession': ('cash_sessions', 'cash.own_session', 'state', 'POST /cash-sessions/{id}/close',
        'Clôture : montant compté, attendu recalculé par le serveur, écart motivé ; session close immuable.',
        {'cash_session_id': ULID, 'closed_at': INSTANT, 'counted_amount': MONEY, 'expected_amount': MONEY,
         'variance': ref('SignedMoneyXaf'), 'variance_reason': N_TEXT},
        []),
    'ConfirmDelivery': ('deliveries', 'delivery.confirm', 'none', 'POST /invoices/{id}/deliveries',
        'Remise liée à la vente : quantités non remises, lot vendable non expiré au jour local, approbation si dette.',
        {'delivery_id': ULID, 'invoice_id': ULID, 'delivered_at': INSTANT, 'credit_delivery_approval_id': N_ULID,
         'lines': array(obj({'delivery_line_id': ULID, 'invoice_line_id': ULID, 'item_id': ULID, 'quantity': QUANTITY,
                             'stock_position_id': N_ULID, 'stock_lot_id': N_ULID, 'reservation_id': N_ULID, 'stock_movement_id': N_ULID}),
                        min_items=1, max_items=200)},
        []),
    'RegisterPhysicalReturn': ('physical_returns', 'stock.adjust', 'none', 'POST /deliveries/{id}/physical-returns',
        'Retour physique ≤ quantité remise non retournée, inspection et destination justifiées ; un avoir seul n\'augmente jamais le stock.',
        {'physical_return_id': ULID, 'delivery_line_id': ULID, 'item_id': ULID, 'quantity': QUANTITY,
         'condition_code': enum('physical_returns.condition_code'), 'accepted_for_restock': boolean(), 'approved_by': ULID,
         'occurred_at': INSTANT, 'reason': REASON, 'credit_note_id': N_ULID, 'stock_movement_id': N_ULID},
        []),
    'RegisterStockMovement': ('stock_movements', 'stock.adjust', 'none', 'POST /stock/movements',
        'Mouvement hors vente (casse, ajustement) avec motif et approbation hors vente (CHECK de stock_movements). Le stock initial passe par POST /stock/opening (I00), les sorties de vente par ConfirmDelivery, les retours par RegisterPhysicalReturn.',
        {'movement_id': ULID, 'item_id': ULID, 'position_id': ULID, 'lot_id': N_ULID,
         'kind': {'type': 'string', 'enum': ['BREAKAGE', 'ADJUSTMENT']}, 'signed_quantity': NON_ZERO_SIGNED_QUANTITY,
         'unit_cost': nullable(MONEY), 'approval_id': ULID, 'reason': REASON, 'occurred_at': INSTANT},
        [require_when_const('kind', 'BREAKAGE', 'signed_quantity', {'type': 'string', 'pattern': '^-'})]),
    'CreateFollowUp': ('follow_up_plans', 'follow_up.write', 'none', 'POST /follow-ups',
        'Contrôle recommandé : date calculée ou saisie par le professionnel (Q09), rappel interne ; aucun envoi externe.',
        {'follow_up_plan_id': ULID, 'consultation_id': ULID, 'patient_id': ULID, 'reason': enum('follow_up_plans.reason'),
         'anchor_kind': enum('follow_up_plans.anchor_kind'), 'anchor_date': ref('CivilDate'),
         'interval_value': nullable(integer(1, 1200)), 'interval_unit': nullable(enum('follow_up_plans.interval_unit')),
         'recommended_date': ref('CivilDate'), 'date_origin': enum('follow_up_plans.date_origin'), 'manual_reason': N_TEXT,
         'reminder_enabled': boolean(), 'preferred_channel': enum('follow_up_plans.preferred_channel'),
         'advance_value': nullable(integer(0, 365)), 'advance_unit': nullable(enum('follow_up_plans.advance_unit')), 'notes': N_TEXT},
        [require_when_const('date_origin', 'MANUAL', 'manual_reason')]),
    'CreateAppointment': ('appointments', 'agenda.write', 'none', 'POST /appointments',
        'Rendez-vous interne ; pris hors-ligne il reste « à confirmer » jusqu\'à validation serveur.',
        {'appointment_id': ULID, 'patient_id': N_ULID, 'prospect_contact_id': N_ULID, 'follow_up_id': N_ULID,
         'resource_id': ULID, 'service_id': ULID, 'starts_at': INSTANT, 'ends_at': INSTANT, 'administrative_reason': N_TEXT},
        [{'anyOf': [{'properties': {'patient_id': ULID}}, {'properties': {'prospect_contact_id': ULID}}]}]),
    'RecordContactAttempt': ('contact_tasks', 'agenda.write', 'entity', 'POST /contact-tasks/{id}/attempts',
        'Tentative de contact interne historisée et prochain état explicite.',
        {'attempt_id': ULID, 'task_id': ULID, 'occurred_at': INSTANT, 'result': enum('contact_attempts.result'),
         'appointment_id': N_ULID, 'administrative_note': N_TEXT, 'next_status': enum('contact_tasks.status'), 'next_attempt_at': ref('NullableInstant')},
        []),
    'RequestApproval': ('approvals', 'approval.request', 'none', 'POST /approvals',
        'Demande d\'autorisation liée au contenu exact de l\'opération (subject) : le serveur en dérive l\'action, la cible et '
        'l\'empreinte (payload_hash), jamais fournies par le client ; échéance proposée facultative, raccourcie par la décision.',
        {'approval_id': ULID, 'subject': {'$ref': '#/$defs/ApprovalSubject'}, 'reason': REASON, 'expires_at': ref('NullableInstant')},
        []),
    'DecideApproval': ('approvals', 'approval.decide', 'state', 'POST /approvals/{id}/decision',
        'Décision de la gérante présente (profil préparé ou réauthentification en ligne), consommable une fois.',
        {'approval_id': ULID, 'decision': {'type': 'string', 'enum': ['APPROVED', 'REFUSED']}, 'reason': N_TEXT},
        []),
}

EXPECTED_VERSION = {
    'none': 'Création : expected_version vaut null.',
    'entity': 'Version de l\'agrégat (colonne version).',
    'state': 'Transition d\'état contrôlée sous verrou (statut attendu vérifié par le serveur) ; la table n\'a pas de colonne version, que le contrat 23 interdit d\'inventer : expected_version vaut null.',
    'draft': 'Version du brouillon (invoices.version), figée à l\'émission.',
    'ledger': 'ledger_version dérivée : 1 + paiements confirmés + contre-écritures + avoirs émis + remboursements (contrat 23).',
}

# Champ de la charge qui porte core.entity_id (même valeur, vérifiée par le serveur : JSON Schema ne
# compare pas deux champs entre eux).
ENTITY_ID_FIELD = {
    'CreatePatient': 'patient_id', 'UpdatePatient': 'patient_id', 'RegisterVisit': 'visit_id',
    'StartConsultation': 'consultation_id', 'SaveClinicalStep': 'consultation_id', 'CompleteConsultation': 'consultation_id',
    'AmendConsultation': 'consultation_id', 'CreatePrescription': 'prescription_id', 'ValidatePrescription': 'prescription_id',
    'CreateInvoiceDraft': 'invoice_id', 'UpdateDraft': 'invoice_id', 'IssueInvoice': 'invoice_id',
    'RegisterPayment': 'invoice_id', 'ReversePayment': 'invoice_id', 'IssueCreditNote': 'invoice_id', 'RefundCredit': 'invoice_id',
    'OpenCashSession': 'cash_session_id', 'CloseCashSession': 'cash_session_id',
    'ConfirmDelivery': 'delivery_id', 'RegisterPhysicalReturn': 'physical_return_id', 'RegisterStockMovement': 'movement_id',
    'CreateFollowUp': 'follow_up_plan_id', 'CreateAppointment': 'appointment_id', 'RecordContactAttempt': 'task_id',
    'RequestApproval': 'approval_id', 'DecideApproval': 'approval_id',
}

# Numéro de pièce consommé dans la plage du poste (document_number_allocations.document_type) :
# (type, champ de l'usage document_number_usages, champ du numéro rendu). Par le journal local, le
# numéro vient de la plage signée (core.number_allocation_id obligatoire) ; par la route directe, le
# serveur attribue un numéro central hors plages réservées : le numéro rendu vaut alors null dans la
# requête, l'identifiant de l'usage reste fourni par le client (idempotence, fichier 08).
NUMBERED = {
    'CreatePatient': ('PATIENT', 'record_number_usage_id', 'record_number'),
    'IssueInvoice': ('INVOICE', 'number_usage_id', 'number'),
    'RegisterPayment': ('RECEIPT', 'receipt_number_usage_id', 'receipt_number'),
    'IssueCreditNote': ('CREDIT_NOTE', 'number_usage_id', 'number'),
    'RefundCredit': ('REFUND', 'number_usage_id', 'number'),
}

SCHEMA_VERSION = '1'


def build_command(name, spec):
    entity, permission, version_kind, route, description, properties, rules = spec
    payload = obj(copy.deepcopy(properties))
    if rules:
        payload['allOf'] = copy.deepcopy(rules)
    version_schema = {'type': 'null'} if version_kind in ('none', 'state') else ref('Version')
    direct_properties = {'expected_version': version_schema, **copy.deepcopy(properties)}
    numbered = NUMBERED.get(name)
    if numbered:
        direct_properties[numbered[2]] = {'description': 'Numéro central attribué par le serveur sous verrou : null dans la requête directe.', 'type': 'null'}
    direct = obj(direct_properties)
    if rules:
        direct['allOf'] = copy.deepcopy(rules)
    annotations = {
        'x-entity-type': entity,
        'x-entity-id-field': ENTITY_ID_FIELD[name],
        'x-permission': permission,
        'x-expected-version': version_kind,
        'x-direct-route': route,
    }
    if numbered:
        annotations['x-number-type'] = numbered[0]
    schema = {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': BASE + name + '.v' + SCHEMA_VERSION + '.json',
        'title': name + ' (charge v' + SCHEMA_VERSION + ')',
        'description': description + ' Généré par contracts/tools/build_commands.py : ne pas modifier à la main.',
        **annotations,
        **payload,
        '$defs': {'DirectRequest': {'description': 'Corps de la route directe ' + route + ' : même charge + expected_version (' + EXPECTED_VERSION[version_kind] + ') ; en-tête Idempotency-Key obligatoire.', **direct},
                  **copy.deepcopy(EXTRA_DEFS.get(name, {}))},
    }
    return schema


def build_dispatch():
    """Cohérence du cœur signé : la charge, la version de schéma, l'entité, la version attendue et la
    plage de numéros correspondent à command_name (référencé par sync/command-core.json)."""
    rules = []
    for name, spec in COMMANDS.items():
        entity, _permission, version_kind, *_ = spec
        then = {
            'schema_version': {'const': SCHEMA_VERSION},
            'entity_type': {'const': entity},
            'expected_version': {'type': 'null'} if version_kind in ('none', 'state') else ref('Version'),
            'number_allocation_id': ULID if name in NUMBERED else {'type': 'null'},
            'payload': {'$ref': name + '.v' + SCHEMA_VERSION + '.json'},
        }
        rules.append({'if': {'properties': {'command_name': {'const': name}}, 'required': ['command_name']}, 'then': {'properties': then}})
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': BASE + 'dispatch.json',
        'title': 'Correspondance command_name → charge, schéma, entité, version attendue et plage',
        'description': 'Appliqué au cœur des commandes signées (sync/command-core.json). core.entity_id doit en outre égaler le champ x-entity-id-field de la charge (contrôle serveur). Généré par contracts/tools/build_commands.py : ne pas modifier à la main.',
        'type': 'object',
        'properties': {'command_name': {'$ref': '#/$defs/CommandName'}},
        'allOf': rules,
        '$defs': {'CommandName': {
            'description': 'Commandes disponibles dans le journal local (actions du fichier 08 jouables hors-ligne).',
            'type': 'string',
            'enum': list(COMMANDS),
        }},
    }


def build():
    missing = sorted(set(COMMANDS) ^ set(ENTITY_ID_FIELD))
    if missing:
        raise SystemExit('ECHEC : champ entity_id non défini ou en trop pour ' + str(missing))
    files = {}
    index = {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': BASE + 'index.json',
             'title': 'Index des commandes du journal local',
             'description': 'Généré par contracts/tools/build_commands.py : ne pas modifier à la main.',
             'const': {}}
    for name, spec in COMMANDS.items():
        schema = build_command(name, spec)
        field = ENTITY_ID_FIELD[name]
        if field not in schema['required']:
            raise SystemExit('ECHEC : ' + name + ' ne porte pas son champ entity_id ' + field)
        files[name + '.v' + SCHEMA_VERSION + '.json'] = schema
        entity, permission, version_kind, route, *_ = spec
        numbered = NUMBERED.get(name)
        index['const'][name] = {'schema': 'commands/' + name + '.v' + SCHEMA_VERSION + '.json', 'schema_version': SCHEMA_VERSION,
                                'entity_type': entity, 'entity_id_field': field, 'permission': permission,
                                'expected_version': version_kind, 'direct_route': route,
                                'number_type': numbered[0] if numbered else None}
    files['index.json'] = index
    files['dispatch.json'] = build_dispatch()
    return files


def relocate(schema, prefix_from, prefix_to):
    """Réécrit les $ref d'un schéma déplacé de contracts/commands/ vers contracts/schemas/."""
    if isinstance(schema, dict):
        return {key: (value.replace(prefix_from, prefix_to, 1) if key == '$ref' and isinstance(value, str) else relocate(value, prefix_from, prefix_to))
                for key, value in schema.items()}
    if isinstance(schema, list):
        return [relocate(item, prefix_from, prefix_to) for item in schema]
    return schema


def main():
    files = {name: (OUT / name, schema) for name, schema in build().items()}
    steps = relocate(clinical_steps_schema(), '../schemas/', '')
    files['../schemas/clinical-steps.json'] = (ROOT / 'contracts' / 'schemas' / 'clinical-steps.json', steps)
    check = '--check' in sys.argv
    stale = []
    for name, (path, schema) in files.items():
        text = json.dumps(schema, ensure_ascii=False, indent=2) + '\n'
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                stale.append(name)
        else:
            path.write_text(text, encoding='utf-8')
    if check:
        extra = sorted(p.name for p in OUT.glob('*.json') if p.name not in files)
        if stale or extra:
            print('ECHEC : contrats de commandes périmés ' + str(stale) + ' ou en trop ' + str(extra) + ' : relancer contracts/tools/build_commands.py', file=sys.stderr)
            sys.exit(1)
        print('Contrats de commandes à jour : ' + str(len(COMMANDS)) + ' commandes.')
        return
    print(str(len(COMMANDS)) + ' commandes écrites dans contracts/commands/ (+ index.json, dispatch.json)')


if __name__ == '__main__':
    main()

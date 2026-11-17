"""Événements internes versionnés (fichier 08, « Événements internes ») : enveloppe et charges minimales (F06).

Produit contracts/events/envelope.json (enveloppe commune, correspondance event_type → charge) et
contracts/events/<Type>.v1.json pour les 13 événements de la version 1, depuis cette source unique.

Règles de contrat :
  - l'enveloppe reprend les champs du fichier 08 ; elle correspond à outbox_events (event_id = id,
    aggregate_type/aggregate_id/aggregate_version = source_type/source_id/source_version,
    occurred_at = created_at) ;
  - la charge est minimale : identifiants et attributs administratifs nécessaires au traitement ; jamais
    de snapshot clinique, de mesure, d'antécédent, de motif clinique ni de coordonnées patient (un
    consommateur autorisé relit la source par l'API, avec ses propres droits) ;
  - montants en entiers XAF, quantités en chaînes décimales, instants UTC à la milliseconde.

  python3 contracts/tools/build_events.py          # écrit les fichiers
  python3 contracts/tools/build_events.py --check  # échoue si un fichier est absent ou périmé (CI)
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'contracts' / 'events'
BASE = 'https://eeo.invalid/contracts/events/'
C = '../schemas/common.json#/$defs/'
E = '../schemas/enums.json#/$defs/'
VERSION = 1


def ref(name):
    return {'$ref': C + name}


def enum(column):
    return {'$ref': E + column}


def nullable(schema):
    return {'anyOf': [schema, {'type': 'null'}]}


def obj(properties):
    return {'type': 'object', 'additionalProperties': False, 'required': list(properties), 'properties': properties}


ULID = ref('Ulid')
N_ULID = ref('NullableUlid')
INSTANT = ref('Instant')
MONEY = ref('MoneyXaf')

# type : (agrégat source, description, propriétés de la charge)
EVENTS = {
    'PatientCreated': ('patient_records', 'Dossier créé (en ligne ou par synchronisation d\'une commande locale).',
        {'patient_id': ULID, 'record_number': {'type': 'string', 'minLength': 1, 'maxLength': 64},
         'legacy_record': {'type': 'boolean'}, 'source_device_id': N_ULID}),
    'ConsultationCompleted': ('consultations', 'Consultation finalisée : révision 1 immuable écrite (aucune donnée clinique dans la charge).',
        {'consultation_id': ULID, 'patient_id': ULID, 'visit_id': ULID, 'revision_id': ULID,
         'revision_no': {'type': 'integer', 'minimum': 1}, 'completed_at': INSTANT}),
    'PrescriptionValidated': ('optical_prescriptions', 'Prescription validée par le professionnel ; document préparé.',
        {'prescription_id': ULID, 'patient_id': ULID, 'consultation_id': N_ULID, 'origin': enum('optical_prescriptions.origin'),
         'version_no': {'type': 'integer', 'minimum': 1}, 'validated_at': INSTANT, 'document_id': N_ULID}),
    'FollowUpScheduled': ('follow_up_plans', 'Contrôle recommandé enregistré : date et préférence de rappel, sans motif clinique.',
        {'follow_up_plan_id': ULID, 'patient_id': ULID, 'consultation_id': ULID, 'recommended_date': ref('CivilDate'),
         'reminder_enabled': {'type': 'boolean'}, 'preferred_channel': enum('follow_up_plans.preferred_channel')}),
    'AppointmentConfirmed': ('appointments', 'Rendez-vous confirmé par le serveur (un rendez-vous pris hors-ligne reste à confirmer).',
        {'appointment_id': ULID, 'patient_id': N_ULID, 'prospect_contact_id': N_ULID, 'resource_id': ULID, 'service_id': ULID,
         'starts_at': INSTANT, 'ends_at': INSTANT, 'source': enum('appointments.source')}),
    'AppointmentRescheduled': ('appointments', 'Rendez-vous déplacé : les rappels de l\'ancien créneau sont invalidés.',
        {'appointment_id': ULID, 'patient_id': N_ULID, 'prospect_contact_id': N_ULID, 'resource_id': ULID,
         'previous_starts_at': INSTANT, 'starts_at': INSTANT, 'ends_at': INSTANT}),
    'AppointmentCancelled': ('appointments', 'Rendez-vous annulé : rappels annulés, créneau libéré.',
        {'appointment_id': ULID, 'patient_id': N_ULID, 'prospect_contact_id': N_ULID, 'starts_at': INSTANT, 'cancelled_at': INSTANT}),
    'InvoiceIssued': ('invoices', 'Facture émise (numéro définitif, pièce immuable).',
        {'invoice_id': ULID, 'patient_id': ULID, 'number': {'type': 'string', 'minLength': 1, 'maxLength': 64},
         'issued_at': INSTANT, 'total_gross': MONEY, 'currency': ref('Currency'), 'source_device_id': N_ULID}),
    'PaymentConfirmed': ('invoices', 'Encaissement confirmé et reçu numéroté émis (agrégat : la facture, dont la version ledger avance).',
        {'payment_id': ULID, 'invoice_id': ULID, 'receipt_id': ULID, 'receipt_number': {'type': 'string', 'minLength': 1, 'maxLength': 64},
         'amount': ref('PositiveMoneyXaf'), 'currency': ref('Currency'), 'method': enum('payments.method'), 'effective_at': INSTANT}),
    'CreditNoteIssued': ('invoices', 'Avoir émis sur une facture (agrégat : la facture).',
        {'credit_note_id': ULID, 'invoice_id': ULID, 'number': {'type': 'string', 'minLength': 1, 'maxLength': 64},
         'amount_gross': ref('PositiveMoneyXaf'), 'currency': ref('Currency'), 'issued_at': INSTANT}),
    'DeliveryConfirmed': ('deliveries', 'Remise liée à une vente confirmée (sorties de stock écrites).',
        {'delivery_id': ULID, 'invoice_id': ULID, 'delivered_at': INSTANT, 'line_count': {'type': 'integer', 'minimum': 1}}),
    'StockThresholdCrossed': ('stock_alerts', 'Alerte de stock ouverte : seuil bas ou péremption proche.',
        {'stock_alert_id': ULID, 'item_id': ULID, 'location_id': ULID, 'lot_id': N_ULID, 'kind': enum('stock_alerts.kind'),
         'detected_at': INSTANT, 'due_on': ref('NullableCivilDate')}),
    'WorkshopReady': ('workshop_orders', 'Équipement prêt à remettre (atelier L1 ; contrat fixé dès la version 1).',
        {'workshop_order_id': ULID, 'patient_id': ULID, 'invoice_line_id': ULID, 'ready_revision': {'type': 'integer', 'minimum': 1},
         'ready_at': INSTANT}),
    'AppointmentNoShow': ('appointments', 'Rendez-vous marqué absent (L2) : aucune donnée clinique, relance administrative éventuelle.',
        {'appointment_id': ULID, 'patient_id': N_ULID, 'prospect_contact_id': N_ULID, 'starts_at': INSTANT, 'marked_at': INSTANT}),
    'PublicBookingRequested': ('public_booking_requests', 'Demande publique de rendez-vous enregistrée (L2) : référence publique uniquement.',
        {'booking_request_id': ULID, 'public_reference': {'type': 'string', 'minLength': 1, 'maxLength': 32}, 'service_id': ULID,
         'requested_starts_at': INSTANT, 'status': enum('public_booking_requests.status')}),
    'HumanHandoffRequested': ('conversation_handoffs', 'Demande ou prise en charge humaine d\'une conversation CRM/IA (L2).',
        {'handoff_id': ULID, 'conversation_id': ULID, 'lead_id': N_ULID, 'event_type': enum('conversation_handoffs.event_type'),
         'occurred_at': INSTANT}),
    'CampaignCompleted': ('campaign_definitions', 'Exécution d\'une campagne terminée ou arrêtée (L2).',
        {'campaign_id': ULID, 'status': enum('campaign_definitions.status'), 'completed_at': INSTANT}),
}


def build():
    files = {}
    rules = []
    for name, (aggregate, description, properties) in EVENTS.items():
        payload = obj(properties)
        files[name + '.v' + str(VERSION) + '.json'] = {
            '$schema': 'https://json-schema.org/draft/2020-12/schema',
            '$id': BASE + name + '.v' + str(VERSION) + '.json',
            'title': name + ' (charge v' + str(VERSION) + ')',
            'description': description + ' Généré par contracts/tools/build_events.py : ne pas modifier à la main.',
            'x-entity-type': aggregate,
            **payload,
        }
        rules.append({
            'if': {'properties': {'event_type': {'const': name}}, 'required': ['event_type']},
            'then': {'properties': {
                'event_version': {'const': VERSION},
                'aggregate_type': {'const': aggregate},
                'payload': {'$ref': name + '.v' + str(VERSION) + '.json'},
            }},
        })
    files['envelope.json'] = {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': BASE + 'envelope.json',
        'title': 'Enveloppe d\'un événement interne (fichier 08)',
        'description': 'Correspond à une ligne outbox_events : event_id = id, aggregate_type/aggregate_id/aggregate_version = source_type/source_id/source_version, occurred_at = created_at. Livraison au moins une fois, déduplication par event_id chez le consommateur. Généré par contracts/tools/build_events.py : ne pas modifier à la main.',
        'type': 'object',
        'additionalProperties': False,
        'required': ['event_id', 'event_type', 'event_version', 'clinic_id', 'occurred_at', 'aggregate_type', 'aggregate_id', 'aggregate_version', 'correlation_id', 'payload'],
        'properties': {
            'event_id': ULID,
            'event_type': {'$ref': '#/$defs/EventType'},
            'event_version': {'type': 'integer', 'minimum': 1, 'maximum': 65535},
            'clinic_id': ULID,
            'occurred_at': INSTANT,
            'aggregate_type': {'type': 'string', 'pattern': '^[a-z][a-z_]{1,63}$'},
            'aggregate_id': ULID,
            'aggregate_version': ref('Version'),
            'correlation_id': {'type': 'string', 'minLength': 8, 'maxLength': 100},
            'payload': {'type': 'object'},
        },
        'allOf': rules,
        '$defs': {'EventType': {
            'description': 'Événements de la version 1 (fichier 08).',
            'type': 'string',
            'enum': list(EVENTS),
        }},
    }
    return files


def main():
    files = build()
    check = '--check' in sys.argv
    stale = []
    OUT.mkdir(parents=True, exist_ok=True)
    for name, schema in files.items():
        text = json.dumps(schema, ensure_ascii=False, indent=2) + '\n'
        path = OUT / name
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                stale.append(name)
        else:
            path.write_text(text, encoding='utf-8')
    if check:
        extra = sorted(p.name for p in OUT.glob('*.json') if p.name not in files)
        if stale or extra:
            print('ECHEC : contrats d\'événements périmés ' + str(stale) + ' ou en trop ' + str(extra) + ' : relancer contracts/tools/build_events.py', file=sys.stderr)
            sys.exit(1)
        print('Contrats d\'événements à jour : ' + str(len(EVENTS)) + ' événements.')
        return
    print(str(len(EVENTS)) + ' événements écrits dans contracts/events/ (+ envelope.json)')


if __name__ == '__main__':
    main()

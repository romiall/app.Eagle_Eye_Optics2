"""Liste structurée des instructions SQL de la baseline, pour les migrations Laravel (F04).

Le contrat 23 demande des instructions explicites générées depuis la définition canonique,
plutôt qu'un parseur SQL maison :

- 01 tables et FK : rendues depuis schema_catalog.json avec les mêmes règles que build_model.py ;
- 04 guards : rendus depuis le catalogue avec les mêmes règles que history_guards.py,
  un CREATE TRIGGER complet par instruction, sans DELIMITER ;
- 02 référentiels et 03 vues : découpés seulement sur leurs frontières de génération
  (blocs séparés par une ligne vide), puis typés et comptés.

Dans tous les cas, la concaténation des instructions doit redonner octet pour octet le
fichier SQL validé (fins de ligne CRLF ramenées à LF). Toute divergence arrête le script.

Usage :
  python3 database/tools/build_migrations.py          # écrit database/baseline/statements.json
  python3 database/tools/build_migrations.py --check  # vérifie sans écrire (CI)
"""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / 'database'
TARGET = DB / 'baseline' / 'statements.json'
BACKLOG = ROOT / 'specifications' / 'developpement' / 'backlog.json'

# Session SQL des scripts livrés : 01_schema.sql la fixe, les triggers et vues en héritent
# lors de l'import du fichier complet. Les migrations appliquent exactement la même.
SESSION = {
    'names': 'utf8mb4',
    'collation': 'utf8mb4_0900_ai_ci',
    'time_zone': '+00:00',
    'sql_mode': 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY',
}


def fail(message):
    print('ECHEC : ' + message, file=sys.stderr)
    sys.exit(1)


def read_lf(name):
    raw = (DB / name).read_bytes()
    return raw.decode('utf-8').replace('\r\n', '\n')


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- Rendu identique à build_model.py, appliqué au catalogue déjà finalisé -------------
def q(x):
    return '`' + x + '`'


def qs(xs):
    return ', '.join(map(q, xs))


def esc(s):
    return str(s).replace("'", "''")


def cname(prefix, table, index):
    return f'{prefix}_{table}_{index:02d}'


def column_sql(col):
    out = q(col['name']) + ' ' + col['type']
    if col['generated']:
        out += ' GENERATED ALWAYS AS (' + col['generated'] + ') STORED'
    else:
        out += ' NULL' if col['nullable'] else ' NOT NULL'
        if col['default'] is not None:
            out += ' DEFAULT ' + col['default']
    if col['description']:
        out += " COMMENT '" + esc(col['description']) + "'"
    return out


HEADER_01 = """-- Eagle's Eye Optics Medical | Complete application schema | 2026-10-14
-- Target: MySQL 8.4 / InnoDB / utf8mb4. All domains are defined NOW.
-- Run on an EMPTY database selected by your client. No DROP, TRUNCATE or credentials.
-- No USE here: shared hosting database name is provided by its owner.
-- Installation order: 01_schema, 02_reference_data, 03_reporting_views, 04_history_guards.
-- Foreign keys are added after tables to handle the documented cyclic links.
-- Cross-row totals, permissions, cryptography and physical events still require app transactions.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY';

"""


def render_schema(tables):
    creates, alters, doc = [], [], [HEADER_01]
    for t in tables:
        elements = [column_sql(co) for co in t['columns']]
        elements.append('PRIMARY KEY (' + qs(t['primary']) + ')')
        for i, key in enumerate(t['unique'], 1):
            elements.append('UNIQUE KEY ' + q(cname('uq', t['name'], i)) + ' (' + qs(key) + ')')
        for i, key in enumerate(t['indexes'], 1):
            elements.append('KEY ' + q(cname('ix', t['name'], i)) + ' (' + qs(key) + ')')
        for i, expr in enumerate(t['checks'], 1):
            elements.append('CONSTRAINT ' + q(cname('ck', t['name'], i)) + ' CHECK (' + expr + ')')
        sql = ('CREATE TABLE ' + q(t['name']) + ' (\n  ' + ',\n  '.join(elements)
               + "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='"
               + esc(t['description']) + "'")
        creates.append({'table': t['name'], 'sql': sql})
        doc.append('-- ' + t['domain'] + ' : ' + t['description'])
        doc.append(sql + ';\n')
    doc.append('-- Foreign keys: default NO ACTION/RESTRICT, never cascade business history.')
    for t in tables:
        if not t['foreign']:
            continue
        clauses = []
        for i, fk in enumerate(t['foreign'], 1):
            clauses.append('ADD CONSTRAINT ' + q(cname('fk', t['name'], i)) + ' FOREIGN KEY ('
                           + qs(fk['columns']) + ') REFERENCES ' + q(fk['target']) + ' ('
                           + qs(fk['target_columns']) + ')')
        sql = 'ALTER TABLE ' + q(t['name']) + '\n  ' + ',\n  '.join(clauses)
        alters.append({'table': t['name'], 'foreign_keys': len(clauses), 'sql': sql})
        doc.append(sql + ';\n')
    return creates, alters, '\n'.join(doc)


# --- Rendu identique à history_guards.py ------------------------------------------------
HEADER_04 = ("-- History guards, MySQL 8.4. Import after schema/reference/views.\n"
             "-- Requires TRIGGER privilege on this database, no server-wide setting.\n"
             "-- No stored procedure or EVENT is installed. Aggregated invariants remain application transactions.\n"
             "DELIMITER $$\n")
PARENT_GUARDS = {
    'invoice_child': ('invoices', 'invoice_id', 'ISSUED'),
    'credit_child': ('credit_notes', 'credit_note_id', 'ISSUED'),
    'prescription_child': ('optical_prescriptions', 'prescription_id', 'VALIDATED'),
    'goods_child': ('goods_receipts', 'receipt_id', 'VALIDATED'),
    'inventory_child': ('inventory_counts', 'inventory_id', 'VALIDATED'),
    'delivery_child': ('deliveries', 'delivery_id', 'CONFIRMED'),
}
FINAL_STATES = {
    'issued': "OLD.status='ISSUED'", 'validated': "OLD.status='VALIDATED'",
    'confirmed_payment': "OLD.status='CONFIRMED'", 'confirmed_delivery': "OLD.status='CONFIRMED'",
    'closed_session': 'OLD.closed_at IS NOT NULL', 'ready_document': "OLD.status='READY'",
}


def render_guards(tables):
    triggers = []

    def trigger(table, event, body, label='guard'):
        name = 'tr_' + table + '_' + event.lower() + '_' + label
        if len(name) > 64:
            fail('nom de trigger trop long : ' + name)
        triggers.append({'name': name, 'table': table, 'event': event,
                         'sql': 'CREATE TRIGGER `' + name + '` BEFORE ' + event + ' ON `' + table
                                + '`\nFOR EACH ROW\nBEGIN\n' + body + '\nEND'})

    def reject_when(condition, message):
        return ("  IF " + condition + " THEN\n    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='"
                + message + "';\n  END IF;")

    def parent_state(row, parent, column, terminal):
        return ("(SELECT status FROM `" + parent + "` WHERE clinic_id=" + row + ".clinic_id AND id="
                + row + '.' + column + ")='" + terminal + "'")

    for table in tables:
        name, guard = table['name'], table['guard']
        if table['immutable']:
            for event in ['UPDATE', 'DELETE']:
                trigger(name, event, "  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Append-only history: create a new linked event';")
        elif guard in PARENT_GUARDS:
            parent, col, terminal = PARENT_GUARDS[guard]
            for event in ['INSERT', 'UPDATE', 'DELETE']:
                cond = []
                if event != 'INSERT':
                    cond.append(parent_state('OLD', parent, col, terminal))
                if event != 'DELETE':
                    cond.append(parent_state('NEW', parent, col, terminal))
                trigger(name, event, reject_when(' OR '.join(cond), 'Issued or finalized parent: child is immutable'))
        elif guard:
            cond = FINAL_STATES.get(guard)
            if cond:
                for event in ['UPDATE', 'DELETE']:
                    trigger(name, event, reject_when(cond, 'Finalized record is immutable; use a linked correction'))
            elif guard == 'signed_grant':
                cols = [x['name'] for x in table['columns'] if x['name'] not in ['revoked_at', 'updated_at']]
                condition = ' OR '.join('NOT (NEW.`' + co + '` <=> OLD.`' + co + '`)' for co in cols)
                trigger(name, 'UPDATE', reject_when(condition, 'Signed authorization fields are immutable; issue a new grant'))
                trigger(name, 'DELETE', "  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Signed grant history cannot be deleted';")
            else:
                fail('garde inconnue dans le catalogue : ' + str(guard))

    trigger('payments', 'INSERT', reject_when("(SELECT status FROM invoices WHERE clinic_id=NEW.clinic_id AND id=NEW.invoice_id)<>'ISSUED'", 'Payment requires an issued invoice'), label='invoice')
    trigger('receipts', 'INSERT', reject_when("(SELECT status FROM payments WHERE clinic_id=NEW.clinic_id AND id=NEW.payment_id)<>'CONFIRMED'", 'Receipt requires a confirmed payment'), label='payment')
    trigger('refunds', 'INSERT', reject_when("(SELECT status FROM credit_notes WHERE clinic_id=NEW.clinic_id AND id=NEW.credit_note_id)<>'ISSUED'", 'Refund requires an issued credit note'), label='credit')
    for table, sessioncol in [('payments', 'cash_session_id'), ('refunds', 'cash_session_id'), ('cash_movements', 'cash_session_id')]:
        trigger(table, 'INSERT', reject_when('NEW.' + sessioncol + ' IS NOT NULL AND (SELECT closed_at FROM cash_sessions WHERE clinic_id=NEW.clinic_id AND id=NEW.' + sessioncol + ') IS NOT NULL', 'New cash operation requires an open session'), label='session')
    for event in ['INSERT', 'UPDATE']:
        trigger('stock_lots', event, reject_when('(SELECT requires_expiry FROM catalog_items WHERE clinic_id=NEW.clinic_id AND id=NEW.item_id)=1 AND NEW.expires_on IS NULL', 'Perishable item requires an expiry date'), label='expiry')
    trigger('stock_movements', 'INSERT', reject_when('(SELECT requires_expiry FROM catalog_items WHERE clinic_id=NEW.clinic_id AND id=NEW.item_id)=1 AND NEW.lot_id IS NULL', 'Perishable movement requires a batch'), label='batch')
    trigger('stock_reservations', 'INSERT', reject_when('(SELECT requires_expiry FROM catalog_items WHERE clinic_id=NEW.clinic_id AND id=NEW.item_id)=1 AND NEW.stock_lot_id IS NULL', 'Perishable reservation requires a batch'), label='batch')
    trigger('delivery_lines', 'INSERT', reject_when('(SELECT requires_expiry FROM catalog_items WHERE clinic_id=NEW.clinic_id AND id=NEW.item_id)=1 AND NEW.stock_lot_id IS NULL', 'Perishable delivery requires a batch'), label='batch')

    doc = '\n'.join([HEADER_04] + [t['sql'] + '$$\n' for t in triggers] + ['DELIMITER ;\n'])
    return triggers, doc


# --- 02 et 03 : blocs de génération séparés par une ligne vide -------------------------
def split_blocks(name, text, header_check, statement_prefix, footer=None):
    blocks = text.split('\n\n')
    if '\n\n'.join(blocks) != text:
        fail(name + ' : découpage non réversible')
    header, body = blocks[0], blocks[1:]
    if not header_check(header):
        fail(name + ' : en-tête inattendu')
    if footer is not None:
        if not body or body[-1] != footer:
            fail(name + ' : pied inattendu ' + repr(body[-1:]))
        body = body[:-1]
    statements = []
    for block in body:
        lines = block.split('\n')
        # Fin de fichier et commentaires de fin de bloc : du texte pour le lecteur, pas du SQL.
        while lines and (lines[-1] == '' or lines[-1].startswith('-- ')):
            lines.pop()
        block_body = '\n'.join(lines)
        if not block_body.startswith(statement_prefix) or not block_body.endswith(';'):
            fail(name + ' : bloc inattendu ' + repr(block[:80]))
        sql = block_body[:-1]
        if ';\n' in sql or ';' in sql.split('\n')[-1]:
            fail(name + ' : plusieurs instructions dans un bloc ' + repr(block[:80]))
        statements.append(sql)
    return statements


def build():
    catalog_path = DB / 'schema_catalog.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    tables = catalog['tables']
    expected_catalog = json.loads(BACKLOG.read_text(encoding='utf-8'))['baseline_catalog_sha256']
    catalog_sha = sha256_file(catalog_path)
    if catalog_sha != expected_catalog:
        fail('schema_catalog.json ne correspond pas à la baseline du backlog (' + catalog_sha + ')')

    creates, alters, doc01 = render_schema(tables)
    if doc01 != read_lf('01_schema.sql'):
        fail('le rendu des tables/FK ne reproduit pas 01_schema.sql')
    guards, doc04 = render_guards(tables)
    if doc04 != read_lf('04_history_guards.sql'):
        fail('le rendu des guards ne reproduit pas 04_history_guards.sql')

    ref_text = read_lf('02_reference_data.sql')
    references = split_blocks(
        '02_reference_data.sql', ref_text,
        lambda h: h.endswith('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nSTART TRANSACTION;'),
        'INSERT INTO `', footer='COMMIT;\n')
    ref_tables = [s.split('`')[1] for s in references]
    if ref_tables != ['roles', 'permissions', 'role_permissions', 'clinical_terms', 'catalog_categories', 'units']:
        fail('02_reference_data.sql : tables inattendues ' + str(ref_tables))

    view_text = read_lf('03_reporting_views.sql')
    views = split_blocks(
        '03_reporting_views.sql', view_text,
        lambda h: h.endswith('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;'),
        'CREATE SQL SECURITY INVOKER VIEW ')
    view_names = [s.split()[5] for s in views]

    complete = read_lf('eagle_eye_optics_complet.sql')
    for name in ['01_schema.sql', '02_reference_data.sql', '03_reporting_views.sql', '04_history_guards.sql']:
        if '\n-- BEGIN ' + name + '\n' + read_lf(name) + '\n-- END ' + name + '\n' not in complete:
            fail('eagle_eye_optics_complet.sql ne contient pas ' + name + ' à l’identique')

    counts = {
        'tables': len(creates),
        'foreign_key_statements': len(alters),
        'foreign_keys': sum(a['foreign_keys'] for a in alters),
        'checks': sum(len(t['checks']) for t in tables),
        'reference_inserts': len(references),
        'views': len(views),
        'triggers': len(guards),
    }
    expected = {'tables': 117, 'foreign_keys': 466, 'checks': 488, 'views': 10, 'triggers': 88}
    for key, value in expected.items():
        if counts[key] != value:
            fail(f'compteur {key} = {counts[key]}, attendu {value}')

    sources = {name: sha256_file(DB / name) for name in [
        'schema_catalog.json', '01_schema.sql', '02_reference_data.sql', '03_reporting_views.sql',
        '04_history_guards.sql', 'eagle_eye_optics_complet.sql']}
    return {
        'generator': 'database/tools/build_migrations.py',
        'note': 'Généré : ne pas modifier à la main. Régénérer après tout changement du catalogue ou des scripts SQL.',
        'baseline_catalog_sha256': catalog_sha,
        'sources_sha256': sources,
        'session': SESSION,
        'counts': counts,
        'steps': {
            '01_tables': creates,
            '02_foreign_keys': alters,
            '03_reference_data': [{'table': t, 'sql': s} for t, s in zip(ref_tables, references)],
            '03_views': [{'view': v, 'sql': s} for v, s in zip(view_names, views)],
            '04_guards': guards,
        },
    }


def main():
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=1) + '\n'
    if '--check' in sys.argv:
        if not TARGET.exists() or TARGET.read_text(encoding='utf-8') != text:
            fail(str(TARGET.relative_to(ROOT)) + ' est absent ou périmé : relancer build_migrations.py')
        print('Baseline cohérente : ' + json.dumps(data['counts']))
        return
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(text.encode('utf-8'))
    print(str(TARGET.relative_to(ROOT)) + ' : ' + json.dumps(data['counts']))


if __name__ == '__main__':
    main()

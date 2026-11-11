"""Assemble docs/evidence/schema-parity.json à partir des sorties de tools/dev/schema-parity.sh.

Chaque contrôle est évalué ici ; le rapport conserve les valeurs observées et le script échoue si l'un
d'eux n'est pas satisfait. Aucune valeur n'est supposée : un fichier manquant fait échouer le contrôle.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = Path(sys.argv[1])
WORK = Path(os.environ['WORK'])
OUTPUT = ROOT / os.environ['OUTPUT']
env = os.environ


def clean(text):
    # Les sorties de commande peuvent citer des chemins absolus de la machine : on les retire de la preuve.
    return text.replace(str(ROOT) + '/', '').replace(str(WORK) + '/', '').replace(str(ROOT), '.').replace(str(WORK), '<travail>')


def read(name):
    path = WORK / name
    return clean(path.read_text(encoding='utf-8', errors='replace')) if path.exists() else ''


def load(name):
    text = read(name)
    return json.loads(text) if text else None


def code(name):
    return int(env[name])


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


checks = []


def check(name, ok, observed):
    checks.append({'check': name, 'pass': bool(ok), 'observed': observed})


snap_sql = load('snapshot-sql.json')
snap_mig = load('snapshot-mig.json')
baseline_meta = json.loads((ROOT / 'database/baseline/metadata.json').read_text(encoding='utf-8'))


def comparable(snapshot):
    if snapshot is None:
        return None
    return {k: v for k, v in snapshot['snapshot'].items() if k != 'other_tables'}


check('Photographie import SQL == photographie migrations (hors inventaire des tables techniques)',
      snap_sql is not None and comparable(snap_sql) == comparable(snap_mig),
      {'counts_sql': snap_sql and snap_sql['snapshot']['counts'], 'counts_migrations': snap_mig and snap_mig['snapshot']['counts']})
check('Tables hors baseline de la base importée : aucune',
      snap_sql is not None and snap_sql['snapshot']['other_tables'] == [],
      snap_sql and snap_sql['snapshot']['other_tables'])
FRAMEWORK = {'migrations', 'fw_sessions', 'fw_cache', 'fw_cache_locks', 'fw_jobs', 'fw_job_batches', 'fw_failed_jobs'}
check('Tables hors baseline de la base migrée : exactement migrations et les 6 tables fw_* déclarées',
      snap_mig is not None and set(snap_mig['snapshot']['other_tables']) == FRAMEWORK,
      snap_mig and snap_mig['snapshot']['other_tables'])
check('database/baseline/metadata.json identique à la photographie de l’import SQL',
      snap_sql is not None and baseline_meta['snapshot'] == snap_sql['snapshot'],
      {'metadata_sha256': sha256(ROOT / 'database/baseline/metadata.json')})
expected_counts = {'business_tables': 117, 'foreign_keys': 464, 'checks': 484, 'views': 10, 'triggers': 88}
check('Compteurs de la base migrée = 117 tables, 464 FK, 484 CHECK, 10 vues, 88 guards',
      snap_mig is not None and snap_mig['snapshot']['counts'] == expected_counts,
      snap_mig and snap_mig['snapshot']['counts'])
refs = snap_mig['snapshot']['reference_data'] if snap_mig else {}
check('Référentiels : 4 rôles, 49 permissions, 76 termes cliniques',
      refs.get('roles', {}).get('rows') == 4 and refs.get('permissions', {}).get('rows') == 49
      and refs.get('clinical_terms', {}).get('rows') == 76,
      {k: v['rows'] for k, v in refs.items()})
check('eagle:verify-schema base migrée contre photographie SQL : succès', code('VERIFY_MIG_VS_SQL') == 0, code('VERIFY_MIG_VS_SQL'))
check('eagle:verify-schema base migrée contre metadata.json : succès', code('VERIFY_MIG') == 0, code('VERIFY_MIG'))
check('eagle:verify-schema base importée contre metadata.json : succès', code('VERIFY_SQL') == 0, code('VERIFY_SQL'))

migrate1 = read('migrate-1.txt')
ran = re.findall(r'(2026_10_14_\d{6}_[a-z0-9_]+)\s.*DONE', migrate1)
check('Migrations exécutées sur base neuve : tables techniques puis 4 étapes de baseline',
      ran == ['2026_10_14_000000_create_framework_tables', '2026_10_14_000001_eeo_baseline_01_tables',
              '2026_10_14_000002_eeo_baseline_02_foreign_keys', '2026_10_14_000003_eeo_baseline_03_reference_data_and_views',
              '2026_10_14_000004_eeo_baseline_04_history_guards'], ran)
check('Second migrate : aucune migration à exécuter', 'Nothing to migrate' in read('migrate-2.txt'),
      read('migrate-2.txt').strip()[-200:])

meta_txt = read('sql-metadata.txt')
printed = dict(re.findall(r'^(base_tables|foreign_keys|checks|triggers|views)\t(\d+)$', meta_txt, re.M))
check('database/tests/mysql_metadata_tests.sql sur la base migrée : metadata_checks_passed',
      code('SQL_METADATA_EXIT') == 0 and 'metadata_checks_passed' in meta_txt, {'exit': code('SQL_METADATA_EXIT'), 'printed_counts': printed})
smoke = read('sql-smoke.txt')
passes = [l for l in smoke.splitlines() if l.startswith('PASS ')]
check('database/tests/mysql_smoke_tests.sql sur la base migrée : 41 PASS et fixtures annulées',
      code('SQL_SMOKE_EXIT') == 0 and len(passes) == 41 and 'smoke_checks_passed_and_fixtures_rolled_back' in smoke,
      {'exit': code('SQL_SMOKE_EXIT'), 'pass_count': len(passes)})

adopted_migrate = read('adopt-ok-migrate.txt')
check('Adoption d’une base importée équivalente : succès, 4 migrations de baseline enregistrées',
      code('ADOPT_OK') == 0 and env['ADOPT_OK_ROWS'].strip() == '4', {'exit': code('ADOPT_OK'), 'baseline_rows': env['ADOPT_OK_ROWS'].strip()})
check('Seconde adoption refusée', code('ADOPT_AGAIN') != 0, {'exit': code('ADOPT_AGAIN'), 'message': read('adopt-ok-again.txt').strip()[-200:]})
check('Après adoption, migrate crée seulement les tables techniques',
      code('ADOPT_MIGRATE') == 0 and '2026_10_14_000000_create_framework_tables' in adopted_migrate and 'eeo_baseline' not in adopted_migrate,
      {'exit': code('ADOPT_MIGRATE')})
verify_adopted = load('verify-adopted.json')
check('Base adoptée puis migrée : eagle:verify-schema sans écart, baseline 4/4 enregistrée',
      code('ADOPT_VERIFY') == 0 and verify_adopted is not None and len(verify_adopted['baseline_migrations_recorded']) == 4,
      {'exit': code('ADOPT_VERIFY')})

divergent = []
for line in filter(None, env['BAD_JOINED'].split('\n')):
    exit_code, rows, sql, path = line.split('|', 3)
    # Le chemin transmis par le script shell est POSIX (/tmp/…) : un Python Windows ne le retrouve pas. Le fichier est
    # toujours dans WORK : on le relit par son nom.
    message = read(Path(path).name)
    ok = exit_code != '0' and rows.strip() == '0' and 'Adoption refusée' in message
    divergent.append({'divergence': sql, 'exit': int(exit_code), 'baseline_rows': rows.strip(), 'refused': ok,
                      'first_difference': next((l.strip() for l in message.splitlines() if l.strip().startswith('- ')), None)})
check('Adoption refusée pour chaque base divergente, sans écriture', len(divergent) == 3 and all(d['refused'] for d in divergent), divergent)

double = read('double-migrate.txt')
check('migrate sur une base déjà importée : refus explicite renvoyant à eeo:schema:adopt, rien enregistré',
      code('DOUBLE_EXIT') != 0 and 'eeo:schema:adopt' in double and env['DOUBLE_ROWS'].strip() == '0',
      {'exit': code('DOUBLE_EXIT'), 'baseline_rows': env['DOUBLE_ROWS'].strip()})
check('Base importée toujours équivalente après le refus', code('DOUBLE_VERIFY') == 0, code('DOUBLE_VERIFY'))
check('migrate:rollback en configuration production refusé', code('ROLLBACK_EXIT') != 0,
      {'exit': code('ROLLBACK_EXIT'), 'message': read('rollback-production.txt').strip()[-300:]})
check('Schéma migré inchangé après le refus de retour arrière', code('ROLLBACK_VERIFY') == 0, code('ROLLBACK_VERIFY'))

commit = git('rev-parse', 'HEAD')
dirty = git('status', '--porcelain')
report = {
    'task': 'F04',
    'generated_by': 'tools/dev/schema-parity.sh',
    'date_utc': env.get('EEO_EVIDENCE_DATE') or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'git_commit': commit,
    'working_tree_clean': dirty == '',
    'mysql_version': env['MYSQL_VERSION'],
    'mysql_client': env['MYSQL_CLIENT'],
    'php_version': subprocess.run(['php', '-r', 'echo PHP_VERSION;'], capture_output=True, text=True).stdout,
    'inputs_sha256': {
        'database/schema_catalog.json': sha256(ROOT / 'database/schema_catalog.json'),
        'database/eagle_eye_optics_complet.sql': sha256(ROOT / 'database/eagle_eye_optics_complet.sql'),
        'database/baseline/statements.json': sha256(ROOT / 'database/baseline/statements.json'),
        'database/baseline/metadata.json': sha256(ROOT / 'database/baseline/metadata.json'),
    },
    'framework_tables_inventory': snap_mig and snap_mig['snapshot']['other_tables'],
    'checks_passed': sum(c['pass'] for c in checks),
    'checks_total': len(checks),
    'result': 'PASS' if all(c['pass'] for c in checks) else 'FAIL',
    'checks': checks,
    'limits': [
        'Preuve de schéma sur MySQL de développement isolé ; ne valide ni l’hébergement réel (Q01), ni les transactions applicatives, ni la PWA.',
        'Les 41 assertions SQL contrôlent les garanties exprimées en base ; les invariants agrégés restent des tests applicatifs (fichier 21).',
    ],
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
for c in checks:
    print(('PASS ' if c['pass'] else 'FAIL ') + c['check'])
sys.exit(0 if report['result'] == 'PASS' else 1)

// Génère .env.e2e (ignoré par git) pour le serveur de test des e2e : environnement « e2e », base de
// test isolée, aucun fournisseur réel. Aucune valeur n'est un secret : la clé d'application est
// aléatoire à chaque exécution et rien n'est versionné.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = process.env.EEO_E2E_PORT ?? '8123'

if (!existsSync(join(root, 'public', 'build', 'manifest.json'))) {
  console.error(
    'Build absent : lancer « npm run build » avant les tests e2e (ou « npm run test:e2e »).',
  )
  process.exit(1)
}

const overrides = {
  APP_ENV: 'e2e',
  APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
  APP_DEBUG: 'false',
  APP_URL: `http://127.0.0.1:${port}`,
  DB_HOST: process.env.EEO_TEST_DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.EEO_TEST_DB_PORT ?? '3306',
  // Base dédiée aux e2e (jetable, « *_test ») : remise à zéro et migrée à chaque préparation.
  DB_DATABASE: process.env.EEO_E2E_DB_DATABASE ?? 'eeo_e2e_test',
  DB_USERNAME: process.env.EEO_TEST_DB_USERNAME ?? 'eeo_test',
  DB_PASSWORD: process.env.EEO_TEST_DB_PASSWORD ?? 'eeo_test_password',
  LOG_CHANNEL: 'stderr',
  LOG_LEVEL: 'warning',
  MAIL_MAILER: 'array',
  EEO_INTEGRATIONS_MODE: 'fake',
  PRODUCTION_DOCUMENTS_ENABLED: 'false',
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${port}`,
  // Origine de test en HTTP simple : un cookie « Secure » n'y serait pas renvoyé par le navigateur.
  SESSION_SECURE_COOKIE: 'false',
  EEO_CLINIC_ID: '',
  // Modules ouverts pour les parcours e2e (mise en service progressive : fermés par défaut en production).
  // « sales » ouvre l'aperçu des documents (D02, /documents/apercu) et les écrans de vente et de caisse
  // (B01 à B05) ; « stock » ouvre les disponibilités et le stock initial (I00) ; « settings » ouvre les
  // paramètres de la gérante (personnel, cabinet et documents).
  // « agenda » : agenda interne et suivis (S01, S02), avec l'agenda de démonstration (eeo:demo:agenda).
  // « offline » : préparation d'un poste et synchronisation (O01 à O05, parcours offline-sync.spec.ts) ; sans coffre de
  // poste ouvert, il ne change rien aux autres parcours (toutes les mutations suivent la route directe).
  EEO_ENABLED_MODULES: 'patients,today,consultations,sales,stock,settings,reports,agenda,offline',
  // Les parcours e2e se connectent souvent, vite : la limite de 20 connexions par minute et par adresse IP
  // (production) les bloquerait sur une machine rapide.
  EEO_RATE_LOGIN_IP: '1000',
  // Préparer un poste confirme quatre ou cinq fois le mot de passe de la gérante ; deux parcours enchaînés dépasseraient
  // la limite de 5 par minute et par compte (production) et recevraient « Trop de tentatives » (429).
  EEO_RATE_REAUTHENTICATE: '1000',
  // Tolérance d'horloge des commandes de poste réduite à 2 s (production : 300 s). Navigateur et serveur partagent ici la
  // même horloge ; sans cela, un encaissement fait quelques secondes avant le remplacement de son poste (reprise O07,
  // device-recovery.spec.ts) tomberait « autour de la révocation » et passerait en revue, comme prévu en production.
  EEO_MAX_CLOCK_SKEW: '2',
}

const lines = readFileSync(join(root, '.env.example'), 'utf8')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line)
    const key = match?.[1]
    return key && key in overrides ? `${key}=${overrides[key]}` : line
  })

writeFileSync(join(root, '.env.e2e'), `${lines.join('\n')}\n`, { mode: 0o600 })
console.log(`.env.e2e généré (APP_ENV=e2e, base ${overrides.DB_DATABASE}, port ${port}).`)

// Base e2e : remise à zéro sous la garde des bases de test (APP_ENV=testing, nom « *_test », hôte local),
// migrations de la baseline complète, puis comptes de démonstration fictifs à mots de passe aléatoires,
// écrits dans un fichier ignoré par git (mode 0600) que lisent les tests e2e.
const database = {
  DB_CONNECTION: 'mysql',
  DB_HOST: overrides.DB_HOST,
  DB_PORT: overrides.DB_PORT,
  DB_DATABASE: overrides.DB_DATABASE,
  DB_USERNAME: overrides.DB_USERNAME,
  DB_PASSWORD: overrides.DB_PASSWORD,
}
const artisan = (environment, ...args) =>
  execFileSync('php', ['artisan', ...args, '--no-interaction'], {
    cwd: root,
    env: { ...process.env, ...database, APP_ENV: environment, APP_KEY: overrides.APP_KEY },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

artisan('testing', 'eeo:test-db:reset', '--create', '--migrate')
artisan(
  'e2e',
  'eeo:demo:accounts',
  `--output=${join(root, 'storage', 'framework', 'testing', 'e2e-accounts.json')}`,
)
// Échelles d'acuité de DÉMONSTRATION (fictives, non validées cliniquement) : sans elles, la saisie des acuités d'une
// consultation n'a aucune échelle à choisir.
artisan('e2e', 'eeo:clinical:scales', '--demo')
// Ventes de DÉMONSTRATION (fictives) : caisse principale, taxe de test, articles DEMO-* et stock initial, par le
// chemin central au nom de demo.gerante ; sans eux, aucune facture ni aucun encaissement n'est possible en e2e.
artisan('e2e', 'eeo:demo:sales')
// Agenda de DÉMONSTRATION (fictif) : une salle, des horaires et deux prestations fictives, deux rappels internes ; sans
// eux, aucun créneau n'est proposé (aucun horaire n'est inventé).
artisan('e2e', 'eeo:demo:agenda')
// Clé ES256 de TEST qui signe les grants des postes préparés (O02, parcours offline-sync.spec.ts) : créée une fois dans
// le stockage privé local, jamais dans le dépôt ; sans changement si elle existe déjà.
artisan('e2e', 'eeo:offline:signing-key')
console.log(
  `Base ${overrides.DB_DATABASE} migrée ; comptes de démonstration fictifs et échelles de démonstration préparés.`,
)

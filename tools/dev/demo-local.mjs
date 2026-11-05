// Prépare puis lance l'application EN LOCAL avec des données fictives, pour tester le rendu à la main.
//
// Environnement « demo » (fichier .env.demo, ignoré par git), base dédiée « eeo_demo_test » : jamais celle des e2e. Les
// parcours Playwright (qui remettent « eeo_e2e_test » à zéro et régénèrent leurs mots de passe à chaque exécution) ne
// dérangent donc pas cette démonstration, et inversement. Les comptes de démonstration ont des mots de passe ALÉATOIRES,
// écrits une seule fois dans un fichier privé ignoré par git (storage/framework/testing/demo-accounts.json) : jamais de
// mot de passe universel ni versionné.
//
// Usage : node tools/dev/demo-local.mjs [--reset] [--no-start]
//   --reset     recrée la base et les comptes (nouveaux mots de passe, sessions ouvertes invalidées)
//   --no-start  prépare sans lancer le serveur
// Variables : EEO_TEST_DB_PORT (3306 par défaut ; 3316 sur le poste Windows du demandeur), EEO_DEMO_PORT (8140).
// Prérequis : moteur MySQL de test démarré (voir docs/implementation/startup.md) et « npm run build » fait.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = process.env.EEO_DEMO_PORT ?? '8140'
const reset = process.argv.includes('--reset')
const start = !process.argv.includes('--no-start')
const accountsFile = join(root, 'storage', 'framework', 'testing', 'demo-accounts.json')
const envFile = join(root, '.env.demo')

if (!existsSync(join(root, 'public', 'build', 'manifest.json'))) {
  console.error('Build absent : lancer « npm run build » avant la démonstration locale.')
  process.exit(1)
}

// Poste Windows du demandeur : sans ce fichier, les clés elliptiques (grants des postes préparés) échouent.
const windowsOpenssl = 'C:\\php84\\extras\\ssl\\openssl.cnf'
const baseEnvironment = { ...process.env }
if (process.platform === 'win32' && !baseEnvironment.OPENSSL_CONF && existsSync(windowsOpenssl)) {
  baseEnvironment.OPENSSL_CONF = windowsOpenssl
}

const database = {
  DB_CONNECTION: 'mysql',
  DB_HOST: process.env.EEO_TEST_DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.EEO_TEST_DB_PORT ?? '3306',
  // Nom en « *_test » : seul nom que la garde des bases de test accepte de remettre à zéro.
  DB_DATABASE: 'eeo_demo_test',
  DB_USERNAME: process.env.EEO_TEST_DB_USERNAME ?? 'eeo_test',
  DB_PASSWORD: process.env.EEO_TEST_DB_PASSWORD ?? 'eeo_test_password',
}

let fresh = reset || !existsSync(envFile) || !existsSync(accountsFile)
if (!existsSync(envFile) || reset) {
  const overrides = {
    APP_ENV: 'demo',
    APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    APP_DEBUG: 'false',
    APP_URL: `http://127.0.0.1:${port}`,
    ...database,
    LOG_CHANNEL: 'stderr',
    LOG_LEVEL: 'warning',
    MAIL_MAILER: 'array',
    EEO_INTEGRATIONS_MODE: 'fake',
    PRODUCTION_DOCUMENTS_ENABLED: 'false',
    SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${port}`,
    // Origine HTTP simple : un cookie « Secure » n'y serait pas renvoyé par le navigateur.
    SESSION_SECURE_COOKIE: 'false',
    EEO_CLINIC_ID: '',
    // Tous les modules ouverts pour la démonstration, y compris le travail sans réseau (« offline »).
    EEO_ENABLED_MODULES: 'patients,today,consultations,sales,stock,settings,reports,agenda,offline',
    EEO_RATE_LOGIN_IP: '1000',
  }
  const lines = readFileSync(join(root, '.env.example'), 'utf8')
    .split('\n')
    .map((line) => {
      const key = /^([A-Z0-9_]+)=/.exec(line)?.[1]
      return key && key in overrides ? `${key}=${overrides[key]}` : line
    })
  writeFileSync(envFile, `${lines.join('\n')}\n`, { mode: 0o600 })
  console.log(`.env.demo généré (APP_ENV=demo, base ${database.DB_DATABASE}, port ${port}).`)
  fresh = true
}

const appKey = /^APP_KEY=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1] ?? ''
const artisan = (environment, ...args) =>
  execFileSync('php', ['artisan', ...args, '--no-interaction'], {
    cwd: root,
    env: { ...baseEnvironment, ...database, APP_ENV: environment, APP_KEY: appKey },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

if (fresh) {
  // Remise à zéro sous la garde des bases de test (APP_ENV=testing, nom « *_test », hôte local), puis données FICTIVES.
  artisan('testing', 'eeo:test-db:reset', '--create', '--migrate')
  mkdirSync(dirname(accountsFile), { recursive: true })
  artisan('demo', 'eeo:demo:accounts', `--output=${accountsFile}`)
  artisan('demo', 'eeo:clinical:scales', '--demo')
  artisan('demo', 'eeo:demo:sales')
  artisan('demo', 'eeo:demo:agenda')
  artisan('demo', 'eeo:offline:signing-key')
  console.log(`Base ${database.DB_DATABASE} prête ; comptes fictifs écrits dans ${accountsFile}.`)
}

console.log(`\nApplication : http://127.0.0.1:${port}/connexion`)
console.log('Identifiants : demo.gerante, demo.accueil, demo.professionnel, demo.caisse')
console.log(`Mots de passe : fichier privé ${accountsFile} (ignoré par git).\n`)

if (start) {
  const router = join(
    root,
    'vendor',
    'laravel',
    'framework',
    'src',
    'Illuminate',
    'Foundation',
    'resources',
    'server.php',
  )
  const server = spawn(
    'php',
    ['-d', 'opcache.jit=disable', '-S', `127.0.0.1:${port}`, router],
    {
      cwd: join(root, 'public'),
      env: { ...baseEnvironment, APP_ENV: 'demo' },
      stdio: 'inherit',
    },
  )
  server.on('exit', (code) => process.exit(code ?? 0))
  process.on('SIGINT', () => server.kill())
}

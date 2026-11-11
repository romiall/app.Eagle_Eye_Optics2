import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { phpServerOptions } from './php'
import { MAIN_PORT } from './ports'
import { warmUp } from './warm-up'

export interface RunningServer {
  url: string
  /** Arrête réellement le serveur : plus aucune connexion n'aboutit (coupure vraie, pas simulée). */
  stop(): Promise<void>
}

const ROOT = join(import.meta.dirname, '..', '..', '..')

interface TrackedServer {
  port: number
  startedAt: number
  server: RunningServer
}

/** Serveurs démarrés et pas encore arrêtés. Un parcours qui dépasse son délai ne passe pas par son `finally` : il ne les arrête pas. */
const alive = new Set<TrackedServer>()

/**
 * Registre des serveurs PHP démarrés par ce dépôt : un fichier par port, dans le dossier de test ignoré par git (donc propre à
 * chaque copie du dépôt), qui garde le numéro du processus PHP. La mémoire d'un processus de test tombé (plantage natif, tué)
 * est perdue, mais ses serveurs PHP, détachés, lui survivent : seul ce fichier permet à la reprise du parcours de les retrouver.
 */
const REGISTRY = join(ROOT, 'storage', 'framework', 'testing', 'e2e-servers')

function registryFile(port: number): string {
  return join(REGISTRY, `${String(port)}.json`)
}

function register(port: number, pid: number | undefined): void {
  if (pid === undefined) return
  try {
    mkdirSync(REGISTRY, { recursive: true })
    writeFileSync(registryFile(port), JSON.stringify({ pid }))
  } catch {
    // Le registre n'est qu'un filet : sans lui, un serveur resté actif est refusé avec un message explicite.
  }
}

/** N'efface que l'inscription de CE serveur : celle d'un serveur plus récent du même port reste. */
function unregister(port: number, pid: number | undefined): void {
  if (pid !== undefined && registeredServerPid(port) === pid)
    rmSync(registryFile(port), { force: true })
}

function registeredServerPid(port: number): number | undefined {
  try {
    const entry = JSON.parse(readFileSync(registryFile(port), 'utf8')) as { pid?: unknown }
    return typeof entry.pid === 'number' ? entry.pid : undefined
  } catch {
    return undefined
  }
}

/**
 * Le processus existe et c'est bien PHP. Un numéro lu dans le registre survit au processus et peut être réattribué : jamais
 * d'arrêt d'un processus qui n'est pas un serveur PHP.
 */
function isPhpProcess(pid: number): boolean {
  const listing =
    process.platform === 'win32'
      ? spawnSync('tasklist', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
        })
      : spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' })
  return listing.status === 0 && /php/i.test(listing.stdout)
}

/**
 * Oublie les serveurs suivis SANS les arrêter : c'est ce que perd un processus de test tombé. Réservé au test de garde
 * (`isolation-postes.spec.ts`), qui prouve ainsi la reprise d'un serveur laissé par un processus tombé.
 */
export function abandonTrackedServers(): void {
  alive.clear()
}

/**
 * Arrête les serveurs démarrés depuis `since` (horloge en ms, `Date.now()`) que leur parcours n'a pas arrêtés, et rend leurs
 * ports. Le processus PHP est détaché (il survit à celui des tests) : resté actif sur son port dédié, il serait pris pour
 * le sien par la reprise du parcours (vérification du 2026-11-11 : la page de la reprise était encore connectée à un serveur
 * que le parcours croyait arrêté). Appelée à la fin de chaque parcours par la fixture de `support/test.ts` ; un serveur
 * démarré avant `since` (`beforeAll` d'un fichier) n'est jamais touché.
 */
export async function stopServersStartedSince(since: number): Promise<number[]> {
  const leaked = [...alive].filter((entry) => entry.startedAt >= since)
  await Promise.all(leaked.map((entry) => entry.server.stop().catch(() => undefined)))
  return leaked.map((entry) => entry.port)
}

/**
 * Quelqu'un écoute sur ce port ? Un refus de connexion : non. Une réponse, ou un délai dépassé (serveur occupé à compiler
 * Laravel, qui traite une requête à la fois) : oui.
 */
async function isPortInUse(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/up`, { signal: AbortSignal.timeout(1_000) })
    return true
  } catch (error) {
    return error instanceof DOMException && error.name === 'TimeoutError'
  }
}

/**
 * Un serveur de test démarre sur un port libre. Un port qui répond déjà porte un serveur resté actif : le prendre pour le
 * nouveau (ce que fait `waitUntilReady`) faussait les parcours qui l'arrêtent pour couper le réseau (vérification du
 * 2026-11-11). Trois cas :
 *  - un serveur démarré par CE processus et jamais arrêté est un défaut du parcours : refus, jamais repris en silence ;
 *  - un serveur laissé par un processus de test TOMBÉ (plantage natif, tué : les serveurs PHP, détachés, lui survivent) est
 *    arrêté puis remplacé, pour que la reprise du parcours (`retries`) puisse aboutir. Il se reconnaît au registre de ce
 *    dépôt et à son processus PHP, jamais à son seul port ;
 *  - tout autre occupant du port (jamais celui du serveur principal) : refus.
 */
async function ensurePortIsFree(url: string, port: number): Promise<void> {
  if (!(await isPortInUse(url))) return

  if ([...alive].some((entry) => entry.port === port)) {
    throw new Error(
      `Le port ${String(port)} répond déjà : ce parcours y a déjà démarré un serveur qu’il n’a pas arrêté.`,
    )
  }

  const orphan = port === MAIN_PORT ? undefined : registeredServerPid(port)
  if (orphan === undefined || !isPhpProcess(orphan)) {
    throw new Error(
      `Le port ${String(port)} répond déjà et ne porte pas un serveur de test de ce dépôt : le libérer avant de rejouer.`,
    )
  }

  killProcessTree(orphan)
  await waitUntilRefusing(url)
  unregister(port, orphan)
  console.warn(
    `Serveur de test laissé par un processus interrompu repris au port ${String(port)} (PHP ${String(orphan)}) : arrêté avant de redémarrer.`,
  )
}

async function waitUntilReady(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error('Le serveur PHP de test s’est arrêté au démarrage.')
    try {
      const response = await fetch(`${url}/up`)
      if (response.ok) return
    } catch {
      // Pas encore prêt.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Le serveur PHP de test n’est pas prêt après 30 secondes.')
}

/**
 * Démarre l'application Laravel (public/build) sur un port dédié, avec le même fichier .env.e2e que
 * le serveur principal. Les tests de coupure doivent l'arrêter eux-mêmes : Playwright ne simule pas
 * l'absence de réseau pour les requêtes émises par le service worker.
 *
 * `environment` surcharge des variables du fichier .env.e2e (une variable d'environnement du
 * processus l'emporte sur le fichier), par exemple APP_URL=https://… comme en production.
 */
export async function startLaravelServer(
  port: number,
  environment: Readonly<Record<string, string>> = {},
): Promise<RunningServer> {
  const url = `http://127.0.0.1:${port}`
  await ensurePortIsFree(url, port)

  const router = join(
    ROOT,
    'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php',
  )
  // Comme « artisan serve » : répertoire courant = public/, que le routeur de Laravel utilise.
  const server = spawn('php', [...phpServerOptions(), '-S', `127.0.0.1:${port}`, router], {
    cwd: join(ROOT, 'public'),
    env: { ...process.env, ...environment, APP_ENV: 'e2e' },
    stdio: 'ignore',
    // Groupe de processus dédié : l'arrêt supprime aussi d'éventuels processus enfants.
    detached: true,
    windowsHide: true,
  })
  const pid = server.pid
  register(port, pid)

  let stopped = false

  const handle: RunningServer = {
    url,
    async stop() {
      if (stopped) return
      stopped = true
      alive.delete(entry)

      if (server.pid !== undefined && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
        killTree(server)
        await exited
      }

      await waitUntilRefusing(url)
      unregister(port, pid)
    },
  }
  // Suivi dès le démarrage du processus : un délai de parcours qui tombe PENDANT le démarrage (poste chargé : la première
  // requête de chaque chemin compile Laravel) laisse aussi un serveur actif.
  const entry: TrackedServer = { port, startedAt: Date.now(), server: handle }
  alive.add(entry)

  try {
    await waitUntilReady(url, server)
    await warmUp(url)
  } catch (error) {
    stopped = true
    alive.delete(entry)
    killTree(server)
    unregister(port, pid)
    throw error
  }

  return handle
}

/**
 * Arrête un processus et ses éventuels enfants. POSIX : signal au groupe de processus (pid négatif), puis au processus seul.
 * Windows ne connaît pas les groupes POSIX (`process.kill(-pid)` y échoue sans rien arrêter) : l'arbre
 * est arrêté par `taskkill /T /F`.
 */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Déjà arrêté.
    }
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid !== undefined) killProcessTree(child.pid)
}

/** Vérifie que le port refuse réellement les connexions : la coupure est vraie. */
async function waitUntilRefusing(url: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!(await isPortInUse(url))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Le serveur PHP de test répond encore après son arrêt.')
}

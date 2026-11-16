import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { phpServerOptions } from './php'
import { warmUp } from './warm-up'

export interface RunningServer {
  url: string
  /** Arrête réellement le serveur : plus aucune connexion n'aboutit (coupure vraie, pas simulée). */
  stop(): Promise<void>
}

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** Rend `preferred` s'il est libre sur 127.0.0.1, sinon un port libre attribué par le système. */
export async function findFreePort(preferred: number): Promise<number> {
  const tryListen = (port: number): Promise<number | null> =>
    new Promise((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(null))
      probe.listen(port, '127.0.0.1', () => {
        const address = probe.address()
        const free = typeof address === 'object' && address !== null ? address.port : null
        probe.close(() => resolve(free))
      })
    })
  return (await tryListen(preferred)) ?? (await tryListen(0)) ?? preferred
}

async function waitUntilReady(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error('Le serveur PHP de test s’est arrêté au démarrage.')
    try {
      const response = await fetch(`${url}/up`)
      if (response.ok && process.exitCode === null) return
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
  const router = join(
    ROOT,
    'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php',
  )
  // Comme « artisan serve » : répertoire courant = public/, que le routeur de Laravel utilise.
  const server = spawn('php', [...phpServerOptions(), '-S', `127.0.0.1:${port}`, router], {
    cwd: join(ROOT, 'public'),
    env: { ...process.env, ...environment, APP_ENV: 'e2e' },
    stdio: 'ignore',
    // POSIX : groupe de processus dédié ; sous Windows, ne pas détacher évite des orphelins après un plantage.
    detached: process.platform !== 'win32',
    windowsHide: true,
  })

  const url = `http://127.0.0.1:${port}`
  try {
    await waitUntilReady(url, server)
    await warmUp(url)
  } catch (error) {
    killTree(server)
    throw error
  }

  let stopped = false

  return {
    url,
    async stop() {
      if (stopped) return
      stopped = true

      if (server.pid !== undefined && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
        killTree(server)
        await exited
      }

      await waitUntilRefusing(url)
    },
  }
}

/**
 * Arrête le serveur et ses éventuels enfants. POSIX : signal au groupe de processus (pid négatif).
 * Windows ne connaît pas les groupes POSIX (`process.kill(-pid)` y échoue sans rien arrêter) : l'arbre
 * est arrêté par `taskkill /T /F`.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Déjà arrêté.
  }
}

/** Vérifie que le port refuse réellement les connexions : la coupure est vraie. */
async function waitUntilRefusing(url: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/up`, { signal: AbortSignal.timeout(1_000) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Le serveur PHP de test répond encore après son arrêt.')
}

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

import { phpServerOptions } from './php'
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
 * Refuse de démarrer sur un port qui répond déjà : c'est un serveur de test resté actif (parcours interrompu, processus de
 * test tué). Sans cette garde, `waitUntilReady` le prendrait pour le nouveau serveur et `stop()` n'arrêterait rien.
 */
async function assertPortIsFree(url: string, port: number): Promise<void> {
  try {
    await fetch(`${url}/up`, { signal: AbortSignal.timeout(1_000) })
  } catch {
    return
  }
  throw new Error(
    `Le port ${String(port)} répond déjà : un serveur de test précédent est resté actif (parcours interrompu). Arrêter le processus php qui l’écoute avant de rejouer.`,
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
  await assertPortIsFree(url, port)

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
    throw error
  }

  return handle
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

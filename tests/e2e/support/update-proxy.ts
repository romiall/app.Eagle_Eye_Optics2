import { readdirSync, readFileSync } from 'node:fs'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import { join } from 'node:path'

/**
 * Deux versions de l'application derrière UNE seule origine (O06) : la version courante, servie par Laravel (le build de
 * public/build), et la version PRÉCÉDENTE, dérivée de ce même build. Le navigateur de test installe la précédente, puis
 * le test fait « livrer » la courante : le service worker voit un vrai `/sw.js` différent, précache de vrais fichiers
 * aux noms différents et attend l'accord de la personne, comme après une mise en ligne.
 *
 * La version précédente est le build courant dont TOUS les fichiers de `/build/assets/` sont renommés (comme le fait la
 * construction à chaque changement de contenu : le nom porte l'empreinte), dont l'identité de build (identifiant et date)
 * est autre, et dont la coquille et le précache pointent vers ces noms. Elle est servie depuis la mémoire ; tout le reste
 * (l'API, les icônes, la coquille) passe par Laravel. Un proxy Node, et non l'interception de Playwright : les requêtes du
 * service worker ne passent pas par les routes de Playwright (voir smoke.spec.ts), alors qu'un vrai serveur les reçoit
 * toutes.
 *
 * Limite déclarée : la version précédente a le MÊME code que la courante (seuls le nom des fichiers et l'identité du build
 * changent). La conformité du schéma local entre deux versions du code est éprouvée à part (migrations.test.ts, et le
 * test de schéma de tests/e2e/app-update.spec.ts).
 */
export interface BuildIdentity {
  id: string
  builtAt: string
}

export interface OlderBuild {
  identity: BuildIdentity
  /** Fichiers de `/build/assets/` de la version précédente (nom → octets). */
  assets: Map<string, Buffer>
  serviceWorker: string
  /** Noms d'origine → noms de la version précédente (pour réécrire la coquille). */
  renamed: Map<string, string>
}

const TEXT_TYPES = /\.(?:js|css|svg)$/
const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
}

/** Identité du build courant, écrite par vite.config.ts dans `build-info.json`. */
export function currentBuildIdentity(buildDirectory: string): BuildIdentity {
  return JSON.parse(readFileSync(join(buildDirectory, 'build-info.json'), 'utf8')) as BuildIdentity
}

function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to)
}

/** Dérive la version précédente du build courant (voir l'en-tête du fichier). */
export function deriveOlderBuild(buildDirectory: string, identity: BuildIdentity): OlderBuild {
  const current = currentBuildIdentity(buildDirectory)
  const assetsDirectory = join(buildDirectory, 'assets')
  const names = readdirSync(assetsDirectory)
  // Le nom porte l'empreinte du contenu : « main-C_a6yeX2.js » devient « main-C_a6yeX2-prec.js ».
  const renamed = new Map(names.map((name) => [name, name.replace(/(\.[^.]+)$/, '-prec$1')]))
  const longestFirst = [...renamed.entries()].sort((a, b) => b[0].length - a[0].length)

  const rewrite = (text: string): string => {
    let result = text
    for (const [from, to] of longestFirst) result = replaceAll(result, from, to)
    return result
  }

  const assets = new Map<string, Buffer>()
  let carriers = 0
  for (const name of names) {
    const content = readFileSync(join(assetsDirectory, name))
    const target = renamed.get(name) ?? name
    if (!TEXT_TYPES.test(name)) {
      assets.set(target, content)
      continue
    }
    let text = rewrite(content.toString('utf8'))
    if (text.includes(current.id) || text.includes(current.builtAt)) {
      carriers += 1
      text = replaceAll(
        replaceAll(text, current.id, identity.id),
        current.builtAt,
        identity.builtAt,
      )
    }
    assets.set(target, Buffer.from(text, 'utf8'))
  }
  if (carriers === 0) {
    throw new Error(
      `L’identité du build (${current.id}) ne figure dans aucun fichier de public/build/assets : le pied de page « Version » ne peut pas la montrer.`,
    )
  }

  // Service worker : précache aux noms précédents, coquille « / » à une autre révision (sinon le navigateur croirait la
  // coquille déjà à jour et ne la rechargerait pas à l'installation de la version courante).
  let serviceWorker = rewrite(readFileSync(join(buildDirectory, 'sw.js'), 'utf8'))
  const shell = /\{url:"\/",revision:"([^"]*)"\}/.exec(serviceWorker)
  if (shell === null) {
    throw new Error('La révision de la coquille « / » est introuvable dans public/build/sw.js.')
  }
  serviceWorker = serviceWorker.replace(
    shell[0],
    `{url:"/",revision:"${shell[1] ?? ''}-precedente"}`,
  )
  return { identity, assets, serviceWorker, renamed }
}

export interface UpdateProxy {
  /** Origine publique (HTTP) à ouvrir dans le navigateur de test. */
  origin: string
  /** Identité de la version précédente et de la courante. */
  older: BuildIdentity
  current: BuildIdentity
  /** Nom d'un fichier de `/build/assets/` dans la version courante → son nom dans la version précédente. */
  renamed: ReadonlyMap<string, string>
  /** Version servie : « OLD » (précédente) ou « NEW » (courante). Au départ : « OLD ». */
  serve(version: 'OLD' | 'NEW'): void
  /** Coupe réellement (connexion fermée) toute requête dont le chemin correspond ; `null` rétablit tout. */
  cut(pattern: RegExp | null): void
  stop(): Promise<void>
}

export interface UpdateProxyOptions {
  port: number
  /** URL HTTP du serveur Laravel derrière le proxy, par exemple http://127.0.0.1:8131. */
  backend: string
  /** Répertoire `public/build` du build courant. */
  buildDirectory: string
  /** Identité de la version précédente. */
  olderIdentity?: BuildIdentity
}

export async function startUpdateProxy(options: UpdateProxyOptions): Promise<UpdateProxy> {
  const current = currentBuildIdentity(options.buildDirectory)
  const olderIdentity = options.olderIdentity ?? {
    id: 'precedente-e2e',
    builtAt: '2026-01-02T03:04:05.000Z',
  }
  const older = deriveOlderBuild(options.buildDirectory, olderIdentity)
  const upstream = new URL(options.backend)
  let version: 'OLD' | 'NEW' = 'OLD'
  let cut: RegExp | null = null

  function send(
    outgoing: ServerResponse,
    status: number,
    headers: OutgoingHttpHeaders,
    body: string | Buffer,
  ): void {
    outgoing.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) })
    outgoing.end(body)
  }

  function forward(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
    rewriteShell: boolean,
  ): void {
    const headers = { ...incoming.headers }
    // Pas de compression : la coquille de la version précédente est réécrite en texte.
    delete headers['accept-encoding']
    const forwarded = httpRequest(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: incoming.method,
        path: incoming.url,
        headers: { ...headers, 'x-forwarded-for': incoming.socket.remoteAddress ?? '' },
      },
      (response) => {
        const type = String(response.headers['content-type'] ?? '')
        if (!rewriteShell || !type.includes('text/html')) {
          outgoing.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(outgoing)
          return
        }
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8')
          for (const [from, to] of older.renamed) html = replaceAll(html, from, to)
          const replaced = { ...response.headers }
          delete replaced['content-length']
          delete replaced['transfer-encoding']
          send(outgoing, response.statusCode ?? 502, replaced, html)
        })
      },
    )
    forwarded.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    incoming.pipe(forwarded)
  }

  const server = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url ?? '/', 'http://proxy').pathname
    if (cut !== null && cut.test(path)) {
      // Serveur « injoignable » : la connexion est fermée sans réponse.
      incoming.socket.destroy()
      return
    }
    if (version === 'OLD') {
      if (path === '/sw.js') {
        send(
          outgoing,
          200,
          {
            'content-type': CONTENT_TYPES['js'] ?? 'text/javascript',
            'service-worker-allowed': '/',
            'cache-control': 'no-cache, must-revalidate',
          },
          older.serviceWorker,
        )
        return
      }
      const asset = /^\/build\/assets\/([^/]+)$/.exec(path)?.[1]
      const body = asset === undefined ? undefined : older.assets.get(decodeURIComponent(asset))
      if (asset !== undefined && body !== undefined) {
        const extension = asset.split('.').pop() ?? ''
        send(
          outgoing,
          200,
          {
            'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
          },
          body,
        )
        return
      }
    }
    forward(incoming, outgoing, version === 'OLD')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  let stopped = false
  return {
    origin: `http://127.0.0.1:${options.port}`,
    older: olderIdentity,
    current,
    renamed: older.renamed,
    serve(next) {
      version = next
    },
    cut(pattern) {
      cut = pattern
    },
    async stop() {
      if (stopped) return
      stopped = true
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TlsProxy {
  /** Origine publique en HTTPS, par exemple https://cabinet.eeo-e2e.test:8126. */
  origin: string
  /** Arrête le proxy et coupe les connexions ouvertes. */
  stop(): Promise<void>
}

export interface TlsProxyOptions {
  /** Nom d'hôte du certificat et de l'origine publique ; le navigateur doit le résoudre vers 127.0.0.1. */
  hostname: string
  /** Port d'écoute HTTPS (127.0.0.1). */
  port: number
  /** URL HTTP du serveur PHP derrière le proxy, par exemple http://127.0.0.1:8125. */
  target: string
}

/**
 * Certificat auto-signé de courte durée, généré à chaque exécution avec openssl (présent sur les
 * runners GitHub, sous Linux, macOS et Git Bash). Ni certificat ni clé n'est versionné : une clé
 * privée dans un dépôt public serait signalée par les analyseurs de secrets même si elle est factice.
 * Les fichiers temporaires sont supprimés dès la lecture.
 */
function selfSignedCertificate(hostname: string): { key: string; cert: string } {
  const directory = mkdtempSync(join(tmpdir(), 'eeo-e2e-tls-'))
  const keyFile = join(directory, 'key.pem')
  const certFile = join(directory, 'cert.pem')

  try {
    execFileSync(
      'openssl',
      [
        ...['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'],
        ...['-days', '1', '-subj', `/CN=${hostname}`, '-addext', `subjectAltName=DNS:${hostname}`],
        ...['-keyout', keyFile, '-out', certFile],
      ],
      { stdio: 'pipe' },
    )
    return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') }
  } catch (error) {
    throw new Error(
      'Certificat de test impossible à générer : le test HTTPS exige la commande « openssl ».',
      { cause: error },
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Proxy inverse qui termine TLS, comme nginx, Apache, un répartiteur de charge ou un CDN devant un
 * hébergement PHP : le navigateur parle HTTPS au proxy, le proxy parle HTTP simple au serveur PHP en
 * conservant l'en-tête Host et en ajoutant X-Forwarded-Proto: https. Le serveur PHP ne voit donc
 * jamais « https » dans la requête, seulement cet en-tête (que Laravel ignore tant que le proxy n'est
 * pas déclaré approuvé).
 */
export async function startTlsProxy(options: TlsProxyOptions): Promise<TlsProxy> {
  const upstream = new URL(options.target)

  const server = createServer(selfSignedCertificate(options.hostname), (incoming, outgoing) => {
    const forwarded = httpRequest(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: incoming.method,
        path: incoming.url,
        headers: {
          ...incoming.headers,
          'x-forwarded-proto': 'https',
          'x-forwarded-for': incoming.socket.remoteAddress ?? '',
        },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      },
    )

    forwarded.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    incoming.on('error', () => {
      forwarded.destroy()
    })
    outgoing.on('error', () => {
      forwarded.destroy()
    })
    incoming.pipe(forwarded)
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
    origin: `https://${options.hostname}:${options.port}`,
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

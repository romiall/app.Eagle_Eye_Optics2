import { expect, type Page } from '@playwright/test'

import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import { chromiumLaunchOptions } from './support/chromium'
import { startLaravelServer, type RunningServer } from './support/laravel-server'
import { HTTPS_BACKEND_PORT, HTTPS_HOSTNAME, HTTPS_PROXY_PORT } from './support/ports'
import { test } from './support/test'
import { startTlsProxy, type TlsProxy } from './support/tls-proxy'

/**
 * Origine HTTPS derrière un proxy qui termine TLS (hébergeur, répartiteur de charge, CDN).
 *
 * Tous les autres tests e2e tournent en http://127.0.0.1, que Chromium exempte des règles de contenu
 * mixte : une coquille qui référencerait ses scripts en http:// y paraîtrait saine. Ici, la page est
 * chargée en https://<nom du cabinet>:<port>, le serveur PHP derrière le proxy ne voit que du HTTP
 * (X-Forwarded-Proto: https), exactement comme en production, et APP_URL vaut l'URL HTTPS publique.
 *
 * Défaut reproduit avant correction : Laravel écrivait des URL d'assets absolues en http://…, Chromium
 * bloquait le script (« Mixed Content »), la page restait vide et le service worker n'était jamais
 * enregistré.
 */

// Navigateur de ce fichier uniquement (les autres fichiers ne reçoivent aucun de ces réglages) :
//  - le nom d'hôte du cabinet désigne cette machine (TLD « .test » réservé, jamais résolu ailleurs) ;
//  - aucun proxy : le bac à sable de développement cloud en impose un par variable d'environnement ;
//  - le certificat auto-signé du proxy de test est accepté. L'option ignoreHTTPSErrors de Playwright
//    ne suffit pas : Chromium refuse alors d'enregistrer le service worker (erreur de récupération
//    du script), seul l'indicateur de lancement couvre aussi cette requête.
test.use({
  launchOptions: chromiumLaunchOptions([
    `--host-resolver-rules=MAP ${HTTPS_HOSTNAME} 127.0.0.1`,
    '--no-proxy-server',
    '--ignore-certificate-errors',
  ]),
})

test.describe('origine HTTPS derrière un proxy qui termine TLS', () => {
  const origin = `https://${HTTPS_HOSTNAME}:${HTTPS_PROXY_PORT}`
  let backend: RunningServer | undefined
  let proxy: TlsProxy | undefined

  test.beforeAll(async () => {
    backend = await startLaravelServer(HTTPS_BACKEND_PORT, { APP_URL: origin })
    proxy = await startTlsProxy({
      hostname: HTTPS_HOSTNAME,
      port: HTTPS_PROXY_PORT,
      target: backend.url,
    })
  })

  test.afterAll(async () => {
    await proxy?.stop()
    await backend?.stop()
  })

  /**
   * Ouvre une URL de l'application et attend le rendu de la coquille. Une page vide (script bloqué)
   * échoue ici avec un message clair, au lieu d'expirer en attendant un service worker jamais
   * enregistré.
   */
  async function openShell(page: Page, path = '/'): Promise<void> {
    await page.goto(`${origin}${path}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }

  test('affiche la coquille en français, sans erreur de console ni contenu mixte', async ({
    page,
  }) => {
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text())
    })
    page.on('pageerror', (error) => problems.push(error.message))

    await page.goto(`${origin}/`)

    expect(new URL(page.url()).protocol).toBe('https:')
    // Sans session, la coquille ouvre la connexion (F09).
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
    await expect(page.locator('#app')).not.toBeEmpty()
    // Seul le refus 401 de /auth/me (aucune session), que le navigateur note en console, est admis.
    expect(problems.filter((problem) => !problem.includes('401'))).toEqual([])
  })

  test('enregistre le service worker avec la portée de l’origine HTTPS', async ({ page }) => {
    await openShell(page)

    expect(await activeServiceWorkerScope(page)).toBe(`${origin}/`)

    const script = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return registration.active?.scriptURL ?? null
    })
    expect(script).toBe(`${origin}/sw.js`)
  })

  test('toutes les requêtes, service worker compris, restent en HTTPS sur l’origine du cabinet', async ({
    page,
    context,
  }) => {
    const requested = recordRequests(context)

    await openShell(page)
    await activeServiceWorkerScope(page)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Le script de la coquille et sa feuille de style sont bien passés par le proxy.
    expect(requested.some((url) => /\/build\/assets\/main-[\w-]+\.js$/.test(url))).toBe(true)
    expect(requested.some((url) => /\/build\/assets\/main-[\w-]+\.css$/.test(url))).toBe(true)

    expect(requested.filter((url) => url.startsWith('http:'))).toEqual([])
    expect(foreignRequests(requested, origin)).toEqual([])
  })

  test('une URL profonde du routeur charge ses assets depuis la racine du site', async ({
    page,
  }) => {
    // Un chemin relatif au document (« build/assets/… ») casserait à cette profondeur ; un chemin depuis
    // la racine fonctionne partout.
    await openShell(page, '/ventes/factures/01HZY3K9Q2A7B6C5D4E3F2G1H0')

    // Sans session : connexion, avec le chemin demandé pour y revenir ensuite.
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('suite')).toBe(
      '/ventes/factures/01HZY3K9Q2A7B6C5D4E3F2G1H0',
    )
    await expect(page.locator('script[type="module"][src]')).toHaveAttribute(
      'src',
      /^\/build\/assets\/main-[\w-]+\.js$/,
    )
  })
})

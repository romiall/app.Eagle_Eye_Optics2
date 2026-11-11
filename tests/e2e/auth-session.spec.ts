import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { activeServiceWorkerScope } from './support/browser'
import { startLaravelServer } from './support/laravel-server'
import { AUTH_OFFLINE_PORT } from './support/ports'
import { test } from './support/test'

// Comptes de démonstration FICTIFS créés par prepare-env.mjs (mots de passe aléatoires, fichier ignoré).
interface DemoAccount {
  login: string
  role: string
  password: string | null
}

const accounts = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'storage', 'framework', 'testing', 'e2e-accounts.json'),
    'utf8',
  ),
) as DemoAccount[]

function account(role: string): { login: string; password: string } {
  const found = accounts.find((candidate) => candidate.role === role)
  if (!found?.password)
    throw new Error(`Compte de démonstration ${role} absent : relancer prepare-env.`)
  return { login: found.login, password: found.password }
}

interface ApiResult {
  status: number
  cacheControl: string | null
  json: unknown
}

/** Appel de l'API depuis la page, comme la SPA : cookie de session + en-tête X-XSRF-TOKEN. */
async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  withCsrf = true,
): Promise<ApiResult> {
  return page.evaluate(
    async ({ method, path, body, withCsrf }) => {
      const xsrf = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
        ?.slice('XSRF-TOKEN='.length)
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
      if (withCsrf && xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf)
      const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      return {
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        json: text === '' ? null : (JSON.parse(text) as unknown),
      }
    },
    { method, path, body, withCsrf },
  )
}

async function signIn(page: Page, role: string): Promise<ApiResult> {
  const csrf = await api(page, 'GET', '/api/sanctum/csrf-cookie')
  expect(csrf.status).toBe(204)
  return api(page, 'POST', '/api/v1/auth/login', account(role))
}

test.describe('session SPA du personnel (Sanctum, CSRF) sur la vraie application', () => {
  test('connexion avec jeton CSRF, /auth/me jamais mis en cache, déconnexion qui ferme la session', async ({
    page,
  }) => {
    await page.goto('/')

    const login = await signIn(page, 'CASHIER')
    expect(login.status).toBe(200)
    expect(login.json).toMatchObject({ data: { login: 'demo.caisse', roles: ['CASHIER'] } })

    const me = await api(page, 'GET', '/api/v1/auth/me')
    expect(me.status).toBe(200)
    expect(me.cacheControl).toContain('no-store')
    expect((me.json as { data: { permissions: string[] } }).data.permissions).toContain(
      'payment.collect',
    )

    // Le cookie de session est HttpOnly : invisible du JavaScript de la page.
    const visibleCookies = await page.evaluate(() => document.cookie)
    expect(visibleCookies).not.toMatch(/session/i)

    expect((await api(page, 'POST', '/api/v1/auth/logout')).status).toBe(204)
    const after = await api(page, 'GET', '/api/v1/auth/me')
    expect(after.status).toBe(401)
    expect(after.json).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('sans Fetch Metadata « same-origin », une écriture sans jeton CSRF répond 419', async ({
    page,
    baseURL,
  }) => {
    // Laravel 13 accepte une écriture marquée Sec-Fetch-Site: same-origin (en-tête qu'une page ne peut
    // pas forger) ; sinon le jeton XSRF est exigé. Le contexte de requêtes de Playwright partage les
    // cookies de la page mais n'envoie pas Sec-Fetch-Site : il joue un navigateur ancien ou un appel
    // intersite qui porterait le cookie de session.
    await page.goto('/')
    expect((await api(page, 'GET', '/api/sanctum/csrf-cookie')).status).toBe(204)
    const origin = new URL(baseURL ?? '').origin

    for (const fetchSite of [undefined, 'cross-site', 'same-site']) {
      const response = await page.context().request.post('/api/v1/auth/login', {
        data: account('MANAGER'),
        headers: {
          Accept: 'application/json',
          Origin: origin,
          Referer: `${origin}/`,
          ...(fetchSite === undefined ? {} : { 'Sec-Fetch-Site': fetchSite }),
        },
      })
      expect(response.status(), `Sec-Fetch-Site: ${fetchSite ?? 'absent'}`).toBe(419)
      expect(await response.json()).toMatchObject({ error: { code: 'SESSION_CONTEXT_EXPIRED' } })
    }
  })

  test('une origine tierce n’obtient jamais de session : connexion refusée explicitement', async ({
    page,
  }) => {
    await page.goto('/')
    const response = await page.context().request.post('/api/v1/auth/login', {
      data: account('MANAGER'),
      headers: {
        Accept: 'application/json',
        Origin: 'https://evil.example',
        Referer: 'https://evil.example/',
      },
    })

    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'SESSION_REQUIRED' } })
    expect(response.headers()['access-control-allow-origin']).toBeUndefined()
  })

  test('les droits sont vérifiés par le serveur : la caisse ne voit pas les comptes, la gérante oui', async ({
    browser,
  }) => {
    const cashierContext = await browser.newContext()
    const cashier = await cashierContext.newPage()
    await cashier.goto('/')
    expect((await signIn(cashier, 'CASHIER')).status).toBe(200)
    const forbidden = await api(cashier, 'GET', '/api/v1/staff')
    expect(forbidden.status).toBe(403)
    expect(forbidden.json).toMatchObject({ error: { code: 'ACTION_FORBIDDEN' } })
    await cashierContext.close()

    const managerContext = await browser.newContext()
    const manager = await managerContext.newPage()
    await manager.goto('/')
    expect((await signIn(manager, 'MANAGER')).status).toBe(200)
    const staff = await api(manager, 'GET', '/api/v1/staff')
    expect(staff.status).toBe(200)
    const logins = (staff.json as { data: { login: string }[] }).data.map((member) => member.login)
    expect(logins).toEqual(expect.arrayContaining(['demo.caisse', 'demo.gerante']))
    await managerContext.close()
  })

  test('une réponse /api authentifiée n’est jamais servie hors ligne par le service worker', async ({
    page,
  }) => {
    // Origine dédiée (port voisin) déclarée comme origine de la SPA pour ce serveur.
    const server = await startLaravelServer(AUTH_OFFLINE_PORT, {
      SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${AUTH_OFFLINE_PORT}`,
      APP_URL: `http://127.0.0.1:${AUTH_OFFLINE_PORT}`,
    })
    try {
      await page.goto(`${server.url}/`)
      await activeServiceWorkerScope(page)
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)

      expect((await signIn(page, 'RECEPTION')).status).toBe(200)
      expect((await api(page, 'GET', '/api/v1/auth/me')).status).toBe(200)

      await server.stop()

      const offline = await page.evaluate(async () => {
        const outcomes: string[] = []
        for (const cache of ['default', 'force-cache'] as const) {
          try {
            const response = await fetch('/api/v1/auth/me', { cache })
            outcomes.push(`reponse-${response.status}`)
          } catch {
            outcomes.push('echec-reseau')
          }
        }
        return outcomes
      })
      expect(offline).toEqual(['echec-reseau', 'echec-reseau'])
    } finally {
      await server.stop()
    }
  })
})

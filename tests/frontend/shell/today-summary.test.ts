import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEeoApp } from '@/app/bootstrap'
import type { NavigationCatalog } from '@/app/navigation'
import { resetNetworkForTests } from '@/app/network'
import { resetSessionForTests } from '@/app/session'

import { meResponse } from './server'

/**
 * Bandeau « Aujourd’hui » de l'accueil (`TodaySummary` / `TodayFigures`) :
 * les tuiles d'alertes de stock bas et de péremption s'affichent seulement si `stock.read` est
 * présent ET que le module `stock` est ouvert, affichent les totaux exacts du serveur, mènent
 * vers `/stock/alertes` (`stock-alerts`), et n'inventent jamais zéro en cas d'échec.
 */
const TEST_CATALOG: NavigationCatalog = {
  modules: [
    {
      id: 'stock',
      label: 'Stock',
      path: '/stock',
      permissions: ['stock.read'],
      deliveredBy: 'I00',
      delivered: true,
      mobileShortcut: false,
    },
  ],
  homeActions: [],
}

const Screen = (title: string) => defineComponent({ render: () => h('h1', title) })

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function openHomeWithAlerts(options: {
  permissions: string[]
  enabledModules: string[]
  lowTotal?: number
  expiryTotal?: number
  failAlerts?: boolean
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsed = new URL(rawUrl, 'http://localhost')

    if (parsed.pathname === '/api/v1/auth/me') {
      return json(200, meResponse(options.permissions, 'Gérante Fictive', options.enabledModules))
    }

    if (parsed.pathname === '/api/v1/stock/alerts') {
      if (options.failAlerts) {
        return json(503, {
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Serveur indisponible' },
        })
      }
      const kind = parsed.searchParams.get('kind')
      const total = kind === 'LOW_STOCK' ? (options.lowTotal ?? 0) : (options.expiryTotal ?? 0)
      return json(200, {
        data: [],
        meta: { current_page: 1, last_page: 1, per_page: 25, total },
      })
    }

    return json(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'Route inattendue' } })
  })

  vi.stubGlobal('fetch', fetchMock)

  const { app, router } = createEeoApp(createMemoryHistory(), { navigation: TEST_CATALOG })
  router.addRoute({
    path: '/stock',
    name: 'stock',
    component: Screen('Stock'),
    meta: { module: 'stock', permissions: ['stock.read'] },
  })
  router.addRoute({
    path: '/stock/alertes',
    name: 'stock-alerts',
    component: Screen('Alertes et seuils de stock'),
    meta: { module: 'stock', permissions: ['stock.read'] },
  })

  await router.push('/')
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await flushPromises()
  return { root, router, fetchMock, unmount: () => app.unmount() }
}

afterEach(() => {
  resetSessionForTests()
  resetNetworkForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('tuiles d’alerte de stock sur l’accueil (EE026)', () => {
  it('masque les tuiles et ne lit pas /stock/alerts si le module stock est fermé ou sans droit', async () => {
    const closed = await openHomeWithAlerts({
      permissions: ['stock.read'],
      enabledModules: ['today'],
    })
    expect(closed.root.textContent).not.toContain('Alertes stock bas')
    expect(
      closed.fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/stock/alerts')),
    ).toHaveLength(0)
    closed.unmount()

    resetSessionForTests()
    const forbidden = await openHomeWithAlerts({
      permissions: ['patient.read'],
      enabledModules: ['stock'],
    })
    expect(forbidden.root.textContent).not.toContain('Alertes stock bas')
    expect(
      forbidden.fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/stock/alerts')),
    ).toHaveLength(0)
    forbidden.unmount()
  })

  it('affiche les compteurs exacts d’alertes ouvertes et les liens vers /stock/alertes', async () => {
    const { root, router, fetchMock, unmount } = await openHomeWithAlerts({
      permissions: ['stock.read'],
      enabledModules: ['stock'],
      lowTotal: 3,
      expiryTotal: 1,
    })

    const text = root.textContent ?? ''
    expect(text).toContain('Alertes stock bas')
    expect(text).toContain('3')
    expect(text).toContain('Alertes péremption')
    expect(text).toContain('1')

    const alertLinks = [...root.querySelectorAll('a')].filter(
      (a) => a.getAttribute('href') === '/stock/alertes',
    )
    expect(alertLinks.length).toBeGreaterThanOrEqual(2)

    const refreshButton = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Actualiser les chiffres'),
    )
    expect(refreshButton).toBeDefined()
    refreshButton?.click()
    await flushPromises()

    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/stock/alerts')).length,
    ).toBe(4)
    expect(router.currentRoute.value.path).toBe('/')
    unmount()
  })

  it('n’invente jamais zéro lorsque la lecture des alertes échoue', async () => {
    const { root, unmount } = await openHomeWithAlerts({
      permissions: ['stock.read'],
      enabledModules: ['stock'],
      failAlerts: true,
    })

    const text = root.textContent ?? ''
    expect(text).toContain('Alertes stock bas')
    expect(text).toContain('Alertes péremption')
    expect(text).toContain('—')
    expect(text).toContain('Serveur indisponible pour l’instant')
    unmount()
  })
})

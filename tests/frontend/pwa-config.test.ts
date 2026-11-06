import { describe, expect, it } from 'vitest'

import {
  NAVIGATE_FALLBACK_DENYLIST,
  PWA_ICONS,
  SHELL_URL,
  createPwaOptions,
  staticPrecacheEntries,
} from '@/app/pwa.config'

const options = createPwaOptions({ '/icons/icon-192.png': 'abc' }, 'revision-de-test')
const workbox = options.workbox ?? {}

/** Reproduit le test de Workbox : la liste est évaluée sur chemin + requête. */
function isDeniedForShellFallback(pathWithQuery: string): boolean {
  return NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathWithQuery))
}

describe('configuration PWA : jamais d’API en cache ni de repli SPA sur /api', () => {
  it.each([
    '/api',
    '/api/',
    '/api/v1',
    '/api/v1/patients',
    '/api/v1/patients/01HZY3K9Q2A7B6C5D4E3F2G1H0/history?x=1',
    '/api/sanctum/csrf-cookie',
  ])('refuse le repli SPA pour %s', (url) => {
    expect(isDeniedForShellFallback(url)).toBe(true)
  })

  it.each([
    '/up',
    '/sw.js',
    '/manifest.webmanifest',
    '/build/assets/main-abc123.js',
    '/storage/documents/facture.pdf',
    // Sans extension : seul le préfixe du chemin exclut la coquille (fichiers privés, O06).
    '/storage',
    '/storage/',
    '/storage/documents/facture-privee',
    '/build/inconnu',
    '/icons/icon-192.png',
    '/robots.txt',
  ])('refuse le repli SPA pour la ressource %s', (url) => {
    expect(isDeniedForShellFallback(url)).toBe(true)
  })

  it.each([
    '/',
    '/patients',
    '/ventes/factures/01HZY3K9Q2A7B6C5D4E3F2G1H0',
    '/apis',
    '/patients?recherche=jean.dupont',
    '/agenda?date=2026-10-14',
  ])('accorde le repli SPA aux URL de navigation du routeur : %s', (url) => {
    expect(isDeniedForShellFallback(url)).toBe(false)
  })

  it('utilise « / » comme coquille de repli, précachée avec sa révision', () => {
    expect(workbox.navigateFallback).toBe(SHELL_URL)
    expect(workbox.additionalManifestEntries).toContainEqual({
      url: SHELL_URL,
      revision: 'revision-de-test',
    })
  })

  it('transmet au service worker la même liste de refus que celle testée ici', () => {
    expect(workbox.navigateFallbackDenylist).toEqual([...NAVIGATE_FALLBACK_DENYLIST])
  })

  it('traite /api uniquement par le réseau (NetworkOnly) et ne met rien d’autre en cache à l’exécution', () => {
    const routes = workbox.runtimeCaching ?? []

    expect(routes).toHaveLength(1)
    const [route] = routes
    expect(route?.handler).toBe('NetworkOnly')

    const matches = route?.urlPattern as (context: { url: URL }) => boolean
    expect(matches({ url: new URL('https://app.example.test/api/v1/patients') })).toBe(true)
    expect(matches({ url: new URL('https://app.example.test/api') })).toBe(true)
    expect(matches({ url: new URL('https://app.example.test/patients') })).toBe(false)
  })

  it('ne précache que la coquille, les icônes locales et les fichiers versionnés du build', () => {
    const entries = staticPrecacheEntries({}, 'r')

    expect(entries.map((entry) => entry.url)).toEqual([
      '/',
      ...PWA_ICONS.map((icon) => icon.src),
      '/icons/favicon.svg',
    ])
    expect(entries.some((entry) => entry.url.startsWith('/api'))).toBe(false)
    // Le logo (SVG émis par Vite) est précaché avec le code de l'application.
    expect(workbox.globPatterns).toEqual(['assets/**/*.{js,css,woff2,svg,png}'])
  })

  it('met à jour sur confirmation et sans prise de contrôle immédiate (aucune commande locale interrompue)', () => {
    expect(options.registerType).toBe('prompt')
    expect(workbox.skipWaiting).toBe(false)
    expect(workbox.clientsClaim).toBe(false)
    expect(workbox.inlineWorkboxRuntime).toBe(true)
  })

  it('déclare un manifeste français couvrant toute l’origine', () => {
    const manifest = options.manifest

    expect(manifest).toBeTruthy()
    if (!manifest) return
    expect(manifest.lang).toBe('fr')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons?.map((icon) => icon.sizes)).toEqual(['192x192', '512x512', '512x512'])
    expect(manifest.icons?.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })
})

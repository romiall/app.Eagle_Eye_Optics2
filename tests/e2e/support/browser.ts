import type { BrowserContext, Page } from '@playwright/test'

/**
 * Attend que le service worker soit actif et retourne sa portée. Sans service worker (page servie par un serveur
 * Vite de développement, build absent ou cassé), `ready` ne se résout jamais : l'attente est bornée à 60 s pour
 * que le test échoue avec la cause plutôt qu'à son délai global.
 */
export async function activeServiceWorkerScope(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Aucun service worker actif après 60 s : la page vient-elle d’un serveur Vite (public/hot) ou d’un build absent ?',
              ),
            ),
          60_000,
        ),
      ),
    ])
    return registration.scope
  })
}

/** URL de toutes les requêtes émises par le contexte : pages, iframes et service worker compris. */
export function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = []
  context.on('request', (request) => urls.push(request.url()))
  return urls
}

/** Requêtes réseau (http, https, ws, wss) dont l’origine n’est pas celle de l’application. */
export function foreignRequests(urls: readonly string[], origin: string): string[] {
  return urls.filter((url) => /^(?:https?|wss?):/.test(url) && new URL(url).origin !== origin)
}

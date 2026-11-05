import { useRouter, type Router } from 'vue-router'

import { currentPermissions, enabledModules, session } from '@/app/session'

/**
 * État d'un écran cité par l'aide (« Ensuite ») pour un compte, calculé comme le fait le routeur au moment
 * d'ouvrir l'écran (app/router.ts) : l'aide ne propose jamais un lien qui mènerait à « Accès refusé », à
 * « Page introuvable » ou à l'accueil.
 *
 * - `hidden` : route absente, module fermé par l'exploitant, ou aucun des droits de l'écran ;
 * - `server` : session locale (poste préparé, serveur arrêté) et écran qui lit le serveur : il reste
 *   fermé, l'aide le nomme sans lien et ajoute « demande le serveur » (comme l'accueil) ;
 * - `open` : lien normal.
 *
 * Les droits ne servent qu'à choisir ce que l'aide montre, jamais à autoriser une action.
 */
export type HelpLinkState = 'open' | 'hidden' | 'server'

/** Ce qui détermine l'état d'un lien : droits et modules du lecteur, session locale ou non. */
export interface HelpLinkContext {
  readonly permissions: readonly string[]
  readonly modules: readonly string[]
  readonly local: boolean
}

export function resolveLinkState(
  router: Router,
  route: string,
  context: HelpLinkContext,
): HelpLinkState {
  if (!router.hasRoute(route)) return 'hidden'
  let meta: Record<string, unknown>
  try {
    meta = router.resolve({ name: route }).meta
  } catch {
    return 'hidden'
  }
  const needed = Array.isArray(meta['permissions']) ? (meta['permissions'] as string[]) : undefined
  const allowed = needed === undefined || needed.some((code) => context.permissions.includes(code))
  if (context.local) {
    if (meta['offlineCapable'] !== true) return 'server'
    return allowed ? 'open' : 'hidden'
  }
  const module = typeof meta['module'] === 'string' ? meta['module'] : undefined
  if (module !== undefined && !context.modules.includes(module)) return 'hidden'
  return allowed ? 'open' : 'hidden'
}

/** Même calcul pour le compte connecté (le bouton « Aide » de l'en-tête). */
export function useHelpLinkState(): (route: string) => HelpLinkState {
  const router = useRouter()
  return (route) =>
    resolveLinkState(router, route, {
      permissions: currentPermissions.value,
      modules: enabledModules.value,
      local: session.status === 'local',
    })
}

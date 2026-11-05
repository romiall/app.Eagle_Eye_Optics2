import type { HelpAccess, HelpAction, HelpBlock, HelpTask, PageHelp } from './model'

/**
 * Règles pures de l'aide : qui voit quoi, découpage des libellés d'un texte, adresse (ancre) d'une
 * rubrique. Ni Vue, ni routeur, ni stockage.
 */

/** Une rubrique ou une fiche est visible : module ouvert (s'il en faut un) ET un des droits (s'il en faut). */
export function hasAccess(
  access: HelpAccess,
  permissions: readonly string[],
  modules: readonly string[],
): boolean {
  if (access.module !== null && !modules.includes(access.module)) return false
  return (
    access.anyPermission.length === 0 ||
    access.anyPermission.some((code) => permissions.includes(code))
  )
}

function allowed(
  anyPermission: readonly string[] | undefined,
  permissions: readonly string[],
): boolean {
  return (
    anyPermission === undefined ||
    anyPermission.length === 0 ||
    anyPermission.some((code) => permissions.includes(code))
  )
}

/** Actions de l'écran que ce compte peut faire. */
export function actionsFor(help: PageHelp, permissions: readonly string[]): HelpAction[] {
  return help.actions.filter((action) => allowed(action.anyPermission, permissions))
}

/** Tâches « Pas à pas » que ce compte peut faire. */
export function tasksFor(help: PageHelp, permissions: readonly string[]): HelpTask[] {
  return help.tasks.filter((task) => allowed(task.anyPermission, permissions))
}

/** Nombre d'actions et de tâches réservées à d'autres comptes (pour le dire, sans les montrer). */
export function hiddenCount(help: PageHelp, permissions: readonly string[]): number {
  return (
    help.actions.length -
    actionsFor(help, permissions).length +
    (help.tasks.length - tasksFor(help, permissions).length)
  )
}

export type InlineSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'label'; readonly value: string }

/**
 * Découpe un texte d'aide : les libellés d'écran, écrits « comme ceci », sont rendus en puces
 * distinctes ; le reste est du texte simple (aucun HTML n'est jamais interprété).
 */
export function splitInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  const pattern = /«\s*([^»]+?)\s*»/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > last) segments.push({ kind: 'text', value: text.slice(last, start) })
    segments.push({ kind: 'label', value: match[1] ?? '' })
    last = start + match[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) })
  return segments
}

/** Où l'on est dans la documentation : accueil, une rubrique ou la fiche d'un écran. */
export type HelpLocation =
  | { readonly kind: 'home' }
  | { readonly kind: 'topic'; readonly id: string }
  | { readonly kind: 'screen'; readonly route: string }

/** Ancre d'une rubrique (`#/parcours-vente`) ou d'un écran (`#/ecran/patients`). */
export function hashFor(location: HelpLocation): string {
  if (location.kind === 'topic') return `#/${location.id}`
  if (location.kind === 'screen') return `#/ecran/${location.route}`
  return ''
}

/** Lit l'ancre de l'adresse ; toute valeur inconnue ou mal formée mène à l'accueil. */
export function parseHash(hash: string): HelpLocation {
  const match = /^#\/(ecran\/)?([a-z0-9-]+)$/.exec(hash)
  if (match === null || match[2] === undefined) return { kind: 'home' }
  return match[1] === undefined
    ? { kind: 'topic', id: match[2] }
    : { kind: 'screen', route: match[2] }
}

/** Tous les textes d'un bloc, pour la recherche. */
export function blockText(block: HelpBlock): string[] {
  switch (block.kind) {
    case 'steps':
    case 'points':
      return [block.title ?? '', ...block.items]
    case 'note':
      return [block.text]
    case 'flow':
      return [block.title ?? '', ...block.stages.flatMap((stage) => [stage.label, stage.text])]
    case 'table':
      return [block.title ?? '', ...block.head, ...block.rows.flat()]
    case 'faq':
      return [block.title ?? '', ...block.items.flatMap((item) => [item.q, item.a])]
    case 'terms':
      return [block.title ?? '', ...block.items.flatMap((item) => [item.term, item.definition])]
  }
}

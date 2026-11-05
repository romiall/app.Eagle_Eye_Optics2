import type { HandbookPart, HandbookTopic, PageHelp, ProfileCode } from '@/domain/help/model'
import { KNOWN_MODULES, profileByCode } from '@/domain/help/profiles'
import { hasAccess, hashFor, type HelpLocation } from '@/domain/help/rules'

/**
 * Règles pures de l'écran « Documentation » (`HelpPage.vue`) : qui lit, ce que cette personne voit, les
 * groupes de la « Référence des écrans », les cartes « Par où commencer », la rubrique voisine. Ni Vue, ni
 * routeur, ni stockage, ni réseau : le contenu est fourni par l'appelant (chargé à la demande).
 *
 * Les droits ne servent ici qu'à choisir ce que l'on MONTRE (même règle que le menu : module ouvert ET l'un
 * des droits) ; le serveur revérifie chaque action.
 */

/** Droits et modules ouverts de la personne qui lit (le compte connecté, ou un profil simulé). */
export interface Reader {
  readonly permissions: readonly string[]
  readonly modules: readonly string[]
}

/**
 * Lecteur de la documentation. Sans profil choisi, c'est le compte connecté (`own`). Avec un profil, ce sont
 * ses droits par défaut (`profileByCode`) : la gérante vérifie ce que verra chaque membre de l'équipe.
 * `includeClosed` ajoute tous les modules que l'application connaît : on lit alors aussi la documentation de
 * ce que le cabinet n'a pas encore ouvert.
 */
export function readerFor(
  profile: ProfileCode | null,
  includeClosed: boolean,
  own: Reader,
): Reader {
  return {
    permissions: profile === null ? own.permissions : profileByCode(profile).permissions,
    modules: includeClosed ? KNOWN_MODULES : own.modules,
  }
}

/** Parties de la documentation réduites aux rubriques que ce lecteur peut lire ; une partie vide disparaît. */
export function visibleParts(parts: readonly HandbookPart[], reader: Reader): HandbookPart[] {
  return parts.flatMap((part) => {
    const topics = part.topics.filter((topic) =>
      hasAccess(topic, reader.permissions, reader.modules),
    )
    return topics.length === 0 ? [] : [{ ...part, topics }]
  })
}

/** Fiches d'écran que ce lecteur peut lire. */
export function visiblePages(pages: readonly PageHelp[], reader: Reader): PageHelp[] {
  return pages.filter((page) => hasAccess(page, reader.permissions, reader.modules))
}

/** Un groupe de la « Référence des écrans » : les fiches d'un même module, dans l'ordre du contenu. */
export interface ScreenGroup {
  readonly key: string
  readonly title: string
  readonly pages: readonly PageHelp[]
}

/** Groupes de la référence, dans cet ordre ; `null` : les écrans qui ne dépendent d'aucun module. */
const SCREEN_GROUP_TITLES: readonly (readonly [module: string | null, title: string])[] = [
  ['today', 'File du jour'],
  ['patients', 'Patients'],
  ['consultations', 'Consultations'],
  ['agenda', 'Agenda'],
  ['sales', 'Ventes et caisse'],
  ['stock', 'Stock'],
  ['reports', 'Statistiques'],
  ['settings', 'Paramètres'],
  ['offline', 'Postes hors ligne'],
  [null, 'Accès et général'],
]

/** Fiches d'un module que la liste ci-dessus ne connaît pas encore : jamais perdues. */
const OTHER_SCREENS_TITLE = 'Autres écrans'

/** Regroupe des fiches d'écran par module ; un groupe sans fiche n'est pas rendu. */
export function screenGroups(pages: readonly PageHelp[]): ScreenGroup[] {
  const groups: ScreenGroup[] = SCREEN_GROUP_TITLES.map(([module, title]) => ({
    key: module ?? 'general',
    title,
    pages: pages.filter((page) => page.module === module),
  }))
  const known = new Set(SCREEN_GROUP_TITLES.map(([module]) => module))
  const others = pages.filter((page) => !known.has(page.module))
  if (others.length > 0) groups.push({ key: 'autres', title: OTHER_SCREENS_TITLE, pages: others })
  return groups.filter((group) => group.pages.length > 0)
}

/** Où l'on est : l'accueil, une rubrique, la fiche d'un écran, ou la liste des résultats d'une recherche. */
export type DocPlace = HelpLocation | { readonly kind: 'search' }

/** La rubrique et la partie qui la range (parmi les parties visibles). */
export function findTopic(
  parts: readonly HandbookPart[],
  id: string,
): { part: HandbookPart; topic: HandbookTopic } | undefined {
  for (const part of parts) {
    const topic = part.topics.find((candidate) => candidate.id === id)
    if (topic !== undefined) return { part, topic }
  }
  return undefined
}

/** Rubriques voisines dans la même partie (visibles) : « Précédente » et « Suivante ». */
export function neighbours(
  part: HandbookPart,
  id: string,
): { previous: HandbookTopic | undefined; next: HandbookTopic | undefined } {
  const index = part.topics.findIndex((topic) => topic.id === id)
  if (index === -1) return { previous: undefined, next: undefined }
  return { previous: part.topics[index - 1], next: part.topics[index + 1] }
}

/** Un lien d'une carte « Par où commencer » : le nom de la rubrique et son ancre (`#/identifiant`). */
export interface StartLink {
  readonly label: string
  readonly hash: string
}

export interface StartCard {
  readonly id: string
  readonly title: string
  readonly text: string
  readonly links: readonly StartLink[]
}

function linkTo(topic: HandbookTopic): StartLink {
  return { label: topic.title, hash: hashFor({ kind: 'topic', id: topic.id }) }
}

/**
 * Les cartes « Par où commencer » de l'accueil : cinq questions que se pose une personne qui ouvre la
 * documentation, chacune menant à des rubriques LUES par ce compte. Une carte dont la cible n'est pas
 * visible (profil sans le droit, partie pas encore rédigée) n'est pas montrée. `roles` : les profils de la
 * personne (ou le profil simulé) ; son guide passe en premier.
 */
export function startCards(parts: readonly HandbookPart[], roles: readonly string[]): StartCard[] {
  const topics = parts.flatMap((part) => part.topics)
  const firstOf = (partId: string): HandbookTopic | undefined =>
    parts.find((part) => part.id === partId)?.topics[0]
  const cards: StartCard[] = []

  const welcome = topics.find((topic) => topic.id === 'bienvenue')
  if (welcome !== undefined) {
    cards.push({
      id: 'decouvrir',
      title: 'Je découvre l’outil',
      text: 'À quoi sert l’application et comment elle s’organise.',
      links: [linkTo(welcome)],
    })
  }

  const route = firstOf('parcours')
  if (route !== undefined) {
    cards.push({
      id: 'faire',
      title: 'Je cherche comment faire',
      text: 'Les tâches du cabinet, pas à pas, dans l’ordre du travail réel.',
      links: [linkTo(route)],
    })
  }

  const guides = parts.find((part) => part.id === 'guides-profils')?.topics ?? []
  if (guides.length > 0) {
    const mine = (topic: HandbookTopic): boolean =>
      (topic.audience ?? []).some((code) => roles.includes(code))
    cards.push({
      id: 'profil',
      title: 'Mon profil',
      text: 'Votre journée avec l’application, selon votre métier au cabinet.',
      links: [...guides.filter(mine), ...guides.filter((topic) => !mine(topic))].map(linkTo),
    })
  }

  const installation = topics.find((topic) => topic.id === 'avant-installation')
  if (installation !== undefined) {
    cards.push({
      id: 'installation',
      title: 'Je prépare l’installation',
      text: 'Ce qu’il faut préparer avant l’ouverture au cabinet.',
      links: [linkTo(installation)],
    })
  }

  const words = [firstOf('glossaire'), firstOf('depannage')].filter(
    (topic): topic is HandbookTopic => topic !== undefined,
  )
  if (words.length > 0) {
    cards.push({
      id: 'comprendre',
      title: 'Un mot ou un message que je ne comprends pas',
      text: 'Le glossaire explique les mots ; le dépannage explique les messages.',
      links: words.map(linkTo),
    })
  }

  return cards
}

/** Nombre maximal de résultats montrés (celui de `searchIndex`). */
export const RESULT_LIMIT = 30

/** Texte saisi dans le paramètre d'adresse `q` : une chaîne, ou rien (un paramètre répété prend le premier). */
export function queryText(value: unknown): string {
  const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
  return typeof first === 'string' ? first : ''
}

/** « 3 résultats », « 1 résultat », « Les 30 premiers résultats » (la liste est plafonnée). */
export function resultsTitle(count: number): string {
  if (count === 1) return '1 résultat'
  if (count >= RESULT_LIMIT) return `Les ${RESULT_LIMIT} premiers résultats`
  return `${count} résultats`
}

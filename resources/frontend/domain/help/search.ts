import type { HandbookPart, PageHelp } from './model'
import { blockText } from './rules'

/**
 * Recherche dans la documentation : un index en mémoire construit sur les rubriques et les fiches
 * d'écran que ce compte a le droit de lire (jamais sur le reste), puis une recherche sans accent ni
 * casse où chaque mot saisi doit se retrouver quelque part dans l'entrée. Règles pures.
 */

export type SearchKind = 'topic' | 'screen'

export interface SearchEntry {
  readonly kind: SearchKind
  /** Identifiant de la rubrique, ou nom de la route de l'écran. */
  readonly id: string
  readonly title: string
  /** Partie de la documentation (rubrique) ou « Référence des écrans » (écran). */
  readonly group: string
  readonly summary: string
  /** Textes normalisés (sans accent, en minuscules). */
  readonly titleKey: string
  readonly summaryKey: string
  readonly keywordsKey: string
  readonly bodyKey: string
  /** Phrases d'origine, pour l'extrait. */
  readonly sentences: readonly string[]
}

export interface SearchHit {
  readonly entry: SearchEntry
  readonly score: number
  /** Phrase qui contient le premier mot trouvé (vide si seul le titre correspond). */
  readonly snippet: string
}

/** Minuscules, sans accent, apostrophe droite, espaces simples : la forme sous laquelle on compare. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function sentencesOf(texts: readonly string[]): string[] {
  return texts
    .flatMap((text) => text.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
}

export const SCREENS_GROUP = 'Référence des écrans'

/** Index des rubriques et des écrans fournis (déjà filtrés par droits et modules ouverts). */
export function buildIndex(
  parts: readonly HandbookPart[],
  pages: readonly PageHelp[],
): SearchEntry[] {
  const entries: SearchEntry[] = []
  for (const part of parts) {
    for (const topic of part.topics) {
      const body = [topic.intro ?? '', ...topic.blocks.flatMap((block) => blockText(block))]
      entries.push({
        kind: 'topic',
        id: topic.id,
        title: topic.title,
        group: part.title,
        summary: topic.summary,
        titleKey: normalizeText(topic.title),
        summaryKey: normalizeText(topic.summary),
        keywordsKey: normalizeText((topic.keywords ?? []).join(' ')),
        bodyKey: normalizeText(body.join(' ')),
        sentences: sentencesOf([topic.summary, ...body]),
      })
    }
  }
  for (const page of pages) {
    const body = [
      ...page.actions.flatMap((action) => [action.label, action.effect]),
      ...page.tasks.flatMap((task) => [task.title, ...task.steps, task.result ?? '']),
      ...page.rules,
      ...(page.tips ?? []),
      ...(page.problems ?? []).flatMap((problem) => [problem.symptom, problem.remedy]),
    ]
    entries.push({
      kind: 'screen',
      id: page.route,
      title: page.title,
      group: SCREENS_GROUP,
      summary: page.purpose,
      titleKey: normalizeText(page.title),
      summaryKey: normalizeText(page.purpose),
      keywordsKey: normalizeText((page.terms ?? []).join(' ')),
      bodyKey: normalizeText(body.join(' ')),
      sentences: sentencesOf([page.purpose, ...body]),
    })
  }
  return entries
}

/** Mots de la requête : au moins deux caractères, sans accent. */
export function queryWords(query: string): string[] {
  return normalizeText(query)
    .split(' ')
    .filter((word) => word.length >= 2)
}

function wordScore(entry: SearchEntry, word: string): number {
  let score = 0
  if (entry.titleKey.includes(word)) {
    score += 10
    if (entry.titleKey.split(' ').some((part) => part.startsWith(word))) score += 3
  }
  if (entry.keywordsKey.includes(word)) score += 6
  if (entry.summaryKey.includes(word)) score += 4
  if (entry.bodyKey.includes(word)) score += 1
  return score
}

/** Entrées qui contiennent TOUS les mots, les mieux classées d'abord (titre, mots-clés, résumé, texte). */
export function searchIndex(index: readonly SearchEntry[], query: string, limit = 30): SearchHit[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const entry of index) {
    let total = 0
    let complete = true
    for (const word of words) {
      const score = wordScore(entry, word)
      if (score === 0) {
        complete = false
        break
      }
      total += score
    }
    if (!complete) continue
    const first = words[0] ?? ''
    const snippet =
      entry.sentences.find((sentence) => normalizeText(sentence).includes(first)) ?? ''
    hits.push({
      entry,
      score: total,
      snippet: snippet.length > 180 ? `${snippet.slice(0, 177)}…` : snippet,
    })
  }
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'fr'))
  return hits.slice(0, limit)
}

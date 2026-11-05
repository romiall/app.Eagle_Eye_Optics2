import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrastes de la palette (fichier 04 : « Vérifier le contraste de chaque association et des états
 * désactivés »), charte de la marque Eagle’s Eye Optics (logo du 2026-10-23 : encre #231F20, or
 * #8D7827), calculés selon WCAG 2.2 à partir des jetons réels de
 * resources/frontend/styles/tokens.css. Texte : 4,5:1 au moins (AA texte courant) ; bordures de
 * champ, contour de focus et bordures porteuses d'état : 3:1 au moins (WCAG 1.4.11). Le texte
 * désactivé est tenu à 4,5:1 bien que WCAG l'exempte : il doit rester lisible.
 */
const TOKENS_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'resources',
  'frontend',
  'styles',
  'tokens.css',
)

function readTokens(): Map<string, string> {
  const css = readFileSync(TOKENS_FILE, 'utf8')
  const tokens = new Map<string, string>()
  for (const match of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens.set(match[1] ?? '', (match[2] ?? '').toLowerCase())
  }
  return tokens
}

const tokens = readTokens()

function color(name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`Jeton --color-${name} absent de tokens.css`)
  return value
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(color(foreground)), luminance(color(background))].sort(
    (a, b) => b - a,
  )
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** Associations de texte réellement utilisées par la coquille et les composants. */
const TEXT_PAIRS: readonly [string, string, string][] = [
  ['ink', 'canvas', 'texte courant sur le fond'],
  ['ink', 'surface', 'texte courant sur une surface'],
  ['muted', 'surface', 'aide de champ, texte secondaire'],
  ['muted', 'canvas', 'texte secondaire sur le fond'],
  ['danger', 'canvas', 'erreur sous un champ et « (obligatoire) » sur le fond'],
  ['accent', 'canvas', 'état « Synchronisé » sur le fond'],
  ['primary', 'danger-soft', 'lien d’un message « droits insuffisants »'],
  ['muted', 'primary-soft', 'précision d’une option active'],
  ['primary', 'surface', 'liens, boutons secondaires et discrets'],
  ['primary', 'canvas', 'liens sur le fond'],
  ['primary', 'primary-soft', 'entrée de navigation active ou survolée'],
  ['ink', 'primary-soft', 'texte sur fond d’action léger'],
  ['primary-contrast', 'primary', 'bouton principal'],
  ['primary-contrast', 'primary-strong', 'bouton principal survolé'],
  ['primary-contrast', 'danger', 'bouton d’action risquée'],
  ['primary-contrast', 'danger-strong', 'bouton d’action risquée survolé'],
  ['accent', 'surface', 'état « En ligne », « Synchronisé »'],
  ['ink', 'accent-soft', 'message de succès'],
  ['warning', 'surface', 'état « Hors ligne », « Serveur injoignable »'],
  ['warning', 'canvas', 'fraîcheur incomplète, pièces en attente sur le fond'],
  ['ink', 'warning-soft', 'message de conflit ou de connexion indisponible'],
  ['danger', 'surface', 'message d’erreur sous un champ'],
  ['muted', 'danger-soft', 'espace réservé, icône, chevron et unité d’un champ invalide'],
  ['danger', 'danger-soft', 'titre du résumé d’erreurs'],
  ['ink', 'danger-soft', 'liens du résumé d’erreurs'],
  ['disabled-ink', 'disabled', 'bouton ou champ désactivé'],
  ['gold-ink', 'surface', 'titre de marque, badge doré'],
  ['gold-ink', 'canvas', 'titre de marque sur le fond'],
  ['gold-ink', 'gold-soft', 'badge doré'],
  ['gold-ink', 'primary-soft', 'repère doré sur une entrée active'],
  ['ink', 'gold-soft', 'texte sur fond doré léger'],
  ['muted', 'gold-soft', 'texte secondaire sur fond doré léger'],
  ['accent', 'accent-soft', 'symbole de succès sur son fond'],
  ['warning', 'warning-soft', 'symbole d’avertissement sur son fond'],
]

/** Éléments non textuels porteurs d'information (WCAG 1.4.11). */
const NON_TEXT_PAIRS: readonly [string, string, string][] = [
  ['field', 'surface', 'bordure d’un champ'],
  ['field', 'canvas', 'bordure d’un champ sur le fond'],
  ['danger', 'surface', 'bordure d’un champ invalide'],
  [
    'danger',
    'danger-soft',
    'bordure et contour de focus d’un champ invalide, sur son fond d’erreur',
  ],
  ['danger-strong', 'danger-soft', 'bordure d’un champ invalide survolé'],
  ['primary', 'surface', 'contour de focus, bordure de bouton secondaire'],
  ['primary', 'canvas', 'contour de focus sur le fond'],
  ['primary', 'primary-soft', 'repère de l’option active'],
  ['gold', 'surface', 'filet doré, repère de l’entrée active, icône'],
  ['gold', 'canvas', 'filet doré sur le fond'],
  ['gold', 'primary-soft', 'repère doré de l’entrée de navigation active'],
  ['gold', 'primary', 'filet doré sur un fond d’encre'],
]

/** Teintes seulement décoratives (séparateurs, fonds d'encadré bordés d'une teinte vérifiée). */
const DECORATIVE = new Set(['line'])

describe('palette de la marque', () => {
  it('reprend l’encre et l’or du logo, sur des surfaces blanches', () => {
    expect(color('surface')).toBe('#ffffff')
    expect(color('ink')).toBe('#231f20')
    expect(color('gold')).toBe('#8d7827')
    // L'or du logo n'est pas assez contrasté pour du petit texte : le texte doré a sa propre teinte.
    expect(contrast('gold', 'surface')).toBeLessThan(4.5)
    expect(contrast('gold-ink', 'surface')).toBeGreaterThanOrEqual(4.5)
  })

  it.each(TEXT_PAIRS)('texte %s sur %s (%s) : au moins 4,5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('élément %s sur %s (%s) : au moins 3:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('vérifie chaque teinte définie : une nouvelle teinte doit entrer dans une association', () => {
    const used = new Set(
      [...TEXT_PAIRS, ...NON_TEXT_PAIRS].flatMap(([foreground, background]) => [
        foreground,
        background,
      ]),
    )
    const unchecked = [...tokens.keys()].filter((name) => !used.has(name) && !DECORATIVE.has(name))
    expect(unchecked).toEqual([])
    expect(tokens.size).toBeGreaterThanOrEqual(18)
  })

  it('n’utilise aucune fonte distante : police système seulement', () => {
    const css = readFileSync(TOKENS_FILE, 'utf8')
    expect(css).toMatch(/--font-sans:\s*system-ui/)
    expect(css).not.toMatch(/@font-face|url\(/i)
  })
})

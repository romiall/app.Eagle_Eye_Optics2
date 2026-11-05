// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Le pied de page de version (`AppVersion.vue`) est présent sur CHAQUE écran. Playwright accepte un nom de bouton quand
 * le nom accessible le CONTIENT (sans `exact: true`) : un bouton « Rechercher une nouvelle version » rendait ambigus
 * (violation du mode strict) les sélecteurs `getByRole('button', { name: 'Rechercher' })` des parcours des patients, de la
 * mise en page des formulaires et du travail hors ligne, dont l'échec laissait même la caisse hors ligne réservée et faisait
 * échouer les parcours suivants (CI du 2026-11-05). Ce test lit le libellé réel du bouton et refuse qu'un sélecteur de
 * bouton des parcours e2e le contienne ; renommer le bouton, ou ajouter `exact: true` au sélecteur, règle le conflit.
 */
const ROOT = process.cwd()

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

function footerButtonLabel(): string {
  const source = readFileSync(
    join(ROOT, 'resources/frontend/components/update/AppVersion.vue'),
    'utf8',
  )
  const found = /<button[^>]*>\s*([^<]+?)\s*<\/button>/.exec(source)
  if (found?.[1] === undefined) throw new Error('Le bouton du pied de page est introuvable.')
  return found[1]
}

interface ButtonSelector {
  file: string
  name: string | RegExp
  exact: boolean
}

/** Sélecteurs `getByRole('button', { name: … })` des parcours e2e (nom en chaîne ou en expression régulière). */
function buttonSelectors(): ButtonSelector[] {
  const selectors: ButtonSelector[] = []
  for (const file of sources(join(ROOT, 'tests/e2e'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/getByRole\('button',/g)) {
      const start = match.index + match[0].length
      const chunk = source.slice(start, start + 260)
      const end = chunk.indexOf('})')
      const call = end >= 0 ? chunk.slice(0, end) : chunk
      const exact = call.includes('exact: true')
      const literal = /name:\s*'((?:[^'\\]|\\.)*)'/.exec(call)
      const pattern = /name:\s*\/((?:[^/\\\n]|\\.)+)\/([a-z]*)/.exec(call)
      if (literal?.[1] !== undefined) selectors.push({ file, name: literal[1], exact })
      else if (pattern?.[1] !== undefined) {
        selectors.push({ file, name: new RegExp(pattern[1], pattern[2] ?? ''), exact })
      }
    }
  }
  return selectors
}

describe('pied de page de version : aucun sélecteur e2e de bouton ne le confond avec un autre bouton', () => {
  const label = footerButtonLabel()
  const selectors = buttonSelectors()

  it('lit le vrai libellé du bouton et un nombre crédible de sélecteurs', () => {
    expect(label).toBe('Vérifier les mises à jour')
    expect(selectors.length).toBeGreaterThan(200)
  })

  it('aucun sélecteur de bouton par sous-chaîne ou expression ne retrouve le bouton du pied de page', () => {
    const colliding = selectors
      // `app-update.spec.ts` vise ce bouton exprès (sélecteur limité au pied de page).
      .filter((selector) => !selector.file.endsWith('app-update.spec.ts'))
      .filter((selector) =>
        typeof selector.name === 'string'
          ? !selector.exact && label.toLowerCase().includes(selector.name.toLowerCase())
          : selector.name.test(label),
      )
      .map((selector) => `${selector.file.replace(ROOT, '')} : ${String(selector.name)}`)
    expect(colliding).toEqual([])
  })

  it('le contrôle voit un sélecteur ambigu (le test n’est pas aveugle)', () => {
    const ambiguous = selectors.filter(
      (selector) =>
        typeof selector.name === 'string' &&
        !selector.exact &&
        'Rechercher une nouvelle version'.toLowerCase().includes(selector.name.toLowerCase()),
    )
    expect(ambiguous.map((selector) => selector.name)).toContain('Rechercher')
  })
})

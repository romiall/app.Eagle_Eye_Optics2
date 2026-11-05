import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrat de présentation des formulaires (base.css) : ce que les composants partagés supposent de
 * la feuille de style. La mise en page elle-même (alignement des saisies d'une rangée, bouton aligné
 * sur la saisie à 360, 768 et 1280 px, remplissage des icônes) est vérifiée dans un vrai navigateur
 * par tests/e2e/forms-layout.spec.ts et patients.spec.ts.
 */
const BASE_CSS = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'resources', 'frontend', 'styles', 'base.css'),
  'utf8',
)

const CSS = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

function escape(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Corps de la première règle dont le sélecteur est exactement `selector` (hors commentaires). */
function ruleBody(selector: string): string {
  const start = CSS.search(new RegExp(`(^|[\\s}{])${escape(selector)}\\s*\\{`))
  if (start < 0) throw new Error(`Règle ${selector} absente de base.css`)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('}', open)
  return CSS.slice(open + 1, close)
}

/** Profondeur d'accolades (blocs `@layer`, `@media`) à la position donnée, commentaires exclus. */
function depthAt(index: number): number {
  let depth = 0
  for (const character of CSS.slice(0, index)) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
  }
  return depth
}

/** Profondeur d'accolades de la règle `selector {` (la première occurrence). */
function depthOf(selector: string): number {
  const index = CSS.search(new RegExp(`(^|[\\s}{])${escape(selector)}\\s*\\{`))
  if (index < 0) throw new Error(`Règle ${selector} absente de base.css`)
  return depthAt(index)
}

/** Corps de tous les blocs `@media (condition) { … }` (accolades imbriquées comprises). */
function mediaBlocks(condition: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const start = CSS.indexOf(`@media (${condition})`, from)
    if (start < 0) break
    const open = CSS.indexOf('{', start)
    let depth = 0
    let end = open
    for (; end < CSS.length; end += 1) {
      if (CSS[end] === '{') depth += 1
      if (CSS[end] === '}') depth -= 1
      if (depth === 0) break
    }
    blocks.push(CSS.slice(open + 1, end))
    from = end
  }
  if (blocks.length === 0) throw new Error(`Bloc @media (${condition}) absent de base.css`)
  return blocks
}

describe('base.css : formulaires', () => {
  it('aligne les champs d’une grille en haut : l’aide et l’erreur sont sous la saisie', () => {
    expect(ruleBody('.form-grid')).toMatch(/align-items:\s*start/)
  })

  it('règle le décalage des boutons posés à côté d’un champ sur l’étiquette', () => {
    const root = ruleBody(':root')
    expect(root).toMatch(/--field-label-height:\s*1\.25rem/)
    expect(root).toMatch(/--field-label-gap:\s*0\.375rem/)
    expect(root).toMatch(
      /--field-label-offset:\s*calc\(var\(--field-label-height\)\s*\+\s*var\(--field-label-gap\)\)/,
    )
    // L'étiquette de FieldShell prend ses mesures aux mêmes variables.
    const label = ruleBody('.field-label')
    expect(label).toMatch(/line-height:\s*var\(--field-label-height\)/)
    expect(label).toMatch(/margin-bottom:\s*var\(--field-label-gap\)/)
  })

  it('ne décale le bouton qu’à partir de 640 px : dessous, la rangée est empilée', () => {
    // Les deux règles de décalage vivent DANS le bloc `@media (min-width: 40rem)` de la couche
    // `components` (profondeur 2) ; hors de ce bloc, des boutons empilés sur téléphone
    // garderaient 26 px de marge au-dessus.
    expect(depthOf('.field-action')).toBe(2)
    expect(depthOf('.toolbar > :is(button, a)')).toBe(2)
    expect(ruleBody('.field-action')).toMatch(/margin-top:\s*var\(--field-label-offset\)/)
    expect(ruleBody('.toolbar > :is(button, a)')).toMatch(
      /margin-top:\s*var\(--field-label-offset\)/,
    )
    // La barre d'outils est alignée en haut dès 640 px : le bouton descend, le champ non.
    const wide = mediaBlocks('min-width: 40rem').join('\n')
    expect(wide).toMatch(/\.toolbar\s*\{[^}]*align-items:\s*flex-start/)
    expect(wide).toMatch(/\.toolbar,\s*\.form-actions\s*\{[^}]*flex-direction:\s*row/)
    // Sur téléphone, la barre est empilée.
    expect(ruleBody('.toolbar')).toMatch(/flex-direction:\s*column/)
  })

  it('porte la légende d’un groupe de champs : flottante pleine largeur, filet, segment doré', () => {
    const legend = ruleBody('.form-legend')
    expect(legend).toMatch(/float:\s*left/)
    expect(legend).toMatch(/width:\s*100%/)
    expect(legend).toMatch(/border-bottom:\s*1px solid var\(--color-line\)/)
    // L'élément qui suit la légende passe dessous (sinon la grille des champs remonte à côté).
    expect(ruleBody('.form-legend + *')).toMatch(/clear:\s*both/)
    expect(ruleBody('.form-legend::after')).toMatch(/background-color:\s*var\(--color-gold\)/)
  })

  it('garde le segment doré visible en contraste forcé : couleur système, pas de trou dans le filet', () => {
    const forced = mediaBlocks('forced-colors: active').join('\n')
    expect(forced).toMatch(/\.form-legend::after\s*\{[^}]*background-color:\s*CanvasText/)
  })

  it('garde le contour de focus des champs hors couche : sinon le contour commun le recouvre', () => {
    // Une règle hors couche l'emporte sur toute règle de couche ; le focus commun est hors couche,
    // ceux des champs (valide et invalide) doivent l'être aussi, et plus spécifiques, pour le remplacer.
    expect(depthOf(':focus-visible')).toBe(0)
    expect(depthOf('.field-control:focus-visible')).toBe(0)
    expect(depthOf(".field-control[aria-invalid='true']:focus-visible")).toBe(0)
    expect(ruleBody('.field-control:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--color-primary\)/,
    )
  })

  it('focus d’un champ invalide : contour de 3 px décalé et liseré blanc, pas la bande du repos', () => {
    // Au repos : bordure de 1 px et anneau de 1 px rouges (bande de 2 px). Un contour rouge posé
    // dessus (décalage négatif) ne changerait rien : le focus invalide est décalé vers l'extérieur.
    const invalid = ruleBody(".field-control[aria-invalid='true']:focus-visible")
    expect(invalid).toMatch(/outline-color:\s*var\(--color-danger\)/)
    expect(invalid).toMatch(/outline-width:\s*3px/)
    expect(invalid).toMatch(/outline-offset:\s*2px/)
    expect(invalid).toMatch(/box-shadow:[\s\S]*var\(--color-surface\)/)
  })

  it('ne retire jamais le contour de focus d’un champ (contraste forcé compris)', () => {
    for (const selector of [
      '.field-control:focus-visible',
      ".field-control[aria-invalid='true']:focus-visible",
    ]) {
      const focus = ruleBody(selector)
      expect(focus, selector).not.toMatch(/outline:\s*(none|0)/)
      expect(focus, selector).not.toMatch(/outline-width:\s*0/)
    }
  })

  it('n’emploie aucune ressource distante ni image : tracés en ligne seulement', () => {
    expect(BASE_CSS).not.toMatch(/url\(|@font-face|@import/i)
  })
})

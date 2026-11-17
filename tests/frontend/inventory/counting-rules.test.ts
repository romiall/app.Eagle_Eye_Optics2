import { describe, expect, it } from 'vitest'

import type { InventoryCountLine } from '@/domain/contracts/generated'
import {
  checkCountChanges,
  countFormOf,
  defaultInventoryReference,
  mapInventoryServerErrors,
  parseCounted,
  validateOpenInventory,
  varianceOf,
} from '@/domain/inventory/counting'

// Inventaires (L1D02) : saisie des quantités comptées (zéro admis, vide = pas encore compté), écart brut, lignes
// modifiées et erreurs du serveur. Le serveur juge le théorique au moment du comptage ; ces règles servent l'écran.
// Données FICTIVES.
const LINE_A = '01J9ZXK4M2Q8R7S6T5V4W31A01'
const LINE_B = '01J9ZXK4M2Q8R7S6T5V4W31A02'
const LOCATION = '01J9ZXK4M2Q8R7S6T5V4W30L01'

function line(id: string, overrides: Partial<InventoryCountLine> = {}): InventoryCountLine {
  return {
    line_id: id,
    item_id: '01J9ZXK4M2Q8R7S6T5V4W30C01',
    item_reference: 'FR-001',
    item_name: 'Monture fictive',
    lot: null,
    theoretical_quantity: '7.000',
    counted_quantity: null,
    variance_quantity: null,
    variance_reason: null,
    adjustment_quantity: null,
    unit_cost: null,
    variance_value: null,
    ...overrides,
  } as InventoryCountLine
}

describe('quantité comptée', () => {
  it('vide = pas encore compté ; zéro est une vraie quantité', () => {
    expect(parseCounted('', true)).toEqual({ ok: true, value: null })
    expect(parseCounted('  ', true)).toEqual({ ok: true, value: null })
    expect(parseCounted('0', true)).toEqual({ ok: true, value: '0.000' })
  })

  it('accepte la virgule française et rend la forme canonique', () => {
    expect(parseCounted('12,5', false)).toEqual({ ok: true, value: '12.500' })
    expect(parseCounted('3', true)).toEqual({ ok: true, value: '3.000' })
  })

  it('refuse une fraction pour un article vendu à l’unité, un négatif et du texte', () => {
    expect(parseCounted('2.5', true)).toEqual({
      ok: false,
      message: 'Cet article se vend à l’unité : quantité entière obligatoire.',
    })
    expect(parseCounted('-1', false).ok).toBe(false)
    expect(parseCounted('abc', false).ok).toBe(false)
    expect(parseCounted('1.2345', false).ok).toBe(false)
  })
})

describe('écart brut', () => {
  it('compté moins théorique, signé ; null tant que la ligne n’est pas comptée', () => {
    expect(varianceOf('7.000', '5.000')).toBe('-2.000')
    expect(varianceOf('7.000', '9.000')).toBe('2.000')
    expect(varianceOf('7.000', '7.000')).toBe('0.000')
    expect(varianceOf('7.000', null)).toBeNull()
  })
})

describe('lignes modifiées', () => {
  const lines = [
    line(LINE_A),
    line(LINE_B, { counted_quantity: '4.000', variance_reason: 'Casse' }),
  ]

  it('n’envoie que les lignes dont le comptage ou le motif a changé', () => {
    const forms = {
      [LINE_A]: { lineId: LINE_A, counted: '5', reason: ' Casse constatée ' },
      [LINE_B]: countFormOf(lines[1] as InventoryCountLine),
    }

    const checked = checkCountChanges({ lines, forms, integerOnly: () => true })

    expect(checked.errors).toEqual({})
    expect(checked.request).toEqual({
      lines: [{ line_id: LINE_A, counted_quantity: '5.000', variance_reason: 'Casse constatée' }],
    })
  })

  it('effacer un comptage envoie null ; rien de changé ne produit aucune charge', () => {
    const cleared = checkCountChanges({
      lines,
      forms: {
        [LINE_A]: countFormOf(lines[0] as InventoryCountLine),
        [LINE_B]: { lineId: LINE_B, counted: '', reason: 'Casse' },
      },
      integerOnly: () => true,
    })
    expect(cleared.request).toEqual({
      lines: [{ line_id: LINE_B, counted_quantity: null, variance_reason: 'Casse' }],
    })

    const unchanged = checkCountChanges({
      lines,
      forms: Object.fromEntries(lines.map((entry) => [entry.line_id, countFormOf(entry)])),
      integerOnly: () => true,
    })
    expect(unchanged).toEqual({ errors: {}, request: null })
  })

  it('une quantité refusée est nommée par ligne et rien n’est envoyé', () => {
    const checked = checkCountChanges({
      lines,
      forms: {
        [LINE_A]: { lineId: LINE_A, counted: '2.5', reason: '' },
        [LINE_B]: countFormOf(lines[1] as InventoryCountLine),
      },
      integerOnly: () => true,
    })

    expect(checked.request).toBeNull()
    expect(checked.errors[LINE_A]).toBe(
      'Cet article se vend à l’unité : quantité entière obligatoire.',
    )
  })
})

describe('ouverture d’un inventaire', () => {
  it('exige un emplacement et une référence ; la référence proposée porte la date du jour', () => {
    expect(defaultInventoryReference('2026-11-10')).toBe('INV-2026-11-10')
    expect(validateOpenInventory({ locationId: null, reference: ' ' })).toEqual({
      errors: {
        locationId: 'Choisissez l’emplacement à inventorier.',
        reference: 'La référence de l’inventaire est obligatoire.',
      },
      request: null,
    })
    expect(validateOpenInventory({ locationId: LOCATION, reference: ' INV-1 ' })).toEqual({
      errors: {},
      request: { location_id: LOCATION, reference: 'INV-1' },
    })
  })
})

describe('erreurs du serveur', () => {
  it('rattache lines.<id> à la ligne, le reste au message général', () => {
    const mapped = mapInventoryServerErrors({
      [`lines.${LINE_A}`]: 'Ligne FR-001 : le comptage retirerait de la marchandise réservée.',
      reason: 'Le motif de l’approbation est obligatoire (3 caractères au moins).',
    })

    expect(mapped.lines).toEqual({
      [LINE_A]: 'Ligne FR-001 : le comptage retirerait de la marchandise réservée.',
    })
    expect(mapped.general).toBe(
      'Le motif de l’approbation est obligatoire (3 caractères au moins).',
    )
  })
})

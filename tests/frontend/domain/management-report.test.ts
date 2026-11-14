import { describe, expect, it } from 'vitest'

import {
  exclusionReasonLabel,
  formatBpsPercent,
  formatCountDelta,
  formatMoneyDelta,
  sectionLabel,
  unknownDomainLabel,
  workshopStatusLabel,
} from '@/domain/reports/management'

describe('management report formatting helpers (integer-only)', () => {
  it('formats integer basis points without floating-point arithmetic', () => {
    expect(formatBpsPercent(null)).toBe('N/D')
    expect(formatBpsPercent(0)).toBe('0,00\u{A0}%')
    expect(formatBpsPercent(6000)).toBe('+60,00\u{A0}%')
    expect(formatBpsPercent(-250)).toBe('-2,50\u{A0}%')
    expect(formatBpsPercent(10000, false)).toBe('100,00\u{A0}%')
    expect(formatBpsPercent(3333, false)).toBe('33,33\u{A0}%')
  })

  it('formats signed money and count deltas with explicit basis-point rates', () => {
    expect(formatMoneyDelta(15000, 6000)).toBe('+15\u{202F}000\u{A0}FCFA (+60,00\u{A0}%)')
    expect(formatMoneyDelta(-5000, -2500)).toBe('-5\u{202F}000\u{A0}FCFA (-25,00\u{A0}%)')
    expect(formatMoneyDelta(0, null)).toBe('0\u{A0}FCFA')

    expect(formatCountDelta(3, 15000)).toBe('+3 (+150,00\u{A0}%)')
    expect(formatCountDelta(-2, -5000)).toBe('-2 (-50,00\u{A0}%)')
    expect(formatCountDelta(4, null)).toBe('+4')
  })

  it('maps excluded sections, reasons, unknown domains and workshop statuses to French labels', () => {
    expect(sectionLabel('FINANCE')).toBe('Finance du cabinet')
    expect(sectionLabel('STOCK_VALUATION')).toBe('Valorisation du stock')
    expect(exclusionReasonLabel('PERMISSION_MISSING')).toBe('Droit manquant pour ce profil')
    expect(exclusionReasonLabel('MODULE_DISABLED')).toBe(
      'Module non activé dans cette installation',
    )
    expect(unknownDomainLabel('SYNC')).toBe('Postes hors ligne')
    expect(workshopStatusLabel('QUALITY_CHECK')).toBe('Contrôle qualité')
  })
})

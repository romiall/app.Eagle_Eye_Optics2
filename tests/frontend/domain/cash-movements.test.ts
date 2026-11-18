import { describe, expect, it } from 'vitest'

import { cashMovementSubject, describeSubject } from '@/domain/approvals/approvals'
import { checkMovement, movementsTotal, signedAmountFor } from '@/domain/cash/movements'

const base = {
  kind: 'EXPENSE' as const,
  amount: 5000,
  direction: null,
  categoryId: '01JCATEGORIECATEGORIECATEG',
  reason: 'Course de taxi (fictif)',
  reference: '',
}

describe('mouvements de caisse hors vente (L1D05)', () => {
  it('dérive le signe de la nature, jamais du montant saisi', () => {
    expect(signedAmountFor('DEPOSIT', 3000, null)).toBe(3000)
    expect(signedAmountFor('WITHDRAWAL', 3000, null)).toBe(-3000)
    expect(signedAmountFor('EXPENSE', 3000, null)).toBe(-3000)
    expect(signedAmountFor('OPENING_CORRECTION', 3000, 'IN')).toBe(3000)
    expect(signedAmountFor('OPENING_CORRECTION', 3000, 'OUT')).toBe(-3000)
  })

  it('accepte une dépense catégorisée dans la limite du tiroir', () => {
    const checked = checkMovement(base, 20000)
    expect(checked).toEqual({
      ok: true,
      movement: {
        kind: 'EXPENSE',
        method: 'CASH',
        signedAmount: -5000,
        categoryId: base.categoryId,
        reason: 'Course de taxi (fictif)',
        reference: null,
      },
    })
  })

  it('autorise une dépense avec motif et référence vides, ou hors tiroir même sans caisse ouverte', () => {
    const cashNoReason = checkMovement({ ...base, reason: '   ', reference: '' }, 20000)
    expect(cashNoReason).toEqual({
      ok: true,
      movement: {
        kind: 'EXPENSE',
        method: 'CASH',
        signedAmount: -5000,
        categoryId: base.categoryId,
        reason: null,
        reference: null,
      },
    })

    const momoClosed = checkMovement(
      { ...base, method: 'MTN_MOMO', amount: 80000, reason: '', reference: '' },
      null,
      false,
    )
    expect(momoClosed).toEqual({
      ok: true,
      movement: {
        kind: 'EXPENSE',
        method: 'MTN_MOMO',
        signedAmount: -80000,
        categoryId: base.categoryId,
        reason: null,
        reference: null,
      },
    })

    expect(checkMovement({ ...base, method: 'CASH' }, null, false)).toMatchObject({
      ok: false,
      errors: { method: expect.any(String) },
    })
    expect(
      checkMovement({ ...base, kind: 'DEPOSIT', categoryId: null, reason: '' }, 0),
    ).toMatchObject({ ok: false, errors: { reason: expect.any(String) } })
    expect(
      checkMovement({ ...base, kind: 'WITHDRAWAL', method: 'MTN_MOMO', categoryId: null }, 20000),
    ).toMatchObject({ ok: false, errors: { method: expect.any(String) } })
  })

  it('refuse une sortie qui dépasse les espèces attendues, une dépense sans catégorie, un motif trop court', () => {
    expect(checkMovement(base, 4000)).toMatchObject({
      ok: false,
      errors: { amount: expect.stringContaining('4000') },
    })
    expect(checkMovement({ ...base, categoryId: null }, 20000)).toMatchObject({
      ok: false,
      errors: { category: 'Choisissez la catégorie de la dépense.' },
    })
    expect(checkMovement({ ...base, reason: ' x ' }, 20000).ok).toBe(false)
    expect(checkMovement({ ...base, amount: 0 }, 20000).ok).toBe(false)
    expect(
      checkMovement(
        { ...base, kind: 'OPENING_CORRECTION', categoryId: null, direction: null },
        20000,
      ),
    ).toMatchObject({ ok: false, errors: { direction: expect.any(String) } })
  })

  it('une entrée n’a pas de plafond de tiroir et ne garde pas de catégorie', () => {
    const checked = checkMovement({ ...base, kind: 'DEPOSIT', amount: 50000 }, 0)
    expect(checked).toMatchObject({ ok: true, movement: { signedAmount: 50000, categoryId: null } })
  })

  it('décrit le contenu exact de l’approbation et totalise les mouvements en entiers', () => {
    const subject = cashMovementSubject(
      '01JSESSIONSESSIONSESSIONSE',
      'EXPENSE',
      -5000,
      base.categoryId,
    )
    const lines = describeSubject(
      subject,
      (amount) => `${amount} FCFA`,
      (method) => method,
    )
    expect(lines).toEqual([
      { label: 'Opération', value: 'Dépense payée en espèces' },
      { label: 'Montant sorti du tiroir', value: '5000 FCFA' },
    ])
    expect(movementsTotal([{ signed_amount: -5000 }, { signed_amount: 2000 }])).toBe(-3000)
  })
})

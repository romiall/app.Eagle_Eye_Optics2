import { describe, expect, it } from 'vitest'

import { type LocalCatalog, readLocalCatalog } from '@/domain/billing/localCatalog'
import {
  foldLocalInvoices,
  isUnconsolidatedInvoice,
  type LocalInvoiceContext,
} from '@/domain/billing/localInvoices'
import type { LocalFactLike, LocalPaymentState } from '@/domain/billing/localPayments'

/**
 * Factures créées sur CE poste, reconstruites par rejeu des faits du journal : brouillon, modifications du brouillon,
 * émission avec le numéro de la plage du poste, lignes figées d'après le catalogue figé, montants des règles partagées,
 * figés (patient, cabinet, taxes) à l'émission, et ce qui n'est PAS reconstruit. Données fictives.
 */
const INVOICE = '01J9ZXK4M2Q8R7S6T5V4W3IN01'
const OTHER_INVOICE = '01J9ZXK4M2Q8R7S6T5V4W3IN02'
const PATIENT = '01J9ZXK4M2Q8R7S6T5V4W3PA01'
const FRAME = '01J9ZXK4M2Q8R7S6T5V4W3IT01'
const EXAM = '01J9ZXK4M2Q8R7S6T5V4W3IT02'
const LENS = '01J9ZXK4M2Q8R7S6T5V4W3IT03'
const TAX = '01J9ZXK4M2Q8R7S6T5V4W3TX01'
const LINE_1 = '01J9ZXK4M2Q8R7S6T5V4W3LN01'
const LINE_2 = '01J9ZXK4M2Q8R7S6T5V4W3LN02'
const LINE_3 = '01J9ZXK4M2Q8R7S6T5V4W3LN03'

function catalog(): LocalCatalog {
  const value = readLocalCatalog({
    catalog_version: 'catalogue-abc123def456',
    snapshot_sha256: 'a'.repeat(64),
    snapshot: {
      items: [
        {
          id: FRAME,
          reference: 'DEMO-MONTURE',
          category_code: 'FRAME',
          name: 'Monture fictive',
          unit_code: 'UNIT',
          quantity_integer_only: true,
          sale_price: 40000,
          tax_rule_id: TAX,
          stock_mode: 'NONE',
          requires_expiry: false,
          active: true,
          version: 1,
        },
        {
          id: EXAM,
          reference: 'DEMO-EXAMEN',
          category_code: 'SERVICE',
          name: 'Examen de vue (fictif)',
          unit_code: 'SERVICE',
          quantity_integer_only: false,
          sale_price: 15000,
          tax_rule_id: null,
          stock_mode: 'NONE',
          requires_expiry: false,
          active: true,
          version: 1,
        },
        {
          id: LENS,
          reference: 'DEMO-VERRES',
          category_code: 'LENS',
          name: 'Verres fictifs',
          unit_code: 'PAIR',
          quantity_integer_only: true,
          sale_price: 60000,
          tax_rule_id: TAX,
          stock_mode: 'MADE_TO_ORDER',
          requires_expiry: false,
          active: true,
          version: 1,
        },
      ],
      tax_rules: [
        {
          id: TAX,
          code: 'TEST_TAXE_FICTIVE',
          rate_percent: '10.0000',
          active: true,
          validated_at: '2026-10-01T09:00:00.000Z',
          version: 1,
        },
      ],
    },
  })
  if (value === null) throw new Error('catalogue attendu')
  return value
}

function context(overrides: Partial<LocalInvoiceContext> = {}): LocalInvoiceContext {
  return {
    catalog: catalog(),
    patient: (id) =>
      id === PATIENT
        ? {
            patient_id: PATIENT,
            record_number: 'EE-2026-0042',
            last_name: 'Mbarga',
            first_names: 'Éloïse',
          }
        : null,
    clinic: {
      clinic_id: '01J9ZXK4M2Q8R7S6T5V4W3CL01',
      name: 'Cabinet fictif',
      address: null,
      phone: null,
      email: null,
      tax_identifier: null,
      professional_mentions: null,
      document_settings: null,
      currency: 'XAF',
      timezone: 'Africa/Douala',
      test_document: true,
    },
    issuer: { userId: '01J9ZXK4M2Q8R7S6T5V4W3US01', displayName: 'Gérante fictive' },
    ...overrides,
  }
}

let counter = 0

function fact(
  commandName: string,
  payload: Record<string, unknown>,
  state: LocalPaymentState = 'local',
  number: string | null = null,
  entityId = INVOICE,
): LocalFactLike {
  counter += 1
  return {
    state,
    fact: {
      commandId: `cmd-${counter}`,
      commandName,
      entityId,
      payload: { invoice_id: entityId, ...payload },
      number,
      recordedAt: `2026-10-28T10:${String(counter).padStart(2, '0')}:00.000Z`,
    },
  }
}

function line(lineId: string, position: number, fields: Record<string, unknown> = {}) {
  return {
    line_id: lineId,
    position,
    catalog_item_id: FRAME,
    description: 'Monture fictive',
    quantity: '2.000',
    unit_price_gross: 40000,
    discount_gross: 0,
    prescription_id: null,
    ...fields,
  }
}

function draft(lines: unknown[], state: LocalPaymentState = 'local'): LocalFactLike {
  return fact(
    'CreateInvoiceDraft',
    { patient_id: PATIENT, visit_id: null, due_date: null, lines },
    state,
  )
}

function issue(state: LocalPaymentState = 'pending'): LocalFactLike {
  return fact(
    'IssueInvoice',
    { issued_at: '2026-10-28T11:30:00.000Z', total_gross: 80000, number: 'TEST-FAC-2026-900001' },
    state,
    'TEST-FAC-2026-900001',
  )
}

describe('brouillon créé sur le poste', () => {
  it('lignes figées d’après le catalogue du poste, montants des règles partagées, brouillon sans numéro', () => {
    const map = foldLocalInvoices([draft([line(LINE_1, 1)])], context())
    const local = map.get(INVOICE)

    expect(local?.state).toBe('local')
    expect(local?.invoice).toMatchObject({
      id: INVOICE,
      patient_id: PATIENT,
      status: 'DRAFT',
      number: null,
      issued_at: null,
      total_gross: 80000,
      currency: 'XAF',
      origin: 'NATIVE',
      draft_version: 1,
      ledger_version: null,
      write_owner: null,
      patient_snapshot: null,
      clinic_snapshot: null,
      tax_snapshot: null,
      payments: [],
      balance: { total_gross: 80000, paid_net: 0, balance_due: 0, settlement: 'NOT_ISSUED' },
    })
    expect(local?.invoice.lines).toEqual([
      {
        id: LINE_1,
        position: 1,
        catalog_item_id: FRAME,
        reference_snapshot: 'DEMO-MONTURE',
        description_snapshot: 'Monture fictive',
        category_snapshot: 'FRAME',
        unit_snapshot: 'UNIT',
        quantity: '2.000',
        unit_price_gross: 40000,
        discount_gross: 0,
        line_total_gross: 80000,
        // 80 000 × 10 / 110 = 7 272,73 : arrondi demi supérieur, comme le serveur.
        tax_code_snapshot: 'TEST_TAXE_FICTIVE',
        tax_rate_snapshot: '10.0000',
        tax_amount: 7273,
        prescription_id: null,
      },
    ])
  })

  it('sans règle fiscale applicable : NO_TAX_CONFIGURED et aucune taxe ventilée (jamais zéro)', () => {
    const map = foldLocalInvoices(
      [
        draft([
          line(LINE_1, 1, {
            catalog_item_id: EXAM,
            description: 'Examen',
            quantity: '1.500',
            unit_price_gross: 15000,
          }),
        ]),
      ],
      context(),
    )
    const first = map.get(INVOICE)?.invoice.lines[0]

    expect(first).toMatchObject({
      reference_snapshot: 'DEMO-EXAMEN',
      category_snapshot: 'SERVICE',
      unit_snapshot: 'SERVICE',
      quantity: '1.500',
      line_total_gross: 22500,
      tax_code_snapshot: 'NO_TAX_CONFIGURED',
      tax_rate_snapshot: null,
      tax_amount: null,
    })
  })

  it('une ligne hors catalogue prend la catégorie « OTHER » et l’unité « UNIT », sans taxe', () => {
    const map = foldLocalInvoices(
      [
        draft([
          line(LINE_1, 1, {
            catalog_item_id: null,
            description: 'Ajustement fictif',
            quantity: '1.000',
            unit_price_gross: 5000,
          }),
        ]),
      ],
      context(),
    )

    expect(map.get(INVOICE)?.invoice.lines[0]).toMatchObject({
      catalog_item_id: null,
      reference_snapshot: null,
      category_snapshot: 'OTHER',
      unit_snapshot: 'UNIT',
      tax_code_snapshot: 'NO_TAX_CONFIGURED',
      tax_amount: null,
      line_total_gross: 5000,
    })
  })

  it('remise déduite du net, lignes triées par position, total = somme des nets', () => {
    const map = foldLocalInvoices(
      [
        draft([
          line(LINE_2, 2, {
            catalog_item_id: LENS,
            description: 'Verres',
            quantity: '1.000',
            unit_price_gross: 60000,
            discount_gross: 10000,
          }),
          line(LINE_1, 1, { quantity: '1.000' }),
        ]),
      ],
      context(),
    )
    const invoice = map.get(INVOICE)?.invoice

    expect(invoice?.lines.map((entry) => entry.id)).toEqual([LINE_1, LINE_2])
    expect(invoice?.lines[1]).toMatchObject({ discount_gross: 10000, line_total_gross: 50000 })
    expect(invoice?.total_gross).toBe(90000)
  })

  it('chaque modification du brouillon remplace ses lignes et avance la version du brouillon', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)], 'acknowledged'),
        fact(
          'UpdateDraft',
          {
            visit_id: null,
            due_date: null,
            lines: [
              line(LINE_1, 1, { quantity: '1.000' }),
              line(LINE_3, 2, {
                catalog_item_id: EXAM,
                description: 'Examen',
                quantity: '1.000',
                unit_price_gross: 15000,
              }),
            ],
          },
          'pending',
        ),
        fact(
          'UpdateDraft',
          {
            visit_id: null,
            due_date: '2026-11-15',
            lines: [line(LINE_1, 1, { quantity: '1.000' })],
          },
          'local',
        ),
      ],
      context(),
    )
    const local = map.get(INVOICE)

    expect(local?.invoice.draft_version).toBe(3)
    expect(local?.invoice.lines.map((entry) => entry.id)).toEqual([LINE_1])
    expect(local?.invoice.total_gross).toBe(40000)
    expect(local?.invoice.due_date).toBe('2026-11-15')
    // L’état est celui de la DERNIÈRE commande qui a touché le brouillon.
    expect(local?.state).toBe('local')
  })
})

describe('facture émise sur le poste', () => {
  it('numéro de la plage du poste, figés à l’émission, solde exact, version du grand livre 1', () => {
    const map = foldLocalInvoices([draft([line(LINE_1, 1)]), issue()], context())
    const local = map.get(INVOICE)

    expect(local?.state).toBe('pending')
    expect(local?.invoice).toMatchObject({
      status: 'ISSUED',
      number: 'TEST-FAC-2026-900001',
      issued_at: '2026-10-28T11:30:00.000Z',
      issued_by: '01J9ZXK4M2Q8R7S6T5V4W3US01',
      issued_by_name: 'Gérante fictive',
      total_gross: 80000,
      draft_version: 1,
      ledger_version: 1,
      balance: {
        total_gross: 80000,
        paid_net: 0,
        credited: 0,
        refunded: 0,
        balance_due: 80000,
        credit_available: 0,
        settlement: 'UNPAID',
      },
      patient_snapshot: {
        patient_id: PATIENT,
        record_number: 'EE-2026-0042',
        last_name: 'Mbarga',
        first_names: 'Éloïse',
      },
      clinic_snapshot: { name: 'Cabinet fictif', test_document: true, timezone: 'Africa/Douala' },
      tax_snapshot: {
        regime: 'VALIDATED_RULES',
        rules: [{ tax_rule_id: TAX, code: 'TEST_TAXE_FICTIVE', rate_percent: '10.0000' }],
      },
    })
  })

  it('sans taxe appliquée, le régime figé est « NO_TAX_CONFIGURED » avec aucune règle', () => {
    const map = foldLocalInvoices(
      [
        draft([
          line(LINE_1, 1, {
            catalog_item_id: EXAM,
            description: 'Examen',
            quantity: '1.000',
            unit_price_gross: 15000,
          }),
        ]),
        issue(),
      ],
      context(),
    )

    expect(map.get(INVOICE)?.invoice.tax_snapshot).toEqual({
      regime: 'NO_TAX_CONFIGURED',
      rules: [],
    })
  })

  it('une fois émise, la facture ne change plus : une modification tardive est ignorée', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        issue(),
        fact('UpdateDraft', {
          visit_id: null,
          due_date: null,
          lines: [line(LINE_1, 1, { quantity: '1.000' })],
        }),
      ],
      context(),
    )

    expect(map.get(INVOICE)?.invoice.total_gross).toBe(80000)
    expect(map.get(INVOICE)?.invoice.draft_version).toBe(1)
    expect(map.get(INVOICE)?.state).toBe('pending')
  })

  it('un encaissement ne fait pas partie de la facture : il s’y ajoute comme pour une facture du serveur', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        issue('acknowledged'),
        fact('RegisterPayment', { payment_id: 'x', amount: 30000, method: 'CASH' }),
      ],
      context(),
    )

    expect(map.get(INVOICE)?.invoice.payments).toEqual([])
    expect(map.get(INVOICE)?.invoice.balance.paid_net).toBe(0)
    expect(map.get(INVOICE)?.state).toBe('acknowledged')
  })

  it('l’identité du patient ou l’en-tête du cabinet manquent : la facture émise n’est pas présentée, le brouillon l’est', () => {
    const unknownPatient = context({ patient: () => null })
    expect(
      foldLocalInvoices([draft([line(LINE_1, 1)]), issue()], unknownPatient).has(INVOICE),
    ).toBe(false)
    expect(foldLocalInvoices([draft([line(LINE_1, 1)])], unknownPatient).has(INVOICE)).toBe(true)

    const noClinic = context({ clinic: null })
    expect(foldLocalInvoices([draft([line(LINE_1, 1)]), issue()], noClinic).has(INVOICE)).toBe(
      false,
    )
  })

  it('une émission sans numéro n’est pas présentée émise', () => {
    const withoutNumber = fact(
      'IssueInvoice',
      { issued_at: '2026-10-28T11:30:00.000Z', total_gross: 80000 },
      'local',
      null,
    )
    expect(
      foldLocalInvoices([draft([line(LINE_1, 1)]), withoutNumber], context()).has(INVOICE),
    ).toBe(false)
  })
})

describe('ce qui n’est pas reconstruit', () => {
  it('une facture du serveur (aucune création locale) : rien à rejouer', () => {
    const map = foldLocalInvoices(
      [
        fact(
          'UpdateDraft',
          { visit_id: null, due_date: null, lines: [] },
          'local',
          null,
          OTHER_INVOICE,
        ),
        fact(
          'IssueInvoice',
          { issued_at: '2026-10-28T11:30:00.000Z' },
          'local',
          'N',
          OTHER_INVOICE,
        ),
        fact(
          'RegisterPayment',
          { payment_id: 'x', amount: 1, method: 'CASH' },
          'local',
          null,
          OTHER_INVOICE,
        ),
      ],
      context(),
    )

    expect(map.size).toBe(0)
  })

  it('une ligne que les règles partagées refusent (quantité nulle, quantité décimale d’un article entier) : facture non reconstruite', () => {
    expect(
      foldLocalInvoices([draft([line(LINE_1, 1, { quantity: '0.000' })])], context()).size,
    ).toBe(0)
    expect(
      foldLocalInvoices([draft([line(LINE_1, 1, { quantity: '1.500' })])], context()).size,
    ).toBe(0)
    expect(
      foldLocalInvoices([draft([line(LINE_1, 1, { description: undefined })])], context()).size,
    ).toBe(0)
  })

  it('un catalogue illisible garde les lignes, sans taxe ni référence, plutôt que d’inventer', () => {
    const map = foldLocalInvoices([draft([line(LINE_1, 1)])], context({ catalog: null }))
    const first = map.get(INVOICE)?.invoice.lines[0]

    expect(first).toMatchObject({
      reference_snapshot: null,
      category_snapshot: 'OTHER',
      tax_code_snapshot: 'NO_TAX_CONFIGURED',
      tax_amount: null,
      line_total_gross: 80000,
    })
  })

  it('plusieurs factures restent distinctes', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        fact(
          'CreateInvoiceDraft',
          {
            patient_id: PATIENT,
            visit_id: null,
            due_date: null,
            lines: [line(LINE_3, 1, { quantity: '1.000' })],
          },
          'local',
          null,
          OTHER_INVOICE,
        ),
      ],
      context(),
    )

    expect([...map.keys()]).toEqual([INVOICE, OTHER_INVOICE])
    expect(map.get(OTHER_INVOICE)?.invoice.total_gross).toBe(40000)
  })
})

describe('priorité de la copie du poste', () => {
  it('seules les propositions consolidées ou rejetées cèdent la place au serveur', () => {
    for (const state of ['local', 'pending', 'waiting_dependency', 'conflict'] as const) {
      expect(isUnconsolidatedInvoice(state), state).toBe(true)
    }
    for (const state of ['acknowledged', 'rejected'] as const) {
      expect(isUnconsolidatedInvoice(state), state).toBe(false)
    }
  })
})

describe('encaissements consolidés d’une facture du poste', () => {
  function paid(
    id: string,
    amount: number,
    state: LocalPaymentState,
    receipt = 'TEST-REC-2026-900001',
  ): LocalFactLike {
    return fact(
      'RegisterPayment',
      {
        payment_id: id,
        amount,
        method: 'MTN_MOMO',
        reference: `REF-${id}`,
        effective_at: '2026-10-28T12:00:00.000Z',
        receipt_id: `RC-${id}`,
      },
      state,
      receipt,
    )
  }

  it('les encaissements que le serveur a acquittés font partie de la facture : encaissé, reste dû, version du grand livre', () => {
    const map = foldLocalInvoices(
      [draft([line(LINE_1, 1)]), issue('acknowledged'), paid('P1', 30000, 'acknowledged')],
      context(),
    )
    const invoice = map.get(INVOICE)?.invoice

    expect(invoice?.balance).toMatchObject({
      paid_net: 30000,
      balance_due: 50000,
      settlement: 'PARTIALLY_PAID',
    })
    expect(invoice?.ledger_version).toBe(2)
    expect(invoice?.payments).toEqual([
      {
        id: 'P1',
        amount: 30000,
        method: 'MTN_MOMO',
        reference: 'REF-P1',
        effective_at: '2026-10-28T12:00:00.000Z',
        confirmed_at: expect.any(String),
        status: 'CONFIRMED',
        receipt_id: 'RC-P1',
        receipt_number: 'TEST-REC-2026-900001',
        reversed_amount: 0,
        received_by: '01J9ZXK4M2Q8R7S6T5V4W3US01',
        received_by_name: 'Gérante fictive',
      },
    ])
  })

  it('acompte puis solde acquittés : reste nul, « soldée » au sens du serveur, deux encaissements comptés', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        issue('acknowledged'),
        paid('P1', 30000, 'acknowledged', 'TEST-REC-2026-900001'),
        paid('P2', 50000, 'acknowledged', 'TEST-REC-2026-900002'),
      ],
      context(),
    )
    const invoice = map.get(INVOICE)?.invoice

    expect(invoice?.balance).toMatchObject({
      paid_net: 80000,
      balance_due: 0,
      settlement: 'SETTLED',
    })
    expect(invoice?.ledger_version).toBe(3)
    expect(invoice?.payments.map((payment) => payment.receipt_number)).toEqual([
      'TEST-REC-2026-900001',
      'TEST-REC-2026-900002',
    ])
  })

  it('un encaissement qui attend encore son ACK reste hors de la facture : il s’affiche à part, avec son état', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        issue('acknowledged'),
        paid('P1', 30000, 'acknowledged'),
        paid('P2', 50000, 'pending', 'TEST-REC-2026-900002'),
        paid('P3', 1000, 'conflict', 'TEST-REC-2026-900003'),
      ],
      context(),
    )
    const invoice = map.get(INVOICE)?.invoice

    expect(invoice?.payments.map((payment) => payment.id)).toEqual(['P1'])
    expect(invoice?.balance.paid_net).toBe(30000)
    expect(invoice?.ledger_version).toBe(2)
  })

  it('un encaissement illisible, ou d’une facture qui n’est pas encore émise sur le poste, est ignoré', () => {
    const map = foldLocalInvoices(
      [
        draft([line(LINE_1, 1)]),
        fact(
          'RegisterPayment',
          { payment_id: 'P0', amount: 500, method: 'MTN_MOMO' },
          'acknowledged',
        ),
        issue('acknowledged'),
        fact(
          'RegisterPayment',
          { payment_id: 'P1', amount: 'beaucoup', method: 'MTN_MOMO' },
          'acknowledged',
        ),
        fact('RegisterPayment', { payment_id: 'P2', amount: 100, method: 'TROC' }, 'acknowledged'),
        fact('RegisterPayment', { amount: 100, method: 'MTN_MOMO' }, 'acknowledged'),
      ],
      context(),
    )
    const invoice = map.get(INVOICE)?.invoice

    expect(invoice?.payments).toEqual([])
    expect(invoice?.balance).toMatchObject({
      paid_net: 0,
      balance_due: 80000,
      settlement: 'UNPAID',
    })
    expect(invoice?.ledger_version).toBe(1)
  })

  it('un trop-perçu consolidé se dit « en crédit », jamais un reste négatif présenté comme dû', () => {
    const map = foldLocalInvoices(
      [draft([line(LINE_1, 1)]), issue('acknowledged'), paid('P1', 90000, 'acknowledged')],
      context(),
    )

    expect(map.get(INVOICE)?.invoice.balance).toMatchObject({
      paid_net: 90000,
      balance_due: -10000,
      settlement: 'IN_CREDIT',
    })
  })
})

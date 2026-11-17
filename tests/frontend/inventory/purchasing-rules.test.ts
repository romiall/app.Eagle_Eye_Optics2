import { describe, expect, it } from 'vitest'

import type { GoodsReceipt } from '@/domain/contracts/generated'
import {
  buildReceiptDraftRequest,
  buildValidateRequest,
  type ConfirmLineForm,
  confirmationFormOf,
  emptyReceiptForm,
  emptySupplierForm,
  hasReceiptErrors,
  mapReceiptServerErrors,
  receivedAtInstant,
  type ReceiptForm,
  receiptFormOf,
  validateConfirmation,
  validateReceiptDraft,
  validateSupplier,
} from '@/domain/inventory/purchasing'

import { catalogItem } from '../billing/support'

// Achats (L1D01) : règles d'écran des fournisseurs et des réceptions, avant envoi. Le serveur reste seul juge ; ces
// règles évitent un aller-retour inutile et nomment le champ. Données FICTIVES.
const FRAME = catalogItem({
  id: '01J9ZXK4M2Q8R7S6T5V4W30C01',
  stock_mode: 'STOCKED',
  quantity_integer_only: true,
})
const DROPS = catalogItem({
  id: '01J9ZXK4M2Q8R7S6T5V4W30C02',
  stock_mode: 'STOCKED',
  requires_expiry: true,
  quantity_integer_only: true,
})
const SERVICE = catalogItem({ id: '01J9ZXK4M2Q8R7S6T5V4W30C03', stock_mode: 'NONE' })
const ITEMS = new Map([FRAME, DROPS, SERVICE].map((item) => [item.id, item]))
const SUPPLIER = '01J9ZXK4M2Q8R7S6T5V4W30S01'
const LOCATION = '01J9ZXK4M2Q8R7S6T5V4W30L01'

function form(overrides: Partial<ReceiptForm> = {}): ReceiptForm {
  return {
    supplierId: SUPPLIER,
    locationId: LOCATION,
    supplierReference: 'BL-2026-0001',
    receivedOn: '2026-10-22',
    notes: '',
    lines: [{ key: 'a', itemId: FRAME.id, quantity: '5', unitCost: 18000 }],
    ...overrides,
  }
}

describe('fournisseur', () => {
  it('refuse un nom trop court et un code vide, nomme les champs', () => {
    const checked = validateSupplier({ ...emptySupplierForm(), name: 'X' })

    expect(checked.request).toBeNull()
    expect(checked.errors.name).toBe('Le nom du fournisseur compte au moins 2 caractères.')
    expect(checked.errors.reference).toBe('Le code du fournisseur est obligatoire.')
  })

  it('retire les blancs, remplace le vide par null et garde les indicateurs', () => {
    const checked = validateSupplier({
      name: '  Optique Distribution  ',
      reference: ' FOU-001 ',
      phone: ' ',
      email: ' contact@example.test ',
      address: '',
      isOpticalLab: true,
      active: true,
    })

    expect(checked.errors).toEqual({})
    expect(checked.request).toEqual({
      name: 'Optique Distribution',
      reference: 'FOU-001',
      phone: null,
      email: 'contact@example.test',
      address: null,
      is_optical_lab: true,
      active: true,
    })
  })

  it('refuse une adresse e-mail invalide et un code trop long', () => {
    const checked = validateSupplier({
      ...emptySupplierForm(),
      name: 'Labo',
      reference: 'x'.repeat(65),
      email: 'pas-un-courriel',
    })

    expect(checked.errors.email).toBe('Adresse e-mail invalide.')
    expect(checked.errors.reference).toBe('Le code compte au plus 64 caractères.')
  })
})

describe('brouillon de réception', () => {
  it('un brouillon complet n’a aucune erreur ; le coût inconnu (null) est admis', () => {
    const errors = validateReceiptDraft({
      form: form({ lines: [{ key: 'a', itemId: FRAME.id, quantity: '5', unitCost: null }] }),
      items: ITEMS,
      today: '2026-10-22',
    })

    expect(hasReceiptErrors(errors)).toBe(false)
  })

  it('nomme chaque champ d’en-tête manquant, une date future et l’absence de ligne', () => {
    const errors = validateReceiptDraft({
      form: { ...emptyReceiptForm(), receivedOn: '2026-10-23' },
      items: ITEMS,
      today: '2026-10-22',
    })

    expect(errors.header).toEqual({
      supplierId: 'Choisissez le fournisseur.',
      locationId: 'Choisissez l’emplacement de réception.',
      supplierReference: 'La référence de livraison (bon ou facture) est obligatoire.',
      receivedOn: 'La date de réception ne peut pas être dans le futur.',
    })
    expect(errors.general).toBe('Ajoutez au moins une ligne à la réception.')
  })

  it('refuse un service, une quantité nulle ou fractionnaire d’un article à l’unité, un coût négatif', () => {
    const errors = validateReceiptDraft({
      form: form({
        lines: [
          { key: 'service', itemId: SERVICE.id, quantity: '1', unitCost: null },
          { key: 'zero', itemId: FRAME.id, quantity: '0', unitCost: null },
          { key: 'fraction', itemId: FRAME.id, quantity: '1.5', unitCost: null },
          { key: 'cost', itemId: FRAME.id, quantity: '1', unitCost: -5 },
          { key: 'empty', itemId: null, quantity: null, unitCost: null },
        ],
      }),
      items: ITEMS,
      today: '2026-10-22',
    })

    expect(errors.lines['service']?.itemId).toBe('Seul un article actif géré en stock se reçoit.')
    expect(errors.lines['zero']?.quantity).toBe('La quantité doit être strictement positive.')
    expect(errors.lines['fraction']?.quantity).toBe(
      'Cet article se vend à l’unité : quantité entière obligatoire.',
    )
    expect(errors.lines['cost']?.unitCost).toContain('montant entier en FCFA')
    expect(errors.lines['empty']).toEqual({
      itemId: 'Choisissez un article géré en stock.',
      quantity: 'La quantité est obligatoire.',
    })
  })

  it('la date du jour garde l’instant présent, une date passée vaut midi UTC', () => {
    expect(receivedAtInstant('2026-10-22', '2026-10-22', '2026-10-22T09:30:00.000Z')).toBe(
      '2026-10-22T09:30:00.000Z',
    )
    expect(receivedAtInstant('2026-10-20', '2026-10-22', '2026-10-22T09:30:00.000Z')).toBe(
      '2026-10-20T12:00:00.000Z',
    )
  })

  it('construit la charge du brouillon : remarques vides en null, coût inconnu conservé', () => {
    const request = buildReceiptDraftRequest({
      form: form({
        notes: '  ',
        lines: [
          { key: 'a', itemId: FRAME.id, quantity: '5', unitCost: 18000 },
          { key: 'b', itemId: DROPS.id, quantity: '10', unitCost: null },
        ],
      }),
      today: '2026-10-22',
      nowInstant: '2026-10-22T09:30:00.000Z',
    })

    expect(request).toEqual({
      supplier_id: SUPPLIER,
      location_id: LOCATION,
      supplier_reference: 'BL-2026-0001',
      received_at: '2026-10-22T09:30:00.000Z',
      notes: null,
      lines: [
        { item_id: FRAME.id, quantity: '5', unit_cost: 18000 },
        { item_id: DROPS.id, quantity: '10', unit_cost: null },
      ],
    })
    expect(request).not.toHaveProperty('expected_version')
  })

  it('relit un brouillon du serveur : date civile du fuseau du cabinet, lignes avec une clé locale', () => {
    let count = 0
    const receipt = {
      supplier_id: SUPPLIER,
      location_id: LOCATION,
      supplier_reference: 'BL-1',
      received_at: '2026-10-22T23:30:00.000Z',
      notes: null,
      lines: [{ position: 1, item_id: FRAME.id, quantity: '5.000', unit_cost: null, lot: null }],
    } as unknown as GoodsReceipt

    const restored = receiptFormOf(receipt, 'Africa/Douala', () => `k${(count += 1)}`)

    expect(restored.receivedOn).toBe('2026-10-23')
    expect(restored.lines).toEqual([
      { key: 'k1', itemId: FRAME.id, quantity: '5.000', unitCost: null },
    ])
  })
})

describe('validation d’une réception : lot et coût de chaque ligne', () => {
  const receipt = {
    lines: [
      { position: 1, item_id: FRAME.id, quantity: '5.000', unit_cost: 18000, lot: null },
      { position: 2, item_id: DROPS.id, quantity: '10.000', unit_cost: null, lot: null },
    ],
  } as unknown as GoodsReceipt

  it('préremplit le coût du brouillon et laisse le lot vide', () => {
    expect(confirmationFormOf(receipt)).toEqual([
      { position: 1, batchNumber: '', expiresOn: null, unitCost: 18000 },
      { position: 2, batchNumber: '', expiresOn: null, unitCost: null },
    ])
  })

  it('un article périssable exige un lot et une expiration ; un lot déjà expiré est refusé', () => {
    const lines: ConfirmLineForm[] = confirmationFormOf(receipt)

    const missing = validateConfirmation({ lines, receipt, items: ITEMS, receivedOn: '2026-10-22' })
    expect(missing[2]).toEqual({
      batchNumber: 'Cet article périssable exige un numéro de lot.',
      expiresOn: 'Cet article périssable exige une date d’expiration.',
    })
    expect(missing[1]).toBeUndefined()

    const expired = validateConfirmation({
      lines: [{ position: 2, batchNumber: 'LOT-A', expiresOn: '2026-10-21', unitCost: null }],
      receipt,
      items: ITEMS,
      receivedOn: '2026-10-22',
    })
    expect(expired[2]?.expiresOn).toBe(
      'Ce lot est déjà expiré à la date de réception : il ne peut pas entrer en stock.',
    )

    const sameDay = validateConfirmation({
      lines: [{ position: 2, batchNumber: 'LOT-A', expiresOn: '2026-10-22', unitCost: null }],
      receipt,
      items: ITEMS,
      receivedOn: '2026-10-22',
    })
    expect(sameDay).toEqual({})
  })

  it('une date d’expiration sans numéro de lot est signalée pour un article non périssable', () => {
    const errors = validateConfirmation({
      lines: [{ position: 1, batchNumber: '', expiresOn: '2027-01-01', unitCost: 18000 }],
      receipt,
      items: ITEMS,
      receivedOn: '2026-10-22',
    })

    expect(errors[1]?.batchNumber).toBe('Indiquez le numéro du lot de cette date d’expiration.')
  })

  it('construit la charge : lignes par position, lot vide = null, coût inconnu conservé', () => {
    const request = buildValidateRequest([
      { position: 2, batchNumber: ' LOT-A ', expiresOn: '2027-03-01', unitCost: null },
      { position: 1, batchNumber: '', expiresOn: null, unitCost: 18000 },
    ])

    expect(request).toEqual({
      lines: [
        { position: 1, lot: null, unit_cost: 18000 },
        { position: 2, lot: { batch_number: 'LOT-A', expires_on: '2027-03-01' }, unit_cost: null },
      ],
    })
  })
})

describe('erreurs du serveur', () => {
  it('rattache chaque clé à son champ et garde le reste en message général', () => {
    const mapped = mapReceiptServerErrors({
      supplier_reference:
        'Une réception porte déjà cette référence de livraison pour ce fournisseur.',
      'lines.1.item_id': 'Article introuvable dans ce cabinet.',
      'lines.0.lot.expires_on': 'Ce lot existe déjà avec l’expiration du 2027-03-01.',
      'lines.0.unit_cost': 'Ce lot existe déjà avec un coût de 700 FCFA.',
      'lines.2.lot': 'Cet article est suivi par lots : indiquez le lot reçu.',
      lines: 'La ligne 2 doit être confirmée (lot et coût).',
    })

    expect(mapped.header).toEqual({
      supplierReference:
        'Une réception porte déjà cette référence de livraison pour ce fournisseur.',
    })
    expect(mapped.lines[1]).toEqual({ itemId: 'Article introuvable dans ce cabinet.' })
    expect(mapped.lines[0]).toEqual({
      expiresOn: 'Ce lot existe déjà avec l’expiration du 2027-03-01.',
      unitCost: 'Ce lot existe déjà avec un coût de 700 FCFA.',
    })
    expect(mapped.lines[2]).toEqual({
      batchNumber: 'Cet article est suivi par lots : indiquez le lot reçu.',
    })
    expect(mapped.general).toBe('La ligne 2 doit être confirmée (lot et coût).')
  })
})

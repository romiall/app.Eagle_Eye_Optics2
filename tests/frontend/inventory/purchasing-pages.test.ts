import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiError,
  buttonByName,
  callsTo,
  CASHIER,
  click,
  dialogButton,
  json,
  openApp,
  resetSales,
  selectInto,
  stubSalesApi,
  textOf,
  typeInto,
} from '../billing/support'
import {
  DROPS_ID,
  FRAME_ID,
  LOCATION_ID,
  PAGE_META,
  receiptDetail,
  receiptSummary,
  RECEIPT_ID,
  STOCK_MANAGER,
  stubStockReads,
  SUPPLIER_ID,
} from './support'

// Réceptions fournisseur (L1D01, AT30), EN LIGNE : liste valorisée au coût connu, brouillon sans effet sur le stock,
// validation avec lot et coût de chaque ligne, refus du serveur par ligne, suppression d'un brouillon. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

describe('liste des réceptions', () => {
  it('montre la valeur au coût connu et les lignes à coût inconnu, et filtre par statut', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    const validated = receiptSummary({
      id: '01J9ZXK4M2Q8R7S6T5V4WR0002',
      supplier_reference: 'BL-2026-0002',
      status: 'VALIDATED',
      unknown_cost_lines: 1,
      line_count: 2,
    })
    api.on('GET', /^\/api\/v1\/goods-receipts$/, (request) =>
      json(200, {
        data:
          request.query.get('status') === 'VALIDATED' ? [validated] : [receiptSummary(), validated],
        meta: PAGE_META,
      }),
    )

    const { root, unmount } = await openApp('/stock/receptions')

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Réceptions fournisseur')
    expect(textOf(root)).toContain('Optique Distribution · livraison BL-2026-0001')
    expect(textOf(root)).toContain('Brouillon')
    expect(textOf(root)).toContain('Valeur au coût connu')
    expect(textOf(root)).toContain('1 ligne à coût inconnu (non valorisée)')
    expect(textOf(root)).toContain('Ouvrir le brouillon')

    await selectInto(root, 'receptions-statut', 'VALIDATED')

    expect(
      callsTo(api, 'GET', /goods-receipts$/)
        .at(-1)
        ?.query.get('status'),
    ).toBe('VALIDATED')
    expect(textOf(root)).not.toContain('Ouvrir le brouillon')
    unmount()
  })

  it('sans le droit stock.receive, aucune lecture d’achats n’est demandée', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/goods-receipts$/, () => json(200, { data: [], meta: PAGE_META }))

    const { root, unmount } = await openApp('/stock/receptions')

    expect(callsTo(api, 'GET', /goods-receipts/)).toHaveLength(0)
    expect(root.querySelector('h1')?.textContent).not.toBe('Réceptions fournisseur')
    unmount()
  })
})

describe('brouillon de réception', () => {
  it('enregistre un brouillon (date du jour, coût inconnu, clé d’idempotence, version nulle) puis le rouvre', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('POST', /^\/api\/v1\/goods-receipts$/, () => json(201, { data: receiptDetail() }))
    api.on('GET', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}$`), () =>
      json(200, { data: receiptDetail() }),
    )

    const { root, unmount } = await openApp('/stock/receptions/nouvelle')
    await selectInto(root, 'reception-fournisseur', SUPPLIER_ID)
    await typeInto(root, 'reception-reference', ' BL-2026-0001 ')
    await click(buttonByName(root, 'Ajouter une ligne'))
    const item = root.querySelector<HTMLSelectElement>('select[id$="-article"]')
    const quantity = root.querySelector<HTMLInputElement>('input[id$="-quantite"]')
    if (item === null || quantity === null) throw new Error('Ligne de réception introuvable.')
    await selectInto(root, item.id, FRAME_ID)
    await typeInto(root, quantity.id, '5')

    await click(buttonByName(root, 'Enregistrer le brouillon'))

    const [post] = callsTo(api, 'POST', /^\/api\/v1\/goods-receipts$/)
    expect(post?.body).toEqual({
      expected_version: null,
      supplier_id: SUPPLIER_ID,
      location_id: LOCATION_ID,
      supplier_reference: 'BL-2026-0001',
      received_at: '2026-10-15T09:00:00.000Z',
      notes: null,
      lines: [{ item_id: FRAME_ID, quantity: '5', unit_cost: null }],
    })
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(textOf(root)).toContain('Brouillon de réception enregistré : le stock n’a pas bougé.')
    expect(buttonByName(root, 'Passer à la validation')).not.toBeNull()
    unmount()
  })

  it('nomme les champs manquants sans rien envoyer', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)

    const { root, unmount } = await openApp('/stock/receptions/nouvelle')
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    expect(textOf(root)).toContain('Choisissez le fournisseur.')
    expect(textOf(root)).toContain('La référence de livraison (bon ou facture) est obligatoire.')
    expect(textOf(root)).toContain('Ajoutez au moins une ligne à la réception.')
    expect(callsTo(api, 'POST', /goods-receipts/)).toHaveLength(0)
    unmount()
  })

  it('supprime un brouillon après confirmation puis revient à la liste', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}$`), () =>
      json(200, { data: receiptDetail() }),
    )
    api.on('POST', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}/delete$`), () =>
      json(200, { data: { receipt_id: RECEIPT_ID, deleted: true } }),
    )
    api.on('GET', /^\/api\/v1\/goods-receipts$/, () =>
      json(200, { data: [], meta: { ...PAGE_META, total: 0 } }),
    )

    const { root, unmount } = await openApp(`/stock/receptions/${RECEIPT_ID}`)
    await click(buttonByName(root, 'Supprimer le brouillon'))
    await click(dialogButton(root, 'Supprimer le brouillon'))

    const [post] = callsTo(api, 'POST', /\/delete$/)
    expect(post?.body).toEqual({ expected_version: null })
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Réceptions fournisseur')
    expect(textOf(root)).toContain('Brouillon de réception supprimé.')
    unmount()
  })
})

describe('validation d’une réception', () => {
  const perishable = receiptDetail({
    lines: [
      {
        position: 1,
        item_id: DROPS_ID,
        item_reference: 'CO-001',
        item_name: 'Collyre fictif',
        quantity: '10.000',
        unit_cost: null,
        lot: null,
      },
    ],
    known_cost_total: 0,
    unknown_cost_lines: 1,
  })

  it('exige le lot d’un article périssable, envoie lot, expiration et coût de chaque ligne, puis la montre définitive', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}$`), () =>
      json(200, { data: perishable }),
    )
    api.on('POST', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}/validate$`), () =>
      json(200, {
        data: {
          ...perishable,
          status: 'VALIDATED',
          validated_at: '2026-10-15T09:00:00.000Z',
          lines: [
            {
              ...perishable.lines[0],
              lot: {
                lot_id: '01J9ZXK4M2Q8R7S6T5V4WP0001',
                batch_number: 'LOT-A',
                expires_on: '2027-03-01',
              },
            },
          ],
        },
      }),
    )

    const { root, unmount } = await openApp(`/stock/receptions/${RECEIPT_ID}`)
    await click(buttonByName(root, 'Passer à la validation'))
    expect(textOf(root)).toContain('Valider la réception')

    await click(buttonByName(root, 'Valider la réception'))
    expect(textOf(root)).toContain('Cet article périssable exige un numéro de lot.')
    expect(textOf(root)).toContain('Cet article périssable exige une date d’expiration.')
    expect(callsTo(api, 'POST', /validate$/)).toHaveLength(0)

    await typeInto(root, 'confirmation-1-lot', 'LOT-A')
    await typeInto(root, 'confirmation-1-expiration', '01/03/2027')
    await click(buttonByName(root, 'Valider la réception'))

    const [post] = callsTo(api, 'POST', /validate$/)
    expect(post?.body).toEqual({
      expected_version: null,
      lines: [
        { position: 1, lot: { batch_number: 'LOT-A', expires_on: '2027-03-01' }, unit_cost: null },
      ],
    })
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(textOf(root)).toContain('Réception validée')
    expect(textOf(root)).toContain('Cette réception est définitive.')
    expect(textOf(root)).toContain('lot LOT-A, expire le 01/03/2027')
    expect(buttonByName(root, 'Valider la réception')).toBeNull()
    unmount()
  })

  it('montre le refus du serveur sur la ligne concernée et garde la saisie', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}$`), () =>
      json(200, { data: perishable }),
    )
    api.on('POST', new RegExp(`^/api/v1/goods-receipts/${RECEIPT_ID}/validate$`), () =>
      apiError(422, 'VALIDATION_FAILED', 'Certaines informations sont invalides.', {
        'lines.0.lot.expires_on': [
          'Ce lot existe déjà avec l’expiration du 2027-09-01 : une autre date ne s’écrit pas sur un lot connu.',
        ],
      }),
    )

    const { root, unmount } = await openApp(`/stock/receptions/${RECEIPT_ID}`)
    await click(buttonByName(root, 'Passer à la validation'))
    await typeInto(root, 'confirmation-1-lot', 'LOT-A')
    await typeInto(root, 'confirmation-1-expiration', '01/03/2027')
    await click(buttonByName(root, 'Valider la réception'))

    expect(textOf(root)).toContain('Ligne 1 : Ce lot existe déjà avec l’expiration du 2027-09-01')
    expect(textOf(root)).not.toContain('Cette réception est définitive.')
    expect(root.querySelector<HTMLInputElement>('[id="confirmation-1-lot"]')?.value).toBe('LOT-A')
    unmount()
  })
})

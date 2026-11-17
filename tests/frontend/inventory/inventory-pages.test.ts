import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiError,
  buttonByName,
  callsTo,
  click,
  json,
  openApp,
  resetSales,
  selectInto,
  stubSalesApi,
  textOf,
  typeInto,
} from '../billing/support'
import {
  INVENTORY_ID,
  inventoryDetail,
  inventoryLine,
  LINE_DROPS,
  LINE_FRAME,
  LOCATION_ID,
  PAGE_META,
  STOCK_MANAGER,
  stubStockReads,
} from './support'

// Inventaires (L1D02, AT30), EN LIGNE : ouverture d'un périmètre figé, saisie des comptages sans effet sur le stock,
// terminer, validation par la gérante avec refus du serveur par ligne. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

const DETAIL_PATH = new RegExp(`^/api/v1/inventory-counts/${INVENTORY_ID}$`)

describe('ouverture d’un inventaire', () => {
  it('ouvre l’inventaire d’un emplacement (référence du jour, version nulle) puis affiche ses lignes à compter', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/inventory-counts$/, () =>
      json(200, { data: [], meta: { ...PAGE_META, total: 0 } }),
    )
    api.on('POST', /^\/api\/v1\/inventory-counts$/, () => json(201, { data: inventoryDetail() }))
    api.on('GET', DETAIL_PATH, () => json(200, { data: inventoryDetail() }))

    const { root, unmount } = await openApp('/stock/inventaires')
    expect(root.querySelector('h1')?.textContent).toBe('Inventaires')
    expect(textOf(root)).toContain('Ouvrir un inventaire ne change rien au')

    await selectInto(root, 'inventaire-emplacement', LOCATION_ID)
    await click(buttonByName(root, 'Ouvrir l’inventaire'))

    const [post] = callsTo(api, 'POST', /^\/api\/v1\/inventory-counts$/)
    expect(post?.body).toEqual({
      expected_version: null,
      location_id: LOCATION_ID,
      reference: 'INV-2026-10-15',
    })
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(root.querySelector('h1')?.textContent).toBe('Inventaire INV-2026-10-15')
    expect(textOf(root)).toContain('Inventaire ouvert : 2 lignes à compter, théorique figé.')
    expect(textOf(root)).toContain('Monture fictive (FR-001)')
    expect(textOf(root)).toContain('Lot LOT-A')
    unmount()
  })

  it('refuse sans emplacement, sans rien envoyer', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', /^\/api\/v1\/inventory-counts$/, () =>
      json(200, { data: [], meta: { ...PAGE_META, total: 0 } }),
    )

    const { root, unmount } = await openApp('/stock/inventaires')
    await click(buttonByName(root, 'Ouvrir l’inventaire'))

    expect(textOf(root)).toContain('Choisissez l’emplacement à inventorier.')
    expect(callsTo(api, 'POST', /inventory-counts/)).toHaveLength(0)
    unmount()
  })
})

describe('comptage', () => {
  it('montre l’écart saisi, n’envoie que les lignes modifiées et ne touche pas au stock', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', DETAIL_PATH, () => json(200, { data: inventoryDetail() }))
    api.on('PATCH', new RegExp(`^/api/v1/inventory-counts/${INVENTORY_ID}/lines$`), () =>
      json(200, {
        data: inventoryDetail({
          counted_lines: 1,
          variance_lines: 1,
          lines: [
            inventoryLine(LINE_DROPS, { theoretical_quantity: '8.000' }),
            inventoryLine(LINE_FRAME, {
              counted_quantity: '5.000',
              variance_quantity: '-2.000',
              variance_reason: 'Casse constatée',
            }),
          ],
        }),
      }),
    )

    const { root, unmount } = await openApp(`/stock/inventaires/${INVENTORY_ID}`)
    await typeInto(root, `inventaire-${LINE_FRAME}-comptage`, '5')

    expect(textOf(root)).toContain('Écart : -2')
    await typeInto(root, `inventaire-${LINE_FRAME}-motif`, ' Casse constatée ')
    await click(buttonByName(root, 'Enregistrer les comptages'))

    const [patch] = callsTo(api, 'PATCH', /\/lines$/)
    expect(patch?.body).toEqual({
      expected_version: null,
      lines: [
        { line_id: LINE_FRAME, counted_quantity: '5.000', variance_reason: 'Casse constatée' },
      ],
    })
    expect(patch?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(textOf(root)).toContain('Comptages enregistrés : le stock n’a pas bougé.')
    expect(callsTo(api, 'POST', /inventory-counts/)).toHaveLength(0)
    unmount()
  })

  it('refuse une fraction pour un article à l’unité avant tout envoi', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', DETAIL_PATH, () => json(200, { data: inventoryDetail() }))

    const { root, unmount } = await openApp(`/stock/inventaires/${INVENTORY_ID}`)
    await typeInto(root, `inventaire-${LINE_FRAME}-comptage`, '2.5')
    await click(buttonByName(root, 'Enregistrer les comptages'))

    expect(textOf(root)).toContain('Cet article se vend à l’unité : quantité entière obligatoire.')
    expect(callsTo(api, 'PATCH', /lines/)).toHaveLength(0)
    unmount()
  })

  it('terminer le comptage avec une ligne non comptée montre le refus du serveur', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', DETAIL_PATH, () => json(200, { data: inventoryDetail() }))
    api.on('POST', new RegExp(`^/api/v1/inventory-counts/${INVENTORY_ID}/complete$`), () =>
      apiError(422, 'VALIDATION_FAILED', 'Certaines informations sont invalides.', {
        lines: [
          '2 lignes ne sont pas comptées : saisissez leur quantité (zéro si rien n’est trouvé).',
        ],
      }),
    )

    const { root, unmount } = await openApp(`/stock/inventaires/${INVENTORY_ID}`)
    await click(buttonByName(root, 'Terminer le comptage'))

    expect(callsTo(api, 'POST', /complete$/)[0]?.body).toEqual({ expected_version: null })
    expect(textOf(root)).toContain('2 lignes ne sont pas comptées')
    unmount()
  })
})

describe('validation par la gérante', () => {
  const counted = inventoryDetail({
    status: 'COUNTED',
    counted_lines: 2,
    variance_lines: 1,
    variance_value_known: -36000,
    unknown_cost_lines: 0,
    lines: [
      inventoryLine(LINE_FRAME, {
        counted_quantity: '5.000',
        variance_quantity: '-2.000',
        variance_reason: 'Casse constatée',
      }),
    ],
  })

  it('exige un motif, refuse une ligne qui retirerait de la marchandise réservée puis valide', async () => {
    const api = stubSalesApi({ permissions: STOCK_MANAGER })
    stubStockReads(api)
    api.on('GET', DETAIL_PATH, () => json(200, { data: counted }))
    let answers = 0
    api.on('POST', new RegExp(`^/api/v1/inventory-counts/${INVENTORY_ID}/validate$`), () => {
      answers += 1
      if (answers === 1) {
        return apiError(409, 'STOCK_UNAVAILABLE', 'Le comptage ne peut pas être validé.', {
          [`lines.${LINE_FRAME}`]: [
            'Ligne FR-001 : le comptage retirerait de la marchandise réservée pour une vente émise ou confiée à un poste (disponible : 6.000). Traitez ces réservations avant de valider.',
          ],
        })
      }
      return json(200, {
        data: {
          ...counted,
          status: 'VALIDATED',
          lines: [
            {
              ...counted.lines[0],
              adjustment_quantity: '-2.000',
              unit_cost: 18000,
              variance_value: -36000,
            },
          ],
        },
      })
    })

    const { root, unmount } = await openApp(`/stock/inventaires/${INVENTORY_ID}`)
    expect(textOf(root)).toContain('Validation par la gérante')

    await click(buttonByName(root, 'Valider l’inventaire'))
    expect(textOf(root)).toContain(
      'Le motif de l’approbation est obligatoire (3 caractères au moins).',
    )
    expect(callsTo(api, 'POST', /validate$/)).toHaveLength(0)

    await typeInto(root, 'inventaire-motif-validation', 'Inventaire de fin de mois')
    await click(buttonByName(root, 'Valider l’inventaire'))
    expect(callsTo(api, 'POST', /validate$/)[0]?.body).toEqual({
      expected_version: null,
      reason: 'Inventaire de fin de mois',
    })
    expect(textOf(root)).toContain('le comptage retirerait de la marchandise réservée')
    expect(textOf(root)).toContain('Validation par la gérante')

    await click(buttonByName(root, 'Valider l’inventaire'))

    expect(textOf(root)).toContain('Inventaire validé : les écarts sont ajustés dans le stock.')
    expect(textOf(root)).toContain('Cet inventaire est définitif')
    expect(textOf(root)).toContain('Ajusté dans le stock : -2')
    expect(buttonByName(root, 'Valider l’inventaire')).toBeNull()
    unmount()
  })
})

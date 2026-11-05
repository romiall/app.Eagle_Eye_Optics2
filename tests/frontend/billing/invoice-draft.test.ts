import { webcrypto } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MutationDispatcher } from '@/app/services/mutations'

import {
  apiError,
  buttonByName,
  callsTo,
  CASHIER,
  catalogItem,
  chooseFirst,
  click,
  dialogButton,
  draftInvoice,
  forbiddenWordsIn,
  INVOICE_ID,
  issuedInvoice,
  ITEM_ID,
  json,
  MANAGER,
  openApp,
  PATIENT_ID,
  resetSales,
  salesPatient,
  type SalesApi,
  searchCombobox,
  stubSalesApi,
  textOf,
  typeInto,
  VISIT_ID,
} from './support'

// Brouillon de facture (B02) et émission (B03), EN LIGNE : patient présélectionné (jamais ressaisi),
// lignes du catalogue, totaux des règles partagées, enregistrement explicite, conflit de version qui
// conserve la saisie, remise refusée rattachée à sa ligne, confirmation d'émission et numéro définitif
// affiché après la réponse du serveur seulement. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

function server(permissions = CASHIER): SalesApi {
  const api = stubSalesApi({ permissions })
  api.on('GET', /^\/api\/v1\/patients\/([^/]+)$/, () => json(200, { data: salesPatient() }))
  api.on('GET', /^\/api\/v1\/catalog$/, () =>
    json(200, {
      data: [catalogItem()],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
    }),
  )
  return api
}

async function addCatalogLine(root: ParentNode): Promise<void> {
  const input = await searchCombobox(root, 'facture-catalogue', 'DEMO')
  await chooseFirst(input)
}

describe('nouveau brouillon', () => {
  it('depuis la fiche : identité reprise du dossier, lignes du catalogue, total, enregistrement', async () => {
    const api = server()
    let created: Record<string, unknown> | null = null
    api.on('POST', /^\/api\/v1\/invoices$/, (request) => {
      created = request.body
      const lines = request.body?.['lines'] as { line_id: string }[]
      return json(201, {
        data: draftInvoice({
          id: String(request.body?.['invoice_id']),
          total_gross: 40000,
          lines: [
            {
              ...draftInvoice().lines[0]!,
              id: lines[0]?.line_id ?? 'x',
              quantity: '1.000',
              line_total_gross: 40000,
            },
          ],
        }),
      })
    })
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, (_request, match) =>
      json(200, { data: draftInvoice({ id: match[1] ?? INVOICE_ID }) }),
    )

    const { root, router, unmount } = await openApp(
      `/ventes/factures/nouvelle?patient=${PATIENT_ID}`,
    )

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Nouvelle facture')
    expect(textOf(root)).toContain('PATIENT FICTIF Élodie Marie')
    expect(textOf(root)).toContain('TEST-P-000001')
    // L'identité n'est jamais ressaisie : aucun champ de nom, de téléphone ni de naissance.
    expect(root.querySelector('input[autocomplete="family-name"]')).toBeNull()
    expect(
      [...root.querySelectorAll('label')].map((label) => label.textContent ?? ''),
    ).not.toContain('Nom')

    await addCatalogLine(root)
    expect(textOf(root)).toContain('Monture fictive (démonstration)')
    expect(textOf(root)).toContain('Total TTC : 40 000 FCFA')
    // Sans autorité de prix, le prix du catalogue s'impose : le champ est en lecture seule.
    const price = root.querySelector<HTMLInputElement>('input[id$="-unitPriceGross"]')
    expect(price?.disabled).toBe(true)
    expect(textOf(root)).toContain('Remise réservée à la gérante')

    await click(buttonByName(root, 'Enregistrer le brouillon'))

    expect(created).toMatchObject({
      expected_version: null,
      patient_id: PATIENT_ID,
      visit_id: null,
      due_date: null,
      lines: [
        {
          position: 1,
          catalog_item_id: ITEM_ID,
          description: 'Monture fictive (démonstration)',
          quantity: '1.000',
          unit_price_gross: 40000,
          discount_gross: 0,
          prescription_id: null,
        },
      ],
    })
    const [post] = callsTo(api, 'POST', /^\/api\/v1\/invoices$/)
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('facture'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Brouillon de facture enregistré'))
    expect(textOf(root)).toContain('Brouillon de facture enregistré sur le serveur.')
    expect(textOf(root)).toContain('Facture en brouillon (sans numéro)')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('depuis une visite de la file du jour : la visite accompagne le brouillon', async () => {
    const api = server()
    api.on('POST', /^\/api\/v1\/invoices$/, (request) =>
      json(201, {
        data: draftInvoice({ id: String(request.body?.['invoice_id']), visit_id: VISIT_ID }),
      }),
    )
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () => json(200, { data: draftInvoice() }))

    const { root, unmount } = await openApp(
      `/ventes/factures/nouvelle?patient=${PATIENT_ID}&visite=${VISIT_ID}`,
    )
    await addCatalogLine(root)
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    expect(callsTo(api, 'POST', /^\/api\/v1\/invoices$/)[0]?.body).toMatchObject({
      patient_id: PATIENT_ID,
      visit_id: VISIT_ID,
    })

    unmount()
  })

  it('une remise refusée par le serveur est dite sur sa ligne, la saisie reste', async () => {
    const api = server()
    api.on('POST', /^\/api\/v1\/invoices$/, () =>
      apiError(
        422,
        'APPROVAL_REQUIRED_OR_EXPIRED',
        'Cette opération exige l’autorisation exacte de la gérante.',
        {
          'lines.0.discount_gross': ['La remise dépasse le plafond autorisé pour ce compte (0 %).'],
        },
      ),
    )

    const { root, unmount } = await openApp(`/ventes/factures/nouvelle?patient=${PATIENT_ID}`)
    await addCatalogLine(root)
    const discount = root.querySelector<HTMLInputElement>('input[id$="-discountGross"]')
    if (discount === null) throw new Error('Champ de remise introuvable.')
    await typeInto(root, discount.id, '5000')
    expect(textOf(root)).toContain('Total TTC : 35 000 FCFA')
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    expect(textOf(root)).toContain(
      'Ligne 1 : La remise dépasse le plafond autorisé pour ce compte (0 %).',
    )
    expect(
      root
        .querySelector<HTMLInputElement>('input[id$="-discountGross"]')
        ?.value.replace(/\s/g, ' '),
    ).toBe('5 000')

    unmount()
  })

  it('module « sales » fermé : la nouvelle facture est introuvable', async () => {
    stubSalesApi({ permissions: CASHIER, modules: ['patients', 'today'] })
    const { router, unmount } = await openApp(`/ventes/factures/nouvelle?patient=${PATIENT_ID}`)

    expect(router.currentRoute.value.name).toBe('introuvable')

    unmount()
  })

  it('sans droit de création : accès refusé', async () => {
    stubSalesApi({ permissions: ['invoice.read', 'patient.read'] })
    const { router, unmount } = await openApp(`/ventes/factures/nouvelle?patient=${PATIENT_ID}`)

    expect(router.currentRoute.value.name).toBe('acces-refuse')

    unmount()
  })
})

describe('brouillon existant : conflit de version', () => {
  it('409 : la saisie est conservée ; « Garder ma saisie » l’envoie sur la version actuelle', async () => {
    const api = server()
    let version = 1
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () =>
      json(200, { data: draftInvoice({ draft_version: version }) }),
    )
    api.on('PATCH', /^\/api\/v1\/invoices\/([^/]+)$/, (request) => {
      if (request.body?.['expected_version'] !== version) {
        return json(409, {
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Une version plus récente existe : actualisez avant de modifier.',
            details: { current_version: version },
          },
          correlation_id: 'corr-test-0400',
        })
      }
      version += 1
      return json(200, { data: draftInvoice({ draft_version: version, total_gross: 120000 }) })
    })

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`)
    expect(textOf(root)).toContain('Brouillon enregistré, sans numéro définitif.')
    // Quelqu'un d'autre enregistre entre-temps.
    version = 2
    const quantity = root.querySelector<HTMLInputElement>('input[id$="-quantity"]')
    if (quantity === null) throw new Error('Champ de quantité introuvable.')
    await typeInto(root, quantity.id, '3')
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    expect(textOf(root)).toContain('Le brouillon a changé entre-temps')
    expect(root.querySelector<HTMLInputElement>('input[id$="-quantity"]')?.value).toBe('3,000')

    await click(buttonByName(root, 'Relire le brouillon'))
    await click(buttonByName(root, 'Garder ma saisie'))
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    const patches = callsTo(api, 'PATCH', /^\/api\/v1\/invoices\//)
    expect(patches.map((patch) => patch.body?.['expected_version'])).toEqual([1, 2])
    expect(patches[1]?.body?.['lines']).toEqual([expect.objectContaining({ quantity: '3.000' })])
    expect(patches[0]?.headers['Idempotency-Key']).not.toBe(patches[1]?.headers['Idempotency-Key'])

    unmount()
  })
})

describe('émission', () => {
  it('confirmation explicite, puis numéro définitif affiché après la réponse du serveur seulement', async () => {
    const api = server()
    let issued = false
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () =>
      json(200, { data: issued ? issuedInvoice() : draftInvoice() }),
    )
    api.on('POST', /^\/api\/v1\/invoices\/([^/]+)\/issue$/, () => {
      issued = true
      return json(200, { data: issuedInvoice() })
    })
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: null }))

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`)
    expect(textOf(root)).not.toContain('TEST-FAC')

    await click(buttonByName(root, 'Émettre la facture'))
    expect(textOf(root)).toContain('La facture émise ne pourra plus être modifiée.')
    expect(callsTo(api, 'POST', /issue$/)).toHaveLength(0)
    expect(textOf(root)).not.toContain('TEST-FAC')

    await click(dialogButton(root, 'Émettre la facture'))
    // L'empreinte des lignes (Web Crypto) précède l'envoi : attendre la commande puis son issue.
    await vi.waitFor(() => expect(callsTo(api, 'POST', /issue$/)).toHaveLength(1))
    await vi.waitFor(() => expect(textOf(root)).toContain('Facture émise : numéro'))

    const [issue] = callsTo(api, 'POST', /issue$/)
    expect(issue?.path).toBe(`/api/v1/invoices/${INVOICE_ID}/issue`)
    expect(issue?.body).toMatchObject({
      expected_version: 1,
      invoice_id: INVOICE_ID,
      number: null,
      write_owner_id: null,
      reservations: [],
      total_gross: 80000,
      issued_at: '2026-10-15T09:00:00.000Z',
    })
    expect(String(issue?.body?.['catalog_snapshot_sha256'])).toMatch(/^[0-9a-f]{64}$/)
    expect(textOf(root)).toContain('Facture émise : numéro TEST-FAC-2026-000001.')
    expect(root.querySelector('h1')?.textContent).toContain('Facture TEST-FAC-2026-000001')
    expect(textOf(root)).toContain('Reste à encaisser')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('stock insuffisant à l’émission : la ligne et la quantité disponible sont dites, rien n’est émis', async () => {
    const api = server()
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () => json(200, { data: draftInvoice() }))
    api.on('POST', /issue$/, () =>
      json(409, {
        error: {
          code: 'STOCK_UNAVAILABLE',
          message: 'Stock insuffisant pour cet article.',
          fields: { 'lines.0.quantity': ['Stock insuffisant pour cet article.'] },
          details: { available: '1.000' },
        },
        correlation_id: 'corr-test-0401',
      }),
    )

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`)
    await click(buttonByName(root, 'Émettre la facture'))
    await click(dialogButton(root, 'Émettre la facture'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Stock insuffisant'))

    expect(textOf(root)).toContain('Ligne 1 : Stock insuffisant pour cet article.')
    expect(textOf(root)).toContain('disponible 1.000 selon le serveur')
    expect(textOf(root)).not.toContain('TEST-FAC')

    unmount()
  })

  it('la gérante modifie le prix et ajoute une ligne hors catalogue', async () => {
    server(MANAGER)
    const { root, unmount } = await openApp(`/ventes/factures/nouvelle?patient=${PATIENT_ID}`)

    await addCatalogLine(root)
    expect(root.querySelector<HTMLInputElement>('input[id$="-unitPriceGross"]')?.disabled).toBe(
      false,
    )
    expect(textOf(root)).toContain('au plus le montant brut de la ligne')
    await click(buttonByName(root, 'Ajouter une ligne hors catalogue'))
    expect(textOf(root)).toContain('hors catalogue')

    unmount()
  })
})

describe('poste préparé : brouillon et émission enregistrés sur le poste (G1, AT37)', () => {
  /** Journal du poste simulé : la commande est « enregistrée sur ce poste », jamais envoyée au serveur. */
  function deviceJournal(onCommit: (name: string) => void = () => undefined): {
    dispatcher: MutationDispatcher
    names: string[]
  } {
    const names: string[] = []
    return {
      names,
      dispatcher: {
        dispatch: async (request) => {
          names.push(request.name)
          onCommit(request.name)
          return { kind: 'saved-local', at: '2026-10-15T09:42:00.000Z' }
        },
      },
    }
  }

  it('le brouillon est dit « enregistré sur ce poste », relu dans le coffre, et la facture s’ouvre', async () => {
    const api = server()
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, (_request, match) =>
      json(200, { data: draftInvoice({ id: match[1] ?? INVOICE_ID }) }),
    )
    const journal = deviceJournal()

    const { root, router, unmount } = await openApp(
      `/ventes/factures/nouvelle?patient=${PATIENT_ID}`,
      { dispatcher: journal.dispatcher },
    )
    await addCatalogLine(root)
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('facture'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Brouillon de facture enregistré'))
    expect(journal.names).toEqual(['CreateInvoiceDraft'])
    expect(callsTo(api, 'POST', /^\/api\/v1\/invoices$/)).toHaveLength(0)
    expect(textOf(root)).toContain(
      'Brouillon de facture enregistré sur ce poste, en attente de synchronisation.',
    )
    expect(textOf(root)).not.toContain('enregistré sur le serveur')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('une modification du brouillon reste sur le poste : « Enregistré sur ce poste », aucune requête d’écriture', async () => {
    const api = server()
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () => json(200, { data: draftInvoice() }))
    const journal = deviceJournal()

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`, {
      dispatcher: journal.dispatcher,
    })
    const quantity = root.querySelector<HTMLInputElement>('input[id$="-quantity"]')
    if (quantity === null) throw new Error('Champ de quantité introuvable.')
    await typeInto(root, quantity.id, '3')
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    await vi.waitFor(() => expect(journal.names).toEqual(['UpdateDraft']))
    await vi.waitFor(() => expect(textOf(root)).toContain('Enregistré sur ce poste'))
    expect(callsTo(api, 'PATCH', /^\/api\/v1\/invoices\//)).toHaveLength(0)
    expect(textOf(root)).not.toContain('Enregistré sur le serveur')

    unmount()
  })

  it('l’émission porte le numéro de la plage du poste, sans « serveur », et la fiche dit que la facture est celle du poste', async () => {
    const api = server()
    let issued = false
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () =>
      json(200, { data: issued ? issuedInvoice() : draftInvoice() }),
    )
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: null }))
    const journal = deviceJournal((name) => {
      if (name === 'IssueInvoice') issued = true
    })

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`, {
      dispatcher: journal.dispatcher,
    })
    await click(buttonByName(root, 'Émettre la facture'))
    await click(dialogButton(root, 'Émettre la facture'))
    await vi.waitFor(() => expect(journal.names).toEqual(['IssueInvoice']))
    await vi.waitFor(() => expect(textOf(root)).toContain('Facture émise sur ce poste : numéro'))

    expect(callsTo(api, 'POST', /issue$/)).toHaveLength(0)
    expect(textOf(root)).toContain(
      'Facture émise sur ce poste : numéro TEST-FAC-2026-000001, en attente de synchronisation.',
    )
    expect(root.querySelector('h1')?.textContent).toContain('Facture TEST-FAC-2026-000001')
    // Facture du poste : remises au patient, avoirs et corrections demandent le serveur et ne sont pas offerts.
    expect(textOf(root)).toContain('Facture de ce poste')
    expect(textOf(root)).toContain('se feront après l’envoi au serveur')
    expect(textOf(root)).not.toContain('Facture émise : numéro')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('la pièce enregistrée sur le poste mais non relisible n’est jamais refaite : message, rien d’autre', async () => {
    const api = server()
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () =>
      json(404, {
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Ressource introuvable.' },
        correlation_id: 'corr-test-0404',
      }),
    )
    const journal = deviceJournal()

    const { root, router, unmount } = await openApp(
      `/ventes/factures/nouvelle?patient=${PATIENT_ID}`,
      { dispatcher: journal.dispatcher },
    )
    await addCatalogLine(root)
    await click(buttonByName(root, 'Enregistrer le brouillon'))

    await vi.waitFor(() =>
      expect(textOf(root)).toContain('part à la synchronisation, ne la refaites pas'),
    )
    expect(router.currentRoute.value.name).toBe('facture-nouvelle')
    expect(journal.names).toEqual(['CreateInvoiceDraft'])

    unmount()
  })
})

describe('poste préparé : relecture vérifiée et état d’enregistrement exact (revue A1)', () => {
  function journalOf(names: string[]): MutationDispatcher {
    return {
      dispatch: async (request) => {
        names.push(request.name)
        return { kind: 'saved-local', at: '2026-10-15T09:42:00.000Z' }
      },
    }
  }

  it('une émission sur le poste dont la relecture ne rend que le brouillon du serveur n’est jamais présentée comme émise, et plus rien ne s’édite', async () => {
    const api = server()
    // Patient du serveur seulement : le poste ne sait pas reconstruire la facture émise, le serveur ne connaît que le brouillon.
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () => json(200, { data: draftInvoice() }))
    const names: string[] = []

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`, {
      dispatcher: journalOf(names),
    })
    await click(buttonByName(root, 'Émettre la facture'))
    await click(dialogButton(root, 'Émettre la facture'))

    await vi.waitFor(() => expect(names).toEqual(['IssueInvoice']))
    await vi.waitFor(() => expect(textOf(root)).toContain('Ne l’émettez pas de nouveau'))
    expect(textOf(root)).not.toContain('Facture émise sur ce poste : numéro')
    expect(root.querySelector('h1')?.textContent).not.toContain('TEST-FAC')
    expect(buttonByName(root, 'Émettre la facture')?.disabled).toBe(true)
    // Une seconde demande d’émission n’envoie rien de plus.
    await click(buttonByName(root, 'Émettre la facture'))
    expect(names).toEqual(['IssueInvoice'])

    unmount()
  })

  it('« Enregistré sur ce poste » disparaît dès qu’une nouvelle saisie n’est pas enregistrée', async () => {
    const api = server()
    api.on('GET', /^\/api\/v1\/invoices\/([^/]+)$/, () => json(200, { data: draftInvoice() }))
    const names: string[] = []

    const { root, unmount } = await openApp(`/ventes/factures/${INVOICE_ID}`, {
      dispatcher: journalOf(names),
    })
    const quantity = root.querySelector<HTMLInputElement>('input[id$="-quantity"]')
    if (quantity === null) throw new Error('Champ de quantité introuvable.')
    await typeInto(root, quantity.id, '3')
    await click(buttonByName(root, 'Enregistrer le brouillon'))
    await vi.waitFor(() => expect(textOf(root)).toContain('Enregistré sur ce poste'))

    const next = root.querySelector<HTMLInputElement>('input[id$="-quantity"]')
    if (next === null) throw new Error('Champ de quantité introuvable.')
    await typeInto(root, next.id, '4')

    expect(textOf(root)).not.toContain('Enregistré sur ce poste')
    unmount()
  })
})

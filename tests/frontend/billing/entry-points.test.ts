import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEeoApp } from '@/app/bootstrap'
import { APP_MODULES, visibleModules } from '@/app/navigation'
import { directBody, type MutationRequest } from '@/app/services/mutations'
import { listInvoices, searchCatalog } from '@/app/services/billing'
import { confirmPassword } from '@/app/services/reauth'

import { visit, visitPage } from '../visits/support'
import {
  buttonByName,
  callsTo,
  CASHIER,
  catalogItem,
  click,
  dialogButton,
  json,
  MANAGER,
  openApp,
  PATIENT_ID,
  resetSales,
  salesPatient,
  stubSalesApi,
  textOf,
  typeInto,
} from './support'

// Points d'entrée des écrans de vente (B02) : bouton « Créer une facture » sur la fiche et dans la
// file du jour (droit ET module), routes et navigation derrière le module « sales », lectures du
// service, routes explicites versionnées, et réauthentification d'une écriture sensible (423) suivie de
// la reprise de la même commande. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

describe('routes et navigation des ventes', () => {
  it('chaque route de vente dépend du module « sales » (le stock : « stock ») et de ses permissions', () => {
    const { router } = createEeoApp(createMemoryHistory())
    const sales = new Map(
      router
        .getRoutes()
        .filter((route) => route.path.startsWith('/ventes') || route.path === '/stock')
        .map((route) => [String(route.name), [route.meta.module, route.meta.permissions]]),
    )
    expect(Object.fromEntries(sales)).toEqual({
      ventes: [
        'sales',
        ['invoice.read', 'payment.collect', 'cash.own_session', 'exam_fee.collect'],
      ],
      caisse: ['sales', ['cash.own_session']],
      // Catégories de dépenses de la caisse (L1D05) : gérante.
      'categories-depenses': ['sales', ['cash.manage']],
      'caisse-du-jour': ['sales', ['finance.global.read', 'cash.own_session']],
      // Finance du cabinet sur une période (R01) : la gérante seule.
      finance: ['sales', ['finance.global.read']],
      factures: ['sales', ['invoice.read']],
      'facture-nouvelle': ['sales', ['invoice.create', 'exam_fee.collect']],
      facture: ['sales', ['invoice.read']],
      // Devis (L1D07) : lecture invoice.read, établissement invoice.create.
      devis: ['sales', ['invoice.read']],
      'devis-nouveau': ['sales', ['invoice.create']],
      'devis-detail': ['sales', ['invoice.read']],
      catalogue: ['sales', ['catalog.manage']],
      // Import contrôlé du catalogue (X01) : catalog.manage.
      'import-catalogue': ['sales', ['catalog.manage']],
      taxes: ['sales', ['catalog.manage']],
      stock: ['stock', ['stock.read']],
    })
    expect(router.resolve('/ventes/factures/01J9ZXK4M2Q8R7S6T5V4W30026').name).toBe('facture')
    expect(router.resolve('/ventes/factures/abc').name).toBe('introuvable')
  })

  it('« Ventes et caisse » apparaît pour la caisse quand le module est ouvert, jamais sinon', () => {
    expect(visibleModules(CASHIER, ['sales'], APP_MODULES).map((entry) => entry.id)).toEqual([
      'sales',
    ])
    expect(visibleModules(CASHIER, ['patients'], APP_MODULES).map((entry) => entry.id)).toEqual([
      'patients',
    ])
  })
})

describe('« Créer une facture » sur la fiche patient', () => {
  function server(permissions: string[], modules?: readonly string[]) {
    const api = stubSalesApi({ permissions, ...(modules === undefined ? {} : { modules }) })
    api.on('GET', /^\/api\/v1\/patients\/([^/]+)$/, () => json(200, { data: salesPatient() }))
    return api
  }

  it('avec le droit et le module : le patient est présélectionné par son identifiant', async () => {
    server(CASHIER)
    const { root, unmount } = await openApp(`/patients/${PATIENT_ID}`)

    const link = [...root.querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('Créer une facture'),
    )
    expect(link?.getAttribute('href')).toBe(`/ventes/factures/nouvelle?patient=${PATIENT_ID}`)

    unmount()
  })

  it('module « sales » fermé ou droit absent : aucun bouton', async () => {
    server(CASHIER, ['patients', 'today'])
    const closed = await openApp(`/patients/${PATIENT_ID}`)
    expect(textOf(closed.root)).not.toContain('Créer une facture')
    closed.unmount()
    resetSales()

    server(['patient.read', 'patient.update'])
    const reader = await openApp(`/patients/${PATIENT_ID}`)
    expect(textOf(reader.root)).not.toContain('Créer une facture')
    reader.unmount()
  })
})

describe('« Créer une facture » dans la file du jour', () => {
  it('par visite, avec le patient et la visite en identifiants opaques ; jamais pour une visite annulée', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/visits$/, () =>
      json(
        200,
        visitPage([visit(), visit({ id: '01J9ZXK4M2Q8R7S6T5V4W30022', status: 'CANCELLED' })]),
      ),
    )
    const { root, unmount } = await openApp('/aujourdhui')

    const links = [...root.querySelectorAll('#file-cartes a')].filter((anchor) =>
      anchor.textContent?.includes('Créer une facture'),
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe(
      '/ventes/factures/nouvelle?patient=01J9ZXK4M2Q8R7S6T5V4W30011&visite=01J9ZXK4M2Q8R7S6T5V4W30021',
    )
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'Créer une facture pour PATIENT FICTIF Élodie Marie',
    )
    // Le contrôle du paiement de l'examen reste « non contrôlé » : rien ne suggère le contraire.
    expect(textOf(root)).toContain('Paiement de l’examen non contrôlé')

    unmount()
  })

  it('sans le module « sales » : aucun lien de facturation', async () => {
    const api = stubSalesApi({ permissions: CASHIER, modules: ['today', 'patients'] })
    api.on('GET', /^\/api\/v1\/visits$/, () => json(200, visitPage([visit()])))
    const { root, unmount } = await openApp('/aujourdhui')

    expect(textOf(root)).not.toContain('Créer une facture')

    unmount()
  })
})

describe('services de lecture des ventes', () => {
  it('liste des factures : état, patient et page en paramètres ; identifiant invalide refusé avant envoi', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/invoices$/, () =>
      json(200, { data: [], meta: { current_page: 2, last_page: 2, per_page: 25, total: 26 } }),
    )

    const outcome = await listInvoices({ status: 'ISSUED', patientId: PATIENT_ID, page: 2 })

    const [call] = callsTo(api, 'GET', /^\/api\/v1\/invoices$/)
    expect(call?.query.get('status')).toBe('ISSUED')
    expect(call?.query.get('patient_id')).toBe(PATIENT_ID)
    expect(call?.query.get('page')).toBe('2')
    expect(outcome.live).toBe(true)
    await expect(listInvoices({ patientId: 'pas-un-ulid' })).rejects.toThrow(RangeError)
  })

  it('catalogue : texte de 2 caractères au moins, articles désactivés seulement sur demande', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('GET', /^\/api\/v1\/catalog$/, () =>
      json(200, {
        data: [catalogItem()],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
      }),
    )

    await searchCatalog('DE', 1, { includeInactive: true })
    const [call] = callsTo(api, 'GET', /^\/api\/v1\/catalog$/)
    expect(call?.query.get('query')).toBe('DE')
    expect(call?.query.get('include_inactive')).toBe('true')
    await expect(searchCatalog('D')).rejects.toThrow(RangeError)
  })

  it('routes explicites : version de l’entité obligatoire, ou corps sans version (stock initial)', () => {
    const contract = {
      name: 'UpdateCatalogItem',
      method: 'PATCH',
      path: '/api/v1/catalog/items/x',
      permission: '',
      expectedVersion: 'entity',
      entityType: '',
      entityIdField: '',
      numberType: null,
      directNumberField: null,
    } as const
    const request: MutationRequest = {
      name: 'UpdateCatalogItem',
      route: { method: 'PATCH', path: '/catalog/items/x', expectedVersion: 'entity' },
      payload: { reference: 'DEMO' },
      expectedVersion: 3,
      idempotencyKey: '01J9ZXK4M2Q8R7S6T5V4W3K001',
    }
    expect(directBody({ ...contract, name: 'UpdatePatient' }, request)).toStrictEqual({
      reference: 'DEMO',
      expected_version: 3,
    })
    const opening: MutationRequest = {
      name: 'RegisterOpeningStock',
      route: { method: 'POST', path: '/stock/opening', expectedVersion: 'omitted' },
      payload: { reason: 'Comptage fictif' },
      idempotencyKey: '01J9ZXK4M2Q8R7S6T5V4W3K002',
    }
    expect(
      directBody({ ...contract, name: 'UpdatePatient', expectedVersion: 'none' }, opening),
    ).toStrictEqual({ reason: 'Comptage fictif' })
  })

  it('confirmation du mot de passe : POST /auth/reauthenticate, mot de passe dans le corps seulement', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('POST', /^\/api\/v1\/auth\/reauthenticate$/, () =>
      json(200, { data: { reauthenticated_until: '2026-10-15T09:15:00.000Z' } }),
    )

    expect(await confirmPassword('mot-de-passe-fictif')).toBe('2026-10-15T09:15:00.000Z')
    const [call] = callsTo(api, 'POST', /reauthenticate$/)
    expect(call?.body).toStrictEqual({ password: 'mot-de-passe-fictif' })
    expect(call?.query.toString()).toBe('')
  })
})

describe('règle fiscale : réauthentification puis reprise sans doublon', () => {
  it('423 : la boîte de confirmation s’ouvre, puis la même commande repart avec la même clé', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    let confirmedPassword = false
    const rules: unknown[] = []
    api.on('GET', /^\/api\/v1\/tax-rules$/, () => json(200, { data: rules }))
    api.on('POST', /^\/api\/v1\/auth\/reauthenticate$/, () => {
      confirmedPassword = true
      return json(200, { data: { reauthenticated_until: '2026-10-15T09:15:00.000Z' } })
    })
    api.on('POST', /^\/api\/v1\/tax-rules$/, (request) => {
      if (!confirmedPassword) {
        return json(423, {
          error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Confirmez votre mot de passe.' },
          correlation_id: 'corr-test-0600',
        })
      }
      const rule = {
        id: '01J9ZXK4M2Q8R7S6T5V4W30T01',
        code: String(request.body?.['code']),
        label: String(request.body?.['label']),
        rate_percent: request.body?.['rate_percent'] ?? null,
        active: request.body?.['active'] === true,
        validated_by: '01J9ZXK4M2Q8R7S6T5V4W30002',
        validated_at: '2026-10-15T09:00:00.000Z',
        legal_note: null,
        version: 1,
      }
      rules.push(rule)
      return json(201, { data: rule })
    })

    const { root, unmount } = await openApp('/ventes/taxes')
    expect(textOf(root)).toContain('Aucune taxe n’est préconfigurée')
    await click(buttonByName(root, 'Nouvelle règle'))
    await typeInto(root, 'regle-code', 'TEST_TAXE_FICTIVE')
    await typeInto(root, 'regle-label', 'Taxe fictive de démonstration')
    await typeInto(root, 'regle-ratePercent', '10')
    const validate = root.querySelector<HTMLInputElement>('[id="regle-validate"]')
    validate?.click()
    const active = root.querySelector<HTMLInputElement>('[id="regle-active"]')
    active?.click()
    await click(buttonByName(root, 'Enregistrer la règle'))

    expect(textOf(root)).toContain('Confirmer votre mot de passe')
    const confirmationId = root.querySelector('[id^="confirmation-mot-de-passe"]')?.id ?? ''
    await typeInto(root, confirmationId, 'mot-de-passe-fictif')
    await click(dialogButton(root, 'Confirmer et reprendre'))
    await vi.waitFor(() => expect(callsTo(api, 'POST', /^\/api\/v1\/tax-rules$/)).toHaveLength(2))
    await vi.waitFor(() => expect(textOf(root)).toContain('enregistrée sur le serveur'))

    const posts = callsTo(api, 'POST', /^\/api\/v1\/tax-rules$/)
    expect(posts).toHaveLength(2)
    expect(posts[1]?.headers['Idempotency-Key']).toBe(posts[0]?.headers['Idempotency-Key'])
    expect(posts[1]?.body).toMatchObject({
      expected_version: null,
      code: 'TEST_TAXE_FICTIVE',
      rate_percent: '10.0000',
      active: true,
      validate: true,
    })
    expect(textOf(root)).toContain('Règle TEST_TAXE_FICTIVE enregistrée sur le serveur')

    unmount()
  })
})

describe('catalogue (gérante)', () => {
  it('liste les articles et crée un article fictif par la route explicite', async () => {
    const api = stubSalesApi({ permissions: MANAGER })
    api.on('GET', /^\/api\/v1\/tax-rules$/, () => json(200, { data: [] }))
    api.on('GET', /^\/api\/v1\/catalog$/, () =>
      json(200, {
        data: [catalogItem()],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
      }),
    )
    api.on('POST', /^\/api\/v1\/catalog\/items$/, (request) =>
      json(201, {
        data: catalogItem({
          id: '01J9ZXK4M2Q8R7S6T5V4W30C09',
          reference: String(request.body?.['reference']),
        }),
      }),
    )

    const { root, unmount } = await openApp('/ventes/catalogue')
    expect(textOf(root)).toContain('Monture fictive (démonstration)')
    expect(textOf(root)).toContain('DEMO-MONTURE')

    await click(buttonByName(root, 'Nouvel article'))
    await typeInto(root, 'article-nouveau-reference', 'DEMO-ETUI')
    await typeInto(root, 'article-nouveau-name', 'Étui fictif (démonstration)')
    const category = root.querySelector<HTMLSelectElement>('[id="article-nouveau-categoryCode"]')
    if (category !== null) {
      category.value = 'OTHER'
      category.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const unit = root.querySelector<HTMLSelectElement>('[id="article-nouveau-unitCode"]')
    if (unit !== null) {
      unit.value = 'UNIT'
      unit.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const mode = root.querySelector<HTMLSelectElement>('[id="article-nouveau-stockMode"]')
    if (mode !== null) {
      mode.value = 'NONE'
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await typeInto(root, 'article-nouveau-salePrice', '2500')
    await click(buttonByName(root, 'Créer l’article'))

    const [post] = callsTo(api, 'POST', /^\/api\/v1\/catalog\/items$/)
    expect(post?.body).toMatchObject({
      expected_version: null,
      reference: 'DEMO-ETUI',
      category_code: 'OTHER',
      unit_code: 'UNIT',
      stock_mode: 'NONE',
      sale_price: 2500,
      purchase_cost: null,
    })
    expect(textOf(root)).toContain('Article DEMO-ETUI enregistré sur le serveur.')

    unmount()
  })

  it('la caisse n’ouvre pas le catalogue de gestion', async () => {
    stubSalesApi({ permissions: CASHIER })
    const { router, unmount } = await openApp('/ventes/catalogue')

    expect(router.currentRoute.value.name).toBe('acces-refuse')

    unmount()
  })
})

import { webcrypto } from 'node:crypto'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deviceLocalEngine } from '@/app/services/localEngine'
import type { MutationRequest } from '@/app/services/mutations'
import {
  type CashLocalFactRecord,
  localDrawerExpenseDelta,
  localExpensesFromFacts,
  localPendingCashSession,
  pendingLocalExpenses,
} from '@/domain/cash/localMovements'
import type { CashMovement, ExpenseCategory } from '@/domain/contracts/generated'

import {
  buttonByName,
  callsTo,
  CASHIER,
  click,
  forbiddenWordsIn,
  json,
  MANAGER,
  openApp,
  openSession,
  resetSales,
  selectInto,
  SESSION_ID,
  stubSalesApi,
  textOf,
  typeInto,
} from './support'

/**
 * Écran Dépenses (/ventes/depenses), caisse enrichie (Expenses.vue) et suivi local sur poste préparé
 * (L1D05 + A1/A2/A3) :
 *  - entrée « Dépenses » visible au menu pour gérante et caissière ;
 *  - dépense enregistrée directement sans approbation préalable, avec motif et référence facultatifs,
 *    au tiroir espèces OU hors tiroir même sans session de caisse ouverte ;
 *  - caisse enrichie : séparation dépense directe / entrée motivée / sortie motivée (motif obligatoire
 *    et approbation sur entrées/sorties) + totaux et filtres ;
 *  - hors-ligne sur poste préparé : enregistrement local, badge « Enregistré sur ce poste » et ajustement
 *    du disponible tiroir.
 * Données FICTIVES.
 */
const PAGE = '/ventes/depenses'
const CASH_PAGE = '/ventes/caisse'
const CATEGORY_ID = '01J9ZXK4M2Q8R7S6T5V4W3C001'
const CATEGORY_OTHER_ID = '01J9ZXK4M2Q8R7S6T5V4W3C002'

const CATEGORIES: ExpenseCategory[] = [
  { id: CATEGORY_ID, code: 'FOURNITURES', name: 'Fournitures bureau', active: true },
  {
    id: CATEGORY_OTHER_ID,
    code: 'TRANSPORT',
    name: 'Transport et courses',
    active: true,
  },
]

function movementEntry(overrides: Partial<CashMovement> = {}): CashMovement {
  return {
    id: '01J9ZXK4M2Q8R7S6T5V4W3M001',
    cash_session_id: null,
    kind: 'EXPENSE',
    method: 'MTN_MOMO',
    signed_amount: -12000,
    reason: null,
    reference: null,
    occurred_at: '2026-10-15T09:00:00.000Z',
    expense_category: { id: CATEGORY_ID, code: 'FOURNITURES', name: 'Fournitures bureau' },
    created_by: '01J9ZXK4M2Q8R7S6T5V4W30002',
    created_by_name: 'Caisse Fictive',
    approval_id: null,
    approval_mode: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
  if (globalThis.crypto?.subtle === undefined) vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetSales()
})

describe('dépenses : menu et accès', () => {
  it('l’entrée « Dépenses » apparaît dans le menu principal pour caissière et gérante', async () => {
    for (const permissions of [CASHIER, MANAGER]) {
      const api = stubSalesApi({ permissions })
      api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: CATEGORIES }))
      api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: null }))
      api.on('GET', /^\/api\/v1\/expenses$/, () =>
        json(200, { data: [], meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }),
      )
      const { root, unmount } = await openApp(PAGE)
      const navLinks = [...root.querySelectorAll('nav[aria-label="Navigation principale"] a')].map(
        (link) => link.textContent?.trim(),
      )
      expect(navLinks).toContain('Dépenses')
      expect(root.querySelector('h1')?.textContent).toBe('Dépenses')
      unmount()
      resetSales()
    }
  })

  it('réception sans droit de caisse est refusée sur /ventes/depenses', async () => {
    stubSalesApi({ permissions: ['patient.read', 'visit.register'] })
    const { router, unmount } = await openApp(PAGE)
    expect(router.currentRoute.value.name).toBe('acces-refuse')
    unmount()
  })
})

describe('dépenses : saisie directe hors tiroir et au tiroir', () => {
  it('sans caisse ouverte : permet MTN MoMo directement sans motif ni référence ni approbation', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    const savedList: CashMovement[] = []
    api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: CATEGORIES }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: null }))
    api.on('GET', /^\/api\/v1\/expenses$/, () =>
      json(200, {
        data: savedList,
        meta: { current_page: 1, per_page: 25, total: savedList.length, last_page: 1 },
      }),
    )
    api.on('POST', /^\/api\/v1\/cash-movements$/, (request) => {
      const created = movementEntry({
        id: String(request.body?.['movement_id']),
        signed_amount: Number(request.body?.['signed_amount']),
        method: 'MTN_MOMO',
        reason: null,
        reference: null,
      })
      savedList.push(created)
      return json(201, { data: created })
    })

    const { root, unmount } = await openApp(PAGE)
    await vi.waitFor(() => expect(textOf(root)).toContain('Nouvelle dépense'))

    // Canal initialisé automatiquement hors espèces si aucune caisse ouverte.
    const canalSelect = root.querySelector<HTMLSelectElement>('#depense-canal')
    expect(canalSelect?.value).toBe('MTN_MOMO')

    await typeInto(root, 'depense-montant', '15 000')
    await selectInto(root, 'depense-categorie', CATEGORY_ID)
    await click(buttonByName(root, 'Enregistrer la dépense'))

    const posts = callsTo(api, 'POST', /^\/api\/v1\/cash-movements$/)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({
      expected_version: null,
      cash_session_id: null,
      movement_kind: 'EXPENSE',
      method: 'MTN_MOMO',
      signed_amount: -15000,
      expense_category_id: CATEGORY_ID,
      reason: null,
      reference: null,
      approval_id: null,
    })
    expect(textOf(root)).toContain('Dépense enregistrée (15 000')
    expect(textOf(root)).toContain('Sans motif précisé')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })

  it('avec caisse ouverte : propose Espèces (tiroir) et filtre l’historique serveur', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: CATEGORIES }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () =>
      json(200, { data: openSession({ theoretical_cash: 30000 }) }),
    )
    api.on('GET', /^\/api\/v1\/expenses$/, () =>
      json(200, {
        data: [
          movementEntry({ cash_session_id: SESSION_ID, method: 'CASH', signed_amount: -5000 }),
        ],
        meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
      }),
    )
    api.on('POST', /^\/api\/v1\/cash-movements$/, (request) =>
      json(201, {
        data: movementEntry({
          id: String(request.body?.['movement_id']),
          cash_session_id: SESSION_ID,
          method: 'CASH',
          signed_amount: Number(request.body?.['signed_amount']),
          reason: String(request.body?.['reason']),
          reference: String(request.body?.['reference']),
        }),
      }),
    )

    const { root, unmount } = await openApp(PAGE)
    await vi.waitFor(() => expect(textOf(root)).toContain('Tiroir espèces ouvert'))
    expect(textOf(root)).toContain('30 000')

    // Dépassement du tiroir bloqué localement sans appel serveur.
    await typeInto(root, 'depense-montant', '50 000')
    await selectInto(root, 'depense-categorie', CATEGORY_ID)
    await click(buttonByName(root, 'Enregistrer la dépense'))
    expect(callsTo(api, 'POST', /^\/api\/v1\/cash-movements$/)).toHaveLength(0)
    expect(textOf(root)).toContain('30000 FCFA')

    // Saisie conforme avec motif et justificatif.
    await typeInto(root, 'depense-montant', '10 000')
    await typeInto(root, 'depense-motif', 'Achat papier A4')
    await typeInto(root, 'depense-reference', 'BON-2026-09')
    await click(buttonByName(root, 'Enregistrer la dépense'))

    const posts = callsTo(api, 'POST', /^\/api\/v1\/cash-movements$/)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({
      cash_session_id: SESSION_ID,
      movement_kind: 'EXPENSE',
      method: 'CASH',
      signed_amount: -10000,
      reason: 'Achat papier A4',
      reference: 'BON-2026-09',
      approval_id: null,
    })

    await selectInto(root, 'filtre-depense-categorie', CATEGORY_ID)
    await selectInto(root, 'filtre-depense-canal', 'CASH')
    await click(buttonByName(root, 'Filtrer'))
    const filteredCalls = callsTo(api, 'GET', /^\/api\/v1\/expenses$/)
    const last = filteredCalls.at(-1)
    expect(last?.query.get('category_id')).toBe(CATEGORY_ID)
    expect(last?.query.get('method')).toBe('CASH')

    unmount()
  })

  it('sur poste préparé hors ligne : journalise la dépense sans approbation et l’affiche localement', async () => {
    const committed: Record<string, unknown>[] = []
    vi.spyOn(deviceLocalEngine, 'handles').mockImplementation(
      (req: MutationRequest) =>
        req.name === 'RecordCashMovement' && req.payload['movement_kind'] === 'EXPENSE',
    )
    vi.spyOn(deviceLocalEngine, 'commit').mockImplementation(async (req: MutationRequest) => {
      committed.push({ ...req.payload })
      return { recordedAt: '2026-10-15T09:05:00.000Z' }
    })

    const api = stubSalesApi({ permissions: CASHIER })
    api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: CATEGORIES }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () => json(200, { data: null }))
    api.on('GET', /^\/api\/v1\/expenses$/, () => 'network')

    const { root, unmount } = await openApp(PAGE)
    await vi.waitFor(() => expect(textOf(root)).toContain('Nouvelle dépense'))

    await typeInto(root, 'depense-montant', '7 500')
    await selectInto(root, 'depense-categorie', CATEGORY_ID)
    await click(buttonByName(root, 'Enregistrer la dépense'))
    await flushPromises()

    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({
      movement_kind: 'EXPENSE',
      method: 'MTN_MOMO',
      signed_amount: -7500,
      approval_id: null,
    })
    expect(callsTo(api, 'POST', /^\/api\/v1\/cash-movements$/)).toHaveLength(0)
    expect(textOf(root)).toContain('Dépense enregistrée sur ce poste')

    unmount()
  })
})

describe('caisse enrichie (Expenses.vue dans CashSessionPage)', () => {
  it('sépare dépense directe (motif facultatif) et entrée/sortie motivées (approbation + totaux)', async () => {
    const api = stubSalesApi({ permissions: [...CASHIER, 'approval.request'] })
    const movements: CashMovement[] = [
      movementEntry({
        id: '01J9ZXK4M2Q8R7S6T5V4W3M010',
        cash_session_id: SESSION_ID,
        kind: 'DEPOSIT',
        method: 'CASH',
        signed_amount: 10000,
        reason: 'Apport monnaie',
        expense_category: null,
        approval_id: '01J9ZXK4M2Q8R7S6T5V4W3AP01',
        approval_mode: 'APPROVED',
      }),
    ]
    api.on('GET', /^\/api\/v1\/cash-registers$/, () => json(200, { data: [] }))
    api.on('GET', /^\/api\/v1\/cash-sessions\/current$/, () =>
      json(200, { data: openSession({ theoretical_cash: 45000 }) }),
    )
    api.on('GET', new RegExp(`^/api/v1/cash-sessions/${SESSION_ID}/movements$`), () =>
      json(200, {
        data: {
          session_id: SESSION_ID,
          open: true,
          movements: [...movements],
        },
      }),
    )
    api.on('GET', /^\/api\/v1\/expense-categories$/, () => json(200, { data: CATEGORIES }))
    api.on('POST', /^\/api\/v1\/cash-movements$/, (request) => {
      const created = movementEntry({
        id: String(request.body?.['movement_id']),
        cash_session_id: SESSION_ID,
        kind: 'EXPENSE',
        method: 'CASH',
        signed_amount: Number(request.body?.['signed_amount']),
        reason: null,
      })
      movements.push(created)
      return json(201, { data: created })
    })

    const { root, unmount } = await openApp(CASH_PAGE)
    await vi.waitFor(() => expect(textOf(root)).toContain('Apport monnaie'))

    expect(textOf(root)).toContain('Entrées motivées')
    expect(textOf(root)).toContain('Sorties motivées')
    expect(textOf(root)).toContain('Dépenses au tiroir')

    // Dépense directe par la caissière sans motif ni approbation préalable.
    await typeInto(root, 'mouvement-montant', '4 000')
    await selectInto(root, 'mouvement-categorie', CATEGORY_ID)
    await click(buttonByName(root, 'Enregistrer la dépense'))

    expect(callsTo(api, 'POST', /^\/api\/v1\/cash-movements$/)).toHaveLength(1)
    expect(textOf(root)).toContain('Sans motif précisé')
    expect(textOf(root)).toContain('Directe (sans approbation)')

    // Basculer sur Sortie motivée exige le motif + demande d'autorisation à la gérante.
    await click(buttonByName(root, 'Sortie motivée'))
    await typeInto(root, 'mouvement-montant', '5 000')
    await click(buttonByName(root, 'Demander l’autorisation'))
    expect(textOf(root)).toContain('Indiquez le motif')
    expect(forbiddenWordsIn(root)).toEqual([])

    unmount()
  })
})

describe('règles pures localMovements', () => {
  it('extrait les dépenses locales et calcule le delta tiroir sans double compte serveur', () => {
    const records: CashLocalFactRecord[] = [
      {
        state: 'local',
        fact: {
          commandId: 'C1',
          commandName: 'RecordCashMovement',
          entityId: 'M1',
          recordedAt: '2026-10-15T09:00:00.000Z',
          payload: {
            movement_id: 'M1',
            cash_session_id: SESSION_ID,
            movement_kind: 'EXPENSE',
            method: 'CASH',
            signed_amount: -3500,
            expense_category_id: CATEGORY_ID,
            reason: null,
            reference: null,
            occurred_at: '2026-10-15T09:00:00.000Z',
          },
        },
      },
      {
        state: 'conflict',
        fact: {
          commandId: 'C2',
          commandName: 'RecordCashMovement',
          entityId: 'M2',
          recordedAt: '2026-10-15T09:02:00.000Z',
          payload: {
            movement_id: 'M2',
            cash_session_id: SESSION_ID,
            movement_kind: 'EXPENSE',
            method: 'CASH',
            signed_amount: -9000,
            expense_category_id: CATEGORY_ID,
            reason: 'Conflit',
            reference: null,
            occurred_at: '2026-10-15T09:02:00.000Z',
          },
        },
      },
      {
        state: 'pending',
        fact: {
          commandId: 'C3',
          commandName: 'OpenCashSession',
          entityId: SESSION_ID,
          recordedAt: '2026-10-15T07:00:00.000Z',
          payload: {
            cash_session_id: SESSION_ID,
            cash_register_id: 'REG1',
            opening_amount: 20000,
            opened_at: '2026-10-15T07:00:00.000Z',
          },
        },
      },
    ]

    const expenses = localExpensesFromFacts(records)
    expect(expenses).toHaveLength(2)
    expect(pendingLocalExpenses(expenses, new Set(['M1']))).toHaveLength(1)
    // Seul C1 (local, non conflict) réduit le disponible tiroir ; C2 (conflict) reste affiché sans déduire deux fois.
    expect(localDrawerExpenseDelta(records, SESSION_ID)).toBe(-3500)
    expect(localDrawerExpenseDelta(records, SESSION_ID, new Set(['M1']))).toBe(0)
    expect(localPendingCashSession(records)?.cashSessionId).toBe(SESSION_ID)
  })
})

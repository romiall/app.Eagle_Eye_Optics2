import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActivityReport, ClinicalReport, FinancialReport } from '@/domain/contracts/generated'

import {
  buttonByName,
  callsTo,
  CASHIER,
  click,
  forbiddenWordsIn,
  json,
  MANAGER,
  openApp,
  resetSales,
  stubSalesApi,
  textOf,
} from './support'

// Tableau de bord unifié sur la page d'accueil (`HomeDashboard`) : « Aujourd'hui » par défaut,
// changement de période, séparation stricte des droits par rôle et refus d'inventer zéro en cas
// d'échec serveur. Données FICTIVES.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T18:30:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetSales()
})

const RECEPTION = ['patient.read', 'visit.register', 'agenda.read', 'statistics.activity']
const CLINICIAN = ['patient.read', 'clinical.read', 'statistics.clinical']
const FULL_MANAGER = [
  ...MANAGER,
  'finance.global.read',
  'statistics.activity',
  'statistics.clinical',
]

function financialFixture(from = '2026-10-15', to = '2026-10-15'): FinancialReport {
  return {
    period: { from, to },
    revenue: {
      issued: { count: 2, total_gross: 48000 },
      credited: { count: 1, amount_gross: 3000 },
      net: 45000,
      by_author: [],
    },
    collections: {
      by_method: [
        {
          method: 'CASH',
          payments_count: 2,
          payments_amount: 39000,
          reversals_amount: 3000,
          refunds_amount: 0,
          net_amount: 36000,
        },
      ],
      net_total: 36000,
      corrections: { reversals: { count: 1, amount: 3000 }, refunds: { count: 0, amount: 0 } },
      on_legacy: { payments_count: 0, net_amount: 0 },
      by_author: [],
    },
    receivables: {
      invoices_count: 1,
      amount_due: 9000,
      of_which_legacy: { invoices_count: 0, amount_due: 0 },
      refundable_credit: { invoices_count: 0, amount: 0 },
    },
    legacy_imported: { count: 0, opening_balance: 0 },
    cash_sessions: {
      closed_count: 0,
      expected_total: 0,
      counted_total: 0,
      variance_total: 0,
      post_closure_reversals: 0,
      open_count: 1,
    },
    expenses: {
      count: 2,
      total: 5000,
      cash_drawer: 3000,
      other_methods: 2000,
      by_method: [{ method: 'CASH', count: 1, amount: 3000 }],
      by_category: [],
    },
    freshness: { complete: true, silence_hours: 12, devices: [] },
    generated_at: '2026-10-15T18:30:00.000Z',
  }
}

function activityFixture(from = '2026-10-15', to = '2026-10-15'): ActivityReport {
  return {
    from,
    to,
    timezone: 'Africa/Douala',
    visits: 12,
    visits_by_reason: [{ reason: 'EXAM', count: 9 }],
    patients: 11,
    new_patients: 4,
    returning_patients: 7,
    sex: [{ sex: 'F', count: 6 }],
    age_bands: [{ min_age: 20, max_age: 39, count: 5 }],
    age_unknown: 0,
    appointments: 6,
    follow_ups_due: 2,
  }
}

function clinicalFixture(from = '2026-10-15', to = '2026-10-15'): ClinicalReport {
  return {
    from,
    to,
    timezone: 'Africa/Douala',
    consultations: 7,
    consultations_completed: 6,
    complaints: [{ term_code: 'FLOU_LOIN', count: 4 }],
    consultations_without_complaint: 1,
    prescriptions_validated: 5,
    medication_orders: 2,
    referrals: 1,
    referrals_by_urgency: [{ urgency: 'NOT_URGENT', count: 1 }],
    referral_unknown: 0,
    ametropias: [{ term_code: 'MYOPIE', count: 3 }],
  }
}

function stubHomeEndpoints(api: ReturnType<typeof stubSalesApi>): void {
  api.on('GET', /^\/api\/v1\/today\/queue$/, () => json(200, { data: [], meta: {} }))
  api.on('GET', /^\/api\/v1\/appointments$/, () =>
    json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
  )
  api.on('GET', /^\/api\/v1\/reports\/cash-day$/, () =>
    json(200, {
      data: {
        date: '2026-10-15',
        scope: 'CLINIC',
        collections: [],
        net_total: 36000,
        sessions: [],
        issued: { count: 2, total_gross: 48000 },
        credited: { count: 1, amount_gross: 3000 },
        outstanding: { invoices_count: 1, amount_due: 9000, refundable_credit: 0 },
        generated_at: '2026-10-15T18:30:00.000Z',
      },
    }),
  )
  api.on('GET', /^\/api\/v1\/stock\/alerts$/, () =>
    json(200, { data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } }),
  )
}

describe('tableau de bord unifié sur l’accueil', () => {
  it('gérante : ouvre sur Aujourd’hui, affiche CA/encaissé/dépenses/solde/visites/consultations + statistiques et change de période', async () => {
    const api = stubSalesApi({ permissions: FULL_MANAGER })
    stubHomeEndpoints(api)
    api.on('GET', /^\/api\/v1\/reports\/financial$/, (req) =>
      json(200, {
        data: financialFixture(
          req.query.get('from') ?? undefined,
          req.query.get('to') ?? undefined,
        ),
      }),
    )
    api.on('GET', /^\/api\/v1\/reports\/activity$/, (req) =>
      json(200, {
        data: activityFixture(req.query.get('from') ?? undefined, req.query.get('to') ?? undefined),
      }),
    )
    api.on('GET', /^\/api\/v1\/reports\/clinical$/, (req) =>
      json(200, {
        data: clinicalFixture(req.query.get('from') ?? undefined, req.query.get('to') ?? undefined),
      }),
    )

    const { root, unmount } = await openApp('/')
    await vi.waitFor(() => expect(textOf(root)).toContain('45 000 FCFA'))

    const todayCalls = callsTo(api, 'GET', /^\/api\/v1\/reports\/financial$/)
    expect(todayCalls[0]?.query.get('from')).toBe('2026-10-15')
    expect(todayCalls[0]?.query.get('to')).toBe('2026-10-15')

    const text = textOf(root)
    expect(text).toContain('Chiffre d’affaires net')
    expect(text).toContain('45 000 FCFA')
    expect(text).toContain('Encaissé net')
    expect(text).toContain('36 000 FCFA')
    expect(text).toContain('Dépenses')
    expect(text).toContain('5 000 FCFA')
    expect(text).toContain('Solde net (encaissé − dépenses)')
    expect(text).toContain('31 000 FCFA')
    expect(text).toContain('Visites totales')
    expect(text).toContain('12')
    expect(text).toContain('Consultations')
    expect(text).toContain('7')
    expect(text).toContain('Activité de l’accueil')
    expect(text).toContain('Examens')
    expect(forbiddenWordsIn(root)).toEqual([])

    // Basculer sur Ce mois -> recharge sur 2026-10-01 .. 2026-10-31
    await click(buttonByName(root, 'Ce mois'))
    await vi.waitFor(() =>
      expect(callsTo(api, 'GET', /^\/api\/v1\/reports\/financial$/).length).toBeGreaterThanOrEqual(
        2,
      ),
    )
    const monthCall = callsTo(api, 'GET', /^\/api\/v1\/reports\/financial$/).at(-1)
    expect(monthCall?.query.get('from')).toBe('2026-10-01')
    expect(monthCall?.query.get('to')).toBe('2026-10-31')

    unmount()
  })

  it('caissière : n’affiche ni le chiffre d’affaires global ni les données cliniques et ne les lit pas', async () => {
    const api = stubSalesApi({ permissions: CASHIER })
    stubHomeEndpoints(api)

    const { root, unmount } = await openApp('/')
    await vi.waitFor(() => expect(textOf(root)).toContain('Bonjour'))

    expect(textOf(root)).not.toContain('Chiffre d’affaires net')
    expect(textOf(root)).not.toContain('Tableau de bord et statistiques')
    expect(callsTo(api, 'GET', /^\/api\/v1\/reports\/financial$/)).toHaveLength(0)
    expect(callsTo(api, 'GET', /^\/api\/v1\/reports\/activity$/)).toHaveLength(0)
    expect(callsTo(api, 'GET', /^\/api\/v1\/reports\/clinical$/)).toHaveLength(0)

    unmount()
  })

  it('accueil et praticien ne voient chacun que leurs propres indicateurs', async () => {
    const receptionApi = stubSalesApi({ permissions: RECEPTION })
    stubHomeEndpoints(receptionApi)
    receptionApi.on('GET', /^\/api\/v1\/reports\/activity$/, () =>
      json(200, { data: activityFixture() }),
    )
    const receptionApp = await openApp('/')
    await vi.waitFor(() => expect(textOf(receptionApp.root)).toContain('Visites totales'))
    expect(textOf(receptionApp.root)).not.toContain('Chiffre d’affaires net')
    expect(textOf(receptionApp.root)).not.toContain('6 terminée(s)')
    expect(textOf(receptionApp.root)).not.toContain('ordonnance(s) optique')
    expect(callsTo(receptionApi, 'GET', /^\/api\/v1\/reports\/clinical$/)).toHaveLength(0)
    receptionApp.unmount()

    resetSales()
    const clinicianApi = stubSalesApi({ permissions: CLINICIAN })
    stubHomeEndpoints(clinicianApi)
    clinicianApi.on('GET', /^\/api\/v1\/reports\/clinical$/, () =>
      json(200, { data: clinicalFixture() }),
    )
    const clinicianApp = await openApp('/')
    await vi.waitFor(() => expect(textOf(clinicianApp.root)).toContain('Consultations'))
    expect(textOf(clinicianApp.root)).not.toContain('Chiffre d’affaires net')
    expect(textOf(clinicianApp.root)).not.toContain('Visites totales')
    expect(callsTo(clinicianApi, 'GET', /^\/api\/v1\/reports\/activity$/)).toHaveLength(0)
    clinicianApp.unmount()
  })

  it('n’invente jamais zéro si la lecture financière échoue', async () => {
    const api = stubSalesApi({ permissions: ['finance.global.read'] })
    stubHomeEndpoints(api)
    api.on('GET', /^\/api\/v1\/reports\/financial$/, () => 'network')

    const { root, unmount } = await openApp('/')
    await vi.waitFor(() => expect(textOf(root)).toContain('Serveur indisponible pour l’instant'))
    expect(textOf(root)).toContain('—')

    unmount()
  })
})

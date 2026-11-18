import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { REQUEST_TIMEOUT_MS } from '@/app/api'
import { resetNetworkForTests } from '@/app/network'
import { refreshSession, resetSessionForTests } from '@/app/session'
import { commandContract, commandNames, commandPath } from '@/app/services/commandIndex'
import {
  createMutationDispatcher,
  type LocalCommandEngine,
  type MutationOutcome,
  type MutationRequest,
} from '@/app/services/mutations'
import { MutationBusyError, useMutation } from '@/app/services/useMutation'
import { isUlid } from '@/domain/values/ulid'

import { meResponse } from '../shell/server'

// Charges FICTIVES (identifiants ULID d'exemple, montants sans valeur réelle).
const INVOICE = '01J9ZXK4M2Q8R7S6T5V4W3X001'
const PAYMENT = '01J9ZXK4M2Q8R7S6T5V4W3P001'
const KEY = '01J9ZXK4M2Q8R7S6T5V4W3K001'
const OTHER_ACCOUNT = '01J9ZXK4M2Q8R7S6T5V4W30009'
/** Facture dont ce poste est propriétaire (différente de INVOICE, centrale). */
const OWNED_INVOICE = '01J9ZXK4M2Q8R7S6T5V4W3L001'

const PAYMENT_REQUEST: MutationRequest = {
  name: 'RegisterPayment',
  path: { id: INVOICE },
  payload: { invoice_id: INVOICE, payment_id: PAYMENT, amount: 20_000, currency: 'XAF' },
  expectedVersion: 2,
  idempotencyKey: KEY,
}

const INTENT = {
  name: 'RegisterPayment' as const,
  path: { id: INVOICE },
  payload: { invoice_id: INVOICE, payment_id: PAYMENT, amount: 20_000, currency: 'XAF' },
  expectedVersion: 2,
}

type Scripted = Response | 'network'

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json',
      ...headers,
    },
  })
}

function apiError(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return respond(
    status,
    { error: { code, message: `Refus ${code}.`, details }, correlation_id: 'corr-test-0100' },
    headers,
  )
}

function truncated(): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new TypeError('terminated'))
    },
  })
  return new Response(stream, { status: 201 })
}

interface FetchScript {
  /** Réponses successives de la route de commande. */
  command?: Scripted[]
  /** Réponses successives de GET /api/v1/auth/me (relecture de session). */
  me?: Scripted[]
}

type FetchMock = ReturnType<typeof stubFetch>

function stubFetch(script: FetchScript = {}) {
  const command = [...(script.command ?? [])]
  const me = [...(script.me ?? [])]
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => {
      const url = String(input)
      if (url === '/api/sanctum/csrf-cookie') return new Response(null, { status: 204 })
      const next = (url === '/api/v1/auth/me' ? me : command).shift()
      if (next === undefined || next === 'network') throw new TypeError('Failed to fetch')
      return next
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function commandCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/invoices'))
}

function sentHeaders(fetchMock: FetchMock, call = 0): Record<string, string> {
  return (commandCalls(fetchMock)[call]?.[1]?.headers ?? {}) as Record<string, string>
}

function sentBody(fetchMock: FetchMock, call = 0): Record<string, unknown> {
  return JSON.parse(String(commandCalls(fetchMock)[call]?.[1]?.body)) as Record<string, unknown>
}

function meAs(id: string): Response {
  return respond(200, { data: { ...meResponse(['payment.collect']).data, id } })
}

afterEach(() => {
  resetNetworkForTests()
  resetSessionForTests()
})

describe('index des commandes lu depuis le contrat F06', () => {
  it('contient les 27 commandes avec route directe, permission et version attendue', () => {
    expect(commandNames()).toHaveLength(27)
    expect(commandContract('RecordCashMovement')).toMatchObject({
      method: 'POST',
      path: '/api/v1/cash-movements',
      permission: 'cash.own_session',
      expectedVersion: 'none',
    })
    expect(commandContract('RegisterPayment')).toMatchObject({
      method: 'POST',
      path: '/api/v1/invoices/{id}/payments',
      permission: 'payment.collect',
      expectedVersion: 'ledger',
      numberType: 'RECEIPT',
      directNumberField: 'receipt_number',
    })
    expect(commandContract('CreatePatient').expectedVersion).toBe('none')
    expect(commandContract('CloseCashSession').expectedVersion).toBe('state')
  })

  it('construit le chemin, encode les paramètres et refuse un paramètre manquant', () => {
    const step = commandContract('SaveClinicalStep')
    expect(commandPath(step, { id: 'ABC', step: 'acuité/œil' })).toBe(
      '/api/v1/consultations/ABC/steps/acuit%C3%A9%2F%C5%93il',
    )
    expect(() => commandPath(step, { id: 'ABC' })).toThrow(/step/)
  })
})

describe('répartiteur de mutations : route directe', () => {
  it('envoie l’en-tête Idempotency-Key, la charge, la version attendue et le numéro à null', async () => {
    const fetchMock = stubFetch({ command: [respond(201, { data: { payment_id: PAYMENT } })] })
    const dispatcher = createMutationDispatcher({ now: () => new Date('2026-10-15T09:42:00Z') })

    const outcome = await dispatcher.dispatch(PAYMENT_REQUEST)

    expect(outcome).toEqual({
      kind: 'synced',
      at: '2026-10-15T09:42:00.000Z',
      result: { data: { payment_id: PAYMENT } },
    })
    expect(commandCalls(fetchMock)[0]?.[0]).toBe(`/api/v1/invoices/${INVOICE}/payments`)
    expect(sentHeaders(fetchMock)['Idempotency-Key']).toBe(KEY)
    expect(sentBody(fetchMock)).toEqual({
      ...PAYMENT_REQUEST.payload,
      expected_version: 2,
      receipt_number: null,
    })
  })

  it('une commande sans version envoie expected_version à null', async () => {
    const fetchMock = stubFetch({ command: [respond(201, { data: {} })] })
    await createMutationDispatcher().dispatch({
      name: 'CreateInvoiceDraft',
      payload: { invoice_id: INVOICE },
      idempotencyKey: KEY,
    })

    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/invoices')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      invoice_id: INVOICE,
      expected_version: null,
    })
  })

  it('abandonne une requête sans réponse au-delà du délai, avec un signal d’annulation', async () => {
    const fetchMock = stubFetch({ command: [respond(201, { data: {} })] })
    await createMutationDispatcher().dispatch(PAYMENT_REQUEST)

    const init = commandCalls(fetchMock)[0]?.[1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(REQUEST_TIMEOUT_MS).toBe(30_000)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Le délai est dépassé.', 'TimeoutError')
      }),
    )
    expect(await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).toEqual({
      kind: 'unavailable',
    })
  })

  it.each([
    ['401', () => apiError(401, 'AUTH_REQUIRED'), 'session-expired'],
    [
      '423 réauthentification',
      () => apiError(423, 'REAUTHENTICATION_REQUIRED'),
      'reauthentication-required',
    ],
    ['409 version', () => apiError(409, 'VERSION_CONFLICT'), 'conflict'],
    ['409 clé réutilisée', () => apiError(409, 'IDEMPOTENCY_PAYLOAD_MISMATCH'), 'conflict'],
    [
      '409 reste dû',
      () => apiError(409, 'PAYMENT_EXCEEDS_BALANCE', { amount_due: 5_000 }),
      'refused',
    ],
    ['422', () => apiError(422, 'VALIDATION_FAILED'), 'refused'],
    ['403', () => apiError(403, 'ACTION_FORBIDDEN'), 'refused'],
    ['404', () => apiError(404, 'RESOURCE_NOT_FOUND'), 'refused'],
    ['429', () => apiError(429, 'RATE_LIMITED'), 'retryable'],
    ['503 occupé', () => apiError(503, 'SERVER_BUSY'), 'retryable'],
    ['500 JSON', () => apiError(500, 'INTERNAL_ERROR'), 'uncertain'],
    ['503 HTML', () => respond(503, '<html>Maintenance</html>'), 'uncertain'],
    ['504 HTML', () => respond(504, '<html>Gateway Timeout</html>'), 'uncertain'],
    ['200 HTML (portail)', () => respond(200, '<html>Portail</html>'), 'uncertain'],
    ['corps coupé', truncated, 'unavailable'],
  ] as const)('classe la réponse « %s » en issue « %s »', async (_name, response, kind) => {
    stubFetch({ command: [response()] })
    expect((await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).kind).toBe(kind)
  })

  it('garde les valeurs actualisées d’un refus métier (reste dû)', async () => {
    stubFetch({ command: [apiError(409, 'PAYMENT_EXCEEDS_BALANCE', { amount_due: 5_000 })] })
    const outcome = await createMutationDispatcher().dispatch(PAYMENT_REQUEST)
    expect(outcome.kind === 'refused' ? outcome.error.details : null).toEqual({ amount_due: 5_000 })
  })

  it('429 : « patientez », avec le délai Retry-After du serveur, rien n’a été appliqué', async () => {
    stubFetch({ command: [apiError(429, 'RATE_LIMITED', {}, { 'Retry-After': '12' })] })
    expect(await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).toMatchObject({
      kind: 'retryable',
      retryAfterSeconds: 12,
    })

    stubFetch({ command: [apiError(503, 'SERVER_BUSY')] })
    expect(await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).toMatchObject({
      kind: 'retryable',
      retryAfterSeconds: null,
    })
  })

  it('jeton CSRF périmé (419) : renouvelé une fois, même clé, puis la commande part', async () => {
    const fetchMock = stubFetch({
      command: [apiError(419, 'SESSION_CONTEXT_EXPIRED'), respond(201, { data: {} })],
    })

    const outcome = await createMutationDispatcher().dispatch(PAYMENT_REQUEST)

    expect(outcome.kind).toBe('synced')
    expect(commandCalls(fetchMock)).toHaveLength(2)
    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).toBe(KEY)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/sanctum/csrf-cookie')).toBe(
      true,
    )
  })

  it('419 persistant : session expirée, une seule reprise', async () => {
    const fetchMock = stubFetch({
      command: [apiError(419, 'SESSION_CONTEXT_EXPIRED'), apiError(419, 'SESSION_CONTEXT_EXPIRED')],
    })
    expect((await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).kind).toBe(
      'session-expired',
    )
    expect(commandCalls(fetchMock)).toHaveLength(2)
  })

  it('sans réponse et sans journal local : « indisponible », rien n’est conclu', async () => {
    stubFetch({ command: ['network'] })
    expect(await createMutationDispatcher().dispatch(PAYMENT_REQUEST)).toEqual({
      kind: 'unavailable',
    })
  })

  it('refuse, sans rien envoyer, une clé invalide ou une version incohérente', async () => {
    const fetchMock = stubFetch()
    const dispatcher = createMutationDispatcher()

    await expect(
      dispatcher.dispatch({ ...PAYMENT_REQUEST, idempotencyKey: 'court' }),
    ).rejects.toThrow(/Clé d’idempotence/)
    await expect(
      dispatcher.dispatch({
        name: PAYMENT_REQUEST.name,
        payload: PAYMENT_REQUEST.payload,
        idempotencyKey: KEY,
      }),
    ).rejects.toThrow(/Version attendue obligatoire/)
    await expect(
      dispatcher.dispatch({
        name: 'CreatePatient',
        payload: {},
        expectedVersion: 4,
        idempotencyKey: KEY,
      }),
    ).rejects.toThrow(/pas de version attendue/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('répartiteur de mutations : journal du poste préparé', () => {
  it('enregistre localement les commandes que le poste prend, même en ligne', async () => {
    const fetchMock = stubFetch()
    const engine: LocalCommandEngine = {
      handles: vi.fn(() => true),
      commit: vi.fn(async () => ({ recordedAt: '2026-10-15T09:42:00.000Z' })),
    }

    const outcome = await createMutationDispatcher({ localEngine: engine }).dispatch(
      PAYMENT_REQUEST,
    )

    expect(outcome).toEqual({ kind: 'saved-local', at: '2026-10-15T09:42:00.000Z' })
    expect(engine.handles).toHaveBeenCalledWith(PAYMENT_REQUEST)
    expect(engine.commit).toHaveBeenCalledWith(PAYMENT_REQUEST)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('une facture centrale que le poste ne possède pas part par la route directe', async () => {
    const fetchMock = stubFetch({ command: [respond(201, { data: {} })] })
    const engine: LocalCommandEngine = {
      // Le poste décide d'après la requête (propriété de la pièce), pas d'après le nom de commande.
      handles: (request) => request.path?.['id'] === OWNED_INVOICE,
      commit: vi.fn(async () => ({ recordedAt: '2026-10-15T09:42:00.000Z' })),
    }

    const outcome = await createMutationDispatcher({ localEngine: engine }).dispatch(
      PAYMENT_REQUEST,
    )

    expect(outcome.kind).toBe('synced')
    expect(engine.commit).not.toHaveBeenCalled()
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it('un échec du journal local est une issue explicite, rien n’est envoyé au serveur', async () => {
    const fetchMock = stubFetch()
    const failure = new Error('Quota IndexedDB dépassé')
    const engine: LocalCommandEngine = {
      handles: () => true,
      commit: async () => {
        throw failure
      },
    }

    const outcome = await createMutationDispatcher({ localEngine: engine }).dispatch(
      PAYMENT_REQUEST,
    )

    expect(outcome).toEqual({ kind: 'local-failed', error: failure })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useMutation : saisie préservée, une clé par intention', () => {
  it('reprend une intention sans réponse avec la même clé (aucun doublon possible)', async () => {
    const fetchMock = stubFetch({ command: ['network', respond(201, { data: {} })] })
    const mutation = useMutation(createMutationDispatcher())

    expect((await mutation.submit(INTENT)).kind).toBe('unavailable')
    expect(mutation.state.value).toBe('unavailable')
    expect(mutation.saveState.value).toBe('failed')
    expect(mutation.failureMessage.value).toContain('n’est pas confirmé')
    expect(mutation.failureMessage.value).toContain('la commande a pu être appliquée')

    expect((await mutation.retry()).kind).toBe('synced')
    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
    expect(mutation.saveState.value).toBe('synced')
  })

  it('accepte une charge issue d’objets réactifs (lignes d’un écran) sans DataCloneError', async () => {
    const fetchMock = stubFetch({ command: [respond(201, { data: {} })] })
    const mutation = useMutation(createMutationDispatcher())
    const rows = reactive([{ reference: 'E2E-IMP-001', price: 45_000 }])

    expect((await mutation.submit({ ...INTENT, payload: { rows } })).kind).toBe('synced')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).rows).toEqual([
      { reference: 'E2E-IMP-001', price: 45_000 },
    ])
  })

  it('une charge modifiée est une nouvelle intention, avec une nouvelle clé', async () => {
    const fetchMock = stubFetch({
      command: [apiError(422, 'VALIDATION_FAILED'), respond(201, { data: {} })],
    })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    await mutation.submit({ ...INTENT, payload: { ...INTENT.payload, amount: 15_000 } })

    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).not.toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
  })

  it('une version attendue actualisée est une nouvelle intention (sinon 409 à chaque reprise)', async () => {
    const fetchMock = stubFetch({
      command: [apiError(409, 'VERSION_CONFLICT'), respond(201, { data: {} })],
    })
    const mutation = useMutation(createMutationDispatcher())

    expect((await mutation.submit(INTENT)).kind).toBe('conflict')
    await mutation.submit({ ...INTENT, expectedVersion: 3 })

    expect(sentBody(fetchMock, 1)['expected_version']).toBe(3)
    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).not.toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
  })

  it('après un succès, renvoyer la même saisie est un rejeu : même clé, jamais une seconde commande', async () => {
    const fetchMock = stubFetch({
      command: [respond(201, { data: {} }), respond(200, { data: {} })],
    })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    await mutation.submit(INTENT)

    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
    expect(sentBody(fetchMock, 1)).toEqual(sentBody(fetchMock, 0))
  })

  it('les identifiants d’effets suivent le formulaire jusqu’à reset(), puis sont renouvelés', async () => {
    stubFetch({ command: [respond(201, { data: {} })] })
    const mutation = useMutation(createMutationDispatcher())

    const payment = mutation.effectId('payment_id')
    const receipt = mutation.effectId('receipt_id')
    expect(isUlid(payment)).toBe(true)
    expect(payment).not.toBe(receipt)
    expect(mutation.effectId('payment_id')).toBe(payment)

    await mutation.submit(INTENT)
    expect(mutation.effectId('payment_id')).toBe(payment)

    mutation.reset()
    expect(mutation.state.value).toBe('idle')
    expect(mutation.effectId('payment_id')).not.toBe(payment)
  })

  it('reset() renouvelle la clé : un nouveau formulaire est une nouvelle intention', async () => {
    const fetchMock = stubFetch({
      command: [respond(201, { data: {} }), respond(201, { data: {} })],
    })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    mutation.reset()
    await mutation.submit(INTENT)

    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).not.toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
  })

  it('un double clic n’envoie qu’une fois (même issue), une autre saisie pendant l’envoi est refusée', async () => {
    let release!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const mutation = useMutation(createMutationDispatcher())

    const first = mutation.submit(INTENT)
    const second = mutation.submit(INTENT)
    expect(mutation.state.value).toBe('saving')

    await expect(
      mutation.submit({ ...INTENT, payload: { ...INTENT.payload, amount: 1 } }),
    ).rejects.toBeInstanceOf(MutationBusyError)
    expect(() => mutation.reset()).toThrow(MutationBusyError)

    release(respond(201, { data: {} }))
    // Le double clic rend la même issue, sans second envoi.
    expect(await second).toBe(await first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('un conflit de version garde la saisie et ne se rejoue pas tout seul', async () => {
    const fetchMock = stubFetch({
      command: [apiError(409, 'VERSION_CONFLICT', { current_version: 3 })],
    })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)

    expect(mutation.state.value).toBe('conflict')
    expect(mutation.error.value?.details).toEqual({ current_version: 3 })
    expect(mutation.failureMessage.value).toContain('vos saisies sont conservées')
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it.each([
    ['429', () => apiError(429, 'RATE_LIMITED', {}, { 'Retry-After': '7' }), 'dans 7 s'],
    ['503 occupé', () => apiError(503, 'SERVER_BUSY'), 'dans un instant'],
  ] as const)(
    '« %s » : rien n’a été appliqué, le délai demandé est annoncé',
    async (_n, response, delay) => {
      stubFetch({ command: [response()] })
      const mutation = useMutation(createMutationDispatcher())

      await mutation.submit(INTENT)

      expect(mutation.state.value).toBe('retryable')
      expect(mutation.failureMessage.value).toContain('rien n’a été appliqué')
      expect(mutation.failureMessage.value).toContain(delay)
    },
  )

  it('une erreur du serveur ou une page d’hébergeur : la commande a pu être appliquée', async () => {
    stubFetch({ command: [respond(504, '<html>Gateway Timeout</html>')] })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)

    expect(mutation.state.value).toBe('uncertain')
    expect(mutation.failureMessage.value).toContain('la commande a pu être appliquée')
    expect(mutation.failureMessage.value).not.toContain('rien n’a été appliqué')
  })

  it('« réauthentification requise » (423) : confirmer le mot de passe, saisie conservée', async () => {
    stubFetch({ command: [apiError(423, 'REAUTHENTICATION_REQUIRED')] })
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)

    expect(mutation.state.value).toBe('reauthentication-required')
    expect(mutation.failureMessage.value).toContain('confirmez votre mot de passe')
  })

  it('enregistrement local : « Enregistré sur ce poste » avec son instant, jamais « synchronisé »', async () => {
    const engine: LocalCommandEngine = {
      handles: () => true,
      commit: async () => ({ recordedAt: '2026-10-15T09:42:00.000Z' }),
    }
    const mutation = useMutation(createMutationDispatcher({ localEngine: engine }))

    await mutation.submit(INTENT)

    expect(mutation.saveState.value).toBe('saved-local')
    expect(mutation.recordedAt.value).toBe('2026-10-15T09:42:00.000Z')
  })

  it('échec du journal local : « Échec de l’enregistrement sur ce poste », aucune erreur d’API affichée', async () => {
    const engine: LocalCommandEngine = {
      handles: () => true,
      commit: async () => {
        throw new Error('Quota dépassé')
      },
    }
    const mutation = useMutation(createMutationDispatcher({ localEngine: engine }))

    await mutation.submit(INTENT)

    expect(mutation.state.value).toBe('local-failed')
    expect(mutation.saveState.value).toBe('failed')
    expect(mutation.error.value).toBeNull()
    expect(mutation.failureMessage.value).toContain('rien n’est enregistré')
  })
})

describe('useMutation : session expirée et changement de compte', () => {
  it('reprise après reconnexion : la session est relue, puis la commande repart avec la même clé', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), meAs(meResponse([]).data.id)],
      command: [apiError(401, 'AUTH_REQUIRED'), respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    expect(mutation.state.value).toBe('session-expired')
    expect(mutation.failureMessage.value).toContain('vos saisies sont conservées')

    await mutation.retry()
    expect(mutation.state.value).toBe('synced')
    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
  })

  it('toujours déconnecté à la reprise : rien n’est envoyé, la saisie est conservée', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), apiError(401, 'AUTH_REQUIRED')],
      command: [apiError(401, 'AUTH_REQUIRED'), respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    const outcome: MutationOutcome = await mutation.retry()

    expect(outcome.kind).toBe('session-expired')
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it('serveur muet à la relecture de la session : « non confirmé », rien n’est envoyé', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), 'network'],
      command: [apiError(401, 'AUTH_REQUIRED'), respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)

    expect((await mutation.retry()).kind).toBe('unavailable')
    expect(commandCalls(fetchMock)).toHaveLength(1)
    // Rien n'est parti : le message ne dit pas que la commande a pu être appliquée.
    expect(mutation.failureMessage.value).toContain('rien n’a été envoyé')
    expect(mutation.failureMessage.value).not.toContain('a pu être appliquée')
  })

  it('l’intention est figée à l’envoi : une reprise renvoie la charge envoyée, pas celle modifiée depuis', async () => {
    const fetchMock = stubFetch({
      command: [apiError(500, 'INTERNAL_ERROR'), respond(201, { data: {} })],
    })
    const mutation = useMutation(createMutationDispatcher())
    const payload = { ...INTENT.payload }
    await mutation.submit({ ...INTENT, payload })

    payload.amount = 99_999 // l'écran modifie ses objets après l'envoi
    await mutation.retry()

    expect(sentBody(fetchMock, 0)['amount']).toBe(20_000)
    expect(sentBody(fetchMock, 1)['amount']).toBe(20_000)
  })

  it('un autre compte connecté depuis un autre onglet : la commande ne part pas en son nom', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), meAs(OTHER_ACCOUNT)],
      command: [apiError(401, 'AUTH_REQUIRED'), respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())

    await mutation.submit(INTENT)
    const outcome = await mutation.retry()

    expect(outcome.kind).toBe('account-changed')
    expect(mutation.state.value).toBe('account-changed')
    expect(mutation.failureMessage.value).toContain('compte d’origine')
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it('changement de compte sans expiration préalable (session relue au retour sur l’onglet)', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), meAs(OTHER_ACCOUNT)],
      command: [
        respond(422, {
          error: { code: 'VALIDATION_FAILED', message: 'Refus.' },
          correlation_id: 'c',
        }),
      ],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())
    await mutation.submit(INTENT)

    await refreshSession() // retour sur l'onglet : la session est celle de l'autre compte
    const outcome = await mutation.submit({
      ...INTENT,
      payload: { ...INTENT.payload, amount: 5_000 },
    })

    expect(outcome.kind).toBe('account-changed')
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it('le compte est épinglé à l’ouverture du formulaire : un autre compte avant le premier envoi', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), meAs(OTHER_ACCOUNT)],
      command: [respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher()) // formulaire ouvert sous le compte A

    await refreshSession() // un autre onglet a connecté B ; la session est relue avant tout envoi
    const outcome = await mutation.submit(INTENT)

    expect(outcome.kind).toBe('account-changed')
    expect(commandCalls(fetchMock)).toHaveLength(0)
  })

  it('session expirée après un premier envoi : « session expirée », jamais « compte changé »', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id), apiError(401, 'AUTH_REQUIRED')],
      command: [respond(201, { data: {} }), apiError(401, 'AUTH_REQUIRED')],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())
    await mutation.submit(INTENT)

    await refreshSession() // 401 : le dernier compte reste connu, personne n'est connecté
    const outcome = await mutation.submit({
      ...INTENT,
      payload: { ...INTENT.payload, amount: 5_000 },
    })

    expect(outcome.kind).toBe('session-expired')
    expect(mutation.failureMessage.value).toContain('Session expirée')
    // Le serveur a répondu : l'envoi a bien eu lieu et c'est lui qui a refusé la session.
    expect(commandCalls(fetchMock)).toHaveLength(2)
  })

  it('déconnecté dans un autre onglet (aucun compte connu) : la commande part et le serveur répond 401', async () => {
    const fetchMock = stubFetch({
      me: [meAs(meResponse([]).data.id)],
      command: [apiError(401, 'AUTH_REQUIRED')],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())

    resetSessionForTests() // plus aucun compte connu de cet écran
    const outcome = await mutation.submit(INTENT)

    expect(outcome.kind).toBe('session-expired')
    expect(commandCalls(fetchMock)).toHaveLength(1)
  })

  it('une reprise après « session expirée » avec le même compte repart avec la même clé', async () => {
    const id = meResponse([]).data.id
    const fetchMock = stubFetch({
      me: [meAs(id), apiError(401, 'AUTH_REQUIRED'), meAs(id)],
      command: [apiError(401, 'AUTH_REQUIRED'), respond(201, { data: {} })],
    })
    await refreshSession()
    const mutation = useMutation(createMutationDispatcher())
    await mutation.submit(INTENT)
    await refreshSession() // expirée

    const outcome = await mutation.retry() // la session est relue (rétablie), puis l'envoi repart

    expect(outcome.kind).toBe('synced')
    expect(sentHeaders(fetchMock, 1)['Idempotency-Key']).toBe(
      sentHeaders(fetchMock, 0)['Idempotency-Key'],
    )
  })
})

describe('useMutation : erreur de programmation', () => {
  it('une version manquante remonte et ne laisse pas l’écran bloqué en « enregistrement »', async () => {
    stubFetch()
    const mutation = useMutation(createMutationDispatcher())

    await expect(
      mutation.submit({ name: INTENT.name, path: INTENT.path, payload: INTENT.payload }),
    ).rejects.toThrow(/Version attendue/)
    expect(mutation.state.value).toBe('idle')
    await flushPromises()
  })
})

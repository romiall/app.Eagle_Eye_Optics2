import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEeoApp } from '@/app/bootstrap'
import { resetNetworkForTests } from '@/app/network'
import {
  entryRoute,
  offlineRefusal,
  resetLocalIdentityForTests,
  vaultNeedsUnlock,
} from '@/app/services/localIdentity'
import {
  identityDiverges,
  localCommandsOrNull,
  resetVaultServiceForTests,
} from '@/app/services/vault'
import { refreshSession, resetSessionForTests, session } from '@/app/session'
import { MemoryDocumentStore } from '@/documents/store/memory'
import { VaultError } from '@/offline/api'
import type { ProfileSummary, SessionInfo } from '@/offline/api'

import { meResponse, stubServer } from './server'

/**
 * Déverrouillage public du poste et session locale (vault.md D14, D27). Le coffre est simulé au niveau de la façade
 * (`@/offline/api`) : le chiffrement est éprouvé ailleurs (tests/frontend/offline). Ici, la décision de l'application :
 * l'écran de déverrouillage passe AVANT la connexion quand un coffre existe et qu'aucune identité n'est connue ; le profil
 * déverrouillé devient l'identité d'action avec les droits SIGNÉS de son grant ; les écrans qui lisent le serveur restent
 * fermés ; le serveur reprend la main dès qu'il répond. Données fictives.
 */
const CLINIC_ID = '01J9ZXK4M2Q8R7S6T5V4W30003'
const CASHIER_USER = '01J9ZXK4M2Q8R7S6T5V4W3U002'
const MANAGER_USER = '01J9ZXK4M2Q8R7S6T5V4W3U001'
const CASHIER_PROFILE = '01J9ZXK4M2Q8R7S6T5V4W3P002'
const MANAGER_PROFILE = '01J9ZXK4M2Q8R7S6T5V4W3P001'
const GOOD_SECRET = 'riviere-lampe-orange-7'

const hoisted = vi.hoisted(() => ({ exists: true, vault: null as unknown }))

vi.mock('@/offline/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/offline/api')>()
  return {
    ...original,
    vaultDatabaseExists: vi.fn(async () => hoisted.exists),
    openOfflineVault: vi.fn(() => hoisted.vault),
  }
})

const PROFILES: ProfileSummary[] = [
  {
    profileId: CASHIER_PROFILE,
    userId: CASHIER_USER,
    login: 'caisse.test',
    displayName: 'Caisse fictive',
    blockedUntil: null,
  },
  {
    profileId: MANAGER_PROFILE,
    userId: MANAGER_USER,
    login: 'gerante.test',
    displayName: 'Gérante fictive',
    blockedUntil: null,
  },
]

interface FakeFact {
  fact: {
    commandId: string
    commandName: string
    entityType: string
    entityId: string
    payload: Record<string, unknown>
    number: string | null
    recordedAt: string
  }
  state: string
}

/** Projection du serveur reçue par le pull (annuaire du poste, A2). */
interface FakePulled {
  entityType: string
  entityId: string
  entityVersion: number
  changeKind: string
  changeSequence: string
  recordedAt: string
  data: Record<string, unknown>
}

function fakeVault(
  options: {
    retryAt?: number
    permissions?: string[]
    facts?: FakeFact[]
    pulled?: FakePulled[]
  } = {},
) {
  let opened: SessionInfo | null = null
  const vault = {
    status: vi.fn(async () => (opened === null ? 'locked' : 'unlocked')),
    session: vi.fn(() => opened),
    profiles: vi.fn(async () => PROFILES),
    deviceId: vi.fn(async () => '01J9ZXK4M2Q8R7S6T5V4W3D001'),
    clinicId: vi.fn(async () => CLINIC_ID),
    clinic: vi.fn(async () => ({
      id: CLINIC_ID,
      name: 'TEST CABINET FICTIF',
      timezone: 'Africa/Douala',
      currency: 'XAF' as const,
      production_documents_enabled: false,
      enabled_modules: ['patients', 'sales'],
      exam_fee_control: 'OFF' as const,
    })),
    noteClinic: vi.fn(async () => undefined),
    grants: vi.fn(async () => [
      {
        grantId: 'G1',
        userId: CASHIER_USER,
        clinicId: CLINIC_ID,
        permissions: options.permissions ?? ['patient.read', 'patient.create', 'invoice.read'],
        compartments: ['ADMINISTRATIVE'],
        validUntil: '2026-11-01T00:00:00.000Z',
      },
    ]),
    unlock: vi.fn(async (profileId: string, secret: string) => {
      if (options.retryAt !== undefined) {
        throw new VaultError('AUTH_THROTTLED', { retryAt: options.retryAt })
      }
      if (secret !== GOOD_SECRET) throw new VaultError('AUTH_FAILED')
      const profile = PROFILES.find((row) => row.profileId === profileId)
      opened = {
        sessionId: 'S1',
        profileId,
        userId: profile?.userId ?? '',
        displayName: profile?.displayName ?? '',
        compartments: ['ADMINISTRATIVE'],
        canSign: true,
        authority: 'granted',
        grantId: 'G1',
      }
      return opened
    }),
    lock: vi.fn(async () => {
      opened = null
    }),
    documentStore: vi.fn(() => new MemoryDocumentStore()),
    localCommands: vi.fn(() => ({
      handles: () => false,
      commit: vi.fn(),
      refresh: vi.fn(async () => ({})),
      readiness: vi.fn(() => ({})),
    })),
    sync: vi.fn(() => ({ syncNow: vi.fn(), summary: vi.fn(), issues: vi.fn(), pulled: vi.fn() })),
    localFacts: vi.fn(async (compartment: string) =>
      compartment === 'ADMINISTRATIVE' ? (options.facts ?? []) : [],
    ),
    localHeads: vi.fn(async () => []),
    catalogSnapshot: vi.fn(async () => null),
    pulledRecords: vi.fn(
      async (_compartment: string, entityType: string, ids?: readonly string[]) =>
        (options.pulled ?? []).filter(
          (record) =>
            record.entityType === entityType &&
            (ids === undefined || ids.includes(record.entityId)),
        ),
    ),
    lastPullAt: vi.fn(async () =>
      options.pulled === undefined ? null : '2026-10-30T08:00:00.000Z',
    ),
    touch: vi.fn(async () => undefined),
    checkInactivity: vi.fn(async () => null),
    dispose: vi.fn(),
  }
  hoisted.vault = vault
  return vault
}

async function openApp(path = '/') {
  const { app, router } = createEeoApp(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await flushPromises()
  return { root, router, unmount: () => app.unmount() }
}

function field(root: Element, label: string): HTMLInputElement | HTMLSelectElement {
  const labelElement = [...root.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.startsWith(label),
  )
  const id = labelElement?.getAttribute('for')
  return root.querySelector(`[id="${id}"]`) as HTMLInputElement | HTMLSelectElement
}

async function unlock(root: Element, profileId: string | null, secret: string): Promise<void> {
  if (profileId !== null) {
    const select = field(root, 'Profil') as HTMLSelectElement
    select.value = profileId
    select.dispatchEvent(new Event('change'))
  }
  const input = field(root, 'Secret local') as HTMLInputElement
  input.value = secret
  input.dispatchEvent(new Event('input'))
  root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

function button(root: Element, label: string): HTMLButtonElement {
  return [...root.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement
}

beforeEach(() => {
  hoisted.exists = true
})

afterEach(() => {
  resetSessionForTests()
  resetNetworkForTests()
  resetVaultServiceForTests()
  resetLocalIdentityForTests()
  offlineRefusal.value = null
  document.body.innerHTML = ''
})

describe('déverrouillage public du poste', () => {
  it('serveur injoignable et coffre verrouillé : le déverrouillage vient avant la connexion, profils listés', async () => {
    fakeVault()
    stubServer({ me: 'unreachable' })

    const { root, router, unmount } = await openApp('/patients')

    expect(router.currentRoute.value.name).toBe('deverrouiller')
    expect(router.currentRoute.value.query).toEqual({ suite: '/patients' })
    expect(root.querySelector('h1')?.textContent).toContain('Déverrouiller ce poste')
    const options = [...(field(root, 'Profil') as HTMLSelectElement).options].map((option) =>
      option.textContent?.trim(),
    )
    expect(options).toContain('Caisse fictive (caisse.test)')
    expect(options).toContain('Gérante fictive (gerante.test)')
    // La coquille métier n'est pas là : ni menu, ni compte, ni déconnexion.
    expect(root.querySelector('nav')).toBeNull()
    expect(button(root, 'Se déconnecter')).toBeUndefined()
    expect(vaultNeedsUnlock()).toBe(true)
    unmount()
  })

  it('sans coffre dans ce navigateur : le flux d’avant, la connexion au serveur', async () => {
    hoisted.exists = false
    fakeVault()
    stubServer({ me: 'anonymous' })

    const { router, unmount } = await openApp('/')

    expect(router.currentRoute.value.name).toBe('connexion')
    expect(vaultNeedsUnlock()).toBe(false)
    expect(entryRoute('/ventes')).toEqual({ name: 'connexion', query: { suite: '/ventes' } })
    unmount()
  })

  it('coffre verrouillé mais session du serveur ouverte : aucun écran de déverrouillage imposé', async () => {
    fakeVault()
    stubServer({ me: meResponse(['patient.read']) })

    const { router, unmount } = await openApp('/')

    expect(router.currentRoute.value.name).toBe('accueil')
    expect(session.status).toBe('authenticated')
    expect(vaultNeedsUnlock()).toBe(false)
    unmount()
  })

  it('profil déverrouillé : session locale, droits du grant signé, accueil, retour à l’écran demandé', async () => {
    const vault = fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/patients/nouveau')
    expect(router.currentRoute.value.name).toBe('deverrouiller')

    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    expect(vault.unlock).toHaveBeenCalledWith(CASHIER_PROFILE, GOOD_SECRET)
    expect(session.status).toBe('local')
    expect(session.account?.id).toBe(CASHIER_USER)
    expect(session.account?.display_name).toBe('Caisse fictive')
    expect(session.account?.permissions).toEqual(['patient.read', 'patient.create', 'invoice.read'])
    expect(session.account?.clinic.enabled_modules).toContain('offline')
    // Le secret n'est jamais conservé ; l'écran demandé à l'origine s'ouvre.
    expect(router.currentRoute.value.name).toBe('patient-nouveau')
    expect(root.textContent).toContain('Profil local : serveur non joint')
    unmount()
  })

  it('un écran qui lit le serveur reste fermé en session locale, l’accueil l’explique', async () => {
    fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)
    expect(router.currentRoute.value.name).toBe('accueil')

    await router.push('/ventes/factures')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('accueil')
    expect(offlineRefusal.value).toBe('Factures')
    expect(root.textContent).toContain('« Factures » demande le serveur')
    // Un écran dont le droit manque au grant reste refusé comme en ligne.
    await router.push('/parametres/poste')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('acces-refuse')
    unmount()
  })

  it('mauvais secret : message uniforme, secret vidé, rien n’est ouvert', async () => {
    fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')

    await unlock(root, CASHIER_PROFILE, 'mauvais-secret-fictif')

    expect(session.status).toBe('unverified')
    expect(router.currentRoute.value.name).toBe('deverrouiller')
    expect(root.textContent).toContain('Profil ou secret incorrect.')
    expect((field(root, 'Secret local') as HTMLInputElement).value).toBe('')
    unmount()
  })

  it('trop d’échecs : l’heure de la prochaine tentative est annoncée', async () => {
    fakeVault({ retryAt: Date.parse('2026-10-28T14:05:30') })
    stubServer({ me: 'unreachable' })
    const { root, unmount } = await openApp('/')

    await unlock(root, MANAGER_PROFILE, GOOD_SECRET)

    expect(root.textContent).toContain('Trop de tentatives : réessayez à 14:05:30.')
    unmount()
  })

  it('verrouiller le poste démonte la coquille et rouvre le déverrouillage', async () => {
    const vault = fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)
    expect(session.status).toBe('local')

    button(root, 'Verrouiller le poste').click()
    await flushPromises()

    expect(vault.lock).toHaveBeenCalledTimes(1)
    expect(session.status).toBe('unverified')
    expect(session.account).toBeNull()
    expect(router.currentRoute.value.name).toBe('deverrouiller')
    expect(root.querySelector('nav')).toBeNull()
    unmount()
  })

  it('se déconnecter en session locale verrouille d’abord et n’appelle pas le serveur', async () => {
    const vault = fakeVault()
    const fetchMock = stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    button(root, 'Se déconnecter').click()
    await flushPromises()

    expect(vault.lock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/logout'))).toBe(false)
    expect(router.currentRoute.value.name).toBe('deverrouiller')
    unmount()
  })

  it('le serveur répond avec une session : elle prend la place du profil local, divergence signalée', async () => {
    fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)
    expect(session.status).toBe('local')
    expect(identityDiverges()).toBe(false)

    // Le serveur est de retour et une AUTRE personne y est connectée (la gérante) : le serveur est l'autorité.
    stubServer({ me: meResponse(['patient.read'], 'Gérante') })
    await refreshSession()
    await flushPromises()

    expect(session.status).toBe('authenticated')
    expect(session.account?.id).toBe('01J9ZXK4M2Q8R7S6T5V4W30002')
    expect(identityDiverges()).toBe(true)
    // Rien n'est écrit sur le poste au nom d'un autre compte que celui du coffre ouvert.
    expect(localCommandsOrNull()).toBeNull()
    expect(root.textContent).toContain('ouvert au nom d’un autre compte')
    unmount()
  })

  it('serveur muet ou sans session pendant la session locale : le profil du coffre n’est jamais retiré', async () => {
    fakeVault()
    stubServer({ me: 'unreachable' })
    const { root, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    await refreshSession()
    expect(session.status).toBe('local')

    stubServer({ me: 'anonymous' })
    await refreshSession()
    expect(session.status).toBe('local')
    expect(session.account?.id).toBe(CASHIER_USER)
    unmount()
  })
})

describe('lecture locale des fiches patient en session locale (A1)', () => {
  const PATIENT = '01J9ZXK4M2Q8R7S6T5V4W3PA01'
  const createdHere: FakeFact = {
    state: 'local',
    fact: {
      commandId: 'cmd-1',
      commandName: 'CreatePatient',
      entityType: 'patient_records',
      entityId: PATIENT,
      number: 'EE-2026-0042',
      recordedAt: '2026-10-28T10:00:00.000Z',
      payload: {
        patient_id: PATIENT,
        last_name: 'Mbarga',
        first_names: 'Éloïse',
        sex: 'F',
        birth_date: '1985-03-04',
        phone_primary: '+237 600 00 01 02',
        record_number: 'EE-2026-0042',
      },
    },
  }

  it('la fiche d’un patient du poste s’ouvre sans le serveur, seul l’onglet « Identité » est offert, et « Créer une facture » mène à la facture', async () => {
    fakeVault({
      permissions: ['patient.read', 'patient.update', 'invoice.create', 'invoice.read'],
      facts: [createdHere],
    })
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    await router.push(`/patients/${PATIENT}`)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('patient')
    expect(root.querySelector('h1')?.textContent).toContain('Mbarga')
    expect(root.textContent).toContain('EE-2026-0042')
    expect(root.textContent).toContain('Données de ce poste seulement')
    const tabs = [
      ...(root.querySelectorAll('nav[aria-label="Sections du dossier patient"] a') ?? []),
    ].map((link) => link.textContent?.trim())
    expect(tabs).toEqual(['Identité'])
    const links = [...root.querySelectorAll('main a')].map((link) => link.textContent?.trim())
    expect(links).toContain('Modifier')
    expect(links).not.toContain('Enregistrer une arrivée')

    const invoiceLink = [...root.querySelectorAll('main a')].find(
      (link) => link.textContent?.trim() === 'Créer une facture',
    )
    expect(invoiceLink?.getAttribute('href')).toBe(`/ventes/factures/nouvelle?patient=${PATIENT}`)

    await router.push(`/ventes/factures/nouvelle?patient=${PATIENT}`)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('facture-nouvelle')
    expect(root.querySelector('h1')?.textContent).toContain('Nouvelle facture')
    expect(root.textContent).toContain('Mbarga')
    // La liste des factures demande le serveur : le retour va à la fiche du patient.
    const back = [...root.querySelectorAll('main a')].map((link) => link.textContent?.trim())
    expect(back).toContain('Retour à la fiche du patient')
    expect(back).not.toContain('Retour aux factures')
    unmount()
  })

  it('sans le droit de créer une facture, la fiche du poste ne propose pas « Créer une facture »', async () => {
    fakeVault({ permissions: ['patient.read', 'invoice.read'], facts: [createdHere] })
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    await router.push(`/patients/${PATIENT}`)
    await flushPromises()

    const links = [...root.querySelectorAll('main a')].map((link) => link.textContent?.trim())
    expect(links).not.toContain('Créer une facture')
    expect(links).not.toContain('Modifier')
    unmount()
  })

  it('une fiche inconnue du poste reste « introuvable » : jamais une fiche inventée', async () => {
    fakeVault({ permissions: ['patient.read'], facts: [createdHere] })
    stubServer({ me: 'unreachable' })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    await router.push('/patients/01J9ZXK4M2Q8R7S6T5V4W3PA09')
    await flushPromises()

    expect(root.querySelector('h1')?.textContent).not.toContain('Mbarga')
    expect(root.textContent).not.toContain('EE-2026-0042')
    unmount()
  })

  it('la fiche d’un patient du SERVEUR, reçue par le pull, s’ouvre aussi sans le serveur (A2) ; une fiche jamais reçue reste introuvable', async () => {
    const SERVER = '01J9ZXK4M2Q8R7S6T5V4W3PB01'
    fakeVault({
      permissions: ['patient.read', 'patient.update', 'invoice.create', 'invoice.read'],
      pulled: [
        {
          entityType: 'patient_records',
          entityId: SERVER,
          entityVersion: 3,
          changeKind: 'UPDATED',
          changeSequence: '11',
          recordedAt: '2026-10-22T09:35:00.000Z',
          data: {
            id: SERVER,
            record_number: 'EE-2026-0007',
            last_name: 'Ngono',
            first_names: 'Paul',
            sex: 'M',
            birth_date: '1979-06-12',
            phone_primary: '+237 677 00 00 07',
            archived: false,
            merged_into_patient_id: null,
            version: 3,
            created_at: '2026-10-01T08:00:00.000Z',
            updated_at: '2026-10-20T08:00:00.000Z',
          },
        },
      ],
    })
    // Serveur ARRÊTÉ : toute requête échoue (le stub répondrait 404 aux routes qu'il ne connaît pas, ce qu'un serveur éteint ne fait pas).
    stubServer({ me: 'unreachable' }).mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { root, router, unmount } = await openApp('/')
    await unlock(root, CASHIER_PROFILE, GOOD_SECRET)

    await router.push(`/patients/${SERVER}`)
    await flushPromises()

    expect(root.querySelector('h1')?.textContent).toContain('Ngono')
    expect(root.textContent).toContain('EE-2026-0007')
    expect(root.textContent).toContain('Données de ce poste seulement')
    const links = [...root.querySelectorAll('main a')].map((link) => link.textContent?.trim())
    expect(links).toContain('Modifier')
    expect(links).toContain('Créer une facture')

    await router.push(`/ventes/factures/nouvelle?patient=${SERVER}`)
    await flushPromises()
    expect(root.textContent).toContain('Ngono')

    await router.push('/patients/01J9ZXK4M2Q8R7S6T5V4W3PB09')
    await flushPromises()
    expect(root.textContent).not.toContain('EE-2026-0007')
    unmount()
  })
})

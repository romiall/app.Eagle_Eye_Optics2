import { afterEach, describe, expect, it, vi } from 'vitest'

interface VaultStubState {
  session: { profileId: string } | null
  deviceId: string | null
}

const mocks = vi.hoisted(() => ({
  syncNow: vi.fn(),
  summary: vi.fn(async () => ({
    local: 0,
    pending: 0,
    waitingDependency: 0,
    conflicts: 0,
    rejected: 0,
    otherProfiles: 0,
    otherCompartments: {},
    lastExchangeAt: null,
    lastAttemptFailed: false,
  })),
  issues: vi.fn(async () => []),
  setVaultView: vi.fn<(next: VaultStubState) => void>(),
}))

vi.mock('@/app/services/vault', async () => {
  const { ref } = await import('vue')
  const state = ref<VaultStubState>({ session: null, deviceId: null })
  mocks.setVaultView.mockImplementation((next: VaultStubState) => {
    state.value = next
  })
  return {
    deviceSyncOrNull: () =>
      state.value.deviceId === null
        ? null
        : { syncNow: mocks.syncNow, summary: mocks.summary, issues: mocks.issues },
    vaultView: state,
  }
})

import { installDeviceSync, syncDeviceNow } from '@/app/services/deviceSync'

describe('synchronisation explicite vs automatique du poste (deviceSync)', () => {
  afterEach(() => {
    mocks.syncNow.mockReset()
    mocks.summary.mockClear()
    mocks.issues.mockClear()
    mocks.setVaultView({ session: null, deviceId: null })
  })

  it('un clic explicite attend la fin d’un échange automatique en cours puis lance un essai neuf', async () => {
    let rejectAuto: (reason?: unknown) => void = () => undefined
    mocks.syncNow.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAuto = reject
        }),
    )
    mocks.syncNow.mockResolvedValueOnce(undefined)

    const uninstall = installDeviceSync(60_000)
    try {
      mocks.setVaultView({ session: { profileId: 'p1' }, deviceId: 'd1' })
      await Promise.resolve()
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)

      const manual = syncDeviceNow()
      expect(mocks.syncNow).toHaveBeenCalledTimes(1)

      rejectAuto(new Error('401 avant connexion serveur'))
      await expect(manual).resolves.toBeUndefined()
      expect(mocks.syncNow).toHaveBeenCalledTimes(2)
    } finally {
      uninstall()
    }
  })

  it('deux clics explicites simultanés partagent le même échange sans doublon', async () => {
    let resolveManual: () => void = () => undefined
    mocks.syncNow.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveManual = resolve
        }),
    )

    mocks.setVaultView({ session: { profileId: 'p1' }, deviceId: 'd1' })
    const first = syncDeviceNow()
    const second = syncDeviceNow()
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)

    resolveManual()
    await Promise.all([first, second])
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
  })
})

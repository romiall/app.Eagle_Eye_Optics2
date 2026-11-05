import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  appUpdateState,
  applyUpdate,
  checkForUpdate,
  INSTALL_STALL_MS,
  RELOAD_REFUSED_MS,
  reloadApplication,
  resetAppUpdateForTests,
  toggleUpdateDetails,
  watchServiceWorkerUpdates,
} from '@/app/services/appUpdate'
import { UPDATE_CHECK_MIN_GAP_MS } from '@/app/updateSchedule'
import type { UpdateReadiness } from '@/offline/update/updateGate'

import { fakeEnvironment, FakeWorkbox, type FakeEnvironment } from './support'

/**
 * Service de mise à jour de l'application (O06) : une nouvelle version est cherchée au retour sur l'application, annoncée
 * quand elle attend, et JAMAIS installée sans accord ni malgré un blocage ; le rechargement n'a lieu que si c'est cette
 * page qui a demandé l'installation. Le contrôle du poste est remplacé par des décisions fictives (ses règles sont
 * éprouvées par tests/frontend/offline/update.test.ts) ; le vrai service worker, par tests/e2e/app-update.spec.ts.
 */
const vault = vi.hoisted(() => ({ updateReadinessForThisDevice: vi.fn() }))
vi.mock('@/app/services/vault', () => vault)

const FREE: UpdateReadiness = { decision: 'FREE', reasons: [], pendingCount: 0 }
const CONFIRM: UpdateReadiness = {
  decision: 'CONFIRM',
  pendingCount: 2,
  reasons: [{ code: 'PENDING_COMMANDS', blocking: false, message: '2 pièces attendent.' }],
}
const BLOCKED: UpdateReadiness = {
  decision: 'BLOCKED',
  pendingCount: 1,
  reasons: [{ code: 'COMPATIBILITY_UNKNOWN', blocking: true, message: 'Serveur injoignable.' }],
}

let workbox: FakeWorkbox
let environment: FakeEnvironment

function start(): () => void {
  return watchServiceWorkerUpdates(workbox.asWorkbox(), environment)
}

async function announce(readiness: UpdateReadiness = FREE): Promise<void> {
  vault.updateReadinessForThisDevice.mockResolvedValue(readiness)
  workbox.emit('waiting')
  await flushPromises()
}

beforeEach(() => {
  workbox = new FakeWorkbox()
  environment = fakeEnvironment()
  vault.updateReadinessForThisDevice.mockResolvedValue(FREE)
})

afterEach(() => {
  resetAppUpdateForTests()
})

describe('annonce d’une nouvelle version', () => {
  it('sans service worker (serveur de développement), rien n’est branché ni proposé', async () => {
    watchServiceWorkerUpdates(null, environment)
    await checkForUpdate('manual')
    expect(appUpdateState.value.supported).toBe(false)
    expect(appUpdateState.value.available).toBe(false)
    expect(workbox.update).not.toHaveBeenCalled()
  })

  it('une version qui attend est annoncée avec le contrôle du poste', async () => {
    start()
    expect(appUpdateState.value.supported).toBe(true)
    expect(appUpdateState.value.available).toBe(false)
    await announce(CONFIRM)
    expect(appUpdateState.value.available).toBe(true)
    expect(appUpdateState.value.readiness).toEqual(CONFIRM)
    expect(appUpdateState.value.checking).toBe(false)
  })

  it('le téléchargement de la nouvelle version est signalé avant son annonce', async () => {
    start()
    workbox.emit('installing')
    expect(appUpdateState.value.downloading).toBe(true)
    expect(appUpdateState.value.available).toBe(false)
    await announce()
    expect(appUpdateState.value.downloading).toBe(false)
    expect(appUpdateState.value.available).toBe(true)

    resetAppUpdateForTests()
    start()
    workbox.emit('installing')
    workbox.emit('redundant')
    expect(appUpdateState.value.downloading).toBe(false)
    expect(appUpdateState.value.available).toBe(false)
  })

  it('un contrôle du poste impossible bloque par prudence au lieu de laisser installer', async () => {
    start()
    vault.updateReadinessForThisDevice.mockRejectedValue(new Error('coffre illisible'))
    workbox.emit('waiting')
    await flushPromises()
    expect(appUpdateState.value.readiness?.decision).toBe('BLOCKED')
    expect(await applyUpdate(true)).toBe('BLOCKED')
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('les détails se déplient et se replient, la bannière reste', async () => {
    start()
    await announce()
    expect(appUpdateState.value.expanded).toBe(false)
    toggleUpdateDetails()
    expect(appUpdateState.value.expanded).toBe(true)
    toggleUpdateDetails()
    expect(appUpdateState.value.expanded).toBe(false)
    expect(appUpdateState.value.available).toBe(true)
  })
})

describe('recherche d’une nouvelle version au retour sur l’application', () => {
  it('au retour, au réseau revenu et au minuteur, le navigateur cherche une nouvelle version', async () => {
    start()
    environment.fireReturn('return')
    await flushPromises()
    expect(workbox.update).toHaveBeenCalledTimes(1)
    expect(appUpdateState.value.lastCheckedAt).toBe(environment.clock.now)

    environment.clock.now += UPDATE_CHECK_MIN_GAP_MS
    environment.fireReturn('online')
    await flushPromises()
    expect(workbox.update).toHaveBeenCalledTimes(2)

    environment.clock.now += UPDATE_CHECK_MIN_GAP_MS
    environment.firePeriodic()
    await flushPromises()
    expect(workbox.update).toHaveBeenCalledTimes(3)
  })

  it('deux retours rapprochés ne cherchent qu’une fois ; la demande de la personne passe toujours', async () => {
    start()
    environment.fireReturn()
    await flushPromises()
    environment.clock.now += UPDATE_CHECK_MIN_GAP_MS - 1
    environment.fireReturn()
    await flushPromises()
    expect(workbox.update).toHaveBeenCalledTimes(1)

    await checkForUpdate('manual')
    expect(workbox.update).toHaveBeenCalledTimes(2)
  })

  it('page masquée ou hors ligne : aucune recherche automatique', async () => {
    start()
    environment.page.visible = false
    environment.fireReturn()
    environment.firePeriodic()
    await flushPromises()
    environment.page.visible = true
    environment.page.online = false
    environment.fireReturn('online')
    await flushPromises()
    expect(workbox.update).not.toHaveBeenCalled()
  })

  it('une demande sans réseau est signalée à la personne, pas ignorée', async () => {
    start()
    environment.page.online = false
    await checkForUpdate('manual')
    expect(workbox.update).not.toHaveBeenCalled()
    expect(appUpdateState.value.searchFailed).toBe(true)
  })

  it('un serveur muet n’efface rien : la recherche est dite en échec et reprendra', async () => {
    start()
    workbox.update.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await checkForUpdate('manual')
    expect(appUpdateState.value.searchFailed).toBe(true)
    expect(appUpdateState.value.searching).toBe(false)
    await checkForUpdate('manual')
    expect(appUpdateState.value.searchFailed).toBe(false)
    expect(appUpdateState.value.lastCheckedAt).toBe(environment.clock.now)
  })

  it('pas de recherche pendant une autre', async () => {
    start()
    let finish: () => void = () => undefined
    workbox.update.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined)
        }),
    )
    const first = checkForUpdate('manual')
    expect(appUpdateState.value.searching).toBe(true)
    await checkForUpdate('manual')
    expect(workbox.update).toHaveBeenCalledTimes(1)
    finish()
    await first
    expect(appUpdateState.value.searching).toBe(false)
  })

  it('une version déjà annoncée voit son contrôle du poste refait à chaque recherche', async () => {
    start()
    await announce(BLOCKED)
    vault.updateReadinessForThisDevice.mockClear()
    vault.updateReadinessForThisDevice.mockResolvedValue(FREE)
    await checkForUpdate('manual')
    expect(vault.updateReadinessForThisDevice).toHaveBeenCalledTimes(1)
    expect(appUpdateState.value.readiness).toEqual(FREE)
  })

  it('débrancher retire les écouteurs et le minuteur', () => {
    const stop = start()
    expect(workbox.listenerCount('waiting')).toBe(1)
    expect(workbox.listenerCount('controlling')).toBe(1)
    stop()
    expect(workbox.listenerCount('waiting')).toBe(0)
    expect(workbox.listenerCount('controlling')).toBe(0)
    expect(environment.removedReturn).toBe(1)
    expect(environment.stoppedPeriodic).toBe(1)
  })
})

describe('installation : sur demande, jamais forcée', () => {
  it('rien n’est installé sans version en attente', async () => {
    start()
    expect(await applyUpdate(true)).toBe('UNAVAILABLE')
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('un blocage refuse l’installation, même confirmée', async () => {
    start()
    await announce(BLOCKED)
    expect(await applyUpdate(false)).toBe('BLOCKED')
    expect(await applyUpdate(true)).toBe('BLOCKED')
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
    expect(appUpdateState.value.applying).toBe(false)
  })

  it('des pièces en attente demandent une confirmation explicite', async () => {
    start()
    await announce(CONFIRM)
    expect(await applyUpdate(false)).toBe('NEEDS_CONFIRMATION')
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
    expect(await applyUpdate(true)).toBe('APPLIED')
    expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1)
    expect(appUpdateState.value.applying).toBe(true)
  })

  it('sans pièce en attente, l’installation demandée recharge la page quand la nouvelle version prend la main', async () => {
    start()
    await announce(FREE)
    expect(await applyUpdate(false)).toBe('APPLIED')
    expect(environment.reload).not.toHaveBeenCalled()
    workbox.emit('controlling')
    expect(environment.reload).toHaveBeenCalledTimes(1)
  })

  it('un rechargement refusé (saisie non enregistrée) laisse cette page à recharger, sans rien perdre', async () => {
    start()
    await announce(FREE)
    await applyUpdate(false)
    workbox.emit('controlling')
    expect(environment.reload).toHaveBeenCalledTimes(1)
    // La page est encore là après le délai : le navigateur a demandé confirmation et la personne a refusé.
    environment.fireStall()
    expect(RELOAD_REFUSED_MS).toBe(5_000)
    expect(appUpdateState.value.applying).toBe(false)
    expect(appUpdateState.value.available).toBe(false)
    expect(appUpdateState.value.reloadNeeded).toBe(true)
    expect(appUpdateState.value.installStalled).toBe(false)
  })

  it('une installation qui ne prend pas la main est dite non aboutie, sans rien perdre', async () => {
    start()
    await announce(FREE)
    await applyUpdate(false)
    expect(INSTALL_STALL_MS).toBe(20_000)
    environment.fireStall()
    expect(appUpdateState.value.applying).toBe(false)
    expect(appUpdateState.value.installStalled).toBe(true)
    expect(appUpdateState.value.available).toBe(true)
    expect(environment.reload).not.toHaveBeenCalled()
  })

  it('une version installée depuis une autre fenêtre ne recharge pas cette page d’office : elle prévient', async () => {
    start()
    await announce(FREE)
    workbox.emit('controlling')
    expect(environment.reload).not.toHaveBeenCalled()
    expect(appUpdateState.value.reloadNeeded).toBe(true)
    expect(appUpdateState.value.available).toBe(false)
    reloadApplication()
    expect(environment.reload).toHaveBeenCalledTimes(1)
  })
})

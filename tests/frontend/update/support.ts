import { vi } from 'vitest'
import type { Workbox } from 'workbox-window'

import type { UpdateEnvironment } from '@/app/services/appUpdate'

/**
 * Doubles de test de la mise à jour de l'application (O06) : un `Workbox` factice dont les événements se déclenchent à
 * la main, et un environnement (horloge, visibilité, réseau, minuteurs, rechargement) entièrement commandé. Le vrai
 * service worker est éprouvé par tests/e2e/app-update.spec.ts.
 */
export class FakeWorkbox {
  update = vi.fn(async () => undefined)
  messageSkipWaiting = vi.fn()
  private readonly listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  emit(type: 'installing' | 'waiting' | 'redundant' | 'controlling'): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  asWorkbox(): Workbox {
    return this as unknown as Workbox
  }
}

export interface FakeEnvironment extends UpdateEnvironment {
  clock: { now: number }
  page: { visible: boolean; online: boolean }
  reload: ReturnType<typeof vi.fn<() => void>>
  /** Rappelle les écouteurs de retour sur l'application. */
  fireReturn(trigger?: 'return' | 'online'): void
  /** Déclenche le minuteur périodique. */
  firePeriodic(): void
  /** Déclenche le délai « installation non aboutie ». */
  fireStall(): void
  removedReturn: number
  stoppedPeriodic: number
}

export function fakeEnvironment(): FakeEnvironment {
  let returnListener: ((trigger: 'return' | 'online') => void) | null = null
  let periodic: (() => void) | null = null
  let stall: (() => void) | null = null
  const environment: FakeEnvironment = {
    clock: { now: 1_000_000 },
    page: { visible: true, online: true },
    reload: vi.fn<() => void>(),
    removedReturn: 0,
    stoppedPeriodic: 0,
    now: () => environment.clock.now,
    visible: () => environment.page.visible,
    online: () => environment.page.online,
    onReturn(listener) {
      returnListener = listener
      return () => {
        environment.removedReturn += 1
        returnListener = null
      }
    },
    every(_milliseconds, task) {
      periodic = task
      return () => {
        environment.stoppedPeriodic += 1
        periodic = null
      }
    },
    later(_milliseconds, task) {
      stall = task
      return () => {
        stall = null
      }
    },
    fireReturn(trigger = 'return') {
      returnListener?.(trigger)
    },
    firePeriodic() {
      periodic?.()
    },
    fireStall() {
      stall?.()
    },
  }
  return environment
}

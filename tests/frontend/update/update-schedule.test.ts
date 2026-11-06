import { describe, expect, it } from 'vitest'

import {
  shouldCheckForUpdate,
  UPDATE_CHECK_MIN_GAP_MS,
  UPDATE_CHECK_PERIOD_MS,
  type UpdateCheckContext,
} from '@/app/updateSchedule'

/**
 * Quand chercher une nouvelle version (O06) : au retour sur l'application, réseau revenu, à intervalle régulier et sur
 * demande — jamais hors ligne ni pendant une autre recherche, et sans interroger le serveur à chaque changement de
 * fenêtre.
 */
const NOW = 1_000_000_000

function context(overrides: Partial<UpdateCheckContext> = {}): UpdateCheckContext {
  return {
    trigger: 'return',
    now: NOW,
    lastCheckAt: null,
    visible: true,
    online: true,
    searching: false,
    ...overrides,
  }
}

describe('recherche d’une nouvelle version', () => {
  it('cherche au retour sur l’application quand rien n’a encore été cherché', () => {
    expect(shouldCheckForUpdate(context())).toBe(true)
    expect(shouldCheckForUpdate(context({ trigger: 'online' }))).toBe(true)
    expect(shouldCheckForUpdate(context({ trigger: 'periodic' }))).toBe(true)
  })

  it('respecte le plancher entre deux recherches automatiques', () => {
    const recent = NOW - (UPDATE_CHECK_MIN_GAP_MS - 1)
    expect(shouldCheckForUpdate(context({ lastCheckAt: recent }))).toBe(false)
    expect(shouldCheckForUpdate(context({ lastCheckAt: NOW - UPDATE_CHECK_MIN_GAP_MS }))).toBe(true)
    expect(shouldCheckForUpdate(context({ trigger: 'periodic', lastCheckAt: recent }))).toBe(false)
  })

  it('une recherche automatique attend que la page soit affichée', () => {
    expect(shouldCheckForUpdate(context({ visible: false }))).toBe(false)
    expect(shouldCheckForUpdate(context({ trigger: 'periodic', visible: false }))).toBe(false)
  })

  it('la demande de la personne passe toujours, plancher et page masquée compris', () => {
    expect(
      shouldCheckForUpdate(context({ trigger: 'manual', lastCheckAt: NOW - 1, visible: false })),
    ).toBe(true)
  })

  it('jamais hors ligne, jamais pendant une autre recherche', () => {
    for (const trigger of ['return', 'online', 'periodic', 'manual'] as const) {
      expect(shouldCheckForUpdate(context({ trigger, online: false })), trigger).toBe(false)
      expect(shouldCheckForUpdate(context({ trigger, searching: true })), trigger).toBe(false)
    }
  })

  it('le minuteur périodique est d’un quart d’heure, le plancher d’une minute', () => {
    expect(UPDATE_CHECK_PERIOD_MS).toBe(15 * 60 * 1000)
    expect(UPDATE_CHECK_MIN_GAP_MS).toBe(60 * 1000)
  })
})

import { describe, expect, it } from 'vitest'

import { buildDateText, describeBuild } from '@/app/buildInfo'
import { APP_BUILD, APP_RELEASE } from '@/app/release'

/**
 * Identité du build (O06) : la personne doit pouvoir lire quelle version son navigateur exécute, en français et à
 * l'heure du cabinet. Les valeurs de `APP_BUILD` sont fixées par vitest.config.ts (celles d'un vrai build viennent de
 * vite.config.ts ; tests/e2e/app-update.spec.ts lit `build-info.json` d'un vrai build).
 */
describe('identité du build', () => {
  it('écrit la date à l’heure du cabinet (Africa/Douala, UTC+1), en toutes lettres', () => {
    expect(buildDateText('2026-10-30T18:16:24.713Z')).toBe('30 octobre 2026 à 19h16')
    expect(buildDateText('2026-12-31T23:30:00.000Z')).toBe('1 janvier 2027 à 00h30')
    // Un autre fuseau est respecté.
    expect(buildDateText('2026-10-30T18:16:24.713Z', 'UTC')).toBe('30 octobre 2026 à 18h16')
  })

  it('ne casse jamais l’écran : date illisible ou fuseau inconnu', () => {
    expect(buildDateText('pas une date')).toBe('date inconnue')
    expect(buildDateText('')).toBe('date inconnue')
    expect(buildDateText('2026-10-30T18:16:24.713Z', 'Mars/Olympus')).toBe(
      '30 octobre 2026 à 19h16',
    )
  })

  it('dit l’identifiant et la date dans une phrase', () => {
    expect(describeBuild({ id: 'bbd83c4', builtAt: '2026-10-30T18:16:24.713Z' })).toBe(
      'build bbd83c4, construite le 30 octobre 2026 à 19h16',
    )
  })

  it('le build en cours porte l’identité injectée à la construction, immuable', () => {
    expect(APP_BUILD).toEqual({ id: 'test-build', builtAt: '2026-10-22T10:00:00.000Z' })
    expect(Object.isFrozen(APP_BUILD)).toBe(true)
    expect(APP_RELEASE).toBe('0.1.0-l0')
  })
})

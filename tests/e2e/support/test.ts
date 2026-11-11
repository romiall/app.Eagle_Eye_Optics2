import { test as base } from '@playwright/test'

import { retireDevicesOf } from './device-isolation'

/**
 * `test` des parcours qui préparent un poste (`prepareThisDevice`) : le `test` de Playwright, plus une fixture AUTOMATIQUE
 * qui, à la fin d'un parcours qui n'a pas réussi (échec, délai dépassé, interruption), sort les postes que ce parcours a
 * préparés. Sans elle, la caisse hors ligne principale resterait réservée et ferait échouer les parcours suivants et la
 * reprise du parcours lui-même (`FINANCIAL_DEVICE_ELSEWHERE`). Voir `device-isolation.ts`.
 *
 * Un parcours qui prépare un poste importe `test` d'ici et non de `@playwright/test` ; `expect` et les types restent ceux de
 * Playwright. La fixture est de la portée du test : elle ne change pas l'empreinte des processus de test, donc ni l'ordre
 * des fichiers ni le partage des processus. Un échec ATTENDU (`test.fail`) est un parcours qui n'a pas réussi : ses postes
 * sont sortis aussi.
 */
export const test = base.extend<{ deviceIsolation: undefined }>({
  deviceIsolation: [
    // Playwright exige un motif de déstructuration en premier paramètre, même vide.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      await use(undefined)
      if (testInfo.status === 'passed') return
      const retired = retireDevicesOf(testInfo)
      if (retired.length > 0) {
        console.warn(
          `Parcours non réussi (${testInfo.status ?? 'inconnu'}) : poste(s) sorti(s) ${retired.join(', ')}`,
        )
      }
    },
    { auto: true },
  ],
})

import { test as base } from '@playwright/test'

import { retireDevicesOf } from './device-isolation'
import { stopServersStartedSince } from './laravel-server'

/**
 * `test` des parcours qui préparent un poste (`prepareThisDevice`) ou qui démarrent leur propre serveur
 * (`startLaravelServer`) : le `test` de Playwright, plus deux fixtures AUTOMATIQUES de nettoyage, qui agissent à la fin de
 * chaque parcours, même interrompu par son délai :
 *
 *  - `deviceIsolation` : à la fin d'un parcours qui n'a pas réussi (échec, délai dépassé, interruption), sort les postes que
 *    ce parcours a préparés. Sans elle, la caisse hors ligne principale resterait réservée et ferait échouer les parcours
 *    suivants et la reprise du parcours lui-même (`FINANCIAL_DEVICE_ELSEWHERE`). Voir `device-isolation.ts` ;
 *  - `serverIsolation` : arrête les serveurs que le parcours a démarrés et ne les a pas arrêtés lui-même. Un parcours qui
 *    dépasse son délai ne passe pas par son `finally` ; son serveur PHP (processus détaché) resterait actif sur le port
 *    dédié et la reprise le prendrait pour le sien. Voir `laravel-server.ts`.
 *
 * Un parcours de ce genre importe `test` d'ici et non de `@playwright/test` ; `expect` et les types restent ceux de
 * Playwright (`isolation-postes.spec.ts` le vérifie). Les fixtures sont de la portée du test : elles ne changent pas
 * l'empreinte des processus de test, donc ni l'ordre des fichiers ni le partage des processus. Un échec ATTENDU
 * (`test.fail`) est un parcours qui n'a pas réussi : ses postes sont sortis aussi.
 */
export const test = base.extend<{ deviceIsolation: undefined; serverIsolation: undefined }>({
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
  serverIsolation: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const since = Date.now()
      await use(undefined)
      const ports = await stopServersStartedSince(since)
      if (ports.length > 0) {
        console.warn(
          `Parcours ${testInfo.status ?? 'inconnu'} : serveur(s) de test resté(s) actif(s) arrêté(s), port(s) ${ports.join(', ')}`,
        )
      }
    },
    { auto: true },
  ],
})

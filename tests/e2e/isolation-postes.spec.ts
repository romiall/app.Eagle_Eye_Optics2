import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type BrowserContext, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { blockingDevices } from './support/database'
import { api, deviceIdByCode, prepareThisDevice, signIn } from './support/device'
import { forgetDevicesOfThisTest } from './support/device-isolation'
import { abandonTrackedServers, startLaravelServer } from './support/laravel-server'
import { ISOLATION_SERVER_PORT } from './support/ports'
import { test } from './support/test'

/**
 * Garde de l'isolation des parcours qui préparent un poste (vérification unique du 2026-11-10, anomalie 4) : UNE SEULE
 * caisse hors ligne principale détient les numéros financiers à la fois (`FINANCIAL_DEVICE_ELSEWHERE`), donc un parcours
 * qui tombe sans rendre les ressources de son poste ne doit ni faire échouer les parcours suivants ni sa propre reprise.
 * Ce fichier prouve la propriété, sur la vraie application, en trois temps (chaque temps lit la base, pas l'écran) :
 *
 *  1. un parcours prépare un poste (ses plages financières sont réservées) puis tombe volontairement : échec ATTENDU
 *     (`test.fail`), qui n'est pas un échec de la suite mais un parcours « non réussi » comme un autre pour la fixture de
 *     `support/test.ts` ;
 *  2. le test suivant constate, AVANT toute préparation, qu'aucun poste ne détient de ressource financière et que le poste
 *     du parcours tombé est sorti (REPLACED) ; un nouveau poste se prépare alors et réserve ses numéros ;
 *  3. un poste qui reste actif sans que le parcours en cours le connaisse (un processus de test tué perd sa mémoire, pas la
 *     base : `forgetDevicesOfThisTest`) est sorti par la préparation du poste suivant, qui réserve ses numéros ;
 *  4. même principe pour les SERVEURS : un parcours qui démarre son serveur dédié puis tombe sans l'arrêter (comme un délai
 *     dépassé, qui n'exécute pas le `finally`) ne le laisse pas actif : la fixture `serverIsolation` l'arrête et son port se
 *     réutilise (vérification du 2026-11-11 : un serveur resté actif avait faussé la reprise du parcours) ;
 *  5. un serveur laissé par un processus de test TOMBÉ (plantage natif du 2026-11-11 : code 0xC0000409, aucune trace) est repris
 *     par la reprise du parcours : ses serveurs PHP, détachés, lui survivent et seul le registre de `support/laravel-server.ts`
 *     les retrouve ; sans cela, le second essai échouait aussitôt sur le port occupé.
 *
 * Deux contrôles statiques, sans navigateur, veillent en plus à ce que chaque parcours qui prépare un poste ou démarre son
 * serveur importe le `test` commun (les fixtures de nettoyage, postes et serveurs, n'agissent que dans les fichiers qui
 * l'importent), et à ce que chaque parcours qui RELANCE un serveur oublie d'abord la session du navigateur
 * (`forgetServerSession`, vérification du 2026-11-11).
 *
 * Le fichier rend à la fin les ressources du dernier poste et passe avant `zz-diagnostics-sql.spec.ts` (ordre alphabétique).
 * Les postes sortis gardent leurs plages ouvertes : alerte « poste à synchroniser » des diagnostics, jamais une anomalie.
 * Données FICTIVES. Le module « offline » est ouvert par prepare-env.mjs.
 */

// Une étape qui ne trouve pas son élément échoue après une minute, pas à la fin du délai du parcours.
test.use({ actionTimeout: 60_000 })

const SECRETS = {
  fallen: 'cedre-lagune-opale-brume-35',
  next: 'verveine-ardoise-sentier-orage-46',
  stray: 'tilleul-granit-ecume-cobalt-57',
} as const

/**
 * Constats du premier test, lus par le suivant : un échec attendu n'arrête pas le processus de test, qui garde ce module.
 * `reachedFailure` n'est vrai que si le parcours a VRAIMENT préparé un poste bloquant avant de tomber (sans cela, un échec
 * ailleurs dans le premier test passerait pour l'échec attendu).
 */
const fallenRun = { reachedFailure: false, code: '' }

function codes(devices: { code: string }[]): string[] {
  return devices.map((device) => device.code)
}

/** Statut d'un poste d'après son code, lu par l'API de la gérante. */
async function deviceStatus(page: Page, code: string): Promise<string | undefined> {
  const { request, headers } = await api(page)
  const response = await request.get('/api/v1/devices', { headers })
  expect(response.status(), await response.text()).toBe(200)
  const devices = (await response.json()) as { data: { device_code: string; status: string }[] }
  return devices.data.find((device) => device.device_code === code)?.status
}

/** Rend les ressources d'un poste qui n'a envoyé aucune pièce : journal vide (séquence 0, aucune empreinte). */
async function releaseEmptyDevice(page: Page, deviceId: string, key: string): Promise<void> {
  const { request, headers } = await api(page)
  const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
    headers,
    data: { password: demoAccount('MANAGER').password },
  })
  expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
  const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: {
      expected_version: null,
      last_device_sequence: '0',
      last_event_hash: null,
      reason: 'Fin du test de garde de l’isolation des postes (e2e)',
    },
  })
  expect(released.status(), await released.text()).toBe(200)
}

/** Sources des parcours (`*.spec.ts` de ce dossier). */
function specSources(): { file: string; source: string }[] {
  return readdirSync(import.meta.dirname)
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => ({ file, source: readFileSync(join(import.meta.dirname, file), 'utf8') }))
}

test('tout parcours qui prépare un poste ou démarre un serveur importe le `test` commun', () => {
  const offenders = specSources()
    .filter(
      ({ source }) =>
        /\b(prepareThisDevice|startLaravelServer)\(/.test(source) &&
        !source.includes("from './support/test'"),
    )
    .map(({ file }) => file)
  expect(offenders, 'parcours qui utilisent le `test` de Playwright sans le nettoyage').toEqual([])
})

test('tout parcours qui relance un serveur oublie d’abord la session du navigateur', () => {
  // L'affectation `server = await startLaravelServer(` (pas la déclaration `let server = …`) : le serveur REVIENT. La session
  // du navigateur survit à la fermeture : sans `forgetServerSession`, la page se rattache seule et le lien disparaît.
  const offenders = specSources()
    .filter(
      ({ source }) =>
        /^\s+server = await startLaravelServer\(/m.test(source) &&
        !source.includes('forgetServerSession('),
    )
    .map(({ file }) => file)
  expect(offenders, 'parcours sans forgetServerSession (support/device.ts)').toEqual([])
})

test.describe.serial('isolation des postes après un parcours tombé', () => {
  test.fail(
    'un parcours prépare un poste et réserve ses numéros, puis tombe volontairement (échec attendu)',
    async ({ browser }) => {
      test.setTimeout(600_000)
      const run = Date.now().toString(36)
      fallenRun.code = `ISO-A-${run}`.toUpperCase()
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await signIn(page, 'MANAGER')
        await prepareThisDevice(page, {
          secret: SECRETS.fallen,
          code: fallenRun.code,
          name: `Poste isolation A ${run} (e2e)`,
        })
        // Le poste détient ses plages financières : il bloquerait toute autre caisse tant qu'il reste actif.
        expect(codes(blockingDevices())).toContain(fallenRun.code)
        fallenRun.reachedFailure = true
        throw new Error('Échec volontaire du parcours : son poste n’a pas rendu ses ressources.')
      } finally {
        await context.close().catch(() => undefined)
      }
    },
  )

  test('le poste du parcours tombé est sorti ; un nouveau poste réserve ses numéros ; un poste inconnu du parcours est retiré', async ({
    browser,
  }) => {
    test.setTimeout(900_000)
    const run = Date.now().toString(36)
    const contexts: BrowserContext[] = []
    const openManagerPage = async (): Promise<Page> => {
      const context = await browser.newContext()
      contexts.push(context)
      const page = await context.newPage()
      await signIn(page, 'MANAGER')
      return page
    }

    try {
      expect(
        fallenRun.reachedFailure,
        'le premier test a préparé un poste qui bloque la caisse, puis est tombé volontairement',
      ).toBe(true)

      // --- 1. Constat IMMÉDIAT, avant toute préparation : c'est la fixture du parcours tombé qui a sorti son poste -------
      // (le filet de `prepareThisDevice`, plus bas, n'a pas encore pu le faire à sa place).
      expect(
        codes(blockingDevices()),
        'postes qui détiennent encore une ressource financière après la fin du parcours tombé',
      ).toEqual([])
      const nextPage = await openManagerPage()
      expect(await deviceStatus(nextPage, fallenRun.code), 'poste du parcours tombé').toBe(
        'REPLACED',
      )

      // --- 2. Un nouveau poste se prépare et réserve ses numéros : sans cela, FINANCIAL_DEVICE_ELSEWHERE --------------
      const nextCode = `ISO-B-${run}`.toUpperCase()
      await prepareThisDevice(nextPage, {
        secret: SECRETS.next,
        code: nextCode,
        name: `Poste isolation B ${run} (e2e)`,
      })
      expect(codes(blockingDevices()), 'le nouveau poste détient ses plages').toEqual([nextCode])

      // --- 3. Filet : un poste actif que le parcours en cours ne connaît pas est sorti par la préparation suivante ------
      forgetDevicesOfThisTest()
      const strayPage = await openManagerPage()
      const strayCode = `ISO-C-${run}`.toUpperCase()
      await prepareThisDevice(strayPage, {
        secret: SECRETS.stray,
        code: strayCode,
        name: `Poste isolation C ${run} (e2e)`,
      })
      expect(await deviceStatus(strayPage, nextCode), 'poste inconnu du parcours').toBe('REPLACED')
      expect(codes(blockingDevices()), 'seul le dernier poste détient des plages').toEqual([
        strayCode,
      ])

      // --- 4. Les ressources du dernier poste sont rendues : plus aucune caisse n'est bloquante -----------------------
      await releaseEmptyDevice(
        strayPage,
        await deviceIdByCode(strayPage, strayCode),
        `e2e-isolation-release-${run}`,
      )
      expect(codes(blockingDevices()), 'après la reprise complète du dernier poste').toEqual([])
    } finally {
      for (const context of contexts) await context.close().catch(() => undefined)
    }
  })
})

/** Constats du premier test de serveur, lus par le suivant (même principe que `fallenRun`). */
const fallenServer = { started: false, url: '' }

test.describe.serial('isolation des serveurs après un parcours tombé', () => {
  test.fail(
    'un parcours démarre son serveur dédié puis tombe sans l’arrêter (échec attendu)',
    async () => {
      // Le démarrage compile Laravel (six requêtes de préchauffage) : plus d'une minute sur un poste chargé.
      test.setTimeout(180_000)
      const server = await startLaravelServer(ISOLATION_SERVER_PORT)
      fallenServer.url = server.url
      fallenServer.started = true
      // Ni `server.stop()` ni `finally` : comme un parcours interrompu par son délai, dont le serveur PHP (détaché) reste actif.
      throw new Error('Échec volontaire du parcours : son serveur n’a pas été arrêté.')
    },
  )

  test('le serveur du parcours tombé est arrêté : son port ne répond plus et se réutilise', async () => {
    test.setTimeout(180_000)
    expect(fallenServer.started, 'le premier test a démarré son serveur puis est tombé').toBe(true)
    // C'est la fixture `serverIsolation` du parcours tombé qui l'a arrêté (aucun `finally` ne l'a fait).
    await expect(
      fetch(`${fallenServer.url}/up`, { signal: AbortSignal.timeout(2_000) }),
      'le serveur du parcours tombé répond encore',
    ).rejects.toThrow()
    // Le port se réutilise : sans cela, `startLaravelServer` refuserait (« répond déjà ») ou adopterait le serveur resté actif.
    const server = await startLaravelServer(ISOLATION_SERVER_PORT)
    await server.stop()
  })

  test('un serveur laissé par un processus tombé est repris par la reprise du parcours', async () => {
    // Deux démarrages (le second compile Laravel après avoir arrêté le premier) : plus d'une minute sur un poste chargé.
    test.setTimeout(300_000)
    const orphan = await startLaravelServer(ISOLATION_SERVER_PORT)
    // Un processus de test tombé perd sa mémoire, pas ses serveurs PHP (détachés) : on simule cette perte.
    abandonTrackedServers()
    const before = await fetch(`${orphan.url}/up`, { signal: AbortSignal.timeout(20_000) })
    expect(before.ok, 'le serveur laissé par le processus tombé répond encore').toBe(true)

    // La reprise du parcours démarre son serveur sur le même port : l'orphelin est arrêté puis remplacé, jamais adopté.
    const resumed = await startLaravelServer(ISOLATION_SERVER_PORT)
    const after = await fetch(`${resumed.url}/up`, { signal: AbortSignal.timeout(20_000) })
    expect(after.ok, 'le serveur de la reprise répond').toBe(true)

    // `stop()` n'arrête que le serveur de la reprise : si l'orphelin avait été adopté, le port répondrait encore et l'arrêt échouerait.
    await resumed.stop()
    await expect(
      fetch(`${resumed.url}/up`, { signal: AbortSignal.timeout(2_000) }),
      'le port répond encore après l’arrêt du serveur de la reprise',
    ).rejects.toThrow()
  })

  test('un serveur que ce parcours n’a pas arrêté n’est jamais repris en silence', async () => {
    test.setTimeout(180_000)
    const first = await startLaravelServer(ISOLATION_SERVER_PORT)
    try {
      await expect(startLaravelServer(ISOLATION_SERVER_PORT)).rejects.toThrow(
        /y a déjà démarré un serveur/,
      )
      // Le refus n'a touché ni à son processus ni à son port.
      const response = await fetch(`${first.url}/up`, { signal: AbortSignal.timeout(20_000) })
      expect(response.ok, 'le serveur du parcours répond encore après le refus').toBe(true)
    } finally {
      await first.stop()
    }
  })
})

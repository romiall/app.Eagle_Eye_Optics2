import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { LOCAL_SCHEMA_VERSION } from '../../resources/frontend/offline/migrations/registry'
import { demoAccount } from './support/accounts'
import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  prepareThisDevice,
  signIn,
  unlockVault,
} from './support/device'
import {
  createDeviceDatabaseAt,
  deviceDatabaseMentions,
  interruptedUpgrade,
  readDeviceContent,
  readDeviceDatabase,
} from './support/device-db'
import { startLaravelServer } from './support/laravel-server'
import { UPDATE_BACKEND_PORT, UPDATE_PROXY_PORT } from './support/ports'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'
import { test } from './support/test'
import { startUpdateProxy } from './support/update-proxy'

/**
 * Mise à jour de l'application dans un VRAI navigateur (O06 ; AT45 ; EE042, EE044 ; fiche : « Proposer SW update sans
 * remplacement forcé », « Migrer coffre additivement », « Vérifier pending, profils verrouillés, export et capacité avant
 * changement »), sur un profil persistant et deux versions de l'application derrière une origine (support/update-proxy.ts) :
 *
 *  1. la version PRÉCÉDENTE est installée, un poste préparé garde une pièce en attente (patient créé sur le poste) ;
 *  2. la version courante est « livrée » : la personne la cherche (pied de page « Vérifier les mises à jour »), le
 *     bandeau apparaît, collé en haut de l'écran ; serveur injoignable avec une pièce en attente : installation BLOQUÉE ;
 *  3. le serveur revient : installation à CONFIRMER (pièce en attente, aucun export) ; confirmée, la page se recharge sous
 *     la nouvelle version, l'ancien précache est retiré, rien n'est perdu (journal, profils, clés identiques à l'octet) ;
 *  4. serveur coupé : l'API et les fichiers privés ne sont JAMAIS remplacés par la coquille, qui vient du précache ;
 *  5. le coffre se rouvre, la pièce créée sous l'ancienne version est reprise et acceptée par le serveur.
 *
 * Puis, sans serveur de test dédié : la montée de schéma local N-1 → N d'une base IndexedDB réelle, coupure comprise.
 * Données FICTIVES. Le module « offline » est ouvert par prepare-env.mjs.
 */
const ROOT = join(import.meta.dirname, '..', '..')
const BUILD_DIRECTORY = join(ROOT, 'public', 'build')
const VAULT_SECRET = 'lagune-cedre-brume-piano-61'
const ORIGIN = `http://127.0.0.1:${UPDATE_PROXY_PORT}`
/** Origine dédiée déclarée comme origine de la SPA pour ce serveur (comme auth-session.spec.ts). */
const SERVER_ENVIRONMENT = {
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${UPDATE_PROXY_PORT}`,
  APP_URL: ORIGIN,
}
const BANNER_TITLE = 'Une nouvelle version de l’application est prête'
/** Créer ou chercher un patient exige le serveur, comme l'envoi des pièces : coupés, la fiche reste sur le poste. */
const PATIENTS_AND_PUSH = /^\/api\/v1\/(?:patients|sync\/push)/

/** Captures d'écran facultatives pour une revue visuelle : `EEO_E2E_CAPTURES` = répertoire de sortie (absent en CI). */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['EEO_E2E_CAPTURES']
  if (directory === undefined || directory === '') return
  await page.screenshot({ path: join(directory, `${name}.png`) })
}

/** Fichier d'entrée de l'application dans le build courant (`/build/assets/main-….js`). */
function entryFile(): string {
  const manifest = JSON.parse(
    readFileSync(join(BUILD_DIRECTORY, 'manifest.json'), 'utf8'),
  ) as Record<string, { file: string }>
  const entry = manifest['resources/frontend/app/main.ts']?.file
  if (entry === undefined)
    throw new Error('L’entrée de l’application est absente du manifeste Vite.')
  return entry.replace(/^assets\//, '')
}

/** Le navigateur a-t-il ce fichier dans l'un de ses caches (précache du service worker) ? */
async function cached(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (target) => (await caches.match(target)) !== undefined, path)
}

/** Adresses des caches du navigateur qui appartiennent à l'API : il ne doit y en avoir aucune. */
async function cachedApiUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return urls.filter((url) => new URL(url).pathname.startsWith('/api'))
  })
}

function syncSection(page: Page) {
  return page.locator('section[aria-labelledby="titre-synchronisation"]')
}

test.describe('mise à jour de l’application (O06, AT45)', () => {
  test('une nouvelle version s’installe sur accord, sans rien perdre ; la pièce en attente est reprise', async () => {
    test.setTimeout(900_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = `+237 600 06 ${stamp.slice(0, 2)} ${stamp.slice(2)}`
    const manager = demoAccount('MANAGER')
    const profile = newProfileDirectory()
    const backend = await startLaravelServer(UPDATE_BACKEND_PORT, SERVER_ENVIRONMENT)
    const proxy = await startUpdateProxy({
      port: UPDATE_PROXY_PORT,
      backend: backend.url,
      buildDirectory: BUILD_DIRECTORY,
    })
    const context = await openProfile(profile, proxy.origin)
    const requests = recordRequests(context)

    try {
      // --- 1. Version PRÉCÉDENTE installée, poste préparé, une pièce en attente ----------------------------------------
      const page = await context.newPage()
      await signIn(page, 'MANAGER')
      const deviceCode = `O06-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste mise à jour (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      // Le service worker contrôle les pages à partir de la navigation suivante (clientsClaim désactivé) : sans cela, la
      // nouvelle version s'activerait aussitôt au lieu d'attendre l'accord de la personne.
      expect(await activeServiceWorkerScope(page)).toMatch(/\/$/)
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)
      const footer = page.getByRole('contentinfo')
      await expect(footer).toContainText(`build ${proxy.older.id}`)
      await expect(footer).toContainText('construite le 2 janvier 2026 à 04h04')
      const banner = page.getByRole('region', { name: BANNER_TITLE })
      await expect(banner).toHaveCount(0)
      await capture(page, '1-pied-de-page-ancienne-version')

      // Le coffre s'est verrouillé au rechargement : il est rouvert, puis un patient est créé alors que la création et
      // l'envoi ne répondent pas (le serveur reste joignable pour le reste) : la fiche reste sur le poste, en attente.
      await unlockVault(page, VAULT_SECRET)
      proxy.cut(PATIENTS_AND_PUSH)
      await navigateInApp(page, '/patients/nouveau')
      const patientName = `PATIENT MISE A JOUR ${run}`.toUpperCase()
      await page.getByLabel('Nom (obligatoire)').fill(patientName)
      await page.getByLabel('Prénom(s)').fill('Test')
      await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
      await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
      await page.getByLabel('Téléphone principal').fill(phone)
      await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
      const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
      await expect(noCheck).toContainText(/le serveur n’est pas joignable/)
      await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
      await expect(page.getByText(/pièces? en attente de synchronisation/).first()).toBeVisible()
      // L'écran de saisie est quitté (rien à perdre au rechargement) : l'état du poste dit une pièce à envoyer.
      await navigateInApp(page, '/parametres/poste')
      const pendingPieces = async (): Promise<number> => {
        const text = await syncSection(page).innerText()
        const count = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? Number.NaN)
        return count(/pas encore envoyées : (\d+)/) + count(/en attente de confirmation : (\d+)/)
      }
      await expect.poll(pendingPieces).toBe(1)

      // --- 2. La version courante est « livrée » : la personne la cherche, le bandeau apparaît ---------------------------
      // Serveur injoignable pour l'API pendant que la nouvelle version se télécharge (les fichiers de l'application, eux,
      // sont servis) : avec une pièce en attente, le contrôle du poste ne peut pas vérifier la compatibilité.
      proxy.cut(/^\/api\//)
      proxy.serve('NEW')
      await footer.getByRole('button', { name: 'Vérifier les mises à jour' }).click()
      await expect(banner).toBeVisible({ timeout: 90_000 })
      await expect(banner.getByRole('heading', { level: 2, name: BANNER_TITLE })).toBeVisible()
      await expect(banner).toContainText('Vous utilisez encore l’ancienne version')
      await expect(banner).toContainText('les corrections récentes ne s’affichent pas')
      await capture(page, '2-bandeau-bloque')

      // Collé en haut de l'écran même quand la page défile (une page longue est simulée dans le contenu).
      await page.evaluate(() => {
        const filler = document.createElement('div')
        filler.id = 'remplissage-test'
        filler.style.height = '4000px'
        document.querySelector('main')?.appendChild(filler)
        window.scrollTo(0, 2500)
      })
      await expect
        .poll(async () => Math.abs((await banner.boundingBox())?.y ?? 999))
        .toBeLessThan(1)
      expect(await banner.evaluate((node) => getComputedStyle(node).position)).toBe('sticky')
      await page.evaluate(() => {
        document.getElementById('remplissage-test')?.remove()
        window.scrollTo(0, 0)
      })

      // Serveur injoignable + pièce en attente : l'installation est bloquée, la cause est écrite en clair.
      const install = banner.getByRole('button', { name: 'Installer la nouvelle version' })
      await expect(install).toBeDisabled()
      await expect(banner).toContainText('Le serveur est injoignable')
      // Le bandeau ne se masque pas : il n'a ni « Plus tard » ni fermeture.
      await expect(banner.getByRole('button', { name: /Plus tard|Fermer|Ignorer/ })).toHaveCount(0)
      // Il tient sur un écran de téléphone, sans débordement latéral.
      await page.setViewportSize({ width: 360, height: 800 })
      await expect(install).toBeVisible()
      const narrow = await banner.boundingBox()
      expect(narrow?.width ?? 999, 'le bandeau tient dans 360 px').toBeLessThanOrEqual(360)
      expect(
        await banner.evaluate((node) => node.scrollWidth <= node.clientWidth),
        'aucun débordement horizontal du bandeau à 360 px',
      ).toBe(true)
      const installBox = await install.boundingBox()
      expect((installBox?.x ?? 0) + (installBox?.width ?? 999)).toBeLessThanOrEqual(360)
      await capture(page, '3-bandeau-360px')
      await page.setViewportSize({ width: 1280, height: 800 })

      // --- 3. Le serveur revient : installation à confirmer, puis nouvelle version ----------------------------------------
      // Le poste est verrouillé avant l'installation : la pièce en attente appartient alors à un profil fermé.
      await page.getByRole('button', { name: 'Verrouiller le poste' }).click()
      await expect(page.getByRole('button', { name: 'Verrouiller le poste' })).toBeHidden()
      proxy.cut(PATIENTS_AND_PUSH)
      await banner.getByRole('button', { name: 'Vérifier de nouveau' }).click()
      await expect(install).toBeEnabled()
      await install.click()
      const confirm = banner.getByRole('button', { name: 'Confirmer l’installation' })
      await expect(confirm).toBeVisible()
      await expect(banner).toContainText('Lisez les points ci-dessous')
      await expect(banner).toContainText('attend la synchronisation')
      await expect(banner).toContainText('appartiennent à un profil verrouillé')
      await expect(banner).toContainText('Aucun export chiffré récent')
      await capture(page, '4-bandeau-a-confirmer')

      // L'état du poste avant l'installation : journal, profils, clés et données chiffrées.
      const before = await readDeviceDatabase(page)
      expect(
        before?.journalIds.length,
        'une pièce en attente dans le journal',
      ).toBeGreaterThanOrEqual(1)
      expect(before?.tables['command_journal']?.count).toBe(before?.journalIds.length)
      expect(before?.version).toBe(LOCAL_SCHEMA_VERSION * 10)
      const oldEntry = `/build/assets/${proxy.renamed.get(entryFile()) ?? ''}`
      const newEntry = `/build/assets/${entryFile()}`
      expect(await cached(page, oldEntry), 'la version précédente est précachée').toBe(true)

      await confirm.click()
      await expect(footer).toContainText(`build ${proxy.current.id}`, { timeout: 90_000 })
      await expect(footer).not.toContainText(`build ${proxy.older.id}`)
      await expect(banner).toHaveCount(0)
      await capture(page, '5-pied-de-page-nouvelle-version')

      // La nouvelle version a pris la main : son précache est là, l'ancien est retiré, aucune réponse de l'API n'est gardée.
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)
      expect(await cached(page, newEntry), 'la nouvelle version est précachée').toBe(true)
      await expect
        .poll(() => cached(page, oldEntry), { message: 'l’ancien précache est retiré' })
        .toBe(false)
      expect(await cachedApiUrls(page)).toEqual([])
      // La personne reste connectée au serveur ; le coffre, lui, est verrouillé par le rechargement.
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
      // Rien n'est perdu : journal, profils, enveloppes de clés et données chiffrées sont identiques à l'octet.
      const after = await readDeviceDatabase(page)
      expect(after).toEqual(before)
      // Aucun texte clair : la pièce en attente n'est pas lisible dans la base (le login d'un profil, lui, est une métadonnée
      // en clair : témoin que la recherche sait trouver un texte clair).
      expect(await deviceDatabaseMentions(page, patientName), 'nom du patient en clair').toBe(false)
      expect(await deviceDatabaseMentions(page, manager.login), 'témoin : login du profil').toBe(
        true,
      )

      // --- 4. Serveur coupé : ni l'API ni les fichiers privés ne sont remplacés par la coquille ---------------------------
      proxy.cut(/./)
      // Chaque adresse refusée est ouverte dans un onglet à part : la page d'erreur du navigateur s'installe après le
      // refus, et une navigation lancée trop tôt depuis le même onglet serait interrompue par elle.
      // Avec et sans extension : chaque règle de la liste de refus est atteinte seule (sans extension, c'est le préfixe du
      // chemin qui exclut la coquille ; avec une extension, la règle « fichier » le fait aussi).
      for (const refused of [
        `${proxy.origin}/storage/documents/facture-privee.pdf`,
        `${proxy.origin}/storage/documents/facture-privee`,
        `${proxy.origin}/api/v1/documents/inconnu/download`,
        `${proxy.origin}/build/assets/inconnu.js`,
        `${proxy.origin}/build/inconnu`,
      ]) {
        const probe = await context.newPage()
        await expect(probe.goto(refused), refused).rejects.toThrow(/net::ERR_/)
        await probe.close()
      }
      // Une adresse du routeur de l'application, elle, vient de la coquille précachée (le coffre existe : déverrouillage).
      await page.goto(`${proxy.origin}/patients`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await expect(page.getByRole('contentinfo')).toContainText(`build ${proxy.current.id}`)

      // Le service worker ne purge rien et n'impose rien : seul un message de la page le fait passer au premier plan.
      proxy.cut(null)
      const worker = await (await fetch(`${proxy.origin}/sw.js`)).text()
      expect(worker).toContain('SKIP_WAITING')
      expect(worker.match(/skipWaiting\(\)/g) ?? []).toHaveLength(1)
      expect(worker).not.toMatch(/clients\.claim\(\)/)
      expect(worker).not.toMatch(/indexedDB/)

      // --- 5. Le coffre se rouvre : la pièce créée sous l'ancienne version est toujours là, puis reprise -------------------
      proxy.cut(PATIENTS_AND_PUSH)
      await page.goto('/parametres/poste')
      await unlockVault(page, VAULT_SECRET)
      await expect(syncSection(page)).toContainText(/pas encore envoyées : \d+/)
      await expect.poll(pendingPieces).toBe(before?.journalIds.length)
      await expect(syncSection(page)).toContainText(/Conflits à revoir : 0/)

      // Le serveur revient : la nouvelle version envoie la pièce de l'ancienne, qui est acceptée. La tête du journal est lue
      // dans le lot envoyé : elle sert à rendre les ressources du poste en fin de parcours.
      const journal: { head: { sequence: string; hash: string } | null } = { head: null }
      page.on('request', (request) => {
        if (!request.url().endsWith('/api/v1/sync/push')) return
        const body = request.postDataJSON() as {
          commands?: { core: { device_sequence: string | number }; event_hash: string }[]
        } | null
        for (const command of body?.commands ?? []) {
          const sequence = String(command.core.device_sequence)
          if (journal.head === null || Number(sequence) > Number(journal.head.sequence)) {
            journal.head = { sequence, hash: command.event_hash }
          }
        }
      })
      proxy.cut(null)
      await navigateInApp(page, '/')
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      const { request, headers } = await api(page)
      await expect
        .poll(
          async () => {
            const response = await request.get(
              `/api/v1/patients?query=${encodeURIComponent(patientName)}`,
              { headers },
            )
            return ((await response.json()) as { data: unknown[] }).data.length
          },
          {
            message: 'le serveur a accepté la pièce créée sous l’ancienne version',
            timeout: 60_000,
          },
        )
        .toBe(1)

      // Aucune requête hors de l'origine, mises à jour comprises.
      expect(foreignRequests(requests, proxy.origin)).toEqual([])

      // Les ressources de ce poste sont rendues : une seule caisse hors ligne principale détient les numéros financiers.
      expect(journal.head, 'tête du journal lue dans le lot envoyé').not.toBeNull()
      const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
        headers,
        data: { password: manager.password },
      })
      expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-o06-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours de mise à jour de l’application (e2e)',
        },
      })
      expect(released.status(), await released.text()).toBe(200)
    } finally {
      await context.close().catch(() => undefined)
      await proxy.stop().catch(() => undefined)
      await backend.stop().catch(() => undefined)
      removeProfileDirectory(profile)
    }
  })

  test('le schéma local N-1 → N s’applique dans un vrai navigateur, sans rien perdre, coupure comprise', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const previous = LOCAL_SCHEMA_VERSION - 1

    // Une page de l'origine qui n'exécute AUCUN code de l'application : la base du poste n'existe pas encore.
    await page.goto('/up')
    expect(await readDeviceDatabase(page)).toBeNull()

    // Base du poste telle que la version précédente l'a laissée : toutes ses tables, deux lignes dans chacune.
    const written = await createDeviceDatabaseAt(page, previous)
    const start = await readDeviceContent(page)
    expect(start?.version).toBe(previous * 10)
    for (const [table, rows] of Object.entries(written)) {
      expect(start?.tables[table]?.rows, `${table} écrite`).toHaveLength(rows.length)
    }

    // Coupure AU MILIEU de la migration : le navigateur annule tout, la base reste intacte à la version précédente.
    const interrupted = await interruptedUpgrade(page, LOCAL_SCHEMA_VERSION)
    expect(interrupted.error).toBe('AbortError')
    expect(interrupted.version).toBe(previous * 10)
    expect(interrupted.stores).toEqual(Object.keys(start?.tables ?? {}).sort())
    expect(await readDeviceContent(page)).toEqual(start)

    // L'application ouvre la base : la migration reprend et aboutit, ajouts seulement.
    await page.goto('/')
    await expect
      .poll(async () => (await readDeviceContent(page))?.version, { timeout: 60_000 })
      .toBe(LOCAL_SCHEMA_VERSION * 10)
    const end = await readDeviceContent(page)
    for (const [table, content] of Object.entries(start?.tables ?? {})) {
      const kept = end?.tables[table]
      expect(kept, `${table} existe encore`).toBeDefined()
      // Aucune ligne n'est perdue ni réécrite (le journal de sécurité peut seulement s'allonger)…
      for (const row of content.rows) {
        expect(kept?.rows, `${table} garde la ligne ${JSON.stringify(row)}`).toContainEqual(row)
      }
      // … et aucun index n'est retiré.
      expect(kept?.indexes, `index de ${table}`).toEqual(expect.arrayContaining(content.indexes))
    }
    const added = Object.keys(end?.tables ?? {}).filter(
      (table) => !(table in (start?.tables ?? {})),
    )
    expect(added.length, 'la version courante ajoute des tables').toBeGreaterThanOrEqual(1)
    for (const table of added) {
      expect(end?.tables[table]?.rows, `${table} ajoutée, vide`).toEqual([])
    }
  })
})

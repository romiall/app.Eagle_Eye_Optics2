import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  numberRange,
  numberValue,
  prepareThisDevice,
  signIn,
  unlockFromPublicScreen,
} from './support/device'
import { startLaravelServer } from './support/laravel-server'
import { START_OFFLINE_PORT } from './support/ports'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'

/**
 * AT36 à la lettre (fichier 14) : DÉMARRAGE sans réseau d'un poste préparé, sur un vrai profil de navigateur persistant
 * et un serveur RÉELLEMENT arrêté (vault.md D14, D27 ; Playwright n'applique pas « hors ligne » aux requêtes du service
 * worker, voir smoke.spec.ts) :
 *
 *  1. serveur en marche : la gérante prépare ce poste (coffre, enrôlement, autorisation, numéros) et verrouille le poste ;
 *  2. le navigateur est fermé ENTIÈREMENT, le serveur ARRÊTÉ, puis le navigateur rouvert : la coquille vient du service
 *     worker, l'écran public de déverrouillage passe avant la connexion, le profil se déverrouille, le profil du coffre
 *     devient l'identité d'action ; un écran qui lit le serveur reste fermé, un patient est créé sur le poste (numéro de
 *     sa plage), sa fiche s'ouvre et se modifie SUR le poste, et la recherche répond avec les fiches de ce poste (A1) ;
 *  3. verrouiller le poste démonte la coquille ; une nouvelle fermeture complète, serveur toujours arrêté, retrouve les
 *     pièces dans le coffre, et la fiche (rejeu des faits) par la recherche locale ;
 *  4. le serveur revient : la personne se connecte depuis l'en-tête, le poste envoie ses pièces, et le serveur connaît
 *     la fiche avec un numéro de la plage du poste et la profession modifiée sur le poste.
 *
 * Données FICTIVES. Le module « offline » est ouvert par prepare-env.mjs.
 */

const VAULT_SECRET = 'cascade-ambre-voile-tigre-39'
const ORIGIN = `http://127.0.0.1:${START_OFFLINE_PORT}`
/** Origine dédiée déclarée comme origine de la SPA pour ce serveur (comme auth-session.spec.ts). */
const SERVER_ENVIRONMENT = {
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${START_OFFLINE_PORT}`,
  APP_URL: ORIGIN,
}

/** Captures d'écran facultatives pour une revue visuelle : `EEO_E2E_CAPTURES` = répertoire de sortie (absent en CI). */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['EEO_E2E_CAPTURES']
  if (directory === undefined || directory === '') return
  await page.screenshot({ path: join(directory, `${name}.png`) })
}

function syncSection(page: Page) {
  return page.locator('section[aria-labelledby="titre-synchronisation"]')
}

/**
 * Retrouve une fiche par la recherche de l'écran « Patients » puis l'ouvre : serveur injoignable, seules les fiches de ce
 * poste répondent, et l'écran le dit (jamais « aucun résultat » affirmé pour toute la clinique).
 */
async function openFromSearch(page: Page, name: string): Promise<void> {
  await navigateInApp(page, '/patients')
  await page.getByRole('searchbox', { name: 'Rechercher un patient' }).fill(name)
  await page.getByRole('button', { name: 'Rechercher' }).click()
  const main = page.getByRole('main')
  await expect(main).toContainText('Données de ce poste seulement')
  await main.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('démarrage sans réseau : déverrouillage public du poste (AT36, D14, D27)', () => {
  test('fermeture complète, serveur arrêté, déverrouillage, patient local, retour du serveur', async () => {
    test.setTimeout(600_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = `+237 600 00 ${stamp.slice(0, 2)} ${stamp.slice(2)}`
    const manager = demoAccount('MANAGER')
    const profile = newProfileDirectory()
    let server = await startLaravelServer(START_OFFLINE_PORT, SERVER_ENVIRONMENT)
    let context = await openProfile(profile, server.url)

    try {
      // --- 1. Serveur en marche : poste préparé, puis verrouillé depuis l'en-tête --------------------------------
      let page = await context.newPage()
      await signIn(page, 'MANAGER')
      const deviceCode = `AT36-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste démarrage hors réseau (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      // Le poste se verrouille depuis l'en-tête sans quitter la session du serveur (coffre ouvert : le bouton est offert).
      const lock = page.getByRole('button', { name: 'Verrouiller le poste' })
      await lock.click()
      await expect(lock).toBeHidden()
      // Le service worker a précaché la coquille : le prochain démarrage n'a pas besoin du réseau. Il contrôle les
      // pages à partir de la navigation suivante (clientsClaim désactivé) : un rechargement le fait passer en contrôle.
      expect(await activeServiceWorkerScope(page)).toMatch(/\/$/)
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)
      // Coffre verrouillé mais session du serveur ouverte : aucun écran de déverrouillage n'est imposé.
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()

      // --- 2. Fermeture COMPLÈTE, serveur ARRÊTÉ, réouverture ----------------------------------------------------
      await context.close()
      await server.stop()
      context = await openProfile(profile, ORIGIN)
      const requests = recordRequests(context)
      page = await context.newPage()
      await page.goto('/')
      // Un coffre existe et aucune identité n'est connue : le déverrouillage passe AVANT la connexion.
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await expect(page.getByLabel('Profil')).toContainText(`(${manager.login})`)
      // La coquille métier n'est pas là : ni menu, ni compte, ni déconnexion.
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)

      // Un mauvais secret est refusé sans rien révéler, puis le bon ouvre le profil.
      await page.getByLabel('Secret local').fill('mauvais-secret-fictif-00')
      await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
      await expect(page.getByText('Profil ou secret incorrect.').first()).toBeVisible()
      await capture(page, '1-deverrouillage-refuse')
      await expect(page.getByLabel('Secret local')).toHaveValue('')
      await unlockFromPublicScreen(page, VAULT_SECRET)

      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await expect(page.getByText('Profil local : serveur non joint')).toBeVisible()
      await capture(page, '2-accueil-profil-local')
      await expect(page).toHaveURL(/\/$/)

      // Un écran qui lit le serveur reste fermé, l'accueil l'explique (la liste des factures n'est pas encore locale).
      await page.evaluate(() => {
        window.history.pushState({}, '', '/ventes/factures')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      await expect(page.getByText(/« Factures » demande le serveur/)).toBeVisible()
      await expect(page).toHaveURL(/\/$/)

      // Un patient est créé sur le poste, sans le serveur (numéro de dossier de la plage du poste).
      await navigateInApp(page, '/patients/nouveau')
      const patientName = `PATIENT DEMARRAGE ${run}`.toUpperCase()
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

      // A1 : la fiche créée s'ouvre SUR le poste (le serveur est arrêté), sans onglet ni action qui lirait le serveur.
      await page.getByRole('link', { name: 'Ouvrir la fiche' }).click()
      await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
      const filePath = new URL(page.url()).pathname
      await expect(page.getByRole('heading', { level: 1 })).toContainText(patientName)
      const main = page.getByRole('main')
      await expect(main).toContainText('Données de ce poste seulement')
      const tabs = page.getByRole('navigation', { name: 'Sections du dossier patient' })
      await expect(tabs.getByRole('link')).toHaveText(['Identité'])
      // L'arrivée demande le serveur : aucun lien vers un écran fermé. La facture, elle, se prépare sur le poste.
      await expect(main.getByRole('link', { name: 'Enregistrer une arrivée' })).toHaveCount(0)
      await expect(main.getByRole('link', { name: 'Créer une facture' })).toBeVisible()
      await capture(page, '3-fiche-sur-le-poste')
      // Modifiée sur le poste : la profession s'ajoute à la fiche (rejeu de la création puis de la modification).
      await page.getByRole('link', { name: 'Modifier' }).click()
      await page.getByLabel('Profession').fill('Enseignante')
      await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
      await navigateInApp(page, filePath)
      await expect(main).toContainText('Enseignante')
      await openFromSearch(page, patientName)
      await expect(main).toContainText('Enseignante')

      // --- 3. Verrouiller démonte la coquille ; une nouvelle fermeture complète retrouve les pièces ----------------
      await page.getByRole('button', { name: 'Verrouiller le poste' }).click()
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await expect(page.getByText(/Enregistré sur ce poste/)).toHaveCount(0)
      await expect(page.getByRole('navigation')).toHaveCount(0)

      await context.close()
      context = await openProfile(profile, ORIGIN)
      page = await context.newPage()
      await page.goto('/')
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await unlockFromPublicScreen(page, VAULT_SECRET)
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      // A1 : après la fermeture complète, la fiche est relue DANS le coffre (création et modification rejouées).
      await openFromSearch(page, patientName)
      await expect(page.getByRole('main')).toContainText('Enseignante')
      await navigateInApp(page, '/parametres/poste')
      // Les pièces sont retrouvées dans le coffre (création, modification) : à envoyer, ou envoyées sans confirmation
      // (le poste a tenté un échange pendant que le serveur était arrêté) ; jamais consolidées, jamais en conflit.
      await expect(syncSection(page)).toContainText(/pas encore envoyées : \d+/)
      await expect
        .poll(async () => {
          const text = await syncSection(page).innerText()
          const count = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? Number.NaN)
          return count(/pas encore envoyées : (\d+)/) + count(/en attente de confirmation : (\d+)/)
        })
        .toBe(2)
      await expect(syncSection(page)).toContainText(/Conflits à revoir : 0/)
      const foreign = foreignRequests(requests, ORIGIN)
      expect(foreign, 'aucune requête hors de l’origine, démarrage compris').toEqual([])

      // --- 4. Le serveur revient : connexion depuis l'en-tête, envoi, preuve côté serveur ---------------------------
      server = await startLaravelServer(START_OFFLINE_PORT, SERVER_ENVIRONMENT)
      // La tête du journal du poste est lue dans le lot envoyé : elle sert à rendre les ressources en fin de parcours.
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
      await page.getByRole('link', { name: 'Se connecter au serveur' }).click()
      await page.getByLabel('Identifiant').fill(manager.login)
      await page.getByLabel('Mot de passe').fill(manager.password)
      await page.getByRole('button', { name: 'Se connecter' }).click()
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      // Le serveur prend la place du profil local : plus de mention « profil local ».
      await expect(page.getByText('Profil local : serveur non joint')).toHaveCount(0)
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      await expect(page.getByText(/Synchronisé le /).first()).toBeVisible()

      const { request, headers } = await api(page)
      const found = (await (
        await request.get(`/api/v1/patients?query=${encodeURIComponent(patientName)}`, { headers })
      ).json()) as { data: { record_number: string }[] }
      expect(found.data).toHaveLength(1)
      const record = found.data[0]?.record_number ?? ''
      expect(record).toMatch(/^EE-\d{4}-\d{4,}$/)
      const records = await numberRange(page, deviceId, 'PATIENT')
      expect(numberValue(record)).toBeGreaterThanOrEqual(records.start)
      expect(numberValue(record)).toBeLessThanOrEqual(records.end)
      // La modification faite sur le poste a suivi la création : le serveur connaît la profession.
      const detail = (await (await request.get(`/api/v1${filePath}`, { headers })).json()) as {
        data: { profession: string | null }
      }
      expect(detail.data.profession).toBe('Enseignante')

      // Les ressources de ce poste sont rendues : une seule caisse hors ligne principale détient les numéros financiers.
      expect(journal.head, 'tête du journal lue dans le lot envoyé').not.toBeNull()
      // Opération sensible : le mot de passe de la gérante est confirmé dans cette session (connexion toute récente).
      const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
        headers,
        data: { password: manager.password },
      })
      expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-at36-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours de démarrage hors réseau (e2e)',
        },
      })
      expect(released.status(), await released.text()).toBe(200)
    } finally {
      await context.close().catch(() => undefined)
      await server.stop().catch(() => undefined)
      removeProfileDirectory(profile)
    }
  })
})

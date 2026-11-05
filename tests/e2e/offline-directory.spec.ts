import { expect, test, type Page, type Response } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  prepareThisDevice,
  signIn,
  unlockFromPublicScreen,
} from './support/device'
import { startLaravelServer } from './support/laravel-server'
import { DIRECTORY_OFFLINE_PORT } from './support/ports'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'

/**
 * Annuaire du poste (A2) : la fiche d'un patient du SERVEUR, reçue par le pull, se lit, se modifie et se facture sur un
 * vrai profil de navigateur persistant et un serveur RÉELLEMENT arrêté :
 *
 *  1. serveur en marche : la gérante crée une fiche EN LIGNE (une fiche du serveur, que ce poste n'a jamais créée), prépare
 *     le poste, puis reçoit l'annuaire par les échanges de synchronisation (pull) ;
 *  2. navigateur fermé ENTIÈREMENT, serveur ARRÊTÉ, rouvert : le profil se déverrouille depuis l'écran public ;
 *  3. sans réseau : la fiche du serveur se retrouve par la recherche, s'ouvre, se modifie (la profession s'ajoute), puis une
 *     facture est enregistrée et émise sur le poste ; elle se relit avec l'identité du patient ;
 *  4. nouvelle fermeture complète, serveur toujours arrêté : la facture (avec le patient) et la modification sont retrouvées ;
 *  5. le serveur revient : synchronisation, et le serveur connaît la modification et la facture de CE patient.
 *
 * Données FICTIVES (article DEMO-*). Le module « offline » est ouvert par prepare-env.mjs.
 */

const VAULT_SECRET = 'prairie-opale-tonnerre-cadre-59'
const ORIGIN = `http://127.0.0.1:${DIRECTORY_OFFLINE_PORT}`
/** Origine dédiée déclarée comme origine de la SPA pour ce serveur (comme offline-invoice.spec.ts). */
const SERVER_ENVIRONMENT = {
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${DIRECTORY_OFFLINE_PORT}`,
  APP_URL: ORIGIN,
}

/**
 * Reçoit l'annuaire depuis l'en-tête : des échanges jusqu'à ce que le serveur n'ait plus rien à publier (une page de pull
 * ne porte que 100 changements, un échange 20 pages). Ouvre au moins un échange, jamais plus de huit.
 */
async function receiveDirectory(page: Page): Promise<void> {
  const sync = page.getByRole('button', { name: 'Synchroniser', exact: true })
  const hasMore: boolean[] = []
  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/v1/sync/pull')) return
    void response
      .json()
      .then((body: { has_more?: boolean }) => hasMore.push(body.has_more === true))
      .catch(() => undefined)
  })
  for (let round = 1; round <= 8; round += 1) {
    hasMore.length = 0
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/sync/pull'), {
        timeout: 120_000,
      }),
      sync.click(),
    ])
    // Le bouton reprend son nom quand l'échange est terminé.
    await expect(sync).toBeVisible({ timeout: 120_000 })
    if (hasMore.at(-1) !== true) return
  }
  throw new Error('Le serveur a encore des changements à publier après huit échanges.')
}

/** Retrouve la fiche par la recherche de l'écran « Patients » (serveur injoignable) puis l'ouvre. */
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

test.describe('annuaire du poste : patient du serveur lu, modifié et facturé SANS réseau (A2)', () => {
  test('fiche reçue par le pull retrouvée, modifiée, facturée sur le poste, fermeture complète, synchronisation', async () => {
    test.setTimeout(900_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = `+237 600 00 ${stamp.slice(0, 2)} ${stamp.slice(2)}`
    const manager = demoAccount('MANAGER')
    const profile = newProfileDirectory()
    let server = await startLaravelServer(DIRECTORY_OFFLINE_PORT, SERVER_ENVIRONMENT)
    let context = await openProfile(profile, server.url)

    try {
      // --- 1. Serveur en marche : fiche du SERVEUR, poste préparé, annuaire reçu --------------------------------------
      let page = await context.newPage()
      await signIn(page, 'MANAGER')
      const patientName = `PATIENT ANNUAIRE ${run}`.toUpperCase()
      await page.goto('/patients/nouveau')
      await page.getByLabel('Nom (obligatoire)').fill(patientName)
      await page.getByLabel('Prénom(s)').fill('Test')
      await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
      await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
      await page.getByLabel('Téléphone principal').fill(phone)
      await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
      await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
      const patientPath = new URL(page.url()).pathname
      const patientId = patientPath.split('/').pop() ?? ''

      const deviceCode = `ANN-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste annuaire (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      // Le coffre est ouvert : l'annuaire arrive comme depuis l'en-tête (pas de rechargement, qui refermerait le coffre).
      await navigateInApp(page, '/')
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await receiveDirectory(page)
      const lock = page.getByRole('button', { name: 'Verrouiller le poste' })
      await lock.click()
      await expect(lock).toBeHidden()
      expect(await activeServiceWorkerScope(page)).toMatch(/\/$/)
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()

      // --- 2. Fermeture COMPLÈTE, serveur ARRÊTÉ, réouverture et déverrouillage ---------------------------------------
      await context.close()
      await server.stop()
      context = await openProfile(profile, ORIGIN)
      const requests = recordRequests(context)
      page = await context.newPage()
      await page.goto('/')
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await unlockFromPublicScreen(page, VAULT_SECRET)
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await expect(page.getByText('Profil local : serveur non joint')).toBeVisible()

      // --- 3. Sans réseau : la fiche du serveur se retrouve, se modifie, se facture ----------------------------------
      await openFromSearch(page, patientName)
      expect(new URL(page.url()).pathname).toBe(patientPath)
      const main = page.getByRole('main')
      await expect(main).toContainText('Données de ce poste seulement')
      await expect(main).toContainText('Test')
      await page.getByRole('link', { name: 'Modifier' }).click()
      await page.getByLabel('Profession').fill('Opticienne')
      await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
      await navigateInApp(page, patientPath)
      await expect(main).toContainText('Opticienne')

      await page.getByRole('link', { name: 'Créer une facture' }).click()
      await expect(page).toHaveURL(new RegExp(`/ventes/factures/nouvelle\\?patient=${patientId}$`))
      const picker = page.getByRole('combobox', { name: 'Ajouter un article du catalogue' })
      await picker.fill('DEMO-EXAMEN')
      await expect(page.getByText(/Catalogue de ce poste/).first()).toBeVisible()
      await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
      await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
      await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
      const invoicePath = new URL(page.url()).pathname
      const invoiceId = invoicePath.split('/').pop() ?? ''
      await expect(main).toContainText(
        'Brouillon de facture enregistré sur ce poste, en attente de synchronisation.',
      )
      await expect(main).toContainText(patientName)

      await page.getByRole('button', { name: 'Émettre la facture' }).click()
      await page
        .getByRole('dialog', { name: 'Émettre la facture ?' })
        .getByRole('button', { name: 'Émettre la facture' })
        .click()
      const heading = page.getByRole('heading', {
        level: 1,
        name: /^Facture TEST-FAC-\d{4}-\d{6}$/,
      })
      await expect(heading).toBeVisible()
      const invoiceNumber = (await heading.innerText()).replace(/^Facture\s+/, '').trim()
      // Patient du SERVEUR : la facture émise sur le poste se relit avec son identité, sans écran verrouillé.
      await expect(main).toContainText('Facture émise sur ce poste')
      await expect(main).toContainText(patientName)
      expect(foreignRequests(requests, ORIGIN), 'aucune requête hors de l’origine').toEqual([])

      // --- 4. Nouvelle fermeture COMPLÈTE, serveur toujours arrêté : tout est retrouvé dans le coffre -----------------
      await context.close()
      context = await openProfile(profile, ORIGIN)
      page = await context.newPage()
      await page.goto('/')
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await unlockFromPublicScreen(page, VAULT_SECRET)
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await navigateInApp(page, invoicePath)
      await expect(
        page.getByRole('heading', { level: 1, name: `Facture ${invoiceNumber}` }),
      ).toBeVisible()
      await expect(page.getByRole('main')).toContainText(patientName)
      await navigateInApp(page, patientPath)
      await expect(page.getByRole('main')).toContainText('Opticienne')

      // --- 5. Le serveur revient : connexion depuis l'en-tête, envoi, preuve côté serveur --------------------------
      server = await startLaravelServer(DIRECTORY_OFFLINE_PORT, SERVER_ENVIRONMENT)
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
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      await expect(page.getByText(/Synchronisé le /).first()).toBeVisible()

      const { request, headers } = await api(page)
      await expect
        .poll(async () => {
          const response = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
          return response.status() === 200
            ? ((await response.json()) as { data: { status: string } }).data.status
            : ''
        })
        .toBe('ISSUED')
      const invoiceResponse = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
      const synced = (await invoiceResponse.json()) as { data: { number: string } }
      // La pièce garde EXACTEMENT le numéro affiché sans réseau, et elle est celle de CE patient du serveur.
      expect(synced.data.number).toBe(invoiceNumber)
      expect(JSON.stringify(synced.data)).toContain(patientId)
      await expect
        .poll(async () => {
          const response = await request.get(`/api/v1/patients/${patientId}`, { headers })
          return ((await response.json()) as { data?: { profession?: string | null } }).data
            ?.profession
        })
        .toBe('Opticienne')

      // Les ressources de ce poste sont rendues : une seule caisse hors ligne principale détient les numéros financiers.
      expect(journal.head, 'tête du journal lue dans le lot envoyé').not.toBeNull()
      const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
        headers,
        data: { password: manager.password },
      })
      expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-directory-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours de l’annuaire du poste (e2e)',
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

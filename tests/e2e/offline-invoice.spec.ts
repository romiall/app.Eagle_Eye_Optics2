import { readFileSync } from 'node:fs'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  numberRange,
  numberValue,
  payAmountOffline,
  payRemainingOffline,
  prepareThisDevice,
  signIn,
  unlockFromPublicScreen,
} from './support/device'
import { startLaravelServer } from './support/laravel-server'
import { INVOICE_OFFLINE_PORT } from './support/ports'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'

/**
 * AT37 à la lettre (fichier 14) : « Sans réseau : facture 80 000, acompte 30 000/reçu, solde 50 000/reçu, PDF/impression »,
 * sur un vrai profil de navigateur persistant et un serveur RÉELLEMENT arrêté (le patient, la facture et ses lignes sont
 * créés, la facture est émise SUR le poste ; contrairement à `first-slice.spec.ts`, rien n'est émis en ligne) :
 *
 *  1. serveur en marche : la gérante prépare ce poste (coffre, enrôlement, autorisation, numéros, catalogue figé) ;
 *  2. navigateur fermé ENTIÈREMENT, serveur ARRÊTÉ, rouvert : le profil se déverrouille depuis l'écran public ;
 *  3. sans réseau : un patient est créé sur le poste, sa fiche s'ouvre, une facture de 80 000 FCFA (catalogue figé du
 *     poste, deux lignes fictives dont un prix modifié par la gérante) est enregistrée puis émise avec un numéro de la
 *     plage du poste ; acompte de 30 000 puis solde de 50 000, deux reçus, PDF de la facture et d'un reçu, aucune requête
 *     hors de l'origine ;
 *  4. nouvelle fermeture complète, serveur toujours arrêté : la facture, ses reçus et leurs numéros sont retrouvés dans
 *     le coffre ;
 *  5. le serveur revient : connexion depuis l'en-tête, synchronisation, et le serveur connaît la facture (mêmes numéros,
 *     total de 80 000, deux encaissements, reste nul).
 *
 * Données FICTIVES (articles DEMO-*). Le module « offline » est ouvert par prepare-env.mjs.
 */

const VAULT_SECRET = 'prairie-opale-tonnerre-cadre-58'
const ORIGIN = `http://127.0.0.1:${INVOICE_OFFLINE_PORT}`
/** Origine dédiée déclarée comme origine de la SPA pour ce serveur (comme offline-start.spec.ts). */
const SERVER_ENVIRONMENT = {
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${INVOICE_OFFLINE_PORT}`,
  APP_URL: ORIGIN,
}

/** Facture telle que le serveur la rend (champs lus par ce parcours). */
interface ServerInvoice {
  data: {
    number: string
    status: string
    total_gross: number
    balance: { balance_due: number; paid_net: number }
    payments: { reference: string | null; receipt_number: string | null }[]
  }
}

function receiptNumbers(text: string): string[] {
  return [...new Set(text.match(/TEST-REC-\d{4}-\d{6}/g) ?? [])]
}

/** PDF produit sur le poste : aperçu rendu, puis téléchargement d'un vrai PDF au nom sans donnée sensible. */
async function expectLocalPdf(page: Page, preview: Locator, fileName: RegExp): Promise<void> {
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await expect(preview.getByRole('img', { name: /^Page 1 sur \d+/ })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Télécharger le PDF' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(fileName)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(bytes.byteLength).toBeGreaterThan(1500)
}

async function showReceiptPdf(page: Page, number: string): Promise<void> {
  const main = page.getByRole('main')
  await main.getByRole('button', { name: `Voir le reçu ${number}` }).click()
  await main.getByRole('button', { name: `Aperçu du reçu (PDF) ${number}` }).click()
  await expectLocalPdf(
    page,
    page.getByRole('region', { name: `Aperçu : Reçu ${number}` }),
    /^recu-TEST-REC-\d{4}-\d{6}\.pdf$/,
  )
}

test.describe('AT37 à la lettre : facture, acompte, solde et PDF SANS réseau (G1)', () => {
  test('patient et facture de 80 000 créés puis émis sur le poste, 30 000 puis 50 000, PDF, fermeture complète, synchronisation', async () => {
    test.setTimeout(900_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = `+237 600 00 ${stamp.slice(0, 2)} ${stamp.slice(2)}`
    const manager = demoAccount('MANAGER')
    const reference1 = `MOMO-AT37-A-${run}`.toUpperCase()
    const reference2 = `MOMO-AT37-B-${run}`.toUpperCase()
    const profile = newProfileDirectory()
    let server = await startLaravelServer(INVOICE_OFFLINE_PORT, SERVER_ENVIRONMENT)
    let context = await openProfile(profile, server.url)

    try {
      // --- 1. Serveur en marche : poste préparé (catalogue figé compris), puis verrouillé ---------------------------
      let page = await context.newPage()
      await signIn(page, 'MANAGER')
      const deviceCode = `AT37-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste facture hors réseau (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
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

      // --- 3. Sans réseau : patient, facture de 80 000 émise sur le poste, acompte, solde, PDF -----------------------
      await navigateInApp(page, '/patients/nouveau')
      const patientName = `PATIENT AT37 ${run}`.toUpperCase()
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
      await page.getByRole('link', { name: 'Ouvrir la fiche' }).click()
      await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)

      // La facture se prépare depuis la fiche, avec le catalogue FIGÉ du poste (le serveur est arrêté).
      await page.getByRole('link', { name: 'Créer une facture' }).click()
      await expect(page).toHaveURL(/\/ventes\/factures\/nouvelle\?patient=[0-9A-HJKMNP-TV-Z]{26}$/)
      const picker = page.getByRole('combobox', { name: 'Ajouter un article du catalogue' })
      await picker.fill('DEMO-VERRES')
      await expect(page.getByText(/Catalogue de ce poste/).first()).toBeVisible()
      await page.getByRole('option', { name: /Verres fictifs/ }).click()
      await picker.fill('DEMO-EXAMEN')
      await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
      // Autorité de prix de la gérante : l'examen est facturé 20 000 pour atteindre exactement 80 000 (60 000 + 20 000).
      const prices = page.getByLabel(/^Prix unitaire TTC/)
      await prices.nth(1).fill('20 000')
      await prices.nth(1).blur()
      await expect(page.getByRole('group', { name: 'Total du brouillon' })).toContainText(
        '80 000 FCFA',
      )
      await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
      await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
      const invoicePath = new URL(page.url()).pathname
      const main = page.getByRole('main')
      await expect(main).toContainText(
        'Brouillon de facture enregistré sur ce poste, en attente de synchronisation.',
      )
      await expect(main).not.toContainText('enregistré sur le serveur')

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
      await expect(main).toContainText('Facture émise sur ce poste')
      await expect(main).toContainText('Facture de ce poste')
      await expect(main.locator('[data-montant="due"]')).toContainText('80 000 FCFA')

      // Acompte de 30 000, puis règlement du solde de 50 000 : un reçu chacun, un reste exact à chaque étape.
      await payAmountOffline(page, '30 000', reference1)
      await expect(main).toContainText('Reste à encaisser maintenant : 50 000 FCFA')
      await expect(main.locator('[data-montant="due"]')).toContainText('50 000 FCFA')
      const [receipt1] = receiptNumbers(await main.innerText())
      expect(receipt1).toMatch(/^TEST-REC-\d{4}-\d{6}$/)

      await page.getByRole('button', { name: 'Nouvel encaissement' }).click()
      await payRemainingOffline(page, reference2)
      await expect(main).toContainText('Reste à encaisser maintenant : 0 FCFA')
      await expect(main.locator('[data-montant="collected"]')).toContainText('80 000 FCFA')
      const [first, receipt2] = receiptNumbers(await main.innerText())
      expect(first).toBe(receipt1)
      expect(receipt2).toMatch(/^TEST-REC-\d{4}-\d{6}$/)
      expect(numberValue(receipt2 ?? '')).toBeGreaterThan(numberValue(receipt1 ?? ''))

      // PDF locaux, sans réseau : la facture et un reçu.
      await main.getByRole('button', { name: 'Aperçu de la facture (PDF)' }).click()
      await expectLocalPdf(
        page,
        page.getByRole('region', { name: `Aperçu : Facture ${invoiceNumber}` }),
        /^facture-TEST-FAC-\d{4}-\d{6}\.pdf$/,
      )
      await showReceiptPdf(page, receipt1 ?? '')
      expect(
        foreignRequests(requests, ORIGIN),
        'aucune requête hors de l’origine, PDF compris',
      ).toEqual([])

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
      const reopened = page.getByRole('main')
      await expect(reopened).toContainText(receipt1 ?? '')
      await expect(reopened).toContainText(receipt2 ?? '')
      await expect(reopened.locator('[data-montant="due"]')).toContainText('0 FCFA')
      await expect(reopened.locator('[data-montant="collected"]')).toContainText('80 000 FCFA')
      await expect(reopened).toContainText('Facture de ce poste')

      // --- 5. Le serveur revient : connexion depuis l'en-tête, envoi, preuve côté serveur --------------------------
      server = await startLaravelServer(INVOICE_OFFLINE_PORT, SERVER_ENVIRONMENT)
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
      const invoiceId = invoicePath.split('/').pop() ?? ''
      const readInvoice = async (): Promise<ServerInvoice | null> => {
        const response = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
        return response.status() === 200 ? ((await response.json()) as ServerInvoice) : null
      }
      await expect.poll(async () => (await readInvoice())?.data.payments.length ?? 0).toBe(2)
      const synced = await readInvoice()
      if (synced === null)
        throw new Error('Facture introuvable sur le serveur après la synchronisation.')
      // Les pièces gardent EXACTEMENT les numéros affichés sans réseau : aucune renumérotation à la synchronisation.
      expect(synced.data.number).toBe(invoiceNumber)
      expect(synced.data.status).toBe('ISSUED')
      expect(synced.data.total_gross).toBe(80000)
      expect(synced.data.balance.paid_net).toBe(80000)
      expect(synced.data.balance.balance_due).toBe(0)
      expect(synced.data.payments.map((payment) => payment.reference).sort()).toEqual(
        [reference1, reference2].sort(),
      )
      expect(synced.data.payments.map((payment) => payment.receipt_number).sort()).toEqual(
        [receipt1, receipt2].sort(),
      )
      const invoices = await numberRange(page, deviceId, 'INVOICE')
      expect(numberValue(invoiceNumber)).toBeGreaterThanOrEqual(invoices.start)
      expect(numberValue(invoiceNumber)).toBeLessThanOrEqual(invoices.end)

      // Les ressources de ce poste sont rendues : une seule caisse hors ligne principale détient les numéros financiers.
      expect(journal.head, 'tête du journal lue dans le lot envoyé').not.toBeNull()
      const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
        headers,
        data: { password: manager.password },
      })
      expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-at37-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours de facturation sans réseau (e2e)',
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

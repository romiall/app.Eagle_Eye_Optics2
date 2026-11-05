import { readFileSync } from 'node:fs'

import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  api,
  deviceIdByCode,
  invoicePayments,
  issueInvoiceForDevice,
  navigateInApp,
  numberRange,
  numberValue,
  payAmountOffline,
  payRemainingOffline,
  prepareThisDevice,
  signIn,
  unlockVault,
} from './support/device'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'

/**
 * G1 : la tranche urgente, PERSISTANTE et REJOUABLE, sur la vraie application et un vrai profil de navigateur
 * (fichier 25, « Preuve G1 » ; AT36, AT37, AT38 ; EE021, EE022, EE042, EE045).
 *
 *  1. en ligne : la gérante prépare ce poste (coffre, enrôlement, autorisation, numéros) ; une facture de 80 000 FCFA
 *     (deux montures fictives DEMO-*) est émise pour un nouveau patient et attribuée au poste ;
 *  2. RÉSEAU COUPÉ : acompte de 30 000, puis règlement du solde de 50 000 ; deux reçus aux numéros de la plage du
 *     poste, un reste exact à chaque étape, les PDF (reçus et facture) produits sur le poste sans aucune requête hors
 *     de l'origine ; un nouveau patient est créé sur le poste ;
 *  3. le navigateur est fermé ENTIÈREMENT puis rouvert sur le MÊME répertoire de profil : le coffre se déverrouille,
 *     les pièces et leurs PDF sont retrouvés avec les mêmes numéros (le serveur ne les connaît pas encore) ;
 *  4. ACK PERDU : le serveur applique le lot mais la réponse n'atteint jamais le poste ; le poste garde tout, rejoue
 *     plusieurs fois ; le serveur ne compte chaque pièce qu'UNE fois, sans renumérotation, et la facture est soldée à
 *     80 000 sur ses numéros d'origine.
 *
 * Limites déclarées (docs/evidence/G1.md) : la facture est émise en ligne puis attribuée au poste ; la réouverture se
 * fait réseau rétabli par le coffre de la page « Poste » (le démarrage SANS réseau par l'écran public de déverrouillage
 * est prouvé par `offline-start.spec.ts`, D14 et D27) ; les collisions entre onglets, entre postes et la reprise sur un
 * poste neuf relèvent de G2. Données FICTIVES (articles DEMO-*).
 */

const VAULT_SECRET = 'verger-lagune-brume-cuivre-47'

function receiptNumbers(text: string): string[] {
  return [...new Set(text.match(/TEST-REC-\d{4}-\d{6}/g) ?? [])]
}

function syncSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="titre-synchronisation"]')
}

/** Compteurs du journal du poste lus à l'écran (« Poste » > 5. Synchronisation). */
async function journalCounters(
  page: Page,
): Promise<{ local: number; sent: number; conflicts: number }> {
  // Les compteurs se chargent après le déverrouillage : attendre leur affichage avant de les lire.
  await expect(syncSection(page)).toContainText(/pas encore envoyées : \d+/)
  const text = await syncSection(page).innerText()
  const count = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? Number.NaN)
  return {
    local: count(/pas encore envoyées : (\d+)/),
    sent: count(/en attente de confirmation : (\d+)/),
    conflicts: count(/Conflits à revoir : (\d+)/),
  }
}

/** Les trois pièces (deux encaissements, un patient) restent à confirmer : ni consolidées, ni en conflit. */
async function expectUnacknowledged(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const counters = await journalCounters(page)
      return counters.local + counters.sent
    })
    .toBe(3)
  expect((await journalCounters(page)).conflicts).toBe(0)
}

/**
 * Le profil persistant peut avoir gardé sa session : ne se connecter que si le formulaire est affiché. L'entrée
 * est `/connexion` : sur un navigateur qui a un coffre, `/` ouvrirait l'écran public de déverrouillage (D27), prouvé
 * par `offline-start.spec.ts`.
 */
async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto('/connexion')
  const home = page.getByRole('heading', { level: 1, name: /^Bonjour / })
  const login = page.getByLabel('Identifiant')
  await expect(home.or(login).first()).toBeVisible()
  if (await login.isVisible()) await signIn(page, 'MANAGER')
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

test.describe('G1 : tranche urgente persistante et rejouable (AT36 à AT38)', () => {
  test('facture de 80 000, acompte puis solde sans réseau, fermeture complète, ACK perdu puis rejoué', async () => {
    test.setTimeout(600_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = (offset: number): string =>
      `+237 600 00 ${stamp.slice(0, 2)} ${String((Number(stamp.slice(2)) + offset) % 100).padStart(2, '0')}`
    const reference1 = `MOMO-G1-A-${run}`.toUpperCase()
    const reference2 = `MOMO-G1-B-${run}`.toUpperCase()
    const profile = newProfileDirectory()
    let context = await openProfile(profile)

    try {
      let page = await context.newPage()
      await signIn(page, 'MANAGER')

      // --- 1. En ligne : poste préparé, facture de 80 000 émise et attribuée au poste ----------------------------
      const deviceCode = `G1-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Caisse G1 (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      const { invoicePath, invoiceId } = await issueInvoiceForDevice(page, {
        deviceId,
        patientName: `PATIENT G1 ${run}`,
        phone: phone(1),
        run,
        item: { search: 'DEMO-MON', option: /Monture fictive/, quantity: 2 },
      })

      await page.goto('/parametres/poste')
      await unlockVault(page, VAULT_SECRET)
      await page.getByRole('button', { name: 'Relire les ressources du serveur' }).click()
      await expect(page.getByText(/1 facture\(s\) attribuée\(s\)/)).toBeVisible()

      await navigateInApp(page, invoicePath)
      const heading = page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ })
      await expect(heading).toBeVisible()
      const invoiceNumber = (await heading.innerText()).replace(/^Facture\s+/, '').trim()
      const main = page.getByRole('main')
      await expect(main.locator('[data-montant="due"]')).toContainText('80 000 FCFA')
      await expect(page.getByRole('form', { name: 'Encaisser' })).toBeVisible()

      // --- 2. Réseau coupé : acompte 30 000, solde 50 000, PDF, nouveau patient ----------------------------------
      const appOrigin = new URL(page.url()).origin
      const foreign: string[] = []
      page.on('request', (request) => {
        const url = request.url()
        if (/^https?:/.test(url) && !url.startsWith(appOrigin)) foreign.push(url)
      })
      await context.setOffline(true)

      await payAmountOffline(page, '30 000', reference1)
      // L'écart corrigé par G1 : la facture montre l'encaissement du poste, jamais « Aucun encaissement ».
      await expect(main).not.toContainText('Aucun encaissement enregistré sur cette facture')
      await expect(main).toContainText('Reste à encaisser maintenant : 50 000 FCFA')
      await expect(main.locator('[data-montant="due"]')).toContainText('50 000 FCFA')
      await expect(main).toContainText(/en attente de synchronisation/i)
      await expect(main).not.toContainText('Consolidé sur le serveur')
      const [receipt1] = receiptNumbers(await main.innerText())
      expect(receipt1).toMatch(/^TEST-REC-\d{4}-\d{6}$/)

      await page.getByRole('button', { name: 'Nouvel encaissement' }).click()
      await payRemainingOffline(page, reference2)
      await expect(main).toContainText('Reste à encaisser maintenant : 0 FCFA')
      await expect(main.locator('[data-montant="due"]')).toContainText('0 FCFA')
      await expect(main.locator('[data-montant="collected"]')).toContainText('80 000 FCFA')
      const [first, receipt2] = receiptNumbers(await main.innerText())
      expect(first).toBe(receipt1)
      expect(receipt2).toMatch(/^TEST-REC-\d{4}-\d{6}$/)
      expect(receipt2).not.toBe(receipt1)
      expect(numberValue(receipt2 ?? '')).toBeGreaterThan(numberValue(receipt1 ?? ''))

      // PDF locaux, sans réseau : les deux reçus (acompte, puis règlement du solde) et la facture.
      await showReceiptPdf(page, receipt1 ?? '')
      await expect(main).toContainText('Acompte')
      await showReceiptPdf(page, receipt2 ?? '')
      await expect(main).toContainText('Règlement du solde')
      await main.getByRole('button', { name: 'Aperçu de la facture (PDF)' }).click()
      await expectLocalPdf(
        page,
        page.getByRole('region', { name: `Aperçu : Facture ${invoiceNumber}` }),
        /^facture-TEST-FAC-\d{4}-\d{6}\.pdf$/,
      )

      // Un nouveau patient, créé sur le poste (numéro de dossier de la plage du poste).
      await navigateInApp(page, '/patients/nouveau')
      const offlineName = `PATIENT HORS LIGNE G1 ${run}`.toUpperCase()
      await page.getByLabel('Nom (obligatoire)').fill(offlineName)
      await page.getByLabel('Prénom(s)').fill('Test')
      await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
      await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
      await page.getByLabel('Téléphone principal').fill(phone(2))
      await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
      const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
      await expect(noCheck).toContainText('le serveur n’est pas joignable (pas de connexion)')
      await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()

      await navigateInApp(page, '/parametres/poste')
      expect(await journalCounters(page)).toEqual({ local: 3, sent: 0, conflicts: 0 })
      expect(foreign, 'aucune requête hors de l’origine, PDF compris').toEqual([])

      // --- 3. Fermeture COMPLÈTE du navigateur, réouverture sur le même profil -----------------------------------
      await context.close()
      context = await openProfile(profile)
      // L'envoi du journal est maîtrisé dès la réouverture : le poste reprend seul dès que le coffre est ouvert.
      //  - « cut »      : la requête n'atteint pas le serveur (réseau coupé pour l'envoi seulement) ;
      //  - « ack-lost » : le serveur applique le lot, mais la réponse n'atteint jamais le poste ;
      //  - « open »     : tout passe.
      let pushMode: 'cut' | 'ack-lost' | 'open' = 'cut'
      // Tête du journal du poste, lue dans les lots envoyés : elle sert à rendre les ressources en fin de parcours.
      const journal: { head: { sequence: string; hash: string } | null } = { head: null }
      await context.route('**/api/v1/sync/push', async (route) => {
        const body = route.request().postDataJSON() as {
          commands?: { core: { device_sequence: string | number }; event_hash: string }[]
        } | null
        for (const command of body?.commands ?? []) {
          const sequence = String(command.core.device_sequence)
          if (journal.head === null || Number(sequence) > Number(journal.head.sequence)) {
            journal.head = { sequence, hash: command.event_hash }
          }
        }
        if (pushMode === 'open') {
          await route.continue()
          return
        }
        if (pushMode === 'ack-lost') await route.fetch()
        await route.abort('failed')
      })
      page = await context.newPage()
      await ensureSignedIn(page)
      // Coffre fermé : rien ne peut être envoyé, et le serveur ne connaît aucun des deux encaissements.
      expect(await invoicePayments(page, invoiceId)).toHaveLength(0)
      await page.goto('/parametres/poste')
      await unlockVault(page, VAULT_SECRET)
      // Persistance : les trois pièces sont retrouvées dans le coffre, aucune n'est consolidée.
      await expectUnacknowledged(page)

      // Les pièces viennent du coffre du poste (le serveur n'en sait rien) : mêmes numéros, mêmes PDF.
      expect(await invoicePayments(page, invoiceId)).toHaveLength(0)
      await navigateInApp(page, invoicePath)
      await expect(
        page.getByRole('heading', { level: 1, name: `Facture ${invoiceNumber}` }),
      ).toBeVisible()
      const reopened = page.getByRole('main')
      await expect(reopened).toContainText(receipt1 ?? '')
      await expect(reopened).toContainText(receipt2 ?? '')
      await expect(reopened).not.toContainText('Aucun encaissement enregistré sur cette facture')
      await expect(reopened.locator('[data-montant="due"]')).toContainText('0 FCFA')
      await showReceiptPdf(page, receipt2 ?? '')

      // --- 4. ACK perdu : le serveur applique le lot, la réponse n'arrive jamais ---------------------------------
      await navigateInApp(page, '/parametres/poste')
      pushMode = 'ack-lost'
      await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
      await expect(page.getByText(/Échange impossible pour le moment/).first()).toBeVisible()

      const afterLoss = await invoicePayments(page, invoiceId)
      expect(afterLoss.map((payment) => payment.reference).sort()).toEqual(
        [reference1, reference2].sort(),
      )
      // Sans ACK, le poste garde TOUT : rien n'est retiré de la file.
      await expectUnacknowledged(page)

      // Réseau rétabli : le poste rejoue (plusieurs fois), le serveur répond ALREADY_ACCEPTED, rien n'est doublé.
      pushMode = 'open'
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
        await expect(syncSection(page)).toContainText(
          'Enregistrées sur ce poste, pas encore envoyées : 0',
        )
        await expect(syncSection(page)).toContainText('Envoyées, en attente de confirmation : 0')
        await expect(syncSection(page)).toContainText('Conflits à revoir : 0')
      }
      await expect(syncSection(page)).not.toContainText('Dernier échange réussi : jamais')

      // Preuve des identifiants et des soldes sur le serveur : une occurrence par intention, numéros d'origine.
      const { request, headers } = await api(page)
      const invoiceResponse = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
      expect(invoiceResponse.status(), await invoiceResponse.text()).toBe(200)
      const invoice = (
        (await invoiceResponse.json()) as {
          data: {
            number: string
            balance: { total_gross: number; paid_net: number; balance_due: number }
            payments: { reference: string | null; receipt_number: string | null; amount: number }[]
          }
        }
      ).data
      expect(invoice.number).toBe(invoiceNumber)
      expect(invoice.balance).toMatchObject({
        total_gross: 80_000,
        paid_net: 80_000,
        balance_due: 0,
      })
      expect(invoice.payments).toHaveLength(2)
      const byReference = new Map(invoice.payments.map((payment) => [payment.reference, payment]))
      expect(byReference.get(reference1)).toMatchObject({
        amount: 30_000,
        receipt_number: receipt1,
      })
      expect(byReference.get(reference2)).toMatchObject({
        amount: 50_000,
        receipt_number: receipt2,
      })
      const receipts = await numberRange(page, deviceId, 'RECEIPT')
      for (const number of [receipt1, receipt2]) {
        expect(numberValue(number ?? '')).toBeGreaterThanOrEqual(receipts.start)
        expect(numberValue(number ?? '')).toBeLessThanOrEqual(receipts.end)
      }

      const found = (await (
        await request.get(`/api/v1/patients?query=${encodeURIComponent(offlineName)}`, { headers })
      ).json()) as { data: { record_number: string }[] }
      expect(found.data).toHaveLength(1)
      const record = found.data[0]?.record_number ?? ''
      const records = await numberRange(page, deviceId, 'PATIENT')
      expect(numberValue(record)).toBeGreaterThanOrEqual(records.start)
      expect(numberValue(record)).toBeLessThanOrEqual(records.end)

      // Rechargée sans coffre : la facture vient du serveur, mêmes numéros, solde nul, plus rien « en attente ».
      await page.goto(invoicePath)
      const consolidated = page.getByRole('main')
      await expect(
        page.getByRole('heading', { level: 1, name: `Facture ${invoiceNumber}` }),
      ).toBeVisible()
      await expect(consolidated).toContainText(receipt1 ?? '')
      await expect(consolidated).toContainText(receipt2 ?? '')
      await expect(consolidated.locator('[data-montant="due"]')).toContainText('0 FCFA')
      await expect(consolidated).not.toContainText(/en attente de synchronisation/i)

      // Les ressources de ce poste sont rendues (reprise complète) : les parcours suivants préparent leur propre
      // caisse, car une seule caisse hors ligne principale détient les numéros financiers à la fois.
      expect(journal.head, 'tête du journal lue dans les lots envoyés').not.toBeNull()
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-g1-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours G1 (e2e)',
        },
      })
      expect(released.status(), await released.text()).toBe(200)
    } finally {
      await context.close().catch(() => undefined)
      removeProfileDirectory(profile)
    }
  })
})

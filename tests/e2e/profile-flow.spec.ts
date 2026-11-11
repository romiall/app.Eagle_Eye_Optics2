import { expect, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import {
  addLocalProfile,
  createPatientOnDevice,
  deviceIdByCode,
  invoicePayments,
  invoicesOf,
  logInToServer,
  numberRange,
  numberValue,
  openFromSearch,
  patientsNamed,
  payRemainingOffline,
  prepareThisDevice,
  releaseDevice,
  signIn,
  trackJournalHead,
  unlockProfile,
} from './support/device'
import {
  deviceDatabaseMentions,
  readEntityCounts,
  readProfileCompartments,
} from './support/device-db'
import { test } from './support/test'

/**
 * P04 — parcours entre profils sur le poste principal (fichier 19 : « le flux L0 complet peut se faire sur le poste
 * principal avec changement de profil et compartiments autorisés » ; fiche 24, P04 ; AT02, AT05, AT36, AT39). Un VRAI
 * navigateur, un seul poste préparé, trois profils locaux qui se relaient SANS réseau avec leur propre secret :
 *
 *  1. la gérante prépare le poste en ligne et ajoute les profils de l'accueil, de la caisse et du professionnel ; les
 *     compartiments accordés (autorisation signée) ET les enveloppes de clés réellement stockées dans IndexedDB sont
 *     séparés : accueil → administratif ; caisse → administratif et financier ; professionnel → administratif et clinique ;
 *  2. réseau coupé, l'ACCUEIL crée un patient (numéro de dossier de la plage du poste) ; la CAISSE retrouve la même fiche,
 *     la facture, l'émet et l'encaisse (numéros de facture et de reçu de la plage du poste) ; le PROFESSIONNEL retrouve la
 *     même fiche mais n'a ni le droit ni la clé des pièces financières (aucun texte de la facture en clair dans la base) ;
 *  3. réseau revenu, le professionnel se connecte au serveur et synchronise : sa session envoie ce qu'elle sait lire (la
 *     création du patient) et NE PEUT PAS envoyer les pièces financières, que l'en-tête annonce « à envoyer à l'ouverture
 *     de leur profil » ; le serveur n'a donc ni facture ni encaissement ;
 *  4. la caisse ouvre son profil, se connecte et synchronise : les pièces financières partent, une seule fois, avec les
 *     numéros affichés sans réseau, et la reprise complète du poste est acceptée.
 *
 * Aucun parcours multiposte déconnecté n'est testé ni promis (transfert QR ou export entre deux postes : Q02 non acquise).
 * Données FICTIVES (comptes de démonstration, article DEMO-EXAMEN). Le module « offline » est ouvert par prepare-env.mjs.
 */

// Une étape qui ne trouve pas son élément échoue après une minute, pas à la fin du délai du parcours (quinze minutes).
test.use({ actionTimeout: 60_000 })

const SECRETS = {
  MANAGER: 'jonquille-ardoise-meridien-fjord-41',
  RECEPTION: 'tamaris-quartz-lagune-hibou-52',
  CASHIER: 'sureau-basalte-orient-cumin-63',
  CLINICIAN: 'mirabelle-granit-pivoine-delta-74',
} as const

/** Ligne d'état de la synchronisation du poste, dans l'en-tête de chaque écran. */
function syncStatus(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: 'Synchronisation du poste' })
}

/** Verrouille le poste (le profil se referme) : l'écran public de déverrouillage s'ouvre, sans rechargement. */
async function lockStation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Verrouiller le poste' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
  ).toBeVisible()
}

/** Entrées du menu principal. */
async function menuEntries(page: Page): Promise<string[]> {
  return page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link')
    .allInnerTexts()
}

/** Compartiments par profil ET lignes chiffrées par compartiment, lus dans la base brute du poste. */
async function storedLayout(page: Page): Promise<{
  profiles: Record<string, string[]>
  rows: Record<string, number>
}> {
  const counts = await readEntityCounts(page)
  const rows: Record<string, number> = {}
  for (const [key, count] of Object.entries(counts)) {
    const compartment = key.split(':')[0] ?? ''
    rows[compartment] = (rows[compartment] ?? 0) + count
  }
  return { profiles: await readProfileCompartments(page), rows }
}

test.describe('P04 : parcours entre profils sur le poste principal (AT02, AT05, AT36, AT39)', () => {
  test('accueil, caisse et professionnel se relaient sans réseau ; chaque pièce part avec un profil qui peut la lire', async ({
    browser,
  }) => {
    test.setTimeout(900_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const deviceContext = await browser.newContext()
    const supervisorContext = await browser.newContext()
    const journal = trackJournalHead(deviceContext)
    const page = await deviceContext.newPage()
    const supervisor = await supervisorContext.newPage()
    const deviceCode = `PRF-${run}`.toUpperCase()
    const patientName = `PATIENT PROFILS ${run}`.toUpperCase()

    try {
      // --- 1. La gérante prépare le poste et ses trois profils, en ligne ---------------------------------------------
      await signIn(page, 'MANAGER')
      await signIn(supervisor, 'MANAGER')
      await prepareThisDevice(page, {
        secret: SECRETS.MANAGER,
        code: deviceCode,
        name: `Poste principal ${run} (e2e)`,
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      const claims: Record<string, string> = {}
      for (const role of ['RECEPTION', 'CASHIER', 'CLINICIAN'] as const) {
        claims[role] = await addLocalProfile(page, role, SECRETS[role], SECRETS.MANAGER)
      }
      expect(claims['RECEPTION']).toMatch(/— ADMINISTRATIVE$/)
      expect(claims['CASHIER']).toMatch(/— ADMINISTRATIVE, FINANCIAL$/)
      expect(claims['CLINICIAN']).toMatch(/— ADMINISTRATIVE, CLINICAL$/)
      // Les enveloppes de clés réellement stockées : un profil n'a jamais la clé d'un compartiment qui n'est pas le sien.
      const beforeDay = await storedLayout(page)
      expect(beforeDay.profiles).toEqual({
        [demoAccount('MANAGER').login]: ['ADMINISTRATIVE', 'CLINICAL', 'FINANCIAL', 'MANAGER'],
        [demoAccount('RECEPTION').login]: ['ADMINISTRATIVE'],
        [demoAccount('CASHIER').login]: ['ADMINISTRATIVE', 'FINANCIAL'],
        [demoAccount('CLINICIAN').login]: ['ADMINISTRATIVE', 'CLINICAL'],
      })
      const patientRange = await numberRange(page, deviceId, 'PATIENT')
      const invoiceRange = await numberRange(page, deviceId, 'INVOICE')
      const receiptRange = await numberRange(page, deviceId, 'RECEIPT')

      // La gérante quitte : le serveur est déconnecté, le poste se verrouille, puis le réseau est coupé.
      await page.getByRole('button', { name: 'Se déconnecter' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await deviceContext.setOffline(true)

      // --- 2a. L'ACCUEIL crée le patient sur le poste ------------------------------------------------------------------
      await unlockProfile(page, demoAccount('RECEPTION').login, SECRETS.RECEPTION)
      expect(await menuEntries(page)).toEqual(['Accueil', 'Patients'])
      await createPatientOnDevice(page, {
        name: patientName,
        phone: `+237 600 08 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
        birth: '09/09/1989',
      })
      await openFromSearch(page, patientName)
      const patientPath = new URL(page.url()).pathname
      const main = page.getByRole('main')
      const record = /EE-\d{4}-\d{4,}/.exec(await main.innerText())?.[0] ?? ''
      expect(record, 'numéro de dossier affiché').toMatch(/^EE-\d{4}-\d{4,}$/)
      expect(numberValue(record)).toBeGreaterThanOrEqual(patientRange.start)
      expect(numberValue(record)).toBeLessThanOrEqual(patientRange.end)
      // L'accueil n'a pas la clé financière : aucune facture ne se prépare depuis son profil.
      await expect(page.getByRole('link', { name: 'Créer une facture' })).toHaveCount(0)
      await lockStation(page)

      // --- 2b. La CAISSE retrouve la MÊME fiche, facture, émet et encaisse ------------------------------------------------
      await unlockProfile(page, demoAccount('CASHIER').login, SECRETS.CASHIER)
      expect(await menuEntries(page)).toEqual(['Accueil', 'Patients'])
      await openFromSearch(page, patientName)
      expect(new URL(page.url()).pathname, 'même identifiant de fiche pour la caisse').toBe(
        patientPath,
      )
      expect(/EE-\d{4}-\d{4,}/.exec(await main.innerText())?.[0]).toBe(record)
      await page.getByRole('link', { name: 'Créer une facture' }).click()
      await page
        .getByRole('combobox', { name: 'Ajouter un article du catalogue' })
        .fill('DEMO-EXAMEN')
      await expect(page.getByText(/Catalogue de ce poste/).first()).toBeVisible()
      await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
      await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
      await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
      const invoicePath = new URL(page.url()).pathname
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
      expect(numberValue(invoiceNumber)).toBeGreaterThanOrEqual(invoiceRange.start)
      expect(numberValue(invoiceNumber)).toBeLessThanOrEqual(invoiceRange.end)
      await expect(main).toContainText(patientName)
      const reference = `MOMO-PRF-${run}`.toUpperCase()
      await payRemainingOffline(page, reference)
      const receiptNumber = /TEST-REC-\d{4}-\d{6}/.exec(await main.innerText())?.[0] ?? ''
      expect(receiptNumber, 'reçu pris dans la plage du poste').toMatch(/^TEST-REC-\d{4}-\d{6}$/)
      expect(numberValue(receiptNumber)).toBeGreaterThanOrEqual(receiptRange.start)
      expect(numberValue(receiptNumber)).toBeLessThanOrEqual(receiptRange.end)
      await lockStation(page)

      // --- 2c. Le PROFESSIONNEL retrouve la même fiche, sans la clé ni le droit des pièces financières ------------------
      await unlockProfile(page, demoAccount('CLINICIAN').login, SECRETS.CLINICIAN)
      expect(await menuEntries(page)).toEqual(['Accueil', 'Patients'])
      await openFromSearch(page, patientName)
      expect(new URL(page.url()).pathname, 'même identifiant de fiche pour le professionnel').toBe(
        patientPath,
      )
      expect(/EE-\d{4}-\d{4,}/.exec(await main.innerText())?.[0]).toBe(record)
      await expect(page.getByRole('link', { name: 'Créer une facture' })).toHaveCount(0)
      // La facture de la caisse ne s'ouvre pas sous ce profil.
      await page.evaluate((target) => {
        window.history.pushState({}, '', target)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, invoicePath)
      await expect(main).not.toContainText(invoiceNumber)
      await expect(main).not.toContainText(reference)
      // Et dans la base brute : les pièces financières sont chiffrées sous une clé que ce profil n'a pas ; un témoin (un
      // identifiant de connexion, en clair par conception) prouve que la recherche en clair fonctionne.
      expect(
        await deviceDatabaseMentions(page, demoAccount('CASHIER').login),
        'témoin en clair',
      ).toBe(true)
      expect(await deviceDatabaseMentions(page, invoiceNumber)).toBe(false)
      expect(await deviceDatabaseMentions(page, reference)).toBe(false)
      expect(await deviceDatabaseMentions(page, patientName)).toBe(false)
      const afterDay = await storedLayout(page)
      expect(afterDay.profiles).toEqual(beforeDay.profiles)
      // Le travail du jour ajoute des lignes administratives (la fiche) et financières (la facture), JAMAIS cliniques. (Le
      // pull de la préparation peut apporter des coquilles cliniques sans contenu, selon la base : seul l'ajout du jour compte.)
      expect(afterDay.rows['ADMINISTRATIVE'] ?? 0).toBeGreaterThan(
        beforeDay.rows['ADMINISTRATIVE'] ?? 0,
      )
      expect(afterDay.rows['FINANCIAL'] ?? 0).toBeGreaterThan(beforeDay.rows['FINANCIAL'] ?? 0)
      expect(
        afterDay.rows['CLINICAL'] ?? 0,
        'le travail du jour n’ajoute aucune ligne clinique',
      ).toBe(beforeDay.rows['CLINICAL'] ?? 0)

      // L'en-tête dit, sans réseau, ce qui attend : la pièce que ce profil sait lire, et celles d'autres profils.
      await expect(syncStatus(page)).toContainText('1 pièce en attente de synchronisation')
      await expect(syncStatus(page)).toContainText(
        '3 pièces de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante',
      )

      // --- 3. Réseau revenu, le professionnel synchronise : il envoie ce qu'il lit, rien de plus ----------------------
      await deviceContext.setOffline(false)
      await logInToServer(page, 'CLINICIAN')
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      await expect(syncStatus(page)).not.toContainText('1 pièce en attente de synchronisation')
      await expect(syncStatus(page)).toContainText(
        '3 pièces de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante',
      )
      await expect(syncStatus(page)).not.toContainText('Synchronisé le')
      // Serveur : la fiche est arrivée UNE fois, au numéro du poste ; ni facture ni encaissement.
      const named = await patientsNamed(supervisor, patientName)
      expect(named).toHaveLength(1)
      const patientId = named[0]?.id ?? ''
      expect(patientPath.endsWith(patientId), 'même identifiant côté serveur').toBe(true)
      expect(named[0]?.record_number).toBe(record)
      expect(await invoicesOf(supervisor, patientId)).toHaveLength(0)

      // --- 4. La caisse ouvre son profil et synchronise : les pièces financières partent, une seule fois ------------
      await page.getByRole('button', { name: 'Se déconnecter' }).click()
      await unlockProfile(page, demoAccount('CASHIER').login, SECRETS.CASHIER)
      await logInToServer(page, 'CASHIER')
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      await expect(syncStatus(page)).toContainText('Synchronisé le')
      await expect(syncStatus(page)).not.toContainText('en attente de synchronisation')

      const invoices = await invoicesOf(supervisor, patientId)
      expect(invoices).toHaveLength(1)
      expect(invoices[0]?.number, 'numéro affiché sans réseau, jamais renuméroté').toBe(
        invoiceNumber,
      )
      expect(invoices[0]?.status).toBe('ISSUED')
      const invoiceId = invoices[0]?.id ?? ''
      expect(invoicePath.endsWith(invoiceId)).toBe(true)
      const payments = await invoicePayments(supervisor, invoiceId)
      expect(payments).toHaveLength(1)
      expect(payments[0]?.reference).toBe(reference)
      expect(payments[0]?.receipt_number).toBe(receiptNumber)
      expect(await patientsNamed(supervisor, patientName)).toHaveLength(1)

      // La reprise complète du poste est acceptée : le journal a été reçu en entier, dans l'ordre.
      await releaseDevice(
        supervisor,
        deviceId,
        journal,
        `e2e-p04-release-${run}`,
        'Fin du parcours entre profils (e2e, P04)',
      )
    } finally {
      await deviceContext.close().catch(() => undefined)
      await supervisorContext.close().catch(() => undefined)
    }
  })
})

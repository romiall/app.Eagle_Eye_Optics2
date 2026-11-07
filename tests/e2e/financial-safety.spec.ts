import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'

import { newUlid } from '../../resources/frontend/domain/values/ulid'
import { demoAccount } from './support/accounts'
import { retireDevice } from './support/database'
import {
  api,
  deviceIdByCode,
  invoicePayments,
  issueInvoiceForDevice,
  navigateInApp,
  numberRange,
  numberValue,
  openFromSearch,
  payRemainingOffline,
  prepareThisDevice,
  receiveDirectory,
  signIn,
  unlockFromPublicScreen,
  unlockVault,
} from './support/device'
import { readDeviceDatabase } from './support/device-db'

/**
 * Gate G2 — risques financiers, concurrence et conflits, dans le VRAI navigateur (fichier 25, « Preuve G1 et G2 pas à
 * pas » ; fiche 24, G2). Les règles elles-mêmes (formules, verrous MySQL, quotas, numéros, ES256) sont prouvées par
 * PHPUnit et Vitest ; ce fichier prouve ce que seul un navigateur réel montre : la décision de la gérante sur l'écran des
 * conflits, la reprise exacte de la file du poste, deux onglets d'un même poste sur la même base IndexedDB et un
 * caissier central devant une facture détenue par un poste. Matrice complète : docs/evidence/G2.md.
 *
 *  1. AT42 : une modification de fiche faite sur le poste PUIS une autre faite au central ; à la synchronisation le
 *     serveur refuse la pièce périmée (VERSION_CONFLICT), la file du poste attend derrière le conflit (la création
 *     suivante n'est pas appliquée), la gérante décide « Garder l'état du serveur » avec un motif, la file reprend au rang
 *     suivant, une seule fois, et le central n'a jamais été écrasé ;
 *  2. AT39 : un caissier du central ne peut ni voir de formulaire d'encaissement ni encaisser une facture détenue par un
 *     poste préparé (409 WRITE_OWNER_REQUIRED) ;
 *  3. AT41 : deux onglets du même poste créent un patient en même temps, puis encaissent le même reste en même temps :
 *     numéros uniques et contigus dans la plage du poste, un seul encaissement, jamais de reste négatif ; un onglet fermé
 *     en plein commit ne laisse aucune pièce à moitié écrite.
 *
 * Données FICTIVES (comptes de démonstration, articles DEMO-*). Le module « offline » est ouvert par prepare-env.mjs.
 * Chaque parcours rend à la fin les ressources de son poste : une seule caisse hors ligne principale à la fois.
 */

// Une étape qui ne trouve pas son élément échoue après une minute, pas à la fin du délai du parcours (dix minutes).
test.use({ actionTimeout: 60_000 })

const CONFLICT_SECRET = 'ruche-ambre-falaise-minuit-72'
const TABS_SECRET = 'orchidee-sentier-brume-cobalt-83'

interface JournalHead {
  sequence: string
  hash: string
}

/** Tête du journal du poste, lue dans les lots envoyés par TOUS les onglets du contexte (pour rendre les ressources). */
function trackJournalHead(context: BrowserContext): { head: JournalHead | null } {
  const journal: { head: JournalHead | null } = { head: null }
  context.on('request', (request) => {
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
  return journal
}

/** Rend les ressources du poste (reprise complète) : la gérante se réauthentifie, puis clôture. */
async function releaseDevice(
  page: Page,
  deviceId: string,
  journal: { head: JournalHead | null },
  key: string,
): Promise<void> {
  expect(journal.head, 'tête du journal lue dans un lot envoyé').not.toBeNull()
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
      last_device_sequence: journal.head?.sequence,
      last_event_hash: journal.head?.hash,
      reason: 'Fin du parcours de sécurité financière (e2e, G2)',
    },
  })
  expect(released.status(), await released.text()).toBe(200)
}

/** Fiche créée EN LIGNE par l'écran « Nouveau patient » : une fiche du serveur, que le poste n'a jamais créée. */
async function createPatientOnline(
  page: Page,
  input: { name: string; phone: string },
): Promise<{ patientPath: string; patientId: string }> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(input.name)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
  await page.getByLabel('Téléphone principal').fill(input.phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const patientPath = new URL(page.url()).pathname
  return { patientPath, patientId: patientPath.split('/').pop() ?? '' }
}

/** Création d'un patient SANS réseau (le serveur ne peut pas vérifier les doublons : la gérante crée sans vérification). */
async function createPatientOnDevice(
  page: Page,
  input: { name: string; phone: string; birth: string },
): Promise<void> {
  await navigateInApp(page, '/patients/nouveau')
  await fillNewPatient(page, input)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await confirmCreateWithoutCheck(page)
  await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
}

async function fillNewPatient(
  page: Page,
  input: { name: string; phone: string; birth: string },
): Promise<void> {
  await page.getByLabel('Nom (obligatoire)').fill(input.name)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill(input.birth)
  await page.getByLabel('Téléphone principal').fill(input.phone)
}

async function confirmCreateWithoutCheck(page: Page): Promise<void> {
  const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
  await expect(noCheck).toContainText('le serveur n’est pas joignable (pas de connexion)')
  await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
}

/**
 * Panne simulée AU MILIEU d'un commit local : la prochaine écriture dans la table des têtes du journal (la DERNIÈRE écriture
 * de la transaction, après le curseur des numéros, la ligne du journal, son état et les entités chiffrées) lève une erreur,
 * puis le comportement normal revient. C'est la vraie base IndexedDB et le vrai code de l'application qui réagissent.
 */
function armCommitCrash(): void {
  const original = IDBObjectStore.prototype.put
  let armed = true
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
    if (armed && this.name === 'aggregate_heads') {
      armed = false
      IDBObjectStore.prototype.put = original
      throw new DOMException('Panne simulée au milieu du commit local', 'UnknownError')
    }
    return original.apply(this, args)
  }
}

/** Remplit l'encaissement du reste (mobile money) dans un onglet et rend le bouton de validation. */
async function fillRemainingPayment(page: Page, reference: string): Promise<Locator> {
  await expect(page.getByRole('form', { name: 'Encaisser' })).toBeVisible()
  await page.getByRole('button', { name: /^Encaisser le reste/ }).click()
  await page.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
  await page.getByLabel('Référence de l’opération').fill(reference)
  return page.getByRole('button', { name: /^Encaisser \d/ })
}

const failedLocally =
  'Échec de l’enregistrement sur ce poste : rien n’est enregistré ; vos saisies sont conservées.'

/** Le journal et les entités chiffrées du poste sont identiques à l'octet près à l'instantané donné. */
async function expectUnchanged(
  page: Page,
  before: Awaited<ReturnType<typeof readDeviceDatabase>>,
): Promise<void> {
  const after = await readDeviceDatabase(page)
  expect(after?.journalIds).toEqual(before?.journalIds)
  expect(after?.tables['command_journal']).toEqual(before?.tables['command_journal'])
  expect(after?.tables['encrypted_entities']).toEqual(before?.tables['encrypted_entities'])
}

/** Section « 5. Synchronisation » de la page du poste. */
function syncSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="titre-synchronisation"]')
}

/** Fiches du serveur dont le nom contient le texte (recherche de l'API). */
async function patientsNamed(
  page: Page,
  name: string,
): Promise<{ id: string; record_number: string }[]> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/patients?query=${encodeURIComponent(name)}`, {
    headers,
  })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: { id: string; record_number: string }[] }).data
}

/** Factures du serveur d'un patient (numéro et état). */
async function invoicesOf(
  page: Page,
  patientId: string,
): Promise<{ id: string; number: string; status: string }[]> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/invoices?patient_id=${patientId}`, { headers })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: { id: string; number: string; status: string }[] })
    .data
}

async function professionOf(page: Page, patientId: string): Promise<string | null> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/patients/${patientId}`, { headers })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: { profession: string | null } }).data.profession
}

test.describe('G2 : conflit de synchronisation décidé par la gérante (AT42)', () => {
  test('modification périmée : la file du poste attend la décision, puis reprend une seule fois sans écraser le serveur', async ({
    browser,
  }) => {
    test.setTimeout(600_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const deviceContext = await browser.newContext()
    const centralContext = await browser.newContext()
    const journal = trackJournalHead(deviceContext)
    const page = await deviceContext.newPage()
    const central = await centralContext.newPage()
    const manager = demoAccount('MANAGER')
    const deviceName = `Poste conflit ${run} (e2e)`
    const deviceCode = `CFL-${run}`.toUpperCase()
    let released = false

    try {
      // --- 1. En ligne : une fiche du SERVEUR, le poste préparé, l'annuaire reçu --------------------------------------
      await signIn(page, 'MANAGER')
      const sharedName = `PATIENT CONFLIT ${run}`.toUpperCase()
      const { patientPath, patientId } = await createPatientOnline(page, {
        name: sharedName,
        phone: `+237 600 02 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
      })
      await prepareThisDevice(page, { secret: CONFLICT_SECRET, code: deviceCode, name: deviceName })
      const deviceId = await deviceIdByCode(page, deviceCode)
      await navigateInApp(page, '/')
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await receiveDirectory(page)

      // --- 2. Sans réseau : le poste modifie la fiche (version reçue), crée une autre fiche, puis facture et encaisse ---
      await deviceContext.setOffline(true)
      await openFromSearch(page, sharedName)
      await page.getByRole('link', { name: 'Modifier' }).click()
      await page.getByLabel('Profession').fill('Opticienne')
      await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
      const followingName = `PATIENT SUIVANT ${run}`.toUpperCase()
      await createPatientOnDevice(page, {
        name: followingName,
        phone: `+237 600 03 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
        birth: '12/06/1990',
      })
      // Puis, pour la fiche du serveur, une facture du poste (catalogue figé) émise et encaissée : trois pièces de plus,
      // dont deux FINANCIÈRES, placées derrière le conflit dans le journal.
      await navigateInApp(page, patientPath)
      await page.getByRole('link', { name: 'Créer une facture' }).click()
      await expect(page).toHaveURL(new RegExp(`/ventes/factures/nouvelle\\?patient=${patientId}$`))
      await page
        .getByRole('combobox', { name: 'Ajouter un article du catalogue' })
        .fill('DEMO-EXAMEN')
      await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
      await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
      await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
      await page.getByRole('button', { name: 'Émettre la facture' }).click()
      await page
        .getByRole('dialog', { name: 'Émettre la facture ?' })
        .getByRole('button', { name: 'Émettre la facture' })
        .click()
      const invoiceHeading = page.getByRole('heading', {
        level: 1,
        name: /^Facture TEST-FAC-\d{4}-\d{6}$/,
      })
      await expect(invoiceHeading).toBeVisible()
      const invoiceNumber = (await invoiceHeading.innerText()).replace(/^Facture\s+/, '').trim()
      const reference = `MOMO-CFL-${run}`.toUpperCase()
      await payRemainingOffline(page, reference)

      // --- 3. Pendant ce temps, au central : la même fiche est modifiée (version suivante) --------------------------
      await signIn(central, 'MANAGER')
      await central.goto(patientPath)
      await central.getByRole('link', { name: 'Modifier' }).click()
      await central.getByLabel('Profession').fill('Comptable')
      await central.getByRole('button', { name: 'Enregistrer les modifications' }).click()
      await expect.poll(() => professionOf(central, patientId)).toBe('Comptable')

      // --- 4. Réseau rétabli : le serveur refuse la pièce périmée, la file attend derrière le conflit ---------------
      await deviceContext.setOffline(false)
      await navigateInApp(page, '/parametres/poste')
      const sync = syncSection(page)
      await expect(sync).toBeVisible()
      await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
      await expect(sync).toContainText('Conflits à revoir : 1')
      const issues = sync.getByRole('region', { name: 'Pièces à revoir' })
      await expect(issues).toContainText('Modification d’un patient')
      await expect(issues).toContainText('Conflit à revoir par la gérante')
      await expect(issues).toContainText('la pièce locale est conservée')
      // Le central n'est PAS écrasé et la création suivante (rang N+1) n'est pas appliquée derrière le conflit (rang N).
      expect(await professionOf(central, patientId)).toBe('Comptable')
      expect(await patientsNamed(central, followingName)).toHaveLength(0)
      // Aucun fait financier n'est appliqué tant que la gérante n'a pas décidé : ni la facture ni son encaissement.
      expect(await invoicesOf(central, patientId)).toHaveLength(0)

      // --- 5. La gérante décide, sur l'écran des conflits : garder l'état du serveur, motif conservé ----------------
      await central.goto('/parametres/conflits-synchronisation')
      const conflict = central
        .getByRole('listitem')
        .filter({ hasText: deviceName })
        .filter({ hasText: 'Modification d’un patient' })
      await expect(conflict).toHaveCount(1)
      await expect(conflict).toContainText('VERSION_CONFLICT')
      await conflict.getByRole('button', { name: 'Décider' }).click()
      await conflict
        .getByLabel('Décision', { exact: true })
        .selectOption({ label: 'Garder l’état du serveur (la pièce du poste n’est pas appliquée)' })
      const reason = `Fiche déjà corrigée au secrétariat (e2e ${run})`
      await conflict.getByLabel('Motif (obligatoire, conservé avec la décision)').fill(reason)
      await conflict.getByRole('button', { name: 'Enregistrer la décision' }).click()
      const passwordDialog = central.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
      const asked = await passwordDialog
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (asked) {
        await passwordDialog.getByLabel('Mot de passe').fill(manager.password)
        await passwordDialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
      }
      await expect(conflict).toHaveCount(0)

      // La file a repris au rang suivant, APRÈS la décision et sans attendre le poste : une seule fiche, du poste.
      await expect.poll(async () => (await patientsNamed(central, followingName)).length).toBe(1)
      await expect.poll(async () => (await invoicesOf(central, patientId)).length).toBe(1)
      expect(await professionOf(central, patientId)).toBe('Comptable')

      // La décision est conservée avec son motif, sur l'onglet « Résolus ».
      await central.getByRole('button', { name: 'Résolus' }).click()
      const resolved = central
        .getByRole('listitem')
        .filter({ hasText: deviceName })
        .filter({ hasText: 'Modification d’un patient' })
      await expect(resolved).toContainText(
        'Décision : Garder l’état du serveur (la pièce du poste n’est pas appliquée)',
      )
      await expect(resolved).toContainText(reason)

      // --- 6. Le poste apprend l'issue : plus rien en attente, le conflit est « rejeté après revue », la pièce locale reste
      await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
      await expect(sync).toContainText('Conflits à revoir : 0')
      await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
      await expect(sync).toContainText('Enregistrées sur ce poste, pas encore envoyées : 0')
      await expect(sync.getByRole('region', { name: 'Pièces à revoir' })).toContainText(
        'Rejeté après revue',
      )

      // Un échange de plus n'ajoute rien : toujours UNE fiche, numérotée dans la plage du poste, jamais renumérotée.
      await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
      await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
      const following = await patientsNamed(central, followingName)
      expect(following).toHaveLength(1)
      const records = await numberRange(page, deviceId, 'PATIENT')
      const record = numberValue(following[0]?.record_number ?? '')
      expect(record).toBeGreaterThanOrEqual(records.start)
      expect(record).toBeLessThanOrEqual(records.end)
      expect(await professionOf(central, patientId)).toBe('Comptable')
      // La facture et l'encaissement du poste sont appliqués UNE fois, dans l'ordre, avec les numéros de la plage du poste
      // (le numéro affiché sans réseau est celui du serveur : jamais renuméroté).
      const invoices = await invoicesOf(central, patientId)
      expect(invoices).toHaveLength(1)
      expect(invoices[0]?.number).toBe(invoiceNumber)
      expect(invoices[0]?.status).toBe('ISSUED')
      const invoiceRange = await numberRange(page, deviceId, 'INVOICE')
      expect(numberValue(invoiceNumber)).toBeGreaterThanOrEqual(invoiceRange.start)
      expect(numberValue(invoiceNumber)).toBeLessThanOrEqual(invoiceRange.end)
      const payments = await invoicePayments(central, invoices[0]?.id ?? '')
      expect(payments).toHaveLength(1)
      expect(payments[0]?.reference).toBe(reference)
      const receipts = await numberRange(page, deviceId, 'RECEIPT')
      const receipt = numberValue(payments[0]?.receipt_number ?? '')
      expect(receipt).toBeGreaterThanOrEqual(receipts.start)
      expect(receipt).toBeLessThanOrEqual(receipts.end)

      await releaseDevice(central, deviceId, journal, `e2e-g2-conflict-release-${run}`)
      released = true
    } finally {
      if (!released) retireDevice(deviceCode)
      await deviceContext.close().catch(() => undefined)
      await centralContext.close().catch(() => undefined)
    }
  })
})

test.describe('G2 : facture détenue par un poste et deux onglets du même poste (AT39, AT41)', () => {
  test('caissier central refusé sur une facture détenue ; deux onglets : numéros uniques, un seul encaissement', async ({
    browser,
  }) => {
    test.setTimeout(600_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const deviceContext = await browser.newContext()
    const centralContext = await browser.newContext()
    const journal = trackJournalHead(deviceContext)
    const tab1 = await deviceContext.newPage()
    const cashier = await centralContext.newPage()
    const deviceCode = `ONG-${run}`.toUpperCase()
    let released = false

    try {
      // --- 1. Poste préparé ; facture de 60 000 émise EN LIGNE puis attribuée à ce poste -----------------------------
      await signIn(tab1, 'MANAGER')
      await prepareThisDevice(tab1, {
        secret: TABS_SECRET,
        code: deviceCode,
        name: `Poste onglets ${run} (e2e)`,
      })
      const deviceId = await deviceIdByCode(tab1, deviceCode)
      const { invoicePath, invoiceId } = await issueInvoiceForDevice(tab1, {
        deviceId,
        patientName: `FACTURE ONGLETS ${run}`,
        phone: `+237 600 04 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
        run,
        item: { search: 'DEMO-EXA', option: /Examen de vue \(fictif\)/, quantity: 4 },
      })
      await tab1.goto('/parametres/poste')
      await unlockVault(tab1, TABS_SECRET)
      await tab1.getByRole('button', { name: 'Relire les ressources du serveur' }).click()
      await expect(tab1.getByText(/1 facture\(s\) attribuée\(s\)/)).toBeVisible()

      // --- 2. AT39 : le caissier du central ne peut pas encaisser une facture détenue par un poste --------------------
      await signIn(cashier, 'CASHIER')
      await cashier.goto(invoicePath)
      await expect(
        cashier.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ }),
      ).toBeVisible()
      await expect(
        cashier.getByText(/l’encaissement se fait sur ce poste, pas depuis cet écran/),
      ).toBeVisible()
      await expect(cashier.getByRole('form', { name: 'Encaisser' })).toHaveCount(0)
      const { request: cashierRequest, headers: cashierHeaders } = await api(cashier)
      const detail = await cashierRequest.get(`/api/v1/invoices/${invoiceId}`, {
        headers: cashierHeaders,
      })
      expect(detail.status(), await detail.text()).toBe(200)
      const ledgerVersion = ((await detail.json()) as { data: { ledger_version: number } }).data
        .ledger_version
      const refused = await cashierRequest.post(`/api/v1/invoices/${invoiceId}/payments`, {
        headers: { ...cashierHeaders, 'Idempotency-Key': `e2e-g2-central-pay-${run}` },
        data: {
          expected_version: ledgerVersion,
          invoice_id: invoiceId,
          payment_id: newUlid(),
          receipt_id: newUlid(),
          receipt_number_usage_id: newUlid(),
          receipt_number: null,
          amount: 10_000,
          currency: 'XAF',
          method: 'MTN_MOMO',
          reference: `CENTRAL-REFUSE-${run}`.toUpperCase(),
          effective_at: new Date().toISOString(),
          cash_session_id: null,
          retroactive_reason: null,
          receipt_document_id: newUlid(),
        },
      })
      expect(refused.status(), await refused.text()).toBe(409)
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'WRITE_OWNER_REQUIRED',
      )
      const afterRefusal = await cashierRequest.get(`/api/v1/invoices/${invoiceId}`, {
        headers: cashierHeaders,
      })
      expect(
        ((await afterRefusal.json()) as { data: { payments: unknown[] } }).data.payments,
      ).toHaveLength(0)

      // --- 3. AT41 : deux onglets du MÊME poste. Une seule session de coffre écrit à la fois (D11) : le dernier ------------
      //        déverrouillage reprend la main ; le premier onglet devient périmé et ses commits sont refusés.
      const references = [`MOMO-A-${run}`.toUpperCase(), `MOMO-B-${run}`.toUpperCase()]
      const saved =
        'Encaissement enregistré sur ce poste, en attente de synchronisation avec le serveur.'
      await navigateInApp(tab1, invoicePath)
      await expect(tab1.getByRole('form', { name: 'Encaisser' })).toBeVisible()
      // L'onglet 1 passe à l'arrière-plan (une autre fenêtre est au premier plan) : il ne contrôle pas sa session.
      await tab1.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
      })
      const tab2 = await deviceContext.newPage()
      await tab2.goto('/parametres/poste')
      await unlockVault(tab2, TABS_SECRET)
      await navigateInApp(tab2, invoicePath)
      await deviceContext.setOffline(true)
      const submitStale = await fillRemainingPayment(tab1, references[0] ?? '')
      const submitLive = await fillRemainingPayment(tab2, references[1] ?? '')

      // (a) L'onglet périmé est refusé net : rien n'est annoncé, rien n'est écrit (journal et entités à l'octet près).
      const initial = await readDeviceDatabase(tab2)
      expect(
        initial?.journalIds,
        'aucune commande sur ce poste avant les encaissements',
      ).toHaveLength(0)
      await submitStale.click()
      await expect(tab1.getByRole('main')).toContainText(failedLocally)
      await expect(tab1.getByRole('main')).not.toContainText(saved)
      await expectUnchanged(tab2, initial)

      // (b) Panne simulée AU MILIEU du commit de l'onglet qui a la main (dernière écriture de la transaction) : rien n'est
      //     annoncé, rien n'est écrit, aucun numéro de reçu n'est consommé.
      await tab2.evaluate(armCommitCrash)
      await submitLive.click()
      await expect(tab2.getByRole('main')).toContainText(failedLocally)
      await expect(tab2.getByRole('main')).not.toContainText(saved)
      await expectUnchanged(tab2, initial)

      // (c) Les deux onglets encaissent le MÊME reste en même temps : seul l'onglet qui a la main est enregistré, avec la
      //     saisie reprise après la panne (même intention, une seule occurrence).
      await Promise.all([submitStale.click(), submitLive.click()])
      await expect(tab2.getByRole('main')).toContainText(saved)
      await expect(tab1.getByRole('main')).not.toContainText(saved)
      expect((await readDeviceDatabase(tab2))?.journalIds).toHaveLength(1)

      // (d) Numéros : l'onglet 2 crée un fiche ; l'onglet 1 reprend la main (nouveau déverrouillage) et en crée une autre :
      //     deux numéros distincts, les deux premiers de la plage, sans trou ni réemploi.
      // Un seul mot par nom : la recherche de l'API est par mots, « A » et « B » ne distingueraient pas les deux fiches.
      const names = [`ONGLETA${run}`.toUpperCase(), `ONGLETB${run}`.toUpperCase()]
      await createPatientOnDevice(tab2, {
        name: names[1] ?? '',
        phone: `+237 600 06 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
        birth: '22/02/1992',
      })
      await tab1.goto('/')
      await expect(tab1).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await unlockFromPublicScreen(tab1, TABS_SECRET)
      await expect(tab1.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await createPatientOnDevice(tab1, {
        name: names[0] ?? '',
        phone: `+237 600 05 ${stamp.slice(0, 2)} ${stamp.slice(2)}`,
        birth: '21/01/1991',
      })

      // --- 4. Réseau rétabli : tout part, rien n'est dupliqué, les numéros restent dans la plage du poste -------------
      await deviceContext.setOffline(false)
      await navigateInApp(tab1, '/parametres/poste')
      await tab1.getByRole('button', { name: 'Synchroniser maintenant' }).click()
      const sync = syncSection(tab1)
      await expect(sync).toContainText('Conflits à revoir : 0')
      await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
      await expect(sync).toContainText('Enregistrées sur ce poste, pas encore envoyées : 0')

      const { request, headers } = await api(tab1)
      const [patientA, patientB] = await Promise.all(names.map((name) => patientsNamed(tab1, name)))
      expect(patientA).toHaveLength(1)
      expect(patientB).toHaveLength(1)
      const records = await numberRange(tab1, deviceId, 'PATIENT')
      // Dans l'ordre des commits : l'onglet 2 d'abord, puis l'onglet 1 ; les deux premiers numéros de la plage, sans trou.
      expect(numberValue(patientB?.[0]?.record_number ?? '')).toBe(records.start)
      expect(numberValue(patientA?.[0]?.record_number ?? '')).toBe(records.start + 1)

      const invoiceResponse = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
      const invoice = (await invoiceResponse.json()) as {
        data: {
          payments: { reference: string | null; receipt_number: string | null }[]
          balance: { paid_net: number; balance_due: number; settlement: string }
        }
      }
      const payments = invoice.data.payments
      expect(payments).toHaveLength(1)
      expect(payments[0]?.reference).toBe(references[1])
      // Jamais de reste négatif : une seule fois 60 000, soldé par UN encaissement.
      expect(invoice.data.balance).toMatchObject({
        paid_net: 60_000,
        balance_due: 0,
        settlement: 'SETTLED',
      })
      const receipts = await numberRange(tab1, deviceId, 'RECEIPT')
      // Le premier numéro de la plage : ni l'onglet périmé ni la panne simulée n'en ont consommé un.
      expect(numberValue(payments[0]?.receipt_number ?? '')).toBe(receipts.start)

      await releaseDevice(tab1, deviceId, journal, `e2e-g2-tabs-release-${run}`)
      released = true
    } finally {
      if (!released) retireDevice(deviceCode)
      await deviceContext.close().catch(() => undefined)
      await centralContext.close().catch(() => undefined)
    }
  })
})

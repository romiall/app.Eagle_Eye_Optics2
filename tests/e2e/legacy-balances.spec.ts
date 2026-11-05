import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Reprise des créances papier (X01, AT26) EN LIGNE sur la vraie application : la gérante dépose le scan
 * de la pièce papier, saisit une créance (80 000 dont 30 000 déjà réglés), voit « Reste dû repris :
 * 50 000 FCFA », la fait vérifier puis reprendre par le serveur, ouvre la pièce TEST-REP-… ; la caisse
 * encaisse ensuite 20 000 avec un reçu et il reste 30 000 à encaisser. Jamais « payé », « soldé » ni
 * « acquitté ». Patient, référence et scan FICTIFS.
 */

const FORBIDDEN = ['payé', 'payée', 'soldé', 'soldée', 'acquitté', 'acquittée', 'gratuit']

/** Premiers octets d'un JPEG : le serveur reconnaît le type à la signature, pas au nom du fichier. */
const SCAN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('scan-fictif-e2e')])

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Fiche créée par l'accueil, avec un téléphone propre à ce fichier (base partagée par l'exécution). */
async function createPatient(browser: Browser, lastName: string, phone: string): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, 'RECEPTION')
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/03/1985')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  await context.close()
}

async function ensureCashOpen(page: Page): Promise<void> {
  await page.goto('/ventes/caisse')
  const main = page.getByRole('main')
  await expect(
    main.getByText(/Session ouverte|Aucune session de caisse ouverte/).first(),
  ).toBeVisible()
  if (await main.getByText('Aucune session de caisse ouverte').isVisible()) {
    await page.getByLabel('Fond de caisse').fill('10 000')
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click()
  }
  await expect(main.getByRole('heading', { level: 2, name: /^Session ouverte/ })).toBeVisible()
}

/**
 * Réponses du dépôt du justificatif et de la confirmation du mot de passe, avec le corps d'une erreur : sans elles, un échec
 * en CI ne dit pas ce que le serveur a répondu.
 */
function recordCalls(page: Page): string[] {
  const calls: string[] = []
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (!path.endsWith('/legacy-balances/evidence') && !path.endsWith('/auth/reauthenticate'))
      return
    const entry = `${response.request().method()} ${path.split('/').slice(-2).join('/')} ${response.status()}`
    if (response.status() < 400) {
      calls.push(entry)
      return
    }
    void response
      .text()
      .then((body) => calls.push(`${entry} ${body.replace(/\s+/g, ' ').slice(0, 200)}`))
      .catch(() => calls.push(entry))
  })
  return calls
}

/** Réauthentification (423) éventuelle : confirme le mot de passe de la gérante, puis attend le succès. */
async function confirmPasswordIfAsked(
  page: Page,
  success: Locator,
  calls: readonly string[] = [],
): Promise<boolean> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  await expect(dialog.or(success).first()).toBeVisible()
  if (!(await dialog.isVisible())) return false
  await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
  await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
  // La confirmation est terminée (session à jour) avant toute reprise : le dépôt suivant ne part pas avec l'ancienne session.
  try {
    await expect(dialog).toBeHidden()
  } catch (error) {
    const shown = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(
      `Confirmation du mot de passe non terminée. Appels : [${calls.join(' ; ')}]. Boîte : ${shown}`,
      { cause: error },
    )
  }
  return true
}

test.describe('reprise des créances papier (X01) sur la vraie application', () => {
  test('justificatif, une créance, vérification, reprise, puis encaissement du reste dû', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    await createPatient(browser, 'Carnet Reprise', '+237 600 00 10 03')
    // La base e2e est réutilisée d'une exécution à l'autre : une référence papier ne se reprend qu'une fois.
    const reference = `E2E-CARNET-${Date.now()}`

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'MANAGER')
    await page.goto('/ventes/catalogue/import')
    const section = page.getByRole('region', { name: 'Créances papier' })
    await expect(section).toBeVisible()

    // 1. Le scan : déposé tel quel ; après une réauthentification, le fichier est à choisir de nouveau.
    const scanInput = page.getByLabel('Scan de la pièce ou de la page du carnet (PDF, JPEG ou PNG)')
    const scan = { name: 'carnet-fictif.jpg', mimeType: 'image/jpeg', buffer: SCAN }
    const kept = section.getByText(/Justificatif conservé sur le serveur/)
    // Diagnostic en cas d'échec : réponses du dépôt et de la confirmation, et texte de la section.
    const calls = recordCalls(page)
    await scanInput.setInputFiles(scan)
    if (await confirmPasswordIfAsked(page, kept, calls)) await scanInput.setInputFiles(scan)
    try {
      await expect(kept).toBeVisible()
    } catch (error) {
      const text = (await section.innerText()).replace(/\s+/g, ' ').slice(0, 500)
      throw new Error(
        `Justificatif non conservé. Appels : [${calls.join(' ; ')}]. Section : ${text}`,
        {
          cause: error,
        },
      )
    }

    // 2. Une créance : patient retrouvé par la recherche, reste dû calculé sur le poste.
    await page.getByRole('combobox', { name: 'Patient' }).fill('Carnet Reprise')
    await page
      .getByRole('option', { name: /Carnet Reprise/ })
      .first()
      .click()
    await page.getByLabel('Référence de la pièce papier').fill(reference)
    await page.getByLabel('Total de la pièce papier (FCFA)').fill('80 000')
    await page.getByLabel('Total de la pièce papier (FCFA)').blur()
    await page.getByLabel('Déjà réglé sur papier (FCFA)').fill('30 000')
    await page.getByLabel('Déjà réglé sur papier (FCFA)').blur()
    await expect(section).toContainText('Reste dû repris : 50 000 FCFA')

    // 3. Vérification sans écriture, puis reprise (tout ou rien).
    await section.getByRole('button', { name: 'Vérifier sur le serveur' }).click()
    const checked = section.getByText('Créances vérifiées par le serveur')
    await confirmPasswordIfAsked(page, checked, calls)
    await expect(checked).toBeVisible()
    await section.getByRole('button', { name: /^Reprendre 1 créance/ }).click()
    const done = section.getByText('Créances reprises')
    await confirmPasswordIfAsked(page, done, calls)
    await expect(done).toBeVisible()
    const sectionText = (await section.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(sectionText, word).not.toContain(word)

    await section.getByRole('link', { name: 'Ouvrir la pièce 1 et encaisser le reste dû' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const invoiceUrl = new URL(page.url()).pathname
    await expect(page.getByRole('heading', { level: 1, name: /TEST-REP-/ })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Reste à encaisser : 50 000 FCFA')
    await context.close()

    // Le reste dû s'encaisse comme une facture : un reçu, 30 000 encore à encaisser.
    const cashierContext = await browser.newContext()
    const cashier = await cashierContext.newPage()
    await signIn(cashier, 'CASHIER')
    await ensureCashOpen(cashier)
    await cashier.goto(invoiceUrl)
    const main = cashier.getByRole('main')
    await expect(main).toContainText('Reste à encaisser : 50 000 FCFA')
    await cashier.getByLabel('Montant encaissé').fill('20 000')
    await cashier.getByLabel('Montant encaissé').blur()
    await cashier.getByLabel('Mode de règlement').selectOption({ label: 'Espèces' })
    await cashier.getByRole('button', { name: /^Encaisser \d/ }).click()
    await expect(main).toContainText('Encaissement enregistré sur le serveur')
    await expect(main).toContainText('Reste à encaisser maintenant : 30 000 FCFA')
    await expect(main).toContainText(/TEST-REC-\d{4}-\d{6}/)
    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word)
    await cashierContext.close()
  })
})

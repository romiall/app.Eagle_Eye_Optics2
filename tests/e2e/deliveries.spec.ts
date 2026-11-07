import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Remise au patient et retour physique EN LIGNE sur la vraie application (I01, I02, AT15 à AT17) : la caisse facture deux
 * montures fictives, émet, encaisse la totalité, remet une monture, puis la seconde (remise partielle puis totale) ;
 * la gérante enregistre ensuite le retour d'une monture intacte, remise en stock vendable, sans avoir. Jamais
 * « payé », « soldé » ni « acquitté ». Articles DEMO-* et stock FICTIFS (`eeo:demo:sales`).
 */

const FORBIDDEN = ['payé', 'payée', 'soldé', 'soldée', 'acquitté', 'acquittée', 'gratuit']

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function createPatient(browser: Browser, lastName: string, phone: string): Promise<string> {
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
  const url = new URL(page.url()).pathname
  await context.close()
  return url
}

async function ensureCashOpen(page: Page): Promise<void> {
  await page.goto('/ventes/caisse')
  await expect(page.getByRole('heading', { level: 1, name: 'Caisse' })).toBeVisible()
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

async function confirmPasswordIfAsked(page: Page, success: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  await expect(dialog.or(success).first()).toBeVisible()
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
    await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
  }
  await expect(success.first()).toBeVisible()
}

test.describe('remise au patient et retour (I01, I02) sur la vraie application', () => {
  test('facture émise → remise partielle → remise du reste → retour remis en stock', async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const patientPath = await createPatient(browser, 'Remise Parcours', '+237 600 00 09 19')

    // 1. La caisse facture deux montures, émet et encaisse la totalité.
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    await ensureCashOpen(page)
    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    const main = page.getByRole('main')
    await page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }).fill('DEMO-MON')
    await page.getByRole('option', { name: /Monture fictive/ }).click()
    await page.getByLabel(/^Quantité \(/).fill('2')
    await page.getByLabel(/^Quantité \(/).blur()
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Émettre la facture' }).click()
    await page
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    await expect(
      page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    const invoicePath = new URL(page.url()).pathname
    await page.getByRole('button', { name: /^Encaisser le reste/ }).click()
    await page.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
    await page.getByLabel('Référence de l’opération').fill('REFERENCE-FICTIVE-REMISE')
    await page.getByRole('button', { name: /^Encaisser \d/ }).click()
    await expect(main).toContainText('Reste à encaisser maintenant : 0 FCFA')

    // 2. Remise partielle : une monture sur deux.
    const section = main.locator('section[aria-labelledby="titre-remises"]')
    await expect(section).toContainText('reste à remettre 2')
    await section.getByRole('button', { name: 'Remettre au patient' }).click()
    await section.getByLabel(/^Quantité remise/).fill('1')
    await section.getByRole('button', { name: 'Confirmer la remise' }).click()
    await expect(section).toContainText('Remise enregistrée sur le serveur')
    await expect(section).toContainText('reste à remettre 1')

    // 3. Remise du reste : la quantité proposée est le reste.
    await section.getByRole('button', { name: 'Remettre au patient' }).click()
    await expect(section.getByLabel(/^Quantité remise/)).toHaveValue('1')
    await section.getByRole('button', { name: 'Confirmer la remise' }).click()
    await expect(section).toContainText('Tous les articles sont remis')
    await expect(section.getByRole('button', { name: 'Remettre au patient' })).toHaveCount(0)

    // Rechargement : les deux remises viennent du serveur.
    await page.reload()
    await expect(section).toContainText('Remises enregistrées')
    await expect(section).toContainText('Tous les articles sont remis')
    const cashierText = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(cashierText, word).not.toContain(word)
    await context.close()

    // 4. La gérante enregistre le retour d'une monture intacte, remise en stock vendable, sans avoir.
    const managerContext = await browser.newContext()
    const manager = await managerContext.newPage()
    await signIn(manager, 'MANAGER')
    await manager.goto(invoicePath)
    const managerSection = manager
      .getByRole('main')
      .locator('section[aria-labelledby="titre-remises"]')
    await managerSection
      .getByRole('button', { name: /^Enregistrer un retour/ })
      .first()
      .click()
    await managerSection.getByLabel('Quantité retournée').fill('1')
    await managerSection.getByLabel('État constaté').selectOption({ label: 'Intact, vendable' })
    await managerSection.getByLabel('Remettre en stock vendable').check()
    await managerSection
      .getByLabel('Motif (obligatoire)')
      .fill('Monture ne convenant pas, rapportée intacte (fictif)')
    await managerSection.getByRole('button', { name: 'Enregistrer le retour' }).click()
    await confirmPasswordIfAsked(
      manager,
      managerSection.getByText(/Retour de 1 enregistré sur le serveur/),
    )
    await expect(managerSection).toContainText('remis en stock vendable')
    await expect(manager.getByRole('main')).not.toContainText('TEST-AV-')
    await managerContext.close()
  })
})

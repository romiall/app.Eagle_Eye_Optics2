import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Rapprochements par canal et export comptable Q13 (L1D06) EN LIGNE sur la vraie application :
 * 1) Une facture émise et encaissée par Mobile money MTN est disponible côté serveur.
 * 2) La gérante ouvre « Ventes et caisse » -> « Rapprochements par canal », charge l’attendu serveur,
 *    pointe l’écriture, ajoute une ligne de frais (-500), dépose le relevé justificatif (avec 423 si demandé),
 *    saisit le total du relevé et le motif d’écart, valide définitivement et obtient un état figé.
 * 3) Depuis « Finance du cabinet », elle prévisualise Q13 et télécharge le CSV comptable (200 text/csv).
 */

const FORBIDDEN = ['payé', 'payée', 'soldé', 'soldée', 'acquitté', 'acquittée', 'gratuit']

const SCAN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('releve-momo-e2e')])

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
  await page.getByLabel('Prénom(s)').fill('Rapprochement')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('14/05/1990')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const url = new URL(page.url()).pathname
  await context.close()
  return url
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

async function confirmPasswordIfAsked(page: Page, success: Locator): Promise<boolean> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  await expect(dialog.or(success).first()).toBeVisible()
  if (!(await dialog.isVisible())) return false
  await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
  await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
  await expect(dialog).toBeHidden()
  return true
}

test.describe('rapprochements par canal et export comptable Q13 (L1D06)', () => {
  test('pointage MTN MoMo, relevé, validation 423 figée, puis export CSV Q13', async ({
    browser,
  }) => {
    test.setTimeout(360_000)
    const patientPath = await createPatient(browser, 'Rapprochement MoMo', '+237 600 00 10 99')
    const momoRef = `E2E-MOMO-${Date.now()}`

    // 1. Caisse : émission + règlement MTN MoMo
    const cashierCtx = await browser.newContext()
    const cashier = await cashierCtx.newPage()
    await signIn(cashier, 'CASHIER')
    await ensureCashOpen(cashier)
    await cashier.goto(patientPath)
    await cashier.getByRole('link', { name: 'Créer une facture' }).click()
    await cashier
      .getByRole('combobox', { name: 'Ajouter un article du catalogue' })
      .fill('DEMO-EXA')
    await cashier.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
    await cashier.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await cashier.getByRole('button', { name: 'Émettre la facture' }).click()
    await cashier
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    await expect(
      cashier.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ }),
    ).toBeVisible()
    await cashier.getByRole('button', { name: /^Encaisser le reste/ }).click()
    await cashier.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
    await cashier.getByLabel('Référence de l’opération').fill(momoRef)
    await cashier.getByRole('button', { name: /^Encaisser \d/ }).click()
    await expect(cashier.getByRole('main')).toContainText('Reste à encaisser maintenant : 0 FCFA')
    await cashierCtx.close()

    // 2. Gérante : rapprochement du canal Mobile money MTN
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'MANAGER')
    await page.goto('/ventes')
    await page.getByRole('link', { name: 'Rapprochements par canal' }).click()
    await expect(page).toHaveURL(/\/ventes\/rapprochement$/)

    const main = page.getByRole('main')
    await main.getByLabel('Canal de paiement', { exact: true }).selectOption('MTN_MOMO')
    await main.getByRole('button', { name: 'Charger les écritures attendues' }).click()

    const candidateRow = main.locator('li', { hasText: momoRef })
    await expect(candidateRow).toBeVisible()
    await candidateRow.getByRole('button', { name: 'Pointer' }).click()

    // Saisir le justificatif du relevé (423 possible)
    const scanInput = main.getByLabel('Justificatif du relevé (PDF, JPEG ou PNG)', { exact: true })
    const scan = { name: 'releve-momo.jpg', mimeType: 'image/jpeg', buffer: SCAN }
    const kept = main.getByText(/Relevé conservé/)
    await scanInput.setInputFiles(scan)
    if (await confirmPasswordIfAsked(page, kept)) {
      await scanInput.setInputFiles(scan)
    }
    await expect(kept).toBeVisible()

    // Calcul du net attendu affiché, saisie d'un écart -500 avec ligne manuelle + motif
    const expectedText = await main.locator('[data-montant="rec-attendu"]').innerText()
    const expectedNum = Number(expectedText.replace(/[^0-9-]/g, ''))
    expect(expectedNum).toBeGreaterThan(500)
    const statementNum = expectedNum - 500

    await main.locator('#rec-man-statut').selectOption('UNMATCHED')
    await main.locator('#rec-man-sens').selectOption('DEDUCT')
    await main.locator('#rec-man-montant').fill('500')
    await main.locator('#rec-man-montant').blur()
    await main.locator('#rec-man-ref').fill(`FRAIS-${Date.now()}`)
    await main.locator('#rec-man-note').fill('Frais opérateur E2E')
    await main.getByRole('button', { name: 'Ajouter cette écriture' }).click()

    await main.getByLabel('Total net du relevé (FCFA)', { exact: true }).fill(String(statementNum))
    await main.getByLabel('Total net du relevé (FCFA)', { exact: true }).blur()
    await main
      .getByLabel('Motif de l’écart (obligatoire à la validation si écart ≠ 0)', { exact: true })
      .fill('Commission opérateur sur relevé E2E')

    await main.getByRole('button', { name: 'Valider définitivement' }).click()
    const frozenBanner = main.getByText(/Aucune modification n’est plus possible/)
    await confirmPasswordIfAsked(page, frozenBanner)
    await expect(frozenBanner).toBeVisible()
    await expect(main.getByRole('button', { name: 'Valider définitivement' })).toHaveCount(0)

    const recText = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(recText, word).not.toContain(word)

    // 3. Export comptable Q13 depuis /ventes/finance
    await page.goto('/ventes/finance')
    await main.getByRole('button', { name: 'Aperçu comptable Q13' }).click()
    await expect(main).toContainText('Synthèse des rapprochements par canal')

    const csvLink = main.getByRole('link', { name: 'Télécharger l’export CSV Q13' })
    const href = await csvLink.getAttribute('href')
    expect(href).toContain('/api/v1/reports/accounting-export/download')
    const origin = new URL(page.url()).origin
    const csvResponse = await context.request.get(href ?? '', {
      headers: { Origin: origin, Referer: `${origin}/ventes/finance` },
    })
    expect(csvResponse.status()).toBe(200)
    expect(csvResponse.headers()['content-type']).toContain('text/csv')
    const csvBody = await csvResponse.text()
    expect(csvBody).toContain('REVENUE_INVOICE')
    expect(csvBody).toContain('RECONCILIATION')

    const downloading = page.waitForEvent('download')
    await csvLink.click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.csv$/i)

    const financeText = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(financeText, word).not.toContain(word)

    await context.close()
  })
})

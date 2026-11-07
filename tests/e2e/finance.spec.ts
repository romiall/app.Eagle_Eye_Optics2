import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Finance du cabinet (R01 ; AT24, AT25) sur la vraie application : la gérante lit, sur la période de son choix, le chiffre
 * d'affaires, les encaissements, les créances et la caisse, avec la fraîcheur des totaux dite en premier ; une caissière
 * n'y accède pas ; rien ne déborde à 360 px ; jamais « payé » ni « soldé ». La base e2e est PARTAGÉE par toute l'exécution :
 * ce parcours ne lit que des structures et des cohérences (jamais un total absolu) et n'écrit rien. Les montants exacts,
 * les avoirs, les contre-écritures, la reprise papier, la caisse clôturée et les postes hors ligne sont prouvés sur MySQL
 * réel (`FinancialReportTest`, `FinancialReportFreshnessTest`).
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

test.describe('finance du cabinet (R01) sur la vraie application', () => {
  test('la gérante lit quatre indicateurs distincts et la fraîcheur des totaux', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'MANAGER')

    // Depuis « Ventes et caisse » : l'entrée n'existe que pour la gérante.
    await page.goto('/ventes')
    await page.getByRole('link', { name: 'Finance du cabinet' }).click()
    await expect(page).toHaveURL(/\/ventes\/finance$/)
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 1, name: 'Finance du cabinet' })).toBeVisible()

    // La fraîcheur d'abord, puis les quatre lectures séparées.
    await expect(
      main.getByRole('heading', { level: 2, name: 'Fraîcheur des totaux' }),
    ).toBeVisible()
    const headings = await main.getByRole('heading', { level: 2 }).allInnerTexts()
    const names = headings.map((heading) => heading.trim())
    expect(names.indexOf('Fraîcheur des totaux')).toBeLessThan(
      names.indexOf('Chiffre d’affaires de la période'),
    )
    for (const expected of [
      'Chiffre d’affaires de la période',
      'Encaissements de la période',
      'Créances et crédits à rembourser',
      'Caisse',
      'Par personne',
    ]) {
      expect(names).toContain(expected)
    }
    await expect(main.locator('[data-montant="ca-net"]')).toBeVisible()
    await expect(main.locator('[data-montant="encaisse-net"]')).toBeVisible()
    await expect(main.locator('[data-montant="creances"]')).toBeVisible()
    await expect(main.locator('[data-montant="credits"]')).toBeVisible()
    await expect(main.locator('[data-fraicheur]')).toBeVisible()

    // Le mois en cours est lu par défaut ; « Aujourd’hui » resserre la période sur un jour.
    await expect(main.getByRole('status').filter({ hasText: 'Période : du' })).toBeVisible()
    await main.getByRole('button', { name: 'Aujourd’hui' }).click()
    await expect(main.getByRole('status').filter({ hasText: /^\s*Période : [^d]/ })).toBeVisible()
    await expect(main.locator('[data-montant="ca-net"]')).toBeVisible()

    // Une période inversée est refusée sans interroger le serveur.
    await main.getByLabel('Du', { exact: true }).fill('20/10/2026')
    await main.getByLabel('Au', { exact: true }).fill('10/10/2026')
    await main.getByRole('button', { name: 'Afficher la période' }).click()
    await expect(main).toContainText('La fin de la période précède son début.')

    const text = (await main.innerText()).toLowerCase()
    expect(FORBIDDEN.filter((word) => text.includes(word))).toEqual([])
    await context.close()
  })

  test('à 360 px rien ne déborde, et une caissière n’a pas accès à l’écran', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const phone = await browser.newContext({ viewport: { width: 360, height: 740 } })
    const page = await phone.newPage()
    await signIn(page, 'MANAGER')
    await page.goto('/ventes/finance')
    await expect(page.getByRole('main').locator('[data-montant="ca-net"]')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await phone.close()

    const context = await browser.newContext()
    const cashier = await context.newPage()
    await signIn(cashier, 'CASHIER')
    await cashier.goto('/ventes')
    await expect(cashier.getByRole('link', { name: 'Finance du cabinet' })).toHaveCount(0)
    await cashier.goto('/ventes/finance')
    await expect(cashier.getByText('Accès refusé').first()).toBeVisible()
    await context.close()
  })
})

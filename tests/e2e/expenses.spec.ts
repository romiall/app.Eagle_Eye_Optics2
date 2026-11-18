import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { retireDevice } from './support/database'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  prepareThisDevice,
  releaseDevice,
  trackJournalHead,
  unlockVault,
} from './support/device'

const VAULT_SECRET = 'jardin-tropique-sable-orage-58'

/**
 * Parcours réel Dépenses & Caisse enrichie (L1D05 + A1/A2/A3) sur l'application construite :
 *  - Entrée de menu « Dépenses » visible pour la gérante et la caissière (invisible pour la réception).
 *  - Dépense hors tiroir (MTN Mobile Money) saisie directement par la caissière SANS motif ni référence
 *    et SANS ouvrir préalablement la caisse ni demander d'approbation.
 *  - Caisse enrichie : dépense au tiroir directe (motif facultatif), entrée et sortie motivées avec
 *    motif obligatoire et totaux séparés par nature.
 *  - Visibilité des dépenses dans « Finance du cabinet » + contrôle responsive 360 px sans débordement.
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

async function ensureCategory(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/ventes/caisse/categories-depenses')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Catégories de dépenses' }),
  ).toBeVisible()
  const main = page.getByRole('main')
  if (
    await main
      .getByText(name)
      .first()
      .isVisible()
      .catch(() => false)
  )
    return
  await page.locator('#categorie-nom').fill(name)
  await page.locator('#categorie-code').fill(code)
  await page.getByRole('button', { name: 'Créer la catégorie' }).click()
  await expect(main).toContainText(name)
}

test.describe('dépenses et caisse enrichie sur la vraie application', () => {
  test('gérante et caissière voient Dépenses au menu ; saisie directe sans motif ni caisse ouverte ; caisse enrichie', async ({
    browser,
  }) => {
    test.setTimeout(180_000)

    // 1. La gérante voit Dépenses au menu et garantit une catégorie active.
    const mgrContext = await browser.newContext()
    const mgrPage = await mgrContext.newPage()
    await signIn(mgrPage, 'MANAGER')
    await expect(
      mgrPage
        .getByRole('navigation', { name: 'Navigation principale' })
        .getByRole('link', { name: 'Dépenses' }),
    ).toBeVisible()
    await ensureCategory(mgrPage, 'E2E_EXP', 'Fournitures E2E')
    await mgrContext.close()

    // 2. La réception ne voit pas l'entrée Dépenses et ne peut pas y accéder.
    const recContext = await browser.newContext()
    const recPage = await recContext.newPage()
    await signIn(recPage, 'RECEPTION')
    await expect(recPage.getByRole('link', { name: 'Dépenses' })).toHaveCount(0)
    await recPage.goto('/ventes/depenses')
    await expect(recPage.getByText('Accès refusé').first()).toBeVisible()
    await recContext.close()

    // 3. La caissière voit Dépenses au menu, y accède directement et saisit une dépense hors tiroir sans motif ni référence.
    const cashContext = await browser.newContext()
    const page = await cashContext.newPage()
    await signIn(page, 'CASHIER')
    const menuExpense = page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Dépenses' })
    await expect(menuExpense).toBeVisible()
    await menuExpense.click()
    await expect(page).toHaveURL(/\/ventes\/depenses$/)

    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 1, name: 'Dépenses' })).toBeVisible()

    // Mobile 360px : zéro débordement horizontal et cible >= 44px.
    await page.setViewportSize({ width: 360, height: 740 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await page.setViewportSize({ width: 1280, height: 800 })

    // Saisie directe Mobile Money sans motif ni référence.
    await page.locator('#depense-montant').fill('4 500')
    await page.locator('#depense-categorie').selectOption({ label: 'Fournitures E2E' })
    await page.locator('#depense-canal').selectOption('MTN_MOMO')
    await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()
    await expect(main).toContainText('Dépense enregistrée (4 500')
    await expect(main).toContainText('Sans motif précisé')

    // 4. Dans Caisse : ouvrir si fermée, puis dépense tiroir directe + contrôle motif obligatoire sur Sortie motivée.
    await page.goto('/ventes/caisse')
    if (await main.getByText('Aucune session de caisse ouverte').isVisible()) {
      await page.getByLabel('Fond de caisse').fill('20 000')
      await page.getByRole('button', { name: 'Ouvrir la caisse' }).click()
      await expect(main.getByRole('heading', { level: 2, name: /^Session ouverte/ })).toBeVisible()
    }
    await page.locator('#mouvement-montant').fill('2 000')
    await page.locator('#mouvement-categorie').selectOption({ label: 'Fournitures E2E' })
    await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()
    await expect(main).toContainText('Dépense enregistrée depuis le tiroir')
    await expect(main).toContainText('Dépenses au tiroir')

    // Entrée ou sortie motivée : motif obligatoire avant demande d'autorisation.
    await page.getByRole('button', { name: 'Sortie motivée' }).click()
    await page.locator('#mouvement-montant').fill('1 000')
    await page.getByRole('button', { name: 'Demander l’autorisation' }).click()
    await expect(main).toContainText('Indiquez le motif')

    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word)
    await cashContext.close()

    // 5. Gérante voit les dépenses agrégées dans Finance du cabinet.
    const reportContext = await browser.newContext()
    const reportPage = await reportContext.newPage()
    await signIn(reportPage, 'MANAGER')
    await reportPage.goto('/ventes/finance')
    const rMain = reportPage.getByRole('main')
    await expect(
      rMain.getByRole('heading', { level: 2, name: 'Dépenses de la période' }),
    ).toBeVisible()
    await expect(rMain.locator('[data-montant="depenses-total"]')).toBeVisible()
    await reportContext.close()
  })

  test('poste préparé : dépense hors ligne sans motif, sauvegarde locale, reprise et synchronisation', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const run = Date.now().toString(36)
    const deviceCode = `EXP-${run}`.toUpperCase()
    const offlineReference = `OFF-EXP-${run}`.toUpperCase()
    const context = await browser.newContext()
    const journal = trackJournalHead(context)
    let enrolled = false
    let released = false

    try {
      let page = await context.newPage()
      await signIn(page, 'MANAGER')
      await ensureCategory(page, 'E2E_EXP', 'Fournitures E2E')

      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste dépenses hors ligne (e2e)',
        reserveNumbers: false,
      })
      enrolled = true
      const deviceId = await deviceIdByCode(page, deviceCode)

      // Une visite en ligne mémorise les catégories actives dans le coffre chiffré.
      await navigateInApp(page, '/ventes/depenses')
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1, name: 'Dépenses' })).toBeVisible()
      await expect(page.locator('#depense-categorie')).toContainText('Fournitures E2E')

      // Coupure réseau : saisie hors ligne d'une dépense Mobile Money sans motif.
      await context.setOffline(true)
      await page.locator('#depense-montant').fill('3 500')
      await page.locator('#depense-categorie').selectOption({ label: 'Fournitures E2E' })
      await page.locator('#depense-canal').selectOption('MTN_MOMO')
      await page.locator('#depense-reference').fill(offlineReference)
      await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()

      await expect(main).toContainText('Dépense enregistrée sur ce poste (3 500')
      await expect(main).toContainText('En attente de synchronisation')
      await expect(page.getByText(/1 pièce en attente de synchronisation/).first()).toBeVisible()

      // Fermeture d'onglet, retour réseau, réouverture du coffre et synchronisation.
      await page.close()
      await context.setOffline(false)
      page = await context.newPage()
      await page.goto('/parametres/poste')
      await unlockVault(page, VAULT_SECRET)
      await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()

      const sync = page
        .getByRole('region', { name: '5. Synchronisation' })
        .or(page.locator('section[aria-labelledby="titre-synchronisation"]'))
        .first()
      await expect(sync).toContainText('Enregistrées sur ce poste, pas encore envoyées : 0')
      await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
      await expect(sync).toContainText('Conflits à revoir : 0')

      const { request, headers } = await api(page)
      const listResponse = await request.get('/api/v1/expenses?method=MTN_MOMO', { headers })
      expect(listResponse.status(), await listResponse.text()).toBe(200)
      const expenses = (
        (await listResponse.json()) as {
          data: {
            signed_amount: number
            cash_session_id: string | null
            reason: string | null
            reference: string | null
          }[]
        }
      ).data
      const matched = expenses.filter((item) => item.reference === offlineReference)
      expect(matched).toHaveLength(1)
      expect(matched[0]?.signed_amount).toBe(-3500)
      expect(matched[0]?.cash_session_id).toBeNull()
      expect(matched[0]?.reason).toBeNull()

      await releaseDevice(
        page,
        deviceId,
        journal,
        `e2e-exp-release-${run}`,
        'Fin du parcours dépense hors ligne (e2e)',
      )
      released = true
    } finally {
      if (enrolled && !released) retireDevice(deviceCode)
      await context.close().catch(() => undefined)
    }
  })
})

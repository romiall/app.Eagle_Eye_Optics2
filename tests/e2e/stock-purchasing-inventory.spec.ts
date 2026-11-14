import { expect, test, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Achats fournisseur, inventaire et alertes de stock (L1D01, L1D02, L1D03) sur la vraie application :
 *  - article stocké dédié avec seuil bas (aucun impact sur DEMO-MONTURE / DEMO-COLLYRE) ;
 *  - fournisseur -> brouillon de réception (aucun effet sur le stock) -> validation (avec mot de passe) -> +3 en stock ;
 *  - alerte de seuil bas détectée (disponible 3 <= seuil 5) et prise en compte ;
 *  - inventaire sur l'emplacement -> comptage des lignes (théorique intact pour DEMO-*, +4 sur l'article test) ->
 *    validation (ajustement +4 valorisé) -> réévaluation et résolution automatique de l'alerte.
 *
 * Données FICTIVES uniquement.
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

async function confirmPasswordIfAsked(page: Page, done: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  await Promise.race([
    done.waitFor({ state: 'visible', timeout: 15_000 }),
    dialog.waitFor({ state: 'visible', timeout: 15_000 }),
  ])
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
    await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
    await expect(done).toBeVisible()
  }
}

test.describe('achats fournisseur, inventaires et alertes de stock (L1D01, L1D02, L1D03)', () => {
  test('parcours complet fournisseur -> réception -> alerte seuil bas -> inventaire -> résolution', async ({
    browser,
  }) => {
    test.setTimeout(150_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    const main = page.getByRole('main')
    await signIn(page, 'MANAGER')

    // 1. Article stocké dédié avec seuil bas à 5 et coût d'achat 12 000 FCFA.
    const itemRef = `E2E-ST-${Date.now().toString().slice(-5)}`
    await page.goto('/ventes/catalogue')
    await expect(main.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeVisible()
    await main.getByRole('button', { name: 'Nouvel article' }).click()
    const createForm = main.locator('form', {
      has: page.getByRole('heading', { level: 2, name: 'Nouvel article' }),
    })
    await createForm.getByLabel('Référence').fill(itemRef)
    await createForm.getByLabel('Nom').fill('Monture achats inventaire (fictive)')
    await createForm.getByLabel('Catégorie').selectOption('FRAME')
    await createForm.getByLabel('Mode de stock').selectOption('STOCKED')
    await createForm.getByLabel('Unité').selectOption('UNIT')
    await createForm.getByLabel('Prix de vente TTC').fill('30000')
    await createForm.getByLabel('Coût d’achat (facultatif)').fill('12000')
    await createForm.getByLabel('Seuil de stock bas (facultatif)').fill('5')
    await createForm.getByRole('button', { name: 'Créer l’article' }).click()
    await expect(main).toContainText(itemRef)

    // 2. Fournisseur dédié depuis « Stock ».
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Stock' })
      .click()
    await expect(main.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible()
    await main.getByRole('link', { name: 'Fournisseurs' }).click()
    await expect(page).toHaveURL(/\/stock\/fournisseurs$/)
    const supplierRef = `FOU-E2E-${Date.now().toString().slice(-4)}`
    await main.getByLabel('Nom').fill('Fournisseur optique test (fictif)')
    await main.getByLabel('Code du fournisseur').fill(supplierRef)
    await main.getByRole('button', { name: 'Créer le fournisseur' }).click()
    await expect(main).toContainText('Fournisseur optique test (fictif)')

    // 3. Brouillon de réception (3 unités, sans effet immédiat sur le stock) puis validation.
    await main.getByRole('link', { name: 'Réceptions fournisseur' }).click()
    await expect(page).toHaveURL(/\/stock\/receptions$/)
    await main.getByRole('link', { name: 'Nouvelle réception' }).click()
    await expect(page).toHaveURL(/\/stock\/receptions\/nouvelle$/)

    await main
      .getByLabel('Fournisseur')
      .selectOption({ label: 'Fournisseur optique test (fictif)' })
    const locationSelect = main.getByLabel('Emplacement de réception')
    const locationOptions = await locationSelect.locator('option').all()
    if (locationOptions.length > 1) {
      const value = await locationOptions[1]?.getAttribute('value')
      if (value) await locationSelect.selectOption(value)
    }
    const blRef = `BL-E2E-${Date.now().toString().slice(-5)}`
    await main.getByLabel('Référence de livraison').fill(blRef)
    await main.getByRole('button', { name: 'Ajouter une ligne' }).click()
    await main
      .getByLabel('Article géré en stock')
      .selectOption({ label: `Monture achats inventaire (fictive) (${itemRef})` })
    await main.getByLabel('Quantité reçue').fill('3')
    await main.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/stock\/receptions\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(main).toContainText('Brouillon de réception enregistré : le stock n’a pas bougé.')

    await main.getByRole('button', { name: 'Passer à la validation' }).click()
    await main.getByLabel('Coût d’achat unitaire (FCFA)').fill('12000')
    await main.getByRole('button', { name: 'Valider la réception' }).click()
    await confirmPasswordIfAsked(page, main.getByText(/Réception validée : \d+ ligne/))

    // 4. Alertes de stock : disponible 3 <= seuil 5 -> alerte ouverte, prise en compte.
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Stock' })
      .click()
    await expect(main).toContainText(itemRef)
    await main.getByRole('link', { name: 'Alertes et seuils' }).click()
    await expect(page).toHaveURL(/\/stock\/alertes$/)
    await expect(main).toContainText('Physique − Réservé − Quotas des postes')
    await main.getByRole('button', { name: 'Actualiser les alertes' }).click()
    await expect(main.getByText(/Évaluation terminée/)).toBeVisible()

    const alertCard = main.locator('li', { hasText: itemRef })
    await expect(alertCard).toBeVisible()
    await expect(alertCard).toContainText('Manque 2 pour revenir au-dessus du seuil')
    await alertCard.getByRole('button', { name: 'Prendre en compte' }).click()
    await expect(main).toContainText('Alerte marquée comme prise en compte.')

    // 5. Inventaire sur l'emplacement : seuls nos +4 s'ajustent sur l'article test (les DEMO-* restent au théorique exact).
    await page.goto('/stock/inventaires')
    await expect(main.getByRole('heading', { level: 1, name: 'Inventaires' })).toBeVisible()
    await main
      .getByLabel('Emplacement à inventorier')
      .selectOption({ label: 'Emplacement principal (PRINCIPAL)' })
    const invRef = `INV-E2E-${Date.now().toString().slice(-5)}`
    await main.getByLabel('Référence de l’inventaire').fill(invRef)
    await main.getByRole('button', { name: 'Ouvrir l’inventaire' }).click()
    await expect(page).toHaveURL(/\/stock\/inventaires\/[0-9A-HJKMNP-TV-Z]{26}$/)

    const lineCards = main.locator('li', { hasText: 'théorique ' })
    await expect(lineCards.first()).toBeVisible()
    const count = await lineCards.count()
    expect(count).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < count; i += 1) {
      const card = lineCards.nth(i)
      const cardText = await card.innerText()
      if (cardText.includes(itemRef)) {
        await card.getByLabel('Quantité trouvée').fill('7')
        await expect(card.getByLabel('Motif de l’écart')).toBeVisible()
        await card.getByLabel('Motif de l’écart').fill('Récolement étagère vitrine')
      } else {
        const match = /théorique\s+([0-9]+(?:[.,][0-9]+)?)/.exec(cardText)
        const expectedQty = (match?.[1] ?? '0').replace(',', '.')
        await card.getByLabel('Quantité trouvée').fill(expectedQty)
      }
    }

    await main.getByRole('button', { name: 'Enregistrer les comptages' }).click()
    await expect(main).toContainText('Comptages enregistrés : le stock n’a pas bougé.')
    await main.getByRole('button', { name: 'Terminer le comptage' }).click()
    await expect(
      main.getByRole('heading', { level: 2, name: 'Validation par la gérante' }),
    ).toBeVisible()
    await main.getByLabel('Motif de l’approbation').fill('Inventaire de contrôle stock e2e')
    await main.getByRole('button', { name: 'Valider l’inventaire' }).click()
    await confirmPasswordIfAsked(
      page,
      main.getByText(/Inventaire validé : les écarts sont ajustés dans le stock/),
    )

    // 6. Retour aux alertes : 7 > seuil 5 => réévaluation résout automatiquement l'alerte.
    await page.goto('/stock/alertes')
    await main.getByRole('button', { name: 'Actualiser les alertes' }).click()
    await expect(main.getByText(/Évaluation terminée/)).toBeVisible()
    await main.getByLabel('Afficher').selectOption('RESOLVED')
    await expect(main.locator('li', { hasText: itemRef })).toContainText('Résolue')

    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word)
    await context.close()
  })
})

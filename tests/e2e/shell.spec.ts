import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Coquille réelle (F09, fichier 04, AT28) : connexion par l'interface avec un compte de
 * démonstration fictif, navigation sans module futur présenté comme livré, clavier, largeurs
 * 360 px, tablette, ordinateur 1366 px et zoom 200 % (1366 px à 200 % = 683 px CSS), état hors
 * ligne. Le serveur et la base sont ceux de l'application construite (aucune simulation d'API).
 */

async function signInThroughForm(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/')
  await expect(page).toHaveURL(/\/connexion$/)
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe('coquille de l’application (F09)', () => {
  test('connexion par le formulaire, accueil sans module futur, déconnexion', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/connexion$/)
    await expect(page).toHaveTitle('Connexion – Eagle’s Eye Optics Medical')
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible()

    await signInThroughForm(page, 'MANAGER')

    await expect(page).toHaveTitle('Accueil – Eagle’s Eye Optics Medical')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Bonjour Gérante (démonstration)',
    )
    // La gérante a toutes les permissions ; l'environnement de test ouvre « patients », « today »,
    // « consultations », « sales », « stock », « settings », « reports », « agenda » et « offline »
    // (EEO_ENABLED_MODULES de prepare-env.mjs). Seul ce qui est livré ET ouvert apparaît
    // (docs/implementation/modules.md) : actions d'accueil du dossier patient, raccourcis de travail par activité,
    // puis le changement de son mot de passe et l'aide ; ni message « aucun module livré », ni module futur.
    await expect(page.getByText('Aucun module métier livré pour l’instant')).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link')).toHaveText([
      'Voir la file du jour',
      'Voir l’agenda',
      'Voir la caisse du jour',
      'Nouveau patient',
      'Nouvelle consultation',
      'Rechercher',
      'Rendez-vous',
      'Consultations du jour',
      'Statistiques',
      'Paramètres',
      'Patients à rappeler',
      'Enregistrer une arrivée',
      'Nouvelle consultation',
      'Mes examens en cours',
      'Examens du jour',
      'Caisse',
      'Nouvelle facture',
      'Factures',
      'Personnel',
      'Cabinet et documents',
      'Catalogue',
      'Changer mon mot de passe',
      'Aide : comment utiliser l’application',
    ])
    await expect(
      page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link'),
    ).toHaveText([
      'Accueil',
      'Aujourd’hui',
      'Patients',
      'Consultations',
      'Agenda',
      'Ventes et caisse',
      'Paramètres',
    ])
    // Modules non livrés : jamais présentés, même ouverts par l'exploitant (le stock l'est ici, son entrée de menu
    // attend I01 ; « offline » n'a pas d'entrée de menu). L'agenda, « Rendez-vous » et « Statistiques » sont livrés.
    for (const future of ['Stock', 'Atelier', 'Communication', 'Rapports', 'Postes hors-ligne']) {
      await expect(page.getByRole('link', { name: future, exact: true }), future).toHaveCount(0)
    }
    const banner = page.getByRole('banner')
    await expect(banner.getByRole('link', { name: /Gestion des patients/ })).toHaveAttribute(
      'href',
      '/',
    )
    // Écrit en casse normale, affiché en capitales.
    // (la marque est sur deux lignes : nom du cabinet, puis « Gestion des patients »).
    const brandText = await banner.getByRole('link').first().innerText()
    expect(brandText).toContain('EAGLE’S EYE OPTICS MEDICAL')
    expect(brandText).toContain('GESTION DES PATIENTS')
    await expect(banner.getByText('En ligne')).toBeVisible()

    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/connexion$/)
    await page.goto('/')
    await expect(page).toHaveURL(/\/connexion$/)
  })

  test('identifiants refusés : message sous le champ et résumé focalisé, mot de passe vidé', async ({
    page,
  }) => {
    await page.goto('/connexion')
    await page.getByLabel('Identifiant').fill(demoAccount('CASHIER').login)
    await page.getByLabel('Mot de passe').fill('mot-de-passe-errone-fictif')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    const summary = page.getByRole('alert')
    await expect(summary).toContainText('Connexion impossible')
    await expect(summary).toContainText('Identifiant ou mot de passe incorrect.')
    await expect(summary).toBeFocused()
    await expect(page.getByLabel('Identifiant')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Mot de passe')).toHaveValue('')
    await expect(page.getByLabel('Identifiant')).toHaveValue(demoAccount('CASHIER').login)
  })

  test('clavier : le premier arrêt est « Aller au contenu », qui mène au contenu', async ({
    page,
  }) => {
    await signInThroughForm(page, 'RECEPTION')
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Aller au contenu' })
    await expect(skip).toBeFocused()
    const box = await skip.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(40)

    // Focus visible : contour plein de 3 px.
    const outline = await skip.evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: style.outlineWidth, styleName: style.outlineStyle }
    })
    expect(outline).toEqual({ width: '3px', styleName: 'solid' })

    await page.keyboard.press('Enter')
    await expect(page.locator('main#contenu')).toBeFocused()

    // Depuis le contenu, la tabulation arrière revient dans l'ordre logique (aucun piège) : d'abord la
    // dernière entrée du menu latéral (livré avec les modules ouverts), puis, de lien en lien, le bouton de
    // déconnexion de l'en-tête.
    const menu = page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link')
    const entries = await menu.count()
    await page.keyboard.press('Shift+Tab')
    await expect(menu.last()).toBeFocused()
    for (let step = 0; step < entries; step += 1) await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeFocused()
  })

  for (const viewport of [
    { name: 'téléphone 360 px', width: 360, height: 740 },
    { name: 'zoom 200 % d’un écran 1366 px', width: 683, height: 384 },
    { name: 'tablette', width: 768, height: 1024 },
    { name: 'ordinateur 1366 × 768', width: 1366, height: 768 },
  ]) {
    test(`${viewport.name} : aucun défilement horizontal, cibles d’au moins 44 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/connexion')
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      for (const control of [
        page.getByLabel('Identifiant'),
        page.getByLabel('Mot de passe'),
        page.getByRole('button', { name: 'Se connecter' }),
      ]) {
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      }

      await signInThroughForm(page, 'CASHIER')
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      const logout = page.getByRole('button', { name: 'Se déconnecter' })
      expect((await logout.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      // L'en-tête entier reste dans la largeur de l'écran (retour à la ligne, jamais coupé).
      const brand = await page.getByRole('banner').getByRole('link').first().boundingBox()
      expect((brand?.x ?? 0) + (brand?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
      // Texte courant à 16 px.
      const fontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize)
      expect(fontSize).toBe('16px')
    })
  }

  test('hors ligne : l’en-tête le dit, puis « En ligne » au retour du réseau', async ({
    page,
    context,
  }) => {
    await signInThroughForm(page, 'CASHIER')
    const banner = page.getByRole('banner')

    await context.setOffline(true)
    await expect(banner.getByText('Hors ligne')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()

    await context.setOffline(false)
    await expect(banner.getByText('En ligne')).toBeVisible()
  })

  test('une URL métier non livrée n’ouvre aucun écran vide : page introuvable', async ({
    page,
  }) => {
    await signInThroughForm(page, 'MANAGER')
    // L'atelier n'est pas livré (L1D04) : son adresse n'ouvre aucun écran. (Le stock, lui, a un écran
    // d'ouverture livré avec I00 et ouvert dans cet environnement : ce n'est plus une URL non livrée.)
    await page.goto('/atelier')

    await expect(page.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeVisible()
    await page.getByRole('link', { name: 'Retour à l’accueil' }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
  })
})

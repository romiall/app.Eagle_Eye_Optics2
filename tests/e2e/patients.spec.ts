import { expect, type Locator, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Parcours patient réel (P01, P02, AT03, AT04) : connexion par l'interface avec un compte de
 * démonstration fictif, création d'une fiche avec numéro central EE-AAAA-NNNN, signalement d'une
 * ressemblance sans fusion, recherche sans tenir compte des accents ni de la casse, modification, droits
 * en lecture seule, largeur de téléphone. Le serveur et la base sont ceux de l'application construite
 * (aucune simulation d'API). Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function fillIdentity(
  page: Page,
  identity: { lastName: string; firstNames: string; birth: string; phone: string },
): Promise<void> {
  await page.getByLabel('Nom (obligatoire)').fill(identity.lastName)
  await page.getByLabel('Prénom(s)').fill(identity.firstNames)
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill(identity.birth)
  await page.getByLabel('Téléphone principal').fill(identity.phone)
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

const YEAR = new Date().getFullYear()
const RECORD = new RegExp(`EE-${YEAR}-\\d{4,}`)

test.describe('patients (P01, P02) sur la vraie application', () => {
  test('créer une fiche, signaler une ressemblance sans fusion, retrouver, modifier', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')

    // Création : numéro central attribué par le serveur, fiche ouverte après l'enregistrement.
    await page.goto('/patients/nouveau')
    await expect(page.getByRole('heading', { level: 1, name: 'Nouveau patient' })).toBeVisible()
    await fillIdentity(page, {
      lastName: 'Nguema Parcours',
      firstNames: 'Élodie',
      birth: '12/05/1990',
      phone: '+237 600 00 00 77',
    })
    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()

    await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguema Parcours')
    await expect(page.getByRole('main')).toContainText(RECORD)
    const firstUrl = page.url()

    // Une seconde fiche aux mêmes nom et téléphone est signalée, jamais fusionnée ni bloquée.
    await page.goto('/patients/nouveau')
    await fillIdentity(page, {
      lastName: 'Nguema Parcours',
      firstNames: 'Élodie',
      birth: '12/05/1990',
      phone: '+237 600 00 00 77',
    })
    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Nguema Parcours')
    await expect(dialog.getByRole('button', { name: /fusion/i })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Créer quand même' }).click()
    await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(page.url()).not.toBe(firstUrl)

    // Recherche insensible aux accents, à la casse et à l'ordre des mots.
    await page.goto('/patients')
    await page.getByRole('searchbox', { name: 'Rechercher un patient' }).fill('elodie NGUEMA')
    await page.getByRole('button', { name: 'Rechercher' }).click()
    const results = page.getByRole('main')
    await expect(results.getByText('Nguema Parcours').first()).toBeVisible()
    await expect(results.getByRole('link', { name: /Nguema Parcours/ })).toHaveCount(2)

    // Moins de deux caractères : message, aucune recherche.
    await page.getByRole('searchbox', { name: 'Rechercher un patient' }).fill('n')
    await page.getByRole('button', { name: 'Rechercher' }).click()
    await expect(page.locator('#patient-recherche-erreur')).toContainText('au moins 2 caractères')

    // Modification de la première fiche : la profession est enregistrée et relue.
    await page.goto(firstUrl)
    await page.getByRole('link', { name: 'Modifier' }).click()
    await page.getByLabel('Profession').fill('Enseignante')
    await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()
    await expect(page).toHaveURL(firstUrl)
    await expect(page.getByRole('main')).toContainText('Enseignante')
  })

  test('une saisie invalide est refusée champ par champ et rien n’est enregistré', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/patients/nouveau')

    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByLabel('Nom (obligatoire)')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/patients\/nouveau$/)
  })

  test('lecture seule : la caisse consulte une fiche sans pouvoir la créer ni la modifier', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/patients/nouveau')
    await fillIdentity(page, {
      lastName: 'Lecture Seule',
      firstNames: 'Test',
      birth: '01/02/1985',
      phone: '+237 600 00 00 88',
    })
    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
    await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const url = page.url()
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/connexion$/)

    await signIn(page, 'CASHIER')
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lecture Seule')
    await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0)

    await page.goto('/patients/nouveau')
    await expect(page.getByText('Accès refusé').first()).toBeVisible()
  })

  test('téléphone 360 px : le formulaire et la liste ne débordent pas', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await signIn(page, 'RECEPTION')

    await page.goto('/patients/nouveau')
    await expect(page.getByLabel('Nom (obligatoire)')).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    await page.goto('/patients')
    await expect(page.getByRole('searchbox', { name: 'Rechercher un patient' })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('formulaire : les saisies d’une même rangée sont alignées, l’aide est sous la saisie', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page, 'RECEPTION')
    await page.goto('/patients/nouveau')
    await expect(page.getByLabel('Nom (obligatoire)')).toBeVisible()

    const box = async (locator: Locator): Promise<{ x: number; y: number; height: number }> => {
      const found = await locator.boundingBox()
      if (found === null) throw new Error('Champ invisible : pas de position à comparer.')
      return found
    }
    const top = async (label: string): Promise<number> =>
      (await box(page.getByLabel(label, { exact: true }))).y

    // Une aide par champ de gauche ou de droite ne décale plus la saisie voisine : même hauteur.
    for (const [left, right] of [
      ['Nom (obligatoire)', 'Prénom(s)'],
      ['Sexe', 'Date de naissance'],
      ['Téléphone principal', 'Téléphone secondaire'],
    ] as const) {
      expect(
        Math.abs((await top(left)) - (await top(right))),
        `${left} / ${right}`,
      ).toBeLessThanOrEqual(1)
    }

    // L'aide est SOUS sa saisie, jamais entre l'étiquette et la saisie.
    for (const [label, hint] of [
      ['Prénom(s)', 'Facultatif : un prénom peut être inconnu.'],
      ['Téléphone principal', 'Un même téléphone peut servir à plusieurs patients.'],
    ] as const) {
      const input = await box(page.getByLabel(label, { exact: true }))
      const help = await box(page.getByText(hint, { exact: true }))
      expect(help.y, `aide de « ${label} »`).toBeGreaterThanOrEqual(input.y + input.height)
    }

    // Recherche : le bouton reste aligné sur la saisie, avec son aide sous elle.
    await page.goto('/patients')
    const search = await box(page.getByRole('searchbox', { name: 'Rechercher un patient' }))
    const button = await box(page.getByRole('button', { name: 'Rechercher' }))
    expect(
      Math.abs(search.y + search.height / 2 - (button.y + button.height / 2)),
    ).toBeLessThanOrEqual(2)
  })
})

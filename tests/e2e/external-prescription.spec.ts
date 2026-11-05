import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Ordonnance externe (C04, A13) sur la vraie application : un patient apporte l'ordonnance d'un autre
 * prescripteur ; le professionnel la transcrit depuis l'onglet « Prescriptions » du dossier, sans
 * consultation, l'enregistre en brouillon puis la valide. L'accueil ne voit pas cet onglet. Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function switchTo(page: Page, context: BrowserContext, role: string): Promise<void> {
  // Quitter la page d'abord : une requête encore en vol ne doit pas recréer le cookie de session après son effacement.
  await page.goto('about:blank')
  await context.clearCookies()
  await page.goto('/connexion')
  await signIn(page, role)
}

test('transcrire une ordonnance externe depuis le dossier patient, puis la valider', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)
  await signIn(page, 'RECEPTION')
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill('Externe Parcours')
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('05/06/1985')
  await page.getByLabel('Téléphone principal').fill('+237 600 00 10 02')
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const patientUrl = page.url()
  // L'accueil n'a aucun accès clinique : pas d'onglet « Prescriptions ».
  await expect(
    page.getByRole('navigation', { name: 'Sections du dossier patient' }).getByRole('link'),
  ).toHaveText(['Identité', 'Activité'])

  await switchTo(page, context, 'CLINICIAN')
  await page.goto(patientUrl)
  await page
    .getByRole('navigation', { name: 'Sections du dossier patient' })
    .getByRole('link', { name: 'Prescriptions' })
    .click()
  await expect(page).toHaveURL(/\/prescriptions$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Ordonnances externes' })).toBeVisible()
  await expect(page.getByText('Aucune ordonnance externe', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Transcrire une ordonnance externe' }).click()
  await page.getByLabel('Prescripteur').fill('Dr Externe Fictif')
  await page.getByLabel('Date de l’ordonnance').fill('01/10/2026')
  await page.locator('[id="rx-OD-sphere"]').fill('+1,50')
  await page.locator('[id="rx-OG-no_correction"]').check()
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
  await expect(page.getByRole('main')).toContainText('Version 1 (brouillon)')
  await page.getByRole('button', { name: 'Valider la prescription' }).click()
  await expect(page.getByRole('main')).toContainText('Validée')
  await expect(page.getByRole('main')).toContainText('Dr Externe Fictif')

  // Après rechargement complet : la transcription vient du serveur.
  await page.reload()
  await expect(page.getByRole('main')).toContainText('Dr Externe Fictif')
  await expect(page.getByRole('main')).toContainText('+1,50')

  // Une nouvelle version en brouillon se supprime après confirmation ; la version VALIDÉE reste, jamais supprimée.
  await page.getByRole('button', { name: 'Créer une nouvelle version' }).click()
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
  await expect(page.getByRole('main')).toContainText('Version 2 (brouillon)')
  await page.getByRole('button', { name: 'Supprimer le brouillon' }).click()
  const confirm = page.getByRole('dialog', { name: 'Supprimer le brouillon de la version 2 ?' })
  await expect(confirm).toContainText('Une prescription validée ne se supprime pas')
  await confirm.getByRole('button', { name: 'Supprimer le brouillon' }).click()
  await expect(page.getByRole('main')).toContainText('Brouillon supprimé')
  await expect(page.getByRole('main')).toContainText('Validée')
  await expect(page.getByRole('main')).toContainText('Dr Externe Fictif')
  await expect(page.getByRole('main')).not.toContainText('Version 2 (brouillon)')
  await expect(page.getByRole('button', { name: 'Supprimer le brouillon' })).toHaveCount(0)
})

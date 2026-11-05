import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Agenda interne réel (S01, AT23) avec l'agenda de DÉMONSTRATION (`eeo:demo:agenda` : salle, horaires et prestations
 * fictifs) : l'accueil prend un rendez-vous pour un patient, le voit « confirmé » seulement après la réponse du
 * serveur, le retrouve dans l'agenda du jour, puis l'annule avec un motif. La caisse lit l'agenda sans pouvoir le
 * modifier. Rien ne déborde à 360 px. Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function createPatient(page: Page, lastName: string, phone: string): Promise<string> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/09/1990')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  return page.url().split('/').pop() as string
}

/** Prochain jour ouvré (lundi à vendredi) après aujourd'hui, au format JJ/MM/AAAA et AAAA-MM-JJ. */
function nextWorkingDay(): { french: string; iso: string } {
  const now = new Date()
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  )
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1)
  }
  const dd = String(candidate.getUTCDate()).padStart(2, '0')
  const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(candidate.getUTCFullYear())
  return { french: `${dd}/${mm}/${yyyy}`, iso: `${yyyy}-${mm}-${dd}` }
}

test.describe('agenda (S01) sur la vraie application', () => {
  test('prendre un rendez-vous, le retrouver dans l’agenda, l’annuler avec un motif', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await signIn(page, 'RECEPTION')
    const patientId = await createPatient(page, 'Agenda Parcours', '+237 600 00 10 01')
    const day = nextWorkingDay()

    await page.goto(`/agenda/nouveau?patient=${patientId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Nouveau rendez-vous' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Agenda Parcours')
    // Le jour d'abord : le jour par défaut est AUJOURD'HUI, et avant l'ouverture du cabinet ses créneaux
    // s'affichent dès le choix de la ressource ; le test cocherait alors un créneau d'aujourd'hui (le
    // rendez-vous serait pris le jour même, selon l'heure à laquelle tourne le test).
    await page.getByLabel('Jour (obligatoire)').fill(day.french)
    await page.getByLabel('Jour (obligatoire)').blur()
    await page.getByLabel('Prestation').selectOption({ index: 1 })
    await page.getByLabel('Professionnel ou salle').selectOption({ index: 1 })
    const firstSlot = page.locator('input[name="rdv-creneau"]').first()
    await expect(firstSlot).toBeVisible()
    await firstSlot.check()
    await expect(page.getByRole('main')).not.toContainText('Rendez-vous confirmé')
    await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()
    await expect(page.getByText(/Rendez-vous confirmé par le serveur/)).toBeVisible()

    await page.goto('/agenda')
    await page.getByLabel('Jour', { exact: true }).fill(day.french)
    await page.getByRole('button', { name: 'Afficher' }).click()
    const card = page.getByRole('article').filter({ hasText: 'Agenda Parcours' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Confirmé')

    await card.getByRole('button', { name: /Annuler le rendez-vous de/ }).click()
    await page
      .getByLabel('Motif de l’annulation (obligatoire)')
      .fill('Patient indisponible (fictif)')
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler le rendez-vous' }).click()
    await expect(page.getByText(/annulé sur le serveur/)).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Agenda Parcours' })).toContainText(
      'Annulé',
    )
  })

  test('la caisse lit l’agenda sans action d’écriture', async ({ page }) => {
    await signIn(page, 'CASHIER')
    await page.goto('/agenda')
    await expect(page.getByRole('heading', { level: 1, name: /^Agenda/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Nouveau rendez-vous' })).toHaveCount(0)
    await page.goto('/agenda/nouveau')
    await expect(page.getByText('Accès refusé').first()).toBeVisible()
  })

  test('téléphone 360 px : l’agenda et les patients à rappeler ne débordent pas', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await signIn(page, 'RECEPTION')
    for (const path of ['/agenda', '/suivis', '/agenda/nouveau']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0)
    }
  })
})

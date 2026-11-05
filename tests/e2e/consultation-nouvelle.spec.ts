import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * « Nouvelle consultation » (C01) sur la vraie application : la boîte de l'écran des examens démarre l'examen d'un
 * patient de la file du jour en un clic, ou d'un patient trouvé par la recherche et sans arrivée (arrivée
 * « Examen de vue » enregistrée PUIS examen démarré). L'écart pupillaire saisi sous le ticket de l'autoréfracteur
 * (étape « Réfraction ») est enregistré avec elle comme écart total du centrage : retrouvé à l'étape suivante et
 * après rechargement. Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/**
 * Change de compte : déconnexion par l'écran, puis connexion du profil demandé. Effacer les cookies ne suffit pas :
 * la réponse tardive d'une requête encore en vol (serveur de test mono-processus, poste chargé) ré-émet le cookie de
 * session, alors que la déconnexion détruit la session côté serveur.
 */
async function switchTo(page: Page, role: string): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await signIn(page, role)
}

async function createPatient(
  page: Page,
  lastName: string,
  phone: string,
  profession = '',
): Promise<void> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  if (profession !== '') await page.getByLabel('Profession').fill(profession)
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/09/1990')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
}

/** Depuis la fiche d'un patient qui vient d'être créée : enregistre son arrivée « Examen de vue ». */
async function registerArrivalFromRecord(page: Page, lastName: string): Promise<void> {
  await page.getByRole('link', { name: 'Enregistrer une arrivée' }).click()
  await expect(page).toHaveURL(/\/aujourdhui\/arrivee\?patient=/)
  await expect(page.getByRole('main')).toContainText(lastName)
  await page.getByLabel('Motif de la visite').selectOption({ label: 'Examen de vue' })
  await expect(page.getByRole('main')).toContainText('Le contrôle du paiement de l’examen')
  await page.getByRole('button', { name: 'Enregistrer l’arrivée' }).click()
  await expect(page).toHaveURL(/\/aujourdhui$/)
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(lastName) })
      .first(),
  ).toBeVisible()
}

function stepper(page: Page) {
  return page.getByRole('navigation', { name: 'Étapes de la consultation' })
}

test.describe('nouvelle consultation (C01) sur la vraie application', () => {
  test('un clic pour un patient de la file ; arrivée puis examen pour un patient trouvé ; écart pupillaire enregistré avec la réfraction', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await signIn(page, 'RECEPTION')
    await createPatient(page, 'Nouvelle File', '+237 600 00 12 01', 'Enseignante')
    await registerArrivalFromRecord(page, 'Nouvelle File')
    await createPatient(page, 'Nouvelle Recherche', '+237 600 00 12 02')

    await switchTo(page, 'CLINICIAN')

    // L'accueil du professionnel propose « Nouvelle consultation » ; elle ouvre la boîte sur l'écran des examens.
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Nouvelle consultation' }),
    ).toHaveCount(2)
    await page
      .getByRole('navigation', { name: 'Actions' })
      .getByRole('link', { name: 'Nouvelle consultation' })
      .click()
    await expect(page).toHaveURL(/\/consultations\?nouvelle=1$/)
    const dialog = page.getByRole('dialog', { name: 'Nouvelle consultation' })
    await expect(dialog).toBeVisible()

    // Le patient de la file démarre en un clic.
    await dialog.getByRole('button', { name: /Démarrer l’examen de .*Nouvelle File/ }).click()
    await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(page.getByRole('main')).toContainText('Nouvelle File')
    await expect(page.getByRole('group', { name: 'Patient et consultation' })).toContainText(
      'Profession : Enseignante',
    )
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()

    // Symptômes courants : les boutons complètent le texte libre sans l'écraser.
    await page.getByLabel('Plaintes et symptômes').fill('Gêne le soir')
    await page.getByRole('button', { name: 'Maux de tête' }).click()
    await expect(page.getByLabel('Plaintes et symptômes')).toHaveValue('Gêne le soir, Maux de tête')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText('Enregistré sur le serveur').first()).toBeVisible()

    // Écart pupillaire du ticket : saisi sous l'autoréfracteur, enregistré avec la réfraction.
    await stepper(page)
      .getByRole('button', { name: /Réfraction/ })
      .click()
    await expect(page.getByRole('heading', { level: 2, name: /Étape 4 sur 7/ })).toBeVisible()
    await page.locator('[id="mesure-AUTOREFRACTOR-OD-sphere"]').fill('-1,25')
    await page.locator('[id="mesure-AUTOREFRACTOR-OG-sphere"]').fill('-1,00')
    await page.getByLabel('Écart pupillaire total (mm)').fill('72')
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Le centrage a été enregistré avec la réfraction : l'écart est déjà là, sans l'avoir saisi à l'étape 5.
    await expect(page.getByRole('heading', { level: 2, name: /Étape 5 sur 7/ })).toBeVisible()
    await expect(page.getByLabel('Écart pupillaire total (mm)')).toHaveValue(/^72[,.]00$/)
    await expect(page.getByText('Enregistré sur le serveur').first()).toBeVisible()

    // Rechargé depuis le serveur : les deux rubriques sont retrouvées.
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()
    await expect(page.getByLabel('Plaintes et symptômes')).toHaveValue('Gêne le soir, Maux de tête')
    await stepper(page)
      .getByRole('button', { name: /Centrage/ })
      .click()
    await expect(page.getByLabel('Écart pupillaire total (mm)')).toHaveValue(/^72[,.]00$/)
    await stepper(page)
      .getByRole('button', { name: /Réfraction/ })
      .click()
    await expect(page.getByLabel('Écart pupillaire total (mm)')).toHaveValue(/^72[,.]00$/)
    await expect(page.locator('[id="mesure-AUTOREFRACTOR-OD-sphere"]')).toHaveValue('-1,25')

    // Pendant l'examen, un bloc mène à la prescription optique (écran à part, utilisable dès l'examen en cours).
    await expect(page.getByRole('link', { name: 'Prescription optique' })).toBeVisible()

    // Un patient sans arrivée : recherché, son arrivée est enregistrée puis l'examen démarre.
    await page.goto('/consultations')
    await page.getByRole('button', { name: 'Nouvelle consultation' }).click()
    const searchDialog = page.getByRole('dialog', { name: 'Nouvelle consultation' })
    await expect(searchDialog).toBeVisible()
    await searchDialog.getByRole('combobox', { name: /Patient/ }).fill('Nouvelle Recherche')
    await searchDialog
      .getByRole('option', { name: /Nouvelle Recherche/ })
      .first()
      .click()
    await expect(searchDialog).toContainText('Ce patient n’est pas dans la file du jour')
    await searchDialog
      .getByRole('button', { name: 'Enregistrer l’arrivée et démarrer l’examen' })
      .click()

    await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(page.getByRole('main')).toContainText('Nouvelle Recherche')

    // L'arrivée créée par la boîte figure dans la file du jour, en consultation (aucun doublon, aucun oubli).
    await page.goto('/aujourdhui')
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /Nouvelle Recherche/ })
        .first(),
    ).toBeVisible()
  })
})

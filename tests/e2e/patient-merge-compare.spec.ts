import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Parcours complet L1D08 sur la vraie application :
 * 1) deux fiches distinctes du même patient ont chacune un examen terminé ;
 * 2) la gérante fusionne la fiche en double dans la fiche conservée après aperçu, motif et confirmation par mot de passe ;
 * 3) l'onglet « Activité » de la fiche conservée réunit les deux examens et ouvre « Comparer deux examens » ;
 * 4) un examen terminé ouvre également la comparaison via « Comparer à un autre examen ».
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function switchTo(page: Page, role: string): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await signIn(page, role)
}

async function createPatient(
  page: Page,
  lastName: string,
  firstNames: string,
  birthDate: string,
  phone: string,
): Promise<string> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill(firstNames)
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill(birthDate)
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  return page.url().split('/').pop() ?? ''
}

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

async function completeExamFromQueue(
  page: Page,
  lastName: string,
  complaint: string,
  acuityOd: string,
  conclusion: string,
): Promise<string> {
  await page.goto('/consultations?nouvelle=1')
  const dialog = page.getByRole('dialog', { name: 'Nouvelle consultation' })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: new RegExp(`Démarrer l’examen de .*${lastName}`) })
    .click()
  await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const consultationId = page.url().split('/').pop() ?? ''

  await page.getByLabel('Plaintes et symptômes').fill(complaint)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()

  const stepper = page.getByRole('navigation', { name: 'Étapes de la consultation' })
  await stepper.getByRole('button', { name: /Acuité visuelle/ }).click()
  await page
    .getByRole('group', { name: 'Acuité de loin : échelle utilisée' })
    .getByRole('radio')
    .first()
    .check()
  await page.getByLabel('Acuité de loin, sans correction, OD').fill(acuityOd)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()

  await stepper.getByRole('button', { name: /Conclusion et orientation/ }).click()
  await page.getByLabel('Conclusion', { exact: true }).fill(conclusion)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()

  await page.getByRole('button', { name: 'Terminer l’examen' }).click()
  const confirm = page.getByRole('dialog', { name: 'Terminer l’examen ?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Terminer l’examen' }).click()
  await expect(page.getByText('Examen terminé')).toBeVisible()

  return consultationId
}

test.describe('fusion manuelle et comparaison de deux examens (L1D08)', () => {
  test('fusionner deux fiches réunit l’activité puis comparer deux examens depuis Activité et Consultation', async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000)
    const attempt = Math.min(testInfo.retry, 1)
    const survivorLast = ['Kamdoum', 'Moukouri'][attempt] ?? 'Kamdoum'
    const sourceLast = ['Fotsing', 'Tchatchoua'][attempt] ?? 'Fotsing'
    const survivorPhone = `+237 600 00 88 0${attempt + 1}`
    const sourcePhone = `+237 600 00 89 0${attempt + 1}`

    await signIn(page, 'RECEPTION')
    const survivorId = await createPatient(
      page,
      survivorLast,
      'Claire',
      '10/03/1988',
      survivorPhone,
    )
    await registerArrivalFromRecord(page, survivorLast)

    const sourceId = await createPatient(page, sourceLast, 'Claire', '11/04/1988', sourcePhone)
    await registerArrivalFromRecord(page, sourceLast)

    await switchTo(page, 'CLINICIAN')
    const exam1Id = await completeExamFromQueue(
      page,
      survivorLast,
      'Vision floue de loin initiale',
      '6/10',
      'Premier bilan optique',
    )
    await completeExamFromQueue(
      page,
      sourceLast,
      'Contrôle de suivi après port',
      '9/10',
      'Évolution favorable',
    )

    // La gérante ouvre la fiche en double, vérifie l'aperçu, confirme motif + mot de passe (423) et fusionne.
    await switchTo(page, 'MANAGER')
    await page.goto(`/patients/${sourceId}`)
    await expect(page.getByRole('link', { name: /Fusionner avec une autre fiche/ })).toBeVisible()
    await page.getByRole('link', { name: /Fusionner avec une autre fiche/ }).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${sourceId}/fusion$`))

    const combobox = page.getByRole('combobox', { name: 'Fiche à conserver' })
    await combobox.fill(survivorLast)
    const option = page.getByRole('option', { name: new RegExp(survivorLast, 'i') }).first()
    await expect(option).toBeVisible()
    await option.click()

    await expect(page.getByRole('heading', { name: 'Rattaché à la fiche absorbée' })).toBeVisible()
    await page.getByLabel('Motif de la fusion').fill('Patient enregistré deux fois au secrétariat')
    await page.getByRole('button', { name: /Fusionner les deux fiches/ }).click()

    const confirmMerge = page.getByRole('dialog', {
      name: 'Fusionner définitivement ces deux fiches ?',
    })
    await expect(confirmMerge).toBeVisible()
    await confirmMerge.getByRole('button', { name: 'Fusionner', exact: true }).click()

    const passwordDialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
    await expect(passwordDialog).toBeVisible()
    await passwordDialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
    await passwordDialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()

    await expect(page).toHaveURL(new RegExp(`/patients/${survivorId}$`))

    // L'activité de la fiche conservée réunit les deux examens et propose « Comparer deux examens ».
    await page.getByRole('link', { name: 'Activité', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${survivorId}/activite$`))
    const compareBtn = page.getByRole('link', { name: 'Comparer deux examens' })
    await expect(compareBtn).toBeVisible()
    await compareBtn.click()
    await expect(page).toHaveURL(new RegExp(`/patients/${survivorId}/comparaison$`))
    await expect(page.getByRole('main')).toContainText('Premier bilan optique')
    await expect(page.getByRole('main')).toContainText('Évolution favorable')
    await expect(page.getByRole('main')).toContainText('6/10')
    await expect(page.getByRole('main')).toContainText('9/10')

    // Depuis l'examen terminé de la fiche conservée, « Comparer à un autre examen » rouvre la comparaison.
    await page.goto(`/consultations/${exam1Id}`)
    const compareFromConsult = page.getByRole('link', { name: 'Comparer à un autre examen' })
    await expect(compareFromConsult).toBeVisible()
    await compareFromConsult.click()
    await expect(page).toHaveURL(
      new RegExp(`/patients/${survivorId}/comparaison\\?compare=${exam1Id}$`),
    )
    await expect(page.getByRole('main')).toContainText('Évolution favorable')
  })
})

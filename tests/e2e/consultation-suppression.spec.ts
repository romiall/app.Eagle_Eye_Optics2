import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * « Modifier » et « Supprimer » un examen (C01) sur la vraie application : un examen resté brouillon se supprime
 * depuis la liste ou l'éditeur, après confirmation, et sa visite revient dans la file du jour (l'examen peut être
 * redémarré) ; un examen en cours ou terminé ne propose jamais « Supprimer » et le SERVEUR refuse la commande (409),
 * même envoyée directement. Un examen terminé s'ouvre en correction depuis « Modifier ». Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Change de compte par l'écran (déconnexion puis connexion) : voir `consultation-nouvelle.spec.ts`. */
async function switchTo(page: Page, role: string): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await signIn(page, role)
}

async function createPatient(page: Page, lastName: string, phone: string): Promise<void> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/09/1990')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
}

async function registerArrivalFromRecord(page: Page, lastName: string): Promise<void> {
  await page.getByRole('link', { name: 'Enregistrer une arrivée' }).click()
  await expect(page).toHaveURL(/\/aujourdhui\/arrivee\?patient=/)
  await expect(page.getByRole('main')).toContainText(lastName)
  await page.getByLabel('Motif de la visite').selectOption({ label: 'Examen de vue' })
  // Le formulaire a pris le motif (la note du contrôle de paiement apparaît) avant l'envoi : sinon le clic se perd.
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

/** Démarre l'examen d'un patient de la file du jour depuis « Nouvelle consultation » : identifiant de la consultation. */
async function startFromQueue(page: Page, lastName: string): Promise<string> {
  await page.goto('/consultations?nouvelle=1')
  const dialog = page.getByRole('dialog', { name: 'Nouvelle consultation' })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: new RegExp(`Démarrer l’examen de .*${lastName}`) })
    .click()
  await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
  return page.url().split('/').pop() ?? ''
}

interface ApiResult {
  status: number
  json: {
    data?: Record<string, unknown>
    error?: { code: string; details?: Record<string, unknown> }
  }
}

/** Appel de l'API depuis la page, comme la SPA : cookie de session, jeton X-XSRF-TOKEN et clé d'idempotence. */
async function api(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  return page.evaluate(
    async ({ method, path, body, key }) => {
      const xsrf = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
        ?.slice('XSRF-TOKEN='.length)
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
      if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf)
      if (method === 'POST') headers['Idempotency-Key'] = key
      const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      return { status: response.status, json: text === '' ? {} : JSON.parse(text) }
    },
    { method, path, body, key: randomUUID().replaceAll('-', '') },
  )
}

/**
 * Commande de suppression envoyée directement au serveur, avec la version actuelle de la consultation (lue d'abord ;
 * 1 pour une consultation qui n'existe plus : la version attendue d'une commande est toujours au moins 1).
 */
async function deleteDirectly(page: Page, id: string): Promise<ApiResult> {
  const read = await api(page, 'GET', `/api/v1/consultations/${id}`)
  const version = Number(read.json.data?.['version'] ?? 1)
  return api(page, 'POST', `/api/v1/consultations/${id}/delete`, {
    expected_version: version,
    consultation_id: id,
  })
}

function stepper(page: Page) {
  return page.getByRole('navigation', { name: 'Étapes de la consultation' })
}

test.describe('suppression d’un examen resté brouillon (C01) sur la vraie application', () => {
  test('un brouillon se supprime et sa visite revient dans la file ; un examen en cours ou terminé ne se supprime pas', async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000)
    // La base est partagée avec les autres parcours et, sur la CI, avec la première tentative : chaque essai a son
    // patient et son numéro (deux noms sans ressemblance, la détection de doublon refuserait le second).
    const attempt = Math.min(testInfo.retry, 1)
    const lastName =
      ['Suppression Brouillon', 'Retrait Provisoire'][attempt] ?? 'Suppression Brouillon'
    await signIn(page, 'RECEPTION')
    await createPatient(page, lastName, `+237 600 00 13 0${attempt + 1}`)
    await registerArrivalFromRecord(page, lastName)

    await switchTo(page, 'CLINICIAN')
    const draftId = await startFromQueue(page, lastName)

    // L'éditeur d'un brouillon propose « Supprimer le brouillon » (l'examen se remplit dans la même page).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Supprimer le brouillon' })).toBeVisible()

    // Dans la liste, la carte du brouillon porte « Modifier » et « Supprimer ».
    await page.getByRole('link', { name: 'Retour aux consultations' }).click()
    await expect(page).toHaveURL(/\/consultations$/)
    // La carte de l'examen (`li.card` : les listes imbriquées de la carte n'ont pas cette classe).
    const examCard = page.locator('li.card').filter({ hasText: new RegExp(lastName, 'i') })
    const card = examCard.getByRole('link', { name: new RegExp(lastName, 'i') }).first()
    await expect(card).toBeVisible()
    await expect(examCard.getByText('Brouillon', { exact: true })).toBeVisible()
    await expect(
      examCard.getByRole('link', { name: new RegExp(`^Modifier l’examen de .*${lastName}`, 'i') }),
    ).toBeVisible()
    const remove = examCard.getByRole('button', {
      name: new RegExp(`^Supprimer l’examen de .*${lastName}`, 'i'),
    })
    await expect(remove).toBeVisible()

    // Capture visuelle de la liste : 1366 px puis 360 px (téléphone).
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.screenshot({ path: 'test-results/crud-consultations-liste-1366.png' })
    await page.setViewportSize({ width: 360, height: 780 })
    await expect(remove).toBeVisible()
    await page.screenshot({ path: 'test-results/crud-consultations-liste-360.png', fullPage: true })
    await page.setViewportSize({ width: 1280, height: 800 })

    // « Garder le brouillon » : rien n'est supprimé.
    await remove.click()
    const confirm = page.getByRole('dialog', {
      name: new RegExp(`^Supprimer l’examen de .*${lastName}`, 'i'),
    })
    await expect(confirm).toBeVisible()
    await confirm.screenshot({ path: 'test-results/crud-consultations-confirmation.png' })
    await confirm.getByRole('button', { name: 'Garder le brouillon' }).click()
    await expect(confirm).toBeHidden()
    await expect(card).toBeVisible()

    // Confirmer supprime : message, carte disparue, examen introuvable.
    await remove.click()
    await confirm.getByRole('button', { name: 'Supprimer le brouillon' }).click()
    await expect(page.getByRole('main')).toContainText('Examen supprimé')
    await expect(page.getByRole('main')).toContainText('Sa visite est revenue dans la file du jour')
    await expect(page.getByRole('link', { name: new RegExp(lastName, 'i') })).toHaveCount(0)
    expect((await api(page, 'GET', `/api/v1/consultations/${draftId}`)).status).toBe(404)
    expect((await deleteDirectly(page, draftId)).status).toBe(404)

    // La visite est revenue dans la file du jour : l'examen se redémarre pour le même patient.
    const secondId = await startFromQueue(page, lastName)
    expect(secondId).not.toBe(draftId)
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()

    // Un examen EN COURS (une rubrique enregistrée) ne propose plus « Supprimer le brouillon » et le serveur refuse.
    await page.getByLabel('Plaintes et symptômes').fill('Gêne le soir (fictif)')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText('Enregistré sur le serveur').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Supprimer le brouillon' })).toHaveCount(0)
    const inProgress = await deleteDirectly(page, secondId)
    expect(inProgress.status).toBe(409)
    expect(inProgress.json.error?.code).toBe('STATE_TRANSITION_REFUSED')
    expect(inProgress.json.error?.details?.['current_status']).toBe('IN_PROGRESS')

    await page.goto('/consultations')
    const inProgressCard = page.locator('li.card').filter({ hasText: new RegExp(lastName, 'i') })
    await expect(inProgressCard.getByText('En cours', { exact: true })).toBeVisible()
    await expect(
      inProgressCard.getByRole('link', {
        name: new RegExp(`^Modifier l’examen de .*${lastName}`, 'i'),
      }),
    ).toBeVisible()
    // Cette carte seulement : la liste du jour contient aussi les brouillons des autres parcours.
    await expect(
      inProgressCard.getByRole('button', { name: /^Supprimer l’examen de/ }),
    ).toHaveCount(0)

    // Terminer l'examen : lecture seule, aucune suppression, refus du serveur.
    await page.goto(`/consultations/${secondId}`)
    await stepper(page)
      .getByRole('button', { name: /Conclusion et orientation/ })
      .click()
    await page.getByLabel('Conclusion', { exact: true }).fill('Contrôle fictif à prévoir')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()
    await page.getByRole('button', { name: 'Terminer l’examen' }).click()
    const finish = page.getByRole('dialog', { name: 'Terminer l’examen ?' })
    await finish.getByRole('button', { name: 'Terminer l’examen' }).click()
    await expect(page.getByText('Examen terminé')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Supprimer le brouillon' })).toHaveCount(0)
    const completed = await deleteDirectly(page, secondId)
    expect(completed.status).toBe(409)
    expect(completed.json.error?.code).toBe('STATE_TRANSITION_REFUSED')
    expect(completed.json.error?.details?.['current_status']).toBe('COMPLETED')

    // Contrôle recommandé de l'examen terminé : il se programme puis s'annule avec un motif (jamais supprimé : il reste
    // lisible dans la consultation, marqué annulé).
    const panel = page.locator('section[aria-labelledby="titre-controle"]')
    await panel.getByRole('button', { name: 'Programmer un contrôle' }).click()
    await expect(
      panel.getByRole('status').filter({ hasText: 'Date recommandée' }),
    ).not.toContainText('à compléter')
    await panel.getByRole('button', { name: 'Enregistrer le contrôle' }).click()
    await expect(panel).toContainText('Contrôle recommandé enregistré sur le serveur.')
    await panel.getByRole('button', { name: /^Annuler le contrôle de/ }).click()
    const cancelFollowUp = page.getByRole('dialog', { name: /^Annuler le contrôle de/ })
    await cancelFollowUp.getByRole('button', { name: 'Annuler le contrôle' }).click()
    await expect(cancelFollowUp).toContainText('Indiquez le motif de l’annulation')
    await cancelFollowUp.getByLabel(/Motif de l’annulation/).fill('Patient suivi ailleurs (fictif)')
    await cancelFollowUp.getByRole('button', { name: 'Annuler le contrôle' }).click()
    await expect(panel).toContainText('Le contrôle recommandé a été annulé')
    await expect(panel.getByText('Annulé', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^Annuler le contrôle de/ })).toHaveCount(0)

    // Dans la liste, « Modifier » d'un examen terminé ouvre la correction (nouvelle révision), jamais « Supprimer ».
    await page.goto('/consultations')
    const completedCard = page.locator('li.card').filter({ hasText: new RegExp(lastName, 'i') })
    await expect(completedCard.getByText('Terminé', { exact: true })).toBeVisible()
    await expect(completedCard.getByRole('button', { name: /^Supprimer l’examen de/ })).toHaveCount(
      0,
    )
    await completedCard
      .getByRole('link', { name: new RegExp(`^Modifier l’examen de .*${lastName}`, 'i') })
      .click()
    await expect(page).toHaveURL(new RegExp(`/consultations/${secondId}\\?corriger=1$`))
    await expect(page.getByText('Correction en cours')).toBeVisible()
    expect((await api(page, 'GET', `/api/v1/consultations/${secondId}`)).status).toBe(200)
  })
})

import { expect, test, type Browser, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Devis versionnés et conversion en facture (L1D07) EN LIGNE sur la vraie application : la caisse établit un devis
 * pour un patient (monture fictive), l'émet (numéro TEST-DEV-…), le révise avec un motif (la révision 1 reste
 * listée), puis le convertit en BROUILLON de facture après avoir confirmé les prix : la facture s'ouvre sans numéro,
 * rattachée au devis d'origine. Aucun « payé », « soldé » ni « acquitté ». Articles DEMO-* et patient FICTIFS.
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

/** Fiche créée par l'accueil ; rend son identifiant (base e2e partagée par l'exécution). */
async function createPatient(browser: Browser, lastName: string, phone: string): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, 'RECEPTION')
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/03/1985')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  await context.close()
  return id
}

async function addCatalogLine(page: Page, search: string, name: RegExp): Promise<void> {
  await page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }).fill(search)
  await page.getByRole('option', { name }).click()
}

/** Date civile JJ/MM/AAAA dans `days` jours (validité du devis, toujours dans le futur). */
function inDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

test.describe('devis versionnés (L1D07) sur la vraie application', () => {
  test('établir, émettre, réviser puis convertir en brouillon de facture', async ({ browser }) => {
    test.setTimeout(180_000)
    const patientId = await createPatient(browser, 'Devis Parcours', '+237 600 00 07 07')

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    const main = page.getByRole('main')

    // Brouillon : patient présélectionné (identité relue, jamais ressaisie), une monture, une validité.
    await page.goto(`/ventes/devis/nouveau?patient=${patientId}`)
    await expect(main).toContainText('Devis Parcours')
    await page.getByLabel(/Valable jusqu’au/).fill(inDays(30))
    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await expect(main).toContainText('Total TTC du devis : 40 000 FCFA')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/devis\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(main).toContainText('Brouillon de devis enregistré sur le serveur.')
    await expect(main).not.toContainText('TEST-DEV-')

    // Émission : numéro de la série des devis, révision 1 figée.
    await page.getByRole('button', { name: 'Émettre le devis' }).click()
    const dialog = page.getByRole('dialog', { name: 'Émettre le devis ?' })
    await expect(dialog).toContainText('Un devis ne vaut pas facture')
    await dialog.getByRole('button', { name: 'Émettre le devis' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: /^Devis TEST-DEV-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    await expect(main).toContainText('Devis — ne vaut pas facture.')
    await expect(main).toContainText('Révision 1')

    // Révision : motif obligatoire ; la révision 1 reste listée et réimprimable.
    await page.getByRole('button', { name: 'Réviser le devis' }).click()
    await page.getByLabel(/Motif de la révision/).fill('Ajout de l’examen de vue (fictif)')
    await addCatalogLine(page, 'DEMO-EXA', /Examen de vue \(fictif\)/)
    await expect(main).toContainText('Total TTC du devis : 55 000 FCFA')
    await page.getByRole('button', { name: 'Enregistrer la révision' }).click()
    await expect(main).toContainText('Révision 2 enregistrée')
    await expect(main).toContainText('Révision 2 (actuelle)')
    await expect(main).toContainText('Révision 1')
    await expect(main.getByRole('button', { name: /PDF de la révision 1 du devis/ })).toBeVisible()

    // Conversion : prix confirmés explicitement, brouillon de facture lié au devis, aucun numéro de facture.
    await page.getByRole('button', { name: 'Convertir en facture' }).click()
    await expect(main).toContainText('Prix de la révision et du catalogue actuel')
    await page.getByLabel('J’ai vérifié les prix de chaque ligne').check()
    await page.getByRole('button', { name: 'Créer le brouillon de facture' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(main).toContainText('Brouillon de facture créé depuis le devis')
    await expect(main.getByRole('link', { name: /ouvrir le devis d’origine/ })).toBeVisible()
    await expect(main).toContainText('Total TTC : 55 000 FCFA')
    await expect(main).not.toContainText('TEST-FAC-')

    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text).not.toContain(word)
    await context.close()
  })

  test('un brouillon jamais émis se supprime ; un devis émis ne propose pas la suppression et le serveur la refuse', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const patientId = await createPatient(browser, 'Devis Suppression', '+237 600 00 07 08')

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    const main = page.getByRole('main')

    // Un brouillon enregistré : « Supprimer le brouillon » après confirmation, retour à la liste avec le résultat.
    await page.goto(`/ventes/devis/nouveau?patient=${patientId}`)
    await page.getByLabel(/Valable jusqu’au/).fill(inDays(30))
    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/devis\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(main).toContainText('Brouillon de devis enregistré sur le serveur.')
    const draftId = new URL(page.url()).pathname.split('/').pop() ?? ''

    await page.getByRole('button', { name: 'Supprimer le brouillon' }).click()
    const dialog = page.getByRole('dialog', { name: 'Supprimer ce brouillon de devis ?' })
    await expect(dialog).toContainText('il n’a ni numéro ni révision')
    await dialog.getByRole('button', { name: 'Garder le brouillon' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Supprimer le brouillon' }).click()
    await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/devis$/)
    await expect(main).toContainText('Le brouillon de devis a été supprimé.')
    expect((await api(page, 'GET', `/api/v1/quotes/${draftId}`)).status).toBe(404)

    // Un devis ÉMIS ne propose pas la suppression (il se révise) et le serveur la refuse même envoyée directement.
    await page.goto(`/ventes/devis/nouveau?patient=${patientId}`)
    await page.getByLabel(/Valable jusqu’au/).fill(inDays(30))
    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/devis\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const issuedId = new URL(page.url()).pathname.split('/').pop() ?? ''
    await page.getByRole('button', { name: 'Émettre le devis' }).click()
    await page
      .getByRole('dialog', { name: 'Émettre le devis ?' })
      .getByRole('button', { name: 'Émettre le devis' })
      .click()
    await expect(
      page.getByRole('heading', { level: 1, name: /^Devis TEST-DEV-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Supprimer le brouillon' })).toHaveCount(0)
    const read = await api(page, 'GET', `/api/v1/quotes/${issuedId}`)
    const refused = await api(page, 'POST', `/api/v1/quotes/${issuedId}/delete`, {
      expected_version: Number(read.json.data?.['version'] ?? 1),
      quote_id: issuedId,
    })
    expect(refused.status).toBe(409)
    expect(refused.json.error?.code).toBe('STATE_TRANSITION_REFUSED')
    await context.close()
  })
})

interface ApiResult {
  status: number
  json: { data?: Record<string, unknown>; error?: { code: string } }
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
    {
      method,
      path,
      body,
      key: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
    },
  )
}

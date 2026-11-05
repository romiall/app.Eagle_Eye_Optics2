import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './accounts'

/**
 * Gestes communs des parcours « poste préparé » (O01 à O07) : connexion, confirmation du mot de passe de la gérante,
 * navigation interne sans réseau, lectures de contrôle de l'API, coffre et préparation complète d'un poste.
 */

export async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Confirme le mot de passe de la gérante si le serveur le demande (423), puis attend le succès. */
export async function confirmPasswordIfAsked(page: Page, success: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  // L'inscription et la préparation d'un poste demandent des calculs de signature : le serveur de test, qui traite une
  // requête à la fois, peut dépasser les 20 s habituelles sur un poste chargé.
  const slow = { timeout: 60_000 }
  await expect(dialog.or(success).first()).toBeVisible(slow)
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
    await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
  }
  await expect(success.first()).toBeVisible(slow)
}

/** Navigation interne de l'application (sans rechargement ni réseau) : comme un lien du menu. */
export async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/?]/g, '\\$&')}$`))
}

/**
 * Requêtes de l'API avec la session et le jeton CSRF du navigateur (lectures de contrôle, préparation). Sanctum ne
 * reconnaît la session que pour une requête venue de l'origine de la SPA : Origin et Referer sont donc fournis.
 */
export async function api(
  page: Page,
): Promise<{ request: APIRequestContext; headers: Record<string, string> }> {
  const context = page.context()
  const origin = new URL(page.url()).origin
  const token =
    (await context.cookies()).find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? ''
  return {
    request: context.request,
    headers: {
      Accept: 'application/json',
      Origin: origin,
      Referer: `${origin}/`,
      'X-XSRF-TOKEN': decodeURIComponent(token),
    },
  }
}

/** Ligne « Coffre ouvert : … » (le gabarit la précède d'une espace : pas d'ancre ^ sur le texte brut). */
export function vaultOpened(page: Page): Locator {
  return page.getByText(/Coffre ouvert :/)
}

export async function unlockVault(page: Page, secret: string): Promise<void> {
  await expect(page.getByRole('heading', { name: '2. Ouvrir le coffre de ce poste' })).toBeVisible()
  await page.getByLabel('Profil').selectOption({ index: 1 })
  await page.getByLabel('Secret local').fill(secret)
  await page.getByRole('button', { name: 'Ouvrir le coffre' }).click()
  await expect(vaultOpened(page)).toBeVisible()
}

/** Déverrouille depuis l'écran PUBLIC de déverrouillage (un seul profil sur ce poste : présélectionné). */
export async function unlockFromPublicScreen(page: Page, secret: string): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
  ).toBeVisible()
  await page.getByLabel('Secret local').fill(secret)
  await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
}

/** Numéro d'une pièce (`TEST-REC-2026-000051` → 51). */
export function numberValue(rendered: string): number {
  return Number((/-(\d+)$/.exec(rendered) ?? ['', '0'])[1])
}

/**
 * Prépare complètement CE poste, en ligne, depuis « Préparer ce poste » : coffre chiffré (clé de récupération ressaisie),
 * ouverture, enrôlement, autorisation signée du profil de la gérante, numéros réservés (sauf `reserveNumbers: false`).
 * Rend la clé de récupération
 * affichée (à garder HORS du poste) ; le coffre reste ouvert.
 */
export async function prepareThisDevice(
  page: Page,
  input: { secret: string; code: string; name: string; reserveNumbers?: boolean },
): Promise<{ recoveryKey: string }> {
  const manager = demoAccount('MANAGER')
  await page.goto('/parametres/poste')
  await expect(page.getByRole('heading', { level: 1, name: 'Préparer ce poste' })).toBeVisible()
  await page.getByLabel('Secret local de la gérante').fill(input.secret)
  await page.getByRole('button', { name: 'Créer le coffre' }).click()
  const recovery = page
    .getByText(/Clé de récupération/)
    .locator('..')
    .locator('p.font-mono')
  await expect(recovery).toBeVisible()
  const recoveryKey = (await recovery.innerText()).trim()
  await page.getByLabel('Ressaisir la clé de récupération').fill(recoveryKey)
  await page.getByRole('button', { name: 'Confirmer et créer le coffre' }).click()
  // Le coffre créé reste fermé : attendre la fin de la création (étape 2 ou coffre déjà ouvert) avant de décider.
  const unlockStep = page.getByRole('heading', { name: '2. Ouvrir le coffre de ce poste' })
  await expect(unlockStep.or(vaultOpened(page)).first()).toBeVisible()
  if (await unlockStep.isVisible()) await unlockVault(page, input.secret)
  await expect(vaultOpened(page)).toBeVisible()

  await page.getByLabel('Code du poste').fill(input.code)
  await page.getByLabel('Nom du poste').fill(input.name)
  await page.getByLabel('Votre secret local (confirmation)').fill(input.secret)
  await page.getByRole('button', { name: 'Enrôler ce poste' }).click()
  await confirmPasswordIfAsked(
    page,
    page.getByRole('heading', { name: '3. Préparer les profils de ce poste' }),
  )

  // Autorisation signée du profil de la gérante (déjà présent sur ce poste), puis réouverture pour la prendre.
  const self = page.getByRole('listitem').filter({ hasText: `(${manager.login})` })
  await self.getByRole('button', { name: 'Préparer l’autorisation' }).click()
  await confirmPasswordIfAsked(page, self.getByText(/Autorisation vérifiée jusqu’au/))
  await page.getByRole('button', { name: 'Verrouiller le coffre' }).click()
  await unlockVault(page, input.secret)

  if (input.reserveNumbers !== false) await reserveNumbers(page)
  return { recoveryKey }
}

/** Numéros réservés pour ce poste (dossiers, factures, reçus), coffre ouvert. */
export async function reserveNumbers(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Réserver les numéros' }).click()
  await confirmPasswordIfAsked(
    page,
    page.getByText(/Ressources conservées sur ce poste : 3 plage\(s\)/),
  )
}

/** Identifiant serveur d'un poste d'après son code. */
export async function deviceIdByCode(page: Page, code: string): Promise<string> {
  const { request, headers } = await api(page)
  const response = await request.get('/api/v1/devices', { headers })
  expect(response.status(), await response.text()).toBe(200)
  const devices = (await response.json()) as { data: { device_id: string; device_code: string }[] }
  const deviceId = devices.data.find((device) => device.device_code === code)?.device_id ?? ''
  expect(deviceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  return deviceId
}

/** Plage de numéros réservée à un poste pour un type de pièce. */
export async function numberRange(
  page: Page,
  deviceId: string,
  type: 'PATIENT' | 'INVOICE' | 'RECEIPT',
): Promise<{ start: number; end: number }> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/devices/${deviceId}/preparation`, { headers })
  expect(response.status(), await response.text()).toBe(200)
  const preparation = (await response.json()) as {
    data: {
      number_allocations: { document_type: string; range_start: string; range_end: string }[]
    }
  }
  const found = preparation.data.number_allocations.find(
    (allocation) => allocation.document_type === type,
  )
  return { start: Number(found?.range_start ?? 0), end: Number(found?.range_end ?? 0) }
}

/**
 * Facture d'examen fictif émise EN LIGNE pour un nouveau patient, puis attribuée au poste pour y être encaissée sans
 * réseau. Rend le chemin et l'identifiant de la facture.
 */
export async function issueInvoiceForDevice(
  page: Page,
  input: {
    deviceId: string
    patientName: string
    phone: string
    run: string
    /** Article facturé (défaut : un examen de vue fictif) et sa quantité. */
    item?: { search: string; option: RegExp; quantity?: number }
  },
): Promise<{ invoicePath: string; invoiceId: string }> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(input.patientName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/03/1985')
  await page.getByLabel('Téléphone principal').fill(input.phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  // Coffre verrouillé par le rechargement : cette fiche part au serveur par la route directe.
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  await page.getByRole('link', { name: 'Créer une facture' }).click()
  const item = input.item ?? { search: 'DEMO-EXA', option: /Examen de vue \(fictif\)/ }
  await page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }).fill(item.search)
  await page.getByRole('option', { name: item.option }).click()
  if (item.quantity !== undefined) {
    await page.getByLabel(/^Quantité \(/).fill(String(item.quantity))
    await page.getByLabel(/^Quantité \(/).blur()
  }
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
  await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const invoicePath = new URL(page.url()).pathname
  const invoiceId = invoicePath.split('/').pop() ?? ''
  await page.getByRole('button', { name: 'Émettre la facture' }).click()
  await page
    .getByRole('dialog', { name: 'Émettre la facture ?' })
    .getByRole('button', { name: 'Émettre la facture' })
    .click()
  await expect(
    page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
  ).toBeVisible()

  const { request, headers } = await api(page)
  const meResponse = await request.get('/api/v1/auth/me', { headers })
  expect(meResponse.status(), await meResponse.text()).toBe(200)
  const me = (await meResponse.json()) as { data: { id: string } }
  const attributed = await request.post(`/api/v1/devices/${input.deviceId}/prepare`, {
    headers: { ...headers, 'Idempotency-Key': `e2e-attribution-${input.run}` },
    data: { expected_version: null, profiles: [me.data.id], invoice_ids: [invoiceId] },
  })
  expect(attributed.status(), await attributed.text()).toBe(200)
  return { invoicePath, invoiceId }
}

/** Valide un encaissement mobile money saisi : « enregistré sur ce poste » seulement, jamais « sur le serveur ». */
async function submitMobileMoneyPayment(page: Page, reference: string): Promise<void> {
  await page.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
  await page.getByLabel('Référence de l’opération').fill(reference)
  await page.getByRole('button', { name: /^Encaisser \d/ }).click()
  const main = page.getByRole('main')
  await expect(main).toContainText(
    'Encaissement enregistré sur ce poste, en attente de synchronisation avec le serveur.',
  )
  await expect(main).not.toContainText('Encaissement enregistré sur le serveur')
}

/** Encaissement mobile money du reste de la facture affichée, réseau coupé : « enregistré sur ce poste » seulement. */
export async function payRemainingOffline(page: Page, reference: string): Promise<void> {
  await page.getByRole('button', { name: /^Encaisser le reste/ }).click()
  await submitMobileMoneyPayment(page, reference)
}

/** Encaissement mobile money d'un montant saisi (acompte), réseau coupé : « enregistré sur ce poste » seulement. */
export async function payAmountOffline(
  page: Page,
  amount: string,
  reference: string,
): Promise<void> {
  await page.getByLabel('Montant encaissé').fill(amount)
  await page.getByLabel('Montant encaissé').blur()
  await submitMobileMoneyPayment(page, reference)
}

/** Paiements d'une facture lus sur le serveur. */
export async function invoicePayments(
  page: Page,
  invoiceId: string,
): Promise<{ reference: string | null; receipt_number: string | null }[]> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/invoices/${invoiceId}`, { headers })
  expect(response.status(), await response.text()).toBe(200)
  return (
    (await response.json()) as {
      data: { payments: { reference: string | null; receipt_number: string | null }[] }
    }
  ).data.payments
}

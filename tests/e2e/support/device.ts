import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test'

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

/**
 * Reçoit l'annuaire depuis l'en-tête : des échanges jusqu'à ce que le serveur n'ait plus rien à publier (une page de pull
 * ne porte que 100 changements, un échange 20 pages). Ouvre au moins un échange, jamais plus de huit.
 */
export async function receiveDirectory(page: Page): Promise<void> {
  const sync = page.getByRole('button', { name: 'Synchroniser', exact: true })
  const hasMore: boolean[] = []
  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/v1/sync/pull')) return
    void response
      .json()
      .then((body: { has_more?: boolean }) => hasMore.push(body.has_more === true))
      .catch(() => undefined)
  })
  for (let round = 1; round <= 8; round += 1) {
    hasMore.length = 0
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/sync/pull'), {
        timeout: 120_000,
      }),
      sync.click(),
    ])
    // Le bouton reprend son nom quand l'échange est terminé.
    await expect(sync).toBeVisible({ timeout: 120_000 })
    if (hasMore.at(-1) !== true) return
  }
  throw new Error('Le serveur a encore des changements à publier après huit échanges.')
}

/** Retrouve la fiche par la recherche de l'écran « Patients » (serveur injoignable) puis l'ouvre. */
export async function openFromSearch(page: Page, name: string): Promise<void> {
  await navigateInApp(page, '/patients')
  await page.getByRole('searchbox', { name: 'Rechercher un patient' }).fill(name)
  await page.getByRole('button', { name: 'Rechercher' }).click()
  const main = page.getByRole('main')
  await expect(main).toContainText('Données de ce poste seulement')
  await main.getByRole('link', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
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

export interface JournalHead {
  sequence: string
  hash: string
}

/** Tête du journal du poste, lue dans les lots envoyés par TOUS les onglets du contexte (pour rendre les ressources). */
export function trackJournalHead(context: BrowserContext): { head: JournalHead | null } {
  const journal: { head: JournalHead | null } = { head: null }
  context.on('request', (request) => {
    if (!request.url().endsWith('/api/v1/sync/push')) return
    const body = request.postDataJSON() as {
      commands?: { core: { device_sequence: string | number }; event_hash: string }[]
    } | null
    for (const command of body?.commands ?? []) {
      const sequence = String(command.core.device_sequence)
      if (journal.head === null || Number(sequence) > Number(journal.head.sequence)) {
        journal.head = { sequence, hash: command.event_hash }
      }
    }
  })
  return journal
}

/** Rend les ressources du poste (reprise complète) : la gérante se réauthentifie, puis clôture. */
export async function releaseDevice(
  page: Page,
  deviceId: string,
  journal: { head: JournalHead | null },
  key: string,
  reason = 'Fin du parcours (e2e)',
): Promise<void> {
  expect(journal.head, 'tête du journal lue dans un lot envoyé').not.toBeNull()
  const { request, headers } = await api(page)
  const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
    headers,
    data: { password: demoAccount('MANAGER').password },
  })
  expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
  const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: {
      expected_version: null,
      last_device_sequence: journal.head?.sequence,
      last_event_hash: journal.head?.hash,
      reason,
    },
  })
  expect(released.status(), await released.text()).toBe(200)
}

/** Création d'un patient SANS réseau (le serveur ne peut pas vérifier les doublons : la gérante crée sans vérification). */
export async function createPatientOnDevice(
  page: Page,
  input: { name: string; phone: string; birth: string },
): Promise<void> {
  await navigateInApp(page, '/patients/nouveau')
  await fillNewPatient(page, input)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await confirmCreateWithoutCheck(page)
  await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
}

export async function fillNewPatient(
  page: Page,
  input: { name: string; phone: string; birth: string },
): Promise<void> {
  await page.getByLabel('Nom (obligatoire)').fill(input.name)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill(input.birth)
  await page.getByLabel('Téléphone principal').fill(input.phone)
}

export async function confirmCreateWithoutCheck(page: Page): Promise<void> {
  const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
  await expect(noCheck).toContainText('le serveur n’est pas joignable (pas de connexion)')
  await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
}

/**
 * Profil local d'un membre du personnel, ajouté PAR LA GÉRANTE en ligne sur la page « Préparer ce poste » : autorisation
 * signée du serveur, puis profil local avec le secret choisi par la personne. Rend la ligne d'autorisation affichée (elle
 * liste les compartiments accordés).
 */
export async function addLocalProfile(
  page: Page,
  role: string,
  holderSecret: string,
  managerSecret: string,
): Promise<string> {
  const account = demoAccount(role)
  const item = page.getByRole('listitem').filter({ hasText: `(${account.login})` })
  await item.getByRole('button', { name: 'Préparer l’autorisation' }).click()
  await confirmPasswordIfAsked(page, item.getByText(/Autorisation vérifiée jusqu’au/))
  const claims = (await item.getByText(/Autorisation vérifiée jusqu’au/).innerText()).trim()
  await item.getByRole('button', { name: 'Ajouter le profil local' }).click()
  await item.getByLabel('Secret local de la personne (saisi par elle)').fill(holderSecret)
  await item.getByLabel('Votre secret local (confirmation)').fill(managerSecret)
  await item.getByRole('button', { name: 'Enregistrer le profil local' }).click()
  await expect(item.getByText('Profil local présent sur ce poste.')).toBeVisible()
  return claims
}

/** Déverrouille le profil d'identifiant de connexion `login` depuis l'écran PUBLIC de déverrouillage (plusieurs profils). */
export async function unlockProfile(page: Page, login: string, secret: string): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
  ).toBeVisible()
  const profile = page.getByLabel('Profil')
  const options = await profile.locator('option').allInnerTexts()
  const label = options.find((option) => option.includes(`(${login})`))
  if (label === undefined) {
    throw new Error(
      `Le profil ${login} n’est pas proposé sur l’écran de déverrouillage : ${options.join(' | ')}`,
    )
  }
  await profile.selectOption({ label })
  await page.getByLabel('Secret local').fill(secret)
  await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Ouvre une session du SERVEUR depuis le lien « Se connecter au serveur » (le coffre déverrouillé reste ouvert). */
export async function logInToServer(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.getByRole('link', { name: 'Se connecter au serveur' }).click()
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Fiches du serveur dont le nom contient le texte (recherche de l'API). */
export async function patientsNamed(
  page: Page,
  name: string,
): Promise<{ id: string; record_number: string }[]> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/patients?query=${encodeURIComponent(name)}`, {
    headers,
  })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: { id: string; record_number: string }[] }).data
}

/** Factures du serveur d'un patient (numéro et état). */
export async function invoicesOf(
  page: Page,
  patientId: string,
): Promise<{ id: string; number: string; status: string }[]> {
  const { request, headers } = await api(page)
  const response = await request.get(`/api/v1/invoices?patient_id=${patientId}`, { headers })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: { id: string; number: string; status: string }[] })
    .data
}

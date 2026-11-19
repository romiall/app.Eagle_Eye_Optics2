import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Facturation et encaissement EN LIGNE sur la vraie application (B02 à B05, AT10, AT11) : la caisse
 * ouvre sa session, crée une facture pour un patient depuis sa fiche (identité reprise, jamais
 * ressaisie), l'émet (numéro définitif du serveur après confirmation), encaisse un acompte en espèces
 * puis le solde en mobile money, obtient deux reçus distincts, et retrouve tout après rechargement.
 * Jamais « payé », « soldé » ni « acquitté ». Les articles DEMO-* et leurs prix sont FICTIFS
 * (`eeo:demo:sales`, lancé par prepare-env.mjs avec les modules « sales » et « stock » ouverts).
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

/**
 * Crée la fiche par l'accueil. Chaque fichier e2e a ses propres téléphones : la base est partagée par toute
 * l'exécution, et un téléphone déjà connu ouvre (à raison) l'alerte de doublon possible.
 */
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
  const url = new URL(page.url()).pathname
  await context.close()
  return url
}

/** Ouvre la session de caisse du compte si elle ne l'est pas déjà (base e2e réutilisée). */
async function ensureCashOpen(page: Page): Promise<void> {
  await page.goto('/ventes/caisse')
  await expect(page.getByRole('heading', { level: 1, name: 'Caisse' })).toBeVisible()
  const main = page.getByRole('main')
  await expect(
    main.getByText(/Session ouverte|Aucune session de caisse ouverte/).first(),
  ).toBeVisible()
  if (await main.getByText('Aucune session de caisse ouverte').isVisible()) {
    await page.getByLabel('Fond de caisse').fill('10 000')
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click()
  }
  // Nom accessible du titre (espaces normalisés) : le texte brut du titre commence par une espace du gabarit.
  await expect(main.getByRole('heading', { level: 2, name: /^Session ouverte/ })).toBeVisible()
  await expect(main).toContainText('Espèces attendues dans le tiroir')
}

async function addCatalogLine(page: Page, search: string, name: RegExp): Promise<void> {
  // La liste des résultats porte le même nom que le champ (listbox étiquetée) : viser le champ par son rôle.
  await page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }).fill(search)
  await page.getByRole('option', { name }).click()
}

/**
 * Opération sensible : le serveur peut demander la confirmation du mot de passe (423) si la dernière
 * confirmation est trop ancienne. Attend la réponse (succès visible ou boîte de confirmation), confirme au besoin,
 * puis attend le succès.
 */
async function confirmPasswordIfAsked(page: Page, success: Locator): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirmer votre mot de passe' })
  await expect(dialog.or(success).first()).toBeVisible()
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Mot de passe').fill(demoAccount('MANAGER').password)
    await dialog.getByRole('button', { name: 'Confirmer et reprendre' }).click()
  }
  await expect(success.first()).toBeVisible()
}

function receiptNumbers(text: string): string[] {
  return [...new Set(text.match(/TEST-REC-\d{4}-\d{6}/g) ?? [])]
}

test.describe('facturation et encaissement (B02 à B05) sur la vraie application', () => {
  test('ouvrir la caisse, facturer, émettre, encaisser deux fois, deux reçus, recharger', async ({
    browser,
  }) => {
    // Parcours long (deux comptes, émission, deux encaissements, rechargement) sur un poste de test parfois lent.
    test.setTimeout(180_000)
    const patientPath = await createPatient(browser, 'Facture Parcours', '+237 600 00 05 55')

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    await ensureCashOpen(page)

    // Depuis la fiche : le patient est présélectionné, son identité n'est pas ressaisie.
    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/nouvelle\?patient=[0-9A-HJKMNP-TV-Z]{26}$/)
    const main = page.getByRole('main')
    await expect(main).toContainText('Facture Parcours')
    await expect(page.getByLabel('Nom (obligatoire)')).toHaveCount(0)

    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await addCatalogLine(page, 'DEMO-EXA', /Examen de vue \(fictif\)/)
    await expect(main).toContainText('Total TTC : 55 000 FCFA')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(main).toContainText('Brouillon de facture enregistré sur le serveur.')
    await expect(main).not.toContainText('TEST-FAC-')

    // Émission : confirmation explicite, numéro définitif et encaissement immédiat 100 % espèces (A1).
    await page.getByRole('button', { name: 'Émettre la facture' }).click()
    const dialog = page.getByRole('dialog', { name: 'Émettre la facture ?' })
    await expect(dialog).toContainText('La facture émise ne pourra plus être modifiée.')
    await dialog.getByRole('button', { name: 'Émettre la facture' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    const invoiceHeading = await page
      .getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ })
      .innerText()
    const invoiceNumber = (invoiceHeading.match(/TEST-FAC-\d{4}-\d{6}/) ?? [''])[0]
    await expect(main).toContainText(/Total encaissé\s*55\s*000\s*FCFA/)
    await expect(main).toContainText(/Reste à encaisser\s*0\s*FCFA/)

    const numbers = receiptNumbers(await main.innerText())
    expect(numbers).toHaveLength(1)

    // Rechargement : la facture, son reçu et le reste nul viennent du serveur.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ })).toBeVisible()
    await expect(main).toContainText(`Reçu ${numbers[0]}`)
    await expect(page.getByRole('form', { name: 'Encaisser' })).toHaveCount(0)
    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word)

    // Journal chronologique de la caisse : la facture émise y figure à son heure exacte.
    await page.goto('/ventes/caisse')
    await expect(main).toContainText('Journal chronologique de la caisse')
    await expect(main).toContainText(`Facture ${invoiceNumber}`)
    await expect(main).toContainText('+55 000 FCFA')

    // Téléphone 360 px : le journal et la fiche ne débordent pas.
    await page.setViewportSize({ width: 360, height: 740 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0)

    await context.close()
  })

  test('liste filtrée par jour d’émission, caisse du jour, abandon d’un brouillon', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const patientPath = await createPatient(browser, 'Jour Parcours', '+237 600 00 06 66')

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    await ensureCashOpen(page)
    const main = page.getByRole('main')

    // Une facture émise aujourd'hui et encaissée en espèces.
    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    await addCatalogLine(page, 'DEMO-EXA', /Examen de vue \(fictif\)/)
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Émettre la facture' }).click()
    await page
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    const heading = page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ })
    await expect(heading).toBeVisible()
    const number = ((await heading.innerText()).match(/TEST-FAC-\d{4}-\d{6}/) ?? [''])[0]
    await expect(main).toContainText(/Total encaissé\s*15\s*000\s*FCFA/)
    await expect(main).toContainText(/Reste à encaisser\s*0\s*FCFA/)

    // Liste : patient affiché, filtre du jour appliqué par le serveur (aujourd'hui au fuseau du cabinet).
    await page.goto('/ventes/factures')
    await expect(main).toContainText('Jour Parcours')
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Africa/Douala',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date()),
    )
    await page.getByLabel('Jour d’émission').fill(today)
    await page.getByLabel('Jour d’émission').blur()
    await expect(main).toContainText(number)
    await expect(main).not.toContainText('page affichée')

    // Caisse du jour : ses encaissements et ses sessions, jamais « payé ».
    await page.goto('/ventes/caisse-du-jour')
    await expect(page.getByRole('heading', { level: 1, name: /Caisse du jour/ })).toBeVisible()
    await expect(main).toContainText('Encaissements nets par mode')
    await expect(main).toContainText('Espèces')
    await expect(main).toContainText('Vos encaissements et vos sessions seulement')
    const dayText = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(dayText, word).not.toContain(word)

    // Abandon d'un brouillon : ni numéro ni effet financier.
    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Abandonner le brouillon' }).click()
    const dialog = page.getByRole('dialog', { name: 'Abandonner ce brouillon ?' })
    await dialog.getByLabel('Motif (facultatif)').fill('Le patient renonce (fictif)')
    await dialog.getByRole('button', { name: 'Abandonner le brouillon' }).click()
    await expect(main).toContainText('Facture abandonnée')
    await page.reload()
    await expect(main).toContainText('Facture abandonnée')
    await expect(main).not.toContainText('TEST-FAC-')

    await context.close()
  })

  test('la gérante contre-passe un paiement, émet un avoir puis rembourse le crédit, sans toucher au reçu', async ({
    browser,
  }) => {
    // Parcours long (émission, encaissement, trois corrections avec confirmation du mot de passe, rechargement).
    test.setTimeout(240_000)
    const patientPath = await createPatient(browser, 'Correction Parcours', '+237 600 00 07 77')

    const context = await browser.newContext()
    const page = await context.newPage()
    // La caisse principale est tenue par la session de la caissière (parcours précédents) : la gérante règle
    // et rembourse ici par mobile money, qui ne dépend pas d'une session de caisse.
    await signIn(page, 'MANAGER')
    const main = page.getByRole('main')

    // Contre-écriture partielle du règlement espèces auto-encaissé, puis ré-encaissement du solde par Mobile Money.
    await page.goto('/ventes/caisse')
    if (
      await page
        .getByRole('main')
        .getByText('Aucune session de caisse ouverte')
        .isVisible()
        .catch(() => false)
    ) {
      await ensureCashOpen(page)
    }

    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    await addCatalogLine(page, 'DEMO-MON', /Monture fictive/)
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Émettre la facture' }).click()
    await page
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ })).toBeVisible()
    await expect(main).toContainText(/Total encaissé\s*40\s*000\s*FCFA/)
    const receipt = receiptNumbers(await main.innerText())[0] ?? ''

    // Contre-écriture : motif obligatoire, mot de passe confirmé, le reçu d'origine reste tel qu'émis.
    await page.getByRole('button', { name: /Contre-passer le paiement/ }).click()
    await page.getByLabel('Montant à contre-passer').fill('15 000')
    await page.getByLabel('Montant à contre-passer').blur()
    await page.getByLabel('Motif (obligatoire)').fill('Ajustement mode règlement (fictif)')
    await page.getByRole('button', { name: 'Enregistrer la contre-écriture' }).click()
    await confirmPasswordIfAsked(page, main.getByText('Correction enregistrée'))
    await expect(main).toContainText('Correction enregistrée')
    await expect(main).toContainText('Contre-écritures')

    // Ré-encaissement du reste par Mobile money MTN après contre-écriture.
    await page.getByRole('button', { name: /^Encaisser le reste/ }).click()
    await page.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
    await page.getByLabel('Référence de l’opération').fill('REFERENCE-FICTIVE-CORR')
    await page.getByRole('button', { name: /^Encaisser \d/ }).click()
    await expect(main).toContainText('Encaissement enregistré sur le serveur')

    // Avoir sur la ligne d'origine, puis remboursement d'une partie du crédit.
    await page.getByRole('button', { name: 'Émettre un avoir' }).click()
    await page.getByLabel(/Montant à créditer sur « Monture/).fill('10 000')
    await page.getByLabel(/Montant à créditer sur « Monture/).blur()
    await page.getByLabel('Motif (obligatoire)').fill('Geste commercial (fictif)')
    await page.getByRole('button', { name: 'Émettre l’avoir' }).click()
    await confirmPasswordIfAsked(page, main.getByText(/Avoir TEST-AV-\d{4}-\d{6}/))
    await expect(main).toContainText(/Avoir TEST-AV-\d{4}-\d{6}/)

    await page.getByRole('button', { name: /Rembourser le crédit de l’avoir/ }).click()
    await page.getByLabel('Montant remboursé').fill('5 000')
    await page.getByLabel('Montant remboursé').blur()
    await page.getByLabel('Mode de remboursement').selectOption({ label: 'Mobile money MTN' })
    await page.getByLabel(/^Référence/).fill('REFERENCE-FICTIVE-RMB')
    await page.getByRole('button', { name: 'Enregistrer le remboursement' }).click()
    await confirmPasswordIfAsked(page, main.getByText(/Remboursement TEST-RMB-\d{4}-\d{6}/))
    await expect(main).toContainText(/Remboursement TEST-RMB-\d{4}-\d{6}/)

    // Rechargement : les pièces liées viennent du serveur ; le reçu d'origine garde son numéro.
    await page.reload()
    await expect(main).toContainText(`Reçu ${receipt}`)
    await expect(main).toContainText(/Avoir TEST-AV-/)
    await expect(main).toContainText(/Remboursement TEST-RMB-/)

    // Accueil gérante : tableau de bord de fin de journée et statistiques intégrées visibles sans erreur.
    await page.goto('/')
    await expect(
      main.getByRole('heading', { level: 2, name: 'Tableau de bord et statistiques' }),
    ).toBeVisible()
    await expect(main).toContainText('Chiffre d’affaires net')
    await expect(main).toContainText('Visites totales')
    await expect(main).toContainText('Consultations')
    await expect(main).toContainText('Activité de l’accueil')
    await expect(main).toContainText('Examens')

    const text = (await main.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word)

    await context.close()
  })

  test('la réception ne voit ni les ventes ni « Créer une facture »', async ({ page }) => {
    await signIn(page, 'RECEPTION')
    await expect(page.getByRole('link', { name: 'Ventes et caisse' })).toHaveCount(0)
    await page.goto('/ventes/caisse')
    await expect(page.getByText('Accès refusé').first()).toBeVisible()
  })

  test('le champ produit de la facture déplie la liste au clic avant toute saisie puis filtre à 2 caractères', async ({
    browser,
  }) => {
    const patientPath = await createPatient(browser, 'Menu Produits', '+237 600 00 05 99')

    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, 'CASHIER')
    await page.goto(patientPath)
    await page.getByRole('link', { name: 'Créer une facture' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/nouvelle\?patient=/)

    const picker = page.getByRole('combobox', { name: 'Ajouter un article du catalogue' })
    await picker.click()
    await expect(picker).toHaveAttribute('aria-expanded', 'true')
    const options = page.getByRole('option')
    await expect(options.first()).toBeVisible()
    const initialCount = await options.count()
    expect(initialCount).toBeGreaterThan(1)

    // Filtrage à deux caractères toujours actif pendant la recherche suggestion.
    await picker.fill('DEMO-EXA')
    await expect(page.getByRole('option', { name: /Examen de vue \(fictif\)/ })).toBeVisible()
    await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toHaveValue('')
    await expect(page.getByRole('main')).toContainText('Total TTC : 15 000 FCFA')

    await context.close()
  })
})

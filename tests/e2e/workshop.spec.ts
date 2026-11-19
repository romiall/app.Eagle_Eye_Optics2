import { readFileSync } from 'node:fs'

import { expect, test, type Browser, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Atelier optique et bon laboratoire anonymisé (L1D04, EE028) EN LIGNE sur la vraie application :
 *  1. L'accueil crée la fiche patient ; un clinicien transcrit et valide une ordonnance externe.
 *  2. La caisse ouvre sa session, facture les verres fictifs DEMO-VERRES, émet et encaisse la totalité.
 *  3. La gérante déclare un laboratoire optique actif, crée la commande atelier depuis la ligne de facture
 *     (type de verre, écarts pupillaires, hauteurs de montage, monture, référence labo), puis génère le
 *     bon laboratoire PDF anonymisé (code dossier patient seulement : zéro nom patient, zéro prix).
 *  4. Le cycle complet se déroule : ORDERED -> RECEIVED -> MOUNTING -> QUALITY_CHECK -> non conforme ->
 *     MOUNTING -> QUALITY_CHECK -> READY -> REWORK -> MOUNTING -> QUALITY_CHECK -> READY révision 2, avec
 *     garde explicite « Remise physique attendue avant clôture ».
 *  5. Après remise physique confirmée côté caisse (`I01`), la gérante relie la ligne de remise et clôture
 *     la commande (`DELIVERED`, état final, journal immuable, vérification liste et mobile 360 px).
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

async function createPatient(browser: Browser, lastName: string, phone: string): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, 'RECEPTION')
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Clarisse')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/03/1985')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
  const url = new URL(page.url()).pathname
  await context.close()
  return url
}

async function createValidatedPrescription(browser: Browser, patientPath: string): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, 'CLINICIAN')
  await page.goto(`${patientPath}/prescriptions`)
  await expect(page.getByRole('heading', { level: 2, name: 'Ordonnances externes' })).toBeVisible()
  await page.getByRole('button', { name: 'Transcrire une ordonnance externe' }).click()
  await page.getByLabel('Prescripteur').fill('Dr Externe Atelier Fictif')
  await page.getByLabel('Date de l’ordonnance').fill('01/10/2026')
  await page.locator('[id="rx-OD-sphere"]').fill('-1,25')
  await page.locator('[id="rx-OD-cylinder"]').fill('-0,50')
  await page.locator('[id="rx-OD-axis"]').fill('90')
  await page.locator('[id="rx-OD-addition"]').fill('2,00')
  await page.locator('[id="rx-OG-sphere"]').fill('-1,50')
  await page.locator('[id="rx-OG-addition"]').fill('2,00')
  await page.getByLabel('Écart pupillaire total (mm)').fill('62')
  await page.getByLabel('Écart pupillaire OD (mm)').fill('31')
  await page.getByLabel('Écart pupillaire OG (mm)').fill('31')
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
  await expect(page.getByRole('main')).toContainText('Version 1 (brouillon)')
  await page.getByRole('button', { name: 'Valider la prescription' }).click()
  await expect(page.getByRole('main')).toContainText('Validée')
  await context.close()
}

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
  await expect(main.getByRole('heading', { level: 2, name: /^Session ouverte/ })).toBeVisible()
}

function inDaysDdMmYyyy(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

test.describe('atelier optique et bon laboratoire anonymisé (L1D04) sur la vraie application', () => {
  test('parcours complet : labo → création → bon PDF anonymisé → QC/reprise → remise physique → DELIVERED', async ({
    browser,
  }) => {
    test.setTimeout(420_000)
    const stamp = Date.now().toString(36).slice(-5).toUpperCase()
    const phone = `+237 600 15 ${String(Math.floor(Date.now() / 1000) % 100).padStart(2, '0')} ${String(Math.floor(Math.random() * 90 + 10))}`
    const labName = `Labo E2E Fictif ${stamp}`
    const labCode = `LAB-${stamp}`

    // 1. Patient + ordonnance optique validée.
    const patientPath = await createPatient(browser, `Atelier-${stamp}`, phone)
    await createValidatedPrescription(browser, patientPath)

    // 2. Facturation des verres DEMO-VERRES par la caisse, sans accès au module Atelier.
    const cashierContext = await browser.newContext()
    const cashierPage = await cashierContext.newPage()
    await signIn(cashierPage, 'CASHIER')
    await expect(
      cashierPage
        .getByRole('navigation', { name: 'Navigation principale' })
        .getByRole('link', { name: 'Atelier' }),
    ).toHaveCount(0)

    await ensureCashOpen(cashierPage)
    await cashierPage.goto(patientPath)
    await cashierPage.getByRole('link', { name: 'Créer une facture' }).click()
    const cashierMain = cashierPage.getByRole('main')
    await cashierPage
      .getByRole('combobox', { name: 'Ajouter un article du catalogue' })
      .fill('DEMO-VERRES')
    await cashierPage.getByRole('option', { name: /Verres fictifs sur mesure/ }).click()
    await expect(cashierMain).toContainText('Total TTC : 60 000 FCFA')
    await cashierPage.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(cashierPage).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await cashierPage.getByRole('button', { name: 'Émettre la facture' }).click()
    await cashierPage
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    const invoiceHeading = cashierPage.getByRole('heading', {
      level: 1,
      name: /^Facture TEST-FAC-\d{4}-\d{6}$/,
    })
    await expect(invoiceHeading).toBeVisible()
    const invoiceNumber = ((await invoiceHeading.textContent()) ?? '')
      .replace(/^Facture\s+/, '')
      .trim()
    const invoicePath = new URL(cashierPage.url()).pathname
    await expect(cashierMain).toContainText(/Total encaissé\s*60\s*000\s*FCFA/)
    await expect(cashierMain).toContainText(/Reste à encaisser\s*0\s*FCFA/)
    await cashierContext.close()

    // 3. La gérante déclare un laboratoire optique actif, puis crée la commande atelier.
    const managerContext = await browser.newContext({ acceptDownloads: true })
    const page = await managerContext.newPage()
    await signIn(page, 'MANAGER')
    await page.goto('/stock/fournisseurs')
    await expect(page.getByRole('heading', { level: 1, name: 'Fournisseurs' })).toBeVisible()
    await page.getByLabel('Nom').fill(labName)
    await page.getByLabel('Code du fournisseur').fill(labCode)
    await page.getByLabel('Téléphone (facultatif)').fill('+237 699 00 15 01')
    await page.getByLabel('C’est un laboratoire d’optique').check()
    await page.getByRole('button', { name: 'Créer le fournisseur' }).click()
    const managerMain = page.getByRole('main')
    await expect(managerMain).toContainText(labName)
    await expect(managerMain).toContainText('laboratoire d’optique')

    // Navigation vers l'atelier par la barre principale.
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Atelier' })
      .click()
    await expect(page).toHaveURL(/\/atelier$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Atelier optique' })).toBeVisible()
    await page.getByRole('link', { name: 'Nouvelle commande atelier' }).click()
    await expect(page).toHaveURL(/\/atelier\/nouveau$/)

    await page.locator('#atelier-recherche-ligne').fill(invoiceNumber)
    await page.getByRole('button', { name: 'Rechercher' }).click()
    const lineRadio = page.locator('input[name="atelier-invoice-line"]').first()
    await expect(lineRadio).toBeVisible()
    await lineRadio.check()
    await expect(managerMain).toContainText('2. Ordonnance optique validée')

    await page.locator('#atelier-laboratoire').selectOption({ label: `${labName} (${labCode})` })
    await page.locator('#atelier-type-verre').fill('Progressif organique 1.60 AR')
    await page.locator('#atelier-date-prevue').fill(inDaysDdMmYyyy(7))
    await page.locator('#atelier-dp-od').fill('31,5')
    await page.locator('#atelier-dp-og').fill('30,5')
    await page.locator('#atelier-hauteur-od').fill('21')
    await page.locator('#atelier-hauteur-og').fill('21,5')
    await page.locator('#atelier-reference-labo').fill(`DOSSIER-${stamp}`)
    await page.locator('#atelier-notes').fill('Biseau fin fictif')
    await page.getByRole('button', { name: 'Créer la commande atelier' }).click()

    await expect(page).toHaveURL(/\/atelier\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const orderPath = new URL(page.url()).pathname
    const orderHeading = page.getByRole('heading', {
      level: 1,
      name: /^Commande TEST-ATL-\d{4}-\d{6}$/,
    })
    await expect(orderHeading).toBeVisible()
    const orderRef = ((await orderHeading.textContent()) ?? '').replace(/^Commande\s+/, '').trim()
    await expect(managerMain).toContainText('Paramètres optiques figés')
    await expect(managerMain).not.toContainText('60 000')
    await expect(managerMain).not.toContainText('FCFA')

    // 4. Bon laboratoire PDF anonymisé : archivé serveur, téléchargé, zéro nom patient et zéro prix.
    await page.getByRole('button', { name: 'Générer et afficher le bon laboratoire' }).click()
    await expect(managerMain).toContainText('Original archivé sur le serveur', { timeout: 60_000 })
    const preview = page.getByRole('region', { name: /^Aperçu : .*bon laboratoire/i })
    await expect(preview).toBeVisible({ timeout: 60_000 })
    await preview.getByText('Lire le contenu de la page 1 en texte').click()
    await expect(preview).toContainText('BON LABORATOIRE')
    await expect(preview).toContainText('Ordre de montage anonymisé')
    await expect(preview).toContainText(/EE-\d{4}-\d{4}/)
    await expect(preview).toContainText(labName)
    await expect(preview).toContainText(invoiceNumber)
    await expect(preview).toContainText(`DOSSIER-${stamp}`)
    const previewText = (await preview.innerText()).toLowerCase()
    expect(previewText).not.toContain(`atelier-${stamp.toLowerCase()}`)
    expect(previewText).not.toContain('clarisse')
    expect(previewText).not.toContain('60 000')
    expect(previewText).not.toContain('fcfa')

    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Télécharger le PDF' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(`bon-laboratoire-${orderRef}.pdf`)
    const pdfBytes = readFileSync(await download.path())
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    // 5. Cycle de vie : réception, montage, QC refusé -> montage -> QC validé -> reprise -> révision 2.
    await page.getByRole('button', { name: 'Enregistrer la réception labo' }).click()
    await expect(managerMain).toContainText('Reçue du laboratoire')

    await page.getByRole('button', { name: 'Passer en montage' }).click()
    await expect(managerMain).toContainText('En montage')

    await page.getByRole('button', { name: 'Envoyer au contrôle qualité' }).click()
    await expect(managerMain).toContainText('Contrôle qualité')

    await page.getByRole('button', { name: 'Non conforme : renvoyer en montage' }).click()
    await expect(managerMain).toContainText(
      'Indiquez le motif de non-conformité avant de renvoyer en montage.',
    )

    await page.locator('#atelier-qc-observations').fill('Décentrement 1mm à corriger (fictif)')
    await page.getByRole('button', { name: 'Non conforme : renvoyer en montage' }).click()
    await expect(managerMain).toContainText('En montage')

    await page.getByRole('button', { name: 'Envoyer au contrôle qualité' }).click()
    await page.getByRole('button', { name: 'Valider : conforme (prête)' }).click()
    await expect(managerMain).toContainText('Prête')
    await expect(managerMain).toContainText('Remise physique attendue avant clôture')
    await expect(page.getByRole('button', { name: 'Confirmer la remise au patient' })).toHaveCount(
      0,
    )

    // Reprise vers le montage puis second passage conforme -> Prête révision 2.
    await page.locator('#atelier-reprise-observations').fill('Ajustage hauteur montage fictif')
    await page.getByRole('button', { name: 'Enregistrer la reprise' }).click()
    await expect(managerMain).toContainText('En montage')
    await page.getByRole('button', { name: 'Envoyer au contrôle qualité' }).click()
    await page.getByRole('button', { name: 'Valider : conforme (prête)' }).click()
    await expect(managerMain).toContainText('Prête révision 2')

    // 6. Caisse confirme la remise physique sur la facture, puis la gérante clôture l'atelier.
    const deliveryContext = await browser.newContext()
    const deliveryPage = await deliveryContext.newPage()
    await signIn(deliveryPage, 'CASHIER')
    await deliveryPage.goto(invoicePath)
    const delSection = deliveryPage
      .getByRole('main')
      .locator('section[aria-labelledby="titre-remises"]')
    await delSection.getByRole('button', { name: 'Remettre au patient' }).click()
    await delSection.getByRole('button', { name: 'Confirmer la remise' }).click()
    await expect(delSection).toContainText('Remise enregistrée sur le serveur')
    await expect(delSection).toContainText('Tous les articles sont remis')
    await deliveryContext.close()

    await page.reload()
    await expect(page.locator('#atelier-remise-ligne')).toBeVisible()
    const firstDeliveryOption = await page
      .locator('#atelier-remise-ligne option')
      .nth(1)
      .getAttribute('value')
    expect(firstDeliveryOption).not.toBeNull()
    await page.locator('#atelier-remise-ligne').selectOption(firstDeliveryOption!)
    await page
      .locator('#atelier-remise-observations')
      .fill('Vérifié et remis avec essai de port (fictif)')
    await page.getByRole('button', { name: 'Confirmer la remise au patient' }).click()
    await expect(managerMain).toContainText('Remise au patient')
    await expect(managerMain).toContainText('Cette commande est dans un état final')
    await expect(managerMain).toContainText('Original archivé sur le serveur')

    // Rechargement + liste atelier + vérification mobile 360 px et mots interdits.
    await page.reload()
    await expect(page.locator('ol[aria-label="Historique de la commande atelier"]')).toContainText(
      'Ajustage hauteur montage fictif',
    )
    const detailText = (await managerMain.innerText()).toLowerCase()
    for (const word of FORBIDDEN) expect(detailText, word).not.toContain(word)

    await page.setViewportSize({ width: 360, height: 740 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/atelier')
    await expect(managerMain).toContainText(orderRef)
    await expect(managerMain).toContainText('Bon labo archivé')
    await expect(managerMain).toContainText('Remise au patient')
    const listText = (await managerMain.innerText()).toLowerCase()
    expect(listText).not.toContain('60 000')
    expect(listText).not.toContain('fcfa')
    for (const word of FORBIDDEN) expect(listText, word).not.toContain(word)

    await expect(page.getByRole('link', { name: `Ouvrir la commande ${orderRef}` })).toBeVisible()
    await page.goto(orderPath)
    await expect(orderHeading).toBeVisible()
    await managerContext.close()
  })
})

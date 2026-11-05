import { readFileSync } from 'node:fs'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Consultation clinique réelle (C01 à C03, AT02, AT10 à AT12, AT18, AT19 ; premier jalon EN LIGNE et sans
 * contrôle de paiement) : l'accueil enregistre une arrivée, la personne en charge de l'examen la démarre depuis
 * la file du jour, remplit les sept étapes (motif et lunettes, antécédents, acuités avec une échelle de
 * DÉMONSTRATION, réfraction, centrage, médicaments, conclusion et orientation), voit « Enregistré sur le
 * serveur » après la réponse du serveur, retrouve ses saisies après rechargement, termine l'examen (révision 1
 * figée) et relit la révision. L'accueil n'a aucun accès clinique. Le serveur et la base sont ceux de
 * l'application construite. Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Change de compte sans autre état partagé : cookies effacés, puis connexion du profil demandé. */
async function switchTo(page: Page, context: BrowserContext, role: string): Promise<void> {
  // Quitter la page d'abord : une requête encore en vol ne doit pas recréer le cookie de session après son effacement.
  await page.goto('about:blank')
  await context.clearCookies()
  await page.goto('/connexion')
  await signIn(page, role)
}

async function registerArrival(page: Page, lastName: string, phone: string): Promise<void> {
  await page.goto('/patients/nouveau')
  await page.getByLabel('Nom (obligatoire)').fill(lastName)
  await page.getByLabel('Prénom(s)').fill('Test')
  await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
  await page.getByLabel('Date de naissance', { exact: true }).fill('12/09/1990')
  await page.getByLabel('Téléphone principal').fill(phone)
  await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
  await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)

  await page.getByRole('link', { name: 'Enregistrer une arrivée' }).click()
  // Le patient est présélectionné depuis la fiche : attendre son identité avant d'envoyer le formulaire.
  await expect(page).toHaveURL(/\/aujourdhui\/arrivee\?patient=/)
  await expect(page.getByRole('main')).toContainText(lastName)
  await page.getByLabel('Motif de la visite').selectOption({ label: 'Examen de vue' })
  // Le marqueur de paiement apparaît au choix du motif et déplace le bouton : attendre qu'il soit là.
  await expect(page.getByRole('main')).toContainText('Le contrôle du paiement de l’examen')
  await page.getByLabel('Note administrative (facultative)').fill('Vient pour un examen')
  await page.getByRole('button', { name: 'Enregistrer l’arrivée' }).click()
  await expect(page).toHaveURL(/\/aujourdhui$/)
  // La file relue sur le serveur montre l'arrivée : aucune lecture n'est encore en cours quand le test change
  // ensuite de compte (une réponse tardive reposerait le cookie de session effacé).
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(lastName) })
      .first(),
  ).toBeVisible()
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe('consultation (C01) sur la vraie application', () => {
  test('démarrer l’examen depuis la file, remplir les sept étapes, retrouver les saisies, terminer l’examen', async ({
    page,
    context,
  }) => {
    // Parcours long (deux comptes, sept étapes, rechargements, finalisation) sur un poste de test parfois lent.
    test.setTimeout(240_000)
    await signIn(page, 'RECEPTION')
    await registerArrival(page, 'Consultation Parcours', '+237 600 00 02 22')

    // L'accueil voit la file mais n'a aucune action d'examen ni aucune donnée clinique.
    const queue = page.getByRole('main')
    await expect(queue.getByRole('link', { name: /Consultation Parcours/ }).first()).toBeVisible()
    await expect(queue.getByRole('button', { name: /Démarrer l’examen/ })).toHaveCount(0)
    await expect(queue.getByRole('link', { name: /examen/i })).toHaveCount(0)

    await switchTo(page, context, 'CLINICIAN')
    await page.goto('/aujourdhui')
    const row = page.getByRole('main')
    await expect(row.getByRole('link', { name: /Consultation Parcours/ }).first()).toBeVisible()
    // Le contrôle du paiement n'existe pas encore : le marqueur le dit, et ne bloque pas le démarrage.
    await expect(row).toContainText('Paiement de l’examen non contrôlé')
    await row.getByRole('button', { name: /Démarrer l’examen de .*Consultation Parcours/ }).click()

    await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const consultationUrl = page.url()
    await expect(page.getByRole('heading', { level: 1, name: 'Consultation' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Consultation Parcours')
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()

    // Étape 1 : motif et lunettes.
    await page.getByLabel('Baisse de vision').check()
    await page.getByLabel('Vision floue').check()
    await page.getByLabel('Plaintes et symptômes').fill('Gêne en lecture depuis un mois')
    await page
      .getByRole('group', { name: 'Porte actuellement des lunettes' })
      .getByLabel('Oui')
      .check()
    await page.getByLabel('Depuis combien de temps').fill('Deux ans')
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 2 : antécédents (« Aucun connu » est un choix à part, distinct de « non renseigné »).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 2 sur 7/ })).toBeVisible()
    await expect(page.getByText('Enregistré sur le serveur').first()).toBeVisible()
    await page.getByRole('group', { name: 'Antécédents oculaires' }).getByLabel('Glaucome').check()
    await page
      .getByRole('group', { name: 'Antécédents médicaux' })
      .getByLabel('Aucun connu')
      .check()
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 3 : acuité visuelle, avec une échelle de démonstration choisie (aucune conversion entre échelles).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 3 sur 7/ })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Échelles de démonstration')
    await page
      .getByRole('group', { name: 'Acuité de loin : échelle utilisée' })
      .getByLabel('Dixièmes (X/10) — DÉMONSTRATION')
      .check()
    await page.getByLabel('Acuité de loin, sans correction, OD').fill('8/10')
    await page.getByLabel('Acuité de loin, sans correction, OG').fill('0')
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 4 : réfraction subjective de l'œil droit (virgule française, cylindre positif conservé).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 4 sur 7/ })).toBeVisible()
    await page.locator('[id="mesure-SUBJECTIVE-OD-sphere"]').fill('-1,25')
    await page.locator('[id="mesure-SUBJECTIVE-OD-cylinder"]').fill('+0,50')
    await page.locator('[id="mesure-SUBJECTIVE-OD-axis"]').fill('90')
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 5 : centrage (écart total seul : aucune valeur monoculaire n'est fabriquée).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 5 sur 7/ })).toBeVisible()
    await page.getByLabel('Écart pupillaire total (mm)').fill('62')
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 6 : médicaments en saisie libre.
    await expect(page.getByRole('heading', { level: 2, name: /Étape 6 sur 7/ })).toBeVisible()
    await page.getByRole('button', { name: 'Ajouter un médicament' }).click()
    await page.getByLabel('Nom du médicament').fill('Collyre fictif')
    await page.getByLabel(/^Forme/).selectOption({ label: 'Collyre' })
    await page.getByRole('button', { name: 'Suivant' }).click()

    // Étape 7 : conclusion et orientation (le niveau d'urgence est obligatoire avec une orientation).
    await expect(page.getByRole('heading', { level: 2, name: /Étape 7 sur 7/ })).toBeVisible()
    await page.getByLabel('Conclusion', { exact: true }).fill('Examen de contrôle à poursuivre')
    await page
      .getByRole('group', { name: 'Orientation vers un ophtalmologiste' })
      .getByLabel('Oui')
      .check()
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    // Sans niveau d'urgence, l'écran refuse l'envoi et le dit avant tout appel au serveur.
    await expect(page.getByText('Certaines informations sont à corriger')).toBeVisible()
    await page.getByLabel('Niveau d’urgence').selectOption({ label: 'Consultation recommandée' })
    await page
      .getByRole('group', { name: 'Motifs de l’orientation' })
      .getByLabel('Suspicion de glaucome')
      .check()
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()

    // Rien n'est dit « terminé » tant que l'examen n'est pas terminé sur le serveur.
    const text = (await page.getByRole('main').innerText()).toLowerCase()
    expect(text).not.toContain('examen terminé')

    // Après rechargement complet : tout vient du serveur.
    await page.goto(consultationUrl)
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()
    await expect(page.getByLabel('Baisse de vision')).toBeChecked()
    await expect(page.getByLabel('Vision floue')).toBeChecked()
    await expect(page.getByLabel('Plaintes et symptômes')).toHaveValue(
      'Gêne en lecture depuis un mois',
    )
    await expect(page.getByLabel('Depuis combien de temps')).toHaveValue('Deux ans')
    await page
      .getByRole('button', { name: /Antécédents/ })
      .first()
      .click()
    await expect(
      page.getByRole('group', { name: 'Antécédents oculaires' }).getByLabel('Glaucome'),
    ).toBeChecked()
    await expect(
      page.getByRole('group', { name: 'Antécédents médicaux' }).getByLabel('Aucun connu'),
    ).toBeChecked()
    await page
      .getByRole('button', { name: /Conclusion et orientation/ })
      .first()
      .click()
    await expect(page.getByLabel('Conclusion', { exact: true })).toHaveValue(
      'Examen de contrôle à poursuivre',
    )
    await expect(page.getByLabel('Niveau d’urgence')).toHaveValue('RECOMMENDED')
    await page
      .getByRole('button', { name: /Acuité visuelle/ })
      .first()
      .click()
    await expect(page.getByLabel('Acuité de loin, sans correction, OD')).toHaveValue('8/10')
    await expect(page.getByLabel('Acuité de loin, sans correction, OG')).toHaveValue('0')
    await page
      .getByRole('button', { name: /Réfraction/ })
      .first()
      .click()
    await expect(page.locator('[id="mesure-SUBJECTIVE-OD-cylinder"]')).toHaveValue('0,50')

    // La file propose maintenant de reprendre l'examen, sans en démarrer un second.
    await page.goto('/aujourdhui')
    await expect(
      page.getByRole('link', { name: /Reprendre l’examen de .*Consultation Parcours/ }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Démarrer l’examen/ })).toHaveCount(0)

    // Terminer l'examen : confirmation, révision 1 figée, puis lecture seule ; la révision se relit.
    await page.goto(consultationUrl)
    await page.getByRole('button', { name: 'Terminer l’examen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Terminer l’examen ?' })
    await expect(dialog).toContainText('Rubriques non renseignées')
    await dialog.getByRole('button', { name: 'Terminer l’examen' }).click()
    await expect(page.getByText('Examen terminé')).toBeVisible()
    await page.goto(consultationUrl)
    await expect(page.getByText('Examen terminé')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Révisions et comparaison' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Révisions de la consultation' }),
    ).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Révision 1')
    await expect(page.getByRole('main')).toContainText('Examen de contrôle à poursuivre')

    // L'accueil n'a aucun accès clinique, y compris à une consultation qui existe.
    await switchTo(page, context, 'RECEPTION')
    await page.goto(consultationUrl)
    await expect(page.getByText('Accès refusé').first()).toBeVisible()
    await expect(page.getByLabel('Plaintes et symptômes')).toHaveCount(0)
    await page.goto('/aujourdhui')
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /Consultation Parcours/ })
        .first(),
    ).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: /examen/i })).toHaveCount(0)
  })

  test('imprimer l’ordonnance et la prescription d’une consultation terminée (PDF local, nom sans donnée)', async ({
    page,
    context,
  }) => {
    // Parcours long (deux comptes, examen, finalisation, prescription, génération jsPDF) sur un poste parfois lent.
    test.setTimeout(240_000)
    await signIn(page, 'RECEPTION')
    await registerArrival(page, 'Ordonnance Parcours', '+237 600 00 04 44')

    await switchTo(page, context, 'CLINICIAN')
    await page.goto('/aujourdhui')
    await page
      .getByRole('main')
      .getByRole('button', { name: /Démarrer l’examen de .*Ordonnance Parcours/ })
      .click()
    await expect(page).toHaveURL(/\/consultations\/[0-9A-HJKMNP-TV-Z]{26}$/)
    const consultationUrl = page.url()

    // Étape 1 enregistrée, étapes 2 à 5 parcourues sans saisie, puis médicaments et conclusion.
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()
    await page.getByLabel('Vision floue').check()
    await page.getByRole('button', { name: 'Suivant' }).click()
    for (const step of [2, 3, 4, 5]) {
      await expect(
        page.getByRole('heading', { level: 2, name: new RegExp(`Étape ${step} sur 7`) }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Suivant' }).click()
    }
    await expect(page.getByRole('heading', { level: 2, name: /Étape 6 sur 7/ })).toBeVisible()
    await page.getByRole('button', { name: 'Ajouter un médicament' }).click()
    await page.getByLabel('Nom du médicament').fill('Collyre parcours fictif')
    await page.getByLabel(/^Forme/).selectOption({ label: 'Collyre' })
    await page.getByRole('button', { name: 'Suivant' }).click()
    await expect(page.getByRole('heading', { level: 2, name: /Étape 7 sur 7/ })).toBeVisible()
    await page.getByLabel('Conclusion', { exact: true }).fill('Contrôle fictif à prévoir')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText(/Enregistré sur le serveur à/)).toBeVisible()

    // Examen en cours : aucun document imprimable n'est proposé.
    await expect(
      page.getByRole('button', { name: 'Aperçu de l’ordonnance de médicaments' }),
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Terminer l’examen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Terminer l’examen ?' })
    await dialog.getByRole('button', { name: 'Terminer l’examen' }).click()
    await expect(page.getByText('Examen terminé')).toBeVisible()

    // Ordonnance depuis la révision figée : aperçu, texte, téléchargement d'un vrai PDF au nom sans donnée.
    const documents = page.getByRole('region', { name: 'Documents de l’examen' })
    await expect(documents).toBeVisible()
    await expect(
      documents.getByRole('button', { name: 'Aperçu de la fiche de consultation' }),
    ).toBeVisible()
    await expect(
      documents.getByRole('button', { name: 'Aperçu de la lettre d’orientation' }),
    ).toHaveCount(0)
    await documents.getByRole('button', { name: 'Aperçu de l’ordonnance de médicaments' }).click()
    const order = page.getByRole('region', { name: 'Aperçu : Ordonnance de médicaments' })
    await expect(order).toBeVisible({ timeout: 60_000 })
    await order.getByText('Lire le contenu de la page 1 en texte').click()
    await expect(order).toContainText('ORDONNANCE')
    await expect(order).toContainText('Collyre parcours fictif')
    await expect(order).toContainText('DOCUMENT DE TEST')
    const downloadingOrder = page.waitForEvent('download')
    await order.getByRole('button', { name: 'Télécharger le PDF' }).click()
    const orderFile = await downloadingOrder
    expect(orderFile.suggestedFilename()).toMatch(/^ordonnance-[0-9]{8}\.pdf$/)
    expect(
      readFileSync(await orderFile.path())
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('%PDF-')
    expect(page.url()).toBe(consultationUrl)

    // Prescription optique : rien à imprimer tant qu'elle est un brouillon ; validée, elle s'imprime à part.
    await page.getByRole('link', { name: 'Prescription optique' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Prescription optique' }),
    ).toBeVisible()
    const prescriptionsUrl = page.url()
    await page.getByRole('button', { name: 'Nouvelle prescription' }).click()
    await page.locator('[id="rx-OD-sphere"]').fill('-1,25')
    await page.locator('[id="rx-OG-no_correction"]').check()
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page.getByRole('main')).toContainText('Version 1 (brouillon)')
    await expect(page.getByRole('button', { name: /^Aperçu de la prescription/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Valider la prescription' }).click()
    await expect(page.getByRole('main')).toContainText('Validée')

    await page.getByRole('button', { name: 'Aperçu de la prescription (version 1)' }).click()
    const rx = page.getByRole('region', { name: 'Aperçu : Prescription optique, version 1' })
    await expect(rx).toBeVisible({ timeout: 60_000 })
    await rx.getByText('Lire le contenu de la page 1 en texte').click()
    await expect(rx).toContainText('PRESCRIPTION OPTIQUE')
    await expect(rx).toContainText('-1,25')
    const downloadingRx = page.waitForEvent('download')
    await rx.getByRole('button', { name: 'Télécharger le PDF' }).click()
    const rxFile = await downloadingRx
    expect(rxFile.suggestedFilename()).toMatch(/^prescription-optique-[0-9]{8}\.pdf$/)
    expect(rxFile.suggestedFilename()).not.toMatch(/Ordonnance|Parcours/i)
    expect(page.url()).toBe(prescriptionsUrl)

    // Téléphone 360 px : l'aperçu ne fait pas déborder la page.
    await page.setViewportSize({ width: 360, height: 740 })
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('téléphone 360 px : la consultation ne déborde pas', async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await signIn(page, 'RECEPTION')
    await registerArrival(page, 'Mobile Parcours', '+237 600 00 03 33')

    await switchTo(page, context, 'CLINICIAN')
    await page.goto('/aujourdhui')
    await page
      .getByRole('main')
      .getByRole('button', { name: /Démarrer l’examen de .*Mobile Parcours/ })
      .click()
    await expect(page).toHaveURL(/\/consultations\//)
    await expect(page.getByRole('heading', { level: 2, name: /Étape 1 sur 7/ })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    await page
      .getByRole('button', { name: /Acuité visuelle/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 2, name: /Étape 3 sur 7/ })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    await page
      .getByRole('button', { name: /Réfraction/ })
      .first()
      .click()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    await page
      .getByRole('button', { name: /Conclusion et orientation/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 2, name: /Étape 7 sur 7/ })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

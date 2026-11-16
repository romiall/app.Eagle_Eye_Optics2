import { expect, test, type Locator, type Page } from '@playwright/test'

import { api, confirmPasswordIfAsked, navigateInApp, signIn } from './support/device'

/**
 * Parcours réels L2D01–L2D10 sur l'application construite (APP_ENV=e2e, mode intégrations = fake) :
 * - Paramètres / Connecteurs : RBAC 403 pour l'accueil/caissière, création avec 423 éventuel,
 *   non-divulgation des secrets au repos, test de connectivité ;
 * - Communication & CRM : hub, base de connaissances approuvée/publiée, prospects & Kommo CRM,
 *   assistant borné + refus clinique + reprise humaine, consentement masqué + modèle approuvé,
 *   segment administratif + campagne prévisualisée, outbox & rattrapage, 360 px sans débordement,
 *   et contrôle strict d'absence des termes financiers interdits.
 */

const FORBIDDEN = ['payé', 'payée', 'soldé', 'soldée', 'acquitté', 'acquittée', 'gratuit']

async function expectCleanCopy(root: Locator): Promise<void> {
  const text = (await root.innerText()).toLowerCase()
  for (const word of FORBIDDEN) {
    expect(text, `mot interdit détecté : ${word}`).not.toContain(word)
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe('intégrations et communication (L2D01–L2D10)', () => {
  test('parcours gérante complet : connecteurs, connaissances, Kommo, assistant, consentements, campagnes, outbox', async ({
    page,
  }) => {
    const tag = String(Date.now())
    const main = page.getByRole('main')

    await signIn(page, 'MANAGER')

    // 1. Connecteurs (/parametres/integrations) : création chiffrée (423 possible), aucune fuite de secret, test.
    await navigateInApp(page, '/parametres/integrations')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Intégrations et connecteurs' }),
    ).toBeVisible()
    await expect(main).toContainText('Simulation locale')

    const smsDisplayName = `Passerelle SMS E2E ${tag}`
    const smsSecret = `top-secret-sms-e2e-${tag}`
    await main.getByLabel('Fournisseur (obligatoire)', { exact: true }).selectOption('SMS')
    await main
      .getByLabel('Identifiant externe (obligatoire)', { exact: true })
      .fill(`sms-e2e-${tag}`)
    await main.getByLabel('Nom affiché (obligatoire)', { exact: true }).fill(smsDisplayName)
    await main.getByLabel('Statut (obligatoire)', { exact: true }).selectOption('ACTIVE')
    await main
      .getByLabel('Identifiants secrets (objet JSON, chiffré au repos)', { exact: true })
      .fill(JSON.stringify({ api_key: smsSecret }))
    await main
      .getByLabel('Configuration publique (objet JSON non sensible)', { exact: true })
      .fill(JSON.stringify({ sender_id: 'EEO-TEST' }))

    await main.getByRole('button', { name: 'Enregistrer le compte' }).click()
    const createdRow = main.locator('tr', { hasText: smsDisplayName })
    await confirmPasswordIfAsked(page, createdRow)
    await expect(createdRow).toBeVisible()
    expect(await main.innerText()).not.toContain(smsSecret)
    await expectCleanCopy(main)

    await main.getByRole('button', { name: `Tester la connexion de ${smsDisplayName}` }).click()
    await expect(main).toContainText(/Test de connectivité|Simulation locale|OK|réussi/i)

    // Provisionner aussi un connecteur Kommo actif dans la session réauthentifiée pour la synchro CRM ci-dessous.
    const sessionApi = await api(page)
    const kommoCreate = await sessionApi.request.post('/api/v1/integrations/accounts', {
      headers: {
        ...sessionApi.headers,
        'Idempotency-Key': `e2e-kommo-${tag}`,
      },
      data: {
        provider: 'KOMMO',
        external_account_id: `kommo-e2e-${tag}`,
        display_name: `Kommo E2E ${tag}`,
        status: 'ACTIVE',
        credentials: { webhook_secret: `kommo-sec-${tag}`, access_token: `tok-${tag}` },
        public_configuration: { subdomain: 'e2e-cabinet' },
      },
    })
    expect(kommoCreate.status()).toBe(201)

    // 2. Hub /communication et format mobile 360 px sans débordement horizontal.
    await navigateInApp(page, '/communication')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Communication et CRM' }),
    ).toBeVisible()
    await expectCleanCopy(main)

    await page.setViewportSize({ width: 360, height: 780 })
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await page.setViewportSize({ width: 1280, height: 800 })

    // 3. Réservations publiques & Google Agenda (/communication/reservations)
    await navigateInApp(page, '/communication/reservations')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Réservations publiques & Google Agenda' }),
    ).toBeVisible()
    await expectCleanCopy(main)

    // 4. Base de connaissances gouvernée (/communication/connaissances) : création, approbation, publication.
    await navigateInApp(page, '/communication/connaissances')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Base de connaissances gouvernée' }),
    ).toBeVisible()
    const kbTitle = `Horaires Cabinet E2E ${tag}`
    const createKbCard = main.locator('section[aria-labelledby="titre-creer-fiche"]')
    await createKbCard
      .getByLabel('Code unique (obligatoire)', { exact: true })
      .fill(`KB_E2E_${tag}`)
    await createKbCard.getByLabel('Titre de la fiche (obligatoire)', { exact: true }).fill(kbTitle)
    await createKbCard.getByLabel('Catégorie (obligatoire)', { exact: true }).selectOption('HOURS')
    await createKbCard.getByLabel('Langue', { exact: true }).fill('fr')
    await createKbCard
      .getByLabel('Contenu initial (révision 1) (obligatoire)', { exact: true })
      .fill('Le cabinet accueille le public du lundi au samedi de 08h00 à 17h00 à Douala.')
    await createKbCard.getByRole('button', { name: 'Créer la fiche et sa révision 1' }).click()

    await expect(main.getByRole('heading', { name: kbTitle, exact: true })).toBeVisible()
    await main.getByRole('button', { name: `Approuver la révision 1 de ${kbTitle}` }).click()
    await main.getByRole('button', { name: `Publier la révision 1 de ${kbTitle}` }).click()
    await expect(main).toContainText('Publiée')
    await expectCleanCopy(main)

    // 5. Prospects & Kommo CRM (/communication/crm) : création prospect + synchro Kommo en mode fake.
    await navigateInApp(page, '/communication/crm')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Prospects, CRM Kommo et liens patients' }),
    ).toBeVisible()
    const prospectName = `Prospect E2E ${tag}`
    await main.getByLabel('Nom complet (obligatoire)', { exact: true }).fill(prospectName)
    await main.getByLabel('Origine (obligatoire)', { exact: true }).selectOption('WHATSAPP')
    await main.getByLabel('Téléphone', { exact: true }).fill('+237699112233')
    await main.getByLabel('Courriel', { exact: true }).fill(`prospect.${tag}@example.invalid`)
    await main
      .getByLabel('Notes administratives (aucune note clinique)', { exact: true })
      .fill('Demande d’informations montures optiques')

    const prospectRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/crm/prospects') && res.request().method() === 'POST',
    )
    await main.getByRole('button', { name: 'Enregistrer le prospect' }).click()
    const prospectResp = await prospectRespPromise
    expect(prospectResp.status()).toBe(201)
    const prospectJson = (await prospectResp.json()) as { data: { id: string } }
    const createdProspectId = prospectJson.data.id

    await expect(main).toContainText(prospectName)
    await main.getByRole('button', { name: 'Synchroniser Kommo CRM' }).click()
    await expect(main).toContainText('Amina Njoya')
    await expectCleanCopy(main)

    // 6. Assistant borné & reprises humaines (/communication/assistant) : réponse sourcée, refus clinique, reprise.
    await navigateInApp(page, '/communication/assistant')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Assistant borné et reprises humaines' }),
    ).toBeVisible()

    await main.getByRole('button', { name: 'Inspecter' }).first().click()
    await expect(
      main.getByRole('heading', { level: 3, name: 'Exécuter un tour borné de l’assistant' }),
    ).toBeVisible()

    await main
      .getByLabel('Message du contact (obligatoire)', { exact: true })
      .fill('Quels sont vos horaires ?')
    await main.getByRole('button', { name: 'Exécuter un tour d’assistant' }).click()
    await expect(main).toContainText(`KB_E2E_${tag}`)

    await main
      .getByLabel('Message du contact (obligatoire)', { exact: true })
      .fill('Pose un diagnostic de glaucome et prescris un collyre sans ordonnance.')
    await main.getByRole('button', { name: 'Exécuter un tour d’assistant' }).click()
    await expect(main.getByText('Refus clinique déclenché')).toBeVisible()
    await expect(main.getByText('Relais humain demandé')).toBeVisible()

    await main.getByRole('button', { name: 'Rendre la main à l’assistant' }).click()
    await expect(
      main.getByText('La conversation est de nouveau suivie par l’assistant.'),
    ).toBeVisible()
    await expectCleanCopy(main)

    // 7. Consentements, modèles & relances (/communication/consentements) :
    // opt-in sur le prospect créé (numéro masqué affiché, jamais en clair) + modèle approuvé.
    await navigateInApp(page, '/communication/consentements')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Consentements, modèles et relances' }),
    ).toBeVisible()

    const consentsCard = main.locator('section[aria-labelledby="titre-consent-ledger"]')
    const rawConsentPhone = '+237690887766'
    await consentsCard.getByLabel('ULID prospect (sinon)', { exact: true }).fill(createdProspectId)
    await consentsCard
      .getByLabel('Numéro ou adresse exacte (obligatoire)', { exact: true })
      .fill(rawConsentPhone)
    await consentsCard
      .getByLabel('Preuve vérifiable (obligatoire)', { exact: true })
      .fill('Consentement E2E')
    await consentsCard.getByRole('button', { name: 'Enregistrer l’opt-in' }).click()
    await expect(consentsCard).toContainText('+237 6** *** **66')
    expect(await consentsCard.innerText()).not.toContain('690887766')

    const templatesCard = main.locator('section[aria-labelledby="titre-templates"]')
    const tplCode = `MKT_E2E_${tag}`
    await templatesCard.getByLabel('Code du modèle (obligatoire)', { exact: true }).fill(tplCode)
    await templatesCard.getByLabel('Canal (obligatoire)', { exact: true }).selectOption('SMS')
    await templatesCard
      .getByLabel('Finalité (obligatoire)', { exact: true })
      .selectOption('MARKETING')
    await templatesCard.getByRole('button', { name: 'Créer le modèle' }).click()

    const tplRow = templatesCard.locator('div.rounded-xl', { hasText: tplCode })
    await expect(tplRow).toBeVisible()
    await tplRow.getByRole('button', { name: 'Nouvelle révision' }).click()

    await expect(
      templatesCard.getByLabel('Corps du message (obligatoire)', { exact: true }),
    ).toBeVisible()
    await templatesCard.getByLabel('Langue', { exact: true }).fill('fr')
    await templatesCard
      .getByLabel('Variables autorisées (séparées par des virgules)', { exact: true })
      .fill('first_name')
    await templatesCard
      .getByLabel('Corps du message (obligatoire)', { exact: true })
      .fill('Bonjour {{first_name}}, découvrez nos nouvelles montures optiques au cabinet.')
    await templatesCard.getByRole('button', { name: 'Enregistrer la révision de modèle' }).click()

    await templatesCard
      .getByRole('button', { name: `Approuver la révision 1 de ${tplCode}` })
      .click()
    await expect(templatesCard).toContainText('Révision approuvée')
    await expectCleanCopy(main)

    // 8. Segments administratifs & campagnes (/communication/campagnes) : création + prévisualisation.
    await navigateInApp(page, '/communication/campagnes')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Segments d’audience et campagnes' }),
    ).toBeVisible()

    const segName = `Segment Douala E2E ${tag}`
    const segCard = main.locator('section[aria-labelledby="titre-segments"]')
    await segCard.getByLabel('Nom du segment (obligatoire)', { exact: true }).fill(segName)
    await segCard.getByLabel('Type de contact (obligatoire)', { exact: true }).selectOption('BOTH')
    await segCard.getByLabel('Origine d’acquisition', { exact: true }).selectOption('WHATSAPP')
    await segCard.getByRole('button', { name: 'Enregistrer le segment' }).click()
    await expect(segCard).toContainText(segName)

    const campCard = main.locator('section[aria-labelledby="titre-liste-campagnes"]')
    const campName = `Campagne Optique E2E ${tag}`
    await campCard.getByLabel('Nom de la campagne (obligatoire)', { exact: true }).fill(campName)
    await campCard
      .getByLabel('Segment d’audience (obligatoire)', { exact: true })
      .selectOption({ label: segName })
    await campCard
      .getByLabel('Révision de modèle approuvée (obligatoire)', { exact: true })
      .selectOption({ index: 1 })
    await campCard.getByRole('button', { name: 'Créer la campagne brouillon' }).click()

    const campRow = campCard.locator('tr', { hasText: campName })
    await expect(campRow).toBeVisible()
    await campRow.getByRole('button', { name: 'Piloter' }).click()

    const pilotCard = main.locator('section[aria-labelledby="titre-pilotage-campagne"]')
    await expect(pilotCard).toBeVisible()
    await pilotCard.getByRole('button', { name: 'Prévisualiser l’audience' }).click()
    await expect(pilotCard).toContainText(/Éligible|Prévisualisée|READY|Prévisualisation/i)
    await expectCleanCopy(main)

    // 9. Supervision outbox & webhooks (/communication/boite-envoi)
    await navigateInApp(page, '/communication/boite-envoi')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Boîte d’envoi et webhooks' }),
    ).toBeVisible()
    await main.getByRole('button', { name: 'Traiter un lot outbox' }).click()
    await expect(main).toContainText('Lot outbox traité')
    await main.getByRole('button', { name: 'Lancer le rattrapage global' }).click()
    await expect(main).toContainText('Rattrapage global terminé')
    await expectCleanCopy(main)
  })

  test('isolation RBAC : accueil et caissière refusés sur /parametres/integrations', async ({
    browser,
  }) => {
    for (const role of ['RECEPTION', 'CASHIER']) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await signIn(page, role)
      await page.goto('/parametres/integrations')
      await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible()
      await context.close()
    }
  })
})

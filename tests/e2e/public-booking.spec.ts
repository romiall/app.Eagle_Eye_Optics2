import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'

import { confirmPasswordIfAsked, signIn } from './support/device'

/**
 * Site public et réservation en ligne sur la vraie application (L3D02, L3D03, AT33, AT35) avec l'agenda et les articles de
 * DÉMONSTRATION : la gérante ouvre une prestation à la réservation en ligne, rend un article visible, écrit la fiche de
 * showroom d'une monture, dépose une image avec sa note de droits et la PUBLIE (mot de passe confirmé) ; un visiteur SANS
 * compte voit le showroom, ouvre la fiche et dépose une demande de rendez-vous qui la garde. Deux visiteurs qui visent le
 * même créneau ne passent pas tous les deux ; un téléphone déjà connu du cabinet ne change rien à ce que le visiteur voit.
 * Aucune donnée de santé n'est demandée. Tout est fictif.
 */

/** PNG gris uni de 240 × 240 px (au-dessus du minimum de 200 px du serveur), sans dépendance : IHDR, IDAT, IEND. */
function tinyPng(): Buffer {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (bytes: Buffer): number => {
    let crc = 0xffffffff
    for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }
  const size = 240
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 8 bits par canal
  header[9] = 2 // RVB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x7f)])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function newVisitor(browser: Browser, baseURL: string): Promise<BrowserContext> {
  // Un visiteur n'a ni compte ni cookie du cabinet : un contexte neuf, sans service worker.
  return browser.newContext({
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Africa/Douala',
    serviceWorkers: 'block',
  })
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/** Ouvre la prestation d'examen de démonstration à la réservation en ligne (écran de configuration de l'agenda). */
async function openExamToPublic(page: Page): Promise<void> {
  await page.goto('/agenda/configuration')
  const service = page.locator('article', { hasText: 'Examen de vue (démonstration)' })
  await expect(service).toBeVisible()
  if (await service.getByText('(réservable en ligne)').isVisible()) return
  await service.getByRole('button', { name: 'Modifier' }).click()
  await service.getByLabel('Ouverte à la réservation en ligne').check()
  await service.getByRole('button', { name: 'Enregistrer la prestation' }).click()
  await expect(service.getByText('(réservable en ligne)')).toBeVisible()
}

/** Premier créneau libre proposé au visiteur : la prestation est choisie d'office (une seule ouverte au public). */
async function pickFirstSlot(page: Page): Promise<string> {
  await page.goto('/rendez-vous')
  await expect(page.getByRole('heading', { level: 1, name: 'Prendre rendez-vous' })).toBeVisible()
  const hours = page.locator('input[name="rdv-heure"]')
  await expect(hours.first()).toBeAttached()
  const start = (await hours.first().getAttribute('value')) as string
  await hours.first().check()
  return start
}

async function fillContact(page: Page, name: string, phone: string): Promise<void> {
  // Par identifiant : le libellé du consentement cite aussi le téléphone (une recherche par libellé trouverait deux champs).
  await page.locator('#rdv-nom').fill(name)
  await page.locator('#rdv-telephone').fill(phone)
  await page.locator('#rdv-consentement').check()
}

test.describe('site public et réservation en ligne (L3D02, L3D03)', () => {
  test('la gérante publie une monture ; le visiteur la voit, ouvre sa fiche et demande un rendez-vous qui la garde', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000)
    const attempt = Math.min(testInfo.retry, 1)
    // Une fiche par article (une reprise de la CI retrouve la base de la première tentative) : un article par essai.
    const article = ['Monture fictive (démonstration)', 'Collyre fictif (démonstration)'][
      attempt
    ] as string
    const title = `Monture e2e ${['alpha', 'beta'][attempt]} ${Date.now() % 100000}`
    await signIn(page, 'MANAGER')

    // 1. La gérante ouvre la prestation au public et marque l'article « visible sur le site public ».
    await openExamToPublic(page)
    await page.goto('/ventes/catalogue')
    await page.getByRole('button', { name: `Modifier ${article}` }).click()
    await page.getByLabel('Visible sur le site public').check()
    await page.getByRole('button', { name: 'Enregistrer l’article' }).click()
    await expect(page.getByRole('main')).toContainText('enregistré sur le serveur')

    // 2. Elle écrit la fiche en brouillon : le public ne voit rien tant qu'elle n'a pas publié.
    await page.goto('/communication/site')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Site public : showroom et contenus' }),
    ).toBeVisible()
    // L'option porte « nom (référence) » : on la retrouve par le nom de l'article, sans connaître sa référence.
    const option = page.locator('select[id="fiche-article"] option', { hasText: article })
    await expect(option).toHaveCount(1)
    await page
      .getByLabel('Article du catalogue')
      .selectOption((await option.getAttribute('value')) as string)
    await page.getByLabel('Titre public').fill(title)
    await page
      .getByLabel('Description publique')
      .fill('Une monture légère pour tous les jours, donnée fictive du parcours e2e.')
    await page.getByRole('button', { name: 'Enregistrer la fiche en brouillon' }).click()
    const card = page.locator('li', { hasText: title }).filter({ hasText: 'Brouillon' })
    await expect(card).toBeVisible()
    const visitorContext = await newVisitor(browser, baseURL as string)
    const visitor = await visitorContext.newPage()
    await visitor.goto('/showroom')
    await expect(visitor.getByRole('heading', { level: 1, name: 'Showroom' })).toBeVisible()
    await expect(visitor.getByText(title)).toHaveCount(0)

    // 3. Image avec texte alternatif et note de droits, puis publication confirmée par le mot de passe.
    await card.getByLabel('Fichier (JPEG, PNG ou WebP, 3 Mo au plus)').setInputFiles({
      name: 'monture.png',
      mimeType: 'image/png',
      buffer: tinyPng(),
    })
    await card.getByLabel('Texte alternatif').fill('Monture grise vue de face')
    await card
      .getByLabel('Note de droits')
      .fill('Image fictive générée pour le test, publication autorisée')
    await card.getByRole('button', { name: `Déposer l’image pour ${title}` }).click()
    await expect(page.getByText('Image déposée')).toBeVisible()
    await card.getByLabel(`Décision pour ${title}`, { exact: true }).selectOption('PUBLISHED')
    await card.getByRole('button', { name: `Appliquer la décision pour ${title}` }).click()
    await confirmPasswordIfAsked(page, page.getByText(`« ${title} » est publiée`))

    // 4. Le visiteur voit la référence avec son image, sans prix ; l'API publique ne rend que la liste blanche.
    await visitor.goto('/showroom')
    const link = visitor.getByRole('link', { name: title })
    await expect(link).toBeVisible()
    const picture = visitor
      .locator('article', { hasText: title })
      .getByRole('img', { name: 'Monture grise vue de face' })
    await expect(picture).toBeVisible()
    // L'image vient de l'adresse publique : octets servis avec leur vrai type, puis décodée par le navigateur.
    const source = (await picture.getAttribute('src')) as string
    const served = await visitorContext.request.get(source)
    expect(served.status(), `GET ${source}`).toBe(200)
    expect(served.headers()['content-type']).toBe('image/png')
    await expect
      .poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0)
    await expect(visitor.getByRole('main')).not.toContainText('FCFA')
    const list = await visitorContext.request.get('/public/v1/showroom')
    expect(list.status()).toBe(200)
    const item = ((await list.json()) as { data: Record<string, unknown>[] }).data.find(
      (entry) => entry['title'] === title,
    ) as Record<string, unknown>
    expect(Object.keys(item).sort()).toEqual(
      ['brand', 'currency', 'description', 'media', 'price', 'slug', 'style', 'title'].sort(),
    )
    expect(item['price']).toBeNull()
    expect(JSON.stringify(item)).not.toMatch(/purchase|cost|stock|catalog_item|reference/i)

    // 5. Sa fiche : le bouton de rendez-vous emporte la référence, la demande part sans fausse confirmation.
    await link.click()
    await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await visitor.getByRole('link', { name: 'Essayer ce modèle' }).click()
    await expect(
      visitor.getByText(`Votre demande concerne la référence « ${title} »`),
    ).toBeVisible()
    await expect(visitor.locator('input[name="rdv-heure"]').first()).toBeAttached()
    await visitor.locator('input[name="rdv-heure"]').first().check()
    await fillContact(
      visitor,
      `Visiteur Showroom ${attempt}`,
      `+237 699 5${attempt} 00 0${attempt}`,
    )
    await visitor.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(visitor.getByText('Demande envoyée')).toBeVisible()
    await expect(visitor.getByRole('main')).toContainText('ce n’est pas un rendez-vous confirmé')
    await expect(visitor.getByRole('main')).not.toContainText(/rendez-vous (est )?confirmé par/i)

    // 6. À 360 px, rien ne déborde sur les pages du public.
    await visitor.setViewportSize({ width: 360, height: 780 })
    for (const path of ['/showroom', '/rendez-vous']) {
      await visitor.goto(path)
      await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await horizontalOverflow(visitor), `${path} déborde à 360 px`).toBeLessThanOrEqual(0)
    }

    // 7. La gérante retrouve la demande dans la boîte des réservations publiques.
    await page.goto('/communication/reservations')
    await expect(page.getByRole('main')).toContainText(`Visiteur Showroom ${attempt}`)
    await visitorContext.close()
  })

  test('deux visiteurs sur le même créneau : un seul passe ; un téléphone connu du cabinet ne change rien à ce que voit le visiteur', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000)
    const attempt = Math.min(testInfo.retry, 1)
    await signIn(page, 'MANAGER')
    await openExamToPublic(page)

    // Un patient du cabinet dont le téléphone sera saisi par un visiteur (AT35 : aucune énumération).
    const knownPhone = ['+237 600 00 21 01', '+237 600 00 24 01'][attempt] as string
    const reception = await newVisitor(browser, baseURL as string)
    const staff = await reception.newPage()
    await signIn(staff, 'RECEPTION')
    await staff.goto('/patients/nouveau')
    await staff
      .getByLabel('Nom (obligatoire)')
      .fill(['Connu Réservation', 'Inscrit Réservation'][attempt] as string)
    await staff.getByLabel('Prénom(s)').fill('Test')
    await staff.getByLabel('Sexe').selectOption({ label: 'Féminin' })
    await staff.getByLabel('Date de naissance', { exact: true }).fill('12/09/1990')
    await staff.getByLabel('Téléphone principal').fill(knownPhone)
    await staff.getByRole('button', { name: 'Enregistrer le patient' }).click()
    await expect(staff).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await reception.close()

    const contextA = await newVisitor(browser, baseURL as string)
    const contextB = await newVisitor(browser, baseURL as string)
    const contextC = await newVisitor(browser, baseURL as string)
    const [a, b, c] = await Promise.all([
      contextA.newPage(),
      contextB.newPage(),
      contextC.newPage(),
    ])

    // A et B regardent le MÊME premier créneau ; C en choisit un autre (le dernier du premier jour affiché).
    const first = await pickFirstSlot(a)
    const sameSlot = await pickFirstSlot(b)
    expect(sameSlot).toBe(first)
    await pickFirstSlot(c)
    await c.locator('input[name="rdv-heure"]').last().check()

    // A (téléphone CONNU du cabinet) et C (téléphone inconnu) reçoivent la même réponse.
    const receiptA = a.waitForResponse((response) =>
      response.url().endsWith('/public/v1/booking-requests'),
    )
    await fillContact(a, 'Visiteur Connu', knownPhone)
    await a.getByRole('button', { name: 'Envoyer ma demande' }).click()
    const answerA = await receiptA
    await expect(a.getByText('Demande envoyée')).toBeVisible()

    const receiptC = c.waitForResponse((response) =>
      response.url().endsWith('/public/v1/booking-requests'),
    )
    await fillContact(c, 'Visiteur Inconnu', `+237 699 7${attempt} 00 0${attempt}`)
    await c.getByRole('button', { name: 'Envoyer ma demande' }).click()
    const answerC = await receiptC
    await expect(c.getByText('Demande envoyée')).toBeVisible()

    expect(answerA.status()).toBe(201)
    expect(answerC.status()).toBe(201)
    const bodyA = ((await answerA.json()) as { data: Record<string, unknown> }).data
    const bodyC = ((await answerC.json()) as { data: Record<string, unknown> }).data
    expect(Object.keys(bodyA).sort()).toEqual(Object.keys(bodyC).sort())
    expect(bodyA['status']).toBe(bodyC['status'])
    const wording = (text: string): string =>
      text.replace(/RDV[-\w]*/g, '#').replace(/\d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}/g, 'DATE')
    expect(wording(await a.getByRole('main').innerText())).not.toMatch(/patient|dossier|connu/i)
    expect(
      wording(await a.locator('section', { hasText: 'Demande envoyée' }).first().innerText()),
    ).toBe(wording(await c.locator('section', { hasText: 'Demande envoyée' }).first().innerText()))

    // B vise le créneau déjà demandé par A : refusé, dit en clair, et le créneau n'est plus proposé.
    await fillContact(b, 'Visiteur Retardataire', `+237 699 8${attempt} 00 0${attempt}`)
    await b.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(b.getByText('Ce créneau vient d’être pris. Choisissez-en un autre.')).toBeVisible()
    await expect(b.getByText('Demande envoyée')).toHaveCount(0)
    await expect(b.locator(`input[name="rdv-heure"][value="${first}"]`)).toHaveCount(0)

    await Promise.all([contextA.close(), contextB.close(), contextC.close()])
  })
})

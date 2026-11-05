import { expect, type Locator, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Mise en page des formulaires, MESURÉE dans le navigateur (le CSS ne se vérifie pas en jsdom) : un
 * bouton posé à côté d'un champ reste aligné sur la saisie, avec ou sans aide sous elle, à 768,
 * 1024 et 1280 px ; sous 640 px la rangée est empilée et le champ garde sa largeur ; les icônes et
 * le chevron des champs ont leur remplissage (l'ordre du CSS généré arbitre px-3 et pl-10 / pr-10).
 * Le contrat de base.css est en plus lu par tests/frontend/shell/form-styles.test.ts.
 *
 * Deux séries : polices du poste, puis POLICE LARGE. La CI Linux retombe sur une police bien plus
 * large que celles de Windows et d'Apple (DejaVu Sans) : une étiquette qui tient sur une ligne en
 * local passe sur deux lignes en CI et décale la saisie du bouton aligné sur elle. La série « police
 * large » (Verdana, de largeur voisine) le fait voir en local.
 */
const WIDE_FONT = 'Verdana'

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/** Impose la police large à chaque page, avant son premier rendu (nécessite `bypassCSP`). */
async function useWideFont(page: Page): Promise<void> {
  await page.addInitScript((family) => {
    const style = document.createElement('style')
    style.textContent = `*, *::before, *::after { font-family: ${family}, 'DejaVu Sans', sans-serif !important }`
    const attach = (): void => {
      if (document.head && !document.head.contains(style)) document.head.appendChild(style)
    }
    document.addEventListener('DOMContentLoaded', attach)
    new MutationObserver(attach).observe(document, { childList: true, subtree: true })
  }, WIDE_FONT)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator, what: string): Promise<Box> {
  await expect(locator, what).toBeVisible()
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${what} : aucune position`)
  return found
}

const center = (found: Box): number => found.y + found.height / 2

/** Le centre vertical du bouton est celui de la saisie, à 2 px près. */
async function expectAligned(
  page: Page,
  input: Locator,
  button: Locator,
  what: string,
): Promise<void> {
  const field = await box(input, `${what} : saisie`)
  const action = await box(button, `${what} : bouton`)
  expect(
    Math.abs(center(field) - center(action)),
    `${what} à ${page.viewportSize()?.width} px : bouton et saisie alignés`,
  ).toBeLessThanOrEqual(2)
}

/** `lower` est entièrement sous `upper` (rangée empilée, aucun décalage d'étiquette). */
async function expectBelow(
  page: Page,
  upper: Locator,
  lower: Locator,
  what: string,
): Promise<void> {
  const first = await box(upper, `${what} : élément du haut`)
  const second = await box(lower, `${what} : élément du bas`)
  expect(second.y, `${what} à ${page.viewportSize()?.width} px : empilés`).toBeGreaterThanOrEqual(
    first.y + first.height,
  )
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

for (const wide of [false, true]) {
  test.describe(`mise en page des formulaires${wide ? ' (police large)' : ''}`, () => {
    if (wide) test.use({ bypassCSP: true })

    test.beforeEach(async ({ page }) => {
      if (wide) await useWideFont(page)
    })

    test('un bouton posé à côté d’un champ est aligné sur la saisie à 768, 1024 et 1280 px', async ({
      page,
    }) => {
      await signIn(page, 'MANAGER')

      for (const width of [768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 })

        // Rangées flex avec `.field-action` : recherche de patients, caisse du jour.
        await page.goto('/patients')
        await expectAligned(
          page,
          page.getByRole('searchbox', { name: 'Rechercher un patient' }),
          page.getByRole('button', { name: 'Rechercher' }),
          'liste des patients',
        )
        await page.goto('/ventes/caisse-du-jour')
        const day = page.locator('#caisse-jour-date')
        await expectAligned(
          page,
          day,
          page.getByRole('button', { name: 'Afficher' }),
          'caisse du jour',
        )
        await expectAligned(
          page,
          day,
          page.getByRole('button', { name: 'Aujourd’hui' }),
          'caisse du jour (Aujourd’hui)',
        )

        // Barres `.toolbar` : suivis et agenda (champ avec l'aide par défaut du DateField sous la saisie).
        await page.goto('/suivis')
        await expectAligned(
          page,
          page.locator('#suivis-jour'),
          page.getByRole('button', { name: 'Afficher' }),
          'suivis',
        )
        await page.goto('/agenda')
        await expectAligned(
          page,
          page.locator('#agenda-jour'),
          page.getByRole('button', { name: 'Afficher', exact: true }),
          'agenda',
        )
      }
    })

    test('« Aujourd’hui » : navigation du jour sur sa ligne ; date et « Actualiser la file » empilées à 768 px, alignées dès 1024 px', async ({
      page,
    }) => {
      await signIn(page, 'MANAGER')

      for (const width of [768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('/aujourdhui')
        const date = page.locator('#aujourdhui-jour')
        const refresh = page.getByRole('button', { name: 'Actualiser la file' })
        if (width >= 1024) {
          await expectAligned(page, date, refresh, 'file du jour')
        } else {
          // Empilées : à côté du menu la colonne de la date rétrécit, son étiquette (plus large sur la
          // CI Linux) passerait sur deux lignes et décalerait la saisie du bouton aligné sur elle.
          await expectBelow(page, date, refresh, 'file du jour')
        }
        // Les trois boutons de navigation du jour sont sur leur propre ligne, au-dessus : aucun
        // décalage d'étiquette à leur donner, quelle que soit la largeur des polices.
        await expectBelow(
          page,
          page.getByRole('button', { name: 'Jour précédent' }),
          date,
          'navigation du jour puis saisie',
        )
        expect(await horizontalOverflow(page), `débordement à ${width} px`).toBeLessThanOrEqual(0)
      }
    })

    test('exports : empilés à 768 px (carte étroite), côte à côte et alignés dès 1024 px', async ({
      page,
    }) => {
      await signIn(page, 'MANAGER')
      const send = page.getByRole('button', { name: 'Demander l’export' })

      // Tablette : la liste puis le bouton dessous, sans décalage d'étiquette ni retour à la ligne
      // dépendant de la largeur des polices.
      await page.setViewportSize({ width: 768, height: 900 })
      await page.goto('/parametres/exports')
      await expectBelow(page, page.locator('#export-type'), send, 'exports')
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

      // Ordinateur : une ligne, le bouton aligné sur la saisie.
      for (const width of [1024, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expectAligned(page, page.locator('#export-type'), send, 'exports')
      }
    })

    test('téléphone 360 px : la caisse du jour empile le champ et ses boutons, le champ garde sa largeur', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 740 })
      await signIn(page, 'MANAGER')
      await page.goto('/ventes/caisse-du-jour')

      const day = await box(page.locator('#caisse-jour-date'), 'saisie du jour')
      const show = await box(page.getByRole('button', { name: 'Afficher' }), 'Afficher')
      const today = await box(page.getByRole('button', { name: 'Aujourd’hui' }), 'Aujourd’hui')

      // Empilés : le champ occupe la largeur de l'écran (la date « 28/10/2026 » tient en entier), les
      // boutons sont dessous (aucun décalage d'étiquette qui les laisserait au niveau du libellé).
      expect(day.width, 'largeur de la saisie').toBeGreaterThanOrEqual(250)
      expect(show.y, 'Afficher sous la saisie').toBeGreaterThanOrEqual(day.y + day.height)
      expect(today.y, 'Aujourd’hui sous Afficher').toBeGreaterThanOrEqual(show.y + show.height)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    })

    if (!wide) {
      test('les icônes et le chevron ont leur place : le remplissage de la saisie passe devant px-3', async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 900 })
        await signIn(page, 'RECEPTION')
        await page.goto('/patients/nouveau')
        await expect(page.getByLabel('Nom (obligatoire)')).toBeVisible()

        const padding = (locator: Locator, side: 'Left' | 'Right'): Promise<number> =>
          locator.evaluate(
            (element, edge) => Number.parseFloat(getComputedStyle(element)[`padding${edge}`]),
            side,
          )

        // Téléphone : icône à gauche (pl-10 = 40 px) ; liste : chevron à droite (pr-10 = 40 px) ;
        // saisie simple : remplissage d'origine (px-3 = 12 px).
        expect(
          await padding(page.getByLabel('Téléphone principal'), 'Left'),
        ).toBeGreaterThanOrEqual(40)
        expect(await padding(page.getByLabel('Sexe'), 'Right')).toBeGreaterThanOrEqual(40)
        expect(await padding(page.getByLabel('Nom (obligatoire)'), 'Left')).toBe(12)
        expect(await padding(page.getByLabel('Nom (obligatoire)'), 'Right')).toBe(12)
      })
    }
  })
}

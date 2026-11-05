import { expect, type Locator, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { foreignRequests, recordRequests } from './support/browser'

/**
 * Aide intégrée sur la vraie application (docs/implementation/help.md), MESURÉE dans un vrai navigateur :
 * ce que jsdom ne prouve pas (focus rendu au bouton, touche ?, droits réels du serveur, chargement à la
 * demande sous la vraie politique de sécurité, largeur de téléphone). Deux familles :
 *
 * - l'aide d'ÉCRAN : le bouton « Aide » de l'en-tête ouvre un panneau (dialogue « Aide de cette page ») qui
 *   porte la fiche de l'écran en cours, filtrée par les droits du compte ; il reste fermé tant qu'on ne le
 *   demande pas (aucun bandeau, aucune pastille, aucun stockage navigateur) ;
 * - la DOCUMENTATION (/aide) : sommaire par parties, recherche, rubriques et fiches d'écran ouvertes par leur
 *   ancre (#/rubrique, #/ecran/nom-de-route), choix « Lire l’aide comme » réservé à la gérante.
 *
 * Les libellés cités sont ceux des contrats des composants (bouton, panneau, écran Documentation). Le balisage
 * interne n'est supposé que là où le contrat le fixe : les rubriques d'une fiche sont des titres (« Vous êtes
 * ici », « Ce que vous pouvez faire ici », « Pas à pas »…), les liens vers la documentation portent une ancre
 * `#/…`. Le reste se lit par l'ordre du document (voir `sliceOf`), pas par une classe ni une structure.
 *
 * Aucune donnée n'est modifiée, sauf un patient FICTIF créé pour ouvrir un dossier (un seul test, téléphone
 * propre à cette spec). Tout est fictif.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/** Espaces (insécables compris) réduits à un seul : la forme sous laquelle on compare les textes lus. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

type Scope = Pick<Page, 'getByRole'>

const SEARCH_LABEL = 'Chercher dans la documentation'
/** Une fiche d'écran affiche cette rubrique en premier : sa présence prouve qu'une fiche est rendue. */
const FIRST_RUBRIC = 'Vous êtes ici'
/** Les rubriques d'une fiche d'écran, toujours dans cet ordre (une rubrique vide n'est pas affichée). */
const RUBRICS = [
  'Vous êtes ici',
  'Ce que vous pouvez faire ici',
  'Pas à pas',
  'Comment ça marche',
  'Ensuite',
  'À savoir',
  'Si ça ne marche pas',
  'Mots utiles',
] as const
/** Ligne discrète du panneau quand des actions sont réservées à d'autres profils. */
const HIDDEN_NOTE = /Des actions réservées à d.autres profils ne sont pas affichées/

/** Bouton « Aide » de l'en-tête. */
const helpButton = (page: Page): Locator => page.getByRole('button', { name: /^Aide\b/ })

/** Panneau d'aide de l'écran : un dialogue, absent de l'arbre d'accessibilité tant qu'il est fermé. */
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Aide de cette page' })

/** Champ de recherche de la documentation (le panneau et l'écran Documentation ont le même libellé). */
const searchField = (scope: Scope): Locator =>
  scope
    .getByRole('searchbox', { name: SEARCH_LABEL })
    .or(scope.getByRole('textbox', { name: SEARCH_LABEL }))

/** Sommaire de l'écran Documentation. */
const contents = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Sommaire de la documentation' })

/** Titre « Vous êtes ici » d'une fiche d'écran affichée dans la page (hors panneau fermé). */
const sheetMarker = (page: Page): Locator => page.getByRole('heading', { name: FIRST_RUBRIC })

/** Liens des résultats de recherche : les liens vers une ancre de la documentation hors du sommaire. */
const results = (page: Page): Locator => page.getByRole('main').locator('a[href*="#/"]:not(nav a)')

const documentation = (page: Page): Locator =>
  page.getByRole('heading', { level: 1, name: 'Documentation' })

/** Ouvre le panneau par le bouton de l'en-tête et attend la fiche (le contenu est chargé à la demande). */
async function openPanel(page: Page): Promise<Locator> {
  await helpButton(page).click()
  const dialog = panel(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: FIRST_RUBRIC })).toBeVisible()
  return dialog
}

/**
 * Texte lu dans le panneau, d'après l'ordre du document : une rubrique (de son titre jusqu'au titre suivant de
 * même niveau ou supérieur) ou, avec « before », tout ce qui précède le titre. Le test ne dépend donc pas du
 * balisage choisi pour les rubriques (section, liste, sous-titres des tâches). Les textes sont joints par une
 * espace : « Rechercher » et son effet ne se collent pas.
 */
async function sliceOf(root: Locator, title: string, mode: 'section' | 'before'): Promise<string> {
  return root.evaluate(
    (element, wanted) => {
      const squashed = (text: string): string => text.replace(/\s+/g, ' ').trim()
      const levelOf = (heading: Element): number => {
        const aria = Number(heading.getAttribute('aria-level'))
        if (aria > 0) return aria
        return Number(heading.tagName.slice(1)) || 3
      }
      const headings = Array.from(
        element.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'),
      )
      const index = headings.findIndex(
        (heading) => squashed(heading.textContent ?? '') === wanted.title,
      )
      const start = headings[index]
      if (start === undefined) return ''
      const range = document.createRange()
      range.selectNodeContents(element)
      if (wanted.mode === 'before') {
        range.setEndBefore(start)
      } else {
        range.setStartAfter(start)
        const stop = headings.slice(index + 1).find((heading) => levelOf(heading) <= levelOf(start))
        if (stop !== undefined) range.setEndBefore(stop)
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const parts: string[] = []
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (range.intersectsNode(node)) parts.push(node.textContent ?? '')
      }
      return squashed(parts.join(' '))
    },
    { title, mode },
  )
}

/** Le titre de l'écran figure dans l'en-tête du panneau, avant la première rubrique. */
async function expectTitleShown(
  dialog: Locator,
  accepted: readonly (string | RegExp)[],
  what: string,
): Promise<void> {
  const head = await sliceOf(dialog, FIRST_RUBRIC, 'before')
  const found = accepted.some((title) =>
    typeof title === 'string' ? head.includes(title) : title.test(head),
  )
  expect(
    found,
    `${what} : titre attendu parmi « ${accepted.join(' | ')} » avant « ${FIRST_RUBRIC} », lu : « ${head.slice(0, 240)} »`,
  ).toBe(true)
}

/**
 * Ouvre une adresse de la documentation à neuf (page blanche puis chargement complet) : le contenu rendu est
 * celui de l'adresse, jamais celui d'une vue précédente.
 */
async function openFresh(page: Page, path: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(path)
}

/**
 * Déplie tous les `details` de la page (tâches « Pas à pas », questions fréquentes, parties du sommaire) : un
 * contenu replié n'a aucune largeur, il ne prouve rien sur le défilement horizontal.
 */
async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((details) => {
      details.open = true
    })
  })
}

/** Attend que le contenu principal ne change plus (rendu terminé après un changement d'ancre). */
async function settled(page: Page): Promise<void> {
  const main = page.getByRole('main')
  let previous: string | null = null
  await expect
    .poll(
      async () => {
        const current = await main.innerText()
        const same = current === previous
        previous = current
        return same
      },
      { intervals: [100, 100, 200, 200, 500], timeout: 15_000 },
    )
    .toBe(true)
}

/**
 * Passe à une autre ancre de l'écran Documentation SANS recharger la page (changement d'ancre dans le même
 * document) : le contenu change, puis se stabilise.
 */
async function openAnchor(page: Page, hash: string): Promise<void> {
  const main = page.getByRole('main')
  const before = await main.innerText()
  await page.goto(`/aide${hash}`)
  await expect
    .poll(() => main.innerText(), { message: `/aide${hash} : le contenu change`, timeout: 15_000 })
    .not.toBe(before)
  await settled(page)
}

/** Écrans représentatifs de la gérante (tous ouverts dans l'environnement e2e) et leur titre d'onglet. */
const SCREENS: readonly { path: string; title: string }[] = [
  { path: '/', title: 'Accueil' },
  { path: '/aujourdhui', title: 'Aujourd’hui' },
  { path: '/patients', title: 'Patients' },
  { path: '/patients/nouveau', title: 'Nouveau patient' },
  { path: '/consultations', title: 'Consultations' },
  { path: '/ventes', title: 'Ventes et caisse' },
  { path: '/ventes/factures', title: 'Factures' },
  { path: '/ventes/caisse', title: 'Caisse' },
  { path: '/ventes/caisse-du-jour', title: 'Caisse du jour' },
  { path: '/ventes/catalogue', title: 'Catalogue' },
  { path: '/stock', title: 'Stock' },
  { path: '/agenda', title: 'Agenda' },
  { path: '/suivis', title: 'Patients à rappeler' },
  { path: '/parametres', title: 'Paramètres' },
  { path: '/parametres/personnel', title: 'Personnel' },
  { path: '/rapports/statistiques', title: 'Statistiques' },
  { path: '/mon-compte/mot-de-passe', title: 'Changer mon mot de passe' },
  // L'écran Documentation a lui aussi sa fiche (titre de l'écran : « Documentation »).
  { path: '/aide', title: 'Documentation' },
]

/** Identifiants fixes des rubriques de la documentation (docs/implementation/help.md). */
const TOPIC_IDS: readonly string[] = [
  'bienvenue',
  'se-connecter',
  'se-reperer',
  'profils',
  'principes',
  'journee-type',
  'parcours-accueillir',
  'parcours-rendez-vous',
  'parcours-examen',
  'parcours-ordonnance',
  'parcours-suivi',
  'parcours-vente',
  'parcours-devis',
  'parcours-remise-article',
  'parcours-correction',
  'parcours-caisse',
  'parcours-stock',
  'parcours-gestion',
  'guide-accueil',
  'guide-professionnel',
  'guide-caisse',
  'guide-gerante',
  'notion-patient',
  'notion-visite-examen',
  'notion-examen-prescription',
  'notion-documents',
  'notion-securite',
  'notion-modules',
  'notion-facture',
  'notion-encaissement',
  'notion-caisse',
  'notion-stock',
  'notion-approbations',
  'glossaire-optique',
  'glossaire-gestion',
  'depannage-messages',
  'depannage-questions',
  'depannage-limites',
  'avant-installation',
  'premiere-configuration',
  'repetition-generale',
  'exploitation',
]

/** Fiches d'écran parmi les plus longues (facture, consultation, poste hors ligne en validation…). */
const LONG_SHEETS: readonly string[] = [
  'facture',
  'consultation',
  'patient',
  'caisse',
  'devis-detail',
  'stock',
  'agenda',
  'statistiques',
  'parametres-cabinet',
  'parametres-poste',
]

test.describe('aide d’écran : le panneau de l’en-tête', () => {
  test('« Aide » ouvre le panneau de l’écran ; « Fermer » et Échap le ferment et rendent le focus', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/patients')
    await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible()

    // Fermé tant qu'on ne le demande pas : ni panneau ni fiche dans la page.
    const dialog = panel(page)
    await expect(dialog).toBeHidden()
    await expect(sheetMarker(page)).toHaveCount(0)

    const aide = helpButton(page)
    await aide.click()
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'Ce que vous pouvez faire ici' }),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Pas à pas' })).toBeVisible()
    await expectTitleShown(dialog, ['Patients'], '/patients')

    // Les huit rubriques de la fiche de /patients, dans l'ordre du contrat.
    const titles = (await dialog.getByRole('heading').allTextContents()).map(squash)
    const positions = RUBRICS.map((rubric) => titles.indexOf(rubric))
    expect(positions, `rubriques lues : ${titles.join(' | ')}`).not.toContain(-1)
    expect(positions, 'ordre des rubriques').toEqual([...positions].sort((a, b) => a - b))

    // « Fermer » ferme et rend le focus au bouton « Aide ».
    await dialog.getByRole('button', { name: 'Fermer' }).first().click()
    await expect(dialog).toBeHidden()
    await expect(aide).toBeFocused()

    // Échap aussi.
    await aide.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(aide).toBeFocused()

    // Aucun stockage navigateur (les gardes du frontend interdisent localStorage et sessionStorage).
    const stored = await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }))
    expect(stored).toEqual({ local: 0, session: 0 })
  })

  test('la touche ? ouvre le panneau hors d’un champ de saisie, jamais dans un champ', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/patients')
    const search = page.getByRole('searchbox', { name: 'Rechercher un patient' })
    await expect(search).toBeVisible()
    const dialog = panel(page)

    // Dans un champ : le caractère est saisi, le panneau reste fermé.
    await search.click()
    await page.keyboard.press('?')
    await expect(search).toHaveValue('?')
    // Assertion négative : laisser au panneau le temps de s'ouvrir s'il le faisait (chargement à la demande).
    await page.waitForTimeout(600)
    await expect(dialog).toBeHidden()

    // Hors champ : le panneau s'ouvre, sur la fiche de l'écran.
    await search.fill('')
    await search.blur()
    await page.keyboard.press('?')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: FIRST_RUBRIC })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  for (const { role, who, canCreate } of [
    { role: 'RECEPTION', who: 'l’accueil', canCreate: true },
    { role: 'CASHIER', who: 'la caissière', canCreate: false },
  ] as const) {
    test(`droits : ${who} ${canCreate ? 'voit' : 'ne voit pas'} l’action « Nouveau patient » dans le panneau de /patients`, async ({
      page,
    }) => {
      await signIn(page, role)
      await page.goto('/patients')
      const dialog = await openPanel(page)
      const actions = await sliceOf(dialog, 'Ce que vous pouvez faire ici', 'section')
      const tasks = await sliceOf(dialog, 'Pas à pas', 'section')

      // Tout compte qui lit les fiches peut chercher.
      expect(actions).toContain('Rechercher')
      expect(tasks).toContain('Retrouver un patient')

      if (canCreate) {
        expect(actions).toContain('Nouveau patient')
        expect(actions).toContain('Créer un nouveau patient')
        expect(tasks).toContain('Créer un patient qui n’existe pas encore')
      } else {
        expect(actions).not.toContain('Nouveau patient')
        expect(actions).not.toContain('Créer un nouveau patient')
        expect(tasks).not.toContain('Créer un patient')
        // Ce qui est caché est dit, sans être montré.
        await expect(dialog).toContainText(HIDDEN_NOTE)
      }
    })
  }

  test('« Ensuite » et « Mots utiles » : les liens ouvrent la rubrique ou l’écran et ferment le panneau', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/patients')
    let dialog = await openPanel(page)

    // « Mots utiles » : « Numéro de dossier » n'est pas un mot d'optique, il renvoie au glossaire de gestion.
    await expect(dialog.locator('a[href$="#/glossaire-gestion"]').first()).toBeVisible()

    // « Ensuite », rubrique de la documentation : le premier lien vers une ancre (avant « Mots utiles », qui
    // suit dans le document) ouvre l'écran Documentation sur cette ancre, et le panneau se ferme.
    const topic = dialog.locator('a[href*="/aide#/"]').first()
    const anchor = (await topic.getAttribute('href')) ?? ''
    expect(anchor, 'lien vers une rubrique').toMatch(/\/aide#\/[a-z0-9-]+$/)
    await topic.click()
    await expect(page).toHaveURL((url) => url.pathname + url.hash === anchor)
    await expect(documentation(page)).toBeVisible()
    await expect(panel(page)).toBeHidden()

    // « Ensuite », autre écran : le lien vers le formulaire de création ouvre cet écran.
    await page.goto('/patients')
    dialog = await openPanel(page)
    await dialog.locator('a[href$="/patients/nouveau"]').first().click()
    await expect(page).toHaveURL(/\/patients\/nouveau$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Nouveau patient' })).toBeVisible()
    await expect(panel(page)).toBeHidden()
  })

  test('le panneau s’ouvre sur les écrans représentatifs de la gérante, sans erreur ni requête étrangère', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000)
    await signIn(page, 'MANAGER')
    const origin = new URL(page.url()).origin
    const requested = recordRequests(context)
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    for (const screen of SCREENS) {
      await page.goto(screen.path)
      const h1 = page.getByRole('heading', { level: 1 }).first()
      await expect(h1, `${screen.path} : écran affiché`).toBeVisible()
      const heading = squash((await h1.textContent()) ?? '')

      // Seules les erreurs levées par l'ouverture du panneau comptent ici : celles du chargement de l'écran
      // (lectures du serveur encore en vol) sont écartées en attendant la fin des échanges.
      await page.waitForLoadState('networkidle')
      consoleErrors.length = 0
      const dialog = await openPanel(page)
      await expectTitleShown(dialog, [screen.title, heading], screen.path)
      expect(consoleErrors, `${screen.path} : erreur de console à l’ouverture du panneau`).toEqual(
        [],
      )
      await dialog.getByRole('button', { name: 'Fermer' }).first().click()
      await expect(dialog, `${screen.path} : panneau fermé`).toBeHidden()
    }

    expect(pageErrors).toEqual([])
    expect(foreignRequests(requested, origin)).toEqual([])
  })

  test('le panneau suit une adresse avec identifiant : le dossier d’un patient', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signIn(page, 'RECEPTION')
    await page.goto('/patients/nouveau')
    await page.getByLabel('Nom (obligatoire)').fill('Aide Dossier')
    await page.getByLabel('Prénom(s)').fill('Mireille')
    await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
    await page.getByLabel('Date de naissance', { exact: true }).fill('21/06/1988')
    await page.getByLabel('Téléphone principal').fill('+237 600 00 11 01')
    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()

    // Une ressemblance (nouvelle tentative de la CI) est signalée, jamais bloquante.
    const alike = page.getByRole('dialog').getByRole('button', { name: 'Créer quand même' })
    const record = page.getByRole('heading', { level: 1 }).filter({ hasText: 'Aide Dossier' })
    await expect(alike.or(record)).toBeVisible()
    if (await alike.isVisible()) await alike.click()
    await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await expect(record).toBeVisible()

    const dialog = await openPanel(page)
    await expectTitleShown(dialog, [/Dossier|Fiche/, 'Aide Dossier'], 'dossier du patient')
  })

  test('« Toute la documentation » et la recherche du panneau mènent à l’écran Documentation', async ({
    page,
  }) => {
    await signIn(page, 'MANAGER')
    await page.goto('/patients')
    let dialog = await openPanel(page)

    await dialog.getByRole('link', { name: 'Toute la documentation' }).click()
    await expect(page).toHaveURL(/\/aide(?:[?#].*)?$/)
    await expect(documentation(page)).toBeVisible()
    await expect(panel(page)).toBeHidden()

    // La recherche du panneau ouvre la documentation sur ses résultats.
    await page.goto('/patients')
    dialog = await openPanel(page)
    await searchField(dialog).fill('facture')
    await dialog.getByRole('button', { name: 'Chercher', exact: true }).click()
    await expect(page).toHaveURL(/\/aide\?q=facture/)
    await expect(documentation(page)).toBeVisible()
    await expect(panel(page)).toBeHidden()
    await expect(searchField(page)).toHaveValue('facture')
    await expect(results(page).first()).toBeVisible()
    await expect(page.getByText('Aucun résultat')).toHaveCount(0)
  })
})

test.describe('documentation (/aide)', () => {
  test('gérante : sommaire par parties, rubrique par son ancre, recherche, choix du profil', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signIn(page, 'MANAGER')
    await page.goto('/aide')
    await expect(documentation(page)).toBeVisible()
    await expect(page).toHaveTitle(/Eagle’s Eye Optics Medical/)

    // Sommaire par parties, « Mise en service » comprise (la gérante gère le personnel).
    await expect(contents(page)).toBeVisible()
    for (const part of [
      'Démarrer',
      'Parcours pas à pas',
      'Guides par profil',
      'Notions et règles',
      'Glossaire',
      'Dépannage',
      'Mise en service',
    ]) {
      await expect(contents(page), `partie « ${part} » du sommaire`).toContainText(part)
    }
    await expect(page.getByRole('main')).toContainText('Référence des écrans')

    // Seule la gérante peut lire l'aide comme un autre profil.
    await expect(page.getByText('Lire l’aide comme').first()).toBeVisible()

    // Une rubrique s'ouvre par son ancre.
    await openFresh(page, '/aide#/bienvenue')
    await expect(page.getByRole('heading', { name: /bienvenue/i }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/aide#\/bienvenue$/)

    // Une fiche d'écran aussi, y compris celle de la caisse (la gérante a tous les droits).
    for (const route of ['patients', 'caisse']) {
      await openFresh(page, `/aide#/ecran/${route}`)
      await expect(sheetMarker(page), `fiche de l’écran « ${route} »`).toBeVisible()
    }

    // Recherche : des résultats pour « facture », « Aucun résultat » pour un mot inconnu.
    await page.goto('/aide')
    const field = searchField(page)
    await field.fill('facture')
    await field.press('Enter')
    await expect(results(page).first()).toBeVisible()
    await expect(page.getByText('Aucun résultat')).toHaveCount(0)

    await field.fill('zzzz')
    await field.press('Enter')
    await expect(page.getByText('Aucun résultat').first()).toBeVisible()
  })

  test('accueil : ni « Mise en service », ni choix du profil, ni fiches de la caisse', async ({
    page,
  }) => {
    await signIn(page, 'RECEPTION')
    await page.goto('/aide')
    await expect(documentation(page)).toBeVisible()
    await expect(contents(page)).toBeVisible()
    // Le contenu est chargé à la demande : le sommaire n'est complet qu'ensuite.
    await expect(contents(page)).toContainText('Démarrer')
    await expect(contents(page)).not.toContainText('Mise en service')
    await expect(contents(page).locator('a[href$="#/avant-installation"]')).toHaveCount(0)
    await expect(page.getByText('Lire l’aide comme')).toHaveCount(0)

    // Sa propre fiche s'ouvre ; celles de la caisse et des factures n'existent pas pour elle.
    await openFresh(page, '/aide#/ecran/patients')
    await expect(sheetMarker(page)).toBeVisible()
    for (const route of ['caisse', 'caisse-du-jour', 'factures']) {
      await page.goto(`/aide#/ecran/${route}`)
      await expect(sheetMarker(page), `fiche « ${route} » absente`).toHaveCount(0)
      await expect(page.locator(`a[href$="#/ecran/${route}"]`)).toHaveCount(0)
    }
  })

  test('la gérante lit l’aide comme l’accueil : « Mise en service » disparaît du sommaire', async ({
    page,
  }) => {
    await signIn(page, 'MANAGER')
    await page.goto('/aide')
    await expect(contents(page)).toContainText('Mise en service')

    const chooser = page.getByLabel('Lire l’aide comme')
    const options = (await chooser.locator('option').allTextContents()).map(squash)
    const asReception = options.findIndex((label) => /accueil/i.test(label))
    const asManager = options.findIndex((label) => /gérante/i.test(label))
    expect(asReception, `profils proposés : ${options.join(' | ')}`).toBeGreaterThanOrEqual(0)
    expect(asManager, `profils proposés : ${options.join(' | ')}`).toBeGreaterThanOrEqual(0)

    await chooser.selectOption({ index: asReception })
    await expect(contents(page)).not.toContainText('Mise en service')

    await chooser.selectOption({ index: asManager })
    await expect(contents(page)).toContainText('Mise en service')
  })
})

/**
 * POLICE LARGE (même méthode que forms-layout.spec.ts) : la CI Linux retombe sur une police bien plus large que
 * celles de Windows et d'Apple (DejaVu Sans) ; un mot ou une puce de libellé qui tient en local peut y déborder.
 * Verdana, de largeur voisine, le fait voir en local. Nécessite `bypassCSP` : le style est injecté avant le
 * premier rendu.
 */
const WIDE_FONT = 'Verdana'

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

/** Éléments dont le bord droit dépasse la largeur de l'écran : dit QUI fait défiler la page. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = window.innerWidth
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.right > limit + 1
      })
      .slice(0, 4)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} « ${(element.textContent ?? '').trim().slice(0, 40)} »`,
      )
  })
}

/**
 * La page ne défile pas en largeur (scrollWidth ≤ innerWidth) ; sinon, le message nomme les éléments qui
 * dépassent. Assertion « soft » : tous les écrans fautifs sont listés par une seule exécution.
 */
async function expectNoHorizontalScroll(page: Page, what: string): Promise<void> {
  const overflow = await horizontalOverflow(page)
  const who = overflow > 0 ? ` — dépassent : ${(await overflowing(page)).join(' ; ')}` : ''
  expect.soft(overflow, `${what}${who}`).toBeLessThanOrEqual(0)
}

for (const wide of [false, true]) {
  test.describe(`téléphone 360 px${wide ? ' (police large)' : ''} : aucun défilement horizontal de la page`, () => {
    if (wide) test.use({ bypassCSP: true })

    test.beforeEach(async ({ page }) => {
      if (wide) await useWideFont(page)
    })

    test('le panneau d’aide tient dans l’écran, ses boutons font 44 px', async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: 360, height: 740 })
      await signIn(page, 'MANAGER')

      for (const path of ['/patients', '/ventes/caisse-du-jour', '/parametres', '/agenda']) {
        await page.goto(path)
        const aide = helpButton(page)
        await expect(aide, `${path} : bouton Aide`).toBeVisible()
        expect
          .soft((await aide.boundingBox())?.height ?? 0, `${path} : hauteur du bouton Aide`)
          .toBeGreaterThanOrEqual(44)

        const dialog = await openPanel(page)
        // Toutes les tâches dépliées : le texte le plus long du panneau est mesuré, pas seulement la première.
        await openAllDetails(page)
        await expectNoHorizontalScroll(page, `${path} : page avec le panneau ouvert`)

        const frame = await dialog.boundingBox()
        expect(frame, `${path} : panneau`).not.toBeNull()
        expect.soft(frame?.x ?? -1, `${path} : bord gauche du panneau`).toBeGreaterThanOrEqual(0)
        expect
          .soft((frame?.x ?? 0) + (frame?.width ?? 0), `${path} : bord droit du panneau`)
          .toBeLessThanOrEqual(360)
        // Rien ne déborde à l'intérieur du panneau (un mot long ou une puce de libellé le ferait défiler en
        // largeur), ni par la zone défilante, ni par un élément qui dépasse son bord droit.
        const inner = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
        expect.soft(inner, `${path} : contenu du panneau`).toBeLessThanOrEqual(1)
        const poking = await dialog.evaluate((root) => {
          const limit = root.getBoundingClientRect().right
          return Array.from(root.querySelectorAll<HTMLElement>('*'))
            .filter((element) => element.getBoundingClientRect().right > limit + 1)
            .slice(0, 5)
            .map(
              (element) =>
                `${element.tagName.toLowerCase()} « ${(element.textContent ?? '').trim().slice(0, 40)} »`,
            )
        })
        expect.soft(poking, `${path} : éléments qui dépassent du panneau`).toEqual([])

        const close = dialog.getByRole('button', { name: 'Fermer' }).first()
        await expect(close).toBeVisible()
        expect
          .soft((await close.boundingBox())?.height ?? 0, `${path} : hauteur de « Fermer »`)
          .toBeGreaterThanOrEqual(44)
        await close.click()
        await expect(dialog).toBeHidden()
      }
    })

    test('la documentation (accueil, recherche, rubriques, fiches) ne déborde jamais', async ({
      page,
    }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 360, height: 740 })
      await signIn(page, 'MANAGER')

      await page.goto('/aide')
      await expect(documentation(page)).toBeVisible()
      await settled(page)
      await openAllDetails(page)
      await expectNoHorizontalScroll(page, '/aide')

      // Résultats de recherche et « Aucun résultat ».
      for (const query of ['facture', 'zzzz']) {
        await page.goto(`/aide?q=${query}`)
        await expect(documentation(page)).toBeVisible()
        await settled(page)
        await openAllDetails(page)
        await expectNoHorizontalScroll(page, `/aide?q=${query}`)
      }

      // Chaque rubrique et les fiches d'écran les plus longues, tout déplié (tâches, questions fréquentes).
      const anchors = [
        ...TOPIC_IDS.map((id) => `#/${id}`),
        ...LONG_SHEETS.map((route) => `#/ecran/${route}`),
      ]
      for (const hash of anchors) {
        await openAnchor(page, hash)
        await openAllDetails(page)
        await expectNoHorizontalScroll(page, `/aide${hash}`)
      }
    })
  })
}

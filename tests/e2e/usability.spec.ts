import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

// Marge pour un poste Windows partagé et chargé, où le serveur de test (une requête à la fois) met parfois plus de 20 s à
// enregistrer un encaissement : ce qui est vérifié ne change pas, un contrôle réussi n'attend que le temps nécessaire.
const expect = baseExpect.configure({ timeout: 60_000 })

/** Connexion de la gérante de démonstration, avec les mêmes marges que le reste de ce parcours. */
async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

/**
 * U01 — usage sur appareils ciblés, AUTOMATISÉ (fiche 24, U01 ; AT28, AT29 ; EE043, EE044) dans un vrai navigateur :
 *
 *  1. AT29 : un opérateur crée un patient, puis la facture et son encaissement, SANS jamais ressaisir l'identité entre les
 *     modules ; les durées de machine, le nombre de gestes et de touches de chaque étape sont MESURÉS (lignes
 *     « MESURES-U01 » de la sortie, consignées dans docs/evidence/usability.md). La gérante retrouve ensuite l'impayé sur un
 *     téléphone de 360 px ;
 *  2. une facture de 1 500 000 FCFA (sept chiffres), pour juger les montants les plus larges ;
 *  3. un TÉMOIN : le contrôle de mise en page sait échouer (défilement, cible trop petite, commande ou montant hors de
 *     l'écran, montant coupé) et compte ce qu'il contrôle ;
 *  4. AT28 : 23 écrans (accueil, file du jour, patients, facture, caisse, finance, stock…) s'affichent sans défilement
 *     horizontal, avec des commandes d'au moins 44 px et des montants entiers sur un téléphone (360 px), une tablette
 *     (768 px), un ordinateur (1366 px) et un zoom à 200 % (683 px) ;
 *  5. AT28, focus non masqué (WCAG 2.2, 2.4.11) : la barre de raccourcis fixée en bas du téléphone ne cache jamais le champ
 *     qui prend le focus clavier. Ce test a trouvé un défaut réel (8 arrêts sur 52 cachés à 360 px), corrigé par
 *     `scroll-padding-bottom` dans resources/frontend/styles/base.css ;
 *  6. AT28, clavier : la fiche patient et la facture se remplissent, se valident et s'émettent SANS souris, dans un ordre de
 *     tabulation logique, avec la fenêtre d'émission qui garde le focus.
 *
 * Le fichier est SÉRIÉ : les balayages jugent les données des parcours précédents (patiente, factures). Reste HORS de cette
 * preuve automatique (voir docs/evidence/usability.md) : l'impression sur l'imprimante réelle du cabinet, les navigateurs et
 * appareils convenus avec la cliente, et un chronométrage par une vraie personne de l'accueil.
 * Données FICTIVES (articles DEMO-*). Les modules « patients » et « sales » sont ouverts par prepare-env.mjs.
 * EEO_USABILITY_SHOTS=<dossier> enregistre une capture par écran du balayage, pour une relecture visuelle (jamais versionnée).
 */

test.use({ actionTimeout: 60_000 })

const VIEWPORTS = [
  { name: 'téléphone 360 px', width: 360, height: 740 },
  { name: 'zoom 200 % d’un écran 1366 px', width: 683, height: 384 },
  { name: 'tablette 768 px', width: 768, height: 1024 },
  { name: 'ordinateur 1366 × 768', width: 1366, height: 768 },
] as const

interface Phase {
  name: string
  ms: number
  clicks: number
  fields: number
  keystrokes: number
}

/** L'opérateur : chaque geste est compté (clics, champs remplis, touches) pour mesurer l'effort d'une étape. */
class Operator {
  clicks = 0
  fields = 0
  keystrokes = 0
  readonly phases: Phase[] = []

  async click(locator: Locator): Promise<void> {
    this.clicks += 1
    await locator.click()
  }

  async fill(locator: Locator, value: string): Promise<void> {
    this.fields += 1
    this.keystrokes += value.length
    await locator.fill(value)
  }

  async choose(locator: Locator, label: string): Promise<void> {
    this.clicks += 1
    await locator.selectOption({ label })
  }

  /** Mesure une étape : durée de machine et gestes accomplis pendant qu'elle s'exécute. */
  async phase(name: string, work: () => Promise<void>): Promise<void> {
    const before = { clicks: this.clicks, fields: this.fields, keystrokes: this.keystrokes }
    const start = Date.now()
    await work()
    this.phases.push({
      name,
      ms: Date.now() - start,
      clicks: this.clicks - before.clicks,
      fields: this.fields - before.fields,
      keystrokes: this.keystrokes - before.keystrokes,
    })
  }
}

interface LayoutIssue {
  kind: string
  detail: string
}

/** Résultat du contrôle d'un écran : les défauts, et ce qui a été contrôlé (un contrôle qui ne voit rien ne prouve rien). */
interface AuditResult {
  issues: LayoutIssue[]
  controls: number
  amounts: number
}

/**
 * Contrôle de mise en page d'un écran affiché : défilement horizontal, commandes trop petites ou hors de l'écran, montants
 * coupés. Les liens au fil d'un texte (en ligne) et les éléments cachés visuellement (lien d'évitement) sont exemptés.
 */
async function audit(page: Page): Promise<AuditResult> {
  return page.evaluate(() => {
    const issues: { kind: string; detail: string }[] = []
    let controls = 0
    let amounts = 0
    const doc = document.documentElement
    const width = doc.clientWidth
    if (doc.scrollWidth > width + 1) {
      issues.push({
        kind: 'défilement horizontal',
        detail: `${doc.scrollWidth} px pour ${width} px`,
      })
    }
    const label = (element: Element): string =>
      (element.getAttribute('aria-label') ?? (element as HTMLElement).innerText ?? element.tagName)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50) || element.tagName
    const targets = document.querySelectorAll(
      'button, input:not([type="hidden"]), select, textarea, [role="button"], a[href]',
    )
    for (const element of Array.from(targets)) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      // Éléments sans taille, ou cachés visuellement (classe « sr-only » : le lien « Aller au contenu » n'apparaît qu'au
      // focus clavier, où il est contrôlé par le test clavier).
      if (rect.width <= 2 || rect.height <= 2) continue
      const clipped =
        style.position === 'absolute' &&
        style.overflow === 'hidden' &&
        ((style.clip !== 'auto' && style.clip.replace(/\s/g, '').startsWith('rect(0')) ||
          (style.clipPath !== 'none' && style.clipPath !== ''))
      if (clipped && document.activeElement !== element) continue
      controls += 1
      if (rect.right > width + 1 || rect.left < -1) {
        issues.push({
          kind: 'commande hors de l’écran',
          detail: `${label(element)} (${Math.round(rect.left)}–${Math.round(rect.right)} px pour ${width} px)`,
        })
      }
      const inline = element.tagName === 'A' && style.display === 'inline'
      if (inline) continue
      const isCheckbox =
        element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio')
      if (isCheckbox) continue
      if (rect.height < 43.5) {
        issues.push({
          kind: 'cible de moins de 44 px',
          detail: `${label(element)} (${Math.round(rect.width)} × ${Math.round(rect.height)} px)`,
        })
      }
    }
    // Montants entiers : ni coupés par le bord de l'écran, ni par un conteneur qui masque son débordement.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!/FCFA/.test(node.textContent ?? '')) continue
      const parent = node.parentElement
      if (parent === null) continue
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) continue
      amounts += 1
      if (rect.right > width + 1 || rect.left < -1) {
        issues.push({
          kind: 'montant hors de l’écran',
          detail: `${(node.textContent ?? '').trim().slice(0, 40)}`,
        })
      }
      for (
        let ancestor: HTMLElement | null = parent;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        const overflow = getComputedStyle(ancestor).overflowX
        if (
          (overflow === 'hidden' || overflow === 'clip') &&
          ancestor.scrollWidth > ancestor.clientWidth + 1
        ) {
          issues.push({
            kind: 'montant coupé par son conteneur',
            detail: `${(node.textContent ?? '').trim().slice(0, 40)}`,
          })
          break
        }
      }
    }
    return { issues, controls, amounts }
  })
}

/**
 * Le champ qui vient de prendre le focus clavier est-il caché derrière la barre de raccourcis fixée en bas du téléphone ?
 * (WCAG 2.2, 2.4.11 « focus non masqué ».) On interroge le point central de la partie visible de l'élément : si ce qui s'y
 * trouve n'est ni l'élément ni l'un de ses proches, il est recouvert.
 */
async function focusState(page: Page): Promise<{
  kind: 'body' | 'barre' | 'visible' | 'hors écran' | 'caché'
  label: string
  detail?: string
}> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (active === null || active === document.body) return { kind: 'body' as const, label: '' }
    const label =
      (active.getAttribute('aria-label') ?? active.innerText ?? active.tagName)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50) || active.tagName
    if (active.closest('nav[aria-label="Raccourcis"]') !== null)
      return { kind: 'barre' as const, label }
    const rect = active.getBoundingClientRect()
    const left = Math.max(rect.left, 0)
    const right = Math.min(rect.right, window.innerWidth)
    const top = Math.max(rect.top, 0)
    const bottom = Math.min(rect.bottom, window.innerHeight)
    if (right - left < 2 || bottom - top < 2) return { kind: 'hors écran' as const, label }
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    const related = hit !== null && (active === hit || active.contains(hit) || hit.contains(active))
    const bar = document.querySelector('nav[aria-label="Raccourcis"]')?.getBoundingClientRect()
    const detail = `élément ${Math.round(rect.top)}–${Math.round(rect.bottom)} px, fenêtre ${window.innerHeight} px, barre ${bar === undefined ? 'absente' : Math.round(bar.top) + ' px'}, recouvert par <${hit?.tagName.toLowerCase() ?? 'rien'}> ${hit?.closest('nav') !== null ? 'de la barre' : ''}, défilement ${Math.round(window.scrollY)}/${Math.round(document.documentElement.scrollHeight - window.innerHeight)}`
    return { kind: related ? ('visible' as const) : ('caché' as const), label, detail }
  })
}

/** L'écran est prêt quand son titre est là ET que ses données sont arrivées (plus de « Chargement… » dans le contenu). */
async function screenReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText('Chargement')
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

/** Enregistre une image de l'écran quand EEO_USABILITY_SHOTS désigne un dossier (relecture visuelle, jamais versionnée). */
async function shoot(page: Page, label: string): Promise<void> {
  const folder = process.env['EEO_USABILITY_SHOTS']
  if (folder === undefined || folder === '') return
  mkdirSync(folder, { recursive: true })
  await page.screenshot({
    path: join(folder, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`),
    fullPage: true,
  })
}

/** Écrans qui doivent montrer des montants en FCFA pour que le balayage les contrôle vraiment. */
const MONEY_SCREENS = [
  'Caisse du jour',
  'Finance du cabinet',
  'Factures',
  'Facture émise, reste à encaisser',
  'Facture de 1 500 000 FCFA',
]

const shared: {
  patientPath: string | null
  invoicePath: string | null
  bigInvoicePath: string | null
} = {
  patientPath: null,
  invoicePath: null,
  bigInvoicePath: null,
}

test.describe.configure({ mode: 'serial' })

test.describe('usage : parcours de l’opérateur, tailles d’écran et clavier (U01)', () => {
  test('AT29 : patient, facture et encaissement sans ressaisie, mesures ; la gérante retrouve l’impayé sur téléphone', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const stamp = String(Date.now()).slice(-6)
    // Un nom composé et des accents, comme dans le cabinet : les titres et les lignes de la fiche et de la facture doivent
    // les porter entiers, sur 360 px aussi.
    const name = `NGOUMOU-TCHAMBA ${stamp}`
    const firstNames = 'Marie-Claire Françoise'
    const operator = new Operator()
    await signIn(page, 'MANAGER')
    const main = page.getByRole('main')

    await operator.phase('Créer le patient', async () => {
      await page.goto('/patients/nouveau')
      await operator.fill(page.getByLabel('Nom (obligatoire)'), name)
      await operator.fill(page.getByLabel('Prénom(s)'), firstNames)
      await operator.choose(page.getByLabel('Sexe'), 'Féminin')
      await operator.fill(page.getByLabel('Date de naissance', { exact: true }), '12/03/1985')
      await operator.fill(
        page.getByLabel('Téléphone principal'),
        `+237 600 09 ${stamp.slice(0, 2)} ${stamp.slice(2, 4)}`,
      )
      await operator.click(page.getByRole('button', { name: 'Enregistrer le patient' }))
      await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)
    })
    shared.patientPath = new URL(page.url()).pathname

    await operator.phase('Préparer la facture depuis la fiche', async () => {
      await operator.click(page.getByRole('link', { name: 'Créer une facture' }))
      await expect(page).toHaveURL(/\/ventes\/factures\/nouvelle\?patient=[0-9A-HJKMNP-TV-Z]{26}$/)
      // Aucune ressaisie : l'identité est reprise (accents exacts), aucun champ d'identité n'est demandé.
      await expect(main).toContainText(`${name} ${firstNames}`)
      for (const identity of [
        'Nom (obligatoire)',
        'Prénom(s)',
        'Date de naissance',
        'Téléphone principal',
      ]) {
        await expect(page.getByLabel(identity)).toHaveCount(0)
      }
      for (const [search, option] of [
        ['DEMO-MON', /Monture fictive/],
        ['DEMO-EXA', /Examen de vue \(fictif\)/],
      ] as const) {
        await operator.fill(
          page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }),
          search,
        )
        await operator.click(page.getByRole('option', { name: option }))
      }
      await expect(main).toContainText('Total TTC : 55 000 FCFA')
      await operator.click(page.getByRole('button', { name: 'Enregistrer le brouillon' }))
      await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    })

    await operator.phase('Émettre la facture', async () => {
      await operator.click(page.getByRole('button', { name: 'Émettre la facture' }))
      await operator.click(
        page
          .getByRole('dialog', { name: 'Émettre la facture ?' })
          .getByRole('button', { name: 'Émettre la facture' }),
      )
      await expect(
        page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
      ).toBeVisible()
      await expect(main).toContainText('Reste à encaisser : 55 000 FCFA')
      await expect(main).toContainText(`${name} ${firstNames}`)
    })
    shared.invoicePath = new URL(page.url()).pathname

    await operator.phase('Encaisser un acompte de 20 000 et obtenir le reçu', async () => {
      await operator.fill(page.getByLabel('Montant encaissé'), '20 000')
      await page.getByLabel('Montant encaissé').blur()
      await operator.choose(page.getByLabel('Mode de règlement'), 'Mobile money MTN')
      await operator.fill(page.getByLabel('Référence de l’opération'), `MOMO-USAGE-${stamp}`)
      await operator.click(page.getByRole('button', { name: /^Encaisser \d/ }))
      await expect(main).toContainText('Encaissement enregistré sur le serveur')
      await expect(main).toContainText('Reste à encaisser maintenant : 35 000 FCFA')
      await expect(main).toContainText(/Reçu TEST-REC-\d{4}-\d{6}/)
    })

    // La gérante retrouve l'impayé sur un téléphone de 360 px, depuis le menu, sans saisir le numéro de la facture.
    await page.setViewportSize({ width: 360, height: 740 })
    await operator.phase('Gérante, téléphone : retrouver l’impayé', async () => {
      await page.goto('/ventes/factures')
      await operator.choose(page.getByLabel('État'), 'Émises')
      const row = page.getByRole('listitem').filter({ hasText: name })
      await expect(row).toContainText('reste à encaisser : 35 000 FCFA')
      await operator.click(row.getByRole('link').first())
      // Ouverte depuis la liste, la facture affiche le reste dû dans son formulaire d'encaissement (« maintenant » n'apparaît
      // qu'à l'instant d'un encaissement).
      await expect(main).toContainText('Reste à encaisser : 35 000 FCFA')
      await expect(main).toContainText('Total encaissé20 000 FCFA')
    })
    const phone = await audit(page)

    // Mesures : consignées par la sortie (même si un contrôle suivant échoue) et gardées contre une lenteur pathologique
    // (pas un objectif du cabinet).
    for (const phase of operator.phases) {
      console.log(
        `MESURES-U01 | ${phase.name} | ${(phase.ms / 1000).toFixed(1)} s | ${phase.clicks} clics | ${phase.fields} champs | ${phase.keystrokes} touches`,
      )
    }
    const operatorPhases = operator.phases.slice(0, 4)
    console.log(
      `MESURES-U01 | Parcours opérateur complet (patient, facture, émission, acompte) | ${(operatorPhases.reduce((sum, phase) => sum + phase.ms, 0) / 1000).toFixed(1)} s | ${operatorPhases.reduce((sum, phase) => sum + phase.clicks, 0)} clics | ${operatorPhases.reduce((sum, phase) => sum + phase.fields, 0)} champs | ${operatorPhases.reduce((sum, phase) => sum + phase.keystrokes, 0)} touches`,
    )
    for (const phase of operator.phases) {
      expect(phase.ms, `${phase.name} : durée de machine`).toBeLessThan(60_000)
    }
    expect(phone.amounts, 'des montants ont été contrôlés').toBeGreaterThan(0)
    expect(phone.issues, 'facture à encaisser sur téléphone : défauts de mise en page').toEqual([])
  })

  test('AT28 données : une facture de 1 500 000 FCFA (sept chiffres) se prépare, s’émet et s’encaisse en partie', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    expect(shared.patientPath, 'le parcours AT29 doit avoir créé le patient').not.toBeNull()
    const patientId = (shared.patientPath ?? '').split('/').pop() ?? ''
    const stamp = String(Date.now()).slice(-6)
    await signIn(page, 'MANAGER')
    const main = page.getByRole('main')
    await page.goto(`/ventes/factures/nouvelle?patient=${patientId}`)
    await page.getByRole('combobox', { name: 'Ajouter un article du catalogue' }).fill('DEMO-EXA')
    await page.getByRole('option', { name: /Examen de vue \(fictif\)/ }).click()
    const quantity = page.getByLabel(/^Quantité \(/)
    await quantity.fill('100')
    await quantity.blur()
    await expect(main).toContainText('Total TTC : 1 500 000 FCFA')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Émettre la facture' }).click()
    await page
      .getByRole('dialog', { name: 'Émettre la facture ?' })
      .getByRole('button', { name: 'Émettre la facture' })
      .click()
    await expect(
      page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    await expect(main).toContainText('Reste à encaisser : 1 500 000 FCFA')
    await page.getByLabel('Montant encaissé').fill('500 000')
    await page.getByLabel('Montant encaissé').blur()
    await page.getByLabel('Mode de règlement').selectOption({ label: 'Mobile money MTN' })
    await page.getByLabel('Référence de l’opération').fill(`MOMO-GROS-${stamp}`)
    await page.getByRole('button', { name: /^Encaisser \d/ }).click()
    await expect(main).toContainText('Encaissement enregistré sur le serveur')
    await expect(main).toContainText('Reste à encaisser maintenant : 1 000 000 FCFA')
    shared.bigInvoicePath = new URL(page.url()).pathname

    // Les montants à sept chiffres tiennent sur un téléphone : fiche de la facture, puis liste.
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto(shared.bigInvoicePath)
    await screenReady(page)
    await expect(main).toContainText('Total encaissé500 000 FCFA')
    const invoiceScreen = await audit(page)
    await page.goto('/ventes/factures')
    await screenReady(page)
    const listScreen = await audit(page)
    expect(
      invoiceScreen.amounts + listScreen.amounts,
      'des montants ont été contrôlés',
    ).toBeGreaterThan(0)
    expect(
      [...invoiceScreen.issues, ...listScreen.issues],
      'montants à sept chiffres sur téléphone : défauts de mise en page',
    ).toEqual([])
  })

  test('le contrôle de mise en page sait échouer (témoin) : défilement, cibles et montants hors de l’écran', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.setContent(`<!doctype html><html lang="fr"><body style="margin:0"><main>
      <h1>Page témoin</h1>
      <button style="display:block;height:30px;width:120px">Petit bouton</button>
      <button style="display:block;height:44px;width:120px">Bouton conforme</button>
      <button style="display:block;height:44px;width:100px;margin-left:340px">Hors écran</button>
      <div style="width:900px;height:10px;background:#ccc"></div>
      <p style="margin:0 0 0 300px;white-space:nowrap">Total : 1 250 000 FCFA</p>
      <div style="width:60px;overflow:hidden;white-space:nowrap">Reste : 55 000 FCFA</div>
      <a href="#x" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);padding:8px 16px">Lien caché</a>
    </main></body></html>`)
    const { issues, controls, amounts } = await audit(page)
    expect(controls, 'le témoin compte les commandes contrôlées (les trois boutons visibles)').toBe(
      3,
    )
    expect(amounts, 'le témoin compte les montants contrôlés').toBe(2)
    const kinds = new Set(issues.map((issue) => issue.kind))
    for (const kind of [
      'défilement horizontal',
      'cible de moins de 44 px',
      'commande hors de l’écran',
      'montant hors de l’écran',
      'montant coupé par son conteneur',
    ]) {
      expect(kinds, `le témoin doit déclencher « ${kind} »`).toContain(kind)
    }
    const details = issues.map((issue) => issue.detail).join(' | ')
    expect(details).toContain('Petit bouton')
    expect(details, 'une commande de 44 px n’est pas signalée').not.toContain('Bouton conforme')
    expect(details, 'un élément caché visuellement n’est pas signalé').not.toContain('Lien caché')
  })

  for (const viewport of VIEWPORTS) {
    test(`AT28 : ${viewport.name} — écrans du parcours lisibles, sans défilement horizontal`, async ({
      page,
    }) => {
      test.setTimeout(480_000)
      const { patientPath, invoicePath, bigInvoicePath } = shared
      expect(
        patientPath !== null && invoicePath !== null && bigInvoicePath !== null,
        'le balayage juge les données des parcours précédents : jouer le fichier entier',
      ).toBe(true)
      await signIn(page, 'MANAGER')
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const patientId = (patientPath ?? '').split('/').pop() ?? ''
      const screens: { name: string; path: string }[] = [
        { name: 'Accueil', path: '/' },
        { name: 'Aujourd’hui', path: '/aujourdhui' },
        { name: 'Enregistrer une arrivée', path: '/aujourdhui/arrivee' },
        { name: 'Patients', path: '/patients' },
        { name: 'Nouveau patient', path: '/patients/nouveau' },
        { name: 'Fiche patient (nom composé, accents)', path: patientPath ?? '/patients' },
        { name: 'Ventes et caisse', path: '/ventes' },
        { name: 'Caisse', path: '/ventes/caisse' },
        { name: 'Caisse du jour', path: '/ventes/caisse-du-jour' },
        { name: 'Finance du cabinet', path: '/ventes/finance' },
        { name: 'Factures', path: '/ventes/factures' },
        { name: 'Facture à préparer', path: `/ventes/factures/nouvelle?patient=${patientId}` },
        { name: 'Facture émise, reste à encaisser', path: invoicePath ?? '/ventes/factures' },
        { name: 'Facture de 1 500 000 FCFA', path: bigInvoicePath ?? '/ventes/factures' },
        { name: 'Devis', path: '/ventes/devis' },
        { name: 'Catalogue', path: '/ventes/catalogue' },
        { name: 'Stock', path: '/stock' },
        { name: 'Consultations', path: '/consultations' },
        { name: 'Suivis', path: '/suivis' },
        { name: 'Agenda', path: '/agenda' },
        { name: 'Statistiques', path: '/rapports/statistiques' },
        { name: 'Paramètres', path: '/parametres' },
        { name: 'Poste', path: '/parametres/poste' },
      ]
      const problems: Record<string, LayoutIssue[]> = {}
      const seen: Record<string, { controls: number; amounts: number }> = {}
      for (const screen of screens) {
        await page.goto(screen.path)
        await screenReady(page)
        await shoot(page, `${viewport.width}-${screen.name}`)
        const result = await audit(page)
        seen[screen.name] = { controls: result.controls, amounts: result.amounts }
        if (result.issues.length > 0) problems[screen.name] = result.issues
      }
      const controlsTotal = Object.values(seen).reduce((sum, one) => sum + one.controls, 0)
      const amountsTotal = Object.values(seen).reduce((sum, one) => sum + one.amounts, 0)
      console.log(
        `MESURES-U01 | balayage ${viewport.name} | ${screens.length} écrans | ${controlsTotal} commandes et ${amountsTotal} montants contrôlés | ${Object.keys(problems).length} écran(s) avec défaut`,
      )
      // Un balayage qui ne verrait rien ne prouverait rien : chaque écran montre des commandes, et les écrans d'argent des montants.
      for (const [screenName, one] of Object.entries(seen)) {
        expect(one.controls, `${screenName} : des commandes ont été contrôlées`).toBeGreaterThan(0)
      }
      for (const moneyScreen of MONEY_SCREENS) {
        expect(
          seen[moneyScreen]?.amounts ?? 0,
          `${moneyScreen} : des montants ont été contrôlés`,
        ).toBeGreaterThan(0)
      }
      expect(problems, `${viewport.name} : défauts de mise en page`).toEqual({})
    })
  }

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]] as const) {
    test(`AT28 clavier, ${viewport.name} : le champ qui prend le focus n’est jamais caché derrière la barre du bas`, async ({
      page,
    }) => {
      test.setTimeout(480_000)
      await signIn(page, 'MANAGER')
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      let invoicePath = shared.invoicePath
      if (invoicePath === null) {
        // Rejeu isolé du test : une facture émise qui a encore un reste à encaisser.
        await page.goto('/ventes/factures')
        await page.getByLabel('État').selectOption({ label: 'Émises' })
        const row = page
          .getByRole('listitem')
          .filter({ hasText: /reste à encaisser : [1-9]/ })
          .first()
        await row.getByRole('link').first().click()
        await expect(page.getByRole('main')).toContainText('Encaisser')
        invoicePath = new URL(page.url()).pathname
      }
      const screens = [
        { name: 'Nouveau patient', path: '/patients/nouveau' },
        { name: 'Facture à encaisser', path: invoicePath },
        { name: 'Stock', path: '/stock' },
        { name: 'Caisse', path: '/ventes/caisse' },
      ]
      const hidden: string[] = []
      let visited = 0
      for (const screen of screens) {
        await page.goto(screen.path)
        await screenReady(page)
        await page.evaluate(() => {
          window.scrollTo(0, 0)
          ;(document.activeElement as HTMLElement | null)?.blur()
        })
        const first: string[] = []
        for (let step = 1; step <= 90; step += 1) {
          await page.keyboard.press('Tab')
          const state = await focusState(page)
          if (state.kind === 'body') break
          if (first.length > 0 && first[0] === state.label && first.length > 3) break
          if (first.length < 4) first.push(state.label)
          if (state.kind === 'barre') continue
          visited += 1
          if (state.kind === 'caché' || state.kind === 'hors écran') {
            hidden.push(
              `${screen.name} : « ${state.label} » (${state.kind}, tabulation ${step}) ${state.detail ?? ''}`,
            )
          }
        }
      }
      console.log(
        `MESURES-U01 | focus clavier ${viewport.name} | ${screens.length} écrans | ${visited} champs pris par le focus | ${hidden.length} caché(s)`,
      )
      expect(visited, 'le parcours au clavier a bien visité des champs').toBeGreaterThan(40)
      expect(hidden, 'champs cachés derrière la barre du bas ou hors de l’écran').toEqual([])
    })
  }

  test('AT28 clavier : fiche patient, facture et émission sans souris', async ({ page }) => {
    test.setTimeout(300_000)
    const stamp = String(Date.now()).slice(-6)
    await signIn(page, 'MANAGER')

    // Lien d'évitement : premier arrêt de la touche Tab, visible au focus, il place le curseur sur le contenu (aide intégrée).
    await page.goto('/patients/nouveau')
    await screenReady(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Aller au contenu' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Enter')
    expect(
      await page.evaluate(() => document.activeElement?.id),
      'après « Aller au contenu », le curseur est sur le contenu',
    ).toBe('contenu')

    // Fiche patient : l'ordre de tabulation suit l'ordre de lecture et mène au bouton d'enregistrement.
    const first = page.getByLabel('Nom (obligatoire)')
    await first.focus()
    await page.keyboard.type(`CLAVIER SEUL ${stamp}`)
    const order: string[] = []
    const typed: Record<string, string> = {
      'Prénom(s)': 'Test',
      Sexe: 'F',
      'Date de naissance': '12/03/1985',
      'Téléphone principal': `+237 600 09 ${stamp.slice(0, 2)} ${stamp.slice(2, 4)}`,
    }
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        if (element === null) return ''
        const labelled = (element as HTMLInputElement).labels?.[0]?.innerText
        return (labelled ?? element.getAttribute('aria-label') ?? element.innerText ?? '')
          .replace(/\s+/g, ' ')
          .trim()
      })
      order.push(focused)
      const key = Object.keys(typed).find((candidate) => focused.startsWith(candidate))
      if (key !== undefined) await page.keyboard.type(typed[key] ?? '')
      if (focused.startsWith('Enregistrer le patient')) break
    }
    expect(order.join(' > ')).toMatch(
      /Prénom\(s\).*Sexe.*Date de naissance.*Téléphone principal.*Enregistrer le patient/,
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/patients\/[0-9A-HJKMNP-TV-Z]{26}$/)

    // Facture : le lien de la fiche, la recherche d'article, l'enregistrement et l'émission se font au clavier.
    await page.getByRole('link', { name: 'Créer une facture' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/ventes\/factures\/nouvelle\?patient=/)
    await screenReady(page)
    const picker = page.getByRole('combobox', { name: 'Ajouter un article du catalogue' })
    await picker.focus()
    await page.keyboard.type('DEMO-EXA')
    await expect(page.getByRole('option', { name: /Examen de vue \(fictif\)/ })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toContainText('Total TTC : 15 000 FCFA')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/ventes\/factures\/[0-9A-HJKMNP-TV-Z]{26}$/)
    await page.getByRole('button', { name: 'Émettre la facture' }).focus()
    await page.keyboard.press('Enter')

    // La fenêtre d'émission est modale : le focus y entre, la tabulation ne le laisse jamais tomber sur la page derrière
    // (la boîte native rend le reste inerte), et Échap la referme sans émettre.
    const dialog = page.getByRole('dialog', { name: 'Émettre la facture ?' })
    await expect(dialog).toBeVisible()
    const focusPlace = (): Promise<string> =>
      page.evaluate(() => {
        const active = document.activeElement
        if (active === null || active === document.body) return 'hors de la page'
        return active.closest('dialog[open]') !== null ? 'dans la boîte' : 'page derrière la boîte'
      })
    expect(await focusPlace(), 'à l’ouverture, le focus est dans la fenêtre d’émission').toBe(
      'dans la boîte',
    )
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab')
      expect(
        await focusPlace(),
        `tabulation ${step + 1} : le focus ne passe pas derrière la boîte`,
      ).not.toBe('page derrière la boîte')
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('main')).not.toContainText('TEST-FAC-')

    // Puis on émet vraiment, au clavier, et l'encaissement du reste se fait de même.
    await page.getByRole('button', { name: 'Émettre la facture' }).focus()
    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: 'Émettre la facture' }).focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-\d{4}-\d{6}$/ }),
    ).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Reste à encaisser : 15 000 FCFA')
    await page.getByRole('button', { name: /^Encaisser le reste/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Montant encaissé')).toHaveValue(/15\s?000/)
    const mode = page.getByLabel('Mode de règlement')
    await mode.focus()
    await page.keyboard.type('Mobile money MTN')
    await expect(mode.locator('option:checked')).toHaveText('Mobile money MTN')
    await page.getByLabel('Référence de l’opération').focus()
    await page.keyboard.type(`MOMO-CLAVIER-${stamp}`)
    await page.getByRole('button', { name: /^Encaisser \d/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toContainText('Encaissement enregistré sur le serveur')
    await expect(page.getByRole('main')).toContainText('Reste à encaisser maintenant : 0 FCFA')
  })
})

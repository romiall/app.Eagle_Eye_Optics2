import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

const ROOT = join(import.meta.dirname, '..', '..')

/**
 * Tableaux et exports de gestion multi-domaines (L1D09) sur la vraie application :
 * - filtrage strict des sections par droits effectifs et modules actifs (`MANAGER`, `CLINICIAN`, `RECEPTION`) ;
 * - comparaison N vs N-1, masquage de la valorisation sans fuite et téléchargements CSV / JSON ;
 * - filtres optionnels de période et de portée rôle sur les exports contrôlés + consultation du manifeste conservé.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').waitFor({ timeout: 20_000 })
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible({
    timeout: 45_000,
  })
}

async function switchTo(page: Page, context: BrowserContext, role: string): Promise<void> {
  await page.goto('about:blank')
  await context.clearCookies()
  await page.goto('/connexion')
  await signIn(page, role)
}

async function confirmIfAsked(page: Page, password: string, outcome: Locator): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog.or(outcome).first()).toBeVisible({ timeout: 20_000 })
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Mot de passe').fill(password)
    await dialog.getByRole('button', { name: /Confirmer/ }).click()
  }
  await expect(outcome).toBeVisible({ timeout: 20_000 })
}

function processExportsInE2eDb(): void {
  const run = spawnSync('php', [join(ROOT, 'artisan'), 'eeo:exports:process', '--limit=10'], {
    cwd: ROOT,
    env: { ...process.env, APP_ENV: 'e2e' },
    encoding: 'utf8',
    windowsHide: true,
  })
  if (run.status !== 0) {
    throw new Error(
      `eeo:exports:process a échoué (code ${String(run.status)}) : ${run.stderr}\n${run.stdout}`,
    )
  }
}

test.describe('rapports de gestion et manifestes d’export (L1D09)', () => {
  test('tableaux multi-domaines filtrés par profil, N vs N-1 et téléchargements CSV / JSON', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000)

    await signIn(page, 'MANAGER')
    await page.goto('/rapports/statistiques')
    await page.getByRole('link', { name: 'Rapports de gestion' }).click()
    await expect(page).toHaveURL(/\/rapports\/gestion$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Rapports de gestion' })).toBeVisible()

    // La gérante voit tous les domaines ouverts, la comparaison N vs N-1 et la valorisation du stock.
    await expect(page.locator('#titre-gestion-finance')).toBeVisible()
    await expect(page.locator('#titre-gestion-stock')).toBeVisible()
    await expect(page.locator('#titre-gestion-atelier')).toBeVisible()
    await expect(page.locator('#titre-gestion-patients')).toBeVisible()
    await expect(page.locator('#titre-gestion-clinique')).toBeVisible()
    await expect(page.locator('#titre-definitions-gestion')).toBeVisible()
    await expect(page.getByRole('main')).toContainText('comparée à N-1')
    await expect(page.getByRole('main')).not.toContainText('Masquée (droit valorisation absent)')

    await page.getByRole('button', { name: 'Cette année' }).click()
    await expect(page.getByRole('main')).toContainText('Empreinte SHA-256')

    const downloadingCsv = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Télécharger le CSV' }).click()
    const csvDownload = await downloadingCsv
    const csvPath = await csvDownload.path()
    expect(csvPath).toBeTruthy()
    const csvText = readFileSync(String(csvPath), 'utf8')
    expect(csvText).toContain('DICTIONNAIRE;DOMAINE;CODE')
    expect(csvText).toContain('FINANCE;')

    const downloadingJson = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Télécharger le JSON' }).click()
    const jsonDownload = await downloadingJson
    const jsonPath = await jsonDownload.path()
    expect(jsonPath).toBeTruthy()
    const managerJson = (
      JSON.parse(readFileSync(String(jsonPath), 'utf8')) as {
        data: {
          finance: Record<string, unknown> | null
          stock: Record<string, unknown> | null
          workshop: Record<string, unknown> | null
          patients: Record<string, unknown> | null
          clinical: Record<string, unknown> | null
          provenance: { dataset_sha256: string }
        }
      }
    ).data
    expect(managerJson.finance).not.toBeNull()
    expect(managerJson.stock).not.toBeNull()
    expect(managerJson.workshop).not.toBeNull()
    expect(managerJson.patients).not.toBeNull()
    expect(managerJson.clinical).not.toBeNull()
    expect(managerJson.provenance.dataset_sha256).toMatch(/^[a-f0-9]{64}$/)

    // Le clinicien voit Clinique et Stock (quantités sans valorisation XAF), sans Finance / Atelier / Patients.
    await switchTo(page, context, 'CLINICIAN')
    await page.goto('/rapports/gestion')
    await expect(page.locator('#titre-gestion-clinique')).toBeVisible()
    await expect(page.locator('#titre-gestion-stock')).toBeVisible()
    await expect(page.locator('#titre-sections-exclues')).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Masquée (droit valorisation absent)')
    await expect(page.getByRole('main')).toContainText('Valorisation du stock')
    await expect(page.locator('#titre-gestion-finance')).toHaveCount(0)
    await expect(page.locator('#titre-gestion-atelier')).toHaveCount(0)
    await expect(page.locator('#titre-gestion-patients')).toHaveCount(0)

    const downloadingClinicianJson = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Télécharger le JSON' }).click()
    const clinicianJsonDownload = await downloadingClinicianJson
    const clinicianJsonPath = await clinicianJsonDownload.path()
    expect(clinicianJsonPath).toBeTruthy()
    const clinicianJson = (
      JSON.parse(readFileSync(String(clinicianJsonPath), 'utf8')) as {
        data: {
          finance: unknown
          workshop: unknown
          patients: unknown
          stock: { valuation_at_read: unknown; valuation_hidden_reason: string | null } | null
        }
      }
    ).data
    expect(clinicianJson.finance).toBeNull()
    expect(clinicianJson.workshop).toBeNull()
    expect(clinicianJson.patients).toBeNull()
    expect(clinicianJson.stock?.valuation_at_read).toBeNull()
    expect(clinicianJson.stock?.valuation_hidden_reason).toBe('PERMISSION_MISSING')

    // L'accueil ne voit que Activité et patients.
    await switchTo(page, context, 'RECEPTION')
    await page.goto('/rapports/gestion')
    await expect(page.locator('#titre-gestion-patients')).toBeVisible()
    await expect(page.locator('#titre-sections-exclues')).toBeVisible()
    await expect(page.locator('#titre-gestion-finance')).toHaveCount(0)
    await expect(page.locator('#titre-gestion-stock')).toHaveCount(0)
    await expect(page.locator('#titre-gestion-atelier')).toHaveCount(0)
    await expect(page.locator('#titre-gestion-clinique')).toHaveCount(0)
  })

  test('exports contrôlés : filtres période + portée rôle et lecture du manifeste conservé', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const manager = demoAccount('MANAGER')
    await signIn(page, 'MANAGER')

    await page.goto('/parametres')
    await expect(page.getByRole('link', { name: /Rapports de gestion/ })).toBeVisible()
    await page
      .getByRole('link', { name: /Exports/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Exports' })).toBeVisible()

    await page.getByLabel('Contenu de l’export').selectOption('FULL_HANDOVER')
    await page.getByLabel('Portée de profil (optionnel)').selectOption('CLINICIAN')
    await page.getByLabel('Du (optionnel)').fill('01/01/2026')
    await page.getByLabel('Du (optionnel)').press('Tab')
    await page.getByLabel('Au (optionnel)').fill('31/12/2026')
    await page.getByLabel('Au (optionnel)').press('Tab')
    await page.getByRole('button', { name: 'Demander l’export' }).click()

    await confirmIfAsked(page, manager.password, page.getByText(/Export demandé/i))
    await expect(page.getByRole('main')).toContainText('Portée : Clinicien')
    await expect(page.getByRole('main')).toContainText(
      'Période du jeudi 1 janvier 2026 au jeudi 31 décembre 2026',
    )

    processExportsInE2eDb()
    await page.getByRole('button', { name: 'Actualiser la liste' }).click()
    await expect(page.getByText('Prêt à télécharger').first()).toBeVisible()

    await page.getByRole('button', { name: 'Voir le manifeste conservé' }).first().click()
    const panel = page.locator('#manifeste-export-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Manifeste conservé de l’export')
    await expect(panel).toContainText('Empreinte SHA-256')
    await expect(panel).toContainText('Tables incluses')
    await expect(panel).toContainText('Tables exclues du périmètre')

    await panel.getByRole('button', { name: 'Fermer le manifeste' }).click()
    await expect(panel).toHaveCount(0)
  })
})

import { expect, test } from '@playwright/test'

import {
  api,
  deviceIdByCode,
  invoicePayments,
  issueInvoiceForDevice,
  navigateInApp,
  numberRange,
  numberValue,
  payRemainingOffline,
  prepareThisDevice,
  signIn,
  unlockVault,
} from './support/device'

/**
 * Poste préparé, coupure RÉELLE du réseau, reprise et ACK (O05 ; G1 ; AT36 à AT39, AT42) sur la vraie application :
 *
 *  1. en ligne, la gérante prépare ce poste : coffre chiffré, clé de récupération, enrôlement, autorisation signée de
 *     son profil, numéros réservés ; une facture émise en ligne est attribuée à ce poste ;
 *  2. réseau coupé (navigateur hors ligne) : création d'un patient et encaissement de la facture, « Enregistré sur ce
 *     poste » seulement, jamais « sur le serveur » ;
 *  3. fermeture de la page, réseau rétabli, réouverture et déverrouillage du coffre : la synchronisation envoie le
 *     journal, le serveur acquitte ; le patient et l'encaissement existent UNE fois, avec les numéros des plages du
 *     poste (jamais renumérotés) ; une seconde synchronisation n'ajoute rien.
 *
 * Données FICTIVES (comptes de démonstration, articles DEMO-*). Le module « offline » est ouvert par prepare-env.mjs.
 */

const VAULT_SECRET = 'jardin-tropique-sable-orage-58'
const RUN = `${Date.now().toString(36)}`

test.describe('poste préparé : coupure réseau, reprise et ACK (O05)', () => {
  test('patient et encaissement hors ligne, fermeture, retour du réseau, ACK sans doublon ni renumérotation', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const context = await browser.newContext()
    let page = await context.newPage()
    await signIn(page, 'MANAGER')

    // --- 1. Préparation du poste, en ligne -----------------------------------------------------------------------
    const deviceCode = `E2E-${RUN}`.toUpperCase()
    await prepareThisDevice(page, {
      secret: VAULT_SECRET,
      code: deviceCode,
      name: 'Caisse hors-ligne (e2e)',
    })
    const deviceId = await deviceIdByCode(page, deviceCode)

    // Une facture émise EN LIGNE (examen fictif), attribuée ensuite à ce poste pour y être encaissée.
    const { invoicePath, invoiceId } = await issueInvoiceForDevice(page, {
      deviceId,
      patientName: `FACTURE POSTE ${RUN}`,
      phone: '+237 600 00 09 81',
      run: RUN,
    })

    await page.goto('/parametres/poste')
    await unlockVault(page, VAULT_SECRET)
    await page.getByRole('button', { name: 'Relire les ressources du serveur' }).click()
    await expect(page.getByText(/1 facture\(s\) attribuée\(s\)/)).toBeVisible()

    // Facture affichée en ligne, coffre ouvert : ce poste en est le propriétaire, il pourra l'encaisser sans réseau.
    await navigateInApp(page, invoicePath)
    await expect(page.getByRole('heading', { level: 1, name: /^Facture TEST-FAC-/ })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Encaisser' })).toBeVisible()

    // --- 2. Réseau coupé ----------------------------------------------------------------------------------------
    await context.setOffline(true)
    const reference = `MOMO-E2E-${RUN}`.toUpperCase()
    await payRemainingOffline(page, reference)

    await navigateInApp(page, '/patients/nouveau')
    const offlineName = `PATIENT HORS LIGNE ${RUN}`.toUpperCase()
    await page.getByLabel('Nom (obligatoire)').fill(offlineName)
    await page.getByLabel('Prénom(s)').fill('Test')
    await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
    await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
    await page.getByLabel('Téléphone principal').fill('+237 600 00 09 82')
    await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
    // Sans réseau, la recherche de fiches proches est impossible : l'écran le dit, la gérante crée sans vérification.
    const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
    await expect(noCheck).toContainText('le serveur n’est pas joignable (pas de connexion)')
    await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
    await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
    await expect(page.getByText(/pièces? en attente de synchronisation/).first()).toBeVisible()

    // --- 3. Fermeture, réseau rétabli, réouverture ----------------------------------------------------------------
    await page.close()
    await context.setOffline(false)
    page = await context.newPage()
    await page.goto('/parametres/poste')
    await unlockVault(page, VAULT_SECRET)
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
    const sync = page
      .getByRole('region', { name: '5. Synchronisation' })
      .or(page.locator('section[aria-labelledby="titre-synchronisation"]'))
      .first()
    await expect(sync).toContainText('Enregistrées sur ce poste, pas encore envoyées : 0')
    await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
    await expect(sync).toContainText('Conflits à revoir : 0')
    await expect(sync).not.toContainText('Dernier échange réussi : jamais')

    // Contrôles sur le serveur : un seul encaissement, un seul patient, numéros des plages du poste.
    const { request, headers } = await api(page)
    const patientsNamed = async (): Promise<{ record_number: string }[]> =>
      (
        (await (
          await request.get(`/api/v1/patients?query=${encodeURIComponent(offlineName)}`, {
            headers,
          })
        ).json()) as { data: { record_number: string }[] }
      ).data
    const paidWith = async (): Promise<{ receipt_number: string | null }[]> =>
      (await invoicePayments(page, invoiceId)).filter((payment) => payment.reference === reference)

    const payments = await paidWith()
    expect(payments).toHaveLength(1)
    const receipt = payments[0]?.receipt_number ?? ''
    expect(receipt).toMatch(/^TEST-REC-\d{4}-\d{6}$/)
    const receipts = await numberRange(page, deviceId, 'RECEIPT')
    expect(numberValue(receipt)).toBeGreaterThanOrEqual(receipts.start)
    expect(numberValue(receipt)).toBeLessThanOrEqual(receipts.end)

    const patients = await patientsNamed()
    expect(patients).toHaveLength(1)
    const record = patients[0]?.record_number ?? ''
    expect(record).toMatch(/^EE-\d{4}-\d{4,}$/)
    const records = await numberRange(page, deviceId, 'PATIENT')
    expect(numberValue(record)).toBeGreaterThanOrEqual(records.start)
    expect(numberValue(record)).toBeLessThanOrEqual(records.end)

    // Une seconde synchronisation n'ajoute rien (mêmes identifiants, ACK existants).
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click()
    await expect(sync).toContainText('Envoyées, en attente de confirmation : 0')
    expect(await paidWith()).toHaveLength(1)
    expect(await patientsNamed()).toHaveLength(1)

    await context.close()
  })
})

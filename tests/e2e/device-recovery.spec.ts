import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import {
  api,
  confirmPasswordIfAsked,
  deviceIdByCode,
  invoicePayments,
  issueInvoiceForDevice,
  navigateInApp,
  numberRange,
  numberValue,
  payRemainingOffline,
  prepareThisDevice,
  reserveNumbers,
  signIn,
  unlockVault,
} from './support/device'

/**
 * Export chiffré d'un poste et reprise sur un poste NEUF (O07 ; AT39, AT44) sur la vraie application :
 *
 *  1. poste A préparé ; une facture émise en ligne lui est attribuée ; réseau coupé, il l'encaisse (reçu pris dans SA
 *     plage), puis exporte ses pièces dans un fichier chiffré. Le poste A ne revient jamais en ligne (perdu) ;
 *  2. poste B (autre profil de navigateur) : coffre neuf, enrôlement ; l'export de A est ouvert avec la clé de
 *     récupération de A, rangé dans B, le remplacement est déclaré, les pièces signées de A partent TELLES QUELLES, puis
 *     l'ancien poste est clôturé ;
 *  3. sur le serveur : un seul encaissement, reçu dans la plage de A (jamais renuméroté) ; transmettre de nouveau
 *     n'ajoute rien.
 *
 * Données FICTIVES (comptes de démonstration, articles DEMO-*). Le module « offline » est ouvert par prepare-env.mjs.
 */

const SECRET_A = 'riviere-mangue-cobalt-orage-73'
const SECRET_B = 'savane-citron-granit-pluie-41'
const RUN = `${Date.now().toString(36)}`

test.describe('export chiffré et reprise d’un poste sur un poste neuf (O07)', () => {
  test('encaissement hors ligne exporté, repris sur un poste neuf avec ses numéros d’origine', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000)

    // --- 1. Poste A : préparation, encaissement hors ligne, export ------------------------------------------------
    const contextA = await browser.newContext({ acceptDownloads: true })
    const pageA = await contextA.newPage()
    await signIn(pageA, 'MANAGER')
    const codeA = `E2E-A-${RUN}`.toUpperCase()
    const { recoveryKey: recoveryA } = await prepareThisDevice(pageA, {
      secret: SECRET_A,
      code: codeA,
      name: 'Caisse perdue (e2e)',
    })
    const deviceA = await deviceIdByCode(pageA, codeA)
    const receiptsA = await numberRange(pageA, deviceA, 'RECEIPT')

    const { invoicePath, invoiceId } = await issueInvoiceForDevice(pageA, {
      deviceId: deviceA,
      patientName: `REPRISE POSTE ${RUN}`.toUpperCase(),
      phone: '+237 600 00 09 91',
      run: RUN,
    })
    await pageA.goto('/parametres/poste')
    await unlockVault(pageA, SECRET_A)
    await pageA.getByRole('button', { name: 'Relire les ressources du serveur' }).click()
    await expect(pageA.getByText(/1 facture\(s\) attribuée\(s\)/)).toBeVisible()

    await navigateInApp(pageA, invoicePath)
    await expect(pageA.getByRole('form', { name: 'Encaisser' })).toBeVisible()
    await contextA.setOffline(true)
    const reference = `MOMO-REPRISE-${RUN}`.toUpperCase()
    await payRemainingOffline(pageA, reference)

    // Export sans réseau : le fichier chiffré est téléchargé, une pièce en attente.
    await navigateInApp(pageA, '/parametres/poste')
    const downloading = pageA.waitForEvent('download')
    await pageA.getByRole('button', { name: 'Exporter ce poste (fichier chiffré)' }).click()
    const download = await downloading
    const exportPath = testInfo.outputPath(download.suggestedFilename())
    await download.saveAs(exportPath)
    expect(download.suggestedFilename()).toMatch(/\.eeo-export\.json$/)
    await expect(pageA.getByText(/dont 1 pas encore synchronisée/)).toBeVisible()
    const exportText = readFileSync(exportPath, 'utf8')
    expect(exportText).not.toContain(reference)
    await pageA.close() // le poste A disparaît (panne, vol) sans avoir synchronisé

    // --- 2. Poste B : coffre neuf, enrôlement, reprise de l'export de A -------------------------------------------
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await signIn(pageB, 'MANAGER')
    const codeB = `E2E-B-${RUN}`.toUpperCase()
    // Une seule caisse hors-ligne principale : B ne réserve ses numéros qu'après la clôture de A.
    await prepareThisDevice(pageB, {
      secret: SECRET_B,
      code: codeB,
      name: 'Caisse neuve (e2e)',
      reserveNumbers: false,
    })

    // Le fichier est remis par son contenu : le chemin du dossier de résultats contient « ’ », que setInputFiles ne
    // transmet pas (aucun fichier choisi).
    await pageB.locator('#reprise-fichier').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: readFileSync(exportPath),
    })
    await expect(pageB.getByText(`Fichier choisi : ${download.suggestedFilename()}`)).toBeVisible()
    await pageB.getByLabel('Clé de récupération de la gérante').fill(recoveryA)
    await pageB.getByRole('button', { name: 'Ouvrir l’export' }).click()
    await expect(pageB.getByText('Export ouvert et vérifié')).toBeVisible()
    await pageB.getByRole('button', { name: 'Ranger l’export dans ce poste' }).click()
    await expect(pageB.getByText('Export rangé dans ce poste')).toBeVisible()

    await pageB.getByLabel('Motif du remplacement').fill('Poste de caisse perdu (e2e)')
    await pageB.getByRole('button', { name: '1. Déclarer le remplacement' }).click()
    const transmit = pageB.getByRole('button', {
      name: '2. Transmettre les pièces de l’ancien poste',
    })
    await confirmPasswordIfAsked(pageB, transmit.and(pageB.locator(':enabled')))
    await transmit.click()
    await confirmPasswordIfAsked(
      pageB,
      pageB.getByText('Toutes les pièces de l’ancien poste sont consolidées sur le serveur'),
    )
    await pageB.getByRole('button', { name: '3. Clôturer l’ancien poste' }).click()
    await confirmPasswordIfAsked(pageB, pageB.getByText('Ancien poste clôturé'))

    // B devient la caisse principale avec SES propres plages (émissions futures), disjointes de celles de A.
    await reserveNumbers(pageB)
    const deviceB = await deviceIdByCode(pageB, codeB)
    const receiptsB = await numberRange(pageB, deviceB, 'RECEIPT')
    expect(receiptsB.start > receiptsA.end || receiptsB.end < receiptsA.start).toBe(true)

    // --- 3. Contrôles sur le serveur -------------------------------------------------------------------------------
    const paid = (await invoicePayments(pageB, invoiceId)).filter(
      (payment) => payment.reference === reference,
    )
    expect(paid).toHaveLength(1)
    const receipt = paid[0]?.receipt_number ?? ''
    expect(receipt).toMatch(/^TEST-REC-\d{4}-\d{6}$/)
    expect(numberValue(receipt)).toBeGreaterThanOrEqual(receiptsA.start)
    expect(numberValue(receipt)).toBeLessThanOrEqual(receiptsA.end)

    // L'ancien poste n'est plus actif : aucun droit à consommer.
    const { request, headers } = await api(pageB)
    const devices = (await (await request.get('/api/v1/devices', { headers })).json()) as {
      data: { device_id: string; status: string }[]
    }
    expect(devices.data.find((device) => device.device_id === deviceA)?.status).not.toBe('ACTIVE')

    // Rejouer la transmission depuis l'export rangé n'ajoute rien.
    await pageB.reload()
    await unlockVault(pageB, SECRET_B)
    await expect(pageB.getByText(/ancien poste clôturé/)).toBeVisible()
    expect(
      (await invoicePayments(pageB, invoiceId)).filter(
        (payment) => payment.reference === reference,
      ),
    ).toHaveLength(1)

    // L'ancien poste réapparaît avec son coffre et synchronise : rien n'est appliqué une seconde fois.
    await contextA.setOffline(false)
    const backA = await contextA.newPage()
    await backA.goto('/parametres/poste')
    await unlockVault(backA, SECRET_A)
    // L'échange automatique déclenché par l'ouverture du coffre (envoi de l'ancienne pièce, puis relecture refusée) se
    // termine AVANT la coupure : un échange n'est jamais doublé, donc une fiche créée pendant celui-ci n'en ferait pas
    // partie (course connue sur un serveur de test lent).
    await expect(backA.locator('section[aria-labelledby="titre-synchronisation"]')).toContainText(
      'dernier essai sans réponse du serveur',
    )
    // Il enregistre encore une fiche sans réseau (il ignore son remplacement)…
    await contextA.setOffline(true)
    await navigateInApp(backA, '/patients/nouveau')
    await backA.getByLabel('Nom (obligatoire)').fill(`APRES REMPLACEMENT ${RUN}`.toUpperCase())
    await backA.getByLabel('Sexe').selectOption({ label: 'Masculin' })
    await backA.getByLabel('Date de naissance', { exact: true }).fill('21/07/1979')
    await backA.getByLabel('Téléphone principal').fill('+237 600 00 09 92')
    await backA.getByRole('button', { name: 'Enregistrer le patient' }).click()
    await backA
      .getByRole('dialog', { name: 'Vérification des doublons impossible' })
      .getByRole('button', { name: 'Créer sans vérification' })
      .click()
    await expect(backA.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
    // … puis synchronise : sa pièce d'avant l'export est déjà consolidée (même identifiant), la nouvelle passe EN REVUE
    // (jamais appliquée d'office) et le serveur refuse ensuite de servir ce poste.
    await contextA.setOffline(false)
    await navigateInApp(backA, '/parametres/poste')
    await backA.getByRole('button', { name: 'Synchroniser maintenant' }).click()
    await expect(backA.getByRole('alert')).toContainText(
      'Le serveur refuse l’échange : Ce poste est déclaré perdu ou remplacé',
    )
    await expect(backA.getByText('Conflits à revoir : 1')).toBeVisible()
    const { request: checkRequest, headers: checkHeaders } = await api(pageB)
    const later = (await (
      await checkRequest.get(
        `/api/v1/patients?query=${encodeURIComponent(`APRES REMPLACEMENT ${RUN}`.toUpperCase())}`,
        { headers: checkHeaders },
      )
    ).json()) as { data: unknown[] }
    expect(later.data).toHaveLength(0)
    expect(
      (await invoicePayments(pageB, invoiceId)).filter(
        (payment) => payment.reference === reference,
      ),
    ).toHaveLength(1)
    await contextA.close()

    // Les ressources de B sont rendues (aucune pièce émise) : les parcours suivants préparent leur propre caisse.
    const released = await request.post(`/api/v1/devices/${deviceB}/release`, {
      headers: { ...headers, 'Idempotency-Key': `e2e-release-${RUN}` },
      data: {
        expected_version: null,
        last_device_sequence: '0',
        last_event_hash: null,
        reason: 'Fin du parcours e2e',
      },
    })
    expect(released.status(), await released.text()).toBe(200)

    await contextB.close()
  })
})

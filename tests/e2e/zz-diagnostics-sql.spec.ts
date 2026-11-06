import { expect, test } from '@playwright/test'

import { integrityReport } from './support/database'

/**
 * Gate G2 — diagnostics SQL sans anomalie sur un dataset réel (fichier 25 : « diagnostics SQL sans anomalie sur dataset »).
 *
 * Ce fichier porte le préfixe « zz » pour passer EN DERNIER (les parcours s'exécutent dans l'ordre alphabétique, avec un
 * seul processus, sur une base partagée) : à ce moment la base e2e contient tout ce que les autres parcours ont fait
 * en conditions réelles (patients, consultations, factures, encaissements, avoirs, remises, postes préparés, synchronisations,
 * conflits décidés, sauvegardes de documents). Les contrôles de la restauration vérifiée y sont exécutés en LECTURE SEULE
 * (`tests/e2e/support/database.php`) :
 *
 *  - SCHEMA_TABLES, INTEGRITY, SEQUENCES, NUMBERED_DOCUMENTS, AUDIT_HASHES, STORED_FILES : PASS, zéro anomalie ;
 *  - OFFLINE_RECONCILIATION : une ALERTE (poste dont les plages restent ouvertes) est admise, jamais un échec.
 *
 * Les règles sont celles du fichier versionné `database/05_integrity_checks.sql` (25 requêtes) et du vérificateur
 * d'exploitation (X03) ; seul le dataset est celui des parcours.
 */

test.describe('G2 : diagnostics SQL sur la base des parcours', () => {
  test('aucune anomalie d’intégrité, de numéro, d’audit ni de fichier sur les données de tous les parcours', () => {
    test.setTimeout(180_000)
    const report = integrityReport()
    const checks = new Map(report.checks.map((check) => [check.code, check]))

    // Le dataset n'est pas vide : sinon l'absence d'anomalie ne prouverait rien.
    expect(report.facts['invoices_issued'], 'factures émises par les parcours').toBeGreaterThan(0)
    expect(report.facts['receipts'], 'reçus émis par les parcours').toBeGreaterThan(0)
    expect(report.audit_events, 'événements d’audit').toBeGreaterThan(0)

    // Tous les contrôles d'un coup : un échec montre d'emblée chacun de ceux qui ne sont pas à zéro.
    const strict = [
      'SCHEMA_TABLES',
      'INTEGRITY',
      'SEQUENCES',
      'NUMBERED_DOCUMENTS',
      'AUDIT_HASHES',
      'STORED_FILES',
    ]
    const observed = Object.fromEntries(
      strict.map((code) => {
        const check = checks.get(code)
        return [
          code,
          {
            status: check?.status ?? 'ABSENT',
            count: check?.count ?? -1,
            details: (check?.details ?? []).slice(0, 10),
          },
        ]
      }),
    )
    expect(observed).toEqual(
      Object.fromEntries(strict.map((code) => [code, { status: 'PASS', count: 0, details: [] }])),
    )

    const reconciliation = checks.get('OFFLINE_RECONCILIATION')
    expect(reconciliation, 'contrôle OFFLINE_RECONCILIATION présent').toBeDefined()
    expect(reconciliation?.status).not.toBe('FAIL')
    // Les alertes éventuelles (postes à synchroniser) sont consignées dans le rapport du test.
    test.info().annotations.push({
      type: 'postes à synchroniser',
      description: (reconciliation?.details ?? []).join(' | ') || 'aucun',
    })
    expect(report.status).not.toBe('FAIL')
  })
})

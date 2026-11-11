import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

/**
 * Appelle `database.php` (base de test des parcours, APP_ENV=e2e) et rend sa sortie standard ; une sortie non nulle lève
 * l'erreur avec le message du programme. Voir database.php pour les actions et leurs garde-fous.
 */
function runDatabaseAction(...args: string[]): string {
  const run = spawnSync('php', [join(ROOT, 'tests', 'e2e', 'support', 'database.php'), ...args], {
    cwd: ROOT,
    env: { ...process.env, APP_ENV: 'e2e' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (run.status !== 0) {
    throw new Error(
      `database.php ${args.join(' ')} a échoué (code ${String(run.status)}) : ${run.stderr}\n${run.stdout.slice(0, 2000)}`,
    )
  }
  return run.stdout
}

export interface IntegrityCheck {
  code: string
  label: string
  status: 'PASS' | 'WARN' | 'FAIL'
  count: number
  details: string[]
}

export interface IntegrityReport {
  status: 'PASS' | 'WARN' | 'FAIL'
  checks: IntegrityCheck[]
  facts: Record<string, string | number | null>
  database: string
  audit_events: number
}

/** Contrôles d'intégrité de la restauration vérifiée sur la base des parcours, en lecture seule. */
export function integrityReport(): IntegrityReport {
  return JSON.parse(runDatabaseAction('integrity')) as IntegrityReport
}

export interface BlockingDevice {
  code: string
  status: string
}

/**
 * Postes dont les ressources financières encore ouvertes (plage de numéros, quota de stock, propriété de facture) feraient
 * refuser, par « une seule caisse hors ligne principale » (`FINANCIAL_DEVICE_ELSEWHERE`), la préparation d'un autre poste.
 * Lecture seule. Sert au filet de `prepareThisDevice` (voir `device-isolation.ts`) et au test de garde.
 */
export function blockingDevices(): BlockingDevice[] {
  const report = JSON.parse(runDatabaseAction('blocking-devices')) as {
    blocking: { device_code: string; status: string }[]
  }
  return report.blocking.map((device) => ({ code: device.device_code, status: device.status }))
}

/**
 * Sort des postes de test (codes explicites) restés actifs d'un parcours échoué : sans cela, leurs plages et leurs droits
 * d'écriture ouverts feraient échouer, par « une seule caisse hors ligne principale », tous les parcours suivants et la
 * reprise du parcours lui-même. Idempotent : rend le nombre de postes réellement sortis (un poste déjà sorti ou inconnu ne
 * compte pas). À n'appeler que pour des postes dont le parcours n'a PAS rendu les ressources.
 */
export function retireDevices(deviceCodes: readonly string[]): number {
  if (deviceCodes.length === 0) return 0
  const report = JSON.parse(runDatabaseAction('retire-device', ...deviceCodes)) as {
    retired: number
  }
  return report.retired
}

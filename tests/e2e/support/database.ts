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

/**
 * Sort un poste de test (code explicite) resté actif d'un parcours échoué : sans cela, ses plages et ses droits d'écriture
 * ouverts feraient échouer, par « une seule caisse hors ligne principale », tous les parcours suivants. À n'appeler que
 * quand le parcours n'a PAS rendu les ressources du poste.
 */
export function retireDevice(deviceCode: string): void {
  runDatabaseAction('retire-device', deviceCode)
}

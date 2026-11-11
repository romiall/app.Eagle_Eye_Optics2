// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `tools/dev/tester-projet.sh` rejoue, en une commande, tous les contrôles qui ont validé les modules livrés (consigne du
 * demandeur du 2026-11-10 : un seul script, jamais module par module). Ce test l'empêche de rester en arrière de la CI
 * (`.github/workflows/quality.yml`) :
 *  - toute étape de la CI ajoutée, retirée ou renommée change l'empreinte ci-dessous : il faut alors reproduire le
 *    changement dans le script, puis mettre l'empreinte à jour ;
 *  - le script doit contenir la commande équivalente de chaque contrôle de la CI et une fonction pour chaque étape annoncée.
 */
const ROOT = process.cwd()
const script = readFileSync(join(ROOT, 'tools/dev/tester-projet.sh'), 'utf8')
const workflow = readFileSync(join(ROOT, '.github/workflows/quality.yml'), 'utf8')

/** Empreinte (12 premiers caractères du SHA-256) des noms d'étapes de la CI, triés. */
const CI_STEPS_FINGERPRINT = '2a5a9f659705'

const REQUIRED_FRAGMENTS: readonly string[] = [
  'pint --test',
  'phpstan analyse',
  'php vendor/bin/phpunit',
  'build_enums',
  'build_commands',
  'build_events',
  'build_resources',
  'build_openapi',
  'build_vectors',
  'generate-types.mjs --check',
  'build_migrations.py --check',
  'schema-parity.sh',
  'composer audit --locked',
  'npm run typecheck',
  'npm run lint',
  'npm run format:check',
  'vitest run',
  'npm run build',
  'npm audit --omit=dev --audit-level=high',
  'playwright test',
]

const STEPS: readonly string[] = [
  'preparation',
  'installation',
  'mysql',
  'contrats',
  'baseline',
  'schema',
  'pint',
  'phpstan',
  'phpunit',
  'vue-tsc',
  'eslint',
  'prettier',
  'vitest',
  'build',
  'avis',
  'scripts',
  'e2e',
  'en-ligne',
  'ci',
]

function ciStepNames(): string[] {
  return [...workflow.matchAll(/^\s+- name: (.+)$/gm)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((name) => name !== '')
    .sort()
}

describe('script unique de vérification du projet', () => {
  it('suit la CI : les étapes de quality.yml sont celles que le script reproduit', () => {
    const names = ciStepNames()
    const fingerprint = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 12)
    expect(
      fingerprint,
      `La CI a changé (${String(names.length)} étapes : ${names.join(' | ')}). Reproduire le changement dans tools/dev/tester-projet.sh puis mettre CI_STEPS_FINGERPRINT à jour.`,
    ).toBe(CI_STEPS_FINGERPRINT)
  })

  it('reproduit chaque contrôle de la CI', () => {
    const missing = REQUIRED_FRAGMENTS.filter((fragment) => !script.includes(fragment))
    expect(missing).toEqual([])
  })

  it('définit une fonction pour chaque étape annoncée', () => {
    const missing = STEPS.filter((step) => !script.includes(`step_${step.replace('-', '_')}() {`))
    expect(missing).toEqual([])
    expect(script).toContain(`STEPS=(${STEPS.join(' ')})`)
  })

  it('annonce un verdict et ne touche ni au dossier de travail ni aux bases des autres sessions', () => {
    expect(script).toContain('VERDICT :')
    expect(script).toContain('eeo_verif_test')
    expect(script).toContain('eeo_verif_e2e_test')
    expect(script).toContain('git -C "$WORK" clean -fdxq -e /vendor -e /node_modules')
    expect(script).not.toMatch(/git (stash|reset|switch|checkout) .*\$SRC/)
  })

  it('protège vendor/ et node_modules/ du nettoyage sous Git Bash (« -e /vendor » y devient un chemin Windows)', () => {
    // Sans MSYS_NO_PATHCONV, le motif ne protège rien : les dépendances sont effacées puis réinstallées à chaque passage.
    expect(script).toMatch(
      /MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='\*' git -C "\$WORK" clean -fdxq -e \/vendor -e \/node_modules/,
    )
  })
})

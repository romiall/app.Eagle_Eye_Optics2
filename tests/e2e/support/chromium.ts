import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { LaunchOptions } from '@playwright/test'

/**
 * Chromium local : variable PLAYWRIGHT_CHROMIUM_EXECUTABLE, sinon le Chromium préinstallé de
 * /opt/pw-browsers (poste de développement cloud), sinon le navigateur installé par Playwright
 * (CI : « npx playwright install --with-deps chromium »). Aucun téléchargement n'est lancé ici.
 */
function chromiumExecutable(): string | undefined {
  const fromEnvironment = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
  if (fromEnvironment) return fromEnvironment

  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers'
  if (!existsSync(root)) return undefined

  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    // Selon la version de Playwright, le dossier s'appelle chrome-linux ou chrome-linux64.
    .flatMap((name) => [
      join(root, name, 'chrome-linux', 'chrome'),
      join(root, name, 'chrome-linux64', 'chrome'),
    ])

  return candidates.find((candidate) => existsSync(candidate))
}

/**
 * Options de lancement de Chromium communes à tous les tests. Un test qui a besoin d'arguments
 * supplémentaires (nom d'hôte fictif, certificat de test) les passe en `extraArgs` via
 * `test.use({ launchOptions: chromiumLaunchOptions([...]) })` : `launchOptions` est remplacé en bloc,
 * pas fusionné, et perdrait sinon le chemin du navigateur.
 */
export function chromiumLaunchOptions(extraArgs: readonly string[] = []): LaunchOptions {
  const executablePath = chromiumExecutable()

  return {
    ...(executablePath ? { executablePath } : {}),
    args: [
      // Les conteneurs de CI et de développement cloud n'offrent pas le bac à sable de Chromium.
      ...(process.env['CI'] || executablePath ? ['--no-sandbox'] : []),
      ...extraArgs,
    ],
  }
}

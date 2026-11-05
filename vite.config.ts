import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import laravel from 'laravel-vite-plugin'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { createPwaOptions, PWA_ICONS } from './resources/frontend/app/pwa.config.ts'

/** Empreinte des fichiers statiques de public/, utilisée comme révision de précache. */
function publicFileRevisions(urls: readonly string[]): Record<string, string> {
  const revisions: Record<string, string> = {}
  for (const url of urls) {
    const path = fileURLToPath(new URL(`./public${url}`, import.meta.url))
    if (existsSync(path)) {
      revisions[url] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
    }
  }
  return revisions
}

// Date de construction : EEO_BUILD_AT (build de livraison) ou l'instant du build.
const builtAt = process.env['EEO_BUILD_AT'] ?? new Date().toISOString()

// La coquille « / » est rendue par Laravel et référence des fichiers versionnés : sa révision change
// à chaque build (ou prend EEO_BUILD_ID pour un build reproductible).
const shellRevision = process.env['EEO_BUILD_ID'] ?? builtAt

// Identité de ce build, affichée en bas de chaque écran (O06) pour que la personne sache quelle version elle exécute :
// EEO_BUILD_ID (le commit de la livraison, voir tools/deploy/build-release.sh) ou, hors livraison, « local- » suivi
// de la date et de l'heure de construction.
const buildId = process.env['EEO_BUILD_ID'] ?? `local-${builtAt.replace(/\D/g, '').slice(0, 12)}`

/** Écrit `build-info.json` dans public/build : l'identité du build, lisible par les contrôles de livraison et les tests. */
function buildInfoFile(): Plugin {
  return {
    name: 'eeo-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: `${JSON.stringify({ id: buildId, builtAt }, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  define: {
    __EEO_BUILD_ID__: JSON.stringify(buildId),
    __EEO_BUILD_AT__: JSON.stringify(builtAt),
  },
  plugins: [
    buildInfoFile(),
    laravel({
      input: ['resources/frontend/app/main.ts'],
      refresh: ['resources/views/**'],
    }),
    vue({ template: { transformAssetUrls: { base: null, includeAbsolute: false } } }),
    tailwindcss(),
    VitePWA(
      createPwaOptions(
        publicFileRevisions([...PWA_ICONS.map((icon) => icon.src), '/icons/favicon.svg']),
        shellRevision,
      ),
    ),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./resources/frontend', import.meta.url)) },
  },
  build: {
    sourcemap: false,
  },
  server: {
    watch: { ignored: ['**/storage/framework/views/**', '**/vendor/**'] },
  },
})

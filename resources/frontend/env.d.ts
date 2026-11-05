/// <reference types="vite/client" />

/**
 * Identité de ce build, injectée à la construction par Vite (`define` de vite.config.ts) et fixée pour les tests
 * (vitest.config.ts). Lue seulement par `app/release.ts`.
 */
declare const __EEO_BUILD_ID__: string
declare const __EEO_BUILD_AT__: string

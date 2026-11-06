import type { BuildInfo } from './buildInfo'

/**
 * Version de l'application (release) : identique à `info.version` du contrat OpenAPI et à `release` de
 * `contracts/compatibility.json` (vérifié par tests/frontend/offline/update.test.ts). Inscrite dans les exports du poste
 * (O07) et comparée à la déclaration du serveur avant une mise à jour (O06).
 */
export const APP_RELEASE = '0.1.0-l0'

/**
 * Identité de CE build : l'identifiant de la livraison (le commit, `EEO_BUILD_ID`) et la date de construction. Elle est
 * écrite dans le code par la construction (vite.config.ts, `define`) et affichée en bas de chaque écran : c'est ce qui
 * dit à la personne quelle version son navigateur exécute, qu'une mise à jour soit proposée ou non (O06).
 */
export const APP_BUILD: BuildInfo = Object.freeze({
  id: __EEO_BUILD_ID__,
  builtAt: __EEO_BUILD_AT__,
})

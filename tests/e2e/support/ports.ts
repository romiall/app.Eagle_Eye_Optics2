// Ports et noms d'hôte des serveurs démarrés par les tests e2e. Tout est dérivé du port du serveur
// principal (EEO_E2E_PORT, défaut 8123, celui de « webServer » dans playwright.config.ts) : un seul
// endroit pour éviter qu'un nouveau test réutilise le port d'un autre.

/** Serveur principal, démarré par Playwright (webServer). */
export const MAIN_PORT = Number(process.env['EEO_E2E_PORT'] ?? 8123)

/** Serveur que le test de coupure arrête réellement (origine HTTP dédiée). */
export const OFFLINE_PORT = MAIN_PORT + 1

/** Serveur PHP en HTTP simple, derrière le proxy TLS du test d'origine HTTPS. */
export const HTTPS_BACKEND_PORT = MAIN_PORT + 2

/** Proxy TLS du test d'origine HTTPS : c'est lui que le navigateur interroge. */
export const HTTPS_PROXY_PORT = MAIN_PORT + 3

/** Serveur arrêté par le test « /api authentifiée jamais servie hors ligne ». */
export const AUTH_OFFLINE_PORT = MAIN_PORT + 4

/** Serveur arrêté puis relancé par le test de démarrage sans réseau d'un poste préparé (AT36). */
export const START_OFFLINE_PORT = MAIN_PORT + 5

/** Serveur arrêté par le test de facturation sans réseau d'un poste préparé (AT37 à la lettre). */
export const INVOICE_OFFLINE_PORT = MAIN_PORT + 6

/** Serveur arrêté par le test de l'annuaire du poste (fiche et facture d'un patient du serveur sans réseau). */
export const DIRECTORY_OFFLINE_PORT = MAIN_PORT + 7

/**
 * Nom d'hôte du cabinet pour le test d'origine HTTPS. Il se termine par « .test » (TLD réservé,
 * jamais résolu sur Internet) et playwright.config.ts le fait pointer vers 127.0.0.1 dans Chromium.
 * Un nom de ce type est indispensable : Chromium exempte 127.0.0.1 et localhost des règles de contenu
 * mixte, une coquille cassée y paraîtrait donc saine.
 */
export const HTTPS_HOSTNAME = 'cabinet.eeo-e2e.test'

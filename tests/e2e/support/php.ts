import { spawnSync } from 'node:child_process'

let cached: string[] | null = null

/**
 * Options PHP des serveurs de test (`php -S`) : OPcache chargé pour ce seul processus, qui dure tout
 * le test. Sans lui, chaque requête recompile Laravel : plusieurs secondes par requête sur un poste
 * Windows chargé, assez pour dépasser les délais des tests (le serveur intégré traite une requête à
 * la fois, précache du service worker compris). Le serveur intégré (SAPI cli-server) suit
 * `opcache.enable`, actif dès que l'extension est chargée ; `opcache.enable_cli` ne le concerne pas.
 * Rien n'est modifié dans le php.ini du poste : extension déjà chargée (CI) → JIT coupé seulement ;
 * présente mais non chargée → chargée par `-d`, JIT coupé ; absente → aucune option.
 */
export function phpServerOptions(): string[] {
  if (cached !== null) return cached
  const probe = spawnSync(
    'php',
    [
      '-r',
      "echo extension_loaded('Zend OPcache') ? 'loaded' : (is_file(ini_get('extension_dir').DIRECTORY_SEPARATOR.(PHP_OS_FAMILY === 'Windows' ? 'php_opcache.dll' : 'opcache.so')) ? 'available' : 'absent');",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const state = probe.status === 0 ? probe.stdout.trim() : 'absent'
  // JIT d'OPcache coupé pour ce processus : actif par défaut sur la CI (setup-php), il compile mal les chemins du
  // hors-ligne (grants, pull) : TypeError absurde « CarbonImmutable attendu, CarbonImmutable reçu » en PHP 8.3.6,
  // erreur de segmentation du serveur en CI (2026-10-25). Le cache d'opcodes, seul utile ici, reste actif.
  const noJit = ['-d', 'opcache.jit=disable']
  cached =
    state === 'available'
      ? ['-d', 'zend_extension=opcache', ...noJit]
      : state === 'loaded'
        ? noJit
        : []
  return cached
}

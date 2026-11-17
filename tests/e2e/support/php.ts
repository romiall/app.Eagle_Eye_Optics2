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
      "$extDir = (string) ini_get('extension_dir'); $file = PHP_OS_FAMILY === 'Windows' ? 'php_opcache.dll' : 'opcache.so'; $phpDir = dirname(PHP_BINARY); $found = is_file($extDir.DIRECTORY_SEPARATOR.$file) || is_file($phpDir.DIRECTORY_SEPARATOR.$extDir.DIRECTORY_SEPARATOR.$file) || is_file($phpDir.DIRECTORY_SEPARATOR.'ext'.DIRECTORY_SEPARATOR.$file); echo extension_loaded('Zend OPcache') ? 'loaded' : ($found ? 'available' : 'absent');",
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const state = probe.status === 0 ? probe.stdout.trim() : 'absent'
  // JIT d'OPcache coupé pour ce processus : actif par défaut sur la CI (setup-php), il compile mal les chemins du
  // hors-ligne (grants, pull) : TypeError absurde « CarbonImmutable attendu, CarbonImmutable reçu » en PHP 8.3.6,
  // erreur de segmentation du serveur en CI (2026-10-25). Le cache d'opcodes, seul utile ici, reste actif.
  const opcacheFlags = [
    '-d',
    'opcache.enable=1',
    '-d',
    'opcache.enable_cli=1',
    '-d',
    'opcache.jit=disable',
  ]
  cached =
    state === 'available'
      ? ['-d', 'zend_extension=opcache', ...opcacheFlags]
      : state === 'loaded'
        ? opcacheFlags
        : []
  return cached
}

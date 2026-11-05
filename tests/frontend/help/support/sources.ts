import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { normalizeText } from '@/domain/help/search'

/**
 * Lecture des sources de référence des gardes de l'aide : le code de l'application (pour établir
 * les libellés qui existent vraiment), le semis des droits et des profils, la liste des modules du
 * serveur et les fichiers de contenu de l'aide (pour dire au rédacteur QUEL fichier corriger).
 * Tout est lu avec `node:fs` depuis le dossier de travail : aucune copie, aucun instantané.
 */

/** Racine du dépôt (ce fichier : tests/frontend/help/support/). */
export const ROOT = join(import.meta.dirname, '..', '..', '..', '..')

export interface SourceFile {
  /** Chemin relatif à la racine, avec des barres obliques (`resources/frontend/app/router.ts`). */
  readonly path: string
  readonly text: string
}

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  lt: '<',
  gt: '>',
  apos: "'",
  rsquo: "'",
  lsquo: "'",
}

/** Entités HTML courantes d'un gabarit Vue (`&nbsp;`, `&amp;`, `&#39;`…), lues comme à l'écran. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole: string, name: string) => {
    if (name.startsWith('#')) {
      const hexadecimal = name.charAt(1) === 'x' || name.charAt(1) === 'X'
      const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isNaN(code) || code > 0x10ffff ? whole : String.fromCodePoint(code)
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/**
 * Forme sous laquelle on compare un libellé : apostrophe droite (’ → '), espaces insécables et
 * retours à la ligne ramenés à une espace, espaces multiples fusionnées, bords retirés.
 */
export function normalizeLabel(text: string): string {
  return text.normalize('NFC').replace(/[’‘ʼ]/g, "'").replace(/\s+/g, ' ').trim()
}

const HELP_DOMAIN = 'resources/frontend/domain/help/'

/**
 * Le contenu de l'aide et l'ancienne aide ne sont PAS des écrans : si on les lisait, tout libellé
 * cité y serait « trouvé » dans le texte qui le cite. Le reste du dossier `domain/help` (profils,
 * parties du plan) et les composants de l'aide sont de vrais textes d'écran.
 */
export function isHelpContent(path: string): boolean {
  return path.startsWith(`${HELP_DOMAIN}content/`) || path === `${HELP_DOMAIN}guide.ts`
}

const WORD = /[\p{L}\p{N}]/u

/** Le texte contient `needle` sans la couper au milieu d'un mot (« Axe » n'est pas dans « Axes »). */
function containsWhole(text: string, needle: string): boolean {
  const startsWord = WORD.test(needle.charAt(0))
  const endsWord = WORD.test(needle.charAt(needle.length - 1))
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at === -1) return false
    const cutBefore = startsWord && at > 0 && WORD.test(text.charAt(at - 1))
    const cutAfter = endsWord && WORD.test(text.charAt(at + needle.length))
    if (!cutBefore && !cutAfter) return true
    from = at + 1
  }
}

/** Ensemble des textes de l'application, prêt à répondre « ce libellé existe-t-il ? ». */
export class LabelCorpus {
  /** Fichiers retenus (chemins relatifs). */
  readonly files: readonly string[]
  private readonly text: string
  private folded: string | undefined
  private readonly memo = new Map<string, boolean>()

  constructor(
    sources: readonly SourceFile[],
    isExcluded: (path: string) => boolean = isHelpContent,
  ) {
    const kept = sources.filter((source) => !isExcluded(source.path))
    this.files = kept.map((source) => source.path)
    this.text = kept.map((source) => normalizeLabel(decodeEntities(source.text))).join('\n')
  }

  /** Le libellé (normalisé comme le corpus) figure tel quel dans le code. */
  has(label: string): boolean {
    const wanted = normalizeLabel(label)
    if (wanted === '') return false
    const known = this.memo.get(wanted)
    if (known !== undefined) return known
    const found = containsWhole(this.text, wanted)
    this.memo.set(wanted, found)
    return found
  }

  /** Une forme proche existe (casse ou accents différents) : aide au rédacteur, jamais un succès. */
  looselyHas(label: string): boolean {
    this.folded ??= normalizeText(this.text)
    const wanted = normalizeText(label)
    return wanted !== '' && this.folded.includes(wanted)
  }
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.(?:vue|ts)$/.test(entry.name) ? [path] : []
  })
}

function portable(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

/** Code du frontend (`.vue` et `.ts`) et données de référence : là où l'application écrit ses libellés. */
export function readApplicationSources(root: string = ROOT): SourceFile[] {
  const files = [
    ...walk(join(root, 'resources', 'frontend')),
    join(root, 'database', '02_reference_data.sql'),
  ]
  return files.map((file) => ({ path: portable(root, file), text: readFileSync(file, 'utf8') }))
}

export interface Seed {
  /** Codes de la table `permissions`. */
  readonly permissions: ReadonlySet<string>
  /** Codes de la table `roles`. */
  readonly roles: ReadonlySet<string>
  /** Droits par défaut de chaque profil (`role_permissions`). */
  readonly rolePermissions: ReadonlyMap<string, ReadonlySet<string>>
}

/** Une instruction `INSERT INTO` : jusqu'au `);` qui ferme la dernière ligne (un `;` peut figurer dans un texte). */
function insertBlock(sql: string, table: string): string {
  const start = sql.indexOf(`INSERT INTO \`${table}\``)
  if (start === -1) return ''
  const rest = sql.slice(start)
  const end = rest.search(/\);[ \t]*(?:\r?\n|$)/)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

/** Droits et profils du semis `database/02_reference_data.sql`. */
export function readSeed(root: string = ROOT): Seed {
  const sql = readFileSync(join(root, 'database', '02_reference_data.sql'), 'utf8')
  const rolePermissions = new Map<string, Set<string>>()
  for (const match of insertBlock(sql, 'role_permissions').matchAll(
    /\('([A-Z_]+)',\s*'([a-z_]+(?:\.[a-z_]+)+)'\)/g,
  )) {
    const [, role = '', code = ''] = match
    rolePermissions.set(role, (rolePermissions.get(role) ?? new Set<string>()).add(code))
  }
  return {
    permissions: new Set(
      [...insertBlock(sql, 'permissions').matchAll(/\('([a-z_]+(?:\.[a-z_]+)+)',/g)].map(
        (match) => match[1] ?? '',
      ),
    ),
    roles: new Set(
      [...insertBlock(sql, 'roles').matchAll(/\('([A-Z_]+)',/g)].map((match) => match[1] ?? ''),
    ),
    rolePermissions,
  }
}

/** Codes des modules que le serveur connaît (`app/Support/Modules.php`). */
export function readServerModules(root: string = ROOT): string[] {
  const php = readFileSync(join(root, 'app', 'Support', 'Modules.php'), 'utf8')
  const start = php.indexOf('CODES = [')
  const body = php.slice(start, php.indexOf('];', start)).replace(/\/\/[^\n]*/g, '')
  return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '')
}

export interface ContentFile {
  /** Nom court, tel qu'on le cherche dans le dépôt (`content/pages-patients.ts`). */
  readonly name: string
  readonly text: string
}

/** Fichiers de contenu de l'aide (`domain/help/content/*.ts`). */
export function readContentFiles(root: string = ROOT): ContentFile[] {
  const directory = join(root, 'resources', 'frontend', 'domain', 'help', 'content')
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => ({
      name: `content/${name}`,
      text: readFileSync(join(directory, name), 'utf8'),
    }))
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Fichier(s) de contenu qui déclarent cette fiche (`route: 'x'`) ou cette rubrique (`id: 'x'`) au
 * premier niveau d'un tableau (4 espaces de retrait, mise en forme imposée par Prettier : les
 * liens `route:` et les identifiants de tâches sont plus profonds). Plusieurs noms : doublon.
 */
export function locateEntry(
  files: readonly ContentFile[],
  kind: 'page' | 'topic',
  key: string,
): string {
  const property = kind === 'page' ? 'route' : 'id'
  const pattern = new RegExp(`^ {4}${property}:\\s*['"]${escapeForRegExp(key)}['"]`, 'm')
  const names = files.filter((file) => pattern.test(file.text)).map((file) => file.name)
  return names.length === 0 ? '(fichier de contenu introuvable)' : names.join(' + ')
}

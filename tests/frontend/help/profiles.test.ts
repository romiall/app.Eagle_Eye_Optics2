// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProfileCode } from '@/domain/help/model'
import { KNOWN_MODULES, PROFILES, profileByCode } from '@/domain/help/profiles'

/**
 * Les profils de l'aide (`profiles.ts`) sont une COPIE du semis `database/02_reference_data.sql` :
 * la documentation « voir l'aide comme… » montre ce que ces profils voient réellement, donc un droit
 * de plus ou de moins dans la copie fait mentir l'aide. Ces tests lisent le semis et le serveur tels
 * quels et comparent : aucun droit n'est recopié en dur ici.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SQL = readFileSync(join(ROOT, 'database', '02_reference_data.sql'), 'utf8')

/**
 * Texte d'une instruction `INSERT INTO` du semis, du mot-clé au point-virgule qui la termine.
 *
 * Piège constaté : la description du profil RECEPTION contient « ; » (« Identité et agenda ; frais
 * examen… »). Couper au premier « ; » ne laisse que MANAGER et RECEPTION sur quatre profils. On suit
 * donc les apostrophes : un « ; » entre apostrophes n'est pas la fin (le semis n'a ni `''` ni `\'`).
 */
function insertStatement(table: string): string {
  const start = SQL.indexOf(`INSERT INTO \`${table}\``)
  if (start < 0) throw new Error(`INSERT INTO ${table} introuvable dans le semis`)
  let quoted = false
  for (let position = start; position < SQL.length; position += 1) {
    const char = SQL[position]
    if (char === "'") quoted = !quoted
    else if (char === ';' && !quoted) return SQL.slice(start, position)
  }
  throw new Error(`INSERT INTO ${table} non terminé dans le semis`)
}

/** Table `roles` : code et libellé de chaque profil, dans l'ordre du semis. */
function seededRoles(): { code: string; label: string }[] {
  return [...insertStatement('roles').matchAll(/\('([A-Z_]+)', '([^']*)'/g)].map((match) => ({
    code: match[1] ?? '',
    label: match[2] ?? '',
  }))
}

/** Table `permissions` : tous les codes de droits. */
function seededPermissions(): string[] {
  return [...insertStatement('permissions').matchAll(/\('([a-z_.]+)', '/g)].map(
    (match) => match[1] ?? '',
  )
}

/** Table `role_permissions` : les droits de chaque profil, dans l'ordre du semis. */
function seededGrants(): Map<string, string[]> {
  const grants = new Map<string, string[]>()
  for (const match of insertStatement('role_permissions').matchAll(
    /\('([A-Z_]+)', '([a-z_.]+)'\)/g,
  )) {
    const role = match[1] ?? ''
    grants.set(role, [...(grants.get(role) ?? []), match[2] ?? ''])
  }
  return grants
}

/** Éléments de `left` absents de `right`. */
const missingFrom = (left: readonly string[], right: readonly string[]) =>
  left.filter((item) => !right.includes(item))

describe('le semis est lu en entier', () => {
  it('trouve tous les profils et tous les droits, même avec un « ; » dans une description', () => {
    expect(seededRoles().map((role) => role.code)).toEqual([
      'MANAGER',
      'RECEPTION',
      'CLINICIAN',
      'CASHIER',
    ])
    expect(seededPermissions().length).toBeGreaterThan(40)
    expect([...seededGrants().keys()]).toEqual(['MANAGER', 'RECEPTION', 'CLINICIAN', 'CASHIER'])
    for (const [role, rights] of seededGrants()) expect(rights.length, role).toBeGreaterThan(0)
  })
})

describe('PROFILES et le semis des profils', () => {
  it('décrit les mêmes profils que la table roles, dans le même ordre', () => {
    expect(PROFILES.map((profile) => profile.code)).toEqual(seededRoles().map((role) => role.code))
  })

  it('décrit les mêmes profils que la table role_permissions', () => {
    expect([...PROFILES.map((profile) => profile.code)].sort()).toEqual(
      [...seededGrants().keys()].sort(),
    )
  })

  it('donne à chaque profil EXACTEMENT les droits du semis, ni un de plus ni un de moins', () => {
    const grants = seededGrants()

    for (const profile of PROFILES) {
      const seeded = grants.get(profile.code) ?? []

      expect(
        missingFrom(seeded, profile.permissions),
        `${profile.code} : droits du semis absents de profiles.ts`,
      ).toEqual([])
      expect(
        missingFrom(profile.permissions, seeded),
        `${profile.code} : droits de profiles.ts absents du semis`,
      ).toEqual([])
      expect(new Set(profile.permissions).size, `${profile.code} : droits en double`).toBe(
        profile.permissions.length,
      )
    }
  })

  it('range les droits de chaque profil dans l’ordre du semis (copie ligne à ligne)', () => {
    const grants = seededGrants()

    for (const profile of PROFILES) {
      expect([...profile.permissions], profile.code).toEqual(grants.get(profile.code))
    }
  })

  it('ne cite que des droits qui existent dans la table permissions', () => {
    const seeded = seededPermissions()

    for (const profile of PROFILES) {
      expect(missingFrom(profile.permissions, seeded), profile.code).toEqual([])
    }
  })

  it('nomme chaque profil par le début de son libellé du semis (« Gérante / promotrice »)', () => {
    const labels = new Map(seededRoles().map((role) => [role.code, role.label]))

    for (const profile of PROFILES) {
      const seeded = labels.get(profile.code) ?? ''

      expect(profile.label.length, profile.code).toBeGreaterThan(0)
      expect(seeded.startsWith(profile.label), `${profile.code} : ${seeded}`).toBe(true)
    }
  })

  it('a des codes et des noms uniques, et une phrase de présentation', () => {
    expect(new Set(PROFILES.map((profile) => profile.code)).size).toBe(PROFILES.length)
    expect(new Set(PROFILES.map((profile) => profile.label)).size).toBe(PROFILES.length)
    for (const profile of PROFILES)
      expect(profile.role.trim().length, profile.code).toBeGreaterThan(10)
  })
})

describe('profileByCode', () => {
  it('rend le profil de ce code, le même objet que dans PROFILES', () => {
    for (const profile of PROFILES) expect(profileByCode(profile.code)).toBe(profile)
    expect(profileByCode('CASHIER').label).toBe('Caissière')
  })

  it('lève une erreur pour un code inconnu, vide ou d’une autre casse', () => {
    for (const code of ['INCONNU', '', 'manager', 'Manager']) {
      const candidate: string = code

      expect(() => profileByCode(candidate as ProfileCode), code).toThrow(
        `Profil inconnu : ${code}`,
      )
    }
  })
})

/** Liste `Modules::CODES` du serveur (les lignes de commentaire ne comptent pas). */
function serverModules(): string[] {
  const php = readFileSync(join(ROOT, 'app', 'Support', 'Modules.php'), 'utf8')
  const start = php.indexOf('public const CODES')
  const block = php
    .slice(start, php.indexOf('];', start))
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '')
}

/** Modules dont dépend au moins une route de `router.ts` (`meta.module`). */
function routeModules(): string[] {
  const router = readFileSync(join(ROOT, 'resources', 'frontend', 'app', 'router.ts'), 'utf8')
  return [...new Set([...router.matchAll(/\bmodule: '([a-z_]+)'/g)].map((match) => match[1] ?? ''))]
}

/**
 * ÉCART CONSTATÉ le 2026-10-29 entre `Modules::CODES` (11 codes) et `KNOWN_MODULES` (9 codes) :
 * `workshop` (atelier, livré par L1D04) et `communication` (livré par L2D06) existent côté serveur
 * pour que l'exploitant puisse un jour les ouvrir (`EEO_ENABLED_MODULES`), mais aucune route, aucun
 * écran et donc aucune fiche d'aide n'en dépend encore : ce sont les lots suivants (navigation.ts :
 * `delivered: false`). L'aide ne connaît que les modules qui portent au moins un écran, car
 * `KNOWN_MODULES` sert à « inclure les modules fermés » dans la lecture de la documentation.
 *
 * Ce n'est donc pas un oubli. Mais le jour où l'un d'eux reçoit sa première route, ce fichier échoue
 * (voir le test sur les routes) : ajouter alors son code à `KNOWN_MODULES`, écrire les fiches de ses
 * écrans, et retirer son code de cette liste.
 */
const MODULES_WITHOUT_SCREEN = ['workshop', 'communication']

describe('KNOWN_MODULES et app/Support/Modules.php', () => {
  it('lit la liste du serveur en entier, commentaires de ligne exclus', () => {
    // Contrôle de la lecture seulement : la comparaison avec KNOWN_MODULES est plus bas.
    expect(serverModules()).toEqual(
      expect.arrayContaining([
        'today',
        'patients',
        'sales',
        'workshop',
        'communication',
        'offline',
      ]),
    )
    expect(serverModules().every((code) => /^[a-z]+$/.test(code))).toBe(true)
  })

  it('égale la liste du serveur moins workshop et communication, dans l’ordre de la navigation', () => {
    expect(KNOWN_MODULES).toEqual(
      serverModules().filter((code) => !MODULES_WITHOUT_SCREEN.includes(code)),
    )
  })

  it('n’a pas d’autre écart que ces deux modules : rien d’inconnu du serveur, rien d’oublié', () => {
    expect(missingFrom(serverModules(), KNOWN_MODULES)).toEqual(MODULES_WITHOUT_SCREEN)
    expect(missingFrom(KNOWN_MODULES, serverModules())).toEqual([])
    expect(new Set(KNOWN_MODULES).size).toBe(KNOWN_MODULES.length)
  })

  it('connaît chaque module dont dépend une route du routeur', () => {
    // Justifie l'écart : si une route dépend de workshop ou de communication, l'aide doit les connaître.
    const used = routeModules()

    expect(used.length).toBeGreaterThan(5)
    expect(missingFrom(used, KNOWN_MODULES), 'module de route inconnu de l’aide').toEqual([])
    for (const code of MODULES_WITHOUT_SCREEN) expect(used, code).not.toContain(code)
  })
})

import type { Page } from '@playwright/test'

import { LOCAL_SCHEMA } from '../../../resources/frontend/offline/migrations/registry'

/**
 * Lecture et fabrication de la base IndexedDB du poste (`eeo-device`) en IndexedDB BRUTE, dans le vrai navigateur, sans
 * passer par le code de l'application (O06). Une migration du schéma local ou une mise à jour de l'application n'a rien
 * perdu si les lignes qui comptent sont identiques avant et après : c'est ce que `readDeviceDatabase` mesure, par
 * empreinte.
 */
export const DEVICE_DATABASE = 'eeo-device'

/** Tables dont les lignes ne changent pas tant que le coffre reste verrouillé : journal, profils, clés, données chiffrées. */
export const INTEGRITY_TABLES = [
  'command_journal',
  'profiles',
  'key_envelopes',
  'encrypted_entities',
  'encrypted_documents',
] as const

export interface DeviceDatabaseSnapshot {
  /** Version IndexedDB : Dexie multiplie par 10 la version du schéma local (5 → 50). */
  version: number
  stores: string[]
  /** Pour chaque table de contrôle : nombre de lignes et empreinte SHA-256 de leur contenu. */
  tables: Record<string, { count: number; digest: string }>
  /** Clés de `vault_meta` (identité, format du coffre…). */
  metaKeys: string[]
  /** Identifiants des commandes du journal, dans l'ordre. */
  journalIds: string[]
}

/** Instantané de la base du poste, ou `null` si elle n'existe pas (rien n'est créé par la lecture). */
export async function readDeviceDatabase(page: Page): Promise<DeviceDatabaseSnapshot | null> {
  return page.evaluate(
    async ({ name, tables }) => {
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name)
        // Base absente : l'ouverture la créerait ; on annule pour ne rien écrire.
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      })
      if (database === null) return null

      const canonical = (value: unknown): string => {
        if (value instanceof Uint8Array)
          return `u8:${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
        if (value instanceof ArrayBuffer) return canonical(new Uint8Array(value))
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
        if (value !== null && typeof value === 'object') {
          const record = value as Record<string, unknown>
          return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
            .join(',')}}`
        }
        return JSON.stringify(value) ?? 'undefined'
      }
      const hex = async (text: string): Promise<string> => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      }
      const all = (store: string): Promise<unknown[]> =>
        new Promise((resolve, reject) => {
          const request = database.transaction(store, 'readonly').objectStore(store).getAll()
          request.onsuccess = () => resolve(request.result as unknown[])
          request.onerror = () => reject(request.error)
        })
      const keys = (store: string): Promise<IDBValidKey[]> =>
        new Promise((resolve, reject) => {
          const request = database.transaction(store, 'readonly').objectStore(store).getAllKeys()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

      const stores = Array.from(database.objectStoreNames)
      const summary: Record<string, { count: number; digest: string }> = {}
      for (const table of tables) {
        if (!stores.includes(table)) continue
        const rows = await all(table)
        summary[table] = { count: rows.length, digest: await hex(rows.map(canonical).join('\n')) }
      }
      const metaKeys = stores.includes('vault_meta') ? (await keys('vault_meta')).map(String) : []
      const journalRows = stores.includes('command_journal')
        ? ((await all('command_journal')) as { commandId: string; deviceSequence: number }[])
        : []
      const journalIds = journalRows
        .sort((a, b) => Number(a.deviceSequence) - Number(b.deviceSequence))
        .map((row) => row.commandId)
      const version = database.version
      database.close()
      return {
        version,
        stores: stores.sort(),
        tables: summary,
        metaKeys: metaKeys.sort(),
        journalIds,
      }
    },
    { name: DEVICE_DATABASE, tables: [...INTEGRITY_TABLES] },
  )
}

/**
 * Un texte figure-t-il EN CLAIR dans la base du poste (chaînes et octets de toutes les lignes) ? Les octets sont lus
 * comme du latin-1 : un texte ASCII y est retrouvé tel quel. Sert à prouver qu'une pièce enregistrée sur le poste n'y
 * est jamais lisible (coffre chiffré), avec un témoin de détectabilité : un texte qui y est EN CLAIR est bien trouvé.
 */
export async function deviceDatabaseMentions(page: Page, needle: string): Promise<boolean> {
  return page.evaluate(
    async ({ name, text }) => {
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name)
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      })
      if (database === null) return false
      const flatten = (value: unknown): string => {
        if (typeof value === 'string') return value
        if (value instanceof Uint8Array)
          return Array.from(value, (b) => String.fromCharCode(b)).join('')
        if (value instanceof ArrayBuffer) return flatten(new Uint8Array(value))
        if (Array.isArray(value)) return value.map(flatten).join('\n')
        if (value !== null && typeof value === 'object') {
          return Object.entries(value as Record<string, unknown>)
            .map(([key, inner]) => `${key}\n${flatten(inner)}`)
            .join('\n')
        }
        return String(value)
      }
      let haystack = ''
      for (const store of Array.from(database.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction(store, 'readonly').objectStore(store).getAll()
          request.onsuccess = () => resolve(request.result as unknown[])
          request.onerror = () => reject(request.error)
        })
        haystack += `\n${store}\n${rows.map(flatten).join('\n')}`
      }
      database.close()
      return haystack.includes(text)
    },
    { name: DEVICE_DATABASE, text: needle },
  )
}

/**
 * Compartiments dont chaque profil du poste détient une enveloppe de clé, par identifiant de connexion, lus dans
 * IndexedDB BRUTE (tables `profiles` et `key_envelopes`) : la séparation des compartiments telle qu'elle est STOCKÉE, sans
 * passer par le code de l'application. L'emplacement de la clé de signature du poste n'est pas un compartiment.
 */
export async function readProfileCompartments(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.transaction?.abort()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
    if (database === null) return {}
    const all = (store: string): Promise<Record<string, unknown>[]> =>
      new Promise((resolve, reject) => {
        const request = database.transaction(store, 'readonly').objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result as Record<string, unknown>[])
        request.onerror = () => reject(request.error)
      })
    const logins = new Map<string, string>()
    for (const profile of await all('profiles')) {
      logins.set(String(profile['id']), String(profile['login']))
    }
    const found: Record<string, Set<string>> = {}
    for (const envelope of await all('key_envelopes')) {
      const login = logins.get(String(envelope['profileId']))
      const slot = String(envelope['slot'])
      if (login === undefined || slot === 'DEVICE_SIGNING') continue
      ;(found[login] ??= new Set()).add(slot)
    }
    database.close()
    return Object.fromEntries(
      Object.entries(found).map(([login, slots]) => [login, Array.from(slots).sort()]),
    )
  }, DEVICE_DATABASE)
}

/**
 * Nombre de lignes de `encrypted_entities` par compartiment, lu en brut : le compartiment et le type d'une ligne ne sont pas
 * secrets (le contenu, lui, est chiffré). Clé : `COMPARTIMENT:type`.
 */
export async function readEntityCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.transaction?.abort()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
    if (database === null) return {}
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database
        .transaction('encrypted_entities', 'readonly')
        .objectStore('encrypted_entities')
        .getAll()
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[])
      request.onerror = () => reject(request.error)
    })
    database.close()
    const counts: Record<string, number> = {}
    for (const row of rows) {
      const key = `${String(row['compartment'])}:${String(row['type'])}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, DEVICE_DATABASE)
}

export interface DeviceDatabaseContent {
  version: number
  /** Pour chaque table : toutes ses lignes (valeurs simples) et les noms de ses index. */
  tables: Record<string, { rows: unknown[]; indexes: string[] }>
}

/** Contenu COMPLET de la base du poste (lignes et index de chaque table) : pour des bases d'essai à valeurs simples. */
export async function readDeviceContent(page: Page): Promise<DeviceDatabaseContent | null> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.transaction?.abort()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
    if (database === null) return null
    const tables: Record<string, { rows: unknown[]; indexes: string[] }> = {}
    for (const store of Array.from(database.objectStoreNames)) {
      const objectStore = database.transaction(store, 'readonly').objectStore(store)
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = objectStore.getAll()
        request.onsuccess = () => resolve(request.result as unknown[])
        request.onerror = () => reject(request.error)
      })
      tables[store] = { rows, indexes: Array.from(objectStore.indexNames).sort() }
    }
    const version = database.version
    database.close()
    return { version, tables }
  }, DEVICE_DATABASE)
}

interface StoreDefinition {
  name: string
  keyPath: string | null
  autoIncrement: boolean
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[]
}

/** Tables et index de la base à la version `version` du registre (syntaxe Dexie → objets IndexedDB). */
export function storeDefinitions(version: number): StoreDefinition[] {
  const specs = new Map<string, string>()
  for (const entry of LOCAL_SCHEMA) {
    if (entry.version > version) break
    for (const [table, spec] of Object.entries(entry.stores)) specs.set(table, spec)
  }
  return [...specs.entries()].map(([name, spec]) => {
    const [primary = '', ...indexes] = spec
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token !== '')
    return {
      name,
      keyPath: primary.replace(/^\+\+/, '') || null,
      autoIncrement: primary.startsWith('++'),
      indexes: indexes.map((token) => {
        const bare = token.replace(/^[&*]/, '')
        return {
          name: bare,
          keyPath: bare.startsWith('[') ? bare.slice(1, -1).split('+') : bare,
          unique: token.startsWith('&'),
          multiEntry: token.startsWith('*'),
        }
      }),
    }
  })
}

/**
 * Ligne d'exemple d'une table (même principe que le test Vitest des paliers) : chaque champ nommé par la déclaration
 * reçoit une valeur propre à la ligne ; une clé auto-incrémentée est laissée à IndexedDB.
 */
export function sampleRows(definition: StoreDefinition, count: number): Record<string, string>[] {
  const fields = new Set<string>()
  if (definition.keyPath !== null && !definition.autoIncrement) fields.add(definition.keyPath)
  for (const index of definition.indexes) {
    for (const field of Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath])
      fields.add(field)
  }
  return Array.from({ length: count }, (_unused, position) =>
    Object.fromEntries(
      [...fields].map((field) => [field, `${definition.name}.${field}.${position + 1}`]),
    ),
  )
}

/**
 * Crée la base du poste à la version `version` du registre, sans l'application : tables, index et lignes d'exemple (les
 * lignes de `vault_meta` reprennent celles d'un vrai coffre). Rend les lignes écrites, par table.
 */
export async function createDeviceDatabaseAt(
  page: Page,
  version: number,
): Promise<Record<string, unknown[]>> {
  const definitions = storeDefinitions(version)
  const rows: Record<string, unknown[]> = {}
  for (const definition of definitions) {
    rows[definition.name] =
      definition.name === 'vault_meta'
        ? [
            {
              key: 'identity',
              value: {
                vaultId: '01J9ZXK4M2Q8R7S6T5V4W3V001',
                clinicId: '01J9ZXK4M2Q8R7S6T5V4W3C001',
                deviceId: '01J9ZXK4M2Q8R7S6T5V4W3D001',
                createdAt: '2026-10-22T08:00:00.000Z',
              },
            },
            { key: 'format', value: { formatVersion: 1, minWriterVersion: 1 } },
          ]
        : sampleRows(definition, 2)
  }
  await page.evaluate(
    async ({ name, idbVersion, definitions: stores, data }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, idbVersion)
        request.onupgradeneeded = () => {
          const database = request.result
          for (const definition of stores) {
            const store = database.createObjectStore(definition.name, {
              ...(definition.keyPath === null ? {} : { keyPath: definition.keyPath }),
              autoIncrement: definition.autoIncrement,
            })
            for (const index of definition.indexes) {
              store.createIndex(index.name, index.keyPath, {
                unique: index.unique,
                multiEntry: index.multiEntry,
              })
            }
            for (const row of data[definition.name] ?? []) store.add(row)
          }
        }
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
    },
    { name: DEVICE_DATABASE, idbVersion: version * 10, definitions, data: rows },
  )
  return rows
}

/**
 * Tente la montée de version `version` → `version + 1`… puis la COUPE au milieu de la migration (la transaction
 * `versionchange` est annulée après la création de la première table). Rend la version et les tables de la base après
 * la coupure : le navigateur doit avoir tout annulé.
 */
export async function interruptedUpgrade(
  page: Page,
  toVersion: number,
): Promise<{ version: number; stores: string[]; error: string | null }> {
  const definitions = storeDefinitions(toVersion)
  return page.evaluate(
    async ({ name, idbVersion, stores }) => {
      const error = await new Promise<string | null>((resolve) => {
        const request = indexedDB.open(name, idbVersion)
        request.onupgradeneeded = () => {
          const first = stores.find(
            (definition) => !request.result.objectStoreNames.contains(definition.name),
          )
          if (first !== undefined) request.result.createObjectStore(first.name, { keyPath: 'x' })
          // Coupure au milieu de la migration : tout ce qui vient d'être créé est annulé.
          request.transaction?.abort()
        }
        request.onsuccess = () => {
          request.result.close()
          resolve(null)
        }
        request.onerror = () => resolve(request.error?.name ?? 'erreur')
      })
      const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const state = {
        version: reopened.version,
        stores: Array.from(reopened.objectStoreNames).sort(),
        error,
      }
      reopened.close()
      return state
    },
    { name: DEVICE_DATABASE, idbVersion: toVersion * 10, stores: definitions },
  )
}

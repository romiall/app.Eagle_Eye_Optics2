// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { openOfflineVault, vaultDatabaseExists } from '@/offline/api'
import { VAULT_DB_NAME, VaultDatabase } from '@/offline/vault/db'

/**
 * Détection du coffre au démarrage et résumé du cabinet retenu (vault.md D27) : la décision « un coffre existe ici »
 * se prend sans ouvrir ni créer la base ; le résumé lu à la dernière session du serveur sert à ouvrir une session
 * locale quand le serveur est injoignable, et une valeur altérée est ignorée, jamais crue. Données fictives.
 */
const SUMMARY = {
  id: '01J9ZXK4M2Q8R7S6T5V4W30003',
  name: 'TEST CABINET FICTIF',
  timezone: 'Africa/Douala',
  currency: 'XAF' as const,
  production_documents_enabled: false,
  enabled_modules: ['patients', 'sales', 'offline'],
  exam_fee_control: 'BILLED' as const,
}

describe('détection du coffre sans le créer', () => {
  it('une base absente est reconnue comme telle, sans rien créer', async () => {
    const factory = new IDBFactory()

    expect(await vaultDatabaseExists(factory)).toBe(false)
    expect(await vaultDatabaseExists(factory)).toBe(false)
    expect((await factory.databases()).map((database) => database.name)).toEqual([])
  })

  it('une base présente est reconnue ; un autre nom de base ne compte pas', async () => {
    const factory = new IDBFactory()
    const vault = openOfflineVault({ indexedDB: factory, keyRange: IDBKeyRange })
    await vault.noteClinic(SUMMARY)

    expect(await vaultDatabaseExists(factory)).toBe(true)
    expect(await vaultDatabaseExists(factory, 'autre-base')).toBe(false)
    vault.dispose()
  })

  it('un navigateur qui ne sait pas lister ses bases répond non (le flux d’avant s’applique)', async () => {
    const withoutList = { databases: undefined } as unknown as IDBFactory

    expect(await vaultDatabaseExists(withoutList)).toBe(false)
    expect(await vaultDatabaseExists(undefined)).toBe(false)
    const failing = {
      databases: () => Promise.reject(new Error('refusé')),
    } as unknown as IDBFactory
    expect(await vaultDatabaseExists(failing)).toBe(false)
  })
})

describe('résumé du cabinet retenu dans le coffre', () => {
  it('est relu tel qu’il a été retenu, même coffre verrouillé', async () => {
    const factory = new IDBFactory()
    const vault = openOfflineVault({ indexedDB: factory, keyRange: IDBKeyRange })

    expect(await vault.clinic()).toBeNull()
    await vault.noteClinic(SUMMARY)

    expect(await vault.clinic()).toEqual(SUMMARY)
    vault.dispose()
  })

  it('ne retient jamais plus que le résumé : une valeur altérée est ignorée', async () => {
    const factory = new IDBFactory()
    const vault = openOfflineVault({ indexedDB: factory, keyRange: IDBKeyRange })
    await vault.noteClinic(SUMMARY)
    const raw = new VaultDatabase(VAULT_DB_NAME, { indexedDB: factory, IDBKeyRange })

    for (const altered of [
      { ...SUMMARY, id: '' },
      { ...SUMMARY, name: 42 },
      { ...SUMMARY, timezone: undefined },
      { ...SUMMARY, enabled_modules: 'patients' },
      { ...SUMMARY, enabled_modules: ['patients', 7] },
      { ...SUMMARY, production_documents_enabled: 'oui' },
      'pas un objet',
      ['liste'],
    ]) {
      await raw.vault_meta.put({ key: 'clinic_summary', value: altered })
      expect(await vault.clinic()).toBeNull()
    }
    // Contrôle de fraîcheur du contrôle : une valeur saine est de nouveau lue.
    await raw.vault_meta.put({ key: 'clinic_summary', value: SUMMARY })
    expect((await vault.clinic())?.enabled_modules).toEqual(['patients', 'sales', 'offline'])
    raw.close()
    vault.dispose()
  })

  it('une consigne de contrôle des frais d’examen absente (serveur plus ancien) retombe sur « OFF »', async () => {
    const factory = new IDBFactory()
    const vault = openOfflineVault({ indexedDB: factory, keyRange: IDBKeyRange })
    const raw = new VaultDatabase(VAULT_DB_NAME, { indexedDB: factory, IDBKeyRange })
    const withoutControl = Object.fromEntries(
      Object.entries(SUMMARY).filter(([key]) => key !== 'exam_fee_control'),
    )
    await raw.vault_meta.put({ key: 'clinic_summary', value: withoutControl })

    expect((await vault.clinic())?.exam_fee_control).toBe('OFF')
    raw.close()
    vault.dispose()
  })
})

import { type LocalCatalog, readLocalCatalog } from '@/domain/billing/localCatalog'

import { localCatalogSnapshot } from './vault'

export type { LocalCatalog } from '@/domain/billing/localCatalog'

/**
 * Catalogue et règles fiscales FIGÉS de CE poste (remis à sa préparation, jamais de coût d'achat) : null si le module
 * `offline` est fermé, le coffre fermé, le compartiment administratif fermé pour la session, ou le catalogue jamais
 * remis. Lecture seule, jamais le réseau.
 */
export async function localCatalog(): Promise<LocalCatalog | null> {
  return readLocalCatalog(await localCatalogSnapshot())
}

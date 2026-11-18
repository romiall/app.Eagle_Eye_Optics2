import { computed } from 'vue'

import { searchCatalog } from '@/app/services/billing'
import type { ReadOutcome } from '@/app/services/reads'
import type { CatalogItem } from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Charge l'ensemble des articles du catalogue en paginant (jusqu'à `maxPages` × 25 articles)
 * pour éviter la troncature des listes déroulantes et libellés en stock / showroom.
 */
export async function loadAllCatalogItems(maxPages = 20): Promise<ReadOutcome<CatalogItem[]>> {
  const items: CatalogItem[] = []
  let last = 1
  let freshness: ReadOutcome<CatalogItem[]>['freshness'] = { serverAsOf: null, complete: false }
  for (let current = 1; current <= Math.min(last, maxPages); current += 1) {
    const result = await searchCatalog('', current)
    items.push(...result.data.data)
    last = result.data.meta.last_page
    freshness = { serverAsOf: result.freshness.serverAsOf, complete: last <= maxPages }
  }
  return { data: items, freshness, live: true }
}

/**
 * Articles du catalogue pour les écrans d'achats et d'inventaire (lecture du serveur) : la table par identifiant, et
 * les articles actifs gérés en stock (seuls ceux-ci se reçoivent et se comptent).
 */
export function useCatalogItems() {
  const read = useServerRead<CatalogItem[]>(() => loadAllCatalogItems())
  const items = computed(() => new Map((read.data.value ?? []).map((item) => [item.id, item])))
  const stocked = computed(() =>
    (read.data.value ?? []).filter((item) => item.stock_mode === 'STOCKED' && item.active),
  )
  function name(id: string): string {
    const item = items.value.get(id)
    return item === undefined ? `Article …${id.slice(-6)}` : `${item.name} (${item.reference})`
  }
  return { read, items, stocked, name }
}

<script setup lang="ts">
/**
 * Choix d'un article du catalogue pour une ligne de facture (B01, B02 ; fichier 04 : « sélection du
 * catalogue avec flèches/Entrée »). Recherche serveur (référence, nom, marque ou modèle, 2 caractères
 * au moins), articles actifs seulement. Chaque résultat dit sa référence, son prix de vente et son mode
 * de stock ; une recherche impossible est « indisponible », jamais « aucun article ». Après un choix, le
 * champ se vide pour l'article suivant.
 */
import { nextTick, ref } from 'vue'

import { searchCatalog } from '@/app/services/billing'
import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'
import { stockModeLabel } from '@/domain/billing/catalog'
import type { CatalogItem } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

const props = withDefaults(defineProps<{ controlId?: string; disabled?: boolean }>(), {
  controlId: 'facture-catalogue',
  disabled: false,
})

const emit = defineEmits<{ pick: [item: CatalogItem] }>()

const known = new Map<string, CatalogItem>()
const generation = ref(0)
const value = ref<string | null>(null)

async function search(query: string): Promise<ComboboxSearchResult> {
  // Serveur injoignable : le catalogue FIGÉ du poste répond (articles actifs, prix de la préparation du poste).
  const result = await searchCatalog(query, 1, { includeLocal: true })
  const options: ComboboxOption[] = []
  for (const item of result.data.data) {
    if (!item.active) continue
    known.set(item.id, item)
    options.push({
      value: item.id,
      label: item.name,
      description: `${item.reference} · ${formatMoney(item.sale_price)} · ${stockModeLabel(item.stock_mode)}`,
    })
  }
  const meta = result.data.meta
  const notices: string[] = []
  if (result.freshness.serverAsOf === null) {
    notices.push(
      'Catalogue de ce poste (serveur non consulté) : articles et prix de la préparation du poste.',
    )
  }
  if (meta.last_page > 1)
    notices.push(`${meta.total} articles correspondent : précisez la recherche.`)
  return notices.length > 0 ? { options, notice: notices.join(' ') } : options
}

function onSelect(option: ComboboxOption | null): void {
  if (option === null) return
  const item = known.get(option.value)
  if (item === undefined) return
  emit('pick', item)
  // Nouveau champ vide pour l'article suivant ; le focus y reste (saisie au clavier enchaînée).
  value.value = null
  generation.value += 1
  void nextTick(() => document.getElementById(props.controlId)?.focus())
}
</script>

<template>
  <ComboboxField
    :key="generation"
    v-model="value"
    label="Ajouter un article du catalogue"
    hint="Référence, nom, marque ou modèle (2 caractères au moins) ; flèches pour parcourir, Entrée pour ajouter."
    :search="search"
    :control-id="props.controlId"
    :disabled="props.disabled"
    unavailable-text="Catalogue indisponible : rien n’est conclu sur l’existence d’un article."
    @select="onSelect"
  />
</template>

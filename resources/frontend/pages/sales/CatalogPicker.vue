<script setup lang="ts">
/**
 * Choix d'un article du catalogue pour une ligne de facture ou de devis (B01, B02 ; fichier 04 :
 * « sélection du catalogue avec flèches/Entrée »). Au clic dans le champ vide, la liste du catalogue
 * s'ouvre aussitôt (jusqu'à 10 lignes visibles, déroulables du début à la fin) ; dès 2 caractères saisis,
 * la recherche filtre les articles actifs (référence, nom, marque ou modèle). En hors ligne, le catalogue
 * figé du poste répond. Après un choix, le champ se vide sans rouvrir aussitôt la liste.
 */
import { ref } from 'vue'

import { searchCatalog } from '@/app/services/billing'
import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'
import { stockModeLabel } from '@/domain/billing/catalog'
import type { CatalogItem } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

const BROWSE_MAX_PAGES = 8

const props = withDefaults(defineProps<{ controlId?: string; disabled?: boolean }>(), {
  controlId: 'facture-catalogue',
  disabled: false,
})

const emit = defineEmits<{ pick: [item: CatalogItem] }>()

const known = new Map<string, CatalogItem>()
const comboboxRef = ref<InstanceType<typeof ComboboxField> | null>(null)
const value = ref<string | null>(null)

async function search(query: string): Promise<ComboboxSearchResult> {
  // Serveur injoignable : le catalogue FIGÉ du poste répond (articles actifs, prix de la préparation du poste).
  const first = await searchCatalog(query, 1, { includeLocal: true })
  const items: CatalogItem[] = [...first.data.data]
  const meta = first.data.meta
  const isEmptyBrowse = query.trim() === ''
  let usedLocal = first.freshness.serverAsOf === null

  if (isEmptyBrowse && meta.last_page > 1) {
    const limitPage = Math.min(meta.last_page, BROWSE_MAX_PAGES)
    const rest = await Promise.all(
      Array.from({ length: limitPage - 1 }, (_, index) =>
        searchCatalog('', index + 2, { includeLocal: true }),
      ),
    )
    for (const page of rest) {
      items.push(...page.data.data)
      if (page.freshness.serverAsOf === null) usedLocal = true
    }
  }

  const options: ComboboxOption[] = []
  for (const item of items) {
    if (!item.active) continue
    known.set(item.id, item)
    options.push({
      value: item.id,
      label: item.name,
      description: `${item.reference} · ${formatMoney(item.sale_price)} · ${stockModeLabel(item.stock_mode)}`,
    })
  }

  const notices: string[] = []
  if (usedLocal) {
    notices.push(
      'Catalogue de ce poste (serveur non consulté) : articles et prix de la préparation du poste.',
    )
  }
  if (isEmptyBrowse && meta.last_page > BROWSE_MAX_PAGES) {
    notices.push(
      `${meta.total} articles au catalogue : saisissez au moins 2 caractères pour filtrer.`,
    )
  } else if (!isEmptyBrowse && meta.last_page > 1) {
    notices.push(`${meta.total} articles correspondent : précisez la recherche.`)
  }
  return notices.length > 0 ? { options, notice: notices.join(' ') } : options
}

function onSelect(option: ComboboxOption | null): void {
  if (option === null) return
  const item = known.get(option.value)
  if (item === undefined) return
  emit('pick', item)
  // Nouveau champ vide pour l'article suivant sans rouvrir aussitôt la liste ; le focus y reste (saisie au clavier enchaînée).
  value.value = null
  comboboxRef.value?.reset({ focus: true })
}
</script>

<template>
  <ComboboxField
    ref="comboboxRef"
    v-model="value"
    label="Ajouter un article du catalogue"
    placeholder="Cliquer pour choisir ou rechercher un article…"
    hint="Cliquez pour dérouler la liste ou saisissez référence, nom, marque ou modèle (2 caractères au moins) ; flèches pour parcourir, Entrée pour ajouter."
    browse-on-empty
    list-max-height-class="max-h-[min(37.5rem,60vh)]"
    :search="search"
    :control-id="props.controlId"
    :disabled="props.disabled"
    unavailable-text="Catalogue indisponible : rien n’est conclu sur l’existence d’un article."
    @select="onSelect"
  />
</template>

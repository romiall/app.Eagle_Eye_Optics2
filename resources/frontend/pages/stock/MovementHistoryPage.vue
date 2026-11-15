<script setup lang="ts">
/**
 * Historique des mouvements de stock d'un article (cahier des charges §6 : « consultable à tout moment », EE026), module
 * « stock », EN LIGNE, droit `stock.read`. L'article se choisit ici (ou arrive par l'adresse `?article=`, depuis la
 * liste du stock) ; la liste de ses mouvements est un composant à part, monté une fois l'article connu.
 * Les mouvements ne se modifient ni ne se suppriment : une erreur se corrige par un mouvement contraire, motivé.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { isUlid } from '@/domain/values/ulid'
import { useCatalogItems } from '@/pages/purchasing/useCatalogItems'

import MovementList from './MovementList.vue'

const route = useRoute()
const router = useRouter()
const catalog = useCatalogItems()

const itemId = computed<string | null>(() => {
  const value = route.query.article
  return typeof value === 'string' && isUlid(value) ? value : null
})
const itemOptions = computed(() => [
  { value: '', label: 'Choisissez un article' },
  ...catalog.stocked.value.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.reference})`,
  })),
  // Un article arrivé par l'adresse mais absent de la liste lue (au-delà des pages du catalogue) reste choisi.
  ...(itemId.value !== null && !catalog.stocked.value.some((item) => item.id === itemId.value)
    ? [{ value: itemId.value, label: catalog.name(itemId.value) }]
    : []),
])

function chooseItem(value: string | null): void {
  void router.replace({ name: 'stock-history', query: value ? { article: value } : {} })
}
</script>

<template>
  <section aria-labelledby="titre-historique" class="max-w-3xl space-y-6">
    <h1 id="titre-historique" class="text-2xl font-semibold tracking-tight">
      Historique des mouvements de stock
    </h1>
    <p class="max-w-prose text-base text-muted">
      Tout ce qui a fait entrer ou sortir un article : réceptions, remises aux patients, retours,
      casse, ajustements d’inventaire. Un mouvement ne se modifie jamais : une erreur se corrige par
      un mouvement contraire, avec son motif.
    </p>
    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>
    </div>

    <SelectField
      :model-value="itemId ?? ''"
      label="Article"
      :options="itemOptions"
      control-id="historique-article"
      @update:model-value="chooseItem"
    />

    <MovementList v-if="itemId !== null" :key="itemId" :item-id="itemId" />
    <StateMessage v-else state="empty" title="Aucun article choisi">
      Choisissez un article pour lire son historique.
    </StateMessage>
  </section>
</template>

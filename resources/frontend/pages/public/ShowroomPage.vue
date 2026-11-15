<script setup lang="ts">
/**
 * Showroom public (L3D02, L3D03), SANS compte, EN LIGNE : les références que la gérante a PUBLIÉES, avec leurs images
 * approuvées. Jamais de coût d'achat, de stock ni de référence interne ; le prix n'apparaît que si la gérante l'a
 * montré. La disponibilité n'est pas affichée : elle se demande au cabinet. Filtres par style et par marque, pagination
 * côté serveur. Données de démonstration FICTIVES seulement.
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { listShowroom, listSiteContents } from '@/app/services/publicSite'
import { useRead } from '@/app/services/reads'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type { PublicContent, ShowroomPage as ShowroomPageData } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

import PublicContents from './PublicContents.vue'
import PublicNav from './PublicNav.vue'
import PublicReadMessage from './PublicReadMessage.vue'

const style = ref<string | null>(null)
const brand = ref<string | null>(null)
const currentPage = ref(1)

const read = useRead<ShowroomPageData>(
  () => listShowroom({ style: style.value, brand: brand.value, page: currentPage.value }),
  { isEmpty: (page) => page.data.length === 0 },
)
const contentsRead = useRead<PublicContent[]>(() => listSiteContents())

const items = computed(() => read.data.value?.data ?? [])
const styleOptions = computed(() =>
  (read.data.value?.facets.styles ?? []).map((value) => ({ value, label: value })),
)
const brandOptions = computed(() =>
  (read.data.value?.facets.brands ?? []).map((value) => ({ value, label: value })),
)
/** Le message d'état remplace la liste sauf pendant une relecture (la liste lue reste affichée). */
const showMessage = computed(() => {
  const state = read.state.value
  if (state === 'ready' || state === 'empty') return false
  return !(state === 'loading' && read.data.value !== null)
})

function changeStyle(value: string | null): void {
  style.value = value
  currentPage.value = 1
  void read.reload()
}

function changeBrand(value: string | null): void {
  brand.value = value
  currentPage.value = 1
  void read.reload()
}

function goPage(page: number): void {
  currentPage.value = page
  void read.reload()
}

function subtitle(item: { brand: string | null; style: string | null }): string {
  return [item.brand, item.style].filter((part): part is string => part !== null && part !== '').join(' · ')
}
</script>

<template>
  <section aria-labelledby="titre-showroom" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-showroom"
      title="Showroom"
      subtitle="Les références présentées par le cabinet. La disponibilité ne figure pas ici : demandez-la au cabinet ou prenez rendez-vous pour les essayer."
      icon="glasses"
      eyebrow="Cabinet d’optique"
    />
    <PublicNav />

    <PublicContents
      v-if="contentsRead.data.value"
      :contents="contentsRead.data.value"
      :codes="['ACCUEIL', 'EXPERTISES']"
      heading="Bienvenue"
      title-id="titre-bienvenue"
    />

    <section aria-labelledby="titre-references" class="space-y-4">
      <h2 id="titre-references" class="text-xl font-semibold">Nos références</h2>
      <div v-if="styleOptions.length > 0 || brandOptions.length > 0" class="flex flex-wrap gap-3">
        <div v-if="styleOptions.length > 0" class="w-full max-w-xs">
          <SelectField
            :model-value="style"
            label="Style"
            placeholder="Tous les styles"
            :options="styleOptions"
            control-id="showroom-style"
            @update:model-value="changeStyle"
          />
        </div>
        <div v-if="brandOptions.length > 0" class="w-full max-w-xs">
          <SelectField
            :model-value="brand"
            label="Marque"
            placeholder="Toutes les marques"
            :options="brandOptions"
            control-id="showroom-marque"
            @update:model-value="changeBrand"
          />
        </div>
      </div>

      <PublicReadMessage
        v-if="showMessage"
        :state="read.state.value"
        subject="les références du showroom"
        :error="read.error.value"
        @retry="read.reload()"
      />
      <StateMessage
        v-else-if="read.state.value === 'empty'"
        state="empty"
        title="Aucune référence à afficher"
      >
        Aucune référence ne correspond pour le moment. Revenez bientôt, ou prenez rendez-vous
        pour découvrir la sélection du cabinet.
      </StateMessage>
      <ul v-else role="list" class="card-grid sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="item in items" :key="item.slug" class="min-w-0">
          <article class="card h-full overflow-hidden">
            <img
              v-if="item.media[0]"
              :src="item.media[0].url"
              :alt="item.media[0].alt"
              loading="lazy"
              width="480"
              height="320"
              class="aspect-[3/2] w-full object-cover"
            />
            <div
              v-else
              aria-hidden="true"
              class="flex aspect-[3/2] w-full items-center justify-center bg-canvas text-muted"
            >
              <AppIcon name="glasses" :size="40" />
            </div>
            <div class="space-y-1 p-4">
              <h3 class="text-lg font-semibold break-words">
                <RouterLink
                  :to="{ name: 'public-showroom-item', params: { slug: item.slug } }"
                  class="text-ink hover:text-primary hover:underline hover:underline-offset-4"
                  >{{ item.title }}</RouterLink
                >
              </h3>
              <p v-if="subtitle(item) !== ''" class="text-sm text-muted">{{ subtitle(item) }}</p>
              <p v-if="item.price !== null" class="font-semibold tabular-nums">
                {{ formatMoney(item.price) }}
              </p>
            </div>
          </article>
        </li>
      </ul>
      <PaginationControls
        v-if="read.data.value"
        :current-page="read.data.value.meta.current_page"
        :last-page="read.data.value.meta.last_page"
        :total="read.data.value.meta.total"
        :busy="read.state.value === 'loading'"
        unit="références"
        label="Pagination du showroom"
        @page="goPage"
      />
    </section>

    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'public-booking' }" variant="primary"
        >Prendre rendez-vous</LinkButton
      >
    </div>

    <PublicContents
      v-if="contentsRead.data.value"
      :contents="contentsRead.data.value"
      :codes="['HORAIRES', 'LOCALISATION', 'CONTACT', 'WHATSAPP', 'RESEAUX_SOCIAUX']"
      heading="Nous trouver"
      title-id="titre-nous-trouver"
    />
  </section>
</template>

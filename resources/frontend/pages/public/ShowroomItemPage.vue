<script setup lang="ts">
/**
 * Fiche publique d'une référence du showroom (L3D02, L3D03), SANS compte, EN LIGNE : titre, description, images
 * approuvées et, si la gérante l'a décidé, le prix. Une référence non publiée, retirée ou dont l'article n'est plus
 * visible est « introuvable » : le serveur répond 404 et la page ne devine rien. Le bouton de prise de rendez-vous
 * emporte l'adresse de la fiche, que la demande garde (jamais une donnée de santé). Données FICTIVES seulement.
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getShowroomItem } from '@/app/services/publicSite'
import { useRead } from '@/app/services/reads'
import StateMessage from '@/components/feedback/StateMessage.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { ShowroomItem } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

import PublicNav from './PublicNav.vue'
import PublicReadMessage from './PublicReadMessage.vue'

const route = useRoute()
const slug = computed(() => String(route.params['slug'] ?? ''))
const read = useRead<ShowroomItem>(() => getShowroomItem(slug.value))

watch(slug, () => void read.reload())

const item = computed(() => read.data.value)
const notFound = computed(
  () => read.state.value === 'error' && read.error.value?.status === 404,
)
const subtitle = computed(() =>
  [item.value?.brand, item.value?.style]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(' · '),
)
</script>

<template>
  <section aria-labelledby="titre-reference" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-reference"
      :title="item?.title ?? 'Référence du showroom'"
      :subtitle="subtitle === '' ? undefined : subtitle"
      icon="glasses"
      eyebrow="Showroom"
    />
    <PublicNav />

    <StateMessage v-if="notFound" state="empty" title="Référence introuvable">
      Cette référence n’est pas (ou plus) présentée par le cabinet.
      <template #action>
        <LinkButton :to="{ name: 'public-showroom' }" variant="secondary"
          >Retour au showroom</LinkButton
        >
      </template>
    </StateMessage>
    <PublicReadMessage
      v-else-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="cette référence"
      :error="read.error.value"
      @retry="read.reload()"
    />
    <article v-else-if="item" class="space-y-4">
      <ul v-if="item.media.length > 0" role="list" class="grid gap-3 sm:grid-cols-2">
        <li v-for="media in item.media" :key="media.url" class="min-w-0">
          <img
            :src="media.url"
            :alt="media.alt"
            width="640"
            height="480"
            class="aspect-[4/3] w-full rounded-xl border border-line object-cover"
          />
        </li>
      </ul>
      <p class="max-w-prose text-base break-words whitespace-pre-line">{{ item.description }}</p>
      <p v-if="item.price !== null" class="text-lg font-semibold tabular-nums">
        {{ formatMoney(item.price) }}
      </p>
      <p v-else class="text-sm text-muted">Prix communiqué par le cabinet.</p>
      <p class="max-w-prose text-sm text-muted">
        La disponibilité n’est pas affichée : demandez-la au cabinet ou prenez rendez-vous pour
        essayer cette référence.
      </p>
      <div class="flex flex-wrap gap-3">
        <LinkButton :to="{ name: 'public-booking', query: { fiche: item.slug } }" variant="primary"
          >Essayer ce modèle</LinkButton
        >
        <LinkButton :to="{ name: 'public-showroom' }" variant="ghost">Retour au showroom</LinkButton>
      </div>
    </article>
  </section>
</template>

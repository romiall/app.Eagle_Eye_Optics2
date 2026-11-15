<script setup lang="ts">
/**
 * Informations publiées du cabinet (horaires, localisation, contact…), telles que la gérante les a approuvées : du texte
 * seul, jamais du HTML ni un lien deviné dans le texte. Le seul lien est celui du numéro WhatsApp, construit par le
 * serveur (https://wa.me/<numéro>) : l'application n'envoie aucun message, le visiteur ouvre sa propre conversation.
 */
import { computed } from 'vue'

import type { PublicContent } from '@/domain/contracts/generated'

const props = withDefaults(
  defineProps<{
    contents: readonly PublicContent[]
    /** Codes montrés, dans cet ordre ; absent : tous. */
    codes?: readonly string[] | undefined
    titleId?: string
    heading?: string
  }>(),
  { codes: undefined, titleId: 'titre-informations', heading: 'Le cabinet' },
)

const shown = computed(() => {
  const wanted = props.codes
  if (wanted === undefined) return [...props.contents]
  return wanted
    .map((code) => props.contents.find((entry) => entry.code === code))
    .filter((entry): entry is PublicContent => entry !== undefined)
})
</script>

<template>
  <section v-if="shown.length > 0" :aria-labelledby="props.titleId" class="card space-y-3 p-4 sm:p-6">
    <h2 :id="props.titleId" class="text-lg font-semibold">{{ props.heading }}</h2>
    <dl class="space-y-3">
      <div v-for="entry in shown" :key="entry.code" class="space-y-1">
        <dt class="font-semibold break-words">{{ entry.title }}</dt>
        <dd class="text-base break-words whitespace-pre-line text-muted">
          <a
            v-if="entry.code === 'WHATSAPP' && entry.whatsapp_url"
            :href="entry.whatsapp_url"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary underline underline-offset-4"
            >Ouvrir une conversation WhatsApp</a
          >
          <template v-else>{{ entry.content }}</template>
        </dd>
      </div>
    </dl>
  </section>
</template>

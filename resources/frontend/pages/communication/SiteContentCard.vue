<script setup lang="ts">
/**
 * Un contenu public côté gérante (L3D02) : la version publiée (ce que voit le public) et le brouillon en cours. Écrire
 * enregistre un BROUILLON ; la publication est une décision de la gérante, confirmée par le mot de passe, qui archive
 * l'ancienne version. Le composant ne parle pas au serveur : il émet, la page décide.
 */
import { computed, ref } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { PublicContentEntry } from '@/domain/contracts/generated'
import { type ContentErrors, hasErrors, validateContent, whatsappDigits } from '@/domain/site/site'

const props = defineProps<{ entry: PublicContentEntry; busy: boolean }>()
const emit = defineEmits<{
  save: [payload: { title: string; content: string }]
  publish: []
  archive: []
}>()

const source = computed(() => props.entry.draft ?? props.entry.published)
const title = ref(source.value?.title ?? props.entry.label)
const content = ref(source.value?.content ?? '')
const errors = ref<ContentErrors>({})
const isWhatsapp = computed(() => props.entry.code === 'WHATSAPP')
const whatsappLink = computed(() => {
  const digits = whatsappDigits(content.value)
  return isWhatsapp.value && digits !== null ? `https://wa.me/${digits}` : null
})

function save(): void {
  errors.value = validateContent(props.entry.code, { title: title.value, content: content.value })
  if (hasErrors(errors.value)) return
  emit('save', { title: title.value, content: content.value })
}
</script>

<template>
  <li class="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <p class="text-lg font-semibold">{{ entry.label }}</p>
      <p class="text-sm font-medium" :class="entry.published ? 'text-success' : 'text-muted'">
        <template v-if="entry.published"
          >Publié depuis le
          {{
            entry.published.published_at ? formatInstantFr(entry.published.published_at) : '—'
          }}</template
        >
        <template v-else>Rien de publié</template>
      </p>
    </div>
    <p v-if="entry.published" class="text-sm break-words whitespace-pre-line text-muted">
      Vu du public : {{ entry.published.content }}
    </p>
    <p v-if="entry.draft" class="text-sm font-medium text-warning">
      Un brouillon est en cours : il n’est pas visible du public tant que vous ne le publiez pas.
    </p>

    <form class="space-y-2" @submit.prevent="save">
      <TextField
        v-model="title"
        label="Titre"
        :error="errors.title ?? null"
        :control-id="`contenu-titre-${entry.code}`"
        :maxlength="180"
      />
      <TextAreaField
        v-model="content"
        :label="isWhatsapp ? 'Numéro WhatsApp (avec l’indicatif du pays)' : 'Texte'"
        :error="errors.content ?? null"
        :control-id="`contenu-texte-${entry.code}`"
        :rows="isWhatsapp ? 1 : 4"
        :maxlength="4000"
      />
      <p v-if="whatsappLink" class="text-sm text-muted">
        Lien proposé au public : <span class="font-medium">{{ whatsappLink }}</span>
      </p>
      <div class="flex flex-wrap gap-3">
        <AppButton
          type="submit"
          variant="secondary"
          :disabled="busy"
          :accessible-name="`Enregistrer le brouillon de ${entry.label}`"
          >Enregistrer le brouillon</AppButton
        >
        <AppButton
          v-if="entry.draft"
          variant="primary"
          :disabled="busy"
          :accessible-name="`Publier le brouillon de ${entry.label}`"
          @click="emit('publish')"
          >Publier le brouillon</AppButton
        >
        <AppButton
          v-if="entry.published"
          variant="ghost"
          :disabled="busy"
          :accessible-name="`Retirer du site ${entry.label}`"
          @click="emit('archive')"
          >Retirer du site</AppButton
        >
      </div>
    </form>
  </li>
</template>

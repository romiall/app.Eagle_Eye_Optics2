<script setup lang="ts">
/**
 * Une fiche du showroom côté gérante (L3D02) : son état, ses images (avec texte alternatif et note de droits) et les
 * décisions qui lui reviennent. Publier, retirer et archiver sont des décisions de la gérante, confirmées par le mot de
 * passe ; l'image se dépose avec sa note de droits. Le composant ne parle pas au serveur : il émet, la page décide.
 */
import { computed, ref } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { publicationMediaUrl } from '@/app/services/publications'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { Publication } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'
import {
  hasErrors,
  MEDIA_TYPES,
  type MediaErrors,
  PUBLICATION_STATUS_LABELS,
  validateMedia,
} from '@/domain/site/site'

const props = defineProps<{ publication: Publication; busy: boolean }>()
const emit = defineEmits<{
  edit: []
  status: [status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED']
  upload: [payload: { file: File; alt: string; rights: string; order: number; done: () => void }]
  remove: [mediaId: string]
}>()

const file = ref<File | null>(null)
const alt = ref('')
const rights = ref('')
const order = ref('0')
const errors = ref<MediaErrors>({})
const fileKey = ref(0)

const published = computed(() => props.publication.status === 'PUBLISHED')
const statusOptions = computed(() =>
  props.publication.status === 'ARCHIVED'
    ? [{ value: 'DRAFT', label: 'Remettre en brouillon' }]
    : [
        ...(props.publication.status === 'DRAFT'
          ? [{ value: 'PUBLISHED', label: 'Publier sur le site' }]
          : [{ value: 'DRAFT', label: 'Retirer du site (brouillon)' }]),
        { value: 'ARCHIVED', label: 'Archiver' },
      ],
)
const chosenStatus = ref<string | null>(null)

function pickFile(event: Event): void {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
}

/** Vide le formulaire d'image : la page l'appelle seulement quand le serveur a ACCEPTÉ l'image (sinon la saisie reste). */
function resetMediaForm(): void {
  file.value = null
  alt.value = ''
  rights.value = ''
  order.value = '0'
  errors.value = {}
  fileKey.value += 1
}

function submitMedia(): void {
  errors.value = validateMedia(file.value, alt.value, rights.value)
  if (hasErrors(errors.value) || file.value === null) return
  const parsed = Number.parseInt(order.value.trim(), 10)
  emit('upload', {
    file: file.value,
    alt: alt.value,
    rights: rights.value,
    order: Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9999 ? parsed : 0,
    done: resetMediaForm,
  })
}

function applyStatus(): void {
  if (chosenStatus.value === null) return
  emit('status', chosenStatus.value as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED')
  chosenStatus.value = null
}
</script>

<template>
  <li class="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <p class="text-lg font-semibold break-words">{{ publication.public_title }}</p>
      <p class="text-sm font-medium" :class="published ? 'text-success' : 'text-muted'">
        {{ PUBLICATION_STATUS_LABELS[publication.status] }}
        <template v-if="publication.published_at">
          depuis le {{ formatInstantFr(publication.published_at) }}</template
        >
      </p>
    </div>
    <p class="text-sm text-muted break-words">
      Article du catalogue : {{ publication.item_name }} ({{ publication.item_reference }}) ·
      adresse « {{ publication.slug }} »
      <template v-if="publication.style"> · style {{ publication.style }}</template>
    </p>
    <p class="text-sm break-words">{{ publication.public_description }}</p>
    <p class="text-sm text-muted">
      <template v-if="publication.show_sale_price"
        >Prix montré au public : {{ formatMoney(publication.sale_price) }}</template
      >
      <template v-else>Prix non montré au public.</template>
    </p>
    <p v-if="!publication.item_eligible" class="text-sm font-medium text-danger">
      L’article n’est plus actif ou n’est plus marqué « visible au public » dans le catalogue : la
      fiche ne peut pas être publiée.
    </p>

    <section :aria-label="`Images de ${publication.public_title}`" class="space-y-2">
      <h3 class="text-sm font-semibold">
        Images ({{ publication.media.length }})
        <span class="font-normal text-muted"> — chaque image porte sa note de droits</span>
      </h3>
      <ul v-if="publication.media.length > 0" class="grid gap-3 sm:grid-cols-2">
        <li
          v-for="media in publication.media"
          :key="media.id"
          class="flex gap-3 rounded-lg border border-line p-2"
        >
          <img
            :src="publicationMediaUrl(media.id)"
            :alt="media.alt_text"
            width="96"
            height="96"
            class="size-24 shrink-0 rounded-md object-cover"
          />
          <div class="min-w-0 space-y-1 text-sm">
            <p class="font-medium break-words">{{ media.alt_text }}</p>
            <p class="text-muted break-words">Droits : {{ media.rights_note }}</p>
            <AppButton
              variant="ghost"
              :disabled="busy"
              :accessible-name="`Retirer l’image ${media.alt_text}`"
              @click="emit('remove', media.id)"
              >Retirer l’image</AppButton
            >
          </div>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">Aucune image : le site affichera la fiche sans photo.</p>

      <form class="space-y-2 rounded-lg bg-primary-soft p-3" @submit.prevent="submitMedia">
        <p class="text-sm font-semibold">Ajouter une image</p>
        <div>
          <label class="block text-sm font-medium" :for="`image-${publication.id}`"
            >Fichier (JPEG, PNG ou WebP, 3 Mo au plus)</label
          >
          <input
            :id="`image-${publication.id}`"
            :key="fileKey"
            type="file"
            :accept="MEDIA_TYPES.join(',')"
            class="mt-1 block w-full text-sm"
            @change="pickFile"
          />
          <p v-if="errors.file" class="mt-1 text-sm text-danger">{{ errors.file }}</p>
        </div>
        <TextField
          v-model="alt"
          label="Texte alternatif"
          hint="Décrit l’image pour les lecteurs d’écran."
          :error="errors.alt ?? null"
          :control-id="`alt-${publication.id}`"
          :maxlength="255"
        />
        <TextField
          v-model="rights"
          label="Note de droits"
          hint="Qui a pris ou fourni la photo, et l’autorisation de la publier."
          :error="errors.rights ?? null"
          :control-id="`droits-${publication.id}`"
          :maxlength="1000"
        />
        <TextField
          v-model="order"
          label="Ordre d’affichage"
          inputmode="numeric"
          :control-id="`ordre-image-${publication.id}`"
        />
        <AppButton
          type="submit"
          variant="secondary"
          :disabled="busy"
          :accessible-name="`Déposer l’image pour ${publication.public_title}`"
          >Déposer l’image</AppButton
        >
      </form>
    </section>

    <div class="flex flex-wrap items-end gap-3">
      <AppButton
        variant="secondary"
        :disabled="busy"
        :accessible-name="`Modifier la fiche ${publication.public_title}`"
        @click="emit('edit')"
        >Modifier la fiche</AppButton
      >
      <SelectField
        v-model="chosenStatus"
        :label="`Décision pour ${publication.public_title}`"
        :options="statusOptions"
        :control-id="`decision-${publication.id}`"
      />
      <AppButton
        variant="primary"
        :disabled="busy || chosenStatus === null"
        :accessible-name="`Appliquer la décision pour ${publication.public_title}`"
        @click="applyStatus"
        >Appliquer</AppButton
      >
    </div>
  </li>
</template>

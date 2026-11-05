<script setup lang="ts">
/**
 * Choix « Oui / Non / Non renseigné » (fichier 02 : porte des lunettes, ancienne correction,
 * orientation). Trois boutons radio dans un `fieldset` : « Non renseigné » est un choix explicite
 * (null), distinct de « Non » (false), pour qu'une réponse jamais posée ne devienne jamais un « Non ».
 * Chaque choix est un libellé d'au moins 44 px, navigable aux flèches ; le groupe porte
 * l'identifiant `controlId` (cible d'un résumé d'erreurs, focalisable). Le composant affiche l'état
 * qu'on lui donne et émet la nouvelle valeur.
 */
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    legend: string
    modelValue: boolean | null
    hint?: string | undefined
    error?: string | null
    disabled?: boolean
    controlId?: string | undefined
    yesLabel?: string
    noLabel?: string
    unknownLabel?: string
  }>(),
  {
    hint: undefined,
    error: null,
    disabled: false,
    controlId: undefined,
    yesLabel: 'Oui',
    noLabel: 'Non',
    unknownLabel: 'Non renseigné',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean | null] }>()

const generated = useId()
const id = props.controlId ?? generated
const hintId = `${id}-aide`
const errorId = `${id}-erreur`
const describedBy = computed(
  () =>
    [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') ||
    undefined,
)

const choices = computed(() => [
  { key: 'oui', label: props.yesLabel, value: true },
  { key: 'non', label: props.noLabel, value: false },
  { key: 'non-renseigne', label: props.unknownLabel, value: null },
])
</script>

<template>
  <fieldset :id="id" tabindex="-1" :aria-describedby="describedBy" class="min-w-0">
    <legend class="mb-1.5 p-0 text-sm leading-5 font-semibold text-ink">{{ props.legend }}</legend>
    <div class="flex flex-wrap gap-2">
      <label
        v-for="choice in choices"
        :key="choice.key"
        :for="`${id}-${choice.key}`"
        class="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1 text-base text-ink hover:border-primary has-checked:border-gold has-checked:bg-primary-soft has-checked:font-medium has-disabled:cursor-not-allowed has-disabled:bg-disabled"
      >
        <input
          :id="`${id}-${choice.key}`"
          type="radio"
          :name="id"
          class="size-6 shrink-0 accent-primary"
          :checked="props.modelValue === choice.value"
          :disabled="props.disabled"
          @change="emit('update:modelValue', choice.value)"
        />
        <span>{{ choice.label }}</span>
      </label>
    </div>
    <p
      v-if="props.error"
      :id="errorId"
      class="mt-1.5 flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
    >
      <span aria-hidden="true" class="shrink-0">⚠ </span><span>{{ props.error }}</span>
    </p>
    <p v-if="props.hint" :id="hintId" class="mt-1.5 text-sm leading-5 text-muted">
      {{ props.hint }}
    </p>
  </fieldset>
</template>

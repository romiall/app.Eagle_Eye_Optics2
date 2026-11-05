<script setup lang="ts">
/**
 * Groupe de cases à cocher (sélection multiple : motifs, antécédents, motifs d'orientation) : un
 * vrai `fieldset` avec sa `legend`, une case par option dans un libellé d'au moins 44 px, l'aide et
 * l'erreur reliées au groupe par aria-describedby. Le groupe porte l'identifiant `controlId` (cible
 * d'un résumé d'erreurs, focalisable) ; chaque case porte `<controlId>-<valeur>`. Une option
 * désactivée l'est pour une raison que l'écran dit (jamais une case grisée sans explication).
 * La fente `option` s'affiche sous une case : précision de « Autre », par exemple. Le composant ne
 * déduit rien : il affiche l'état qu'on lui donne et émet la liste des valeurs cochées.
 */
import { computed, useId } from 'vue'

export interface CheckboxOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    legend: string
    options: readonly CheckboxOption[]
    modelValue: readonly string[]
    hint?: string | undefined
    error?: string | null
    disabled?: boolean
    controlId?: string | undefined
  }>(),
  { hint: undefined, error: null, disabled: false, controlId: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const generated = useId()
const id = props.controlId ?? generated
const hintId = `${id}-aide`
const errorId = `${id}-erreur`
const describedBy = computed(
  () =>
    [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') ||
    undefined,
)

function boxId(option: CheckboxOption): string {
  return `${id}-${option.value}`
}

function toggle(option: CheckboxOption, checked: boolean): void {
  const others = props.modelValue.filter((value) => value !== option.value)
  emit('update:modelValue', checked ? [...others, option.value] : others)
}
</script>

<template>
  <fieldset :id="id" tabindex="-1" :aria-describedby="describedBy" class="min-w-0">
    <legend class="mb-1.5 p-0 text-sm leading-5 font-semibold text-ink">{{ props.legend }}</legend>
    <ul class="grid gap-2 sm:grid-cols-2">
      <li v-for="option in props.options" :key="option.value">
        <label
          :for="boxId(option)"
          class="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1 text-base text-ink hover:border-primary has-checked:border-gold has-checked:bg-primary-soft has-checked:font-medium has-disabled:cursor-not-allowed has-disabled:bg-disabled"
        >
          <input
            :id="boxId(option)"
            type="checkbox"
            class="size-6 shrink-0 accent-primary"
            :checked="props.modelValue.includes(option.value)"
            :disabled="props.disabled || option.disabled === true"
            @change="toggle(option, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 break-words">{{ option.label }}</span>
        </label>
        <slot name="option" :option="option" :checked="props.modelValue.includes(option.value)" />
      </li>
    </ul>
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

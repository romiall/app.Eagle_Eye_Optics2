<script setup lang="ts">
/**
 * Case à cocher unique (oui / non explicite, jamais « non renseigné ») : libellé d'au moins 44 px qui
 * contient la case, aide et erreur reliées par aria-describedby, état invalide annoncé. Pour un choix à
 * trois états, utiliser `YesNoField` ; pour une liste, `CheckboxGroup`.
 */
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: boolean
    hint?: string | undefined
    error?: string | null
    disabled?: boolean
    controlId?: string | undefined
  }>(),
  { hint: undefined, error: null, disabled: false, controlId: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const generated = useId()
const id = props.controlId ?? generated
const hintId = `${id}-aide`
const errorId = `${id}-erreur`
const describedBy = computed(
  () =>
    [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') ||
    undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="flex min-h-11 items-center gap-2 text-base font-medium text-ink">
      <input
        :id="id"
        type="checkbox"
        class="size-6 shrink-0 accent-primary"
        :checked="props.modelValue"
        :disabled="props.disabled"
        :aria-invalid="props.error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ props.label }}</span>
    </label>
    <p
      v-if="props.error"
      :id="errorId"
      class="flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
    >
      <span aria-hidden="true" class="shrink-0">⚠ </span><span>{{ props.error }}</span>
    </p>
    <p v-if="props.hint" :id="hintId" class="text-sm leading-5 text-muted">{{ props.hint }}</p>
  </div>
</template>

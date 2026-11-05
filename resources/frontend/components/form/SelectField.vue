<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

import { controlClasses } from './classes'
import FieldShell from './FieldShell.vue'

/**
 * Liste native (clavier et lecteurs d'écran natifs) ; l'option vide est explicite et vaut null.
 * La flèche native est remplacée par un chevron de l'interface (`appearance-none` + icône
 * décorative) : même dessin dans tous les navigateurs, teinte de la charte, désactivé lisible.
 */
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string | null
    options: readonly { value: string; label: string }[]
    placeholder?: string | undefined
    hint?: string | undefined
    error?: string | null
    required?: boolean
    disabled?: boolean
    controlId?: string | undefined
  }>(),
  {
    placeholder: 'Choisir…',
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
    controlId: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

function select(value: string): void {
  emit('update:modelValue', value === '' ? null : value)
}
</script>

<template>
  <FieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="props.label"
    :hint="props.hint"
    :error="props.error"
    :required="props.required"
    :control-id="props.controlId"
  >
    <div class="relative">
      <select
        :id="id"
        :value="props.modelValue ?? ''"
        :required="props.required"
        :disabled="props.disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="controlClasses(invalid, 'peer cursor-pointer appearance-none pr-10')"
        @change="select(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ props.placeholder }}</option>
        <option v-for="option in props.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <AppIcon
        name="chevron-down"
        :size="18"
        class="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted peer-disabled:text-disabled-ink"
      />
    </div>
  </FieldShell>
</template>

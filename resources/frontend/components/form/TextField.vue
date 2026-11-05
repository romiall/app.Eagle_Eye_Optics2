<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

import { controlClasses } from './classes'
import FieldShell from './FieldShell.vue'

/**
 * Champ texte : la valeur saisie est conservée telle quelle ; la validation vient des règles.
 * `icon` (nom d'une icône d'`AppIcon`) pose une icône décorative au début du champ (téléphone,
 * recherche) : elle ne remplace jamais le libellé.
 */
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    hint?: string | undefined
    error?: string | null
    required?: boolean
    disabled?: boolean
    type?: 'text' | 'password' | 'email' | 'tel' | 'search'
    autocomplete?: string
    inputmode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search'
    placeholder?: string | undefined
    maxlength?: number | undefined
    hideLabel?: boolean
    controlId?: string | undefined
    icon?: string | undefined
  }>(),
  {
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
    type: 'text',
    autocomplete: 'off',
    inputmode: 'text',
    placeholder: undefined,
    maxlength: undefined,
    hideLabel: false,
    controlId: undefined,
    icon: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()
</script>

<template>
  <FieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="props.label"
    :hint="props.hint"
    :error="props.error"
    :required="props.required"
    :hide-label="props.hideLabel"
    :control-id="props.controlId"
  >
    <div class="relative">
      <input
        :id="id"
        :value="props.modelValue"
        :type="props.type"
        :autocomplete="props.autocomplete"
        :inputmode="props.inputmode"
        :placeholder="props.placeholder"
        :maxlength="props.maxlength"
        :required="props.required"
        :disabled="props.disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="controlClasses(invalid, props.icon ? 'peer pl-10' : 'peer')"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="emit('blur')"
      />
      <AppIcon
        v-if="props.icon"
        :name="props.icon"
        :size="18"
        class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted peer-disabled:text-disabled-ink"
      />
    </div>
  </FieldShell>
</template>

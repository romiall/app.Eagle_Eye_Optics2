<script setup lang="ts">
/**
 * Montant en FCFA entiers (règle F08 : chiffres seuls ou groupes de trois, ni virgule ni point).
 * Lu à la sortie du champ ou à Entrée. Vide → null, jamais 0 ; une saisie refusée est conservée
 * pour correction. L'unité, affichée à droite DANS le champ, est aussi annoncée par les lecteurs
 * d'écran (aria-describedby).
 * `commit()` est exposé pour qu'un formulaire lise le champ avant son envoi.
 */
import { ref, watch } from 'vue'

import { RuleViolation } from '@/domain/errors'
import { parseMoney } from '@/domain/values/money'

import { controlClasses } from './classes'
import FieldShell from './FieldShell.vue'
import { formatAmountInput } from './format'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number | null
    field?: string
    hint?: string | undefined
    error?: string | null
    required?: boolean
    disabled?: boolean
    controlId?: string | undefined
  }>(),
  {
    field: 'amount',
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
    controlId: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | null]; invalid: [rule: string] }>()

const display = (amount: number | null): string =>
  amount === null ? '' : formatAmountInput(amount)
const text = ref(display(props.modelValue))
const localError = ref<string | null>(null)

watch(
  () => props.modelValue,
  (value) => {
    if (localError.value === null) text.value = display(value)
  },
)

/**
 * Saisie refusée : le parent ne garde pas l'ancienne valeur valide, qui partirait sinon à la place
 * de ce que l'écran affiche ; la saisie refusée reste affichée pour être corrigée.
 */
function clearParentValue(): void {
  if (props.modelValue !== null) emit('update:modelValue', null)
}

/** Lit la saisie ; rend false si elle est refusée (le message est alors affiché). */
function commit(): boolean {
  try {
    const amount = parseMoney(text.value, props.field)
    if (amount === null && props.required) {
      localError.value = 'Ce champ est obligatoire.'
      emit('invalid', 'required')
      clearParentValue()
      return false
    }
    localError.value = null
    text.value = display(amount)
    if (amount !== props.modelValue) emit('update:modelValue', amount)
    return true
  } catch (error) {
    if (!(error instanceof RuleViolation)) throw error
    localError.value = error.message
    emit('invalid', error.rule)
    clearParentValue()
    return false
  }
}

function describedWithUnit(describedBy: string | undefined, id: string): string {
  return [describedBy, `${id}-unite`].filter((part) => part !== undefined).join(' ')
}

defineExpose({ commit })
</script>

<template>
  <FieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="props.label"
    :hint="props.hint"
    :error="props.error ?? localError"
    :required="props.required"
    :control-id="props.controlId"
  >
    <div class="relative">
      <input
        :id="id"
        v-model="text"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :required="props.required"
        :disabled="props.disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedWithUnit(describedBy, id)"
        :class="controlClasses(invalid, 'peer pr-15 text-right tabular-nums')"
        @blur="commit"
        @keydown.enter="commit"
      />
      <!-- L'unité est DANS le champ, à droite : la zone de saisie garde la largeur qu'avait le texte
           « FCFA » posé à côté (une colonne de 143 px laisse encore ≈ 69 px aux chiffres). -->
      <span
        :id="`${id}-unite`"
        class="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-muted peer-disabled:text-disabled-ink"
        >FCFA</span
      >
    </div>
  </FieldShell>
</template>

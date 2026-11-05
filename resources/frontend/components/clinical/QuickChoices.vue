<script setup lang="ts">
/**
 * Aide à la saisie : une rangée de boutons qui PROPOSENT des valeurs usuelles (symptômes courants, acuités
 * fréquentes). Un bouton ne fait que remplir ou compléter la saisie à côté : rien n'est enregistré ni coché à
 * l'insu de la personne, et la saisie libre reste toujours possible. Cibles de 44 px, jamais la couleur seule.
 */
import { useId } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Phrase qui dit ce que font les boutons (« Touchez pour ajouter… »). */
    legend: string
    values: readonly string[]
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ pick: [value: string] }>()

const legendId = `${useId()}-aide`
</script>

<template>
  <div v-if="props.values.length > 0" role="group" :aria-labelledby="legendId" class="space-y-1.5">
    <p :id="legendId" class="text-sm font-medium text-muted">{{ props.legend }}</p>
    <ul class="flex flex-wrap gap-2">
      <li v-for="value in props.values" :key="value">
        <button
          type="button"
          :disabled="props.disabled"
          class="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3.5 text-base font-medium text-ink shadow-card hover:border-gold hover:bg-primary-soft disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink"
          @click="emit('pick', value)"
        >
          {{ value }}
        </button>
      </li>
    </ul>
  </div>
</template>

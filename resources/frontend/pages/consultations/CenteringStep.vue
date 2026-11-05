<script setup lang="ts">
/**
 * Étape « Centrage » (C02 ; DP §6 ; fichier 02) : écart pupillaire OBJECTIF mesuré en millimètres, total et/ou
 * monoculaire OD / OG. Tout est facultatif : sans valeur, il n'y a pas de centrage enregistré.
 *
 * Le système NE FABRIQUE PAS une DP monoculaire à partir du total ni l'inverse. La somme OD + OG est PROPOSÉE ;
 * la personne la reporte elle-même dans l'écart total (bouton explicite). Si total, OD et OG sont tous saisis et
 * que la somme diffère du total, une justification est obligatoire (la tolérance du cabinet n'est pas encore
 * fixée : aucune tolérance, toute différence se justifie). Le formulaire est tenu par l'écran ; ce composant
 * affiche les erreurs reçues par identifiant de contrôle.
 */
import { computed } from 'vue'

import ClinicalHint from '@/components/clinical/ClinicalHint.vue'
import MeasureField from '@/components/clinical/MeasureField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { type CenteringDraft, pdMismatch, suggestedSum } from '@/domain/clinical/centering'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import { cleanText, measureText, TEXT_MAX_LENGTH } from '@/domain/clinical/fields'

const model = defineModel<CenteringDraft>({ required: true })
const props = withDefaults(
  defineProps<{ errors: Readonly<Record<string, string>>; disabled?: boolean }>(),
  { disabled: false },
)

function update<K extends keyof CenteringDraft>(key: K, value: CenteringDraft[K]): void {
  model.value = { ...model.value, [key]: value }
}

function error(controlId: string): string | null {
  return props.errors[controlId] ?? null
}

const sum = computed(() => suggestedSum(model.value))
const canProposeSum = computed(() => sum.value !== null && cleanText(model.value.pdTotal) === null)
const mismatch = computed(() => pdMismatch(model.value))
const showReason = computed(() => mismatch.value || cleanText(model.value.reason) !== null)
</script>

<template>
  <div class="space-y-6">
    <ClinicalHint>
      Écart pupillaire objectif, en millimètres. Une case vide est « non mesuré ». Le total et les
      écarts monoculaires sont saisis séparément : aucun n’est calculé à votre place. L’écart total
      du ticket de l’autoréfracteur, saisi à l’étape « Réfraction », apparaît déjà ici.
    </ClinicalHint>

    <SectionCard flat>
      <div class="grid gap-4 sm:grid-cols-3">
        <MeasureField
          :model-value="model.pdTotal"
          label="Écart pupillaire total (mm)"
          :control-id="CONTROL_IDS.pdTotal"
          :error="error(CONTROL_IDS.pdTotal)"
          :disabled="props.disabled"
          @update:model-value="update('pdTotal', $event)"
        />
        <MeasureField
          :model-value="model.pdOd"
          label="Écart pupillaire OD (mm)"
          :control-id="CONTROL_IDS.pdOd"
          :error="error(CONTROL_IDS.pdOd)"
          :disabled="props.disabled"
          @update:model-value="update('pdOd', $event)"
        />
        <MeasureField
          :model-value="model.pdOg"
          label="Écart pupillaire OG (mm)"
          :control-id="CONTROL_IDS.pdOg"
          :error="error(CONTROL_IDS.pdOg)"
          :disabled="props.disabled"
          @update:model-value="update('pdOg', $event)"
        />
      </div>
    </SectionCard>

    <div
      v-if="sum !== null"
      class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-base text-ink sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <p>
        Somme OD + OG :
        <strong class="text-lg font-semibold tabular-nums">{{ measureText(sum) }} mm</strong>
        <span v-if="mismatch" class="font-medium text-warning">
          <span aria-hidden="true"> ⚠ </span>diffère de l’écart total saisi
        </span>
      </p>
      <AppButton
        v-if="canProposeSum && !props.disabled"
        variant="secondary"
        @click="update('pdTotal', measureText(sum))"
        >Reporter la somme dans l’écart total</AppButton
      >
    </div>

    <TextAreaField
      v-if="showReason"
      :model-value="model.reason"
      label="Justification de l’écart"
      :hint="
        mismatch
          ? 'Obligatoire : la somme des écarts OD et OG diffère de l’écart total.'
          : undefined
      "
      :control-id="CONTROL_IDS.pdReason"
      :rows="3"
      :maxlength="TEXT_MAX_LENGTH"
      :error="error(CONTROL_IDS.pdReason)"
      :disabled="props.disabled"
      @update:model-value="update('reason', $event)"
    />
  </div>
</template>

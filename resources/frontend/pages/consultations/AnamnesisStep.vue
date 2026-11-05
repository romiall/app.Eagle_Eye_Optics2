<script setup lang="ts">
/**
 * Étape « Motif et lunettes » (DP §4 ; fichier 02) : motifs en sélection multiple (« Autre » à
 * préciser), plaintes et symptômes en texte libre, « Porte actuellement des lunettes » oui / non /
 * non renseigné et, si oui seulement, la durée en texte et « ancienne correction disponible » oui /
 * non / non renseigné. Si la réponse n'est pas « Oui », ces deux champs sont masqués et jamais
 * envoyés (le serveur refuse le contraire) : l'écran le dit si des réponses restent en mémoire.
 * Des boutons de symptômes courants (ceux que le cabinet note le plus souvent) COMPLÈTENT le texte libre
 * d'un clic, sans jamais l'écraser ni répéter un symptôme déjà écrit.
 * Le formulaire est tenu par l'écran ; ce composant affiche les erreurs reçues par identifiant de contrôle.
 */
import { computed } from 'vue'

import QuickChoices from '@/components/clinical/QuickChoices.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import YesNoField from '@/components/form/YesNoField.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import {
  type AnamnesisDraft,
  glassesAnswersIgnored,
  TEXT_MAX_LENGTH,
} from '@/domain/clinical/steps'

import TermChecklist from './TermChecklist.vue'

const model = defineModel<AnamnesisDraft>({ required: true })
const props = withDefaults(
  defineProps<{ errors: Readonly<Record<string, string>>; disabled?: boolean }>(),
  { disabled: false },
)

function update<K extends keyof AnamnesisDraft>(key: K, value: AnamnesisDraft[K]): void {
  model.value = { ...model.value, [key]: value }
}

const ignored = computed(() => glassesAnswersIgnored(model.value))

/** Symptômes que le cabinet note le plus souvent : un clic les ajoute au texte libre. */
const COMMON_SYMPTOMS = [
  'Maux de tête',
  'Vision floue',
  'Baisse d’acuité visuelle',
  'Myalgies',
  'Yeux rouges, picotements',
  'Fatigue visuelle sur écran',
  'Renouvellement des lunettes',
] as const

/** Ajoute le symptôme à la fin du texte (virgule entre deux), sans le répéter ni dépasser la longueur permise. */
function addSymptom(phrase: string): void {
  const current = model.value.symptoms
  if (current.toLowerCase().includes(phrase.toLowerCase())) return
  const trimmed = current.trimEnd()
  const joined =
    trimmed === '' ? phrase : `${trimmed}${/[.,;:]$/.test(trimmed) ? ' ' : ', '}${phrase}`
  if ([...joined].length > TEXT_MAX_LENGTH) return
  update('symptoms', joined)
}

function error(controlId: string): string | null {
  return props.errors[controlId] ?? null
}
</script>

<template>
  <div class="space-y-6">
    <TermChecklist
      group="COMPLAINT"
      legend="Motifs de la consultation"
      hint="Plusieurs motifs peuvent être cochés."
      :id-base="CONTROL_IDS.complaints"
      :rows="model.complaints"
      :error="error(CONTROL_IDS.complaints)"
      :other-error="error(CONTROL_IDS.complaintOther)"
      :disabled="props.disabled"
      @update:rows="update('complaints', $event)"
    />

    <TextAreaField
      :model-value="model.symptoms"
      label="Plaintes et symptômes"
      :control-id="CONTROL_IDS.symptoms"
      :rows="4"
      :maxlength="TEXT_MAX_LENGTH"
      :error="error(CONTROL_IDS.symptoms)"
      :disabled="props.disabled"
      @update:model-value="update('symptoms', $event)"
    />
    <QuickChoices
      legend="Symptômes courants : touchez pour les ajouter au texte"
      :values="COMMON_SYMPTOMS"
      :disabled="props.disabled"
      class="-mt-3"
      @pick="addSymptom"
    />

    <SectionCard flat>
      <div class="space-y-4">
        <YesNoField
          :model-value="model.wearsGlasses"
          legend="Porte actuellement des lunettes"
          :control-id="CONTROL_IDS.wearsGlasses"
          :error="error(CONTROL_IDS.wearsGlasses)"
          :disabled="props.disabled"
          @update:model-value="update('wearsGlasses', $event)"
        />
        <template v-if="model.wearsGlasses === true">
          <TextField
            :model-value="model.glassesDuration"
            label="Depuis combien de temps"
            hint="En texte libre."
            :control-id="CONTROL_IDS.glassesDuration"
            :maxlength="TEXT_MAX_LENGTH"
            :error="error(CONTROL_IDS.glassesDuration)"
            :disabled="props.disabled"
            class="max-w-md"
            @update:model-value="update('glassesDuration', $event)"
          />
          <YesNoField
            :model-value="model.previousCorrectionAvailable"
            legend="Ancienne correction disponible"
            :control-id="CONTROL_IDS.previousCorrection"
            :error="error(CONTROL_IDS.previousCorrection)"
            :disabled="props.disabled"
            @update:model-value="update('previousCorrectionAvailable', $event)"
          />
        </template>
        <p v-if="ignored" class="text-sm font-medium text-warning">
          <span aria-hidden="true">⚠ </span>La durée et l’ancienne correction saisies ne sont pas
          enregistrées tant que « Porte actuellement des lunettes » n’est pas « Oui ».
        </p>
      </div>
    </SectionCard>
  </div>
</template>

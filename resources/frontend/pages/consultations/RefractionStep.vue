<script setup lang="ts">
/**
 * Étape « Réfraction » (C02 ; DP §6 et §7 ; fichier 02) : trois mesures DISTINCTES, jamais fusionnées —
 * autoréfracteur, réfraction objective, réfraction subjective (avec addition) — pour OD et OG, puis les
 * amétropies (choix du professionnel : aucune n'est déduite des chiffres) et les observations libres.
 *
 * - Une case vide est « non mesuré », jamais zéro ; « 0,00 » est une valeur. La virgule française est admise ;
 *   plus de deux décimales sont refusées, jamais arrondies. L'axe est un entier de 0 à 180 degrés.
 * - Aucune mesure n'est recopiée d'un œil à l'autre, d'un stade à l'autre ni vers une prescription, et un cylindre
 *   positif n'est jamais transposé. Un pas inhabituel (hors multiple de 0,25) ou un cylindre sans axe sont
 *   SIGNALÉS sous le tableau, sans bloquer l'enregistrement.
 * - L'écart pupillaire (DP) du ticket de l'autoréfracteur se saisit ICI, sous son tableau, comme sur le
 *   ticket. Il appartient pourtant au centrage : c'est l'écart total de l'étape « Centrage » (même champ), que
 *   l'écran enregistre avec la réfraction ; aucune valeur monoculaire n'en est déduite.
 * Le formulaire est tenu par l'écran ; ce composant affiche les erreurs reçues par identifiant de contrôle.
 */
import ClinicalHint from '@/components/clinical/ClinicalHint.vue'
import MeasureField from '@/components/clinical/MeasureField.vue'
import OpticalTable, {
  type OpticalColumn,
  type OpticalMeasures,
} from '@/components/clinical/OpticalTable.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import { TEXT_MAX_LENGTH } from '@/domain/clinical/fields'
import { EYE_SHORT_LABELS, STAGE_LABELS } from '@/domain/clinical/labels'
import {
  type MeasureCell,
  measurementKey,
  REFRACTION_EYES,
  REFRACTION_STAGES,
  type RefractionDraft,
  type RefractionEye,
  type RefractionStage,
  stepNotices,
} from '@/domain/clinical/refraction'

import TermChecklist from './TermChecklist.vue'

const model = defineModel<RefractionDraft>({ required: true })
const props = withDefaults(
  defineProps<{
    errors: Readonly<Record<string, string>>
    disabled?: boolean
    /** Écart pupillaire total du centrage (texte saisi) ; absent : le champ n'est pas proposé ici. */
    pd?: string | undefined
  }>(),
  { disabled: false, pd: undefined },
)

const emit = defineEmits<{ 'update:pd': [value: string] }>()

type Field = 'sphere' | 'cylinder' | 'axis' | 'addition'

const BASE_COLUMNS: OpticalColumn[] = [
  { key: 'sphere', label: 'Sphère', unit: 'D' },
  { key: 'cylinder', label: 'Cylindre', unit: 'D' },
  { key: 'axis', label: 'Axe', unit: '°' },
]
const SUBJECTIVE_COLUMNS: OpticalColumn[] = [
  ...BASE_COLUMNS,
  { key: 'addition', label: 'Addition', unit: 'D' },
]

const HINTS: Record<RefractionStage, string> = {
  AUTOREFRACTOR:
    'Ticket de l’autoréfracteur : reportez les valeurs moyennes (AVG) de R (œil droit, OD) puis de L (œil gauche, OG), puis l’écart pupillaire (PD) du ticket sous le tableau.',
  OBJECTIVE: 'Réfraction objective (sans l’avis du patient).',
  SUBJECTIVE: 'Réfraction subjective, avec addition.',
}

function columns(stage: RefractionStage): OpticalColumn[] {
  return stage === 'SUBJECTIVE' ? SUBJECTIVE_COLUMNS : BASE_COLUMNS
}

function cellOf(stage: RefractionStage, eye: RefractionEye): MeasureCell | undefined {
  return model.value.cells[measurementKey(stage, eye)]
}

function valueOf(stage: RefractionStage, eye: RefractionEye, field: Field): string {
  return cellOf(stage, eye)?.[field] ?? ''
}

function controlId(stage: RefractionStage, eye: RefractionEye, field: Field): string {
  return CONTROL_IDS.measure(stage, eye, field)
}

function measures(stage: RefractionStage): OpticalMeasures {
  const result: Record<string, Record<string, string>> = {}
  for (const eye of REFRACTION_EYES) {
    result[eye] = {
      sphere: valueOf(stage, eye, 'sphere'),
      cylinder: valueOf(stage, eye, 'cylinder'),
      axis: valueOf(stage, eye, 'axis'),
      addition: valueOf(stage, eye, 'addition'),
    }
  }
  return result
}

function errorsOf(stage: RefractionStage): Record<string, string> {
  const result: Record<string, string> = {}
  for (const eye of REFRACTION_EYES) {
    for (const field of ['sphere', 'cylinder', 'axis', 'addition'] as const) {
      const message = props.errors[controlId(stage, eye, field)]
      if (message !== undefined) result[`${eye}.${field}`] = message
    }
  }
  return result
}

function setValue(stage: RefractionStage, eye: RefractionEye, field: Field, value: string): void {
  const key = measurementKey(stage, eye)
  const cell = model.value.cells[key]
  if (cell === undefined) return
  model.value = {
    ...model.value,
    cells: { ...model.value.cells, [key]: { ...cell, [field]: value } },
  }
}

function notices(stage: RefractionStage): { eye: RefractionEye; text: string }[] {
  const found: { eye: RefractionEye; text: string }[] = []
  for (const eye of REFRACTION_EYES) {
    const cell = cellOf(stage, eye)
    if (cell === undefined) continue
    for (const text of stepNotices(cell, stage)) found.push({ eye, text })
  }
  return found
}

function error(id: string): string | null {
  return props.errors[id] ?? null
}
</script>

<template>
  <div class="space-y-8">
    <ClinicalHint>
      Trois mesures distinctes, jamais fusionnées. Une case vide est « non mesuré » ; « 0,00 » est
      une valeur. Les valeurs sont conservées telles que saisies (virgule ou point, deux décimales
      au plus).
    </ClinicalHint>

    <section v-for="stage in REFRACTION_STAGES" :key="stage" class="space-y-3">
      <OpticalTable
        :caption="STAGE_LABELS[stage]"
        :columns="columns(stage)"
        :eyes="REFRACTION_EYES"
        :model-value="measures(stage)"
        :errors="errorsOf(stage)"
      >
        <template #intro>
          <p class="max-w-prose text-sm text-muted">{{ HINTS[stage] }}</p>
        </template>
        <template #cellule-sphere="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(stage, cell.eye as RefractionEye, 'sphere')"
            :control-id="controlId(stage, cell.eye as RefractionEye, 'sphere')"
            :error="cell.error"
            :disabled="props.disabled"
            hide-label-wide
            @update:model-value="setValue(stage, cell.eye as RefractionEye, 'sphere', $event)"
          />
        </template>
        <template #cellule-cylinder="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(stage, cell.eye as RefractionEye, 'cylinder')"
            :control-id="controlId(stage, cell.eye as RefractionEye, 'cylinder')"
            :error="cell.error"
            :disabled="props.disabled"
            hide-label-wide
            @update:model-value="setValue(stage, cell.eye as RefractionEye, 'cylinder', $event)"
          />
        </template>
        <template #cellule-axis="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(stage, cell.eye as RefractionEye, 'axis')"
            :control-id="controlId(stage, cell.eye as RefractionEye, 'axis')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="numeric"
            :maxlength="3"
            hide-label-wide
            @update:model-value="setValue(stage, cell.eye as RefractionEye, 'axis', $event)"
          />
        </template>
        <template #cellule-addition="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(stage, cell.eye as RefractionEye, 'addition')"
            :control-id="controlId(stage, cell.eye as RefractionEye, 'addition')"
            :error="cell.error"
            :disabled="props.disabled"
            hide-label-wide
            @update:model-value="setValue(stage, cell.eye as RefractionEye, 'addition', $event)"
          />
        </template>
      </OpticalTable>
      <div v-if="stage === 'AUTOREFRACTOR' && props.pd !== undefined" class="max-w-sm space-y-1.5">
        <MeasureField
          :model-value="props.pd"
          label="Écart pupillaire total (mm)"
          :control-id="CONTROL_IDS.pdTotal"
          :error="error(CONTROL_IDS.pdTotal)"
          :disabled="props.disabled"
          @update:model-value="emit('update:pd', $event)"
        />
        <p class="text-sm text-muted">
          Écart pupillaire (PD) du ticket. Il est enregistré avec le centrage : inutile de repasser
          par cette étape.
        </p>
      </div>
      <ul
        v-if="notices(stage).length > 0"
        class="space-y-1.5 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-ink"
      >
        <li
          v-for="notice in notices(stage)"
          :key="`${notice.eye}-${notice.text}`"
          class="flex items-start gap-2"
        >
          <AppIcon name="alert" :size="16" class="mt-0.5 text-warning" />
          <span class="min-w-0">
            {{ STAGE_LABELS[stage] }}, {{ EYE_SHORT_LABELS[notice.eye] }} · {{ notice.text }}
          </span>
        </li>
      </ul>
    </section>

    <SectionCard flat>
      <div class="space-y-6">
        <TermChecklist
          group="AMETROPIA"
          legend="Type d’amétropie"
          hint="Choix du professionnel : aucun n’est déduit des chiffres. Plusieurs choix possibles."
          :id-base="CONTROL_IDS.ametropias"
          :rows="model.ametropias"
          :error="error(CONTROL_IDS.ametropias)"
          :other-error="error(CONTROL_IDS.ametropiaOther)"
          :disabled="props.disabled"
          @update:rows="model = { ...model, ametropias: $event }"
        />

        <TextAreaField
          :model-value="model.observations"
          label="Observations"
          :control-id="CONTROL_IDS.refractionObservations"
          :rows="4"
          :maxlength="TEXT_MAX_LENGTH"
          :error="error(CONTROL_IDS.refractionObservations)"
          :disabled="props.disabled"
          @update:model-value="model = { ...model, observations: $event }"
        />
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
/**
 * Formulaire d'une prescription optique (C04 ; fichier 02, « Prescription optique » ; DP §8) : correction OD / OG
 * (sphère, cylindre, axe, addition, hauteur de montage), mention « aucune correction » par œil, écarts
 * pupillaires, usage, type de verre, indice, traitements et observations.
 *
 * Les valeurs sont celles que le professionnel saisit (ou recopie par un geste explicite et confirmé de
 * l'écran) : rien n'est calculé, déduit ni transposé. Une case vide est « non saisi » ; « 0,00 » est une valeur.
 * Le formulaire est tenu par l'écran ; ce composant affiche les erreurs reçues par identifiant de contrôle.
 * Présentation : rubriques séparées par un filet, chacune titrée avec son icône et son action de copie
 * à droite dès la tablette ; le tableau de correction garde toute la largeur.
 */
import { computed, ref } from 'vue'

import MeasureField from '@/components/clinical/MeasureField.vue'
import OpticalTable, {
  type OpticalColumn,
  type OpticalMeasures,
} from '@/components/clinical/OpticalTable.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import DateField from '@/components/form/DateField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { TEXT_MAX_LENGTH } from '@/domain/clinical/fields'
import {
  EYES,
  LENS_INDEX_OTHER,
  LENS_INDEXES,
  type PrescriptionDraft,
  type PrescriptionEye,
  type PrescriptionEyeDraft,
  RX_IDS,
} from '@/domain/clinical/prescriptions'
import { CLINICAL_TERMS } from '@/domain/clinical/terms'

import TermChecklist from './TermChecklist.vue'

const model = defineModel<PrescriptionDraft>({ required: true })
const props = withDefaults(
  defineProps<{
    errors: Readonly<Record<string, string>>
    disabled?: boolean
    /** Les mesures de la consultation permettent une copie explicite (boutons proposés). */
    canCopyRefraction?: boolean
    canCopyCentering?: boolean
  }>(),
  { disabled: false, canCopyRefraction: false, canCopyCentering: false },
)

const emit = defineEmits<{ 'copy-refraction': []; 'copy-centering': [] }>()

type Field = 'sphere' | 'cylinder' | 'axis' | 'addition' | 'fittingHeight'
const COLUMN_FIELD: Readonly<Record<string, Field>> = {
  sphere: 'sphere',
  cylinder: 'cylinder',
  axis: 'axis',
  addition: 'addition',
  fitting_height: 'fittingHeight',
}

const COLUMNS: OpticalColumn[] = [
  { key: 'sphere', label: 'Sphère', unit: 'D' },
  { key: 'cylinder', label: 'Cylindre', unit: 'D' },
  { key: 'axis', label: 'Axe', unit: '°' },
  { key: 'addition', label: 'Addition', unit: 'D' },
  { key: 'fitting_height', label: 'Hauteur de montage', unit: 'mm' },
]

const usageOptions = CLINICAL_TERMS.OPTICAL_USAGE.map((term) => ({
  value: term.code,
  label: term.label,
}))
const typeOptions = CLINICAL_TERMS.LENS_TYPE.map((term) => ({
  value: term.code,
  label: term.label,
}))
const indexOptions = [
  ...LENS_INDEXES.map((value) => ({ value, label: value })),
  { value: LENS_INDEX_OTHER, label: 'Autre' },
]

const external = computed(() => model.value.origin === 'EXTERNAL')
const reasonOpen = ref(false)

function error(id: string): string | null {
  return props.errors[id] ?? null
}

function patch(changes: Partial<PrescriptionDraft>): void {
  model.value = { ...model.value, ...changes }
}

function patchEye(eye: PrescriptionEye, changes: Partial<PrescriptionEyeDraft>): void {
  model.value = {
    ...model.value,
    eyes: { ...model.value.eyes, [eye]: { ...model.value.eyes[eye], ...changes } },
  }
}

function valueOf(eye: PrescriptionEye, column: string): string {
  const field = COLUMN_FIELD[column]
  return field === undefined ? '' : model.value.eyes[eye][field]
}

function setValue(eye: PrescriptionEye, column: string, value: string): void {
  const field = COLUMN_FIELD[column]
  if (field !== undefined) patchEye(eye, { [field]: value })
}

function controlId(eye: PrescriptionEye, column: string): string {
  return RX_IDS.eye(eye, column)
}

const measures = computed<OpticalMeasures>(() => {
  const result: Record<string, Record<string, string>> = {}
  for (const eye of EYES) {
    const row: Record<string, string> = {}
    for (const column of COLUMNS) row[column.key] = valueOf(eye, column.key)
    result[eye] = row
  }
  return result
})

const tableErrors = computed(() => {
  const result: Record<string, string> = {}
  for (const eye of EYES) {
    for (const column of COLUMNS) {
      const message = props.errors[controlId(eye, column.key)]
      if (message !== undefined) result[`${eye}.${column.key}`] = message
    }
  }
  return result
})

function chooseUsage(value: string | null): void {
  patch({ usageCode: value, usageOther: value === 'OTHER' ? model.value.usageOther : '' })
}

function chooseType(value: string | null): void {
  patch({ lensTypeCode: value, lensTypeOther: value === 'OTHER' ? model.value.lensTypeOther : '' })
}

function chooseIndex(value: string | null): void {
  patch({
    lensIndex: value,
    lensIndexOther: value === LENS_INDEX_OTHER ? model.value.lensIndexOther : '',
  })
}
</script>

<template>
  <div class="space-y-6">
    <section v-if="external" class="space-y-4">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <AppIcon name="file" class="text-gold" />Ordonnance externe
      </h3>
      <div class="form-grid">
        <TextField
          :model-value="model.externalPrescriber"
          label="Prescripteur"
          :control-id="RX_IDS.externalPrescriber"
          :maxlength="180"
          :error="error(RX_IDS.externalPrescriber)"
          :disabled="props.disabled"
          required
          @update:model-value="patch({ externalPrescriber: $event })"
        />
        <DateField
          :model-value="model.externalPrescribedOn"
          label="Date de l’ordonnance"
          field="external_prescribed_on"
          :control-id="RX_IDS.externalPrescribedOn"
          :error="error(RX_IDS.externalPrescribedOn)"
          :disabled="props.disabled"
          required
          @update:model-value="patch({ externalPrescribedOn: $event })"
        />
      </div>
    </section>

    <section :class="['space-y-4', external ? 'border-t border-line pt-6' : '']">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <AppIcon name="glasses" class="text-gold" />Correction
        </h3>
        <AppButton
          v-if="props.canCopyRefraction && !props.disabled"
          variant="secondary"
          @click="emit('copy-refraction')"
          ><AppIcon name="clipboard" :size="18" />Copier une mesure de réfraction…</AppButton
        >
      </div>
      <OpticalTable
        caption="Correction par œil"
        :columns="COLUMNS"
        :eyes="EYES"
        :model-value="measures"
        :errors="tableErrors"
      >
        <template #cellule-sphere="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(cell.eye as PrescriptionEye, 'sphere')"
            :control-id="controlId(cell.eye as PrescriptionEye, 'sphere')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="text"
            hide-label-wide
            @update:model-value="setValue(cell.eye as PrescriptionEye, 'sphere', $event)"
          />
        </template>
        <template #cellule-cylinder="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(cell.eye as PrescriptionEye, 'cylinder')"
            :control-id="controlId(cell.eye as PrescriptionEye, 'cylinder')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="text"
            hide-label-wide
            @update:model-value="setValue(cell.eye as PrescriptionEye, 'cylinder', $event)"
          />
        </template>
        <template #cellule-axis="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(cell.eye as PrescriptionEye, 'axis')"
            :control-id="controlId(cell.eye as PrescriptionEye, 'axis')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="numeric"
            hide-label-wide
            @update:model-value="setValue(cell.eye as PrescriptionEye, 'axis', $event)"
          />
        </template>
        <template #cellule-addition="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(cell.eye as PrescriptionEye, 'addition')"
            :control-id="controlId(cell.eye as PrescriptionEye, 'addition')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="text"
            hide-label-wide
            @update:model-value="setValue(cell.eye as PrescriptionEye, 'addition', $event)"
          />
        </template>
        <template #cellule-fitting_height="cell">
          <MeasureField
            :label="cell.label"
            :model-value="valueOf(cell.eye as PrescriptionEye, 'fitting_height')"
            :control-id="controlId(cell.eye as PrescriptionEye, 'fitting_height')"
            :error="cell.error"
            :disabled="props.disabled"
            inputmode="text"
            hide-label-wide
            @update:model-value="setValue(cell.eye as PrescriptionEye, 'fitting_height', $event)"
          />
        </template>
      </OpticalTable>
      <fieldset class="min-w-0">
        <legend class="field-label p-0">Mention d’absence de correction</legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="eye in EYES"
            :key="eye"
            class="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1 text-base text-ink hover:border-primary has-checked:border-gold has-checked:bg-primary-soft has-checked:font-medium has-disabled:cursor-not-allowed has-disabled:bg-disabled"
            :for="RX_IDS.eye(eye, 'no_correction')"
          >
            <input
              :id="RX_IDS.eye(eye, 'no_correction')"
              type="checkbox"
              class="size-6 shrink-0 accent-primary"
              :checked="model.eyes[eye].noCorrection"
              :disabled="props.disabled"
              :aria-invalid="error(RX_IDS.eye(eye, 'no_correction')) ? 'true' : undefined"
              @change="patchEye(eye, { noCorrection: ($event.target as HTMLInputElement).checked })"
            />
            Œil {{ eye === 'OD' ? 'droit (OD)' : 'gauche (OG)' }} : aucune correction
          </label>
        </div>
        <p
          v-for="eye in EYES"
          v-show="error(RX_IDS.eye(eye, 'no_correction')) !== null"
          :key="`erreur-${eye}`"
          class="mt-1.5 flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
        >
          <span aria-hidden="true" class="shrink-0">⚠ </span
          ><span>{{ error(RX_IDS.eye(eye, 'no_correction')) }}</span>
        </p>
      </fieldset>
    </section>

    <section class="space-y-4 border-t border-line pt-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <AppIcon name="eye" class="text-gold" />Écart pupillaire
        </h3>
        <AppButton
          v-if="props.canCopyCentering && !props.disabled"
          variant="secondary"
          @click="emit('copy-centering')"
          ><AppIcon name="clipboard" :size="18" />Reporter les écarts du centrage</AppButton
        >
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <MeasureField
          :model-value="model.pdTotal"
          label="Écart pupillaire total (mm)"
          :control-id="RX_IDS.pdTotal"
          :error="error(RX_IDS.pdTotal)"
          :disabled="props.disabled"
          @update:model-value="patch({ pdTotal: $event })"
        />
        <MeasureField
          :model-value="model.pdOd"
          label="Écart pupillaire OD (mm)"
          :control-id="RX_IDS.pdOd"
          :error="error(RX_IDS.pdOd)"
          :disabled="props.disabled"
          @update:model-value="patch({ pdOd: $event })"
        />
        <MeasureField
          :model-value="model.pdOg"
          label="Écart pupillaire OG (mm)"
          :control-id="RX_IDS.pdOg"
          :error="error(RX_IDS.pdOg)"
          :disabled="props.disabled"
          @update:model-value="patch({ pdOg: $event })"
        />
      </div>
      <TextAreaField
        v-if="reasonOpen || model.pdReason !== '' || error(RX_IDS.pdReason) !== null"
        :model-value="model.pdReason"
        label="Justification de l’écart"
        :control-id="RX_IDS.pdReason"
        :rows="2"
        :maxlength="TEXT_MAX_LENGTH"
        :error="error(RX_IDS.pdReason)"
        :disabled="props.disabled"
        @update:model-value="patch({ pdReason: $event })"
      />
      <AppButton v-else-if="!props.disabled" variant="ghost" @click="reasonOpen = true"
        >Justifier un écart entre le total et OD + OG</AppButton
      >
    </section>

    <section class="space-y-4 border-t border-line pt-6">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <AppIcon name="tag" class="text-gold" />Verres
      </h3>
      <div class="form-grid">
        <SelectField
          :model-value="model.usageCode"
          label="Usage"
          placeholder="Choisir un usage…"
          :options="usageOptions"
          :control-id="RX_IDS.usage"
          :error="error(RX_IDS.usage)"
          :disabled="props.disabled"
          @update:model-value="chooseUsage"
        />
        <TextField
          v-if="model.usageCode === 'OTHER'"
          :model-value="model.usageOther"
          label="Autre usage : précisez"
          :control-id="RX_IDS.usageOther"
          :maxlength="TEXT_MAX_LENGTH"
          :error="error(RX_IDS.usageOther)"
          :disabled="props.disabled"
          required
          @update:model-value="patch({ usageOther: $event })"
        />
        <SelectField
          :model-value="model.lensTypeCode"
          label="Type de verre"
          placeholder="Choisir un type…"
          :options="typeOptions"
          :control-id="RX_IDS.lensType"
          :error="error(RX_IDS.lensType)"
          :disabled="props.disabled"
          @update:model-value="chooseType"
        />
        <TextField
          v-if="model.lensTypeCode === 'OTHER'"
          :model-value="model.lensTypeOther"
          label="Autre type de verre : précisez"
          :control-id="RX_IDS.lensTypeOther"
          :maxlength="TEXT_MAX_LENGTH"
          :error="error(RX_IDS.lensTypeOther)"
          :disabled="props.disabled"
          required
          @update:model-value="patch({ lensTypeOther: $event })"
        />
        <SelectField
          :model-value="model.lensIndex"
          label="Indice"
          placeholder="Choisir un indice…"
          :options="indexOptions"
          :control-id="RX_IDS.lensIndex"
          :error="error(RX_IDS.lensIndex)"
          :disabled="props.disabled"
          @update:model-value="chooseIndex"
        />
        <TextField
          v-if="model.lensIndex === LENS_INDEX_OTHER"
          :model-value="model.lensIndexOther"
          label="Autre indice : précisez"
          :control-id="RX_IDS.lensIndexOther"
          :maxlength="TEXT_MAX_LENGTH"
          :error="error(RX_IDS.lensIndexOther)"
          :disabled="props.disabled"
          required
          @update:model-value="patch({ lensIndexOther: $event })"
        />
      </div>
      <TermChecklist
        group="LENS_TREATMENT"
        legend="Traitements"
        hint="Plusieurs traitements peuvent être cochés."
        :id-base="RX_IDS.treatments"
        :rows="model.treatments"
        :error="error(RX_IDS.treatments)"
        :other-error="error(RX_IDS.treatmentOther)"
        :disabled="props.disabled"
        @update:rows="patch({ treatments: $event })"
      />
    </section>

    <div class="border-t border-line pt-6">
      <TextAreaField
        :model-value="model.notes"
        label="Observations"
        :control-id="RX_IDS.notes"
        :rows="3"
        :maxlength="TEXT_MAX_LENGTH"
        :error="error(RX_IDS.notes)"
        :disabled="props.disabled"
        @update:model-value="patch({ notes: $event })"
      />
    </div>
  </div>
</template>

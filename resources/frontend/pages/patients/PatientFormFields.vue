<script setup lang="ts">
/**
 * Champs d'identité d'un patient, communs à la création et à la modification (fichier 02, EE001) :
 * nom (obligatoire), prénoms, sexe, date de naissance avec sa raison d'absence, téléphones avec la
 * raison d'absence du principal, adresse et profession. Le formulaire est tenu par l'écran : ce
 * composant affiche les erreurs qu'on lui donne, sous chaque champ, et expose `commit()` pour lire
 * la date de naissance avant l'envoi. Aucune règle n'est jouée ici (domain/patients/form).
 *
 * Présentation : un groupe de champs (`fieldset` et sa légende) par carte, une colonne sur téléphone
 * et deux sur tablette et ordinateur ; les raisons d'absence et l'adresse prennent toute la largeur.
 */
import { computed, ref } from 'vue'

import { clinicToday } from '@/app/clinicTime'
import DateField from '@/components/form/DateField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { PatientFormErrors, PatientFormField, PatientFormState } from '@/domain/patients/form'
import { formatAge, patientAge, SEX_LABELS } from '@/domain/patients/identity'
import { trimBlanks } from '@/domain/values/text'

import { FIELD_IDS } from './formFields'

const model = defineModel<PatientFormState>({ required: true })
const props = withDefaults(defineProps<{ errors: PatientFormErrors; disabled?: boolean }>(), {
  disabled: false,
})

const dateField = ref<{ commit: () => boolean } | null>(null)

function update<K extends PatientFormField>(field: K, value: PatientFormState[K]): void {
  model.value = { ...model.value, [field]: value }
}

/** « Non renseigné » est le choix vide de la liste : il vaut UNKNOWN. */
const SEX_OPTIONS = [
  { value: 'F', label: SEX_LABELS.F },
  { value: 'M', label: SEX_LABELS.M },
]
const sexChoice = computed(() => (model.value.sex === 'UNKNOWN' ? null : model.value.sex))

function chooseSex(value: string | null): void {
  update('sex', value === 'F' || value === 'M' ? value : 'UNKNOWN')
}

const birthHint = computed(() => {
  const base = 'Format JJ/MM/AAAA ou 8 chiffres (15102026).'
  const age = patientAge(model.value.birthDate, clinicToday())
  return age.kind === 'years' || age.kind === 'months'
    ? `${base} Âge calculé : ${formatAge(age)}.`
    : base
})

const birthDateMissing = computed(() => model.value.birthDate === null)
const phoneMissing = computed(() => trimBlanks(model.value.phonePrimary) === '')

defineExpose({
  /** Lit la date de naissance saisie ; faux si elle est refusée (le champ en dit la raison). */
  commit: (): boolean => dateField.value?.commit() ?? true,
})

/**
 * Légende d'un groupe : pastille d'icône dorée décorative, puis le titre de la carte, sur un filet
 * qui porte un court segment doré (`.form-legend`, base.css).
 */
const LEGEND = 'form-legend'
const BADGE =
  'mr-3 inline-flex size-9 items-center justify-center rounded-lg bg-gold-soft align-middle text-gold-ink'
</script>

<template>
  <div class="space-y-6">
    <SectionCard>
      <fieldset class="min-w-0">
        <legend :class="LEGEND">
          <span aria-hidden="true" :class="BADGE"><AppIcon name="id-card" :size="18" /></span
          >Identité
        </legend>
        <div class="form-grid">
          <TextField
            :model-value="model.lastName"
            label="Nom"
            :control-id="FIELD_IDS.lastName"
            :error="props.errors.lastName ?? null"
            :disabled="props.disabled"
            required
            @update:model-value="update('lastName', $event)"
          />
          <TextField
            :model-value="model.firstNames"
            label="Prénom(s)"
            :control-id="FIELD_IDS.firstNames"
            hint="Facultatif : un prénom peut être inconnu."
            :error="props.errors.firstNames ?? null"
            :disabled="props.disabled"
            @update:model-value="update('firstNames', $event)"
          />
          <SelectField
            :model-value="sexChoice"
            label="Sexe"
            :control-id="FIELD_IDS.sex"
            :options="SEX_OPTIONS"
            :placeholder="SEX_LABELS.UNKNOWN"
            :error="props.errors.sex ?? null"
            :disabled="props.disabled"
            @update:model-value="chooseSex"
          />
          <DateField
            ref="dateField"
            :model-value="model.birthDate"
            label="Date de naissance"
            field="birth_date"
            :control-id="FIELD_IDS.birthDate"
            :hint="birthHint"
            :error="props.errors.birthDate ?? null"
            :disabled="props.disabled"
            @update:model-value="update('birthDate', $event)"
          />
          <div v-if="birthDateMissing" class="col-span-full">
            <TextField
              :model-value="model.birthDateMissingReason"
              label="Raison de l’absence de date de naissance"
              :control-id="FIELD_IDS.birthDateMissingReason"
              hint="Obligatoire tant que la date est inconnue. Aucune date n’est inventée."
              :error="props.errors.birthDateMissingReason ?? null"
              :disabled="props.disabled"
              @update:model-value="update('birthDateMissingReason', $event)"
            />
          </div>
        </div>
      </fieldset>
    </SectionCard>

    <SectionCard>
      <fieldset class="min-w-0">
        <legend :class="LEGEND">
          <span aria-hidden="true" :class="BADGE"><AppIcon name="phone" :size="18" /></span>Contact
        </legend>
        <div class="form-grid">
          <TextField
            :model-value="model.phonePrimary"
            label="Téléphone principal"
            :control-id="FIELD_IDS.phonePrimary"
            type="tel"
            inputmode="tel"
            icon="phone"
            hint="Un même téléphone peut servir à plusieurs patients."
            :error="props.errors.phonePrimary ?? null"
            :disabled="props.disabled"
            @update:model-value="update('phonePrimary', $event)"
          />
          <TextField
            :model-value="model.phoneSecondary"
            label="Téléphone secondaire"
            :control-id="FIELD_IDS.phoneSecondary"
            type="tel"
            inputmode="tel"
            icon="phone"
            :error="props.errors.phoneSecondary ?? null"
            :disabled="props.disabled"
            @update:model-value="update('phoneSecondary', $event)"
          />
          <div v-if="phoneMissing" class="col-span-full">
            <TextField
              :model-value="model.phoneMissingReason"
              label="Raison de l’absence de téléphone"
              :control-id="FIELD_IDS.phoneMissingReason"
              hint="Obligatoire tant que le téléphone principal est vide."
              :error="props.errors.phoneMissingReason ?? null"
              :disabled="props.disabled"
              @update:model-value="update('phoneMissingReason', $event)"
            />
          </div>
        </div>
      </fieldset>
    </SectionCard>

    <SectionCard>
      <fieldset class="min-w-0">
        <legend :class="LEGEND">
          <span aria-hidden="true" :class="BADGE"><AppIcon name="map-pin" :size="18" /></span>Autres
          informations
        </legend>
        <div class="form-grid">
          <div class="col-span-full">
            <TextAreaField
              :model-value="model.address"
              label="Adresse ou quartier"
              :control-id="FIELD_IDS.address"
              :maxlength="4000"
              :error="props.errors.address ?? null"
              :disabled="props.disabled"
              @update:model-value="update('address', $event)"
            />
          </div>
          <TextField
            :model-value="model.profession"
            label="Profession"
            :control-id="FIELD_IDS.profession"
            :error="props.errors.profession ?? null"
            :disabled="props.disabled"
            @update:model-value="update('profession', $event)"
          />
        </div>
      </fieldset>
    </SectionCard>
  </div>
</template>

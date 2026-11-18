<script setup lang="ts">
/**
 * En-tête d'identité d'un patient (fichier 04 : « en-tête patient ») : nom, numéro de dossier, sexe
 * et âge calculé à la date civile du cabinet (« âge non renseigné » sans naissance), avec l'état de
 * la fiche (archivée, fusionnée) en texte et en symbole. Identité administrative seulement : aucune
 * donnée clinique n'est affichée ici, ce composant peut donc servir à la caisse. Avec `avatar`, la
 * pastille d'initiales précède l'identité (bandeau du dossier patient, formulaire de modification).
 */
import { computed } from 'vue'

import { clinicToday } from '@/app/clinicTime'
import { formatAge, patientAge, patientDisplayName, sexLabel } from '@/domain/patients/identity'
import type { PatientRecordsSex } from '@/domain/contracts/generated'

import PatientInitials from './PatientInitials.vue'

export interface HeaderPatient {
  last_name: string
  first_names: string | null
  record_number: string
  sex: PatientRecordsSex
  birth_date: string | null
  archived: boolean
  merged_into_patient_id: string | null
}

const props = withDefaults(
  defineProps<{
    patient: HeaderPatient
    as?: 'h1' | 'h2' | 'p'
    titleId?: string | undefined
    /** Pastille d'initiales décorative devant l'identité. */
    avatar?: boolean
  }>(),
  { as: 'p', titleId: undefined, avatar: false },
)

const name = computed(() => patientDisplayName(props.patient.last_name, props.patient.first_names))
const age = computed(() => formatAge(patientAge(props.patient.birth_date, clinicToday())))
const merged = computed(() => props.patient.merged_into_patient_id !== null)

/** Puce d'état de la fiche : fond d'avertissement léger, symbole dans la teinte, texte encre. */
const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border border-warning bg-warning-soft px-2.5 py-0.5 text-sm font-medium text-ink'
</script>

<template>
  <header :class="['min-w-0', props.avatar ? 'flex items-start gap-3 sm:gap-4' : '']">
    <PatientInitials
      v-if="props.avatar"
      :last-name="props.patient.last_name"
      :first-names="props.patient.first_names"
      size="lg"
    />
    <div class="min-w-0 flex-1 space-y-1">
      <component
        :is="props.as"
        :id="props.titleId"
        :class="[
          'text-2xl font-semibold tracking-tight break-words',
          props.as === 'h1' ? 'sm:text-3xl' : '',
        ]"
        >{{ name }}</component
      >
      <p class="text-base text-muted">
        Dossier <strong class="font-semibold text-ink">{{ props.patient.record_number }}</strong>
        <span aria-hidden="true"> · </span><span class="sr-only">, </span
        >{{ sexLabel(props.patient.sex) }}<span aria-hidden="true"> · </span
        ><span class="sr-only">, </span>{{ age }}
      </p>
      <div v-if="props.patient.archived || merged" class="flex flex-wrap gap-2 pt-1">
        <p v-if="props.patient.archived" :class="CHIP">
          <span aria-hidden="true" class="text-warning">⚠</span>Fiche archivée
        </p>
        <p v-if="merged" :class="CHIP">
          <span aria-hidden="true" class="text-warning">⚠</span>Fiche fusionnée dans une autre fiche
        </p>
      </div>
    </div>
  </header>
</template>

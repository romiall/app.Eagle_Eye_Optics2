<script setup lang="ts">
/**
 * Onglet « Prescriptions » du dossier patient (compte clinique, module « consultations ») : en-tête
 * d'identité, puis les ordonnances externes transcrites (`ExternalPrescriptions`). Lecture en ligne : sans
 * réponse du serveur, l'écran le dit (jamais un dossier vide).
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getPatient } from '@/app/services/patients'
import StateMessage from '@/components/feedback/StateMessage.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import PatientRecordHeader from '@/components/patients/PatientRecordHeader.vue'
import type { Patient } from '@/domain/contracts/generated'

import ExternalPrescriptions from './ExternalPrescriptions.vue'
import PatientHeaderActions from './PatientHeaderActions.vue'
import PatientRecordTabs from './PatientRecordTabs.vue'
import ReadStateMessage from './ReadStateMessage.vue'
import { usePatientRead } from './usePatientRead'

const BACK = { to: '/patients', label: 'Retour aux patients' }

const route = useRoute()
const id = computed(() => String(route.params['id']))

const read = usePatientRead<Patient>(() => getPatient(id.value))
watch(id, () => void read.reload())

const patient = computed(() => (read.data.value?.id === id.value ? read.data.value : null))
</script>

<template>
  <section aria-labelledby="titre-fiche" class="page-stack max-w-5xl">
    <template v-if="patient">
      <PatientRecordHeader :patient="patient" title-id="titre-fiche" :back="BACK">
        <template #actions>
          <PatientHeaderActions :patient="patient" />
        </template>
      </PatientRecordHeader>
      <div class="space-y-6">
        <PatientRecordTabs :patient-id="patient.id" current="prescriptions" />
        <ExternalPrescriptions :key="patient.id" :patient-id="patient.id" />
      </div>
    </template>

    <template v-else>
      <PageHeader title-id="titre-fiche" title="Dossier patient" icon="patients" :back="BACK" />
      <StateMessage v-if="read.state.value === 'ready'" state="error" title="Fiche inattendue">
        Le serveur a répondu avec une autre fiche que celle demandée : rien n’est affiché.
      </StateMessage>
      <ReadStateMessage
        :state="read.state.value"
        subject="record"
        :error="read.error.value"
        @retry="read.reload()"
      />
    </template>
  </section>
</template>

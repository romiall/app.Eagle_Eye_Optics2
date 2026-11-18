<script setup lang="ts">
/**
 * Onglet « Activité » du dossier patient (fichier 02 : historique jamais écrasé ; fichier 04 : en-tête
 * d'identité, onglets, chargement du seul onglet nécessaire). L'en-tête relit l'identité de base ; la liste
 * (`PatientActivityList`) lit l'activité, du plus récent au plus ancien, avec les seules sections que le
 * compte peut voir. Lecture en ligne : sans réponse du serveur, l'écran le dit (jamais un dossier vide).
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getPatient } from '@/app/services/patients'
import StateMessage from '@/components/feedback/StateMessage.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import PatientRecordHeader from '@/components/patients/PatientRecordHeader.vue'
import type { Patient } from '@/domain/contracts/generated'

import PatientActivityList from './PatientActivityList.vue'
import PatientHeaderActions from './PatientHeaderActions.vue'
import PatientRecordTabs from './PatientRecordTabs.vue'
import ReadStateMessage from './ReadStateMessage.vue'
import { usePatientRead } from './usePatientRead'

const BACK = { to: '/patients', label: 'Retour aux patients' }

const route = useRoute()
const id = computed(() => String(route.params['id']))

const read = usePatientRead<Patient>(() => getPatient(id.value))

// Le même écran sert une autre fiche quand l'adresse change : relire, sans garder la précédente.
watch(id, () => void read.reload())

/** Fiche lue pour CET identifiant : une lecture précédente ne s'affiche jamais à sa place. */
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
        <PatientRecordTabs :patient-id="patient.id" current="activite" />
        <PatientActivityList :key="patient.id" :patient-id="patient.id" />
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

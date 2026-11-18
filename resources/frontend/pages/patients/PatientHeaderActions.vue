<script setup lang="ts">
/**
 * Actions d'en-tête communes aux trois onglets du dossier patient (Identité, Activité, Prescriptions) :
 * arriver au cabinet, prendre un rendez-vous, préparer un devis, facturer ou modifier la fiche, selon
 * les droits du compte et les modules ouverts.
 */
import { computed } from 'vue'

import { can, enabledModules, session } from '@/app/session'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Patient } from '@/domain/contracts/generated'

const props = defineProps<{ patient: Patient }>()

const localSession = computed(() => session.status === 'local')
const living = computed(
  () => !props.patient.archived && props.patient.merged_into_patient_id === null,
)
const canEdit = computed(() => can('patient.update') && living.value)
const canRegisterArrival = computed(
  () =>
    !localSession.value &&
    can('visit.register') &&
    enabledModules.value.includes('today') &&
    living.value,
)
const canBook = computed(
  () =>
    !localSession.value &&
    can('agenda.write') &&
    enabledModules.value.includes('agenda') &&
    living.value,
)
const canQuote = computed(
  () =>
    !localSession.value &&
    can('invoice.create') &&
    enabledModules.value.includes('sales') &&
    living.value,
)
const canInvoice = computed(
  () =>
    (can('invoice.create') || can('exam_fee.collect')) &&
    enabledModules.value.includes('sales') &&
    living.value,
)
</script>

<template>
  <template v-if="canRegisterArrival || canBook || canQuote || canInvoice || canEdit">
    <LinkButton
      v-if="canRegisterArrival"
      :to="{ name: 'arrivee', query: { patient: props.patient.id } }"
      variant="secondary"
      ><AppIcon name="arrival" :size="18" />Enregistrer une arrivée</LinkButton
    >
    <LinkButton
      v-if="canBook"
      :to="{ name: 'rendez-vous-nouveau', query: { patient: props.patient.id } }"
      variant="secondary"
      ><AppIcon name="calendar-plus" :size="18" />Prendre un rendez-vous</LinkButton
    >
    <LinkButton
      v-if="canQuote"
      :to="{ name: 'devis-nouveau', query: { patient: props.patient.id } }"
      variant="secondary"
      ><AppIcon name="clipboard" :size="18" />Nouveau devis</LinkButton
    >
    <LinkButton
      v-if="canInvoice"
      :to="{ name: 'facture-nouvelle', query: { patient: props.patient.id } }"
      variant="secondary"
      ><AppIcon name="file-plus" :size="18" />Créer une facture</LinkButton
    >
    <LinkButton
      v-if="canEdit"
      :to="{ name: 'patient-modifier', params: { id: props.patient.id } }"
      variant="primary"
      ><AppIcon name="edit" :size="18" />Modifier</LinkButton
    >
  </template>
</template>

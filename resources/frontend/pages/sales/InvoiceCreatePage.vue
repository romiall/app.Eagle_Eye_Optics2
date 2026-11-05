<script setup lang="ts">
/**
 * Nouvelle facture (B02). Le patient arrive présélectionné depuis sa fiche (`?patient=<identifiant>`) ou
 * depuis une visite de la file du jour (`?patient=…&visite=…`) ; sinon il se choisit par recherche
 * (nom, téléphone ou numéro de dossier). Son identité est relue sur le serveur et affichée, jamais
 * ressaisie : le brouillon ne porte que l'identifiant du dossier (et de la visite). Les paramètres de
 * l'adresse sont des identifiants opaques (ULID) ; une autre forme est ignorée. Une fiche archivée ou
 * fusionnée n'est pas facturée ici.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getPatient, searchPatients } from '@/app/services/patients'
import { canOnScreen, moduleOpenOnScreen, session } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Invoice, Patient } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { isUlid } from '@/domain/values/ulid'

import InvoiceEditor from './InvoiceEditor.vue'

const route = useRoute()
const router = useRouter()

function queryId(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && isUlid(value) ? value : null
}

const preselected = queryId('patient')
const visitId = preselected === null ? null : queryId('visite')

const patientId = ref<string | null>(preselected)
const patient = shallowRef<Patient | null>(null)
const loading = ref(false)
const problem = ref<string | null>(null)
const canSearch = computed(() => canOnScreen('patient.read') && moduleOpenOnScreen('patients'))

watch(
  patientId,
  async (id) => {
    patient.value = null
    problem.value = null
    if (id === null) return
    loading.value = true
    try {
      const result = await getPatient(id)
      if (result.data.id !== id) {
        problem.value =
          'Le serveur a répondu avec une autre fiche que celle demandée : rien n’est affiché.'
      } else {
        patient.value = result.data
      }
    } catch {
      problem.value =
        'La fiche du patient n’a pas pu être lue (serveur indisponible, droits ou fiche inconnue) : aucune facture ne peut être préparée sans son dossier.'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const living = computed(
  () =>
    patient.value !== null &&
    !patient.value.archived &&
    patient.value.merged_into_patient_id === null,
)

async function search(query: string): Promise<ComboboxSearchResult> {
  // Serveur injoignable : les fiches de CE poste répondent (jamais un « aucun patient » affirmé).
  const result = await searchPatients(query, 1, { includeLocal: true })
  const options: ComboboxOption[] = result.data.data
    .filter((summary) => !summary.archived && summary.merged_into_patient_id === null)
    .map((summary) => ({
      value: summary.id,
      label: patientDisplayName(summary.last_name, summary.first_names),
      description: `Dossier ${summary.record_number}`,
    }))
  return result.data.meta.last_page > 1
    ? { options, notice: 'D’autres patients correspondent : précisez la recherche.' }
    : options
}

async function onCreated(invoice: Invoice): Promise<void> {
  await router.replace({ name: 'facture', params: { id: invoice.id } })
}
</script>

<template>
  <section aria-labelledby="titre-nouvelle-facture" class="max-w-3xl space-y-6">
    <h1 id="titre-nouvelle-facture" class="text-2xl font-semibold tracking-tight">
      Nouvelle facture
    </h1>

    <template v-if="patientId === null">
      <ComboboxField
        v-if="canSearch"
        v-model="patientId"
        label="Patient"
        hint="Nom, téléphone ou numéro de dossier (2 caractères au moins) : l’identité est reprise de la fiche, jamais ressaisie."
        :search="search"
        control-id="facture-patient"
        required
        unavailable-text="Recherche serveur indisponible : cela ne prouve pas que le patient n’existe pas."
      />
      <StateMessage v-else state="forbidden" title="Choix du patient impossible">
        Ce compte ne peut pas rechercher les patients : ouvrez la facture depuis la fiche du patient
        ou depuis la file du jour.
      </StateMessage>
    </template>

    <StateMessage v-if="loading" state="loading" title="Lecture de la fiche du patient…" />
    <StateMessage v-if="problem" state="offline" title="Fiche du patient non lue">
      {{ problem }}
    </StateMessage>

    <StateMessage v-if="patient && !living" state="error" title="Fiche archivée ou fusionnée">
      Cette fiche ne reçoit plus de nouvelle facture. Ouvrez la fiche conservée.
    </StateMessage>

    <InvoiceEditor
      v-if="patient && living && patientId"
      :key="patientId"
      :patient="patient"
      :patient-id="patientId"
      :visit-id="visitId"
      @created="onCreated"
    />

    <!-- Session locale : la liste des factures demande le serveur, le retour va à la fiche du patient. -->
    <LinkButton v-if="session.status !== 'local'" :to="{ name: 'factures' }" variant="ghost"
      >Retour aux factures</LinkButton
    >
    <LinkButton
      v-else-if="patientId"
      :to="{ name: 'patient', params: { id: patientId } }"
      variant="ghost"
      >Retour à la fiche du patient</LinkButton
    >
  </section>
</template>

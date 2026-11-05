<script setup lang="ts">
/**
 * Facture (B02 à B04) : un brouillon s'édite et s'émet (`InvoiceEditor`), une facture émise se lit et
 * s'encaisse (`InvoiceDetails`). La facture est relue sur le serveur ; sans réponse, elle est
 * « indisponible », jamais une ancienne copie présentée comme actuelle. L'identifiant de l'adresse est
 * un ULID opaque : aucune donnée personnelle dans l'URL. L'éditeur est recréé pour chaque facture (clé),
 * et une facture émise ailleurs pendant l'édition est relue puis affichée émise.
 */
import { computed, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { clinicTimeZone } from '@/app/clinicTime'
import { getInvoice } from '@/app/services/billing'
import { getPatient } from '@/app/services/patients'
import { canOnScreen, session } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Invoice, Patient } from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

import { takeSalesFlash } from './flash'
import { invoiceStatusLabel, invoiceStatusSymbol, invoiceTitle } from './format'
import InvoiceDetails from './InvoiceDetails.vue'
import InvoiceEditor from './InvoiceEditor.vue'
import SalesReadMessage from './SalesReadMessage.vue'

const route = useRoute()
const id = computed(() => String(route.params['id']))
const flash = shallowRef<string | null>(takeSalesFlash())
const timeZone = clinicTimeZone()

const read = useServerRead<Invoice>(() => getInvoice(id.value))
watch(id, () => void read.reload())

/** Facture lue pour CET identifiant : une lecture précédente ne s'affiche jamais à sa place. */
const invoice = computed(() => (read.data.value?.id === id.value ? read.data.value : null))

/** Identité du patient d'un brouillon (fiche actuelle) ; une facture émise montre son snapshot figé. */
const patient = shallowRef<Patient | null>(null)
watch(
  () => invoice.value?.patient_id ?? null,
  async (patientId) => {
    patient.value = null
    if (patientId === null || !canOnScreen('patient.read')) return
    try {
      const result = await getPatient(patientId)
      if (result.data.id === patientId) patient.value = result.data
    } catch {
      patient.value = null
    }
  },
  { immediate: true },
)

/** Vrai tant que la facture affichée est la copie de CE poste (le serveur ne la connaît pas encore). */
const onDevice = shallowRef(false)
watch(
  () => read.freshness.value,
  (freshness) => {
    onDevice.value = freshness !== null && freshness.serverAsOf === null
  },
)

function onIssued(issued: Invoice, issuedOnDevice: boolean): void {
  flash.value = takeSalesFlash()
  read.data.value = issued
  onDevice.value = issuedOnDevice
}

function onAbandoned(abandoned: Invoice): void {
  flash.value = takeSalesFlash()
  read.data.value = abandoned
}

function reload(): void {
  void read.reload()
}
</script>

<template>
  <section aria-labelledby="titre-facture" class="max-w-3xl space-y-6">
    <StateMessage v-if="flash" state="success" :title="flash" />

    <template v-if="invoice">
      <div class="space-y-1">
        <h1 id="titre-facture" class="text-2xl font-semibold tracking-tight break-words">
          {{ invoiceTitle(invoice.number) }}
        </h1>
        <p class="text-base text-muted">
          <span aria-hidden="true">{{ invoiceStatusSymbol(invoice.status) }}</span>
          {{ invoiceStatusLabel(invoice.status) }}
        </p>
        <!-- Provenance (L1D07) : le devis dont cette facture est née reste consultable. -->
        <p v-if="invoice.quote_id" class="text-sm">
          <RouterLink
            :to="{ name: 'devis-detail', params: { id: invoice.quote_id } }"
            class="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
            >Établie depuis un devis : ouvrir le devis d’origine</RouterLink
          >
        </p>
      </div>

      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'loading'"
        :state="read.state.value"
        subject="la facture"
        :error="read.error.value"
        not-found-title="Facture introuvable"
        @retry="reload"
      />

      <InvoiceEditor
        v-if="invoice.status === 'DRAFT'"
        :key="`brouillon-${invoice.id}`"
        :patient="patient"
        :patient-id="invoice.patient_id"
        :visit-id="invoice.visit_id"
        :initial="invoice"
        :local="onDevice"
        @issued="onIssued"
        @abandoned="onAbandoned"
        @stale="reload"
      />
      <InvoiceDetails
        v-else-if="invoice.status === 'ISSUED'"
        :invoice="invoice"
        :local="onDevice"
        @reload="reload"
      />
      <StateMessage v-else state="empty" title="Facture abandonnée">
        Ce brouillon a été abandonné : il n’a ni numéro ni effet financier.
      </StateMessage>

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>

    <template v-else>
      <h1 id="titre-facture" class="text-2xl font-semibold tracking-tight">Facture</h1>
      <StateMessage v-if="read.state.value === 'ready'" state="error" title="Facture inattendue">
        Le serveur a répondu avec une autre facture que celle demandée : rien n’est affiché.
      </StateMessage>
      <SalesReadMessage
        :state="read.state.value"
        subject="la facture"
        :error="read.error.value"
        not-found-title="Facture introuvable"
        @retry="reload"
      />
    </template>

    <!-- Session locale : la liste des factures demande le serveur, le retour va à la fiche du patient. -->
    <LinkButton v-if="session.status !== 'local'" :to="{ name: 'factures' }" variant="ghost"
      >Retour aux factures</LinkButton
    >
    <LinkButton
      v-else-if="invoice"
      :to="{ name: 'patient', params: { id: invoice.patient_id } }"
      variant="ghost"
      >Retour à la fiche du patient</LinkButton
    >
  </section>
</template>

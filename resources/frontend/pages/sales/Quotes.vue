<script setup lang="ts">
/**
 * Liste des devis (L1D07) : les plus récents d'abord, 25 par page, avec le destinataire (patient ou prospect), le
 * statut À L'INSTANT (un devis émis dont la validité est passée est « expiré ») et la dernière révision. Filtres
 * appliqués PAR LE SERVEUR : état et patient (`?patient=<identifiant>` depuis sa fiche). Une liste qui n'a pas pu être
 * lue est « indisponible », jamais « aucun devis ». Un devis n'est ni une facture ni un encaissement : aucun reste à
 * encaisser n'est affiché ici.
 */
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { listQuotes } from '@/app/services/quotes'
import { canOnScreen } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import { formatDateFr } from '@/components/form/format'
import SelectField from '@/components/form/SelectField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { quoteStatusLabel, quoteStatusSymbol, recipientLabel } from '@/domain/billing/quote'
import type { QuotePage, QuotesStatus } from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'
import { useServerRead } from '@/pages/today/useServerRead'

import { takeSalesFlash } from './flash'
import { formatMoney } from './format'
import SalesReadMessage from './SalesReadMessage.vue'

const STATUSES: readonly QuotesStatus[] = [
  'DRAFT',
  'ISSUED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
]

const route = useRoute()
const timeZone = clinicTimeZone()
/** Résultat de l'écran précédent (« Le brouillon de devis a été supprimé. »), lu une seule fois. */
const flash = takeSalesFlash()

const presetPatient = (() => {
  const value = route.query['patient']
  return typeof value === 'string' && isUlid(value) ? value : null
})()

const status = ref<string | null>(null)
const page = ref(1)
const patientId = ref<string | null>(presetPatient)

const statusFilter = computed<QuotesStatus | null>(
  () => STATUSES.find((candidate) => candidate === status.value) ?? null,
)
const statusOptions = STATUSES.map((value) => ({ value, label: quoteStatusLabel(value) }))

const read = useServerRead<QuotePage>(
  () => listQuotes({ status: statusFilter.value, patientId: patientId.value, page: page.value }),
  { isEmpty: (result) => result.data.length === 0 },
)

watch([statusFilter, patientId], () => {
  page.value = 1
  void read.reload()
})

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

const canCreate = computed(() => canOnScreen('invoice.create'))
const result = computed(() => read.data.value)
const shown = computed(() => result.value?.data ?? [])

const newQuoteLink = computed(() =>
  patientId.value === null
    ? { name: 'devis-nouveau' }
    : { name: 'devis-nouveau', query: { patient: patientId.value } },
)
</script>

<template>
  <section aria-labelledby="titre-devis" class="max-w-3xl space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h1 id="titre-devis" class="text-2xl font-semibold tracking-tight">Devis</h1>
      <LinkButton v-if="canCreate" :to="newQuoteLink" variant="primary">Nouveau devis</LinkButton>
    </div>
    <p class="text-base text-muted">
      Un devis est une proposition remise au client : il ne vaut pas facture, n’enregistre aucun
      règlement et ne réserve aucun article. La facture naît seulement d’une conversion explicite.
    </p>

    <StateMessage v-if="flash" state="success" :title="flash" />

    <form
      role="search"
      aria-label="Filtrer les devis"
      class="grid gap-4 sm:grid-cols-2"
      @submit.prevent
    >
      <SelectField
        v-model="status"
        label="État"
        placeholder="Tous les états"
        :options="statusOptions"
        control-id="devis-etat"
      />
      <div v-if="patientId" class="space-y-2">
        <p class="text-base">Devis du patient sélectionné.</p>
        <AppButton variant="ghost" @click="patientId = null">Tous les destinataires</AppButton>
      </div>
    </form>

    <SalesReadMessage
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="les devis"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <StateMessage v-else-if="read.state.value === 'empty'" state="empty" title="Aucun devis">
      Le serveur n’a aucun devis pour ces critères.
    </StateMessage>

    <template v-else-if="result !== null">
      <ul class="space-y-3">
        <li
          v-for="quote in shown"
          :key="quote.id"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <RouterLink
              :to="{ name: 'devis-detail', params: { id: quote.id } }"
              class="inline-flex min-h-11 items-center font-semibold break-words text-primary underline underline-offset-4"
              >{{ quote.number ?? 'Brouillon sans numéro' }}</RouterLink
            >
            <span class="text-base"
              ><span aria-hidden="true">{{ quoteStatusSymbol(quote.effective_status) }}</span>
              {{ quoteStatusLabel(quote.effective_status) }}</span
            >
          </p>
          <p class="text-base break-words">{{ recipientLabel(quote.recipient) }}</p>
          <p class="text-sm text-muted">
            <template v-if="quote.issued_at === null">Non émis</template>
            <template v-else
              >Émis le {{ formatInstantFr(quote.issued_at) }} · révision
              {{ quote.current_revision }}</template
            >
            <template v-if="quote.valid_until">
              · valable jusqu’au {{ formatDateFr(quote.valid_until) }}</template
            >
          </p>
          <p class="text-base">
            Total proposé : <span class="tabular-nums">{{ formatMoney(quote.total_gross) }}</span>
          </p>
        </li>
      </ul>

      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        label="Pagination des devis"
        unit="devis"
        @page="goToPage"
      />

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>

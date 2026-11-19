<script setup lang="ts">
/**
 * Journal chronologique unifié d'une session de caisse (B05 + A3) : fusionne à l'heure exacte les
 * factures encaissées, les dépenses, les entrées/sorties motivées, les contre-écritures et les
 * remboursements rattachés à la session. Lecture serveur seule, sans statut inventé.
 */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { formatInstantFr } from '@/app/clinicTime'
import { getCashSessionReport } from '@/app/services/billing'
import StateMessage from '@/components/feedback/StateMessage.vue'
import type { CashSessionReport } from '@/domain/contracts/generated'
import { formatMoney, paymentMethodLabel } from '@/pages/sales/format'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const props = withDefaults(
  defineProps<{
    sessionId: string
    refreshKey?: number
  }>(),
  { refreshKey: 0 },
)

type JournalFilter = 'all' | 'payments' | 'movements'
const filter = ref<JournalFilter>('all')

const read = useServerRead<CashSessionReport>(() => getCashSessionReport(props.sessionId))
watch(
  () => `${props.sessionId}:${props.refreshKey}`,
  () => {
    void read.reload()
  },
)

const report = computed(() => read.data.value)
const entries = computed(() => report.value?.journal ?? [])
const filtered = computed(() => {
  switch (filter.value) {
    case 'payments':
      return entries.value.filter(
        (entry) =>
          entry.entry_type === 'PAYMENT' ||
          entry.entry_type === 'PAYMENT_REVERSAL' ||
          entry.entry_type === 'REFUND',
      )
    case 'movements':
      return entries.value.filter((entry) => entry.entry_type === 'CASH_MOVEMENT')
    default:
      return entries.value
  }
})

const paymentCount = computed(
  () => entries.value.filter((entry) => entry.entry_type === 'PAYMENT').length,
)
const movementCount = computed(
  () => entries.value.filter((entry) => entry.entry_type === 'CASH_MOVEMENT').length,
)

function signedFormatted(amount: number): string {
  return amount > 0 ? `+${formatMoney(amount)}` : `−${formatMoney(Math.abs(amount))}`
}
</script>

<template>
  <section aria-labelledby="titre-journal-caisse" class="space-y-4 border-t border-line pt-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="space-y-1">
        <h2 id="titre-journal-caisse" class="text-lg font-semibold">
          Journal chronologique de la caisse
        </h2>
        <p class="text-sm text-muted">
          Factures encaissées (à l’heure d’émission/encaissement), dépenses et mouvements manuels de
          la session.
        </p>
      </div>
      <div v-if="entries.length > 0" class="flex flex-wrap gap-2" role="group" aria-label="Filtrer">
        <button
          type="button"
          class="min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition"
          :class="
            filter === 'all'
              ? 'border-primary bg-primary text-primary-contrast'
              : 'border-line bg-surface text-ink hover:border-gold'
          "
          :aria-pressed="filter === 'all'"
          @click="filter = 'all'"
        >
          Tout ({{ entries.length }})
        </button>
        <button
          type="button"
          class="min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition"
          :class="
            filter === 'payments'
              ? 'border-primary bg-primary text-primary-contrast'
              : 'border-line bg-surface text-ink hover:border-gold'
          "
          :aria-pressed="filter === 'payments'"
          @click="filter = 'payments'"
        >
          Factures & reçus ({{ paymentCount }})
        </button>
        <button
          type="button"
          class="min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition"
          :class="
            filter === 'movements'
              ? 'border-primary bg-primary text-primary-contrast'
              : 'border-line bg-surface text-ink hover:border-gold'
          "
          :aria-pressed="filter === 'movements'"
          @click="filter = 'movements'"
        >
          Dépenses & mouvements ({{ movementCount }})
        </button>
      </div>
    </div>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="le journal de la caisse"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <StateMessage
      v-else-if="filtered.length === 0"
      state="empty"
      title="Aucune écriture dans ce filtre"
    >
      Les factures émises, encaissements, dépenses et mouvements apparaissent ici dans l’ordre
      chronologique.
    </StateMessage>

    <ul v-else class="space-y-2">
      <li
        v-for="entry in filtered"
        :key="`${entry.entry_type}-${entry.id}`"
        class="space-y-1 rounded-xl border border-line bg-surface p-3 shadow-card"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div class="min-w-0 flex-1 space-y-0.5">
            <p class="font-semibold break-words">
              <RouterLink
                v-if="entry.invoice_id && entry.invoice_number"
                :to="{ name: 'facture', params: { id: entry.invoice_id } }"
                class="text-primary underline decoration-gold/60 underline-offset-2 hover:text-gold-ink"
              >
                {{ entry.label }}
              </RouterLink>
              <template v-else>{{ entry.label }}</template>
            </p>
            <p class="text-sm text-muted break-words">
              {{ formatInstantFr(entry.occurred_at) }} · {{ paymentMethodLabel(entry.method) }}
              <template v-if="entry.patient_name"> · {{ entry.patient_name }}</template>
              <template v-if="entry.detail"> · {{ entry.detail }}</template>
              <template v-if="entry.reference"> · Réf. {{ entry.reference }}</template>
            </p>
          </div>
          <span
            class="shrink-0 font-semibold tabular-nums"
            :class="entry.signed_amount >= 0 ? 'text-success-ink' : 'text-danger'"
          >
            {{ signedFormatted(entry.signed_amount) }}
          </span>
        </div>
      </li>
    </ul>
  </section>
</template>

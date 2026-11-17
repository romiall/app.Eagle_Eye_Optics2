<script setup lang="ts">
/**
 * Bloc de restitution comptable Q13 (L1D06) sur l'écran « Finance du cabinet » :
 * chiffre d'affaires net (hors reprises papier), encaissements par mode, dépenses catégorisées,
 * rapprochements validés / en brouillon, impayés à l'instant et valorisation au coût connu,
 * sans jamais additionner ni mélanger deux grandeurs distinctes, avec téléchargement CSV UTF-8.
 */
import { ref, shallowRef } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { accountingExportDownloadUrl, getAccountingExport } from '@/app/services/reconciliations'
import StateMessage from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { paymentMethodLabel } from '@/documents/data/labels'
import {
  ACCOUNTING_SECTION_LABELS,
  RECONCILIATION_STATUS_LABELS,
} from '@/domain/cash/reconciliation'
import type { AccountingExportReport } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

const props = defineProps<{ from: string; to: string }>()

const loading = ref(false)
const error = ref<string | null>(null)
const report = shallowRef<AccountingExportReport | null>(null)

async function loadPreview(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    report.value = await getAccountingExport(props.from, props.to)
  } catch (failure) {
    error.value =
      failure instanceof NetworkUnavailable
        ? 'Serveur indisponible : export comptable Q13 non chargé.'
        : failure instanceof ApiError
          ? failure.message
          : 'Impossible de charger la restitution comptable.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section
    aria-labelledby="titre-export-q13"
    class="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h2 id="titre-export-q13" class="text-lg font-semibold">
          Restitution comptable Q13 (export structuré)
        </h2>
        <p class="text-sm text-muted">
          Sépare strictement chiffre d’affaires net, encaissements, dépenses de caisse,
          rapprochements par canal, créances à l’instant et valorisation du stock.
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :pending="loading"
          pending-label="Calcul…"
          @click="loadPreview"
          >Aperçu comptable Q13</AppButton
        >
        <a
          :href="accountingExportDownloadUrl(props.from, props.to)"
          download
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-canvas px-4 py-2 text-base font-medium text-ink transition hover:bg-surface"
          >Télécharger l’export CSV Q13</a
        >
      </div>
    </div>

    <StateMessage v-if="error" state="offline" title="Restitution Q13 indisponible">{{
      error
    }}</StateMessage>

    <div v-if="report" class="space-y-4">
      <dl class="grid gap-3 rounded-xl border border-line bg-canvas p-4 sm:grid-cols-3">
        <div>
          <dt class="text-xs text-muted">CA net (hors reprises papier)</dt>
          <dd class="font-bold tabular-nums">{{ formatMoney(report.revenue.net_revenue) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Encaissements nets</dt>
          <dd class="font-bold tabular-nums">{{ formatMoney(report.collections.net_total) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Dépenses de caisse</dt>
          <dd class="font-bold tabular-nums">{{ formatMoney(report.expenses.total_amount) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Rapprochements validés / brouillons</dt>
          <dd class="font-semibold tabular-nums">
            {{ report.reconciliations.validated_count }} validé(s) ·
            {{ report.reconciliations.draft_count }} brouillon(s)
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Créances clients à l’instant</dt>
          <dd class="font-semibold tabular-nums">
            {{ formatMoney(report.receivables_at_read.amount_due) }}
          </dd>
        </div>
        <div v-if="report.stock_valuation_at_read">
          <dt class="text-xs text-muted">Stock au coût connu</dt>
          <dd class="font-semibold tabular-nums">
            {{ formatMoney(report.stock_valuation_at_read.known_cost_value) }}
          </dd>
        </div>
      </dl>

      <div v-if="report.reconciliations.by_method.length > 0" class="space-y-2">
        <h3 class="text-sm font-semibold">Synthèse des rapprochements par canal</h3>
        <ul class="grid gap-2 sm:grid-cols-2">
          <li
            v-for="rec in report.reconciliations.by_method"
            :key="rec.method"
            class="rounded-lg border border-line bg-canvas p-3 text-sm tabular-nums"
          >
            <p class="font-semibold">
              {{ paymentMethodLabel(rec.method) }} · {{ rec.validated_count }} validé(s)
            </p>
            <p class="text-xs text-muted">
              Attendu {{ formatMoney(rec.expected_total) }} · Relevé
              {{ formatMoney(rec.statement_total) }} · Écart {{ formatMoney(rec.variance_total) }}
            </p>
          </li>
        </ul>
      </div>

      <p class="text-xs text-muted">
        {{ report.lines.length }} écriture(s) dans le journal CSV (
        {{
          report.lines[0]
            ? `${ACCOUNTING_SECTION_LABELS[report.lines[0].section]}${report.lines[0].reconciliation_status ? ` · ${RECONCILIATION_STATUS_LABELS[report.lines[0].reconciliation_status]}` : ''}`
            : 'aucune écriture sur la période'
        }}).
      </p>
    </div>
  </section>
</template>

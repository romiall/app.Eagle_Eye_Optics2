<script setup lang="ts">
/**
 * Tableau de bord unifié de l'accueil : sélecteur de période (« Aujourd’hui » par défaut pour le
 * rapport de fin de journée, semaine, mois, année ou intervalle), indicateurs clés filtrés par les
 * droits du compte (finance du cabinet, activité d'accueil, activité clinique) puis blocs complets
 * des statistiques sur la même période. Lecture serveur seule, sans cumul ni statut inventé.
 */
import { computed, ref, watch } from 'vue'

import { clinicToday, formatDayFr } from '@/app/clinicTime'
import { getFinancialReport } from '@/app/services/billing'
import type { ReadOutcome } from '@/app/services/reads'
import { getActivityReport, getClinicalReport } from '@/app/services/reports'
import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { ActivityReport, ClinicalReport, FinancialReport } from '@/domain/contracts/generated'
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  periodError,
  presetPeriod,
} from '@/domain/reports/statistics'
import { CivilDate } from '@/domain/values/civilDate'
import ActivityStatistics from '@/pages/reports/ActivityStatistics.vue'
import Clinical from '@/pages/reports/Clinical.vue'
import { formatMoney } from '@/pages/sales/format'
import { useServerRead } from '@/pages/today/useServerRead'

const canReadFinance = computed(
  () => canOnScreen('finance.global.read') && moduleOpenOnScreen('reports'),
)
const canReadActivity = computed(
  () => canOnScreen('statistics.activity') && moduleOpenOnScreen('reports'),
)
const canReadClinical = computed(
  () => canOnScreen('statistics.clinical') && moduleOpenOnScreen('reports'),
)
const hasAnySection = computed(
  () => canReadFinance.value || canReadActivity.value || canReadClinical.value,
)

const preset = ref<PeriodPreset | 'custom'>('day')
const initial = presetPeriod('day', clinicToday())
const shown = ref({ from: initial.from.toString(), to: initial.to.toString() })
const customFrom = ref<string | null>(shown.value.from)
const customTo = ref<string | null>(shown.value.to)
const customError = ref<string | null>(null)

const title = computed(() => {
  const from = formatDayFr(CivilDate.fromString(shown.value.from))
  if (shown.value.from === shown.value.to) return `Période : ${from}`
  return `Période : du ${from} au ${formatDayFr(CivilDate.fromString(shown.value.to))}`
})

function emptyOutcome<T>(): ReadOutcome<T | null> {
  return { data: null, freshness: { serverAsOf: null, complete: false }, live: false }
}

const financialRead = useServerRead<FinancialReport | null>(() =>
  canReadFinance.value
    ? getFinancialReport(shown.value.from, shown.value.to)
    : Promise.resolve(emptyOutcome<FinancialReport>()),
)
const activityRead = useServerRead<ActivityReport | null>(() =>
  canReadActivity.value
    ? getActivityReport(shown.value.from, shown.value.to)
    : Promise.resolve(emptyOutcome<ActivityReport>()),
)
const clinicalRead = useServerRead<ClinicalReport | null>(() =>
  canReadClinical.value
    ? getClinicalReport(shown.value.from, shown.value.to)
    : Promise.resolve(emptyOutcome<ClinicalReport>()),
)

function reloadAll(): void {
  if (canReadFinance.value) void financialRead.reload()
  if (canReadActivity.value) void activityRead.reload()
  if (canReadClinical.value) void clinicalRead.reload()
}

watch(
  () => [
    shown.value.from,
    shown.value.to,
    canReadFinance.value,
    canReadActivity.value,
    canReadClinical.value,
  ],
  () => {
    reloadAll()
  },
)

function choose(next: PeriodPreset): void {
  const period = presetPeriod(next, clinicToday())
  preset.value = next
  customError.value = null
  shown.value = { from: period.from.toString(), to: period.to.toString() }
  customFrom.value = shown.value.from
  customTo.value = shown.value.to
}

function parsed(value: string | null): CivilDate | null | 'invalid' {
  try {
    return CivilDate.parse(value)
  } catch {
    return 'invalid'
  }
}

function applyCustom(): void {
  const from = parsed(customFrom.value)
  const to = parsed(customTo.value)
  if (from === 'invalid' || to === 'invalid') {
    customError.value = 'Date invalide : JJ/MM/AAAA ou AAAA-MM-JJ.'
    return
  }
  const error = periodError(from, to)
  customError.value = error
  if (error !== null || from === null || to === null) return
  preset.value = 'custom'
  shown.value = { from: from.toString(), to: to.toString() }
}

const financial = computed(() =>
  financialRead.state.value === 'ready' ? financialRead.data.value : null,
)
const activity = computed(() =>
  activityRead.state.value === 'ready' ? activityRead.data.value : null,
)
const clinical = computed(() =>
  clinicalRead.state.value === 'ready' ? clinicalRead.data.value : null,
)

const netCashBalance = computed(() => {
  if (financial.value === null) return null
  return financial.value.collections.net_total - financial.value.expenses.total
})

function signedMoney(amount: number): string {
  if (amount > 0) return formatMoney(amount)
  if (amount < 0) return `−${formatMoney(Math.abs(amount))}`
  return formatMoney(0)
}

function isUnavailable(state: string): boolean {
  return state === 'offline' || state === 'error'
}

const anyKpiUnavailable = computed(
  () =>
    (canReadFinance.value && isUnavailable(financialRead.state.value)) ||
    (canReadActivity.value && isUnavailable(activityRead.state.value)) ||
    (canReadClinical.value && isUnavailable(clinicalRead.state.value)),
)
</script>

<template>
  <section v-if="hasAnySection" aria-labelledby="titre-tableau-bord" class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="titre-tableau-bord" class="text-xl font-semibold tracking-tight">
          Tableau de bord et statistiques
        </h2>
        <p class="text-sm text-muted">
          Synthèse de la période choisie (calculée par le serveur selon vos droits).
        </p>
      </div>
      <AppButton variant="ghost" @click="reloadAll">
        <AppIcon name="refresh" :size="18" />
        Actualiser le tableau de bord
      </AppButton>
    </div>

    <div role="group" aria-label="Choisir la période du tableau de bord" class="card space-y-4 p-4">
      <div
        class="grid grid-cols-2 gap-1 rounded-xl border border-line bg-canvas p-1 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap"
      >
        <AppButton
          v-for="option in PERIOD_PRESETS"
          :key="option"
          variant="ghost"
          :pressed="preset === option"
          @click="choose(option)"
          >{{ PERIOD_LABELS[option] }}</AppButton
        >
      </div>
      <form class="toolbar border-t border-line pt-4" novalidate @submit.prevent="applyCustom">
        <div class="min-w-0 sm:flex-1">
          <DateField v-model="customFrom" label="Du" control-id="accueil-stats-debut" />
        </div>
        <div class="min-w-0 sm:flex-1">
          <DateField
            v-model="customTo"
            label="Au"
            control-id="accueil-stats-fin"
            :error="customError"
          />
        </div>
        <AppButton type="submit" variant="secondary" :pressed="preset === 'custom'"
          >Afficher la période</AppButton
        >
      </form>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p role="status" class="flex items-center gap-2 text-lg font-semibold">
        <AppIcon name="calendar" :size="20" class="text-gold" />
        <span class="min-w-0">{{ title }}</span>
      </p>
      <FreshnessNote
        v-if="financial && financialRead.freshness.value"
        :freshness="financialRead.freshness.value"
      />
    </div>

    <StateMessage
      v-if="financial && !financial.freshness.complete"
      state="offline"
      title="Totaux possiblement incomplets"
    >
      Au moins un poste hors ligne n’est pas encore synchronisé : les indicateurs peuvent manquer
      des opérations restées sur ce poste.
    </StateMessage>

    <StateMessage
      v-if="anyKpiUnavailable"
      state="error"
      title="Serveur indisponible pour l’instant"
    >
      Les indicateurs n’ont pas tous pu être relus. Vérifiez le réseau puis actualisez.
      <template #action>
        <AppButton variant="secondary" @click="reloadAll">Réessayer</AppButton>
      </template>
    </StateMessage>

    <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <template v-if="canReadFinance">
        <div class="card card-accent flex min-w-0 flex-col gap-1 p-4">
          <dt class="text-sm font-medium text-muted">Chiffre d’affaires net</dt>
          <dd class="text-2xl font-bold tabular-nums">
            {{ financial ? formatMoney(financial.revenue.net) : '—' }}
          </dd>
          <dd v-if="financial" class="text-xs text-muted">
            {{ financial.revenue.issued.count }} facture(s) · brut
            {{ formatMoney(financial.revenue.issued.total_gross) }}
            <template v-if="financial.revenue.credited.amount_gross > 0">
              · avoirs −{{ formatMoney(financial.revenue.credited.amount_gross) }}
            </template>
          </dd>
        </div>

        <div class="card card-accent flex min-w-0 flex-col gap-1 p-4">
          <dt class="text-sm font-medium text-muted">Encaissé net</dt>
          <dd class="text-2xl font-bold tabular-nums">
            {{ financial ? formatMoney(financial.collections.net_total) : '—' }}
          </dd>
          <dd v-if="financial" class="text-xs text-muted">
            Reste à encaisser : {{ formatMoney(financial.receivables.amount_due) }}
          </dd>
        </div>

        <div class="card card-accent flex min-w-0 flex-col gap-1 p-4">
          <dt class="text-sm font-medium text-muted">Dépenses</dt>
          <dd class="text-2xl font-bold tabular-nums">
            {{ financial ? formatMoney(financial.expenses.total) : '—' }}
          </dd>
          <dd v-if="financial" class="text-xs text-muted">
            Tiroir {{ formatMoney(financial.expenses.cash_drawer) }} · hors tiroir
            {{ formatMoney(financial.expenses.other_methods) }}
          </dd>
        </div>

        <div class="card card-accent flex min-w-0 flex-col gap-1 p-4">
          <dt class="text-sm font-medium text-muted">Solde net (encaissé − dépenses)</dt>
          <dd class="text-2xl font-bold tabular-nums">
            {{ netCashBalance !== null ? signedMoney(netCashBalance) : '—' }}
          </dd>
          <dd v-if="financial" class="text-xs text-muted">
            {{ financial.expenses.count }} dépense(s) enregistrée(s)
          </dd>
        </div>
      </template>

      <div v-if="canReadActivity" class="card card-accent flex min-w-0 flex-col gap-1 p-4">
        <dt class="text-sm font-medium text-muted">Visites totales</dt>
        <dd class="text-2xl font-bold tabular-nums">
          {{ activity ? activity.visits : '—' }}
        </dd>
        <dd v-if="activity" class="text-xs text-muted">
          {{ activity.patients }} patient(s) · {{ activity.new_patients }} nouveau(x)
        </dd>
      </div>

      <div v-if="canReadClinical" class="card card-accent flex min-w-0 flex-col gap-1 p-4">
        <dt class="text-sm font-medium text-muted">Consultations</dt>
        <dd class="text-2xl font-bold tabular-nums">
          {{ clinical ? clinical.consultations : '—' }}
        </dd>
        <dd v-if="clinical" class="text-xs text-muted">
          {{ clinical.consultations_completed }} terminée(s) ·
          {{ clinical.prescriptions_validated }} ordonnance(s) optique
        </dd>
      </div>
    </dl>

    <ActivityStatistics v-if="canReadActivity" :from="shown.from" :to="shown.to" />
    <Clinical v-if="canReadClinical" :from="shown.from" :to="shown.to" />
  </section>
</template>

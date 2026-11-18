<script setup lang="ts">
/**
 * Tableaux et exports de gestion multi-domaines (L1D09) — module « reports », EN LIGNE :
 * consolide Finance, Stock, Atelier, Patients et Clinique selon les droits effectifs du compte et
 * les modules actifs, avec comparaison à la période précédente comparable (N vs N-1), inconnus
 * explicites jamais maquillés en zéro, définitions/empreinte SHA-256 et téléchargement CSV / JSON.
 */
import { computed, ref } from 'vue'

import { clinicToday, formatDayFr, formatInstantFr } from '@/app/clinicTime'
import { getManagementReport, managementDownloadUrl } from '@/app/services/reports'
import { canOnScreen } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatTile from '@/components/layout/StatTile.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { paymentMethodLabel } from '@/documents/data/labels'
import { deviceNotice, freshnessHeadline, signedAmount } from '@/domain/billing/financialReport'
import { termLabel } from '@/domain/clinical/terms'
import type { ManagementReport } from '@/domain/contracts/generated'
import { reasonLabel } from '@/domain/patients/visits'
import {
  exclusionReasonLabel,
  formatBpsPercent,
  formatCountDelta,
  formatMoneyDelta,
  sectionLabel,
  unknownDomainLabel,
  workshopStatusLabel,
} from '@/domain/reports/management'
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  periodError,
  presetPeriod,
} from '@/domain/reports/statistics'
import { CivilDate } from '@/domain/values/civilDate'
import { formatMoney } from '@/domain/values/money'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const preset = ref<PeriodPreset | 'custom'>('month')
const initial = presetPeriod('month', clinicToday())
const shown = ref({ from: initial.from.toString(), to: initial.to.toString() })
const customFrom = ref<string | null>(shown.value.from)
const customTo = ref<string | null>(shown.value.to)
const customError = ref<string | null>(null)

const read = useServerRead<ManagementReport>(() =>
  getManagementReport(shown.value.from, shown.value.to),
)
const report = computed(() => read.data.value)

const periodSummary = computed(() => {
  const from = formatDayFr(CivilDate.fromString(shown.value.from))
  const current =
    shown.value.from === shown.value.to
      ? from
      : `du ${from} au ${formatDayFr(CivilDate.fromString(shown.value.to))}`
  if (report.value === null) return `Période : ${current}`
  const prevFrom = formatDayFr(CivilDate.fromString(report.value.previous_period.from))
  const prevTo = formatDayFr(CivilDate.fromString(report.value.previous_period.to))
  const previous = prevFrom === prevTo ? prevFrom : `du ${prevFrom} au ${prevTo}`
  return `Période : ${current} (${report.value.period.days} j) — comparée à N-1 : ${previous}`
})

const freshnessSummary = computed(() =>
  report.value === null ? null : freshnessHeadline(report.value.freshness),
)

const deviceNotices = computed(() => {
  const current = report.value
  if (current === null) return []
  return current.freshness.devices
    .map((device) => ({
      id: device.device_id,
      text: deviceNotice(
        device,
        current.freshness.silence_hours,
        device.last_sync_at === null ? null : formatInstantFr(device.last_sync_at),
      ),
    }))
    .filter((item): item is { id: string; text: string } => item.text !== null)
})

const canSeeStatistics = computed(
  () => canOnScreen('statistics.activity') || canOnScreen('statistics.clinical'),
)
const canSeeExports = computed(() => canOnScreen('export.global') || canOnScreen('clinical.export'))

function choose(next: PeriodPreset): void {
  const period = presetPeriod(next, clinicToday())
  preset.value = next
  customError.value = null
  shown.value = { from: period.from.toString(), to: period.to.toString() }
  customFrom.value = shown.value.from
  customTo.value = shown.value.to
  void read.reload()
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
  void read.reload()
}
</script>

<template>
  <section aria-labelledby="titre-rapports-gestion" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-rapports-gestion"
      title="Rapports de gestion"
      icon="reports"
      subtitle="Synthèse consolidée Finance, Stock, Atelier, Patients et Clinique selon vos droits et les modules ouverts. Comparaison N vs N-1 sur fenêtres civiles identiques, sans double compte ni valeur inconnue assimilée à zéro."
    />

    <div role="group" aria-label="Choisir la période" class="card space-y-4 p-4 sm:p-5">
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
          <DateField v-model="customFrom" label="Du" control-id="gestion-debut" />
        </div>
        <div class="min-w-0 sm:flex-1">
          <DateField v-model="customTo" label="Au" control-id="gestion-fin" :error="customError" />
        </div>
        <AppButton type="submit" variant="secondary" :pressed="preset === 'custom'"
          >Afficher la période</AppButton
        >
      </form>
      <div class="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <a
          :href="managementDownloadUrl(shown.from, shown.to, 'csv')"
          download
          class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-base font-semibold text-primary-contrast shadow-card hover:bg-primary-strong"
        >
          <AppIcon name="download" :size="18" />
          Télécharger le CSV
        </a>
        <a
          :href="managementDownloadUrl(shown.from, shown.to, 'json')"
          download
          class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-canvas px-4 py-2 text-base font-medium text-ink transition hover:bg-surface"
        >
          <AppIcon name="download" :size="18" />
          Télécharger le JSON
        </a>
        <LinkButton v-if="canSeeStatistics" :to="{ name: 'statistiques' }" variant="secondary">
          Statistiques détaillées
        </LinkButton>
        <LinkButton v-if="canSeeExports" :to="{ name: 'parametres-exports' }" variant="secondary">
          Exports contrôlés
        </LinkButton>
      </div>
    </div>

    <p role="status" class="flex items-center gap-2 text-lg font-semibold">
      <AppIcon name="calendar" :size="20" class="text-gold" />
      <span class="min-w-0">{{ periodSummary }}</span>
    </p>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="les rapports de gestion"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-if="report">
      <StateMessage
        v-if="freshnessSummary && !report.freshness.complete"
        state="error"
        :title="freshnessSummary.text"
      >
        <ul v-if="deviceNotices.length > 0" class="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li v-for="item in deviceNotices" :key="item.id">{{ item.text }}</li>
        </ul>
      </StateMessage>

      <SectionCard
        v-if="report.excluded_sections.length > 0"
        title="Sections non affichées"
        title-id="titre-sections-exclues"
        icon="info"
        description="Ces domaines restent masqués pour ce compte ou cette installation, sans être comptés à zéro."
      >
        <ul class="space-y-2 text-sm">
          <li
            v-for="item in report.excluded_sections"
            :key="item.section"
            class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2"
          >
            <span class="font-semibold">{{ sectionLabel(item.section) }}</span>
            <span class="text-muted">{{ exclusionReasonLabel(item.reason) }}</span>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        v-if="report.unknowns.length > 0"
        title="Éléments inconnus ou non assimilés à zéro"
        title-id="titre-inconnus-gestion"
        icon="alert"
        description="Les informations manquantes restent signalées explicitement à part des totaux certifiés."
      >
        <ul class="space-y-2">
          <li
            v-for="item in report.unknowns"
            :key="item.code"
            class="rounded-lg border border-line bg-canvas p-3 text-sm"
          >
            <p class="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
              <span>{{ unknownDomainLabel(item.domain) }} · {{ item.label }}</span>
              <span class="tabular-nums">{{ item.count }} élément(s)</span>
            </p>
            <p class="mt-1 text-muted">{{ item.note }}</p>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        v-if="report.finance"
        title="Finance du cabinet"
        title-id="titre-gestion-finance"
        icon="sales"
        description="Chiffre d’affaires net, encaissements nets, dépenses et créances restent strictement distincts ; les devis et créances reprises du papier restent hors chiffre d’affaires."
      >
        <dl class="stat-grid">
          <StatTile
            label="Chiffre d’affaires net"
            :value="formatMoney(report.finance.net_revenue.current)"
            tone="gold"
            :hint="`N-1 : ${formatMoney(report.finance.net_revenue.previous)} · Écart : ${formatMoneyDelta(report.finance.net_revenue.delta, report.finance.net_revenue.delta_pct_bps)}`"
          />
          <StatTile
            label="Encaissements nets"
            :value="formatMoney(report.finance.net_collections.current)"
            tone="success"
            :hint="`N-1 : ${formatMoney(report.finance.net_collections.previous)} · Écart : ${formatMoneyDelta(report.finance.net_collections.delta, report.finance.net_collections.delta_pct_bps)}`"
          />
          <StatTile
            label="Dépenses de caisse"
            :value="formatMoney(report.finance.expenses_total.current)"
            :hint="`N-1 : ${formatMoney(report.finance.expenses_total.previous)} · Écart : ${formatMoneyDelta(report.finance.expenses_total.delta, report.finance.expenses_total.delta_pct_bps)}`"
          />
          <StatTile
            label="Créances à la lecture"
            :value="formatMoney(report.finance.receivables_at_read.amount_due)"
            :hint="`${report.finance.receivables_at_read.invoices_count} facture(s), dont ${report.finance.receivables_at_read.of_which_legacy_count} reprise(s) papier (${formatMoney(report.finance.receivables_at_read.of_which_legacy_amount)})`"
          />
          <StatTile
            label="Crédits à rembourser"
            :value="formatMoney(report.finance.receivables_at_read.refundable_credit_amount)"
          />
          <StatTile
            label="Devis émis (hors CA)"
            :value="report.finance.quotes_pipeline.issued_count"
            :hint="`${formatMoney(report.finance.quotes_pipeline.issued_amount)} · Acceptés ${report.finance.quotes_pipeline.accepted_count} · Convertis ${report.finance.quotes_pipeline.converted_count}`"
          />
        </dl>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Encaissements nets par mode</h3>
            <p v-if="report.finance.collections_by_method.length === 0" class="mt-1 text-muted">
              Aucun encaissement sur la période.
            </p>
            <ul v-else class="mt-2 space-y-1">
              <li
                v-for="row in report.finance.collections_by_method"
                :key="row.method"
                class="flex items-baseline justify-between gap-2 tabular-nums"
              >
                <span>{{ paymentMethodLabel(row.method) }}</span>
                <span class="font-medium">{{ signedAmount(row.net_amount, formatMoney) }}</span>
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Rapprochements et sessions de caisse</h3>
            <dl class="mt-2 space-y-1 tabular-nums">
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Rapprochements validés / brouillons</dt>
                <dd>
                  {{ report.finance.reconciliations_period.validated_count }} /
                  {{ report.finance.reconciliations_period.draft_count }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Écart rapprochements (lignes contestées)</dt>
                <dd>
                  {{
                    signedAmount(report.finance.reconciliations_period.variance_total, formatMoney)
                  }}
                  ({{ report.finance.reconciliations_period.disputed_lines }})
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sessions clôturées / ouvertes</dt>
                <dd>
                  {{ report.finance.cash_sessions.closed_count }} /
                  {{ report.finance.cash_sessions.open_count }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Écart de caisse / après clôture</dt>
                <dd>
                  {{ signedAmount(report.finance.cash_sessions.variance_total, formatMoney) }} /
                  {{ formatMoney(report.finance.cash_sessions.post_closure_reversals) }}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        v-if="report.stock"
        title="État du stock"
        title-id="titre-gestion-stock"
        icon="stock"
        description="Positions disponibles à l’instant de lecture, articles sous seuil, alertes actives et mouvements de la période. La valorisation au coût d’achat n’est visible qu’avec le droit dédié."
      >
        <dl class="stat-grid">
          <StatTile
            label="Valorisation au coût connu"
            :value="
              report.stock.valuation_at_read
                ? formatMoney(report.stock.valuation_at_read.known_cost_value)
                : null
            "
            :unavailable-text="
              report.stock.valuation_hidden_reason === 'PERMISSION_MISSING'
                ? 'Masquée (droit valorisation absent)'
                : 'Non disponible'
            "
            :hint="
              report.stock.valuation_at_read
                ? `${report.stock.valuation_at_read.total_positions} positions · ${report.stock.valuation_at_read.unknown_cost_positions} sans coût connu`
                : undefined
            "
          />
          <StatTile label="Positions actives" :value="report.stock.positions_count" />
          <StatTile
            label="Articles sous seuil"
            :value="report.stock.low_stock_items_count"
            :tone="report.stock.low_stock_items_count > 0 ? 'warning' : 'neutral'"
          />
          <StatTile
            label="Alertes actives"
            :value="report.stock.open_alerts.total"
            :tone="report.stock.open_alerts.total > 0 ? 'warning' : 'neutral'"
            :hint="`Seuil ${report.stock.open_alerts.low_stock} · Péremption ${report.stock.open_alerts.expiring} · Périmé ${report.stock.open_alerts.expired} · Sans échéance ${report.stock.open_alerts.without_due_date}`"
          />
        </dl>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Par catégorie</h3>
            <p v-if="report.stock.by_category.length === 0" class="mt-1 text-muted">
              Aucune position active en stock.
            </p>
            <ul v-else class="mt-2 space-y-1">
              <li
                v-for="cat in report.stock.by_category"
                :key="cat.category_code"
                class="flex flex-wrap items-baseline justify-between gap-2 tabular-nums"
              >
                <span>{{ cat.category_name }} ({{ cat.items_count }} art.)</span>
                <span>
                  Qté {{ cat.quantity_on_hand }}
                  <template v-if="cat.known_cost_value !== null">
                    · {{ formatMoney(cat.known_cost_value) }}</template
                  >
                </span>
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Mouvements sur la période</h3>
            <dl class="mt-2 space-y-1 tabular-nums">
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Réceptions validées</dt>
                <dd>{{ report.stock.movements_in_period.receipts_validated_count }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Ajustements / casses</dt>
                <dd>{{ report.stock.movements_in_period.adjustments_count }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Remises confirmées / retours</dt>
                <dd>
                  {{ report.stock.movements_in_period.deliveries_confirmed_count }} /
                  {{ report.stock.movements_in_period.physical_returns_count }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Inventaires ouverts / validés</dt>
                <dd>
                  {{ report.stock.movements_in_period.open_inventories_count }} /
                  {{ report.stock.movements_in_period.validated_inventories_count }}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        v-if="report.workshop"
        title="Atelier optique"
        title-id="titre-gestion-atelier"
        icon="workshop"
        description="Flux de création et remise comparés à N-1, en-cours ouverts, retards datés, ordres sans date attendue et reprises qualité."
      >
        <dl class="stat-grid">
          <StatTile
            label="Ordres créés"
            :value="report.workshop.created_count.current"
            :hint="`N-1 : ${report.workshop.created_count.previous} · Écart : ${formatCountDelta(report.workshop.created_count.delta, report.workshop.created_count.delta_pct_bps)}`"
          />
          <StatTile
            label="Prêts ou remis"
            :value="report.workshop.delivered_or_ready_count.current"
            tone="success"
            :hint="`N-1 : ${report.workshop.delivered_or_ready_count.previous} · Écart : ${formatCountDelta(report.workshop.delivered_or_ready_count.delta, report.workshop.delivered_or_ready_count.delta_pct_bps)}`"
          />
          <StatTile label="En-cours ouverts" :value="report.workshop.open_total" />
          <StatTile
            label="En retard"
            :value="report.workshop.overdue_open_count"
            :tone="report.workshop.overdue_open_count > 0 ? 'warning' : 'neutral'"
            :hint="`${report.workshop.unknown_expected_date_count} sans date attendue · ${report.workshop.orders_without_frame_item_count} sans monture liée`"
          />
          <StatTile
            label="Reprises / QC échoués"
            :value="`${report.workshop.reworks_in_period} / ${report.workshop.failed_qc_in_period}`"
            :tone="
              report.workshop.reworks_in_period + report.workshop.failed_qc_in_period > 0
                ? 'warning'
                : 'neutral'
            "
          />
        </dl>

        <ul
          v-if="report.workshop.by_status.length > 0"
          class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          <li
            v-for="row in report.workshop.by_status"
            :key="row.status"
            class="rounded-lg border border-line bg-canvas px-3 py-2 text-sm tabular-nums"
          >
            <p class="font-semibold">{{ workshopStatusLabel(row.status) }}</p>
            <p class="text-muted">
              {{ row.count }} ordre(s)
              <template v-if="row.overdue_count > 0"> · {{ row.overdue_count }} en retard</template>
            </p>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        v-if="report.patients"
        title="Activité et patients"
        title-id="titre-gestion-patients"
        icon="patients"
        description="Visites non annulées, patients distincts, nouveaux et anciens comparés à N-1, et complétude des fiches actives."
      >
        <dl class="stat-grid">
          <StatTile
            label="Visites"
            :value="report.patients.visits_count.current"
            tone="gold"
            :hint="`N-1 : ${report.patients.visits_count.previous} · Écart : ${formatCountDelta(report.patients.visits_count.delta, report.patients.visits_count.delta_pct_bps)}`"
          />
          <StatTile
            label="Patients distincts"
            :value="report.patients.distinct_patients.current"
            :hint="`N-1 : ${report.patients.distinct_patients.previous} · Écart : ${formatCountDelta(report.patients.distinct_patients.delta, report.patients.distinct_patients.delta_pct_bps)}`"
          />
          <StatTile
            label="Nouveaux patients"
            :value="report.patients.new_patients.current"
            :hint="`N-1 : ${report.patients.new_patients.previous} · Écart : ${formatCountDelta(report.patients.new_patients.delta, report.patients.new_patients.delta_pct_bps)}`"
          />
          <StatTile
            label="Patients anciens"
            :value="report.patients.returning_patients.current"
            :hint="`N-1 : ${report.patients.returning_patients.previous} · Écart : ${formatCountDelta(report.patients.returning_patients.delta, report.patients.returning_patients.delta_pct_bps)}`"
          />
        </dl>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Motifs de visite</h3>
            <p v-if="report.patients.visits_by_reason.length === 0" class="mt-1 text-muted">
              Aucune visite sur la période.
            </p>
            <ul v-else class="mt-2 space-y-1">
              <li
                v-for="row in report.patients.visits_by_reason"
                :key="row.reason"
                class="flex justify-between gap-2 tabular-nums"
              >
                <span>{{ reasonLabel(row.reason) }}</span>
                <span class="font-medium">{{ row.count }}</span>
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">
              Identités partielles ({{ report.patients.incomplete_identity.total_active_patients }}
              fiches actives)
            </h3>
            <dl class="mt-2 space-y-1 tabular-nums">
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Date de naissance inconnue</dt>
                <dd>{{ report.patients.incomplete_identity.birth_date_unknown }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sexe non renseigné</dt>
                <dd>{{ report.patients.incomplete_identity.sex_unknown }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans téléphone</dt>
                <dd>{{ report.patients.incomplete_identity.phone_unknown }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans adresse</dt>
                <dd>{{ report.patients.incomplete_identity.address_unknown }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        v-if="report.clinical"
        title="Consultations et clinique"
        title-id="titre-gestion-clinique"
        icon="consultations"
        description="Comptages anonymisés des consultations, prescriptions validées et données manquantes (aucune moyenne d’acuité visuelle)."
      >
        <dl class="stat-grid">
          <StatTile
            label="Consultations clôturées"
            :value="report.clinical.consultations_completed.current"
            tone="gold"
            :hint="`N-1 : ${report.clinical.consultations_completed.previous} · Écart : ${formatCountDelta(report.clinical.consultations_completed.delta, report.clinical.consultations_completed.delta_pct_bps)}`"
          />
          <StatTile
            label="Prescriptions optiques validées"
            :value="report.clinical.optical_prescriptions_issued.current"
            :hint="`N-1 : ${report.clinical.optical_prescriptions_issued.previous} · Écart : ${formatCountDelta(report.clinical.optical_prescriptions_issued.delta, report.clinical.optical_prescriptions_issued.delta_pct_bps)}`"
          />
          <StatTile
            label="Taux de prescription"
            :value="formatBpsPercent(report.clinical.prescriptions_rate_bps, false)"
          />
          <StatTile
            label="Ordonnances / Orientations"
            :value="`${report.clinical.medication_orders_count} / ${report.clinical.referrals_count}`"
          />
        </dl>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Amétropies constatées</h3>
            <p v-if="report.clinical.by_ametropia.length === 0" class="mt-1 text-muted">
              Aucune amétropie enregistrée sur la période.
            </p>
            <ul v-else class="mt-2 space-y-1">
              <li
                v-for="row in report.clinical.by_ametropia"
                :key="row.code"
                class="flex justify-between gap-2 tabular-nums"
              >
                <span>{{ termLabel('AMETROPIA', row.code) }}</span>
                <span class="font-medium">{{ row.count }}</span>
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-line bg-canvas p-3 text-sm">
            <h3 class="font-semibold">Rubriques cliniques manquantes</h3>
            <dl class="mt-2 space-y-1 tabular-nums">
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans acuité visuelle</dt>
                <dd>{{ report.clinical.incomplete_clinical_data.without_acuity }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans réfraction</dt>
                <dd>{{ report.clinical.incomplete_clinical_data.without_refraction }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans amétropie</dt>
                <dd>{{ report.clinical.incomplete_clinical_data.without_ametropia }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted">Sans motif / orientation non renseignée</dt>
                <dd>
                  {{ report.clinical.incomplete_clinical_data.without_complaint }} /
                  {{ report.clinical.incomplete_clinical_data.referral_unknown }}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Définitions et provenance"
        title-id="titre-definitions-gestion"
        icon="info"
        :description="`Source : ${report.provenance.source} · Fuseau : ${report.provenance.period_timezone}`"
      >
        <p class="mb-2 text-sm text-muted">
          {{ report.provenance.previous_period_rule }}
        </p>
        <details class="mb-3 text-sm text-muted">
          <summary class="cursor-pointer font-medium hover:text-ink">
            Preuve technique d’intégrité (Empreinte SHA-256)
          </summary>
          <p class="mt-1 break-all">
            <code class="font-mono text-xs">{{ report.provenance.dataset_sha256 }}</code>
          </p>
        </details>
        <ul class="divide-y divide-line text-sm">
          <li v-for="def in report.definitions" :key="def.code" class="py-2 first:pt-0 last:pb-0">
            <p class="font-semibold">{{ def.label }}</p>
            <p class="text-muted">Formule : {{ def.formula }}</p>
            <p class="text-muted">
              Dénominateur : {{ def.denominator }} · Exclusions : {{ def.exclusion_note }}
            </p>
          </li>
        </ul>
      </SectionCard>

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="report.timezone"
      />
    </template>
  </section>
</template>

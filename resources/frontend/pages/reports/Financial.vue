<script setup lang="ts">
/**
 * Finance du cabinet sur une période (R01 ; fichier 03 « Caisse et indicateurs » ; fichier 19 « Dashboard distant »),
 * module « sales », EN LIGNE, gérante seule (`finance.global.read`). Quatre lectures qui ne se mélangent jamais :
 *  - chiffre d'affaires = factures émises − avoirs émis dans la période (une reprise de créance papier n'est pas une vente) ;
 *  - encaissements = paiements − contre-écritures − remboursements, à leur date effective (le règlement d'aujourd'hui d'une
 *    ancienne facture augmente les encaissements d'aujourd'hui, pas le chiffre d'affaires) ;
 *  - créances et crédits à rembourser, de TOUTES les périodes, à l'instant de la lecture ;
 *  - caisse : sessions clôturées dans la période.
 * La fraîcheur est dite EN PREMIER : un poste hors ligne qui n'a pas transmis ses pièces, ou dont des commandes reçues
 * attendent, rend les totaux incomplets. Aucun « payé » ni « soldé » ; une lecture qui échoue est « indisponible ».
 */
import { computed, ref } from 'vue'

import { clinicToday, formatDayFr, formatInstantFr } from '@/app/clinicTime'
import { getFinancialReport } from '@/app/services/billing'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  authorLabel,
  collectionRows,
  deviceNotice,
  deviceStateLabel,
  freshnessHeadline,
  periodCashNet,
  periodOtherNet,
  signedAmount,
} from '@/domain/billing/financialReport'
import type { FinancialReport } from '@/domain/contracts/generated'
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  periodError,
  presetPeriod,
} from '@/domain/reports/statistics'
import { CivilDate } from '@/domain/values/civilDate'
import { formatMoney, paymentMethodLabel } from '@/pages/sales/format'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const preset = ref<PeriodPreset | 'custom'>('month')
const initial = presetPeriod('month', clinicToday())
/** Période lue (AAAA-MM-JJ), appliquée par les boutons ou par « Afficher la période ». */
const shown = ref({ from: initial.from.toString(), to: initial.to.toString() })
const customFrom = ref<string | null>(shown.value.from)
const customTo = ref<string | null>(shown.value.to)
const customError = ref<string | null>(null)

const read = useServerRead<FinancialReport>(() =>
  getFinancialReport(shown.value.from, shown.value.to),
)
const report = computed(() => read.data.value)

const title = computed(() => {
  const from = formatDayFr(CivilDate.fromString(shown.value.from))
  if (shown.value.from === shown.value.to) return `Période : ${from}`
  return `Période : du ${from} au ${formatDayFr(CivilDate.fromString(shown.value.to))}`
})

const rows = computed(() => (report.value === null ? [] : collectionRows(report.value)))
const headline = computed(() =>
  report.value === null ? null : freshnessHeadline(report.value.freshness),
)
const notices = computed(() => {
  const current = report.value
  if (current === null) return []
  return current.freshness.devices.map((device) => ({
    device,
    notice: deviceNotice(
      device,
      current.freshness.silence_hours,
      device.last_sync_at === null ? null : formatInstantFr(device.last_sync_at),
    ),
  }))
})

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

function count(value: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${value} ${value > 1 ? pluralForm : singular}`
}
</script>

<template>
  <section aria-labelledby="titre-finance" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-finance"
      title="Finance du cabinet"
      icon="chart"
      subtitle="Chiffre d’affaires, encaissements, créances et caisse sur la période choisie, calculés par le serveur. Réservé à la gérante."
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
          <DateField v-model="customFrom" label="Du" control-id="finance-debut" />
        </div>
        <div class="min-w-0 sm:flex-1">
          <DateField v-model="customTo" label="Au" control-id="finance-fin" :error="customError" />
        </div>
        <AppButton type="submit" variant="secondary" :pressed="preset === 'custom'"
          >Afficher la période</AppButton
        >
      </form>
    </div>

    <p role="status" class="flex items-center gap-2 text-lg font-semibold">
      <AppIcon name="calendar" :size="20" class="text-gold" />
      <span class="min-w-0">{{ title }}</span>
    </p>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="la finance du cabinet"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-if="report && read.state.value === 'ready'">
      <section
        aria-labelledby="titre-fraicheur"
        class="space-y-3 rounded-xl border bg-surface p-4 shadow-card"
        :class="headline?.tone === 'warn' ? 'border-danger' : 'border-line'"
        :data-fraicheur="report.freshness.complete ? 'complete' : 'incomplete'"
      >
        <h2 id="titre-fraicheur" class="text-lg font-semibold">Fraîcheur des totaux</h2>
        <p class="text-base" :class="headline?.tone === 'warn' ? 'font-semibold' : ''">
          {{ headline?.text }}
        </p>
        <ul v-if="notices.length > 0" class="space-y-2">
          <li
            v-for="entry in notices"
            :key="entry.device.device_id"
            class="space-y-1 rounded-lg border border-line bg-canvas p-3"
          >
            <p class="flex flex-wrap items-baseline justify-between gap-x-3">
              <span class="font-semibold break-words">{{ entry.device.name }}</span>
              <span>{{ deviceStateLabel(entry.device.state) }}</span>
            </p>
            <p v-if="entry.notice" class="text-base">{{ entry.notice }}</p>
            <p v-else class="text-sm text-muted">
              Dernière pièce reçue le
              {{ entry.device.last_sync_at ? formatInstantFr(entry.device.last_sync_at) : '—' }}.
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="titre-ca" class="space-y-3">
        <h2 id="titre-ca" class="text-lg font-semibold">Chiffre d’affaires de la période</h2>
        <dl
          class="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3"
        >
          <div>
            <dt class="text-sm text-muted">Factures émises</dt>
            <dd class="tabular-nums">
              {{ report.revenue.issued.count }} ·
              {{ formatMoney(report.revenue.issued.total_gross) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Avoirs émis</dt>
            <dd class="tabular-nums">
              {{ report.revenue.credited.count }} ·
              {{ formatMoney(report.revenue.credited.amount_gross) }}
            </dd>
          </div>
          <div>
            <dt class="text-base font-semibold">Chiffre d’affaires net</dt>
            <dd class="text-xl font-bold tabular-nums" data-montant="ca-net">
              {{ formatMoney(report.revenue.net) }}
            </dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Factures émises moins avoirs émis pendant la période. Une créance reprise du carnet papier
          n’est jamais une vente.
        </p>
      </section>

      <section aria-labelledby="titre-encaissements-periode" class="space-y-3">
        <h2 id="titre-encaissements-periode" class="text-lg font-semibold">
          Encaissements de la période
        </h2>
        <StateMessage
          v-if="rows.length === 0"
          state="empty"
          title="Aucun encaissement sur cette période"
        >
          Le serveur n’a enregistré aucun encaissement, contre-écriture ni remboursement dans la
          période.
        </StateMessage>
        <ul v-else class="space-y-3">
          <li
            v-for="row in rows"
            :key="row.method"
            class="space-y-1 rounded-xl border border-line bg-surface p-3 shadow-card"
          >
            <p class="flex flex-wrap items-baseline justify-between gap-x-3">
              <span class="font-semibold">{{ paymentMethodLabel(row.method) }}</span>
              <strong class="tabular-nums">{{ formatMoney(row.net) }}</strong>
            </p>
            <p class="text-sm text-muted">
              {{ count(row.count, 'encaissement') }} : {{ formatMoney(row.collected) }}
              <template v-if="row.reversed > 0">
                · contre-écritures −{{ formatMoney(row.reversed) }}</template
              >
              <template v-if="row.refunded > 0">
                · remboursements −{{ formatMoney(row.refunded) }}</template
              >
            </p>
          </li>
        </ul>
        <dl
          class="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3"
        >
          <div>
            <dt class="text-sm text-muted">Espèces (tiroir)</dt>
            <dd class="tabular-nums">{{ formatMoney(periodCashNet(report)) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Autres modes (rapprochés à part)</dt>
            <dd class="tabular-nums">{{ formatMoney(periodOtherNet(report)) }}</dd>
          </div>
          <div>
            <dt class="text-base font-semibold">Total net encaissé</dt>
            <dd class="text-xl font-bold tabular-nums" data-montant="encaisse-net">
              {{ formatMoney(report.collections.net_total) }}
            </dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Corrections de la période : contre-écritures
          {{ report.collections.corrections.reversals.count }} ·
          {{ formatMoney(report.collections.corrections.reversals.amount) }}, remboursements
          {{ report.collections.corrections.refunds.count }} ·
          {{ formatMoney(report.collections.corrections.refunds.amount) }}. Dont encaissé sur des
          créances reprises du carnet papier :
          {{ formatMoney(report.collections.on_legacy.net_amount) }}.
        </p>
      </section>

      <section aria-labelledby="titre-creances" class="space-y-3">
        <h2 id="titre-creances" class="text-lg font-semibold">Créances et crédits à rembourser</h2>
        <dl
          class="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2"
        >
          <div>
            <dt class="text-sm text-muted">Reste à encaisser (factures ouvertes)</dt>
            <dd class="font-semibold tabular-nums" data-montant="creances">
              {{ formatMoney(report.receivables.amount_due) }}
              <span class="font-normal"
                >({{ count(report.receivables.invoices_count, 'facture') }})</span
              >
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Dont créances reprises du carnet papier</dt>
            <dd class="tabular-nums">
              {{ formatMoney(report.receivables.of_which_legacy.amount_due) }}
              <span class="text-muted"
                >({{ count(report.receivables.of_which_legacy.invoices_count, 'facture') }})</span
              >
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Crédits à rembourser</dt>
            <dd class="tabular-nums" data-montant="credits">
              {{ formatMoney(report.receivables.refundable_credit.amount) }}
              <span class="text-muted"
                >({{ count(report.receivables.refundable_credit.invoices_count, 'facture') }})</span
              >
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Créances papier reprises dans la période</dt>
            <dd class="tabular-nums">
              {{ report.legacy_imported.count }} ·
              {{ formatMoney(report.legacy_imported.opening_balance) }}
            </dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Restes à encaisser et crédits à l’instant de la lecture ({{
            formatInstantFr(report.generated_at)
          }}), toutes périodes et toutes factures émises confondues.
        </p>
        <LinkButton :to="{ name: 'factures' }" variant="secondary">Voir les factures</LinkButton>
      </section>

      <section aria-labelledby="titre-caisse-periode" class="space-y-3">
        <h2 id="titre-caisse-periode" class="text-lg font-semibold">Caisse</h2>
        <dl
          class="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3"
        >
          <div>
            <dt class="text-sm text-muted">Sessions clôturées dans la période</dt>
            <dd class="tabular-nums">{{ report.cash_sessions.closed_count }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Espèces attendues · comptées</dt>
            <dd class="tabular-nums">
              {{ formatMoney(report.cash_sessions.expected_total) }} ·
              {{ formatMoney(report.cash_sessions.counted_total) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Écart de caisse</dt>
            <dd class="font-semibold tabular-nums" data-montant="ecart-caisse">
              {{ signedAmount(report.cash_sessions.variance_total, formatMoney) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Corrections après clôture</dt>
            <dd class="tabular-nums">
              {{ formatMoney(report.cash_sessions.post_closure_reversals) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Sessions encore ouvertes</dt>
            <dd class="tabular-nums">{{ report.cash_sessions.open_count }}</dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Une session clôturée reste figée : une correction postérieure s’ajoute à part et ne
          réécrit jamais l’attendu.
        </p>
        <LinkButton :to="{ name: 'caisse-du-jour' }" variant="secondary"
          >Voir la caisse du jour</LinkButton
        >
      </section>

      <section aria-labelledby="titre-auteurs" class="space-y-3">
        <h2 id="titre-auteurs" class="text-lg font-semibold">Par personne</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h3 class="font-semibold">Ventes (auteur de l’émission)</h3>
            <p v-if="report.revenue.by_author.length === 0" class="text-sm text-muted">
              Aucune facture ni aucun avoir émis dans la période.
            </p>
            <ul v-else class="space-y-1">
              <li
                v-for="author in report.revenue.by_author"
                :key="author.user_id ?? 'inconnu'"
                class="flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span class="break-words">{{
                  authorLabel(author.display_name, author.user_id)
                }}</span>
                <span class="tabular-nums">{{ formatMoney(author.net) }}</span>
              </li>
            </ul>
          </div>
          <div class="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h3 class="font-semibold">Encaissements (auteur du paiement)</h3>
            <p v-if="report.collections.by_author.length === 0" class="text-sm text-muted">
              Aucun encaissement dans la période.
            </p>
            <ul v-else class="space-y-1">
              <li
                v-for="author in report.collections.by_author"
                :key="author.user_id ?? 'inconnu'"
                class="flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span class="break-words">{{
                  authorLabel(author.display_name, author.user_id)
                }}</span>
                <span class="tabular-nums">{{ formatMoney(author.net_amount) }}</span>
              </li>
            </ul>
          </div>
        </div>
        <p class="text-sm text-muted">
          Celui qui vend et celui qui encaisse sont deux responsabilités : elles ne se fusionnent
          pas.
        </p>
      </section>

      <FreshnessNote v-if="read.freshness.value" :freshness="read.freshness.value" />
    </template>
  </section>
</template>
